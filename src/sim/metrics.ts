// Objective measures computed from a run's event log. No model judges anything here.
import type { RunResult } from "./engine.ts";
import type { SimEvent } from "./types.ts";

const WORLD_TYPES = new Set(["state", "notice", "article", "statement", "gather"]);
const VISUAL_TYPES = new Set(["move", "talk", "phone", "look", "inspect", "state", "notice", "article", "statement", "gather", "react", "arrive"]);

function bigrams(s: string) {
  const t = s.replace(/[\s，。！？、「」『』：；,.!?"'（）()]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
export function similarity(a: string, b: string) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

export interface Metrics {
  depth: number; // longest chain of residents deciding because of the previous one
  reach: number; // residents who heard some version
  believers: number; // residents who ended with a belief >= 0.5
  decisions: number;
  noneDecisions: number;
  actionsDone: Record<string, number>;
  worldChanges: number;
  worldChangeTypes: string[];
  rejected: number;
  idle: boolean; // nothing beyond the first resident's reaction
  topics: string[];
  topicDrift: number; // claims whose topic differs from the first claim's
  retellings: { from: string; to: string; text: string; similarity: number }[];
  meanSimilarity: number | null;
  explained: number; // fraction of world changes with a causal path to the seed
  visualEvents: number;
  gameMinutes: number;
  llmCalls: number;
  llmSeconds: number;
  tokens: number;
  estCost: number;
  /** what the platform itself reported (usage.cost, US$) — the real figure; estCost is a list-rate guess in points */
  platformCost: number;
  validatorRetries: number;
  modelErrors: number;
  fallbacks: number;
  /** decisions whose thinking was kept but whose wanted action the rules refused (after retries) */
  refusedWishes: number;
}

export function measure(run: RunResult): Metrics {
  const byId = new Map(run.events.map((e) => [e.id, e]));
  const seed = run.events.find((e) => e.type === "seed")!;
  const hop = new Map<string, number>();
  const hopOf = (e: SimEvent): number => {
    if (hop.has(e.id)) return hop.get(e.id)!;
    hop.set(e.id, 0);
    const up = Math.max(0, ...e.causes.map((c) => byId.get(c)).filter(Boolean).map((c) => hopOf(c!)));
    const h = up + (e.type === "decide" ? 1 : 0);
    hop.set(e.id, h);
    return h;
  };
  const decides = run.events.filter((e) => e.type === "decide" && !e.data.budget);
  const depth = Math.max(0, ...decides.map(hopOf));
  const reached = new Set<string>([seed.target!]);
  for (const e of run.events) if (e.type === "deliver" && e.data.via !== "inspection" && e.target) reached.add(e.target);
  const believers = Object.values(run.minds).filter((m) => m.beliefs.some((b) => b.confidence >= 0.5)).length;
  const actionsDone: Record<string, number> = {};
  for (const e of run.events) if (["talk", "phone", "look", "inspect", "state", "notice", "article", "statement", "gather"].includes(e.type)) actionsDone[e.type] = (actionsDone[e.type] ?? 0) + 1;
  const world = run.events.filter((e) => WORLD_TYPES.has(e.type) && e.data.key !== "writing");
  const reachesSeed = (e: SimEvent): boolean => {
    const seen = new Set<string>();
    const stack = [e];
    while (stack.length) {
      const x = stack.pop()!;
      if (x.id === seed.id) return true;
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      for (const c of x.causes) {
        const y = byId.get(c);
        if (y) stack.push(y);
      }
    }
    return false;
  };
  const retellings = run.events
    .filter((e) => e.type === "talk" || (e.type === "phone" && !e.data.missed))
    .map((e) => ({ from: e.actor!, to: e.target!, text: String(e.data.text ?? ""), similarity: Number(similarity(String(seed.data.text), String(e.data.text ?? "")).toFixed(2)) }));
  const first = run.claims[0];
  const llm = run.decisions.flatMap((d) => d.llm);
  return {
    depth,
    reach: reached.size,
    believers,
    decisions: decides.length,
    noneDecisions: decides.filter((e) => (e.data.actions as string[]).every((a) => a === "none")).length,
    actionsDone,
    worldChanges: world.length,
    worldChangeTypes: [...new Set(world.map((e) => (e.data.key ? `${e.type}:${String(e.data.key).split(".")[0]}` : e.type)))],
    rejected: run.events.filter((e) => e.type === "rejected").length,
    idle: depth <= 1 && world.length === 0,
    topics: [...new Set(run.claims.map((c) => c.topic))],
    topicDrift: first ? run.claims.filter((c) => c.topic !== first.topic).length : 0,
    retellings,
    meanSimilarity: retellings.length ? Number((retellings.reduce((s, r) => s + r.similarity, 0) / retellings.length).toFixed(2)) : null,
    explained: world.length ? world.filter(reachesSeed).length / world.length : 1,
    visualEvents: run.events.filter((e) => VISUAL_TYPES.has(e.type)).length,
    gameMinutes: Number((run.ended.t - seed.t).toFixed(1)),
    llmCalls: llm.length,
    llmSeconds: Number((llm.reduce((s, l) => s + l.latencyMs, 0) / 1000).toFixed(1)),
    tokens: llm.reduce((s, l) => s + l.promptTokens + l.completionTokens, 0),
    estCost: Number(llm.reduce((s, l) => s + l.estCost, 0).toFixed(6)),
    platformCost: Number(llm.reduce((s, l) => s + (l.platformCost ?? 0), 0).toFixed(6)),
    // only rejections of the model's output count; provider outages and two-stage calls do not
    validatorRetries: run.decisions.reduce((s, d) => s + d.validation.filter((v) => v.kind === "validator" || (v.kind === undefined && v.errors.length > 0 && !v.errors.some((e) => e.startsWith("model error") || e === "decision budget reached"))).length, 0),
    modelErrors: run.decisions.reduce((s, d) => s + d.validation.filter((v) => v.kind === "model" || v.errors.some((e) => e.startsWith("model error"))).length, 0),
    // planned decision caps are not failures; count only decisions the validator had to give up on
    fallbacks: run.decisions.filter((d) => d.fallback && !d.validation.some((v) => v.errors.includes("decision budget reached"))).length,
    refusedWishes: run.decisions.filter((d) => d.validation.some((v) => v.kind === "salvaged")).length,
  };
}
