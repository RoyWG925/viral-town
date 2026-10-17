// Offline validator tests (Experiment C, deterministic part). These feed hand-written bad decisions
// to the validator; they test our guardrails, not Gemma. Run: node --test lab/test-validators.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACTS, PERSONAS, PLACES, PUBLIC_INFO } from "../src/sim/scenario.ts";
import { checkDecision, coerce, normalize } from "../src/sim/validate.ts";
import type { DecisionOutput } from "../src/sim/types.ts";
import type { View } from "../src/sim/view.ts";

function viewFor(id: string, opts: Partial<View> = {}): View {
  const p = PERSONAS.find((x) => x.id === id)!;
  const known: Record<string, boolean> = {};
  for (const f of p.knows) known[f] = FACTS.find((x) => x.id === f)!.value;
  return {
    npc: p, t: 30, clock: "15:30", place: p.home, placeZh: PLACES.find((x) => x.id === p.home)!.zh,
    knowledge: p.knows.map((f) => ({ id: f, zh: FACTS.find((x) => x.id === f)!.zh, secret: p.secrets.includes(f), learned: false })),
    known, beliefs: [],
    inbox: [{ id: "m1", from: "unknown", fromZh: "一位陌生客人", via: "seed", intent: "inform", text: "聽說市長很害怕鴿子。", trust: 0.3 }],
    memory: [],
    people: PERSONAS.filter((o) => o.id !== id && ["baker", "florist", "journalist"].includes(o.id)).map((o) => ({
      id: o.id, name: o.name, roleZh: o.roleZh, place: o.home, placeZh: o.home, relation: p.relations[o.id] ?? { trust: 0.35, phone: false, zh: "點頭之交" }, busy: false,
    })),
    actions: ["tell", "phone", "ask", "go_look", ...p.actions], publicEvents: [], heardText: "聽說市長很害怕鴿子。", publicInfo: PUBLIC_INFO, ...opts,
  };
}

const base = (over: Partial<DecisionOutput> = {}): DecisionOutput => ({
  understanding: "有人說市長怕鴿子", thought: "真的假的？", feeling: "🤔 好奇",
  claims: [{ ref: "new", statement: "市長很怕鴿子", topic: "mayor_fears_pigeons", says: "yes", category: "personal" }],
  stances: [{ claim: 0, verdict: "doubt", confidence: 0.3, why: "陌生人說的", cites: ["m1"] }],
  actions: [{ type: "none", why: "聽聽就好" }],
  ...over,
});

test("a sensible decision passes", () => {
  const r = checkDecision(viewFor("baker"), base());
  assert.deepEqual(r.errors, []);
});

test("mentioning another resident's secret is rejected", () => {
  const r = checkDecision(viewFor("florist"), base({ thought: "我猜燈籠節預算超支了，市長才會這麼緊張。" }));
  assert.ok(r.errors.some((e) => e.includes("超支")), r.errors.join("|"));
});

test("a resident may mention their own secret", () => {
  const r = checkDecision(viewFor("baker"), base({ thought: "還好沒人知道烤箱檢查過期的事。" }));
  assert.deepEqual(r.errors, []);
});

test("a word heard from someone else is not a leak", () => {
  const v = viewFor("florist", { heardText: "聽說燈籠節預算超支三成" });
  const r = checkDecision(v, base({ thought: "預算超支？難怪最近攤位費漲這麼多。" }));
  assert.deepEqual(r.errors, []);
});

test("a paraphrase of what they heard is not a leak", () => {
  const v = viewFor("vendor", { heardText: "聽說燈籠節的預算超支了，攤位費漲價就是為了補洞。" });
  const r = checkDecision(v, base({ thought: "原來漲價是為了補預算！" }));
  assert.deepEqual(r.errors, []);
});

test("a relayed rumour cannot become much surer than its teller", () => {
  const v = viewFor("florist", { inbox: [{ id: "m1", from: "baker", fromZh: "阿德", via: "phone", intent: "ask", text: "聽說市長很怕鴿子，妳聽說過嗎？", trust: 0.8, senderConf: 0.49 }] });
  const r = checkDecision(v, base({ stances: [{ claim: 0, verdict: "believe", confidence: 0.9, why: "阿德說的", cites: ["m1"] }] }));
  assert.ok(r.confidence[0] <= 0.64 + 1e-9, `confidence ${r.confidence[0]}`);
});

