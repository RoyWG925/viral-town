// 今晚的小目標: small invitations in the spirit of Untitled Goose Game's to-do list, ticked only by events in
// the log. Pure: no model, no world, and nothing a resident can see, so the goals never steer the story.
// Detection is one pass in the order given, and each event is judged only by what came before it, so the
// played prefix (show.order.slice(0, show.i)) stamps a goal on the beat it plays, never earlier.
import { checkTexts } from "./festival.ts";
import { FACTS, PERSONAS } from "./scenario.ts";
import { clockOf, topicFact } from "./view.ts";
import type { Claim, SimEvent } from "./types.ts";

export interface Challenge {
  id: string;
  icon: string;
  zh: string;
  hint: string;
  hidden?: boolean;
}

// Copy invites and never promises: hints say who has which public power ("can", "might"), never what is hidden
// and never what "will" happen.
export const CHALLENGES: Challenge[] = [
  { id: "town", icon: "🗣️", zh: "Get one sentence all over town", hint: "Six people need to hear it; chatty Barney and Molly, who has the most regulars, can both help it spread" },
  { id: "truth", icon: "🔍", zh: "Let a made-up rumor dig up a real problem", hint: "It can be invented, as long as someone who can check things in person goes and looks; Chief Harlow, Penny and Gus can all check" },
  { id: "stage", icon: "🚧", zh: "Get the stage closed off", hint: "Chief Harlow and Gus can both close off the stage, but first they have to feel it's truly dangerous" },
  { id: "article", icon: "📰", zh: "Get Penny into The Mistport Gazette", hint: "Penny can publish a story the whole town sees; she has a sharp nose and loves a scoop" },
  { id: "police", icon: "🚓", zh: "Get the police called out", hint: "Chief Harlow can send officers, but a stranger has a hard time convincing him" },
  { id: "strangers", icon: "🤝", zh: "Get two people who don't know each other talking face to face", hint: "Some people never cross paths and don't have each other's number; something has to bring one of them to the other's door" },
  { id: "shop", icon: "🔒", zh: "Get a shop to close for the day", hint: "Barney, Daisy, Molly and Rosa can all close up shop, but only for something more pressing than business", hidden: true },
  { id: "gather", icon: "✊", zh: "Get the stall owners to gather", hint: "Rosa can rally the stall owners with one shout; she's fed up with the higher stall fee", hidden: true },
  { id: "statement", icon: "📣", zh: "Get the mayor to make a public statement", hint: "Mayor Higgins can address the whole town; he cares most about his image", hidden: true },
  { id: "cancel", icon: "🏮", zh: "Get the Lantern Festival cancelled", hint: "Only Mayor Higgins can cancel the Lantern Festival, and he cares most about it going smoothly", hidden: true },
];

export interface ChallengeHit {
  id: string;
  eventId: string;
  t: number;
  /** one short line quoting the log, e.g. "17:10 Chief Harlow closed off the festival stage" */
  evidence: string;
}

export interface ChallengeConfig {
  seedNpc: string;
  /** part of the shared run config; goals read only the log, never the player's wording */
  seedText: string;
  active?: string[];
  /** the run's claims (run.claims), for logs whose belief events do not carry their topic */
  claims?: Pick<Claim, "id" | "topic">[];
}

/** How many residents must have heard something for it to count as all over town. */
const TOWN_N = 6;

const nameOf = (id: string) => PERSONAS.find((p) => p.id === id)?.name ?? id;
const strangers = (a: string, b: string) => {
  const pa = PERSONAS.find((p) => p.id === a);
  const pb = PERSONAS.find((p) => p.id === b);
  return !!pa && !!pb && a !== b && !pa.relations[b] && !pb.relations[a];
};
// a topic with no true fact behind it: the fact is false, or the claim fits no known topic ("other")
const madeUp = (topic: string) => {
  const fact = topicFact(topic);
  return !fact || FACTS.find((f) => f.id === fact)?.value === false;
};

/** Cut a log line to n characters, closing a quote it cut open. */
function clip(text: string, n: number) {
  if (text.length <= n) return text;
  const cut = `${text.slice(0, n)}…`;
  const open = (a: string, b: string) => cut.split(a).length > cut.split(b).length;
  return cut + (open("「", "」") ? "」" : "") + (open("〈", "〉") ? "〉" : "") + (open("“", "”") ? "”" : "");
}
const line = (e: SimEvent, text: string) => `${clockOf(e.t)} ${text}`;

/** What the scan has seen so far: only events before the current one. */
interface Scan {
  seedNpc: string;
  need: number;
  /** residents the player whispered to (later whispers included, from the moment they happen) */
  whispered: Set<string>;
  /** whispered-to residents whose first reading of the whisper is still to come */
  waiting: Set<string>;
  /** decide events that read a whisper: the beliefs they formed are the planted claims */
  reading: Set<string>;
  /** topics of the planted claims */
  planted: string[];
  /** residents a message has reached */
  heard: Set<string>;
  topicOf: (e: SimEvent) => string | undefined;
}

