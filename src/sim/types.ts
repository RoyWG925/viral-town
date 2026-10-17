// VIRAL social simulation: shared types.
// Three layers, kept apart on purpose:
//   - World truth (facts, object state, who is where): only the engine writes it.
//   - Minds (knowledge, beliefs, trust, memory): one per core NPC; the engine writes it from validated decisions.
//   - Claims: what people say. A claim is never truth, even when it happens to match a fact.

export type NpcId = string;
export type PlaceId = string;
export type FactId = string;

/** Game time in minutes after 15:00. */
export type Minutes = number;

export interface Place {
  id: PlaceId;
  zh: string;
  en: string;
  /** building id in the 3D town, or a plaza/stage spot, for playback */
  spot: string;
}

/** An objective fact about the town. `observable` facts can be checked by anyone who goes and looks. */
export interface Fact {
  id: FactId;
  zh: string; // the fact stated plainly (true statement)
  value: boolean; // whether `zh` is true in this world
  /** for a false fact: the truth said plainly, as someone who knows it would think it (models skip negations like 「這不是真的：…」) */
  notZh?: string;
  /** where it can be checked, and how. `legacyZh`: the same finding in the Chinese wording that logs recorded before
   *  the English text carry (lab/runs, public/recorded), so code matching a log's `found` text can accept either. */
  check?: { place: PlaceId; by: "look" | "expert"; roles?: string[]; zh: string; legacyZh?: string };
  /** words that give it away; used to catch NPCs mentioning what they cannot know */
  keywords: string[];
  public?: boolean; // everyone knows it from the start (posters, common knowledge)
  /** can change during the evening (a schedule): contradicting it is unlikely, not impossible */
  soft?: boolean;
}

/** Mutable object/world state that playback can show. */
export interface WorldState {
  festival: "scheduled" | "cancelled" | "postponed";
  shops: Record<string, "open" | "closed">; // keyed by place id
  stage: "open" | "closed";
  police: { deployed: boolean; place: PlaceId | null; arriveAt?: Minutes };
  notices: { id: string; text: string; by: NpcId; at: Minutes }[];
  articles: { id: string; headline: string; body: string; by: NpcId; at: Minutes }[];
  gatherings: Record<PlaceId, { cause: string; people: NpcId[]; extras: number }>;
  statements: { by: NpcId; text: string; at: Minutes }[];
}

export interface Relation {
  trust: number; // 0..1, how much they believe what this person tells them
  phone: boolean; // close enough to call
  zh: string; // how they relate, in words
  /** what kind of tie it is (前任, 債主, 暗戀, 表面盟友…) and one line of shared past — shown only to the person holding it */
  type?: string;
  past?: string;
}

/**
 * Who someone is, in nouns rather than adjectives: what they hold, what only they can do, what they want tonight,
 * what they fear, how they misread things, how they pass things on, what they will never do, and what would make
 * them turn on someone. Shown to the model only for the resident it is playing; players discover it over plays.
 */
export interface PersonaCard {
  owns: string;
  exclusive: string;
  wants: string;
  fears: string;
  bias: string;
  gossip: string;
  bottom: string;
  price: string;
  lines: string[];
}

export interface Persona {
  id: NpcId;
  name: string;
  role: string; // job/role key, e.g. "baker"
  roleZh: string;
  home: PlaceId; // workplace / where they usually are
  traits: string; // personality in plain words
  wants: string; // goals and interests
  credulity: number; // 0..1 how readily they take hearsay seriously
  talkative: number; // 0..1 how readily they pass things on
  knows: FactId[]; // facts known from the start (incl. their secrets)
  secrets: FactId[]; // subset of knows they protect
  relations: Record<NpcId, Relation>;
  /** extra actions beyond the common ones */
  actions: ActionKind[];
  /** how they tend to act when something gets to them — characterisation shown to the model, never an order */
  habit?: string;
  card?: PersonaCard;
}

export type Category = "safety" | "crime" | "scandal" | "health" | "policy" | "event" | "personal" | "absurd" | "other";

export type Says = "yes" | "no" | "unclear";

export interface Claim {
  id: string; // c1, c2... global per run
  statement: string; // one sentence, as understood when first recorded
  topic: string; // a public topic id (see scenario TOPICS)
  says: Says; // the claim's answer to that topic's yes/no question
  category: Category;
  /** engine-only: the fact behind the topic and whether the claim asserts it; never shown to NPCs */
  fact: FactId | null;
  asserts: boolean | null;
  origin: string; // event id that first introduced it
  by: NpcId | "unknown"; // who first recorded it
}

export interface Belief {
  claim: string; // claim id
  confidence: number; // 0..1
  sources: string[]; // who it came from (npc id, "unknown", "self:inspection"...)
  updatedAt: Minutes;
  why: string;
}

export interface Mind {
  knows: Set<FactId>;
  /** knowledge acquired during the run (fact id -> value learned), e.g. from an inspection */
  learned: Map<FactId, boolean>;
  beliefs: Map<string, Belief>;
  inbox: Message[]; // not yet considered
  memory: string[]; // short lines the NPC remembers having heard or done
  decisions: number;
  lastDecisionAt: Minutes;
  /** who I already told what (claim id → how often, how sure I was, whether in person), so the engine can stop
   *  empty repeats but still let a changed mind or a first face-to-face confrontation through */
  told: Map<NpcId, Map<string, { n: number; conf: number; face: boolean }>>;
  /** "from|claimId" → how it was last heard, so hearing the same thing from the same person again adds nothing,
   *  unless they now say it in person for the first time or are much surer / less sure than before */
  heardKeys: Map<string, { face: boolean; conf: number }>;
}

