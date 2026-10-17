// Mistport town plan, in metres. +x east, +z south (toward the default camera), y up.
// Kept free of imports so `node scripts/check-layout.ts` can load it directly.
//
// Zones: central plaza with the town hall as focal point; a diagonal shopping street from the
// main road up to the plaza; a quiet residential lane north-west; a park west; the harbour east,
// where the main road bends north along the coast; houses with back gardens across the main road.

export type Pt = [number, number];
export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Circle = { x: number; z: number; r: number };
/** Oriented box: centre, width along local x, depth along local z, rotation about y. */
export type Obb = { x: number; z: number; w: number; d: number; rot: number };

// ---------------------------------------------------------------------------------------------
// geometry helpers

/** Uniform Catmull-Rom through the control points, resampled every `step` metres. */
export function samplePath(pts: Pt[], step = 0.75, closed = false): Pt[] {
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  const out: Pt[] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? out[0] : pts[pts.length - 1]);
  return out;
}

export function distToPolyline(x: number, z: number, line: Pt[]) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

export function inPolygon(x: number, z: number, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Local coordinates of a world point inside an oriented box frame. */
export function toLocal(o: { x: number; z: number; rot: number }, x: number, z: number) {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const dx = x - o.x;
  const dz = z - o.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
/** World coordinates of a local point (front of the frame = +z local). Matches three.js rotation.y. */
export function fromLocal(o: { x: number; z: number; rot: number }, lx: number, lz: number) {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
}
export function inObb(o: Obb, x: number, z: number, pad = 0) {
  const { lx, lz } = toLocal(o, x, z);
  return Math.abs(lx) <= o.w / 2 + pad && Math.abs(lz) <= o.d / 2 + pad;
}

// ---------------------------------------------------------------------------------------------
// roads

export type Surface = "asphalt" | "cobble" | "tile" | "gravel";
export interface RoadDef {
  id: string;
  kind: "main" | "street" | "lane" | "alley" | "path";
  pts: Pt[];
  width: number;
  surface: Surface;
  closed?: boolean;
}

export const CARRIAGEWAY = 5.6; // the main road's asphalt; sidewalks run either side
export const MAIN_SIDEWALK = 9.4; // total width including both sidewalks

export const MAIN_ROAD: RoadDef = {
  id: "main", kind: "main", width: CARRIAGEWAY, surface: "asphalt",
  pts: [[-80, 18], [-50, 17.5], [-32, 16], [-18, 15.2], [-4, 16], [10, 15.4], [22, 13.4], [31, 8.6], [36.4, 0.5], [37.6, -11], [37.6, -32], [36.4, -52]],
};

export const ROADS: RoadDef[] = [
  { id: "shopping", kind: "street", width: 5, surface: "cobble", pts: [[-18.4, 14], [-16.2, 6], [-12.6, -1.4], [-9.4, -6.6]] },
  { id: "east", kind: "street", width: 4, surface: "cobble", pts: [[11, -15], [21, -14.2], [30, -13.2], [35.2, -12.6]] },
  { id: "hill", kind: "lane", width: 3.6, surface: "tile", pts: [[-9.6, -22.5], [-19, -25.2], [-31, -24.6], [-42, -20], [-48.5, -13.5]] },
  { id: "homes", kind: "lane", width: 2.8, surface: "tile", pts: [[-27, -24.6], [-26, -12], [-27.4, 0], [-30.6, 8.4], [-33.6, 12.6]] },
  { id: "cafe-alley", kind: "alley", width: 2.6, surface: "cobble", pts: [[9.4, -6.2], [12, -1.6], [12.4, 10.4]] },
  { id: "green-path", kind: "path", width: 2.2, surface: "tile", pts: [[-13.4, 2], [-5, 3.6], [4, 3], [11.8, 4.2]] },
  { id: "park-loop", kind: "path", width: 2.2, surface: "gravel", closed: true, pts: [[-50, -14.5], [-42.5, -10], [-41.5, -1], [-46, 5.5], [-54, 5], [-58.5, -2], [-57, -10.5]] },
  { id: "park-gate", kind: "path", width: 2.2, surface: "gravel", pts: [[-33.6, 12.6], [-40, 9], [-44.4, 4.8]] },
];

export const sampled = {
  main: samplePath(MAIN_ROAD.pts, 0.8),
  roads: ROADS.map((r) => ({ ...r, line: samplePath(r.pts, 0.6, r.closed) })),
};

// Pedestrian crossings over the main road (oriented boxes across the carriageway).
export const CROSSINGS: Obb[] = [
  { x: -17.6, z: 15.2, w: 3.4, d: MAIN_SIDEWALK, rot: 0.05 },
  { x: 2, z: 15.9, w: 3.2, d: MAIN_SIDEWALK, rot: -0.03 },
  { x: 37.6, z: -12.4, w: 3.2, d: MAIN_SIDEWALK, rot: Math.PI / 2 },
  { x: 37.6, z: -24.4, w: 3.2, d: MAIN_SIDEWALK, rot: Math.PI / 2 }, // warehouse to the harbour market
];

// ---------------------------------------------------------------------------------------------
// paved squares and other areas

export const PLAZA: Pt[] = [[-9.4, -6.6], [-11.6, -11], [-11.6, -21.4], [-8, -25.6], [8, -25.6], [11.6, -22], [11.6, -9], [8.4, -5.2], [0, -3.8]];
export const PLAZA_CENTRE = { x: 0, z: -14 };
/** Small paved forecourts and terraces that tie doors to the street network. */
export const PATCHES: Pt[][] = [
  [[-13.4, -18.6], [-11.4, -18.6], [-11.4, -11.4], [-13.4, -11.4]], // police forecourt onto the plaza
  [[-14.4, -10.6], [-12.4, -10.6], [-12.4, -5.4], [-14.4, -5.4]], // ramen frontage
  [[14, 7], [21, 7], [21, 10.6], [14, 10.6]], // cafe terrace onto the main road
  [[22.6, 1], [29, 1], [29.6, 6.4], [22.6, 7.4]], // mart forecourt
  [[32, -10.8], [33.8, -10.8], [33.8, -4.4], [32, -4.4]], // seafood frontage on the coast road
  [[32, -29], [33.8, -29], [33.8, -20.2], [32, -20.2]], // warehouse loading apron
];
/** The town green between the plaza and the main road. */
export const GREEN: Pt[] = [[-12.6, -1.4], [-9.4, -6.6], [0, -3.8], [8.4, -5.2], [11.4, -1.6], [11.4, 9.6], [-3, 10.6], [-15.8, 10.2]];

export const COAST_X = 46.2; // quay edge; the sea lies east
export const QUAY: Rect = { x0: 41.6, x1: COAST_X, z0: -46, z1: 12 };
export const PIERS: Rect[] = [
  { x0: COAST_X, x1: 60, z0: -17.2, z1: -14.6 },
  { x0: COAST_X, x1: 53.5, z0: -3.2, z1: -1.2 },
];

export const PARK: Pt[] = [[-40, -21], [-40, 11], [-64, 11], [-64, -21]];
export const POND = { x: -50, z: -4.5, r: 4.2 };

// ---------------------------------------------------------------------------------------------
// buildings

export type ShopKind = "police" | "bakery" | "flower" | "townhall" | "cafe" | "news" | "books" | "ramen" | "mart" | "seafood";
export type BuildingKind = ShopKind | "house" | "warehouse";
export type RoofStyle = "flat" | "stepped" | "pitched" | "hip" | "barrel";

export interface BuildingDef extends Obb {
  id: string;
  kind: BuildingKind;
  floors: number;
  roof: RoofStyle;
  balcony?: boolean;
  annex?: "left" | "right";
  wall: string;
  roofColor: string;
  trim: string;
  awning?: [string, string];
  /** shop sign: the name painted large, a short line under it */
  sign?: { name: string; sub: string; bg: string; fg: string };
  yard?: { front?: number; back?: number }; // fenced garden depth in front of / behind a house
}

export const GROUND_H = 3.6; // shopfront storey: window, awning and sign
export const FLOOR_H = 2.6; // each upper storey
export const wallHeight = (floors: number) => GROUND_H + (floors - 1) * FLOOR_H;

const S = 0;
const E = Math.PI / 2;
const W = -Math.PI / 2;
const N = Math.PI;

export const BUILDINGS: BuildingDef[] = [
  // central plaza
  {
    id: "townhall", kind: "townhall", x: 0, z: -30.6, w: 14, d: 9, rot: S, floors: 2, roof: "flat",
    wall: "#a9d6a2", roofColor: "#55875a", trim: "#f3f8ef", sign: { name: "Town Hall", sub: "MISTPORT", bg: "#2f5a37", fg: "#f6f1d5" },
  },
  {
    id: "police", kind: "police", x: -16.2, z: -15, w: 7, d: 6.4, rot: E, floors: 2, roof: "stepped", annex: "left",
    wall: "#7fa9dc", roofColor: "#3c5a86", trim: "#e8eef7", awning: ["#3c5a86", "#e8eef7"], sign: { name: "Police", sub: "MISTPORT POLICE STATION", bg: "#1f3b66", fg: "#ffffff" },
  },
  {
    id: "books", kind: "books", x: 15.8, z: -6.6, w: 6.4, d: 6, rot: W, floors: 2, roof: "pitched", balcony: true,
    wall: "#c9b5e8", roofColor: "#5b4a8c", trim: "#f6f1ff", awning: ["#5b4a8c", "#f6f1ff"], sign: { name: "Old Street Books", sub: "NEW & SECONDHAND", bg: "#f6f1ff", fg: "#4a3a7a" },
  },
  // shopping street (fronts follow the street, facing east-south-east)
  {
    id: "ramen", kind: "ramen", x: -16.8, z: -8, w: 5.6, d: 5.4, rot: E, floors: 1, roof: "hip",
    wall: "#f6d6a8", roofColor: "#b5462f", trim: "#fff4e3", awning: ["#b5462f", "#fff4e3"], sign: { name: "Ramen", sub: "NOODLE HOUSE", bg: "#b5462f", fg: "#fff4e3" },
  },
  {
    id: "flower", kind: "flower", x: -18.8, z: -1, w: 5.6, d: 5, rot: 1.15, floors: 1, roof: "hip",
    wall: "#f5a9c5", roofColor: "#7b4ba0", trim: "#fff0f6", awning: ["#8fd18b", "#fff0f6"], sign: { name: "Daisy's Flowers", sub: "FLORIST", bg: "#ffffff", fg: "#b03a78" },
  },
  {
    id: "bakery", kind: "bakery", x: -23.9, z: 6.4, w: 6.2, d: 6, rot: 1.3, floors: 2, roof: "pitched", balcony: true,
    wall: "#f7c48e", roofColor: "#c4643e", trim: "#fff4e3", awning: ["#e2574c", "#fff4e3"], sign: { name: "Barney's Bakery", sub: "FRESH BREAD DAILY", bg: "#7a3b1d", fg: "#ffe9c2" },
  },
  // south-east block between the plaza and the main road
  {
    id: "cafe", kind: "cafe", x: 17.4, z: 3.8, w: 6.2, d: 6.4, rot: S, floors: 1, roof: "barrel", annex: "right",
    wall: "#97d3d6", roofColor: "#2e6f74", trim: "#effafa", awning: ["#2e6f74", "#f4efe2"], sign: { name: "Corner Café", sub: "COFFEE & CAKE", bg: "#3a2a22", fg: "#ffd9a8" },
  },
  {
    id: "mart", kind: "mart", x: 25.8, z: -1.5, w: 6, d: 5, rot: S, floors: 1, roof: "flat",
    wall: "#ffffff", roofColor: "#e2574c", trim: "#f2f2f2", awning: ["#3a86ff", "#ffffff"], sign: { name: "Mart 24", sub: "SNACKS & DRINKS", bg: "#3a86ff", fg: "#ffffff" },
  },
  // harbour side
  {
    id: "news", kind: "news", x: 18.6, z: -21.2, w: 7, d: 6, rot: S, floors: 3, roof: "flat",
    wall: "#f2e497", roofColor: "#8b6c3a", trim: "#fffbe6", awning: ["#3d3d3d", "#f2e497"], sign: { name: "Mistport News", sub: "YOUR TOWN, YOUR NEWS", bg: "#222222", fg: "#ffe45c" },
  },
  {
    id: "seafood", kind: "seafood", x: 29.5, z: -7.6, w: 6, d: 5, rot: E, floors: 2, roof: "pitched",
    wall: "#9fd3f0", roofColor: "#2f6f9f", trim: "#f4fbff", awning: ["#2f6f9f", "#ffffff"], sign: { name: "Harbor Grill", sub: "SEAFOOD", bg: "#1d4e74", fg: "#ffffff" },
  },
  { id: "warehouse", kind: "warehouse", x: 28.2, z: -24.6, w: 9, d: 7.6, rot: E, floors: 2, roof: "barrel", wall: "#c98f5a", roofColor: "#7a4f32", trim: "#f1e3d0" },
  // residential lane (north-west), fronts face the lane
  { id: "h-lane1", kind: "house", x: -17, z: -33.2, w: 6.4, d: 6, rot: S, floors: 2, roof: "hip", wall: "#cfe3f1", roofColor: "#4d6c86", trim: "#ffffff", yard: { front: 2.6 } },
  { id: "h-lane2", kind: "house", x: -27.4, z: -33, w: 6, d: 6.4, rot: S, floors: 3, roof: "pitched", balcony: true, wall: "#f3c8d9", roofColor: "#8c4f6a", trim: "#fff4f8", yard: { front: 2.2 } },
  { id: "h-lane3", kind: "house", x: -38.4, z: -29.8, w: 6, d: 6, rot: 0.4, floors: 2, roof: "pitched", wall: "#f1d39a", roofColor: "#a66b38", trim: "#fff8e6", yard: { front: 2.2 } },
  { id: "h-path1", kind: "house", x: -33.2, z: -14, w: 6, d: 5.8, rot: E, floors: 2, roof: "pitched", wall: "#d6eadf", roofColor: "#4f7a5a", trim: "#ffffff", yard: { front: 2.2 } },
  { id: "h-path2", kind: "house", x: -34.4, z: -2.2, w: 6.4, d: 6, rot: E, floors: 2, roof: "flat", balcony: true, wall: "#fde2c4", roofColor: "#c4643e", trim: "#fff8ee", yard: { front: 2.6 } },
  // across the main road: fronts face the road, back gardens face the camera
  { id: "h-south1", kind: "house", x: -26, z: 25.8, w: 7, d: 6, rot: N, floors: 2, roof: "pitched", wall: "#e8d5f2", roofColor: "#6d4c8c", trim: "#ffffff", yard: { front: 1.6, back: 6 } },
  { id: "h-south2", kind: "house", x: -6.4, z: 26.6, w: 6.4, d: 6.4, rot: N, floors: 3, roof: "flat", wall: "#cde8c4", roofColor: "#4f7a5a", trim: "#ffffff", yard: { front: 1.6, back: 5.4 } },
  { id: "h-south0", kind: "house", x: -44, z: 26.4, w: 6.4, d: 6, rot: N, floors: 2, roof: "hip", wall: "#f6e3a1", roofColor: "#8a6d3b", trim: "#ffffff", yard: { front: 1.6, back: 6 } },
  { id: "h-south3", kind: "house", x: 10.4, z: 25.6, w: 6, d: 6, rot: N, floors: 2, roof: "hip", wall: "#ffe0b8", roofColor: "#b5462f", trim: "#fff8ee", yard: { front: 1.6, back: 6 } },
];

export function frame(b: BuildingDef) {
  return { w: b.w, d: b.d, cx: b.x, cz: b.z, rot: b.rot, height: wallHeight(b.floors) + (b.kind === "townhall" ? 1.2 : 0) };
}
/** World position of a point in a building's local frame (front = +z local). */
export const toWorld = (b: BuildingDef, lx: number, lz: number) => fromLocal(b, lx, lz);
export const doorX = (b: BuildingDef) => (b.kind === "house" ? -b.w * 0.22 : b.kind === "warehouse" ? 0 : b.w * 0.31);

/** Fenced yards as oriented boxes, plus the fence segments around them (gate left open). */
export interface Yard extends Obb {
  house: string;
  side: "front" | "back";
}
export const YARDS: Yard[] = BUILDINGS.flatMap((b) => {
  const out: Yard[] = [];
  if (b.yard?.front) {
    const c = fromLocal(b, 0, b.d / 2 + b.yard.front / 2);
    out.push({ house: b.id, side: "front", x: c.x, z: c.z, w: b.w + 0.6, d: b.yard.front, rot: b.rot });
  }
  if (b.yard?.back) {
    const c = fromLocal(b, 0, -b.d / 2 - b.yard.back / 2);
    out.push({ house: b.id, side: "back", x: c.x, z: c.z, w: b.w + 1.2, d: b.yard.back, rot: b.rot });
  }
  return out;
});
/** Fence segments in world coordinates: [x0, z0, x1, z1]. Front yards keep a gate at the door. */
export const FENCES: [number, number, number, number][] = YARDS.flatMap((y) => {
  const b = BUILDINGS.find((h) => h.id === y.house)!;
  const hw = y.w / 2;
  const hd = y.d / 2;
  const corners = (pts: [number, number][]) => pts.map(([lx, lz]) => fromLocal(y, lx, lz));
  const seg = (a: { x: number; z: number }, c: { x: number; z: number }): [number, number, number, number] => [a.x, a.z, c.x, c.z];
  if (y.side === "front") {
    const gate = doorX(b);
    const [fl, gl, gr, fr, bl, br] = corners([[-hw, hd], [gate - 0.7, hd], [gate + 0.7, hd], [hw, hd], [-hw, -hd], [hw, -hd]]);
    return [seg(fl, gl), seg(gr, fr), seg(fl, bl), seg(fr, br)];
  }
  // back gardens open through a side gate near the far corner, onto the gap between houses
  const [fl, fr, bl, br, g0, g1] = corners([[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [hw, -hd + 0.6], [hw, -hd + 1.8]]);
  return [seg(fl, fr), seg(fl, bl), seg(fr, g0), seg(g1, br)];
});

// ---------------------------------------------------------------------------------------------
// furniture and landmarks

export const FOUNTAIN = { x: 0, z: -13.4, r: 2.3 };
export const STAGE: Obb = { x: -8.8, z: -15.2, w: 7.2, d: 2.4, rot: E };
export const LANTERN_POLES: Circle[] = [
  { x: -10.6, z: -9.6, r: 0.3 }, { x: -10.6, z: -21, r: 0.3 }, { x: 10.6, z: -21.4, r: 0.3 }, { x: 10.6, z: -9.4, r: 0.3 }, { x: 0, z: -4.6, r: 0.3 },
];
export const BENCHES: { x: number; z: number; rot: number }[] = [
  { x: 0, z: -18.2, rot: 0 }, { x: 4.8, z: -13.4, rot: -E }, { x: -3.2, z: 6, rot: 0 }, { x: 5.6, z: 6.4, rot: 0 },
  { x: -46.6, z: -10, rot: 0.6 }, { x: -55.4, z: 2.2, rot: -2.2 }, { x: -43.4, z: 1.4, rot: -1 },
  { x: 43.6, z: -6, rot: E }, { x: 43.6, z: 4, rot: E }, { x: 3, z: 20.6, rot: N }, // quay benches, bus stop
];
export const CAFE_TABLES: Circle[] = [{ x: 15, z: 8.4, r: 1.0 }, { x: 17.4, z: 9.2, r: 1.0 }, { x: 25.4, z: -5.6, r: 1.0 }];
export const LAMPS: Circle[] = [
  { x: -30, z: 11.4, r: 0.35 }, { x: -12, z: 11.4, r: 0.35 }, { x: 7, z: 11.2, r: 0.35 }, { x: 25, z: 9, r: 0.35 },
  { x: -20, z: 20.2, r: 0.35 }, { x: 0, z: 20.6, r: 0.35 }, { x: 18, z: 19.2, r: 0.35 },
  { x: -11.2, z: -24.8, r: 0.35 }, { x: 11.2, z: -24.8, r: 0.35 }, { x: -14.6, z: 0.4, r: 0.35 },
  { x: 42.4, z: -31, r: 0.35 }, { x: 42.4, z: -2, r: 0.35 }, { x: 42.4, z: 8, r: 0.35 },
  { x: -24, z: -26.6, r: 0.35 }, { x: -46, z: -14, r: 0.35 },
];
export const STALLS = [
  { x: -4.6, z: -7.8, rot: 0, name: "Grilled Corn", sub: "HOT & BUTTERY", roof: ["#e2574c", "#fff4e3"] as [string, string], goods: "#f4c542" },
  { x: 5, z: -7.6, rot: 0, name: "Cotton Candy", sub: "SWEET AS CAN BE", roof: ["#ff8fab", "#ffffff"] as [string, string], goods: "#ffb3d1" },
  { x: 7.4, z: -20.4, rot: -0.5, name: "Takoyaki", sub: "OCTOPUS BALLS", roof: ["#3a86ff", "#ffffff"] as [string, string], goods: "#c9874b" },
  { x: 43.8, z: -21.4, rot: W, name: "Fresh Fish", sub: "TODAY'S CATCH", roof: ["#2f6f9f", "#ffffff"] as [string, string], goods: "#9ec9e6" },
  { x: 43.8, z: -27.4, rot: W, name: "Fruit", sub: "SWEET & JUICY", roof: ["#6bcb77", "#ffffff"] as [string, string], goods: "#ff9f43" },
];
export const BALLOON_SELLER = { x: 2.4, z: -9.4 };
export const BIG_TREE = { x: 1.6, z: 3.8, r: 1.4 }; // the old tree on the green
export const BUS_STOP: Obb = { x: 2.4, z: 21.6, w: 3.2, d: 1.4, rot: N };
export const BINS: Circle[] = [{ x: -13.6, z: 11.2, r: 0.35 }, { x: 9.6, z: 11, r: 0.35 }, { x: 11, z: -24.6, r: 0.35 }, { x: 33.4, z: -16.6, r: 0.35 }];
export const MAILBOX: Circle = { x: -9.2, z: -24.6, r: 0.35 };
export const VENDING: Obb = { x: 12.3, z: -10.6, w: 0.9, d: 0.8, rot: W };
export const CRATES: Circle[] = [{ x: 33.4, z: -27.6, r: 0.8 }, { x: 33.6, z: -21.6, r: 0.7 }, { x: 44.6, z: -13.2, r: 0.7 }];
export const PLAYGROUND = { slide: { x: -54.4, z: 7.8, w: 2.4, d: 3.2, rot: 0.3 } as Obb, swings: { x: -47.4, z: 8.4, w: 4, d: 1.2, rot: 0 } as Obb };
export const FLOWER_BEDS: Circle[] = [{ x: -45, z: -16, r: 1.3 }, { x: -59, z: -14, r: 1.1 }, { x: -6.6, z: 0.4, r: 1.2 }];
export const PLANTERS: Circle[] = [{ x: -8.2, z: -23.6, r: 0.9 }, { x: 8.2, z: -23.6, r: 0.9 }, { x: -11, z: -6.2, r: 0.8 }, { x: 9.8, z: -4.8, r: 0.8 }];

// Trees placed by hand: framing the plaza, along the main road, and in the park.
export const STREET_TREES: Circle[] = [
  { x: -24, z: 11.6, r: 0.9 }, { x: -6, z: 11.6, r: 0.9 }, { x: 4, z: 11.4, r: 0.9 }, { x: -32, z: 20.4, r: 0.9 }, { x: -14, z: 20.4, r: 0.9 },
  { x: 16, z: 19.4, r: 0.9 }, { x: 26, z: 17.4, r: 0.9 }, { x: -48, z: -18, r: 1 }, { x: -60, z: 6, r: 1 }, { x: -61, z: -18, r: 1 },
  { x: -41.4, z: -6, r: 1 }, { x: -52, z: -16.4, r: 1 },
];

// ---------------------------------------------------------------------------------------------
// what is walkable, and where the forest fills empty ground

export function onRoad(x: number, z: number, pad = 0) {
  return sampled.roads.some((r) => distToPolyline(x, z, r.line) <= r.width / 2 + pad);
}
export const onMainCarriageway = (x: number, z: number) => distToPolyline(x, z, sampled.main) <= CARRIAGEWAY / 2;
export const onMainSidewalk = (x: number, z: number) => distToPolyline(x, z, sampled.main) <= MAIN_SIDEWALK / 2;
export const onCrossing = (x: number, z: number) => CROSSINGS.some((c) => inObb(c, x, z));
export const inPier = (x: number, z: number) => PIERS.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);
export const inQuay = (x: number, z: number) => x >= QUAY.x0 && x <= QUAY.x1 && z >= QUAY.z0 && z <= QUAY.z1;
export const isSea = (x: number, z: number) => x > COAST_X && !inPier(x, z);
export const inBuilding = (x: number, z: number, pad = 0) => BUILDINGS.some((b) => inObb(b, x, z, pad));
export const inYard = (x: number, z: number) => YARDS.some((y) => inObb(y, x, z));
export const inPlaza = (x: number, z: number) => inPolygon(x, z, PLAZA);
export const inPatch = (x: number, z: number, pad = 0) =>
  PATCHES.some((p) => inPolygon(x, z, p) || (pad > 0 && p.some(([px, pz]) => Math.hypot(px - x, pz - z) < pad)));

/** The town boundary; outside it is forest, hills or sea. */
export const TOWN_EDGE: Pt[] = [[-66, -40], [36, -40], [48, -46], [48, 37], [-66, 37]];

/**
 * Fill empty ground with clusters of trees and bushes so no large patch is bare.
 * Deterministic; skips roads, squares, yards, buildings, the pond and the sea.
 */
export const FILL_TREES: (Circle & { bush: boolean })[] = (() => {
  let s = 1234;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: (Circle & { bush: boolean })[] = [];
  const clear = (x: number, z: number, r: number) =>
    distToPolyline(x, z, sampled.main) > MAIN_SIDEWALK / 2 + r + 0.6 &&
    !onRoad(x, z, r + 1.2) && !inPlaza(x, z) && !inPolygon(x, z, GREEN) && !inBuilding(x, z, r + 1.4) && !inPatch(x, z, r + 0.6) &&
    !YARDS.some((y) => inObb(y, x, z, r + 0.6)) && x < QUAY.x0 - r - 0.8 &&
    Math.hypot(x - POND.x, z - POND.z) > POND.r + r + 2.6 && !out.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r + 0.3) &&
    !STREET_TREES.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r + 0.6) && Math.hypot(x - PLAYGROUND.slide.x, z - PLAYGROUND.slide.z) > 5 &&
    Math.hypot(x - PLAYGROUND.swings.x, z - PLAYGROUND.swings.z) > 4;
  for (let z = -54; z <= 46; z += 2.2) {
    for (let x = -86; x <= 44; x += 2.2) {
      const jx = x + (rand() - 0.5) * 1.8;
      const jz = z + (rand() - 0.5) * 1.8;
      const outside = !inPolygon(jx, jz, TOWN_EDGE);
      const inPark = inPolygon(jx, jz, PARK);
      const density = outside ? 0.75 : inPark ? 0.14 : 0.34;
      if (rand() > density) continue;
      const bush = !outside && rand() < 0.55;
      const r = bush ? 0.6 + rand() * 0.4 : 0.9 + rand() * 0.8;
      if (clear(jx, jz, r)) out.push({ x: jx, z: jz, r, bush });
    }
  }
  return out;
})();

