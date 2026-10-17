// "今晚行程": the fixed meetings in everyone's evening (scenario ROUTINE), read against what has already PLAYED.
// A meeting is worth a countdown only if one of the pair carries a played belief (≥0.3) of a kind that belongs in it —
// the same rule the engine uses to decide whether the meeting happens at all. It never says how it will go.
import type { RunResult } from "../sim/engine.ts";
import { PERSONAS, ROUTINE, TOPIC_CATEGORY } from "../sim/scenario.ts";
import type { SimEvent } from "../sim/types.ts";

const nameOf = (npc: string) => PERSONAS.find((p) => p.id === npc)?.name ?? npc;

// the plan, in plain words, with the residents' names from the scenario (falls back to the scenario's own line)
const PLAN: Record<string, (who: string, other: string) => string> = {
  "baker>cafe": (who, other) => `${who} is taking bread over to ${other} at the café`,
  "police>organizer": (who, other) => `${who} is heading to the stage for a walk-through with ${other}`,
  "journalist>mayor": (who, other) => `${who} is off to the town hall to interview ${other}`,
  "florist>organizer": (who, other) => `${who} is bringing the flower decorations to ${other} at the stage`,
  "vendor>mayor": (who) => `${who} is off to the town hall to pay the stall fee`,
};

const catOfTopic = (topic: string, fallback?: string) => TOPIC_CATEGORY[topic] ?? fallback;

/** The category of a played belief's claim: from the run's claims, else from the decision that stated it (streamed runs carry no claims yet). */
function beliefCategory(e: SimEvent, run: RunResult): string | undefined {
  // newer logs carry the claim's topic on the belief itself
  if (typeof e.data.topic === "string" && TOPIC_CATEGORY[e.data.topic]) return TOPIC_CATEGORY[e.data.topic];
  const cid = String(e.data.claim);
  const c = run.claims?.find((x) => x.id === cid);
  if (c) return catOfTopic(c.topic, c.category);
  // old (Chinese) logs: 「X對「…」的信心」; English logs quote the statement after "confidence"/"belief"
  const stmt = (/對「(.+?)」的信心/.exec(e.zh) ?? /(?:confidence|belief)[^“"]*[“"](.+?)[”"]/i.exec(e.zh))?.[1];
  if (!stmt) return undefined;
  for (const d of run.decisions) for (const r of d.output?.claims ?? []) if (r.statement === stmt) return catOfTopic(r.topic, r.category);
  return undefined;
}

/** Mirror of the engine's carried(): a played belief ≥0.3 whose category is in `about` (no `about` = any kind). */
function carries(npc: string, about: string[] | undefined, played: SimEvent[], run: RunResult): boolean {
  const latest = new Map<string, SimEvent>();
  for (const e of played) if (e.type === "belief" && e.actor === npc) latest.set(String(e.data.claim), e);
  return [...latest.values()].some((e) => {
    if (Number(e.data.to) < 0.3) return false;
    if (!about) return true;
    const cat = beliefCategory(e, run);
    return !!cat && about.includes(cat);
  });
}

const met = (played: SimEvent[], who: string, other: string) => played.some((e) => e.type === "meet" && e.actor === who && e.target === other);

export interface Upcoming {
  at: number;
  minutes: number;
  text: string;
}

/** The next meeting within `window` story minutes that someone is carrying something into, or null. */
export function upcomingMeeting(run: RunResult | null, played: SimEvent[], gameT: number, window = 15): Upcoming | null {
  if (!run) return null;
  const seedAt = played.find((e) => e.type === "seed")?.t ?? 0;
  const active = new Set(run.config.active);
  for (const r of ROUTINE) {
    const left = r.at - gameT;
    if (r.at <= seedAt || left <= 0 || left > window) continue;
    if (!active.has(r.who) || !active.has(r.with) || met(played, r.who, r.with)) continue;
    if (!carries(r.who, r.about, played, run) && !carries(r.with, r.about, played, run)) continue;
    return { at: r.at, minutes: Math.ceil(left), text: PLAN[`${r.who}>${r.with}`]?.(nameOf(r.who), nameOf(r.with)) ?? r.zh };
  }
  return null;
}

export interface MeetingTick {
  at: number;
  zh: string;
  state: "ahead" | "met" | "passed";
}

/** The evening's meetings for the timeline: still ahead, played, or gone by without coming up. */
export function meetingTicks(run: RunResult | null, played: SimEvent[], gameT: number, ended: boolean): MeetingTick[] {
  if (!run) return [];
  const seedAt = played.find((e) => e.type === "seed")?.t ?? 0;
  const active = new Set(run.config.active);
  return ROUTINE.filter((r) => r.at > seedAt && active.has(r.who) && active.has(r.with)).map((r) => ({
    at: r.at,
    zh: r.zh,
    // a meeting plays a few minutes after its hour (the walk there), so only call it passed well after
    state: met(played, r.who, r.with) ? "met" : ended || gameT > r.at + 20 ? "passed" : "ahead",
  }));
}
