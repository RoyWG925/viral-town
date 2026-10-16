// End-to-end playthrough in a real (headless) browser: plays a recorded run or plants a live sentence,
// takes screenshots on a schedule and records a video. Needs the dev server on localhost:3002.
//
//   node lab/e2e.mjs recorded <recorded-id> [name]          # replay public/recorded/<id>.json (no model calls)
//   node lab/e2e.mjs live <npc> "<sentence>" [name]         # plant a sentence: real Gemma calls via /api/gemma
//   options (env): E2E_SECONDS=90  E2E_EVERY=3  E2E_SPEED=1  E2E_VIDEO=1  E2E_URL=http://localhost:3002
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [mode, a1, a2, a3] = process.argv.slice(2);
if (!mode || !a1) {
  console.log('usage: node lab/e2e.mjs recorded <id> [name] | live <npc> "<sentence>" [name]');
  process.exit(1);
}
const name = (mode === "live" ? a3 : a2) ?? `${mode}-${a1}`.replace(/[^\w-]/g, "_");
const seconds = Number(process.env.E2E_SECONDS ?? 90);
const every = Number(process.env.E2E_EVERY ?? 3);
const speed = Number(process.env.E2E_SPEED ?? 1);
const url = (process.env.E2E_URL ?? "http://localhost:3002") + (process.env.E2E_LITE === "0" ? "" : "/?lite");
const out = join("lab", "shots", name);
mkdirSync(out, { recursive: true });

const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  recordVideo: process.env.E2E_VIDEO === "0" ? undefined : { dir: out, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length, null, { timeout: 120_000 });
await page.waitForTimeout(2500);

const t0 = Date.now();
if (mode === "recorded") {
  await page.getByRole("button", { name: /錄製的實驗/ }).click();
  const r = await page.evaluate(async (id) => (await fetch(`/recorded/${id}.json`)).ok, a1);
  if (!r) throw new Error(`no recorded run ${a1}`);
  // the list shows sentences, not ids: click the entry whose index matches
  const ids = await page.evaluate(async () => (await (await fetch("/recorded/index.json")).json()).map((x) => x.id));
  const k = ids.indexOf(a1);
  await page.locator("button", { hasText: "📼 對" }).nth(k).click();
} else {
  // open the resident's card via the dev handle (clicking a 3D name tag is not reliable headless)
  await page.evaluate((npc) => window.__ui?.select?.(npc), a1);
  await page.waitForTimeout(600);
  await page.locator("textarea").fill(a2);
  await page.getByRole("button", { name: "植入這個念頭" }).click();
}
if (speed !== 1) await page.evaluate((s) => window.__setSpeed?.(s), speed);

const timeline = [];
let shot = 0;
while ((Date.now() - t0) / 1000 < seconds) {
  await page.waitForTimeout(every * 1000);
  const st = await page.evaluate(() => {
    const s = window.__show;
    const e = s.order[s.i - 1];
    return {
      status: s.status, i: s.i, n: s.order.length, gameT: s.gameT, stalled: s.stalled, growing: s.growing,
      last: e ? `${e.type}:${e.actor ?? ""}${e.target ? ">" + e.target : ""}` : null,
      shot: s.shot ? `${s.shot.kind}:${s.shot.a ?? ""}${s.shot.b ? "+" + s.shot.b : ""}` : null,
      says: s.says.map((x) => `${x.kind}:${x.npc}`),
      phase: document.body.innerText.includes("影響居民") ? "results" : "",
    };
  });
  const file = `${String(++shot).padStart(3, "0")}.png`;
  await page.screenshot({ path: join(out, file) });
  timeline.push({ s: Math.round((Date.now() - t0) / 1000), file, ...st });
  console.log(JSON.stringify(timeline.at(-1)));
  if (st.phase === "results" && timeline.filter((x) => x.phase === "results").length >= 2) break;
}
writeFileSync(join(out, "timeline.json"), JSON.stringify({ mode, a1, a2, seconds, errors, timeline }, null, 2));
const video = page.video();
await page.close();
if (video) await video.saveAs(join(out, "playthrough.webm"));
await ctx.close();
await browser.close();
console.log(`errors: ${errors.length}`, errors.slice(0, 5));
console.log(`saved to ${out}`);
