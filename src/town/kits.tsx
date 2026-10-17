"use client";

// Signature costume kits for the 8 core residents (and the two officers), plus their gait and idle tells.
// Display only: looks are remapped at render time, so crowdSim's data and RNG stream stay untouched.
import { useRef, type FC, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Look } from "./crowdSim";
import type { Pose } from "./Crowd";
import { POST_NPC } from "./director";
import { mat } from "./materials";

type V3 = [number, number, number];

/** A copy of a geometry moved into place, ready to be merged with others into one draw call. */
function part(g: THREE.BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
  return g.clone().applyMatrix4(m);
}
const merge = (...gs: THREE.BufferGeometry[]) => mergeGeometries(gs)!;
const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const cyl = (top: number, bottom: number, h: number, seg = 12) => new THREE.CylinderGeometry(top, bottom, h, seg);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

// Kit geometry, in the same local units as the townsfolk (head space for hats, hand space for held props).
const K = {
  // mayor
  topBrim: cyl(0.42, 0.42, 0.035, 22),
  topCrown: cyl(0.23, 0.24, 0.5, 18),
  topBand: cyl(0.247, 0.247, 0.08, 18),
  sash: new THREE.TorusGeometry(0.235, 0.04, 6, 24).rotateX(Math.PI / 2),
  medal: cyl(0.065, 0.065, 0.025, 12).rotateX(Math.PI / 2),
  lapel: sphere(0.05, 8, 6),
  cane: merge(part(cyl(0.024, 0.02, 0.62, 6), [0, -0.27, 0]), part(sphere(0.05, 8, 6), [0, 0.05, 0])),
  // police
  // only a slight flare, so the band below the crown still shows from the high camera
  capCrown: cyl(0.36, 0.32, 0.17, 18),
  capBand: cyl(0.336, 0.33, 0.08, 18),
  visor: new THREE.CylinderGeometry(0.21, 0.21, 0.03, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.05),
  capBadge: new THREE.OctahedronGeometry(0.06),
  belt: new THREE.TorusGeometry(0.212, 0.04, 6, 20).rotateX(Math.PI / 2),
  buckle: box(0.1, 0.075, 0.03),
  star: new THREE.OctahedronGeometry(0.06),
  epaulette: box(0.16, 0.04, 0.15),
  baton: cyl(0.03, 0.03, 0.42, 6),
  // journalist
  beret: merge(
    part(new THREE.SphereGeometry(0.33, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0, 0], [0, 0, 0], [1.16, 0.55, 1.16]),
    part(cyl(0.025, 0.03, 0.07, 6), [0, 0.2, 0]),
  ),
  camera: box(0.24, 0.15, 0.1),
  lens: cyl(0.06, 0.065, 0.1, 12).rotateX(Math.PI / 2),
  strap: new THREE.TorusGeometry(0.2, 0.014, 4, 20).rotateX(Math.PI / 2),
  notebook: box(0.16, 0.21, 0.035),
  // baker
  toque: merge(part(cyl(0.25, 0.27, 0.6, 14), [0, 0, 0]), part(sphere(0.34, 14, 10), [0, 0.34, 0], [0, 0, 0], [1, 0.55, 1])),
  moustache: new THREE.CapsuleGeometry(0.032, 0.13, 3, 6).rotateZ(Math.PI / 2),
  baguette: new THREE.CapsuleGeometry(0.06, 0.5, 4, 8),
  // florist (her own sunhat: a little narrower than the townsfolk's, so it never hides whoever she is talking to)
  sunBrim: cyl(0.5, 0.5, 0.035, 22),
  sunCrown: cyl(0.29, 0.33, 0.22, 18),
  ribbon: new THREE.CylinderGeometry(0.338, 0.338, 0.075, 18, 1, true),
  petals: merge(...[0, 1, 2, 3, 4].map((i) => part(sphere(0.075, 8, 6), [Math.cos((i * Math.PI * 2) / 5) * 0.09, Math.sin((i * Math.PI * 2) / 5) * 0.09, 0], [0, 0, 0], [1, 1, 0.55]))),
  flowerHeart: sphere(0.055, 8, 6),
  doveBody: merge(part(sphere(0.1, 10, 8), [0, 0, 0], [0, 0, 0], [1, 0.85, 1.4]), part(sphere(0.065, 8, 6), [0, 0.09, 0.11]), part(box(0.1, 0.02, 0.12), [0, 0.02, -0.15], [0.3, 0, 0])),
  doveBeak: new THREE.ConeGeometry(0.022, 0.06, 4).rotateX(Math.PI / 2),
  doveEyes: merge(part(sphere(0.016, 6, 4), [0.05, 0.11, 0.14]), part(sphere(0.016, 6, 4), [-0.05, 0.11, 0.14])),
  wrap: new THREE.ConeGeometry(0.11, 0.3, 10, 1, true).rotateX(Math.PI),
  blooms: merge(...[[0, 0.03, 0], [0.07, 0, 0.03], [-0.07, 0, 0.02], [0.02, 0.01, -0.07], [-0.02, 0.07, -0.01]].map((p) => part(sphere(0.07, 8, 6), p as V3))),
  // café
  bandana: new THREE.SphereGeometry(0.362, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.36),
  tray: cyl(0.21, 0.21, 0.025, 18),
  cup: merge(part(cyl(0.05, 0.04, 0.09, 10), [0, 0.06, 0]), part(cyl(0.085, 0.085, 0.012, 12), [0, 0.012, 0])),
  // organizer
  headset: merge(
    new THREE.TorusGeometry(0.362, 0.022, 4, 18, Math.PI),
    part(cyl(0.08, 0.08, 0.06, 10), [0.36, 0, 0], [0, 0, Math.PI / 2]),
    part(cyl(0.08, 0.08, 0.06, 10), [-0.36, 0, 0], [0, 0, Math.PI / 2]),
    part(cyl(0.012, 0.012, 0.26, 4), [-0.3, -0.12, 0.17], [1.15, 0, 0.25]),
    part(sphere(0.035, 6, 4), [-0.26, -0.16, 0.29]),
  ),
  stripes: merge(part(new THREE.TorusGeometry(0.214, 0.02, 4, 20), [0, 0.56, 0], [Math.PI / 2, 0, 0]), part(new THREE.TorusGeometry(0.214, 0.02, 4, 20), [0, 0.74, 0], [Math.PI / 2, 0, 0])),
  pass: box(0.09, 0.12, 0.012),
  board: merge(box(0.22, 0.29, 0.02), part(box(0.07, 0.035, 0.03), [0, 0.14, 0.012])),
  paper: box(0.18, 0.22, 0.006),
  // vendor
  hachimaki: merge(
    part(new THREE.TorusGeometry(0.345, 0.04, 6, 22), [0, 0, 0], [Math.PI / 2, 0, 0]),
    part(box(0.06, 0.18, 0.025), [0.05, -0.08, -0.35], [0, 0, 0.4]),
    part(box(0.06, 0.18, 0.025), [-0.05, -0.08, -0.35], [0, 0, -0.4]),
  ),
  sun: cyl(0.06, 0.06, 0.012, 12).rotateX(Math.PI / 2),
  boat: box(0.32, 0.04, 0.18),
  balls: merge(...[-0.1, 0, 0.1].flatMap((x) => [-0.045, 0.045].map((z) => part(sphere(0.045, 8, 6), [x, 0.04, z])))),
};