test("a stranger contradicting the public schedule stays unlikely", () => {
  const v = viewFor("baker", { inbox: [{ id: "m1", from: "unknown", fromZh: "陌生客人", via: "seed", intent: "inform", text: "燈籠節改到下星期了", trust: 0.3 }] });
  const r = checkDecision(v, base({ claims: [{ ref: "new", statement: "燈籠節改期", topic: "festival_on", says: "no", category: "event" }], stances: [{ claim: 0, verdict: "doubt", confidence: 0.6, why: "陌生人說的", cites: ["m1"] }] }));
  assert.ok(r.confidence[0] <= 0.25 + 1e-9, `confidence ${r.confidence[0]}`);
});

test("a trusted eyewitness can make someone confident", () => {
  const v = viewFor("mayor", { inbox: [{ id: "m1", from: "police", fromZh: "老周", via: "phone", intent: "warn", text: "我親眼看到舞台支架鬆動", trust: 0.8, senderConf: 0.98 }] });
  const r = checkDecision(v, base({ claims: [{ ref: "new", statement: "舞台不安全", topic: "stage_unsafe", says: "yes", category: "safety" }], stances: [{ claim: 0, verdict: "believe", confidence: 0.9, why: "老周親眼看到", cites: ["m1"] }] }));
  assert.ok(r.confidence[0] >= 0.8, `confidence ${r.confidence[0]}`);
});

test("a place that does not exist is rejected", () => {
  const r = checkDecision(viewFor("baker"), base({ actions: [{ type: "go_look", place: "castle", why: "看看" }] }));
  assert.ok(r.errors.some((e) => e.includes("place")));
});

test("an action outside the resident's role is rejected", () => {
  const r = checkDecision(viewFor("baker"), base({ actions: [{ type: "publish_article", message: "市長怕鴿子！", cites: ["#0"] }] }));
  assert.ok(r.errors.some((e) => e.includes("不是你能做的行動")));
});

test("calling someone without their number is rejected", () => {
  // (since v2 the baker can call 小雯, his source of gossip; he still has no number for the mayor)
  const r = checkDecision(viewFor("baker", { people: [{ id: "mayor", name: "林市長", roleZh: "市長", place: "townhall", placeZh: "townhall", relation: PERSONAS.find((p) => p.id === "baker")!.relations.mayor, busy: false }] }), base({ actions: [{ type: "phone", target: "mayor", message: "你聽說了嗎", cites: ["#0"] }] }));
  assert.ok(r.errors.some((e) => e.includes("電話")));
});

test("telling someone who is not in the simulation is rejected", () => {
  const r = checkDecision(viewFor("baker"), base({ actions: [{ type: "tell", target: "mayor", message: "市長你怕鴿子嗎", cites: ["#0"] }] }));
  assert.ok(r.errors.some((e) => e.includes("target")));
});

test("citing an id the resident never saw is rejected", () => {
  const r = checkDecision(viewFor("baker"), base({ stances: [{ claim: 0, verdict: "believe", confidence: 0.4, why: "有證據", cites: ["m9", "budget_overrun"] }] }));
  assert.ok(r.errors.some((e) => e.includes("m9")) && r.errors.some((e) => e.includes("budget_overrun")));
});

test("two stances on one claim are rejected", () => {
  const r = checkDecision(viewFor("baker"), base({ stances: [
    { claim: 0, verdict: "believe", confidence: 0.4, why: "a", cites: ["m1"] },
    { claim: 0, verdict: "disbelieve", confidence: 0.1, why: "b", cites: ["m1"] },
  ] }));
  assert.ok(r.errors.some((e) => e.includes("同一條說法")));
});

test("an unknown topic is rejected", () => {
  const r = checkDecision(viewFor("baker"), base({ claims: [{ ref: "new", statement: "x", topic: "aliens", says: "yes", category: "absurd" }] }));
  assert.ok(r.errors.some((e) => e.includes("topic")));
});

