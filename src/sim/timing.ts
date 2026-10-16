// How long each event takes to watch, in real seconds. Shared by the playback director and the
// architecture analysis, so the numbers used to choose the architecture match what players see.
import type { SimEvent } from "./types.ts";
import { walkMetres } from "./geo.ts";

export const WALK_SPEED = 3.2; // m/s for core residents during playback (a brisk, readable walk)

export function watchSeconds(e: SimEvent): number {
  switch (e.type) {
    case "seed": return 2.5;
    case "decide": return 2.0;
    case "move": {
      if (e.data.home) return 0; // walking back to their post plays in the background
      const from = String(e.data.from ?? "");
      const to = String(e.data.to ?? "");
      return from && to ? Math.max(1.5, walkMetres(from, to) / WALK_SPEED) : 2;
    }
    case "talk": return 4.0;
    case "phone": return e.data.missed ? 1.5 : 3.0;
    case "look":
    case "inspect": return 3.0;
    case "state":
    case "notice":
    case "article":
    case "statement":
    case "gather": return e.data.key === "writing" ? 1.0 : 3.5;
    case "deliver": return e.data.via === "inspection" ? 0 : 0.8;
    case "rejected": return 1.0;
    case "meet": return 2.5;
    case "end": return 2.0;
    default: return 0;
  }
}

/** Idle game time between events is compressed: 0.15 s per game minute, at most 2 s per gap. */
export const gapSeconds = (gameMinutes: number) => Math.min(2, Math.max(0, gameMinutes) * 0.15);
