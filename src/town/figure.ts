// The townsfolk's refined figure: an oval head with a gentle jaw, a neck, a tapered torso over separate hips,
// slimmer arms with mitten hands, shaped shoes, hair and hats with real silhouettes, and faces with brows and a nose.
// Every geometry is built once here and shared by all ~80 people (no textures, no per-person allocation).
// "?style=classic" in the URL keeps the original chibi figure (Crowd.tsx and kits.tsx keep that code path as it was).
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Hat, HairStyle } from "./crowdSim";

/** ?style=classic: the original chibi townsfolk. Read once. */
export const CLASSIC = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("style") === "classic";

type V3 = [number, number, number];

// ---- proportions (local units, before the crowd's 1.3× scale) ------------------------------------------------

/** Head half-sizes (an ellipsoid, a little taller than wide) and where it sits. */
export const HEAD = { w: 0.28, h: 0.3, d: 0.272, y: 1.19, z: 0.02 };
const JAW = 0.3; // how much the lower half narrows toward the chin
export const FIG = {
  hipY: 0.46, // leg pivots
  legX: 0.088,
  legLen: 0.4,
  shoulderY: 0.85,
  hand: 0.345, // hand centre below the shoulder pivot
  waistY: 0.535,
  depth: 0.8, // the torso is flatter front to back than side to side
  hipDepth: 0.84,
};
/** Shoulder pivot x for a body width. */
export const armX = (bw: number) => 0.206 * bw + 0.05;

// torso silhouette (radius, height): wider at the shoulders, tapering to the waist, sloping into the neck
const TORSO: [number, number][] = [
  [0, 0.5], [0.148, 0.5], [0.151, 0.54], [0.158, 0.6], [0.175, 0.68], [0.194, 0.76], [0.211, 0.815], [0.214, 0.85],
  [0.204, 0.882], [0.174, 0.906], [0.136, 0.924], [0.088, 0.936], [0, 0.94],
];
const HIPS: [number, number][] = [[0, 0.385], [0.11, 0.388], [0.15, 0.405], [0.166, 0.435], [0.167, 0.47], [0.159, 0.51], [0.15, 0.545], [0, 0.55]];

/** The torso's radius (before the body-width scale) at a height. */
export function torsoR(y: number) {
  for (let i = 2; i < TORSO.length; i++) {
    const [r1, y1] = TORSO[i];
    if (y <= y1) {
      const [r0, y0] = TORSO[i - 1];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
    }
  }
  return 0;
}
/** The torso's front surface (z) at a height, for gear worn on the chest. */
export const chest = (y: number, bw: number) => torsoR(y) * bw * FIG.depth;

/** The head's surface depth at (x, y) in head space, for placing face features. */
export function faceZ(x: number, y: number) {
  const ny = y / HEAD.h;
  const k = ny < 0 ? 1 - JAW * ny * ny : 1;
  const nx = x / (HEAD.w * k);
  return HEAD.d * k * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
}

// face layout (head space)
export const EYE = { x: 0.098, y: 0.004 };
const eyeZ = faceZ(EYE.x, EYE.y) - 0.012;
const eyeYaw = 0.36;
export const BROW = { x: 0.1, y: 0.094, z: faceZ(0.1, 0.094) - 0.004, yaw: 0.37 };
export const MOUTH = { y: -0.112, z: faceZ(0, -0.112) - 0.006 };
/** Hats from the residents' kits were made for the classic round head (radius 0.33): this fits them on the new one. */
export const HAT_FIT = { s: 0.88, y: 0.025 };

// ---- helpers ---------------------------------------------------------------------------------------------------

/** No textures: drop uvs so any two parts can be merged into one draw call. */
function bare(g: THREE.BufferGeometry) {
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}
function mtx(p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
}
/** A copy of a geometry moved into place. */
function place(g: THREE.BufferGeometry, p?: V3, r?: V3, s?: V3) {
  return bare(g.clone()).applyMatrix4(mtx(p, r, s));
}
const merge = (...gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(bare))!;
/** Weld seams and recompute normals, for geometry whose vertices were reshaped. */
function smooth(g: THREE.BufferGeometry) {
  bare(g).deleteAttribute("normal");
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}
/** Reshape a unit sphere vertex by vertex. */
function shaped(w: number, h: number, f: (x: number, y: number, z: number) => V3) {
  const g = new THREE.SphereGeometry(1, w, h);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...f(p.getX(i), p.getY(i), p.getZ(i)));
  return smooth(g);
}
const lathe = (pts: [number, number][], seg: number) => bare(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
/** Point a piece's +y along a direction. */
function aim(g: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3, s: V3 = [1, 1, 1]) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return bare(g.clone()).applyMatrix4(new THREE.Matrix4().compose(at, q, new THREE.Vector3(...s)));
}

