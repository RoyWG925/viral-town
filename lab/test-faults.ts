// Failure cases without spending model calls: a fake Gemma that times out, returns garbage, or answers
// with impossible actions. The game must not crash, must not change the world on bad answers, and the
// story card must not blame a resident for a model failure. node --test lab/test-faults.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/sim/engine.ts";
import type { Chat, LlmCall } from "../src/sim/llm.ts";
import { storyOf } from "../src/town/story.ts";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const call = (content: string | null, status = 200): LlmCall => ({
  content, status, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake",
});
const fake = (answer: (n: number) => LlmCall): Chat => {
  let n = 0;
  return async () => answer(n++);
};
const WORLD = ["state", "notice", "article", "statement", "gather"];
const nameOf = (id: string) => PERSONAS.find((p) => p.id === id)!.name;
// the story card's mark for "the model gave no valid answer" (the engine's safe default), whatever the wording
const INTERRUPTED = "⚠️";

test("the model never answers (outage): no world change, an honest 'interrupted' ending", async () => {
  const run = await simulate({ active: ALL8, seedNpc: "police", seedText: "The stage is about to collapse", seed: 1, policy: "gemma", chat: fake(() => call(null, 503)), maxDecisions: 6 });
  assert.equal(run.events.filter((e) => WORLD.includes(e.type)).length, 0);
  assert.equal(run.events.at(-1)?.type, "end");
  const card = storyOf(run);
  assert.equal(card.icon, INTERRUPTED, card.headline);
  assert.ok(card.headline.length > 0);
  assert.ok(card.headline.includes("broke off"), card.headline);
  assert.ok(!card.stopper, "a model outage must not be presented as the resident's choice");
});

test("garbage instead of JSON: retried, then a safe fallback; nothing happens in the world", async () => {
  const run = await simulate({ active: ALL8, seedNpc: "mayor", seedText: "Cancel the Lantern Festival!", seed: 2, policy: "gemma", chat: fake(() => call("lol not json {{{")), maxDecisions: 4 });
  const d = run.decisions[0];
  assert.ok(d.fallback, "should fall back after invalid answers");
  assert.ok(d.validation.some((v) => v.kind === "validator"), "invalid JSON should be sent back first");
  assert.equal(run.events.filter((e) => WORLD.includes(e.type)).length, 0);
});

test("an impossible action (cancel the festival on a stranger's word) is rejected, not executed", async () => {
  const answer = JSON.stringify({
    feeling: "😡 angry", act: "angry", understanding: "Someone wants me to cancel it", thought: "Fine, cancel it",
    claims: [{ ref: "new", source: "m1", statement: "The Lantern Festival should be cancelled", topic: "festival_on", says: "no", category: "event" }],
    stances: [{ claim: 0, verdict: "believe", confidence: 0.9, why: "a stranger said so", cites: ["m1"] }],
    actions: [{ type: "cancel_festival", message: "The Lantern Festival is cancelled!", cites: ["#0"] }],
  });
  const run = await simulate({ active: ALL8, seedNpc: "mayor", seedText: "Go and cancel the Lantern Festival right now!", seed: 3, policy: "gemma", chat: fake(() => call(answer)), maxDecisions: 3 });
  assert.equal(run.world.festival, "scheduled", "the festival must not be cancelled on a stranger's word");
  assert.ok(run.decisions[0].validation.some((v) => v.errors.some((e) => e.includes("Cancelling the Lantern Festival"))));
});

test("an action toward someone not in town is rejected", async () => {
  const answer = JSON.stringify({
    feeling: "🤔 curious", act: "ponder", understanding: "x", thought: "y", claims: [], stances: [],
    actions: [{ type: "phone", target: "ghost", message: "Hello?", cites: [] }],
  });
  const run = await simulate({ active: ALL8, seedNpc: "baker", seedText: "Hi there", seed: 4, policy: "gemma", chat: fake(() => call(answer)), maxDecisions: 2 });
  assert.equal(run.events.filter((e) => e.type === "phone").length, 0);
});

