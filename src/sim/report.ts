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
      lines.push(`[${clockOf(e.t)}] 🧠 ${run.minds[d.npc] ? d.npc : ""} ${o.feeling}｜理解：${o.understanding}`);
      lines.push(`         想：${o.thought}`);
      o.claims.forEach((c, i) => {
        const s = o.stances.find((x) => x.claim === i);
        lines.push(`         說法#${i} [${c.topic}/${c.says}] ${c.statement} → ${s ? `${s.verdict} ${s.confidence}` : "無立場"}${s ? `（${s.why}）` : ""}`);
      });
      lines.push(`         做：${o.actions.map((a) => `${a.type}${a.target ? `→${a.target}` : ""}${a.place ? `@${a.place}` : ""}${a.message ? `「${a.message}」` : ""}`).join("；")}${d.fallback ? "（驗證失敗，改用預設）" : ""}${d.validation.length > 1 ? `（重試 ${d.validation.length - 1} 次）` : ""}`);
      continue;
    }
    lines.push(`[${clockOf(e.t)}] ${e.type === "rejected" ? "⛔ " : ""}${e.zh}`);
  }
  return lines.join("\n");
}
