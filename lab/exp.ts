// Experiment runner. Runs a named case matrix one simulation at a time, saves every run, resumes
// where it left off, and separates infrastructure failures (model unreachable) from validator failures.
// node lab/exp.ts <experiment> [--only id1,id2] [--rerun-infra]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { simulate, type SimConfig } from "../src/sim/engine.ts";
import { measure } from "../src/sim/metrics.ts";
import { story } from "../src/sim/report.ts";
import { chatFromEnv } from "./run.ts";
import { EXPERIMENTS } from "./cases.ts";

const name = process.argv[2];
const exp = EXPERIMENTS[name];
if (!exp) {
  console.log(`experiments: ${Object.keys(EXPERIMENTS).join(", ")}`);
  process.exit(1);
}
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const rerunInfra = process.argv.includes("--rerun-infra");
const dir = `lab/runs/${name}`;
mkdirSync(dir, { recursive: true });

const done = new Map<string, { infra: boolean }>();
if (existsSync(`${dir}/summary.jsonl`))
  for (const l of readFileSync(`${dir}/summary.jsonl`, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(l);
    done.set(r.id, { infra: r.infra });
  }

/** Wait until one tiny Gemma call succeeds, so provider outages are not recorded as model behaviour. */
async function healthGate(maxMinutes = 30) {
  const key = process.env.TOKENFACTORY_API_KEY!;
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    const ok = await fetch("https://developer.amd.com.cn/radeon/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "Gemma-4-31B-IT", messages: [{ role: "user", content: 'Reply {"ok":true}' }], max_tokens: 10, temperature: 0, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(45_000),
    }).then((r) => r.status === 200).catch(() => false);
    if (ok) return true;
    if (Date.now() - t0 > maxMinutes * 60_000) return false;
    if (i % 3 === 0) console.log(`  … Gemma unavailable, waiting (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
    await new Promise((r) => setTimeout(r, 40_000));
  }
}

const todo = exp.cases.filter((c) => !(only && !only.includes(c.id)) && !(done.get(c.id) && !(rerunInfra && done.get(c.id)!.infra)));
const PARALLEL = Number(process.env.LAB_PARALLEL ?? 1);
let gaveUp = false;
async function worker() {
  for (;;) {
    const c = todo.shift();
    if (!c || gaveUp) return;
    await runCase(c);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
console.log("done");

async function runCase(c: (typeof exp.cases)[number]) {
  if ((c.policy ?? "gemma") === "gemma" && !(await healthGate())) {
    console.log("  ✖ Gemma stayed unavailable for 30 minutes; stopping here (resume later)");
    gaveUp = true;
    return;
  }
  const temperature = c.temperature ?? 0.7;
  const cfg: SimConfig = {
    maxDecisions: 12, maxPerNpc: 4, seed: 1, policy: "gemma", variant: "single", ...c,
    temperature,
    chat: (c.policy ?? "gemma") === "gemma" ? chatFromEnv(temperature) : undefined,
    label: c.id,
    onDecision: (d) => {
      const o = d.output;
      const err = d.llm.filter((l) => l.status !== 200).length;
      console.log(`  ${c.id} ${d.id} ${d.npc} @${d.t.toFixed(0)} ${o?.feeling ?? ""} ${o?.actions.map((a) => a.type + (a.target ? "→" + a.target : "")).join(",") ?? ""}${d.fallback ? (d.validation.some((v) => v.kind === "budget") ? " CAP" : " FALLBACK") : ""}${err ? ` modelErrors=${err}` : ""} ${d.llm.map((l) => (l.latencyMs / 1000).toFixed(1) + "s").join("/")}`);
    },
  };
  console.log(`▶ ${c.id}: ${c.seedNpc} ← 「${c.seedText}」 (${cfg.policy}/${cfg.variant}/t${temperature})`);
  const run = await simulate(cfg);
  const m = measure(run);
  const infra = run.decisions.some((d) => d.llm.length > 0 && d.llm.every((l) => l.status !== 200));
  writeFileSync(`${dir}/${c.id}.json`, JSON.stringify({ case: c, run, metrics: m }, null, 1));
  writeFileSync(`${dir}/${c.id}.story.txt`, story(run, { beliefs: true }));
  const row = {
    id: c.id, infra, npc: c.seedNpc, text: c.seedText, policy: cfg.policy, variant: cfg.variant, temperature, tags: c.tags ?? [],
    wallMs: run.wall.ms, ended: run.ended.reason, depth: m.depth, reach: m.reach, believers: m.believers, decisions: m.decisions,
    none: m.noneDecisions, world: m.worldChanges, worldTypes: m.worldChangeTypes, rejected: m.rejected, idle: m.idle, drift: m.topicDrift,
    topics: m.topics, sim: m.meanSimilarity, llmCalls: m.llmCalls, llmSeconds: m.llmSeconds, tokens: m.tokens, estCost: m.estCost,
    retries: m.validatorRetries, fallbacks: m.fallbacks, firstDecisionMs: run.decisions[0]?.llm.at(-1)?.wallEndMs ?? null,
    firstAction: run.decisions[0]?.output?.actions.map((a) => a.type).join(",") ?? null,
    firstStance: run.decisions[0]?.output?.stances.map((s) => `${s.verdict}:${s.confidence}`).join(",") ?? null,
  };
  appendFileSync(`${dir}/summary.jsonl`, JSON.stringify(row) + "\n");
  console.log(`  ✔ ${c.id} depth ${m.depth} reach ${m.reach} world ${m.worldChanges} decisions ${m.decisions} wall ${(run.wall.ms / 1000).toFixed(0)}s${infra ? " INFRA" : ""}`);
}
