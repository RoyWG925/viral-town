// Conversations play as one continuous scene: approach, talk, the other answers on the spot, maybe they go and look
// together, then they part. No walking home between a line and its reply. node --test lab/test-conversation.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/sim/engine.ts";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";
import { SECTION, whoLine } from "../src/sim/mind.ts";
import type { Chat, ChatMessage, LlmCall } from "../src/sim/llm.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const call = (content: string): LlmCall => ({ content, status: 200, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake" });
const NONE = { feeling: "😐 Meh", act: "shrug", understanding: "x", thought: "Fine", claims: [], stances: [], actions: [{ type: "none", why: "x" }] };
/** Which resident (by id) a prompt is for: the line under its "Who you are" heading, written by mind.ts's own whoLine. */
const whoIs = (prompt: string) => PERSONAS.find((p) => prompt.includes(`${SECTION.who}\n${whoLine(p)}`))?.id ?? "";
/** A scripted model: each resident (by id) answers from their own list, in order, then does nothing. */
function script(by: Record<string, object[]>): Chat {
  const used: Record<string, number> = {};
  return async (msgs: ChatMessage[]) => {
    const who = whoIs(msgs.map((m) => m.content).join("\n"));
    const list = by[who] ?? [];
    const k = used[who] ?? 0;
    used[who] = k + 1;
    return call(JSON.stringify(list[k] ?? NONE));
  };
}
const oven = { ref: "new", source: "m1", statement: "The oven's inspection has expired", topic: "oven_unsafe", says: "yes", category: "safety" };

test("the listener answers on the spot, and the speaker waits for it instead of walking home", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "I heard the oven at Ade's Bakery is past its safety inspection", seed: 21, policy: "gemma", maxDecisions: 6,
    chat: script({
      police: [{ feeling: "🤔 Doubtful", act: "doubt", understanding: "The oven might be a problem", thought: "I'll ask Ade", claims: [oven], stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "a stranger said it", cites: ["m1"] }], actions: [{ type: "ask", target: "baker", message: "Ade, is your oven's inspection still valid?", cites: ["#0"] }] }],
      baker: [{ feeling: "😰 Nervous", act: "nervous", understanding: "Chief Zhou is asking about the oven", thought: "Uh-oh", claims: [], stances: [], actions: [{ type: "tell", target: "police", message: "Y-yes, it should still be good, I think...", why: "covering" }] }],
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
    active: ALL8, seedNpc: "cafe", seedText: "The stage looks like it's about to collapse", seed: 22, policy: "gemma", maxDecisions: 6,
    chat: script({
      cafe: [{ feeling: "😟 Worried", act: "worried", understanding: "The stage is dangerous", thought: "I'll find Chief Zhou", claims: [{ ref: "new", source: "m1", statement: "The stage is about to collapse", topic: "stage_unsafe", says: "yes", category: "safety" }], stances: [{ claim: 0, verdict: "believe", confidence: 0.45, why: "worried about my daughter", cites: ["m1"] }], actions: [{ type: "tell", target: "police", message: "Chief Zhou, they say the stage is about to collapse!", cites: ["#0"] }] }],
      police: [{ feeling: "🤔 Doubtful", act: "doubt", understanding: "Misaki says the stage is dangerous", thought: "Let's go and look together", claims: [], stances: [], actions: [{ type: "go_look", place: "stage", why: "see for myself" }] }],
    }),
  });
  const follow = run.events.find((e) => e.type === "move" && e.actor === "cafe" && e.data.follow === "police");
  assert.ok(follow, "Misaki should walk along with Chief Zhou");
  assert.ok(follow!.zh.includes("went along with"), follow!.zh);
  const sawToo = run.events.find((e) => e.type === "look" && e.actor === "cafe" && e.data.found);
  assert.ok(sawToo && sawToo.zh.includes("together with"), "the companion sees the place with their own eyes");
  assert.ok(run.decisions.some((d) => d.npc === "cafe" && d.triggers.length && d.t >= sawToo!.t), "and reacts to what they saw");
});

test("a rumour about the mayor held by three people reaches the mayor as public talk (once)", async () => {
  const pig = (src: string) => ({ ref: "new", source: src, statement: "The mayor is scared of pigeons", topic: "mayor_fears_pigeons", says: "yes", category: "personal" });
  const believe = (src: string) => ({ claims: [pig(src)], stances: [{ claim: 0, verdict: "believe", confidence: 0.5, why: "everyone's saying it", cites: [src] }] });
  const run = await simulate({
    active: ALL8, seedNpc: "baker", seedText: "I heard the mayor is terrified of pigeons", seed: 23, policy: "gemma", maxDecisions: 8,
    chat: script({
      baker: [{ feeling: "😆 Amused", act: "giggle", understanding: "The mayor is scared of pigeons", thought: "That's hilarious", ...believe("m1"), actions: [{ type: "phone", target: "florist", message: "I heard the mayor is scared of pigeons!", cites: ["#0"] }, { type: "phone", target: "cafe", message: "I heard the mayor is scared of pigeons!", cites: ["#0"] }] }],
      florist: [{ feeling: "😮 Surprised", act: "startled", understanding: "The mayor is scared of pigeons", thought: "Really?", ...believe("m2"), actions: [{ type: "none", why: "x" }] }],
      cafe: [{ feeling: "😆 Amused", act: "giggle", understanding: "The mayor is scared of pigeons", thought: "Ha!", ...believe("m3"), actions: [{ type: "none", why: "x" }] }],
    }),
  });
  const heard = run.events.filter((e) => e.type === "deliver" && e.target === "mayor" && e.data.via === "crowd");
  assert.equal(heard.length, 1, run.events.filter((e) => e.target === "mayor").map((e) => e.zh).join(" / "));
  assert.ok(String(heard[0].data.text).includes("Several people in town are saying"));
  assert.ok(run.decisions.some((d) => d.npc === "mayor"), "the mayor gets to respond");
});

