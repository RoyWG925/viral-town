// v2 character cards and relationships: every resident sees only their own card; the new secrets each resident holds
// about someone else can be said by the holder and are rejected from anyone who could not know. node --test lab/test-cards.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FACTS, PERSONAS, PLACES, PUBLIC_INFO } from "../src/sim/scenario.ts";
import { checkDecision } from "../src/sim/validate.ts";
import { userPrompt } from "../src/sim/mind.ts";
import type { DecisionOutput } from "../src/sim/types.ts";
import type { View } from "../src/sim/view.ts";

function viewFor(id: string): View {
  const p = PERSONAS.find((x) => x.id === id)!;
  const known: Record<string, boolean> = {};
  for (const f of p.knows) known[f] = FACTS.find((x) => x.id === f)!.value;
  return {
    npc: p, t: 30, clock: "15:30", place: p.home, placeZh: PLACES.find((x) => x.id === p.home)!.zh,
    knowledge: p.knows.map((f) => ({ id: f, zh: FACTS.find((x) => x.id === f)!.zh, secret: p.secrets.includes(f), learned: false })),
    known, beliefs: [],
    inbox: [{ id: "m1", from: "unknown", fromZh: "一位陌生客人", via: "seed", intent: "inform", text: "今天天氣不錯。", trust: 0.3 }],
    memory: [],
    people: PERSONAS.filter((o) => o.id !== id && p.relations[o.id]).map((o) => ({ id: o.id, name: o.name, roleZh: o.roleZh, place: o.home, placeZh: o.home, relation: p.relations[o.id], busy: false })),
    actions: ["tell", "phone", "ask", "go_look", ...p.actions], publicEvents: [], heardText: "今天天氣不錯。", publicInfo: PUBLIC_INFO,
  };
}
const saying = (text: string): DecisionOutput => ({
  understanding: "沒什麼", thought: "隨便聊聊", feeling: "🙂 平靜", claims: [], stances: [],
  actions: [{ type: "tell", target: "", message: text, intent: "inform", cites: [] }],
});
const NEW = ["mayor_owes_baker", "florist_heard_strut", "mayor_organizer_quarrel", "daughter_stage_fright", "organizer_cut_corners", "florist_paid_by_townhall", "vendors_unpaid"];

test("every resident has a full card, and each new secret has a holder and leak keywords", () => {
  for (const p of PERSONAS) {
    assert.ok(p.card, `${p.id} has a card`);
    for (const k of ["owns", "exclusive", "wants", "fears", "bias", "gossip", "bottom", "price"] as const) assert.ok(p.card![k].length > 2, `${p.id}.${k}`);
    assert.equal(p.card!.lines.length, 2);
  }
  for (const id of NEW) {
    const f = FACTS.find((x) => x.id === id)!;
    assert.ok(f && f.keywords.length >= 2, id);
    assert.ok(PERSONAS.some((p) => p.knows.includes(id)), `${id} has a holder`);
  }
});

test("a new secret can be said by its holder and is rejected from someone who could not know it", () => {
  for (const id of NEW) {
    const f = FACTS.find((x) => x.id === id)!;
    const holder = PERSONAS.find((p) => p.knows.includes(id))!;
    const outsider = PERSONAS.find((p) => !p.knows.includes(id))!;
    const line = `你知道嗎，${f.keywords[0]}。`;
    const target = (pid: string) => PERSONAS.find((o) => o.id !== pid && PERSONAS.find((x) => x.id === pid)!.relations[o.id])!.id;
    const asHolder = saying(line);
    asHolder.actions[0].target = target(holder.id);
    assert.ok(!checkDecision(viewFor(holder.id), asHolder).errors.some((e) => e.includes("沒有聽說過")), `${holder.id} may say ${id}`);
    const asOutsider = saying(line);
    asOutsider.actions[0].target = target(outsider.id);
    assert.ok(checkDecision(viewFor(outsider.id), asOutsider).errors.some((e) => e.includes("沒有聽說過")), `${outsider.id} must not know ${id}`);
  }
});

