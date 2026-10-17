"use client";

// The VIRAL loop on screen: pick a resident → plant one sentence → real Gemma simulation →
// watch it play out in town → results, causal chain, What If.
// The chrome stays light: a clock pill, the cast, the small goals, and ONE line saying what is happening now.
import { useEffect, useMemo, useRef, useState } from "react";
import { readinessOf } from "../sim/readiness.ts";
import { simulate, type RunResult } from "../sim/engine.ts";
import { remoteChat } from "../sim/remoteChat.ts";
import type { DecisionRecord, SimEvent } from "../sim/types.ts";
import { agentFor, load, nameOf, reset as resetShow, show, update } from "./director";
import { ui } from "./ui";
import { fx } from "./fx";
import { flyTo } from "./camera";
import { storyOf, suggestNext } from "./story";
import { unlockAudio } from "./sfx";
import ClockPill from "./ClockPill";
import RoleCard from "./RoleCard";
import CastStrip from "./CastStrip";
import { AgendaChip, DailyLine, NowLine } from "./NowLine";
import { PlayPill, Timeline } from "./PlayPill";
import { EndTitle, Results, type SavedRun } from "./ResultsPanel";
import { GOAL_BY_TOOL, GoalsNote, goalOf, hitsOf, useGoalStamps } from "./GoalsNote";
import WhisperAgain, { type LullOffer } from "./WhisperAgain";

export type { SavedRun };
type Phase = "explore" | "compose" | "simulating" | "playing" | "results";
type Mode = "stream" | "full";
type Policy = "gemma" | "rules";
type Whisper = { npc: string; text: string } | null;

const ALL_RESIDENTS = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
// the full town: Experiment C (v1.7) showed deeper chains and real world changes with all eight residents
const DEFAULT_ACTIVE = ALL_RESIDENTS;
let ACTIVE = [...DEFAULT_ACTIVE];
const HISTORY_KEY = "viral.history.v1";
// after the first whisper the "how to play" hint gives its place to the town's everyday ticker
const WHISPERED_KEY = "viral.whispered.v1";

function loadHistory(): SavedRun[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveHistory(list: SavedRun[]) {
  for (let n = list.length; n > 0; n--) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, n)));
      return;
    } catch {
      /* storage full: keep fewer */
    }
  }
}
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage unavailable: the hint just comes back next visit */
  }
}

/** Polls the director/ui/everyday-scene stores (they live outside React). */
function useStoreVersion() {
  const [, setV] = useState("");
  useEffect(() => {
    let last = "";
    const id = setInterval(() => {
      const v = `${show.version}:${ui.version}:${fx.version}`;
      if (v !== last) {
        last = v;
        setV(v);
      }
    }, 120);
    return () => clearInterval(id);
  }, []);
}

interface RecordedEntry { id: string; npc: string; text: string; at: string }

