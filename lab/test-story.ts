// The results story card must only retell what the log contains. node --test lab/test-story.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { simulate, type RunResult } from "../src/sim/engine.ts";
import { PERSONAS } from "../src/sim/scenario.ts";
import { storyOf } from "../src/town/story.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const runs: { name: string; run: RunResult }[] = [];
for (const [i, text] of ["聽說市長很害怕鴿子。", "聽說廣場的舞台是趕工搭的，可能撐不住人。", "今晚好像有人要在慶典上搞破壞。", "港口今天的魚特別便宜。"].entries())
  for (const npc of ["baker", "police", "journalist"]) runs.push({ name: `rules-${npc}-${i}`, run: await simulate({ active: ALL8, seedNpc: npc, seedText: text, seed: 3 + i, policy: "rules", maxDecisions: 30, maxPerNpc: 6 }) });
for (const dir of ["public/recorded", "lab/runs/P1"]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
    const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    if (j.run || j.events) runs.push({ name: `${dir}/${f}`, run: j.run ?? j });
  }
}

test("every hop on the card is a real conversation in the log", () => {
  for (const { name, run } of runs) {
    const card = storyOf(run);
    for (const h of card.spine) {
      const e = run.events.find((x) => (x.type === "talk" || x.type === "phone") && x.actor === h.from && x.target === h.to && String(x.data.text) === h.text);
      assert.ok(e, `${name}: hop ${h.from}→${h.to} not in log`);
    }
  }
});

test("names in the headline are residents who took part", () => {
  for (const { name, run } of runs) {
    const card = storyOf(run);
    const involved = new Set(run.events.flatMap((e) => [e.actor, e.target]).filter(Boolean));
    for (const p of PERSONAS) if (card.headline.includes(p.name)) assert.ok(involved.has(p.id), `${name}: ${p.name} in headline but not in the story`);
  }
});

test("a world-change headline only appears when that change happened", () => {
  for (const { name, run } of runs) {
    const card = storyOf(run);
    const has = (key: string) => run.events.some((e) => e.type === "state" && e.data.key === key);
    if (card.headline.includes("燈籠節取消")) assert.ok(has("festival"), name);
    if (card.headline.includes("舞台被封鎖")) assert.ok(has("stage"), name);
    if (card.headline.includes("警察出動")) assert.ok(has("police"), name);
  }
});

test("a quoted stopper thought is that resident's real thought", () => {
  for (const { name, run } of runs) {
    const card = storyOf(run);
    if (!card.stopper) continue;
    assert.ok(run.decisions.some((d) => d.npc === card.stopper!.npc && d.output?.thought === card.stopper!.thought), name);
  }
});

test("digging up a different hidden truth is the headline, not 'nothing found' (P4 car-vendor)", () => {
  const f = "lab/runs/P4/car-vendor.json";
  if (!existsSync(f)) return;
  const run = JSON.parse(readFileSync(f, "utf8")).run as RunResult;
  const card = storyOf(run);
  assert.ok(card.headline.includes("預算超支"), card.headline);
  assert.ok(run.events.some((e) => e.type === "inspect" && String(e.data.found).includes("多了三成")), "the finding is in the log");
});