test("a stranger's rumour cannot make anyone certain", () => {
  const r = checkDecision(viewFor("baker"), base({ stances: [{ claim: 0, verdict: "believe", confidence: 0.99, why: "我信", cites: ["m1"] }] }));
  assert.deepEqual(r.errors, []);
  assert.ok(r.confidence[0] < 0.55, `confidence ${r.confidence[0]}`);
});

test("someone who knows the truth cannot believe the opposite", () => {
  // the mayor knows the budget overran; a claim that it did not is capped near zero
  const v = viewFor("mayor", { inbox: [{ id: "m1", from: "organizer", fromZh: "志明", via: "face", intent: "inform", text: "預算其實沒超支", trust: 0.7 }] });
  const r = checkDecision(v, base({ claims: [{ ref: "new", statement: "預算沒超支", topic: "budget_overrun", says: "no", category: "scandal" }], stances: [{ claim: 0, verdict: "believe", confidence: 0.9, why: "志明說的", cites: ["m1"] }] }));
  assert.ok(r.confidence[0] <= 0.1, `confidence ${r.confidence[0]}`);
});

test("believing the opposite of your own knowledge is sent back to the model", () => {
  // the florist arranged the pigeon cages and knows the birds are healthy
  const v = viewFor("florist", { inbox: [{ id: "m1", from: "unknown", fromZh: "一位陌生客人", via: "seed", intent: "inform", text: "慶典那批鴿子好像生病了。", trust: 0.3 }], heardText: "慶典那批鴿子好像生病了。" });
  const claims = [{ ref: "new", statement: "鴿子生病了", topic: "pigeons_sick", says: "yes" as const, category: "health" as const }];
  const r = checkDecision(v, base({ claims, stances: [{ claim: 0, verdict: "believe", confidence: 0.7, why: "不能掉以輕心", cites: ["m1"] }] }));
  assert.ok(r.errors.some((e) => e.includes("跟你知道的事相反")), r.errors.join("|"));
  const ok = checkDecision(v, base({ claims, stances: [{ claim: 0, verdict: "disbelieve", confidence: 0.05, why: "鴿子很健康", cites: ["m1", "pigeons_sick"] }] }));
  assert.deepEqual(ok.errors, []);
});

test("police cannot be dispatched on a hunch", () => {
  const v = viewFor("police");
  const r = checkDecision(v, base({ claims: [{ ref: "new", statement: "有人要搞破壞", topic: "threat", says: "yes", category: "crime" }], stances: [{ claim: 0, verdict: "believe", confidence: 0.9, why: "陌生人說的", cites: ["m1"] }], actions: [{ type: "dispatch_police", place: "plaza", message: "去看看", cites: ["#0"] }] }));
  assert.ok(r.errors.some((e) => e.includes("出動警力")), r.errors.join("|"));
});

test("the festival cannot be cancelled without strong grounds", () => {
  const v = viewFor("mayor");
  const r = checkDecision(v, base({ actions: [{ type: "cancel_festival", message: "取消", cites: ["#0"] }] }));
  assert.ok(r.errors.some((e) => e.includes("取消燈籠節")));
});

test("only none, never none plus another action", () => {
  const r = checkDecision(viewFor("baker"), base({ actions: [{ type: "none" }, { type: "tell", target: "florist", message: "嘿", cites: ["#0"] }] }));
  assert.ok(r.errors.some((e) => e.includes("none")));
});

test("the chosen act survives parsing; an unknown act is read off the feeling", async () => {
  const { coerce, normalize } = await import("../src/sim/validate.ts");
  const raw = { feeling: "😡 生氣", act: "angry", understanding: "x", claims: [], stances: [], thought: "y", actions: [{ type: "none" }] };
  const kept = normalize(viewFor("baker"), coerce(raw).out!).out;
  assert.equal(kept.act, "angry");
  const mapped = normalize(viewFor("baker"), coerce({ ...raw, act: "breakdance" }).out!).out;
  assert.equal(mapped.act, "angry");
});

