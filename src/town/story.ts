// Turns a finished run's log into the story the results card tells: a headline for the biggest thing
// that really happened (as things stood at the end), the chain of recorded causes that led there ("the
// spine": retellings, public words, what people saw), who stopped the rumour when it died, and the wildest
// retelling. Built only from recorded, validated events and fixed templates — no model writes or embellishes it.
// The templates are English; logs recorded before the English text (lab/runs, public/recorded) are in Chinese, so
// what this file reads out of a log (what a look showed, who was there, what was said) is matched in both.
import type { RunResult } from "../sim/engine.ts";
import { FACTS, LOOK_LIMITS, PERSONAS, PLACES, TOPIC_CATEGORY } from "../sim/scenario.ts";
import { topicFact } from "../sim/view.ts";
import { readinessOf } from "../sim/readiness.ts";
import type { Motive, SimEvent } from "../sim/types.ts";
import { canDo, contactsOf, powerOf, TOOL } from "./roles.ts";

const nameOf = (id: string) => PERSONAS.find((p) => p.id === id)?.name ?? id;
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CJK = /[㐀-鿿]/;
/** Text from a log recorded in Chinese: Chinese characters and no two English words in a row. */
const isChinese = (s: string) => CJK.test(s) && !/[A-Za-z]{2,}[\s,;:]+[A-Za-z]{2,}/.test(s);
/** Cut to about `n` characters (at a word break in English), with "…" when anything was cut. */
const clipS = (t: string, n: number) => {
  if (t.length <= n) return t;
  let cut = t.slice(0, n);
  if (!CJK.test(cut)) {
    const k = cut.lastIndexOf(" ");
    if (k > n * 0.6) cut = cut.slice(0, k);
  }
  return `${cut.replace(/[\s,;:.—-]+$/, "")}…`;
};

/** Every wording a log may hold for a fact's check: the English one, and the Chinese one older logs recorded. */
const checkWords = (f: (typeof FACTS)[number]) => (f.check ? [f.check.zh, f.check.legacyZh].filter((x): x is string => !!x) : []);
/** The wording of a fact's check that this text contains, if any. */
const checkIn = (f: (typeof FACTS)[number], text: string) => checkWords(f).find((w) => text.includes(w));
// what a glance could not tell at a place, as the older Chinese logs worded it (the English is LOOK_LIMITS)
const LEGACY_LIMITS: Partial<Record<string, string>> = {
  stage: "一座台子結不結實，光是看看是看不出來的，要懂行的人仔細檢查才知道。",
  bakery: "店裡的設備安不安全，光是看看是看不出來的，要懂行的人仔細檢查才知道。",
  townhall: "公家的錢怎麼花，不會寫在牆上，要有人去仔細翻閱公開資料才知道。",
};
/** A look that showed nothing out of the ordinary ("everything looks normal"). */
const NOTHING = /一切如常|everything at [^.;]+? looks normal/i;
/** The part of a look that only says who was there. */
const hereLine = (p: string) => /(在這裡。|\b(?:is|are) here\.)$/.test(p);
// a look's parts that are taken whole: a fact's check or a look limit can run to two sentences
const WHOLE = [...FACTS.flatMap((f) => (f.check ? [f.check.zh] : [])), ...Object.values(LOOK_LIMITS).filter((x): x is string => !!x)];
/**
 * The separate things a look showed, in order. Older Chinese logs put a space between them; English ones are
 * sentences joined by spaces, so a known check or limit is taken whole and the rest is split at sentence ends,
 * never inside quoted words (a notice, the cause of a gathering).
 */
function partsOf(found: string): string[] {
  if (isChinese(found)) return found.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let rest = found.trim();
  while (rest) {
    const piece = WHOLE.find((w) => rest.startsWith(w)) ?? /^(?:“[^”]*”|"[^"]*"|[^“"])*?[.!?](?=\s|$)/.exec(rest)?.[0] ?? rest;
    out.push(piece);
    rest = rest.slice(piece.length).trim();
  }
  return out;
}
// someone in a conversation trying to keep it quiet
const COVER_UP =
  /壓下來|壓住|別說|不要說出去|敷衍|私下處理|低調|hush|cover(?:ed|ing)? (?:it|this|that) up|keep (?:it|this|that) (?:quiet|down|between us)|keep quiet|don't tell|do not tell|don't spread|low[- ]key|handle (?:it|this) quietly|quietly handle|play (?:it|this) down|brush (?:it|this) off|sweep (?:it|this) under/i;
