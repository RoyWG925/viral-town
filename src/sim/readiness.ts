// 慶典準備度: eight meters the festival needs, and what the evening's validated events did to them. A pure function
// of the log — no model calls, the same log always gives the same 20:00 outcome. The meters are the game's rule for
// consequences (shown to players as words, never as numbers); people's choices stay Gemma's.
//
// Since the 2026-10-18 pass:
// - the town starts near the edge where its real problems are (the budget is already 30% over, the stage was never
//   inspected, stall owners are angry about the fee), so a sentence can tip it, while an untouched evening stays on;
// - word of mouth counts a little: a resident who believes a worrying claim AND passes it on moves the mood or the
//   crowd once (never belief alone, never twice for the same person, capped);
// - five preparation milestones (festival.ts) check the world at 17:00–19:30;
// - the 20:00 outcome is composed from what happened (no pigeons, stalls on strike, the mayor booed, a packed square…)
//   instead of four fixed sentences;
// - direction matters: a denial is not a scandal, believing "the lanterns are safe" is not a panic, a shop that
//   reopened is open.
import { FACTS, FESTIVAL_AT } from "./scenario.ts";
import { checkTexts, claimInfoOf, milestonesUpTo, snapshotAt, type Meter, type MilestoneResult } from "./festival.ts";
import type { SimEvent } from "./types.ts";

export type { Meter } from "./festival.ts";

export const METERS: { id: Meter; zh: string; label: string; start: number; short: string; why?: string }[] = [
  { id: "people", zh: "People", label: "Organizers and helpers", start: 70, short: "Not enough helpers, so the program was cut short" },
  { id: "supplies", zh: "Supplies", label: "Supplies", start: 75, short: "Not enough supplies" },
  { id: "money", zh: "Money", label: "Budget", start: 45, short: "Money trouble, so the closing fireworks are off", why: "The budget is actually already 30% over" },
  { id: "site", zh: "Site", label: "Site safety", start: 55, short: "The stage can't be used, so it moves to the open plaza", why: "The stage has never had a safety inspection" },
  { id: "mayor", zh: "Mayor", label: "The mayor's support", start: 70, short: "The mayor didn't show up for the opening" },
  { id: "mood", zh: "Mood", label: "Public mood", start: 60, short: "Townsfolk are grumbling and the mood is flat", why: "The stall fee doubled, and the stall owners are furious" },
  { id: "crowd", zh: "Crowd", label: "Turnout", start: 70, short: "Less than half the usual crowd" },
  { id: "time", zh: "Time", label: "Preparations", start: 60, short: "Not ready in time, so the opening slips half an hour" },
];
export const THRESHOLD = 35;

/** How the evening ended, beyond on/reduced/postponed/cancelled: each tag is something the 20:00 scene shows. */
export const TAGS: Record<string, { zh: string; prio: number; good?: boolean }> = {
  protest_rally: { zh: "The festival turned into a protest rally", prio: 1 },
  mayor_absent: { zh: "The mayor didn't show up for the opening", prio: 2 },
  mayor_booed: { zh: "Protest signs went up while the mayor gave his speech", prio: 3 },
  early_exit: { zh: "The crowd left early", prio: 4 },
  on_square: { zh: "The stage was closed off, so it moved to the open plaza", prio: 5 },
  no_pigeons: { zh: "No doves at the opening", prio: 6 },
  vendor_strike: { zh: "The stall owners went on strike, leaving half the plaza empty", prio: 7 },
  no_daughter: { zh: "One act was missing from the program", prio: 8 },
  no_fireworks: { zh: "The closing fireworks were called off", prio: 9 },
  thin_police: { zh: "Too few police", prio: 10 },
  thin_crowd: { zh: "Fewer people came than in past years", prio: 11 },
  uneasy: { zh: "The town was buzzing with gossip", prio: 12 },
  packed: { zh: "The rumors drew a huge crowd of curious onlookers, the biggest turnout ever", prio: 13, good: true },
};
/** a broken meter already says this tag in its own words */
const IMPLIED: Partial<Record<Meter, string>> = { site: "on_square", money: "no_fireworks", mayor: "mayor_absent", crowd: "thin_crowd" };

