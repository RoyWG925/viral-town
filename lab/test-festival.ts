// The festival's own clock: preparation milestones (17:00–19:30), word of mouth, and a 20:00 outcome composed from
// what happened. Pure rules over the validated log; every run reaches 20:00, even after the decision budget is spent.
// node --test lab/test-festival.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readinessOf } from "../src/sim/readiness.ts";
import { simulate } from "../src/sim/engine.ts";
import type { Chat, LlmCall } from "../src/sim/llm.ts";
import type { SimEvent } from "../src/sim/types.ts";

let k = 0;
const ev = (type: SimEvent["type"], t: number, data: Record<string, unknown> = {}, extra: Partial<SimEvent> = {}): SimEvent =>
  ({ id: `e${++k}`, t, type, causes: [], data, zh: "", ...extra }) as SimEvent;
const belief = (actor: string, claim: string, topic: string, says: string, to: number, t = 30) =>
  ev("belief", t, { claim, topic, says, to, verdict: to >= 0.5 ? "believe" : "doubt" }, { actor });
const talk = (actor: string, target: string, claims: string[], t = 40) => ev("talk", t, { claims, text: "…" }, { actor, target });

test("an untouched evening: every milestone goes to plan and the festival is on, with nothing to add", () => {
  const r = readinessOf([]);
  assert.equal(r.outcome.kind, "on");
  assert.deepEqual(r.outcome.tags, []);
  assert.equal(r.outcome.text, "今晚的燈籠節：照常舉行。");
  assert.deepEqual(r.milestones.map((m) => m.status), ["ok", "ok", "ok", "ok", "ok"]);
});

test("a shop that closed and reopened is open: no penalty, the pigeons still arrive", () => {
  const r = readinessOf([ev("state", 30, { key: "shops.flower", to: "closed" }), ev("state", 60, { key: "shops.flower", to: "open" })]);
  assert.equal(r.changes.length, 0);
  assert.equal(r.milestones.find((m) => m.id === "pigeons")!.status, "ok");
  assert.equal(r.outcome.kind, "on");
});

test("the flower shop still shut at 18:00: no pigeons, and the closing is the logged cause", () => {
  const close = ev("state", 170, { key: "shops.flower", to: "closed" });
  const r = readinessOf([close]);
  const p = r.milestones.find((m) => m.id === "pigeons")!;
  assert.equal(p.status, "failed");
  assert.deepEqual(p.causes, [close.id]);
  assert.ok(r.outcome.tags.includes("no_pigeons"));
  assert.ok(r.outcome.text.includes("沒有白鴿"));
});

test("美玲's own worry keeps the birds back only if she believes a danger, and the belief is the cause", () => {
  const sure = belief("florist", "c1", "pigeons_sick", "yes", 0.7, 100);
  assert.equal(readinessOf([sure]).milestones.find((m) => m.id === "pigeons")!.causes[0], sure.id);
  // believing the birds are healthy is not a danger
  assert.equal(readinessOf([belief("florist", "c2", "pigeons_sick", "no", 0.9, 100)]).milestones.find((m) => m.id === "pigeons")!.status, "ok");
  // a doubt is not enough
  assert.equal(readinessOf([belief("florist", "c3", "pigeons_sick", "yes", 0.4, 100)]).milestones.find((m) => m.id === "pigeons")!.status, "ok");
});

test("direction matters: a denial is not a scandal, believing the lanterns are safe is not a panic, gossip about cheap fish is nothing", () => {
  const denial = readinessOf([belief("journalist", "c1", "mayor_embezzled", "no", 0.9), ev("article", 60, { claims: ["c1"] }, { actor: "journalist" })]);
  assert.ok(!denial.changes.some((c) => c.delta.money), "a denial does not cost the festival money");
  const safe = readinessOf(["baker", "florist", "cafe", "vendor", "police", "organizer"].map((who) => belief(who, "c2", "lanterns_flammable", "no", 0.9)));
  assert.ok(!safe.changes.some((c) => c.why.includes("安全謠言")));
  const fish = readinessOf([belief("journalist", "c3", "other", "yes", 0.9), ev("article", 60, { claims: ["c3"] }, { actor: "journalist" })]);
  assert.equal(fish.changes.length, 0);
  assert.equal(fish.outcome.kind, "on");
});

