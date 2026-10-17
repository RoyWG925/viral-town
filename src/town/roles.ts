// Each core resident shown as a tool the player can pick: a one-line tag, what they are able to do, who they can
// call, and how easily they believe hearsay. Built only from engine data (persona.actions, phone relations,
// credulity) plus public copy. Copy says "can" (an ability), never a promise of what they will do,
// and never surfaces a persona's wants or secrets.
import { PERSONAS } from "../sim/scenario.ts";
import type { ActionKind } from "../sim/types.ts";

export interface Role {
  icon: string;
  /** one public line: what kind of tool this person is */
  tag: string;
  /** one or two words for the results cast grid */
  short: string;
  /** two example whispers; the first one changed the world in real Gemma runs (lab/runs P5–P9) where one exists */
  examples: [string, string];
  /** the same two whispers as the recorded runs logged them (lab/runs are in Chinese), for matching those logs */
  examplesZh: [string, string];
}

// The English copy says "can" (an ability), never "will" (a promise of what they will do).
const LANTERNS = "Tonight's lanterns are cheap junk. One spark and they'd go up in flames.";
const OLD_PLANKS = "I heard tonight's stage was thrown together from old planks. It might not hold.";
const LANTERNS_ZH = "今晚的燈籠是便宜貨，一點就燒起來。";
const OLD_PLANKS_ZH = "聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。";

export const ROLES: Record<string, Role> = {
  baker: {
    icon: "🥐", tag: "🤡 Loudmouth: chatty and easy to convince; a story tends to grow once it reaches him", short: "Loudmouth",
    examples: [LANTERNS, "I heard the health inspectors are making a surprise oven check today."],
    examplesZh: [LANTERNS_ZH, "聽說衛生局今天會來突擊檢查烤箱。"],
  },
  florist: {
    icon: "🌷", tag: "🕊️ Soft heart: when animals or kids are in danger, she can't sit still", short: "Soft heart",
    examples: [LANTERNS, "The festival pigeons look sick."],
    examplesZh: [LANTERNS_ZH, "慶典那批鴿子好像生病了。"],
  },
  journalist: {
    icon: "📰", tag: "📰 Amplifier: can check things out, and can post for the whole town to see", short: "Amplifier",
    examples: ["I heard the Lantern Festival went over budget, and the stall fee went up to plug the hole.", "The stall fee went up because the town hall ran out of money."],
    examplesZh: ["聽說燈籠節的預算超支了，攤位費漲價就是為了補洞。", "攤位費漲價是因為鎮公所把錢花光了。"],
  },
  cafe: {
    icon: "☕", tag: "☕ Gossip hub: more regulars than anyone, and an old friend of the chief", short: "Gossip hub",
    examples: [OLD_PLANKS, "The mayor is terrified of pigeons."],
    examplesZh: [OLD_PLANKS_ZH, "市長很害怕鴿子。"],
  },
  police: {
    icon: "🚓", tag: "🚓 The law: can send officers, close the stage, inspect in person; hard for a stranger to convince", short: "The law",
    examples: ["I heard the safety check on the oven at Ade's Bakery ran out ages ago. Something could go wrong any minute.", "Someone's planning to sabotage the festival tonight."],
    examplesZh: ["聽說阿德麵包店的烤箱檢查早就過期了，隨時可能出事。", "今晚有人要在慶典上搞破壞。"],
  },
  mayor: {
    icon: "🎩", tag: "🎩 Power and PR: can make a statement or cancel the festival; hardest to convince, hates losing face", short: "Power",
    examples: [LANTERNS, "A reporter has been asking around about the festival budget."],
    examplesZh: [LANTERNS_ZH, "有記者在打聽慶典預算。"],
  },
  organizer: {
    icon: "🏮", tag: "🏮 Runs the stage: can put up notices; when trouble hits, covers himself first", short: "Stage boss",
    examples: [OLD_PLANKS, "The police say they're coming to check the stage."],
    examplesZh: [OLD_PLANKS_ZH, "警察說要來檢查舞台。"],
  },
  vendor: {
    icon: "🐙", tag: "✊ Ringleader: one shout and the stall owners gather", short: "Ringleader",
    examples: ["The stall fee went up because the mayor spent the money on a new car.", "The stall fee went up to plug a hole in the town hall's budget."],
    examplesZh: ["攤位費漲價是因為市長把錢拿去買新車了。", "攤位費漲價是為了補鎮公所的洞。"],
  },
};

/** The longest whisper the player can type (characters; English needs about 1.7× the room the Chinese 80 had). */
export const MAX_WHISPER = 140;

export const CAST = Object.keys(ROLES);
export const roleIcon = (npc: string) => ROLES[npc]?.icon ?? "";

/**
 * The words for each ability. The compose card and the suspense chip over a resident's head use the same ones.
 * Each is "emoji + a verb phrase in the base form", so "can " + the phrase (emoji stripped, lower-cased) reads right.
 */
export const TOOL: Partial<Record<ActionKind, string>> = {
  dispatch_police: "🚓 Send the police",
  close_stage: "🚧 Close the stage",
  inspect: "🔍 Inspect in person",
  publish_article: "📰 Post the news",
  public_statement: "📣 Make a statement",
  cancel_festival: "🏮 Cancel the festival",
  post_notice: "📋 Put up a notice",
  rally: "✊ Rally the stall owners",
  close_shop: "🚪 Close the shop",
};

/** "can send the police": an ability chip as words in a sentence (emoji off, first letter lower-cased). */
export const canDo = (label: string) => {
  const words = label.replace(/^\S+\s/, "");
  return `can ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
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

/**
 * How easily hearsay gets to them: five dots and a plain bucket (credulity really bounds confidence in the engine).
 * `label` is what the card shows; `zh` keeps the bucket's original name, which lab/test-roles.ts checks.
 */
export function credulityOf(npc: string): { dots: number; label: string; zh: string } {
  const c = persona(npc)?.credulity ?? 0.5;
  const bucket = c < 0.4 ? 0 : c < 0.6 ? 1 : 2;
  return {
    dots: Math.max(1, Math.min(5, Math.round(c * 5))),
    label: ["hard to convince", "half-believes", "easy to convince"][bucket],
    zh: ["很難說服", "半信半疑", "容易相信"][bucket],
  };
}
