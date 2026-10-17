// The story card tells where things ended up, and only what led there: a change undone later is not the outcome
// (a shop closed, then opened again), and the chain holds nothing but recorded causes of the outcome — never a
// conversation from after it (P20 budget-journalist, P19 oven-police). node --test lab/test-causality.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { simulate, type RunResult } from "../src/sim/engine.ts";
import type { Chat, ChatMessage, LlmCall } from "../src/sim/llm.ts";
import type { SimEvent } from "../src/sim/types.ts";
import { storyOf } from "../src/town/story.ts";

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
const oven = (source: string) => ({ ref: "new", source, statement: "烤箱檢查過期", topic: "oven_unsafe", says: "yes", category: "safety" });
const worried = (source: string, actions: object[]) => ({
  feeling: "😟 擔心", act: "worried", understanding: "烤箱可能有問題", thought: "先關店再說", claims: [oven(source)],
  stances: [{ claim: 0, verdict: "doubt", confidence: 0.4, why: "聽人說的", cites: [source] }], actions,
});
const shopStates = (run: RunResult, shop: string) => run.events.filter((e) => e.type === "state" && e.data.key === `shops.${shop}`).map((e) => e.data.to);

test("a shop closed and opened again is not headlined as closed (review C12)", async () => {
  const run = await simulate({
    active: ALL8, seedNpc: "baker", seedText: "聽說阿德麵包店的烤箱檢查過期了", seed: 31, policy: "gemma", maxDecisions: 4,
    chat: script({ 阿德: [worried("m1", [{ type: "close_shop", cites: ["#0"] }, { type: "open_shop" }])] }),
  });
  assert.deepEqual(shopStates(run, "bakery"), ["closed", "open"], "the engine ran both");
  assert.equal(run.world.shops.bakery, "open");
  const card = storyOf(run);
  assert.ok(!card.headline.includes("暫停營業"), card.headline);
  assert.ok(card.headline.includes("又開"), `the reopening is part of what happened: ${card.headline}`);
});

test("a closing that held is still the headline, and beats one that was undone", async () => {
  // 美玲 closes for good and calls 阿德, who closes and opens again
  const run = await simulate({
    active: ALL8, seedNpc: "florist", seedText: "聽說阿德麵包店的烤箱檢查過期了", seed: 32, policy: "gemma", maxDecisions: 6,
    chat: script({
      美玲: [worried("m1", [{ type: "phone", target: "baker", message: "阿德，聽說你的烤箱檢查過期了！", cites: ["#0"] }, { type: "close_shop", cites: ["#0"] }])],
      阿德: [worried("m2", [{ type: "close_shop", cites: ["#0"] }, { type: "open_shop" }])],
    }),
  });
  assert.deepEqual(shopStates(run, "flower"), ["closed"], "美玲 closed");
  assert.deepEqual(shopStates(run, "bakery"), ["closed", "open"], "阿德 closed and opened");
  const card = storyOf(run);
  assert.ok(card.headline.includes("花店") && card.headline.includes("暫停營業"), card.headline);
  assert.ok(!card.headline.includes("麵包店"), card.headline);
});

/** Every event the given one came from, by recorded causes. */
function ancestorsOf(run: RunResult, id: string): Set<string> {
  const byId = new Map(run.events.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.causes ?? [])];
  while (queue.length) {
    const c = queue.shift()!;
    if (seen.has(c)) continue;
    seen.add(c);
    queue.push(...(byId.get(c)?.causes ?? []));
  }
  return seen;
}

