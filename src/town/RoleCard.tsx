"use client";

// The whisper card: who this resident is as a tool (what they are able to do, who they can call, how easily they
// believe), then the sentence. Docked bottom-left and narrow, so the resident stays visible on the right.
import { PERSONAS, PUBLIC_BIO } from "../sim/scenario.ts";
import { nameOf } from "./director";
import { contactsOf, credulityOf, ROLES, toolsOf } from "./roles";
import { useState } from "react";
import { HIDDEN_FIELDS, loadJournal } from "./journal";
import { moderateWhisper } from "../sim/moderation";

export default function RoleCard({ npc, text, setText, onPlant, onClose, goalTools }: {
  npc: string;
  text: string;
  setText: (t: string) => void;
  /** the sentence as it may be heard (swearing masked); refused sentences never get here */
  onPlant: (text: string) => void;
  onClose: () => void;
  /** abilities that could tick an unfinished small goal (shown with 🎯) */
  goalTools?: Record<string, string>;
}) {
  const p = PERSONAS.find((x) => x.id === npc);
  const role = ROLES[npc];
  const [journal] = useState(loadJournal);
  const [refusal, setRefusal] = useState<string | null>(null);
  const plant = () => {
    const m = moderateWhisper(text);
    if (m.action === "block") return setRefusal(m.message);
    setRefusal(null);
    onPlant(m.text);
  };
  if (!p || !role) return null;
  const cred = credulityOf(npc);
  const calls = contactsOf(npc).map(nameOf);
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 w-[min(92vw,380px)] rounded-2xl bg-white/93 p-4 shadow-xl backdrop-blur max-sm:inset-x-2 max-sm:bottom-2 max-sm:w-auto">
      <div className="flex items-start gap-2">
        <span className="text-3xl leading-none">{role.icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold leading-tight text-slate-800">{p.name}</h2>
          <p className="truncate text-xs text-slate-500">{p.roleZh}</p>
        </div>
        <button onClick={onClose} aria-label="關閉" className="text-slate-400 hover:text-slate-700">✕</button>
      </div>
      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-1.5 text-sm font-semibold leading-snug text-amber-900">{role.tag}</p>
      {toolsOf(npc).length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-semibold text-slate-400">能：</span>
          {toolsOf(npc).map((t) => {
            const goal = goalTools?.[t.kind];
            return (
              <span
                key={t.kind}
                title={goal ? `有機會完成小目標：${goal}` : undefined}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${goal ? "bg-orange-100 text-orange-800 ring-1 ring-orange-300" : "bg-slate-100 text-slate-600"}`}
              >
                {t.label}
                {goal ? " 🎯" : ""}
              </span>
            );
          })}
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        📞 能打給：{calls.length ? calls.join("、") : "沒有人（只能當面說）"}
        <span className="mx-1 text-slate-300">·</span>
        耳根軟 <span className="tracking-tighter text-orange-500">{"●".repeat(cred.dots)}</span>
        <span className="tracking-tighter text-slate-300">{"○".repeat(5 - cred.dots)}</span> {cred.zh}
      </p>
      <details className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer select-none text-slate-400">關於{p.name}</summary>
        <p className="mt-1">{PUBLIC_BIO[npc]?.bio}</p>
      </details>
      <details className="mt-0.5 text-xs text-slate-500">
        <summary className="cursor-pointer select-none text-slate-400">
          📓 你對{p.name}的了解 {HIDDEN_FIELDS.filter((f) => journal[npc]?.[f.key]).length}/{HIDDEN_FIELDS.length}
        </summary>
        <ul className="mt-1 space-y-0.5">
          {HIDDEN_FIELDS.map((f) => (
            <li key={f.key}>
              <span className="font-semibold text-slate-600">{f.label}：</span>
              {journal[npc]?.[f.key] && p.card ? p.card[f.field] : <span className="text-slate-300">？？？</span>}
            </li>
          ))}
        </ul>
        {!HIDDEN_FIELDS.some((f) => journal[npc]?.[f.key]) && <p className="mt-1 text-slate-400">多看幾次{p.name}的故事，就會慢慢摸清這個人。</p>}
      </details>
      <div className="relative mt-2">
        <textarea
          value={text}
          onChange={(e) => {
            setRefusal(null);
            setText(e.target.value.slice(0, 80));
          }}
          // typing an "h" must not hide the interface (the scene listens for H on the window)
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={`對${p.name}說一句悄悄話……${p.name}會自己判斷信不信`}
          className="h-16 w-full resize-none rounded-xl border border-slate-200 bg-white p-2.5 text-[15px] text-slate-800 outline-none focus:border-orange-400"
        />
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-slate-300">{text.length}/80</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {role.examples.map((ex) => (
          <button key={ex} onClick={() => setText(ex)} className="max-w-full truncate rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200">
            {ex}
          </button>
        ))}
      </div>
      <button disabled={!text.trim()} onClick={plant} className="mt-2.5 w-full rounded-xl bg-orange-500 py-2 text-base font-bold text-white shadow disabled:opacity-40">
        植入這個念頭
      </button>
      {refusal && <p className="mt-1.5 text-xs leading-snug text-rose-700">{refusal}</p>}
    </div>
  );
}