test("a stance pointing outside the claims list is sent back, not guessed", () => {
  // the florist case: one claim listed, stances on "2" and "0"; guessing "2" = belief c2 stored the opposite belief
  const v = viewFor("florist", {
    beliefs: [{ id: "c2", statement: "今晚的燈籠很容易著火", topic: "lanterns_flammable", says: "yes", category: "safety", confidence: 0.55, sources: ["baker"], sourcesZh: "阿德" }],
  });
  const raw = base({
    claims: [{ ref: "new", statement: "燈籠都是合格防火材質", topic: "lanterns_flammable", says: "no", category: "safety" }],
    stances: [
      { claim: 2, verdict: "believe", confidence: 0.8, why: "主辦人保證", cites: ["m1"] },
      { claim: 0, verdict: "disbelieve", confidence: 0.4, why: "沒根據", cites: ["m1"] },
    ],
  });
  const n = normalize(v, raw);
  const r = checkDecision(v, n.out);
  assert.ok(r.errors.some((e) => e.includes("claims 陣列裡的位置")), r.errors.join("|"));
});

test("with no claims listed, a bare stance number maps to that belief (not ambiguous)", () => {
  const v = viewFor("vendor", {
    beliefs: [{ id: "c2", statement: "市長拿攤位費買新車", topic: "budget_overrun", says: "yes", category: "scandal", confidence: 0.45, sources: ["unknown"], sourcesZh: "陌生人" }],
  });
  const raw = base({ claims: [], stances: [{ claim: 2, verdict: "doubt", confidence: 0.3, why: "沒證據", cites: ["m1"] }] });
  const n = normalize(v, raw);
  assert.equal(n.out.claims[0]?.ref, "c2");
  assert.deepEqual(checkDecision(v, n.out).errors, []);
});

test("a new claim the model named itself (\"c2\") keeps its stance and can be cited (P4 regression)", () => {
  // shape of the real failing answer: the journalist found the overrun, called it c2, re-listed belief c1 by id
  const v = viewFor("journalist", {
    beliefs: [{ id: "c1", statement: "市長拿攤位費買新車", topic: "mayor_embezzled", says: "yes", category: "scandal", confidence: 0.2, sources: ["vendor"], sourcesZh: "阿珠" }],
    knowledge: [...viewFor("journalist").knowledge, { id: "budget_overrun", zh: "公開的慶典收支表上，實際支出比原本的預算多了三成。", secret: false, learned: true }],
  });
  v.known = { ...v.known, budget_overrun: true }; // as the engine does for a fact found by inspecting
  const raw = base({
    claims: [{ ref: "c2", statement: "燈籠節預算超支三成", topic: "budget_overrun", says: "yes", category: "scandal" }],
    stances: [
      { claim: "c2" as unknown as number, verdict: "believe", confidence: 0.95, why: "我親眼看到收支表", cites: ["budget_overrun"] },
      { claim: "c1" as unknown as number, verdict: "doubt", confidence: 0.2, why: "沒證據", cites: [] },
    ],
    actions: [{ type: "publish_article", message: "燈籠節預算超支三成！", cites: ["c2", "budget_overrun"] }],
  });
  const n = normalize(v, raw);
  assert.equal(n.out.claims[0].topic, "budget_overrun");
  assert.equal(n.out.stances.find((s) => s.claim === 0)?.confidence, 0.95);
  assert.ok(n.out.actions[0].cites?.includes("#0"), JSON.stringify(n.out.actions[0].cites));
  assert.deepEqual(checkDecision(v, n.out).errors, []);
});

// F04 (independent review, 2026-10-17): a claim reference is read by its shape before anything is looked up:
// "c<N>" is a claim id, "#<k>" or a bare number a position in this answer's claims, anything else is sent back.
// Stripping the "c" first read belief c1 as position 1 and quietly updated whatever claim sat there.
const belief = (id: string, statement: string): View["beliefs"][number] => ({ id, statement, topic: "other", says: "yes", category: "other", confidence: 0.2, sources: ["unknown"], sourcesZh: "一位陌生客人" });
const listed = (ref: string, statement: string): DecisionOutput["claims"][number] => ({ ref, statement, topic: "other", says: "yes", category: "other" });
const stanceOn = (claim: unknown): DecisionOutput["stances"][number] => ({ claim: claim as number, verdict: "doubt", confidence: 0.4, why: "再想想", cites: ["m1"] });
/** where each stance lands once normalized, i.e. what the engine would write: an old claim by id, a new one by statement */
function landing(v: View, raw: DecisionOutput) {
  const n = normalize(v, raw);
  const r = checkDecision(v, n.out);
  const at = n.out.stances.map((s) => {
    const c = n.out.claims[s.claim];
    return !c ? "nowhere" : c.ref === "new" ? c.statement : c.ref;
  });
  return { n, r, at };
}

