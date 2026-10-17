"use client";

// The one always-there top-left pill: the town's name, the time, and how long until the lantern festival.
// During a story it is the story clock and turns into a doom clock in the last half hour. Tapping it opens
// whatever the caller puts in the drawer (time, views, speed in explore).
import { useState, type ReactNode } from "react";
import { formatHour } from "./clock";

const FESTIVAL_HOUR = 20;

/** `trouble`: what has already gone wrong for the festival in what has played (words, never the meter numbers) */
export default function ClockPill({ hour, story = false, trouble, children }: { hour: number; story?: boolean; trouble?: string | null; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const left = FESTIVAL_HOUR - hour;
  const time = `${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, "0")}`;
  const countdown = left <= 0 ? "The Lantern Festival has begun" : `Lantern Festival in ${time}`;
  const troubled = left <= 0 ? "Festival in trouble · it has begun" : `Festival in trouble · ${time} to go`;
  // the last half hour before 20:00 pulses: the evening is running out
  const urgent = story && left > 0 && left < 0.5;
  const body = (
    <>
      <span className="text-[11px] font-bold tracking-wide text-slate-400 max-sm:hidden">Mistport</span>
      <b className="text-sm font-extrabold tabular-nums text-slate-800">{formatHour(hour)}</b>
      <span className={`text-xs font-semibold ${trouble ? "text-rose-600" : left < 1 ? "text-amber-600" : "text-orange-600"}`} title={trouble ?? undefined}>
        🏮 {trouble ? troubled : countdown}
      </span>
      {children && <span className="text-[10px] text-slate-400">{open ? "▴" : "▾"}</span>}
    </>
  );
  const cls = `pointer-events-auto flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 shadow backdrop-blur ${urgent ? "animate-pulse ring-2 ring-amber-400" : trouble ? "ring-2 ring-rose-300" : ""}`;
  if (!children) return <div className={cls}>{body}</div>;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button onClick={() => setOpen((v) => !v)} className={`${cls} hover:bg-white`} aria-expanded={open} title="Time, views and speed">
        {body}
      </button>
      {open && <div className="pointer-events-auto w-[min(92vw,280px)] rounded-2xl bg-white/92 px-3 py-2.5 shadow-lg backdrop-blur">{children}</div>}
    </div>
  );
}