function observe(e: SimEvent, s: Scan) {
  const d = e.data;
  if (e.type === "seed") {
    const who = e.target ?? (d.second ? undefined : s.seedNpc);
    if (who) (s.whispered.add(who), s.waiting.add(who));
  }
  // the listener's next real decision is their reading of the whisper (a capped "didn't think" reads nothing)
  if (e.type === "decide" && e.actor && s.waiting.has(e.actor)) {
    s.waiting.delete(e.actor);
    if (!d.budget) s.reading.add(e.id);
  }
  if (e.type === "belief" && e.causes.some((c) => s.reading.has(c))) {
    const topic = s.topicOf(e);
    if (topic) s.planted.push(topic);
  }
  // a routine meeting notice carries nothing, and an inspection is what they saw themselves
  if (e.type === "deliver" && e.target && d.via !== "inspection" && d.via !== "meet") s.heard.add(e.target);
}

type Detect = (e: SimEvent, s: Scan) => string | null;

const DETECT: Record<string, Detect> = {
  town: (e, s) => (e.type === "deliver" && s.heard.size >= s.need ? line(e, `Word reached ${s.heard.size} people: ${clip(e.zh, 38)}`) : null),
  truth: (e, s) => {
    const found = String(e.data.found ?? "");
    if ((e.type !== "inspect" && e.type !== "look") || !found || !s.planted.some(madeUp)) return null;
    const plantedFacts = new Set(s.planted.map(topicFact));
    // the check as it reads now, or as an older Chinese log wrote it
    const seen = (f: (typeof FACTS)[number]) => checkTexts(f).find((x) => found.includes(x));
    const fact = FACTS.find((f) => f.value && f.check?.by === "expert" && !plantedFacts.has(f.id) && seen(f));
    return fact && e.actor ? line(e, `${nameOf(e.actor)} found: ${clip(seen(fact)!, 36)}`) : null;
  },
  stage: (e) => (e.type === "state" && e.data.key === "stage" && e.data.to === "closed" ? line(e, clip(e.zh, 64)) : null),
  article: (e) => (e.type === "article" ? line(e, clip(e.zh, 44)) : null),
  police: (e) => (e.type === "state" && e.data.key === "police" ? line(e, clip(e.zh, 64)) : null),
  // face to face only (strangers have no phone), and not the resident the player whispered to doing as told
  strangers: (e, s) =>
    e.type === "talk" && !e.data.missed && e.actor && e.target && !s.whispered.has(e.actor) && strangers(e.actor, e.target) ? line(e, clip(e.zh, 40)) : null,
  shop: (e) => (e.type === "state" && String(e.data.key ?? "").startsWith("shops.") && e.data.to === "closed" ? line(e, clip(e.zh, 64)) : null),
  gather: (e) => (e.type === "gather" ? line(e, clip(e.zh, 44)) : null),
  statement: (e) => (e.type === "statement" && e.actor === "mayor" ? line(e, clip(e.zh, 44)) : null),
  cancel: (e) => (e.type === "state" && e.data.key === "festival" && e.data.to === "cancelled" ? line(e, clip(e.zh, 44)) : null),
};

/** The goals these events achieve, each with the first event that did it. Pass events in play order. */
export function challengesHit(events: SimEvent[], cfg: ChallengeConfig): ChallengeHit[] {
  const claimTopic = new Map((cfg.claims ?? []).map((c) => [c.id, c.topic]));
  const s: Scan = {
    seedNpc: cfg.seedNpc,
    need: Math.min(TOWN_N, cfg.active?.length || PERSONAS.length),
    // the first listener is known even if a log lacks the seed's target
    whispered: new Set([cfg.seedNpc]),
    waiting: new Set(),
    reading: new Set(),
    planted: [],
    heard: new Set(),
    topicOf: (e) => (typeof e.data.topic === "string" ? e.data.topic : claimTopic.get(String(e.data.claim))),
  };
  const hits: ChallengeHit[] = [];
  const done = new Set<string>();
  for (const e of events) {
    observe(e, s);
    for (const c of CHALLENGES) {
      const evidence = done.has(c.id) ? null : DETECT[c.id]?.(e, s);
      if (!evidence) continue;
      done.add(c.id);
      hits.push({ id: c.id, eventId: e.id, t: e.t, evidence });
    }
  }
  return hits;
}

// ---- progress across stories (the notebook remembers; localStorage lives in the UI) ----------------------

export const GOALS_STORAGE_KEY = "viral.goals.v1";

export interface GoalProgress {
  [id: string]: { at: string; headline?: string; recorded?: boolean };
}

/**
 * Stamp new hits into the notebook. A goal keeps its earliest stamp, except that one first seen only in a 📼
 * recorded replay is re-stamped the first time the player makes it happen in a story of their own.
 * Returns `prev` itself when nothing changed, so callers can skip saving.
 */
export function mergeProgress(prev: GoalProgress, hits: ChallengeHit[], meta: { at: string; headline?: string; recorded?: boolean }): GoalProgress {
  const entry = { at: meta.at, ...(meta.headline ? { headline: meta.headline } : {}), ...(meta.recorded ? { recorded: true } : {}) };
  let next: GoalProgress | null = null;
  for (const h of hits) {
    const old = (next ?? prev)[h.id];
    const better = !old || (old.recorded && !meta.recorded) || (!old.recorded === !meta.recorded && meta.at < old.at);
    if (!better) continue;
    next ??= { ...prev };
    next[h.id] = entry;
  }
  return next ?? prev;
}
