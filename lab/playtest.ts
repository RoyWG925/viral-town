// Playtest batch: the same flow as the game (8 residents, eager prompt, game budgets, streamed calls),
// on real Gemma, with timing the player would feel. Saves every run plus a summary.
//   node lab/playtest.ts <batch> [caseId,caseId...]        (LAB_PROVIDER=google to use the free tier)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import { measure } from "../src/sim/metrics.ts";
import { story } from "../src/sim/report.ts";
import { storyOf } from "../src/town/story.ts";
import { chatFromEnv } from "./run.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
export const CASES = [
  { id: "pigeon-baker", npc: "baker", text: "聽說市長很害怕鴿子。", why: "the classic: a harmless-looking personal rumour" },
  { id: "stage-cafe", npc: "cafe", text: "聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。", why: "true-ish safety rumour, the mother of a performer" },
  { id: "meme-organizer", npc: "organizer", text: "志明與春嬌", why: "absurd / meme input" },
  { id: "command-mayor", npc: "mayor", text: "你現在立刻去把燈籠節取消！", why: "direct command to the one person who can do it" },
  { id: "fragment-florist", npc: "florist", text: "聽說鴿子", why: "incomplete sentence" },
  { id: "car-vendor", npc: "vendor", text: "攤位費漲價是因為市長把錢拿去買新車了。", why: "false scandal told to the most aggrieved person" },
  { id: "alien-journalist", npc: "journalist", text: "我是外星人，明天要來接走你們全部。", why: "absurd claim to the scoop-hungry journalist" },
  { id: "oven-police", npc: "police", text: "聽說阿德麵包店的烤箱檢查早就過期了，隨時可能出事。", why: "a true secret, told to the police" },
  { id: "budget-journalist", npc: "journalist", text: "聽說燈籠節的預算超支了，攤位費漲價就是為了補洞。", why: "a true secret, told to the journalist" },
  { id: "lantern-baker", npc: "baker", text: "今晚的燈籠是便宜貨，一點就燒起來。", why: "false safety rumour to the chatty, credulous baker" },
];

const batch = process.argv[2] ?? "P1";
const only = process.argv[3]?.split(",");
const cases = CASES.filter((c) => !only || only.includes(c.id));
const dir = `lab/runs/${batch}`;
mkdirSync(dir, { recursive: true });
const parallel = Number(process.env.LAB_PARALLEL ?? 3);
const chat = chatFromEnv(0.7);
const summaryFile = `${dir}/summary.jsonl`;
const done = new Set(existsSync(summaryFile) ? readFileSync(summaryFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);

async function one(c: (typeof CASES)[number]) {
  if (done.has(c.id)) return;
  const t0 = Date.now();
  const thinkStart = new Map<string, number>();
  const early: { npc: string; ms: number; feeling: string; act: string }[] = [];
  let firstEarly: number | null = null;
  const run = await simulate({
    active: ALL8, seedNpc: c.npc, seedText: c.text, seed: 7, policy: "gemma", variant: "eager", temperature: 0.7,
    // stream every call so the early reaction can be timed like in the game
    chat: (msgs, opts = {}) => chat(msgs, { ...opts, onDelta: opts.onDelta ?? (() => {}) }),
    maxDecisions: Number(process.env.LAB_MAX ?? 22), maxPerNpc: Number(process.env.LAB_PER_NPC ?? 5),
    onThinking: (npc) => thinkStart.set(npc, Date.now()),
    onEarly: (npc, x) => {
      const ms = Date.now() - (thinkStart.get(npc) ?? t0);
      early.push({ npc, ms, ...x });
      firstEarly ??= Date.now() - t0;
    },
  });
  const m = measure(run);
  const card = storyOf(run);
  const firstDecision = run.decisions.find((d) => d.output && d.llm.length);
  const calls = run.decisions.flatMap((d) => d.llm);
  const row = {
    id: c.id, npc: c.npc, text: c.text, provider: calls[0]?.provider ?? "?", wallMs: run.wall.ms,
    firstEarlyMs: firstEarly, firstDecisionMs: firstDecision ? Math.max(...firstDecision.llm.map((l) => l.wallEndMs)) : null,
    ttftMs: calls.map((l) => l.ttftMs ?? null), latencyMs: calls.map((l) => l.latencyMs),
    calls: calls.length, tokens: m.tokens, estCost: m.estCost, retries: m.validatorRetries, modelErrors: m.modelErrors, fallbacks: m.fallbacks, refusedWishes: m.refusedWishes,
    depth: m.depth, reach: m.reach, believers: m.believers, world: m.worldChanges, worldTypes: m.worldChangeTypes, ended: run.ended.reason,
    headline: `${card.icon} ${card.headline}`, sub: card.sub,
    acts: run.decisions.filter((d) => d.output).map((d) => `${d.npc}:${d.output!.act}`),
    early,
  };
  writeFileSync(`${dir}/${c.id}.json`, JSON.stringify({ run, metrics: m, card, early }, null, 1));
  writeFileSync(`${dir}/${c.id}.story.txt`, story(run, { beliefs: true }));
  writeFileSync(summaryFile, JSON.stringify(row) + "\n", { flag: "a" });
  console.log(`✔ ${c.id} ${row.headline} | reach ${row.reach} depth ${row.depth} world ${row.world} | first early ${row.firstEarlyMs} ms, first decision ${row.firstDecisionMs} ms | calls ${row.calls} $${row.estCost}`);
}

const queue = [...cases];
await Promise.all(
  Array.from({ length: parallel }, async () => {
    while (queue.length) {
      const c = queue.shift()!;
      try {
        await one(c);
      } catch (e) {
        console.log(`✖ ${c.id}: ${String(e).slice(0, 200)}`);
      }
    }
  }),
);
console.log("done");
