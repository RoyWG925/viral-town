// Human-readable story of a run, in game-time order. Used by the lab CLI and the results screen.
import type { RunResult } from "./engine.ts";
import { clockOf } from "./view.ts";

const SHOW = new Set(["seed", "decide", "belief", "talk", "phone", "look", "inspect", "state", "notice", "article", "statement", "gather", "rejected", "end", "deliver"]);

export function story(run: RunResult, opts: { beliefs?: boolean; deliveries?: boolean } = {}): string {
  const lines: string[] = [];
  const events = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const dec = new Map(run.decisions.map((d) => [d.id, d]));
  for (const e of events) {
    if (!SHOW.has(e.type)) continue;
    if (e.type === "belief" && !opts.beliefs) continue;
    if (e.type === "deliver" && !opts.deliveries) continue;
    if (e.type === "decide") {
      const d = dec.get(String(e.data.decision));
      const o = d?.output;
      if (!o) {
        lines.push(`[${clockOf(e.t)}] ${e.zh}`);
        continue;
      }
      lines.push(`[${clockOf(e.t)}] 🧠 ${run.minds[d.npc] ? d.npc : ""} ${o.feeling} | understood: ${o.understanding}`);
      lines.push(`         thinks: ${o.thought}`);
      o.claims.forEach((c, i) => {
        const s = o.stances.find((x) => x.claim === i);
        lines.push(`         claim#${i} [${c.topic}/${c.says}] ${c.statement} → ${s ? `${s.verdict} ${s.confidence}` : "no stance"}${s ? ` (${s.why})` : ""}`);
      });
      lines.push(`         does: ${o.actions.map((a) => `${a.type}${a.target ? `→${a.target}` : ""}${a.place ? `@${a.place}` : ""}${a.message ? ` “${a.message}”` : ""}`).join("; ")}${d.fallback ? " (validation failed, used the default)" : ""}${d.validation.length > 1 ? ` (retried ${d.validation.length - 1} ${d.validation.length - 1 === 1 ? "time" : "times"})` : ""}`);
      continue;
    }
    lines.push(`[${clockOf(e.t)}] ${e.type === "rejected" ? "⛔ " : ""}${e.zh}`);
  }
  return lines.join("\n");
}