// ---- hair ------------------------------------------------------------------------------------------------------

interface Shell {
  front: number; // hairline polar angle from the crown, at the forehead (radians)
  side: number; // …over the ears
  back: number; // …at the nape
  part?: number; // a side part: one side of the fringe hangs lower (+ = the figure's left)
  notch?: number; // a centre parting lifts the fringe in the middle
  puff?: number; // volume all round
  top?: number; // extra volume on the crown
  swell?: [number, number, number, number]; // [azimuth, polar angle, amount, width]: a soft mound of volume (a swept fringe)
  parting?: number; // azimuth of a side parting: a shallow groove from the fringe back toward the crown
  tips?: [number, number, number?]; // [count round the head, depth, offset]: the fringe falls in points across the forehead
  strands?: number; // shallow grooves running from the crown, so the shell reads as hair rather than a helmet
  segs?: number; // resolution round the head (the hair under a hat needs far less)
  rings?: number;
}

/** Where a point of the hair shell sits: on the head ellipsoid (jaw included), pushed out by r (and `top` above). */
function shellPoint(a: number, th: number, r: number, top: number) {
  const sy = Math.cos(th);
  const sxz = Math.sin(th);
  const k = sy < 0 ? 1 - JAW * sy * sy : 1;
  const up = sy > 0 ? 1 + (top - 1) * sy : 1;
  return new THREE.Vector3(Math.sin(a) * sxz * HEAD.w * k * r, sy * HEAD.h * r * up, Math.cos(a) * sxz * HEAD.d * k * r);
}

