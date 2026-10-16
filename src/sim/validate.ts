// Deterministic checks on a proposed decision. Anything that fails here never reaches the world.
// Error strings are fed back to the model on retry, so they must not reveal facts the NPC lacks.
import { actFrom } from "./acts.ts";
import { FACTS, PLACES, TOPICS, TOPIC_CATEGORY } from "./scenario.ts";
import type { ActionIntent, ActionKind, Category, DecisionOutput } from "./types.ts";
import { confidenceRange, type Limit, type View } from "./view.ts";

const CATEGORIES: Category[] = ["safety", "crime", "scandal", "health", "policy", "event", "personal", "absurd", "other"];
const INTENTS = ["inform", "warn", "ask", "answer", "deny", "complain", "request", "joke"];
const NEEDS_TARGET: ActionKind[] = ["tell", "phone", "ask"];
const NEEDS_PLACE: ActionKind[] = ["go_look", "inspect", "rally", "dispatch_police"];
const NEEDS_MESSAGE: ActionKind[] = ["tell", "phone", "ask", "post_notice", "publish_article", "public_statement", "rally", "cancel_festival"];
const PLACE_IDS = new Set(PLACES.map((p) => p.id));
const TOPIC_IDS = new Set(TOPICS.map((t) => t.id));

export interface Checked {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** confidence after the engine's limits, per claim index */
  confidence: number[];
  /** who each claim came from (by claim index), for the stored belief */
  sources?: string[][];
  /** by claim index: the engine limit that changed the model's proposed confidence, if any */
  limits?: ({ why: Limit; min: number; max: number } | undefined)[];
}

const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Normalise loosely-typed model output into a DecisionOutput, or explain what is wrong. */
export function coerce(raw: unknown): { out: DecisionOutput | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { out: null, errors: ["回覆必須是一個 JSON 物件"] };
  const r = raw as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : r[k] == null ? [] : (errors.push(`${k} 必須是陣列`), []));
  const out: DecisionOutput = {
    understanding: typeof r.understanding === "string" ? r.understanding : "",
    claims: arr("claims").map((c) => (c && typeof c === "object" ? (c as DecisionOutput["claims"][number]) : ({} as DecisionOutput["claims"][number]))),
    stances: arr("stances").map((c) => (c && typeof c === "object" ? (c as DecisionOutput["stances"][number]) : ({} as DecisionOutput["stances"][number]))),
    feeling: typeof r.feeling === "string" ? r.feeling : "",
    thought: typeof r.thought === "string" ? r.thought : "",
    act: typeof r.act === "string" ? r.act : undefined,
    actions: arr("actions").map((c) => (c && typeof c === "object" ? (c as ActionIntent) : ({ type: "none" } as ActionIntent))),
  };
  return { out, errors };
}

/**
 * Forgive harmless formatting slips before checking (each retry costs ~20 s of model time):
 * unknown claim refs become "new", stray citations are dropped, numbers given as strings are read.
 * Anything that touches the world (actions, targets, places, thresholds, secrets) stays strict.
 */
