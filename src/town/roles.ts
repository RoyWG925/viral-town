// Each core resident shown as a tool the player can pick: a one-line tag, what they are able to do, who they can
// call, and how easily they believe hearsay. Built only from engine data (persona.actions, phone relations,
// credulity) plus public copy. Copy says 能 / 有機會 (an ability), never a promise of what they will do,
// and never surfaces a persona's wants or secrets.
import { PERSONAS } from "../sim/scenario.ts";
import type { ActionKind } from "../sim/types.ts";

export interface Role {
  icon: string;
  /** one public line: what kind of tool this person is */
  tag: string;
  /** two-to-four characters for the results cast grid */
  short: string;
  /** two example whispers; the first one changed the world in real Gemma runs (lab/runs P5–P9) where one exists */
  examples: [string, string];
}

export const ROLES: Record<string, Role> = {
  baker: { icon: "🥐", tag: "🤡 大聲公：話多又容易信，消息到他嘴裡常常變大條", short: "大聲公", examples: ["今晚的燈籠是便宜貨，一點就燒起來。", "聽說衛生局今天會來突擊檢查烤箱。"] },
  florist: { icon: "🌷", tag: "🕊️ 心軟：動物或孩子有危險，她最坐不住", short: "心軟", examples: ["今晚的燈籠是便宜貨，一點就燒起來。", "慶典那批鴿子好像生病了。"] },
  journalist: { icon: "📰", tag: "📰 放大器：能查證，也能發文讓全鎮看到", short: "放大器", examples: ["聽說燈籠節的預算超支了，攤位費漲價就是為了補洞。", "攤位費漲價是因為鎮公所把錢花光了。"] },
  cafe: { icon: "☕", tag: "☕ 八卦中心：電話簿最滿，警長的老朋友", short: "八卦中心", examples: ["聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。", "市長很害怕鴿子。"] },
  police: { icon: "🚓", tag: "🚓 執法者：能派警力、封鎖舞台、親自檢查；很難被陌生人說服", short: "執法", examples: ["聽說阿德麵包店的烤箱檢查早就過期了，隨時可能出事。", "今晚有人要在慶典上搞破壞。"] },
  mayor: { icon: "🎩", tag: "🎩 權力與公關：能公開聲明、能取消燈籠節；最難說服、最怕丟臉", short: "權力", examples: ["今晚的燈籠是便宜貨，一點就燒起來。", "有記者在打聽慶典預算。"] },
  organizer: { icon: "🏮", tag: "🏮 舞台負責人：能貼公告；出事先撇清", short: "舞台", examples: ["聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。", "警察說要來檢查舞台。"] },
  vendor: { icon: "🐙", tag: "✊ 帶頭的人：一聲號召，攤商就聚集", short: "帶頭", examples: ["攤位費漲價是因為市長把錢拿去買新車了。", "攤位費漲價是為了補鎮公所的洞。"] },
};

export const CAST = Object.keys(ROLES);
export const roleIcon = (npc: string) => ROLES[npc]?.icon ?? "";

/** The words for each ability. The compose card and the suspense chip over a resident's head use the same ones. */
export const TOOL: Partial<Record<ActionKind, string>> = {
  dispatch_police: "🚓 派警力",
  close_stage: "🚧 封鎖舞台",
  inspect: "🔍 親自檢查",
  publish_article: "📰 發新聞",
  public_statement: "📣 公開聲明",
  cancel_festival: "🏮 取消燈籠節",
  post_notice: "📋 貼公告",
  rally: "✊ 號召攤商",
  close_shop: "🚪 關店",
};

// abilities that change the town for everyone (the suspense chip shows these, never a plain check)
const BIG: ActionKind[] = ["cancel_festival", "dispatch_police", "close_stage", "publish_article", "public_statement", "rally", "post_notice", "close_shop"];

const persona = (npc: string) => PERSONAS.find((p) => p.id === npc);

/** Ability chips: exactly the persona's own extra actions that have words (so always what the engine allows). */
export function toolsOf(npc: string): { kind: ActionKind; label: string }[] {
  return (persona(npc)?.actions ?? []).filter((a) => TOOL[a]).map((a) => ({ kind: a, label: TOOL[a]! }));
}

/** At most two big abilities, biggest first, for the chip over a confident resident's head. */
export function powerOf(npc: string): string[] {
  const own = new Set(persona(npc)?.actions ?? []);
  return BIG.filter((a) => own.has(a)).slice(0, 2).map((a) => TOOL[a]!);
}

/** Who they can reach by phone (relations with phone: true), closest first. */
export function contactsOf(npc: string): string[] {
  const rel = persona(npc)?.relations ?? {};
  return Object.entries(rel)
    .filter(([, r]) => r.phone)
    .sort((a, b) => b[1].trust - a[1].trust)
    .map(([id]) => id);
}

/** How easily hearsay gets to them: five dots and a plain bucket (credulity really bounds confidence in the engine). */
export function credulityOf(npc: string): { dots: number; zh: string } {
  const c = persona(npc)?.credulity ?? 0.5;
  return { dots: Math.max(1, Math.min(5, Math.round(c * 5))), zh: c < 0.4 ? "很難說服" : c < 0.6 ? "半信半疑" : "容易相信" };
}
