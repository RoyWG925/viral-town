// 慶典準備的里程碑：17:00 到 19:30 五個固定時間點，檢查當下的世界狀態（舞台、店家、攤商、警力、居民的底線），
// 決定這一關順不順。純函式：只讀已驗證的事件紀錄，不呼叫模型，也不替任何居民做新決定——只看他們已經做了什麼、
// 已經相信什麼。引擎在那個時間點把結果記成事件，結局量表（readiness.ts）也用同一個函式，所以兩邊永遠一致。
import { PLACES } from "./scenario.ts";
import type { SimEvent } from "./types.ts";

export type MilestoneId = "stage_check" | "pigeons" | "vendors" | "police" | "rehearsal";
export type Meter = "people" | "supplies" | "money" | "site" | "mayor" | "mood" | "crowd" | "time";

export const MILESTONES: { id: MilestoneId; at: number; zh: string }[] = [
  { id: "stage_check", at: 120, zh: "17:00 Stage walk-through" },
  { id: "pigeons", at: 180, zh: "18:00 Doves delivered to the stage" },
  { id: "vendors", at: 210, zh: "18:30 Stall owners set up" },
  { id: "police", at: 240, zh: "19:00 Police take their posts" },
  { id: "rehearsal", at: 270, zh: "19:30 Opening rehearsal" },
];

/**
 * What a look or an inspection found, in the words the older Chinese logs (lab/runs, public/recorded) used for each
 * fact's check. The facts now speak English; these keep those logs reading the same (the stage defect for the 20:00
 * meters, the hidden problems for tonight's goals).
 */
export const LEGACY_CHECK_ZH: Record<string, string> = {
  pigeons: "舞台旁邊堆著二十個鴿籠，裡面的白鴿看起來很健康。",
  pigeons_sick: "鴿籠裡的白鴿羽毛乾淨、精神很好，看不出生病的樣子。",
  stage_uninspected: "舞台沒有任何安全檢查紀錄，左後方的一根支架明顯鬆動。",
  lanterns_unsafe: "燈籠上貼著防火材質的合格標籤。",
  budget_overrun: "公開的慶典收支表上，實際支出比原本的預算多了三成。",
  oven_expired: "烤箱的安全檢查貼紙日期是兩個月前，已經過期。",
};

/** Every wording of a fact's check that a log may contain: the current one first, then the older Chinese one. */
export function checkTexts(f: { id: string; check?: { zh: string } }): string[] {
  return [...new Set([f.check?.zh, LEGACY_CHECK_ZH[f.id]].filter((x): x is string => !!x))];
}

export interface MilestoneResult {
  id: MilestoneId;
  at: number;
  zh: string;
  /** ok: as planned; moved: happens, but somewhere else or differently; failed: did not happen */
  status: "ok" | "moved" | "failed";
  text: string;
  /** the logged events that decided it (empty when nothing changed the plan) */
  causes: string[];
  delta: Partial<Record<Meter, number>>;
  tag?: string;
}

type ClaimInfo = { topic: string; says: string };
interface Snapshot {
  festivalCancelled: string | null;
  stageClosed: string | null;
  /** shop → the event that closed it, while it is still closed */
  closed: Map<string, string>;
  police: { place: string; ev: string } | null;
  gathers: { place: string; ev: string; actor?: string }[];
  /** resident → claim → latest belief */
  beliefs: Map<string, Map<string, { conf: number; ev: string }>>;
  info: Map<string, ClaimInfo>;
}

/** Topic and direction of every claim: from belief events (live logs carry them) and from run.claims (older logs). */
export function claimInfoOf(events: SimEvent[], claims: { id: string; topic: string; says?: string }[] = []): Map<string, ClaimInfo> {
  const info = new Map<string, ClaimInfo>(claims.map((c) => [c.id, { topic: c.topic, says: c.says ?? "yes" }]));
  for (const e of events) {
    if (e.type !== "belief") continue;
    const id = String(e.data.claim);
    const known = info.get(id);
    const topic = String(e.data.topic ?? known?.topic ?? "");
    if (topic) info.set(id, { topic, says: String(e.data.says ?? known?.says ?? "yes") });
  }
  return info;
}

/** The world as the log stands at minute t (inclusive). */
export function snapshotAt(events: SimEvent[], info: Map<string, ClaimInfo>, t: number): Snapshot {
  const s: Snapshot = { festivalCancelled: null, stageClosed: null, closed: new Map(), police: null, gathers: [], beliefs: new Map(), info };
  for (const e of events) {
    // the log is in processing order, not strictly by time (a reaction is stamped a beat later): skip, don't stop
    if (e.t > t + 1e-9) continue;
    const d = e.data as Record<string, unknown>;
    if (e.type === "state") {
      const key = String(d.key);
      if (key === "festival" && d.to === "cancelled") s.festivalCancelled = e.id;
      else if (key === "stage" && d.to === "closed") s.stageClosed = e.id;
      else if (key === "police") s.police = { place: String(d.to), ev: e.id };
      else if (key.startsWith("shops.")) {
        if (d.to === "closed") s.closed.set(key.slice(6), e.id);
        else s.closed.delete(key.slice(6));
      }
    } else if (e.type === "gather") s.gathers.push({ place: String(e.place ?? ""), ev: e.id, actor: e.actor });
    else if (e.type === "belief" && e.actor) {
      if (!s.beliefs.has(e.actor)) s.beliefs.set(e.actor, new Map());
      s.beliefs.get(e.actor)!.set(String(d.claim), { conf: Number(d.to), ev: e.id });
    }
  }
  return s;
}

