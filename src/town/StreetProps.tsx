"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import {
  BINS, BUILDINGS, BUS_STOP, CAFE_TABLES, CRATES, FENCES, FLOWER_BEDS, LAMPS, LANTERN_POLES, MAILBOX, STALLS, VENDING, YARDS, doorX, fromLocal, type Yard,
} from "./layout";
import { walkable } from "./nav";
import { mat } from "./materials";
import { chalkTexture, iconTexture, rng, signTexture, stripeTexture } from "./textures";
import { glow } from "./clock";
import { LITE } from "./quality";
import { BULB, Gulls, HarbourCrane, Instances, UNIT_BOX, catenary, useBulbMaterial, useShotFade, type Inst } from "./SetPieces";

function Stall({ s }: { s: (typeof STALLS)[number] }) {
  const m = useMemo(() => {
    const sign = new THREE.MeshStandardMaterial({ map: signTexture(s.name, s.sub, s.roof[0], "#ffffff"), roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.15 });
    sign.emissiveMap = sign.map;
    return { roof: new THREE.MeshStandardMaterial({ map: stripeTexture(s.roof[0], s.roof[1], 6), roughness: 0.8 }), sign };
  }, [s]);
  const wood = mat("#b5835a");
  // the vendor stands under this awning: it fades while the director films them (like the café umbrellas)
  const canopy = useRef<THREE.Group>(null);
  useShotFade(canopy, useMemo(() => [{ x: s.x, z: s.z }], [s]), 3);
  return (
    <group position={[s.x, 0, s.z]} rotation={[0, s.rot, 0]}>
      <RoundedBox args={[2.6, 1.0, 0.9]} radius={0.08} position={[0, 0.5, 0.15]} castShadow receiveShadow material={wood} />
      <mesh position={[0, 1.03, 0.15]} castShadow material={mat("#f4efe2", 0.6)}>
        <boxGeometry args={[2.7, 0.06, 1.0]} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[-1.0 + i * 0.4, 1.14, 0.25]} castShadow material={mat(s.goods, 0.5)}>
          <sphereGeometry args={[0.13, 10, 8]} />
        </mesh>
      ))}
      {[-1.25, 1.25].map((x) =>
        [-0.7, 0.55].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 1.25, z]} material={wood}>
            <cylinderGeometry args={[0.05, 0.05, 2.5, 6]} />
          </mesh>
        )),
      )}
      <group ref={canopy}>
        <mesh position={[0, 2.6, -0.05]} rotation={[0.25, 0, 0]} castShadow material={m.roof}>
          <boxGeometry args={[3.0, 0.07, 1.8]} />
        </mesh>
        <mesh position={[0, 2.05, 0.82]} material={m.sign}>
          <planeGeometry args={[2.2, 0.55]} />
        </mesh>
      </group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * 0.9, 2.3, 0.86]} material={glow.lanterns[(i + 3) % 4]}>
          <sphereGeometry args={[0.14, 10, 8]} />
        </mesh>
      ))}
      {s === STALLS[2] && <AFrame x={-1.6} z={0.3} rot={0.45} lines={["Stall fee", "DOUBLED?!", "Same takoyaki"]} />}
    </group>
  );
}

/** A sidewalk chalkboard. Its footprint sits inside a stall's blocked margin, so nobody walks through it. */
function AFrame({ x, z, rot, lines }: { x: number; z: number; rot: number; lines: string[] }) {
  const face = useMemo(() => {
    const wood = mat("#8a5a3a");
    return [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: chalkTexture(lines), roughness: 0.9 }), wood];
  }, [lines]);
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.5, 0.12]} rotation={[-0.18, 0, 0]} castShadow material={face}>
        <boxGeometry args={[0.62, 0.95, 0.04]} />
      </mesh>
      <mesh position={[0, 0.5, -0.12]} rotation={[0.18, 0, 0]} castShadow material={mat("#8a5a3a")}>
        <boxGeometry args={[0.62, 0.95, 0.04]} />
      </mesh>
    </group>
  );
}

