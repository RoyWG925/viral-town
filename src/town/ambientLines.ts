// The everyday scenes' view of the canvas: where the camera is looking, and their short spoken lines drawn over
// townsfolk's heads. Lines are a beige pill with a 「日常」 tag (never the story's violet, never a story card), always
// the same size on screen. They are added straight to the r3f scene, so the scheduler needs no component mount.
import * as THREE from "three";
import { _roots, type RootState } from "@react-three/fiber";
import type { Agent } from "./crowdSim";
import { isCorePost } from "./cast";
import { kitFor } from "./kits";

const MAX_LINES = 4;
const LINE_RANGE = 50; // metres from where the camera looks
const LINE_H = 0.036; // height as a fraction of the view (about 29 px on an 800 px window)
/** The plaza preset, for frames before the canvas exists. */
const FALLBACK = { x: 1, z: -11, dist: 68, cx: 23, cz: 41 };

function rootState() {
  let last: RootState | null = null;
  for (const r of _roots.values()) last = r.store.getState();
  return last;
}

/** Where the camera looks (x, z on the ground), how far away it is, and where it stands (cx, cz). */
export function cameraLook() {
  const st = rootState();
  const target = (st?.controls as { target?: THREE.Vector3 } | null)?.target;
  if (!st || !target) return FALLBACK;
  const p = st.camera.position;
  return { x: target.x, z: target.z, dist: p.distanceTo(target), cx: p.x, cz: p.z };
}

/** Dev only (lab screenshots): put the camera at `pos`, looking at `target`. */
export function devLook(pos: THREE.Vector3Tuple, target: THREE.Vector3Tuple) {
  const st = rootState();
  const controls = st?.controls as { target: THREE.Vector3; update: () => void } | null;
  if (!st || !controls) return false;
  st.camera.position.set(...pos);
  controls.target.set(...target);
  controls.update();
  return true;
}

const textures = new Map<string, { map: THREE.CanvasTexture; aspect: number }>();
function lineTexture(text: string) {
  const hit = textures.get(text);
  if (hit) return hit;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = '600 40px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';
  const tagFont = '700 24px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';
  g.font = tagFont;
  const tagW = Math.ceil(g.measureText("日常").width) + 18;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + tagW + 54;
  c.width = w;
  c.height = 68;
  const pill = (x: number, y: number, pw: number, ph: number) => {
    const r = ph / 2;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + pw, y, x + pw, y + ph, r);
    g.arcTo(x + pw, y + ph, x, y + ph, r);
    g.arcTo(x, y + ph, x, y, r);
    g.arcTo(x, y, x + pw, y, r);
    g.closePath();
  };
  pill(3, 3, w - 6, 62);
  g.fillStyle = "rgba(250, 245, 235, 0.95)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(120, 104, 84, 0.35)";
  g.stroke();
  pill(16, 19, tagW, 30);
  g.fillStyle = "#b5a68c";
  g.fill();
  g.textBaseline = "middle";
  g.font = tagFont;
  g.fillStyle = "#fffaf0";
  g.fillText("日常", 25, 35);
  g.font = font;
  g.fillStyle = "#4a443c";
  g.fillText(text, tagW + 28, 36);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const out = { map, aspect: w / 68 };
  textures.set(text, out);
  return out;
}

const group = new THREE.Group();
group.name = "ambient-lines";
const sprites: THREE.Sprite[] = [];
const feet = new THREE.Vector3();
function spriteFor(k: number, map: THREE.Texture) {
  if (!sprites[k]) {
    // created with its first texture, so swapping textures later never needs a shader rebuild
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }));
    s.center.set(0.5, 0);
    s.renderOrder = 20;
    group.add(s);
    sprites[k] = s;
  }
  sprites[k].material.map = map;
  return sprites[k];
}

/** Show the nearest few everyday lines (agent.line) over their speakers' heads; call once a frame. */
export function syncLines(agents: Agent[]) {
  const st = rootState();
  if (!st || typeof document === "undefined") return;
  if (group.parent !== st.scene) {
    // a hot-reloaded copy of this module leaves its own group behind: take it down first
    st.scene.getObjectByName(group.name)?.removeFromParent();
    st.scene.add(group);
  }
  const look = cameraLook();
  const fov = (st.camera as THREE.PerspectiveCamera).fov ?? 32;
  const h = LINE_H * 2 * Math.tan(((fov / 2) * Math.PI) / 180);
  const far = (a: Agent) => Math.hypot(a.x - look.x, a.z - look.z);
  const near = agents
    .filter((a) => a.line && a.visible > 0.5 && a.mode !== "inside" && far(a) < LINE_RANGE)
    .sort((a, b) => far(a) - far(b))
    .slice(0, MAX_LINES);
  for (let k = 0; k < Math.max(near.length, sprites.length); k++) {
    const a = near[k];
    if (!a) {
      sprites[k].visible = false;
      continue;
    }
    const tex = lineTexture(a.line!);
    const s = spriteFor(k, tex.map);
    s.scale.set(h * tex.aspect, h, 1);
    // just above the emoji bubble: Crowd draws people at 1.3× their look scale, the bubble at 2 (+ a hat's height)
    const k13 = 1.3 * a.look.scale;
    let y = (2.0 + (kitFor(a.post)?.top ?? 0)) * k13 + 0.48 * k13 + 0.1;
    // core residents also wear a name tag (PlaybackLayer CoreMarker: at 3 + 0.35k, 0.42k tall, k = camera distance / 22)
    if (isCorePost(a.post)) {
      const tag = Math.min(2.4, Math.max(1, st.camera.position.distanceTo(feet.set(a.x, 0, a.z)) / 22));
      y = Math.max(y, 3 + 0.56 * tag + 0.12);
    }
    s.position.set(a.x, y, a.z);
    s.visible = true;
  }
}
