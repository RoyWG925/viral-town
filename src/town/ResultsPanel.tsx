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

/** Up to three things that changed the town tonight, from the log: world changes first, then milestones that failed. */
function keyEventsOf(run: RunResult): { icon: string; text: string; t: number }[] {
  const rank = (e: RunResult["events"][number]) => {
    const d = e.data as Record<string, unknown>;
    if (e.type === "state") return d.key === "festival" ? 0 : d.key === "stage" ? 1 : d.key === "police" ? 2 : 4;
    return { article: 3, gather: 3, statement: 5, notice: 6, milestone: 7 }[e.type as string] ?? 99;
  };
  const icon: Record<string, string> = { article: "📰", gather: "✊", statement: "📣", notice: "📋" };
  const picked = run.events
    .filter((e) => (e.type === "state" && e.data.key !== "writing") || ["article", "gather", "statement", "notice"].includes(e.type) || (e.type === "milestone" && e.data.status !== "ok"))
    .sort((a, b) => rank(a) - rank(b) || a.t - b.t)
    .slice(0, 3)
    .sort((a, b) => a.t - b.t);
  return picked.map((e) => {
    const d = e.data as Record<string, unknown>;
    const i = e.type === "state" ? (d.key === "stage" ? "🚧" : d.key === "police" ? "🚓" : d.key === "festival" ? "🏮" : "🔒") : e.type === "milestone" ? (d.status === "failed" ? "❌" : "↪️") : icon[e.type];
    const text = e.type === "milestone" ? `${String(d.zh)}: ${String(d.text)}` : e.zh;
    return { icon: i, text: text.length > 70 ? `${text.slice(0, 68)}…` : text, t: e.t };
  });
}

/** Who passed it to whom, in order of first hearing (the player first). */
function spreadOf(run: RunResult, seedNpc: string): string[] {
  const order = [seedNpc];
  for (const e of [...run.events].sort((a, b) => a.t - b.t)) {
    if ((e.type === "talk" || (e.type === "phone" && !e.data.missed)) && e.target && !order.includes(e.target)) order.push(e.target);
  }
  return order;
}

