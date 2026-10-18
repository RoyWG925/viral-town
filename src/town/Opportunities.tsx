"use client";

// The three opportunities lying around Mistport (src/sim/festival.ts), drawn so a player can spot them: a banana
// peel by the plaza notice board, a dove cage held shut with tape, and the lantern generator behind the stage with
// its gauge on empty. They change only when the log says so: the peel disappears when someone slips or Rosa sweeps
// it, the doves flap off to the town hall roof when the cage is knocked, and at 20:00 the lights stay off if nobody
// refueled the generator.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { SPOTS } from "../sim/geo.ts";
import { STAGE, fromLocal, wallHeight } from "./layout";
import { show } from "./director";
import { mat } from "./materials";
import { labelTexture } from "./labels";
import { lightsOff } from "./clock";

const board = { x: SPOTS.plaza.x - 1.2, z: SPOTS.plaza.z - 0.6 };
/** where each opportunity sits (the opening's camera visits them too) */
export const OPP_SPOTS = {
  // out in the open between the notice board and the fountain, where people crossing the plaza walk (the corn stall hides the board's foot)
  peel: { x: SPOTS.plaza.x + 0.9, z: SPOTS.plaza.z - 1.3 },
  cage: fromLocal(STAGE, -STAGE.w / 2 + 0.85, -0.35),
  // at the near end of the stage, beside the cages, where the camera sees it (behind the backdrop it was hidden)
  generator: fromLocal(STAGE, -(STAGE.w / 2 + 0.9), -0.5),
};
const ROOF_Y = wallHeight(2) + 0.12;
const ROOF_Z = -30.6 + 4.5 - 0.3;

function BananaPeel() {
  const ref = useRef<THREE.Group>(null);
  const peel = useMemo(() => mat("#f2c94c", 0.6), []);
  const tip = useMemo(() => mat("#6b4f1d", 0.8), []);
  useFrame(() => {
    if (ref.current) ref.current.visible = show.peel === "down";
  });
  // three floppy strips around a stub: unmistakably a banana peel from the default camera
  return (
    <group ref={ref} position={[OPP_SPOTS.peel.x, 0.05, OPP_SPOTS.peel.z]} rotation={[0, 0.7, 0]} scale={1.7}>
      <mesh material={peel} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.12, 8]} />
      </mesh>
      {[0, 2.1, 4.2].map((a) => (
        <mesh key={a} material={peel} position={[Math.cos(a) * 0.2, -0.02, Math.sin(a) * 0.2]} rotation={[0, -a, 0.15]} castShadow>
          <boxGeometry args={[0.36, 0.03, 0.12]} />
        </mesh>
      ))}
      <mesh material={tip} position={[0, 0.07, 0]}>
        <sphereGeometry args={[0.035, 6, 4]} />
      </mesh>
    </group>
  );
}

function TapedCage() {
  const tape = useMemo(() => mat("#ffd23f", 0.5), []);
  const sign = useMemo(() => labelTexture("tape only!", "#fff4c2", "#8a5a00"), []);
  // a cross of yellow tape over the top cage of the near stack, and a hand-written note
  return (
    <group position={[OPP_SPOTS.cage.x, 0.7 + 0.46 * 2.5 + 0.08, OPP_SPOTS.cage.z]}>
      <mesh material={tape} rotation={[0, 0.6, 0]}>
        <boxGeometry args={[0.78, 0.06, 0.12]} />
      </mesh>
      <mesh material={tape} rotation={[0, -0.6, 0]}>
        <boxGeometry args={[0.78, 0.06, 0.12]} />
      </mesh>
      <Billboard position={[0, 0.42, 0]}>
        <mesh>
          <planeGeometry args={[sign.aspect * 0.24, 0.24]} />
          <meshBasicMaterial map={sign.texture} transparent />
        </mesh>
      </Billboard>
    </group>
  );
}

function Generator() {
  const gauge = useMemo(() => labelTexture("⛽ E", "#2c3e50", "#ff6b6b"), []);
  return (
    <group position={[OPP_SPOTS.generator.x, 0, OPP_SPOTS.generator.z]}>
      <mesh position={[0, 0.38, 0]} material={mat("#4f6d5a", 0.7)} castShadow>
        <boxGeometry args={[0.95, 0.72, 0.6]} />
      </mesh>
      <mesh position={[0, 0.8, 0]} material={mat("#2f3b35", 0.6)}>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 8]} />
      </mesh>
      {/* a red jerry can, standing ready */}
      <mesh position={[0.72, 0.24, 0.1]} material={mat("#c0392b", 0.5)} castShadow>
        <boxGeometry args={[0.3, 0.46, 0.18]} />
      </mesh>
      <Billboard position={[0, 1.25, 0]}>
        <mesh>
          <planeGeometry args={[gauge.aspect * 0.32, 0.32]} />
          <meshBasicMaterial map={gauge.texture} transparent />
        </mesh>
      </Billboard>
    </group>
  );
}

/** The doves after the cage is knocked: a flutter up to the town hall roof, then a row of white birds watching. */
function RoofDoves() {
  const N = 14;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.SphereGeometry(0.16, 8, 6).scale(1.3, 1, 0.9), []);
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t0 = show.dovesEscapedAt;
    for (let i = 0; i < N; i++) {
      if (t0 === null) dummy.scale.setScalar(0);
      else {
        const k = Math.min(1, (show.clock - t0) / 3.5);
        const roof = { x: -5.5 + (i * 11) / (N - 1), y: ROOF_Y, z: ROOF_Z };
        const from = { x: OPP_SPOTS.cage.x, y: 1.6, z: OPP_SPOTS.cage.z };
        const arc = Math.sin(k * Math.PI) * 4;
        dummy.position.set(from.x + (roof.x - from.x) * k, from.y + (roof.y - from.y) * k + arc, from.z + (roof.z - from.z) * k);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, k < 1 ? 0 : Math.sin(show.clock * 2 + i) * 0.4, 0);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, white, N]} frustumCulled={false} />;
}

export default function Opportunities() {
  // 20:00 in the dark: the string lights and lamps stay off when nobody refueled the generator
  useFrame(() => {
    lightsOff.on = !!show.finale && show.finale.tags.includes("lights_out");
  });
  return (
    <group name="opportunities">
      <BananaPeel />
      <TapedCage />
      <Generator />
      <RoofDoves />
    </group>
  );
}
