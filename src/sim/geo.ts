// Where each simulation place is in the 3D town, and how long it takes to walk between them.
// Uses the same town plan and pathfinder as the crowd, so playback walks match the engine's timing.
import { BUILDINGS, STAGE, STALLS, doorX, fromLocal } from "../town/layout.ts";
import { findPath } from "../town/nav.ts";
import type { Minutes, PlaceId } from "./types.ts";

const door = (id: string) => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`no building ${id}`);
  return fromLocal(b, doorX(b), b.d / 2 + 1.0);
};

export const SPOTS: Record<PlaceId, { x: number; z: number }> = {
  bakery: door("bakery"),
  flower: door("flower"),
  news: door("news"),
  cafe: door("cafe"),
  police: door("police"),
  townhall: door("townhall"),
  plaza: { x: -4.2, z: -9.2 },
  stage: fromLocal(STAGE, 0, STAGE.d / 2 + 1.2),
  stall: fromLocal(STALLS[2], 0, 1.7),
  harbour: { x: 44, z: -6 },
};

const WALK_M_PER_MIN = 70;
const cache = new Map<string, number>();

export function walkMetres(a: PlaceId, b: PlaceId): number {
  if (a === b) return 0;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  let d = cache.get(key);
  if (d === undefined) {
    const pa = SPOTS[a];
    const pb = SPOTS[b];
    const path = findPath(pa.x, pa.z, pb.x, pb.z, 80000);
    if (path) {
      d = 0;
      let px = pa.x;
      let pz = pa.z;
      for (const p of path) {
        d += Math.hypot(p.x - px, p.z - pz);
        px = p.x;
        pz = p.z;
      }
    } else d = Math.hypot(pa.x - pb.x, pa.z - pb.z) * 1.4;
    cache.set(key, d);
  }
  return d;
}

/** Game minutes to walk between two places (at least half a minute to leave and arrive). */
export function travelMinutes(a: PlaceId, b: PlaceId): Minutes {
  if (a === b) return 0;
  return Math.max(0.5, walkMetres(a, b) / WALK_M_PER_MIN);
}
