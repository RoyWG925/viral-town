"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { COAST_X, PIERS, PLAYGROUND, POND, QUAY } from "./layout";
import { mat, shade } from "./materials";
import { planksTexture, rng, waterTexture } from "./textures";
import { clock, glow, skyAt } from "./clock";

const WATER_Y = -0.9;

function Water() {
  const m = useMemo(() => {
    const map = waterTexture([22, 40]);
    return new THREE.MeshStandardMaterial({ color: "#3aa6d4", map, roughness: 0.15, metalness: 0.2, emissive: "#0e4f6b", emissiveIntensity: 0.25 });
  }, []);
  useFrame((_, dt) => {
    if (m.map) {
      m.map.offset.x += dt * 0.01;
      m.map.offset.y += dt * 0.004;
    }
  });
  return (
    <mesh position={[COAST_X + 100, WATER_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m}>
      <planeGeometry args={[200, 320]} />
    </mesh>
  );
}

function Quay() {
  const planks = useMemo(() => new THREE.MeshStandardMaterial({ map: planksTexture([3, 18]), roughness: 0.9 }), []);
  const deck = useMemo(() => new THREE.MeshStandardMaterial({ map: planksTexture([4, 1]), roughness: 0.9 }), []);
  const stone = mat("#b9b0a3", 0.9);
  const rail = mat("#2f5d50", 0.5, 0.3);
  // railing runs along the quay edge, with gaps where the piers start
  const gaps = PIERS.map((p) => [p.z0 - 0.2, p.z1 + 0.2] as const);
  const runs: [number, number][] = [];
  let z = QUAY.z0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    runs.push([z, g0]);
    z = g1;
  }
  runs.push([z, QUAY.z1]);
  const qw = QUAY.x1 - QUAY.x0;
  const qd = QUAY.z1 - QUAY.z0;
  return (
    <group>
      <mesh position={[QUAY.x0 + qw / 2, 0.04, QUAY.z0 + qd / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={planks}>
        <planeGeometry args={[qw, qd]} />
      </mesh>
      <mesh position={[COAST_X - 0.3, WATER_Y / 2 - 0.3, QUAY.z0 + qd / 2]} receiveShadow material={stone}>
        <boxGeometry args={[0.6, -WATER_Y + 0.6, qd]} />
      </mesh>
      {runs.map(([a, b]) => (
        <group key={a}>
          <mesh position={[COAST_X - 0.25, 1.0, (a + b) / 2]} material={rail}>
            <boxGeometry args={[0.07, 0.07, b - a]} />
          </mesh>
          {Array.from({ length: Math.max(2, Math.round((b - a) / 2)) + 1 }, (_, i) => (
            <mesh key={i} position={[COAST_X - 0.25, 0.5, a + ((b - a) * i) / Math.max(2, Math.round((b - a) / 2))]} castShadow material={rail}>
              <cylinderGeometry args={[0.05, 0.05, 1.0, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      {PIERS.map((p, k) => (
        <group key={k}>
          <mesh position={[(p.x0 + p.x1) / 2, 0.06, (p.z0 + p.z1) / 2]} castShadow receiveShadow material={deck}>
            <boxGeometry args={[p.x1 - p.x0, 0.14, p.z1 - p.z0]} />
          </mesh>
          {Array.from({ length: Math.round((p.x1 - p.x0) / 2.4) }, (_, i) => p.x0 + 1 + i * 2.4).map((x) =>
            [p.z0 + 0.1, p.z1 - 0.1].map((zz) => (
              <mesh key={`${x}${zz}`} position={[x, -0.4, zz]} castShadow material={mat("#6b4f3a")}>
                <cylinderGeometry args={[0.13, 0.13, 1.4, 8]} />
              </mesh>
            )),
          )}
        </group>
      ))}
      {[-38, -30, -8, 4, 10].map((zz) => (
        <mesh key={zz} position={[COAST_X - 0.7, 0.25, zz]} castShadow material={mat("#3a3a3a", 0.5, 0.5)}>
          <cylinderGeometry args={[0.16, 0.2, 0.5, 10]} />
        </mesh>
      ))}
    </group>
  );
}

// Rocks along the shore south of the quay, so the coast does not end in a straight line.
function Shore() {
  const rocks = useMemo(() => {
    const r = rng(31);
    return Array.from({ length: 26 }, (_, i) => ({ x: COAST_X - 1 + r() * 3, z: QUAY.z1 + 1 + i * 1.3 + r(), s: 0.7 + r() * 1.1, c: shade("#9a948a", (r() - 0.5) * 0.15) }));
  }, []);
  return (
    <group>
      <mesh position={[COAST_X + 3, -0.5, QUAY.z1 + 18]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat("#f2dfb4", 1)}>
        <planeGeometry args={[7, 36]} />
      </mesh>
      {rocks.map((k, i) => (
        <mesh key={i} position={[k.x, -0.2, k.z]} scale={k.s} castShadow receiveShadow material={mat(k.c, 0.95)}>
          <icosahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </group>
  );
}

function Boat({ x, z, color, phase, rot }: { x: number; z: number; color: string; phase: number; rot: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => {
    const t = c.elapsedTime + phase;
    if (ref.current) {
      ref.current.position.y = 0.05 + Math.sin(t * 1.4) * 0.08;
      ref.current.rotation.z = Math.sin(t * 1.1) * 0.05;
      ref.current.rotation.x = Math.cos(t * 0.9) * 0.04;
    }
  });
  return (
    <group position={[x, WATER_Y, z]} rotation={[0, rot, 0]}>
      <group ref={ref}>
        <RoundedBox args={[4.2, 0.9, 1.7]} radius={0.35} position={[0, 0.3, 0]} castShadow material={mat(color, 0.5)} />
        <mesh position={[0, 0.78, 0]} material={mat("#f4efe2", 0.6)}>
          <boxGeometry args={[3.8, 0.08, 1.4]} />
        </mesh>
        <RoundedBox args={[1.4, 0.9, 1.1]} radius={0.12} position={[-0.6, 1.25, 0]} castShadow material={mat("#ffffff", 0.5)} />
        <mesh position={[-0.6, 1.3, 0.56]} material={glow.window}>
          <boxGeometry args={[0.9, 0.35, 0.02]} />
        </mesh>
        <mesh position={[0.9, 2.2, 0]} material={mat("#6b4f3a")}>
          <cylinderGeometry args={[0.05, 0.05, 2.8, 6]} />
        </mesh>
        <mesh position={[1.2, 3.35, 0]} material={mat("#e2574c", 0.7)}>
          <boxGeometry args={[0.55, 0.35, 0.02]} />
        </mesh>
      </group>
    </group>
  );
}

function Lighthouse() {
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff3c4", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), []);
  useFrame(({ clock: c }) => {
    const on = skyAt(clock.hour).lightsOn;
    beamMat.opacity = on * 0.35;
    if (beam.current) beam.current.rotation.y = c.elapsedTime * 0.8;
  });
  return (
    <group position={[82, WATER_Y, -44]}>
      {Array.from({ length: 7 }, (_, i) => {
        const r = rng(60 + i);
        return (
          <mesh key={i} position={[(r() - 0.5) * 9, 0.4, (r() - 0.5) * 7]} scale={2.2 + r() * 1.6} castShadow material={mat("#9a948a", 0.95)}>
            <icosahedronGeometry args={[1, 0]} />
          </mesh>
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[0, 2.2 + i * 1.4, 0]} castShadow material={mat(i % 2 ? "#e63946" : "#ffffff", 0.6)}>
          <cylinderGeometry args={[1.25 - i * 0.08, 1.3 - i * 0.08, 1.4, 20]} />
        </mesh>
      ))}
      <mesh position={[0, 11.2, 0]} material={glow.lamp}>
        <cylinderGeometry args={[0.8, 0.8, 1.2, 16]} />
      </mesh>
      <mesh position={[0, 12.2, 0]} material={mat("#e63946", 0.6)}>
        <coneGeometry args={[1.1, 1.0, 16]} />
      </mesh>
      <mesh ref={beam} position={[0, 11.2, 0]} material={beamMat}>
        <coneGeometry args={[3.2, 26, 16, 1, true]} />
      </mesh>
    </group>
  );
}

function Pond() {
  const ducks = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => {
    if (ducks.current) ducks.current.rotation.y = c.elapsedTime * 0.25;
  });
  const water = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5cc2e6", roughness: 0.1, emissive: "#1f7ea8", emissiveIntensity: 0.3 }), []);
  return (
    <group position={[POND.x, 0, POND.z]}>
      <mesh position={[0, 0.07, 0]} receiveShadow material={mat("#c9c1b6", 0.9)}>
        <cylinderGeometry args={[POND.r + 0.35, POND.r + 0.45, 0.2, 32]} />
      </mesh>
      <mesh position={[0, 0.2, 0]} material={water}>
        <cylinderGeometry args={[POND.r, POND.r, 0.1, 32]} />
      </mesh>
      {[[-1.2, 0.8], [1.4, -1.0], [0.6, 1.6], [-1.6, -1.2]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.26, z]} material={mat("#5fb256", 0.8)}>
          <cylinderGeometry args={[0.35, 0.35, 0.02, 12, 1, false, 0, Math.PI * 1.7]} />
        </mesh>
      ))}
      <group ref={ducks}>
        {[0, 2.1, 4.2].map((a, i) => (
          <group key={a} position={[Math.cos(a) * 2.4, 0.34, Math.sin(a) * 2.4]} rotation={[0, -a, 0]}>
            <mesh scale={[1, 0.7, 1.4]} material={mat(i === 0 ? "#f2c94c" : "#ffffff", 0.6)}>
              <sphereGeometry args={[0.2, 10, 8]} />
            </mesh>
            <mesh position={[0, 0.17, 0.2]} material={mat(i === 0 ? "#f2c94c" : "#ffffff", 0.6)}>
              <sphereGeometry args={[0.12, 10, 8]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function Playground() {
  const { slide, swings } = PLAYGROUND;
  const swing = useRef<THREE.Group[]>([]);
  useFrame(({ clock: c }) => swing.current.forEach((g, i) => g && (g.rotation.x = Math.sin(c.elapsedTime * 2 + i * 1.7) * 0.5)));
  return (
    <group>
      <mesh position={[(slide.x + swings.x) / 2, 0.01, (slide.z + swings.z) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat("#f2d39b", 1)}>
        <circleGeometry args={[5.4, 24]} />
      </mesh>
      <group position={[slide.x, 0, slide.z]} rotation={[0, slide.rot, 0]}>
        <mesh position={[0, 1.0, -0.9]} castShadow material={mat("#3a86ff", 0.5)}>
          <boxGeometry args={[1.2, 0.12, 1.2]} />
        </mesh>
        {[-0.55, 0.55].map((x) =>
          [-1.45, -0.35].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.5, z]} material={mat("#ffd23f", 0.5)}>
              <cylinderGeometry args={[0.06, 0.06, 1.0, 6]} />
            </mesh>
          )),
        )}
        <mesh position={[0, 0.55, 0.65]} rotation={[0.62, 0, 0]} castShadow material={mat("#ff4d6d", 0.4)}>
          <boxGeometry args={[0.8, 0.08, 2.2]} />
        </mesh>
      </group>
      <group position={[swings.x, 0, swings.z]} rotation={[0, swings.rot, 0]}>
        {[-1.8, 1.8].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            {[0.3, -0.3].map((t) => (
              <mesh key={t} position={[0, 1.2, t > 0 ? 0.4 : -0.4]} rotation={[t, 0, 0]} material={mat("#ff9f1c", 0.5)}>
                <cylinderGeometry args={[0.06, 0.06, 2.5, 6]} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0, 2.35, 0]} rotation={[0, 0, Math.PI / 2]} material={mat("#ff9f1c", 0.5)}>
          <cylinderGeometry args={[0.06, 0.06, 3.7, 6]} />
        </mesh>
        {[-0.8, 0.8].map((x, i) => (
          <group key={x} position={[x, 2.35, 0]} ref={(el) => void (el && (swing.current[i] = el))}>
            <mesh position={[0, -0.85, 0]} material={mat("#555")}>
              <boxGeometry args={[0.02, 1.7, 0.02]} />
            </mesh>
            <mesh position={[0, -1.72, 0]} castShadow material={mat("#06d6a0", 0.5)}>
              <boxGeometry args={[0.5, 0.06, 0.25]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

// Rolling hills and far mountains behind the forest frame the town from the default view.
function Hills() {
  const hills = useMemo(() => {
    const r = rng(99);
    return [
      ...Array.from({ length: 9 }, (_, i) => ({ x: -130 + i * 22 + r() * 8, z: -74 - r() * 12, s: 16 + r() * 10, c: shade("#7fb069", (r() - 0.5) * 0.12) })),
      ...Array.from({ length: 4 }, (_, i) => ({ x: -110 - r() * 10, z: -40 + i * 26, s: 14 + r() * 8, c: shade("#86b86e", (r() - 0.5) * 0.12) })),
    ];
  }, []);
  return (
    <group>
      {hills.map((h, i) => (
        <mesh key={i} position={[h.x, -h.s * 0.55, h.z]} scale={[h.s * 1.6, h.s, h.s]} receiveShadow material={mat(h.c, 1)}>
          <sphereGeometry args={[1, 24, 16]} />
        </mesh>
      ))}
      {[-110, -60, -10, 30].map((x, i) => (
        <mesh key={x} position={[x, 9, -140]} material={mat(["#8fa3c7", "#9fb2d4", "#8a9cc0", "#97aacd"][i], 1)}>
          <coneGeometry args={[38, 46, 6]} />
        </mesh>
      ))}
    </group>
  );
}

export default function Terrain() {
  return (
    <group>
      <Water />
      <Quay />
      <Shore />
      <Boat x={53} z={-21} color="#3a86ff" phase={0} rot={0.15} />
      <Boat x={56} z={-9} color="#ff8fab" phase={1.7} rot={-0.25} />
      <Boat x={50} z={4.5} color="#ffd23f" phase={3.1} rot={0.4} />
      <Boat x={66} z={-30} color="#06d6a0" phase={2.2} rot={1.2} />
      <Lighthouse />
      <Pond />
      <Playground />
      <Hills />
    </group>
  );
}
