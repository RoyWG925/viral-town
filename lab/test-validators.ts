// Offline validator tests (Experiment C, deterministic part). These feed hand-written bad decisions
// to the validator; they test our guardrails, not Gemma. Run: node --test lab/test-validators.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FACTS, PERSONAS, PLACES, PUBLIC_INFO } from "../src/sim/scenario.ts";
import { checkDecision } from "../src/sim/validate.ts";
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
  const r = checkDecision(viewFor("baker"), base({ actions: [{ type: "phone", target: "journalist", message: "你聽說了嗎", cites: ["#0"] }] }));
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
