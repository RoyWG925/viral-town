// Screen recordings of the real game for the demo video: the browser records its own tab (picture and sound) with
// MediaRecorder while this script plays the game through its interface. Uses the GPU (ANGLE/D3D11), runs headless.
// Each clip is saved with a log of when every story event appeared on screen, so the edit can cut on real beats.
//   node lab/video/record.mjs <clip,...> [outDir=../viral-video/public/clips]
// Clips: opening, hook, finale, bed, contrast, fizzle, town, live (live makes real model calls: about 25-35, ~US$0.002).
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const [clipsArg = "opening,hook,contrast,fizzle,town,live", outDir = "../viral-video/public/clips"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const LOCK = join("lab", ".headless.lock");
if (existsSync(LOCK)) throw new Error("another headless lab browser is running (lab/.headless.lock)");
writeFileSync(LOCK, String(process.pid));
process.on("exit", () => { try { unlinkSync(LOCK); } catch {} });

const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  headless: true,
  // Playwright mutes the browser by default, which would record silence
  ignoreDefaultArgs: ["--mute-audio"],
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem("viral.opening.v1", "1"); localStorage.setItem("viral.whispered.v1", "1"); } catch {}
  // the dev server's issue badge is not part of the game
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style");
    st.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(st);
  });
});
const page = await ctx.newPage();
page.on("pageerror", (e) => { if (!/synchronously unmount/.test(String(e))) console.log("[pageerror]", String(e).slice(0, 160)); });
let current = null;
await page.exposeBinding("__chunk", (_src, b64) => { if (current) appendFileSync(current, Buffer.from(b64, "base64")); });

