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
