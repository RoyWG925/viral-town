"use client";

// ONE line near the bottom that always says what is happening now. It replaces the stacked caption cards, the
// meanwhile pill, the stall timer and the simulating card. In explore it is the town's everyday ticker instead.
import { useEffect, useState, type ReactNode } from "react";
import type { SimEvent } from "../sim/types.ts";
import { articleOf } from "../sim/article.ts";
import { clip, listOf, nameOf, placeName, show, type Caption } from "./director";
import { fx } from "./fx";
import { ui } from "./ui";
import { flyTo } from "./camera";
import { upcomingMeeting } from "./agenda";

type Tone = Caption["tone"] | "dim";
const TONE: Record<Tone, string> = {
  seed: "bg-violet-600/90 text-white",
  thought: "bg-white/95 text-slate-800",
  speech: "bg-amber-50/95 text-slate-900",
  world: "bg-slate-800/85 text-white",
  system: "bg-slate-200/95 text-slate-700",
  dim: "bg-slate-900/55 text-white/85",
};

/** Re-render every second while something counts seconds. */
function useSeconds(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

/**
 * A short present-tense line for the last event that played (never belief numbers). Words and thoughts are already
 * over people's heads, so this line names the action instead of repeating them.
 */
function lineOf(e: SimEvent): { icon: string; text: string } | null {
  const d = e.data as Record<string, unknown>;
  const a = e.actor ? nameOf(e.actor) : "";
  const b = e.target ? nameOf(e.target) : "";
  switch (e.type) {
    case "seed":
      return { icon: "💭", text: d.second ? `You whispered one more line to ${b}` : `A thought slips into ${b}'s head` };
    case "move":
      return { icon: "🚶", text: e.zh };
    case "meet":
      return { icon: "🕔", text: e.zh };
    case "talk":
      return { icon: "💬", text: `${a} talks to ${b} face to face` };
    case "phone":
      return { icon: "📞", text: d.missed ? `${a} calls ${b}. No answer.` : `${a} is on the phone with ${b}` };
    case "look":
    case "inspect":
      // the start of a check, or its result (the short highlight, as over the finder's head)
      if (d.found) return { icon: "🔍", text: `${a} ${e.type === "inspect" ? "finds" : "sees"}: ${clip(String(d.highlight ?? d.found), 44)}` };
      return { icon: "🔍", text: `${a} ${e.type === "inspect" ? "is inspecting" : "is looking around"} ${e.place ? placeName(e.place) : ""}`.trimEnd() };
    case "state":
      return d.key === "writing" ? { icon: "✍️", text: `${a} is writing it up` } : { icon: "✨", text: clip(e.zh, 68) };
    case "article":
      return { icon: "📰", text: clip(`${a} published “${articleOf(d).headline}”`, 68) };
    case "notice":
    case "statement":
    case "gather":
      return { icon: { notice: "📋", article: "📰", statement: "📣", gather: "✊" }[e.type], text: clip(e.zh, 68) };
    default:
      return null;
  }
}

/** `id` keys the fade-in: a line that only updates its seconds counter must not fade in again every second. */
function Line({ tone, icon, text, full, id, children }: { tone: Tone; icon: string; text: string; full?: string; id?: string; children?: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center px-3 max-sm:bottom-16">
      <div key={id ?? text} className={`pointer-events-auto flex max-w-[min(92vw,640px)] animate-[fadein_0.25s_ease-out] items-center gap-2 rounded-full px-4 py-1.5 text-[15px] leading-snug shadow-md backdrop-blur-sm ${TONE[tone]}`}>
        <span className="shrink-0">{icon}</span>
        <span className="line-clamp-2" title={full ?? text}>
          {text}
        </span>
        {children}
      </div>
    </div>
  );
}

const btn = "shrink-0 rounded-full px-3 py-0.5 text-sm font-bold";

export function NowLine({ phase, seedNpc, error, onRetry, onLeave, onResults, startedAt }: {
  phase: "simulating" | "playing";
  seedNpc: string | null;
  error: string;
  onRetry: () => void;
  onLeave: () => void;
  /** null while results are not available (no finished run to show) */
  onResults: (() => void) | null;
  startedAt: number;
}) {
  useSeconds(phase === "simulating" || show.stalled);
  // 1. the system failed: say so, and offer the way out
  if (error)
    return (
      <Line tone="system" icon="⚠️" text={phase === "playing" ? "The simulation stopped: the model service isn't answering. What already happened plays as it was." : "The simulation stopped: the model service isn't answering."} full={error}>
        <button onClick={onRetry} className={`${btn} bg-orange-500 text-white`}>Try again</button>
        <button onClick={onLeave} className={`${btn} bg-white text-slate-700`}>Back to town</button>
      </Line>
    );
  if (phase === "simulating") {
    const s = Math.round((Date.now() - startedAt) / 1000);
    return <Line tone="system" icon="🧠" id="simulating" text={`Gemma is thinking for ${seedNpc ? nameOf(seedNpc) : "the resident"}… (${s}s)${s > 40 ? " The model service is slow; retrying" : ""}`} full="Each resident judges only from what they know; a decision happens in town only after it passes validation." />;
  }
  const results = onResults ? <button onClick={onResults} className={`${btn} bg-orange-500 text-white`}>See results</button> : null;
  if (show.status === "done" && !show.growing) return <Line tone="world" icon="🏁" text="The story is over">{results ?? null}</Line>;
  // 2. a fresh line that is not already over someone's head
  // (a find is already over the finder's head as its highlight: the full description of the place adds nothing)
  const overHead = (c: Caption) => c.bubbled || c.tone === "speech" || c.tone === "thought" || (c.icon === "🔍" && show.says.some((s) => s.npc === c.who && s.kind === "found"));
  const fresh = show.captions.filter((c) => show.clock - c.at < 5 && !(ui.follow && overHead(c))).at(-1);
  if (fresh) {
    const text = c2t(fresh);
    return <Line tone={fresh.tone} icon={fresh.icon} text={clip(text, 150)} full={text}>{results}</Line>;
  }
  // 3. waiting for the model: who, and for how long (real seconds)
  if (show.stalled && show.thinking.size) {
    const since = Math.min(...[...show.thinking].map((n) => show.thinkingSince[n] ?? Date.now()));
    const s = Math.max(0, Math.round((Date.now() - since) / 1000));
    const who = listOf([...show.thinking].map(nameOf));
    return <Line tone="dim" icon="💭" id={`stall:${[...show.thinking].join()}`} text={`${who} ${show.thinking.size > 1 ? "are" : "is"} thinking… (Gemma, ${s}s${s > 45 ? "; the model service is busy, retrying" : ""})`}>{results}</Line>;
  }
  // 4. the camera is glancing around town meanwhile
  if (show.meanwhile) return <Line tone="dim" icon="👀" text={`Meanwhile, ${show.meanwhile.label}…`}>{results}</Line>;
  // 5. the last thing that played, dimmed
  const last = show.order.slice(0, show.i).map(lineOf).filter(Boolean).at(-1);
  if (last) return <Line tone="dim" icon={last.icon} text={last.text}>{results}</Line>;
  return null;
}

const c2t = (c: Caption) => (c.sub ? `${c.sub}: ${c.text}` : c.text);

/** Explore: the everyday ticker (scenes the town is playing right now). Tap to look. Never the AI's colours. */
export function DailyLine() {
  const scene = [...fx.scenes].sort((a, b) => b.since - a.since)[0];
  if (!scene) return null;
  return (
    <button
      onClick={() => flyTo(scene.at.x, scene.at.z, 22)}
      title="Tap to take a look"
      className="pointer-events-auto flex max-w-[min(92vw,520px)] animate-[fadein_0.25s_ease-out] items-center gap-2 rounded-full bg-[#f4efe6]/92 px-3 py-1.5 text-sm text-stone-700 shadow ring-1 ring-stone-300/70 backdrop-blur-sm hover:bg-[#fbf7f0]"
    >
      <span className="shrink-0 rounded-full bg-stone-500/15 px-1.5 text-[10px] font-bold text-stone-500">Everyday life</span>
      <span className="truncate">{scene.label}</span>
    </button>
  );
}

/** "Bomb under the table": a routine meeting is coming up and one of the pair is carrying something into it. */
export function AgendaChip() {
  const next = upcomingMeeting(show.run, show.order.slice(0, show.i), show.gameT);
  if (!next || show.status === "done") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[84px] flex justify-center px-3">
      <p className="animate-[fadein_0.3s_ease-out] rounded-full bg-amber-100/95 px-3 py-1 text-sm font-semibold text-amber-900 shadow ring-1 ring-amber-300">
        ⏰ In {next.minutes} min, as planned: {next.text}
      </p>
    </div>
  );
}
