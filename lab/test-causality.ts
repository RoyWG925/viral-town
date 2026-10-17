// The story card tells where things ended up, and only what led there: a change undone later is not the outcome
// (a shop closed, then opened again), and the chain holds nothing but recorded causes of the outcome — never a
// conversation from after it (P20 budget-journalist, P19 oven-police), never past the check a 🔍 headline reports
// (B1 fee-journalist) — and a sight on it carries what they made of what they saw. node --test lab/test-causality.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { simulate, type RunResult } from "../src/sim/engine.ts";
import type { Chat, ChatMessage, LlmCall } from "../src/sim/llm.ts";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";
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

/** Every recorded run log (lab batches and the published replays). */
function recorded(): string[] {
  const files: string[] = [];
  for (const base of ["lab/runs", "public/recorded"]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const p = `${base}/${d}`;
      for (const f of statSync(p).isDirectory() ? readdirSync(p).map((x) => `${p}/${x}`) : [p]) if (f.endsWith(".json") && !/index|summary|fun-metrics/.test(f)) files.push(f);
    }
  }
  return files;
}

test("every recorded run: the chain is only causes of its outcome, never later than it", () => {
  const files = recorded();
  let n = 0;
  for (const f of files) {
    const run = load(f);
    if (!run?.events) continue;
    assertChain(f, run);
    n++;
  }
  if (files.length) assert.ok(n > 0);
});

const ev = (id: string, t: number, type: SimEvent["type"], causes: string[], more: Pick<SimEvent, "actor" | "target" | "data">): SimEvent => ({ id, t, type, causes, zh: "", ...more });