test("an empty story (nobody acts) still ends and gets a card", async () => {
  const answer = JSON.stringify({ feeling: "😐 meh", act: "shrug", understanding: "Nothing much", thought: "Whatever", claims: [], stances: [], actions: [{ type: "none", why: "not my business" }] });
  const run = await simulate({ active: ALL8, seedNpc: "vendor", seedText: "Nice weather today", seed: 5, policy: "gemma", chat: fake(() => call(answer)), maxDecisions: 3 });
  assert.equal(run.events.at(-1)?.type, "end");
  const card = storyOf(run);
  assert.ok(card.headline.length > 0);
  assert.ok(card.headline.includes(nameOf("vendor")), card.headline);
});

// Scripted (fake) answers for the first resident, then "none": checks engine rules, not Gemma.
const firstThen = (first: object) => fake((n) => call(JSON.stringify(n === 0 ? first : { feeling: "😐 meh", act: "shrug", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] })));
const stageClaim = { ref: "new", source: "m1", statement: "The stage might not hold up", topic: "stage_unsafe", says: "yes", category: "safety" };

test("a glance is not an inspection: a casual look says what it could not show, and reveals nothing hidden", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "I heard the oven at Ade's Bakery is way past its safety inspection", seed: 6, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "🤔 doubtful", act: "doubt", understanding: "The oven might be a problem", thought: "I'll go and look",
      claims: [{ ref: "new", source: "m1", statement: "The oven is past its safety inspection", topic: "oven_unsafe", says: "yes", category: "safety" }],
      stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "a stranger said it", cites: ["m1"] }],
      actions: [{ type: "go_look", place: "bakery", why: "take a look", cites: ["#0"] }],
    }),
  });
  const look = run.events.find((e) => e.type === "look" && e.data.found);
  assert.ok(look, "the look should finish");
  const found = String(look!.data.found);
  assert.ok(found.includes("just by looking"), found);
  for (const f of FACTS.filter((x) => x.check?.place === "bakery" && x.check.by === "expert"))
    assert.ok(!found.includes(f.check!.zh) && !f.keywords.some((k) => found.toLowerCase().includes(k.toLowerCase())), "a glance must not reveal or hint the hidden fact");
});

test("saying the same thing again is blocked, but the first time in person after a call is a scene", async () => {
  const twoCalls = await simulate({
    active: ALL8, seedNpc: "police", seedText: "The stage is about to collapse", seed: 8, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "😟 worried", act: "worried", understanding: "The stage is dangerous", thought: "I'll let Zhiming know", claims: [stageClaim],
      stances: [{ claim: 0, verdict: "believe", confidence: 0.4, why: "need to make sure", cites: ["m1"] }],
      actions: [{ type: "phone", target: "organizer", message: "Zhiming, something might be wrong with the stage", cites: ["#0"] }, { type: "phone", target: "organizer", message: "Zhiming, something might be wrong with the stage!", cites: ["#0"] }],
    }),
  });
  assert.equal(twoCalls.events.filter((e) => e.type === "phone" && e.actor === "police" && !e.data.missed).length, 1);
  assert.ok(twoCalls.events.some((e) => e.type === "rejected" && String(e.data.why).includes("already told them the same thing")));

  const callThenVisit = await simulate({
    active: ALL8, seedNpc: "police", seedText: "The stage is about to collapse", seed: 8, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "😟 worried", act: "worried", understanding: "The stage is dangerous", thought: "Call Zhiming, then tell him in person", claims: [stageClaim],
      stances: [{ claim: 0, verdict: "believe", confidence: 0.4, why: "need to make sure", cites: ["m1"] }],
      actions: [{ type: "phone", target: "organizer", message: "Zhiming, something might be wrong with the stage", cites: ["#0"] }, { type: "tell", target: "organizer", message: "I'm telling you to your face: the stage needs sorting out", cites: ["#0"] }],
    }),
  });
  assert.ok(callThenVisit.events.some((e) => e.type === "talk" && e.actor === "police" && e.target === "organizer"), "the visit after the call should happen");
  // and the listener reacts to being told to their face, though they heard it on the phone before
  const faceDeliver = callThenVisit.events.find((e) => e.type === "deliver" && e.target === "organizer" && e.data.via === "face");
  assert.ok(faceDeliver && !faceDeliver.data.repeat, "a first face-to-face telling is not a repeat");
});

