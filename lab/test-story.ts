// The results story card must only retell what the log contains. node --test lab/test-story.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { simulate, type RunResult } from "../src/sim/engine.ts";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";
import { storyOf } from "../src/town/story.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const runs: { name: string; run: RunResult }[] = [];
const SEEDS = [
  "I heard the mayor is terrified of pigeons.",
  "I heard the stage in the plaza was thrown together in a rush and might not hold anyone.",
  "Looks like someone is planning to sabotage the festival tonight.",
  "Fish at the harbor is extra cheap today.",
];
for (const [i, text] of SEEDS.entries())
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
      // the chain also carries public words, town talk and first-hand sights on the way: each is its own logged event
      if (h.via !== "talk" && h.via !== "phone") {
        const x = run.events.find((y) => y.id === h.event);
        const said = x && (h.via === "crowd" ? x.type === "deliver" && x.target === h.to : x.type === h.via && x.actor === h.from);
        const words = x && (h.via === "look" || h.via === "inspect" ? String(x.data.found).includes(h.text) : String(h.via === "article" ? x.data.headline : x.data.text) === h.text);
        assert.ok(said && words, `${name}: ${h.via} step ${h.event} not in log`);
        continue;
      }
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
    if (card.headline.includes("Lantern Festival called off")) assert.ok(has("festival"), name);
    if (card.headline.includes("stage sealed off")) assert.ok(has("stage"), name);
    if (card.headline.includes("Police called out")) assert.ok(has("police"), name);
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
  assert.ok(card.headline.includes("set out to check one thing and found another") && card.headline.includes("over budget"), card.headline);
  // the log is in Chinese: the finding is the overrun check in its older wording
  const check = FACTS.find((x) => x.id === "budget_overrun")!.check!;
  assert.ok(run.events.some((e) => e.type === "inspect" && [check.zh, check.legacyZh].some((w) => w && String(e.data.found).includes(w))), "the finding is in the log");
});

test("a true fact seen first-hand is a finding even if it lowered a belief (P12 wobble-organizer)", () => {
  const f = "lab/runs/P12/wobble-organizer.json";
  if (!existsSync(f)) return;
  const card = storyOf(JSON.parse(readFileSync(f, "utf8")).run as RunResult);
  assert.ok(!card.headline.includes("no sign of it"), card.headline);
  // the log is in Chinese: the strut is 支架 there
  assert.ok(/went and checked: /.test(card.headline) && /支架|strut/.test(card.headline), card.headline);
});
