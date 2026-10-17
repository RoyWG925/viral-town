// Screenshots of the game-facing UI at 1280×800 in one headless session (no model calls).
//   node lab/shot-ui.mjs tour [name]      explore → goals note → two whisper cards → 📼 → a recorded replay → results
//   node lab/shot-ui.mjs whisper [name]   a rules-policy story (dev hook) that fizzles, to see the 補一句 offer
// Also prints how much of the explore screen the interface covers (outermost painted boxes over the canvas).
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode = "tour", name = `ui-${mode}`] = process.argv.slice(2);
const out = join("lab", "shots", name);
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
// errors are printed as they happen too, so a crashed tab still leaves a trace
const fail = (t) => (errors.push(t), console.log("ERROR", t));
page.on("console", (m) => m.type() === "error" && fail(m.text().slice(0, 300)));
page.on("pageerror", (e) => fail(`pageerror: ${String(e).slice(0, 300)}`));
page.on("crash", () => console.log("ERROR tab crashed"));
await page.goto("http://localhost:3002/?lite", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length, null, { timeout: 180_000 });
await page.waitForTimeout(3000);
const log = [];
const shot = async (file, note = "") => {
  await page.screenshot({ path: join(out, `${file}.png`) });
  const phase = await page.evaluate(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? "");
  log.push({ file, phase, note });
  console.log(file, phase, note);
};
/** Share of the screen covered by interface boxes: outermost elements that paint a background over the canvas. */
const chrome = () =>
  page.evaluate(() => {
    const boxes = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("canvas") || el.tagName === "CANVAS") continue;
      const cs = getComputedStyle(el);
      const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
      if (!painted || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      let p = el.parentElement;
      let nested = false;
      while (p && p !== document.body) {
        const ps = getComputedStyle(p);
        if (ps.backgroundColor !== "rgba(0, 0, 0, 0)" && ps.backgroundColor !== "transparent") nested = true;
        p = p.parentElement;
      }
      if (nested) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.width * r.height > 0.9 * innerWidth * innerHeight) continue;
      boxes.push({ w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), text: el.textContent.slice(0, 30) });
    }
    const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
    return { pct: +((area / (innerWidth * innerHeight)) * 100).toFixed(2), boxes };
  });

if (mode === "tour") {
  await shot("01-explore-first", "first visit: hint pill");
  const c1 = await chrome();
  console.log("explore chrome", c1.pct, "%", JSON.stringify(c1.boxes));
  await page.evaluate(() => localStorage.setItem("viral.whispered.v1", "1"));
  await page.getByRole("button", { name: /今晚的小目標/ }).click();
  await page.waitForTimeout(400);
  await shot("02-goals-note");
  await page.getByRole("button", { name: /今晚的小目標/ }).click();
  for (const npc of ["baker", "police"]) {
    await page.evaluate((n) => window.__ui.select(n), npc);
    await page.waitForTimeout(2600);
    await shot(`03-compose-${npc}`);
  }
  const c2 = await chrome();
  console.log("compose chrome", c2.pct, "%");
  await page.getByRole("button", { name: "關閉" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /錄製的實驗/ }).click();
  await page.waitForTimeout(400);
  await shot("04-records");
  const ids = await page.evaluate(async () => (await (await fetch("/recorded/index.json")).json()).map((x) => x.id));
  await page.locator("button", { hasText: "📼 對" }).nth(ids.indexOf("P5-lantern-baker")).click();
  await page.waitForTimeout(7000);
  await shot("05-playing-start");
  // fast-forward to just before the 17:00 stage round (the 今晚行程 countdown), then watch at 1×
  await page.evaluate(() => window.__setSpeed?.(12));
  await page.waitForFunction(() => window.__show.gameT >= 106 || window.__show.status === "done", null, { timeout: 600_000, polling: 250 });
  await page.evaluate(() => window.__setSpeed?.(1));
  await page.waitForTimeout(1500);
  await shot("06-playing-countdown");
  await page.evaluate(() => window.__setSpeed?.(12));
  await page.waitForFunction(() => window.__show.gameT >= 125 || window.__show.status === "done", null, { timeout: 600_000, polling: 250 });
  await page.evaluate(() => window.__setSpeed?.(1));
  await page.waitForTimeout(2500);
  await shot("07-playing-stamp");
  await page.evaluate(() => window.__setSpeed?.(12));
  await page.waitForFunction(() => document.querySelector("[data-phase]")?.getAttribute("data-phase") === "results", null, { timeout: 900_000, polling: 500 });
  await page.waitForTimeout(1500);
  await shot("08-results");
  const card = await page.evaluate(() => window.__shareCard?.() ?? null).catch(() => null);
  if (card) writeFileSync(join(out, "share-card.png"), Buffer.from(card.split(",")[1], "base64"));
  await page.getByRole("button", { name: /收起/ }).click();
  await page.waitForTimeout(400);
  await shot("09-results-folded");
  const goals = await page.evaluate(() => localStorage.getItem("viral.goals.v1"));
  console.log("goals", goals);
  // a returning player: the hint is gone, the everyday ticker has its place, the stamps are still there
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length, null, { timeout: 180_000 });
  await page.waitForTimeout(9000);
  await shot("10-explore-return");
  console.log("explore chrome (return)", (await chrome()).pct, "%");
} else {
  await page.evaluate(() => localStorage.setItem("viral.whispered.v1", "1"));
  await page.evaluate(() => window.__viralRules("florist", "聽說鴿子", true));
  await page.waitForFunction(() => document.body.innerText.includes("故事快熄了"), null, { timeout: 300_000, polling: 300 });
  await page.waitForTimeout(800);
  await shot("01-offer");
  await page.getByRole("button", { name: /故事快熄了/ }).click();
  await page.waitForTimeout(400);
  await shot("02-box");
  await page.locator("input[placeholder^='對']").fill("聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。");
  // the first suggestion is preselected: keep it
  await page.getByRole("button", { name: "補這一句" }).click();
  await page.waitForTimeout(6000);
  await shot("03-after");
  await page.evaluate(() => window.__setSpeed?.(12));
  await page.waitForFunction(() => window.__show.status === "done" && !window.__show.growing, null, { timeout: 600_000, polling: 500 });
  await page.waitForTimeout(6000);
  await shot("04-end");
  // the rules path never stamps goals
  console.log("goals", await page.evaluate(() => localStorage.getItem("viral.goals.v1")));
}
writeFileSync(join(out, "log.json"), JSON.stringify({ log, errors }, null, 2));
console.log(JSON.stringify({ errors: errors.length, sample: errors.slice(0, 5) }));
await browser.close();