// Shared kit materials (mat() caches by colour, so nothing here is ever mutated).
const M = {
  silk: mat("#1d1d1f", 0.35),
  red: mat("#c0392b", 0.6),
  gold: mat("#d4af37", 0.35, 0.6),
  silver: mat("#c8ced6", 0.35, 0.5),
  black: mat("#1d1d1f", 0.6),
  pink: mat("#ff6fa0", 0.6),
  white: mat("#ffffff", 0.6),
  cream: mat("#fffdf4", 0.7),
  chiefCap: mat("#1a2a55", 0.6),
  officerBand: mat("#22305f", 0.6),
  visor: mat("#111111", 0.3),
  beret: mat("#a23b4f", 0.8),
  camera: mat("#2b2b2b", 0.4),
  crust: mat("#d9a066", 0.7),
  yellow: mat("#ffd23f", 0.6),
  dove: mat("#f4f4f4", 0.7),
  beak: mat("#ff9f43", 0.6),
  kraft: mat("#e9d3a8", 0.8),
  bandana: mat("#f4a259", 0.8),
  tray: mat("#d7dbe0", 0.35, 0.4),
  reflect: mat("#f4f4f4", 0.3),
  clipboard: mat("#b07a45", 0.7),
  boat: mat("#c9874b", 0.8),
  takoyaki: mat("#b5651d", 0.7),
  straw: mat("#f2d16b", 0.7),
  greyHair: mat("#8d8d8d", 0.7),
  brownHair: mat("#4a2c1a", 0.7),
};