test("word of mouth: belief alone moves nothing; a believer who passes it on counts once; the effect is capped", () => {
  assert.equal(readinessOf([belief("baker", "c1", "stage_unsafe", "yes", 0.8)]).changes.length, 0, "belief alone");
  const once = readinessOf([belief("baker", "c1", "stage_unsafe", "yes", 0.8), talk("baker", "cafe", ["c1"]), talk("baker", "florist", ["c1"], 45)]);
  assert.equal(once.changes.length, 1, "the same person twice counts once");
  assert.equal(once.changes[0].delta.crowd, -3);
  // a doubter passing it on does not count
  assert.equal(readinessOf([belief("baker", "c1", "stage_unsafe", "yes", 0.3), talk("baker", "cafe", ["c1"])]).changes.length, 0);
  // eight believers who all pass it on: capped at -12
  const who = ["baker", "florist", "cafe", "vendor", "police", "organizer", "journalist", "mayor"];
  const many = readinessOf(who.flatMap((w, i) => [belief(w, "c1", "stage_unsafe", "yes", 0.8, 20 + i), talk(w, "cafe", ["c1"], 30 + i)]));
  const crowd = many.changes.filter((c) => c.why.includes("怕出事")).reduce((s, c) => s + (c.delta.crowd ?? 0), 0);
  assert.equal(crowd, -12);
  for (const c of many.changes) assert.ok(many.changes.length && c.event, "every change names its event");
});

test("vendors still protesting at 18:30 strike; the festival turns on the mayor or into a protest", () => {
  const r = readinessOf([ev("gather", 150, {}, { actor: "vendor", place: "townhall" })]);
  assert.equal(r.milestones.find((m) => m.id === "vendors")!.status, "failed");
  assert.ok(r.outcome.tags.includes("vendor_strike"));
  assert.ok(r.outcome.tags.includes("protest_rally") || r.outcome.tags.includes("mayor_booed"));
});

test("the live clock only counts milestones already reached; the 20:00 tags exist only at 20:00", () => {
  const close = ev("state", 30, { key: "shops.flower", to: "closed" });
  assert.equal(readinessOf([close], [], 100).milestones.length, 0, "before 17:00 no milestone has happened");
  assert.equal(readinessOf([close], [], 200).milestones.map((m) => m.id).join(), "stage_check,pigeons");
  const crowd = ["baker", "cafe", "florist", "organizer"].flatMap((w, i) => [belief(w, `c${i}`, "mayor_fears_pigeons", "yes", 0.8, 20 + i), talk(w, "vendor", [`c${i}`], 30 + i)]);
  assert.ok(!readinessOf(crowd, [], 200).outcome.tags.includes("packed"));
  assert.ok(readinessOf(crowd).outcome.tags.includes("packed"), "a buzz that fills the square, at 20:00");
});

const call = (content: string): LlmCall => ({ content, status: 200, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake" });
const TELL = { feeling: "😟 擔心", act: "worry", understanding: "x", thought: "得跟人說", claims: [], stances: [], actions: [{ type: "tell", target: "cafe", message: "舞台好像不太穩" }, { type: "phone", target: "journalist", message: "舞台好像不太穩" }] };
const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];

test("every story reaches 20:00: after the decision budget, the milestones and the festival still play, and nobody decides anything new", async () => {
  let calls = 0;
  const chat: Chat = async () => {
    calls++;
    return call(JSON.stringify(TELL));
  };
  const run = await simulate({ active: ALL8, seedNpc: "baker", seedText: "舞台好像不太穩", seed: 41, policy: "gemma", chat, maxDecisions: 3, maxPerNpc: 3 });
  assert.equal(run.ended.reason, "budget");
  assert.equal(run.ended.t, 300, "the evening is played to the festival");
  assert.equal(run.events.filter((e) => e.type === "milestone").length, 5);
  const fest = run.events.find((e) => e.type === "festival")!;
  assert.ok(fest && fest.t === 300 && String(fest.zh).startsWith("今晚的燈籠節"));
  assert.ok(calls <= 3 * 2 + 3, "no model calls after the budget (retries aside)");
  const real = run.decisions.filter((d) => !d.validation.some((v) => v.kind === "budget"));
  assert.equal(real.length, 3, "only the budgeted decisions were made");
  const after = run.events.filter((e) => e.type === "decide" && e.t > Math.max(...real.map((d) => d.t)));
  assert.ok(after.every((e) => e.data.budget), "after the budget, residents only 'hear without thinking'");
  assert.equal(run.events.at(-1)?.type, "end");
});

test("the festival event says the same as the results would", async () => {
  const run = await simulate({ active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 42, policy: "gemma", chat: async () => call(JSON.stringify({ ...TELL, actions: [{ type: "none", why: "x" }] })), maxDecisions: 5 });
  const fest = run.events.find((e) => e.type === "festival")!;
  assert.equal(fest.zh, readinessOf(run.events, run.claims).outcome.text);
  assert.equal(fest.zh, "今晚的燈籠節：照常舉行。");
});
