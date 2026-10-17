"use client";

// Set dressing that turns the town into a stage: waving flags, the festival stage's truss and dove cages,
// chimney smoke, the harbour crane and gulls. Display only: nothing here touches navigation or the simulation.
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mat } from "./materials";
import { clock, skyAt } from "./clock";
import { LITE } from "./quality";
import { curtainTexture } from "./textures";
import { fx } from "./fx";
import { agentFor, show } from "./director";

// --- shared bits -----------------------------------------------------------------

// Festoon bulbs: warm, and kept under the bloom threshold so they twinkle without haloing faces. Each string of
// bulbs gets its own material (so it can fade on its own); one clock tick drives them all.
const bulbMaterials = new Set<THREE.MeshStandardMaterial>();
export function useBulbMaterial() {
  const m = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff1cf", emissive: "#ffcf7a", emissiveIntensity: 0.15, roughness: 0.4 }), []);
  useEffect(() => {
    bulbMaterials.add(m);
    return () => void bulbMaterials.delete(m);
  }, [m]);
  return m;
}
function tickBulbs() {
  const glow = 0.15 + skyAt(clock.hour).lightsOn * 1.05;
  bulbMaterials.forEach((m) => (m.emissiveIntensity = glow));
}
export const BULB = new THREE.SphereGeometry(0.075, 10, 8);

/** One placed copy of a geometry: position, optional euler rotation, scale and colour. */
export interface Inst {
  p: THREE.Vector3Tuple;
  r?: THREE.Vector3Tuple;
  s?: number | THREE.Vector3Tuple;
  c?: string;
}

/** Static instanced copies: one draw call for every item. */
export function Instances({ geo, material, items, castShadow = false }: { geo: THREE.BufferGeometry; material: THREE.Material; items: Inst[]; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromEuler(e.set(...(it.r ?? [0, 0, 0])));
      if (typeof it.s === "number" || it.s === undefined) s.setScalar(it.s ?? 1);
      else s.set(...it.s);
      mesh.setMatrixAt(i, m.compose(v.set(...it.p), q, s));
      if (it.c) mesh.setColorAt(i, col.set(it.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return <instancedMesh key={items.length} ref={ref} args={[geo, material, items.length]} castShadow={castShadow} receiveShadow />;
}

/** A thin member (beam, bar, brace) from a to b, as an instance of a unit box standing on y. */
export function member(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, thick: number): Inst {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const r = new THREE.Euler().setFromQuaternion(q);
  return { p: va.add(vb).multiplyScalar(0.5).toArray(), r: [r.x, r.y, r.z], s: [thick, dir.length(), thick] };
}
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** A sagging string between two points, sampled into n + 1 points. */
export function catenary(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, sag: number, n: number) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const v = va.clone().lerp(vb, t);
    v.y -= sag * 4 * t * (1 - t);
    return v;
  });
}

/** True while the director films someone (close, two-shot or medium) within r metres of any of these points:
 *  strings overhead there would cut across faces, so they fade out the way the cafe umbrellas do. */
export function filmedNear(points: { x: number; z: number }[], r: number) {
  if (show.status !== "playing" && show.status !== "paused") return false;
  const kind = show.shot?.kind;
  if (!kind || kind === "wide" || kind === "overview") return false;
  for (const id of [show.shot?.a, show.shot?.b, ...show.says.map((s) => s.anchor ?? s.npc)]) {
    const ag = id ? agentFor(id) : null;
    if (ag && points.some((p) => (p.x - ag.x) ** 2 + (p.z - ag.z) ** 2 < r * r)) return true;
  }
  return false;
}