export function normalize(view: View, out: DecisionOutput): { out: DecisionOutput; notes: string[] } {
  const notes: string[] = [];
  const beliefs = new Set(view.beliefs.map((b) => b.id));
  const ids = new Set([...view.knowledge.map((k) => k.id), ...view.inbox.map((m) => m.id), ...beliefs]);
  const msgIds = new Set(view.inbox.map((m) => m.id));
  const claims = out.claims.map((c) => {
    let x = c;
    if (x.ref !== "new" && !beliefs.has(x.ref)) {
      notes.push(`claim ref ${String(x.ref)} → new`);
      x = { ...x, ref: "new" };
    }
    if (x.source && !msgIds.has(x.source)) x = { ...x, source: undefined };
    return x;
  });
  const VERDICT: Record<string, "believe" | "doubt" | "disbelieve"> = { believe: "believe", doubt: "doubt", disbelieve: "disbelieve", unsure: "doubt", uncertain: "doubt", reject: "disbelieve", "not believe": "disbelieve" };
  const stances = out.stances.map((s) => {
    const conf = typeof s.confidence === "string" ? Number(s.confidence) : s.confidence;
    const cites = (Array.isArray(s.cites) ? s.cites : []).filter((c) => {
      const ok = ids.has(c);
      if (!ok) notes.push(`stance cite ${c} dropped`);
      return ok;
    });
    const verdict = VERDICT[String(s.verdict).toLowerCase()] ?? s.verdict;
    // "disbelieve, 0.9" means "90% sure it is false": confidence is the chance the claim is TRUE
    let c = conf;
    if (typeof c === "number" && Number.isFinite(c) && verdict === "disbelieve" && c > 0.5) {
      notes.push(`inverted confidence ${c} → ${(1 - c).toFixed(2)} (disbelieve)`);
      c = Number((1 - c).toFixed(2));
    }
    return { ...s, confidence: c, verdict, cites };
  });
  // stances that point at a belief id ("c3" or 3) instead of a claim index: map them, or re-list that belief
  const beliefById = new Map(view.beliefs.map((b) => [b.id, b]));
  const fixed: typeof stances = [];
  for (const st of stances) {
    const raw = st.claim as unknown;
    let k = typeof raw === "string" ? Number(raw.replace(/^[#c]/, "")) : (raw as number);
    if (!(Number.isInteger(k) && k >= 0 && k < claims.length)) {
      // a bare number outside the claims list is ambiguous (a claim position? a belief id?): guessing once
      // stored the opposite of what the model meant, so leave it for the validator to send back
      if (!(typeof raw === "string" && raw.startsWith("c"))) {
        notes.push(`stance claim ${String(raw)} is outside the claims list: sent back`);
        fixed.push({ ...st, claim: typeof k === "number" && Number.isFinite(k) ? k : -1 });
        continue;
      }
      const id = raw as string;
      const idx = claims.findIndex((c) => c.ref === id);
      if (idx >= 0) k = idx;
      else if (beliefById.has(id)) {
        const b = beliefById.get(id)!;
        claims.push({ ref: id, statement: b.statement, topic: b.topic, says: b.says, category: b.category });
        k = claims.length - 1;
      } else {
        notes.push(`stance for unknown claim ${String(raw)} dropped`);
        continue;
      }
      notes.push(`stance claim ${String(raw)} → index ${k}`);
    }
    if (fixed.some((x) => x.claim === k)) {
      notes.push(`duplicate stance for claim ${k} dropped`);
      continue;
    }
    fixed.push({ ...st, claim: k });
  }
  stances.length = 0;
  stances.push(...fixed);
  // a new claim with no stance says nothing about belief: drop it and renumber the "#k" references
  const keep = claims.map((c, k) => c.ref !== "new" || stances.some((st) => st.claim === k));
  if (keep.some((x) => !x)) {
    const remap = new Map<number, number>();
    let n = 0;
    keep.forEach((x, k) => x && remap.set(k, n++));
    notes.push(`${keep.filter((x) => !x).length} claim(s) without a stance dropped`);
    const kept = claims.filter((_, k) => keep[k]);
    claims.length = 0;
    claims.push(...kept);
    for (const st of stances) st.claim = remap.get(st.claim) ?? st.claim;
    // a cite of a dropped claim is removed, never re-pointed at a different claim
    for (const act of out.actions)
      if (Array.isArray(act.cites))
        act.cites = act.cites
          .map((c) => (/^#\d+$/.test(c) ? (remap.has(Number(c.slice(1))) ? `#${remap.get(Number(c.slice(1)))}` : null) : c))
          .filter((c): c is string => c !== null);
  }
  let actions = out.actions.map((a) => ({ ...a, cites: (Array.isArray(a.cites) ? a.cites : []).filter((c) => ids.has(c) || /^#\d+$/.test(c)) }));
  if (actions.length > 1 && actions.some((a) => a.type === "none")) {
    actions = actions.filter((a) => a.type !== "none");
    notes.push("none dropped next to a real action");
  }
  const feeling = /\p{Extended_Pictographic}/u.test(out.feeling) ? out.feeling : `🙂 ${out.feeling}`.trim();
  // the visible reaction is presentation only: an unknown act is read off the feeling, never rejected
  const act = actFrom(out.act, feeling);
  if (out.act !== undefined && out.act !== act) notes.push(`act ${String(out.act)} → ${act}`);
  return { out: { ...out, claims, stances, actions, feeling, act }, notes };
}

export function checkDecision(view: View, out: DecisionOutput, opts: { requireActions?: boolean; requireReading?: boolean } = {}): Checked {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requireReading = opts.requireReading ?? true;
  const requireActions = opts.requireActions ?? true;
  const myBeliefs = new Map(view.beliefs.map((b) => [b.id, b]));
  const msgIds = new Set(view.inbox.map((m) => m.id));
  const knowIds = new Set(view.knowledge.map((k) => k.id));

  if (requireReading) {
    if (!str(out.understanding, 200)) errors.push("understanding 要用一句話寫出你怎麼理解（200 字內）");
    if (!str(out.thought, 160)) errors.push("thought 要寫一句內心獨白（160 字內）");
    if (!str(out.feeling, 24)) errors.push("feeling 要是一個表情符號加一個詞");
    if (out.claims.length > 4) errors.push("claims 最多 4 條");
  }
  out.claims.forEach((c, i) => {
    if (!str(c.statement, 100)) errors.push(`claims[${i}].statement 要是一句話（100 字內）`);
    if (!TOPIC_IDS.has(c.topic)) errors.push(`claims[${i}].topic 必須是主題清單裡的編號`);
    if (!["yes", "no", "unclear"].includes(c.says)) errors.push(`claims[${i}].says 必須是 yes、no 或 unclear`);
    if (!CATEGORIES.includes(c.category)) errors.push(`claims[${i}].category 不在允許的分類裡`);
    if (c.ref !== "new" && !myBeliefs.has(c.ref)) errors.push(`claims[${i}].ref 只能是 "new" 或你已有的說法編號`);
  });

  // stances: confidence is bounded by trust and knowledge
  const confidence: number[] = out.claims.map((c) => (c.ref !== "new" ? myBeliefs.get(c.ref)?.confidence ?? 0 : 0));
  const senderOf = new Map(view.inbox.map((m) => [m.id, m.from]));
  const inboxSenders = view.inbox.map((m) => m.from);
  // a claim is bounded by the trust of the message it came from; unattributed claims get the least-trusted sender
  const sourcesFor = (c: DecisionOutput["claims"][number]) => {
    if (c.source && senderOf.has(c.source)) return [senderOf.get(c.source)!];
    if (inboxSenders.length <= 1) return inboxSenders;
    const least = [...inboxSenders].sort((a, b) => view.inbox.find((m) => m.from === a)!.trust - view.inbox.find((m) => m.from === b)!.trust)[0];
    return [least];
  };
  const seen = new Set<number>();
  const refSeen = new Set<string>();
  out.claims.forEach((c, i) => {
    if (c.ref !== "new") {
      if (refSeen.has(c.ref)) errors.push(`claims[${i}]：同一條舊說法（${c.ref}）只能出現一次`);
      refSeen.add(c.ref);
    }
  });
  const claimSources = out.claims.map((c) => sourcesFor(c));
  const limits: NonNullable<Checked["limits"]> = [];
  out.stances.forEach((s, i) => {
    if (typeof s.claim !== "number" || !Number.isInteger(s.claim) || s.claim < 0 || s.claim >= out.claims.length) {
      errors.push(`stances[${i}].claim 要填 claims 陣列裡的位置（0 到 ${out.claims.length - 1}）。要對你已經有的說法（例如 c2）表態，先把它放進 claims（ref 填 c2），再用它在 claims 裡的位置`);
      return;
    }
    if (seen.has(s.claim)) errors.push(`同一條說法只能有一個立場（stances[${i}]）`);
    seen.add(s.claim);
    if (!["believe", "doubt", "disbelieve"].includes(s.verdict)) errors.push(`stances[${i}].verdict 必須是 believe、doubt 或 disbelieve`);
    if (typeof s.confidence !== "number" || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) errors.push(`stances[${i}].confidence 必須是 0 到 1 的數字`);
    else {
      const c = out.claims[s.claim];
      const prior = c.ref !== "new" ? myBeliefs.get(c.ref) : undefined;
      // an existing belief keeps its recorded topic and answer; the model cannot re-label it to dodge the limits
      const topic = prior?.topic ?? c.topic;
      const says = prior?.says ?? c.says;
      const msg = c.source ? view.inbox.find((m) => m.id === c.source) : view.inbox.length === 1 ? view.inbox[0] : undefined;
      const range = confidenceRange(view, topic, says, [...new Set([...(prior?.sources ?? []), ...sourcesFor(c)])], msg?.senderConf);
      const v = Math.min(range.max, Math.max(range.min, s.confidence));
      confidence[s.claim] = v;
      if (Math.abs(v - s.confidence) > 1e-9) limits[s.claim] = { why: range.why, min: range.min, max: range.max };
      // believing the opposite of what you yourself know is not a judgement, it is a misread: ask again
      // (capping it silently left residents acting on a belief they could not hold)
      if (range.against && s.confidence >= 0.5) {
        const truth = view.knowledge.find((k) => k.id === range.against)?.zh ?? "";
        errors.push(`stances[${i}]：你自己知道「${truth}」，「${c.statement}」跟你知道的事相反，confidence 不能是 ${s.confidence}。confidence 是這件事為真的機率，不是你希不希望別人這樣相信。請照你知道的事重新判斷；要不要說出真相、隱瞞或利用這個傳聞，由你決定。`);
      }
      if (s.verdict === "believe" && v < 0.5) warnings.push(`stance ${i} says believe but the engine caps confidence at ${v.toFixed(2)} (${range.reason})`);
    }
    for (const id of s.cites ?? []) if (!knowIds.has(id) && !msgIds.has(id) && !myBeliefs.has(id)) errors.push(`stances[${i}].cites 引用了不存在的編號 ${id}`);
  });
  if (requireReading && out.claims.length && !out.stances.length) errors.push("每條說法都要有立場 stances");

  // actions
  if (requireActions && !out.actions.length) errors.push("actions 至少要有一個（不想做事就用 none）");
  if (out.actions.length > 2) errors.push("actions 最多 2 個");
  const allowed = new Set<ActionKind>(["none", ...view.actions]);
  const people = new Map(view.people.map((p) => [p.id, p]));
  const catOf = (topic: string, model: Category) => TOPIC_CATEGORY[topic] ?? (topic === "other" ? model : "other");
  const citeConf = (cites: string[] = []) => {
    const seenKeys = new Set<string>();
    const out2: { c: { topic: string; category: Category }; conf: number }[] = [];
    for (const id of cites) {
      let g: { key: string; c: { topic: string; category: Category }; conf: number } | null = null;
      if (/^#\d+$/.test(id)) {
        const k = Number(id.slice(1));
        if (k < out.claims.length) {
          const c = out.claims[k];
          const key = c.ref !== "new" ? c.ref : `#${k}`;
          const prior = c.ref !== "new" ? myBeliefs.get(c.ref) : undefined;
          g = { key, c: { topic: prior?.topic ?? c.topic, category: catOf(prior?.topic ?? c.topic, c.category) }, conf: confidence[k] };
        }
      } else {
        const b = myBeliefs.get(id);
        if (b) {
          // if this output re-rated the belief, use the new confidence
          const k = out.claims.findIndex((c) => c.ref === id);
          g = { key: id, c: { topic: b.topic, category: catOf(b.topic, b.category) }, conf: k >= 0 ? confidence[k] : b.confidence };
        }
      }
      if (g && !seenKeys.has(g.key)) {
        seenKeys.add(g.key);
        out2.push({ c: g.c, conf: g.conf });
      }
    }
    return out2;
  };
  out.actions.forEach((a, i) => {
    if (!allowed.has(a.type)) {
      errors.push(`actions[${i}].type「${a.type}」不是你能做的行動`);
      return;
    }
    if (a.type === "none" && out.actions.length > 1) errors.push("none 不能和其他行動一起出現");
    if (NEEDS_TARGET.includes(a.type)) {
      const p = a.target ? people.get(a.target) : undefined;
      if (!p) errors.push(`actions[${i}].target 必須是你能聯絡的人的編號`);
      else if (a.type === "phone" && !p.relation.phone) errors.push(`你沒有 ${p.name} 的電話，只能當面去說`);
      if (a.intent && !INTENTS.includes(a.intent)) errors.push(`actions[${i}].intent 不在允許的清單裡`);
    }
    if (NEEDS_PLACE.includes(a.type) && (!a.place || !PLACE_IDS.has(a.place))) errors.push(`actions[${i}].place 必須是地點清單裡的編號`);
    if (NEEDS_MESSAGE.includes(a.type) && !str(a.message, a.type === "publish_article" ? 400 : 140)) errors.push(`actions[${i}].message 要寫出你要說或寫的內容（${a.type === "publish_article" ? 400 : 140} 字以內）`);
    for (const id of a.cites ?? []) {
      const okId = knowIds.has(id) || msgIds.has(id) || myBeliefs.has(id) || (/^#\d+$/.test(id) && Number(id.slice(1)) < out.claims.length);
      if (!okId) errors.push(`actions[${i}].cites 引用了不存在的編號 ${id}`);
    }
    const grounds = citeConf(a.cites);
    const best = (pred: (x: { c: { topic: string; category: Category }; conf: number }) => boolean) => Math.max(0, ...grounds.filter(pred).map((g) => g.conf));
    switch (a.type) {
      case "dispatch_police":
        if (best((g) => ["safety", "crime"].includes(g.c.category)) < 0.5) errors.push("出動警力需要你有相當把握（信心 0.5 以上）的安全或治安疑慮，並在 cites 裡引用它；把握不夠的話，可以先去現場看看、問人，或先不行動");
        break;
      case "cancel_festival": {
        const safety = best((g) => g.c.category === "safety");
        const strong = grounds.filter((g) => g.conf >= 0.5).length;
        if (!(safety >= 0.7 || (strong >= 2 && view.publicEvents.length > 0)))
          errors.push("取消燈籠節需要很有把握的安全疑慮（0.7 以上），或兩個以上有把握的理由加上鎮上已經出現的公開壓力，並在 cites 裡引用；把握不夠的話，可以先查證、找人談，或發表聲明");
        break;
      }
      case "publish_article":
        if (best(() => true) < 0.3) errors.push("發文需要引用至少一條你覺得有可能（信心 0.3 以上）的說法");
        break;
      case "rally":
        if (best(() => true) < 0.5) errors.push("號召大家聚集需要你有把握（0.5 以上）的理由，並在 cites 裡引用");
        break;
      case "close_stage": {
        const knowsDefect = view.known["stage_uninspected"] === true;
        if (!knowsDefect && best((g) => g.c.topic === "stage_unsafe") < 0.6) errors.push("封鎖舞台需要你確定舞台有問題");
        break;
      }
      case "close_shop":
      case "public_statement":
        if (!(a.cites ?? []).length) errors.push(`actions[${i}] 需要在 cites 裡說明是因為哪條資訊`);
        break;
    }
  });

  // unknown information: words that give away facts this NPC has no way of knowing
  const said = [out.understanding, out.thought, out.feeling, ...out.claims.map((c) => c.statement), ...out.stances.map((s) => s.why ?? ""), ...out.actions.map((a) => `${a.message ?? ""} ${a.why ?? ""}`)].join(" ");
  for (const f of FACTS) {
    if (f.public || f.id in view.known) continue;
    // a paraphrase of something they heard is not a leak: every character of the phrase was in what they heard
    const derivable = (k: string) => view.heardText.includes(k) || [...k].every((ch) => view.heardText.includes(ch));
    const kw = f.keywords.find((k) => said.includes(k) && !derivable(k));
    if (kw) errors.push(`你的回覆用到了你沒有聽說過的具體細節（「${kw}」）。請只根據上面列出的資訊思考`);
  }
  return { ok: errors.length === 0, errors, warnings, confidence, sources: claimSources, limits };
}
