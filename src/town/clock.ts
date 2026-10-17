import * as THREE from "three";

// One shared, mutable game clock. The 3D scene reads it every frame; the HUD polls it.
export const clock = {
  hour: 16.5, // 16:30
  speed: 1, // game hours per real minute
};

// dev only: lab screenshots set the hour (`__clock.hour = 19.5; __clock.speed = 0`)
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __clock: typeof clock }).__clock = clock;

export const START_HOUR = 15;
export const END_HOUR = 20.5;

export function advance(deltaSeconds: number) {
  clock.hour += (deltaSeconds / 60) * clock.speed;
  if (clock.hour > END_HOUR) clock.hour = START_HOUR;
}

export function formatHour(h: number) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

interface Key {
  h: number;
  sun: string;
  sunI: number;
  sky: string;
  ground: string;
  hemiI: number;
  bg: string;
  elev: number; // degrees
  azim: number; // degrees, 0 = +z (toward camera), 90 = -x
}

const KEYS: Key[] = [
  { h: 15, sun: "#fff1d6", sunI: 4.2, sky: "#cfe7ff", ground: "#d8b48f", hemiI: 0.7, bg: "#bfe1ff", elev: 48, azim: 40 },
  { h: 17, sun: "#ffc98a", sunI: 4.0, sky: "#ffe2bf", ground: "#c99a74", hemiI: 0.62, bg: "#ffd6a6", elev: 28, azim: 55 },
  { h: 18.3, sun: "#ff8f4a", sunI: 3.0, sky: "#ffb48a", ground: "#9a7a74", hemiI: 0.55, bg: "#f6a37f", elev: 12, azim: 68 },
  // dusk and night stay readable: brighter sky/ground bounce so faces and silhouettes don't sink into purple
  { h: 19.3, sun: "#e07a84", sunI: 1.2, sky: "#a898dc", ground: "#7a6e96", hemiI: 0.95, bg: "#7d6fb8", elev: 3, azim: 76 },
  { h: 20.5, sun: "#5a64a8", sunI: 0.42, sky: "#5c62ae", ground: "#46427a", hemiI: 0.85, bg: "#2a3060", elev: -6, azim: 82 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpColor(a: string, b: string, t: number, out: THREE.Color) {
  tmpA.set(a);
  tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

export interface Sky {
  sun: THREE.Color;
  sunIntensity: number;
  sunDir: THREE.Vector3;
  sky: THREE.Color;
  ground: THREE.Color;
  hemiIntensity: number;
  background: THREE.Color;
  lightsOn: number; // 0..1 how much windows, lamps and lanterns glow
}

const out: Sky = {
  sun: new THREE.Color(),
  sunIntensity: 1,
  sunDir: new THREE.Vector3(),
  sky: new THREE.Color(),
  ground: new THREE.Color(),
  hemiIntensity: 1,
  background: new THREE.Color(),
  lightsOn: 0,
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function skyAt(h: number): Sky {
  let i = 0;
  while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
  lerpColor(a.sun, b.sun, t, out.sun);
  lerpColor(a.sky, b.sky, t, out.sky);
  lerpColor(a.ground, b.ground, t, out.ground);
  lerpColor(a.bg, b.bg, t, out.background);
  out.sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
  out.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;
  const elev = THREE.MathUtils.degToRad(a.elev + (b.elev - a.elev) * t);
  const azim = THREE.MathUtils.degToRad(a.azim + (b.azim - a.azim) * t);
  out.sunDir.set(-Math.sin(azim) * Math.cos(elev), Math.sin(Math.max(elev, 0.02)), Math.cos(azim) * Math.cos(elev)).normalize();
  out.lightsOn = smooth(17.6, 19.0, h);
  return out;
}

// Shared glowing materials; their emissive intensity follows the clock.
export const glow = {
  window: new THREE.MeshStandardMaterial({ color: "#8fb6d6", roughness: 0.2, metalness: 0.1, emissive: "#ffc77a", emissiveIntensity: 0 }),
  lamp: new THREE.MeshStandardMaterial({ color: "#fff2c9", emissive: "#ffd27a", emissiveIntensity: 0.2 }),
  lanterns: ["#ff4b3e", "#ff9f1c", "#ffd23f", "#ff6f91"].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.6 }),
  ),
  neonRed: new THREE.MeshStandardMaterial({ color: "#ff3b3b", emissive: "#ff2a2a", emissiveIntensity: 1.5 }),
  neonBlue: new THREE.MeshStandardMaterial({ color: "#3b7bff", emissive: "#2a6bff", emissiveIntensity: 1.5 }),
  interiors: [] as THREE.MeshStandardMaterial[],
};

// Shop interiors are lit a little by day and glow warmly after dusk.
export function interiorMaterial(map: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: "#ffffff", emissiveIntensity: 0.4, roughness: 0.25 });
  glow.interiors.push(m);
  return m;
}

// Night glow is atmosphere, not the subject: lanterns and lamps glow warmly but stay under the bloom threshold
// mostly, so people, faces and gestures remain the brightest readable things on screen.
export function updateGlow(lightsOn: number, t: number) {
  glow.window.emissiveIntensity = 0.05 + lightsOn * 1.25;
  glow.interiors.forEach((m) => (m.emissiveIntensity = 0.38 + lightsOn * 0.9));
  glow.lamp.emissiveIntensity = 0.2 + lightsOn * 2.6;
  glow.lanterns.forEach((m, i) => (m.emissiveIntensity = 0.25 + lightsOn * (1.5 + Math.sin(t * 2 + i) * 0.2)));
  const blink = Math.sin(t * 6) > 0;
  glow.neonRed.emissiveIntensity = blink ? 2.2 : 0.3;
  glow.neonBlue.emissiveIntensity = blink ? 0.3 : 2.2;
}