test("a blocked repeat sinks in: the speaker gets to decide what to do instead (once per pair)", async () => {
  const stage = { ref: "new", source: "m1", statement: "A stage support is loose", topic: "stage_unsafe", says: "yes", category: "safety" };
  const run = await simulate({
    active: ALL8, seedNpc: "police", seedText: "One of the stage supports seems loose", seed: 24, policy: "gemma", maxDecisions: 8,
    chat: script({
      police: [
        { feeling: "😠 Angry", act: "angry", understanding: "Something's wrong with the stage", thought: "I'll tell Zhiming twice", claims: [stage], stances: [{ claim: 0, verdict: "believe", confidence: 0.45, why: "need to be sure", cites: ["m1"] }], actions: [{ type: "tell", target: "organizer", message: "Zhiming, a support is loose!", cites: ["#0"] }, { type: "tell", target: "organizer", message: "Zhiming, I'm telling you again, a support is loose!", cites: ["#0"] }] },
        { feeling: "🤔 Thinking", act: "ponder", understanding: "Telling him is no use", thought: "Then I'll check it myself", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "check in person" }] },
      ],
    }),
  });
  const blocked = run.events.find((e) => e.type === "rejected" && e.actor === "police" && String(e.data.why).includes("already told them the same thing"));
  assert.ok(blocked, "the second line is blocked");
  const sinks = (text: string) => text.includes("saying it again won't change anything");
  const thought = run.events.find((e) => e.type === "deliver" && e.target === "police" && e.data.via === "hunch" && sinks(String(e.data.text)));
  assert.ok(thought, "it sinks in");
  assert.ok(run.decisions.some((d) => d.npc === "police" && d.triggers.includes(thought!.id)), "and they decide again");
  assert.equal(run.events.filter((e) => e.type === "deliver" && e.target === "police" && e.data.via === "hunch" && sinks(String(e.data.text))).length, 1, "only once per pair");
});

test("whoever has seen a hidden problem first-hand gets more decisions, and a small reserve past the shared cap", async () => {
  const look = (place: string) => ({ feeling: "🤔 Thinking", act: "ponder", understanding: "x", thought: "Let me look again", claims: [], stances: [], actions: [{ type: "go_look", place, why: "look" }] });
  const inspect = { feeling: "🤔 Thinking", act: "ponder", understanding: "x", thought: "Check it properly", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "check" }] };
  const places = ["plaza", "bakery", "harbour", "cafe", "flower", "townhall", "news", "stall"];
  const runWith = (first: object, cfg: Record<string, number>) => {
    let k = 0;
    const chat: Chat = async () => call(JSON.stringify(k++ === 0 ? first : look(places[(k - 2) % places.length])));
    return simulate({ active: ALL8, seedNpc: "police", seedText: "Something seems off about the stage", seed: 25, policy: "gemma", chat, maxDecisions: 30, ...cfg });
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
  const inspect = { feeling: "🤔 Thinking", act: "ponder", understanding: "x", thought: "Check it properly", claims: [], stances: [], actions: [{ type: "inspect", place: "stage", why: "check" }] };
  const close = { feeling: "😠 Angry", act: "angry", understanding: "x", thought: "Close it off", claims: [], stances: [], actions: [{ type: "close_stage", why: "dangerous" }] };
  const runWith = (after: object[]) =>
    simulate({ active: ALL8, seedNpc: "police", seedText: "Something seems off about the stage", seed: 26, policy: "gemma", maxDecisions: 12, chat: script({ police: [inspect, ...after] }) });
  const mulls = (r: Awaited<ReturnType<typeof simulate>>) =>
    r.events.filter((e) => e.type === "deliver" && e.target === "police" && e.data.via === "hunch" && String(e.data.text).includes("can't stop thinking"));
  const strut = FACTS.find((f) => f.id === "stage_uninspected")!.check!.zh;

  // saw the loose strut, then let it be: it comes back to him, about the strut, once
  const quiet = await runWith([NONE]);
  const found = quiet.events.find((e) => e.type === "inspect" && e.actor === "police" && e.data.found)!;
  const m = mulls(quiet);
  assert.equal(m.length, 1, "once");
  assert.ok(String(m[0].data.text).includes(strut) && String(m[0].data.text).includes("The Lantern Festival starts in"), "the thing he saw, and the time left");
  assert.ok(m[0].t >= found.t + 25, "only after a quiet while");
  assert.ok(quiet.decisions.some((d) => d.npc === "police" && d.triggers.includes(m[0].id)), "and he decides again");

  // closed the stage right away: nothing left to turn over
  assert.equal(mulls(await runWith([close])).length, 0);
});