export interface Message {
  id: string; // m1...
  from: NpcId | "unknown" | "news" | "notice" | "crowd" | "hunch";
  to: NpcId;
  via: "face" | "phone" | "overheard" | "article" | "notice" | "crowd" | "inspection" | "seed" | "hunch" | "meet";
  intent: Intent;
  text: string;
  claims: string[]; // claim ids the sender meant (empty for the seed: the receiver interprets it)
  /** how sure the sender was of what they passed on (their highest belief among those claims) */
  senderConf?: number;
  at: Minutes;
  event: string; // event id that delivered it
}

export type Intent = "inform" | "warn" | "ask" | "answer" | "deny" | "complain" | "request" | "joke";

export type ActionKind =
  | "none"
  | "tell" // walk over and talk
  | "phone"
  | "ask" // go and ask someone about something
  | "go_look" // go to a place and look for yourself
  | "inspect" // expert check (role-gated)
  | "close_shop"
  | "open_shop"
  | "post_notice"
  | "publish_article"
  | "public_statement"
  | "cancel_festival"
  | "dispatch_police"
  | "close_stage"
  | "rally"; // call people to gather somewhere

export interface ActionIntent {
  type: ActionKind;
  target?: NpcId | null;
  place?: PlaceId | null;
  fact?: FactId | null;
  intent?: Intent;
  message?: string;
  why?: string;
  cites?: string[];
}

export interface ClaimRead {
  ref: string; // "new" or an existing belief claim id
  /** message id this claim came from (so its confidence is bounded by that sender's trust) */
  source?: string;
  statement: string;
  topic: string;
  says: Says;
  category: Category;
}

export interface Stance {
  claim: number; // index into claims
  verdict: "believe" | "doubt" | "disbelieve";
  confidence: number;
  why: string;
  cites: string[];
}

/** What Gemma (or the rule policy) returns for one decision, before validation. */
export interface DecisionOutput {
  understanding: string;
  claims: ClaimRead[];
  stances: Stance[];
  feeling: string; // an emoji plus a word
  thought: string;
  /** how they visibly react, from the acting library (presentation only; never changes the world) */
  act?: string;
  /** which line of their own card mainly drove this (their own reading, like `thought`); players discover cards from it */
  motive?: Motive;
  actions: ActionIntent[]; // at most 2, executed in order
}

export type Motive = "want" | "fear" | "bias" | "gossip" | "bottom" | "price" | "none";

export type EventType =
  | "seed"
  | "deliver" // a message reaches someone
  | "decide" // an NPC finished deciding
  | "belief"
  | "react" // visible emotional reaction
  | "move"
  | "arrive"
  | "talk"
  | "phone"
  | "look"
  | "inspect"
  | "state" // world state change
  | "notice"
  | "article"
  | "statement"
  | "gather"
  | "meet" // a routine meeting where something might be brought up
  | "rejected" // engine refused an intent
  | "milestone" // a festival preparation checkpoint (17:00–19:30), read from the world as it stands
  | "festival" // 20:00: how the lantern festival turned out
  | "end";

export interface SimEvent {
  id: string; // e1...
  t: Minutes;
  type: EventType;
  actor?: NpcId;
  target?: NpcId;
  place?: PlaceId;
  causes: string[]; // event ids
  data: Record<string, unknown>;
  /** one plain line for logs and the results screen */
  zh: string;
  /** wall-clock ms since the run started when the engine produced this event (for latency analysis) */
  w?: number;
}

export interface LlmRecord {
  /** "amd" (Token Factory) or "google" (AI Studio free tier, lab tests only) */
  provider?: string;
  /** streamed calls: ms until the first generated text arrived */
  ttftMs?: number;
  decision: string; // decision id
  npc: NpcId;
  stage: string; // "single" | "read" | "act"
  wallStartMs: number; // since run start
  wallEndMs: number;
  latencyMs: number;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  platformCost: number;
  estCost: number;
  status: number;
  error?: string;
  raw: string | null;
  promptChars: number;
}

export interface ValidationEntry {
  attempt: number;
  errors: string[];
  stage?: string;
  /** "model": the provider failed (not the model's fault); "validator": output rejected; "budget": planned cap */
  kind?: "model" | "validator" | "budget" | "ok" | "salvaged";
  /** harmless formatting corrections applied before checking (for transparency) */
  notes?: string[];
}

export interface DecisionRecord {
  id: string; // d1...
  npc: NpcId;
  t: Minutes; // game time it was taken
  triggers: string[]; // event ids
  inbox: string[]; // message ids considered
  policy: "gemma" | "rules";
  output: DecisionOutput | null;
  validation: ValidationEntry[];
  fallback: boolean; // validator gave up and the engine used a safe default
  llm: LlmRecord[];
  applied: string[]; // event ids that resulted
}
