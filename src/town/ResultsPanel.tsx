"use client";

// Results that hand you the next experiment: the headline first and largest, what you said, the small goals this
// story stamped, at most one "差一點" What If, and the cast as a grid of tools to try next. Everything is retold
// from the log; the full chain and the tech log sit one tap away.
import { useEffect, useMemo, useState } from "react";
import { addDiscovery, knownLines, loadJournal } from "./journal";
import type { RunResult } from "../sim/engine.ts";
import { measure, type Metrics } from "../sim/metrics.ts";
import { PLACES } from "../sim/scenario.ts";
import type { ChallengeHit, GoalProgress } from "../sim/challenges.ts";
import type { DecisionRecord } from "../sim/types.ts";
import { clockOf } from "../sim/view.ts";
import { nameOf } from "./director";
import { revealOf, storyOf, suggestNext, type StoryCard } from "./story";
import StoryCardView from "./StoryCardView";
import { downloadShareCard, drawShareCard } from "./shareCard";
import { ROLES, toolsOf } from "./roles";
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

const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;
const pct = (c?: number) => (c === undefined ? "" : `${Math.round(c * 100)}%`);

interface ChainStep { t: number; icon: string; text: string; sub?: string }

function chainOf(run: RunResult): ChainStep[] {
  const dec = new Map(run.decisions.map((d) => [d.id, d]));
  const steps: ChainStep[] = [];
  const evs = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const e of evs) {
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case "seed":
        steps.push({ t: e.t, icon: "💭", text: d.second ? `你又對${nameOf(e.target!)}補了一句：「${String(d.text)}」` : `你對${nameOf(e.target!)}說：「${String(d.text)}」` });
        break;
      case "decide": {
        const o = dec.get(String(d.decision))?.output;
        if (!o || d.budget) break;
        const st = o.stances.map((s) => `${s.verdict === "believe" ? "相信" : s.verdict === "doubt" ? "半信半疑" : "不相信"}`).join("、");
        steps.push({ t: e.t, icon: [...o.feeling][0] ?? "🤔", text: `${nameOf(e.actor!)}：${o.thought}`, sub: `${o.understanding}${st ? `（${st}）` : ""}` });
        break;
      }
      case "talk":
        steps.push({ t: e.t, icon: "💬", text: `${nameOf(e.actor!)} → ${nameOf(e.target!)}：「${String(d.text)}」` });
        break;
      case "phone":
        if (!d.missed) steps.push({ t: e.t, icon: "📞", text: `${nameOf(e.actor!)} 打給 ${nameOf(e.target!)}：「${String(d.text)}」` });
        break;
      case "look":
      case "inspect":
        if (d.found) steps.push({ t: e.t, icon: "🔍", text: `${nameOf(e.actor!)}在${placeZh(e.place!)}看到：${String(d.found)}` });
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
    const why = last && !last.fallback ? last.output?.actions.find((a) => a.type === "none")?.why : undefined;
    out.push(last && why && why !== "fallback" && !why.startsWith("free-form:") ? `念頭停在${nameOf(last.npc)}這裡：「${why}」想讓它傳開，試試告訴一位會在乎這件事的人。` : "這個念頭沒有走得很遠——有時候，小鎮就是不買單。");
  }
  return out.slice(0, 6);
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

/** At most one amber nudge: a logged near miss, a logged refusal, or (failing both) a tool for an unfinished goal. */
function nudgeOf(run: RunResult, story: StoryCard, seedNpc: string, progress: GoalProgress): { npc: string; text: string; tryIt?: boolean } | null {
  const c = story.closest;
  if (c && c.npc !== seedNpc) return { npc: c.npc, text: `差一點：${nameOf(c.npc)}聽到了${c.conf !== undefined ? `（信 ${pct(c.conf)}）` : ""}，明明可以${c.could}` };
  const refusal = run.events.filter((e) => e.type === "rejected" && e.data.wanted && e.actor && e.actor !== seedNpc).at(-1);
  if (refusal?.actor) return { npc: refusal.actor, text: `差一點：${refusal.zh}` };
  for (const g of VISIBLE) {
    if (progress[g.id]) continue;
    const tool = Object.keys(GOAL_BY_TOOL).find((k) => GOAL_BY_TOOL[k] === g.id);
    const who = run.config.active.find((n) => n !== seedNpc && toolsOf(n).some((t) => t.kind === tool));
    if (tool && who) return { npc: who, text: `試試看：${nameOf(who)}${toolsOf(who).find((t) => t.kind === tool)!.label.replace(/^\S+\s/, "能")}（${g.icon} ${g.zh}）`, tryIt: true };
  }
  return null;
}

