"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import Buildings from "./Buildings";
import Props from "./Props";
import Crowd from "./Crowd";
import Pets from "./Pets";
import Traffic from "./Traffic";
import StreetProps from "./StreetProps";
import Terrain from "./Terrain";
import Ground from "./Ground";
import PlaybackLayer from "./PlaybackLayer";
import GameUI from "./GameUI";
import { agentFor, show } from "./director";
import { ui } from "./ui";
import { advance, clock, END_HOUR, formatHour, skyAt, START_HOUR, updateGlow } from "./clock";
import { LITE } from "./quality";

// Camera presets: the HUD asks for one and CameraRig glides there.
// The default frames the main road and the green in front, the plaza in the middle and the town hall behind.
const VIEWS = {
  plaza: { label: "廣場", target: [1, 0, -11], pos: [23, 39, 41] },
  shops: { label: "商店街", target: [-15, 0, -2], pos: [1, 31, 30] },
  homes: { label: "住宅", target: [-30, 0, -22], pos: [-38, 33, 10] },
  park: { label: "公園", target: [-50, 0, -3], pos: [-28, 30, 29] },
  harbour: { label: "港口", target: [42, 0, -12], pos: [62, 32, 24] },
  overview: { label: "全景", target: [6, 0, -8], pos: [52, 82, 92] },
} as const;
const TARGET = new THREE.Vector3(...VIEWS.plaza.target);
const SUN_TARGET = new THREE.Vector3(-4, 0, -6);
type ViewId = keyof typeof VIEWS;
const camRequest: { view: ViewId | null } = { view: null };

/** Where the director's current shot looks, and how far away the camera should be. */
function shotGoal(): { x: number; z: number; dist: number } | null {
  const sh = show.shot;
  if (!sh) return null;
  if (sh.kind === "overview") {
    // the whole spread: everyone the thought reached
    const pts = [...show.infected].map((n) => agentFor(n)).filter((a): a is NonNullable<typeof a> => !!a);
    if (!pts.length) return null;
    const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
    const cz = pts.reduce((s, a) => s + a.z, 0) / pts.length;
    const spread = Math.max(...pts.map((a) => Math.hypot(a.x - cx, a.z - cz)));
    return { x: cx, z: cz, dist: Math.min(80, Math.max(36, spread * 1.5 + 24)) };
  }
  const a = sh.a ? agentFor(sh.a) : null;
  const b = sh.b ? agentFor(sh.b) : null;
  if (a && b) {
    const gap = Math.hypot(a.x - b.x, a.z - b.z);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, dist: Math.max(sh.dist, gap * 1.1 + 12) };
  }
  if (a) {
    // heading somewhere: lead the frame a little toward where they are going
    if (sh.at) return { x: a.x + (sh.at.x - a.x) * 0.3, z: a.z + (sh.at.z - a.z) * 0.3, dist: sh.dist };
    return { x: a.x, z: a.z, dist: sh.dist };
  }
  if (sh.at) return { x: sh.at.x, z: sh.at.z, dist: sh.dist };
  return null;
}

