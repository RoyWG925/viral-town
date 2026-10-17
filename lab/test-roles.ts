// The game-facing UI data must stay true to the engine and the log. node --test lab/test-roles.ts
//  - role cards: chips are the persona's own actions, contacts are its phone relations, copy hides wants/secrets
//  - example chips: the first one changed the world in real Gemma runs (P5–P9) wherever such an input exists
//  - suggestNext: log-derived, never the resident already told, prefers people the story has not reached
//  - 今晚行程: a countdown only when someone carries a played belief of the meeting's kind
//  - 補一句: a second seed is a second root of the story card
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { simulate, type RunResult } from "../src/sim/engine.ts";
import { FACTS, PERSONAS, ROUTINE } from "../src/sim/scenario.ts";
import { CAST, contactsOf, credulityOf, powerOf, ROLES, TOOL, toolsOf } from "../src/town/roles.ts";
import { storyOf, suggestNext } from "../src/town/story.ts";
import { meetingTicks, upcomingMeeting } from "../src/town/agenda.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const sorted = (r: RunResult) => [...r.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
const recorded = (id: string) => JSON.parse(readFileSync(`public/recorded/${id}.json`, "utf8")) as RunResult;
const grams = (t: string, n = 4) => [...t.replace(/[，。、！？；：「」\s]/g, "")].map((_, i, a) => a.slice(i, i + n).join("")).filter((g) => g.length === n);

test("every core resident has a role card", () => {
  assert.deepEqual([...CAST].sort(), [...ALL8].sort());
  for (const n of CAST) assert.equal(ROLES[n].examples.length, 2, n);
});

test("ability chips are exactly the persona's own actions; contacts are its phone relations", () => {
  for (const p of PERSONAS) {
    for (const t of toolsOf(p.id)) assert.ok(p.actions.includes(t.kind), `${p.id}: ${t.kind} is not one of its actions`);
    for (const label of powerOf(p.id)) assert.ok(toolsOf(p.id).some((t) => t.label === label), `${p.id}: power chip ${label} not on the card`);
    const phone = Object.entries(p.relations).filter(([, r]) => r.phone).map(([id]) => id).sort();
    assert.deepEqual([...contactsOf(p.id)].sort(), phone, p.id);
    const c = credulityOf(p.id);
    assert.equal(c.zh, p.credulity < 0.4 ? "很難說服" : p.credulity < 0.6 ? "半信半疑" : "容易相信", p.id);
  }
});

test("role copy never promises (會) and never gives away wants, secrets or fact keywords", () => {
  const keywords = FACTS.flatMap((f) => f.keywords);
  for (const p of PERSONAS) {
    const copy = [ROLES[p.id].tag, ...toolsOf(p.id).map((t) => t.label)].join(" ");
    assert.ok(!copy.includes("會"), `${p.id}: copy says 會: ${copy}`);
    for (const k of keywords) assert.ok(!copy.includes(k), `${p.id}: copy contains fact keyword ${k}`);
    for (const g of grams(p.wants)) assert.ok(!copy.includes(g), `${p.id}: copy echoes wants (${g})`);
    for (const s of p.secrets) for (const g of grams(FACTS.find((f) => f.id === s)!.zh)) assert.ok(!copy.includes(g), `${p.id}: copy echoes secret ${s} (${g})`);
  }
  for (const label of Object.values(TOOL)) assert.ok(!label!.includes("會"), label);
});

test("a resident's first example chip changed the world in P5–P9, wherever such an input exists", () => {
  const changed = new Map<string, Set<string>>();
  for (const dir of ["P5", "P6", "P7", "P8", "P9"].map((p) => `lab/runs/${p}`).filter(existsSync)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "fun-metrics.json")) {
      const run = (JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).run ?? null) as RunResult | null;
      if (!run?.config) continue;
      const world = run.events.some((e) => ["state", "notice", "article", "statement", "gather"].includes(e.type) && e.data.key !== "writing");
      if (world) (changed.get(run.config.seedNpc) ?? changed.set(run.config.seedNpc, new Set()).get(run.config.seedNpc)!).add(run.config.seedText);
    }
  }
  if (!changed.size) return; // lab runs not present in this checkout
  for (const [npc, texts] of changed) assert.ok(texts.has(ROLES[npc].examples[0]), `${npc}: first example "${ROLES[npc].examples[0]}" never changed the world`);
  for (const npc of ["baker", "cafe"]) assert.ok(!ROLES[npc].examples[0].includes("鴿子"), `${npc}: the pigeon line fizzled 5/5 and must not lead`);
});

