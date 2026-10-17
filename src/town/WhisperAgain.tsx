"use client";

// 補一句: offered once, only when the engine says the story is about to fizzle and playback has caught up to that
// moment. One more sentence to anyone, or let it fade. Untouched for 20 s, it fades by itself (no hanging story).
import { useEffect, useRef, useState } from "react";
import { nameOf } from "./director";
import { CAST, MAX_WHISPER, ROLES } from "./roles";
import type { Suggestion } from "./story";
import { moderateWhisper } from "../sim/moderation";

const WAIT = 20;

export interface LullOffer {
  t: number;
  decisionsLeft: number;
  reached: string[];
}

export default function WhisperAgain({ suggestions, onAnswer }: { suggestions: Suggestion[]; onAnswer: (w: { npc: string; text: string } | null) => void }) {
  const [open, setOpen] = useState(false);
  const [npc, setNpc] = useState(suggestions[0]?.npc ?? CAST[0]);
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = () => {
    const m = moderateWhisper(text);
    if (m.action === "block") return setRefusal(m.message);
    answer({ npc, text: m.text });
  };
  const [left, setLeft] = useState(WAIT);
  const answered = useRef(false);
  const answer = (w: { npc: string; text: string } | null) => {
    if (answered.current) return;
    answered.current = true;
    onAnswer(w);
  };
  // the ring runs down only while the offer is closed: once the player opens the box, it waits for them
  useEffect(() => {
    if (open) return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [open]);
  useEffect(() => {
    if (!open && left <= 0) answer(null);
  });
  if (!open)
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[84px] flex justify-center px-3">
        <div className="pointer-events-auto flex animate-[fadein_0.3s_ease-out] items-center gap-2 rounded-full bg-white/95 py-1 pl-1 pr-2 shadow-lg ring-1 ring-orange-300">
          <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="#fde3c8" strokeWidth="4" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="#f97316" strokeWidth="4" strokeDasharray={94.2} strokeDashoffset={94.2 * (1 - Math.max(0, left) / WAIT)} className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
          </svg>
          <button onClick={() => setOpen(true)} className="text-sm font-bold text-orange-800">💬 The story is fading. One more line? (just once)</button>
          <button onClick={() => answer(null)} className="rounded-full px-2 text-xs text-slate-400 hover:text-slate-700">Let it fade</button>
        </div>
      </div>
    );
  return (
    <div className="pointer-events-auto absolute bottom-[84px] left-1/2 w-[min(94vw,420px)] -translate-x-1/2 animate-[fadein_0.25s_ease-out] rounded-2xl bg-white/95 p-3 shadow-xl ring-1 ring-orange-200 backdrop-blur">
      <p className="text-sm font-bold text-slate-800">💬 One more line (just once): who do you tell?</p>
      <div className="mt-2 grid grid-cols-8 gap-1">
        {CAST.map((n) => (
          <button key={n} onClick={() => setNpc(n)} title={ROLES[n].tag} className={`flex flex-col items-center rounded-lg py-1 ${npc === n ? "bg-orange-100 ring-2 ring-orange-400" : "hover:bg-slate-100"}`}>
            <span className="text-lg leading-none">{ROLES[n].icon}</span>
            <span className="mt-0.5 text-center text-[10px] font-semibold leading-tight text-slate-600">{nameOf(n)}</span>
          </button>
        ))}
      </div>
      {suggestions.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1 text-[11px] text-slate-500">
          Try:
          {suggestions.map((s) => (
            <button key={s.npc} onClick={() => setNpc(s.npc)} className="rounded-full bg-orange-50 px-2 text-orange-800 hover:bg-orange-100">
              {ROLES[s.npc]?.icon} {nameOf(s.npc)} ({s.why})
            </button>
          ))}
        </p>
      )}
      <input
        value={text}
        onChange={(e) => {
          setRefusal(null);
          setText(e.target.value.slice(0, MAX_WHISPER));
        }}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={`Say something to ${nameOf(npc)}…`}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[15px] text-slate-800 outline-none focus:border-orange-400"
        autoFocus
      />
      <div className="mt-2 flex items-center gap-2">
        <button disabled={!text.trim()} onClick={send} className="flex-1 rounded-xl bg-orange-500 py-1.5 text-sm font-bold text-white disabled:opacity-40">
          Whisper it
        </button>
        <button onClick={() => answer(null)} className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">Let it fade</button>
      </div>
      {refusal && <p className="mt-1.5 text-xs leading-snug text-rose-700">{refusal}</p>}
    </div>
  );
}
