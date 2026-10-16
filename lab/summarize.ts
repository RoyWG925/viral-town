// Summarise experiment runs into objective tables. No model judges anything here.
// node lab/summarize.ts A1 A1R [B1 B1R ...]
import { existsSync, readFileSync, readdirSync } from "node:fs";

interface Row {
  id: string; infra: boolean; npc: string; text: string; policy: string; variant: string; temperature: number; tags: string[];
  wallMs: number; ended: string; depth: number; reach: number; believers: number; decisions: number; none: number; world: number;
  worldTypes: string[]; rejected: number; idle: boolean; drift: number; topics: string[]; sim: number | null; llmCalls: number;
  llmSeconds: number; tokens: number; estCost: number; retries: number; fallbacks: number; firstDecisionMs: number | null;
  firstAction: string | null; firstStance: string | null;
}

function rows(exp: string): Row[] {
  const f = `lab/runs/${exp}/summary.jsonl`;
  if (!existsSync(f)) return [];
  const all = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
  // keep the latest row per case id
  return [...new Map(all.map((r) => [r.id, r])).values()];
}

/** What actually happened, ignoring wording: the actions executed and world changes. */
function signature(exp: string, r: Row) {
  const j = JSON.parse(readFileSync(`lab/runs/${exp}/${r.id}.json`, "utf8"));
  const acts = new Set<string>();
  for (const e of j.run.events) {
    if (["talk", "phone", "look", "inspect", "notice", "article", "statement", "gather"].includes(e.type)) acts.add(`${e.type}${e.target ? ">" + e.target : ""}`);
    if (e.type === "state" && e.data.key !== "writing") acts.add(`state:${e.data.key}`);
  }
  return [...acts].sort().join(" ") || "nothing";
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const mean = (v: number[]) => (v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : NaN);

for (const exp of process.argv.slice(2)) {
  const rs = rows(exp).filter((r) => !r.infra);
  const infra = rows(exp).filter((r) => r.infra).length;
  console.log(`\n## ${exp}: ${rs.length} valid runs${infra ? ` (+${infra} infrastructure failures excluded)` : ""}`);
  if (!rs.length) continue;
  console.table(rs.map((r) => ({ id: r.id, first: r.firstAction, stance: r.firstStance, depth: r.depth, reach: r.reach, world: r.world, idle: r.idle, drift: r.drift, sim: r.sim, s: +(r.wallMs / 1000).toFixed(0), calls: r.llmCalls, retries: r.retries, fb: r.fallbacks })));
  const byNpc = new Map<string, Row[]>();
  for (const r of rs) byNpc.set(r.npc, [...(byNpc.get(r.npc) ?? []), r]);
  const diversity = [...byNpc.entries()].map(([npc, list]) => {
    const sigs = new Set(list.map((r) => signature(exp, r)));
    const firsts = new Set(list.map((r) => r.firstAction));
    return `${npc}: ${sigs.size} distinct outcomes / ${firsts.size} distinct first actions over ${list.length} inputs`;
  });
  const llm = rs.filter((r) => r.llmCalls > 0);
  console.log(JSON.stringify({
    idleRate: pct(rs.filter((r) => r.idle).length, rs.length),
    meanDepth: mean(rs.map((r) => r.depth)),
    meanReach: mean(rs.map((r) => r.reach)),
    runsWithWorldChange: pct(rs.filter((r) => r.world > 0).length, rs.length),
    meanRetellingSimilarity: mean(rs.map((r) => r.sim).filter((x): x is number => x !== null)),
    runsWithTopicDrift: pct(rs.filter((r) => r.drift > 0).length, rs.length),
    diversity,
    llm: llm.length ? {
      callsPerRun: mean(llm.map((r) => r.llmCalls)),
      modelSecondsPerRun: mean(llm.map((r) => r.llmSeconds)),
      wallSecondsPerRun: mean(llm.map((r) => r.wallMs / 1000)),
      firstDecisionSeconds: mean(llm.map((r) => (r.firstDecisionMs ?? 0) / 1000)),
      tokensPerRun: mean(llm.map((r) => r.tokens)),
      estCostPerRun: mean(llm.map((r) => r.estCost)),
      retriesPerRun: mean(llm.map((r) => r.retries)),
      fallbackRuns: pct(llm.filter((r) => r.fallbacks > 0).length, llm.length),
    } : null,
  }, null, 1));
}

// validator and model error details across the given experiments
const errs = new Map<string, number>();
let calls = 0;
let attempts = 0;
let jsonFail = 0;
let modelErr = 0;
for (const exp of process.argv.slice(2)) {
  if (!existsSync(`lab/runs/${exp}`)) continue;
  for (const f of readdirSync(`lab/runs/${exp}`).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(`lab/runs/${exp}/${f}`, "utf8"));
    for (const d of j.run.decisions) {
      for (const l of d.llm) {
        calls++;
        attempts += l.attempts;
        if (l.status !== 200) modelErr++;
      }
      for (const v of d.validation) for (const e of v.errors) {
        if (e === "decision budget reached") continue;
        if (e.startsWith("not JSON")) jsonFail++;
        const k = e.replace(/\d+/g, "N").replace(/「[^」]*」/g, "「…」").slice(0, 70);
        errs.set(k, (errs.get(k) ?? 0) + 1);
      }
    }
  }
}
if (calls) {
  console.log(`\n## model calls: ${calls} decisions-calls, ${attempts} network attempts, ${modelErr} failed after retries, ${jsonFail} not-JSON responses`);
  console.log("validator / model errors (most common):");
  for (const [k, n] of [...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}× ${k}`);
}
