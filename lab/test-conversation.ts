// Conversations play as one continuous scene: approach, talk, the other answers on the spot, maybe they go and look
// together, then they part. No walking home between a line and its reply. node --test lab/test-conversation.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/sim/engine.ts";
import type { Chat, ChatMessage, LlmCall } from "../src/sim/llm.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const call = (content: string): LlmCall => ({ content, status: 200, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake" });
const NONE = { feeling: "😐 無感", act: "shrug", understanding: "x", thought: "好吧", claims: [], stances: [], actions: [{ type: "none", why: "x" }] };
/** A scripted model: each resident answers from their own list, in order, then does nothing. */
function script(by: Record<string, object[]>): Chat {
  const used: Record<string, number> = {};
  return async (msgs: ChatMessage[]) => {
    const who = /【你是誰】([^，]+)，/.exec(msgs.map((m) => m.content).join("\n"))?.[1] ?? "";
    const list = by[who] ?? [];
    const k = used[who] ?? 0;
    used[who] = k + 1;
    return call(JSON.stringify(list[k] ?? NONE));
  };
}
const oven = { ref: "new", source: "m1", statement: "烤箱檢查過期", topic: "oven_unsafe", says: "yes", category: "safety" };

test("the listener answers on the spot, and the speaker waits for it instead of walking home", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "聽說阿德麵包店的烤箱檢查過期了", seed: 21, policy: "gemma", maxDecisions: 6,
    chat: script({
      老周: [{ feeling: "🤔 懷疑", act: "doubt", understanding: "烤箱可能有問題", thought: "去問阿德", claims: [oven], stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "陌生人說的", cites: ["m1"] }], actions: [{ type: "ask", target: "baker", message: "阿德，你的烤箱檢查還有效嗎？", cites: ["#0"] }] }],
      阿德: [{ feeling: "😰 緊張", act: "nervous", understanding: "老周在問烤箱", thought: "糟了", claims: [], stances: [], actions: [{ type: "tell", target: "police", message: "有、有啦，應該還有效吧……", why: "掩飾" }] }],
    }),
  });
  const talks = run.events.filter((e) => e.type === "talk");
  assert.equal(talks.length, 2, talks.map((e) => e.zh).join(" / "));
  const [q, reply] = talks;
  assert.equal(reply.actor, "baker");
  // the baker never walked anywhere to answer; the officer did not head home between question and answer
  assert.ok(!run.events.some((e) => e.type === "move" && e.actor === "baker" && e.t < reply.t), "the listener should answer where they stand");
  assert.ok(!run.events.some((e) => e.type === "move" && e.actor === "police" && e.data.home && e.t > q.t && e.t < reply.t), "the speaker should wait for the answer");
  // after the exchange the visitor goes home
  assert.ok(run.events.some((e) => e.type === "move" && e.actor === "police" && e.data.home && e.t > reply.t), "and leave once it is over");
});

test("when the listener goes to look, the person they were talking with comes along and sees it too", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "cafe", seedText: "舞台好像快塌了", seed: 22, policy: "gemma", maxDecisions: 6,
    chat: script({
      美咲: [{ feeling: "😟 擔心", act: "worried", understanding: "舞台危險", thought: "去找老周", claims: [{ ref: "new", source: "m1", statement: "舞台快塌了", topic: "stage_unsafe", says: "yes", category: "safety" }], stances: [{ claim: 0, verdict: "believe", confidence: 0.45, why: "擔心女兒", cites: ["m1"] }], actions: [{ type: "tell", target: "police", message: "老周，聽說舞台快塌了！", cites: ["#0"] }] }],
      老周: [{ feeling: "🤔 懷疑", act: "doubt", understanding: "美咲說舞台危險", thought: "一起去看看", claims: [], stances: [], actions: [{ type: "go_look", place: "stage", why: "親眼看看" }] }],
    }),
  });
  const follow = run.events.find((e) => e.type === "move" && e.actor === "cafe" && e.data.follow === "police");
  assert.ok(follow, "美咲 should walk along with 老周");
  assert.ok(follow!.zh.includes("跟著"), follow!.zh);
  const sawToo = run.events.find((e) => e.type === "look" && e.actor === "cafe" && e.data.found);
  assert.ok(sawToo && sawToo.zh.includes("一起"), "the companion sees the place with their own eyes");
  assert.ok(run.decisions.some((d) => d.npc === "cafe" && d.triggers.length && d.t >= sawToo!.t), "and reacts to what they saw");
});