/** The chain is real, made only of causes of the outcome (or the outcome itself), in time order, none after it. */
function assertChain(name: string, run: RunResult) {
  const card = storyOf(run);
  const byId = new Map(run.events.map((e) => [e.id, e]));
  if (!card.outcome) return assert.equal(card.spine.length, 0, `${name}: a chain with no outcome to lead to`);
  const out = byId.get(card.outcome)!;
  const causes = ancestorsOf(run, out.id);
  let last = -Infinity;
  for (const h of card.spine) {
    const e: SimEvent | undefined = byId.get(h.event);
    assert.ok(e, `${name}: step ${h.event} not in the log`);
    assert.ok(e!.id === out.id || causes.has(e!.id), `${name}: ${e!.id} (${e!.type} @${e!.t.toFixed(1)}) is no cause of ${out.id} (${out.type} @${out.t.toFixed(1)})`);
    assert.ok(e!.t <= out.t, `${name}: ${e!.id} @${e!.t.toFixed(1)} is later than the outcome @${out.t.toFixed(1)}`);
    assert.ok(e!.t >= last, `${name}: steps out of time order at ${e!.id}`);
    last = e!.t;
    // talk of the town is the message that reached them; every other step is its own event, by its author
    if (h.via === "crowd") assert.ok(e!.type === "deliver" && e!.data.via === "crowd" && e!.target === h.to, `${name}: ${e!.id} is not town talk to ${h.to}`);
    else assert.ok(e!.type === h.via && e!.actor === h.from, `${name}: ${e!.id} is not ${h.via} by ${h.from}`);
    if (h.via === "talk" || h.via === "phone") assert.ok(e!.target === h.to && String(e!.data.text) === h.text, `${name}: ${e!.id} is not that conversation`);
  }
}

const load = (f: string) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  return (j.run ?? j) as RunResult;
};

test("P20 budget-journalist: the rally's chain is the article that reached 阿珠, not a call made after the rally", () => {
  const f = "lab/runs/P20/budget-journalist.json";
  if (!existsSync(f)) return;
  const run = load(f);
  const card = storyOf(run);
  assert.ok(card.spine.every((h) => h.t <= 101.85), card.spine.map((h) => `${h.via}@${h.t.toFixed(1)}`).join(" "));
  assert.equal(card.outcome, "e138", card.headline); // 阿珠's rally at 101.8
  assertChain(f, run);
  assert.ok(card.spine.some((h) => h.via === "article" && h.from === "journalist" && h.to === "vendor"), "the article 阿珠 read is the step that got her there");
});

test("P19 oven-police: the dispatch's chain holds nothing from after 140.9 (what 老周 saw himself)", () => {
  const f = "lab/runs/P19/oven-police.json";
  if (!existsSync(f)) return;
  const run = load(f);
  const card = storyOf(run);
  assert.ok(card.spine.every((h) => h.t <= 140.9), card.spine.map((h) => `${h.via}@${h.t.toFixed(1)}`).join(" "));
  assert.equal(card.outcome, "e87", card.headline); // 老周 sends officers to the stage at 140.9
  assertChain(f, run);
  assert.ok(card.spine.some((h) => h.via === "inspect" && h.text.includes("支架")), "the loose strut he found is on the way to the dispatch");
});

test("every recorded run: the chain is only causes of its outcome, never later than it", () => {
  const files: string[] = [];
  for (const base of ["lab/runs", "public/recorded"]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const p = `${base}/${d}`;
      for (const f of statSync(p).isDirectory() ? readdirSync(p).map((x) => `${p}/${x}`) : [p]) if (f.endsWith(".json") && !/index|summary|fun-metrics/.test(f)) files.push(f);
    }
  }
  let n = 0;
  for (const f of files) {
    const run = load(f);
    if (!run?.events) continue;
    assertChain(f, run);
    n++;
  }
  if (files.length) assert.ok(n > 0);
});

test("no recorded path from the sentence to the outcome: the card says so instead of borrowing other talk", () => {
  // officers sent with no recorded cause, and a conversation that has nothing to do with it
  const ev = (id: string, t: number, type: SimEvent["type"], causes: string[], more: Pick<SimEvent, "actor" | "target" | "data">): SimEvent => ({ id, t, type, causes, zh: "", ...more });
  const run = {
    config: { active: ALL8, seedNpc: "baker", seedText: "聽說市長很害怕鴿子。" },
    events: [
      ev("e1", 20, "seed", [], { target: "baker", data: { text: "聽說市長很害怕鴿子。" } }),
      ev("e2", 30, "phone", ["e1"], { actor: "baker", target: "florist", data: { text: "市長怕鴿子！" } }),
      ev("e3", 40, "state", [], { actor: "police", data: { key: "police", to: "stage" } }),
    ],
    decisions: [], claims: [],
  } as unknown as RunResult;
  const card = storyOf(run);
  assert.equal(card.outcome, "e3");
  assert.equal(card.spine.length, 0, card.spine.map((h) => h.text).join(" / "));
  assert.ok(card.chainGap, "the card says there is no chain");
});
