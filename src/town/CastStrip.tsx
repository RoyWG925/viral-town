"use client";

// Eight faces at the top. In the quiet town it is a roster: tap someone to look at them and open their card.
// During a story it is "who knows now", fed only by what playback has shown (show.*): a ring when they have heard
// it, the fill for where they stand, 💭 while the model thinks for them, and a badge once a big move has played.
import { agentFor, nameOf, show } from "./director";
import { ui } from "./ui";
import { flyTo } from "./camera";
import { CAST, ROLES } from "./roles";
import type { SimEvent } from "../sim/types.ts";

const FILL: Record<string, string> = { believe: "bg-rose-200", doubt: "bg-amber-200", disbelieve: "bg-slate-300" };

/** The badge for a big public move that has already played. */
function badgeOf(e: SimEvent): string | null {
  const key = String(e.data.key ?? "");
  if (e.type === "state") return key === "police" ? "🚓" : key === "stage" ? "🚧" : key === "festival" ? "🏮" : key.startsWith("shops.") ? "🚪" : null;
  return ({ article: "📰", statement: "📣", gather: "✊", notice: "📋" } as Record<string, string>)[e.type] ?? null;
}

export default function CastStrip({ phase }: { phase: "explore" | "compose" | "simulating" | "playing" | "results" }) {
  const story = phase === "playing" || phase === "results";
  const played = story ? show.order.slice(0, show.i) : [];
  const cast = CAST.filter((n) => ui.active.has(n));
  const heard = cast.filter((n) => show.infected.has(n)).length;
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/70 px-1.5 py-1 shadow backdrop-blur max-sm:hidden">
      {cast.map((n) => {
        const st = show.stance[n];
        const infected = story && show.infected.has(n);
        const badge = story ? played.filter((e) => e.actor === n).map(badgeOf).find(Boolean) : null;
        const look = story
          ? `${st ? FILL[st.verdict] ?? "bg-white" : "bg-white"} ${infected ? "ring-2 ring-orange-400" : "opacity-50 grayscale"}`
          : phase === "simulating"
            ? "bg-white opacity-60 grayscale"
            : `bg-white hover:scale-110 ${ui.selected === n ? "ring-2 ring-sky-400" : ""}`;
        return (
          <button
            key={n}
            title={`${nameOf(n)}｜${ROLES[n].tag}`}
            aria-label={nameOf(n)}
            onClick={() => {
              const a = agentFor(n);
              if (story) {
                // look at them now: the auto director steps aside (the pill shows 🎥)
                ui.follow = false;
                ui.version++;
                if (a) flyTo(a.x, a.z, 22);
              } else if (phase === "explore" || phase === "compose") ui.select(n);
            }}
            className={`relative grid h-8 w-8 place-items-center rounded-full text-base transition ${look}`}
          >
            {ROLES[n].icon}
            {story && show.thinking.has(n) && <span className="absolute -right-1 -top-1 animate-pulse text-[10px]">💭</span>}
            {badge && <span className="absolute -bottom-1 -right-1 text-[10px]">{badge}</span>}
          </button>
        );
      })}
      {story && <span className="px-1 text-xs font-bold tabular-nums text-slate-600">{heard}/{cast.length}</span>}
    </div>
  );
}
