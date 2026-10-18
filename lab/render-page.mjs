// Render a local HTML file to PNG (screenshot) or PDF (print), headless. No network, no model calls.
//   node lab/render-page.mjs <in.html> <out.png|out.pdf> [width=1920] [height=1080] [scale=1] [transparent=0]
import { chromium } from "playwright-core";
import { politeHeadless } from "./headless.mjs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [input, output, w = "1920", h = "1080", scale = "1", transparent = "0"] = process.argv.slice(2);
const exe = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
await politeHeadless();
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true });
const page = await (await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale) })).newPage();
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: "load" });
await page.waitForTimeout(400);
if (output.endsWith(".pdf")) await page.pdf({ path: output, width: `${w}px`, height: `${h}px`, printBackground: true, preferCSSPageSize: true });
else await page.screenshot({ path: output, fullPage: false, omitBackground: transparent === "1" });
await browser.close();
console.log("wrote", output);
