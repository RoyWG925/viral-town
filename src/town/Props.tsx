"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BENCHES, BIG_TREE, BUILDINGS, CAFE_TABLES, FILL_TREES, FOUNTAIN, LAMPS, LANTERN_POLES, PLANTERS, STAGE, STREET_TREES, onMainSidewalk, toWorld,
} from "./layout";
import { agentFor, show } from "./director";
import { mat } from "./materials";
import { bannerTexture, rng, stripeTexture } from "./textures";
import { clock, glow, skyAt } from "./clock";
import { fx } from "./fx";
import { DevCam, StageDressing } from "./SetPieces";

const CANOPY = ["#7cb342", "#9ccc65", "#5fa845", "#f4a259", "#e9724c", "#f6bd60", "#8bc34a", "#4f9a4a"];
const BLOB = new THREE.IcosahedronGeometry(1, 1);
const TRUNK = new THREE.CylinderGeometry(0.13, 0.2, 1.9, 7).translate(0, 0.95, 0);

/** One tree, for the few that need their own mesh (the old tree on the green). */
export function Tree({ x, z, s = 1, seed }: { x: number; z: number; s?: number; seed: number }) {
  const r = useMemo(() => rng(seed), [seed]);
  const blobs = useMemo(
    () => Array.from({ length: 5 }, (_, i) => ({ p: [(r() - 0.5) * 1.6, 2.4 + (i % 3) * 0.5 + r() * 0.3, (r() - 0.5) * 1.6] as THREE.Vector3Tuple, s: 1.2 - (i % 3) * 0.15 + r() * 0.25, c: CANOPY[Math.floor(r() * CANOPY.length)] })),
    [r],
  );
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh geometry={TRUNK} castShadow material={mat("#7a5236")} />
      {blobs.map((b, i) => (
        <mesh key={i} geometry={BLOB} position={b.p} scale={b.s} castShadow receiveShadow material={mat(b.c, 0.85)} />
      ))}
    </group>
  );
}

// Every other tree and bush is instanced: one draw call per canopy colour.
function Forest() {
  const data = useMemo(() => {
    const r = rng(77);
    const blobs: { x: number; y: number; z: number; s: number; c: number }[] = [];
    const trunks: { x: number; z: number; s: number }[] = [];
    const plant = (x: number, z: number, size: number, bush: boolean) => {
      if (bush) {
        const n = 2 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) blobs.push({ x: x + (r() - 0.5) * size, y: size * 0.45, z: z + (r() - 0.5) * size, s: size * (0.55 + r() * 0.3), c: Math.floor(r() * 3) === 0 ? 7 : Math.floor(r() * 3) });
        return;
      }
      const s = 0.8 + size * 0.45;
      trunks.push({ x, z, s });
      const c = Math.floor(r() * CANOPY.length);
      for (let i = 0; i < 3; i++) blobs.push({ x: x + (r() - 0.5) * 0.9 * s, y: (2.3 + i * 0.45 + r() * 0.3) * s, z: z + (r() - 0.5) * 0.9 * s, s: (1.1 - i * 0.18 + r() * 0.2) * s, c: r() < 0.7 ? c : Math.floor(r() * CANOPY.length) });
    };
    FILL_TREES.forEach((t) => plant(t.x, t.z, t.r * (t.bush ? 1.6 : 1), t.bush));
    STREET_TREES.forEach((t) => plant(t.x, t.z, 0.9, false));
    return { blobs, trunks };
  }, []);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const blobRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    if (trunkRef.current) {
      data.trunks.forEach((t, i) => trunkRef.current!.setMatrixAt(i, m.compose(v.set(t.x, 0, t.z), q.identity(), sc.setScalar(t.s))));
      trunkRef.current.instanceMatrix.needsUpdate = true;
    }
    CANOPY.forEach((_, c) => {
      const mesh = blobRefs.current[c];
      if (!mesh) return;
      let n = 0;
      for (const b of data.blobs) if (b.c === c) mesh.setMatrixAt(n++, m.compose(v.set(b.x, b.y, b.z), q.identity(), sc.setScalar(b.s)));
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [data]);
  return (
    <group>
      <instancedMesh ref={trunkRef} args={[TRUNK, mat("#7a5236"), data.trunks.length]} castShadow />
      {CANOPY.map((c, i) => (
        <instancedMesh key={c} ref={(el) => void (blobRefs.current[i] = el)} args={[BLOB, mat(c, 0.85), data.blobs.length]} castShadow receiveShadow />
      ))}
      {/* planters under the street trees that stand on paving */}
      {STREET_TREES.filter((t) => onMainSidewalk(t.x, t.z)).map((t, i) => (
        <mesh key={i} position={[t.x, 0.2, t.z]} receiveShadow castShadow material={mat("#b8835a")}>
          <cylinderGeometry args={[0.9, 0.95, 0.4, 16]} />
        </mesh>
      ))}
    </group>
  );
}

function StreetLamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.15, 0]} material={mat("#2f5d50")}>
        <cylinderGeometry args={[0.2, 0.26, 0.3, 10]} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow material={mat("#2f5d50", 0.5, 0.3)}>
        <cylinderGeometry args={[0.07, 0.09, 3.6, 8]} />
      </mesh>
      <mesh position={[0, 3.85, 0]} material={glow.lamp}>
        <sphereGeometry args={[0.28, 14, 10]} />
      </mesh>
      <mesh position={[0, 4.15, 0]} material={mat("#2f5d50", 0.5, 0.3)}>
        <coneGeometry args={[0.36, 0.3, 10]} />
      </mesh>
    </group>
  );
}

// Real lights only where stories play out at night: the shopping street, the cafe terrace and the town hall
// corners of the plaza. All lights are mounted at load (intensity 0) so dusk never triggers a shader recompile.
const LIT = new Set([1, 3, 7, 8, 9]);
function Lamps() {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const festival = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const on = skyAt(clock.hour).lightsOn;
    lights.current.forEach((l) => l && (l.intensity = on * 14));
    // one warm wash from the fountain lantern over the plaza, the stage and the town hall steps
    if (festival.current) festival.current.intensity = on * 26;
  });
  return (
    <group>
      {LAMPS.map((l, i) => (
        <group key={i}>
          <StreetLamp x={l.x} z={l.z} />
          {LIT.has(i) && <pointLight ref={(el) => void (lights.current[i] = el)} position={[l.x, 3.6, l.z]} color="#ffc27a" distance={9} decay={1.6} intensity={0} />}
        </group>
      ))}
      <pointLight ref={festival} position={[FOUNTAIN.x, 5.2, FOUNTAIN.z]} color="#ffb36b" distance={20} decay={1.3} intensity={0} />
    </group>
  );
}

function Bench({ x, z, rot }: { x: number; z: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.48, 0]} castShadow material={mat("#c08552")}>
        <boxGeometry args={[2.0, 0.1, 0.5]} />
      </mesh>
      <mesh position={[0, 0.85, -0.22]} rotation={[0.15, 0, 0]} castShadow material={mat("#c08552")}>
        <boxGeometry args={[2.0, 0.45, 0.08]} />
      </mesh>
      {[-0.85, 0.85].map((o) => (
        <mesh key={o} position={[o, 0.24, 0]} material={mat("#3c3c3c", 0.5, 0.4)}>
          <boxGeometry args={[0.08, 0.48, 0.45]} />
        </mesh>
      ))}
    </group>
  );
}

