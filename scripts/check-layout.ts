// Top-down sanity check of the town plan. Run: node scripts/check-layout.ts
// Prints an ASCII map and lists buildings that overlap each other or the roads, and
// points of interest that sit inside something solid.
import * as L from "../src/town/layout.ts";

const CELL = 1.5;
const X0 = -72;
const X1 = 64;
const Z0 = -50;
const Z1 = 40;

const letter: Record<string, string> = {
  townhall: "T", police: "P", bakery: "B", flower: "F", ramen: "R", cafe: "C", mart: "M", news: "N", books: "K", seafood: "S", warehouse: "W", house: "h",
};
const roadChar: Record<string, string> = { cobble: ":", tile: ".", gravel: "~", asphalt: "=" };

function charAt(x: number, z: number): string {
  const b = L.BUILDINGS.find((o) => L.inObb(o, x, z));
  if (b) return letter[b.kind];
  if (L.isSea(x, z)) return " ";
  if (L.inPier(x, z)) return "+";
  if (L.inQuay(x, z)) return "_";
  if (L.onCrossing(x, z) && L.onMainSidewalk(x, z)) return "x";
  if (L.onMainCarriageway(x, z)) return "=";
  if (L.onMainSidewalk(x, z)) return "-";
  const road = L.sampled.roads.find((r) => L.distToPolyline(x, z, r.line) <= r.width / 2);
  if (road) return roadChar[road.surface];
  if (L.inPlaza(x, z) || L.inPatch(x, z)) return "#";
  if (L.inYard(x, z)) return "y";
  if (Math.hypot(x - L.POND.x, z - L.POND.z) < L.POND.r) return "o";
  if (L.FILL_TREES.some((t) => Math.hypot(t.x - x, t.z - z) < t.r)) return "t";
  if (L.inPolygon(x, z, L.GREEN)) return ",";
  if (!L.inPolygon(x, z, L.TOWN_EDGE)) return "^";
  return " ";
}

const rows: string[] = [];
for (let z = Z0; z <= Z1; z += CELL) {
  let row = "";
  for (let x = X0; x <= X1; x += CELL / 2) row += charAt(x, z);
  rows.push(row);
}
console.log(rows.join("\n"));
console.log("\nT town hall  P police  B bakery  F flower  R ramen  C cafe  M mart  N news  K books  S seafood  W warehouse  h house");
console.log("= road  - sidewalk  x crossing  : cobble  . tile  ~ gravel  # plaza  , green  y yard  _ quay  + pier  o pond  t trees  ^ outside town\n");

// Separating-axis test for two oriented boxes.
function obbOverlap(a: L.Obb, b: L.Obb, pad = 0) {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2].map((r) => [Math.cos(r), -Math.sin(r)]);
  const corners = (o: L.Obb) =>
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => L.fromLocal(o, (sx * (o.w + pad)) / 2, (sz * (o.d + pad)) / 2));
  const ca = corners(a);
  const cb = corners(b);
  return axes.every(([ax, az]) => {
    const pa = ca.map((p) => p.x * ax + p.z * az);
    const pb = cb.map((p) => p.x * ax + p.z * az);
    return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
  });
}

const problems: string[] = [];
for (let i = 0; i < L.BUILDINGS.length; i++)
  for (let j = i + 1; j < L.BUILDINGS.length; j++)
    if (obbOverlap(L.BUILDINGS[i], L.BUILDINGS[j], 0.6)) problems.push(`buildings too close: ${L.BUILDINGS[i].id} / ${L.BUILDINGS[j].id}`);

for (const b of L.BUILDINGS) {
  let onStreet = 0;
  for (let lx = -b.w / 2; lx <= b.w / 2; lx += 0.5)
    for (let lz = -b.d / 2; lz <= b.d / 2; lz += 0.5) {
      const p = L.fromLocal(b, lx, lz);
      if (L.onMainSidewalk(p.x, p.z) || L.onRoad(p.x, p.z) || L.inPlaza(p.x, p.z) || L.isSea(p.x, p.z)) onStreet++;
    }
  if (onStreet) problems.push(`building ${b.id} covers ${onStreet} street/plaza/sea sample points`);
  const front = L.fromLocal(b, 0, b.d / 2 + (b.yard?.front ?? 0) + 1.2);
  const reach = L.onMainSidewalk(front.x, front.z) || L.onRoad(front.x, front.z, 1.5) || L.inPlaza(front.x, front.z) || L.inPatch(front.x, front.z) || L.inQuay(front.x, front.z);
  if (!reach) problems.push(`building ${b.id}: nothing walkable right outside its front door (${front.x.toFixed(1)}, ${front.z.toFixed(1)})`);
}
for (const y of L.YARDS) {
  // the gate edge may touch the lane; check the inside of the yard only
  for (let lx = -y.w / 2 + 0.3; lx <= y.w / 2 - 0.3; lx += 0.5)
    for (let lz = -y.d / 2 + 0.3; lz <= y.d / 2 - 0.3; lz += 0.5) {
      const p = L.fromLocal(y, lx, lz);
      if (L.onMainSidewalk(p.x, p.z) || L.onRoad(p.x, p.z)) {
        problems.push(`yard of ${y.house} (${y.side}) runs into a street`);
        lx = lz = Infinity;
      }
    }
}
for (const p of L.POIS) {
  if (L.inBuilding(p.x, p.z) || L.isSea(p.x, p.z) || L.OBSTACLE_OBBS.some((o) => L.inObb(o, p.x, p.z, 0.1))) problems.push(`POI ${p.activity} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is inside something`);
}
console.log(problems.length ? problems.join("\n") : "no layout problems found");
console.log(`\n${L.BUILDINGS.length} buildings, ${L.FILL_TREES.length} fill trees, ${L.POIS.length} points of interest, ${L.FENCES.length} fence segments`);
