// 補一句: one more whisper, offered once, only when the story is about to fizzle. node --test lab/test-lull.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/sim/engine.ts";
import type { Chat, LlmCall } from "../src/sim/llm.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const call = (content: string): LlmCall => ({ content, status: 200, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake" });
const NONE = { feeling: "😐 無感", act: "shrug", understanding: "沒什麼", thought: "隨便啦", claims: [], stances: [], actions: [{ type: "none", why: "無關" }] };
const shrugs: Chat = async () => call(JSON.stringify(NONE));

test("a story that fizzles offers one more whisper, and the second sentence plays out", async () => {
  let asked = 0;
  const run = await simulate({
    active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 31, policy: "gemma", chat: shrugs, maxDecisions: 10,
    onLull: async (info) => {
      asked++;
      assert.ok(info.decisionsLeft >= 5 && info.t <= 240);
      assert.deepEqual(info.reached, ["vendor"]);
      return { npc: "cafe", text: "聽說今晚會下雨" };
    },
  });
  assert.equal(asked, 1, "offered exactly once");
  const seeds = run.events.filter((e) => e.type === "seed");
  assert.equal(seeds.length, 2);
  assert.equal(seeds[1].data.second, true);
  assert.equal(run.whispers.length, 1);
  assert.equal(run.whispers[0].npc, "cafe");
  assert.ok(run.decisions.some((d) => d.npc === "cafe"), "the second listener reacts");
  assert.ok(run.decisions.filter((d) => !d.validation.some((v) => v.kind === "budget")).length <= 10);
  assert.equal(run.events.at(-1)?.type, "end");
});

test("declining lets the story end as it would have", async () => {
  const run = await simulate({ active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 32, policy: "gemma", chat: shrugs, maxDecisions: 10, onLull: async () => null });
  assert.equal(run.events.filter((e) => e.type === "seed").length, 1);
  assert.equal(run.whispers.length, 0);
  assert.equal(run.events.at(-1)?.type, "end");
});

test("no offer with too few decisions left, or too late in the evening", async () => {
  let asked = 0;
  const ask = async () => { asked++; return null; };
  await simulate({ active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 33, policy: "gemma", chat: shrugs, maxDecisions: 5, onLull: ask });
  await simulate({ active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 34, policy: "gemma", chat: shrugs, maxDecisions: 10, seedAt: 250, onLull: ask });
  assert.equal(asked, 0);
});

test("no offer while something is still under way (a resident is walking to look)", async () => {
  const offers: number[] = [];
  const answers = [{ ...NONE, actions: [{ type: "go_look", place: "stage", why: "看看" }] }];
  let k = 0;
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "舞台好像怪怪的", seed: 35, policy: "gemma", maxDecisions: 10,
    chat: async () => call(JSON.stringify(answers[k++] ?? NONE)),
    onLull: async (info) => { offers.push(info.t); return null; },
  });
  const lookDone = run.events.find((e) => e.type === "look" && e.data.found)!;
  assert.ok(lookDone, "the look happens");
  assert.ok(offers.every((t) => t >= lookDone.t), "never offered before the look (and the decision after it) played out");
});

test("no second whisper when the story went quiet because the model stopped answering", async () => {
  let asked = 0;
  const garbage: Chat = async () => call("我不知道該說什麼");
  const run = await simulate({
    active: ALL8, seedNpc: "vendor", seedText: "今天天氣不錯", seed: 33, policy: "gemma", chat: garbage, maxDecisions: 10,
    onLull: async () => {
      asked++;
      return null;
    },
  });
  assert.ok(run.decisions.at(-1)?.fallback, "the model gave no valid answer");
  assert.equal(asked, 0, "no 補一句 offered on a failed model");
});

test("a story the player left stops at once: no more model calls", async () => {
  let calls = 0;
  let left = false;
  const tellAll: Chat = async () => {
    calls++;
    left = true; // the player leaves while the first answer is on its way
    return call(JSON.stringify({ ...NONE, actions: [{ type: "tell", target: "cafe", message: "聽說今晚會下雨" }, { type: "tell", target: "baker", message: "聽說今晚會下雨" }] }));
  };
  const run = await simulate({ active: ALL8, seedNpc: "vendor", seedText: "聽說今晚會下雨", seed: 34, policy: "gemma", chat: tellAll, maxDecisions: 10, shouldStop: () => left, onLull: async () => ({ npc: "cafe", text: "x" }) });
  assert.equal(calls, 1, "nothing after the player left");
  assert.equal(run.whispers.length, 0);
  assert.equal(run.events.at(-1)?.type, "end");
});