/** Not on a walkable cell anywhere under a footprint of radius r: props may only stand where nobody walks. */
const solid = (x: number, z: number, r: number) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => !walkable(x + dx, z + dz));

// Stock stacked behind the plaza stalls (inside each stall's footprint, beside the vendor) and potted plants
// beside shop doors. Instanced: a few draw calls for the whole town.
const POT = new THREE.CylinderGeometry(0.22, 0.17, 0.4, 10);
const LEAVES = new THREE.IcosahedronGeometry(0.3, 1);
function LifeProps() {
  const { crates, pots, leaves } = useMemo(() => {
    const crates: Inst[] = [];
    STALLS.slice(0, 3).forEach((st, i) => {
      for (const [lx, ly, size, c] of [[-0.85, 0.22, 0.44, "#c49a6c"], [-0.85, 0.62, 0.36, "#a87f55"], [0.85, 0.2, 0.4, i === 2 ? "#3a86ff" : "#c49a6c"]] as const) {
        const p = fromLocal(st, lx, -1.0);
        if (solid(p.x, p.z, size / 2)) crates.push({ p: [p.x, ly, p.z], r: [0, st.rot + i * 0.2, 0], s: size, c });
      }
    });
    const pots: Inst[] = [];
    const leaves: Inst[] = [];
    const r = rng(31);
    for (const b of BUILDINGS) {
      if (b.kind === "house" || b.kind === "warehouse" || b.kind === "townhall") continue;
      // the shopfront lives in the building body (annexes shift it): the visual door is at 0.31 of its width
      const aw = b.annex ? b.w * 0.3 : 0;
      const bodyW = b.w - aw;
      const cx = b.annex === "left" ? aw / 2 : b.annex === "right" ? -aw / 2 : 0;
      // beside the door, on the side away from the shopkeeper (the window ledge fills the other side)
      const p = fromLocal(b, cx + bodyW * 0.31 + 0.8, b.d / 2 + 0.2);
      if (!solid(p.x, p.z, 0.2)) continue;
      pots.push({ p: [p.x, 0.2, p.z] });
      leaves.push({ p: [p.x, 0.58, p.z], s: 0.85 + r() * 0.3, c: ["#5fb256", "#ff6fa0", "#ffd23f", "#5fb256"][Math.floor(r() * 4)] });
    }
    return { crates, pots, leaves };
  }, []);
  return (
    <group name="set:life">
      <Instances geo={UNIT_BOX} material={mat("#ffffff", 0.8)} items={crates} castShadow />
      <Instances geo={POT} material={mat("#c4643e")} items={pots} castShadow />
      <Instances geo={LEAVES} material={mat("#ffffff", 0.85)} items={leaves} castShadow />
    </group>
  );
}

function Bin({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.45, 0]} castShadow material={mat("#3f7d5a", 0.6)}>
        <cylinderGeometry args={[0.3, 0.26, 0.9, 14]} />
      </mesh>
      <mesh position={[0, 0.93, 0]} material={mat("#2f5d44", 0.6)}>
        <cylinderGeometry args={[0.33, 0.33, 0.08, 14]} />
      </mesh>
    </group>
  );
}

function Mailbox() {
  return (
    <group position={[MAILBOX.x, 0, MAILBOX.z]}>
      <mesh position={[0, 0.5, 0]} material={mat("#444", 0.5, 0.4)}>
        <cylinderGeometry args={[0.05, 0.05, 1.0, 6]} />
      </mesh>
      <RoundedBox args={[0.5, 0.6, 0.4]} radius={0.1} position={[0, 1.2, 0]} castShadow material={mat("#2f9e44", 0.5)} />
    </group>
  );
}

function VendingMachine() {
  return (
    <group position={[VENDING.x, 0, VENDING.z]} rotation={[0, VENDING.rot, 0]}>
      <RoundedBox args={[0.95, 1.9, 0.8]} radius={0.06} position={[0, 0.95, 0]} castShadow material={mat("#e63946", 0.4)} />
      <mesh position={[-0.1, 1.2, 0.41]} material={glow.window}>
        <boxGeometry args={[0.55, 1.0, 0.02]} />
      </mesh>
    </group>
  );
}

