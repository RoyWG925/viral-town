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

/**
 * Length caps on what the model writes, in characters. They were set for Chinese answers; English needs about 1.7×
 * the characters for the same content, so each is scaled by that. The prompt quotes the message caps from here.
 */
export const LIMITS = { understanding: 340, thought: 270, feeling: 40, statement: 170, message: 240, article: 680 } as const;

/** Normalise loosely-typed model output into a DecisionOutput, or explain what is wrong. */
export function coerce(raw: unknown): { out: DecisionOutput | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { out: null, errors: ["the reply must be one JSON object"] };
  const r = raw as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : r[k] == null ? [] : (errors.push(`${k} must be an array`), []));
  const out: DecisionOutput = {
    understanding: typeof r.understanding === "string" ? r.understanding : "",
    claims: arr("claims").map((c) => (c && typeof c === "object" ? (c as DecisionOutput["claims"][number]) : ({} as DecisionOutput["claims"][number]))),
    stances: arr("stances").map((c) => (c && typeof c === "object" ? (c as DecisionOutput["stances"][number]) : ({} as DecisionOutput["stances"][number]))),
    feeling: typeof r.feeling === "string" ? r.feeling : "",
    thought: typeof r.thought === "string" ? r.thought : "",
    act: typeof r.act === "string" ? r.act : undefined,
    motive: typeof r.motive === "string" ? (r.motive as DecisionOutput["motive"]) : undefined,
    actions: arr("actions").map((c) => (c && typeof c === "object" ? (c as ActionIntent) : ({ type: "none" } as ActionIntent))),
  };
  return { out, errors };
}

/**
 * Forgive harmless formatting slips before checking (each retry costs ~20 s of model time):
 * unknown claim refs become "new", stray citations are dropped, numbers given as strings are read.
 * Anything that touches the world (actions, targets, places, thresholds, secrets) stays strict, and so does which
 * claim a stance or cite points at: a claim reference that names no claim is sent back, never guessed or dropped.
 */
/** "0.5 (not sure)" → 0.5, "60%" → 0.6, "seventy percent" stays NaN (then it is sent back) */
function readNumber(x: string): number {
  const m = /-?\d+(?:\.\d+)?/.exec(x);
  if (!m) return NaN;
  const v = Number(m[0]);
  return x.includes("%") || v > 1 ? v / 100 : v;
}

/**
 * A reference to a claim, read by its shape alone, before anything is looked up: "c3" is a claim id, "#1" and a bare
 * number (1 or "1") are positions in this answer's claims, anything else is not a claim reference. (F04: stripping
 * the "c" and then checking the range read belief c1 as position 1 and updated whatever claim sat there.)
 */
function claimRef(x: unknown): { id: string } | { pos: number } | null {
  if (typeof x === "number") return Number.isInteger(x) && x >= 0 ? { pos: x } : null;
  if (typeof x !== "string") return null;
  if (/^c\d+$/.test(x)) return { id: x };
  return /^#?\d+$/.test(x) ? { pos: Number(x.replace("#", "")) } : null;
}