const DANGER_TO_PIGEONS = new Set(["pigeons_sick", "stage_unsafe", "lanterns_flammable", "threat"]);
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;

/** The strongest belief this resident holds (≥ min) that says "yes" to one of these topics. */
function believes(s: Snapshot, npc: string, topics: Set<string>, min: number): { conf: number; ev: string } | null {
  let best: { conf: number; ev: string } | null = null;
  for (const [claim, b] of s.beliefs.get(npc) ?? []) {
    const c = s.info.get(claim);
    if (!c || c.says !== "yes" || !topics.has(c.topic) || b.conf < min) continue;
    if (!best || b.conf > best.conf) best = b;
  }
  return best;
}

export function milestoneOf(id: MilestoneId, events: SimEvent[], info: Map<string, ClaimInfo>): MilestoneResult {
  const m = MILESTONES.find((x) => x.id === id)!;
  const s = snapshotAt(events, info, m.at);
  const r = (status: MilestoneResult["status"], text: string, causes: string[] = [], delta: MilestoneResult["delta"] = {}, tag?: string): MilestoneResult => ({ id, at: m.at, zh: m.zh, status, text, causes, delta, tag });
  if (s.festivalCancelled) return r("failed", "The Lantern Festival has already been cancelled", [s.festivalCancelled]);
  switch (id) {
    case "stage_check":
      if (s.stageClosed) return r("moved", "The stage is taped off, so the show moves to the open plaza", [s.stageClosed], {}, "on_square");
      return r("ok", "Walk-through done; the stage is good to go");
    case "pigeons": {
      const shut = s.closed.get("flower");
      if (shut) return r("failed", "Daisy's Flowers is closed, so the doves never arrived", [shut], { supplies: -15 }, "no_pigeons");
      // her own worry about danger, already in the log: she keeps the birds back (no new decision is made for her)
      const fear = believes(s, "florist", DANGER_TO_PIGEONS, 0.6);
      if (fear) return r("failed", "Daisy kept the doves at her shop; she doesn't trust it's safe for them", [fear.ev], { supplies: -15 }, "no_pigeons");
      if (s.stageClosed) return r("moved", "The doves arrived; they'll be released on the plaza instead", [s.stageClosed]);
      return r("ok", "A hundred white doves arrived beside the stage");
    }
    case "vendors": {
      const protest = s.gathers.find((g) => g.actor === "vendor");
      if (protest) return r("failed", `The stall owners never set up; they're still at ${placeZh(protest.place)} demanding answers`, [protest.ev], { supplies: -15, mood: -10 }, "vendor_strike");
      const stall = s.closed.get("stall");
      if (stall) return r("moved", "Rosa's stall stayed shut, so there's no takoyaki on the plaza", [stall], { supplies: -5 });
      return r("ok", "The stall owners are setting up one by one");
    }
    case "police":
      if (s.police && s.police.place !== "stage" && s.police.place !== "plaza")
        return r("moved", `Officers were sent to ${placeZh(s.police.place)}, leaving the plaza half-staffed`, [s.police.ev], { crowd: -10 }, "thin_police");
      if (s.police) return r("ok", `The police are already standing by at ${placeZh(s.police.place)}`, [s.police.ev]);
      return r("ok", "The police are in position on the plaza, as planned");
    case "rehearsal": {
      // 美咲's daughter performs tonight; a mother sure the stage is unsafe keeps her off it (her belief is in the log)
      const worry = s.stageClosed ? null : believes(s, "cafe", new Set(["stage_unsafe"]), 0.6);
      if (worry) return r("failed", "Molly won't let her daughter on stage, so the opening is one act short", [worry.ev], { people: -10 }, "no_daughter");
      if (s.stageClosed) return r("moved", "The rehearsal moves to the open plaza", [s.stageClosed], {}, "on_square");
      return r("ok", "The rehearsal goes smoothly");
    }
  }
}

/** Milestones whose time has come by minute `upTo`, in order. */
export function milestonesUpTo(events: SimEvent[], info: Map<string, ClaimInfo>, upTo: number): MilestoneResult[] {
  return MILESTONES.filter((m) => m.at <= upTo).map((m) => milestoneOf(m.id, events, info));
}
