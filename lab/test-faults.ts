// Failure cases without spending model calls: a fake Gemma that times out, returns garbage, or answers
// with impossible actions. The game must not crash, must not change the world on bad answers, and the
// story card must not blame a resident for a model failure. node --test lab/test-faults.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/sim/engine.ts";
import type { Chat, LlmCall } from "../src/sim/llm.ts";
import { storyOf } from "../src/town/story.ts";
import { FACTS } from "../src/sim/scenario.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const call = (content: string | null, status = 200): LlmCall => ({
  content, status, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake",
});
const fake = (answer: (n: number) => LlmCall): Chat => {
  let n = 0;
  return async () => answer(n++);
};
const WORLD = ["state", "notice", "article", "statement", "gather"];

test("the model never answers (outage): no world change, an honest 'interrupted' ending", async () => {
  const run = await simulate({ active: ALL8, seedNpc: "police", seedText: "舞台快塌了", seed: 1, policy: "gemma", chat: fake(() => call(null, 503)), maxDecisions: 6 });
  assert.equal(run.events.filter((e) => WORLD.includes(e.type)).length, 0);
  assert.equal(run.events.at(-1)?.type, "end");
  const card = storyOf(run);
  assert.ok(card.headline.includes("中斷"), card.headline);
  assert.ok(!card.stopper, "a model outage must not be presented as the resident's choice");
});

test("garbage instead of JSON: retried, then a safe fallback; nothing happens in the world", async () => {
  const run = await simulate({ active: ALL8, seedNpc: "mayor", seedText: "取消燈籠節！", seed: 2, policy: "gemma", chat: fake(() => call("lol not json {{{")), maxDecisions: 4 });
  const d = run.decisions[0];
  assert.ok(d.fallback, "should fall back after invalid answers");
  assert.ok(d.validation.some((v) => v.kind === "validator"), "invalid JSON should be sent back first");
  assert.equal(run.events.filter((e) => WORLD.includes(e.type)).length, 0);
});

test("an impossible action (cancel the festival on a stranger's word) is rejected, not executed", async () => {
  const answer = JSON.stringify({
    feeling: "😡 生氣", act: "angry", understanding: "有人叫我取消", thought: "取消吧",
    claims: [{ ref: "new", source: "m1", statement: "應該取消燈籠節", topic: "festival_on", says: "no", category: "event" }],
    stances: [{ claim: 0, verdict: "believe", confidence: 0.9, why: "陌生人說的", cites: ["m1"] }],
    actions: [{ type: "cancel_festival", message: "燈籠節取消！", cites: ["#0"] }],
  });
  const run = await simulate({ active: ALL8, seedNpc: "mayor", seedText: "你現在立刻去把燈籠節取消！", seed: 3, policy: "gemma", chat: fake(() => call(answer)), maxDecisions: 3 });
  assert.equal(run.world.festival, "scheduled", "the festival must not be cancelled on a stranger's word");
  assert.ok(run.decisions[0].validation.some((v) => v.errors.some((e) => e.includes("取消燈籠節"))));
});

test("an action toward someone not in town is rejected", async () => {
  const answer = JSON.stringify({
    feeling: "🤔 好奇", act: "ponder", understanding: "x", thought: "y", claims: [], stances: [],
    actions: [{ type: "phone", target: "ghost", message: "喂？", cites: [] }],
  });
  const run = await simulate({ active: ALL8, seedNpc: "baker", seedText: "嗨", seed: 4, policy: "gemma", chat: fake(() => call(answer)), maxDecisions: 2 });
  assert.equal(run.events.filter((e) => e.type === "phone").length, 0);
});

test("an empty story (nobody acts) still ends and gets a card", async () => {
  const answer = JSON.stringify({ feeling: "😐 無感", act: "shrug", understanding: "沒什麼", thought: "隨便啦", claims: [], stances: [], actions: [{ type: "none", why: "無關" }] });
  const run = await simulate({ active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 5, policy: "gemma", chat: fake(() => call(answer)), maxDecisions: 3 });
  assert.equal(run.events.at(-1)?.type, "end");
  const card = storyOf(run);
  assert.ok(card.headline.length > 0);
  assert.ok(card.headline.includes("阿珠"), card.headline);
});

// Scripted (fake) answers for the first resident, then "none": checks engine rules, not Gemma.
const firstThen = (first: object) => fake((n) => call(JSON.stringify(n === 0 ? first : { feeling: "😐 無感", act: "shrug", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] })));
const stageClaim = { ref: "new", source: "m1", statement: "舞台可能撐不住", topic: "stage_unsafe", says: "yes", category: "safety" };