export interface Change {
  event: string;
  t: number;
  why: string;
  delta: Partial<Record<Meter, number>>;
}

export interface Readiness {
  meters: Record<Meter, number>;
  changes: Change[];
  milestones: MilestoneResult[];
  outcome: {
    kind: "on" | "reduced" | "postponed" | "cancelled";
    /** one line per meter that broke, most specific wording first */
    missing: string[];
    /** what the 20:00 scene shows, most important first (TAGS ids) */
    tags: string[];
    /** e.g. "Tonight's Lantern Festival: on as planned, but no doves at the opening and the town was buzzing with gossip." */
    text: string;
    short: string; // on / scaled down / postponed / cancelled
  };
}

const MONEY_TOPICS = new Set(["budget_overrun", "mayor_embezzled", "fee_covers_budget", "mayor_owes_baker"]);
const SAFETY_TOPICS = new Set(["stage_unsafe", "lanterns_flammable", "threat", "pigeons_sick", "oven_unsafe", "police_short"]);
const GOSSIP_TOPICS = new Set(["mayor_fears_pigeons", "birds_banned"]);
/** word of mouth: what a believed, retold claim does to the town (once per resident and kind, capped) */
const MOUTH: { topics: Set<string>; meter: Meter; per: number; cap: number; why: string }[] = [
  { topics: SAFETY_TOPICS, meter: "crowd", per: -3, cap: -12, why: "Talk that something might go wrong spread, and some people plan to stay home" },
  { topics: new Set([...MONEY_TOPICS, "birds_banned"]), meter: "mood", per: -3, cap: -12, why: "Grumbling about the town hall spread around town" },
  { topics: new Set(["mayor_fears_pigeons"]), meter: "crowd", per: 3, cap: 12, why: "“The mayor is scared of pigeons” made more people want to see the opening" },
];
// what an inspection of the stage finds: the fact's check as it reads now, and as the older Chinese logs wrote it
const STAGE_DEFECTS = checkTexts(FACTS.find((f) => f.id === "stage_uninspected") ?? { id: "stage_uninspected" });

/**
 * `claims` (run.claims) gives older logs the topic and direction of each claim; newer belief events carry them.
 * `upTo` (game minutes) limits the milestones to those already reached, for the live "燈籠節不妙" clock; the 20:00
 * tags only exist once the evening has reached the festival (or for a finished log, by default).
 */