export function Results({ saved, previous, stamps, recorded, progress, onWhatIf, onReplay, onClose }: {
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
    const lines = [`我在 VIRAL 霧港鎮對${nameOf(saved.npc)}說了一句：「${saved.text}」`];
    for (const w of story.whispers) lines.push(`後來又對${nameOf(w.npc)}補了一句：「${w.text}」`);
    lines.push(`結果：${story.icon} ${story.headline}`);
    lines.push(`傳到 ${m.reach} 位居民、${m.depth} 層、引發 ${m.worldChanges} 個世界變化。${story.festival.text}`);
    if (stampWords.length) lines.push(`今日戰績：${stampWords.join("、")}`);
    if (hl[0]) lines.push(hl[0]);
    lines.push("（每位居民都由 Gemma 依自己知道的事判斷，世界由遊戲引擎驗證。）");
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
          <p className="text-[11px] font-bold tracking-wide text-orange-500">霧港小報 · 今晚的頭條{recorded ? <span title={recorded} className="ml-1.5 font-semibold text-slate-400">📼 錄製的真實推演</span> : null}</p>
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <button onClick={() => setMin((v) => !v)} className="text-slate-400 hover:text-slate-700">{min ? "▴ 展開" : "▾ 收起"}</button>
            <button onClick={onClose} aria-label="回到小鎮" title="回到小鎮" className="text-base text-slate-400 hover:text-slate-700">✕</button>
          </div>
        </div>
        <h2 className="mt-1 text-xl font-extrabold leading-snug text-slate-900">
          {story.icon} {story.headline}
        </h2>
        {!min && (
          <>
            {story.sub && <p className="mt-1 text-sm leading-snug text-slate-600">{story.sub}</p>}
            <p className="mt-2 text-sm text-slate-700">
              你對{nameOf(saved.npc)}說：<b>「{saved.text}」</b>
            </p>
            {story.whispers.map((w, i) => (
              <p key={i} className="text-sm text-slate-700">
                你又對{nameOf(w.npc)}補了一句：<b>「{w.text}」</b>
              </p>
            ))}
            {stamps.length > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-xl bg-orange-50 px-3 py-1.5 ring-1 ring-orange-200">
                {stamps.map((h) => (
                  // one line per stamp: the goal, then the logged line that ticked it
                  <li key={h.id} className="truncate text-xs" title={h.evidence}>
                    <b className="text-orange-800">
                      ✓ {goalOf(h.id)?.icon} {goalOf(h.id)?.zh}
                      {recorded ? <span title="在 📼 錄製的實驗裡看到的"> 📼</span> : null}
                    </b>
                    <span className="text-slate-500"> · {h.evidence}</span>
                  </li>
                ))}
              </ul>
            )}
            {story.festival.kind !== "on" && (
              <p className="mt-2 rounded-xl bg-rose-50 px-3 py-1.5 text-xs leading-snug text-rose-900 ring-1 ring-rose-200" title="根據今晚發生的事推算：舞台、物資、經費、民意……任何一樣撐不住，燈籠節就會受影響">
                🏮 <b>{story.festival.text}</b>
              </p>
            )}
            {story.reveal && (
              <p className="mt-2 rounded-xl bg-violet-50 px-3 py-1.5 text-xs leading-snug text-violet-900 ring-1 ring-violet-200" title="從這個故事裡，這位居民自己說出的行動理由">
                🔓 你發現了：<b>{nameOf(story.reveal.npc)}的{story.reveal.label}</b>——{story.reveal.text}
              </p>
            )}
            {nudge && (
              <button onClick={() => onWhatIf(nudge.npc, saved.text)} className="mt-2 w-full rounded-xl bg-amber-50 px-3 py-2 text-left text-sm leading-snug text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">
                {nudge.tryIt ? "🎯" : "📌"} {nudge.text} → <b>同一句話告訴{nameOf(nudge.npc)}？</b>
              </button>
            )}
            {previous && prevStory && (
              <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900" title="同一個世界與隨機種子；Gemma 的回答本身仍有隨機性">
                <p>上次（告訴{nameOf(previous.npc)}）：{prevStory.icon} {prevStory.headline}</p>
                <p>這次（告訴{nameOf(saved.npc)}）：{story.icon} {story.headline}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400">
              傳到 {m.reach} 人 · {m.depth} 層 · {m.worldChanges} 個世界變化 · 燈籠節{festival}
            </p>
          </>
        )}
      </div>
      {!min && (
        <>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <StoryCardView card={story} seedNpc={saved.npc} seedText={saved.text} hideHeadline hideClosest={!!nudge && !nudge.tryIt} />
            <details>
              <summary className="mb-2 cursor-pointer text-xs font-semibold text-slate-500">完整事件因果鏈（{chain.length} 步，可追溯每一個原因）</summary>
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
              <summary className="cursor-pointer text-xs text-slate-400">🔬 技術紀錄</summary>
              <div className="mt-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
                <p>Gemma-4-31B-IT（AMD Token Factory）呼叫 {m.llmCalls} 次，累計推論 {m.llmSeconds} 秒，{m.tokens} tokens，平台回報成本 US${m.platformCost}</p>
                <p>居民判斷 {m.decisions} 次；驗證器要求重寫 {m.validatorRetries} 次；改用安全預設 {m.fallbacks} 次；引擎拒絕的行動 {m.rejected} 個</p>
                <p>模擬用時 {(run.wall.ms / 1000).toFixed(0)} 秒；遊戲時間 {m.gameMinutes} 分鐘；結束原因：{run.ended.reason}</p>
                <TechDecisions decisions={run.decisions} />
              </div>
            </details>
          </div>
          <div className="border-t border-slate-200 px-4 pb-3 pt-2.5">
            <p className="mb-1.5 text-xs font-semibold text-slate-500">同一句話，換一個人聽 →</p>
            <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-3">
              {run.config.active.filter((n) => ROLES[n]).map((n) => {
                const why = suggested.get(n);
                const self = n === saved.npc;
                return (
                  <button
                    key={n}
                    onClick={() => onWhatIf(n, self ? null : saved.text)}
                    title={self ? "對同一個人換一句話" : why ? `試試看：${why}` : ROLES[n].tag}
                    className={`relative flex flex-col items-center rounded-xl px-1 py-1.5 text-center ${why ? "bg-orange-100 ring-2 ring-orange-400" : "bg-orange-50/70 hover:bg-orange-100"}`}
                  >
                    {why && <span className="absolute -right-1 -top-1.5 rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white">試試</span>}
                    <span className="text-xl leading-none">{ROLES[n].icon}</span>
                    <span className="mt-0.5 text-xs font-bold text-orange-900">{self ? "換一句話" : `告訴${nameOf(n)}`}</span>
                    <span className="w-full truncate text-[10px] text-slate-500">{self ? nameOf(n) : ROLES[n].short}</span>
                  </button>
                );
              })}
            </div>
            {next.length > 0 && <p className="mt-1.5 text-[11px] leading-snug text-slate-400">試試：{next.map((s) => `${nameOf(s.npc)}（${s.why}）`).join("；")}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
              <button onClick={onReplay} className="hover:text-slate-800">⟲ 重看一次</button>
              <button
                onClick={() => navigator.clipboard?.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {})}
                className="hover:text-slate-800"
              >
                {copied ? "✓ 已複製" : "📋 複製分享文字"}
              </button>
              <button onClick={() => downloadShareCard(story, saved.npc, saved.text, stats, stampWords)} className="hover:text-slate-800">🗞️ 下載小報</button>
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
        <p className="text-xs font-bold tracking-widest text-orange-500">霧港小報 · 號外</p>
        <p className="mt-1 text-2xl font-extrabold leading-snug text-slate-900">
          {card.icon} {card.headline}
        </p>
        {card.sub && <p className="mt-1 text-sm text-slate-600">{card.sub}</p>}
        {card.festival.kind !== "on" && <p className="mt-2 text-sm font-bold text-rose-700">🏮 {card.festival.text}</p>}
        {stamps.length > 0 && <p className="mt-2 text-sm font-bold text-orange-600">{stamps.map((h) => goalOf(h.id)?.icon).join(" ")} 蓋了 {stamps.length} 個章</p>}
      </div>
    </div>
  );
}