export const OBSTACLE_CIRCLES: Circle[] = [
  FOUNTAIN, BIG_TREE, POND, MAILBOX, ...LANTERN_POLES, ...LAMPS, ...CAFE_TABLES, ...BINS, ...CRATES, ...FLOWER_BEDS, ...PLANTERS,
  ...STREET_TREES, ...FILL_TREES.map((t) => ({ x: t.x, z: t.z, r: t.bush ? t.r * 0.8 : 0.45 })),
  { x: BALLOON_SELLER.x, z: BALLOON_SELLER.z, r: 0.6 },
];
const benchObb = (b: { x: number; z: number; rot: number }): Obb => ({ x: b.x, z: b.z - 0.05, w: 2.1, d: 0.6, rot: b.rot });
export const OBSTACLE_OBBS: Obb[] = [
  ...BUILDINGS,
  { x: 0, z: -25.6, w: 5.4, d: 1.4, rot: 0 }, // town hall steps
  STAGE,
  BUS_STOP,
  VENDING,
  PLAYGROUND.slide,
  PLAYGROUND.swings,
  ...BENCHES.map(benchObb),
  ...STALLS.map((s) => ({ x: s.x, z: s.z - 0.3, w: 2.8, d: 2.0, rot: s.rot })),
];

// ---------------------------------------------------------------------------------------------
// places people go