/** A hair cap that follows the head, with a shaped hairline and a tucked edge so it reads as thick hair. */
function shell(o: Shell) {
  const segs = o.segs ?? 56;
  const rings = o.rings ?? 9;
  const puff = o.puff ?? 1.07;
  const top = o.top ?? 1.08;
  const line = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const f = Math.max(0, c);
    const b = Math.max(0, -c);
    const d = Math.atan2(s, c);
    let t = o.side + (o.front - o.side) * f * f + (o.back - o.side) * b * b + (o.part ?? 0) * s * f - (o.notch ?? 0) * Math.exp((-d * d) / 0.05);
    if (o.tips) {
      const w = 0.5 + 0.5 * Math.cos(o.tips[0] * (a + (o.tips[2] ?? 0)));
      t += o.tips[1] * w * w * Math.exp((-d * d) / 0.45);
    }
    return t;
  };
  const dirOf = (a: number, th: number) => new THREE.Vector3(Math.sin(th) * Math.sin(a), Math.cos(th), Math.sin(th) * Math.cos(a));
  const sw = o.swell ? dirOf(o.swell[0], o.swell[1]) : null;
  /** volume at a point of the shell: the base puff, a swell, a parting groove */
  const vol = (a: number, th: number, edge: number) => {
    let r = puff;
    if (o.swell && sw) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dirOf(a, th).dot(sw))));
      r += o.swell[2] * Math.exp(-(ang * ang) / (o.swell[3] * o.swell[3]));
    }
    if (o.strands) r *= 1 + o.strands * Math.cos(a * 14) * Math.min(1, th * 2.5);
    if (o.parting !== undefined) {
      const d = Math.atan2(Math.sin(a - o.parting), Math.cos(a - o.parting));
      const along = Math.min(1, Math.max(0, (th - 0.12) / 0.25)) * Math.min(1, Math.max(0, (edge - th) / 0.12));
      r -= 0.035 * Math.exp(-(d * d) / 0.012) * along;
    }
    return r;
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const crown = shellPoint(0, 0, puff, top);
  pos.push(crown.x, crown.y, crown.z);
  for (let j = 1; j <= rings + 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const edge = line(a);
      const th = (edge * j) / rings;
      // the last ring tucks back in to the scalp just under the hairline: a visible thickness at the edge
      const p = j <= rings ? shellPoint(a, th, vol(a, th, edge), top) : shellPoint(a, edge + 0.05, 0.985, 1);
      pos.push(p.x, p.y, p.z);
    }
  }
  const v = (i: number, j: number) => 1 + (j - 1) * segs + (i % segs);
  for (let i = 0; i < segs; i++) idx.push(0, v(i, 1), v(i + 1, 1));
  for (let j = 1; j <= rings; j++) {
    for (let i = 0; i < segs; i++) idx.push(v(i, j), v(i, j + 1), v(i + 1, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const ball = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
/** A teardrop lock (ponytail, pigtail): hangs down from its root at the origin. */
const tail = (r: number, len: number) => lathe([[0, 0.01], [r * 0.6, 0], [r, -len * 0.25], [r * 0.92, -len * 0.6], [r * 0.5, -len * 0.9], [0, -len]], 10);

function spiky() {
  // flattened tufts swept up and back from the fringe, smaller toward the back: a quiff, not a hedgehog
  const tuft = new THREE.ConeGeometry(0.065, 0.17, 6);
  // [azimuth, polar angle, size]: a big quiff over the fringe, smaller tufts behind it, all swept back
  const tips: [number, number, number][] = [[0, 0.55, 1.15], [0.5, 0.75, 0.95], [-0.5, 0.75, 0.95], [0, 0.15, 0.9], [1.4, 0.95, 0.75], [-1.4, 0.95, 0.75], [Math.PI, 0.7, 0.75]];
  return merge(
    shell({ front: 0.95, side: 1.4, back: 1.9, part: 0.15, puff: 1.07, top: 1.06 }),
    ...tips.map(([a, th, s]) => {
      const at = shellPoint(a, th, 1.02, 1.06);
      const dir = shellPoint(a, th, 1, 1).normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.55, -0.9));
      return aim(tuft, at.add(dir.clone().normalize().multiplyScalar(0.045 * s)), dir, [s, s, s * 0.55]);
    }),
  );
}

function afro() {
  // one soft cloud with a gently scalloped outline (displaced, so it stays a single smooth shape)
  const cloud = shaped(20, 14, (x, y, z) => {
    const a = Math.atan2(x, z);
    const bump = 1 + 0.045 * Math.cos(a * 7) * Math.sin(Math.acos(Math.max(-1, Math.min(1, y)))) + 0.035 * Math.cos(y * 9);
    return [x * 0.38 * bump, y * 0.33 * bump + 0.13, z * 0.34 * bump - 0.11];
  });
  return merge(shell({ front: 0.95, side: 1.45, back: 1.95, puff: 1.06 }), cloud);
}

function hairFor(style: HairStyle): THREE.BufferGeometry | null {
  switch (style) {
    case "bald":
      // a horseshoe of hair round the back and over the ears
      return merge(
        place(ball(0.1, 10, 8), [0.255, 0.01, -0.07], [0, 0.3, 0], [0.45, 0.62, 1.15]),
        place(ball(0.1, 10, 8), [-0.255, 0.01, -0.07], [0, -0.3, 0], [0.45, 0.62, 1.15]),
        place(ball(0.1, 12, 8), [0, -0.01, -0.235], [0, 0, 0], [1.9, 0.6, 0.55]),
      );
    case "afro":
      return afro();
    case "long":
      return merge(
        shell({ front: 1.08, side: 1.82, back: 2.25, notch: 0.22, puff: 1.08, top: 1.08, parting: 0, strands: 0.014 }),
        // the length down the back, and two locks framing the face
        place(ball(1, 16, 12), [0, -0.12, -0.13], [0.12, 0, 0], [0.285, 0.36, 0.17]),
        place(tail(0.06, 0.26), [0.225, -0.02, 0.07], [0.05, 0, 0.1]),
        place(tail(0.06, 0.26), [-0.225, -0.02, 0.07], [0.05, 0, -0.1]),
      );
    case "bun":
      return merge(shell({ front: 0.98, side: 1.5, back: 1.85, notch: 0.12, puff: 1.06, top: 1.06, parting: 0, strands: 0.014 }), place(ball(0.11, 12, 10), [0, 0.3, -0.12]), place(ball(0.055, 8, 6), [0, 0.27, -0.06]));
    case "pony":
      // a swept fringe, and a high ponytail that swings out to one side so it shows from the front too
      return merge(
        shell({ front: 0.96, side: 1.45, back: 1.8, part: 0.28, puff: 1.06, top: 1.06, parting: -0.55, swell: [0.35, 0.62, 0.07, 0.5], tips: [13, 0.13, 0.1], strands: 0.012 }),
        place(ball(0.06, 8, 6), [0.03, 0.15, -0.3]),
        place(tail(0.078, 0.38), [0.04, 0.15, -0.32], [0.5, 0, 0.32]),
      );
    case "pigtails":
      return merge(
        shell({ front: 1.16, side: 1.55, back: 1.9, puff: 1.07, top: 1.05, tips: [20, 0.05], strands: 0.01 }),
        place(tail(0.07, 0.27), [0.27, 0.06, -0.07], [0, 0, 0.55]),
        place(tail(0.07, 0.27), [-0.27, 0.06, -0.07], [0, 0, -0.55]),
      );
    case "spiky":
      return spiky();
    default:
      // short: a side parting, the fringe swept across with a little lift
      return shell({ front: 0.93, side: 1.42, back: 1.92, part: -0.3, puff: 1.06, top: 1.05, parting: 0.6, swell: [-0.3, 0.6, 0.07, 0.55], tips: [12, 0.14, -0.12], strands: 0.012 });
  }
}

const HAIR_STYLES: HairStyle[] = ["short", "bun", "long", "bald", "pony", "pigtails", "afro", "spiky"];

// ---- hats (fitted to the new head) ---------------------------------------------------------------------------

/** A dome (the top of a sphere down to `cut`), optionally ribbed like knitting. */
function dome(r: V3, cut: number, ribs = 0) {
  const g = new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, cut);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const k = 1 + ribs * Math.cos(Math.atan2(x, z) * 14) * Math.min(1, Math.hypot(x, z) * 1.5);
    p.setXYZ(i, x * r[0] * k, p.getY(i) * r[1], z * r[2] * k);
  }
  return smooth(g);
}

