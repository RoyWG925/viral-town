"use client";

// The top of the results panel: the headline of what really happened, the chain of retellings
// that led there, and — when the rumour died — who stopped it and who almost acted on it.
import { clip, listOf, nameOf } from "./director";
import { stepLine, type StoryCard } from "./story";

const pct = (c?: number) => (c === undefined ? "" : `${Math.round(c * 100)}%`);
const VERDICT: Record<string, string> = { believe: "believes", doubt: "not sure", disbelieve: "doesn't believe" };

function Pill({ verdict, conf }: { verdict?: string; conf?: number }) {
  if (verdict === undefined) return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">no view yet</span>;
  const tone = (conf ?? 0) >= 0.5 ? "bg-rose-100 text-rose-700" : (conf ?? 0) >= 0.25 ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600";
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{VERDICT[verdict] ?? verdict} {pct(conf)}</span>;
}

/** One planted sentence: the player's own line in the chain. */
function You({ npc, text, again }: { npc: string; text: string; again?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 rounded-full bg-violet-600 px-2 py-0.5 font-bold text-white">You</span>
      <p className="text-slate-700">
        {again ? `One more line to ${nameOf(npc)}` : `To ${nameOf(npc)}`}: <span className="font-semibold">“{clip(text, 68)}”</span>
      </p>
    </div>
  );
}

export default function StoryCardView({ card, seedNpc, seedText, hideHeadline = false, hideClosest = false }: {
  card: StoryCard;
  seedNpc: string;
  seedText: string;
  /** the results panel prints the headline itself, first and largest */
  hideHeadline?: boolean;
  /** the results panel turns the near miss into a What If button */
  hideClosest?: boolean;
}) {
  // the spine starts from the sentence that led to the outcome; a 補一句 that did is printed right before it
  const second = card.whispers[0];
  return (
    <div className="mb-4 rounded-2xl border border-orange-200 bg-gradient-to-b from-orange-50 to-white p-4">
      {!hideHeadline && (
        <>
          <p className="text-[11px] font-bold tracking-wide text-orange-500">The Mistport Gazette · Tonight&apos;s headline</p>
          <p className="mt-1 text-xl font-extrabold leading-snug text-slate-900">
            {card.icon} {card.headline}
          </p>
          {card.sub && <p className="mt-1 text-sm leading-snug text-slate-600">{card.sub}</p>}
        </>
      )}

      <div className={`${hideHeadline ? "" : "mt-3"} space-y-1.5`}>
        <You npc={seedNpc} text={seedText} />
        {second && card.spineRoot === 1 && <You npc={second.npc} text={second.text} again />}
        {card.spine.map((h, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
              {stepLine(h).who}
            </span>
            <div>
              <p className="text-slate-700">{stepLine(h, 52).words}</p>
              {/* a sight is no message: it gets a pill only once they made something of it */}
              {(h.verdict !== undefined || (h.via !== "look" && h.via !== "inspect")) && <Pill verdict={h.verdict} conf={h.conf} />}
            </div>
          </div>
        ))}
        {card.chainGap && <p className="text-xs leading-snug text-slate-500">{card.chainGap}</p>}
        {second && card.spineRoot !== 1 && <You npc={second.npc} text={second.text} again />}
      </div>

      {/* the drift headline already says it ("你說「…」" in old logs, "You said “…”" in English ones) */}
      {card.drift && !/^(你說|You said)/i.test(card.headline) && (
        <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-snug text-slate-600 shadow-sm">
          🔀 The topic changed: you said “{clip(card.drift.from, 27)}”, and later everyone was talking about “{clip(card.drift.to, 34)}”
          {card.drift.pivot ? ` (the turn: what ${nameOf(card.drift.pivot.from)} said to ${nameOf(card.drift.pivot.to)})` : ""}.
        </p>
      )}
      {card.closest && !hideClosest && (
        <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-snug text-slate-600 shadow-sm">
          📌 So close: {nameOf(card.closest.npc)} heard it{card.closest.conf !== undefined ? ` (${pct(card.closest.conf)} sure)` : ""} and could {card.closest.could}, but chose to {card.closest.did} instead.
        </p>
      )}
      {card.truth && (
        <p className="mt-3 rounded-xl bg-slate-800 px-3 py-2 text-xs leading-snug text-white">
          🔎 The truth: {card.truth.text}
          {card.truth.secretOf.length ? ` (a secret ${listOf(card.truth.secretOf.map(nameOf))} kept)` : ""}
          {card.truth.value ? "" : " The rumor was never true."}
        </p>
      )}
      <p className="mt-2 text-[10px] text-slate-400">Everything above comes from this run&apos;s event log and the town&apos;s ground truth. Nothing extra was generated or rewritten.</p>
    </div>
  );
}