/** Fades every material in a group down to a ghost while filmedNear(points, r), and back up afterwards. */
export function useShotFade(group: RefObject<THREE.Group | null>, points: { x: number; z: number }[], r: number) {
  const level = useRef(1);
  useFrame((_, dt) => {
    const goal = filmedNear(points, r) ? 0.12 : 1;
    const cur = level.current;
    if (cur === goal) return;
    const next = Math.abs(goal - cur) < 0.01 ? goal : cur + (goal - cur) * Math.min(1, dt * 6);
    level.current = next;
    group.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m)) return;
      // switching between opaque and transparent recompiles the shader (three drops alpha in opaque programs)
      if (m.transparent !== next < 1) {
        m.transparent = next < 1;
        m.needsUpdate = true;
      }
      m.opacity = next;
      m.depthWrite = next > 0.95;
    });
  });
}

// --- flags ---------------------------------------------------------------------------

/** A cloth flag hoisted at its top-left corner (or top-right when dir = -1); ripples harder toward the fly end. */
export function Flag({ w, h, material, dir = 1, phase = 0 }: { w: number; h: number; material: THREE.Material; dir?: 1 | -1; phase?: number }) {
  const geo = useMemo(() => new THREE.PlaneGeometry(w, h, 10, 2).translate((dir * w) / 2, -h / 2, 0), [w, h, dir]);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock: c }) => {
    const g = mesh.current?.geometry;
    if (!g) return;
    const pos = g.attributes.position;
    const t = c.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const k = Math.abs(base[i * 3]) / w; // 0 at the pole, 1 at the fly end
      pos.setZ(i, Math.sin(k * 5.2 - t * 3.4 + phase) * 0.17 * k);
      pos.setY(i, base[i * 3 + 1] - k * k * 0.07);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  });
  return <mesh ref={mesh} geometry={geo} material={material} castShadow />;
}

// --- chimney smoke ---------------------------------------------------------------------

const PUFF = new THREE.IcosahedronGeometry(0.5, 1);
const puffMaterial = new THREE.MeshStandardMaterial({ color: "#f4f1ec", transparent: true, opacity: 0.5, depthWrite: false, roughness: 1 });

/** Soft puffs rising from a chimney and drifting with the breeze. Skipped in LITE. */
export function Puffs({ position, n = 5, period = 4.5 }: { position: THREE.Vector3Tuple; n?: number; period?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock: c }) => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < n; i++) {
      const k = (c.elapsedTime / period + i / n) % 1;
      const grow = 0.25 + k * 0.6;
      dummy.position.set(k * k * 1.1, k * 2.4, k * 0.3);
      dummy.scale.setScalar(grow * (k > 0.75 ? (1 - k) / 0.25 : 1));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (LITE) return null;
  return <instancedMesh ref={ref} args={[PUFF, puffMaterial, n]} position={position} frustumCulled={false} />;
}

// --- the festival stage ------------------------------------------------------------

const DECK = 0.7;
const TRUSS_H = 4.6;
const CAGE = { w: 0.6, h: 0.46, d: 0.48 };
const DOVE_BODY = new THREE.SphereGeometry(0.085, 10, 8).scale(0.95, 0.85, 1.5);
const DOVE_HEAD = new THREE.SphereGeometry(0.055, 8, 6);
const DOVE_BEAK = new THREE.ConeGeometry(0.018, 0.05, 6).rotateX(Math.PI / 2);
const BLOSSOM = new THREE.IcosahedronGeometry(0.06, 0);
const SPEAKER_CONE = new THREE.CircleGeometry(1, 18);

/** Cage centres (stage-local, on the deck): a pyramid stack of six at the near end, three at the far end. */
function cageSpots(w: number) {
  const out: THREE.Vector3Tuple[] = [];
  const stack = (x: number, rows: number[][]) =>
    rows.forEach((zs, level) => zs.forEach((z) => out.push([x, DECK + CAGE.h / 2 + level * (CAGE.h + 0.02), z])));
  stack(-w / 2 + 0.85, [[-0.85, -0.35, 0.15], [-0.6, -0.1], [-0.35]]);
  stack(w / 2 - 0.85, [[-0.85, -0.35], [-0.6]]);
  return out;
}