test("no recorded path from the sentence to the outcome: the card says so instead of borrowing other talk", () => {
  // officers sent with no recorded cause, and a conversation that has nothing to do with it
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

test("an untraced talk is no chain, and a card that names no result does not speak of one", () => {
  // a conversation with no recorded cause, under a headline that says nothing happened
  const run = {
    config: { active: ALL8, seedNpc: "baker", seedText: "聽說市長很害怕鴿子。" },
    events: [
      ev("e1", 20, "seed", [], { target: "baker", data: { text: "聽說市長很害怕鴿子。" } }),
      ev("e2", 30, "talk", [], { actor: "florist", target: "police", data: { text: "今天的花賣得不錯。" } }),
    ],
    decisions: [], claims: [],
  } as unknown as RunResult;
  const card = storyOf(run);
  assert.equal(card.spine.length, 0, card.spine.map((h) => h.text).join(" / "));
  assert.ok(!card.chainGap?.includes("結果"), `${card.headline} / ${card.chainGap}`);
});

const nameOf = (id: string) => PERSONAS.find((p) => p.id === id)?.name ?? id;
/** The beliefs the looker formed on taking in what this look showed them (the decision its inspection fed). */
function formedBy(run: RunResult, look: SimEvent): SimEvent[] {
  const del = run.events.find((x) => x.type === "deliver" && x.causes[0] === look.id && x.target === look.actor);
  const dec = del && run.decisions.find((d) => d.inbox.includes(String(del.data.message)));
  const dEv = dec && run.events.find((x) => x.type === "decide" && x.data.decision === dec.id);
  return dEv ? run.events.filter((x) => x.type === "belief" && x.causes.includes(dEv.id)) : [];
}

test("a sight's pill is what they made of what they saw, not the opposite rumour that look dropped (P20 wobble-organizer, P19 lantern-baker)", () => {
  // 老周 sees the loose strut: the same decision drops 「舞台一切準備就緒」 to 0 and sets 「支架鬆動」 to 0.98
  for (const [f, ids] of [["public/recorded/P20-wobble-organizer.json", ["e18"]], ["public/recorded/P19-lantern-baker.json", ["e19", "e160"]]] as const) {
    if (!existsSync(f)) continue;
    const card = storyOf(load(f));
    for (const id of ids) {
      const h = card.spine.find((x) => x.event === id);
      assert.ok(h, `${f}: ${id} is on the chain`);
      assert.ok(h!.verdict !== "disbelieve" && (h!.conf === undefined || h!.conf >= 0.5), `${f}: ${id} 「${h!.text.slice(0, 20)}」 shows ${h!.verdict} ${h!.conf}`);
    }
    if (f.includes("P20")) assert.deepEqual(((h) => [h?.verdict, h?.conf])(card.spine.find((x) => x.event === "e18")), ["believe", 0.98]);
  }
});

test("every recorded run: a sight's pill is their belief in what they saw, or none", () => {
  let n = 0;
  for (const f of recorded()) {
    const run = load(f);
    if (!run?.events) continue;
    const claimOf = (id: unknown) => (run.claims ?? []).find((c) => c.id === id);
    for (const h of storyOf(run).spine) {
      if ((h.via !== "look" && h.via !== "inspect") || h.conf === undefined) continue;
      const fact = FACTS.find((x) => x.check && h.text.includes(x.check.zh));
      assert.ok(fact, `${f}: ${h.event} 「${h.text.slice(0, 20)}」 has a pill but shows no fact`);
      const look = run.events.find((e) => e.id === h.event)!;
      // a claim that says what the sight showed: about that fact, asserting it exactly when it is true
      const mine = formedBy(run, look).filter((b) => ((c) => c?.fact === fact!.id && c.asserts === fact!.value)(claimOf(b.data.claim)));
      assert.ok(mine.some((b) => b.data.verdict === h.verdict && Number(b.data.to) === h.conf), `${f}: ${h.event} 「${h.text.slice(0, 20)}」 ${h.verdict} ${h.conf} is not their belief in what they saw`);
      n++;
    }
  }
  if (recorded().length) assert.ok(n > 0);
});

test("a look logged before the engine's highlight shows what the story is about, not whatever it listed first (C1v16 stage-cafe)", () => {
  // 老周 went to see whether the stage would hold; 小雯 to check a stage rumour (and, having seen the birds once,
  // held a belief about them): the pigeons are no step of either story
  for (const f of ["lab/runs/C1v16/stage-cafe.json", "lab/runs/B1v16/stage-florist.json"]) {
    if (!existsSync(f)) continue;
    const card = storyOf(load(f));
    assert.ok(card.spine.every((h) => !h.text.includes("鴿")), `${f}: ${card.spine.map((h) => `${h.via}@${h.t.toFixed(1)} ${h.text.slice(0, 12)}`).join(" / ")}`);
  }
  for (const g of recorded()) {
    const run = load(g);
    if (!run?.events) continue;
    const card = storyOf(run);
    // the facts the story is about: what each first listener made of a planted sentence, and the topic most people held
    const firsts = run.events.filter((s) => s.type === "seed").map((s) => run.events.find((x) => x.type === "decide" && x.actor === s.target && x.t >= s.t && !x.data.budget));
    const people = new Map<string, Set<string>>();
    for (const c of run.claims ?? []) if (c.topic !== "other") (people.get(c.topic) ?? people.set(c.topic, new Set()).get(c.topic)!).add(c.by);
    const most = [...people.entries()].sort((x, y) => y[1].size - x[1].size)[0]?.[0];
    const about = new Set((run.claims ?? []).filter((c) => c.topic === most || firsts.some((d) => d && c.by === d.actor && (c.origin === d.id || d.causes.includes(c.origin)))).map((c) => c.fact));
    for (const h of card.spine) {
      const e = run.events.find((x) => x.id === h.event)!;
      // (the look a 🔍 headline names is told as the headline says)
      if ((h.via !== "look" && h.via !== "inspect") || e.data.highlight !== undefined || h.event === card.outcome) continue;
      const fact = FACTS.find((x) => x.check && x.check.by !== "expert" && h.text.includes(x.check.zh));
      if (fact) assert.ok(about.has(fact.id), `${g}: ${h.event} shows 「${h.text.slice(0, 16)}」 in a story about ${[...about].join("/")}`);
    }
  }
});

test("a 親自查證 headline's chain ends at the check it reports (B1 fee-journalist, C1v16 stage-cafe)", () => {
  for (const [f, id] of [["lab/runs/B1/fee-journalist.json", "e9"], ["lab/runs/C1v16/stage-cafe.json", "e30"]] as const) {
    if (!existsSync(f)) continue;
    const run = load(f);
    const card = storyOf(run);
    const check = run.events.find((e) => e.id === id)!;
    assert.ok(card.headline.startsWith(`${nameOf(check.actor!)}親自`), card.headline);
    assert.equal(card.outcome, id, `${f}: ${card.headline}`);
    assert.ok(card.spine.every((h) => h.t <= check.t), `${f}: ${card.spine.map((h) => `${h.via}@${h.t.toFixed(1)}`).join(" ")}`);
    assert.equal(card.spine.at(-1)?.event, id, `${f}: the check itself closes the chain`);
    assertChain(f, run);
  }
});

test("every recorded 🔍 headline: the chain leads to the look the headline reports", () => {
  let n = 0;
  for (const f of recorded()) {
    const run = load(f);
    if (!run?.events) continue;
    const card = storyOf(run);
    if (card.icon !== "🔍") continue;
    const o = run.events.find((e) => e.id === card.outcome);
    assert.ok(o && (o.type === "look" || o.type === "inspect") && card.headline.startsWith(nameOf(o.actor!)), `${f}: ${card.headline} → ${o?.type} by ${o?.actor}`);
    // what the headline (for 查無實據, its sub line) says they saw is what that look showed
    const said = card.headline.includes("本來在查別的事")
      ? FACTS.find((x) => x.check && x.zh.startsWith(/卻查出：(.+?)…?$/.exec(card.headline)![1]))!.check!.zh
      : card.headline.includes("查無實據")
        ? /^「(.+?)…?」$/.exec(card.sub)![1]
        : /親自查證：(.+?)…?$/.exec(card.headline)![1];
    assert.ok(String(o!.data.found).includes(said), `${f}: ${o!.id} did not show 「${said}」`);
    if (!card.chainGap) assert.ok(card.spine.at(-1)?.event === o!.id && card.spine.at(-1)!.text.startsWith(said), `${f}: the chain does not end at 「${said}」`);
    n++;
  }
  if (recorded().length) assert.ok(n > 0);
});
