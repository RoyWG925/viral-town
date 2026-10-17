// 鎮民筆記: what the player has discovered about each resident's card, one line per story. A line unlocks only when a
// story's log shows that resident acting on it (their own `motive`, see story.ts revealOf). Kept in this browser only.
import type { Motive, PersonaCard } from "../sim/types.ts";

export const JOURNAL_KEY = "viral.journal.v1";

/** the hidden lines of a card, in the order the journal lists them */
export const HIDDEN_FIELDS: { key: Exclude<Motive, "none">; field: keyof Omit<PersonaCard, "lines">; label: string }[] = [
  { key: "want", field: "wants", label: "Wants tonight" },
  { key: "fear", field: "fears", label: "Fears" },
  { key: "bias", field: "bias", label: "Bias" },
  { key: "gossip", field: "gossip", label: "Gossip habit" },
  { key: "bottom", field: "bottom", label: "Line they won't cross" },
  { key: "price", field: "price", label: "Price" },
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

/** "npc.key" for every line already discovered (what revealOf should not repeat when it has a choice) */
export function knownLines(j: Journal): Set<string> {
  return new Set(Object.entries(j).flatMap(([npc, keys]) => Object.keys(keys ?? {}).map((k) => `${npc}.${k}`)));
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