/** 📼: the player's own experiments and the recorded real Gemma runs — inputs only, never how they ended. */
function RecordsPopover({ recorded, history, onRecorded, onHistory }: { recorded: RecordedEntry[]; history: SavedRun[]; onRecorded: (id: string) => void; onHistory: (h: SavedRun) => void }) {
  return (
    <div className="pointer-events-auto max-h-[50vh] w-[min(94vw,460px)] overflow-y-auto rounded-2xl bg-white/95 p-3 shadow-xl">
      {history.length > 0 && (
        <>
          <p className="mb-1 text-xs font-semibold text-slate-500">Your runs</p>
          {history.slice(0, 4).map((h) => (
            <button key={h.id} onClick={() => onHistory(h)} className="block w-full truncate rounded-lg px-2 py-1 text-left text-sm text-slate-700 hover:bg-orange-50">
              ⟲ To {nameOf(h.npc)}: “{h.text}”
            </button>
          ))}
        </>
      )}
      {recorded.length > 0 && (
        <>
          <p className={`mb-1 text-xs font-semibold text-slate-500 ${history.length ? "mt-2" : ""}`}>Recorded real Gemma runs (replays of the log, no new model calls)</p>
          {recorded.map((r) => (
            <button key={r.id} onClick={() => onRecorded(r.id)} className="block w-full truncate rounded-lg px-2 py-1 text-left text-sm text-slate-700 hover:bg-orange-50">
              📼 To {nameOf(r.npc)}: “{r.text}”
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export default function GameUI({ onPhase }: { onPhase?: (p: Phase) => void }) {
  useStoreVersion();
  const [phase, setPhase] = useState<Phase>("explore");
  const [text, setText] = useState("");
  const [progress, setProgress] = useState({ decisions: 0, events: 0, calls: 0, started: 0, error: "" });
  const [current, setCurrent] = useState<SavedRun | null>(null);
  const [history, setHistory] = useState<SavedRun[]>([]);
  const [mode] = useState<Mode>("stream");
  const [recorded, setRecorded] = useState<RecordedEntry[]>([]);
  const [showRecords, setShowRecords] = useState(false);
  /** set while a 📼 replay plays: when it was recorded (the honesty note's tooltip) */
  const [replayOf, setReplayOf] = useState<string | null>(null);
  const [whispered, setWhispered] = useState(true);
  const [lull, setLull] = useState<LullOffer | null>(null);
  const lullAnswer = useRef<((w: Whisper) => void) | null>(null);
  const lastStart = useRef<{ npc: string; text: string; policy: Policy; from?: SavedRun } | null>(null);
  /** the experiment a What If was started from (also a 📼 recording, which is not in the history) */
  const [whatIfFrom, setWhatIfFrom] = useState<SavedRun | null>(null);
  // what is on screen: the dev rules path never stamps goals; a 📼 replay stamps with a 📼 mark
  const [source, setSource] = useState<"gemma" | "rules" | "recorded">("gemma");
  /** bumped whenever the story on screen changes (leave, a new whisper, a replay): an older live run sees it and stops */
  const runSeq = useRef(0);
  const selected = ui.selected;
  const { progress: goals, toast } = useGoalStamps(source !== "rules", source === "recorded");

  useEffect(() => {
    ui.setActive(ACTIVE);
    setHistory(loadHistory());
    setWhispered(readFlag(WHISPERED_KEY));
    fetch("/recorded/index.json").then((r) => (r.ok ? r.json() : [])).then(setRecorded).catch(() => setRecorded([]));
    // leaving the page never leaves the engine waiting on a 補一句 answer
    return () => lullAnswer.current?.(null);
  }, []);
  useEffect(() => onPhase?.(phase), [phase, onPhase]);

  /** The engine found a lull: offer 補一句 and wait for the answer (null = let the story fade). */
  const offerLull = (info: LullOffer) =>
    new Promise<Whisper>((resolve) => {
      // the engine stops waiting after 3 minutes: withdraw the offer just before, so no answer goes nowhere
      const expire = setTimeout(() => lullAnswer.current?.(null), 170_000);
      lullAnswer.current = (w) => {
        clearTimeout(expire);
        lullAnswer.current = null;
        setLull(null);
        resolve(w);
      };
      setLull(info);
    });
  const dropLull = () => lullAnswer.current?.(null);

  async function playRecorded(id: string) {
    const r = await fetch(`/recorded/${id}.json`);
    if (!r.ok) return;
    const run = (await r.json()) as RunResult;
    const entry = recorded.find((x) => x.id === id);
    runSeq.current++;
    dropLull();
    ACTIVE = run.config.active;
    ui.setActive(ACTIVE);
    ui.select(null);
    setShowRecords(false);
    setReplayOf(entry ? `Played out by Gemma for real on ${new Date(entry.at).toLocaleString("en-US")}; this replay makes no new model calls` : "This replay makes no new model calls");
    setSource("recorded");
    setCurrent({ id: `rec-${id}`, npc: run.config.seedNpc, text: run.config.seedText, at: entry?.at ?? "", seed: run.config.seed ?? 1, run: { ...run, whispers: run.whispers ?? [] } });
    load(run, false);
    setPhase("playing");
  }
  function playHistory(h: SavedRun) {
    unlockAudio();
    runSeq.current++;
    dropLull();
    setShowRecords(false);
    setReplayOf(null);
    setSource("gemma");
    setCurrent(h);
    ui.select(null);
    load(h.run, false);
    setPhase("playing");
  }
  /** Back to the quiet town: release the story, the camera and any pending offer. */
  function leave() {
    dropLull();
    runSeq.current++;
    resetShow();
    setReplayOf(null);
    setProgress((p) => ({ ...p, error: "" }));
    ACTIVE = [...DEFAULT_ACTIVE];
    ui.setActive(ACTIVE);
    ui.select(null);
    setPhase("explore");
  }
  // Dev-only: play the same flow with the rule policy (for testing playback; not Gemma output).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __viralRules: (npc: string, text: string, all?: boolean) => void }).__viralRules = (npc, t, all) => {
      ACTIVE = all ? ALL_RESIDENTS : ACTIVE;
      ui.setActive(ACTIVE);
      start(npc, t, "rules");
    };
  });
  useEffect(() => {
    if (selected && phase === "explore") setPhase("compose");
  }, [selected, phase]);
  // frame the chosen resident right of centre, clear of the card docked bottom-left
  useEffect(() => {
    if (phase !== "compose" || !selected) return;
    const a = agentFor(selected);
    if (a) flyTo(a.x, a.z, 34, 6);
  }, [selected, phase]);
  // the end title holds a moment (the punchline), then the results slide in; keyed on the state itself so the
  // overlay's frequent re-renders (story, cast, everyday ticker) do not keep restarting the wait
  const ended = phase === "playing" && show.status === "done" && !show.growing && !!current;
  useEffect(() => {
    if (!ended) return;
    const id = setTimeout(() => setPhase("results"), 4200);
    return () => clearTimeout(id);
  }, [ended]);

  async function start(npc: string, sentence: string, policy: Policy = "gemma", from?: SavedRun) {
    dropLull();
    setReplayOf(null);
    setShowRecords(false);
    if (!ui.active.has(npc)) {
      setProgress((p) => ({ ...p, error: "This resident isn't part of this run" }));
      return;
    }
    lastStart.current = { npc, text: sentence, policy, from };
    setWhatIfFrom(from ?? null);
    // the sentence is planted: the next card starts empty (What If and retry keep their own copy)
    setText("");
    if (!whispered) {
      setWhispered(true);
      setFlag(WHISPERED_KEY);
    }
    // What If keeps the same world and engine seed, so only the listener or the sentence changes
    const seed = from?.seed ?? Math.floor(Math.random() * 1e6);
    const mine = ++runSeq.current;
    const stale = () => runSeq.current !== mine;
    const t0 = Date.now();
    setProgress({ decisions: 0, events: 0, calls: 0, started: t0, error: "" });
    setCurrent(null);
    setSource(policy);
    setPhase("simulating");
    const events: SimEvent[] = [];
    const decisions: DecisionRecord[] = [];
    let frontier = 0;
    let playing = false;
    const partial = (): RunResult => ({
      config: { active: ACTIVE, seedNpc: npc, seedText: sentence }, events: [...events], decisions: [...decisions], claims: [],
      world: { festival: "scheduled", shops: {}, stage: "open", police: { deployed: false, place: null }, notices: [], articles: [], gatherings: {}, statements: [] },
      minds: Object.fromEntries(ACTIVE.map((id) => [id, { place: id, beliefs: [], learned: [], memory: [] }])), ended: { reason: "quiet", t: 0 },
      wall: { startedAt: new Date(t0).toISOString(), ms: Date.now() - t0 },
      llm: { calls: 0, attempts: 0, promptTokens: 0, completionTokens: 0, platformCost: 0, estCost: 0, errors: 0, fallbacks: 0 },
      whispers: [],
    });
    const thinking = new Set<string>();
    const kick = () => {
      // a story the player has left keeps computing in the background: it must not take the town back
      if (mode !== "stream" || stale()) return;
      show.thinking = thinking;
      // start the show as soon as the thought exists; residents visibly think while Gemma works
      if (!playing && events.length) {
        playing = true;
        ui.select(null);
        load(partial(), true);
        setPhase("playing");
      } else if (playing) update(partial(), false, frontier);
    };
    // 補一句 is offered once at a lull; ?whisper2=0 turns the experiment off
    const allowLull = !/[?&]whisper2=0\b/.test(window.location.search);
    try {
      const run = await simulate({
        active: ACTIVE, seedNpc: npc, seedText: sentence, seed, policy, chat: policy === "gemma" ? remoteChat : undefined,
        // P1 playtests: 5 of 6 long stories hit a 16-decision cap right before the climax (e.g. 老周 about to act)
        // 7 each; 11 (and 3 past the shared 22) for whoever has seen a hidden problem first-hand
        maxDecisions: 22, maxPerNpc: 7, maxPerNpcFinding: 11, findingReserve: 3,
        // Experiment D: deeper and rated more interesting, with no added forced drama (lab/LAB_NOTES.md)
        variant: "eager",
        onLull: allowLull ? (info) => (stale() ? Promise.resolve(null) : offerLull(info)) : undefined,
        shouldStop: stale,
        onEvent: (e) => {
          events.push(e);
          setProgress((p) => ({ ...p, events: events.length }));
        },
        onDecision: (d) => {
          decisions.push(d);
          thinking.delete(d.npc);
          setProgress((p) => ({ ...p, decisions: decisions.length, calls: p.calls + d.llm.length }));
          kick();
        },
        onFrontier: (t) => {
          frontier = t;
          kick();
        },
        onThinking: (who) => {
          thinking.add(who);
          kick();
        },
        // the streamed first reaction (a feeling and a gesture) — shown on the thinker, changes nothing in the world
        onEarly: (who, x) => {
          show.early[who] = x;
        },
      });
      if (stale()) return;
      const saved: SavedRun = { id: `${Date.now()}`, npc, text: sentence, at: new Date().toISOString(), seed, run, parent: from?.id };
      setCurrent(saved);
      if (policy === "gemma") {
        // only real model runs go into the player's history; rule runs are dev tests
        const list = [saved, ...history].slice(0, 8);
        setHistory(list);
        saveHistory(list);
      }
      if (playing) update(run, true);
      else {
        ui.select(null);
        load(run, false);
        setPhase("playing");
      }
    } catch (e) {
      if (stale()) return;
      setProgress((p) => ({ ...p, error: String(e) }));
      if (playing) {
        // stop waiting for events that will never come, and say so on screen
        update(partial(), true);
        show.captions.push({ key: Date.now(), who: "", icon: "⚠️", tone: "system", text: "The simulation stopped: the model service isn't answering. What already happened plays as it was.", at: show.clock });
        show.version++;
      }
    }
  }
  const retry = () => {
    const s = lastStart.current;
    if (s) start(s.npc, s.text, s.policy, s.from);
  };

  // the 補一句 box suggests from what this story has reached so far (the log only)
  const lullSuggestions = useMemo(() => (lull && show.run ? suggestNext(show.run, storyOf(show.run)) : []), [lull]);
  const caughtUp = show.i >= show.order.length || show.stalled;
  const runStamps = useMemo(() => (current && source !== "rules" ? hitsOf(current.run) : []), [current, source]);
  const goalTools = Object.fromEntries(Object.entries(GOAL_BY_TOOL).filter(([, g]) => !goals[g]).map(([tool, g]) => [tool, goalOf(g)?.zh ?? g]));
  const storyHour = 15 + show.gameT / 60;
  // the festival's trouble so far, from what has PLAYED (the meters stay hidden; only what broke is named)
  const played = show.i;
  const trouble = useMemo(() => {
    if (phase !== "playing" || !show.run) return null;
    const o = readinessOf(show.order.slice(0, played), show.run.claims ?? []).outcome;
    return o.kind === "on" ? null : o.missing.join(", ");
  }, [phase, played]);

  return (
    <div data-phase={phase} className="pointer-events-none absolute inset-0">
      {/* top bar: the clock (explore draws its own with the drawer), the cast, the small goals */}
      {phase === "playing" && (
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1">
          <ClockPill hour={storyHour} story trouble={trouble} />
          {replayOf && (
            <span title={replayOf} className="pointer-events-auto rounded-full bg-slate-800/75 px-2.5 py-0.5 text-[11px] text-white shadow">
              📼 A real Gemma run, recorded (no new model calls)
            </span>
          )}
        </div>
      )}
      {phase !== "results" && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <CastStrip phase={phase} />
        </div>
      )}
      {phase !== "results" && <GoalsNote progress={goals} toast={toast} />}

      {phase === "explore" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-3">
          {showRecords && <RecordsPopover recorded={recorded} history={history} onRecorded={(id) => { unlockAudio(); playRecorded(id); }} onHistory={playHistory} />}
          <div className="flex items-center gap-2">
            {whispered ? <DailyLine /> : <div className="rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-slate-700 shadow">👆 Tap a resident with a name tag, whisper one sentence, and watch how the town reacts</div>}
            {(recorded.length > 0 || history.length > 0) && (
              <button onClick={() => setShowRecords((v) => !v)} aria-expanded={showRecords} className="pointer-events-auto rounded-full bg-slate-800/80 px-3 py-1.5 text-sm font-semibold text-white shadow">
                📼 Recorded runs
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "compose" && selected && (
        <RoleCard
          npc={selected}
          text={text}
          setText={setText}
          goalTools={goalTools}
          onClose={() => {
            ui.select(null);
            setPhase("explore");
          }}
          onPlant={() => {
            unlockAudio();
            start(selected, text.trim());
          }}
        />
      )}

      {(phase === "simulating" || phase === "playing") && (
        <NowLine
          phase={phase}
          seedNpc={lastStart.current?.npc ?? current?.npc ?? null}
          error={progress.error}
          startedAt={progress.started}
          onRetry={retry}
          onLeave={leave}
          onResults={current && !show.growing ? () => setPhase("results") : null}
        />
      )}
      {phase === "playing" && (lull && caughtUp ? <WhisperAgain key={lull.t} suggestions={lullSuggestions} onAnswer={(w) => lullAnswer.current?.(w)} /> : <AgendaChip />)}
      {phase === "playing" && <PlayPill onLeave={leave} />}
      {phase === "playing" && <Timeline />}
      {phase === "playing" && show.title && show.clock < show.title.until && (
        <div key={show.title.text} className="pointer-events-none absolute inset-x-0 top-[10%] flex justify-center">
          <p className="animate-[fadein_0.4s_ease-out] rounded-full bg-slate-900/75 px-5 py-1.5 text-base font-extrabold tracking-wide text-white shadow-xl">{show.title.text}</p>
        </div>
      )}
      {phase === "playing" && show.status === "done" && !show.growing && show.run && current && <EndTitle run={show.run} stamps={runStamps} />}
      {phase === "results" && current && (
        <Results
          saved={current}
          stamps={runStamps}
          recorded={source === "recorded" ? replayOf : null}
          progress={goals}
          onClose={leave}
          onRetry={source === "gemma" ? () => start(current.npc, current.text, "gemma") : undefined}
          onReplay={() => {
            unlockAudio();
            load(current.run, false);
            setPhase("playing");
          }}
          previous={!current.parent ? null : whatIfFrom?.id === current.parent ? whatIfFrom : (history.find((h) => h.id === current.parent) ?? null)}
          onWhatIf={(npc, sentence) => {
            unlockAudio();
            if (sentence) start(npc, sentence, "gemma", current);
            else {
              setText("");
              resetShow();
              ui.select(npc);
              setPhase("compose");
            }
          }}
        />
      )}
    </div>
  );
}
