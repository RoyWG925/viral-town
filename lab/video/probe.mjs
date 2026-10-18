// Can this machine record the game for the demo video? GPU renderer, frame rate, tab capture with sound.
//   node lab/video/probe.mjs [headed=0|1]
import { chromium } from "playwright-core";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const headed = process.argv[2] === "1";
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  headless: !headed,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => { try { localStorage.setItem("viral.opening.v1", "1"); localStorage.setItem("viral.whispered.v1", "1"); } catch {} });
const page = await ctx.newPage();
await page.goto("http://localhost:3002/?calm", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length, null, { timeout: 180_000 });
await page.waitForTimeout(3000);
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
console.log("GPU:", JSON.stringify({ headed, renderer, fps }));

// tab capture: needs a user gesture, so start it from a click handler
await page.evaluate(() => {
  const b = document.createElement("button");
  b.id = "__rec";
  b.style.cssText = "position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;z-index:99999";
  document.body.appendChild(b);
  b.onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: 1920, height: 1080 }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }, preferCurrentTab: true, selfBrowserSurface: "include" });
      window.__probe = { tracks: s.getTracks().map((t) => `${t.kind}:${JSON.stringify(t.getSettings()).slice(0, 160)}`) };
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 8e6 });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start(1000);
      await new Promise((r) => setTimeout(r, 6000));
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      s.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      window.__probe = { ...window.__probe, mime, size: blob.size, b64: btoa(bin) };
    } catch (e) {
      window.__probe = { error: String(e) };
    }
  };
});
await page.click("#__rec");
await page.waitForFunction(() => window.__probe && (window.__probe.b64 || window.__probe.error), null, { timeout: 60_000 });
const p = await page.evaluate(() => ({ ...window.__probe, b64: undefined, hasData: !!window.__probe.b64 }));
console.log(p);
if (p.hasData) {
  const b64 = await page.evaluate(() => window.__probe.b64);
  writeFileSync("lab/video/probe.webm", Buffer.from(b64, "base64"));
  // what the recording plays back as
  const meta = await page.evaluate(async (b64) => {
    const v = document.createElement("video");
    v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "video/webm" }));
    await new Promise((r) => (v.onloadedmetadata = r));
    return { w: v.videoWidth, h: v.videoHeight, duration: v.duration };
  }, b64);
  console.log("probe.webm", meta);
}
await browser.close();
