// What one NPC can see when deciding: only their own knowledge, beliefs, messages and the people
// they can reach. The engine builds it; prompts, validators and the rule policy read nothing else.
import { FACTS, TOPICS, UNKNOWN_TRUST } from "./scenario.ts";
import type { ActionKind, Category, FactId, Intent, Minutes, Persona, PlaceId, Relation, Says } from "./types.ts";

export interface PersonRef {
  id: string;
  name: string;
  roleZh: string;
  place: PlaceId;
  placeZh: string;
  relation: Relation;
  busy: boolean;
  /** how many times they have already talked (in person or by phone) with this person tonight */
  talks?: number;
}

export interface InboxItem {
  id: string;
  from: string; // npc id, "unknown", "crowd", "news", "notice", "self"
  fromZh: string;
  via: string;
  intent: Intent;
  text: string;
  trust: number; // how much this NPC trusts that source
  /** how sure the sender was (a relayed rumour cannot become surer than its teller) */
  senderConf?: number;
}

export interface BeliefRef {
  id: string; // claim id
  statement: string;
  topic: string;
  says: Says;
  category: Category;
  confidence: number;
  sources: string[];
  sourcesZh: string;
}

export interface View {
  npc: Persona;
  t: Minutes;
  clock: string;
  place: PlaceId;
  placeZh: string;
  knowledge: { id: FactId; zh: string; secret: boolean; learned: boolean }[];
  /** fact values this NPC knows; validator-only */
  known: Record<FactId, boolean>;
  beliefs: BeliefRef[];
  inbox: InboxItem[];
  memory: string[];
  people: PersonRef[];
  actions: ActionKind[];
  /** public happenings this NPC has perceived (articles, gatherings, police, statements) */
  publicEvents: string[];
  /** everything this NPC has heard or read, for the "unknown information" check */
  heardText: string;
  publicInfo: string;
}

export const topicFact = (topic: string) => TOPICS.find((x) => x.id === topic)?.fact ?? null;

export const clockOf = (t: Minutes) => {
  const total = Math.round(15 * 60 + t);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Trust this NPC gives to a source. */
export function trustIn(npc: Persona, source: string): number {
  if (source === "self") return 0.7; // what you saw yourself, for things that are not checkable facts
  if (source === "unknown") return UNKNOWN_TRUST;
  if (source === "hunch") return 0.45; // a thought of unknown origin: easier to entertain than a stranger's word, still unproven
  if (source === "crowd") return 0.4;
  if (source === "notice") return 0.3;
  return npc.relations[source]?.trust ?? 0.35;
}

/** Why the engine limited a belief, kept with the belief so the player can be told in plain words. */
export type Limit =
  | { kind: "knows"; fact: FactId } // contradicts what they themselves know
  | { kind: "agrees"; fact: FactId } // matches what they know, so they are sure
  | { kind: "schedule"; fact: FactId } // contradicts the public schedule
  | { kind: "hearsay"; source: string; trust: number; teller?: number; sources: number; witness?: boolean };

/**
 * How confident this NPC may become about a claim, given who told them and what they know.
 * Deterministic: the model proposes a confidence, the engine keeps it inside this range.
 */
export function confidenceRange(view: View, topic: string, says: Says, sources: string[], senderConf?: number): { min: number; max: number; reason: string; against?: string; why: Limit } {
  const fact = topicFact(topic);
  if (fact && fact in view.known && says !== "unclear") {
    const agrees = (says === "yes") === view.known[fact];
    const soft = FACTS.find((f) => f.id === fact)?.soft;
    if (agrees) return { min: soft ? 0.6 : 0.8, max: 0.98, reason: "matches what they know", why: { kind: "agrees", fact } };
    return { min: 0, max: soft ? 0.25 : 0.1, reason: soft ? "contradicts the public schedule" : "contradicts what they know", against: soft ? undefined : fact, why: soft ? { kind: "schedule", fact } : { kind: "knows", fact } };
  }
  const trusts = sources.map((s) => trustIn(view.npc, s));
  const trustMax = trusts.length ? Math.max(...trusts) : UNKNOWN_TRUST; // callers pass only the sources this claim came from
  const best = trusts.length ? sources[trusts.indexOf(trustMax)] : "unknown";
  const distinct = new Set(sources).size;
  let max = Math.min(0.95, Math.max(0.05, 0.15 + 0.55 * trustMax + 0.25 * view.npc.credulity + 0.1 * Math.max(0, distinct - 1)));
  // you cannot become much surer than the person who told you, unless others say it too
  if (senderConf !== undefined && distinct <= 1) max = Math.min(max, senderConf + 0.15);
  // but a trusted person who is sure (they saw it themselves) counts for more than ordinary hearsay
  const witness = senderConf !== undefined && senderConf >= 0.9 && trustMax >= 0.6;
  if (witness) max = Math.max(max, Math.min(0.95, 0.55 + 0.4 * trustMax));
  return {
    min: 0, max,
    reason: `hearsay (best source trust ${trustMax.toFixed(2)}, ${distinct} source${distinct > 1 ? "s" : ""}${senderConf !== undefined ? `, teller was ${senderConf.toFixed(2)} sure` : ""})`,
    why: { kind: "hearsay", source: best, trust: trustMax, teller: senderConf, sources: distinct, witness: witness || undefined },
  };
}

export const describeTrust = (t: number) =>
  t >= 0.75 ? "你非常信任" : t >= 0.6 ? "你蠻信任" : t >= 0.45 ? "你半信半疑" : t >= 0.3 ? "你不太相信" : "你很不信任";
