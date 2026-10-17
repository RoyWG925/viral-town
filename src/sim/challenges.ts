// 今晚的小目標: small invitations in the spirit of Untitled Goose Game's to-do list, ticked only by events in
// the log. Pure: no model, no world, and nothing a resident can see, so the goals never steer the story.
// Detection is one pass in the order given, and each event is judged only by what came before it, so the
// played prefix (show.order.slice(0, show.i)) stamps a goal on the beat it plays, never earlier.
import { FACTS, PERSONAS, PLACES } from "./scenario.ts";
import { clockOf, topicFact } from "./view.ts";
import type { Claim, SimEvent } from "./types.ts";

export interface Challenge {
  id: string;
  icon: string;
  zh: string;
  hint: string;
  hidden?: boolean;
}

// Copy invites and never promises: hints say who has which public power (能/有機會), never what is hidden.
export const CHALLENGES: Challenge[] = [
  { id: "town", icon: "🗣️", zh: "讓一句話傳遍全鎮", hint: "要有 6 個人聽說；話多的阿德、電話簿最滿的美咲都有機會幫你傳開" },
  { id: "truth", icon: "🔍", zh: "讓假消息碰巧挖出真問題", hint: "編的也無妨，只要讓能親自檢查的人跑一趟；老周、小雯、志明都能查" },
  { id: "stage", icon: "🚧", zh: "讓舞台被封鎖", hint: "老周和志明都能封鎖舞台，但得先讓他們覺得真的有危險" },
  { id: "article", icon: "📰", zh: "讓小雯登上霧港小報", hint: "小雯能發文讓全鎮看到；她嗅覺靈敏，最愛追獨家" },
  { id: "police", icon: "🚓", zh: "讓警察出動", hint: "老周能派警力，但很難被陌生人說服" },
  { id: "strangers", icon: "🤝", zh: "讓兩個不相識的人當面說上話", hint: "有些人平常沒往來，也沒有對方的電話；得有件事讓其中一人親自登門" },
  { id: "shop", icon: "🔒", zh: "讓一家店暫停營業", hint: "阿德、美玲、美咲、阿珠都能關店，但得有比做生意更要緊的事", hidden: true },
  { id: "gather", icon: "✊", zh: "讓攤商聚集起來", hint: "阿珠能一聲號召攤商聚集；她對攤位費漲價很不滿", hidden: true },
  { id: "statement", icon: "📣", zh: "讓市長公開發表聲明", hint: "林市長能對全鎮發表聲明；他最在意自己的形象", hidden: true },
  { id: "cancel", icon: "🏮", zh: "讓燈籠節取消", hint: "只有林市長能取消燈籠節，偏偏他最在意燈籠節順利", hidden: true },
];

export interface ChallengeHit {
  id: string;
  eventId: string;
  t: number;
  /** one short line quoting the log, e.g. "17:10 老周封鎖了慶典舞台" */
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
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;
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
  return cut + (open("「", "」") ? "」" : "") + (open("〈", "〉") ? "〉" : "");
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
  town: (e, s) => (e.type === "deliver" && s.heard.size >= s.need ? line(e, `傳到第 ${s.heard.size} 人：${clip(e.zh, 22)}`) : null),
  truth: (e, s) => {
    const found = String(e.data.found ?? "");
    if ((e.type !== "inspect" && e.type !== "look") || !found || !s.planted.some(madeUp)) return null;
    const plantedFacts = new Set(s.planted.map(topicFact));
    const fact = FACTS.find((f) => f.value && f.check?.by === "expert" && !plantedFacts.has(f.id) && found.includes(f.check.zh));
    return fact && e.actor ? line(e, `${nameOf(e.actor)}在${placeZh(String(e.place))}查出：${clip(fact.check!.zh, 20)}`) : null;
  },
  stage: (e) => (e.type === "state" && e.data.key === "stage" && e.data.to === "closed" ? line(e, e.zh) : null),
  article: (e) => (e.type === "article" ? line(e, clip(e.zh, 26)) : null),
  police: (e) => (e.type === "state" && e.data.key === "police" ? line(e, e.zh) : null),
  // face to face only (strangers have no phone), and not the resident the player whispered to doing as told
  strangers: (e, s) =>
    e.type === "talk" && !e.data.missed && e.actor && e.target && !s.whispered.has(e.actor) && strangers(e.actor, e.target) ? line(e, clip(e.zh, 24)) : null,
  shop: (e) => (e.type === "state" && String(e.data.key ?? "").startsWith("shops.") && e.data.to === "closed" ? line(e, e.zh) : null),
  gather: (e) => (e.type === "gather" ? line(e, clip(e.zh, 26)) : null),
  statement: (e) => (e.type === "statement" && e.actor === "mayor" ? line(e, clip(e.zh, 26)) : null),
  cancel: (e) => (e.type === "state" && e.data.key === "festival" && e.data.to === "cancelled" ? line(e, clip(e.zh, 26)) : null),
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