export interface Gait {
  stride: number; // leg swing
  arm: number; // arm swing
  bounce: number; // vertical bob per step
  cadence: number; // steps per metre (visual only: the walking speed never changes)
  sway: number; // side-to-side torso roll
  lean: number; // torso forward (+) / back (-) while walking
}
export const BASE_GAIT: Gait = { stride: 0.6, arm: 0.55, bounce: 0.06, cadence: 1, sway: 0.05, lean: 0 };

export interface GearProps {
  bw: number; // body width, so torso gear sits on the surface
}

export interface Kit {
  look: Partial<Look>;
  bw: number; // body width
  belly: number; // 0 = none
  gait: Gait;
  /** extra height for the emoji bubble over tall hats */
  top: number;
  apron?: { sx: number; sy: number; y: number };
  /** held prop stays level with the ground (trays) or hangs straight down (a cane) */
  level?: boolean;
  Head?: FC<GearProps>;
  Torso?: FC<GearProps>;
  Hand?: FC<GearProps>;
  /** always-on posture, walking included (a carried prop held up, a raised chin); never touches the right (phone) arm */
  hold?: (t: number) => Partial<Pose>;
  /** idle tells while standing at their post with nothing else going on */
  idle?: (t: number) => Partial<Pose>;
}

const smooth = (x: number) => {
  const v = Math.max(0, Math.min(1, x));
  return v * v * (3 - 2 * v);
};
/** 0 → 1 → 0 across [a, b] of a looping cycle, with soft ramps so a tell eases in and out. */
const pulse = (c: number, a: number, b: number, ramp = 0.3) => Math.min(smooth((c - a) / ramp), smooth((b - c) / ramp));
const front = (bw: number) => 0.205 * bw * 0.95; // the torso's front surface, chest height

// ---- gear ----------------------------------------------------------------------------------------

function PeakedCap({ band, badge }: { band: THREE.Material; badge: THREE.Material }) {
  return (
    <>
      <mesh geometry={K.capCrown} material={M.chiefCap} position={[0, 0.33, -0.01]} castShadow />
      <mesh geometry={K.capBand} material={band} position={[0, 0.265, -0.01]} />
      {/* a short, high visor: from the town's high camera it must never cover the eyes */}
      <mesh geometry={K.visor} material={M.visor} position={[0, 0.25, 0.27]} rotation={[0.1, 0, 0]} />
      <mesh geometry={K.capBadge} material={badge} position={[0, 0.34, 0.36]} />
    </>
  );
}

/** A dove perched on the florist's hat brim (in profile, so it reads as a bird) that pecks now and then. */
function Dove() {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g.current) g.current.rotation.x = t % 3.2 < 0.3 ? 0.55 : Math.sin(t * 3) * 0.08;
  });
  return (
    <group position={[-0.44, 0.3, 0.14]} rotation={[0, -Math.PI / 2, 0]}>
      <group ref={g}>
        <mesh geometry={K.doveBody} material={M.dove} castShadow />
        <mesh geometry={K.doveEyes} material={M.black} />
        <mesh geometry={K.doveBeak} material={M.beak} position={[0, 0.08, 0.2]} />
      </group>
    </group>
  );
}

const Wide = ({ bw, children }: { bw: number; children: ReactNode }) => <group scale={[bw, 1, bw * 0.95]}>{children}</group>;

// ---- the kits ------------------------------------------------------------------------------------

