"use client";

// Town pets on screen: chibi cats and dogs built from simple shapes like the townsfolk, with coat
// patterns (calico patches, tabby stripes, a shiba's cream cheeks) painted into vertex colours.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { crowd, extraObstacles } from "./crowdSim";
import { show } from "./director";
import { labelTexture } from "./labels";
import { mat } from "./materials";
import { pat, pets, spawnPets, stepPets, type Breed, type Pet } from "./petSim";
import { DT_MAX } from "./quality";
import { bubbleTexture } from "./textures";

const WORLD = 1.15; // pets share the townsfolk's chibi scale (people are drawn at 1.3)

const WHITE = "#f7f2ea";
const CREAM = "#f6e8d2";
const CAL_OR = "#e98a2e";
const CAL_BK = "#2f2b2b";
const TABBY = "#f2a24a";
const TABBY_DK = "#cc7424";
const BLACK = "#2a2a30";
const SHIBA = "#d9863a";
const CORGI = "#e8933a";
const GOLDEN = "#ddb05d";
const GOLDEN_LT = "#f0d293";
const GOLDEN_DK = "#c8963f";
const FORMOSAN = "#26262b";
const PINK = "#f29bb0";

type Coat = (x: number, y: number, z: number) => string;
interface Build {
  cat: boolean;
  legs: number; // leg length (short for the munchkin and the corgi)
  legR: number;
  bodyR: number;
  bodyL: number;
  headR: number;
  body: Coat;
  head: Coat;
  leg: string;
  paw: string;
  snout?: string;
  nose: string;
  ears: "cat" | "pointy" | "big" | "floppy";
  earColors: [string, string];
  earInner: string;
  tail: "cat" | "curl" | "stub" | "plume" | "sickle";
  tailColors: string[];
  eyes: "dark" | "ringed" | "yellow";
  collar?: string;
}

const near = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < r * r;

