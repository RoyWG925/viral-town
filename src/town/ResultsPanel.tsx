"use client";

// Results that hand you the next experiment: the headline first and largest, what you said, the small goals this
// story stamped, at most one "差一點" What If, and the cast as a grid of tools to try next. Everything is retold
// from the log; the full chain and the tech log sit one tap away.
import { useEffect, useMemo, useState } from "react";
import { addDiscovery, knownLines, loadJournal } from "./journal";
import type { RunResult } from "../sim/engine.ts";
import { measure, type Metrics } from "../sim/metrics.ts";
import type { ChallengeHit, GoalProgress } from "../sim/challenges.ts";
import type { DecisionRecord } from "../sim/types.ts";
import { clockOf } from "../sim/view.ts";
import { nameOf, placeName } from "./director";
import { revealOf, storyOf, suggestNext, type StoryCard } from "./story";
import StoryCardView from "./StoryCardView";
import { downloadShareCard, drawShareCard } from "./shareCard";
import { canDo, ROLES, toolsOf } from "./roles";
import { GOAL_BY_TOOL, goalOf, VISIBLE } from "./GoalsNote";

export interface SavedRun {
  id: string;
  npc: string;
  text: string;
  at: string;
  seed: number;
  run: RunResult;
  /** the experiment this one is a What If of */
  parent?: string;
}

const pct = (c?: number) => (c === undefined ? "" : `${Math.round(c * 100)}%`);
const VERDICT: Record<string, string> = { believe: "believes", doubt: "not sure", disbelieve: "doesn't believe" };

interface ChainStep { t: number; icon: string; text: string; sub?: string }

function chainOf(run: RunResult): ChainStep[] {
  const dec = new Map(run.decisions.map((d) => [d.id, d]));
  const steps: ChainStep[] = [];
  const evs = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const e of evs) {
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case "seed":
        steps.push({ t: e.t, icon: "💭", text: d.second ? `You whispered one more line to ${nameOf(e.target!)}: “${String(d.text)}”` : `You told ${nameOf(e.target!)}: “${String(d.text)}”` });
        break;
      case "decide": {
        const o = dec.get(String(d.decision))?.output;
        if (!o || d.budget) break;
        const st = o.stances.map((s) => VERDICT[s.verdict] ?? s.verdict).join(", ");
        steps.push({ t: e.t, icon: [...o.feeling][0] ?? "🤔", text: `${nameOf(e.actor!)}: ${o.thought}`, sub: `${o.understanding}${st ? ` (${st})` : ""}` });
        break;
      }
      case "talk":
        steps.push({ t: e.t, icon: "💬", text: `${nameOf(e.actor!)} → ${nameOf(e.target!)}: “${String(d.text)}”` });
        break;
      case "phone":
        if (!d.missed) steps.push({ t: e.t, icon: "📞", text: `${nameOf(e.actor!)} calls ${nameOf(e.target!)}: “${String(d.text)}”` });
        break;
      case "look":
      case "inspect":
        if (d.found) steps.push({ t: e.t, icon: "🔍", text: `At ${placeName(e.place!)}, ${nameOf(e.actor!)} sees: ${String(d.found)}` });
        break;
      case "state":
        if (d.key !== "writing") steps.push({ t: e.t, icon: "✨", text: e.zh });
        break;
      case "notice":
      case "article":
      case "statement":
      case "gather":
        steps.push({ t: e.t, icon: { notice: "📋", article: "📰", statement: "📣", gather: "✊" }[e.type], text: e.zh });
        break;
      case "end":
        steps.push({ t: e.t, icon: "🏁", text: String(e.zh) });
        break;
    }
  }
  return steps;
}

/**
 * What someone found, minus the routine parts (the dove cages, the lanterns' labels, who else was standing there).
 * The engine joins its sentences with a space: old Chinese logs split on the space, English ones after a full stop.
 */
function foundWithoutClutter(found: string) {
  const zh = /[\u4E00-\u9FFF]/.test(found);
  const parts = zh ? found.split(" ") : found.split(/(?<=[.!?])\s+/);
  const clutter = zh ? /鴿籠|燈籠上|在這裡/ : /\bcages?\b|\blabels?\b|\b(?:is|are) (?:already )?here\b/i;
  return parts.filter((x) => !clutter.test(x)).join(" ") || found;
}

