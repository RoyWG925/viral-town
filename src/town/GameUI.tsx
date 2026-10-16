"use client";

// The VIRAL loop on screen: pick a resident → plant one sentence → real Gemma simulation →
// watch it play out in town → results, causal chain, What If.
import { useEffect, useMemo, useRef, useState } from "react";
import { simulate, type RunResult } from "../sim/engine.ts";
import { measure, type Metrics } from "../sim/metrics.ts";
import { remoteChat } from "../sim/remoteChat.ts";
import { PERSONAS, PLACES, PUBLIC_BIO } from "../sim/scenario.ts";
import type { DecisionRecord, SimEvent } from "../sim/types.ts";
import { clockOf } from "../sim/view.ts";
import { load, nameOf, pause, reset as resetShow, restart, resume, setSpeed, show, update, type Caption } from "./director";
import { ui } from "./ui";
import { storyOf } from "./story";
import { isMuted, setMuted, unlockAudio } from "./sfx";
import StoryCardView from "./StoryCardView";
import { downloadShareCard } from "./shareCard";

type Phase = "explore" | "compose" | "simulating" | "playing" | "results";
type Mode = "stream" | "full";

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

const ALL_RESIDENTS = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
// the full town: Experiment C (v1.7) showed deeper chains and real world changes with all eight residents
const DEFAULT_ACTIVE = ALL_RESIDENTS;
let ACTIVE = [...DEFAULT_ACTIVE];
const HISTORY_KEY = "viral.history.v1";
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;

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

/** Polls the director/ui stores (they live outside React). */
function useStoreVersion() {
  const [, setV] = useState(0);
  useEffect(() => {
    let last = -1;
    const id = setInterval(() => {
      const v = show.version * 1000 + ui.version;
      if (v !== last) {
        last = v;
        setV(v);
      }
    }, 120);
    return () => clearInterval(id);
  }, []);
}