test("inspecting outside your trade says so, and who could tell, without revealing anything", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "journalist", seedText: "The stage is about to collapse", seed: 9, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "🤔 doubtful", act: "doubt", understanding: "The stage might have a problem", thought: "I'll check it myself", claims: [stageClaim],
      stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "a stranger said it", cites: ["m1"] }],
      actions: [{ type: "inspect", place: "stage", why: "check it", cites: ["#0"] }],
    }),
  });
  const found = String(run.events.find((e) => e.type === "inspect" && e.data.found)?.data.found ?? "");
  const police = PERSONAS.find((p) => p.id === "police")!;
  assert.ok(found.includes("isn't your trade") && found.includes(police.roleZh), found);
  const hidden = FACTS.find((f) => f.id === "stage_uninspected")!;
  assert.ok(!found.includes(hidden.check!.zh) && !hidden.keywords.some((k) => found.toLowerCase().includes(k.toLowerCase())), found);
});

test("after a look, a resident whose next decision is coming does not walk home and straight back", async () => {
  const answers = [
    { feeling: "🤔 doubtful", act: "doubt", understanding: "The stage might have a problem", thought: "I'll go and look", claims: [stageClaim], stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "a stranger", cites: ["m1"] }], actions: [{ type: "go_look", place: "stage", why: "look", cites: ["#0"] }] },
    { feeling: "🤔 doubtful", act: "doubt", understanding: "Can't tell from here", thought: "Check it properly", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "check" }] },
  ];
  const none = { feeling: "😐 meh", act: "shrug", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] };
  const run = await simulate({ active: ALL8, seedNpc: "police", seedText: "The stage is about to collapse", seed: 10, policy: "gemma", maxDecisions: 4, chat: fake((n) => call(JSON.stringify(answers[n] ?? none))) });
  const lookEnd = run.events.find((e) => e.type === "look" && e.data.found);
  const inspectStart = run.events.find((e) => e.type === "inspect" && !e.data.found);
  assert.ok(lookEnd && inspectStart, "look then inspect should both happen");
  const homeBetween = run.events.filter((e) => e.type === "move" && e.actor === "police" && e.data.home && e.t >= lookEnd!.t && e.t <= inspectStart!.t);
  assert.equal(homeBetween.length, 0, homeBetween.map((e) => e.zh).join(" / "));
});

test("wanting too much on a stranger's word keeps the thinking and shows the refusal (live run regression)", async () => {
  // the real answer from a live run: Chief Zhou wanted to send officers to the bakery on one stranger's sentence
  const answer = {
    feeling: "😟 worried", act: "worried", understanding: "The bakery oven is a safety hazard and could cause an accident during the festival.",
    claims: [{ ref: "c0", source: "m1", statement: "The oven at Ade's Bakery is way past its safety inspection and could go wrong any minute", topic: "oven_unsafe", says: "yes", category: "safety" }],
    stances: [{ claim: "c0", verdict: "believe", confidence: "0.6", why: "you can't take chances with safety", cites: ["m1"] }],
    thought: "We're short-handed tonight as it is; we can't afford any accidents. I need to check this, fast.",
    actions: [{ type: "dispatch_police", place: "bakery", intent: "inform", message: "Go and patrol around Ade's Bakery", cites: ["c0"] }],
  };
  const run = await simulate({ active: ALL8, seedNpc: "police", seedText: "I heard the oven at Ade's Bakery is way past its safety inspection and could go wrong any minute.", seed: 11, policy: "gemma", maxDecisions: 3,
    // the model insists on the same answer when sent back (as it did live), then later residents do nothing
    chat: fake((n) => call(JSON.stringify(n < 2 ? answer : { feeling: "😐 meh", act: "shrug", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] }))) });
  const d = run.decisions[0];
  assert.ok(!d.fallback, "valid thinking must not be thrown away");
  assert.equal(d.output?.thought, answer.thought);
  assert.ok(d.validation.some((v) => v.errors.some((e) => e.includes("can really only be"))), "the retry says what the engine allows");
  assert.equal(run.world.police.deployed, false, "no police on a stranger's word");
  assert.ok(run.events.some((e) => e.type === "belief" && e.actor === "police"), "the belief is kept");
  const refused = run.events.find((e) => e.type === "rejected" && e.data.wanted);
  assert.ok(refused && refused.zh.includes("send officers") && refused.zh.includes("there wasn't enough to go on"), refused?.zh);
  const card = storyOf(run);
  assert.ok(card.headline.includes("send officers") && card.icon !== INTERRUPTED, card.headline);
});
