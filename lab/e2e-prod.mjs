// Production smoke test through the UI only (the dev hooks are compiled out of production builds):
// open the page, open "📼 錄製的實驗", play the first recording, collect console errors and the screen
// (data-phase on the overlay), take screenshots.
//   node lab/e2e-prod.mjs [url=http://localhost:3005] [seconds=60]
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:3005";
const seconds = Number(process.argv[3] ?? 60);
const out = join("lab", "shots", "prod");
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
await page.goto(`${url}/?lite`, { waitUntil: "domcontentloaded" });
await page.getByText("📼 錄製的實驗").click({ timeout: 120_000 });
await page.locator("button", { hasText: "📼 對" }).first().click();
const phases = [];
for (let s = 0; s <= seconds; s += 15) {
  await page.screenshot({ path: join(out, `${String(s).padStart(3, "0")}.png`) });
  // the overlay says which screen it is on (explore / compose / simulating / playing / results)
  phases.push(await page.evaluate(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? ""));
  await page.waitForTimeout(15_000);
}
console.log(JSON.stringify({ errors: errors.length, sample: errors.slice(0, 5), phases }, null, 1));
await browser.close();