function hats(): Record<Exclude<Hat, "none">, THREE.BufferGeometry> {
  return {
    // a baseball cap: a shallow crown that hugs the head above the brows, and a button (the brim is drawn on its own)
    cap: merge(place(dome([0.3, 0.225, 0.296], Math.PI * 0.5), [0, 0.115, -0.01], [-0.2, 0, 0]), place(ball(0.026, 8, 6), [0, 0.335, -0.075])),
    sunhat: merge(
      place(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 24), [0, 0.2, 0]),
      place(new THREE.CylinderGeometry(0.24, 0.27, 0.2, 18), [0, 0.3, 0]),
    ),
    // a ribbed knitted beanie with a turned-up cuff (the pom is drawn on its own, in white)
    beanie: merge(
      place(dome([0.3, 0.31, 0.298], Math.PI * 0.5, 0.018), [0, 0.1, -0.01], [-0.15, 0, 0]),
      place(new THREE.TorusGeometry(0.288, 0.038, 8, 28), [0, 0.11, -0.01], [Math.PI / 2 - 0.15, 0, 0], [1, 0.97, 1]),
    ),
    chef: merge(place(new THREE.CylinderGeometry(0.22, 0.24, 0.26, 16), [0, 0.32, 0]), place(ball(1, 14, 10), [0, 0.5, 0], [0, 0, 0], [0.28, 0.16, 0.28])),
  };
}
/** The cap's brim, in a darker shade so the cap reads as a cap from above. Short and tipped up: the eyes stay visible. */
const capBrim = () => place(new THREE.CylinderGeometry(0.17, 0.17, 0.022, 18, 1, false, -Math.PI / 2, Math.PI), [0, 0.165, 0.215], [-0.06, 0, 0], [1.05, 1, 1.15]);

// ---- the figure ------------------------------------------------------------------------------------------------

