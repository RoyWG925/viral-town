// Run one simulation from the command line and save the full record.
// node lab/run.ts --npc baker --text "聽說市長很害怕鴿子。" [--active baker,florist,journalist] [--policy gemma|rules]
//   [--variant single|two-stage|free-actions|eager] [--temp 0.7] [--seed 1] [--out lab/runs/manual] [--label name] [--quiet]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import { makeChat, makeGoogleChat, rateLimiter } from "../src/sim/llm.ts";
import { measure } from "../src/sim/metrics.ts";
import { story } from "../src/sim/report.ts";
import type { Variant } from "../src/sim/mind.ts";

// stay under the 20 rpm account limit; when several experiment processes run at once, give each a share via LAB_RPM
export const limiter = rateLimiter(Number(process.env.LAB_RPM ?? 18), Number(process.env.LAB_CONCURRENCY ?? 6));

/** LAB_PROVIDER=google uses the same Gemma 4 31B on Google AI Studio's free tier (keys in .env.local). */
export function chatFromEnv(temperature: number) {
  if (process.env.LAB_PROVIDER === "google") {
    const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
    const keys = [...env.matchAll(/^GEMINI_API_KEY(?:_\d+)?=(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
    if (!keys.length) throw new Error("No GEMINI_API_KEY in .env.local");
    return makeGoogleChat({ keys, temperature, maxTokens: 1000, timeoutMs: 120_000, maxAttempts: 6 }, limiter);
  }
  const key = process.env.GEMMA_API_KEY ?? process.env.TOKENFACTORY_API_KEY;
  if (!key) throw new Error("Set TOKENFACTORY_API_KEY first.");
  return makeChat({ key, baseUrl: process.env.GEMMA_BASE_URL || undefined, model: process.env.GEMMA_MODEL || undefined, temperature, maxTokens: 1000, timeoutMs: 60_000, maxAttempts: 8 }, limiter);
}

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}` || process.argv[1]?.endsWith("run.ts")) {
  const policy = (arg("policy", "gemma") as "gemma" | "rules");
  const temperature = Number(arg("temp", "0.7"));
  const run = await simulate({
    active: (arg("active", "baker,florist,journalist") as string).split(","),
    seedNpc: arg("npc", "baker")!,
    seedText: arg("text", "聽說市長很害怕鴿子。")!,
    seed: Number(arg("seed", "1")),
    policy,
    variant: arg("variant", "single") as Variant,
    temperature,
    chat: policy === "gemma" ? chatFromEnv(temperature) : undefined,
    maxDecisions: Number(arg("max", "20")),
    label: arg("label"),
  });
  const m = measure(run);
  const dir = arg("out", "lab/runs/manual")!;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${arg("label", `run-${Date.now()}`)}.json`;
  writeFileSync(file, JSON.stringify({ run, metrics: m }, null, 1));
  if (!process.argv.includes("--quiet")) console.log(story(run, { beliefs: true }));
  console.log("\n" + JSON.stringify({ ...m, retellings: m.retellings.map((r) => `${r.from}→${r.to} ${r.similarity}: ${r.text}`) }, null, 1));
  console.log(`saved ${file}; wall ${run.wall.ms} ms`);
}
