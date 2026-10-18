// Real numbers for the promo's counters, read from the runs' own logs (lab/runs/P23) and the clip logs.
//   node promo-data.mjs → src/promo-data.json
import { readFileSync, writeFileSync } from "node:fs";

const run = (name) => JSON.parse(readFileSync(`../viral-town/lab/runs/P23/${name}.json`, "utf8")).run;
const clipLog = (name) => JSON.parse(readFileSync(`public/clips/${name}.json`, "utf8")).log.filter((e) => e.kind === "event");

// counters at a moment of a clip: the last story event on screen by then, and everything the run had done by its game time
function at(runName, clip, t) {
  const r = run(runName), log = clipLog(clip);
  const shown = log.filter((e) => e.t <= t).at(-1);
  const ev = shown ? r.events.find((e) => e.zh === shown.text && e.type === shown.type) : null;
  const gt = ev ? ev.t : 0;
  const decs = r.decisions.filter((d) => d.t <= gt + 1e-6);
  const calls = decs.reduce((s, d) => s + d.llm.length, 0);
  const cost = decs.reduce((s, d) => s + d.llm.reduce((a, l) => a + (l.platformCost ?? 0), 0), 0);
  const heard = new Set(r.events.filter((e) => e.t <= gt + 1e-6 && (e.type === "deliver" || e.type === "seed") && e.target).map((e) => e.target));
  return { t, game: +gt.toFixed(2), reach: heard.size, calls, cost: +cost.toFixed(4) };
}
const total = (runName) => {
  const r = run(runName);
  const calls = r.decisions.reduce((s, d) => s + d.llm.length, 0);
  const cost = r.decisions.reduce((s, d) => s + d.llm.reduce((a, l) => a + (l.platformCost ?? 0), 0), 0);
  const heard = new Set(r.events.filter((e) => (e.type === "deliver" || e.type === "seed") && e.target).map((e) => e.target));
  return { reach: heard.size, calls, cost: +cost.toFixed(4) };
};
// Molly's first belief in the run (the thought card's confidence bar)
const molly = run("stage-cafe").events.find((e) => e.type === "belief" && e.actor === "cafe");
// the live clip: residents reached and decisions so far, from its own log
const live = clipLog("live");
const liveAt = (t) => ({ t, reach: new Set(live.filter((e) => e.t <= t && (e.type === "deliver" || e.type === "seed") && (e.target || /Chief Harlow/.test(e.text))).map((e) => e.target ?? "police")).size + (live.some((e) => e.t <= t && e.type === "talk") ? 1 : 0), decisions: live.filter((e) => e.t <= t && e.type === "decide").length });

const out = {
  left: [10.5, 19.5, 24.6, 34.5].map((t) => at("stage-cafe", "hook", t)),
  right: [12.0, 19.0, 26.0, 88.5].map((t) => at("car-vendor", "contrast", t)),
  leftTotal: total("stage-cafe"), rightTotal: total("car-vendor"),
  mollyBelief: molly ? { to: molly.data.to, text: molly.zh } : null,
  live: [12.6, 30, 46, 61, 72].map(liveAt),
};
writeFileSync("src/promo-data.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
