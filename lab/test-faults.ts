// Failure cases without spending model calls: a fake Gemma that times out, returns garbage, or answers
// with impossible actions. The game must not crash, must not change the world on bad answers, and the
// story card must not blame a resident for a model failure. node --test lab/test-faults.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/sim/engine.ts";
import type { Chat, LlmCall } from "../src/sim/llm.ts";
import { storyOf } from "../src/town/story.ts";

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
