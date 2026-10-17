// 鎮民筆記: what the player has discovered about each resident's card, one line per story. A line unlocks only when a
// story's log shows that resident acting on it (their own `motive`, see story.ts revealOf). Kept in this browser only.
import type { Motive, PersonaCard } from "../sim/types.ts";

export const JOURNAL_KEY = "viral.journal.v1";

/** the hidden lines of a card, in the order the journal lists them */
export const HIDDEN_FIELDS: { key: Exclude<Motive, "none">; field: keyof Omit<PersonaCard, "lines">; label: string }[] = [
  { key: "want", field: "wants", label: "今晚想要" },
  { key: "fear", field: "fears", label: "怕" },
  { key: "bias", field: "bias", label: "偏誤" },
  { key: "gossip", field: "gossip", label: "傳話習慣" },
  { key: "bottom", field: "bottom", label: "底線" },
  { key: "price", field: "price", label: "價碼" },
];

export type Journal = Record<string, Partial<Record<Exclude<Motive, "none">, { at: string; recorded?: boolean }>>>;

export function loadJournal(): Journal {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(JOURNAL_KEY);
    return raw ? (JSON.parse(raw) as Journal) : {};
  } catch {
    return {};
  }
}

/** Add one discovery; keeps the first time it was seen. Returns the same object when nothing changed. */
export function addDiscovery(j: Journal, npc: string, key: Exclude<Motive, "none">, meta: { at: string; recorded?: boolean }): Journal {
  if (j[npc]?.[key]) return j;
  const next = { ...j, [npc]: { ...j[npc], [key]: meta } };
  try {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
