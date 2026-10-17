"use client";

// The top of the results panel: the headline of what really happened, the chain of retellings
// that led there, and — when the rumour died — who stopped it and who almost acted on it.
import { nameOf } from "./director";
import { stepLine, type StoryCard } from "./story";

const pct = (c?: number) => (c === undefined ? "" : `${Math.round(c * 100)}%`);
const VERDICT: Record<string, string> = { believe: "相信", doubt: "半信半疑", disbelieve: "不信" };
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

function Pill({ verdict, conf }: { verdict?: string; conf?: number }) {
  if (verdict === undefined) return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">還沒表態</span>;
  const tone = (conf ?? 0) >= 0.5 ? "bg-rose-100 text-rose-700" : (conf ?? 0) >= 0.25 ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600";
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{VERDICT[verdict] ?? verdict} {pct(conf)}</span>;
}

/** One planted sentence: the player's own line in the chain. */
function You({ npc, text, again }: { npc: string; text: string; again?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 rounded-full bg-violet-600 px-2 py-0.5 font-bold text-white">你</span>
      <p className="text-slate-700">
        {again ? "又" : ""}對{nameOf(npc)}{again ? "補了一句" : "說"}：<span className="font-semibold">「{clip(text, 40)}」</span>
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
          <p className="text-[11px] font-bold tracking-wide text-orange-500">霧港小報 · 今晚的頭條</p>
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

      {card.drift && !card.headline.startsWith("你說") && (
        <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-snug text-slate-600 shadow-sm">
          🔀 話題變了：你說的是「{clip(card.drift.from, 16)}」，後來大家在談「{clip(card.drift.to, 20)}」
          {card.drift.pivot ? `（轉折：${nameOf(card.drift.pivot.from)}對${nameOf(card.drift.pivot.to)}說的話）` : ""}。
        </p>
      )}
      {card.closest && !hideClosest && (
        <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-snug text-slate-600 shadow-sm">
          📌 差一點：{nameOf(card.closest.npc)}聽到了{card.closest.conf !== undefined ? `（信 ${pct(card.closest.conf)}）` : ""}，明明可以{card.closest.could}，最後卻選擇{card.closest.did}。
        </p>
      )}
      {card.truth && (
        <p className="mt-3 rounded-xl bg-slate-800 px-3 py-2 text-xs leading-snug text-white">
          🔎 真相揭曉：{card.truth.text}
          {card.truth.secretOf.length ? `（這是${card.truth.secretOf.map(nameOf).join("和")}的秘密）` : ""}
          {card.truth.value ? "" : " 這個傳聞本來就不是真的。"}
        </p>
      )}
      <p className="mt-2 text-[10px] text-slate-400">以上全部來自這次模擬的事件紀錄與小鎮設定的真相，沒有額外生成或改寫。</p>
    </div>
  );
}
