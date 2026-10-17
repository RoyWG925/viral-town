"use client";

// The first visit opens with half a minute of the town before anyone is told what to do: who you are (a thought
// that spreads), what is at stake (20:00, the lantern festival), and four things the camera happens to linger on —
// the stage, the bakery's sticker, the dove cages, the stalls. Questions, never answers: what a player might want to
// test with one sentence. Skippable at once; shown once (the 🎬 button brings it back).
import { useEffect, useRef, useState } from "react";
import { SPOTS } from "../sim/geo.ts";
import { STAGE, fromLocal } from "./layout";
import { flyTo } from "./camera";

const cages = fromLocal(STAGE, -STAGE.w / 2 + 1, 0);
const BEATS: { at: { x: number; z: number }; dist: number; kicker: string; line: string; sub: string; secs: number; dark?: boolean }[] = [
  { at: SPOTS.plaza, dist: 80, kicker: "VIRAL", line: "You are not a character.", sub: "You are a thought that spreads.", secs: 4.5, dark: true },
  { at: SPOTS.plaza, dist: 50, kicker: "Mistport · 15:20", line: "Tonight at 20:00: the Lantern Festival.", sub: "Four hours and forty minutes to go.", secs: 4.5 },
  { at: SPOTS.stage, dist: 20, kicker: "The festival stage", line: "Put up in a hurry this week.", sub: "Did anyone ever check it?", secs: 4.5 },
  { at: SPOTS.bakery, dist: 18, kicker: "The bakery", line: "The oven's safety sticker…", sub: "…what date is on it?", secs: 4 },
  { at: cages, dist: 18, kicker: "The dove cages", line: "A hundred white doves fly at the opening.", sub: "Right over the mayor's head.", secs: 4.5 },
  { at: SPOTS.stall, dist: 22, kicker: "The stalls", line: "Stall fees doubled this year.", sub: "Nobody at the town hall will say why.", secs: 4.5 },
  { at: SPOTS.plaza, dist: 58, kicker: "Your move", line: "Pick someone. Whisper one sentence.", sub: "Then watch what the town does with it.", secs: 4.5 },
];

export default function Opening({ onDone }: { onDone: () => void }) {
  const [k, setK] = useState(0);
  const beat = BEATS[k];
  // the parent re-renders all the time (the town is live): keep the latest callback without restarting the beat
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const b = BEATS[k];
    flyTo(b.at.x, b.at.z, b.dist);
    const id = setTimeout(() => (k + 1 < BEATS.length ? setK(k + 1) : done.current()), b.secs * 1000);
    return () => clearTimeout(id);
  }, [k]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") done.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* letterbox bars, and the first beat almost dark */}
      <div className={`absolute inset-0 transition-colors duration-1000 ${beat.dark ? "bg-slate-950/85" : "bg-transparent"}`} />
      <div className="absolute inset-x-0 top-0 h-[9vh] bg-black/85" />
      <div className="absolute inset-x-0 bottom-0 h-[9vh] bg-black/85" />
      <div key={k} className={`absolute inset-x-0 flex justify-center px-4 animate-[fadein_0.7s_ease-out] ${beat.dark ? "top-[38%]" : "bottom-[13vh]"}`}>
        <div className={`max-w-xl text-center ${beat.dark ? "" : "rounded-2xl bg-slate-950/70 px-6 py-3 backdrop-blur-sm"}`}>
          <p className={`font-bold uppercase tracking-[0.3em] text-orange-300 ${beat.dark ? "text-3xl" : "text-[11px]"}`}>{beat.kicker}</p>
          <p className={`mt-1 font-serif font-black text-white ${beat.dark ? "text-3xl" : "text-xl"}`}>{beat.line}</p>
          <p className={`mt-0.5 text-slate-200 ${beat.dark ? "text-lg" : "text-sm"}`}>{beat.sub}</p>
        </div>
      </div>
      <div className="absolute bottom-[2.5vh] left-0 right-0 flex items-center justify-center gap-1.5">
        {BEATS.map((_, i) => (
          <span key={i} className={`h-1 rounded-full transition-all ${i === k ? "w-6 bg-orange-300" : "w-2 bg-white/40"}`} />
        ))}
      </div>
      <button onClick={onDone} className="pointer-events-auto absolute right-4 top-[2.5vh] rounded-full bg-white/15 px-3 py-1 text-sm font-semibold text-white hover:bg-white/30">
        Skip ›
      </button>
    </div>
  );
}
