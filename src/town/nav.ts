// Grid navigation for townsfolk: A* over 0.5 m cells, then line-of-sight smoothing.
// The grid is rasterised from the town plan: paving is cheap, lawns cost more, and buildings,
// furniture, fences, the sea and the main road's carriageway (except at crossings) are blocked.
import {
  CARRIAGEWAY, COAST_X, FENCES, GREEN, MAIN_SIDEWALK, OBSTACLE_CIRCLES, OBSTACLE_OBBS, PATCHES, PIERS, PLAZA, QUAY, TOWN_EDGE, YARDS,
  inObb, inPolygon, onCrossing, sampled, type Obb, type Pt, type Rect,
} from "./layout.ts";

const CELL = 0.5;
const X0 = -70;
const Z0 = -52;
const W = Math.ceil((66 - X0) / CELL);
const H = Math.ceil((42 - Z0) / CELL);
const PAD = 0.32; // keep this far from obstacles

const blocked = new Uint8Array(W * H);
const cost = new Float32Array(W * H).fill(2.6);

const cx = (i: number) => X0 + (i + 0.5) * CELL;
const cz = (j: number) => Z0 + (j + 0.5) * CELL;
const ci = (x: number) => Math.floor((x - X0) / CELL);
const cj = (z: number) => Math.floor((z - Z0) / CELL);

function eachCellIn(x0: number, z0: number, x1: number, z1: number, fn: (k: number, x: number, z: number) => void) {
  const i0 = Math.max(0, ci(x0));
  const i1 = Math.min(W - 1, ci(x1));
  const j0 = Math.max(0, cj(z0));
  const j1 = Math.min(H - 1, cj(z1));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * W + i, cx(i), cz(j));
}
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}
function eachCellNearLine(line: Pt[], hw: number, fn: (k: number, x: number, z: number) => void) {
  for (let s = 0; s < line.length - 1; s++) {
    const [ax, az] = line[s];
    const [bx, bz] = line[s + 1];
    eachCellIn(Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw, (k, x, z) => {
      if (segDist(x, z, ax, az, bx, bz) <= hw) fn(k, x, z);
    });
  }
}
function eachCellInPolygon(poly: Pt[], fn: (k: number) => void) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  eachCellIn(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (k, x, z) => inPolygon(x, z, poly) && fn(k));
}
function eachCellInObb(o: Obb, pad: number, fn: (k: number) => void) {
  const r = Math.hypot(o.w, o.d) / 2 + pad;
  eachCellIn(o.x - r, o.z - r, o.x + r, o.z + r, (k, x, z) => inObb(o, x, z, pad) && fn(k));
}
const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

(function build() {
  // outside the town and out at sea nobody walks
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = cx(i);
      const z = cz(j);
      if (!inPolygon(x, z, TOWN_EDGE) || (x > COAST_X && !PIERS.some((p) => inRect(p, x, z)))) blocked[j * W + i] = 1;
    }
  // surfaces, cheapest last so it wins
  eachCellInPolygon(GREEN, (k) => (cost[k] = 1.8));
  for (const y of YARDS) eachCellInObb(y, 0, (k) => (cost[k] = 1.6));
  for (const r of sampled.roads) eachCellNearLine(r.line, r.width / 2, (k) => (cost[k] = 1));
  eachCellNearLine(sampled.main, MAIN_SIDEWALK / 2, (k) => (cost[k] = 1));
  eachCellInPolygon(PLAZA, (k) => (cost[k] = 1));
  for (const p of PATCHES) eachCellInPolygon(p, (k) => (cost[k] = 1));
  eachCellIn(QUAY.x0, QUAY.z0, QUAY.x1, QUAY.z1, (k) => (cost[k] = 1));
  for (const p of PIERS) eachCellIn(p.x0, p.z0, p.x1, p.z1, (k) => ((cost[k] = 1), (blocked[k] = 0)));
  // obstacles
  eachCellNearLine(sampled.main, CARRIAGEWAY / 2, (k, x, z) => !onCrossing(x, z) && (blocked[k] = 1));
  for (const o of OBSTACLE_OBBS) eachCellInObb(o, PAD, (k) => (blocked[k] = 1));
  for (const c of OBSTACLE_CIRCLES) {
    const r = c.r + PAD;
    eachCellIn(c.x - r, c.z - r, c.x + r, c.z + r, (k, x, z) => (x - c.x) ** 2 + (z - c.z) ** 2 < r * r && (blocked[k] = 1));
  }
  for (const [x0, z0, x1, z1] of FENCES) eachCellNearLine([[x0, z0], [x1, z1]], 0.24, (k) => (blocked[k] = 1));
})();

