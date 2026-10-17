// Look at the town at a given hour, as players see it (full quality by default, or ?lite). No model calls.
//   node lab/shot-scene.mjs <name> [hours=16,18.5,19.5] [lite=0|1] [recorded-id seekGameMinute]
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [name = "scene", hoursArg = "16,18.5,19.5", liteArg = "0", rec, seek] = process.argv.slice(2);
const out = join("lab", "shots", name);
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(`http://localhost:3002/${liteArg === "1" ? "?lite" : ""}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__clock, null, { timeout: 180_000 });
await page.waitForTimeout(4000);
if (process.env.HIDE_UI) await page.keyboard.press("h");
if (rec) {
  await page.getByRole("button", { name: /錄製的實驗/ }).click();
  const ids = await page.evaluate(async () => (await (await fetch("/recorded/index.json")).json()).map((x) => x.id));
  await page.locator("button", { hasText: "📼 對" }).nth(ids.indexOf(rec)).click();
  await page.evaluate(() => window.__setSpeed?.(12));
  await page.waitForFunction((g) => window.__show.gameT >= g || window.__show.status === "done", Number(seek ?? 60), { timeout: 900_000, polling: 500 });
  await page.evaluate(() => window.__setSpeed?.(1));
  for (let k = 0; k < 4; k++) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(out, `play-${k}.png`) });
  }
} else {
  for (const h of hoursArg.split(",").map(Number)) {
    await page.evaluate((hh) => { window.__clock.hour = hh; window.__clock.speed = 0; }, h);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(out, `h${String(h).replace(".", "_")}.png`) });
  }
}
console.log(JSON.stringify({ saved: out, errors }));
await browser.close();
