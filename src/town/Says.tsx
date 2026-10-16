"use client";

// Lines over residents' heads: what they said (with the words they changed from what they heard
// picked out), what they privately think and how much they believe it, and what they found.
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type * as THREE from "three";
import { PERSONAS } from "../sim/scenario.ts";
import { agentFor, nameOf, show, type Say } from "./director";

/** Characters of `said` that are not in its longest common subsequence with `heard`. */
export function changedMarks(heard: string, said: string): boolean[] {
  const n = heard.length;
  const m = said.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = heard[i] === said[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (heard[i] === said[j]) {
      keep[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return keep.map((k) => !k);
}

const PUNCT = /[\s，。、！？：；「」『』（）,.!?:;"'…—-]/;

/** The said line as runs of kept / changed text, or null when it is a complete rewrite (nothing to pick out). */
export function diffRuns(heard: string | undefined, said: string, names: string[] = []): { text: string; changed: boolean }[] | null {
  if (!heard) return null;
  const marks = changedMarks(heard, said);
  // names and greetings are not the rumour changing: never highlight them
  for (const w of [...names, "我是", "你好", "嗨", "喂", "聽說", "剛剛", "剛才"]) {
    for (let at = said.indexOf(w); at >= 0; at = said.indexOf(w, at + 1)) for (let k = at; k < at + w.length; k++) marks[k] = false;
  }
  const content = [...said].filter((c) => !PUNCT.test(c)).length || 1;
  const changed = [...said].filter((c, k) => marks[k] && !PUNCT.test(c)).length;
  if (changed === 0 || changed / content > 0.8) return null;
  const runs: { text: string; changed: boolean }[] = [];
  [...said].forEach((c, k) => {
    const ch = marks[k] && !PUNCT.test(c);
    const last = runs.at(-1);
    if (last && last.changed === ch) last.text += c;
    else runs.push({ text: c, changed: ch });
  });
  // keep the three longest changed pieces (2+ characters); the rest reads as plain text
  const keep = new Set(runs.filter((r) => r.changed && r.text.length >= 2).sort((x, y) => y.text.length - x.text.length).slice(0, 3));
  for (const r of runs) if (r.changed && !keep.has(r)) r.changed = false;
  return keep.size ? runs : null;
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const NAMES = PERSONAS.flatMap((p) => [p.name, p.roleZh]).concat(["市長", "老闆", "警長"]);

function Thinking({ s }: { s: Say }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const secs = s.since ? Math.max(0, Math.round((now - s.since) / 1000)) : 0;
  return (
    <div className="rounded-full border-2 border-violet-200 bg-white/95 px-3 py-1 text-slate-600 shadow-lg">
      <span className="text-[12px] font-semibold">
        💭 {nameOf(s.npc)}在想<span className="inline-block w-5 animate-pulse">…</span>
        <span className="ml-1 text-[11px] tabular-nums text-slate-400">{secs} 秒</span>
      </span>
    </div>
  );
}

function Card({ s }: { s: Say }) {
  if (s.kind === "thinking") return <Thinking s={s} />;
  if (s.kind === "thought") {
    const pct = s.belief ? Math.round(s.belief.conf * 100) : null;
    const tone = !s.belief ? "bg-slate-300" : s.belief.conf >= 0.5 ? "bg-rose-400" : s.belief.conf >= 0.25 ? "bg-amber-400" : "bg-slate-400";
    return (
      <div className="w-[230px] rounded-[22px] border-2 border-violet-200 bg-white/95 px-3 py-2 text-slate-800 shadow-lg">
        <p className="text-[11px] font-semibold text-violet-500">💭 {nameOf(s.npc)}心裡想</p>
        <p className="text-[13px] font-semibold leading-snug">{clip(s.text, 46)}</p>
        {s.understanding && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">以為：{clip(s.understanding, 32)}</p>}
        {s.belief && (
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-1.5 flex-1 rounded-full bg-slate-200">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-bold tabular-nums text-slate-600">
              {s.belief.verdict} {pct}%
            </span>
          </div>
        )}
      </div>
    );
  }
  if (s.kind === "found")
    return (
      <div className="w-[230px] rounded-2xl bg-slate-800/95 px-3 py-2 text-white shadow-lg">
        <p className="text-[11px] font-semibold text-sky-300">🔍 {nameOf(s.npc)}親眼看到</p>
        <p className="text-[13px] leading-snug">{clip(s.text, 60)}</p>
      </div>
    );
  if (s.kind === "seed")
    return (
      <div className="w-[230px] rounded-2xl bg-violet-600/95 px-3 py-2 text-white shadow-lg">
        <p className="text-[11px] font-semibold text-violet-200">一個陌生人對{nameOf(s.npc)}低聲說</p>
        <p className="text-[13px] font-semibold leading-snug">「{clip(s.text, 50)}」</p>
      </div>
    );
  const runs = diffRuns(s.heard, s.text, NAMES);
  const rewritten = !!s.heard && !runs && s.heard !== s.text;
  return (
    <div className="w-[240px] rounded-2xl border-2 border-amber-200 bg-amber-50/95 px-3 py-2 text-slate-900 shadow-lg">
      <p className="text-[11px] font-semibold text-amber-700">
        {s.kind === "phone" ? "📞" : "💬"} {nameOf(s.npc)}{s.to ? ` → ${nameOf(s.to)}` : ""}
      </p>
      {(runs || rewritten) && s.heard && <p className="text-[11px] leading-snug text-slate-400">聽到的是：「{clip(s.heard, 30)}」</p>}
      <p className="text-[13px] font-semibold leading-snug">
        「
        {runs
          ? runs.map((r, k) =>
              r.changed ? (
                <mark key={k} className="rounded bg-orange-300/80 px-0.5 text-slate-900">
                  {r.text}
                </mark>
              ) : (
                <span key={k}>{r.text}</span>
              ),
            )
          : clip(s.text, 64)}
        」
      </p>
    </div>
  );
}

function Bubble({ s }: { s: Say }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const a = agentFor(s.npc);
    if (a && group.current) group.current.position.set(a.x, 0, a.z);
  });
  return (
    <group ref={group}>
      <Html position={[0, 2.6, 0]} zIndexRange={[40, 10]} style={{ pointerEvents: "none" }}>
        <div style={{ transform: "translate(-50%, -100%)" }} className="select-none">
          <Card s={s} />
          <div className="mx-auto h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-white/90" />
        </div>
      </Html>
    </group>
  );
}

/** Re-renders when the director's line list changes. */
export default function Says() {
  const [keys, setKeys] = useState("");
  useFrame(() => {
    const k = show.says.map((x) => x.key).join(",");
    if (k !== keys) setKeys(k);
  });
  return (
    <group>
      {show.says.map((s) => (
        <Bubble key={s.key} s={s} />
      ))}
    </group>
  );
}