// small words that say nothing about what a claim is about
const SMALL = new Set(
  "a an the and or but of to in on at for with by from as is are was were be been being it its this that these those there here their they them he she him her his you your i me my we our so too just very not no up out about has have had will would can could do does did".split(" "),
);
/** The words of an English text, small words aside, plural and possessive "s" off. */
const wordsOf = (t: string) => (t.toLowerCase().match(/[a-z0-9%']+/g) ?? []).map((w) => w.replace(/'s$/, "").replace(/(?<=\w{3})s$/, "")).filter((w) => w && !SMALL.has(w));

/**
 * One step of the chain: a retelling, words made public and the one on the way who took them in, talk of the town
 * that reached someone, or something seen first-hand.
 */
export interface Hop {
  /** the speaker or author; "crowd" for talk of the town */
  from: string;
  /** the listener; the reader of a public text; for a look or inspection, the one who looked (= from) */
  to: string;
  via: "talk" | "phone" | "article" | "notice" | "statement" | "crowd" | "look" | "inspect";
  /** what was said, the article's headline, or what they saw */
  text: string;
  /** the version the speaker had heard before passing it on */
  heard?: string;
  /** what the listener then made of it (their stored belief), if they decided */
  verdict?: string;
  conf?: number;
  t: number;
  /** the logged event this step is */
  event: string;
}

export interface StoryCard {
  icon: string;
  headline: string;
  sub: string;
  /** the player's sentence → … → the last version on the way to the outcome: only its recorded causes, in time order */
  spine: Hop[];
  /** the logged event the spine leads to (the biggest happening, or the look a 🔍 headline reports), when there is one */
  outcome?: string;
  /** said instead of a chain when the log has no readable one from the planted sentence to the outcome */
  chainGap?: string;
  /** when the rumour died: who held it last and what they thought */
  stopper?: { npc: string; thought: string; verdict?: string; conf?: number };
  /** someone who could have done something big, and what they actually did ("could {could}, but chose to {did}") */
  closest?: { npc: string; could: string; did: string; conf?: number };
  /** the retelling that drifted furthest from what was heard */
  wildest?: Hop & { similarity: number };
  /** the world's actual truth about what the player said (authored fact), and whose secret it was */
  truth?: { text: string; value: boolean; secretOf: string[] };
  /** the town ended up talking about something else than the planted sentence: from what, to what, and where it turned */
  drift?: { from: string; to: string; pivot?: Hop };
  reached: string[];
  /** the extra sentence(s) the player added at a lull (One more line): a second root of the story */
  whispers: { npc: string; text: string }[];
  /** which planted sentence the spine starts from (0 = the first, 1 = the One more line) */
  spineRoot: number;
  /** how the festival went at 20:00, from the readiness meters (a rule over the log; never a model call) */
  festival: { kind: "on" | "reduced" | "postponed" | "cancelled"; short: string; text: string; missing: string[] };
  /** one line of someone's card this story showed them acting on (from their own logged motive) */
  reveal?: { npc: string; key: Exclude<Motive, "none">; label: string; text: string; event: string; t: number };
}

const STEP_ICON: Record<Hop["via"], string> = { talk: "💬", phone: "📞", article: "📰", notice: "📋", statement: "📣", crowd: "🗣️", look: "👀", inspect: "🔍" };
/** How a step of the chain reads on a card: icon and who (→ whom), then the words, headline or sight, cut to `n`. */
export function stepLine(h: Hop, n = Infinity): { who: string; words: string } {
  const text = clipS(h.text, n);
  const from = h.via === "crowd" ? "Word around town" : nameOf(h.from);
  return {
    who: `${STEP_ICON[h.via] ?? "💬"} ${from}${h.to !== h.from ? ` → ${nameOf(h.to)}` : ""}`,
    words: h.via === "look" || h.via === "inspect" ? `Saw: ${text}` : h.via === "crowd" ? text : `“${text}”`,
  };
}

// the names of a card's lines, as the town notebook calls them ("Ade's fears — …", "could …, but chose to …")
const MOTIVE_LABEL: Record<string, string> = { price: "price", bottom: "line they won't cross", fear: "fears", want: "wants tonight", bias: "bias", gossip: "gossip habit" };
// the most telling first: what would make them turn, what they will never do, what scares them…
const MOTIVE_RANK = ["price", "bottom", "fear", "want", "bias", "gossip"];

/**
 * The most telling card line a resident acted on in this log (their own `motive`); nothing for old logs without it.
 * `known` ("npc.key") are lines the player has already discovered: a new one is preferred, so the journal grows.
 */
export function revealOf(events: SimEvent[], known: Set<string> = new Set()): StoryCard["reveal"] {
  let best: NonNullable<StoryCard["reveal"]> | undefined;
  let bestScore = Infinity;
  for (const e of events) {
    if (e.type !== "decide" || !e.actor || e.data.fallback || e.data.budget) continue;
    const key = String(e.data.motive ?? "");
    const rank = MOTIVE_RANK.indexOf(key);
    const card = PERSONAS.find((p) => p.id === e.actor)?.card;
    if (rank < 0 || !card) continue;
    // undiscovered lines first (+10 for ones already in the journal), then the most telling
    const score = rank + (known.has(`${e.actor}.${key}`) ? 10 : 0);
    if (score >= bestScore) continue;
    const field = (({ want: "wants", fear: "fears" }) as Record<string, string>)[key] ?? key;
    bestScore = score;
    best = { npc: e.actor, key: key as Exclude<Motive, "none">, label: MOTIVE_LABEL[key], text: String(card[field as keyof typeof card]), event: e.id, t: e.t };
  }
  return best;
}

// the big move a near miss could have made, as "could …" words
const CANCEL = "cancel the Lantern Festival";
const DISPATCH = "send the police";
const POST = "post it on the news blog";
const CLOSE_STAGE = "close the stage";
const IMPACT: Record<string, string> = {
  mayor: CANCEL,
  police: DISPATCH,
  journalist: POST,
  organizer: CLOSE_STAGE,
};
// the officer seals the stage over a stage rumour, else dispatches
const couldOf = (npc: string, topic: string) => (npc === "police" && topic === "stage_unsafe" ? CLOSE_STAGE : IMPACT[npc]);
// the logged event of each big move (to tell whether somebody already made it)
const MOVE: Record<string, { type: string; key?: string }> = {
  [CANCEL]: { type: "state", key: "festival" },
  [DISPATCH]: { type: "state", key: "police" },
  [POST]: { type: "article" },
  [CLOSE_STAGE]: { type: "state", key: "stage" },
};
// the kinds of belief that would justify that big move (a budget scandal is no reason to cancel a festival)
const IMPACT_ON: Record<string, string[]> = {
  mayor: ["safety", "event", "health", "crime"],
  police: ["safety", "crime"],
  journalist: ["safety", "crime", "scandal", "policy", "health", "event"],
  organizer: ["safety"],
};
// what a near miss did instead, as "chose to …" words
const DID: Record<string, string> = {
  phone: "call someone",
  tell: "go tell someone",
  ask: "go ask someone",
  go_look: "go see for themselves",
  inspect: "inspect it in person",
  post_notice: "put up a notice",
  public_statement: "make a statement",
};

/** Consequence rank of an event (higher = bigger). */
function rank(e: SimEvent): number {
  const d = e.data as Record<string, unknown>;
  if (e.type === "state") {
    const key = String(d.key ?? "");
    if (key === "festival") return 9;
    if (key === "police" || key === "stage") return 8;
    // opening again only undoes a closing: it is no happening of its own
    if (key.startsWith("shops.")) return d.to === "closed" ? 5 : 0;
    return 0;
  }
  if (e.type === "article" || e.type === "statement" || e.type === "gather") return 7;
  if (e.type === "notice") return 6;
  if ((e.type === "inspect" || e.type === "look") && d.found) return 2;
  if ((e.type === "talk" || e.type === "phone") && !d.missed) return 1;
  return 0;
}

// a retelling's units: characters of a Chinese one, words of an English one
const unitsOf = (s: string) => (isChinese(s) ? [...s] : (s.toLowerCase().match(/[a-z0-9%']+/g) ?? []));
function similarity(a: string, b: string) {
  // share of the units of b found, in order, in a (LCS / |b|)
  const x = unitsOf(a);
  const y = unitsOf(b);
  const n = x.length;
  const m = y.length;
  if (!m) return 1;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0] / m;
}

export function storyOf(run: RunResult): StoryCard {
  const events = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const byId = new Map(events.map((e) => [e.id, e]));
  const decisionOf = (id: unknown) => run.decisions.find((d) => d.id === id);
  // the planted sentence, and any One more line after it: every seed is a root of the story
  const seeds = events.filter((e) => e.type === "seed");
  const seedIds = new Set(seeds.map((e) => e.id));
  const seed = seeds[0];
  const seedNpc = run.config.seedNpc;
  const seedText = run.config.seedText;

  // what a speaker had heard: the newest message in the inbox of the decision behind this event
  const decisionBehind = (e: SimEvent) => {
    let frontier = [e];
    for (let k = 0; k < 6 && frontier.length; k++) {
      const next: SimEvent[] = [];
      for (const x of frontier) {
        if (x.type === "decide") return decisionOf(x.data.decision) ?? null;
        for (const c of x.causes) {
          const y = byId.get(c);
          if (y) next.push(y);
        }
      }
      frontier = next;
    }
    return null;
  };
  const heardBy = (e: SimEvent) => {
    const dec = decisionBehind(e);
    if (!dec) return undefined;
    return events
      .filter((x) => x.type === "deliver" && dec.inbox.includes(String(x.data.message)) && x.data.via !== "inspection" && x.data.via !== "meet" && !(x.data.via === "crowd" && !(x.data.claims as string[] | undefined)?.length))
      .map((x) => String(x.data.text))
      .at(-1);
  };
  // what the listener made of THIS message: the belief formed by the decision whose inbox held it (`to`: whose
  // reading, for words that reached many; `about`: only a belief in a claim it accepts)
  const verdictOf = (hop: SimEvent, to?: string, about?: (claim: unknown) => boolean): { verdict?: string; conf?: number } => {
    const del = hop.type === "deliver" ? hop : events.find((x) => x.type === "deliver" && x.causes[0] === hop.id && (!to || x.target === to));
    const dec = del && run.decisions.find((d) => d.inbox.includes(String(del.data.message)));
    const dEv = dec && events.find((x) => x.type === "decide" && x.data.decision === dec.id);
    const b = dEv && events.find((x) => x.type === "belief" && x.causes.includes(dEv.id) && (!about || about(x.data.claim)));
    return b ? { verdict: String(b.data.verdict), conf: Number(b.data.to) } : {};
  };
  const hopOf = (e: SimEvent): Hop => ({ from: e.actor!, to: e.target!, via: e.type as "talk" | "phone", text: String(e.data.text), heard: heardBy(e), t: e.t, event: e.id, ...verdictOf(e) });
  const hops = events.filter((e) => (e.type === "talk" || e.type === "phone") && !e.data.missed && e.actor && e.target).map(hopOf);
  const claimOf = (id: unknown) => (run.claims ?? []).find((c) => c.id === id);
  // what each listener first made of a planted sentence (the first one, and any One more line)
  // claims record the message that triggered the decision as their origin
  const firstDecides = seeds
    .map((s) => events.find((e) => e.type === "decide" && e.actor === s.target && e.t >= s.t && !e.data.budget))
    .filter((e): e is SimEvent => !!e);
  const seedClaims = (run.claims ?? []).filter((c) => firstDecides.some((d) => c.by === d.actor && (c.origin === d.id || d.causes.includes(c.origin))));
  // what the story is about: the planted topic, and the topic most people ended up on
  const storyTopics = new Set<string>(seedClaims.map((c) => c.topic));
  {
    const counts = new Map<string, Set<string>>();
    for (const c of run.claims ?? []) if (c.topic !== "other") (counts.get(c.topic) ?? counts.set(c.topic, new Set()).get(c.topic)!).add(c.by);
    const dom = [...counts.entries()].sort((x, y) => y[1].size - x[1].size)[0];
    if (dom) storyTopics.add(dom[0]);
  }
  const storyFacts = new Set([...storyTopics].map((t) => topicFact(t)).filter(Boolean) as string[]);
  // the checkable fact a sight shows, if any (in either wording)
  const factIn = (p: string) => FACTS.find((f) => f.check && checkIn(f, p));
  // of all a look showed, the part that matters: a hidden problem only an expert finds; else the sight that was on
  // their mind (the engine's highlight, when it is one; a log from before it has none, so: a check of something the
  // story is about); else what a glance could not show them; else the first. An old log's first is often a check of
  // something else (the pigeon cages under a stage story: C1v16 stage-cafe): then the first sight that is no check
  // and no list of who was there, or nothing worth a step
  const sightOf = (e: SimEvent): string | undefined => {
    const found = String(e.data.found);
    const parts = partsOf(found);
    const old = e.data.highlight === undefined;
    const place = String(e.place);
    const expert = parts.find((p) => factIn(p)?.check?.by === "expert");
    const onMind = parts.find((p) => factIn(p) && (p === e.data.highlight || (old && storyFacts.has(factIn(p)!.id))));
    const limit = parts.find((p) => p === LOOK_LIMITS[place] || p === LEGACY_LIMITS[place] || p.includes("isn't your trade") || p.includes("不是你的專業"));
    return expert ?? onMind ?? limit ?? (old ? parts.find((p) => !factIn(p) && !hereLine(p)) : (parts[0] ?? found));
  };
  // a step of a causal path a reader can follow (`next`: the event after it on the path; `seen`: for a look, the
  // sight to tell): a retelling; words made public, with the one on the path who took them in; talk of the town that
  // reached someone (a closing noticed, a rumour many repeat); or what someone saw with their own eyes
  const stepOf = (e: SimEvent, next?: SimEvent, seen?: string): Hop | null => {
    const d = e.data as Record<string, unknown>;
    if ((e.type === "talk" || e.type === "phone") && !d.missed && e.actor && e.target) return hopOf(e);
    if ((e.type === "article" || e.type === "notice" || e.type === "statement") && e.actor && next?.type === "deliver" && next.target)
      return { from: e.actor, to: next.target, via: e.type, text: String(e.type === "article" ? d.headline : d.text), heard: heardBy(e), t: e.t, event: e.id, ...verdictOf(e, next.target) };
    // (a statement passed on by the crowd is the statement's step above)
    if (e.type === "deliver" && d.via === "crowd" && e.target && byId.get(e.causes[0])?.type !== "statement")
      return { from: String(d.from ?? "crowd"), to: e.target, via: "crowd", text: String(d.text), t: e.t, event: e.id, ...verdictOf(e) };
    if ((e.type === "look" || e.type === "inspect") && d.found && e.actor) {
      const text = seen ?? sightOf(e);
      if (!text) return null;
      // what they made of it: their belief in a claim that says what they saw. The same look often drops the
      // opposite rumour too, and that "doesn't believe 0%" under the loose strut they had just found read as
      // doubting their own eyes (P20 wobble-organizer). A sight that shows no fact gets no pill.
      const f = factIn(text);
      const saysIt = (c: unknown) => ((x) => !!f && x?.fact === f.id && x.asserts === f.value)(claimOf(c));
      return { from: e.actor, to: e.actor, via: e.type, text, t: e.t, event: e.id, ...(f ? verdictOf(e, e.actor, saysIt) : {}) };
    }
    return null;
  };
  // the path of recorded causes from a planted sentence to `out`, as the steps of it a reader can follow (`seen`:
  // the sight to tell for `out` itself, when the headline names it). Only that path: every step a recorded cause,
  // so never later than `out` (a chain once borrowed whatever talk there was, a call made after the rally it "led
  // to": P20 budget-journalist). The same person seeing the same thing again adds nothing.
  const chainTo = (out: SimEvent, seen?: string): { spine: Hop[]; root?: SimEvent; traced: boolean } => {
    const prev = new Map<string, string>();
    const queue = [out.id];
    const visited = new Set(queue);
    let from: SimEvent | undefined;
    while (queue.length) {
      const id = queue.shift()!;
      if (seedIds.has(id)) {
        from = byId.get(id);
        break;
      }
      for (const c of byId.get(id)?.causes ?? []) if (!visited.has(c)) (visited.add(c), prev.set(c, id), queue.push(c));
    }
    const path: SimEvent[] = [];
    if (from) for (let id: string | undefined = from.id; id; id = prev.get(id)) path.push(byId.get(id)!);
    const steps: Hop[] = [];
    for (const [i, e] of path.entries()) {
      const h = e.t <= out.t ? stepOf(e, path[i + 1], e === out ? seen : undefined) : null;
      if (!h) continue;
      if (h.via === "look" || h.via === "inspect") {
        const twin = steps.findIndex((x) => (x.via === "look" || x.via === "inspect") && x.from === h.from && x.text === h.text);
        if (twin >= 0 && e !== out) continue;
        // the look the headline names stays: an earlier identical one gives way
        if (twin >= 0) steps.splice(twin, 1);
      }
      steps.push(h);
    }
    return { spine: steps, root: from ?? seed, traced: !!from };
  };

  // where each part of the world stood at the end (its last change): a change undone later (a shop closed, then
  // opened again) did happen, but is never told as where things ended up, and one that held beats it
  const finalOf = new Map<string, unknown>();
  for (const e of events) if (e.type === "state") finalOf.set(String(e.data.key), e.data.to);
  const undone = (e: SimEvent) => e.type === "state" && finalOf.get(String(e.data.key)) !== e.data.to;
  const weight = (e: SimEvent) => rank(e) - (undone(e) ? 0.5 : 0);
  // the biggest real outcome, and the path of causes from the planted sentence to it
  // the biggest happening; among equals the later one, which is usually the outcome (police sent, then the stage
  // closed; a friend's shop shut, then the bakery itself)
  const top = events.reduce<SimEvent | null>((best, e) => (weight(e) > 0 && weight(e) >= (best ? weight(best) : 0) ? e : best), null);
  // `traced`: the outcome goes back to a planted sentence through recorded causes (a talk that does not is no chain
  // of this sentence, so it is not put under it)
  let { spine, root, traced } = top ? chainTo(top) : { spine: [] as Hop[], root: seed, traced: false };

  const reached = [...new Set(events.filter((e) => e.type === "deliver" && e.target && e.data.via !== "inspection").map((e) => e.target!))];
  const wildest = hops
    .filter((h) => h.heard)
    .map((h) => ({ ...h, similarity: similarity(h.heard!, h.text) }))
    .sort((a, b) => a.similarity - b.similarity)[0];

  const whispers = seeds.filter((e) => e.data.second && e.target).map((e) => ({ npc: e.target!, text: String(e.data.text) }));
  const card: StoryCard = { festival: { kind: "on", short: "on", text: "", missing: [] },
    icon: "💬", headline: "", sub: "", spine, outcome: top?.id, reached, wildest: wildest && wildest.similarity < 0.55 ? wildest : undefined,
    whispers, spineRoot: root ? Math.max(0, seeds.indexOf(root)) : 0,
  };
  const pulledIn = `${plural(reached.length, "person", "people")} got pulled in`;

  // topic drift: what the seed listener made of the sentence vs. what most people ended up holding beliefs about
  const claims = run.claims ?? [];
  const seedTopics = new Set(seedClaims.map((c) => c.topic));
  const people = new Map<string, Set<string>>();
  for (const c of claims) {
    if (!people.has(c.topic)) people.set(c.topic, new Set());
    people.get(c.topic)!.add(c.by);
  }
  const dominant = [...people.entries()].filter(([t]) => t !== "other").sort((a, b) => b[1].size - a[1].size)[0];
  // a different topic id is not drift if the player's own sentence already said it ("over budget, and the fee went
  // up to plug the hole" has two topics): most of the claim's pieces are in what the player said (two-character
  // pieces of a Chinese claim, the words of an English one)
  const saidByPlayer = (statement: string) => {
    const said = [run.config.seedText ?? "", ...whispers.map((w) => w.text)].join(" ");
    if (isChinese(statement)) {
      const grams = [...statement.replace(/[，。！？、「」\s]/g, "")].map((ch, i, a) => ch + (a[i + 1] ?? "")).slice(0, -1);
      return grams.length > 0 && grams.filter((g) => said.includes(g)).length / grams.length >= 0.5;
    }
    const mine = new Set(wordsOf(said));
    const words = wordsOf(statement);
    return words.length > 0 && words.filter((w) => mine.has(w)).length / words.length >= 0.5;
  };
  const firstOfDominant = dominant ? claims.find((c) => c.topic === dominant[0]) : undefined;
  if (dominant && dominant[1].size >= 2 && !seedTopics.has(dominant[0]) && firstOfDominant && !saidByPlayer(firstOfDominant.statement)) {
    const first = firstOfDominant;
    // the first retelling on the way from the planted sentence to that first claim is where the talk turned
    const origin = byId.get(first.origin);
    let pivot: Hop | undefined;
    if (origin && seed) {
      const prev = new Map<string, string>();
      const queue = [origin.id];
      const seen = new Set(queue);
      let from = seed.id;
      while (queue.length) {
        const id = queue.shift()!;
        if (seedIds.has(id)) {
          from = id;
          break;
        }
        for (const c of byId.get(id)?.causes ?? []) if (!seen.has(c)) (seen.add(c), prev.set(c, id), queue.push(c));
      }
      for (let id: string | undefined = from; id; id = prev.get(id)) {
        const e = byId.get(id);
        // keep the last one: the retelling the new topic's first holder heard right before deciding
        if (e && (e.type === "talk" || e.type === "phone") && !e.data.missed) pivot = hopOf(e);
      }
    }
    card.drift = { from: seedText, to: first.statement, pivot };
  }
  // the most telling first-hand check: someone went to look and the engine showed them the real state of
  // something the story is about (the planted topic, the topic most people ended up on, or what they believed)
  let checked: { e: SimEvent; text: string; dir: "up" | "down"; coverUp: boolean } | null = null;
  const seedFacts = new Set(seedClaims.map((c) => topicFact(c.topic)).filter(Boolean) as string[]);
  const aboutSeed = (e: SimEvent) => {
    const found = String(e.data.found ?? "");
    return FACTS.some((f) => f.check && seedFacts.has(f.id) && checkIn(f, found)) || (NOTHING.test(found) && e.actor === seedNpc);
  };
  const looks = events.filter((x) => x.type === "inspect" || x.type === "look");
  // checks about what the player said first, then expert inspections, then the rest
  looks.sort((x, y) => Number(aboutSeed(y)) - Number(aboutSeed(x)) || (x.type === "inspect" ? -1 : 0) - (y.type === "inspect" ? -1 : 0));
  for (const e of looks) {
    const found = String(e.data.found ?? "");
    if (!found) continue;
    const fact = FACTS.find((f) => f.check && storyFacts.has(f.id) && checkIn(f, found));
    const nothing = NOTHING.test(found);
    if (!fact && !nothing) continue;
    const before = events.filter((x) => x.type === "belief" && x.actor === e.actor && x.t < e.t).at(-1);
    const after = before && events.find((x) => x.type === "belief" && x.actor === e.actor && x.t >= e.t && x.data.claim === before.data.claim);
    // a true hidden fact seen with their own eyes is a finding, whichever of their beliefs it lowered (Chief Zhou
    // doubting Zhiming's "the stage is fine" after seeing the strut is not "nothing found" — P12)
    const dir: "up" | "down" =
      fact && fact.value ? "up" : nothing || (fact && !fact.value) || (before && after && Number(after.data.to) < Number(before.data.to) - 0.1) ? "down" : "up";
    if (nothing && !(before && Number(before.data.to) >= 0.3)) continue; // finding nothing only matters if they had something to check
    const coverUp = hops.some((h) => COVER_UP.test(h.text));
    // the sight in the words the log has (an older log has the Chinese wording of the same check)
    checked = { e, text: fact ? checkIn(fact, found)! : partsOf(found)[0], dir, coverUp };
    break;
  }
  // a hidden truth someone dug up while checking something else ("went to check the car, found the overrun"):
  // an expert inspection that showed a true fact nobody in this story had been talking about
  let discovery: { e: SimEvent; fact: (typeof FACTS)[number]; seen: string } | null = null;
  for (const e of events.filter((x) => x.type === "inspect" && x.data.found)) {
    const fact = FACTS.find((f) => f.value && f.check?.by === "expert" && !storyFacts.has(f.id) && checkIn(f, String(e.data.found)));
    if (fact) {
      discovery = { e, fact, seen: checkIn(fact, String(e.data.found))! };
      break;
    }
  }
  const d = (top?.data ?? {}) as Record<string, unknown>;
  const actor = top?.actor ? nameOf(top.actor) : "";
  // retellings only: a look or an article on the way is no retelling
  const hopsN = spine.filter((h) => h.via === "talk" || h.via === "phone").length;
  const via = hopsN ? ` after ${plural(hopsN, "retelling")}` : "";
  // earlier big happenings that led to this one (causal ancestors in the log), so "police at the takoyaki stall"
  // says why: "First Xiaowen posted “…”, then Chief Zhou sent officers."
  const before: SimEvent[] = [];
  if (top) {
    const seen = new Set([top.id]);
    const queue = [...top.causes];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = byId.get(id);
      if (!e) continue;
      if (rank(e) >= 5) before.push(e);
      queue.push(...e.causes);
    }
    before.sort((x, y) => x.t - y.t);
  }
  const happened = (e: SimEvent) => {
    const x = e.data as Record<string, unknown>;
    const who = e.actor ? nameOf(e.actor) : "";
    if (e.type === "article") return `${who} posted “${clipS(String(x.headline ?? ""), 40)}”`;
    if (e.type === "statement") return `${who} made a statement`;
    if (e.type === "gather") return `${who} rallied the stall owners`;
    if (e.type === "notice") return `${who} put up a notice`;
    if (e.type === "state" && x.key === "stage") return `${who} closed the stage`;
    if (e.type === "state" && x.key === "police") return `${who} sent officers to ${placeZh(String(x.to))}`;
    if (e.type === "state" && String(x.key).startsWith("shops.")) return `${who} ${undone(e) ? "closed up for a while" : "closed up shop"}`;
    return "";
  };
  // the causal subtitle: "First …, then …, and finally …." (at most the two latest happenings before the outcome)
  const chainOf = (last: string) => {
    const prev = before.map(happened).filter(Boolean).slice(-2);
    if (prev.length === 2) return `First ${prev[0]}, then ${prev[1]}, and finally ${last}.`;
    if (prev.length === 1) return `First ${prev[0]}, and then ${last}.`;
    return `${cap(last)}${via}.`;
  };
  // the happening the headline reports: the outcome, or the one look a 🔍 headline is about (and the sight it names)
  let told: SimEvent | undefined = top && rank(top) >= 5 ? top : undefined;
  let toldSeen: string | undefined;
  if (top && rank(top) >= 5) {
    const shop = cap(placeZh(String(d.key).slice(6)));
    const started = !traced ? "" : whispers.length ? " It all started with what you whispered." : ` It all started with one sentence you told ${nameOf(seedNpc)}.`;
    if (top.type === "state" && d.key === "festival") Object.assign(card, { icon: "🏮", headline: "Lantern Festival called off!", sub: `${actor} called it off${via}.${started}` });
    else if (top.type === "state" && d.key === "stage") Object.assign(card, { icon: "🚧", headline: "Festival stage sealed off", sub: chainOf(`${actor} ordered the stage closed`) });
    else if (top.type === "state" && d.key === "police") Object.assign(card, { icon: "🚓", headline: `Police called out to ${placeZh(String(d.to))}`, sub: chainOf(`${actor} sent officers`) });
    // closed, then opened again: the shop is open at the end, so the headline says both
    else if (top.type === "state" && undone(top)) Object.assign(card, { icon: "🚪", headline: `${shop} closed, then opened again`, sub: chainOf(`${actor} closed up for a while, then opened again`) });
    else if (top.type === "state") Object.assign(card, { icon: "🔒", headline: `${shop} shuts its doors`, sub: chainOf(`${actor} decided to close up`) });
    else if (top.type === "article") Object.assign(card, { icon: "📰", headline: `“${String(d.headline)}”`, sub: `${actor} wrote it up as news${via}.` });
    else if (top.type === "statement") Object.assign(card, { icon: "📣", headline: `${actor} goes public with a statement`, sub: `“${clipS(String(d.text), 100)}”` });
    else if (top.type === "gather") Object.assign(card, { icon: "✊", headline: "Stall owners rally for a fair deal", sub: chainOf(`${actor} called everyone together`) });
    else if (top.type === "notice") Object.assign(card, { icon: "📋", headline: "A notice goes up on the plaza board", sub: `“${clipS(String(d.text), 100)}”` });
  } else if (discovery && (!checked || checked.dir === "down")) {
    const found = discovery;
    const who = nameOf(found.e.actor!);
    [told, toldSeen] = [found.e, found.seen];
    const wondering = events.filter((x) => x.type === "belief" && x.actor === found.e.actor && x.t <= found.e.t).at(-1);
    // what they had been trying to settle: the claim of their latest belief (older logs: from the belief's line)
    const meant = wondering && (claimOf(wondering.data.claim)?.statement ?? (/對「(.+?)」的信心|confidence in “(.+?)”/.exec(wondering.zh) ?? []).slice(1).find(Boolean));
    Object.assign(card, {
      icon: "🔍",
      headline: `${who} set out to check one thing and found another: ${clipS(found.fact.zh.replace(/\.$/, ""), 84)}`,
      sub: `${meant ? `${who} was trying to get to the bottom of “${clipS(meant, 56)}”. ` : ""}At ${placeZh(String(found.e.place))}: “${clipS(found.seen, 100)}”`,
    });
  } else if (checked) {
    // no world change, but someone went and saw the truth for themselves: that is the payoff
    const who = nameOf(checked.e.actor!);
    [told, toldSeen] = [checked.e, checked.text];
    Object.assign(card, {
      icon: "🔍",
      headline: checked.dir === "down" ? `${who} went and checked: no sign of it` : `${who} went and checked: ${clipS(checked.text, 90)}`,
      sub:
        checked.dir === "down"
          ? `“${clipS(checked.text, 100)}”`
          : checked.coverUp
            ? "Someone was in a hurry to hush it up, but the truth has already been seen."
            : `${cap(pulledIn)}, but nobody has made a big move yet.`,
    });
  } else if (card.drift && reached.length >= 3) {
    Object.assign(card, {
      icon: "🔀",
      headline: `You said “${clipS(seedText, 28)}”; by the end the town was talking about “${clipS(card.drift.to, 36)}”`,
      sub: card.drift.pivot
        ? `The talk took a turn when ${nameOf(card.drift.pivot.from)} told ${nameOf(card.drift.pivot.to)} “${clipS(card.drift.pivot.text, 44)}”.`
        : `${cap(pulledIn)}.`,
    });
  } else if (reached.length >= 3) {
    Object.assign(card, { icon: "💬", headline: `One sentence pulled ${reached.length} people in`, sub: "The whole town is buzzing, but nobody has done anything big yet." });
  }
  // a 🔍 headline is about that one look: the chain leads to it, not on to whatever was said or seen last
  // ("Xiaowen went and checked: no sign of it" at 24.7 over a chain running on to 41.1: B1 fee-journalist)
  if (told && told !== top) {
    ({ spine, root, traced } = chainTo(told, toldSeen));
    Object.assign(card, { spine, outcome: told.id, spineRoot: root ? Math.max(0, seeds.indexOf(root)) : 0 });
  }
  // nothing on record a reader can follow from what the player said to what the headline reports (no path of causes
  // at all, or one that shows nobody passing anything on while someone else did it): say so rather than fill the
  // chain. A headline that reports no result does not get one named here.
  if (told && (!traced || (!spine.length && told.actor !== root?.target && !before.some(happened))))
    card.chainGap = "The log shows no clear line of cause and effect from your sentence to this result.";
  else if (top && !told && !traced) card.chainGap = "The log shows no clear trail of your sentence being passed along.";

  if (!card.headline) {
    // the rumour died: name who it stopped with, in their own words
    const lastDec = [...run.decisions].reverse().find((x) => x.output && x.npc);
    const stop = lastDec?.output;
    if (lastDec?.fallback) {
      // the model gave no valid answer: say so instead of inventing a reaction for the resident
      Object.assign(card, { icon: "⚠️", headline: `The story broke off with ${nameOf(lastDec.npc)}`, sub: "The model gave no valid answer, so the engine fell back to a safe default and let nothing happen." });
    } else if (lastDec && stop) {
      // where they ended up: their latest stored belief, not just the last decision's
      const lastB = events.filter((x) => x.type === "belief" && x.actor === lastDec.npc).at(-1);
      const b = lastB ? { verdict: String(lastB.data.verdict), conf: Number(lastB.data.to) } : {};
      card.stopper = { npc: lastDec.npc, thought: stop.thought, ...b };
      const dismissive = !b.conf || b.conf < 0.35;
      // the same two people talking it over is not spreading: say so instead of "didn't tell anyone"
      const talkers = new Set(hops.flatMap((h) => [h.from, h.to]));
      const bounced = hops.length >= 2 && talkers.size === 2;
      const [p1, p2] = [...talkers];
      const toldSomeone = hops.some((h) => h.from === lastDec.npc);
      // they wanted to do something big and the rules stopped them: that is the ending, in the log's words
      const wanted = events.filter((x) => x.type === "rejected" && x.data.wanted && x.actor === lastDec.npc).at(-1);
      const npc = nameOf(lastDec.npc);
      Object.assign(card, {
        icon: bounced ? "🔁" : !lastB ? "❓" : dismissive ? "🧱" : "🤐",
        headline: bounced
          ? `It bounced between ${nameOf(p1)} and ${nameOf(p2)} and went no further`
          : !lastB
            ? `${npc} couldn't make heads or tails of it and let it go`
            : dismissive
              ? `The rumor hit a brick wall with ${npc}`
              : toldSomeone
                ? `${npc} passed it on, and that was the end of it`
                : `${npc} took it in, but didn't tell a soul`,
        sub: `“${stop.thought}”`,
      });
      if (wanted) Object.assign(card, { icon: "✋", headline: wanted.zh });
    } else Object.assign(card, { icon: "🍃", headline: "Your sentence didn't make a single ripple", sub: "" });
  }

  // the reveal: what was actually true about the topic the player raised (from the world's authored facts)
  // (if the first listener passed it on without stating a claim, the first claim anyone made is what it became)
  const seedFact = (seedClaims.length ? seedClaims : claims.slice(0, 1)).map((c) => topicFact(c.topic)).find(Boolean);
  const fact = seedFact ? FACTS.find((f) => f.id === seedFact) : undefined;
  if (fact && !fact.public) {
    card.truth = {
      text: fact.value ? fact.zh : (fact.notZh ?? `Not true: ${fact.zh}`),
      value: fact.value,
      secretOf: PERSONAS.filter((p) => p.secrets.includes(fact.id)).map((p) => p.id),
    };
  }

  // the closest call: someone who could have done something big, and what they ended up doing — the one who was
  // surest (a fixed order once picked the mayor at 0.6 over the officer at 0.98 who had seen the loose strut)
  const catOf = (cid: string) => { const c = claims.find((y) => y.id === cid); return c ? (TOPIC_CATEGORY[c.topic] ?? c.category) : undefined; };
  let near: { npc: string; conf: number; topic: string; did: string } | null = null;
  for (const npc of ["mayor", "police", "journalist", "organizer"]) {
    if (!reached.includes(npc) && seedNpc !== npc) continue;
    const decs = run.decisions.filter((x) => x.npc === npc && x.output && !x.fallback);
    if (!decs.length) continue;
    if (events.some((e) => e.actor === npc && rank(e) >= 5)) continue;
    // their final belief on each claim, kept only where it is of a kind that would justify the move, and strong:
    // ≥0.6, the same bar as the on-screen "can …?" suspense chip — a 45% hunch is not a near miss
    const finalB = new Map<string, number>();
    for (const x of events) if (x.type === "belief" && x.actor === npc) finalB.set(String(x.data.claim), Number(x.data.to));
    const strong = [...finalB].filter(([cid, conf]) => conf >= 0.6 && IMPACT_ON[npc].includes(String(catOf(cid)))).sort((x, y) => y[1] - x[1]);
    if (!strong.length || (near && near.conf >= strong[0][1])) continue;
    // a move somebody else already made is no near miss ("could have closed the stage" while it is taped off)
    const topic = claims.find((y) => y.id === strong[0][0])?.topic ?? "";
    const move = MOVE[couldOf(npc, topic)];
    if (move && events.some((e) => e.type === move.type && (!move.key || e.data.key === move.key))) continue;
    const last = decs.flatMap((x) => x.output!.actions).filter((a) => a.type !== "none").at(-1);
    const did = last ? DID[last.type] ?? "do something else" : "do nothing";
    near = { npc, conf: strong[0][1], topic, did };
  }
  if (near) card.closest = { npc: near.npc, could: couldOf(near.npc, near.topic), did: near.did, conf: near.conf };
  card.reveal = revealOf(events);
  card.festival = readinessOf(events, run.claims ?? []).outcome;
  return card;
}

export interface Suggestion {
  npc: string;
  /** why this person, in terms of what they are able to do (never a predicted outcome) */
  why: string;
}

/**
 * Two people worth telling next, from this run's log only: the near miss's closest phone contact (one call from
 * someone who almost acted), else whoever could amplify it and has not heard it yet. Never predicts an ending.
 */
export function suggestNext(run: RunResult, card: StoryCard = storyOf(run)): Suggestion[] {
  const seedNpc = run.config.seedNpc;
  const active = new Set(run.config.active);
  const heard = new Set([...card.reached, seedNpc, ...card.whispers.map((w) => w.npc)]);
  const out: Suggestion[] = [];
  const add = (npc: string | undefined, why: string) => {
    if (npc && active.has(npc) && npc !== seedNpc && !out.some((o) => o.npc === npc)) out.push({ npc, why });
  };
  if (card.closest) {
    const near = card.closest.npc;
    add(contactsOf(near).find((c) => c !== seedNpc && active.has(c)), `${nameOf(near)}'s closest contact, one phone call away`);
  }
  // amplifiers (public moves) and hubs (many phone contacts) who have not heard it yet, most reach first
  // a public move (news, police, stage, rally…) reaches more people than closing one's own shop
  const reach = (npc: string) => contactsOf(npc).length + (!powerOf(npc).length ? 0 : powerOf(npc)[0] === TOOL.close_shop ? 1 : 3);
  const fresh = [...active].filter((n) => !heard.has(n)).sort((a, b) => reach(b) - reach(a));
  for (const n of fresh) {
    const power = powerOf(n)[0];
    add(n, power ? `hasn't heard it yet; ${canDo(power)}` : `hasn't heard it yet; can call ${plural(contactsOf(n).length, "person", "people")}`);
  }
  // everyone has heard it: someone with a public move, then anyone
  for (const n of [...active].sort((a, b) => reach(b) - reach(a))) add(n, powerOf(n)[0] ? canDo(powerOf(n)[0]) : "a fresh pair of ears");
  return out.slice(0, 2);
}
