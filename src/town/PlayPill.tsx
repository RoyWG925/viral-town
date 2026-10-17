"use client";

// Playback controls kept small: a corner pill (pause, speed, auto director, more) and a hairline along the bottom
// edge that is the evening's timeline — 15:00 to the festival at 20:00 — with the big moments that have played
// and the fixed meetings as ticks.
import { useState } from "react";
import { pause, restart, resume, setSpeed, show } from "./director";
import { ui } from "./ui";
import { isMuted, setMuted, unlockAudio } from "./sfx";
import { meetingTicks } from "./agenda";

const EVENING = 300; // story minutes from 15:00 to the festival at 20:00
const BIG = ["state", "notice", "article", "statement", "gather"];
const pct = (t: number) => `${Math.max(0, Math.min(100, (t / EVENING) * 100))}%`;

const iconBtn = "grid h-8 min-w-8 place-items-center rounded-full px-2 text-sm font-bold";

export function PlayPill() {
  const [more, setMore] = useState(false);
  const playing = show.status === "playing";
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/80 p-1 opacity-75 shadow-md backdrop-blur transition-opacity focus-within:opacity-100 hover:opacity-100">
      <button onClick={() => (playing ? pause() : resume())} aria-label={playing ? "暫停" : "播放"} className={`${iconBtn} bg-slate-800 text-white`}>
        {playing ? "⏸" : "▶"}
      </button>
      <button onClick={() => setSpeed((show.speed % 3) + 1)} aria-label="播放速度" title="點一下切換速度" className={`${iconBtn} bg-slate-100 text-slate-700`}>
        {show.speed}×
      </button>
      <button
        onClick={() => {
          ui.follow = !ui.follow;
          ui.version++;
        }}
        aria-label="自動導演"
        title={ui.follow ? "自動導演：鏡頭跟著故事走（拖動畫面就換成自由鏡頭）" : "自由鏡頭：點一下讓鏡頭重新跟著故事"}
        className={`${iconBtn} ${ui.follow ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-700"}`}
      >
        {ui.follow ? "🎬" : "🎥"}
      </button>
      <div className="relative">
        <button onClick={() => setMore((v) => !v)} aria-label="更多" aria-expanded={more} className={`${iconBtn} bg-slate-100 text-slate-700`}>
          ⋯
        </button>
        {more && (
          <div className="absolute bottom-10 right-0 w-40 rounded-xl bg-white/95 p-1 text-sm shadow-lg">
            <button onClick={() => { restart(); setMore(false); }} className="block w-full rounded-lg px-3 py-1.5 text-left hover:bg-slate-100">⟲ 從頭重播</button>
            <button
              onClick={() => {
                unlockAudio();
                setMuted(!isMuted());
                ui.version++;
              }}
              className="block w-full rounded-lg px-3 py-1.5 text-left hover:bg-slate-100"
            >
              {isMuted() ? "🔇 音效：關" : "🔊 音效：開"}
            </button>
            {/* the scene owns the H toggle; this is the same key */}
            <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "h" }))} className="block w-full rounded-lg px-3 py-1.5 text-left hover:bg-slate-100">
              🙈 隱藏介面（H）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The evening as a hairline: how far the story clock has run, what big things have played, the fixed meetings. */
export function Timeline() {
  const played = show.order.slice(0, show.i);
  const ticks = meetingTicks(show.run, played, show.gameT, show.status === "done");
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-black/15" title="今晚：15:00 → 20:00 燈籠節">
      <div className="h-full bg-orange-400 transition-[width] duration-500" style={{ width: pct(show.gameT) }} />
      {ticks.map((m) => (
        <span
          key={m.at}
          title={`${m.zh}${m.state === "met" ? "（碰面了）" : m.state === "passed" ? "（沒有發生什麼）" : ""}`}
          className={`pointer-events-auto absolute bottom-0 h-2 w-[3px] -translate-x-1/2 rounded-full ${m.state === "met" ? "bg-sky-500" : m.state === "passed" ? "bg-slate-400/70" : "bg-white"}`}
          style={{ left: pct(m.at) }}
        />
      ))}
      {/* big moments that have already played (never the ones the engine has computed but not yet shown) */}
      {played.map((e) =>
        BIG.includes(e.type) && e.data.key !== "writing" ? (
          <span key={e.id} title={e.zh} className="pointer-events-auto absolute bottom-0 h-2.5 w-2.5 -translate-x-1/2 translate-y-[3px] rounded-full bg-violet-500 ring-2 ring-white" style={{ left: pct(e.t) }} />
        ) : null,
      )}
    </div>
  );
}
