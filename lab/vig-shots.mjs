// The everyday scenes (鎮上日常) in explore, as players see them: the plaza with several scenes running, then a close
// look at the stage-rush beat (the hurry line, the wobble, 志明's 😅 「沒事沒事！別碰！」). No model calls.
//   node lab/vig-shots.mjs [name=vignettes] [lite=0|1]
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [name = "vignettes", liteArg = "0"] = process.argv.slice(2);
const out = join("lab", "shots", name);
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(`http://localhost:3002/${liteArg === "1" ? "?lite" : ""}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__clock && !!window.__vig, null, { timeout: 180_000 });
await page.waitForTimeout(3000);
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(f)) : res(n / 2)); requestAnimationFrame(f); }));
const state = () => page.evaluate(() => ({
  running: window.__vig.running().map((s) => `${s.id}@${s.secs}s`),
  lines: window.__crowd.agents.filter((a) => a.line).map((a) => `${a.post ?? a.id}: ${a.line}`),
  wobble: performance.now() < window.__vig.fx.stageWobbleUntil,
}));
const log = [];

// 1) the plaza preset with a few scenes going at once
const plaza = await page.evaluate(() => { window.__clock.hour = 17.2; window.__clock.speed = 0; window.__vig.cap(3); return ["bicker", "haggle", "patrol"].map((id) => `${id}:${window.__vig.force(id)}`); });
for (let k = 0; k < 8; k++) {
  await page.waitForTimeout(2500);
  const st = await state();
  log.push({ shot: `plaza-${k}.png`, ...st });
  await page.screenshot({ path: join(out, `plaza-${k}.png`) });
}

// 2) close on the stage: catch the hurry line, the wobble and the 「沒事沒事！別碰！」 beat
await page.evaluate(() => { window.__vig.endAll(); window.__vig.cap(null); window.__vig.look([4, 12, 1], [-8.5, 0.8, -14]); });
await page.waitForTimeout(1500);
const forced = await page.evaluate(() => window.__vig.force("stage-rush"));
const want = { hurry: "快一點", wobble: null, oops: "沒事沒事" };
const t0 = Date.now();
while (Object.keys(want).length && Date.now() - t0 < 240_000) {
  await page.waitForTimeout(250);
  const st = await state();
  if (!st.running.some((r) => r.startsWith("stage-rush"))) break;
  for (const [key, text] of Object.entries(want)) {
    const hit = text ? st.lines.some((l) => l.includes(text)) : st.wobble;
    if (!hit) continue;
    delete want[key];
    log.push({ shot: `stage-${key}.png`, ...st });
    await page.screenshot({ path: join(out, `stage-${key}.png`) });
  }
}
writeFileSync(join(out, "log.json"), JSON.stringify({ fps, plaza, forced, missed: Object.keys(want), log, vig: await page.evaluate(() => window.__vig.log), errors }, null, 2));
console.log(JSON.stringify({ saved: out, fps, plaza, forced, missed: Object.keys(want), errors }));
await browser.close();
