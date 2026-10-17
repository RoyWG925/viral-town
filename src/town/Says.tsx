"use client";

// Lines over residents' heads: what they said (with the words they changed from what they heard
// picked out), what they privately think and how much they believe it, and what they found.
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type * as THREE from "three";
import { PERSONAS } from "../sim/scenario.ts";
import { agentFor, clip, nameOf, show, type Say } from "./director";

// The units a retelling is compared in: a whole English word (so a changed word lights up whole, never a few of its
// letters), or a single other character (one Chinese character in the old recorded runs, a space, a mark).
const UNIT = /[A-Za-z0-9\u00C0-\u024F]+(?:['\u2019][A-Za-z]+)*|[\s\S]/gu;
const units = (t: string) => [...t.matchAll(UNIT)].map((m) => ({ text: m[0], key: m[0].toLowerCase(), at: m.index ?? 0 }));

/** Characters (UTF-16 offsets) of `said` that are not in its longest common subsequence of units with `heard`. */
export function changedMarks(heard: string, said: string): boolean[] {
  const a = units(heard);
  const b = units(said);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) {
      keep[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const marks = new Array<boolean>(said.length).fill(false);
  b.forEach((u, k) => {
    if (!keep[k]) for (let c = u.at; c < u.at + u.text.length; c++) marks[c] = true;
  });
  return marks;
}

const PUNCT = /[\s，。、！？：；「」『』（）,.!?:;"'“”‘’…—-]/;
const LATIN = /[A-Za-z]/;
// greetings and hearsay openers are not the rumor changing (old Chinese runs and English ones)
const OPENERS = ["我是", "你好", "嗨", "喂", "聽說", "剛剛", "剛才", "hey", "hi", "hello", "listen", "i heard", "heard", "did you hear", "just now", "apparently", "they say", "word is", "says", "said", "told me"];

/** The said line as runs of kept / changed text, or null when it is a complete rewrite (nothing to pick out). */
export function diffRuns(heard: string | undefined, said: string, names: string[] = []): { text: string; changed: boolean }[] | null {
  if (!heard) return null;
  const marks = changedMarks(heard, said);
  // names and greetings are not the rumor changing: never highlight them (English ones only as whole words)
  const lower = said.toLowerCase();
  for (const w of [...names, ...OPENERS].filter(Boolean).map((x) => x.toLowerCase())) {
    for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) {
      const whole = !LATIN.test(w) || (!LATIN.test(lower[at - 1] ?? "") && !LATIN.test(lower[at + w.length] ?? ""));
      if (whole) for (let k = at; k < at + w.length; k++) marks[k] = false;
    }
  }
  const chars = [...said];
  // marks are per UTF-16 offset; walk the string by code points
  const offsets: number[] = [];
  chars.reduce((at, c) => (offsets.push(at), at + c.length), 0);
  const isChanged = (k: number) => marks[offsets[k]] && !PUNCT.test(chars[k]);
  const content = chars.filter((c) => !PUNCT.test(c)).length || 1;
  const changed = chars.filter((_, k) => isChanged(k)).length;
  if (changed === 0 || changed / content > 0.8) return null;
  // a space between two changed words belongs to the change ("will collapse" is one highlight, not two)
  const bridged = (k: number) => {
    if (!/\s/.test(chars[k])) return false;
    let l = k - 1;
    while (l >= 0 && /\s/.test(chars[l])) l--;
    let r = k + 1;
    while (r < chars.length && /\s/.test(chars[r])) r++;
    return l >= 0 && r < chars.length && isChanged(l) && isChanged(r);
  };
  const runs: { text: string; changed: boolean }[] = [];
  chars.forEach((c, k) => {
    const ch = isChanged(k) || bridged(k);
    const last = runs.at(-1);
    if (last && last.changed === ch) last.text += c;
    else runs.push({ text: c, changed: ch });
  });
  // keep the three longest changed pieces (2+ characters); the rest reads as plain text
  const keep = new Set(runs.filter((r) => r.changed && r.text.length >= 2).sort((x, y) => y.text.length - x.text.length).slice(0, 3));
  for (const r of runs) if (r.changed && !keep.has(r)) r.changed = false;
  return keep.size ? runs : null;
}

// names (and each word of a two-word name: "Mayor", "Lin") and titles are never the rumor changing
const NAMES = PERSONAS.flatMap((p) => [p.name, ...p.name.split(" "), p.roleZh]).concat(["市長", "老闆", "警長", "Mayor", "Chief", "boss"]);

function Thinking({ s }: { s: Say }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const secs = s.since ? Math.max(0, Math.round((now - s.since) / 1000)) : 0;
  return (
    <div className="whitespace-nowrap rounded-full border-2 border-violet-200 bg-white/95 px-3 py-1 text-slate-600 shadow-lg">
      <span className="text-[12px] font-semibold">
        {s.text || "💭"} {nameOf(s.npc)} is thinking<span className="inline-block w-5 animate-pulse">…</span>
        <span className="ml-1 text-[11px] tabular-nums text-slate-400">{secs}s</span>
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
        <p className="text-[11px] font-semibold text-violet-500">💭 {nameOf(s.npc)} thinks</p>
        <p className="text-[13px] font-semibold leading-snug">{clip(s.text, 78)}</p>
        {s.understanding && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">Takes it as: {clip(s.understanding, 54)}</p>}
        {s.ignoring && <p className="mt-0.5 text-[11px] font-semibold text-slate-500">(decides to let it go for now)</p>}
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
        <p className="text-[11px] font-semibold text-sky-300">🔍 {nameOf(s.npc)} sees it firsthand</p>
        <p className="text-[13px] leading-snug">{clip(s.text, 100)}</p>
      </div>
    );
  if (s.kind === "seed")
    return (
      <div className="w-[230px] rounded-2xl bg-violet-600/95 px-3 py-2 text-white shadow-lg">
        <p className="text-[11px] font-semibold text-violet-200">A stranger whispers to {nameOf(s.npc)}</p>
        <p className="text-[13px] font-semibold leading-snug">“{clip(s.text, 85)}”</p>
      </div>
    );
  const runs = diffRuns(s.heard, s.text, NAMES);
  const rewritten = !!s.heard && !runs && s.heard !== s.text;
  return (
    <div className="w-[240px] rounded-2xl border-2 border-amber-200 bg-amber-50/95 px-3 py-2 text-slate-900 shadow-lg">
      <p className="text-[11px] font-semibold text-amber-700">
        {s.kind === "phone" ? "📞" : "💬"} {nameOf(s.npc)}{s.to ? ` → ${nameOf(s.to)}` : ""}
      </p>
      {(runs || rewritten) && s.heard && <p className="text-[11px] leading-snug text-slate-400">What they heard: “{clip(s.heard, 50)}”</p>}
      {s.speakerConf !== undefined && s.speakerConf < 0.5 && s.intent !== "ask" && s.intent !== "deny" && (
        <p className="text-[10px] font-semibold text-amber-600">(only {Math.round(s.speakerConf * 100)}% sure, but passes it on anyway)</p>
      )}
      <p className="text-[13px] font-semibold leading-snug">
        “
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
          : clip(s.text, 108)}
        ”
      </p>
    </div>
  );
}

/**
 * A fixed slot for one line. drei's <Html> creates its own React root; unmounting it while the scene renders
 * logs a race warning, so slots stay mounted and only swap what they show.
 */
function Slot({ index }: { index: number }) {
  const group = useRef<THREE.Group>(null);
  const [s, setS] = useState<Say | null>(null);
  useFrame(() => {
    const cur = show.says[index] ?? null;
    if ((cur?.key ?? -1) !== (s?.key ?? -1)) setS(cur);
    const a = cur ? agentFor(cur.anchor ?? cur.npc) : null;
    if (a && group.current) group.current.position.set(a.x, 0, a.z);
  });
  return (
    <group ref={group}>
      <Html position={[0, 2.6, 0]} zIndexRange={[40, 10]} style={{ pointerEvents: "none" }}>
        {s && (
          <div style={{ transform: "translate(-50%, -100%)" }} className="select-none">
            <Card s={s} />
            <div className="mx-auto h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-white/90" />
          </div>
        )}
      </Html>
    </group>
  );
}

/** At most three lines on screen (the director keeps it that way); one spare slot for the thinking pill. */
export default function Says() {
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <Slot key={i} index={i} />
      ))}
    </group>
  );
}