const zig = (k: number) => (k % 2 ? -1 : 1); // alternate the braces into a zig-zag

function trussMembers(w: number, d: number): Inst[] {
  const out: Inst[] = [];
  const z = d / 2 - 0.14;
  const x0 = -w / 2 + 0.14;
  const x1 = w / 2 - 0.14;
  const g = 0.11; // half the gap between a truss's two chords
  // two uprights at the front corners and a beam across the top: a proscenium the audience looks through
  for (const x of [x0, x1]) {
    const inward = x < 0 ? 1 : -1;
    out.push(member([x - g, DECK, z], [x - g, TRUSS_H + g, z], 0.05), member([x + g, DECK, z], [x + g, TRUSS_H + g, z], 0.05));
    for (let y = DECK, k = 0; y < TRUSS_H - 0.2; y += 0.42, k++) out.push(member([x - g * inward * zig(k), y, z], [x + g * inward * zig(k), y + 0.42, z], 0.03));
  }
  out.push(member([x0, TRUSS_H - g, z], [x1, TRUSS_H - g, z], 0.05), member([x0, TRUSS_H + g, z], [x1, TRUSS_H + g, z], 0.05));
  for (let x = x0, k = 0; x < x1 - 0.2; x += 0.42, k++) out.push(member([x, TRUSS_H - g * zig(k), z], [x + 0.42, TRUSS_H + g * zig(k), z], 0.03));
  return out;
}

/** Stage dressing in the stage's own frame: deep-red backdrop, light truss, speakers and the dove cages. */
export function StageDressing({ w, d }: { w: number; d: number }) {
  const curtain = useMemo(() => new THREE.MeshStandardMaterial({ map: curtainTexture(), roughness: 0.9 }), []);
  const metal = mat("#b4bac4", 0.45, 0.25); // matt aluminium: a dark, metallic truss read as a heavy cage over the stage
  const bulbs = useBulbMaterial();
  const truss = useMemo(() => trussMembers(w, d), [w, d]);
  const lights = useMemo<Inst[]>(() => {
    const z = d / 2 - 0.14;
    const out: Inst[] = [];
    for (let x = -w / 2 + 0.55; x <= w / 2 - 0.5; x += 0.5) out.push({ p: [x, TRUSS_H - 0.27, z + 0.02] });
    for (const x of [-w / 2 + 0.14, w / 2 - 0.14]) for (let y = 1.5; y < TRUSS_H - 0.4; y += 0.7) out.push({ p: [x, y, z + 0.16] });
    return out;
  }, [w, d]);
  const speakers = useMemo(() => {
    const body: Inst[] = [];
    const cones: Inst[] = [];
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - 0.62);
      const z = d / 2 - 0.42;
      const ry = -side * 0.3;
      const fwd = (dz: number): [number, number] => [x + Math.sin(ry) * dz, z + Math.cos(ry) * dz];
      body.push({ p: [x, DECK + 0.36, z], r: [0, ry, 0], s: [0.62, 0.72, 0.5] }, { p: [x, DECK + 0.97, z], r: [0, ry, 0], s: [0.5, 0.5, 0.44] });
      const [lx, lz] = fwd(0.26);
      const [ux, uz] = fwd(0.23);
      cones.push({ p: [lx, DECK + 0.36, lz], r: [0, ry, 0], s: 0.2 }, { p: [ux, DECK + 0.99, uz], r: [0, ry, 0], s: 0.14 });
    }
    return { body, cones };
  }, [w, d]);
  return (
    <group name="set:stage">
      <mesh position={[0, DECK + 1.6, -d / 2 + 0.08]} receiveShadow material={curtain}>
        <boxGeometry args={[w - 0.8, 3.2, 0.06]} />
      </mesh>
      <Instances geo={UNIT_BOX} material={metal} items={truss} castShadow />
      <Instances geo={BULB} material={bulbs} items={lights} />
      <Instances geo={UNIT_BOX} material={mat("#2b2b2e", 0.6)} items={speakers.body} castShadow />
      <Instances geo={SPEAKER_CONE} material={mat("#6b6f78", 0.5, 0.3)} items={speakers.cones} />
      <DoveCages w={w} />
      <BulbClock />
    </group>
  );
}