function CameraRig() {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: (THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update: () => void }) | null;
  };
  const goalT = useRef(new THREE.Vector3());
  const goalP = useRef(new THREE.Vector3());
  const active = useRef(false);
  const seenLoads = useRef(show.loads);
  useEffect(() => {
    if (!controls) return;
    // the moment the player grabs the camera, the auto director steps aside (they can switch it back on)
    const take = () => {
      if (show.status !== "idle" && ui.follow) {
        ui.follow = false;
        ui.version++;
      }
    };
    controls.addEventListener("start", take);
    return () => controls.removeEventListener("start", take);
  }, [controls]);
  useFrame((_, dt) => {
    // every new story, replay or What If starts with the auto director on again
    if (show.loads !== seenLoads.current) {
      seenLoads.current = show.loads;
      if (!ui.follow) {
        ui.follow = true;
        ui.version++;
      }
    }
    if (camRequest.view) {
      const v = VIEWS[camRequest.view];
      goalT.current.fromArray(v.target);
      goalP.current.fromArray(v.pos);
      active.current = true;
      camRequest.view = null;
    }
    if (controls && ui.follow && (show.status === "playing" || show.status === "paused" || show.status === "done")) {
      const g = shotGoal();
      if (g) {
        // push the look-at point a little beyond the subject: the subject sits lower in frame, the line above fits
        const away = new THREE.Vector2(g.x - camera.position.x, g.z - camera.position.z);
        if (away.lengthSq() > 1e-6) {
          away.normalize().multiplyScalar(g.dist * 0.12);
          g.x += away.x;
          g.z += away.y;
        }
        // glide the look-at point and the distance; keep the viewing angle so the town never spins around
        const k = 1 - Math.exp(-dt * 2.2);
        const nx = controls.target.x + (g.x - controls.target.x) * k;
        const nz = controls.target.z + (g.z - controls.target.z) * k;
        camera.position.x += nx - controls.target.x;
        camera.position.z += nz - controls.target.z;
        controls.target.set(nx, 0, nz);
        const off = camera.position.clone().sub(controls.target);
        const dist = off.length();
        const next = dist + (g.dist - dist) * (1 - Math.exp(-dt * 1.5));
        // tilt: near shots look down more steeply (over umbrellas and heads), wide shots stay low and scenic
        const sph = new THREE.Spherical().setFromVector3(off);
        const tilt = show.shot?.kind === "close" ? 0.68 : show.shot?.kind === "two" ? 0.74 : show.shot?.kind === "medium" ? 0.82 : 0.9;
        sph.phi += (tilt - sph.phi) * (1 - Math.exp(-dt * 1.2));
        sph.radius = next;
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
        controls.update();
        active.current = false;
        return;
      }
    }
    if (!active.current || !controls) return;
    const k = 1 - Math.exp(-dt * 3);
    controls.target.lerp(goalT.current, k);
    camera.position.lerp(goalP.current, k);
    controls.update();
    if (camera.position.distanceTo(goalP.current) < 0.05) active.current = false;
  });
  return null;
}

function SunAndSky() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  // a soft, shadowless cool fill from the viewer's side that fades in with the street lights: keeps faces readable
  const fill = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog("#ffffff", 130, 320);
    if (sun.current) scene.add(sun.current.target);
    if (fill.current) scene.add(fill.current.target);
  }, [scene]);
  useFrame((state, delta) => {
    if (show.status === "playing" || show.status === "paused" || show.status === "done") {
      const target = 15 + show.gameT / 60;
      clock.hour += (target - clock.hour) * Math.min(1, delta * 1.5);
    } else advance(Math.min(delta, 0.1));
    const s = skyAt(clock.hour);
    updateGlow(s.lightsOn, state.clock.elapsedTime);
    (scene.background as THREE.Color).copy(s.background);
    (scene.fog as THREE.Fog).color.copy(s.background);
    if (sun.current) {
      sun.current.position.copy(SUN_TARGET).addScaledVector(s.sunDir, 110);
      sun.current.target.position.copy(SUN_TARGET);
      sun.current.color.copy(s.sun);
      sun.current.intensity = s.sunIntensity;
    }
    if (hemi.current) {
      hemi.current.color.copy(s.sky);
      hemi.current.groundColor.copy(s.ground);
      hemi.current.intensity = s.hemiIntensity;
    }
    if (fill.current) {
      fill.current.position.copy(state.camera.position).add(new THREE.Vector3(0, 30, 0));
      fill.current.target.position.copy(SUN_TARGET);
      fill.current.intensity = s.lightsOn * 0.75;
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} />
      <directionalLight ref={fill} color="#c9d4ff" intensity={0} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={55}
        shadow-camera-bottom={-55}
        shadow-camera-near={10}
        shadow-camera-far={240}
      />
    </>
  );
}

/**
 * Explore-mode HUD, light by default: a one-line title, and a small clock chip with the festival countdown.
 * Time, views and speed open from the chip only when wanted — the town is the screen, not the panels.
 */