const KIT = {
  // 林市長: power. A tall top hat, a red sash, a cane; a slow walk with the chin up, a PR wave every few seconds.
  mayor: {
    look: { shirt: "#2b2d42", pants: "#1d1d28", hair: "#bdbdbd", hairStyle: "short", hat: "none", glasses: true, scarf: null, backpack: null, apron: null, skirt: false, blush: false, scale: 1.04 },
    bw: 1.15,
    belly: 1,
    top: 0.75,
    level: true,
    gait: { stride: 0.38, arm: 0.12, bounce: 0.02, cadence: 0.8, sway: 0.07, lean: -0.08 },
    Head: () => (
      <group rotation={[0.04, 0, -0.07]}>
        <mesh geometry={K.topBrim} material={M.silk} position={[0, 0.27, 0]} castShadow />
        <mesh geometry={K.topCrown} material={M.silk} position={[0, 0.52, 0]} castShadow />
        <mesh geometry={K.topBand} material={M.red} position={[0, 0.33, 0]} />
      </group>
    ),
    Torso: ({ bw }) => (
      <>
        <Wide bw={bw}>
          <mesh geometry={K.sash} material={M.red} position={[0, 0.7, 0.02]} rotation={[0, 0, 0.65]} />
        </Wide>
        <mesh geometry={K.medal} material={M.gold} position={[0, 0.7, front(bw) + 0.075]} />
        <mesh geometry={K.lapel} material={M.pink} position={[0.12, 0.86, front(bw) + 0.01]} />
      </>
    ),
    Hand: () => <mesh geometry={K.cane} material={M.silk} position={[0, 0, 0.02]} />,
    hold: () => ({ headX: -0.1 }), // chin up, always
    idle: (t) => {
      const w = pulse(t % 9, 0, 1.6, 0.35); // the PR wave
      return { armRx: 0.45 - 0.2 * w, armRz: 0.1 + (-2.1 + Math.sin(t * 10) * 0.35 - 0.1) * w, armLx: -0.15, lean: -0.1, headX: -0.12, headY: 0.25 * w };
    },
  },
  // 老周: enforcement. Peaked cap with a gold band, epaulettes, badge and belt; broader and taller than his officers.
  police: {
    look: { shirt: "#1f3b73", pants: "#1a1f36", hair: "#8d8d8d", hairStyle: "short", hat: "none", glasses: false, scarf: null, backpack: null, apron: null, skirt: false, blush: false, scale: 1.1 },
    bw: 1.18,
    belly: 0,
    top: 0.2,
    gait: { stride: 0.5, arm: 0.3, bounce: 0.03, cadence: 1, sway: 0.02, lean: -0.05 },
    Head: () => (
      <>
        <PeakedCap band={M.gold} badge={M.gold} />
        <mesh geometry={K.moustache} material={M.greyHair} position={[0, -0.015, 0.32]} />
      </>
    ),
    Torso: ({ bw }) => (
      <>
        <Wide bw={bw}>
          <mesh geometry={K.belt} material={M.black} position={[0, 0.5, 0]} />
        </Wide>
        <mesh geometry={K.buckle} material={M.gold} position={[0, 0.5, 0.21 * bw * 0.95 + 0.035]} />
        <mesh geometry={K.star} material={M.gold} position={[0.11, 0.78, front(bw) + 0.02]} />
        <mesh geometry={K.epaulette} material={M.gold} position={[0.18 * bw, 0.88, 0]} rotation={[0, 0, -0.45]} />
        <mesh geometry={K.epaulette} material={M.gold} position={[-0.18 * bw, 0.88, 0]} rotation={[0, 0, 0.45]} />
        <mesh geometry={K.baton} material={M.black} position={[-0.16 * bw, 0.42, 0.17 * bw]} rotation={[0.2, 0, 0.15]} />
      </>
    ),
    // hands clasped behind his back, slowly scanning the square
    idle: (t) => ({ armLx: 0.42, armRx: 0.42, armLz: -0.14, armRz: 0.14, lean: -0.06, squash: 1.015, headY: Math.sin(t * 0.5) * 0.55 }),
  },
  // the two officers: the same cap without the gold, a plain build, so the chief stands apart
  officer: {
    look: { shirt: "#3a5796", pants: "#2a2d45", hair: "#2b1d14", hat: "none", hairStyle: "short", glasses: false, scarf: null, backpack: null, apron: null, skirt: false, scale: 1.0 },
    bw: 1,
    belly: 0,
    top: 0.2,
    gait: BASE_GAIT,
    Head: () => <PeakedCap band={M.officerBand} badge={M.silver} />,
  },
  // 小雯: the amplifier. Beret, a camera on her chest, a mustard shirt and a notebook; a quick, bouncy walk.
  journalist: {
    look: { shirt: "#f2b705", pants: "#3d405b", hair: "#2b1d14", hairStyle: "pony", hat: "none", glasses: true, scarf: null, backpack: null, apron: null, skirt: false, blush: true, scale: 0.94 },
    bw: 0.9,
    belly: 0,
    top: 0.1,
    gait: { stride: 0.6, arm: 0.45, bounce: 0.09, cadence: 1.35, sway: 0.04, lean: 0.12 },
    Head: () => <mesh geometry={K.beret} material={M.beret} position={[0.04, 0.2, -0.03]} rotation={[-0.1, 0, -0.2]} castShadow />,
    Torso: ({ bw }) => (
      <>
        <mesh geometry={K.strap} material={M.camera} position={[0, 0.84, 0.06]} rotation={[0.62, 0, 0]} />
        <mesh geometry={K.camera} material={M.camera} position={[0, 0.66, front(bw) + 0.05]} />
        <mesh geometry={K.lens} material={M.silver} position={[0, 0.66, front(bw) + 0.13]} />
      </>
    ),
    Hand: () => <mesh geometry={K.notebook} material={M.cream} position={[0, -0.06, 0.07]} rotation={[-0.35, 0, 0]} />,
    // scribbles in her notebook, then looks around for the next story
    idle: (t) => {
      const k = pulse(t % 6, 0, 3.5);
      const look = 1 - k;
      return { armLx: -0.35 - 0.7 * k, armRx: (-1.1 + Math.sin(t * 14) * 0.08) * k, armRz: 0.3 * k, headX: 0.28 * k, headY: Math.sin(t * 1.7) * 0.7 * look, lean: 0.1 * look };
    },
  },
  // 阿德: the soft heart. A towering toque, a round belly, a moustache and a baguette.
  baker: {
    look: { shirt: "#fff4e3", pants: "#7b4b2a", apron: "#ffffff", hair: "#4a2c1a", hairStyle: "short", hat: "none", glasses: false, scarf: null, backpack: null, skirt: false, blush: true, headScale: 1.06, scale: 1.0 },
    bw: 1.28,
    belly: 1.1,
    top: 0.85,
    apron: { sx: 0.8, sy: 0.55, y: 0.8 }, // a bib: the belly below it wears the apron colour
    gait: { stride: 0.42, arm: 0.5, bounce: 0.05, cadence: 1.15, sway: 0.13, lean: -0.04 },
    Head: () => (
      <>
        <mesh geometry={K.toque} material={M.white} position={[0, 0.5, -0.02]} rotation={[-0.06, 0, 0]} castShadow />
        <mesh geometry={K.moustache} material={M.brownHair} position={[0, -0.015, 0.32]} />
      </>
    ),
    Hand: () => <mesh geometry={K.baguette} material={M.crust} position={[0, 0.12, 0.07]} rotation={[0.35, 0, -0.45]} castShadow />,
    // content swaying; every few seconds he dusts the flour off his apron
    idle: (t) => {
      const k = pulse(t % 8, 0, 1.6, 0.25);
      const pat = Math.sin(t * 13) * 0.18;
      return {
        armLx: -0.4 + (-0.4 + pat) * k, armRx: (-0.75 - pat) * k, armLz: -0.35 * k, armRz: 0.35 * k,
        squash: 1 + Math.sin(t * 3) * 0.02, headZ: Math.sin(t * 1.3) * 0.08 * (1 - k), headX: 0.2 * k, lean: -0.04,
      };
    },
  },
  // 美玲: a wide straw sunhat with a pink ribbon and a flower, a dove perched on the brim, a bouquet in hand.
  florist: {
    look: { shirt: "#ff8fab", skirt: true, apron: "#8fd18b", hat: "none", hair: "#7b4b2a", hairStyle: "long", glasses: false, scarf: null, backpack: null, blush: true, scale: 0.93 },
    bw: 0.92,
    belly: 0,
    top: 0.25,
    gait: { stride: 0.45, arm: 0.3, bounce: 0.07, cadence: 1, sway: 0.06, lean: 0.02 },
    Head: () => (
      <>
        <mesh geometry={K.sunBrim} material={M.straw} position={[0, 0.22, 0]} castShadow />
        <mesh geometry={K.sunCrown} material={M.straw} position={[0, 0.34, 0]} />
        <mesh geometry={K.ribbon} material={M.pink} position={[0, 0.27, 0]} />
        <group position={[0.24, 0.34, 0.2]} rotation={[0, 0.85, 0]}>
          <mesh geometry={K.petals} material={M.pink} />
          <mesh geometry={K.flowerHeart} material={M.yellow} position={[0, 0, 0.03]} />
        </group>
        <Dove />
      </>
    ),
    Hand: () => (
      <group position={[0, 0.06, 0.07]} rotation={[0.25, 0, -0.2]}>
        <mesh geometry={K.wrap} material={M.kraft} position={[0, 0.02, 0]} />
        <mesh geometry={K.blooms} material={M.pink} position={[0, 0.2, 0]} castShadow />
        <mesh geometry={K.flowerHeart} material={M.yellow} position={[0.01, 0.27, 0.02]} />
      </group>
    ),
    hold: () => ({ armLx: -0.5 }),
    // fusses over her bouquet with the other hand
    idle: (t) => {
      const k = pulse(t % 7, 0, 2.2, 0.35);
      return { armLx: -0.55, armRx: -0.85 * k, armRz: 0.5 * k, headX: 0.2 + 0.12 * k, headZ: 0.12 * (1 - k), tilt: Math.sin(t * 0.9) * 0.05 };
    },
  },
  // 美咲: the gossip hub. A long brown bistro apron, a head-wrap, and a tray with a cup always held level.
  cafe: {
    look: { shirt: "#2e6f74", apron: "#6b3f24", hair: "#2b1d14", hairStyle: "bun", hat: "none", glasses: false, scarf: null, backpack: null, skirt: false, blush: true, scale: 0.96 },
    bw: 0.95,
    belly: 0,
    top: 0.1,
    level: true,
    apron: { sx: 1.05, sy: 1.55, y: 0.47 },
    gait: { stride: 0.4, arm: 0.35, bounce: 0.025, cadence: 1.4, sway: 0.03, lean: 0.05 },
    Head: () => <mesh geometry={K.bandana} material={M.bandana} rotation={[-0.35, 0, 0]} />,
    Hand: () => (
      <group position={[0, 0.04, 0.08]}>
        <mesh geometry={K.tray} material={M.tray} />
        <mesh geometry={K.cup} material={M.white} position={[0.04, 0.012, 0.02]} />
      </group>
    ),
    hold: (t) => ({ armLx: -1.2 + Math.sin(t * 2) * 0.04, armLz: 0.1 }),
    // glances around the terrace; now and then wipes the tray with her free hand
    idle: (t) => {
      const k = pulse(t % 8, 0, 2, 0.3);
      return { armRx: (-1.05 + Math.sin(t * 9) * 0.08) * k, armRz: (0.55 + Math.sin(t * 9) * 0.15) * k, headX: 0.25 * k, headY: Math.sin(t * 0.7) * 0.4 * (1 - k) };
    },
  },
  // 志明: the stage. A lime hi-vis vest with reflective stripes, a headset and a clipboard; always busy.
  organizer: {
    look: { shirt: "#c6f432", pants: "#264653", hair: "#d8a35d", hairStyle: "spiky", hat: "none", glasses: false, scarf: null, backpack: null, apron: null, skirt: false, blush: false, scale: 1.08 },
    bw: 0.9,
    belly: 0,
    top: 0.15,
    gait: { stride: 0.6, arm: 0.4, bounce: 0.06, cadence: 1.3, sway: 0.03, lean: 0.1 },
    Head: () => <mesh geometry={K.headset} material={M.black} position={[0, 0.02, 0]} />,
    Torso: ({ bw }) => (
      <>
        <Wide bw={bw}>
          <mesh geometry={K.stripes} material={M.reflect} />
        </Wide>
        <mesh geometry={K.pass} material={M.white} position={[0.09, 0.66, front(bw) + 0.02]} />
      </>
    ),
    Hand: () => (
      <group position={[0, -0.05, 0.07]} rotation={[-0.45, 0, 0]}>
        <mesh geometry={K.board} material={M.clipboard} />
        <mesh geometry={K.paper} material={M.white} position={[0, -0.02, 0.012]} />
      </group>
    ),
    // checks the clipboard (tapping a foot), taps his headset, then glances back at the stage
    idle: (t) => {
      const c = t % 5;
      const check = pulse(c, 0, 2.5);
      const call = pulse(c, 2.6, 4);
      const glance = pulse(c, 4, 5);
      return {
        armLx: -0.3 - 0.8 * check, headX: 0.32 * check, legL: -Math.max(0, Math.sin(t * 9)) * 0.22 * check,
        armRx: -2.5 * call, armRz: -0.55 * call, headZ: -0.1 * call, headY: 0.6 * glance,
      };
    },
  },
  // 阿珠: the ringleader. A hachimaki headband and a boat of takoyaki held out to everyone who passes.
  vendor: {
    look: { shirt: "#e2574c", apron: "#3a86ff", hair: "#4a2c1a", hairStyle: "pony", hat: "none", glasses: false, scarf: null, backpack: null, skirt: false, blush: true, headScale: 1.04, scale: 0.97 },
    bw: 1.1,
    belly: 0,
    top: 0.1,
    level: true,
    apron: { sx: 1, sy: 0.6, y: 0.5 }, // a short waist apron: the full bib read as a board held in front
    gait: { stride: 0.62, arm: 0.75, bounce: 0.08, cadence: 1.05, sway: 0.08, lean: 0.06 },
    Head: () => (
      <group position={[0, 0.12, 0]} rotation={[-0.12, 0, 0]}>
        <mesh geometry={K.hachimaki} material={M.white} />
        <mesh geometry={K.sun} material={M.red} position={[0, 0.01, 0.37]} />
      </group>
    ),
    Hand: () => (
      <group position={[0, 0.04, 0.09]}>
        <mesh geometry={K.boat} material={M.boat} />
        <mesh geometry={K.balls} material={M.takoyaki} />
      </group>
    ),
    hold: () => ({ armLx: -1.1, armLz: 0.08 }),
    // hawks takoyaki at the square with her free arm, then looks around for customers
    idle: (t) => {
      const k = pulse(t % 7, 0, 1.8, 0.3);
      return { armRx: (0.1 + Math.sin(t * 11) * 0.1) * k, armRz: (-1.85 + Math.sin(t * 11) * 0.3) * k, lift: Math.abs(Math.sin(t * 11)) * 0.03 * k, headX: -0.15 * k, headY: Math.sin(t * 0.8) * 0.5 * (1 - k) };
    },
  },
} satisfies Record<string, Kit>;

