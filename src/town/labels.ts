import * as THREE from "three";

// Small rounded text labels drawn on a canvas (name tags, signs). Cached by text and colours.
const cache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

export function labelTexture(text: string, bg = "rgba(255,255,255,0.92)", fg = "#2c3e50") {
  const key = `${text}|${bg}|${fg}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = '600 44px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 48;
  c.width = w;
  c.height = 72;
  g.font = font;
  g.fillStyle = bg;
  const r = 30;
  g.beginPath();
  g.moveTo(r, 4);
  g.arcTo(w - 4, 4, w - 4, 68, r);
  g.arcTo(w - 4, 68, 4, 68, r);
  g.arcTo(4, 68, 4, 4, r);
  g.arcTo(4, 4, w - 4, 4, r);
  g.closePath();
  g.fill();
  g.fillStyle = fg;
  g.textBaseline = "middle";
  g.fillText(text, 24, 38);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const out = { texture, aspect: w / 72 };
  cache.set(key, out);
  return out;
}