async function load(query = "") {
  await page.goto(`http://localhost:3002/${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__clock, null, { timeout: 180_000 });
  await page.waitForTimeout(4000);
  // the recorder: tab capture must start from a click
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.id = "__rec";
    b.style.cssText = "position:fixed;left:0;top:0;width:3px;height:3px;opacity:0.01;z-index:99999;pointer-events:auto";
    document.body.appendChild(b);
    b.onclick = async () => {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: 1920, height: 1080 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
        preferCurrentTab: true, selfBrowserSurface: "include",
      });
      const rec = new MediaRecorder(s, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 10e6, audioBitsPerSecond: 192e3 });
      let pending = Promise.resolve();
      rec.ondataavailable = (e) => {
        pending = pending.then(async () => {
          const buf = new Uint8Array(await e.data.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          await window.__chunk(btoa(bin));
        });
      };
      const t0 = performance.now();
      const log = [];
      let lastI = -1, lastPhase = "", lastFinale = false;
      const tick = setInterval(() => {
        const sh = window.__show, t = (performance.now() - t0) / 1000;
        const phase = document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? "";
        if (sh.i !== lastI && sh.order?.[sh.i - 1]) {
          const e = sh.order[sh.i - 1];
          log.push({ t, kind: "event", i: sh.i - 1, type: e.type, actor: e.actor ?? null, target: e.target ?? null, place: e.place ?? null, text: e.zh });
        }
        if (phase !== lastPhase) log.push({ t, kind: "phase", phase });
        if (!!sh.finale !== lastFinale) log.push({ t, kind: "finale", on: !!sh.finale });
        lastI = sh.i; lastPhase = phase; lastFinale = !!sh.finale;
      }, 100);
      window.__recCtl = {
        log,
        mark: (label) => log.push({ t: (performance.now() - t0) / 1000, kind: "mark", label }),
        stop: async () => {
          clearInterval(tick);
          const done = new Promise((r) => (rec.onstop = r));
          rec.stop();
          await done;
          await pending;
          s.getTracks().forEach((tr) => tr.stop());
          return { log, seconds: (performance.now() - t0) / 1000 };
        },
      };
      rec.start(2000);
    };
  });
}

async function record(name, body) {
  current = join(outDir, `${name}.webm`);
  if (existsSync(current)) unlinkSync(current);
  await page.click("#__rec");
  await page.waitForFunction(() => !!window.__recCtl, null, { timeout: 20_000 });
  const t0 = Date.now();
  try {
    await body();
  } finally {
    const res = await page.evaluate(() => window.__recCtl.stop());
    await page.evaluate(() => { window.__recCtl = null; });
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(res, null, 1));
    console.log(`recorded ${name}: ${res.seconds.toFixed(1)} s, ${res.log.length} log entries (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
    current = null;
  }
}
const mark = (label) => page.evaluate((l) => window.__recCtl.mark(l), label);
const phaseIs = (p, timeout) => page.waitForFunction((p) => document.querySelector("[data-phase]")?.getAttribute("data-phase") === p, p, { timeout, polling: 250 });

async function replay(needle, speed = 3) {
  await page.getByRole("button", { name: /Recorded runs/ }).click();
  await page.waitForTimeout(700);
  await page.locator("button", { hasText: needle }).first().click();
  await mark("play");
  await page.waitForTimeout(800);
  await page.evaluate((s) => window.__setSpeed(s), speed);
  await phaseIs("results", 15 * 60_000);
  await mark("results");
  await page.waitForTimeout(5000);
}

const CLIPS = {
  // the opening, played again from the 🎬 button
  opening: async () => {
    await load();
    await record("opening", async () => {
      await page.waitForTimeout(1000);
      await page.getByTitle("Watch the opening again").click();
      await mark("opening");
      await page.waitForFunction(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") !== "intro", null, { timeout: 120_000, polling: 250 }).catch(() => {});
      await page.waitForTimeout(1500);
    });
  },
  // the hook run, then its front page, Details and Behind the scenes
  hook: async () => {
    await load();
    await record("hook", async () => {
      await page.waitForTimeout(1500);
      await replay("old planks");
      await page.getByRole("button", { name: /Details/ }).first().click();
      await mark("details");
      await page.waitForTimeout(2500);
      const bts = page.getByText(/Behind the scenes/).first();
      if (await bts.count()) { await bts.scrollIntoViewIfNeeded(); await bts.click().catch(() => {}); await mark("behind"); }
      await page.waitForTimeout(2500);
      await page.mouse.move(960, 600);
      for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 220); await page.waitForTimeout(700); }
      await page.waitForTimeout(2000);
    });
  },
  // the hook run's 20:00 scene at normal speed (fast-forwarded until then), then its front page
  finale: async () => {
    await load();
    await record("finale", async () => {
      await page.getByRole("button", { name: /Recorded runs/ }).click();
      await page.waitForTimeout(700);
      await page.locator("button", { hasText: "old planks" }).first().click();
      await page.waitForTimeout(800);
      await page.evaluate(() => window.__setSpeed(12));
      await page.waitForFunction(() => !!window.__show.finale, null, { timeout: 10 * 60_000, polling: 100 });
      await page.evaluate(() => window.__setSpeed(1));
      await mark("finale");
      await phaseIs("results", 5 * 60_000);
      await mark("results");
      await page.waitForTimeout(8000);
    });
  },
  // the music bed for the edit: the hook run again, for its sound (the game's own synthesized soundtrack)
  bed: async () => {
    await load();
    await record("bed", async () => { await page.waitForTimeout(1500); await replay("old planks"); });
  },
  // a command is just something a stranger said: the mayor's reaction, at 2x so his thought is readable
  command: async () => {
    await load();
    await record("command", async () => { await page.waitForTimeout(1500); await replay("Cancel the Lantern", 2); });
  },
  contrast: async () => {
    await load();
    await record("contrast", async () => { await page.waitForTimeout(1500); await replay("new car"); });
  },
  fizzle: async () => {
    await load();
    await record("fizzle", async () => { await page.waitForTimeout(1500); await replay("cheap junk"); });
  },
  // dusk over the plaza, interface hidden
  town: async () => {
    await load();
    await page.evaluate(() => { window.__clock.hour = 18.5; });
    await page.keyboard.press("h");
    await page.waitForTimeout(3000);
    await record("town", async () => { await page.waitForTimeout(16_000); });
  },
  // a real whisper, played live: the oven sentence to Chief Harlow
  live: async () => {
    await load();
    await record("live", async () => {
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Chief Harlow" }).first().click();
      await mark("card");
      await page.waitForTimeout(2500);
      const box = page.getByPlaceholder(/Whisper something to/);
      await box.click();
      await page.keyboard.type("I heard the safety check on Barney's bakery oven expired ages ago.", { delay: 45 });
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: /Plant the thought/ }).click();
      await mark("planted");
      // until the Chief has inspected the bakery and spoken to Barney (or 8 minutes)
      await page.waitForFunction(() => {
        const o = window.__show.order.slice(0, window.__show.i);
        const insp = o.findIndex((e) => e.type === "inspect" && e.actor === "police");
        return insp >= 0 && o.slice(insp).some((e) => (e.type === "talk" || e.type === "phone") && e.actor === "police");
      }, null, { timeout: 8 * 60_000, polling: 500 }).then(() => mark("told")).catch(() => mark("timeout"));
      await page.waitForTimeout(6000);
    });
  },
};

for (const name of clipsArg.split(",")) {
  if (!CLIPS[name]) throw new Error(`unknown clip ${name}`);
  await CLIPS[name]();
}
await browser.close();
