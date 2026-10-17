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

test("a rumour about the mayor held by three people reaches the mayor as public talk (once)", async () => {
  const pig = (src: string) => ({ ref: "new", source: src, statement: "市長很怕鴿子", topic: "mayor_fears_pigeons", says: "yes", category: "personal" });
  const believe = (src: string) => ({ claims: [pig(src)], stances: [{ claim: 0, verdict: "believe", confidence: 0.5, why: "大家都在說", cites: [src] }] });
  const run = await simulate({
    active: ALL8, seedNpc: "baker", seedText: "聽說市長很害怕鴿子", seed: 23, policy: "gemma", maxDecisions: 8,
    chat: script({
      阿德: [{ feeling: "😆 好笑", act: "giggle", understanding: "市長怕鴿子", thought: "太好笑了", ...believe("m1"), actions: [{ type: "phone", target: "florist", message: "聽說市長很怕鴿子！", cites: ["#0"] }, { type: "phone", target: "cafe", message: "聽說市長很怕鴿子！", cites: ["#0"] }] }],
      美玲: [{ feeling: "😮 驚訝", act: "startled", understanding: "市長怕鴿子", thought: "真的嗎", ...believe("m2"), actions: [{ type: "none", why: "x" }] }],
      美咲: [{ feeling: "😆 好笑", act: "giggle", understanding: "市長怕鴿子", thought: "哈哈", ...believe("m3"), actions: [{ type: "none", why: "x" }] }],
    }),
  });
  const heard = run.events.filter((e) => e.type === "deliver" && e.target === "mayor" && e.data.via === "crowd");
  assert.equal(heard.length, 1, run.events.filter((e) => e.target === "mayor").map((e) => e.zh).join(" / "));
  assert.ok(String(heard[0].data.text).includes("鎮上好幾個人在傳"));
  assert.ok(run.decisions.some((d) => d.npc === "mayor"), "the mayor gets to respond");
});

test("a blocked repeat sinks in: the speaker gets to decide what to do instead (once per pair)", async () => {
  const stage = { ref: "new", source: "m1", statement: "舞台支架鬆了", topic: "stage_unsafe", says: "yes", category: "safety" };
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "舞台支架好像鬆了", seed: 24, policy: "gemma", maxDecisions: 8,
    chat: script({
      老周: [
        { feeling: "😠 生氣", act: "angry", understanding: "舞台有問題", thought: "去跟志明講兩次", claims: [stage], stances: [{ claim: 0, verdict: "believe", confidence: 0.45, why: "要確認", cites: ["m1"] }], actions: [{ type: "tell", target: "organizer", message: "志明，支架鬆了！", cites: ["#0"] }, { type: "tell", target: "organizer", message: "志明，我再說一次，支架鬆了！", cites: ["#0"] }] },
        { feeling: "🤔 思考", act: "ponder", understanding: "說了也沒用", thought: "那我自己去查", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "親自檢查" }] },
      ],
    }),
  });
  const blocked = run.events.find((e) => e.type === "rejected" && e.actor === "police" && String(e.data.why).includes("說過同一件事"));
  assert.ok(blocked, "the second line is blocked");
  const thought = run.events.find((e) => e.type === "deliver" && e.target === "police" && e.data.via === "hunch" && String(e.data.text).includes("再說一次也一樣"));
  assert.ok(thought, "it sinks in");
  assert.ok(run.decisions.some((d) => d.npc === "police" && d.triggers.includes(thought!.id)), "and they decide again");
  assert.equal(run.events.filter((e) => e.type === "deliver" && e.target === "police" && e.data.via === "hunch" && String(e.data.text).includes("再說一次也一樣")).length, 1, "only once per pair");
});

test("whoever has seen a hidden problem first-hand gets more decisions, and a small reserve past the shared cap", async () => {
  const look = (place: string) => ({ feeling: "🤔 想", act: "ponder", understanding: "x", thought: "再看看", claims: [], stances: [], actions: [{ type: "go_look", place, why: "看" }] });
  const inspect = { feeling: "🤔 想", act: "ponder", understanding: "x", thought: "仔細查", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "查" }] };
  const places = ["plaza", "bakery", "harbour", "cafe", "flower", "townhall", "news", "stall"];
  const runWith = (first: object, cfg: Record<string, number>) => {
    let k = 0;
    const chat: Chat = async () => call(JSON.stringify(k++ === 0 ? first : look(places[(k - 2) % places.length])));
    return simulate({ active: ALL8, seedNpc: "police", seedText: "舞台好像怪怪的", seed: 25, policy: "gemma", chat, maxDecisions: 30, ...cfg });
  };
  const real = (r: Awaited<ReturnType<typeof simulate>>) => r.decisions.filter((d) => d.npc === "police" && !d.validation.some((v) => v.kind === "budget")).length;
  // only glancing: the ordinary cap
  assert.equal(real(await runWith(look("plaza"), { maxPerNpc: 2, maxPerNpcFinding: 4 })), 2);
  // found the loose strut with his own trained eyes: the larger cap
  assert.equal(real(await runWith(inspect, { maxPerNpc: 2, maxPerNpcFinding: 4 })), 4);
  // and past the shared cap by the reserve
  assert.equal(real(await runWith(inspect, { maxDecisions: 3, maxPerNpc: 10, maxPerNpcFinding: 10, findingReserve: 2 })), 5);
});

test("a hidden problem seen first-hand comes back to mind once they have been quiet a while (once, unless dealt with)", async () => {
  const inspect = { feeling: "🤔 想", act: "ponder", understanding: "x", thought: "仔細查", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "查" }] };
  const close = { feeling: "😠 生氣", act: "angry", understanding: "x", thought: "封起來", claims: [], stances: [], actions: [{ type: "close_stage", why: "危險" }] };
  const runWith = (after: object[]) =>
    simulate({ active: ALL8, seedNpc: "police", seedText: "舞台好像怪怪的", seed: 26, policy: "gemma", maxDecisions: 12, chat: script({ 老周: [inspect, ...after] }) });
  const mulls = (r: Awaited<ReturnType<typeof simulate>>) =>
    r.events.filter((e) => e.type === "deliver" && e.target === "police" && e.data.via === "hunch" && String(e.data.text).includes("放不下"));

  // saw the loose strut, then let it be: it comes back to him, about the strut, once
  const quiet = await runWith([NONE]);
  const found = quiet.events.find((e) => e.type === "inspect" && e.actor === "police" && e.data.found)!;
  const m = mulls(quiet);
  assert.equal(m.length, 1, "once");
  assert.ok(String(m[0].data.text).includes("支架明顯鬆動") && String(m[0].data.text).includes("離燈籠節開始只剩"), "the thing he saw, and the time left");
  assert.ok(m[0].t >= found.t + 25, "only after a quiet while");
  assert.ok(quiet.decisions.some((d) => d.npc === "police" && d.triggers.includes(m[0].id)), "and he decides again");

  // closed the stage right away: nothing left to turn over
  assert.equal(mulls(await runWith([close])).length, 0);
});