const BUILDS: Record<Breed, Build> = {
  // 三花短腿貓: white with orange and black patches, very short legs
  calico: {
    cat: true, legs: 0.07, legR: 0.05, bodyR: 0.165, bodyL: 0.34, headR: 0.195,
    body: (x, y, z) =>
      y < -0.08 ? WHITE
      : near(x, y, z, 0.09, 0.12, -0.12, 0.15) || near(x, y, z, -0.16, 0.0, -0.03, 0.08) ? CAL_OR
      : near(x, y, z, -0.08, 0.13, 0.12, 0.115) || near(x, y, z, 0.14, 0.04, -0.25, 0.075) ? CAL_BK
      : WHITE,
    head: (x, y, z) => (y < 0.0 && z > 0.1 ? WHITE : near(x, y, z, -0.11, 0.11, 0.05, 0.12) ? CAL_OR : near(x, y, z, 0.1, 0.15, -0.04, 0.11) ? CAL_BK : WHITE),
    leg: WHITE, paw: WHITE, nose: PINK, ears: "cat", earColors: [CAL_BK, CAL_OR], earInner: "#f7b6c2",
    tail: "cat", tailColors: [CAL_OR, CAL_OR, CAL_BK], eyes: "dark",
  },
  tabby: {
    cat: true, legs: 0.13, legR: 0.05, bodyR: 0.18, bodyL: 0.32, headR: 0.2,
    body: (x, y, z) => (y < -0.1 || (z > 0.24 && y < 0.05) ? CREAM : y > -0.05 && Math.sin(z * 40 + Math.abs(x) * 8) > 0.45 ? TABBY_DK : TABBY),
    head: (x, y, z) => (y < -0.01 && z > 0.11 ? CREAM : y > 0.07 && z > 0.02 && Math.sin(x * 60) > 0.5 ? TABBY_DK : TABBY),
    leg: TABBY, paw: CREAM, nose: "#e88a8a", ears: "cat", earColors: [TABBY, TABBY], earInner: "#f7b6c2",
    tail: "cat", tailColors: [TABBY, TABBY_DK, TABBY], eyes: "dark",
  },
  black: {
    cat: true, legs: 0.14, legR: 0.046, bodyR: 0.15, bodyL: 0.32, headR: 0.185,
    body: () => BLACK, head: () => BLACK,
    leg: BLACK, paw: BLACK, nose: "#c9708a", ears: "cat", earColors: [BLACK, BLACK], earInner: "#6a4c56",
    tail: "cat", tailColors: [BLACK, BLACK, BLACK], eyes: "yellow",
  },
  tuxedo: {
    cat: true, legs: 0.14, legR: 0.047, bodyR: 0.155, bodyL: 0.32, headR: 0.19,
    body: (x, y, z) => ((y < -0.05 && z > -0.12) || (z > 0.22 && y < 0.07) ? WHITE : BLACK),
    head: (x, y, z) => ((y < 0.01 && z > 0.09) || (Math.abs(x) < 0.035 && z > 0.12) ? WHITE : BLACK),
    leg: BLACK, paw: WHITE, nose: PINK, ears: "cat", earColors: [BLACK, BLACK], earInner: "#6a4c56",
    tail: "cat", tailColors: [BLACK, BLACK, BLACK], eyes: "ringed",
  },
  shiba: {
    cat: false, legs: 0.17, legR: 0.056, bodyR: 0.165, bodyL: 0.3, headR: 0.18,
    body: (x, y, z) => (y < -0.08 || (z > 0.2 && y < 0.06) ? CREAM : SHIBA),
    head: (x, y, z) => ((y < -0.005 && z > 0.02) || near(x, y, z, 0.065, 0.1, 0.14, 0.03) || near(x, y, z, -0.065, 0.1, 0.14, 0.03) ? CREAM : SHIBA),
    leg: SHIBA, paw: CREAM, snout: CREAM, nose: "#1d1d1f", ears: "pointy", earColors: [SHIBA, SHIBA], earInner: CREAM,
    tail: "curl", tailColors: [SHIBA], eyes: "dark", collar: "#d63a3a",
  },
  corgi: {
    cat: false, legs: 0.08, legR: 0.06, bodyR: 0.178, bodyL: 0.4, headR: 0.18,
    body: (x, y, z) => (y < -0.07 || (z > 0.25 && y < 0.1) ? CREAM : CORGI),
    head: (x, y, z) => ((Math.abs(x) < 0.04 && z > 0.04) || (y < -0.01 && z > 0.03) ? CREAM : CORGI),
    leg: CREAM, paw: CREAM, snout: CREAM, nose: "#1d1d1f", ears: "big", earColors: [CORGI, CORGI], earInner: "#f3c7a6",
    tail: "stub", tailColors: [CORGI], eyes: "dark", collar: "#3a7bd5",
  },
  golden: {
    cat: false, legs: 0.21, legR: 0.07, bodyR: 0.19, bodyL: 0.42, headR: 0.2,
    body: (x, y) => (y < -0.1 ? GOLDEN_LT : GOLDEN),
    head: (x, y, z) => (y < -0.02 && z > 0.08 ? GOLDEN_LT : GOLDEN),
    leg: GOLDEN, paw: GOLDEN_LT, snout: GOLDEN_LT, nose: "#1d1d1f", ears: "floppy", earColors: [GOLDEN_DK, GOLDEN_DK], earInner: GOLDEN_DK,
    tail: "plume", tailColors: [GOLDEN, GOLDEN, GOLDEN_LT], eyes: "dark", collar: "#2a9d8f",
  },
  formosan: {
    cat: false, legs: 0.23, legR: 0.058, bodyR: 0.155, bodyL: 0.38, headR: 0.175,
    body: () => FORMOSAN, head: () => FORMOSAN,
    leg: FORMOSAN, paw: FORMOSAN, snout: "#36363c", nose: "#111111", ears: "pointy", earColors: [FORMOSAN, FORMOSAN], earInner: "#4a3a3a",
    tail: "sickle", tailColors: [FORMOSAN, FORMOSAN, FORMOSAN], eyes: "ringed", collar: "#d63a3a",
  },
};

