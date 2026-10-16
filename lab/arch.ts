// Architecture comparison from real runs (Experiment E / section 2 of the brief).
// For each saved run: replay its real LLM timings against the playback timing model and compute
//   A  full pre-simulation, then play
//   B  stream: play as soon as events exist, simulation keeps running ahead (optional lead buffer)
//   C  live: each decision starts only when playback reaches it
// node lab/arch.ts lab/runs/B1 [more dirs or files]
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { RunResult } from "../src/sim/engine.ts";
import { gapSeconds, watchSeconds } from "../src/sim/timing.ts";

function files(paths: string[]) {
  return paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".json")).map((f) => `${p}/${f}`) : [p]));
}

interface Row { id: string; W: number; play: number; A_first: number; B_first: number; B_stall: number; B5_first: number; B5_stall: number; C_first: number; C_stall: number; calls: number; decisions: number }

function analyse(id: string, run: RunResult): Row | null {
  const ev = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  if (!ev.length || ev.some((e) => e.w === undefined)) return null;
  const W = run.wall.ms / 1000;
  // playback schedule: sequential, game-time order, with compressed gaps
  const start: number[] = [];
  let cur = 0;
  let lastT = ev[0].t;
  for (const e of ev) {
    cur += gapSeconds(e.t - lastT);
    lastT = e.t;
    start.push(cur);
    cur += watchSeconds(e);
  }
  const play = cur;
  const firstDecide = ev.findIndex((e) => e.type === "decide");
  const avail = ev.map((e) => (e.w ?? 0) / 1000);
  const stream = (lead: number) => {
    let clock = avail[0] + lead;
    let stall = 0;
    let first = NaN;
    let prev = 0;
    for (let i = 0; i < ev.length; i++) {
      clock += start[i] - prev;
      prev = start[i];
      if (avail[i] > clock) {
        stall += avail[i] - clock;
        clock = avail[i];
      }
      if (i === firstDecide) first = clock;
      clock += 0; // watchSeconds is already inside start[] differences
    }
    return { first, stall };
  };
  // live: a decision's model calls start when playback reaches it; concurrent batches overlap
  const decLatency = new Map(run.decisions.map((d) => [d.id, d.llm.reduce((s, l) => s + l.latencyMs, 0) / 1000]));
  let clockC = 0;
  let stallC = 0;
  let firstC = NaN;
  let prev = 0;
  for (let i = 0; i < ev.length; i++) {
    clockC += start[i] - prev;
    prev = start[i];
    const e = ev[i];
    if (e.type === "decide") {
      const lat = decLatency.get(String(e.data.decision)) ?? 0;
      stallC += lat;
      clockC += lat;
      if (Number.isNaN(firstC)) firstC = clockC;
    }
  }
  const b0 = stream(0);
  const b5 = stream(5);
  return {
    id, W: +W.toFixed(1), play: +play.toFixed(1),
    A_first: +(W + start[firstDecide]).toFixed(1),
    B_first: +b0.first.toFixed(1), B_stall: +b0.stall.toFixed(1),
    B5_first: +b5.first.toFixed(1), B5_stall: +b5.stall.toFixed(1),
    C_first: +firstC.toFixed(1), C_stall: +stallC.toFixed(1),
    calls: run.llm.calls, decisions: run.decisions.length,
  };
}

const rows: Row[] = [];
for (const f of files(process.argv.slice(2))) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const run: RunResult = j.run ?? j;
  const r = analyse(f.split("/").pop()!.replace(".json", ""), run);
  if (r && run.decisions.some((d) => d.llm.length)) rows.push(r);
}
console.table(rows);
const avg = (k: keyof Row) => +(rows.reduce((s, r) => s + (r[k] as number), 0) / Math.max(1, rows.length)).toFixed(1);
const med = (k: keyof Row) => {
  const v = rows.map((r) => r[k] as number).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
console.log(JSON.stringify({
  runs: rows.length,
  mean: { W: avg("W"), play: avg("play"), A_first: avg("A_first"), B_first: avg("B_first"), B_stall: avg("B_stall"), B5_first: avg("B5_first"), B5_stall: avg("B5_stall"), C_first: avg("C_first"), C_stall: avg("C_stall") },
  median: { W: med("W"), A_first: med("A_first"), B_first: med("B_first"), B_stall: med("B_stall"), C_stall: med("C_stall") },
}, null, 1));
