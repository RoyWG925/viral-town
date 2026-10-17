// 慶典準備的里程碑：17:00 到 19:30 五個固定時間點，檢查當下的世界狀態（舞台、店家、攤商、警力、居民的底線），
// 決定這一關順不順。純函式：只讀已驗證的事件紀錄，不呼叫模型，也不替任何居民做新決定——只看他們已經做了什麼、
// 已經相信什麼。引擎在那個時間點把結果記成事件，結局量表（readiness.ts）也用同一個函式，所以兩邊永遠一致。
import { PLACES } from "./scenario.ts";
import type { SimEvent } from "./types.ts";

export type MilestoneId = "stage_check" | "pigeons" | "vendors" | "police" | "rehearsal";
export type Meter = "people" | "supplies" | "money" | "site" | "mayor" | "mood" | "crowd" | "time";

export const MILESTONES: { id: MilestoneId; at: number; zh: string }[] = [
  { id: "stage_check", at: 120, zh: "17:00 舞台巡查" },
  { id: "pigeons", at: 180, zh: "18:00 白鴿送到舞台" },
  { id: "vendors", at: 210, zh: "18:30 攤商進場" },
  { id: "police", at: 240, zh: "19:00 警力部署" },
  { id: "rehearsal", at: 270, zh: "19:30 開場彩排" },
];

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
  if (s.festivalCancelled) return r("failed", "燈籠節已經取消了", [s.festivalCancelled]);
  switch (id) {
    case "stage_check":
      if (s.stageClosed) return r("moved", "舞台已被封鎖，節目改到廣場空地", [s.stageClosed], {}, "on_square");
      return r("ok", "巡查完畢，舞台照常使用");
    case "pigeons": {
      const shut = s.closed.get("flower");
      if (shut) return r("failed", "美玲的花店關著，白鴿沒有送來", [shut], { supplies: -15 }, "no_pigeons");
      // her own worry about danger, already in the log: she keeps the birds back (no new decision is made for her)
      const fear = believes(s, "florist", DANGER_TO_PIGEONS, 0.6);
      if (fear) return r("failed", "美玲把白鴿留在店裡，不放心讓牠們上場", [fear.ev], { supplies: -15 }, "no_pigeons");
      if (s.stageClosed) return r("moved", "白鴿送到了，改在廣場放飛", [s.stageClosed]);
      return r("ok", "一百隻白鴿送到舞台邊");
    }
    case "vendors": {
      const protest = s.gathers.find((g) => g.actor === "vendor");
      if (protest) return r("failed", `攤商們沒有進場，還聚在${placeZh(protest.place)}討公道`, [protest.ev], { supplies: -15, mood: -10 }, "vendor_strike");
      const stall = s.closed.get("stall");
      if (stall) return r("moved", "阿珠的攤位沒開，廣場少了章魚燒", [stall], { supplies: -5 });
      return r("ok", "攤商陸續進場擺攤");
    }
    case "police":
      if (s.police && s.police.place !== "stage" && s.police.place !== "plaza")
        return r("moved", `警力被派去${placeZh(s.police.place)}，廣場只剩一半人手`, [s.police.ev], { crowd: -10 }, "thin_police");
      if (s.police) return r("ok", `警察已經在${placeZh(s.police.place)}待命`, [s.police.ev]);
      return r("ok", "警察照計畫在廣場就位");
    case "rehearsal": {
      // 美咲's daughter performs tonight; a mother sure the stage is unsafe keeps her off it (her belief is in the log)
      const worry = s.stageClosed ? null : believes(s, "cafe", new Set(["stage_unsafe"]), 0.6);
      if (worry) return r("failed", "美咲不讓女兒上台，開場少了一個節目", [worry.ev], { people: -10 }, "no_daughter");
      if (s.stageClosed) return r("moved", "彩排改在廣場空地", [s.stageClosed], {}, "on_square");
      return r("ok", "彩排順利");
    }
  }
}

/** Milestones whose time has come by minute `upTo`, in order. */
export function milestonesUpTo(events: SimEvent[], info: Map<string, ClaimInfo>, upTo: number): MilestoneResult[] {
  return MILESTONES.filter((m) => m.at <= upTo).map((m) => milestoneOf(m.id, events, info));
}