function BusStop() {
  const sign = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: iconTexture("🚌", "#3a86ff"), transparent: true, side: THREE.DoubleSide, emissive: "#ffffff", emissiveIntensity: 0.15 });
    m.emissiveMap = m.map;
    return m;
  }, []);
  const steel = mat("#3d405b", 0.4, 0.5);
  return (
    <group position={[BUS_STOP.x, 0, BUS_STOP.z]} rotation={[0, BUS_STOP.rot, 0]}>
      {[-1.5, 1.5].map((x) => (
        <mesh key={x} position={[x, 1.25, -0.5]} material={steel}>
          <boxGeometry args={[0.08, 2.5, 0.08]} />
        </mesh>
      ))}
      <mesh position={[0, 2.55, 0]} rotation={[-0.08, 0, 0]} castShadow material={mat("#3a86ff", 0.5)}>
        <boxGeometry args={[3.4, 0.1, 1.5]} />
      </mesh>
      <mesh position={[0, 1.3, -0.6]} material={new THREE.MeshStandardMaterial({ color: "#bfe3ff", transparent: true, opacity: 0.45, roughness: 0.1 })}>
        <boxGeometry args={[3.0, 1.8, 0.04]} />
      </mesh>
      <group position={[2.0, 0, 0.3]}>
        <mesh position={[0, 1.3, 0]} material={steel}>
          <cylinderGeometry args={[0.04, 0.04, 2.6, 6]} />
        </mesh>
        <mesh position={[0, 2.5, 0]} material={sign}>
          <circleGeometry args={[0.3, 20]} />
        </mesh>
      </group>
    </group>
  );
}

function Crates() {
  return (
    <group>
      {CRATES.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]} rotation={[0, i * 0.7, 0]}>
          <RoundedBox args={[0.9, 0.9, 0.9]} radius={0.04} position={[-0.2, 0.45, 0]} castShadow material={mat("#c49a6c", 0.8)} />
          <RoundedBox args={[0.8, 0.8, 0.8]} radius={0.04} position={[0.45, 0.4, 0.3]} castShadow material={mat("#a87f55", 0.8)} />
          <RoundedBox args={[0.7, 0.7, 0.7]} radius={0.04} position={[0.1, 1.25, 0.1]} castShadow material={mat(i % 2 ? "#3a86ff" : "#e2574c", 0.8)} />
        </group>
      ))}
    </group>
  );
}

// White picket fences around the yards: posts and rails are instanced.
const POST = new THREE.BoxGeometry(0.1, 0.9, 0.1).translate(0, 0.45, 0);
const RAIL = new THREE.BoxGeometry(1, 0.07, 0.05);
function Fences() {
  const { posts, rails } = useMemo(() => {
    const posts: { x: number; z: number }[] = [];
    const rails: { x: number; z: number; len: number; rot: number; y: number }[] = [];
    for (const [x0, z0, x1, z1] of FENCES) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.2) continue;
      const n = Math.max(1, Math.round(len / 0.55));
      for (let i = 0; i <= n; i++) posts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n });
      const rot = Math.atan2(-(z1 - z0), x1 - x0);
      for (const y of [0.35, 0.7]) rails.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, len, rot, y });
    }
    return { posts, rails };
  }, []);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const railRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    posts.forEach((p, i) => postRef.current?.setMatrixAt(i, m.compose(v.set(p.x, 0, p.z), q.identity(), s.set(1, 1, 1))));
    rails.forEach((r, i) => railRef.current?.setMatrixAt(i, m.compose(v.set(r.x, r.y, r.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot), s.set(r.len, 1, 1))));
    if (postRef.current) postRef.current.instanceMatrix.needsUpdate = true;
    if (railRef.current) railRef.current.instanceMatrix.needsUpdate = true;
  }, [posts, rails]);
  const paint = mat("#fbf8f1", 0.7);
  return (
    <group>
      <instancedMesh ref={postRef} args={[POST, paint, posts.length]} castShadow />
      <instancedMesh ref={railRef} args={[RAIL, paint, rails.length]} castShadow />
    </group>
  );
}