type Role = keyof typeof KIT;

/** Which kit someone wears, from the post crowdSim gave them (core residents via POST_NPC). */
export function kitFor(post: string | null): Kit | null {
  if (!post) return null;
  if (post.startsWith("officer-")) return KIT.officer;
  const npc = POST_NPC[post] as Role | undefined;
  return npc && npc in KIT ? KIT[npc] : null;
}

// ---- generic townsfolk: a gentle palette softening and hat hygiene so the kits pop ---------------

const GREIGE = new THREE.Color("#bfb6a8");
const mutedCache = new Map<string, string>();
function muted(c: string, k: number) {
  const key = `${c}|${k}`;
  let out = mutedCache.get(key);
  if (!out) {
    out = `#${new THREE.Color(c).lerp(GREIGE, k).getHexString()}`;
    mutedCache.set(key, out);
  }
  return out;
}

/** The look as drawn: the kit for core residents, a softened palette for everyone else. */
export function dress(look: Look, kit: Kit | null): Look {
  if (kit) return { ...look, ...kit.look };
  const k = look.who === "kid" ? 0.1 : 0.2;
  const soft = (c: string | null) => (c ? muted(c, k) : c);
  return {
    ...look,
    // the wide sunhat belongs to the florist; the short chef hat stays with the ramen cook
    hat: look.hat === "sunhat" ? "cap" : look.hat,
    shirt: muted(look.shirt, k),
    pants: muted(look.pants, k),
    hatColor: muted(look.hatColor, k),
    backpack: soft(look.backpack),
    scarf: soft(look.scarf),
    apron: soft(look.apron),
  };
}

/** Ease part of a pose toward a target (used to fade idle tells in and out). */
export function mixPose(base: Pose, target: Partial<Pose>, w: number) {
  for (const key of Object.keys(target) as (keyof Pose)[]) base[key] += ((target[key] as number) - base[key]) * w;
}
