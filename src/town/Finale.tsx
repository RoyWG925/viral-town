"use client";

// 20:00, the lantern festival: about eight seconds of what the evening came to, before any text. Lanterns rise
// (fewer when the festival shrank, none when it was cancelled), white doves burst from the stage unless they never
// arrived, fireworks unless the money ran out. The crowd, the mayor and protest signs are moved by the director;
// this layer draws the sky. Everything here follows the outcome tags computed from the log (readiness.ts).
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SPOTS } from "../sim/geo.ts";
import { show } from "./director";

const CENTRE = { x: (SPOTS.plaza.x + SPOTS.stage.x) / 2, z: (SPOTS.plaza.z + SPOTS.stage.z) / 2 };
const seeded = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const lanternCount = (kind: string, tags: string[]) =>
  kind === "cancelled" ? 0 : tags.includes("packed") ? 120 : kind === "postponed" ? 24 : kind === "reduced" ? 46 : tags.includes("thin_crowd") ? 40 : 80;

function Lanterns() {
  const MAX = 120;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.22, 0.17, 0.42, 8), []);
  // emissive above the bloom threshold, so each lantern glows
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffb35c", emissive: new THREE.Color("#ff8a2a"), emissiveIntensity: 2.2, roughness: 0.6 }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const m = ref.current;
    const f = show.finale;
    if (!m) return;
    const n = f ? lanternCount(f.kind, f.tags) : 0;
    // a postponed festival lights its lanterns late
    const t = f ? show.clock - f.start - (f.kind === "postponed" ? 3 : 0) : 0;
    for (let i = 0; i < MAX; i++) {
      const delay = seeded(i) * 3.2;
      const life = t - delay;
      if (!f || i >= n || life < 0) {
        dummy.scale.setScalar(0);
      } else {
        const r = 2 + seeded(i + 99) * 9;
        const a = seeded(i + 7) * Math.PI * 2;
        const rise = Math.min(life, 40) * (0.7 + seeded(i + 3) * 0.6);
        dummy.position.set(CENTRE.x + Math.cos(a) * r + Math.sin(life * 0.7 + i) * 0.4, 1.2 + rise, CENTRE.z + Math.sin(a) * r + Math.cos(life * 0.5 + i) * 0.4);
        dummy.scale.setScalar(Math.min(1, life * 2));
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, MAX]} frustumCulled={false} />;
}

function Doves() {
  const N = 26;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    // two triangles: a white bird seen from below
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-0.35, 0, 0, 0, 0, 0.12, 0, 0, -0.12, 0.35, 0, 0, 0, 0, -0.12, 0, 0, 0.12], 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const m = ref.current;
    const f = show.finale;
    if (!m) return;
    const on = !!f && f.kind !== "cancelled" && !f.tags.includes("no_pigeons");
    const t = f ? show.clock - f.start - 0.6 : 0;
    for (let i = 0; i < N; i++) {
      if (!on || t < 0 || t > 14) dummy.scale.setScalar(0);
      else {
        const a = seeded(i + 51) * Math.PI * 2;
        const out = t * (1.6 + seeded(i + 5) * 1.6);
        const from = f!.tags.includes("on_square") ? SPOTS.plaza : SPOTS.stage;
        dummy.position.set(from.x + Math.cos(a) * out, 2 + t * (2.2 + seeded(i + 17)), from.z + Math.sin(a) * out);
        dummy.rotation.set(Math.sin(t * 14 + i) * 0.6, -a, 0);
        dummy.scale.setScalar(1);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, N]} frustumCulled={false} />;
}

const BURSTS = [
  { at: 2.6, x: -4, z: -6, color: "#ff5d73" },
  { at: 3.8, x: 3, z: -9, color: "#ffd93d" },
  { at: 5.0, x: -1, z: -12, color: "#6ee7ff" },
  { at: 6.1, x: 5, z: -5, color: "#c084fc" },
];
function Fireworks() {
  const P = 70;
  const pts = useRef<(THREE.Object3D | null)[]>([]);
  const dirs = useMemo(() => {
    const d: number[] = [];
    for (let i = 0; i < P; i++) {
      const u = seeded(i + 200) * 2 - 1;
      const th = seeded(i + 300) * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      d.push(s * Math.cos(th), u, s * Math.sin(th));
    }
    return d;
  }, []);
  const geos = useMemo(() => BURSTS.map(() => new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(P * 3), 3))), []);
  const mats = useMemo(() => BURSTS.map((b) => new THREE.PointsMaterial({ color: b.color, size: 0.35, transparent: true, depthWrite: false })), []);
  useFrame(() => {
    const f = show.finale;
    const on = !!f && (f.kind === "on" || f.kind === "reduced") && !f.tags.includes("no_fireworks");
    BURSTS.forEach((b, k) => {
      const p = pts.current[k];
      if (!p) return;
      const t = f ? show.clock - f.start - b.at : -1;
      p.visible = on && t > 0 && t < 2.2;
      if (!p.visible) return;
      const pos = geos[k].attributes.position as THREE.BufferAttribute;
      const r = 1 + t * 4.5;
      for (let i = 0; i < P; i++) pos.setXYZ(i, CENTRE.x + b.x + dirs[i * 3] * r, 22 + dirs[i * 3 + 1] * r - t * t * 0.8, CENTRE.z + b.z + dirs[i * 3 + 2] * r);
      pos.needsUpdate = true;
      mats[k].opacity = Math.max(0, 1 - t / 2.2);
    });
  });
  return (
    <group>
      {BURSTS.map((b, k) => (
        <points key={k} ref={(el) => (pts.current[k] = el)} geometry={geos[k]} material={mats[k]} frustumCulled={false} visible={false} />
      ))}
    </group>
  );
}

export default function Finale() {
  return (
    <group name="finale">
      <Lanterns />
      <Doves />
      <Fireworks />
    </group>
  );
}
