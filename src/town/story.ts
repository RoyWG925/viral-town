// Turns a finished run's log into the story the results card tells: a headline for the biggest thing
// that really happened (as things stood at the end), the chain of recorded causes that led there ("the
// spine": retellings, public words, what people saw), who stopped the rumour when it died, and the wildest
// retelling. Built only from recorded, validated events and fixed templates — no model writes or embellishes it.
import type { RunResult } from "../sim/engine.ts";
import { FACTS, LOOK_LIMITS, PERSONAS, PLACES, TOPIC_CATEGORY } from "../sim/scenario.ts";
import { topicFact } from "../sim/view.ts";
import { readinessOf } from "../sim/readiness.ts";
import type { Motive, SimEvent } from "../sim/types.ts";
import { contactsOf, powerOf } from "./roles.ts";

const nameOf = (id: string) => PERSONAS.find((p) => p.id === id)?.name ?? id;
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;

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
  /** someone who could have done something big, and what they actually did */
  closest?: { npc: string; could: string; did: string; conf?: number };
  /** the retelling that drifted furthest from what was heard */
  wildest?: Hop & { similarity: number };
  /** the world's actual truth about what the player said (authored fact), and whose secret it was */
  truth?: { text: string; value: boolean; secretOf: string[] };
  /** the town ended up talking about something else than the planted sentence: from what, to what, and where it turned */
  drift?: { from: string; to: string; pivot?: Hop };
  reached: string[];
  /** the extra sentence(s) the player added at a lull (補一句): a second root of the story */
  whispers: { npc: string; text: string }[];
  /** which planted sentence the spine starts from (0 = the first, 1 = the 補一句) */
  spineRoot: number;
  /** how the festival went at 20:00, from the readiness meters (a rule over the log; never a model call) */
  festival: { kind: "on" | "reduced" | "postponed" | "cancelled"; short: string; text: string; missing: string[] };
  /** one line of someone's card this story showed them acting on (from their own logged motive) */
  reveal?: { npc: string; key: Exclude<Motive, "none">; label: string; text: string; event: string; t: number };
}

const STEP_ICON: Record<Hop["via"], string> = { talk: "💬", phone: "📞", article: "📰", notice: "📋", statement: "📣", crowd: "🗣️", look: "👀", inspect: "🔍" };
/** How a step of the chain reads on a card: icon and who (→ whom), then the words, headline or sight, cut to `n`. */
export function stepLine(h: Hop, n = Infinity): { who: string; words: string } {
  const text = h.text.length > n ? `${h.text.slice(0, n)}…` : h.text;
  const from = h.via === "crowd" ? "鎮上傳開" : nameOf(h.from);
  return {
    who: `${STEP_ICON[h.via] ?? "💬"} ${from}${h.to !== h.from ? `→${nameOf(h.to)}` : ""}`,
    words: h.via === "article" ? `〈${text}〉` : h.via === "look" || h.via === "inspect" ? `看到：${text}` : h.via === "crowd" ? text : `「${text}」`,
  };
}

const MOTIVE_LABEL: Record<string, string> = { price: "價碼", bottom: "底線", fear: "怕的事", want: "今晚想要的", bias: "看事情的偏誤", gossip: "傳話的習慣" };
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

const IMPACT: Record<string, string> = {
  mayor: "宣布取消燈籠節",
  police: "派警力",
  journalist: "在新聞部落格發文",
  organizer: "封鎖舞台",
};
// the big move a near miss could have made: the officer seals the stage over a stage rumour, else dispatches
const couldOf = (npc: string, topic: string) => (npc === "police" && topic === "stage_unsafe" ? "封鎖舞台" : IMPACT[npc]);
// the logged event of each big move (to tell whether somebody already made it)
const MOVE: Record<string, { type: string; key?: string }> = {
  宣布取消燈籠節: { type: "state", key: "festival" },
  派警力: { type: "state", key: "police" },
  在新聞部落格發文: { type: "article" },
  封鎖舞台: { type: "state", key: "stage" },
};
// the kinds of belief that would justify that big move (a budget scandal is no reason to cancel a festival)
const IMPACT_ON: Record<string, string[]> = {
  mayor: ["safety", "event", "health", "crime"],
  police: ["safety", "crime"],
  journalist: ["safety", "crime", "scandal", "policy", "health", "event"],
  organizer: ["safety"],
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

function similarity(a: string, b: string) {
  // share of characters of b found, in order, in a (LCS / |b|)
  const n = a.length;
  const m = b.length;
  if (!m) return 1;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0] / m;
}

