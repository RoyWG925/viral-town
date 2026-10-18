// Cut-outs of the eight core residents on a transparent background, for slides and the submission page. No model calls.
//   node lab/shot-cast.mjs [hour=15.5]   → docs/characters/<id>.png (one each) and docs/characters/lineup.png (all eight)
// The headless page runs the real town (?calm&lite: no everyday scenes, no post-processing, so the canvas keeps its
// alpha). Just before each frame renders, everything except the chosen residents and the lights is hidden, the sky
// and fog are taken away for that render, the camera is placed by hand and ACES tone mapping stands in for the game's post-processing.
// Each shot is taken at 1.5× and scaled down by half (smooth edges), then cropped to the figure.
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hour = Number(process.argv[2] ?? 15.5);
const out = join("docs", "characters");
mkdirSync(out, { recursive: true });
const CAST = [
  ["baker", "bakery"], ["florist", "flower"], ["journalist", "news"], ["cafe", "cafe"],
  ["police", "police"], ["mayor", "townhall"], ["organizer", "stage"], ["vendor", "stall-2"],
];
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(() => { try { localStorage.setItem("viral.opening.v1", "1"); localStorage.setItem("viral.whispered.v1", "1"); } catch {} });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto("http://localhost:3002/?calm&lite", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__clock && !!window.__scene, null, { timeout: 180_000 });
await page.waitForTimeout(4000);
await page.keyboard.press("h");

await page.evaluate((hh) => {
  window.__clock.hour = hh;
  window.__clock.speed = 0;
  // nothing but the canvas on the page, and nothing behind it
  const canvas = document.querySelector("canvas");
  for (const el of document.body.querySelectorAll("*")) if (el !== canvas && !el.contains(canvas)) el.style.visibility = "hidden";
  for (let el = canvas; el; el = el.parentElement) el.style.background = "transparent";
  document.documentElement.style.background = "transparent";
  // no everyday thought bubbles over anyone's head in a portrait
  const quiet = () => { for (const ag of window.__crowd.agents) { ag.bubble = null; ag.bubbleTimer = 0; } requestAnimationFrame(quiet); };
  quiet();
  // isolation, applied right before every render (after the game's own per-frame updates)
  const S = window.__scene;
  window.__iso = { roots: [], pose: null };
  S.onBeforeRender = (gl, scene, cam) => {
    const iso = window.__iso;
    if (!iso.pose) return;
    gl.setClearColor(0x000000, 0);
    gl.toneMapping = 4; // ACESFilmicToneMapping, as the game's post-processing does
    gl.toneMappingExposure = 1;
    // the game copies new colours into the sky and fog every frame: take them away for this render only
    iso.saved = { background: scene.background, fog: scene.fog };
    scene.background = null;
    scene.fog = null;
    const keep = new Set([scene]);
    const up = (o) => { for (let p = o; p; p = p.parent) keep.add(p); };
    const inside = new Set();
    for (const r of iso.roots) { up(r); r.traverse((o) => inside.add(o)); }
    scene.traverse((o) => {
      if (!o.isLight) return;
      for (let p = o.parent; p; p = p.parent) if (p.isMesh) return; // a lamp's light would drag its lamp along
      up(o);
    });
    // only touch the branch points, so nothing inside a chosen figure changes
    for (const k of keep) for (const c of k.children) if (!inside.has(c) || iso.roots.includes(c)) c.visible = keep.has(c);
    const p = iso.pose;
    cam.fov = p.fov;
    cam.updateProjectionMatrix();
    cam.position.set(...p.pos);
    cam.lookAt(...p.at);
    cam.updateMatrixWorld();
  };
  S.onAfterRender = (gl, scene) => {
    const sv = window.__iso.saved;
    if (!sv) return;
    scene.background = sv.background;
    scene.fog = sv.fog;
    window.__iso.saved = null;
  };
}, hour);

// stand residents at given spots, at ease, facing +z; return nothing (roots are found after a frame)
const place = (list) => page.evaluate((list) => {
  const A = window.__crowd.agents;
  for (const { post, x, z } of list) {
    const a = A.find((q) => q.post === post);
    if (!a) continue;
    Object.assign(a, { x, z, vx: 0, vz: 0, path: [], mode: "work", errand: 0, script: null, act: null, visible: 1, heading: 0, poi: null, partner: null, bubble: null, prop: null });
    a.home = { x, z, face: 0 };
  }
}, list);
// the figure groups standing at those spots: children of the crowd group nearest each spot
const pick = (list, pose) => page.evaluate(({ list, pose }) => {
  const S = window.__scene;
  let crowdGroup = null;
  S.traverse((o) => { if (!crowdGroup && o.isGroup && o.children.length >= 50 && o.children.every((c) => c.isGroup)) crowdGroup = o; });
  const roots = list.map(({ x, z }) => {
    let best = null, bd = Infinity;
    for (const c of crowdGroup.children) {
      const d = Math.hypot(c.position.x - x, c.position.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return bd < 0.3 ? best : null;
  });
  window.__iso.roots = roots.filter(Boolean);
  window.__iso.pose = pose;
  return roots.map((r) => !!r);
}, { list, pose });

// screenshot → in-page: scale by half with smoothing, crop to the figure (+ padding), back as a PNG
async function cutout(file, pad = 24) {
  const buf = await page.screenshot({ omitBackground: true });
  const data = await page.evaluate(async ({ b64, pad }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = Math.round(img.width / 2), h = Math.round(img.height / 2);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const o = document.createElement("canvas");
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return { url: o.toDataURL("image/png"), w: o.width, h: o.height };
  }, { b64: buf.toString("base64"), pad });
  if (!data) throw new Error(`${file}: nothing rendered`);
  writeFileSync(join(out, file), Buffer.from(data.url.split(",")[1], "base64"));
  console.log("wrote", file, `${data.w}x${data.h}`);
}

// one at a time: everyone else is put back on a spot of their own, out of the way (hidden anyway)
const X = 0, Z = -3.4, D = 6.6, YAW = 0.42;
const solo = { fov: 32, pos: [X + D * Math.sin(YAW), 2.1, Z + D * Math.cos(YAW)], at: [X, 1.0, Z] };
for (const [id, post] of CAST) {
  await place(CAST.map(([, p], i) => ({ post: p, x: p === post ? X : -30 + i * 2, z: p === post ? Z : 40 })));
  await page.waitForTimeout(800);
  const found = await pick([{ x: X, z: Z }], solo);
  if (!found[0]) throw new Error(`${id}: figure not found`);
  await page.waitForTimeout(2500);
  await cutout(`${id}.png`);
}

// all eight in a row, the order of the town's role card bar
await page.setViewportSize({ width: 2400, height: 1000 });
const GAP = 1.15, X0 = -((CAST.length - 1) * GAP) / 2;
const row = CAST.map(([, post], i) => ({ post, x: X0 + i * GAP, z: Z }));
await place(row);
await page.waitForTimeout(800);
const L = 14.5;
const found = await pick(row, { fov: 18, pos: [0.6, 2.6, Z + L], at: [0, 0.85, Z] });
console.log("line-up figures found:", found.filter(Boolean).length);
await page.waitForTimeout(3000);
await cutout("lineup.png", 30);
await browser.close();