function head() {
  const skull = shaped(22, 15, (x, y, z) => {
    const k = y < 0 ? 1 - JAW * y * y : 1;
    return [x * HEAD.w * k, y * HEAD.h, z * HEAD.d * k];
  });
  const ear = ball(0.058, 8, 6);
  return merge(
    skull,
    place(ear, [HEAD.w - 0.014, -0.025, -0.01], [0, 0.25, 0], [0.48, 0.9, 0.72]),
    place(ear, [-(HEAD.w - 0.014), -0.025, -0.01], [0, -0.25, 0], [0.48, 0.9, 0.72]),
    // a small button nose
    place(ball(0.034, 8, 6), [0, -0.05, faceZ(0, -0.05) - 0.012], [0, 0, 0], [1.15, 0.85, 0.95]),
  );
}

/** Both eyes in one piece, and both highlights in another (two draw calls instead of six). */
function eyes() {
  const eye = ball(0.048, 12, 8);
  const shine = ball(0.017, 6, 4);
  const sparkle = ball(0.0085, 5, 4);
  const dark: THREE.BufferGeometry[] = [];
  const light: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const m = mtx([s * EYE.x, EYE.y, eyeZ], [-0.06, s * eyeYaw, 0]);
    dark.push(place(eye, [0, 0, 0], [0, 0, 0], [0.8, 1.2, 0.5]).applyMatrix4(m));
    light.push(place(shine, [0.015, 0.024, 0.021]).applyMatrix4(m), place(sparkle, [-0.013, -0.02, 0.021]).applyMatrix4(m));
  }
  return { eyes: merge(...dark), shine: merge(...light) };
}

function brow() {
  // a soft arc, its middle at the origin; flattened onto the face
  const arc = 0.95;
  return bare(new THREE.TorusGeometry(0.075, 0.0135, 5, 10, arc))
    .rotateZ(Math.PI / 2 - arc / 2)
    .translate(0, -0.075, 0)
    .scale(1, 1, 0.55);
}

function blush() {
  const b = ball(0.044, 8, 5);
  const x = 0.165;
  const y = -0.058;
  const z = faceZ(x, y) - 0.006;
  return merge(place(b, [x, y, z], [0, 0.62, 0], [1, 0.52, 0.3]), place(b, [-x, y, z], [0, -0.62, 0], [1, 0.52, 0.3]));
}

function glasses() {
  const lens = new THREE.TorusGeometry(0.05, 0.0095, 6, 18);
  const z = eyeZ + 0.034;
  return merge(
    place(lens, [EYE.x, EYE.y + 0.006, z], [0, 0.3, 0]),
    place(lens, [-EYE.x, EYE.y + 0.006, z], [0, -0.3, 0]),
    place(new THREE.BoxGeometry(0.06, 0.012, 0.012), [0, EYE.y + 0.02, faceZ(0, EYE.y) + 0.026]),
  );
}

// arms: a long sleeve with a cuff lip, or a short sleeve over a bare forearm (y runs down from the shoulder pivot)
const LONG_SLEEVE: [number, number][] = [[0, 0.056], [0.034, 0.052], [0.054, 0.032], [0.062, 0.0], [0.06, -0.07], [0.053, -0.18], [0.048, -0.262], [0.055, -0.268], [0.056, -0.292], [0.036, -0.298], [0, -0.3]];
const SHORT_SLEEVE: [number, number][] = [[0, 0.056], [0.034, 0.052], [0.056, 0.032], [0.065, 0.0], [0.066, -0.09], [0.069, -0.135], [0.045, -0.142], [0, -0.143]];

function hand(side: 1 | -1) {
  // a mitten: a flattened palm and a small thumb on the inside front
  return merge(place(ball(0.054, 10, 6), [0, -FIG.hand, 0], [0, 0, 0], [0.88, 1.1, 0.72]), place(ball(0.024, 6, 4), [-side * 0.036, -FIG.hand + 0.012, 0.022], [0, 0, 0], [1, 1.35, 1]));
}

function forearm(side: 1 | -1) {
  return merge(place(new THREE.CylinderGeometry(0.046, 0.04, 0.2, 8), [0, -0.21, 0]), hand(side));
}

function shoe() {
  return shaped(12, 8, (x, y, z) => {
    const toe = z > 0;
    return [x * (toe ? 0.066 : 0.057), (y < 0 ? y * 0.022 : y * 0.056) - 0.035, z * (toe ? 0.118 : 0.07) + 0.035];
  });
}

