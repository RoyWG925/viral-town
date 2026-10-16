"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { crowd, spawnCrowd, stepCrowd, type Agent } from "./crowdSim";
import { show } from "./director";
import { mat } from "./materials";
import { bubbleTexture } from "./textures";

// Shared geometry for every townsperson (chibi proportions: big head, short legs).
const G = {
  leg: new THREE.CylinderGeometry(0.075, 0.068, 0.36, 8).translate(0, -0.18, 0),
  shoe: new THREE.SphereGeometry(0.085, 8, 6).scale(1, 0.6, 1.5),
  body: new THREE.CapsuleGeometry(0.21, 0.24, 4, 12),
  arm: new THREE.CapsuleGeometry(0.06, 0.2, 3, 6).translate(0, -0.15, 0),
  hand: new THREE.SphereGeometry(0.065, 8, 6),
  head: new THREE.SphereGeometry(0.33, 22, 16),
  eye: new THREE.SphereGeometry(0.048, 10, 8).scale(1, 1.3, 0.6),
  shine: new THREE.SphereGeometry(0.016, 6, 4),
  mouth: new THREE.TorusGeometry(0.045, 0.013, 6, 12, Math.PI).rotateZ(Math.PI),
  blush: new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.6, 0.35),
  hairCap: new THREE.SphereGeometry(0.348, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
  hairBack: new THREE.SphereGeometry(0.33, 14, 10).scale(1, 1.15, 0.7),
  bun: new THREE.SphereGeometry(0.14, 10, 8),
  pony: new THREE.CapsuleGeometry(0.08, 0.22, 3, 8),
  tail: new THREE.SphereGeometry(0.12, 10, 8),
  afro: new THREE.IcosahedronGeometry(0.44, 2).scale(1, 0.92, 0.82),
  spike: new THREE.ConeGeometry(0.08, 0.2, 6),
  capTop: new THREE.SphereGeometry(0.355, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
  brim: new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.4),
  sunBrim: new THREE.CylinderGeometry(0.6, 0.6, 0.035, 22),
  sunCrown: new THREE.CylinderGeometry(0.29, 0.33, 0.22, 18),
  beanie: new THREE.SphereGeometry(0.36, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.12, 1),
  pom: new THREE.SphereGeometry(0.09, 8, 6),
  chef: new THREE.CylinderGeometry(0.26, 0.28, 0.36, 14),
  chefPuff: new THREE.SphereGeometry(0.32, 14, 10).scale(1, 0.6, 1),
  backpack: new THREE.BoxGeometry(0.34, 0.36, 0.16),
  lens: new THREE.TorusGeometry(0.065, 0.013, 6, 14),
  bridge: new THREE.BoxGeometry(0.09, 0.015, 0.015),
  scarf: new THREE.TorusGeometry(0.19, 0.07, 8, 16).rotateX(Math.PI / 2),
  skirt: new THREE.ConeGeometry(0.32, 0.34, 14, 1, true),
  apron: new THREE.BoxGeometry(0.36, 0.42, 0.03),
  balloon: new THREE.SphereGeometry(0.22, 14, 10).scale(1, 1.18, 1),
  string: new THREE.CylinderGeometry(0.006, 0.006, 1, 4).translate(0, 0.5, 0),
  bubble: new THREE.PlaneGeometry(0.95, 0.83),
  crate: new THREE.BoxGeometry(0.62, 0.42, 0.42),
  phone: new THREE.BoxGeometry(0.09, 0.2, 0.03),
};
const BALLOON_COLORS = ["#ff4d6d", "#ffd23f", "#3a86ff", "#06d6a0", "#b983ff", "#ff9f1c"];

const bubbleMats = new Map<string, THREE.MeshBasicMaterial>();
function bubbleMat(text: string) {
  let m = bubbleMats.get(text);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: bubbleTexture(text), transparent: true, depthWrite: false, toneMapped: false });
    bubbleMats.set(text, m);
  }
  return m;
}

function Hair({ style, m }: { style: string; m: THREE.Material }) {
  const cap = <mesh geometry={G.hairCap} material={m} rotation={[-0.25, 0, 0]} />;
  switch (style) {
    case "bald":
      return null;
    case "afro":
      return <mesh geometry={G.afro} material={m} position={[0, 0.12, -0.1]} />;
    case "long":
      return (
        <>
          {cap}
          <mesh geometry={G.hairBack} material={m} position={[0, -0.08, -0.12]} />
        </>
      );
    case "bun":
      return (
        <>
          {cap}
          <mesh geometry={G.bun} material={m} position={[0, 0.33, -0.12]} />
        </>
      );
    case "pony":
      return (
        <>
          {cap}
          <mesh geometry={G.pony} material={m} position={[0, -0.02, -0.38]} rotation={[0.5, 0, 0]} />
        </>
      );
    case "pigtails":
      return (
        <>
          {cap}
          <mesh geometry={G.tail} material={m} position={[0.33, 0.0, -0.08]} />
          <mesh geometry={G.tail} material={m} position={[-0.33, 0.0, -0.08]} />
        </>
      );
    case "spiky":
      return (
        <>
          {cap}
          {[[0, 0.36, 0.02, 0], [0.16, 0.32, -0.04, -0.5], [-0.16, 0.32, -0.04, 0.5], [0.08, 0.3, -0.2, -0.3], [-0.08, 0.3, -0.2, 0.3]].map(([x, y, z, r], i) => (
            <mesh key={i} geometry={G.spike} material={m} position={[x, y, z]} rotation={[-0.3, 0, r]} />
          ))}
        </>
      );
    default:
      return cap;
  }
}