const CLOTHES = ["#ff6b6b", "#ffd93d", "#4d96ff", "#ffffff", "#6bcb77", "#ff8fab"];

// What makes a yard look lived in: laundry and vegetables behind, flowers and a path in front.
function YardLife({ y, seed }: { y: Yard; seed: number }) {
  const r = useMemo(() => rng(seed), [seed]);
  const house = BUILDINGS.find((b) => b.id === y.house)!;
  const items = useMemo(() => {
    const flowers = Array.from({ length: 8 }, () => ({ x: (r() - 0.5) * (y.w - 0.8), z: (r() < 0.5 ? -1 : 1) * (y.d / 2 - 0.45), c: ["#ff6fa0", "#ffd23f", "#b388ff", "#ff8a65", "#ffffff"][Math.floor(r() * 5)] }));
    return { flowers, clothes: Array.from({ length: 4 }, () => CLOTHES[Math.floor(r() * CLOTHES.length)]) };
  }, [r, y]);
  if (y.side === "front") {
    const gateX = doorX(house);
    return (
      <group position={[y.x, 0, y.z]} rotation={[0, y.rot, 0]}>
        {Array.from({ length: Math.max(1, Math.floor(y.d / 0.6)) }, (_, i) => (
          <mesh key={i} position={[gateX, 0.02, -y.d / 2 + 0.3 + i * 0.6]} receiveShadow material={mat("#d6cfc4", 0.9)}>
            <cylinderGeometry args={[0.24, 0.24, 0.05, 10]} />
          </mesh>
        ))}
        {items.flowers.filter((f) => Math.abs(f.x - gateX) > 0.9).map((f, i) => (
          <mesh key={i} position={[f.x, 0.2, f.z * 0.6]} castShadow material={mat(f.c, 0.7)}>
            <icosahedronGeometry args={[0.2, 0]} />
          </mesh>
        ))}
      </group>
    );
  }
  const hw = y.w / 2;
  return (
    <group position={[y.x, 0, y.z]} rotation={[0, y.rot, 0]}>
      {/* laundry line */}
      {[-hw + 0.8, hw * 0.1].map((x) => (
        <mesh key={x} position={[x, 0.95, -y.d * 0.1]} material={mat("#8a6d3b")}>
          <cylinderGeometry args={[0.04, 0.04, 1.9, 6]} />
        </mesh>
      ))}
      <mesh position={[(-hw + 0.8 + hw * 0.1) / 2, 1.8, -y.d * 0.1]} rotation={[0, 0, Math.PI / 2]} material={mat("#eeeeee")}>
        <cylinderGeometry args={[0.012, 0.012, hw * 1.1 - 0.8, 4]} />
      </mesh>
      {items.clothes.map((c, i) => (
        <mesh key={i} position={[-hw + 1.3 + i * ((hw * 1.1 - 1.6) / 3), 1.45, -y.d * 0.1]} castShadow material={new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.9 })}>
          <planeGeometry args={[0.5, 0.65]} />
        </mesh>
      ))}
      {/* vegetable patch */}
      <mesh position={[hw * 0.5, 0.06, y.d * 0.12]} receiveShadow material={mat("#7a5236", 0.95)}>
        <boxGeometry args={[hw * 0.75, 0.12, y.d * 0.45]} />
      </mesh>
      {Array.from({ length: 3 }, (_, k) =>
        Array.from({ length: 4 }, (_, j) => (
          <mesh key={`${k}${j}`} position={[hw * 0.5 - hw * 0.3 + j * hw * 0.2, 0.26, y.d * 0.12 - y.d * 0.15 + k * y.d * 0.15]} castShadow material={mat(k === 1 ? "#ff6b6b" : "#5fb256", 0.8)}>
            <icosahedronGeometry args={[0.16, 0]} />
          </mesh>
        )),
      )}
      {/* tool shed in the far corner */}
      <group position={[-hw + 1.0, 0, y.d / 2 - 1.0]}>
        <RoundedBox args={[1.4, 1.6, 1.2]} radius={0.06} position={[0, 0.8, 0]} castShadow receiveShadow material={mat("#a87f55", 0.8)} />
        <mesh position={[0, 1.72, 0]} rotation={[0, 0, 0.12]} castShadow material={mat("#5b4a8c", 0.7)}>
          <boxGeometry args={[1.7, 0.1, 1.5]} />
        </mesh>
      </group>
    </group>
  );
}

