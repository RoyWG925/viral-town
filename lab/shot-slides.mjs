// Screenshots for the pitch deck, headless, from the running dev server. No model calls.
//   node lab/shot-slides.mjs town [hour=18.6]          → docs/slides/shots/town.png (UI hidden)
//   node lab/shot-slides.mjs replay "<words of the sentence>" → docs/slides/shots/finale.png and frontpage.png
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [mode = "town", arg] = process.argv.slice(2);
const out = join("docs", "slides", "shots");
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => { try { localStorage.setItem("viral.opening.v1", "1"); localStorage.setItem("viral.whispered.v1", "1"); } catch {} });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__clock, null, { timeout: 180_000 });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }); // the dev-only issue badge
await page.waitForTimeout(5000);
if (mode === "town") {
  await page.evaluate((h) => { window.__clock.hour = h; window.__clock.speed = 0; }, Number(arg ?? 18.6));
  await page.keyboard.press("h");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(out, "town.png") });
} else if (mode === "replay") {
  // play a published recording at 3x until the festival scene, then the front page
  await page.evaluate(async (id) => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Recorded runs/.test(b.textContent ?? ""));
    btn?.click();
  }, arg);
  await page.waitForTimeout(800);
  const clicked = await page.evaluate((needle) => {
    const want = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith("📼 To") && (b.textContent ?? "").includes(needle));
    want?.click();
    return want?.textContent ?? null;
  }, arg);
  if (!clicked) throw new Error(`no recorded run matching “${arg}”`);
  console.log("playing", clicked);
  // headless frames are slow and the clock follows frame time: fast-forward to 20:00, then watch the finale at 1x
  await page.evaluate(() => window.__setSpeed(40));
  const probe = setInterval(() => page.evaluate(() => ({ clock: Math.round(window.__show.clock), status: window.__show.status, speed: window.__show.speed, until: Math.round(window.__show.stepUntil ?? 0), phase: document.querySelector("[data-phase]")?.getAttribute("data-phase") })).then((x) => console.log("probe", JSON.stringify(x))).catch(() => {}), 15000);
  await page.waitForFunction(() => !!window.__show.finale, null, { timeout: 900_000, polling: 500 });
  await page.evaluate(() => window.__setSpeed(1));
  await page.keyboard.press("h");
  await page.waitForFunction(() => window.__show.clock - window.__show.finale.start >= 4.5, null, { timeout: 300_000, polling: 250 });
  await page.screenshot({ path: join(out, "finale.png") });
  await page.keyboard.press("h");
  await page.waitForFunction(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") === "results", null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, "frontpage.png") });
  clearInterval(probe);
}
await browser.close();
console.log("done", mode);