test("each prompt carries only its own card, with relationship kinds and pasts", () => {
  for (const p of PERSONAS) {
    const s = userPrompt(viewFor(p.id), "single");
    assert.ok(s.includes(p.card!.price) && s.includes(p.card!.lines[0]), `${p.id} sees own card`);
    for (const o of PERSONAS) if (o !== p) assert.ok(!s.includes(o.card!.price) && !s.includes(o.card!.bottom), `${p.id} must not see ${o.id}'s card`);
  }
  const baker = userPrompt(viewFor("baker"), "single");
  assert.ok(baker.includes("前任") && baker.includes("退了婚"), "the baker's ex shows with its past");
  assert.ok(baker.includes("債主"), "and the mayor's debt");
});

// ---- B: the motive a resident gives, the one line a story reveals ---------------------------------------------
import { normalize, coerce } from "../src/sim/validate.ts";
import { simulate } from "../src/sim/engine.ts";
import { revealOf } from "../src/town/story.ts";
import type { Chat, LlmCall } from "../src/sim/llm.ts";

const reply = (o: object): LlmCall => ({ content: JSON.stringify(o), status: 200, latencyMs: 5, attempts: 1, promptTokens: 100, completionTokens: 20, platformCost: 0, estCost: 0, rateHeaders: {}, provider: "fake" });

test("an unknown motive becomes none instead of a retry; a known one is kept", () => {
  const raw = { feeling: "😟 擔心", act: "worried", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] };
  assert.equal(normalize(viewFor("baker"), coerce({ ...raw, motive: "FEAR" }).out!).out.motive, "fear");
  assert.equal(normalize(viewFor("baker"), coerce({ ...raw, motive: "revenge" }).out!).out.motive, "none");
  assert.equal(normalize(viewFor("baker"), coerce(raw).out!).out.motive, undefined);
});

test("the decide event carries the motive, and the story reveals the most telling line with the card's own words", async () => {
  const answers: Record<string, object> = {
    阿德: { feeling: "😰 緊張", act: "nervous", understanding: "有人在笑我", thought: "糟了", motive: "fear", claims: [], stances: [], actions: [{ type: "phone", target: "journalist", message: "小雯，我跟你說一件事", cites: [] }] },
    小雯: { feeling: "🤨 懷疑", act: "doubt", understanding: "阿德慌了", thought: "越否認越可疑", motive: "bias", claims: [], stances: [], actions: [{ type: "none", why: "先觀察" }] },
  };
  const chat: Chat = async (msgs) => {
    const who = /【你是誰】([^，]+)，/.exec(msgs.map((m) => m.content).join("\n"))?.[1] ?? "";
    return reply(answers[who] ?? { feeling: "😐 無感", act: "shrug", understanding: "x", thought: "y", claims: [], stances: [], actions: [{ type: "none", why: "x" }] });
  };
  const run = await simulate({ active: ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"], seedNpc: "baker", seedText: "大家都在笑你的麵包", seed: 41, policy: "gemma", chat, maxDecisions: 4 });
  const dec = run.events.find((e) => e.type === "decide" && e.actor === "baker")!;
  assert.equal(dec.data.motive, "fear");
  const r = revealOf(run.events)!;
  // fear outranks bias: the baker's fear, quoted from his card
  assert.equal(r.npc, "baker");
  assert.equal(r.key, "fear");
  assert.equal(r.text, PERSONAS.find((p) => p.id === "baker")!.card!.fears);
  // an old log without motives reveals nothing
  assert.equal(revealOf(run.events.map((e) => (e.type === "decide" ? { ...e, data: { ...e.data, motive: undefined } } : e))), undefined);
});

test("a confidence written with words or a percent is read, not sent back", () => {
  const raw = (c: unknown) => ({ feeling: "🤔 想", act: "ponder", understanding: "x", thought: "y", claims: [{ ref: "new", source: "m1", statement: "s", topic: "other", says: "yes", category: "other" }], stances: [{ claim: 0, verdict: "doubt", confidence: c, why: "w", cites: ["m1"] }], actions: [{ type: "none", why: "x" }] });
  assert.equal(normalize(viewFor("baker"), coerce(raw("0.5（不確定）")).out!).out.stances[0].confidence, 0.5);
  assert.equal(normalize(viewFor("baker"), coerce(raw("60%")).out!).out.stances[0].confidence, 0.6);
});

test("the prompt says how often you have already talked with someone tonight", () => {
  const v = viewFor("journalist");
  v.people = v.people.map((x) => (x.id === "baker" ? { ...x, talks: 3 } : x));
  assert.ok(userPrompt(v, "single").includes("你們今晚已經說過 3 次話了"));
});