// Shared unit shapes, scaled per pet.
const G = {
  leg: new THREE.CylinderGeometry(1, 0.9, 1, 8).translate(0, -0.5, 0),
  ball: new THREE.SphereGeometry(1, 12, 8),
  ear: new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0),
  bubble: new THREE.PlaneGeometry(0.95, 0.83),
  tag: new THREE.PlaneGeometry(1, 1),
  hit: new THREE.SphereGeometry(0.42, 8, 6),
  leash: new THREE.CylinderGeometry(0.024, 0.024, 1, 6),
};
const COAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

function paint(geo: THREE.BufferGeometry, coat: Coat) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.set(coat(pos.getX(i), pos.getY(i), pos.getZ(i)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

const built = new Map<Breed, ReturnType<typeof buildGeometry>>();
function buildGeometry(breed: Breed) {
  const b = BUILDS[breed];
  const tailR = b.tail === "plume" ? 0.05 : b.tail === "sickle" ? 0.038 : 0.033;
  const tailLen = b.tail === "plume" ? 0.12 : 0.11;
  return {
    body: paint(new THREE.CapsuleGeometry(b.bodyR, b.bodyL, 6, 16, 8).rotateX(Math.PI / 2), b.body),
    head: paint(new THREE.SphereGeometry(b.headR, 22, 16), b.head),
    tail: new THREE.CapsuleGeometry(tailR, tailLen, 3, 8).translate(0, tailLen / 2, 0),
    tailLen,
    curl: new THREE.TorusGeometry(0.075, 0.038, 8, 18, Math.PI * 1.6),
    collar: new THREE.TorusGeometry(b.bodyR * 1.02, 0.022, 6, 18),
  };
}
const geometryFor = (breed: Breed) => {
  let g = built.get(breed);
  if (!g) {
    g = buildGeometry(breed);
    built.set(breed, g);
  }
  return g;
};

const bubbleMats = new Map<string, THREE.MeshBasicMaterial>();
function bubbleMat(text: string) {
  let m = bubbleMats.get(text);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: bubbleTexture(text), transparent: true, depthWrite: false, toneMapped: false });
    bubbleMats.set(text, m);
  }
  return m;
}
const tagMats = new Map<string, { m: THREE.MeshBasicMaterial; aspect: number }>();
function tagMat(text: string) {
  let t = tagMats.get(text);
  if (!t) {
    const l = labelTexture(text, "rgba(255,248,236,0.95)", "#7a4a1d");
    t = { m: new THREE.MeshBasicMaterial({ map: l.texture, transparent: true, depthWrite: false, toneMapped: false }), aspect: l.aspect };
    tagMats.set(text, t);
  }
  return t;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function PetModel({ p }: { p: Pet }) {
  const b = BUILDS[p.breed];
  const g = useMemo(() => geometryFor(p.breed), [p.breed]);
  const root = useRef<THREE.Group>(null);
  const rig = useRef<THREE.Group>(null);
  const pivot = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const legMesh = useRef<(THREE.Mesh | null)[]>([]);
  const paws = useRef<(THREE.Mesh | null)[]>([]);
  const tail = useRef<(THREE.Group | null)[]>([]);
  const tongue = useRef<THREE.Mesh>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const tag = useRef<THREE.Group>(null);
  const pose = useRef({ pitch: 0, lower: 0, fold: 0, paws: 0, sniff: 0, sleep: 0, rest: 0, groom: 0 });

  const m = useMemo(
    () => ({
      leg: mat(b.leg, 0.85), paw: mat(b.paw, 0.85), nose: mat(b.nose, 0.4), snout: mat(b.snout ?? b.leg, 0.85),
      earL: mat(b.earColors[0], 0.85), earR: mat(b.earColors[1], 0.85), inner: mat(b.earInner, 0.8),
      tails: b.tailColors.map((c) => mat(c, 0.85)), dark: mat("#1b1b1f", 0.3), white: mat("#ffffff", 0.5),
      iris: mat("#d8de4a", 0.4), tongue: mat("#ff7f96", 0.6), collar: mat(b.collar ?? "#d63a3a", 0.6), gold: mat("#f2c14e", 0.35, 0.4),
    }),
    [b],
  );

  // body layout (pet space, before WORLD scale): legs stand under the body, the head sits up and forward
  const hipY = b.legs + 0.02;
  const bodyY = b.legs + b.bodyR - 0.02;
  const frontZ = b.bodyL * 0.45;
  const rearZ = -b.bodyL * 0.45;
  const legX = b.bodyR * 0.55;
  const headY = bodyY + b.bodyR * (b.cat ? 0.95 : 0.8);
  const headZ = b.bodyL / 2 + b.bodyR * (b.cat ? 0.5 : 0.75);
  const hr = b.headR;
  const tailBase: [number, number, number] = [0, bodyY + b.bodyR * 0.45, -b.bodyL / 2 - b.bodyR * 0.6];

  useFrame((state, dt) => {
    const r = root.current;
    if (!r || !rig.current || !pivot.current) return;
    const mode = p.mode;
    const moving = mode === "walk" || mode === "zoom" ? Math.min(1, Math.hypot(p.vx, p.vz) / 0.45) : 0;
    const sitting = mode === "sit" || mode === "groom";
    const lying = mode === "loaf" || mode === "sleep";
    const P = pose.current;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    const goal = {
      pitch: sitting ? (b.legs < 0.1 ? 0.28 : b.cat ? 0.62 : 0.5) : 0,
      lower: sitting ? b.legs * 0.85 : lying ? b.legs : 0,
      fold: sitting ? 1 : 0,
      paws: !b.cat && lying ? 1 : 0,
      sniff: mode === "sniff" ? 1 : 0,
      sleep: mode === "sleep" ? 1 : 0,
      rest: sitting || lying ? 1 : 0,
      groom: mode === "groom" ? 1 : 0,
    };
    for (const key of Object.keys(goal) as (keyof typeof goal)[]) P[key] += (goal[key] - P[key]) * k;
    const now = state.clock.elapsedTime + p.id * 1.7;
    const happy = p.happy > 0;

    r.position.set(p.x, 0, p.z);
    r.rotation.y = p.heading;
    r.scale.setScalar(WORLD * p.size);
    const hop = happy && !b.cat && !lying ? Math.abs(Math.sin(now * 9)) * 0.07 : 0;
    rig.current.position.y = Math.abs(Math.cos(p.phase)) * 0.025 * moving + hop - P.lower;
    pivot.current.rotation.x = -P.pitch;
    // a corgi wiggles its whole back end when happy
    pivot.current.rotation.z = p.breed === "corgi" && happy ? Math.sin(now * 14) * 0.05 : 0;

    // legs: diagonal pairs swing together; sitting folds the back legs, lying tucks them away
    const swing = Math.sin(p.phase) * 0.75 * moving;
    const frontLen = Math.max(0.015, hipY - P.lower + (frontZ - rearZ) * Math.sin(P.pitch));
    const rearLen = Math.max(0.015, mix(hipY - P.lower, hipY * 0.8, P.fold));
    for (let i = 0; i < 4; i++) {
      const leg = legs.current[i];
      const mesh = legMesh.current[i];
      const paw = paws.current[i];
      if (!leg || !mesh || !paw) continue;
      const front = i < 2;
      const sw = i === 0 || i === 3 ? swing : -swing;
      let rot = front ? P.pitch + sw - P.paws * 1.45 : sw - 1.3 * P.fold;
      let len = front ? mix(frontLen, b.legs + 0.03, P.paws) : rearLen;
      // grooming: one front paw comes up to the face
      if (i === 1 && P.groom > 0.001) {
        rot = mix(rot, P.pitch - 2.5 + Math.sin(now * 5) * 0.15, P.groom);
        len = mix(len, frontLen * 1.1, P.groom);
      }
      leg.rotation.x = rot;
      mesh.scale.set(b.legR, len, b.legR);
      paw.position.y = -len;
    }

    // head: kept level when sitting, nose down to sniff, tucked in to sleep, a tilt when happy
    if (head.current) {
      const groomDip = P.groom * (0.27 + 0.18 * Math.sin(now * 4));
      head.current.rotation.x = P.pitch * 0.85 + P.sniff * 0.55 + P.sleep * 0.3 + groomDip;
      head.current.rotation.y = P.sniff * Math.sin(now * 2.5) * 0.35;
      head.current.rotation.z = P.sleep * 0.35 + (happy ? Math.sin(now * 3) * 0.12 : 0) + P.groom * 0.2;
      head.current.position.y = headY - P.sniff * 0.08 - P.sleep * 0.07;
    }
    if (eyes.current) eyes.current.scale.y = 1 - 0.88 * P.sleep;
    if (tongue.current) tongue.current.visible = !b.cat && (happy || mode === "zoom" || (moving > 0.8 && p.speed > p.walkSpeed * 1.3));

    // tail
    const [t0, t1, t2] = tail.current;
    if (b.tail === "cat" && t0 && t1 && t2) {
      const sway = Math.sin(now * (happy ? 6 : 1.6)) * (happy ? 0.35 : 0.15);
      const td = P.rest;
      t0.rotation.set(mix(-0.35, -2.2 + P.pitch, td), 0, mix(sway, 0.35, td));
      t1.rotation.set(mix(-0.2, 0.7, td), 0, mix(sway * 0.6, 0.8, td));
      t2.rotation.set(mix(0.75, 0.05, td), 0, mix(sway * 0.4, 0.8 + Math.sin(now * 1.3) * 0.15, td));
    } else if (t0) {
      const amp = happy ? 0.6 : moving > 0.2 ? 0.35 : lying ? 0.08 : 0.22;
      const wag = Math.sin(now * (happy ? 15 : 7)) * amp;
      if (b.tail === "plume" && t1 && t2) {
        t0.rotation.set(-2.25 + P.pitch + (lying ? 0.6 : 0), 0, wag);
        t1.rotation.set(0.25, 0, wag * 0.4);
        t2.rotation.set(0.2, 0, wag * 0.3);
      } else if (b.tail === "sickle" && t1 && t2) {
        t0.rotation.set(-0.55 + P.pitch * 0.5, 0, wag);
        t1.rotation.set(0.35, 0, wag * 0.3);
        t2.rotation.set(0.5, 0, 0);
      } else t0.rotation.z = wag * 0.4;
    }

    // speech bubble and name tag stay readable from the follow camera
    const dist = state.camera.position.distanceTo(r.position);
    const s = Math.min(3.2, Math.max(1, dist / 16)) / (WORLD * p.size);
    const tagOn = p.tag > 0 || p.hover;
    if (tag.current) {
      tag.current.visible = tagOn;
      tag.current.scale.setScalar(s);
      tag.current.position.y = 0.15 * s; // bottom edge stays at the anchor
    }
    if (bubble.current) {
      bubble.current.visible = !!p.bubble;
      if (p.bubble) bubble.current.material = bubbleMat(p.bubble);
      bubble.current.scale.setScalar(0.8 * s);
      bubble.current.position.y = 0.8 * 0.415 * s + (tagOn ? 0.32 * s : 0);
    }
  });

  const tagInfo = tagMat(`🐾 ${p.name}・${p.title}`);
  const eyeY = b.cat ? 0.03 : 0.05;
  const eyeZ = Math.sqrt(Math.max(0, hr * hr - 0.075 ** 2 - eyeY ** 2)) - 0.004;
  const eye = (x: number) => (
    <group key={x} position={[x, eyeY, eyeZ]}>
      {b.eyes === "ringed" && <mesh geometry={G.ball} material={m.white} scale={[0.045, 0.052, 0.02]} position={[0, 0, -0.004]} />}
      {b.eyes === "yellow" ? (
        <>
          <mesh geometry={G.ball} material={m.iris} scale={[0.04, 0.046, 0.02]} />
          <mesh geometry={G.ball} material={m.dark} scale={[0.012, 0.038, 0.012]} position={[0, 0, 0.012]} />
        </>
      ) : (
        <mesh geometry={G.ball} material={m.dark} scale={[0.034, 0.042, 0.02]} />
      )}
      <mesh geometry={G.ball} material={m.white} scale={0.011} position={[0.01, 0.016, 0.018]} />
    </group>
  );

  return (
    <group ref={root}>
      <group ref={rig}>
        {/* back legs stay at the hips; everything else tips up when they sit */}
        {[1, -1].map((side, k) => (
          <group key={`r${side}`} ref={(el) => void (legs.current[2 + k] = el)} position={[side * legX, hipY, rearZ]}>
            <mesh ref={(el) => void (legMesh.current[2 + k] = el)} geometry={G.leg} material={m.leg} castShadow />
            <mesh ref={(el) => void (paws.current[2 + k] = el)} geometry={G.ball} material={m.paw} scale={[b.legR * 1.2, b.legR * 0.75, b.legR * 1.45]} />
          </group>
        ))}
        <group ref={pivot} position={[0, hipY, rearZ]}>
          <group position={[0, -hipY, -rearZ]}>
            {[1, -1].map((side, k) => (
              <group key={`f${side}`} ref={(el) => void (legs.current[k] = el)} position={[side * legX, hipY, frontZ]}>
                <mesh ref={(el) => void (legMesh.current[k] = el)} geometry={G.leg} material={m.leg} castShadow />
                <mesh ref={(el) => void (paws.current[k] = el)} geometry={G.ball} material={m.paw} scale={[b.legR * 1.2, b.legR * 0.75, b.legR * 1.45]} />
              </group>
            ))}
            <mesh geometry={g.body} material={COAT} position={[0, bodyY, 0]} castShadow />
            {b.collar && (
              <group position={[0, bodyY + b.bodyR * 0.1, b.bodyL / 2 - 0.03]} rotation={[-0.3, 0, 0]}>
                <mesh geometry={g.collar} material={m.collar} />
                <mesh geometry={G.ball} material={m.gold} scale={0.028} position={[0, -(b.bodyR * 1.02 + 0.015), 0.02]} />
              </group>
            )}
            {/* tail */}
            {b.tail === "curl" && (
              <group ref={(el) => void (tail.current[0] = el)} position={[0, bodyY + b.bodyR * 0.95, -b.bodyL / 2 + 0.02]}>
                <mesh geometry={g.curl} material={m.tails[0]} rotation={[0, Math.PI / 2, 0.4]} castShadow />
              </group>
            )}
            {b.tail === "stub" && (
              <group ref={(el) => void (tail.current[0] = el)} position={[0, bodyY + b.bodyR * 0.5, -b.bodyL / 2 - b.bodyR * 0.85]}>
                <mesh geometry={G.ball} material={m.tails[0]} scale={0.055} />
              </group>
            )}
            {(b.tail === "cat" || b.tail === "plume" || b.tail === "sickle") && (
              <group ref={(el) => void (tail.current[0] = el)} position={tailBase}>
                <mesh geometry={g.tail} material={m.tails[0]} castShadow />
                <group ref={(el) => void (tail.current[1] = el)} position={[0, g.tailLen, 0]}>
                  <mesh geometry={g.tail} material={m.tails[1] ?? m.tails[0]} castShadow />
                  <group ref={(el) => void (tail.current[2] = el)} position={[0, g.tailLen, 0]}>
                    <mesh geometry={g.tail} material={m.tails[2] ?? m.tails[0]} castShadow />
                  </group>
                </group>
              </group>
            )}
            {/* head */}
            <group ref={head} position={[0, headY, headZ]}>
              <mesh geometry={g.head} material={COAT} scale={b.cat ? [1.07, 0.96, 1] : [1, 1, 1]} castShadow />
              <group ref={eyes}>
                {eye(0.075)}
                {eye(-0.075)}
              </group>
              {b.cat ? (
                <mesh geometry={G.ball} material={m.nose} scale={[0.024, 0.017, 0.016]} position={[0, -0.03, hr - 0.004]} />
              ) : (
                <>
                  <mesh geometry={G.ball} material={m.snout} scale={[0.095, 0.075, 0.12]} position={[0, -0.055, hr * 0.78]} castShadow />
                  <mesh geometry={G.ball} material={m.nose} scale={[0.036, 0.027, 0.024]} position={[0, -0.03, hr * 0.78 + 0.115]} />
                  <mesh ref={tongue} geometry={G.ball} material={m.tongue} scale={[0.035, 0.012, 0.05]} position={[0, -0.11, hr * 0.78 + 0.06]} rotation={[0.5, 0, 0]} visible={false} />
                </>
              )}
              {/* ears */}
              {[1, -1].map((side) =>
                b.ears === "floppy" ? (
                  <mesh key={side} geometry={G.ball} material={side > 0 ? m.earL : m.earR} scale={[0.048, 0.1, 0.08]} position={[side * hr * 0.88, -0.01, -0.01]} rotation={[0, 0, side * 0.22]} castShadow />
                ) : (
                  <group key={side} position={[side * hr * 0.52, hr * 0.7, -0.01]} rotation={[-0.08, 0, -side * (b.ears === "big" ? 0.42 : b.ears === "pointy" ? 0.28 : 0.36)]}>
                    <mesh
                      geometry={G.ear}
                      material={side > 0 ? m.earL : m.earR}
                      scale={b.ears === "big" ? [0.088, 0.19, 0.05] : b.ears === "pointy" ? [0.068, 0.14, 0.045] : [0.072, 0.125, 0.045]}
                      castShadow
                    />
                    <mesh geometry={G.ear} material={m.inner} scale={b.ears === "big" ? [0.055, 0.14, 0.02] : [0.04, 0.085, 0.02]} position={[0, 0.005, 0.022]} />
                  </group>
                ),
              )}
            </group>
          </group>
        </group>
      </group>
      {/* pointer target: hover shows the name, a click gives them a pat */}
      <mesh
        geometry={G.hit}
        material={HIDDEN}
        position={[0, 0.32, 0.1]}
        onClick={(e) => {
          e.stopPropagation();
          pat(p);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          p.hover = true;
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          p.hover = false;
          document.body.style.cursor = "";
        }}
      />
      <Billboard position={[0, 0.8, 0]}>
        <mesh ref={bubble} geometry={G.bubble} visible={false} renderOrder={10} />
      </Billboard>
      <Billboard position={[0, 0.8, 0]}>
        <group ref={tag} visible={false}>
          <mesh geometry={G.tag} material={tagInfo.m} scale={[0.3 * tagInfo.aspect, 0.3, 1]} renderOrder={11} />
        </group>
      </Billboard>
    </group>
  );
}

const UP = new THREE.Vector3(0, 1, 0);
/** The lead from the walker's right hand to the dog's collar. */
function Leash({ p }: { p: Pet }) {
  const ref = useRef<THREE.Mesh>(null);
  const a = useMemo(() => new THREE.Vector3(), []);
  const c = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = p.owner !== null ? crowd.agents[p.owner] : null;
    if (!o || o.visible < 0.5 || o.mode === "inside") {
      mesh.visible = false;
      return;
    }
    const s = 1.3 * o.look.scale;
    const h = o.heading;
    a.set(o.x - Math.cos(h) * 0.27 * s + Math.sin(h) * 0.1 * s, 0.52 * s, o.z + Math.sin(h) * 0.27 * s + Math.cos(h) * 0.1 * s);
    const b = BUILDS[p.breed];
    const ws = WORLD * p.size;
    const neck = (b.bodyL / 2 + b.bodyR * 0.3) * ws;
    c.set(p.x + Math.sin(p.heading) * neck, (b.legs + b.bodyR * 1.4) * ws, p.z + Math.cos(p.heading) * neck);
    const len = a.distanceTo(c);
    if (len > 4.5) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.copy(a).add(c).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, c.sub(a).normalize());
    mesh.scale.set(1, len, 1);
  });
  return <mesh ref={ref} geometry={G.leash} material={mat("#e04a3a", 0.55)} visible={false} />;
}

export default function Pets() {
  const list = useMemo(() => spawnPets(), []);
  // StrictMode runs the memo twice in development; simulate the copy that is actually on screen.
  useEffect(() => {
    pets.list = list;
    extraObstacles.list = list;
  }, [list]);
  // same clock as the townsfolk: during playback the town moves at the playback speed
  useFrame((_, delta) => stepPets(Math.min(delta, DT_MAX) * (show.status === "playing" ? Math.min(show.speed, 3) : 1)));
  return (
    <group>
      {list.map((p) => (
        <PetModel key={p.id} p={p} />
      ))}
      {list.filter((p) => p.walked).map((p) => (
        <Leash key={`leash-${p.id}`} p={p} />
      ))}
    </group>
  );
}