function CaptionBar() {
  // with the auto director on, speech and thoughts are shown in the town over people's heads
  // stale lines go away after a while; lines already shown over someone's head are not repeated
  const cs = show.captions.filter((c) => show.clock - c.at < 8 && (!ui.follow || (c.tone !== "speech" && c.tone !== "thought" && !c.bubbled))).slice(-2);
  if (!cs.length || show.status === "idle") return null;
  const tone: Record<Caption["tone"], string> = {
    seed: "bg-violet-600/90 text-white", thought: "bg-white/95 text-slate-800", speech: "bg-amber-50/95 text-slate-900",
    world: "bg-slate-800/90 text-white", system: "bg-slate-200/90 text-slate-600",
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex flex-col items-center gap-1.5 px-4">
      {cs.map((c, i) => (
        <div key={c.key} className={`max-w-2xl rounded-2xl px-4 py-2 shadow-lg transition-opacity ${tone[c.tone]} ${i < cs.length - 1 ? "scale-95 opacity-50" : ""}`}>
          <div className="flex items-start gap-2">
            <span className="text-xl leading-7">{c.icon}</span>
            <div>
              {c.sub && <p className="text-xs opacity-70">{c.sub}</p>}
              <p className={i === cs.length - 1 ? "text-base font-semibold leading-snug" : "text-sm"}>{c.text}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** How long the show has been waiting for Gemma, so a slow model never looks like a frozen game. */
function StallTimer() {
  const since = useRef(Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.round((Date.now() - since.current) / 1000);
  return <span className="text-xs tabular-nums text-slate-500">Gemma 推演中… {s} 秒{s > 45 ? "（模型服務忙碌，重試中）" : ""}</span>;
}

function Controls({ onResults }: { onResults: () => void }) {
  const total = show.order.length;
  const pct = total ? Math.round((show.i / total) * 100) : 0;
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-3 mx-auto flex w-[min(96%,720px)] items-center gap-2 rounded-2xl bg-white/90 px-3 py-2 shadow-lg backdrop-blur">
      <button onClick={() => (show.status === "playing" ? pause() : resume())} className="rounded-full bg-slate-800 px-3 py-1 text-sm font-semibold text-white">
        {show.status === "playing" ? "⏸ 暫停" : "▶ 播放"}
      </button>
      {[1, 2, 3].map((s) => (
        <button key={s} onClick={() => setSpeed(s)} className={`rounded-full px-2.5 py-1 text-sm font-semibold ${show.speed === s ? "bg-orange-500 text-white" : "bg-slate-200 text-slate-700"}`}>
          {s}×
        </button>
      ))}
      <button onClick={() => restart()} className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">⟲ 重播</button>
      <button onClick={() => { ui.follow = !ui.follow; ui.version++; }} className={`rounded-full px-3 py-1 text-sm font-semibold ${ui.follow ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-700"}`}>
        {ui.follow ? "🎬 自動導演" : "🎥 自由鏡頭"}
      </button>
      <button
        onClick={() => {
          unlockAudio();
          setMuted(!isMuted());
          ui.version++;
        }}
        title="音效"
        className="rounded-full bg-slate-200 px-2.5 py-1 text-sm"
      >
        {isMuted() ? "🔇" : "🔊"}
      </button>
      <div className="relative mx-2 h-2 flex-1 rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-orange-400 transition-all" style={{ width: `${pct}%` }} />
        {/* big moments on the timeline: world changes the engine confirmed */}
        {show.order.map((e, k) =>
          ["state", "notice", "article", "statement", "gather"].includes(e.type) && e.data.key !== "writing" ? (
            <span key={e.id} title={e.zh} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-500" style={{ left: `${(k / Math.max(1, total)) * 100}%` }} />
          ) : null,
        )}
      </div>
      <span className="w-14 text-right text-sm font-bold tabular-nums text-slate-700">{clockOf(show.gameT)}</span>
      {show.stalled && <StallTimer />}
      {(show.status === "done" || !show.growing) && (
        <button onClick={onResults} className="rounded-full bg-orange-500 px-3 py-1 text-sm font-semibold text-white">看結果</button>
      )}
    </div>
  );
}

interface ChainStep { t: number; icon: string; text: string; sub?: string; tone: string }

function chainOf(run: RunResult): ChainStep[] {
  const dec = new Map(run.decisions.map((d) => [d.id, d]));
  const steps: ChainStep[] = [];
  const evs = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const e of evs) {
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case "seed":
        steps.push({ t: e.t, icon: "💭", text: `你對${nameOf(e.target!)}說：「${String(d.text)}」`, tone: "seed" });
        break;
      case "decide": {
        const o = dec.get(String(d.decision))?.output;
        if (!o || d.budget) break;
        const st = o.stances.map((s) => `${s.verdict === "believe" ? "相信" : s.verdict === "doubt" ? "半信半疑" : "不相信"}`).join("、");
        steps.push({ t: e.t, icon: [...o.feeling][0] ?? "🤔", text: `${nameOf(e.actor!)}：${o.thought}`, sub: `${o.understanding}${st ? `（${st}）` : ""}`, tone: "thought" });
        break;
      }
      case "talk":
        steps.push({ t: e.t, icon: "💬", text: `${nameOf(e.actor!)} → ${nameOf(e.target!)}：「${String(d.text)}」`, tone: "speech" });
        break;
      case "phone":
        if (!d.missed) steps.push({ t: e.t, icon: "📞", text: `${nameOf(e.actor!)} 打給 ${nameOf(e.target!)}：「${String(d.text)}」`, tone: "speech" });
        break;
      case "look":
      case "inspect":
        if (d.found) steps.push({ t: e.t, icon: "🔍", text: `${nameOf(e.actor!)}在${placeZh(e.place!)}看到：${String(d.found)}`, tone: "world" });
        break;
      case "state":
        if (d.key !== "writing") steps.push({ t: e.t, icon: "✨", text: e.zh, tone: "world" });
        break;
      case "notice":
      case "article":
      case "statement":
      case "gather":
        steps.push({ t: e.t, icon: { notice: "📋", article: "📰", statement: "📣", gather: "✊" }[e.type], text: e.zh, tone: "world" });
        break;
      case "end":
        steps.push({ t: e.t, icon: "🏁", text: String(e.zh), tone: "system" });
        break;
    }
  }
  return steps;
}

function highlights(run: RunResult, m: Metrics): string[] {
  const out: string[] = [];
  const first = run.claims[0];
  const drifted = run.claims.filter((c) => first && c.topic !== first.topic);
  if (first && drifted.length) out.push(`原本的說法是「${first.statement}」，傳著傳著變成了「${drifted[drifted.length - 1].statement}」。`);
  // retellings by people who had not checked anything themselves: how far the words drifted
  const checked = new Set(run.events.filter((e) => (e.type === "look" || e.type === "inspect") && e.data.found).map((e) => e.actor));
  const far = m.retellings.filter((r) => !checked.has(r.from)).reduce((acc, r) => (r.similarity < (acc?.similarity ?? 1) ? r : acc), undefined as Metrics["retellings"][number] | undefined);
  if (far && far.similarity < 0.35) out.push(`${nameOf(far.from)}轉述給${nameOf(far.to)}時，話已經變成：「${far.text}」`);
  // what people found when they went to see: once per person, expert checks first
  const seenBy = new Set<string>();
  for (const e of [...run.events].sort((a, b) => (a.type === "inspect" ? -1 : 0) - (b.type === "inspect" ? -1 : 0))) {
    if ((e.type !== "look" && e.type !== "inspect") || !e.data.found || seenBy.has(e.actor!)) continue;
    seenBy.add(e.actor!);
    const found = String(e.data.found).split(" ").filter((x) => !/鴿籠|燈籠上|在這裡/.test(x)).join(" ") || String(e.data.found);
    out.push(`${nameOf(e.actor!)}${e.type === "inspect" ? "仔細檢查後發現" : "跑去親眼看"}：${found}`);
  }
  for (const d of run.decisions) {
    const o = d.output;
    const no = o?.stances.find((s) => s.verdict === "disbelieve");
    if (o && no) out.push(`${nameOf(d.npc)}不相信：「${no.why}」`);
  }
  if (run.world.festival === "cancelled") out.push("最後，燈籠節真的被取消了。");
  if (m.idle) {
    // say who stopped it and in their own (recorded) words why, instead of a generic line
    const last = [...run.decisions].reverse().find((d) => d.output);
    const why = last?.output?.actions.find((a) => a.type === "none")?.why;
    out.push(last && why ? `念頭停在${nameOf(last.npc)}這裡：「${why}」想讓它傳開，試試告訴一位會在乎這件事的人。` : "這個念頭沒有走得很遠——有時候，小鎮就是不買單。");
  }
  return out.slice(0, 6);
}

function summaryOf(run: RunResult) {
  const m = measure(run);
  return { reach: m.reach, depth: m.depth, world: m.worldChanges, festival: run.world.festival === "cancelled" ? "取消" : "照常" };
}

function Results({ saved, previous, onWhatIf, onReplay, onClose }: { saved: SavedRun; previous: SavedRun | null; onWhatIf: (npc: string, text: string | null) => void; onReplay: () => void; onClose: () => void }) {
  const run = saved.run;
  const m = useMemo(() => measure(run), [run]);
  const chain = useMemo(() => chainOf(run), [run]);
  const hl = useMemo(() => highlights(run, m), [run, m]);
  const story = useMemo(() => storyOf(run), [run]);
  const [tech, setTech] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareText = useMemo(() => {
    const lines = [`我在 VIRAL 霧港鎮對${nameOf(saved.npc)}說了一句：「${saved.text}」`, `結果：${story.icon} ${story.headline}`];
    lines.push(`結果傳到 ${m.reach} 位居民、${m.depth} 層、引發 ${m.worldChanges} 個世界變化，燈籠節${run.world.festival === "cancelled" ? "被取消了" : "照常舉行"}。`);
    if (hl[0]) lines.push(hl[0]);
    lines.push("（每位居民都由 Gemma 依自己知道的事判斷，世界由遊戲引擎驗證。）");
    return lines.join(String.fromCharCode(10));
  }, [saved, m, run, hl, story]);
  const reachedNames = [...new Set(run.events.filter((e) => e.type === "deliver" && e.target && e.data.via !== "inspection").map((e) => e.target!))];
  const farthest = run.events.filter((e) => e.type === "decide" && !e.data.budget).at(-1)?.actor;
  return (
    <div className="pointer-events-auto absolute inset-y-4 right-4 flex w-[min(94vw,460px)] flex-col overflow-hidden rounded-3xl bg-white/95 shadow-2xl backdrop-blur">
      <div className="border-b border-slate-200 p-5">
        <div className="flex items-start justify-between">
          <p className="text-xs font-semibold text-slate-500">你對 {nameOf(saved.npc)} 說</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <p className="mt-1 text-lg font-bold text-slate-800">「{saved.text}」</p>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            ["影響居民", `${m.reach}`],
            ["傳播層數", `${m.depth}`],
            ["世界變化", `${m.worldChanges}`],
            ["燈籠節", run.world.festival === "cancelled" ? "取消" : "照常"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-orange-50 py-2">
              <p className="text-lg font-extrabold text-orange-700">{v}</p>
              <p className="text-[11px] text-slate-500">{k}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          傳到：{reachedNames.map(nameOf).join("、") || "沒有人"}{farthest ? `；最後做出判斷的是${nameOf(farthest)}` : ""}
        </p>
        {previous && (() => {
          const a = summaryOf(previous.run);
          const b = summaryOf(run);
          return (
            <div className="mt-3 rounded-xl bg-sky-50 p-3 text-xs text-sky-900">
              <p className="font-semibold">What If 比較（同一個世界與隨機種子；Gemma 的回答本身仍有隨機性）</p>
              <p className="mt-1">上次：對{nameOf(previous.npc)}說「{previous.text}」→ 影響 {a.reach} 人、{a.depth} 層、{a.world} 個世界變化、燈籠節{a.festival}</p>
              <p>這次：對{nameOf(saved.npc)}說「{saved.text}」→ 影響 {b.reach} 人、{b.depth} 層、{b.world} 個世界變化、燈籠節{b.festival}</p>
            </div>
          );
        })()}
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <StoryCardView card={story} seedNpc={saved.npc} seedText={saved.text} />
        {hl.length > 0 && (
          <div className="mb-4 space-y-1.5">
            {hl.map((h, i) => (
              <p key={i} className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900">✨ {h}</p>
            ))}
          </div>
        )}
        <details>
        <summary className="mb-2 cursor-pointer text-xs font-semibold text-slate-500">完整事件因果鏈（{chain.length} 步，可追溯每一個原因）</summary>
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
        <button onClick={() => setTech((v) => !v)} className="mt-4 text-xs text-slate-400 underline">🔬 技術紀錄</button>
        {tech && (
          <div className="mt-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
            <p>Gemma-4-31B-IT（AMD Token Factory）呼叫 {m.llmCalls} 次，累計推論 {m.llmSeconds} 秒，{m.tokens} tokens，估算 ${m.estCost}</p>
            <p>居民判斷 {m.decisions} 次；驗證器要求重寫 {m.validatorRetries} 次；改用安全預設 {m.fallbacks} 次；引擎拒絕的行動 {m.rejected} 個</p>
            <p>模擬用時 {(run.wall.ms / 1000).toFixed(0)} 秒；遊戲時間 {m.gameMinutes} 分鐘；結束原因：{run.ended.reason}</p>
            <TechDecisions decisions={run.decisions} />
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 p-4">
        <p className="mb-2 text-xs font-semibold text-slate-500">What If：同一句話，換一個人說</p>
        <div className="flex flex-wrap gap-2">
          {ACTIVE.filter((n) => n !== saved.npc).map((n) => (
            <button key={n} onClick={() => onWhatIf(n, saved.text)} className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800 hover:bg-orange-200">
              告訴{nameOf(n)}
            </button>
          ))}
          <button onClick={() => onWhatIf(saved.npc, null)} className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">換一句話</button>
          <button onClick={onReplay} className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">⟲ 重看一次</button>
          <button
            onClick={() => navigator.clipboard?.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {})}
            className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-800 hover:bg-violet-200"
          >
            {copied ? "✓ 已複製" : "📋 複製分享文字"}
          </button>
          <button
            onClick={() => downloadShareCard(story, saved.npc, saved.text, { reach: story.reached.length, depth: m.depth, world: m.worldChanges, festival: run.world.festival === "cancelled" ? "取消" : "照常" })}
            className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-800 hover:bg-violet-200"
          >
            🗞️ 下載小報
          </button>
        </div>
      </div>
    </div>
  );
}

/** The punchline: what this sentence led to, from the log, big on screen for a moment. */
function EndTitle({ run }: { run: RunResult }) {
  const card = useMemo(() => storyOf(run), [run]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center px-4">
      <div className="max-w-xl animate-[fadein_0.5s_ease-out] rounded-3xl bg-white/92 px-7 py-5 text-center shadow-2xl backdrop-blur">
        <p className="text-xs font-bold tracking-widest text-orange-500">霧港小報 · 號外</p>
        <p className="mt-1 text-2xl font-extrabold leading-snug text-slate-900">
          {card.icon} {card.headline}
        </p>
        {card.sub && <p className="mt-1 text-sm text-slate-600">{card.sub}</p>}
      </div>
    </div>
  );
}

function TechDecisions({ decisions }: { decisions: DecisionRecord[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {decisions.map((d) => (
        <li key={d.id}>
          {d.id} {nameOf(d.npc)} @{clockOf(d.t)} — {d.llm.map((l) => `${(l.latencyMs / 1000).toFixed(1)}s/${l.promptTokens + l.completionTokens}tok`).join(", ") || "rules"}
          {d.validation.length > 1 ? `，重寫：${d.validation.slice(0, -1).map((v) => v.errors.join("；")).join(" | ").slice(0, 160)}` : ""}
          {d.fallback ? "（安全預設）" : ""}
        </li>
      ))}
    </ul>
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
  const [recorded, setRecorded] = useState<{ id: string; npc: string; text: string; at: string; reach: number; world: number; festival: string; calls: number }[]>([]);
  const [showRecorded, setShowRecorded] = useState(false);
  const [replayNote, setReplayNote] = useState<string | null>(null);
  const abort = useRef(false);
  const selected = ui.selected;

  useEffect(() => {
    ui.setActive(ACTIVE);
    setHistory(loadHistory());
    fetch("/recorded/index.json").then((r) => (r.ok ? r.json() : [])).then(setRecorded).catch(() => setRecorded([]));
  }, []);

  async function playRecorded(id: string) {
    const r = await fetch(`/recorded/${id}.json`);
    if (!r.ok) return;
    const run = (await r.json()) as RunResult;
    const entry = recorded.find((x) => x.id === id);
    ACTIVE = run.config.active;
    ui.setActive(ACTIVE);
    ui.select(null);
    setShowRecorded(false);
    setReplayNote(`📼 重播已錄製的真實模擬：${entry ? new Date(entry.at).toLocaleString("zh-TW") : ""} 由 Gemma 實際推演，這次不會重新呼叫模型。`);
    setCurrent({ id: `rec-${id}`, npc: run.config.seedNpc, text: run.config.seedText, at: entry?.at ?? "", seed: run.config.seed ?? 1, run });
    load(run, false);
    setPhase("playing");
  }
  useEffect(() => onPhase?.(phase), [phase, onPhase]);
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
  useEffect(() => {
    if (phase === "playing" && show.status === "done" && !show.growing) {
      // the end title holds a moment (the punchline), then the results slide in
      const id = setTimeout(() => setPhase("results"), 4200);
      return () => clearTimeout(id);
    }
  });

  async function start(npc: string, sentence: string, policy: "gemma" | "rules" = "gemma", from?: SavedRun) {
    setReplayNote(null);
    if (!ui.active.has(npc)) {
      setProgress((p) => ({ ...p, error: "這位居民不在這次的實驗裡" }));
      return;
    }
    // What If keeps the same world and engine seed, so only the listener or the sentence changes
    const seed = from?.seed ?? Math.floor(Math.random() * 1e6);
    abort.current = false;
    const t0 = Date.now();
    setProgress({ decisions: 0, events: 0, calls: 0, started: t0, error: "" });
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
    });
    const thinking = new Set<string>();
    const kick = () => {
      if (mode !== "stream") return;
      show.thinking = thinking;
      // start the show as soon as the thought exists; residents visibly think while Gemma works
      if (!playing && events.length) {
        playing = true;
        ui.select(null);
        load(partial(), true);
        setPhase("playing");
      } else if (playing) update(partial(), false, frontier);
    };
    try {
      const run = await simulate({
        active: ACTIVE, seedNpc: npc, seedText: sentence, seed, policy, chat: policy === "gemma" ? remoteChat : undefined,
        // P1 playtests: 5 of 6 long stories hit a 16-decision cap right before the climax (e.g. 老周 about to act)
        maxDecisions: 22, maxPerNpc: 5,
        // Experiment D: deeper and rated more interesting, with no added forced drama (lab/LAB_NOTES.md)
        variant: "eager",
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
      if (abort.current) return;
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
      setProgress((p) => ({ ...p, error: String(e) }));
      if (playing) {
        // stop waiting for events that will never come, and say so on screen
        update(partial(), true);
        show.captions.push({ key: Date.now(), who: "", icon: "⚠️", tone: "system", text: "模擬中斷了：模型服務沒有回應。已發生的部分照實播放。", at: show.clock });
        show.version++;
      }
    }
  }

  const persona = selected ? PERSONAS.find((p) => p.id === selected) : null;
  const bio = selected ? PUBLIC_BIO[selected] : null;
  const elapsed = progress.started ? Math.round((Date.now() - progress.started) / 1000) : 0;

  return (
    <div className="pointer-events-none absolute inset-0">
      {phase === "explore" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2">
          {showRecorded && recorded.length > 0 && (
            <div className="pointer-events-auto w-[min(94vw,520px)] rounded-2xl bg-white/95 p-3 shadow-xl">
              <p className="mb-1 text-xs font-semibold text-slate-500">已錄製的真實 Gemma 模擬（重播紀錄，不重新生成）</p>
              {recorded.map((r) => (
                <button key={r.id} onClick={() => { unlockAudio(); playRecorded(r.id); }} className="block w-full truncate rounded-lg px-2 py-1 text-left text-sm text-slate-700 hover:bg-orange-50">
                  📼 對{nameOf(r.npc)}說「{r.text}」— 影響 {r.reach} 人、{r.world} 個世界變化
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-700 shadow-lg">👆 點一位有名牌的居民，對他說一句話</div>
            {recorded.length > 0 && (
              <button onClick={() => setShowRecorded((v) => !v)} className="pointer-events-auto rounded-full bg-slate-800/85 px-4 py-2 text-sm font-semibold text-white shadow-lg">📼 錄製的實驗</button>
            )}
          </div>
        </div>
      )}
      {replayNote && (phase === "playing" || phase === "results") && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-800/85 px-4 py-1.5 text-xs text-white shadow">{replayNote}</div>
      )}

      {phase === "compose" && persona && bio && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(94vw,520px)] -translate-x-1/2 rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">{persona.roleZh}</p>
              <h2 className="text-xl font-extrabold text-slate-800">{persona.name}</h2>
            </div>
            <button onClick={() => { ui.select(null); setPhase("explore"); }} className="text-slate-400 hover:text-slate-700">✕</button>
          </div>
          <p className="mt-1 text-sm text-slate-600">{bio.bio}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 80))}
            placeholder={`對${persona.name}說一句話……`}
            className="mt-3 h-20 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-base text-slate-800 outline-none focus:border-orange-400"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bio.examples.map((ex) => (
              <button key={ex} onClick={() => setText(ex)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200">{ex}</button>
            ))}
          </div>
          <button
            disabled={!text.trim()}
            onClick={() => {
              unlockAudio();
              start(persona.id, text.trim());
            }}
            className="mt-3 w-full rounded-2xl bg-orange-500 py-2.5 text-base font-bold text-white shadow disabled:opacity-40"
          >
            植入這個念頭
          </button>
          {history.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <p className="text-xs font-semibold text-slate-400">之前的實驗</p>
              {history.slice(0, 4).map((h) => (
                <button key={h.id} onClick={() => { setCurrent(h); ui.select(null); load(h.run, false); setPhase("playing"); }} className="block w-full truncate text-left text-xs text-slate-500 hover:text-slate-800">
                  ⟲ 對{nameOf(h.npc)}說「{h.text}」— {h.run.world.festival === "cancelled" ? "燈籠節取消" : `傳到 ${new Set(h.run.events.filter((e) => e.type === "deliver").map((e) => e.target)).size} 人`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "simulating" && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(94vw,460px)] -translate-x-1/2 rounded-3xl bg-white/95 p-5 text-center shadow-2xl">
          <p className="text-3xl">🧠</p>
          <p className="mt-1 text-base font-bold text-slate-800">Gemma 正在推演居民的反應…</p>
          <p className="mt-1 text-sm text-slate-500">每位居民只根據自己知道的事判斷；判斷通過驗證後才會發生在鎮上。</p>
          <p className="mt-3 text-sm tabular-nums text-slate-700">已完成 {progress.decisions} 個居民判斷 · {progress.calls} 次模型呼叫 · {elapsed} 秒</p>
          {progress.error && <p className="mt-2 text-sm text-red-600">模擬失敗：{progress.error}</p>}
          {elapsed > 40 && progress.decisions === 0 && !progress.error && <p className="mt-2 text-xs text-amber-700">模型服務目前回應很慢，正在重試…</p>}
        </div>
      )}

      {(phase === "playing" || phase === "results") && <CaptionBar />}
      {phase === "playing" && <Controls onResults={() => setPhase("results")} />}
      {phase === "playing" && show.meanwhile && (
        <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-slate-900/70 px-4 py-1.5 text-xs text-white shadow">
          同一時間，{show.meanwhile.label}…（{[...show.thinking].map(nameOf).join("、") || "居民"}還在想）
        </div>
      )}
      {phase === "playing" && show.status === "done" && !show.growing && show.run && <EndTitle run={show.run} />}
      {phase === "results" && current && (
        <Results
          saved={current}
          onClose={() => {
            // leave the story: release residents and the camera, back to the default cast
            resetShow();
            setReplayNote(null);
            ACTIVE = [...DEFAULT_ACTIVE];
            ui.setActive(ACTIVE);
            setPhase("explore");
          }}
          onReplay={() => { load(current.run, false); setPhase("playing"); }}
          previous={current.parent ? history.find((h) => h.id === current.parent) ?? null : null}
          onWhatIf={(npc, sentence) => {
            if (sentence) start(npc, sentence, "gemma", current);
            else {
              setText("");
              ui.select(npc);
              setPhase("compose");
            }
          }}
        />
      )}
    </div>
  );
}