function FlowerBeds() {
  return (
    <group>
      {FLOWER_BEDS.map((f, i) => {
        const r = rng(70 + i);
        return (
          <group key={i} position={[f.x, 0, f.z]}>
            <mesh position={[0, 0.12, 0]} receiveShadow material={mat("#7a5236", 0.95)}>
              <cylinderGeometry args={[f.r, f.r + 0.1, 0.24, 24]} />
            </mesh>
            {Array.from({ length: 20 }, (_, k) => {
              const a = r() * Math.PI * 2;
              const d = Math.sqrt(r()) * (f.r - 0.2);
              return (
                <mesh key={k} position={[Math.cos(a) * d, 0.36, Math.sin(a) * d]} castShadow material={mat(["#ff6fa0", "#ffd23f", "#b388ff", "#ff8a65", "#ffffff"][Math.floor(r() * 5)], 0.7)}>
                  <icosahedronGeometry args={[0.16, 0]} />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

// --- festoons: bunting over the shopping street, bulbs over the cafe terrace -------------------------------

type Span = [THREE.Vector3Tuple, THREE.Vector3Tuple, number]; // from, to, sag
const B = (id: string) => BUILDINGS.find((b) => b.id === id)!;
const onFacade = (id: string, lx: number, y: number): THREE.Vector3Tuple => {
  const b = B(id);
  const p = fromLocal(b, lx, b.d / 2 + 0.05);
  return [p.x, y, p.z];
};
const onLamp = (i: number, y = 3.5): THREE.Vector3Tuple => [LAMPS[i].x, y, LAMPS[i].z];

/** Zig-zag across the shopping street, strung only between shop facades and the existing lamp and lantern posts. */
function buntingSpans(): Span[] {
  // spans leave the facades at an angle and skip the flower shop front, so no flags hang across a shop sign;
  // the last two fan out from the plaza's corner lantern pole, where the default camera sees them
  const pole: THREE.Vector3Tuple = [LANTERN_POLES[0].x, 4.0, LANTERN_POLES[0].z];
  return [
    [onFacade("bakery", 2.6, 3.85), onLamp(1), 0.55],
    [onLamp(1), onFacade("flower", -2.5, 3.5), 0.55],
    [onFacade("flower", 2.5, 3.5), pole, 0.5],
    [onFacade("ramen", -2.5, 3.5), pole, 0.35],
  ];
}

/** The cafe terrace: from the street lamps over the umbrella tops, and back to the corner of the cafe's annex
 *  (strings from the main facade crossed the cafe's sign). */
function terraceSpans(): Span[] {
  const cafe = B("cafe");
  const annex = fromLocal(cafe, cafe.w / 2 - 0.1, cafe.d * 0.28 + 0.05); // the lower annex is set back from the front
  const u = CAFE_TABLES.slice(0, 2).map((t): THREE.Vector3Tuple => [t.x, 2.95, t.z]);
  return [
    [onLamp(2), u[0], 0.45],
    [u[0], u[1], 0.2],
    [u[1], onLamp(3), 0.45],
    [[annex.x, 2.75, annex.z], u[1], 0.2],
  ];
}

/** Points every `step` metres along each sagging span, with the span's heading. */
function alongSpans(spans: Span[], step: number) {
  return spans.flatMap(([a, b, sag]) => {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const pts = catenary(a, b, sag, Math.max(2, Math.round(len / step)));
    const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
    return pts.slice(1, -1).map((p) => ({ p, yaw }));
  });
}
/** All spans as one line-segment list: one draw call for every string. */
function stringSegments(spans: Span[]) {
  return spans.flatMap(([a, b, sag]) => {
    const pts = catenary(a, b, sag, 16);
    return pts.slice(1).flatMap((p, i) => [pts[i], p]);
  });
}

const PENNANT = new THREE.BufferGeometry();
PENNANT.setAttribute("position", new THREE.Float32BufferAttribute([-0.25, 0, 0, 0.25, 0, 0, 0, -0.55, 0], 3));
PENNANT.computeVertexNormals();
const PENNANT_COLOURS = ["#e2574c", "#ffd23f", "#3a86ff", "#6bcb77", "#ff8fab"];

function Bunting() {
  const spans = useMemo(() => buntingSpans(), []);
  const flags = useMemo(() => alongSpans(spans, 0.58), [spans]);
  const segments = useMemo(() => stringSegments(spans), [spans]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", side: THREE.DoubleSide, roughness: 0.8 }), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const place = useMemo(
    () => (t: number) => {
      const mesh = ref.current;
      if (!mesh) return;
      flags.forEach((f, i) => {
        dummy.position.copy(f.p);
        // flutter about the string: turn to the span's heading first, then swing
        dummy.rotation.set(Math.sin(t * 2.2 + i * 0.7) * 0.22, f.yaw, 0, "YXZ");
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    [flags, dummy],
  );
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    flags.forEach((_, i) => mesh.setColorAt(i, c.set(PENNANT_COLOURS[i % PENNANT_COLOURS.length])));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    place(0);
    mesh.computeBoundingSphere();
  }, [flags, place]);
  useFrame(({ clock: c }) => {
    if (!LITE) place(c.elapsedTime);
  });
  const group = useRef<THREE.Group>(null);
  useShotFade(group, useMemo(() => flags.map((f) => f.p), [flags]), 3.5);
  return (
    <group ref={group} name="set:bunting">
      <Line points={segments} segments color="#5a4a3a" lineWidth={1} />
      <instancedMesh ref={ref} args={[PENNANT, material, flags.length]} />
    </group>
  );
}

function TerraceLights() {
  const spans = useMemo(() => terraceSpans(), []);
  const along = useMemo(() => alongSpans(spans, 0.45), [spans]);
  const bulbs = useMemo<Inst[]>(() => along.map((f) => ({ p: [f.p.x, f.p.y - 0.07, f.p.z] })), [along]);
  const segments = useMemo(() => stringSegments(spans), [spans]);
  const material = useBulbMaterial();
  const group = useRef<THREE.Group>(null);
  useShotFade(group, useMemo(() => along.map((f) => f.p), [along]), 3.5);
  return (
    <group ref={group} name="set:terrace">
      <Line points={segments} segments color="#3b3030" lineWidth={1} />
      <Instances geo={BULB} material={material} items={bulbs} />
    </group>
  );
}

function Bikes() {
  const wheel = useMemo(() => new THREE.TorusGeometry(0.32, 0.04, 6, 18), []);
  const at = fromLocal(BUILDINGS.find((b) => b.id === "mart")!, -2.6, 3.4);
  return (
    <group position={[at.x, 0, at.z]}>
      {["#ff8fab", "#4d96ff"].map((c, i) => (
        <group key={c} position={[i * 0.8, 0, 0]} rotation={[0, Math.PI / 2 + 0.2, 0]}>
          {[-0.45, 0.45].map((z) => (
            <mesh key={z} geometry={wheel} position={[z, 0.34, 0]} material={mat("#222", 0.6)} />
          ))}
          <mesh position={[0, 0.55, 0]} rotation={[0, 0, 0.1]} material={mat(c, 0.4, 0.3)}>
            <boxGeometry args={[0.95, 0.06, 0.06]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function StreetProps() {
  return (
    <group>
      {STALLS.map((s) => (
        <Stall key={s.zh} s={s} />
      ))}
      {BINS.map((b) => (
        <Bin key={`${b.x}${b.z}`} x={b.x} z={b.z} />
      ))}
      <Mailbox />
      <VendingMachine />
      <BusStop />
      <Crates />
      <Fences />
      {YARDS.map((y, i) => (
        <YardLife key={`${y.house}${y.side}`} y={y} seed={200 + i} />
      ))}
      <FlowerBeds />
      <Bunting />
      <TerraceLights />
      <LifeProps />
      <HarbourCrane />
      <Gulls />
      <Bikes />
    </group>
  );
}
