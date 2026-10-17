"use client";

// What the butterfly effect looks like in the town: who carries the thought, who told whom, and the
// world changes the engine confirmed (closed shops, a taped-off stage, notices, protest signs).
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { SPOTS } from "../sim/geo.ts";
import { PERSONAS } from "../sim/scenario.ts";
import { BUILDINGS, STAGE, fromLocal } from "./layout";
import { NPC_POST, agentFor, show, tick } from "./director";
import { mat } from "./materials";
import { labelTexture } from "./labels";
import { ui } from "./ui";
import { DT_MAX } from "./quality";
import Says from "./Says";
import { cam } from "./camera";
import { contactsOf, powerOf, roleIcon } from "./roles";

// what each resident is able to do that would change the town (shown only as suspense, never as a prediction);
// the same words as the abilities on the whisper card
const POWER = Object.fromEntries(Object.keys(NPC_POST).map((n) => [n, powerOf(n).join(" · ")]).filter(([, t]) => t));

// a played event in which this resident already made a big public move (the suspense is over)
const isBig = (e: { type: string; data: Record<string, unknown> }) =>
  (e.type === "state" && e.data.key !== "writing") || ["article", "statement", "gather", "notice"].includes(e.type);

/** Hitchcock's bomb under the table: someone with real power now believes it. Will they act? */
function Power({ npc }: { npc: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const el = ref.current;
    if (!el) return;
    const st = show.stance[npc];
    const doneBig = show.order.slice(0, show.i).some((e) => e.actor === npc && isBig(e));
    // suspense belongs to the show: off once the story has ended (results on screen)
    const on = (show.status === "playing" || show.status === "paused") && !!st && st.conf >= 0.6 && !doneBig && !show.says.some((x) => (x.anchor ?? x.npc) === npc);
    el.style.opacity = on ? String(0.75 + Math.sin(performance.now() / 300) * 0.25) : "0";
  });
  return (
    <Html position={[0, 4.6, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div ref={ref} style={{ opacity: 0 }} className="whitespace-nowrap rounded-full bg-rose-600/90 px-2 py-0.5 text-[11px] font-bold text-white shadow">
        {POWER[npc]}？
      </div>
    </Html>
  );
}

function CoreMarker({ npc }: { npc: string }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const tag = useRef<THREE.Group>(null);
  const hit = useRef<THREE.Mesh>(null);
  const p = PERSONAS.find((x) => x.id === npc)!;
  const tex = useMemo(() => labelTexture(`${roleIcon(npc)} ${p.name}`), [npc, p.name]);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.0, depthWrite: false }), []);
  useFrame((state) => {
    const a = agentFor(npc);
    const g = group.current;
    if (!a || !g) return;
    g.position.set(a.x, 0, a.z);
    const infected = show.infected.has(npc);
    const active = ui.active.has(npc);
    const focus = show.focus === npc && show.status !== "idle";
    ringMat.opacity = infected ? 0.55 + Math.sin(state.clock.elapsedTime * 4) * 0.2 : ui.selected === npc ? 0.45 : 0;
    ringMat.color.set(ui.selected === npc && !infected ? "#7ad3ff" : focus ? "#ff6b6b" : "#ffb347");
    if (ring.current) ring.current.scale.setScalar(focus ? 1.25 : 1);
    if (tag.current) {
      // while they have a line over their head, the bubble names them instead
      tag.current.visible = active && a.visible > 0.5 && !show.says.some((x) => x.npc === npc);
      // keep name tags readable at any zoom: grow with distance to the camera
      const dist = state.camera.position.distanceTo(g.position);
      const k = Math.min(2.4, Math.max(1, dist / 22)); // capped lower now that the cast strip names everyone
      tag.current.scale.setScalar(k * (focus ? 1.15 : 1));
      tag.current.position.y = 3.0 + k * 0.35;
    }
    if (hit.current) {
      hit.current.visible = active;
      // invisible meshes still catch rays: switch raycasting off for residents outside the scenario
      hit.current.raycast = active ? THREE.Mesh.prototype.raycast : () => {};
    }
  });
  return (
    <group ref={group} name={`marker-${npc}`}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} material={ringMat}>
        <ringGeometry args={[0.55, 0.85, 32]} />
      </mesh>
      <group ref={tag}>
        <Billboard>
          <mesh renderOrder={11}>
            <planeGeometry args={[tex.aspect * 0.42, 0.42]} />
            <meshBasicMaterial map={tex.texture} transparent depthTest={false} />
          </mesh>
        </Billboard>
      </group>
      {POWER[npc] && <Power npc={npc} />}
      {/* a generous, invisible click target */}
      <mesh
        ref={hit}
        position={[0, 1.2, 0]}
        onClick={(e) => {
          if (!ui.active.has(npc)) return;
          e.stopPropagation();
          ui.select(npc);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <cylinderGeometry args={[0.8, 0.8, 2.6, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** One who-told-whom link: a thick dashed line whose ends follow the two residents every frame. */
function ThreadLine({ from, to }: { from: string; to: string }) {
  // drei's Line builds its geometry once, so move the vertices directly on the underlying Line2
  const ref = useRef<{ geometry: { setPositions: (p: number[]) => void }; computeLineDistances: () => void } | null>(null);
  const start = useMemo(() => [new THREE.Vector3(0, 2.4, 0), new THREE.Vector3(0.01, 2.4, 0)], []);
  useFrame(() => {
    const a = agentFor(from);
    const b = agentFor(to);
    const l = ref.current;
    if (!a || !b || !l) return;
    l.geometry.setPositions([a.x, 2.4, a.z, b.x, 2.4, b.z]);
    l.computeLineDistances();
    // colour = what the listener made of it: believed (red), unsure (amber), rejected (grey); orange until they decide
    const conf = show.links.filter((l) => l.from === from && l.to === to).at(-1)?.conf;
    const c = conf === undefined ? "#ff9f43" : conf >= 0.5 ? "#ef4444" : conf >= 0.25 ? "#f2b233" : "#9aa5b1";
    (l as unknown as { material: { color: THREE.Color } }).material?.color?.set(c);
  });
  return <Line ref={ref as never} points={start} color="#ff9f43" lineWidth={3} dashed dashSize={0.6} gapSize={0.35} transparent opacity={0.9} depthTest={false} renderOrder={9} />;
}

/** Who told whom. */
function Threads() {
  const [keys, setKeys] = useState<string[]>([]);
  useFrame(() => {
    const now = [...new Set(show.links.map((l) => `${l.from}>${l.to}`))].slice(0, 24);
    if (now.length !== keys.length || now.some((k, i) => k !== keys[i])) setKeys(now);
  });
  return (
    <group>
      {keys.map((k) => {
        const [from, to] = k.split(">");
        return <ThreadLine key={k} from={from} to={to} />;
      })}
    </group>
  );
}

/** While composing: thin arcs from the selected resident to everyone they can phone (their reach, at a glance). */
function ContactArc({ from, to }: { from: string; to: string }) {
  const ref = useRef<{ geometry: { setPositions: (p: number[]) => void } } | null>(null);
  const start = useMemo(() => Array.from({ length: 9 }, (_, k) => new THREE.Vector3(k * 0.01, 0.3, 0)), []);
  useFrame(() => {
    const a = agentFor(from);
    const b = agentFor(to);
    const l = ref.current;
    if (!a || !b || !l) return;
    const lift = Math.min(6, 1.2 + Math.hypot(a.x - b.x, a.z - b.z) * 0.12);
    const pts: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      pts.push(a.x + (b.x - a.x) * u, 0.4 + Math.sin(u * Math.PI) * lift, a.z + (b.z - a.z) * u);
    }
    l.geometry.setPositions(pts);
  });
  return <Line ref={ref as never} points={start} color="#38bdf8" lineWidth={1.6} transparent opacity={0.75} depthTest={false} renderOrder={8} />;
}

function ContactArcs() {
  const [npc, setNpc] = useState<string | null>(null);
  useFrame(() => {
    // only in the quiet town, never over a story's who-told-whom threads
    const want = show.status === "idle" && ui.selected && ui.active.has(ui.selected) ? ui.selected : null;
    if (want !== npc) setNpc(want);
  });
  if (!npc) return null;
  return (
    <group>
      {contactsOf(npc).filter((c) => ui.active.has(c)).map((c) => (
        <ContactArc key={`${npc}>${c}`} from={npc} to={c} />
      ))}
    </group>
  );
}

/** Glides the camera to a spot the overlay asked for (cast strip, ticker, compose card); the player's drag cancels it. */
function CamGlide() {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: (THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update: () => void }) | null;
  };
  const goalT = useRef<THREE.Vector3 | null>(null);
  const goalP = useRef(new THREE.Vector3());
  useEffect(() => {
    if (!controls) return;
    const cancel = () => (goalT.current = null);
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controls]);
  useFrame((_, dt) => {
    if (!controls) return;
    if (cam.ask) {
      const { x, z, dist, right = 0 } = cam.ask;
      cam.ask = null;
      // keep the viewing angle; shift the look-at point left so the subject lands right of centre
      const off = camera.position.clone().sub(controls.target);
      const left = new THREE.Vector3(-off.z, 0, off.x).normalize(); // the camera's screen-left, on the ground
      const t = new THREE.Vector3(x, 0, z).addScaledVector(left, right);
      goalT.current = t;
      goalP.current.copy(t).add(off.normalize().multiplyScalar(dist));
    }
    // a story with the auto director on owns the camera (and a glide it interrupted is dropped, not resumed later)
    if (ui.follow && show.status !== "idle") goalT.current = null;
    if (!goalT.current) return;
    const k = 1 - Math.exp(-dt * 3);
    controls.target.lerp(goalT.current, k);
    camera.position.lerp(goalP.current, k);
    controls.update();
    if (camera.position.distanceTo(goalP.current) < 0.05) goalT.current = null;
  });
  return null;
}

/** World changes the engine confirmed. */
function WorldChanges() {
  const [v, setV] = useState(0);
  const seen = useRef(-1);
  useFrame(() => {
    if (show.version !== seen.current) {
      seen.current = show.version;
      setV(show.version);
    }
  });
  void v;
  const w = show.world;
  const board = SPOTS.plaza;
  const closedSign = useMemo(() => labelTexture("暫停營業", "#c0392b", "#ffffff"), []);
  const cancelSign = useMemo(() => labelTexture("🏮 燈籠節取消", "#2c3e50", "#ffffff"), []);
  const protest = useMemo(() => labelTexture("✊ 給個交代！", "#fff4e3", "#b5462f"), []);
  const tapePoints = useMemo(() => {
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sz]) => fromLocal(STAGE, sx * (STAGE.w / 2 + 0.9), sz * (STAGE.d / 2 + 0.9)));
    return c.map((p) => new THREE.Vector3(p.x, 0.9, p.z));
  }, []);
  return (
    <group>
      {/* the notice board on the plaza, always there; papers appear as notices are posted */}
      <group position={[board.x - 1.2, 0, board.z - 0.6]} rotation={[0, 0.4, 0]}>
        {[-0.7, 0.7].map((x) => (
          <mesh key={x} position={[x, 0.75, 0]} castShadow material={mat("#7a5236")}>
            <boxGeometry args={[0.12, 1.5, 0.12]} />
          </mesh>
        ))}
        <mesh position={[0, 1.4, 0]} castShadow material={mat("#a87f55")}>
          <boxGeometry args={[1.7, 1.0, 0.08]} />
        </mesh>
        {w.notices.slice(0, 4).map((_, i) => (
          <mesh key={i} position={[-0.5 + i * 0.34, 1.42 + (i % 2) * 0.12, 0.05]} rotation={[0, 0, (i % 2 ? -1 : 1) * 0.08]} material={mat("#fffdf4", 0.9)}>
            <planeGeometry args={[0.3, 0.4]} />
          </mesh>
        ))}
      </group>
      {Object.entries(w.shops).filter(([, s]) => s === "closed").map(([shop]) => {
        const b = BUILDINGS.find((x) => x.id === (shop === "stall" ? "" : shop));
        const p = b ? fromLocal(b, 0, b.d / 2 + 0.25) : SPOTS[shop];
        return (
          <Billboard key={shop} position={[p.x, 2.2, p.z]}>
            <mesh renderOrder={10}>
              <planeGeometry args={[closedSign.aspect * 0.5, 0.5]} />
              <meshBasicMaterial map={closedSign.texture} transparent />
            </mesh>
          </Billboard>
        );
      })}
      {w.stage === "closed" && (
        <group>
          <Line points={tapePoints} color="#ffd93d" lineWidth={4} dashed dashSize={0.4} gapSize={0.25} />
          {tapePoints.slice(0, 4).map((p, i) => (
            <mesh key={i} position={[p.x, 0.4, p.z]} castShadow material={mat("#ff8c42", 0.5)}>
              <coneGeometry args={[0.25, 0.8, 10]} />
            </mesh>
          ))}
        </group>
      )}
      {w.festival === "cancelled" && (
        <Billboard position={[0, 5.2, -13]}>
          <mesh renderOrder={12}>
            <planeGeometry args={[cancelSign.aspect * 1.1, 1.1]} />
            <meshBasicMaterial map={cancelSign.texture} transparent depthTest={false} />
          </mesh>
        </Billboard>
      )}
      {Object.entries(w.gatherings).map(([place]) => {
        const s = SPOTS[place];
        return [0, 1, 2].map((k) => (
          <group key={`${place}${k}`} position={[s.x + (k - 1) * 1.3, 0, s.z + 2.4]}>
            <mesh position={[0, 1.1, 0]} material={mat("#7a5236")}>
              <cylinderGeometry args={[0.04, 0.04, 2.2, 6]} />
            </mesh>
            <Billboard position={[0, 2.25, 0]}>
              <mesh>
                <planeGeometry args={[protest.aspect * 0.4, 0.4]} />
                <meshBasicMaterial map={protest.texture} transparent />
              </mesh>
            </Billboard>
          </group>
        ));
      })}
    </group>
  );
}

export default function PlaybackLayer() {
  const { scene } = useThree();
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __scene: THREE.Scene }).__scene = scene;
  useFrame((_, delta) => tick(Math.min(delta, DT_MAX)));
  return (
    <group name="playback-layer">
      {Object.keys(NPC_POST).map((npc) => (
        <CoreMarker key={npc} npc={npc} />
      ))}
      <Threads />
      <ContactArcs />
      <WorldChanges />
      <Says />
      <CamGlide />
    </group>
  );
}