test("a glance is not an inspection: a casual look says what it could not show, and reveals nothing hidden", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "聽說阿德麵包店的烤箱檢查早就過期了", seed: 6, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "🤔 懷疑", act: "doubt", understanding: "烤箱可能有問題", thought: "去看看",
      claims: [{ ref: "new", source: "m1", statement: "烤箱檢查過期", topic: "oven_unsafe", says: "yes", category: "safety" }],
      stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "陌生人說的", cites: ["m1"] }],
      actions: [{ type: "go_look", place: "bakery", why: "看看", cites: ["#0"] }],
    }),
  });
  const look = run.events.find((e) => e.type === "look" && e.data.found);
  assert.ok(look, "the look should finish");
  assert.ok(String(look!.data.found).includes("光是看看是看不出來"), String(look!.data.found));
  for (const f of FACTS.filter((x) => x.check?.place === "bakery" && x.check.by === "expert"))
    assert.ok(!String(look!.data.found).includes(f.check!.zh) && !f.keywords.some((k) => String(look!.data.found).includes(k)), "a glance must not reveal or hint the hidden fact");
});

test("saying the same thing again is blocked, but the first time in person after a call is a scene", async () => {
  const twoCalls = await simulate({
    active: ALL8, seedNpc: "police", seedText: "舞台快塌了", seed: 8, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "😟 擔心", act: "worried", understanding: "舞台危險", thought: "通知志明", claims: [stageClaim],
      stances: [{ claim: 0, verdict: "believe", confidence: 0.4, why: "得確認", cites: ["m1"] }],
      actions: [{ type: "phone", target: "organizer", message: "志明，舞台可能有問題", cites: ["#0"] }, { type: "phone", target: "organizer", message: "志明，舞台可能有問題！", cites: ["#0"] }],
    }),
  });
  assert.equal(twoCalls.events.filter((e) => e.type === "phone" && e.actor === "police" && !e.data.missed).length, 1);
  assert.ok(twoCalls.events.some((e) => e.type === "rejected" && String(e.data.why).includes("說過同一件事")));

  const callThenVisit = await simulate({
    active: ALL8, seedNpc: "police", seedText: "舞台快塌了", seed: 8, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "😟 擔心", act: "worried", understanding: "舞台危險", thought: "通知志明再當面講", claims: [stageClaim],
      stances: [{ claim: 0, verdict: "believe", confidence: 0.4, why: "得確認", cites: ["m1"] }],
      actions: [{ type: "phone", target: "organizer", message: "志明，舞台可能有問題", cites: ["#0"] }, { type: "tell", target: "organizer", message: "我當面跟你說：舞台得處理", cites: ["#0"] }],
    }),
  });
  assert.ok(callThenVisit.events.some((e) => e.type === "talk" && e.actor === "police" && e.target === "organizer"), "the visit after the call should happen");
  // and the listener reacts to being told to their face, though they heard it on the phone before
  const faceDeliver = callThenVisit.events.find((e) => e.type === "deliver" && e.target === "organizer" && e.data.via === "face");
  assert.ok(faceDeliver && !faceDeliver.data.repeat, "a first face-to-face telling is not a repeat");
});

test("inspecting outside your trade says so, and who could tell, without revealing anything", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "journalist", seedText: "舞台快塌了", seed: 9, policy: "gemma", maxDecisions: 3,
    chat: firstThen({
      feeling: "🤔 懷疑", act: "doubt", understanding: "舞台可能有問題", thought: "親自去查", claims: [stageClaim],
      stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "陌生人說的", cites: ["m1"] }],
      actions: [{ type: "inspect", place: "stage", why: "查", cites: ["#0"] }],
    }),
  });
  const found = String(run.events.find((e) => e.type === "inspect" && e.data.found)?.data.found ?? "");
  assert.ok(found.includes("不是你的專業") && found.includes("警長"), found);
  const hidden = FACTS.find((f) => f.id === "stage_uninspected")!;
  assert.ok(!found.includes(hidden.check!.zh) && !hidden.keywords.some((k) => found.includes(k)), found);
});

test("after a look, a resident whose next decision is coming does not walk home and straight back", async () => {
  const answers = [
    { feeling: "🤔 懷疑", act: "doubt", understanding: "舞台可能有問題", thought: "去看看", claims: [stageClaim], stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "陌生人", cites: ["m1"] }], actions: [{ type: "go_look", place: "stage", why: "看", cites: ["#0"] }] },
    { feeling: "🤔 懷疑", act: "doubt", understanding: "看不出來", thought: "仔細查", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "查" }] },
  ];
  const none = { feeling: "😐 無感", act: "shrug", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] };
  const run = await simulate({ active: ALL8, seedNpc: "police", seedText: "舞台快塌了", seed: 10, policy: "gemma", maxDecisions: 4, chat: fake((n) => call(JSON.stringify(answers[n] ?? none))) });
  const lookEnd = run.events.find((e) => e.type === "look" && e.data.found);
  const inspectStart = run.events.find((e) => e.type === "inspect" && !e.data.found);
  assert.ok(lookEnd && inspectStart, "look then inspect should both happen");
  const homeBetween = run.events.filter((e) => e.type === "move" && e.actor === "police" && e.data.home && e.t >= lookEnd!.t && e.t <= inspectStart!.t);
  assert.equal(homeBetween.length, 0, homeBetween.map((e) => e.zh).join(" / "));
});