function CafeTable({ x, z, colour }: { x: number; z: number; colour: string }) {
  const canopy = useMemo(() => new THREE.MeshStandardMaterial({ map: stripeTexture(colour, "#f4efe2", 10), side: THREE.DoubleSide, roughness: 0.8 }), [colour]);
  // someone the camera is filming stands under this umbrella: let the camera see through it (a scene at the café
  // terrace was all canopy and name tags otherwise)
  useFrame((_, dt) => {
    let under = false;
    if (show.status === "playing" || show.status === "paused") {
      const who = [show.shot?.a, show.shot?.b, ...show.says.map((s) => s.anchor ?? s.npc)];
      for (const id of who) {
        const ag = id ? agentFor(id) : null;
        if (ag && (ag.x - x) ** 2 + (ag.z - z) ** 2 < 3.2) {
          under = true;
          break;
        }
      }
    }
    const goal = under ? 0.22 : 1;
    if (Math.abs(canopy.opacity - goal) < 0.005) return;
    canopy.opacity += (goal - canopy.opacity) * Math.min(1, dt * 6);
    // opaque <-> transparent needs a shader recompile, or three ignores the opacity
    const see = canopy.opacity < 0.995;
    if (canopy.transparent !== see) {
      canopy.transparent = see;
      canopy.needsUpdate = true;
    }
    canopy.depthWrite = canopy.opacity > 0.95;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.72, 0]} castShadow material={mat("#f4f1ea", 0.4)}>
        <cylinderGeometry args={[0.5, 0.5, 0.06, 18]} />
      </mesh>
      <mesh position={[0, 1.4, 0]} material={mat("#6b6b6b", 0.4, 0.5)}>
        <cylinderGeometry args={[0.04, 0.04, 2.8, 6]} />
      </mesh>
      <mesh position={[0, 2.65, 0]} castShadow material={canopy}>
        <coneGeometry args={[1.5, 0.55, 10, 1, true]} />
      </mesh>
      {[-0.8, 0.8].map((o) => (
        <group key={o} position={[o, 0, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow material={mat("#ffd23f", 0.6)}>
            <cylinderGeometry args={[0.24, 0.24, 0.06, 12]} />
          </mesh>
          <mesh position={[0, 0.21, 0]} material={mat("#555", 0.5, 0.4)}>
            <cylinderGeometry args={[0.03, 0.03, 0.42, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Lanterns hang on sagging strings from the fountain pole to the poles around the plaza.
const POLE_TOP = 6.3;
const RIM_H = 4.2;
function lanternStrings() {
  return LANTERN_POLES.map((p) => {
    const a = new THREE.Vector3(FOUNTAIN.x, POLE_TOP, FOUNTAIN.z);
    const b = new THREE.Vector3(p.x, RIM_H, p.z);
    return Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      const v = a.clone().lerp(b, t);
      v.y -= 1.1 * 4 * t * (1 - t);
      return v;
    });
  });
}

function Lanterns() {
  const strings = useMemo(() => lanternStrings(), []);
  const segments = useMemo(() => strings.flatMap((pts) => pts.slice(1).flatMap((p, i) => [pts[i], p])), [strings]);
  const spots = useMemo(() => strings.flatMap((pts) => pts.filter((_, i) => i % 2 === 1 && i < 24).map((p) => p.clone().add(new THREE.Vector3(0, -0.28, 0)))), [strings]);
  const geo = useMemo(() => new THREE.SphereGeometry(0.2, 12, 10).scale(1, 1.25, 1), []);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    glow.lanterns.forEach((_, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      let n = 0;
      spots.forEach((p, i) => {
        if (i % glow.lanterns.length === k) mesh.setMatrixAt(n++, m.makeTranslation(p.x, p.y, p.z));
      });
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [spots]);
  return (
    <group>
      {/* every string in one line-segment list: one draw call */}
      <Line points={segments} segments color="#3b3030" lineWidth={1.2} />
      {/* no shadows: a few dozen lantern dots made a dotted pattern on the faces underneath */}
      {glow.lanterns.map((material, k) => (
        <instancedMesh key={k} ref={(el) => void (refs.current[k] = el)} args={[geo, material, spots.length]} />
      ))}
      {LANTERN_POLES.map((p, i) => (
        <mesh key={i} position={[p.x, RIM_H / 2, p.z]} castShadow material={mat("#7a5a3a")}>
          <cylinderGeometry args={[0.08, 0.11, RIM_H, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function Fountain() {
  const water = useMemo(() => new THREE.MeshStandardMaterial({ color: "#68c3e6", roughness: 0.1, metalness: 0.1, emissive: "#2a7fa8", emissiveIntensity: 0.25 }), []);
  return (
    <group position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow material={mat("#d6cfc4", 0.7)}>
        <cylinderGeometry args={[FOUNTAIN.r, FOUNTAIN.r + 0.15, 0.56, 32]} />
      </mesh>
      <mesh position={[0, 0.5, 0]} material={water}>
        <cylinderGeometry args={[FOUNTAIN.r - 0.25, FOUNTAIN.r - 0.25, 0.08, 32]} />
      </mesh>
      <mesh position={[0, 1.0, 0]} castShadow material={mat("#d6cfc4", 0.7)}>
        <cylinderGeometry args={[0.35, 0.5, 1.0, 16]} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow material={mat("#d6cfc4", 0.7)}>
        <cylinderGeometry args={[0.9, 0.3, 0.25, 20]} />
      </mesh>
      <mesh position={[0, (POLE_TOP + 1.5) / 2, 0]} castShadow material={mat("#7a5a3a")}>
        <cylinderGeometry args={[0.09, 0.12, POLE_TOP - 1.5, 8]} />
      </mesh>
      <FountainLantern y={POLE_TOP} />
    </group>
  );
}

// The plaza's centrepiece: a tiered red-and-orange paper lantern with gold caps, crowning the fountain pole.
// The gold fittings are merged into one mesh, so the whole lantern is three draw calls.
const LANTERN_GOLD = mergeGeometries([
  new THREE.CylinderGeometry(0.3, 0.22, 0.12, 16).translate(0, 0.06, 0),
  new THREE.CylinderGeometry(0.3, 0.36, 0.1, 16).translate(0, 1.0, 0),
  new THREE.ConeGeometry(0.22, 0.22, 16).translate(0, 1.62, 0),
  ...[-1, 1].map((s) => new THREE.ConeGeometry(0.06, 0.32, 8).rotateZ(Math.PI).translate(s * 0.38, 0.68, 0)),
]);
function FountainLantern({ y }: { y: number }) {
  return (
    <group name="set:fountain" position={[0, y, 0]}>
      <mesh geometry={LANTERN_GOLD} material={mat("#d4af37", 0.35, 0.4)} />
      <mesh position={[0, 0.55, 0]} scale={[1, 0.8, 1]} material={glow.lanterns[0]}>
        <sphereGeometry args={[0.55, 18, 12]} />
      </mesh>
      <mesh position={[0, 1.32, 0]} scale={[1, 0.85, 1]} material={glow.lanterns[1]}>
        <sphereGeometry args={[0.34, 16, 10]} />
      </mesh>
    </group>
  );
}

function Stage() {
  const banner = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.6, side: THREE.DoubleSide, emissive: "#ffffff", emissiveIntensity: 0.1 });
    m.emissiveMap = m.map;
    return m;
  }, []);
  const { w, d } = STAGE;
  const post = useRef<THREE.Group>(null);
  const flap = useRef<THREE.Group>(null);
  const wobble = useRef({ until: 0, start: 0 });
  // The stage-rush scene sets fx.stageWobbleUntil: the left-rear post shudders and the banner sways, then both
  // settle back exactly upright. The stage is never shown permanently askew (a look can't tell it is unsound).
  useFrame(() => {
    const now = performance.now();
    if (fx.stageWobbleUntil !== wobble.current.until) wobble.current = { until: fx.stageWobbleUntil, start: now };
    const left = fx.stageWobbleUntil - now;
    let a = 0;
    if (left > 0) {
      const t = (now - wobble.current.start) / 1000;
      a = Math.sin(t * 18) * 0.07 * Math.min(1, left / 300) * (0.45 + 0.55 * Math.exp(-t * 1.2));
    }
    // the post rocks forward and back and leans outward only, so it never cuts into the backdrop
    if (post.current) post.current.rotation.set(a, 0, Math.abs(a) * 0.5);
    if (flap.current) flap.current.rotation.set(a * 0.8, 0, a * 0.2);
  });
  return (
    <group position={[STAGE.x, 0, STAGE.z]} rotation={[0, STAGE.rot, 0]}>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow material={mat("#b5835a", 0.8)}>
        <boxGeometry args={[w, 0.7, d]} />
      </mesh>
      <mesh position={[0, 0.3, d / 2 + 0.02]} material={mat("#c2332f", 0.8)}>
        <boxGeometry args={[w, 0.5, 0.04]} />
      </mesh>
      <group ref={post} position={[-w / 2 + 0.3, 0.7, -d / 2 + 0.2]}>
        <mesh position={[0, 1.6, 0]} castShadow material={mat("#7a5a3a")}>
          <cylinderGeometry args={[0.07, 0.07, 3.2, 8]} />
        </mesh>
      </group>
      <mesh position={[w / 2 - 0.3, 2.3, -d / 2 + 0.2]} castShadow material={mat("#7a5a3a")}>
        <cylinderGeometry args={[0.07, 0.07, 3.2, 8]} />
      </mesh>
      {/* the banner hangs from its top edge, so it swings rather than slides */}
      <group ref={flap} position={[0, 3.9, -d / 2 + 0.2]}>
        <mesh position={[0, -0.8, 0]} castShadow material={banner}>
          <planeGeometry args={[w - 0.8, (w - 0.8) / 4]} />
        </mesh>
      </group>
      <mesh position={[0.6, 1.25, 0.3]} material={mat("#333", 0.4, 0.6)}>
        <cylinderGeometry args={[0.025, 0.025, 1.1, 6]} />
      </mesh>
      <StageDressing w={w} d={d} />
    </group>
  );
}

function FlowerPots() {
  const flower = BUILDINGS.find((b) => b.kind === "flower")!;
  const pots = useMemo(() => {
    const r = rng(9);
    return Array.from({ length: 5 }, (_, i) => {
      const p = toWorld(flower, -flower.w / 2 + 0.5 + i * 0.7, flower.d / 2 + 0.45 + (i % 2) * 0.25);
      return { x: p.x, z: p.z, c: ["#ff6fa0", "#ffd23f", "#b388ff", "#ff8a65"][Math.floor(r() * 4)] };
    });
  }, [flower]);
  return (
    <group>
      {pots.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.2, 0]} castShadow material={mat("#c4643e")}>
            <cylinderGeometry args={[0.25, 0.19, 0.4, 10]} />
          </mesh>
          <mesh position={[0, 0.55, 0]} castShadow material={mat(p.c, 0.7)}>
            <icosahedronGeometry args={[0.3, 1]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Planters() {
  return (
    <group>
      {PLANTERS.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.25, 0]} castShadow receiveShadow material={mat("#f0ece4")}>
            <cylinderGeometry args={[p.r, p.r + 0.05, 0.5, 16]} />
          </mesh>
          <mesh position={[0, 0.75, 0]} scale={[p.r * 1.1, p.r * 0.75, p.r * 1.1]} castShadow material={mat(i % 2 ? "#6aa84f" : "#ff8fab", 0.85)}>
            <icosahedronGeometry args={[1, 1]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function Props() {
  return (
    <group>
      <Forest />
      <Tree x={BIG_TREE.x} z={BIG_TREE.z} s={1.7} seed={4242} />
      <Lamps />
      {BENCHES.map((b, i) => (
        <Bench key={i} {...b} />
      ))}
      {CAFE_TABLES.map((t, i) => (
        <CafeTable key={i} x={t.x} z={t.z} colour={i < 2 ? "#2e6f74" : "#2f6f9f"} />
      ))}
      <Fountain />
      <Lanterns />
      <Stage />
      <FlowerPots />
      <Planters />
      <DevCam />
    </group>
  );
}