export function normalize(view: View, out: DecisionOutput): { out: DecisionOutput; notes: string[] } {
  const notes: string[] = [];
  const beliefs = new Set(view.beliefs.map((b) => b.id));
  const ids = new Set([...view.knowledge.map((k) => k.id), ...view.inbox.map((m) => m.id), ...beliefs]);
  const msgIds = new Set(view.inbox.map((m) => m.id));
  // a new claim the model named itself ("c2" for something it just learned): keep the name so its stance and
  // the actions citing it still find it (P4: a finding was dropped this way and the article could not cite it)
  const invented = new Map<string, number>();
  const claims = out.claims.map((c, k) => {
    let x = c;
    if (x.ref !== "new" && !beliefs.has(x.ref)) {
      notes.push(`claim ref ${String(x.ref)} → new`);
      if (typeof x.ref === "string" && !invented.has(x.ref)) invented.set(x.ref, k);
      x = { ...x, ref: "new" };
    }
    if (x.source && !msgIds.has(x.source)) x = { ...x, source: undefined };
    return x;
  });
  const VERDICT: Record<string, "believe" | "doubt" | "disbelieve"> = { believe: "believe", doubt: "doubt", disbelieve: "disbelieve", unsure: "doubt", uncertain: "doubt", reject: "disbelieve", "not believe": "disbelieve" };
  const stances = out.stances.map((s) => {
    const conf = typeof s.confidence === "string" ? readNumber(s.confidence) : s.confidence;
    const cites = (Array.isArray(s.cites) ? s.cites : []).filter((c) => {
      const ok = ids.has(c);
      if (!ok && !invented.has(c)) notes.push(`stance cite ${c} dropped`);
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
  // a stance names its claim by id ("c3": an old belief, or the model's own name for a new claim) or by position;
  // which one is decided by the shape, never by whether the number happens to fit the list (F04: belief c1 was read
  // as position 1, another claim was updated, and the real stance was dropped as a duplicate)
  const beliefById = new Map(view.beliefs.map((b) => [b.id, b]));
  const fixed: typeof stances = [];
  for (const st of stances) {
    const raw = st.claim as unknown;
    const ref = claimRef(raw);
    let k: number;
    if (ref && "id" in ref) {
      const idx = claims.findIndex((c) => c.ref === ref.id);
      if (idx >= 0) k = idx;
      else if (invented.has(ref.id)) k = invented.get(ref.id)!;
      else if (beliefById.has(ref.id)) {
        const b = beliefById.get(ref.id)!;
        claims.push({ ref: ref.id, statement: b.statement, topic: b.topic, says: b.says, category: b.category });
        k = claims.length - 1;
      } else {
        // not a claim they have: dropping it silently lost their judgement, so ask again
        notes.push(`stance claim ${ref.id} is not one of their claims: sent back`);
        fixed.push({ ...st, claim: -1 });
        continue;
      }
      notes.push(`stance claim ${ref.id} → index ${k}`);
    } else if (ref && ref.pos < claims.length) k = ref.pos;
    else {
      // a bare number outside the claims list is ambiguous (a claim position? a belief id?): guessing once
      // stored the opposite of what the model meant, so leave it for the validator to send back
      // with no claims listed at all, a bare number can only mean one of their beliefs (c<n>): not ambiguous
      if (claims.length === 0 && typeof raw === "number" && beliefById.has(`c${raw}`)) {
        const b = beliefById.get(`c${raw}`)!;
        claims.push({ ref: `c${raw}`, statement: b.statement, topic: b.topic, says: b.says, category: b.category });
        notes.push(`stance claim ${raw} → belief c${raw} (no claims listed)`);
        if (!fixed.some((x) => x.claim === claims.length - 1)) fixed.push({ ...st, claim: claims.length - 1 });
        continue;
      }
      // (-1, not the number they wrote: claims re-listed later must not make it point somewhere)
      notes.push(`stance claim ${String(raw)} is outside the claims list: sent back`);
      fixed.push({ ...st, claim: -1 });
      continue;
    }
    if (fixed.some((x) => x.claim === k)) {
      notes.push(`duplicate stance for claim ${k} dropped`);
      continue;
    }
    fixed.push({ ...st, claim: k });
  }
  stances.length = 0;
  stances.push(...fixed);
  // action cites name claims the same way: an old claim keeps its id, the model's own name or a bare number inside the
  // list becomes "#k", and a claim reference that resolves to nothing stays as written for the validator to send back
  for (const act of out.actions)
    if (Array.isArray(act.cites))
      act.cites = act.cites.map((c) => {
        const ref = claimRef(c);
        if (!ref || ids.has(c)) return c;
        if ("id" in ref) return invented.has(ref.id) ? `#${invented.get(ref.id)}` : ref.id;
        return ref.pos < claims.length ? `#${ref.pos}` : String(c);
      });
  // a new claim with no stance says nothing about belief: drop it and renumber the "#k" references
  // (not while a stance is being sent back: the positions in the message back must be the ones they wrote)
  const sendingBack = stances.some((st) => st.claim === -1);
  const keep = claims.map((c, k) => sendingBack || c.ref !== "new" || stances.some((st) => st.claim === k));
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
  let actions = out.actions.map((a) => ({ ...a, cites: (Array.isArray(a.cites) ? a.cites : []).filter((c) => ids.has(c) || claimRef(c) !== null) }));
  if (actions.length > 1 && actions.some((a) => a.type === "none")) {
    actions = actions.filter((a) => a.type !== "none");
    notes.push("none dropped next to a real action");
  }
  const feeling = /\p{Extended_Pictographic}/u.test(out.feeling) ? out.feeling : `🙂 ${out.feeling}`.trim();
  // the visible reaction is presentation only: an unknown act is read off the feeling, never rejected
  const act = actFrom(out.act, feeling);
  // the motive is their own reading of themselves: an unknown value becomes "none", never a reason to send it back
  const MOTIVES = ["want", "fear", "bias", "gossip", "bottom", "price", "none"];
  const motive = out.motive === undefined ? undefined : MOTIVES.includes(String(out.motive).toLowerCase()) ? (String(out.motive).toLowerCase() as DecisionOutput["motive"]) : "none";
  if (out.act !== undefined && out.act !== act) notes.push(`act ${String(out.act)} → ${act}`);
  return { out: { ...out, claims, stances, actions, feeling, act, motive }, notes };
}

// ---- leak keywords: could they have put this giveaway phrase together from what they heard? ----
// A Chinese keyword (Chinese answers, old logs): yes when every character of it was in what they heard. An English
// keyword: yes when every content word of it was, as a word (loosely stemmed, with a few everyday paraphrases), so
// "the oven's inspection has expired" can come from "the oven is past its safety inspection", but "the stage was
// never inspected" cannot come from "the stage looks shaky".
const HAN = /\p{Script=Han}/u;
/** how English is compared: lower case, straight apostrophes, single spaces */
const plain = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ");
const derivableZh = (k: string, heard: string) => heard.includes(k) || [...k].every((ch) => heard.includes(ch));
const STOP = new Set(
  ("a an the and or but if so as is are was were be been being am has have had do does did done not no never nor of to for on in at by " +
    "with from about into onto than then that this these those there here it its they them their he him his she her we us our you your i me " +
    "my what which who whom whose when where why how all any some each every just only also very really still even again ever yet will would " +
    "shall should can could may might must wo ca let get got gets getting go goes going gone went usual usually normal normally regular regularly").split(" "),
);
/** a few everyday paraphrases, by stem: the stem on the left counts as the one on the right */
const SAME: Record<string, string> = {
  check: "inspect", examin: "inspect",
  past: "expir", overdu: "expir", laps: "expir", outdat: "expir",
  fill: "plug", plugg: "plug", patch: "plug", gap: "hol",
  officer: "polic", cop: "polic",
  argu: "fight", argument: "fight", quarrel: "fight", fought: "fight",
  pictur: "photo", pic: "photo", photograph: "photo",
  shak: "wobbl", loos: "wobbl",
  percent: "%", thirt: "30",
  took: "tak", taken: "tak", paid: "pay", overran: "overrun", cutt: "cut",
};
const SUFFIXES = ["ations", "ation", "ions", "ion", "ings", "ing", "als", "al", "ies", "ied", "es", "ed", "s", "y", "e"];
function stem(w: string): string {
  const suf = SUFFIXES.find((x) => w.endsWith(x) && w.length - x.length >= 3);
  const s = suf ? w.slice(0, -suf.length) : w;
  return SAME[s] ?? s;
}
/** the content words of an English text, stemmed */
function contentWords(s: string): string[] {
  const t = plain(s).replace(/n't\b/g, " not").replace(/'(s|re|ve|ll|d|m)\b/g, "");
  return (t.match(/[\p{L}\p{N}]+|%/gu) ?? []).filter((w) => !STOP.has(w)).map(stem);
}
const heardWords = (heard: string) => new Set(contentWords(heard));
const derivableEn = (k: string, heard: string, words: Set<string>) => plain(heard).includes(plain(k)) || contentWords(k).every((w) => words.has(w));

export function checkDecision(view: View, out: DecisionOutput, opts: { requireActions?: boolean; requireReading?: boolean } = {}): Checked {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requireReading = opts.requireReading ?? true;
  const requireActions = opts.requireActions ?? true;
  const myBeliefs = new Map(view.beliefs.map((b) => [b.id, b]));
  const msgIds = new Set(view.inbox.map((m) => m.id));
  const knowIds = new Set(view.knowledge.map((k) => k.id));

  if (requireReading) {
    if (!str(out.understanding, LIMITS.understanding)) errors.push(`understanding must say in one sentence how you read this (under ${LIMITS.understanding} characters)`);
    if (!str(out.thought, LIMITS.thought)) errors.push(`thought must be one line of inner monologue (under ${LIMITS.thought} characters)`);
    if (!str(out.feeling, LIMITS.feeling)) errors.push("feeling must be one emoji plus one word");
    if (out.claims.length > 4) errors.push("at most 4 claims");
  }
  out.claims.forEach((c, i) => {
    if (!str(c.statement, LIMITS.statement)) errors.push(`claims[${i}].statement must be one sentence (under ${LIMITS.statement} characters)`);
    if (!TOPIC_IDS.has(c.topic)) errors.push(`claims[${i}].topic must be an id from the topic list`);
    if (!["yes", "no", "unclear"].includes(c.says)) errors.push(`claims[${i}].says must be yes, no or unclear`);
    if (!CATEGORIES.includes(c.category)) errors.push(`claims[${i}].category is not one of the allowed categories`);
    if (c.ref !== "new" && !myBeliefs.has(c.ref)) errors.push(`claims[${i}].ref can only be "new" or the id of a claim you already have`);
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
      if (refSeen.has(c.ref)) errors.push(`claims[${i}]: the same old claim (${c.ref}) can only be listed once`);
      refSeen.add(c.ref);
    }
  });
  const claimSources = out.claims.map((c) => sourcesFor(c));
  const limits: NonNullable<Checked["limits"]> = [];
  out.stances.forEach((s, i) => {
    if (typeof s.claim !== "number" || !Number.isInteger(s.claim) || s.claim < 0 || s.claim >= out.claims.length) {
      // name the positions and their own claim ids that do exist (the ids are on their own prompt)
      const mine = [...myBeliefs.keys()].join(", ");
      errors.push(`stances[${i}].claim doesn't point at any claim: use a position in the claims array (${out.claims.length ? `0 to ${out.claims.length - 1}` : "claims is empty this time"}), or the id of a claim you already have (${mine || "you don't have any claims yet"})`);
      return;
    }
    if (seen.has(s.claim)) errors.push(`only one stance per claim (stances[${i}])`);
    seen.add(s.claim);
    if (!["believe", "doubt", "disbelieve"].includes(s.verdict)) errors.push(`stances[${i}].verdict must be believe, doubt or disbelieve`);
    if (typeof s.confidence !== "number" || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) errors.push(`stances[${i}].confidence must be a number from 0 to 1`);
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
        errors.push(`stances[${i}]: you yourself know “${truth.replace(/[.。]$/, "")}”, and “${c.statement.replace(/[.。]$/, "")}” contradicts what you know, so its confidence can't be ${s.confidence}. Confidence is the chance that it's true, not how much you'd like others to believe it. Judge it again from what you know; whether to tell the truth, keep quiet or make use of the rumor is up to you.`);
      }
      if (s.verdict === "believe" && v < 0.5) warnings.push(`stance ${i} says believe but the engine caps confidence at ${v.toFixed(2)} (${range.reason})`);
    }
    for (const id of s.cites ?? []) if (!knowIds.has(id) && !msgIds.has(id) && !myBeliefs.has(id)) errors.push(`stances[${i}].cites names an id that doesn't exist: ${id}`);
  });
  if (requireReading && out.claims.length && !out.stances.length) errors.push("every claim needs a stance in stances");

  // actions
  if (requireActions && !out.actions.length) errors.push("actions needs at least one entry (use none if you don't want to do anything)");
  if (out.actions.length > 2) errors.push("at most 2 actions");
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
      errors.push(`actions[${i}].type “${a.type}” is not something you can do`);
      return;
    }
    if (a.type === "none" && out.actions.length > 1) errors.push("none can't be listed together with other actions");
    if (NEEDS_TARGET.includes(a.type)) {
      const p = a.target ? people.get(a.target) : undefined;
      if (!p) errors.push(`actions[${i}].target must be the id of someone you can contact`);
      else if (a.type === "phone" && !p.relation.phone) errors.push(`you don't have ${p.name}'s number; you can only tell them in person`);
      if (a.intent && !INTENTS.includes(a.intent)) errors.push(`actions[${i}].intent is not one of the allowed intents`);
    }
    if (NEEDS_PLACE.includes(a.type) && (!a.place || !PLACE_IDS.has(a.place))) errors.push(`actions[${i}].place must be an id from the place list`);
    const maxMessage = a.type === "publish_article" ? LIMITS.article : LIMITS.message;
    if (NEEDS_MESSAGE.includes(a.type) && !str(a.message, maxMessage)) errors.push(`actions[${i}].message must say what you say or write (under ${maxMessage} characters)`);
    for (const id of a.cites ?? []) {
      const okId = knowIds.has(id) || msgIds.has(id) || myBeliefs.has(id) || (/^#\d+$/.test(id) && Number(id.slice(1)) < out.claims.length);
      if (!okId) errors.push(`actions[${i}].cites names an id that doesn't exist: ${id}`);
    }
    const grounds = citeConf(a.cites);
    const best = (pred: (x: { c: { topic: string; category: Category }; conf: number }) => boolean) => Math.max(0, ...grounds.filter(pred).map((g) => g.conf));
    // the model only sees its own number; say what the engine allows it to be sure of, and why
    const actually = (v: number) => (grounds.length ? ` (from your sources so far, your confidence in it can really only be ${v.toFixed(2)}: it's only what people told you, with no evidence you saw yourself, so it has a ceiling)` : "");
    switch (a.type) {
      case "dispatch_police":
        if (best((g) => ["safety", "crime"].includes(g.c.category)) < 0.5) errors.push(`Sending officers needs a safety or crime worry you're fairly sure of (confidence 0.5 or more), cited in cites${actually(best((g) => ["safety", "crime"].includes(g.c.category)))}; if you're not sure enough, you can go and look first, ask around, or hold off for now`);
        break;
      case "cancel_festival": {
        const safety = best((g) => g.c.category === "safety");
        const strong = grounds.filter((g) => g.conf >= 0.5).length;
        if (!(safety >= 0.7 || (strong >= 2 && view.publicEvents.length > 0)))
          errors.push(`Cancelling the Lantern Festival needs a safety worry you're very sure of (0.7 or more), or two or more reasons you're sure of plus public pressure that's already showing in town, cited in cites${actually(safety)}; if you're not sure enough, you can check first, talk to people, or make a statement`);
        break;
      }
      case "publish_article":
        if (best(() => true) < 0.3) errors.push("Publishing an article needs at least one claim in cites that you think could be true (confidence 0.3 or more)");
        break;
      case "rally":
        if (best(() => true) < 0.5) errors.push(`Calling people to gather needs a reason you're sure of (0.5 or more), cited in cites${actually(best(() => true))}`);
        break;
      case "close_stage": {
        const knowsDefect = view.known["stage_uninspected"] === true;
        if (!knowsDefect && best((g) => g.c.topic === "stage_unsafe") < 0.6) errors.push(`Taping off the stage needs you to be sure something is wrong with it${actually(best((g) => g.c.topic === "stage_unsafe"))}`);
        break;
      }
      case "close_shop":
      case "public_statement":
        if (!(a.cites ?? []).length) errors.push(`actions[${i}] needs cites saying which information it's because of`);
        break;
    }
  });

  // unknown information: words that give away facts this NPC has no way of knowing
  const said = [out.understanding, out.thought, out.feeling, ...out.claims.map((c) => c.statement), ...out.stances.map((s) => s.why ?? ""), ...out.actions.map((a) => `${a.message ?? ""} ${a.why ?? ""}`)].join(" ");
  const saidLow = plain(said);
  const heard = heardWords(view.heardText);
  for (const f of FACTS) {
    if (f.public || f.id in view.known) continue;
    const kw = f.keywords.find((k) => (HAN.test(k) ? said.includes(k) && !derivableZh(k, view.heardText) : saidLow.includes(plain(k)) && !derivableEn(k, view.heardText, heard)));
    if (kw) errors.push(`your answer uses a specific detail you have never heard of (“${kw}”). Think only from the information listed above`);
  }
  return { ok: errors.length === 0, errors, warnings, confidence, sources: claimSources, limits };
}