function highlights(run: RunResult, m: Metrics): string[] {
  const out: string[] = [];
  const first = run.claims[0];
  const drifted = run.claims.filter((c) => first && c.topic !== first.topic);
  if (first && drifted.length) out.push(`It started out as “${first.statement}”, and as it got passed around it turned into “${drifted[drifted.length - 1].statement}”.`);
  // retellings by people who had not checked anything themselves: how far the words drifted
  const checked = new Set(run.events.filter((e) => (e.type === "look" || e.type === "inspect") && e.data.found).map((e) => e.actor));
  const far = m.retellings.filter((r) => !checked.has(r.from)).reduce((acc, r) => (r.similarity < (acc?.similarity ?? 1) ? r : acc), undefined as Metrics["retellings"][number] | undefined);
  if (far && far.similarity < 0.35) out.push(`By the time ${nameOf(far.from)} passed it on to ${nameOf(far.to)}, it had become: “${far.text}”`);
  // what people found when they went to see: once per person, expert checks first
  const seenBy = new Set<string>();
  for (const e of [...run.events].sort((a, b) => (a.type === "inspect" ? -1 : 0) - (b.type === "inspect" ? -1 : 0))) {
    if ((e.type !== "look" && e.type !== "inspect") || !e.data.found || seenBy.has(e.actor!)) continue;
    seenBy.add(e.actor!);
    out.push(`${nameOf(e.actor!)} ${e.type === "inspect" ? "inspected closely and found" : "went to see firsthand"}: ${foundWithoutClutter(String(e.data.found))}`);
  }
  for (const d of run.decisions) {
    const o = d.output;
    const no = o?.stances.find((s) => s.verdict === "disbelieve");
    if (o && no) out.push(`${nameOf(d.npc)} doesn't buy it: “${no.why}”`);
  }
  if (run.world.festival === "cancelled") out.push("In the end, the Lantern Festival really was cancelled.");
  if (m.idle) {
    // say who stopped it and in their own (recorded) words why, instead of a generic line
    const last = [...run.decisions].reverse().find((d) => d.output);
    const why = last && !last.fallback ? last.output?.actions.find((a) => a.type === "none")?.why : undefined;
    out.push(last && why && why !== "fallback" && !why.startsWith("free-form:") ? `The thought stopped with ${nameOf(last.npc)}: “${why}” To spread it, try telling someone who would care about it.` : "The thought didn't get very far. Sometimes the town just doesn't buy it.");
  }
  return out.slice(0, 6);
}