export function readinessOf(events: SimEvent[], claims: { id: string; topic: string; says?: string }[] = [], upTo = Infinity): Readiness {
  const changes: Change[] = [];
  const add = (e: { id: string; t: number }, why: string, delta: Change["delta"]) => changes.push({ event: e.id, t: e.t, why, delta });
  const info = claimInfoOf(events, claims);
  const says = (claim: string) => info.get(claim)?.says ?? "yes";
  const topicOf = (claim: string) => info.get(claim)?.topic ?? "";
  const holders = new Map<string, Set<string>>(); // safety topic → residents holding "yes" at ≥0.3
  // `${resident}|${claim}` → their latest stance: they said they believe it (the engine may cap hearsay below 0.5)
  const stance = new Map<string, { conf: number; believes: boolean }>();
  const told = new Set<string>(); // `${resident}|${mouth index}`: word of mouth counted once per person and kind
  const mouthSum = MOUTH.map(() => 0);
  let defectSeen = false;
  let alarmRaised = false;
  let cancelled = false;
  let gathered = false;
  let lastT = 0;

  for (const e of events) {
    if (e.t > upTo + 1e-9) continue;
    lastT = Math.max(lastT, e.t);
    const d = e.data as Record<string, unknown>;
    if (e.type === "belief") {
      const claim = String(d.claim);
      const topic = topicOf(claim);
      if (e.actor) stance.set(`${e.actor}|${claim}`, { conf: Number(d.to), believes: d.verdict === "believe" ? Number(d.to) >= 0.35 : Number(d.to) >= 0.5 });
      if (SAFETY_TOPICS.has(topic) && says(claim) === "yes" && Number(d.to) >= 0.3 && e.actor) {
        if (!holders.has(topic)) holders.set(topic, new Set());
        holders.get(topic)!.add(e.actor);
        if (!alarmRaised && holders.get(topic)!.size >= 6) {
          alarmRaised = true;
          add(e, "Safety rumors spread all over town", { crowd: -20, mood: -10 });
        }
      }
    } else if ((e.type === "talk" || (e.type === "phone" && !d.missed)) && e.actor) {
      // a resident who believes something worrying and passes it on moves the town a little
      for (const claim of (d.claims as string[] | undefined) ?? []) {
        if (says(claim) !== "yes" || !stance.get(`${e.actor}|${claim}`)?.believes) continue;
        MOUTH.forEach((w, i) => {
          const key = `${e.actor}|${i}`;
          if (!w.topics.has(topicOf(claim)) || told.has(key) || Math.abs(mouthSum[i]) >= Math.abs(w.cap)) return;
          told.add(key);
          mouthSum[i] += w.per;
          add(e, w.why, { [w.meter]: w.per });
        });
      }
    } else if ((e.type === "inspect" || e.type === "look") && d.found && !defectSeen && STAGE_DEFECTS.some((x) => String(d.found).includes(x))) {
      defectSeen = true;
      add(e, "Someone saw for themselves that the stage's supports are faulty", { site: -20 });
    } else if (e.type === "state") {
      const key = String(d.key);
      if (key === "stage" && d.to === "closed") add(e, "The stage was closed off", { site: -35, time: -25, people: -15, crowd: -15 });
      else if (key === "police") add(e, "The police were called out", { crowd: -15, time: -10 });
      else if (key === "festival" && d.to === "cancelled") cancelled = true;
    } else if (e.type === "article") {
      // what the article is about decides what it does: a scandal, a scare, gossip, a denial — or nothing at all
      // (a piece about cheap fish at the harbour does not touch the festival)
      const cited = ((d.claims as string[] | undefined) ?? []).filter((c) => topicOf(c) && topicOf(c) !== "other");
      const yes = (set: Set<string>) => cited.some((c) => set.has(topicOf(c)) && says(c) === "yes");
      if (yes(MONEY_TOPICS)) add(e, "A money scandal made the news", { money: -25, mayor: -25, mood: -20 });
      else if (yes(SAFETY_TOPICS)) add(e, "Safety worries made the news", { mood: -15, crowd: -10 });
      else if (yes(GOSSIP_TOPICS)) add(e, "A gossip piece made more people want to see the opening", { crowd: 5, mayor: -5 });
      else if (cited.length && cited.every((c) => says(c) === "no")) add(e, "An article debunking the rumor got around", { mood: -5 });
    } else if (e.type === "statement" && e.actor === "mayor") add(e, "The mayor had to come out and set the record straight", { mayor: -10 });
    else if (e.type === "gather") {
      gathered = true;
      add(e, "Stall owners gathered in protest", { mood: -15, supplies: -15, time: -10, ...(e.place === "townhall" ? { mayor: -10 } : {}) });
    } else if (e.type === "notice" && e.actor === "organizer") add(e, "Gus put up a reassuring notice", { mood: 10, crowd: 10 });
  }

  // shops count as they stand now: one that closed and reopened is open
  const evalAt = Number.isFinite(upTo) ? upTo : Math.max(lastT, FESTIVAL_AT);
  const now = snapshotAt(events, info, evalAt);
  for (const [shop, ev] of now.closed) {
    const e = events.find((x) => x.id === ev)!;
    if (shop === "flower") add(e, "The flower shop closed", { supplies: -10 });
    else if (shop === "bakery") add(e, "The bakery closed", { supplies: -20 });
    else add(e, "A shop closed", { supplies: -10 });
  }

  const milestones = milestonesUpTo(events, info, upTo);
  for (const m of milestones) if (Object.keys(m.delta).length) changes.push({ event: m.causes[0] ?? "", t: m.at, why: `${m.zh}: ${m.text}`, delta: m.delta });

  const meters = Object.fromEntries(METERS.map((m) => [m.id, m.start])) as Record<Meter, number>;
  for (const c of changes) for (const [k, v] of Object.entries(c.delta)) meters[k as Meter] = Math.max(0, Math.min(100, meters[k as Meter] + (v ?? 0)));

  const broken = METERS.filter((m) => meters[m.id] < THRESHOLD);
  const missing = broken.map((m) => {
    if (m.id !== "supplies") return m.short;
    const what = [now.closed.has("flower") && "flower decorations", now.closed.has("bakery") && "pastries"].filter(Boolean);
    return what.length ? `No ${what.join(" or ")}` : m.short;
  });
  let kind: Readiness["outcome"]["kind"] = "on";
  if (cancelled) kind = "cancelled";
  else if (meters.site < THRESHOLD && (meters.people < THRESHOLD || meters.time < THRESHOLD)) kind = "postponed";
  else if (broken.length) kind = "reduced";

  // what the 20:00 scene shows
  const tags = new Set<string>(milestones.map((m) => m.tag).filter(Boolean) as string[]);
  for (const m of broken) if (IMPLIED[m.id]) tags.add(IMPLIED[m.id]!);
  const atFestival = !Number.isFinite(upTo) || upTo >= FESTIVAL_AT;
  if (atFestival && kind !== "cancelled") {
    const policeHere = now.police && (now.police.place === "stage" || now.police.place === "plaza");
    if (gathered && meters.mood < THRESHOLD) tags.add("protest_rally");
    else if (gathered && meters.mayor >= THRESHOLD) tags.add("mayor_booed");
    if (alarmRaised && !policeHere) tags.add("early_exit");
    if (meters.crowd >= THRESHOLD && meters.crowd < 60) tags.add("thin_crowd");
    if (meters.mood >= THRESHOLD && meters.mood < 52) tags.add("uneasy");
    if (meters.crowd >= 76 && kind === "on") tags.add("packed");
  }
  const ordered = [...tags].sort((a, b) => TAGS[a].prio - TAGS[b].prio);
  const said = new Set(broken.map((m) => IMPLIED[m.id]).filter(Boolean));
  const extra = ordered.filter((t) => !said.has(t)).map((t) => TAGS[t].zh);
  const short = { on: "on", reduced: "scaled down", postponed: "postponed", cancelled: "cancelled" }[kind];
  // each line reads on its own ("No doves at the opening"); inside the sentence it starts small
  const lines = [...missing, ...extra].slice(0, 3).map((l) => l.charAt(0).toLowerCase() + l.slice(1));
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  const text =
    kind === "cancelled"
      ? "Tonight's Lantern Festival: cancelled."
      : kind === "postponed"
        ? `Tonight's Lantern Festival: postponed — ${lines.join("; ")}.`
        : kind === "reduced"
          ? `Tonight's Lantern Festival: scaled down — ${lines.join("; ")}.`
          : lines.length
            ? ordered.every((t) => TAGS[t].good)
              ? `Tonight's Lantern Festival: on as planned, and ${lines.join("; ")}.`
              : `Tonight's Lantern Festival: on as planned, but ${and(lines)}.`
            : "Tonight's Lantern Festival: on as planned.";
  return { meters, changes, milestones, outcome: { kind, missing, tags: ordered, text, short } };
}