const STAMP: Record<string, { label: string; cls: string }> = {
  on: { label: "ON", cls: "border-emerald-600 text-emerald-700" },
  reduced: { label: "SCALED DOWN", cls: "border-amber-600 text-amber-700" },
  postponed: { label: "POSTPONED", cls: "border-rose-600 text-rose-700" },
  cancelled: { label: "CANCELLED", cls: "border-rose-800 text-rose-800" },
};

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
  const keyEvents = useMemo(() => keyEventsOf(run), [run]);
  const spread = useMemo(() => spreadOf(run, saved.npc), [run, saved.npc]);
  const [panel, setPanel] = useState<"none" | "again" | "details">("none");
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
    lines.push(story.festival.text);
    lines.push(`It reached ${m.reach} ${m.reach === 1 ? "resident" : "residents"}, ${m.depth} ${m.depth === 1 ? "hop" : "hops"} deep, with ${m.worldChanges} ${m.worldChanges === 1 ? "change" : "changes"} to the town. ${story.festival.text}`);
    if (stampWords.length) lines.push(`Goals stamped: ${stampWords.join(", ")}`);
    if (hl[0]) lines.push(hl[0]);
    lines.push("(Every resident is played by Gemma, judging only from what they know; the game engine checks every change to the town.)");
    return lines.join(String.fromCharCode(10));
  }, [saved, m, story, stampWords]);
  const nudge = nudgeOf(run, story, saved.npc, progress);
  // the one card line this story showed: it goes into the 鎮民筆記 (this browser only)
  useEffect(() => {
    if (story.reveal) addDiscovery(loadJournal(), story.reveal.npc, story.reveal.key, { at: run.wall.startedAt, recorded: !!recorded });
  }, [story, recorded, run]);
  const suggested = new Map(next.map((s) => [s.npc, s.why]));
  const stamp = STAMP[story.festival.kind] ?? STAMP.on;
  const variant = story.festival.text.replace(/^[^：:]*[：:]\s*/, "");

  return (
    // the town dims behind the paper; the finale's lanterns keep drifting up behind it
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[1px] animate-[fadein_0.5s_ease-out]">
      <article className="relative flex max-h-[94vh] w-[min(96vw,580px)] flex-col overflow-hidden rounded-2xl bg-[#fbf6ea] shadow-2xl ring-1 ring-black/10">
        <div className="overflow-y-auto px-6 pb-4 pt-4 max-sm:px-4">
          {/* masthead */}
          <div className="flex items-start justify-between gap-2 border-b-2 border-slate-900 pb-1.5">
            <div>
              <p className="font-serif text-[22px] font-black leading-none tracking-tight text-slate-900">The Mistport Gazette</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Lantern Festival special · 20:00{recorded ? <span title={recorded} className="ml-1.5 normal-case tracking-normal text-slate-400">📼 recorded real Gemma run</span> : null}
              </p>
            </div>
            <button onClick={onClose} aria-label="Back to town" title="Back to town" className="text-lg leading-none text-slate-400 hover:text-slate-800">✕</button>
          </div>

          {/* headline and the festival stamp */}
          <div className="relative mt-3 pr-24 max-sm:pr-0">
            <h2 className="font-serif text-[28px] font-black leading-[1.15] text-slate-900 max-sm:text-2xl">
              {story.icon} {story.headline}
            </h2>
            {story.sub && <p className="mt-1.5 text-sm leading-snug text-slate-600">{story.sub}</p>}
            <div title={story.festival.text} className={`absolute -right-1 top-0 grid h-[88px] w-[88px] rotate-[-12deg] place-items-center rounded-full border-[3px] bg-white/40 text-center max-sm:static max-sm:mt-2 max-sm:h-auto max-sm:w-auto max-sm:rotate-0 max-sm:rounded-lg max-sm:px-2 max-sm:py-1 ${stamp.cls}`}>
              <span className="text-[10px] font-black leading-tight tracking-wider">
                🏮 FESTIVAL
                <br />
                <span className="text-[13px]">{stamp.label}</span>
              </span>
            </div>
          </div>
          <p className="mt-2 text-sm font-semibold leading-snug text-slate-800">🏮 {variant}</p>

          {/* what happened, at a glance */}
          {keyEvents.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-300 pt-2">
              {keyEvents.map((k, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-700">
                  <span className="w-11 shrink-0 tabular-nums text-slate-400">{clockOf(k.t)}</span>
                  <span>{k.icon}</span>
                  <span>{k.text}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-slate-700">
            <span className="text-slate-500">You whispered to {nameOf(saved.npc)}:</span> <b>“{saved.text}”</b>
          </p>
          {story.whispers.map((w, i) => (
            <p key={i} className="text-[13px] text-slate-700">
              <span className="text-slate-500">Then to {nameOf(w.npc)}:</span> <b>“{w.text}”</b>
            </p>
          ))}
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-slate-600">
            <span>🗣️ You</span>
            {spread.slice(0, 6).map((n) => (
              <span key={n}>→ {ROLES[n]?.icon} {nameOf(n)}</span>
            ))}
            {spread.length > 6 && <span className="text-slate-400">+{spread.length - 6} more</span>}
          </p>
          {(stamps.length > 0 || story.reveal) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
              {stamps.map((h) => (
                <span key={h.id} title={h.evidence} className="rounded-full bg-orange-100 px-2 py-0.5 font-bold text-orange-800">
                  ✓ {goalOf(h.id)?.icon} {goalOf(h.id)?.zh}
                  {recorded ? " 📼" : ""}
                </span>
              ))}
              {story.reveal && (
                <span title="A reason this resident gave in their own words tonight" className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-800">
                  🔓 {nameOf(story.reveal.npc)}: {story.reveal.label}
                </span>
              )}
            </div>
          )}
          {onRetry && story.icon === "⚠️" && (
            <button onClick={onRetry} className="mt-3 w-full rounded-xl bg-slate-200 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-300">
              ⟲ The model did not answer this time — <b>try the same sentence again</b>
            </button>
          )}

          {/* three ways on */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button onClick={() => setPanel(panel === "again" ? "none" : "again")} className={`rounded-xl py-2 text-sm font-bold shadow ${panel === "again" ? "bg-orange-600 text-white" : "bg-orange-500 text-white hover:bg-orange-600"}`}>
              ▶ Play again
            </button>
            <button onClick={() => setPanel(panel === "details" ? "none" : "details")} className={`rounded-xl py-2 text-sm font-semibold ${panel === "details" ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-800 hover:bg-slate-300"}`}>
              {panel === "details" ? "▴ Details" : "▾ Details"}
            </button>
            <button
              onClick={() => navigator.clipboard?.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {})}
              className="rounded-xl bg-slate-200 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-300"
            >
              {copied ? "✓ Copied" : "📋 Share"}
            </button>
          </div>

          {panel === "again" && (
            <div className="mt-3 rounded-xl bg-white/70 p-3 ring-1 ring-slate-200">
              {nudge && (
                <button onClick={() => onWhatIf(nudge.npc, saved.text)} className="mb-2 w-full rounded-xl bg-amber-50 px-3 py-2 text-left text-sm leading-snug text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">
                  {nudge.tryIt ? "🎯" : "📌"} {nudge.text} → <b>tell {nameOf(nudge.npc)} the same thing?</b>
                </button>
              )}
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Same sentence, someone else →</p>
              <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-3">
                {run.config.active.filter((n) => ROLES[n]).map((n) => {
                  const why = suggested.get(n);
                  const self = n === saved.npc;
                  return (
                    <button
                      key={n}
                      onClick={() => onWhatIf(n, self ? null : saved.text)}
                      title={self ? "Say something else to the same person" : why ? `Try: ${why}` : ROLES[n].tag}
                      className={`relative flex flex-col items-center rounded-xl px-1 py-1.5 text-center ${why ? "bg-orange-100 ring-2 ring-orange-400" : "bg-orange-50/70 hover:bg-orange-100"}`}
                    >
                      {why && <span className="absolute -right-1 -top-1.5 rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white">try</span>}
                      <span className="text-xl leading-none">{ROLES[n].icon}</span>
                      <span className="mt-0.5 text-xs font-bold text-orange-900">{self ? "New line" : nameOf(n)}</span>
                      <span className="w-full truncate text-[10px] text-slate-500">{self ? nameOf(n) : ROLES[n].short}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 text-xs font-semibold text-slate-500">
                <button onClick={onReplay} className="hover:text-slate-800">⟲ Watch it again</button>
                <button onClick={() => downloadShareCard(story, saved.npc, saved.text, stats, stampWords)} className="hover:text-slate-800">🗞️ Download the front page</button>
              </div>
            </div>
          )}

          {panel === "details" && (
            <div className="mt-3 space-y-3">
              <StoryCardView card={story} seedNpc={saved.npc} seedText={saved.text} hideHeadline hideClosest={!!nudge && !nudge.tryIt} />
              {previous && prevStory && (
                <div className="rounded-xl bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900" title="Same world and engine seed; Gemma's answers still vary from run to run">
                  <p>Last time ({nameOf(previous.npc)}): {prevStory.icon} {prevStory.headline}</p>
                  <p>This time ({nameOf(saved.npc)}): {story.icon} {story.headline}</p>
                </div>
              )}
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
              <details>
                <summary className="cursor-pointer text-xs text-slate-400">🎬 Behind the scenes (model calls, latency, cost)</summary>
                <div className="mt-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
                  <p>Gemma-4-31B-IT on AMD Token Factory: {m.llmCalls} calls, {m.llmSeconds} s of inference, {m.tokens} tokens, platform-reported cost US${m.platformCost}</p>
                  <p>{m.decisions} resident decisions; the validator asked for {m.validatorRetries} rewrites; {m.fallbacks} safe fallbacks; {m.rejected} actions refused by the engine</p>
                  <p>Simulated in {(run.wall.ms / 1000).toFixed(0)} s; {m.gameMinutes} minutes of story time; ended: {run.ended.reason}</p>
                  <p className="mt-1">Reach {m.reach} · depth {m.depth} · {m.worldChanges} changes to the town · festival {festival}</p>
                  <TechDecisions decisions={run.decisions} />
                </div>
              </details>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

/** The punchline for older logs without a festival scene: what this sentence led to, big on screen for a moment. */
export function EndTitle({ run, stamps }: { run: RunResult; stamps: ChallengeHit[] }) {
  const card = useMemo(() => storyOf(run), [run]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[16%] flex justify-center px-4">
      <div className="max-w-xl animate-[fadein_0.5s_ease-out] rounded-3xl bg-white/92 px-7 py-5 text-center shadow-2xl backdrop-blur">
        <p className="text-xs font-bold tracking-widest text-orange-500">The Mistport Gazette · Special</p>
        <p className="mt-1 text-2xl font-extrabold leading-snug text-slate-900">
          {card.icon} {card.headline}
        </p>
        {card.sub && <p className="mt-1 text-sm text-slate-600">{card.sub}</p>}
        {card.festival.kind !== "on" && <p className="mt-2 text-sm font-bold text-rose-700">🏮 {card.festival.text}</p>}
        {stamps.length > 0 && <p className="mt-2 text-sm font-bold text-orange-600">{stamps.map((h) => goalOf(h.id)?.icon).join(" ")} {stamps.length} stamp{stamps.length > 1 ? "s" : ""}</p>}
      </div>
    </div>
  );
}
