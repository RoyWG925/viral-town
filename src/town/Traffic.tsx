"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { CARRIAGEWAY, CROSSINGS, inObb, sampled } from "./layout";
import { crowd, extraObstacles } from "./crowdSim";
import { glow } from "./clock";
import { DT_MAX } from "./quality";
import { mat, shade } from "./materials";

const WHEEL = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14).rotateX(Math.PI / 2);

export function CarBody({ color }: { color: string }) {
  return (
    <group>
      <RoundedBox args={[3.2, 0.9, 1.7]} radius={0.25} position={[0, 0.75, 0]} castShadow material={mat(color, 0.4, 0.1)} />
      <RoundedBox args={[1.8, 0.75, 1.5]} radius={0.22} position={[-0.25, 1.45, 0]} castShadow material={mat(shade(color, 0.12), 0.4, 0.1)} />
      <mesh position={[-0.25, 1.47, 0]} material={mat("#2c3e50", 0.15, 0.4)}>
        <boxGeometry args={[1.84, 0.5, 1.42]} />
      </mesh>
      {[-1.05, 1.05].map((x) =>
        [-0.82, 0.82].map((z) => <mesh key={`${x}${z}`} geometry={WHEEL} position={[x, 0.36, z]} material={mat("#222", 0.6)} />),
      )}
      {[-0.55, 0.55].map((z) => (
        <mesh key={z} position={[1.61, 0.85, z]} material={glow.lamp}>
          <sphereGeometry args={[0.13, 10, 8]} />
        </mesh>
      ))}
    </group>
  );
}

// The main road as an arc-length table: cars move by distance along it and read position and heading back.
const LINE = sampled.main;
const S: number[] = [0];
for (let i = 1; i < LINE.length; i++) S.push(S[i - 1] + Math.hypot(LINE[i][0] - LINE[i - 1][0], LINE[i][1] - LINE[i - 1][1]));
const LENGTH = S[S.length - 1];
const LANE = 1.4; // drive on the right

function at(s: number) {
  let lo = 0;
  let hi = S.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (S[m] <= s) lo = m;
    else hi = m;
  }
  const t = (s - S[lo]) / (S[hi] - S[lo] || 1);
  const [ax, az] = LINE[lo];
  const [bx, bz] = LINE[hi];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / len, tz: (bz - az) / len };
}

function project(x: number, z: number) {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < LINE.length - 1; i++) {
    const [ax, az] = LINE[i];
    const [bx, bz] = LINE[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) {
      best = d;
      bestS = S[i] + t * Math.sqrt(l2);
    }
  }
  return bestS;
}

// Cars yield to people on the asphalt part of a crossing, not to anyone walking past on the sidewalk.
const CROSS_S = CROSSINGS.map((c) => {
  const s = project(c.x, c.z);
  return { c: { ...c, d: CARRIAGEWAY + 1.2 }, s, half: c.w / 2, p: at(s) };
});

interface Car {
  s: number;
  dir: 1 | -1;
  v: number;
  max: number;
  color: string;
}

export default function Traffic() {
  const cars = useRef<Car[]>([
    { s: 20, dir: 1, v: 6, max: 6.5, color: "#ff8fab" },
    { s: 70, dir: 1, v: 5, max: 5.2, color: "#9ad1d4" },
    { s: 120, dir: 1, v: 5, max: 5.8, color: "#f4a261" },
    { s: 40, dir: -1, v: 6, max: 6.2, color: "#ffd93d" },
    { s: 95, dir: -1, v: 5, max: 5.5, color: "#b983ff" },
    { s: 150, dir: -1, v: 5, max: 4.8, color: "#7bd389" },
  ]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __cars: Car[] }).__cars = cars.current;

  useFrame((_, delta) => {
    const dt = Math.min(delta, DT_MAX);
    // For each crossing, where across the road (metres right of the forward direction) people (and pets) are.
    const busy = CROSS_S.map(({ c, p }) => {
      const lat = (x: number, z: number) => (x - p.x) * -p.tz + (z - p.z) * p.tx;
      const out: number[] = [];
      for (const a of crowd.agents) if (a.mode !== "inside" && inObb(c, a.x, a.z, 0.3)) out.push(lat(a.x, a.z));
      for (const o of extraObstacles.list) if (inObb(c, o.x, o.z, 0.3)) out.push(lat(o.x, o.z));
      return out;
    });
    cars.current.forEach((c, i) => {
      const front = c.s + c.dir * 1.7;
      let target = c.max;
      CROSS_S.forEach(({ s, half }, k) => {
        // yield to anyone in this car's lane or about to step into it
        if (!busy[k].some((lat) => Math.abs(lat * c.dir - LANE) < 2.3)) return;
        const gap = (s - c.dir * (half + 0.8) - front) * c.dir;
        if (gap > -0.5 && gap < 10) target = Math.min(target, Math.max(0, (gap - 0.3) * 0.8));
      });
      const ahead = cars.current
        .filter((o) => o !== c && o.dir === c.dir)
        .map((o) => (o.s - c.s) * c.dir)
        .filter((d) => d > 0)
        .reduce((m, d) => Math.min(m, d), Infinity);
      if (ahead < 9) target = Math.min(target, Math.max(0, (ahead - 4.5) * 1.2));
      c.v += Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), dt * (target < c.v ? 9 : 3));
      c.s += c.dir * c.v * dt;
      if (c.s > LENGTH) c.s -= LENGTH;
      if (c.s < 0) c.s += LENGTH;
      const g = refs.current[i];
      if (!g) return;
      const p = at(c.s);
      const hx = p.tx * c.dir;
      const hz = p.tz * c.dir;
      // right-hand normal of the heading is (-hz, hx)
      g.position.set(p.x - hz * LANE, 0, p.z + hx * LANE);
      g.rotation.y = Math.atan2(-hz, hx);
      g.visible = c.s > 3 && c.s < LENGTH - 3; // pop in and out beyond the town's ends
    });
  });

  return (
    <group>
      {cars.current.map((c, i) => (
        <group key={i} ref={(el) => void (refs.current[i] = el)}>
          <CarBody color={c.color} />
        </group>
      ))}
    </group>
  );
}
