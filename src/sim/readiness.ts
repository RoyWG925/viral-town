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
import { claimInfoOf, milestonesUpTo, snapshotAt, type Meter, type MilestoneResult } from "./festival.ts";
import type { SimEvent } from "./types.ts";

export type { Meter } from "./festival.ts";

export const METERS: { id: Meter; zh: string; label: string; start: number; short: string; why?: string }[] = [
  { id: "people", zh: "人", label: "主辦與人手", start: 70, short: "人手不夠，節目縮短了" },
  { id: "supplies", zh: "物", label: "物資", start: 75, short: "物資不夠" },
  { id: "money", zh: "錢", label: "經費", start: 45, short: "經費出了問題，壓軸煙火取消", why: "預算其實已經超支三成" },
  { id: "site", zh: "地", label: "場地安全", start: 55, short: "舞台不能用，改在廣場空地舉行", why: "舞台從來沒做過安全檢查" },
  { id: "mayor", zh: "名", label: "市長的支持", start: 70, short: "市長沒有出席開場" },
  { id: "mood", zh: "心", label: "民意", start: 60, short: "鎮民議論紛紛，氣氛冷清", why: "攤位費漲了一倍，攤商一肚子火" },
  { id: "crowd", zh: "眾", label: "出席意願", start: 70, short: "人潮不到往年一半" },
  { id: "time", zh: "時", label: "準備進度", start: 60, short: "準備不及，延後半小時開場" },
];
export const THRESHOLD = 35;

/** How the evening ended, beyond on/reduced/postponed/cancelled: each tag is something the 20:00 scene shows. */
export const TAGS: Record<string, { zh: string; prio: number; good?: boolean }> = {
  protest_rally: { zh: "慶典變成了抗議集會", prio: 1 },
  mayor_absent: { zh: "市長沒有出席開場", prio: 2 },
  mayor_booed: { zh: "市長致詞時，台下有人舉牌抗議", prio: 3 },
  early_exit: { zh: "人潮提早散場", prio: 4 },
  on_square: { zh: "舞台封鎖，改在廣場空地舉行", prio: 5 },
  no_pigeons: { zh: "開場沒有白鴿", prio: 6 },
  vendor_strike: { zh: "攤商罷市，廣場空了一半", prio: 7 },
  no_daughter: { zh: "少了一個表演節目", prio: 8 },
  no_fireworks: { zh: "壓軸煙火取消", prio: 9 },
  thin_police: { zh: "警力不足", prio: 10 },
  thin_crowd: { zh: "來的人比往年少", prio: 11 },
  uneasy: { zh: "鎮上議論紛紛", prio: 12 },
  packed: { zh: "傳言引來大批看熱鬧的人，盛況空前", prio: 13, good: true },
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
    /** one zh line per meter that broke, most specific wording first */
    missing: string[];
    /** what the 20:00 scene shows, most important first (TAGS ids) */
    tags: string[];
    /** e.g. 「今晚的燈籠節：照常舉行，但開場沒有白鴿、現場有點冷清。」 */
    text: string;
    short: string; // 照常 / 縮水 / 延後 / 取消
  };
}