function collar() {
  const flap = new THREE.BoxGeometry(0.055, 0.05, 0.01);
  return merge(
    place(new THREE.TorusGeometry(0.084, 0.02, 5, 14), [0, 0.94, 0.004], [Math.PI / 2 + 0.12, 0, 0]),
    // the two points of a shirt collar, lying on the chest
    place(flap, [0.034, 0.927, 0.1], [-1.15, 0, 0.5]),
    place(flap, [-0.034, 0.927, 0.1], [-1.15, 0, -0.5]),
  );
}

const build = () => {
  const e = eyes();
  return {
    head: head(),
    eyes: e.eyes,
    shine: e.shine,
    brow: brow(),
    mouth: bare(new THREE.TorusGeometry(0.027, 0.0085, 5, 10, Math.PI)).rotateZ(Math.PI),
    blush: blush(),
    glasses: glasses(),
    neck: bare(new THREE.CylinderGeometry(0.056, 0.064, 0.15, 10)),
    torso: lathe(TORSO, 20),
    hips: lathe(HIPS, 18),
    belt: bare(new THREE.TorusGeometry(0.152, 0.021, 5, 18)).rotateX(Math.PI / 2),
    collar: collar(),
    leg: bare(new THREE.CylinderGeometry(0.072, 0.056, FIG.legLen, 10)).translate(0, -FIG.legLen / 2, 0),
    shoe: shoe(),
    sleeveLong: lathe(LONG_SLEEVE, 10),
    sleeveShort: lathe(SHORT_SLEEVE, 10),
    handL: hand(1),
    handR: hand(-1),
    forearmL: forearm(1),
    forearmR: forearm(-1),
    belly: bare(new THREE.SphereGeometry(0.2, 12, 10)).scale(1.1, 1, 0.85),
    skirt: new THREE.CylinderGeometry(0.152, 0.27, 0.25, 18, 1, true),
    apron: new THREE.BoxGeometry(0.34, 0.42, 0.025),
    scarf: bare(new THREE.TorusGeometry(0.115, 0.05, 8, 18)).rotateX(Math.PI / 2),
    // a rounded top, so it reads as a soft rucksack rather than a box
    backpack: merge(place(new THREE.BoxGeometry(0.28, 0.3, 0.12)), place(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 10), [0, 0.15, 0], [0, 0, Math.PI / 2])),
    pom: ball(0.075, 8, 6),
    phone: new THREE.BoxGeometry(0.085, 0.18, 0.026),
    hair: Object.fromEntries(HAIR_STYLES.map((s) => [s, hairFor(s)])) as Record<HairStyle, THREE.BufferGeometry | null>,
    // the little hair that shows under a hat: sideburns and the nape
    hatHair: shell({ front: 0.7, side: 1.5, back: 1.9, puff: 1.04, top: 1, segs: 28, rings: 5 }),
    hats: hats(),
    capBrim: capBrim(),
  };
};

/** Shared refined geometry (built only when the refined figure is in use). */
export const G2 = CLASSIC ? (null as unknown as ReturnType<typeof build>) : build();

// ---- expression --------------------------------------------------------------------------------------------------

/**
 * Brow shape for an acting pose: [raise, tilt]. Tilt > 0 pulls the inner ends down (cross, set on something),
 * < 0 lifts them (worried, unsure).
 */
export function browFor(kind: string): [number, number] {
  switch (kind) {
    case "angry":
    case "determined":
    case "yell":
    case "talk:complain":
    case "talk:deny":
    case "talk:warn":
      return [-0.008, 0.38];
    case "worried":
    case "nervous":
    case "doubt":
    case "ponder":
    case "facepalm":
      return [0.01, -0.36];
    case "startled":
      return [0.035, -0.12];
    case "excited":
    case "giggle":
    case "wave":
    case "clap":
    case "hawk":
    case "offer":
    case "talk:ask":
    case "talk:joke":
    case "shrug":
    case "photo":
    case "speech":
    case "bow":
      return [0.02, -0.08];
    default:
      return [0, 0];
  }
}

/** Acts with an open, talking mouth. */
export const openMouth = (kind: string) => kind.startsWith("talk") || kind === "yell" || kind === "hawk" || kind === "speech" || kind === "excited" || kind === "startled" || kind === "giggle";
