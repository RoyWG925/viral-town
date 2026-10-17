"use client";

// 今晚的小目標: a Goose-style notepad of small goals. A goal is stamped only when an event that achieves it has
// already PLAYED on screen (the played prefix of the show), never from what the engine has computed ahead.
// Progress is a per-viewer convenience in localStorage; every access is wrapped so a private window just starts blank.
import { useEffect, useRef, useState } from "react";
import type { RunResult } from "../sim/engine.ts";
import { CHALLENGES, challengesHit, GOALS_STORAGE_KEY, mergeProgress, type ChallengeHit, type GoalProgress } from "../sim/challenges.ts";
import type { SimEvent } from "../sim/types.ts";
import { show } from "./director";
import { sting } from "./sfx";

export const VISIBLE = CHALLENGES.filter((c) => !c.hidden);
export const HIDDEN = CHALLENGES.filter((c) => c.hidden);
export const goalOf = (id: string) => CHALLENGES.find((c) => c.id === id);

/** Which ability could tick which visible goal (for the 🎯 on the whisper card). */
export const GOAL_BY_TOOL: Record<string, string> = { dispatch_police: "police", close_stage: "stage", publish_article: "article", inspect: "truth" };

function loadGoals(): GoalProgress {
  try {
    return JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function saveGoals(p: GoalProgress) {
  try {
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
}

const inPlayOrder = (evs: SimEvent[]) => [...evs].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));

/** The goals a finished run achieved (results card, newspaper). */
export function hitsOf(run: RunResult): ChallengeHit[] {
  return challengesHit(inPlayOrder(run.events), { seedNpc: run.config.seedNpc, seedText: run.config.seedText, active: run.config.active, claims: run.claims });
}

/**
 * Stamps goals live as the show plays. `on` is false for the dev rules path (never stamps); `recorded` marks
 * stamps earned by watching a 📼 replay.
 */
export function useGoalStamps(on: boolean, recorded: boolean) {
  const [progress, setProgress] = useState<GoalProgress>({});
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef({ loads: -1, ids: new Set<string>() });
  useEffect(() => setProgress(loadGoals()), []);
  const run = show.run;
  const hits = on && run && show.status !== "idle" ? challengesHit(show.order.slice(0, show.i), { seedNpc: run.config.seedNpc, seedText: run.config.seedText, active: run.config.active, claims: run.claims }) : [];
  useEffect(() => {
    if (!hits.length) return;
    // a new story or a replay starts a fresh round of stamps
    if (seen.current.loads !== show.loads) seen.current = { loads: show.loads, ids: new Set() };
    const fresh = hits.filter((h) => !seen.current.ids.has(h.id));
    if (!fresh.length) return;
    for (const h of fresh) seen.current.ids.add(h.id);
    sting.stamp();
    setToast(fresh[0].id);
    setProgress((p) => {
      const next = mergeProgress(p, fresh, { at: new Date().toISOString(), ...(recorded ? { recorded: true } : {}) });
      if (next !== p) saveGoals(next);
      return next;
    });
  });
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  return { progress, toast };
}

/** The small chip, the unfolding note, and the stamp toast (top-right). */
export function GoalsNote({ progress, toast }: { progress: GoalProgress; toast: string | null }) {
  const [open, setOpen] = useState(false);
  const done = VISIBLE.filter((g) => progress[g.id]).length;
  const hiddenDone = HIDDEN.filter((g) => progress[g.id]);
  const t = toast ? goalOf(toast) : null;
  return (
    <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="pointer-events-auto rounded-full bg-[#fffaf0]/95 px-3 py-1 text-sm font-bold text-slate-700 shadow ring-1 ring-amber-200 hover:bg-white"
      >
        📝 <span className="max-sm:hidden">Tonight&apos;s goals </span>
        {done}/{VISIBLE.length}
      </button>
      {t && (
        <p key={t.id} className="animate-[fadein_0.3s_ease-out] rounded-full bg-orange-500 px-3 py-1 text-sm font-bold text-white shadow-lg">
          {t.icon} Done! {t.zh}
        </p>
      )}
      {open && (
        <div className="pointer-events-auto w-[min(88vw,290px)] -rotate-1 rounded-lg bg-[#fffaf0] p-3 text-left text-sm text-slate-700 shadow-lg ring-1 ring-amber-200">
          <p className="mb-1.5 text-xs font-bold text-amber-700">Tonight&apos;s goals (just for fun, no winning or losing)</p>
          <ul className="space-y-1">
            {VISIBLE.map((g) => {
              const p = progress[g.id];
              return (
                <li key={g.id} className="leading-snug">
                  <span className={p ? "text-slate-400 line-through decoration-orange-400 decoration-2" : ""}>
                    {p ? "✓" : "○"} {g.icon} {g.zh}
                  </span>
                  {p?.recorded && <span title="Seen in a 📼 recorded run" className="ml-1 text-xs">📼</span>}
                  {!p && <span className="block pl-5 text-[11px] text-slate-400">{g.hint}</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-amber-100 pt-1.5 text-xs text-slate-500">
            ??? {hiddenDone.length}/{HIDDEN.length}
            {hiddenDone.map((g) => (
              <span key={g.id} className="ml-1.5" title={g.zh}>
                {g.icon}
                {progress[g.id]?.recorded ? "📼" : ""}
              </span>
            ))}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">Only counts what really happened in town and has already played out on screen.</p>
        </div>
      )}
    </div>
  );
}