const MONEY_TOPICS = new Set(["budget_overrun", "mayor_embezzled", "fee_covers_budget", "mayor_owes_baker"]);
const SAFETY_TOPICS = new Set(["stage_unsafe", "lanterns_flammable", "threat", "pigeons_sick", "oven_unsafe", "police_short"]);
const GOSSIP_TOPICS = new Set(["mayor_fears_pigeons", "birds_banned"]);
/** word of mouth: what a believed, retold claim does to the town (once per resident and kind, capped) */
const MOUTH: { topics: Set<string>; meter: Meter; per: number; cap: number; why: string }[] = [
  { topics: SAFETY_TOPICS, meter: "crowd", per: -3, cap: -12, why: "怕出事的傳言在鎮上傳開，有人打算不去了" },
  { topics: new Set([...MONEY_TOPICS, "birds_banned"]), meter: "mood", per: -3, cap: -12, why: "對鎮公所的不滿在鎮上傳開" },
  { topics: new Set(["mayor_fears_pigeons"]), meter: "crowd", per: 3, cap: 12, why: "「市長怕鴿子」讓更多人想來看開場" },
];
const STAGE_DEFECT = FACTS.find((f) => f.id === "stage_uninspected")?.check?.zh ?? "\u0000";

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
          add(e, "安全謠言傳遍了全鎮", { crowd: -20, mood: -10 });
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
    } else if ((e.type === "inspect" || e.type === "look") && d.found && !defectSeen && String(d.found).includes(STAGE_DEFECT)) {
      defectSeen = true;
      add(e, "有人親眼證實舞台的支架有問題", { site: -20 });
    } else if (e.type === "state") {
      const key = String(d.key);
      if (key === "stage" && d.to === "closed") add(e, "舞台被封鎖", { site: -35, time: -25, people: -15, crowd: -15 });
      else if (key === "police") add(e, "警察出動", { crowd: -15, time: -10 });
      else if (key === "festival" && d.to === "cancelled") cancelled = true;
    } else if (e.type === "article") {
      // what the article is about decides what it does: a scandal, a scare, gossip, a denial — or nothing at all
      // (a piece about cheap fish at the harbour does not touch the festival)
      const cited = ((d.claims as string[] | undefined) ?? []).filter((c) => topicOf(c) && topicOf(c) !== "other");
      const yes = (set: Set<string>) => cited.some((c) => set.has(topicOf(c)) && says(c) === "yes");
      if (yes(MONEY_TOPICS)) add(e, "經費醜聞上了新聞", { money: -25, mayor: -25, mood: -20 });
      else if (yes(SAFETY_TOPICS)) add(e, "安全疑慮上了新聞", { mood: -15, crowd: -10 });
      else if (yes(GOSSIP_TOPICS)) add(e, "八卦文章讓更多人想來看開場", { crowd: 5, mayor: -5 });
      else if (cited.length && cited.every((c) => says(c) === "no")) add(e, "一篇闢謠的文章傳開了", { mood: -5 });
    } else if (e.type === "statement" && e.actor === "mayor") add(e, "市長被迫出面澄清", { mayor: -10 });
    else if (e.type === "gather") {
      gathered = true;
      add(e, "攤商聚集抗議", { mood: -15, supplies: -15, time: -10, ...(e.place === "townhall" ? { mayor: -10 } : {}) });
    } else if (e.type === "notice" && e.actor === "organizer") add(e, "志明貼出安撫公告", { mood: 10, crowd: 10 });
  }

  // shops count as they stand now: one that closed and reopened is open
  const evalAt = Number.isFinite(upTo) ? upTo : Math.max(lastT, FESTIVAL_AT);
  const now = snapshotAt(events, info, evalAt);
  for (const [shop, ev] of now.closed) {
    const e = events.find((x) => x.id === ev)!;
    if (shop === "flower") add(e, "花店關門", { supplies: -10 });
    else if (shop === "bakery") add(e, "麵包店關門", { supplies: -20 });
    else add(e, "店家關門", { supplies: -10 });
  }

  const milestones = milestonesUpTo(events, info, upTo);
  for (const m of milestones) if (Object.keys(m.delta).length) changes.push({ event: m.causes[0] ?? "", t: m.at, why: `${m.zh}：${m.text}`, delta: m.delta });

  const meters = Object.fromEntries(METERS.map((m) => [m.id, m.start])) as Record<Meter, number>;
  for (const c of changes) for (const [k, v] of Object.entries(c.delta)) meters[k as Meter] = Math.max(0, Math.min(100, meters[k as Meter] + (v ?? 0)));

  const broken = METERS.filter((m) => meters[m.id] < THRESHOLD);
  const missing = broken.map((m) => {
    if (m.id !== "supplies") return m.short;
    const what = [now.closed.has("flower") && "沒有花飾", now.closed.has("bakery") && "沒有點心"].filter(Boolean);
    return what.length ? what.join("、") : m.short;
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
  const short = { on: "照常", reduced: "縮水", postponed: "延後", cancelled: "取消" }[kind];
  const lines = [...missing, ...extra].slice(0, 3);
  const text =
    kind === "cancelled"
      ? "今晚的燈籠節：取消了。"
      : kind === "postponed"
        ? `今晚的燈籠節：延後舉行——${lines.join("，")}。`
        : kind === "reduced"
          ? `今晚的燈籠節：縮水舉行——${lines.join("，")}。`
          : lines.length
            ? ordered.every((t) => TAGS[t].good)
              ? `今晚的燈籠節：照常舉行，${lines.join("，")}。`
              : `今晚的燈籠節：照常舉行，但${lines.join("、")}。`
            : "今晚的燈籠節：照常舉行。";
  return { meters, changes, milestones, outcome: { kind, missing, tags: ordered, text, short } };
}