export type Activity = "enter" | "browse" | "sit" | "linger" | "play" | "picnic" | "tend" | "wait";
export type Who = "adult" | "kid" | "elder";
export type Zone = "plaza" | "shops" | "homes" | "park" | "harbour" | "green" | "road";
export interface Poi {
  x: number;
  z: number;
  activity: Activity;
  face: number; // heading (radians) while there; atan2(dx, dz)
  weight: number;
  likes?: Partial<Record<Who, number>>;
  zone: Zone;
}

const look = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

export const POIS: Poi[] = [
  ...BUILDINGS.flatMap((b): Poi[] => {
    const door = fromLocal(b, doorX(b), b.d / 2 + (b.yard?.front ? b.yard.front + 0.6 : 0.8));
    const win = fromLocal(b, -b.w * 0.13, b.d / 2 + 1.2);
    const facing = b.rot + Math.PI;
    const zone: Zone = b.kind === "house" ? "homes" : ["seafood", "warehouse", "news"].includes(b.kind) ? "harbour" : ["townhall", "police", "books"].includes(b.kind) ? "plaza" : "shops";
    const shop = b.kind !== "house" && b.kind !== "warehouse";
    return [
      { x: door.x, z: door.z, activity: "enter", face: facing, weight: shop ? 3 : 1.2, likes: { kid: 0.5 }, zone },
      ...(shop && b.kind !== "townhall" ? [{ x: win.x, z: win.z, activity: "browse" as const, face: facing, weight: 2, zone }] : []),
    ];
  }),
  ...YARDS.filter((y) => y.side === "back" || y.d > 2).map((y): Poi => {
    const p = fromLocal(y, y.w * 0.25, 0);
    return { x: p.x, z: p.z, activity: "tend", face: y.rot + Math.PI, weight: 1.2, likes: { elder: 3, kid: 0.2 }, zone: "homes" };
  }),
  ...CAFE_TABLES.flatMap((t): Poi[] => [
    { x: t.x - 0.8, z: t.z, activity: "sit", face: Math.PI / 2, weight: 2, likes: { kid: 0.3 }, zone: "shops" },
    { x: t.x + 0.8, z: t.z, activity: "sit", face: -Math.PI / 2, weight: 2, likes: { kid: 0.3 }, zone: "shops" },
  ]),
  ...BENCHES.flatMap((b): Poi[] =>
    [-0.5, 0.5].map((o) => {
      const p = fromLocal({ x: b.x, z: b.z, rot: b.rot }, o, 0.5);
      const isBus = b.rot === N && b.z > 18;
      return { x: p.x, z: p.z, activity: isBus ? "wait" : "sit", face: b.rot, weight: 1.4, likes: { elder: 3 }, zone: isBus ? "road" : b.x < -40 ? "park" : b.x > 40 ? "harbour" : "green" };
    }),
  ),
  ...STALLS.map((s): Poi => {
    const p = fromLocal({ x: s.x, z: s.z, rot: s.rot }, 0, 1.5);
    return { x: p.x, z: p.z, activity: "browse", face: s.rot + Math.PI, weight: 2.4, likes: { kid: 2 }, zone: s.x > 40 ? "harbour" : "plaza" };
  }),
  { x: BALLOON_SELLER.x, z: BALLOON_SELLER.z + 1.3, activity: "browse", face: Math.PI, weight: 1.5, likes: { kid: 4 }, zone: "plaza" },
  ...[[-5.6, -12], [5.4, -16.8], [-3.6, -19.6], [3.2, -10], [-6.6, -17.6], [6.8, -11.6], [0, -21.6], [-2.4, -8.6]].map(
    ([x, z]): Poi => ({ x, z, activity: "linger", face: look(x, z, FOUNTAIN.x, FOUNTAIN.z), weight: 1.3, zone: "plaza" }),
  ),
  ...[[-1.6, 7.4], [6, 1.4], [-8, 6.6], [3.4, 8.2]].map(([x, z]): Poi => ({ x, z, activity: "play", face: look(x, z, BIG_TREE.x, BIG_TREE.z), weight: 1.2, likes: { kid: 5, adult: 0.2, elder: 0 }, zone: "green" })),
  ...[[-4.6, 1.6], [7.6, 5.6], [-0.6, 0.4]].map(([x, z]): Poi => ({ x, z, activity: "picnic", face: look(x, z, BIG_TREE.x, BIG_TREE.z), weight: 1.1, zone: "green" })),
  // harbour: watch boats from the quay rail and from the end of the piers
  ...[-34, -18, -10, -6, 2, 6].map((z): Poi => ({ x: COAST_X - 0.5, z, activity: "linger", face: Math.PI / 2, weight: 1.1, likes: { elder: 2 }, zone: "harbour" })),
  { x: 59, z: -15.9, activity: "linger", face: Math.PI / 2, weight: 1.2, likes: { elder: 2 }, zone: "harbour" },
  { x: 52.8, z: -2.2, activity: "linger", face: Math.PI / 2, weight: 1, zone: "harbour" },
  // park: play, picnic by the pond, stroll the loop
  ...[[-53.4, 6.2], [-47.4, 6.8], [-46.2, 9.4], [-56, 4.2]].map(([x, z]): Poi => ({ x, z, activity: "play", face: Math.PI, weight: 1.4, likes: { kid: 6, adult: 0.3, elder: 0 }, zone: "park" })),
  ...[[-50, 1.8], [-44.4, -4], [-55.6, -6.4], [-50.4, -11.4]].map(([x, z]): Poi => ({ x, z, activity: "picnic", face: look(x, z, POND.x, POND.z), weight: 1.2, likes: { elder: 1.5 }, zone: "park" })),
  // the far sidewalk and the bus stop
  ...[-30, -12, 14, 22].map((x): Poi => ({ x, z: 19.6, activity: "linger", face: Math.PI, weight: 0.6, zone: "road" })),
];

/** Fixed jobs that keep the harbour and the shops busy. */
export const DOCK_ROUTE = { from: { x: 32.8, z: -24.6 }, to: { x: 58.4, z: -15.9 } };
