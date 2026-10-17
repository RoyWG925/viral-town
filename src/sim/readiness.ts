// 慶典準備度: eight meters the festival needs, and what the evening's validated events did to them. A pure function
// of the log — no model calls, the same log always gives the same 20:00 outcome. The meters are the game's rule for
// consequences (shown to players as words, never as numbers); people's choices stay Gemma's.
import { FACTS } from "./scenario.ts";
import type { SimEvent } from "./types.ts";

export type Meter = "people" | "supplies" | "money" | "site" | "mayor" | "mood" | "crowd" | "time";

export const METERS: { id: Meter; zh: string; label: string; start: number; short: string }[] = [
  { id: "people", zh: "人", label: "主辦與人手", start: 70, short: "人手不夠，節目縮短了" },
  { id: "supplies", zh: "物", label: "物資", start: 75, short: "物資不夠" },
  { id: "money", zh: "錢", label: "經費", start: 50, short: "經費出了問題，壓軸煙火取消" },
  { id: "site", zh: "地", label: "場地安全", start: 60, short: "舞台不能用，改在廣場空地舉行" },
  { id: "mayor", zh: "名", label: "市長的支持", start: 70, short: "市長沒有出席開場" },
  { id: "mood", zh: "心", label: "民意", start: 65, short: "鎮民議論紛紛，氣氛冷清" },
  { id: "crowd", zh: "眾", label: "出席意願", start: 70, short: "人潮不到往年一半" },
  { id: "time", zh: "時", label: "準備進度", start: 60, short: "準備不及，延後半小時開場" },
];
export const THRESHOLD = 35;

export interface Change {
  event: string;
  t: number;
  why: string;
  delta: Partial<Record<Meter, number>>;
}

export interface Readiness {
  meters: Record<Meter, number>;
  changes: Change[];
  outcome: {
    kind: "on" | "reduced" | "postponed" | "cancelled";
    /** one zh line per meter that broke, most specific wording first */
    missing: string[];
    /** e.g. 「今晚的燈籠節：縮水舉行——沒有花飾和白鴿，舞台不能用，改在廣場空地舉行。」 */
    text: string;
    short: string; // 照常 / 縮水 / 延後 / 取消
  };
}

const MONEY_TOPICS = new Set(["budget_overrun", "mayor_embezzled", "fee_covers_budget", "mayor_owes_baker"]);
const SAFETY_TOPICS = new Set(["stage_unsafe", "lanterns_flammable", "threat", "pigeons_sick", "oven_unsafe", "police_short"]);
const STAGE_DEFECT = FACTS.find((f) => f.id === "stage_uninspected")?.check?.zh ?? "\u0000";

/** `claims` (run.claims) maps claim ids to topics for logs written before belief events carried their topic. */
export function readinessOf(events: SimEvent[], claims: { id: string; topic: string }[] = []): Readiness {
  const changes: Change[] = [];
  const add = (e: SimEvent, why: string, delta: Change["delta"]) => changes.push({ event: e.id, t: e.t, why, delta });
  const claimTopic = new Map<string, string>(claims.map((c) => [c.id, c.topic])); // claim id → topic
  const holders = new Map<string, Set<string>>(); // safety topic → residents holding it at ≥0.3
  let defectSeen = false;
  let alarmRaised = false;
  const closed = new Set<string>();
  let cancelled = false;

  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    if (e.type === "belief") {
      const topic = String(d.topic ?? "");
      if (topic) claimTopic.set(String(d.claim), topic);
      if (SAFETY_TOPICS.has(topic) && Number(d.to) >= 0.3 && e.actor) {
        if (!holders.has(topic)) holders.set(topic, new Set());
        holders.get(topic)!.add(e.actor);
        if (!alarmRaised && holders.get(topic)!.size >= 6) {
          alarmRaised = true;
          add(e, "安全謠言傳遍了全鎮", { crowd: -20, mood: -10 });
        }
      }
    } else if ((e.type === "inspect" || e.type === "look") && d.found && !defectSeen && String(d.found).includes(STAGE_DEFECT)) {
      defectSeen = true;
      add(e, "有人親眼證實舞台的支架有問題", { site: -20 });
    } else if (e.type === "state") {
      const key = String(d.key);
      if (key === "stage" && d.to === "closed") add(e, "舞台被封鎖", { site: -35, time: -25, people: -15, crowd: -15 });
      else if (key === "police") add(e, "警察出動", { crowd: -15, time: -10 });
      else if (key === "festival" && d.to === "cancelled") cancelled = true;
      else if (key.startsWith("shops.") && d.to === "closed" && !closed.has(key)) {
        closed.add(key);
        const shop = key.slice(6);
        if (shop === "flower") add(e, "花店關門", { supplies: -25 });
        else if (shop === "bakery") add(e, "麵包店關門", { supplies: -20 });
        else add(e, "店家關門", { supplies: -10 });
      }
    } else if (e.type === "article") {
      const topics = ((d.claims as string[] | undefined) ?? []).map((c) => claimTopic.get(c) ?? "");
      if (topics.some((t) => MONEY_TOPICS.has(t))) add(e, "經費醜聞上了新聞", { money: -25, mayor: -25, mood: -20 });
      else add(e, "爆料文章傳開了", { mood: -15, crowd: -10 });
    } else if (e.type === "statement" && e.actor === "mayor") add(e, "市長被迫出面澄清", { mayor: -10 });
    else if (e.type === "gather") add(e, "攤商聚集抗議", { mood: -15, supplies: -15, time: -10, ...(e.place === "townhall" ? { mayor: -10 } : {}) });
    else if (e.type === "notice" && e.actor === "organizer") add(e, "志明貼出安撫公告", { mood: 10, crowd: 10 });
  }

  const meters = Object.fromEntries(METERS.map((m) => [m.id, m.start])) as Record<Meter, number>;
  for (const c of changes) for (const [k, v] of Object.entries(c.delta)) meters[k as Meter] = Math.max(0, Math.min(100, meters[k as Meter] + (v ?? 0)));

  const broken = METERS.filter((m) => meters[m.id] < THRESHOLD);
  const missing = broken.map((m) => {
    if (m.id !== "supplies") return m.short;
    const what = [closed.has("shops.flower") && "沒有花飾和白鴿", closed.has("shops.bakery") && "沒有點心"].filter(Boolean);
    return what.length ? what.join("、") : m.short;
  });
  let kind: Readiness["outcome"]["kind"] = "on";
  if (cancelled) kind = "cancelled";
  else if (meters.site < THRESHOLD && (meters.people < THRESHOLD || meters.time < THRESHOLD)) kind = "postponed";
  else if (broken.length) kind = "reduced";
  const short = { on: "照常", reduced: "縮水", postponed: "延後", cancelled: "取消" }[kind];
  const text =
    kind === "cancelled"
      ? "今晚的燈籠節：取消了。"
      : kind === "postponed"
        ? `今晚的燈籠節：延後舉行——${missing.join("，")}。`
        : kind === "reduced"
          ? `今晚的燈籠節：縮水舉行——${missing.join("，")}。`
          : "今晚的燈籠節：照常舉行。";
  return { meters, changes, outcome: { kind, missing, text, short } };
}