const cellOf = (x: number, z: number) => {
  const i = Math.floor((x - X0) / CELL);
  const j = Math.floor((z - Z0) / CELL);
  return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
};
const centre = (k: number) => ({ x: X0 + ((k % W) + 0.5) * CELL, z: Z0 + (Math.floor(k / W) + 0.5) * CELL });

export function walkable(x: number, z: number) {
  const k = cellOf(x, z);
  return k >= 0 && !blocked[k];
}

export function isPaved(x: number, z: number) {
  const k = cellOf(x, z);
  return k >= 0 && cost[k] === 1;
}

function nearestFree(x: number, z: number): number {
  const k0 = cellOf(x, z);
  if (k0 >= 0 && !blocked[k0]) return k0;
  for (let r = 1; r < 12; r++) {
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const k = cellOf(x + di * CELL, z + dj * CELL);
        if (k >= 0 && !blocked[k]) return k;
      }
  }
  return -1;
}

// Binary heap keyed by f-score.
const heap: number[] = [];
const fScore = new Float32Array(W * H);
function push(k: number) {
  heap.push(k);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (fScore[heap[p]] <= fScore[heap[i]]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}
function pop() {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
      if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}

const g = new Float32Array(W * H).fill(Infinity);
const parent = new Int32Array(W * H).fill(-1);
const closed = new Uint8Array(W * H);
const touched: number[] = [];
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(d / 0.25);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const k = cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (k < 0 || blocked[k]) return false;
    // Stay on paving when the straight line would cut across a lawn.
    if (cost[k] > 1 && isPaved(a.x, a.z) && isPaved(b.x, b.z)) return false;
  }
  return true;
}

/** World-space waypoints from (sx,sz) to (tx,tz), or null when unreachable. */
export function findPath(sx: number, sz: number, tx: number, tz: number, maxExpand = 30000): { x: number; z: number }[] | null {
  const start = nearestFree(sx, sz);
  const goal = nearestFree(tx, tz);
  if (start < 0 || goal < 0) return null;
  for (const k of touched) {
    g[k] = Infinity;
    parent[k] = -1;
    closed[k] = 0;
  }
  touched.length = 0;
  heap.length = 0;
  const gi = goal % W;
  const gj = Math.floor(goal / W);
  const h = (k: number) => {
    const di = Math.abs((k % W) - gi);
    const dj = Math.abs(Math.floor(k / W) - gj);
    return Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj);
  };
  g[start] = 0;
  fScore[start] = h(start);
  touched.push(start);
  push(start);
  let expanded = 0;
  while (heap.length) {
    const k = pop();
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    if (++expanded > maxExpand) return null;
    const i = k % W;
    const j = Math.floor(k / W);
    for (const [di, dj, step] of NEIGHBOURS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (blocked[n] || closed[n]) continue;
      if (di && dj && (blocked[j * W + ni] || blocked[nj * W + i])) continue; // no corner cutting
      const ng = g[k] + step * (cost[k] + cost[n]) * 0.5;
      if (ng < g[n]) {
        if (g[n] === Infinity) touched.push(n);
        g[n] = ng;
        parent[n] = k;
        fScore[n] = ng + h(n);
        push(n);
      }
    }
  }
  if (parent[goal] < 0 && goal !== start) return null;
  const cells: number[] = [];
  for (let k = goal; k !== -1; k = parent[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map(centre);
  pts[pts.length - 1] = walkable(tx, tz) ? { x: tx, z: tz } : pts[pts.length - 1];
  // Greedy smoothing: jump to the farthest waypoint still in straight-line view.
  const out: { x: number; z: number }[] = [];
  let anchor = { x: sx, z: sz };
  // Starting on a seat or against a wall: step out to the nearest free cell first.
  if (!walkable(sx, sz) && pts.length > 1) {
    out.push(pts[0]);
    anchor = pts[0];
  }
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOfSight(anchor, pts[j])) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j;
  }
  if (!out.length) out.push(pts[pts.length - 1]);
  return out;
}

/** A random walkable spot, preferring paving. */
export function randomWalkable(rand: () => number, bounds: Rect = { x0: -62, x1: 58, z0: -38, z1: 32 }) {
  for (let n = 0; n < 400; n++) {
    const x = bounds.x0 + rand() * (bounds.x1 - bounds.x0);
    const z = bounds.z0 + rand() * (bounds.z1 - bounds.z0);
    if (walkable(x, z) && (isPaved(x, z) || rand() < 0.25)) return { x, z };
  }
  return { x: 0, z: 2 };
}
