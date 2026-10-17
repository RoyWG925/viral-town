// Replays a recorded run (no model calls) and checks the everyday scenes' honesty rules while the story plays:
// only storySafe scenes run, they never cast a core resident or anyone in the story, and they keep 18 m from the
// story's focus and from anyone thinking. Checked twice: by the page's own audit (window.__vig) and, independently,
// by this script every second. A dev-server reload mid-run (someone saved a file) restarts the attempt.
//   node lab/vig-replay.mjs <recorded-id> [speed=6] [name]
import { chromium } from "playwright-core";
import { politeHeadless, LIGHT_ARGS } from "./headless.mjs";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [id = "P2-stage-cafe", speedArg = "6", name = `vig-replay-${id}`] = process.argv.slice(2);
const out = join("lab", "shots", name);
mkdirSync(out, { recursive: true });
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...LIGHT_ARGS] });
const POST = { baker: "bakery", florist: "flower", journalist: "news", cafe: "cafe", police: "police", mayor: "townhall", organizer: "stage", vendor: "stall-2" };
const SAFE = ["cat-chase", "bicker"];

async function attempt(k) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  let loads = 0;
  page.on("load", () => loads++);
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto("http://localhost:3002/?lite", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__show && !!window.__crowd?.agents?.length && !!window.__vig, null, { timeout: 180_000 });
  // let an explore scene or two start first, so the hand-over at the start of the story is tested too
  await page.waitForFunction(() => window.__vig.log.started.length >= 2, null, { timeout: 120_000, polling: 500 }).catch(() => {});
  const before = await page.evaluate(() => window.__vig.running().map((s) => s.id));
  await page.getByRole("button", { name: /錄製的實驗/ }).click();
  const ids = await page.evaluate(async () => (await (await fetch("/recorded/index.json")).json()).map((x) => x.id));
  await page.locator("button", { hasText: "📼 對" }).nth(ids.indexOf(id)).click();
  await page.waitForFunction(() => window.__show.status === "playing", null, { timeout: 30_000 });
  await page.evaluate((s) => window.__setSpeed?.(s), Number(speedArg));
  const loadsAtStart = loads;
  const startedBefore = await page.evaluate(() => window.__vig.log.started.length);

  const own = []; // this script's independent findings
  const seen = new Set();
  let shots = 0;
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 1_200_000 && loads === loadsAtStart) {
    await page.waitForTimeout(1000);
    last = await page.evaluate((POST) => {
      const s = window.__show;
      const agentOf = (npc) => window.__crowd.agents.find((a) => a.post === POST[npc]);
      const story = [s.focus, ...s.thinking].map(agentOf).filter(Boolean);
      const inLog = new Set(s.order.flatMap((e) => [e.actor, e.target]).map(agentOf).filter(Boolean).map((a) => a.id));
      return {
        status: s.status, gameT: s.gameT,
        scenes: window.__vig.running().map((r) => {
          const cast = r.cast.map((c) => window.__crowd.agents.find((a) => a.id === c || a.post === c));
          return { id: r.id, cast: r.cast, gap: Math.min(Infinity, ...story.map((a) => Math.hypot(a.x - r.at.x, a.z - r.at.z))), core: cast.some((a) => a?.post), inStory: cast.some((a) => a && inLog.has(a.id)) };
        }),
      };
    }, POST);
    if (last.status === "playing" || last.status === "paused") {
      for (const sc of last.scenes) {
        seen.add(sc.id);
        if (!SAFE.includes(sc.id)) own.push(`${sc.id} running at ${last.gameT}`);
        if (sc.core || sc.inStory) own.push(`${sc.id} cast ${sc.cast} at ${last.gameT}`);
        if (sc.gap < 18) own.push(`${sc.id} ${sc.gap.toFixed(1)} m from the story at ${last.gameT}`);
      }
      if (last.scenes.length && shots < 3) await page.screenshot({ path: join(out, `during-story-${++shots}.png`) });
    }
    if (last.status === "done" || last.status === "idle") break; // idle: a hot reload reset the story
  }
  const disrupted = loads !== loadsAtStart || last?.status === "idle";
  const vig = disrupted ? null : await page.evaluate(() => window.__vig.log);
  await page.close();
  if (disrupted) return { attempt: k, disrupted: true };
  const during = vig.started.slice(startedBefore).filter((s) => s.playing);
  const problems = [...vig.violations, ...own, ...(last?.status === "done" ? [] : [`story did not finish (${last?.status})`])];
  return { attempt: k, id, before, scenesDuringStory: [...seen], startedWhilePlaying: during, ended: vig.ended, audits: vig.audits, problems, errors };
}

let result;
for (let k = 1; k <= 3; k++) {
  result = await attempt(k);
  console.log(JSON.stringify(result));
  if (!result.disrupted) break;
}
writeFileSync(join(out, "vig.json"), JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.disrupted ? 2 : result.problems.length ? 1 : 0);