function TechDecisions({ decisions }: { decisions: DecisionRecord[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {decisions.map((d) => (
        <li key={d.id}>
          {d.id} {nameOf(d.npc)} @{clockOf(d.t)} — {d.llm.map((l) => `${(l.latencyMs / 1000).toFixed(1)}s/${l.promptTokens + l.completionTokens}tok`).join(", ") || "rules"}
          {d.validation.length > 1 ? `; rewrites: ${d.validation.slice(0, -1).map((v) => v.errors.join("; ")).join(" | ").slice(0, 270)}` : ""}
          {d.fallback ? " (safe default)" : ""}
        </li>
      ))}
    </ul>
  );
}

/** At most one amber nudge: a logged near miss, a logged refusal, or (failing both) a tool for an unfinished goal. */
function nudgeOf(run: RunResult, story: StoryCard, seedNpc: string, progress: GoalProgress): { npc: string; text: string; tryIt?: boolean } | null {
  const c = story.closest;
  if (c && c.npc !== seedNpc) return { npc: c.npc, text: `So close: ${nameOf(c.npc)} heard it${c.conf !== undefined ? ` (${pct(c.conf)} sure)` : ""} and could ${c.could}` };
  const refusal = run.events.filter((e) => e.type === "rejected" && e.data.wanted && e.actor && e.actor !== seedNpc).at(-1);
  if (refusal?.actor) return { npc: refusal.actor, text: `So close: ${refusal.zh}` };
  for (const g of VISIBLE) {
    if (progress[g.id]) continue;
    const tool = Object.keys(GOAL_BY_TOOL).find((k) => GOAL_BY_TOOL[k] === g.id);
    const who = run.config.active.find((n) => n !== seedNpc && toolsOf(n).some((t) => t.kind === tool));
    if (tool && who) return { npc: who, text: `Try: ${nameOf(who)} ${canDo(toolsOf(who).find((t) => t.kind === tool)!.label)} (${g.icon} ${g.zh})`, tryIt: true };
  }
  return null;
}

export function Results({ saved, previous, stamps, recorded, progress, onWhatIf, onReplay, onClose, onRetry }: {
  saved: SavedRun;
  previous: SavedRun | null;
  /** the small goals this story achieved */
  stamps: ChallengeHit[];
  /** a 📼 replay (no model calls this time) */
  recorded: string | null;
  progress: GoalProgress;
  onWhatIf: (npc: string, text: string | null) => void;
  onReplay: () => void;
  onClose: () => void;
  /** the same sentence to the same resident again (offered when the model stopped answering) */
  onRetry?: () => void;
}) {
  const run = saved.run;
  const m = useMemo(() => measure(run), [run]);
  const chain = useMemo(() => chainOf(run), [run]);
  const hl = useMemo(() => highlights(run, m), [run, m]);
  const baseStory = useMemo(() => storyOf(run), [run]);
  // the card line to reveal: one this browser's 鎮民筆記 does not have yet, when the story offers a choice
  const story = useMemo(() => ({ ...baseStory, reveal: revealOf(run.events, knownLines(loadJournal())) }), [baseStory, run]);
  const next = useMemo(() => suggestNext(run, story), [run, story]);
  const prevStory = useMemo(() => (previous ? storyOf(previous.run) : null), [previous]);
  const [min, setMin] = useState(false);
  const [copied, setCopied] = useState(false);
  const festival = story.festival.short;
  const stats = { reach: story.reached.length, depth: m.depth, world: m.worldChanges, festival };
  const stampWords = useMemo(() => stamps.map((h) => `${goalOf(h.id)?.icon ?? ""} ${goalOf(h.id)?.zh ?? h.id}`), [stamps]);
  // dev-only: lets the automated playthrough save the share card it would download
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __shareCard?: () => string }).__shareCard = () => drawShareCard(story, saved.npc, saved.text, stats, stampWords).toDataURL("image/png");
  });
  const shareText = useMemo(() => {
    const lines = [`In VIRAL, I whispered one line to ${nameOf(saved.npc)} in Mistport: “${saved.text}”`];
    for (const w of story.whispers) lines.push(`Then one more line to ${nameOf(w.npc)}: “${w.text}”`);
    lines.push(`What happened: ${story.icon} ${story.headline}`);
    lines.push(`It reached ${m.reach} ${m.reach === 1 ? "resident" : "residents"}, ${m.depth} ${m.depth === 1 ? "hop" : "hops"} deep, with ${m.worldChanges} ${m.worldChanges === 1 ? "change" : "changes"} to the town. ${story.festival.text}`);
    if (stampWords.length) lines.push(`Goals stamped: ${stampWords.join(", ")}`);
    if (hl[0]) lines.push(hl[0]);
    lines.push("(Every resident is played by Gemma, judging only from what they know; the game engine checks every change to the town.)");
    return lines.join(String.fromCharCode(10));
  }, [saved, m, run, hl, story, stampWords]);
  const nudge = nudgeOf(run, story, saved.npc, progress);
  // the one card line this story showed: it goes into the 鎮民筆記 (this browser only)
  useEffect(() => {
    if (story.reveal) addDiscovery(loadJournal(), story.reveal.npc, story.reveal.key, { at: run.wall.startedAt, recorded: !!recorded });
  }, [story, recorded, run]);
  const suggested = new Map(next.map((s) => [s.npc, s.why]));

  return (
    <div className={`pointer-events-auto absolute right-3 top-3 flex w-[min(94vw,400px)] flex-col overflow-hidden rounded-3xl bg-white/95 shadow-2xl backdrop-blur max-sm:inset-x-2 ${min ? "" : "bottom-3 max-sm:top-auto max-sm:max-h-[72vh]"}`}>
      <div className="border-b border-slate-200 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold tracking-wide text-orange-500">The Mistport Gazette · Tonight&apos;s headline{recorded ? <span title={recorded} className="ml-1.5 font-semibold text-slate-400">📼 Recorded real run</span> : null}</p>
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <button onClick={() => setMin((v) => !v)} className="text-slate-400 hover:text-slate-700">{min ? "▴ Expand" : "▾ Collapse"}</button>
            <button onClick={onClose} aria-label="Back to town" title="Back to town" className="text-base text-slate-400 hover:text-slate-700">✕</button>
          </div>
        </div>
        <h2 className="mt-1 text-xl font-extrabold leading-snug text-slate-900">
          {story.icon} {story.headline}
        </h2>
        {!min && (
          <>
            {story.sub && <p className="mt-1 text-sm leading-snug text-slate-600">{story.sub}</p>}
            <p className="mt-2 text-sm text-slate-700">
              You told {nameOf(saved.npc)}: <b>“{saved.text}”</b>
            </p>
            {story.whispers.map((w, i) => (
              <p key={i} className="text-sm text-slate-700">
                Then one more line to {nameOf(w.npc)}: <b>“{w.text}”</b>
              </p>
            ))}
            {stamps.length > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-xl bg-orange-50 px-3 py-1.5 ring-1 ring-orange-200">
                {stamps.map((h) => (
                  // one line per stamp: the goal, then the logged line that ticked it
                  <li key={h.id} className="truncate text-xs" title={h.evidence}>
                    <b className="text-orange-800">
                      ✓ {goalOf(h.id)?.icon} {goalOf(h.id)?.zh}
                      {recorded ? <span title="Seen in a 📼 recorded run"> 📼</span> : null}
                    </b>
                    <span className="text-slate-500"> · {h.evidence}</span>
                  </li>
                ))}
              </ul>
            )}
            {story.festival.kind !== "on" && (
              <p className="mt-2 rounded-xl bg-rose-50 px-3 py-1.5 text-xs leading-snug text-rose-900 ring-1 ring-rose-200" title="Worked out from what happened tonight: the stage, supplies, money, the town's mood… if any one of them gives way, the festival suffers">
                🏮 <b>{story.festival.text}</b>
              </p>
            )}
            {story.reveal && (
              <p className="mt-2 rounded-xl bg-violet-50 px-3 py-1.5 text-xs leading-snug text-violet-900 ring-1 ring-violet-200" title="The reason this resident gave for acting, in this story">
                🔓 You found out: <b>{nameOf(story.reveal.npc)}&apos;s {story.reveal.label}</b> — {story.reveal.text}
              </p>
            )}
            {onRetry && story.icon === "⚠️" && (
              <button onClick={onRetry} className="mt-2 w-full rounded-xl bg-slate-100 px-3 py-2 text-left text-sm leading-snug text-slate-800 ring-1 ring-slate-300 hover:bg-slate-200">
                ⟲ The model didn&apos;t answer just now: <b>try the same line again</b>
              </button>
            )}
            {nudge && (
              <button onClick={() => onWhatIf(nudge.npc, saved.text)} className="mt-2 w-full rounded-xl bg-amber-50 px-3 py-2 text-left text-sm leading-snug text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">
                {nudge.tryIt ? "🎯" : "📌"} {nudge.text} → <b>Tell {nameOf(nudge.npc)} the same line?</b>
              </button>
            )}
            {previous && prevStory && (
              <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900" title="Same world and same random seed; Gemma's answers still vary">
                <p>Last time (told {nameOf(previous.npc)}): {prevStory.icon} {prevStory.headline}</p>
                <p>This time (told {nameOf(saved.npc)}): {story.icon} {story.headline}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Reached {m.reach} {m.reach === 1 ? "person" : "people"} · {m.depth} {m.depth === 1 ? "hop" : "hops"} · {m.worldChanges} {m.worldChanges === 1 ? "change" : "changes"} to the town · festival: {festival}
            </p>
          </>
        )}
      </div>
      {!min && (
        <>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <StoryCardView card={story} seedNpc={saved.npc} seedText={saved.text} hideHeadline hideClosest={!!nudge && !nudge.tryIt} />
            <details>
              <summary className="mb-2 cursor-pointer text-xs font-semibold text-slate-500">Full chain of events ({chain.length} steps, every cause traceable)</summary>
              {hl.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  {hl.map((h, i) => (
                    <p key={i} className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900">✨ {h}</p>
                  ))}
                </div>
              )}
              <ol className="space-y-2">
                {chain.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-slate-400">{clockOf(s.t)}</span>
                    <span>{s.icon}</span>
                    <div>
                      <p className="text-slate-800">{s.text}</p>
                      {s.sub && <p className="text-xs text-slate-500">{s.sub}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </details>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-400">🔬 Behind the scenes</summary>
              <div className="mt-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
                <p>Gemma-4-31B-IT (AMD Token Factory): {m.llmCalls} calls, {m.llmSeconds}s of inference in total, {m.tokens} tokens, platform-reported cost US${m.platformCost}</p>
                <p>{m.decisions} resident decisions; the validator asked for {m.validatorRetries} rewrites; {m.fallbacks} fell back to the safe default; the engine rejected {m.rejected} actions</p>
                <p>The simulation took {(run.wall.ms / 1000).toFixed(0)}s; {m.gameMinutes} minutes of game time; ended because: {run.ended.reason}</p>
                <TechDecisions decisions={run.decisions} />
              </div>
            </details>
          </div>
          <div className="border-t border-slate-200 px-4 pb-3 pt-2.5">
            <p className="mb-1.5 text-xs font-semibold text-slate-500">Same line, different listener →</p>
            <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-3">
              {run.config.active.filter((n) => ROLES[n]).map((n) => {
                const why = suggested.get(n);
                const self = n === saved.npc;
                return (
                  <button
                    key={n}
                    onClick={() => onWhatIf(n, self ? null : saved.text)}
                    title={self ? "A different line for the same person" : why ? `Try: ${why}` : ROLES[n].tag}
                    className={`relative flex flex-col items-center rounded-xl px-1 py-1.5 text-center ${why ? "bg-orange-100 ring-2 ring-orange-400" : "bg-orange-50/70 hover:bg-orange-100"}`}
                  >
                    {why && <span className="absolute -right-1 -top-1.5 rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white">Try</span>}
                    <span className="text-xl leading-none">{ROLES[n].icon}</span>
                    <span className="mt-0.5 text-xs font-bold leading-tight text-orange-900">{self ? "New line" : `Tell ${nameOf(n)}`}</span>
                    <span className="w-full truncate text-[10px] text-slate-500">{self ? nameOf(n) : ROLES[n].short}</span>
                  </button>
                );
              })}
            </div>
            {next.length > 0 && <p className="mt-1.5 text-[11px] leading-snug text-slate-400">Try: {next.map((s) => `${nameOf(s.npc)} (${s.why})`).join("; ")}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
              <button onClick={onReplay} className="hover:text-slate-800">⟲ Watch again</button>
              <button
                onClick={() => navigator.clipboard?.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {})}
                className="hover:text-slate-800"
              >
                {copied ? "✓ Copied" : "📋 Copy share text"}
              </button>
              <button onClick={() => downloadShareCard(story, saved.npc, saved.text, stats, stampWords)} className="hover:text-slate-800">🗞️ Download the Gazette</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The punchline: what this sentence led to, from the log, big on screen for a moment. */
export function EndTitle({ run, stamps }: { run: RunResult; stamps: ChallengeHit[] }) {
  const card = useMemo(() => storyOf(run), [run]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[16%] flex justify-center px-4">
      <div className="max-w-xl animate-[fadein_0.5s_ease-out] rounded-3xl bg-white/92 px-7 py-5 text-center shadow-2xl backdrop-blur">
        <p className="text-xs font-bold tracking-widest text-orange-500">The Mistport Gazette · Special edition</p>
        <p className="mt-1 text-2xl font-extrabold leading-snug text-slate-900">
          {card.icon} {card.headline}
        </p>
        {card.sub && <p className="mt-1 text-sm text-slate-600">{card.sub}</p>}
        {card.festival.kind !== "on" && <p className="mt-2 text-sm font-bold text-rose-700">🏮 {card.festival.text}</p>}
        {stamps.length > 0 && <p className="mt-2 text-sm font-bold text-orange-600">{stamps.map((h) => goalOf(h.id)?.icon).join(" ")} {stamps.length} {stamps.length === 1 ? "goal" : "goals"} stamped</p>}
      </div>
    </div>
  );
}