/** Keeps every festoon bulb's glow in step with the clock (mounted once, with the stage). */
function BulbClock() {
  useFrame(tickBulbs);
  return null;
}

// The opening's 100 white doves wait in rattan cages on the stage: healthy, preening, bobbing.
function DoveCages({ w }: { w: number }) {
  const spots = useMemo(() => cageSpots(w), [w]);
  const parts = useMemo(() => {
    const plates: Inst[] = [];
    const bars: Inst[] = [];
    const blossoms: Inst[] = [];
    const doves: { x: number; y: number; z: number; yaw: number; seed: number }[] = [];
    spots.forEach(([cx, cy, cz], k) => {
      const bottom = cy - CAGE.h / 2;
      plates.push({ p: [cx, bottom + 0.025, cz], s: [CAGE.w + 0.04, 0.05, CAGE.d + 0.04] }, { p: [cx, cy + CAGE.h / 2, cz], s: [CAGE.w + 0.06, 0.04, CAGE.d + 0.06] });
      for (let i = 0; i <= 6; i++)
        for (const z of [-CAGE.d / 2, CAGE.d / 2]) bars.push({ p: [cx - CAGE.w / 2 + (i * CAGE.w) / 6, cy, cz + z], s: [0.018, CAGE.h, 0.018] });
      for (let i = 1; i < 4; i++) for (const x of [-CAGE.w / 2, CAGE.w / 2]) bars.push({ p: [cx + x, cy, cz - CAGE.d / 2 + (i * CAGE.d) / 4], s: [0.018, CAGE.h, 0.018] });
      // the florist's festival flowers along the top cages
      if (k === 5 || k === spots.length - 1)
        for (let i = 0; i < 6; i++) blossoms.push({ p: [cx - CAGE.w / 2 + 0.05 + i * 0.1, cy + CAGE.h / 2 + 0.05, cz + CAGE.d / 2 - 0.02], c: ["#ff6fa0", "#ffd23f", "#ffffff"][i % 3] });
      for (const dx of [-0.13, 0.13]) doves.push({ x: cx + dx, y: bottom + 0.13, z: cz + dx * 0.4, yaw: Math.PI / 2 + dx * 6 + k, seed: k * 2 + (dx > 0 ? 1 : 0) });
    });
    return { plates, bars, blossoms, doves };
  }, [spots]);
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const beak = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const place = useMemo(
    () => (t: number) => {
      parts.doves.forEach((dv, i) => {
        // a gentle bob, and every few seconds the head turns to look around
        const bob = Math.sin(t * 3 + dv.seed) * 0.008;
        const look = Math.sin(t * 0.9 + dv.seed * 1.7) > 0.6 ? 0.7 : 0;
        dummy.position.set(dv.x, dv.y + bob, dv.z);
        dummy.rotation.set(0, dv.yaw, 0);
        dummy.updateMatrix();
        body.current?.setMatrixAt(i, dummy.matrix);
        const hx = dv.x + Math.sin(dv.yaw) * 0.1;
        const hz = dv.z + Math.cos(dv.yaw) * 0.1;
        dummy.rotation.set(0, dv.yaw + look, 0);
        dummy.position.set(hx, dv.y + bob + 0.08, hz);
        dummy.updateMatrix();
        head.current?.setMatrixAt(i, dummy.matrix);
        dummy.position.set(hx + Math.sin(dv.yaw + look) * 0.055, dv.y + bob + 0.075, hz + Math.cos(dv.yaw + look) * 0.055);
        dummy.updateMatrix();
        beak.current?.setMatrixAt(i, dummy.matrix);
      });
      for (const m of [body, head, beak]) if (m.current) m.current.instanceMatrix.needsUpdate = true;
    },
    [parts, dummy],
  );
  useLayoutEffect(() => place(0), [place]);
  useFrame(({ clock: c }) => {
    if (!LITE) place(c.elapsedTime);
  });
  const white = mat("#fbfbf7", 0.6);
  const n = parts.doves.length;
  return (
    <group>
      <Instances geo={UNIT_BOX} material={mat("#a8774a", 0.8)} items={parts.plates} castShadow />
      <Instances geo={UNIT_BOX} material={mat("#e6d3a3", 0.7)} items={parts.bars} />
      <Instances geo={BLOSSOM} material={mat("#ffffff", 0.7)} items={parts.blossoms} />
      <instancedMesh ref={body} args={[DOVE_BODY, white, n]} frustumCulled={false} />
      <instancedMesh ref={head} args={[DOVE_HEAD, white, n]} frustumCulled={false} />
      <instancedMesh ref={beak} args={[DOVE_BEAK, mat("#f4a259", 0.6), n]} frustumCulled={false} />
    </group>
  );
}