test("suggestNext: two other residents, outside the reached set when the story fizzled (P1-meme-organizer)", () => {
  for (const id of ["P1-meme-organizer", "P5-oven-police", "P5-lantern-baker", "P2-stage-cafe"]) {
    const run = recorded(id);
    const card = storyOf(run);
    const next = suggestNext(run, card);
    assert.equal(next.length, 2, id);
    for (const s of next) {
      assert.notEqual(s.npc, run.config.seedNpc, id);
      assert.ok(!/會/.test(s.why), `${id}: ${s.why}`);
    }
    const outside = run.config.active.filter((n) => n !== run.config.seedNpc && !card.reached.includes(n));
    if (id === "P1-meme-organizer") assert.ok(outside.length > 0 && next.some((s) => outside.includes(s.npc)), `${id}: ${next.map((s) => s.npc)}`);
  }
});

test("今晚行程: P5-lantern-baker counts down to 老周's 17:00 stage round only once he carries a safety belief", () => {
  const run = recorded("P5-lantern-baker");
  const evs = sorted(run);
  const r = ROUTINE.find((x) => x.who === "police" && x.with === "organizer")!;
  let first: number | null = null;
  for (let i = 1; i <= evs.length; i++) {
    const played = evs.slice(0, i);
    const up = upcomingMeeting(run, played, played.at(-1)!.t);
    if (up?.at !== r.at) continue;
    first ??= played.at(-1)!.t;
    // the reason is in what has played: a belief of a kind the meeting is about
    assert.ok(played.some((e) => e.type === "belief" && (e.actor === "police" || e.actor === "organizer") && Number(e.data.to) >= 0.3), "countdown without a carried belief");
    assert.match(up.text, /老周/);
    assert.ok(!/封鎖|出動|取消|會/.test(up.text), `the chip implies an outcome: ${up.text}`);
  }
  assert.ok(first !== null && first >= r.at - 15 && first < r.at, `countdown never appeared before 17:00 (first ${first})`);
  // 阿珠's fee meeting is about policy/scandal; nobody in this lantern story carries that
  for (let i = 1; i <= evs.length; i++) assert.notEqual(upcomingMeeting(run, evs.slice(0, i), evs[i - 1].t)?.at, 210);
  const ticks = meetingTicks(run, evs, evs.at(-1)!.t, true);
  assert.ok(ticks.length > 0 && ticks.every((t) => t.state !== "ahead"));
});

test("補一句: the second seed is a root of the story, printed on the card", async () => {
  let asked = 0;
  // small talk fizzles at once under the rule policy, so the engine offers the lull
  const run = await simulate({
    active: ALL8, seedNpc: "florist", seedText: "港口今天的魚特別便宜。", seed: 1, policy: "rules", maxDecisions: 22, maxPerNpc: 6,
    onLull: async () => (asked++, { npc: "police", text: "聽說今晚有人要在慶典上搞破壞。" }),
  });
  const seeds = run.events.filter((e) => e.type === "seed");
  assert.equal(asked, 1);
  assert.equal(seeds.length, 2);
  const card = storyOf(run);
  assert.deepEqual(card.whispers, [{ npc: "police", text: "聽說今晚有人要在慶典上搞破壞。" }]);
  assert.ok(seeds[1].data.second, "the second seed is marked");
  // the story's suggestions never name the first listener
  assert.ok(suggestNext(run, card).every((s) => s.npc !== "florist"));
  for (const h of card.spine) assert.ok(run.events.some((e) => (e.type === "talk" || e.type === "phone") && e.actor === h.from && e.target === h.to && String(e.data.text) === h.text));
});