test("review C1: a stance on \"c1\" updates belief c1, not the new claim at position 1", () => {
  const v = viewFor("baker", { beliefs: [belief("c1", "舊說法 A")] });
  const { n, r, at } = landing(v, base({ claims: [listed("c1", "舊說法 A"), listed("new", "不相干的新說法 B")], stances: [stanceOn("c1")] }));
  assert.deepEqual(at, ["c1"], n.notes.join("|"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.confidence[n.out.stances[0].claim], 0.4);
});

test("review C2: a stance on \"c2\" listed first updates c2, not the claim at position 2", () => {
  const v = viewFor("baker", { beliefs: [belief("c2", "舊說法 A")] });
  const { n, r, at } = landing(v, base({ claims: [listed("c2", "舊說法 A"), listed("new", "新說法 B"), listed("new", "新說法 C")], stances: [stanceOn("c2")] }));
  assert.deepEqual(at, ["c2"], n.notes.join("|"));
  assert.deepEqual(r.errors, []);
});

test("claim ids, positions and the list length never stand in for each other", () => {
  const cases: { name: string; beliefs: string[]; claims: [string, string][]; stances: unknown[]; at: string[] }[] = [
    // the P20 shape: an old belief judged by id but not re-listed, its number inside the list
    { name: "id inside the list length, not listed", beliefs: ["c1"], claims: [["new", "新說法 A"], ["new", "新說法 B"]], stances: [0, 1, "c1"], at: ["新說法 A", "新說法 B", "c1"] },
    { name: "id beyond the list length, not listed", beliefs: ["c3"], claims: [["new", "新說法 A"]], stances: [0, "c3"], at: ["新說法 A", "c3"] },
    { name: "ids listed out of numeric order", beliefs: ["c1", "c2"], claims: [["c2", "舊說法 c2"], ["c1", "舊說法 c1"]], stances: ["c1", "c2"], at: ["c1", "c2"] },
    // the model's own name for a new claim, equal to the other claim's position
    { name: "self-named new claim c1 at position 0", beliefs: [], claims: [["c1", "自己取名的 A"], ["new", "新說法 B"]], stances: ["c1", 1], at: ["自己取名的 A", "新說法 B"] },
    { name: "#k and a number written as text are positions", beliefs: ["c1"], claims: [["new", "新說法 A"], ["new", "新說法 B"]], stances: ["#1", "0"], at: ["新說法 B", "新說法 A"] },
    { name: "a bare number is a position even when a belief has that number", beliefs: ["c1"], claims: [["new", "新說法 A"], ["new", "新說法 B"]], stances: [1, 0], at: ["新說法 B", "新說法 A"] },
  ];
  for (const k of cases) {
    const v = viewFor("baker", { beliefs: k.beliefs.map((id) => belief(id, `舊說法 ${id}`)) });
    const { n, r, at } = landing(v, base({ claims: k.claims.map(([ref, s]) => listed(ref, s)), stances: k.stances.map(stanceOn) }));
    assert.deepEqual(at, k.at, `${k.name}: ${n.notes.join("|")}`);
    assert.deepEqual(r.errors, [], k.name);
    assert.ok(!n.notes.some((x) => x.includes("duplicate")), `${k.name}: ${n.notes.join("|")}`);
  }
});

test("a claim reference that names no claim is sent back, not guessed or dropped", () => {
  // "c0" used to become position 0; "c5" (no such claim) and "claim1" used to vanish with the judgement in them
  const v = viewFor("baker", { beliefs: [belief("c1", "舊說法 c1")] });
  for (const ref of ["c0", "c5", "claim1", "#3", "new", "mayor_fears_pigeons", null]) {
    const { r, at } = landing(v, base({ claims: [listed("new", "新說法 A")], stances: [stanceOn(ref)] }));
    assert.deepEqual(at, ["nowhere"], String(ref));
    // the message back says which positions and which of their own claim ids exist
    assert.ok(r.errors.some((e) => e.includes("claims 陣列裡的位置（0 到 0）") && e.includes("c1")), `${String(ref)}: ${r.errors.join("|")}`);
  }
});

test("action cites read claim references the same way", () => {
  const v = viewFor("baker", { beliefs: [belief("c1", "舊說法 c1")] });
  const raw = (cites: string[]) => base({
    claims: [listed("c1", "舊說法 c1"), listed("c7", "自己取名的新說法")],
    stances: [stanceOn("c1"), stanceOn("c7")],
    actions: [{ type: "tell", target: "florist", intent: "inform", message: "你聽說了嗎", cites }],
  });
  // an old claim keeps its id; the model's own name and a bare number inside the list become positions
  const ok = landing(v, raw(["c1", "c7", "1", "m1"]));
  assert.deepEqual(ok.n.out.actions[0].cites, ["c1", "#1", "#1", "m1"]);
  assert.deepEqual(ok.r.errors, []);
  // a claim reference that resolves to nothing is sent back instead of silently leaving the action's grounds
  for (const bad of ["c9", "5", "#4"]) {
    const { r } = landing(v, raw([bad]));
    assert.ok(r.errors.some((e) => e.includes(`cites 引用了不存在的編號 ${bad}`)), `${bad}: ${r.errors.join("|")}`);
  }
});

test("P20/wobble-organizer d5 replayed: the doubt about the old stage rumour (c1) is kept, not dropped as a duplicate", () => {
  // the recorded answer named its two new findings c2 and c3 and judged its old stage rumour as "c1"; the old reading
  // made "c1" position 1 (the lantern finding) and then dropped it as a second stance on that claim
  const run = JSON.parse(readFileSync("lab/runs/P20/wobble-organizer.json", "utf8")).run;
  const d = run.decisions.find((x: { id: string }) => x.id === "d5");
  const raw: string = d.llm.find((l: { raw?: string | null }) => l.raw).raw;
  const rumour = run.claims.find((c: { id: string }) => c.id === "c1");
  const seen = run.events.find((e: { type: string; data: { message?: string } }) => e.type === "deliver" && e.data.message === "m5").data;
  const org = PERSONAS.find((p) => p.id === "organizer")!;
  const v = viewFor("organizer", {
    beliefs: [{ id: "c1", statement: rumour.statement, topic: rumour.topic, says: rumour.says, category: rumour.category, confidence: 0.8, sources: ["unknown"], sourcesZh: "一位陌生客人" }],
    inbox: [{ id: "m5", from: "self", fromZh: "你自己", via: "inspection", intent: "inform", text: seen.text, trust: 0.7 }],
    heardText: `舞台好像在晃。 ${seen.text}`,
    people: [{ id: "police", name: "老周", roleZh: "警長", place: "police", placeZh: "police", relation: org.relations.police!, busy: false }],
  });
  const n = normalize(v, coerce(JSON.parse(raw)).out!);
  const stances = n.out.stances.map((s) => {
    const c = n.out.claims[s.claim];
    return [c.ref === "new" ? c.statement : c.ref, s.verdict, s.confidence];
  });
  assert.deepEqual(stances, [["慶典的鴿子很健康", "believe", 1], ["燈籠是合格的防火材質", "believe", 1], ["c1", "doubt", 0.3]], n.notes.join("|"));
  assert.ok(!n.notes.some((x) => x.includes("duplicate")), n.notes.join("|"));
  assert.deepEqual(n.out.actions[0].cites, ["#0", "#1"]);
  const r = checkDecision(v, n.out);
  assert.deepEqual(r.errors, []);
  // the review's caveat holds: the organizer knows the stage was never inspected, so the engine keeps c1 at 0.8 or more
  assert.ok(r.confidence[2] >= 0.8, `c1 ${r.confidence[2]}`);
});
