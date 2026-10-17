// Entertainment metrics for a batch of real runs (objective proxies only; "is it fun" needs people).
//   node lab/fun-metrics.ts lab/runs/P1
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { RunResult } from "../src/sim/engine.ts";
import { gapSeconds, watchSeconds } from "../src/sim/timing.ts";
import { storyOf } from "../src/town/story.ts";

const dir = process.argv[2] ?? "lab/runs/P1";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const rows: Record<string, unknown>[] = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const run: RunResult = j.run;
  const early: { npc: string; ms: number }[] = j.early ?? [];
  const calls = run.decisions.flatMap((d) => d.llm).filter((l) => l.status === 200);
  // visible beats: something a viewer reads or sees change
  const beats = run.events.filter((e) => ["decide", "talk", "phone", "look", "inspect", "state", "notice", "article", "statement", "gather"].includes(e.type) && !e.data.budget && !e.data.missed);
  const events = [...run.events].sort((a, b) => a.t - b.t);
  let watch = 0;
  for (let i = 0; i < events.length; i++) watch += watchSeconds(events[i]) + (i ? gapSeconds(events[i].t - events[i - 1].t) : 0);
  // longest stretch with no new decision arriving (what a streamed viewer waits through, at worst)
  const ends = calls.map((l) => l.wallEndMs).sort((a, b) => a - b);
  let longestWait = ends[0] ?? 0;
  for (let i = 1; i < ends.length; i++) longestWait = Math.max(longestWait, ends[i] - ends[i - 1]);
  // acts Gemma chose (read from the raw answers: early batches dropped the field when parsing)
  const acts = run.decisions
    .map((d) => {
      const raw = d.llm.at(-1)?.raw ?? "";
      return /"act"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? d.output?.act;
    })
    .filter(Boolean) as string[];
  const card = storyOf(run);
  // retellings only (the chain also shows articles, town talk and what people saw on the way)
  const retold = card.spine.filter((h) => h.via === "talk" || h.via === "phone");
  const hopsWithChange = retold.filter((h) => h.heard && h.heard !== h.text).length;
  rows.push({
    id: f.replace(".json", ""),
    seed: `${run.config.seedNpc}「${run.config.seedText}」`,
    headline: `${card.icon} ${card.headline}`,
    endingKind: card.stopper ? "fizzle-with-quote" : card.drift ? "topic-drift" : /查證|查無實據/.test(card.headline) ? "first-hand-check" : /捲了進來/.test(card.headline) ? "spread" : "world-change",
    firstVisibleS: early.length ? +(early[0].ms / 1000).toFixed(1) : null,
    firstDecisionS: ends.length ? +(ends[0] / 1000).toFixed(1) : null,
    longestWaitS: +(longestWait / 1000).toFixed(1),
    totalModelS: +(calls.reduce((s, l) => s + l.latencyMs, 0) / 1000).toFixed(0),
    wallS: +(run.wall.ms / 1000).toFixed(0),
    watchS: +watch.toFixed(0),
    beats: beats.length,
    beatsPerMinWatched: +(beats.length / Math.max(watch / 60, 0.1)).toFixed(1),
    people: card.reached.length,
    distinctActs: new Set(acts).size,
    acts: acts.join(","),
    spineHops: retold.length,
    retoldWithChanges: hopsWithChange,
    closestCall: !!card.closest,
    cost: +calls.reduce((s, l) => s + (l.platformCost ?? 0), 0).toFixed(5),
  });
}
writeFileSync(`${dir}/fun-metrics.json`, JSON.stringify(rows, null, 1));
console.table(rows.map(({ seed, acts, ...r }) => r));
const avg = (k: string) => (rows.reduce((s, r) => s + Number((r as Record<string, unknown>)[k] ?? 0), 0) / rows.length).toFixed(1);
console.log(`runs ${rows.length} | first visible ${avg("firstVisibleS")} s | first decision ${avg("firstDecisionS")} s | longest wait ${avg("longestWaitS")} s | watch ${avg("watchS")} s | beats/min ${avg("beatsPerMinWatched")} | distinct acts ${avg("distinctActs")}`);