// --- the harbour ---------------------------------------------------------------------

const CRANE = { x: 47.8, z: -9.6 }; // on its own footing in the water, off every walkable cell
const MAST_H = 5.6;
const JIB = 6.0;
const CAB_AND_JIB = mergeGeometries([
  new THREE.BoxGeometry(0.9, 0.8, 0.9).translate(0, 0.1, 0),
  new THREE.BoxGeometry(JIB + 0.9, 0.24, 0.24).translate((JIB - 2.1) / 2, 0.6, 0),
]);

/** A yellow jib crane slowly slewing a crate between the quay and the moored boat. */
export function HarbourCrane() {
  const slew = useRef<THREE.Group>(null);
  const rope = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => {
    const t = c.elapsedTime;
    // centred on north, out over the quay at one end of the swing and over the boat at the other
    if (slew.current) slew.current.rotation.y = Math.PI / 2 + Math.sin(t * 0.1) * 1.2;
    if (rope.current) rope.current.rotation.z = Math.sin(t * 0.9) * 0.05;
  });
  const yellow = mat("#f4c542", 0.5, 0.2);
  return (
    <group name="set:crane" position={[CRANE.x, 0, CRANE.z]}>
      <mesh position={[0, -0.55, 0]} receiveShadow material={mat("#9a948a", 0.9)}>
        <boxGeometry args={[1.8, 1.7, 1.8]} />
      </mesh>
      <mesh position={[0, 0.42, 0]} material={mat("#3d405b", 0.5, 0.4)}>
        <cylinderGeometry args={[0.7, 0.8, 0.25, 16]} />
      </mesh>
      <mesh position={[0, 0.5 + MAST_H / 2, 0]} castShadow material={yellow}>
        <cylinderGeometry args={[0.16, 0.22, MAST_H, 10]} />
      </mesh>
      <group ref={slew} position={[0, MAST_H + 0.5, 0]}>
        <mesh geometry={CAB_AND_JIB} castShadow material={yellow} />
        <mesh position={[0.46, 0.18, 0]} material={mat("#bfe3ff", 0.15, 0.3)}>
          <boxGeometry args={[0.02, 0.4, 0.6]} />
        </mesh>
        <mesh position={[-1.1, 0.55, 0]} castShadow material={mat("#e2574c", 0.6)}>
          <boxGeometry args={[0.8, 0.6, 0.6]} />
        </mesh>
        <group ref={rope} position={[JIB - 0.75, 0.5, 0]}>
          <mesh position={[0, -1.4, 0]} material={mat("#2b2b2b", 0.6)}>
            <cylinderGeometry args={[0.015, 0.015, 2.8, 4]} />
          </mesh>
          <mesh position={[0, -3.25, 0]} castShadow material={mat("#3a86ff", 0.7)}>
            <boxGeometry args={[0.85, 0.75, 0.85]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

const GULL_BODY = new THREE.SphereGeometry(0.13, 8, 6).scale(0.8, 0.7, 1.8);
const GULL_WING = new THREE.BoxGeometry(0.6, 0.02, 0.2).translate(0.3, 0, 0);
const GULLS = Array.from({ length: 10 }, (_, i) => ({ group: i % 4, lag: Math.floor(i / 4) * 0.35 + (i % 2) * 0.12, dy: (i % 3) * 0.4 }));
const GROUPS = [
  { x: 48, z: -12, r: 7, y: 7.5, w: 0.3 },
  { x: 52, z: -4, r: 9, y: 8.6, w: -0.24 },
  { x: 46, z: -22, r: 6, y: 7, w: 0.38 },
  { x: 55, z: -16, r: 10, y: 9, w: -0.28 },
];

/** Four loose flocks of gulls wheeling over the harbour. Skipped in LITE. */
export function Gulls() {
  const body = useRef<THREE.InstancedMesh>(null);
  const wing = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flap = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Matrix4(), []);
  useFrame(({ clock: c }) => {
    const t = c.elapsedTime;
    GULLS.forEach((gl, i) => {
      const g = GROUPS[gl.group];
      const a = t * g.w - gl.lag * Math.sign(g.w);
      dummy.position.set(g.x + Math.cos(a) * g.r, g.y + gl.dy + Math.sin(t * 0.7 + i) * 0.3, g.z + Math.sin(a) * g.r);
      // fly along the circle, banking into the turn
      dummy.rotation.set(0, -a + (g.w > 0 ? 0 : Math.PI), Math.sign(g.w) * 0.35, "YXZ");
      dummy.updateMatrix();
      body.current?.setMatrixAt(i, dummy.matrix);
      const beat = Math.sin(t * 7 + i * 1.3) * 0.5 + 0.15;
      for (const side of [0, 1]) {
        // the far wing is the near one turned around, so both tips rise and fall together
        flap.rotation.set(0, side ? Math.PI : 0, beat);
        flap.updateMatrix();
        wing.current?.setMatrixAt(i * 2 + side, tmp.multiplyMatrices(dummy.matrix, flap.matrix));
      }
    });
    if (body.current) body.current.instanceMatrix.needsUpdate = true;
    if (wing.current) wing.current.instanceMatrix.needsUpdate = true;
  });
  if (LITE) return null;
  return (
    <group name="set:gulls">
      <instancedMesh ref={body} args={[GULL_BODY, mat("#fbfbf7", 0.7), GULLS.length]} frustumCulled={false} />
      <instancedMesh ref={wing} args={[GULL_WING, mat("#e3e6ea", 0.7), GULLS.length * 2]} frustumCulled={false} />
    </group>
  );
}

// --- dev ------------------------------------------------------------------------------

/** dev only: lab screenshots frame set pieces up close (`__cam.look([x, y, z], [tx, ty, tz])`) and can poke the
 *  shared display state (`__fx.stageWobbleUntil = performance.now() + 2500`). */
export function DevCam() {
  const { camera, controls, gl, scene } = useThree() as unknown as {
    camera: THREE.Camera;
    controls: { target: THREE.Vector3; update: () => void } | null;
    gl: THREE.WebGLRenderer;
    scene: THREE.Scene;
  };
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const look = (p: THREE.Vector3Tuple, t: THREE.Vector3Tuple) => {
      camera.position.set(...p);
      controls?.target.set(...t);
      controls?.update();
    };
    Object.assign(window, { __cam: { camera, controls, gl, scene, look }, __fx: fx });
  }, [camera, controls, gl, scene]);
  return null;
}
