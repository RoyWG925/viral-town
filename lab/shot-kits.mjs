// Readability check for the core residents' costume kits. No model calls.
//   node lab/shot-kits.mjs <name> [lite=0|1] [hours=15.5,19.75]
// Saves, with the UI hidden (H): the default plaza view at each hour, then a line-up of the 8 core residents
// (plus an officer and a generic townsperson) standing at ease, and the same line-up mid-acting.
// The line-up borrows show.status="paused" + show.shot so the director's camera rig frames it; this only
// happens in the headless page, never in anyone's session.
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [name = "kits", liteArg = "0", hoursArg = "15.5,19.75"] = process.argv.slice(2);
const hours = hoursArg.split(",").map(Number);
const out = join("lab", "shots", name);
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
// ?calm: no everyday scenes, so nobody is borrowed out of the line-up
await page.goto(`http://localhost:3002/?calm${liteArg === "1" ? "&lite" : ""}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__clock, null, { timeout: 180_000 });
await page.waitForTimeout(4000);
await page.keyboard.press("h");
const shot = (file) => page.screenshot({ path: join(out, file) });

for (const h of hours) {
  await page.evaluate((hh) => { window.__clock.hour = hh; window.__clock.speed = 0; }, h);
  await page.waitForTimeout(5000);
  await shot(`default-${String(h).replace(".", "_")}.png`);
}

// line-up: mayor, chief, journalist, baker, florist, café, organizer, vendor, an officer, a generic adult
const posts = ["townhall", "police", "news", "bakery", "flower", "cafe", "stage", "stall-2", "officer-0", "bakery?generic"];
const X0 = -4.5, GAP = 1.5, Z = -3.4, FACE = 0.4; // in front of the plaza lantern pole, clear of the stalls
await page.evaluate(({ posts, X0, GAP, Z, FACE }) => {
  const A = window.__crowd.agents;
  const generic = A.find((a) => !a.post && !a.job && !a.prop && a.look.who === "adult" && a.mode !== "inside");
  posts.forEach((p, i) => {
    const a = p.endsWith("?generic") ? generic : A.find((x) => x.post === p);
    if (!a) return;
    Object.assign(a, { x: X0 + i * GAP, z: Z, vx: 0, vz: 0, path: [], mode: "work", errand: 0, script: null, act: null, visible: 1, heading: FACE, poi: null, partner: null, bubble: null });
    a.home = { x: a.x, z: a.z, face: FACE };
  });
}, { posts, X0, GAP, Z, FACE });
await page.evaluate(({ X0, GAP, Z }) => {
  const s = window.__show;
  window.__ui.follow = true;
  s.status = "paused";
  s.shot = { kind: "medium", at: { x: X0 + 4.5 * GAP, z: Z }, dist: 15, prio: 9, since: 0 };
}, { X0, GAP, Z });

for (const h of hours) {
  await page.evaluate((hh) => { window.__show.gameT = (hh - 15) * 60; }, h);
  await page.waitForTimeout(6000);
  const tag = String(h).replace(".", "_");
  await shot(`lineup-${tag}-a.png`);
  await page.waitForTimeout(2500);
  await shot(`lineup-${tag}-b.png`);
}

// mid-acting: the phone stays in the right hand while the kit prop stays in the left
await page.evaluate(() => {
  const A = window.__crowd.agents;
  const acts = { townhall: "talk:warn", police: "scan", news: "photo", bakery: "excited", flower: "clap", cafe: "talk:ask", stage: "yell", "stall-2": "hawk", "officer-0": "wave" };
  for (const [p, kind] of Object.entries(acts)) {
    const a = A.find((x) => x.post === p);
    if (a) a.act = { kind, t: 0, dur: 30 };
  }
  for (const p of ["townhall", "cafe"]) {
    const a = A.find((x) => x.post === p);
    if (a) a.prop = "phone";
  }
});
await page.evaluate((hh) => { window.__show.gameT = (hh - 15) * 60; }, hours[0]);
await page.waitForTimeout(4000);
await shot("lineup-acting.png");

console.log(JSON.stringify({ saved: out, errors }));
await browser.close();