function Balloons() {
  const group = useRef<THREE.Group>(null);
  const spots = useMemo(() => BALLOON_COLORS.map((c, i) => ({ c, x: Math.cos(i * 1.1) * 0.35, z: Math.sin(i * 1.1) * 0.25, y: 2.5 + (i % 3) * 0.28 })), []);
  useFrame(({ clock: c }) => {
    if (group.current) {
      group.current.rotation.z = Math.sin(c.elapsedTime * 1.3) * 0.08;
      group.current.rotation.x = Math.cos(c.elapsedTime * 1.1) * 0.06;
    }
  });
  return (
    <group ref={group} position={[-0.32, 0.7, 0.12]}>
      {spots.map((b, i) => (
        <group key={i}>
          <mesh geometry={G.string} material={mat("#ffffff", 0.6)} scale={[1, b.y - 0.7, 1]} rotation={[b.z * 0.3, 0, -b.x * 0.3]} />
          <mesh geometry={G.balloon} material={mat(b.c, 0.35)} position={[b.x, b.y - 0.7, b.z]} castShadow />
        </group>
      ))}
    </group>
  );
}

function Person({ agent }: { agent: Agent }) {
  const root = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const crate = useRef<THREE.Mesh>(null);
  const phone = useRef<THREE.Mesh>(null);
  const l = agent.look;
  const m = useMemo(
    () => ({
      skin: mat(l.skin, 0.6), shirt: mat(l.shirt, 0.8), pants: mat(l.pants, 0.85), hair: mat(l.hair, 0.7), hat: mat(l.hatColor, 0.7),
      dark: mat("#1d1d1f", 0.3), blush: mat("#ff8fa3", 0.8), white: mat("#ffffff", 0.6), mouth: mat("#7a2e2e", 0.6),
      pack: mat(l.backpack ?? "#888888", 0.7), scarf: mat(l.scarf ?? "#888888", 0.8), apron: mat(l.apron ?? "#ffffff", 0.8),
    }),
    [l],
  );

  useFrame(() => {
    const r = root.current;
    if (!r) return;
    const moving = agent.mode === "walk" ? Math.min(1, Math.hypot(agent.vx, agent.vz) / 0.6) : 0;
    const sitting = agent.mode === "sit";
    const ground = sitting && agent.poi?.activity === "picnic";
    const playing = agent.mode === "play";
    const s = Math.sin(agent.phase);
    let y = Math.abs(Math.cos(agent.phase)) * 0.06 * moving;
    if (sitting) y = ground ? -0.27 : 0.1;
    if (playing) y = Math.abs(Math.sin(agent.phase * 0.6)) * 0.35;
    r.position.set(agent.x, y, agent.z);
    r.rotation.y = agent.heading;
    r.scale.setScalar(1.3 * l.scale * (0.15 + 0.85 * agent.visible));
    r.visible = agent.visible > 0.02;
    const legSwing = s * 0.6 * moving;
    if (legL.current) legL.current.rotation.x = sitting ? -1.45 : legSwing;
    if (legR.current) legR.current.rotation.x = sitting ? -1.45 : -legSwing;
    const now = performance.now() / 1000;
    const talk = agent.mode === "chat" ? Math.sin(now * 6 + agent.id) * 0.25 : 0;
    const cheer = playing ? -2.6 + Math.sin(agent.phase) * 0.3 : 0;
    const carrying = agent.prop === "crate";
    const calling = agent.prop === "phone";
    if (crate.current) crate.current.visible = carrying;
    if (phone.current) phone.current.visible = calling;
    if (armL.current) armL.current.rotation.x = carrying ? -1.25 : playing ? cheer : -s * 0.55 * moving + (agent.mode === "chat" ? -0.35 + talk : 0);
    if (armR.current) {
      // on the phone: hand up to the ear
      armR.current.rotation.x = calling ? -2.5 : carrying ? -1.25 : playing ? cheer : agent.prop === "balloons" ? -0.9 : s * 0.55 * moving;
      armR.current.rotation.z = calling ? -0.55 : 0;
    }
    if (torso.current) {
      torso.current.rotation.z = moving ? s * 0.05 : Math.sin(now * 1.1 + agent.id) * 0.025;
      torso.current.scale.y = 1 + (moving ? Math.abs(Math.cos(agent.phase)) * 0.03 : Math.sin(now * 2 + agent.id) * 0.012);
    }
    if (bubble.current) {
      bubble.current.visible = !!agent.bubble && agent.visible > 0.5;
      if (agent.bubble) bubble.current.material = bubbleMat(agent.bubble);
    }
  });

  return (
    <group ref={root}>
      <group position={[0.1, 0.38, 0]} ref={legL}>
        <mesh geometry={G.leg} material={m.pants} castShadow />
        <mesh geometry={G.shoe} material={m.dark} position={[0, -0.36, 0.04]} />
      </group>
      <group position={[-0.1, 0.38, 0]} ref={legR}>
        <mesh geometry={G.leg} material={m.pants} castShadow />
        <mesh geometry={G.shoe} material={m.dark} position={[0, -0.36, 0.04]} />
      </group>
      <group ref={torso}>
        <mesh geometry={G.body} material={m.shirt} position={[0, 0.65, 0]} castShadow />
        {l.skirt && <mesh geometry={G.skirt} material={m.shirt} position={[0, 0.45, 0]} castShadow />}
        {l.apron && <mesh geometry={G.apron} material={m.apron} position={[0, 0.6, 0.2]} />}
        {l.backpack && <mesh geometry={G.backpack} material={m.pack} position={[0, 0.72, -0.25]} castShadow />}
        {l.scarf && <mesh geometry={G.scarf} material={m.scarf} position={[0, 0.9, 0]} />}
        <group ref={armL} position={[0.27, 0.82, 0]}>
          <mesh geometry={G.arm} material={m.shirt} castShadow />
          <mesh geometry={G.hand} material={m.skin} position={[0, -0.33, 0]} />
        </group>
        <group ref={armR} position={[-0.27, 0.82, 0]}>
          <mesh geometry={G.arm} material={m.shirt} castShadow />
          <mesh geometry={G.hand} material={m.skin} position={[0, -0.33, 0]} />
          <mesh ref={phone} geometry={G.phone} material={m.dark} position={[0, -0.36, 0.06]} visible={false} />
        </group>
        <group position={[0, 1.14, 0.02]} rotation={[-0.22, 0, 0]} scale={l.headScale}>
          <mesh geometry={G.head} material={m.skin} castShadow />
          {[0.115, -0.115].map((x) => (
            <group key={x} position={[x, 0.07, 0.292]}>
              <mesh geometry={G.eye} material={m.dark} />
              <mesh geometry={G.shine} material={m.white} position={[0.014, 0.022, 0.026]} />
            </group>
          ))}
          <mesh geometry={G.mouth} material={m.mouth} position={[0, -0.06, 0.318]} />
          {l.blush && [0.2, -0.2].map((x) => <mesh key={x} geometry={G.blush} material={m.blush} position={[x, -0.03, 0.26]} rotation={[0, x * 1.6, 0]} />)}
          {l.glasses && (
            <>
              {[0.115, -0.115].map((x) => (
                <mesh key={x} geometry={G.lens} material={m.dark} position={[x, 0.07, 0.33]} />
              ))}
              <mesh geometry={G.bridge} material={m.dark} position={[0, 0.08, 0.335]} />
            </>
          )}
          {l.hat === "none" && <Hair style={l.hairStyle} m={m.hair} />}
          {l.hat === "cap" && (
            <>
              <mesh geometry={G.capTop} material={m.hat} rotation={[-0.15, 0, 0]} />
              <mesh geometry={G.brim} material={m.hat} position={[0, 0.11, 0.28]} rotation={[0.15, 0, 0]} />
            </>
          )}
          {l.hat === "sunhat" && (
            <>
              <mesh geometry={G.sunBrim} material={m.hat} position={[0, 0.22, 0]} castShadow />
              <mesh geometry={G.sunCrown} material={m.hat} position={[0, 0.34, 0]} />
            </>
          )}
          {l.hat === "beanie" && (
            <>
              <mesh geometry={G.beanie} material={m.hat} rotation={[-0.12, 0, 0]} />
              <mesh geometry={G.pom} material={m.white} position={[0, 0.42, -0.03]} />
            </>
          )}
          {l.hat === "chef" && (
            <>
              <mesh geometry={G.chef} material={m.white} position={[0, 0.38, 0]} />
              <mesh geometry={G.chefPuff} material={m.white} position={[0, 0.6, 0]} />
            </>
          )}
        </group>
      </group>
      {agent.prop === "balloons" && <Balloons />}
      {agent.job && <mesh ref={crate} geometry={G.crate} material={mat("#b07a45", 0.8)} position={[0, 0.95, 0.42]} castShadow visible={false} />}
      <Billboard position={[0, 2.0, 0]}>
        <mesh ref={bubble} geometry={G.bubble} visible={false} renderOrder={10} />
      </Billboard>
    </group>
  );
}

export default function Crowd({ count = 56 }: { count?: number }) {
  const agents = useMemo(() => {
    spawnCrowd(count);
    return crowd.agents;
  }, [count]);
  // StrictMode runs the memo twice in development; simulate the copy that is actually on screen.
  useEffect(() => {
    crowd.agents = agents;
  }, [agents]);
  // during playback the whole town moves at the playback speed so walks stay in step with the story
  useFrame((_, delta) => stepCrowd(Math.min(delta, 0.05) * (show.status === "playing" ? Math.min(show.speed, 3) : 1)));
  return (
    <group>
      {agents.map((a) => (
        <Person key={a.id} agent={a} />
      ))}
    </group>
  );
}