function Hud({ onHide }: { onHide: () => void }) {
  const [hour, setHour] = useState(clock.hour);
  const [speed, setSpeed] = useState(clock.speed);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setHour(clock.hour), 250);
    return () => clearInterval(id);
  }, []);
  const speeds = [
    { v: 0, label: "暫停" },
    { v: 1, label: "1×" },
    { v: 4, label: "4×" },
    { v: 12, label: "12×" },
  ];
  const left = Math.max(0, 20 - hour);
  const countdown = left <= 0 ? "燈籠節進行中" : `燈籠節倒數 ${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, "0")}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
      <div className="pointer-events-auto rounded-full bg-white/75 px-4 py-1.5 shadow backdrop-blur">
        <span className="text-sm font-extrabold text-slate-800">霧港鎮</span>
        <span className="ml-2 text-xs font-semibold text-slate-500">VIRAL · 一句話的蝴蝶效應</span>
      </div>
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-1.5 shadow backdrop-blur hover:bg-white"
          aria-expanded={open}
          title="時間、視角與速度"
        >
          <span className="text-base font-extrabold tabular-nums text-slate-800">{formatHour(hour)}</span>
          <span className="text-xs font-semibold text-orange-600">🏮 {countdown}</span>
          <span className="text-xs text-slate-400">{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <div className="w-[min(92vw,300px)] rounded-2xl bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
            <input
              aria-label="時間"
              type="range"
              min={START_HOUR}
              max={END_HOUR}
              step={0.01}
              value={hour}
              onChange={(e) => {
                clock.hour = Number(e.target.value);
                setHour(clock.hour);
              }}
              className="w-full accent-orange-500"
            />
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(Object.keys(VIEWS) as ViewId[]).map((id) => (
                <button key={id} onClick={() => (camRequest.view = id)} className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 hover:bg-orange-200">
                  {VIEWS[id].label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              {speeds.map((x) => (
                <button
                  key={x.v}
                  onClick={() => {
                    clock.speed = x.v;
                    setSpeed(x.v);
                  }}
                  className={`flex-1 rounded-full px-2 py-0.5 text-xs font-semibold ${speed === x.v ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-700"}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <button onClick={onHide} className="mt-2 w-full rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-500 hover:bg-slate-200">
              隱藏全部介面（H）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TownScene() {
  const [hudVisible, setHudVisible] = useState(true);
  const [gamePhase, setGamePhase] = useState("explore");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") setHudVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0">
      <Canvas
        shadows
        flat
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
        camera={{ position: [...VIEWS.plaza.pos], fov: 32, near: 1, far: 600 }}
      >
        <SunAndSky />
        <Ground />
        <Buildings />
        <Props />
        <StreetProps />
        <Terrain />
        <Crowd count={70} />
        <Pets />
        <Traffic />
        <PlaybackLayer />
        <CameraRig />
        <MapControls
          makeDefault
          target={TARGET}
          enableDamping
          minDistance={14}
          maxDistance={150}
          minPolarAngle={0.55}
          maxPolarAngle={1.15}
          minAzimuthAngle={-0.6}
          maxAzimuthAngle={1.4}
        />
        {!LITE && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={2} intensity={1.6} distanceFalloff={1.2} halfRes quality="performance" />
          {/* glow is atmosphere: only the brightest highlights bloom, softly */}
          <Bloom mipmapBlur luminanceThreshold={1.25} luminanceSmoothing={0.25} intensity={0.5} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.35} darkness={0.3} />
          <SMAA />
        </EffectComposer>
        )}
      </Canvas>
      {hudVisible && <GameUI onPhase={setGamePhase} />}
      {hudVisible ? (
        gamePhase === "explore" || gamePhase === "compose" ? <Hud onHide={() => setHudVisible(false)} /> : null
      ) : (
        <button
          onClick={() => setHudVisible(true)}
          className="absolute bottom-3 left-3 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
        >
          顯示介面（H）
        </button>
      )}
    </div>
  );
}