export function storyOf(run: RunResult): StoryCard {
  const events = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const byId = new Map(events.map((e) => [e.id, e]));
  const decisionOf = (id: unknown) => run.decisions.find((d) => d.id === id);
  // the planted sentence, and any 補一句 after it: every seed is a root of the story
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
  // what each listener first made of a planted sentence (the first one, and any 補一句)
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
  // the checkable fact a sight shows, if any
  const factIn = (p: string) => FACTS.find((f) => f.check && p.includes(f.check.zh));
  // of all a look showed, the part that matters: a hidden problem only an expert finds; else the sight that was on
  // their mind (the engine's highlight, when it is one; a log from before it has none, so: a check of something the
  // story is about); else what a glance could not show them; else the first. An old log's first is often a check of
  // something else (the pigeon cages under a stage story: C1v16 stage-cafe): then the first sight that is no check
  // and no list of who was there, or nothing worth a step
  const sightOf = (e: SimEvent): string | undefined => {
    const found = String(e.data.found);
    const parts = found.split(/\s+/).filter(Boolean);
    const old = e.data.highlight === undefined;
    const expert = parts.find((p) => factIn(p)?.check?.by === "expert");
    const onMind = parts.find((p) => factIn(p) && (p === e.data.highlight || (old && storyFacts.has(factIn(p)!.id))));
    const limit = parts.find((p) => p === LOOK_LIMITS[String(e.place)] || p.includes("不是你的專業"));
    return expert ?? onMind ?? limit ?? (old ? parts.find((p) => !factIn(p) && !p.endsWith("在這裡。")) : (parts[0] ?? found));
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
      // opposite rumour too, and that 「不信 0%」 under the loose strut they had just found read as doubting their own
      // eyes (P20 wobble-organizer). A sight that shows no fact gets no pill.
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
  const card: StoryCard = { festival: { kind: "on", short: "照常", text: "", missing: [] },
    icon: "💬", headline: "", sub: "", spine, outcome: top?.id, reached, wildest: wildest && wildest.similarity < 0.55 ? wildest : undefined,
    whispers, spineRoot: root ? Math.max(0, seeds.indexOf(root)) : 0,
  };

  // topic drift: what the seed listener made of the sentence vs. what most people ended up holding beliefs about
  const claims = run.claims ?? [];
  const seedTopics = new Set(seedClaims.map((c) => c.topic));
  const people = new Map<string, Set<string>>();
  for (const c of claims) {
    if (!people.has(c.topic)) people.set(c.topic, new Set());
    people.get(c.topic)!.add(c.by);
  }
  const dominant = [...people.entries()].filter(([t]) => t !== "other").sort((a, b) => b[1].size - a[1].size)[0];
  // a different topic id is not drift if the player's own sentence already said it ("預算超支，漲價是為了補洞"
  // has two topics): most of the claim's two-character pieces are in what the player said
  const saidByPlayer = (statement: string) => {
    const said = [run.config.seedText ?? "", ...whispers.map((w) => w.text)].join(" ");
    const grams = [...statement.replace(/[，。！？、「」\s]/g, "")].map((ch, i, a) => ch + (a[i + 1] ?? "")).slice(0, -1);
    return grams.length > 0 && grams.filter((g) => said.includes(g)).length / grams.length >= 0.5;
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
  const clipS = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
  let checked: { e: SimEvent; text: string; dir: "up" | "down"; coverUp: boolean } | null = null;
  const seedFacts = new Set(seedClaims.map((c) => topicFact(c.topic)).filter(Boolean) as string[]);
  const aboutSeed = (e: SimEvent) => {
    const found = String(e.data.found ?? "");
    return FACTS.some((f) => f.check && seedFacts.has(f.id) && found.includes(f.check.zh)) || (/一切如常/.test(found) && e.actor === seedNpc);
  };
  const looks = events.filter((x) => x.type === "inspect" || x.type === "look");
  // checks about what the player said first, then expert inspections, then the rest
  looks.sort((x, y) => Number(aboutSeed(y)) - Number(aboutSeed(x)) || (x.type === "inspect" ? -1 : 0) - (y.type === "inspect" ? -1 : 0));
  for (const e of looks) {
    const found = String(e.data.found ?? "");
    if (!found) continue;
    const fact = FACTS.find((f) => f.check && storyFacts.has(f.id) && found.includes(f.check.zh));
    const nothing = /一切如常/.test(found);
    if (!fact && !nothing) continue;
    const before = events.filter((x) => x.type === "belief" && x.actor === e.actor && x.t < e.t).at(-1);
    const after = before && events.find((x) => x.type === "belief" && x.actor === e.actor && x.t >= e.t && x.data.claim === before.data.claim);
    // a true hidden fact seen with their own eyes is a finding, whichever of their beliefs it lowered (老周 doubting
    // 志明's "the stage is fine" after seeing the strut is not "nothing found" — P12)
    const dir: "up" | "down" =
      fact && fact.value ? "up" : nothing || (fact && !fact.value) || (before && after && Number(after.data.to) < Number(before.data.to) - 0.1) ? "down" : "up";
    if (nothing && !(before && Number(before.data.to) >= 0.3)) continue; // finding nothing only matters if they had something to check
    const coverUp = hops.some((h) => /壓下來|壓住|別說|不要說出去|敷衍|私下處理|低調/.test(h.text));
    checked = { e, text: fact ? fact.check!.zh : found.split(/\s+/)[0], dir, coverUp };
    break;
  }
  // a hidden truth someone dug up while checking something else ("went to check the car, found the overrun"):
  // an expert inspection that showed a true fact nobody in this story had been talking about
  let discovery: { e: SimEvent; fact: (typeof FACTS)[number] } | null = null;
  for (const e of events.filter((x) => x.type === "inspect" && x.data.found)) {
    const fact = FACTS.find((f) => f.value && f.check?.by === "expert" && !storyFacts.has(f.id) && String(e.data.found).includes(f.check.zh));
    if (fact) {
      discovery = { e, fact };
      break;
    }
  }
  const d = (top?.data ?? {}) as Record<string, unknown>;
  const actor = top?.actor ? nameOf(top.actor) : "";
  // retellings only: a look or an article on the way is no 轉述
  const hopsN = spine.filter((h) => h.via === "talk" || h.via === "phone").length;
  const via = hopsN ? `，經過 ${hopsN} 次轉述` : "";
  // earlier big happenings that led to this one (causal ancestors in the log), so "police at the takoyaki stall"
  // says why: 「先是小雯發文〈…〉，最後老周派出警力」
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
    if (e.type === "article") return `${who}發文〈${clipS(String(x.headline ?? ""), 16)}〉`;
    if (e.type === "statement") return `${who}發表聲明`;
    if (e.type === "gather") return `${who}號召攤商聚集`;
    if (e.type === "notice") return `${who}貼出公告`;
    if (e.type === "state" && x.key === "stage") return `${who}封鎖了舞台`;
    if (e.type === "state" && x.key === "police") return `${who}派警力到${placeZh(String(x.to))}`;
    if (e.type === "state" && String(x.key).startsWith("shops.")) return `${who}${undone(e) ? "一度關了店" : "關了店"}`;
    return "";
  };
  const chainOf = (last: string) => {
    const prev = before.map(happened).filter(Boolean).slice(-2);
    return prev.length ? `先是${prev.join("，接著")}，最後${last}。` : `${last}${via}。`;
  };
  // the happening the headline reports: the outcome, or the one look a 🔍 headline is about (and the sight it names)
  let told: SimEvent | undefined = top && rank(top) >= 5 ? top : undefined;
  let toldSeen: string | undefined;
  if (top && rank(top) >= 5) {
    if (top.type === "state" && d.key === "festival") Object.assign(card, { icon: "🏮", headline: "燈籠節取消了！", sub: `${actor}宣布取消${via}。${!traced ? "" : whispers.length ? "一切從你悄悄說的話開始。" : `一切從你對${nameOf(seedNpc)}說的一句話開始。`}` });
    else if (top.type === "state" && d.key === "stage") Object.assign(card, { icon: "🚧", headline: "慶典舞台被封鎖", sub: chainOf(`${actor}下令封鎖`) });
    else if (top.type === "state" && d.key === "police") Object.assign(card, { icon: "🚓", headline: `警察出動到${placeZh(String(d.to))}`, sub: chainOf(`${actor}派出警力`) });
    // closed, then opened again: the shop is open at the end, so the headline says both
    else if (top.type === "state" && undone(top)) Object.assign(card, { icon: "🚪", headline: `${placeZh(String(d.key).slice(6))}關了又開`, sub: chainOf(`${actor}一度關店，後來又開門營業`) });
    else if (top.type === "state") Object.assign(card, { icon: "🔒", headline: `${placeZh(String(d.key).slice(6))}暫停營業`, sub: chainOf(`${actor}決定關店`) });
    else if (top.type === "article") Object.assign(card, { icon: "📰", headline: `〈${String(d.headline)}〉`, sub: `${actor}寫成了新聞${via}。` });
    else if (top.type === "statement") Object.assign(card, { icon: "📣", headline: `${actor}出面發表聲明`, sub: `「${String(d.text).slice(0, 40)}」` });
    else if (top.type === "gather") Object.assign(card, { icon: "✊", headline: "攤商聚集討公道", sub: chainOf(`${actor}號召大家`) });
    else if (top.type === "notice") Object.assign(card, { icon: "📋", headline: "廣場布告欄貼出公告", sub: `「${String(d.text).slice(0, 40)}」` });
  } else if (discovery && (!checked || checked.dir === "down")) {
    const who = nameOf(discovery.e.actor!);
    [told, toldSeen] = [discovery.e, discovery.fact.check!.zh];
    const wondering = events.filter((x) => x.type === "belief" && x.actor === discovery!.e.actor && x.t <= discovery!.e.t).at(-1);
    Object.assign(card, {
      icon: "🔍",
      headline: `${who}本來在查別的事，卻查出：${clipS(discovery.fact.zh.replace(/。$/, ""), 18)}`,
      sub: `${wondering ? `原本想弄清楚「${clipS(/對「(.+?)」的信心/.exec(wondering.zh)?.[1] ?? "", 24)}」，` : ""}卻在${placeZh(String(discovery.e.place))}看到：「${clipS(discovery.fact.check!.zh, 40)}」`,
    });
  } else if (checked) {
    // no world change, but someone went and saw the truth for themselves: that is the payoff
    const who = nameOf(checked.e.actor!);
    [told, toldSeen] = [checked.e, checked.text];
    Object.assign(card, {
      icon: "🔍",
      headline: checked.dir === "down" ? `${who}親自去查：查無實據` : `${who}親自查證：${clipS(checked.text, 22)}`,
      sub: checked.dir === "down" ? `「${clipS(checked.text, 40)}」` : checked.coverUp ? "有人急著想把事情壓下來，但真相已經被看見了。" : `${reached.length} 個人被捲了進來，但目前還沒有人採取大動作。`,
    });
  } else if (card.drift && reached.length >= 3) {
    const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
    Object.assign(card, {
      icon: "🔀",
      headline: `你說「${clip(seedText, 10)}」，最後鎮上在談「${clip(card.drift.to, 14)}」`,
      sub: card.drift.pivot ? `話題在 ${nameOf(card.drift.pivot.from)}對${nameOf(card.drift.pivot.to)}說「${clip(card.drift.pivot.text, 26)}」時轉了彎。` : `${reached.length} 個人被捲了進來。`,
    });
  } else if (reached.length >= 3) {
    Object.assign(card, { icon: "💬", headline: `一句話把 ${reached.length} 個人捲了進來`, sub: "鎮上議論紛紛，但還沒有人真的採取大動作。" });
  }
  // a 🔍 headline is about that one look: the chain leads to it, not on to whatever was said or seen last
  // (「小雯親自去查：查無實據」 at 24.7 over a chain running on to 41.1: B1 fee-journalist)
  if (told && told !== top) {
    ({ spine, root, traced } = chainTo(told, toldSeen));
    Object.assign(card, { spine, outcome: told.id, spineRoot: root ? Math.max(0, seeds.indexOf(root)) : 0 });
  }
  // nothing on record a reader can follow from what the player said to what the headline reports (no path of causes
  // at all, or one that shows nobody passing anything on while someone else did it): say so rather than fill the
  // chain. A headline that reports no result does not get one named here.
  if (told && (!traced || (!spine.length && told.actor !== root?.target && !before.some(happened)))) card.chainGap = "從這句話到這個結果，紀錄裡找不到一條說得清的因果線。";
  else if (top && !told && !traced) card.chainGap = "紀錄裡找不到這句話一路傳下去的因果線。";

  if (!card.headline) {
    // the rumour died: name who it stopped with, in their own words
    const lastDec = [...run.decisions].reverse().find((x) => x.output && x.npc);
    const stop = lastDec?.output;
    if (lastDec?.fallback) {
      // the model gave no valid answer: say so instead of inventing a reaction for the resident
      Object.assign(card, { icon: "⚠️", headline: `故事在${nameOf(lastDec.npc)}這裡中斷`, sub: "模型沒有給出有效回答，引擎改用安全預設，沒有讓任何事發生。" });
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
      Object.assign(card, {
        icon: bounced ? "🔁" : !lastB ? "❓" : dismissive ? "🧱" : "🤐",
        headline: bounced
          ? `話在${nameOf(p1)}和${nameOf(p2)}之間打轉，沒有再傳出去`
          : !lastB
            ? `${nameOf(lastDec.npc)}聽得一頭霧水，就這樣算了`
            : dismissive
            ? `謠言在${nameOf(lastDec.npc)}這裡踢到鐵板`
            : toldSomeone
              ? `${nameOf(lastDec.npc)}說完就沒有下文了`
              : `${nameOf(lastDec.npc)}聽進去了，但沒有說出去`,
        sub: `「${stop.thought}」`,
      });
      if (wanted) Object.assign(card, { icon: "✋", headline: wanted.zh });
    } else Object.assign(card, { icon: "🍃", headline: "這句話沒有激起任何漣漪", sub: "" });
  }

  // the reveal: what was actually true about the topic the player raised (from the world's authored facts)
  // (if the first listener passed it on without stating a claim, the first claim anyone made is what it became)
  const seedFact = (seedClaims.length ? seedClaims : claims.slice(0, 1)).map((c) => topicFact(c.topic)).find(Boolean);
  const fact = seedFact ? FACTS.find((f) => f.id === seedFact) : undefined;
  if (fact && !fact.public) {
    card.truth = {
      text: fact.value ? fact.zh : (fact.notZh ?? `其實並沒有這回事：${fact.zh}`),
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
    // ≥0.6, the same bar as the on-screen "有權…？" suspense chip — a 45% hunch is not a near miss
    const finalB = new Map<string, number>();
    for (const x of events) if (x.type === "belief" && x.actor === npc) finalB.set(String(x.data.claim), Number(x.data.to));
    const strong = [...finalB].filter(([cid, conf]) => conf >= 0.6 && IMPACT_ON[npc].includes(String(catOf(cid)))).sort((x, y) => y[1] - x[1]);
    if (!strong.length || (near && near.conf >= strong[0][1])) continue;
    // a move somebody else already made is no near miss ("明明可以封鎖舞台" while the stage is taped off)
    const topic = claims.find((y) => y.id === strong[0][0])?.topic ?? "";
    const move = MOVE[couldOf(npc, topic)];
    if (move && events.some((e) => e.type === move.type && (!move.key || e.data.key === move.key))) continue;
    const last = decs.flatMap((x) => x.output!.actions).filter((a) => a.type !== "none").at(-1);
    const did = last ? ({ phone: "打電話給別人", tell: "跑去跟別人說", ask: "去問別人", go_look: "自己跑去看", inspect: "親自去檢查", post_notice: "貼了公告", public_statement: "發表聲明" } as Record<string, string>)[last.type] ?? "做了別的事" : "什麼也沒做";
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
    add(contactsOf(near).find((c) => c !== seedNpc && active.has(c)), `跟${nameOf(near)}最親，一通電話就到`);
  }
  // amplifiers (public moves) and hubs (many phone contacts) who have not heard it yet, most reach first
  // a public move (news, police, stage, rally…) reaches more people than closing one's own shop
  const reach = (npc: string) => contactsOf(npc).length + (!powerOf(npc).length ? 0 : powerOf(npc)[0].includes("關店") ? 1 : 3);
  const fresh = [...active].filter((n) => !heard.has(n)).sort((a, b) => reach(b) - reach(a));
  for (const n of fresh) {
    const power = powerOf(n)[0];
    add(n, power ? `還沒聽說這件事；能${power.replace(/^\S+\s/, "")}` : `還沒聽說這件事；能打給 ${contactsOf(n).length} 個人`);
  }
  // everyone has heard it: someone with a public move, then anyone
  for (const n of [...active].sort((a, b) => reach(b) - reach(a))) add(n, powerOf(n)[0] ? `能${powerOf(n)[0].replace(/^\S+\s/, "")}` : "換個人聽聽看");
  return out.slice(0, 2);
}
