// VIRAL simulation engine: a discrete-event world that owns the truth.
// Residents decide (Gemma or rules); the engine validates, moves them, delivers messages, resolves
// inspections against the facts, changes world state and records every cause in the event log.
import { LOOK_LIMITS, TOPIC_CATEGORY, FACTS, FESTIVAL_AT, PERSONAS, PLACES, PUBLIC_INFO, ROUTINE, TOPICS, initialWorld } from "./scenario.ts";
import { claimInfoOf, milestoneOf, MILESTONES } from "./festival.ts";
import { readinessOf } from "./readiness.ts";
import { cleanSpeech } from "./moderation.ts";

const TOPIC_TEXT = TOPICS.map((t) => t.q).join(" ");
import { travelMinutes } from "./geo.ts";
import type { Chat } from "./llm.ts";
import { decideWithGemma, type MindResult, type Variant } from "./mind.ts";
import { decideWithRules } from "./rules.ts";
import type {
  ActionIntent, Belief, Claim, DecisionRecord, EventType, FactId, Intent, LlmRecord, Message, Mind, Minutes, NpcId, Persona, PlaceId, SimEvent, WorldState,
} from "./types.ts";
import { clockOf, topicFact, trustIn, type InboxItem, type View } from "./view.ts";

export interface SimConfig {
  active: NpcId[];
  seedNpc: NpcId;
  seedText: string;
  /** how the planted sentence arrives: overheard from a stranger, or as the resident's own sudden thought */
  seedVia?: "stranger" | "hunch";
  seedAt?: Minutes;
  endAt?: Minutes;
  seed?: number;
  policy?: "gemma" | "rules";
  variant?: Variant;
  temperature?: number;
  chat?: Chat;
  maxDecisions?: number;
  maxPerNpc?: number;
  /** cap for a resident holding a first-hand finding from an expert inspection in their own trade (default maxPerNpc) */
  maxPerNpcFinding?: number;
  /** decisions such a finding holder may still take after the shared maxDecisions is spent (default 0) */
  findingReserve?: number;
  label?: string;
  onEvent?: (e: SimEvent) => void;
  onDecision?: (d: DecisionRecord) => void;
  /** Everything before this game time is final (for streamed playback). */
  onFrontier?: (t: Minutes) => void;
  /** A resident started thinking (a model call is under way). */
  onThinking?: (npc: NpcId, t: Minutes) => void;
  /** streamed: a resident's first visible reaction (feeling and act) before the decision is complete — presentation only */
  onEarly?: (npc: string, x: { feeling: string; act: string }) => void;
  /** include the fixed daily meetings (default true) */
  routine?: boolean;
  /**
   * 補一句: called at most once, when the story is about to fizzle — nothing left that could still happen (no one
   * deciding, no plan under way, no routine meeting anyone has a reason to raise), enough decisions left, and early
   * enough in the evening. Resolve with one more whisper from the player, or null to let it fade.
   */
  onLull?: (info: { t: Minutes; decisionsLeft: number; reached: NpcId[] }) => Promise<{ npc: NpcId; text: string } | null>;
  /** run the festival's preparation milestones and the 20:00 opening (default true) */
  festival?: boolean;
  /** checked before every step and every model call: true once nobody is watching this story any more (the player
   *  left it), so it stops at once instead of spending model calls in the background */
  shouldStop?: () => boolean;
}

export interface RunResult {
  config: Omit<SimConfig, "chat" | "onEvent" | "onDecision" | "onFrontier" | "onThinking">;
  events: SimEvent[];
  decisions: DecisionRecord[];
  claims: Claim[];
  world: WorldState;
  minds: Record<NpcId, { place: PlaceId; beliefs: Belief[]; learned: [FactId, boolean][]; memory: string[] }>;
  ended: { reason: "quiet" | "time" | "budget"; t: Minutes };
  /** extra whispers the player added at a lull (補一句), in order */
  whispers: { npc: NpcId; text: string; t: Minutes; event: string }[];
  wall: { startedAt: string; ms: number };
  llm: { calls: number; attempts: number; promptTokens: number; completionTokens: number; platformCost: number; estCost: number; errors: number; fallbacks: number };
}

// game-minute durations
const PERCEIVE = 0.2;
const REACT = 1; // between deciding and acting; also the window inside which decisions can run in parallel
const TALK = 3;
const PHONE = 2;
const LOOK = 3;
const INSPECT = 10;
const NOTICE = 4;
const WRITE = 20;
const STATEMENT = 8;
const RALLY = 15;
const WAIT_MAX = 10;
// After a face-to-face line both stay "in conversation" this long (minutes after the line ends): long enough for the
// listener to take it in, decide and answer on the spot. Nobody walks home between a line and its reply any more.
const CONV_LINGER = 6;

const placeZh = (id: PlaceId) => PLACES.find((p) => p.id === id)?.zh ?? id;
const fact = (id: FactId) => FACTS.find((f) => f.id === id)!;
/** first letter up, for a line that starts with a place or a source ("the plaza" → "The plaza") */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** a sentence that ends in punctuation, so the next one can follow it */
const sentence = (s: string) => (/[.!?。！？”」]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
/** "A", "A and B", "A, B and C" */
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Npc {
  p: Persona;
  mind: Mind;
  place: PlaceId;
  dest: PlaceId | null;
  busyUntil: Minutes;
  decisionAt: Minutes | null; // a decision is queued for this time
  triggers: string[];
  publicEvents: string[];
  heard: string[];
  planId: number; // bumps when a new decision replaces the plan
  lastBelief: string | null; // event id of the latest belief this resident formed (what they "carry")
  /** claim id → event id of the belief they formed about it (to find what they carry on a given kind of topic) */
  beliefEvents: Map<string, string>;
  /** a face-to-face exchange in progress: who with, and until when they wait for each other */
  conv: { with: NpcId; until: Minutes } | null;
  /** lines exchanged with each person tonight (either direction): shown to them, so a long back-and-forth reads as one */
  talks: Map<NpcId, number>;
}

// `idle` marks a task that cannot move the story by itself (walking home, waiting to part, a routine meeting nobody
// has a reason to raise): a story whose queue holds only idle tasks is about to fizzle.
type Item = { t: Minutes; seq: number } & ({ kind: "task"; run: () => void; idle?: () => boolean } | { kind: "decide"; npc: NpcId });

export async function simulate(cfg: SimConfig): Promise<RunResult> {
  const seedAt = cfg.seedAt ?? 20;
  const endAt = cfg.endAt ?? FESTIVAL_AT;
  const policy = cfg.policy ?? "gemma";
  const variant = cfg.variant ?? "single";
  const temperature = cfg.temperature ?? 0.7;
  const maxDecisions = cfg.maxDecisions ?? 30;
  const maxPerNpc = cfg.maxPerNpc ?? 6;
  const maxPerNpcFinding = cfg.maxPerNpcFinding ?? maxPerNpc;
  const findingReserve = cfg.findingReserve ?? 0;
  /** has seen a hidden problem with their own trained eyes (an expert check in their trade) */
  const holdsFinding = (n: Npc) => [...n.mind.learned.keys()].some((id) => FACTS.find((f) => f.id === id)?.check?.by === "expert");
  const rand = rng(cfg.seed ?? 1);
  if (policy === "gemma" && !cfg.chat) throw new Error("gemma policy needs a chat client");
  if (!cfg.active.includes(cfg.seedNpc)) throw new Error("seed NPC must be active");

  const clock0 = Date.now();
  const world = initialWorld();
  const events: SimEvent[] = [];
  const decisions: DecisionRecord[] = [];
  const claims = new Map<string, Claim>();
  const queue: Item[] = [];
  let seq = 0;
  let now = 0;
  let budgetHit = false;
  let realDecisions = 0;

  const npcs = new Map<NpcId, Npc>();
  for (const id of cfg.active) {
    const p = PERSONAS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown npc ${id}`);
    npcs.set(id, {
      p, place: p.home, dest: null, busyUntil: 0, decisionAt: null, triggers: [], publicEvents: [], heard: [], planId: 0, lastBelief: null, beliefEvents: new Map(), conv: null, talks: new Map(),
      mind: { knows: new Set(p.knows), learned: new Map(), beliefs: new Map(), inbox: [], memory: [], decisions: 0, lastDecisionAt: -99, told: new Map(), heardKeys: new Map() },
    });
  }
  const SOURCE_ZH: Record<string, string> = { unknown: "a stranger", crowd: "people in town", notice: "the notice board", self: "yourself", news: "the news", hunch: "your own thought" };
  const name = (id: string) => npcs.get(id)?.p.name ?? SOURCE_ZH[id] ?? id;
  /** how a message is remembered, as the start of a memory line: "Ade said", "You saw for yourself", "You thought" */
  const heardAs = (m: Message) =>
    m.via === "hunch"
      ? m.from === "self" ? "You thought" : "You had a thought"
      : m.from === "self"
        ? "You saw for yourself"
        : `${cap(name(m.from))} ${m.via === "phone" ? "said on the phone" : m.via === "article" ? "wrote" : "said"}`;

  const emit = (type: EventType, t: Minutes, zh: string, causes: string[], fields: Partial<SimEvent> = {}): string => {
    // full precision: rounding here would let events slip below a frontier already reported to playback
    const e: SimEvent = { id: `e${events.length + 1}`, t, type, causes: [...new Set(causes)], data: {}, zh, ...fields, w: Date.now() - clock0 };
    events.push(e);
    cfg.onEvent?.(e);
    return e.id;
  };
  const at = (t: Minutes, run: () => void, idle?: () => boolean) => queue.push({ t, seq: seq++, kind: "task", run, idle });
  const IDLE = () => true;

  // ---- messages and decisions --------------------------------------------------------------
  let msgN = 0;
  function deliver(to: Npc, from: Message["from"], via: Message["via"], intent: Intent, text: string, claimIds: string[], t: Minutes, cause: string) {
    const sender = npcs.get(from);
    const senderConf = sender && claimIds.length ? Math.max(...claimIds.map((c) => sender.mind.beliefs.get(c)?.confidence ?? 0)) : undefined;
    const m: Message = { id: `m${++msgN}`, from, to: to.p.id, via, intent, text, claims: claimIds, at: t, event: cause, senderConf };
    const how: Record<string, string> = {
      face: `heard from ${name(from)}: “${text}”`, phone: `heard from ${name(from)} on the phone: “${text}”`, inspection: `saw firsthand: ${text}`,
      article: `read ${name(from)}'s article: ${text}`, notice: `saw on the notice board: “${text}”`, crowd: `heard people talking: ${text}`, seed: `overheard a stranger say: “${text}”`,
      hunch: `suddenly had a thought: “${text}”`,
      meet: `ran into ${name(from)} (${text})`,
    };
    const ev = emit("deliver", t, `${to.p.name} ${how[via] ?? `learned: ${text}`}`, [cause], {
      target: to.p.id, actor: npcs.has(from) ? from : undefined, place: to.place, data: { message: m.id, via, intent, text, claims: claimIds, from },
    });
    m.event = ev;
    to.heard.push(text);
    // Hearing the same thing again from the same person adds nothing: remember it, don't re-decide. Unless it is
    // the first time face to face (a confrontation, a lie told to your face) or they are now much surer or less sure.
    const face = via === "face";
    const repeat = claimIds.length > 0 && claimIds.every((c) => {
      const h = to.mind.heardKeys.get(`${from}|${c}`);
      return !!h && (h.face || !face) && Math.abs((senderConf ?? h.conf) - h.conf) < 0.25;
    });
    for (const c of claimIds) {
      const h = to.mind.heardKeys.get(`${from}|${c}`);
      to.mind.heardKeys.set(`${from}|${c}`, { face: face || !!h?.face, conf: senderConf ?? h?.conf ?? 0 });
    }
    if (repeat) {
      events[events.length - 1].data.repeat = true;
      to.mind.memory.push(`${clockOf(t)} ${cap(name(from))} told you again: “${text.slice(0, 68)}”`);
      return;
    }
    to.mind.inbox.push(m);
    requestDecision(to, t + PERCEIVE, ev);
  }

  function requestDecision(n: Npc, t: Minutes, cause: string) {
    n.triggers.push(cause);
    const when = Math.max(t, n.busyUntil);
    if (n.decisionAt !== null && n.decisionAt <= when) return;
    n.decisionAt = when;
    queue.push({ t: when, seq: seq++, kind: "decide", npc: n.p.id });
  }

  /** Spread a public happening to everyone else: people on the spot see it at once, the rest hear it later or not at all. */
  function spread(cause: string, t: Minutes, place: PlaceId | null, text: string, via: Message["via"], from: Message["from"], opts: { except?: NpcId[]; delay: [number, number]; p: number; claims?: string[]; onDeliver?: (n: Npc) => void }) {
    for (const n of npcs.values()) {
      if (opts.except?.includes(n.p.id)) continue;
      const onSpot = place !== null && n.place === place && !n.dest;
      if (!onSpot && rand() > opts.p) continue;
      const d = onSpot ? PERCEIVE : opts.delay[0] + rand() * (opts.delay[1] - opts.delay[0]);
      at(t + d, () => {
        n.publicEvents.push(`${clockOf(t)} ${text}`);
        opts.onDeliver?.(n);
        deliver(n, from, via, "inform", text, opts.claims ?? [], t + d, cause);
      });
    }
  }

  function view(n: Npc, t: Minutes, inbox: Message[]): View {
    const known: Record<FactId, boolean> = {};
    const knowledge: View["knowledge"] = [];
    for (const id of n.mind.knows) {
      known[id] = fact(id).value;
      const f = fact(id);
      knowledge.push({ id, zh: f.value ? f.zh : (f.notZh ?? `This isn't true: ${f.zh.replace(/[。.]$/, "")}.`), secret: n.p.secrets.includes(id), learned: false });
    }
    for (const [id, value] of n.mind.learned) {
      if (id in known) continue;
      known[id] = value;
      const f = fact(id);
      knowledge.push({ id, zh: f.check?.zh ?? (value ? f.zh : (f.notZh ?? `This isn't true: ${f.zh}`)), secret: false, learned: true });
    }
    const items: InboxItem[] = inbox.map((m) => ({ id: m.id, from: m.from, fromZh: name(m.from), via: m.via, intent: m.intent, text: m.text, trust: trustIn(n.p, m.from), senderConf: m.senderConf }));
    return {
      npc: n.p, t, clock: clockOf(t), place: n.place, placeZh: placeZh(n.place), knowledge, known,
      beliefs: [...n.mind.beliefs.values()].map((b) => {
        const c = claims.get(b.claim)!;
        return { id: c.id, statement: c.statement, topic: c.topic, says: c.says, category: c.category, confidence: b.confidence, sources: b.sources, sourcesZh: b.sources.map(name).join(", ") };
      }),
      inbox: items,
      memory: n.mind.memory,
      // residents know where people usually are, not where they are right now; the engine finds them
      people: [...npcs.values()].filter((o) => o !== n).map((o) => ({
        id: o.p.id, name: o.p.name, roleZh: o.p.roleZh, place: o.p.home, placeZh: placeZh(o.p.home),
        relation: n.p.relations[o.p.id] ?? { trust: 0.35, phone: false, zh: "a nodding acquaintance" }, busy: false, talks: n.talks.get(o.p.id) ?? 0,
      })),
      actions: ["tell", "phone", "ask", "go_look", ...n.p.actions],
      publicEvents: n.publicEvents,
      heardText: [...n.heard, ...n.mind.memory, TOPIC_TEXT].join(" "),
      publicInfo: PUBLIC_INFO,
    };
  }

  async function decide(n: Npc, t: Minutes) {
    n.decisionAt = null;
    if (cfg.shouldStop?.()) return;
    if (n.busyUntil > t + 1e-6) {
      requestDecision(n, n.busyUntil, n.triggers[n.triggers.length - 1] ?? "e1");
      return;
    }
    const inbox = n.mind.inbox.splice(0);
    const triggers = n.triggers.splice(0);
    if (!inbox.length) return;
    const id = `d${decisions.length + 1}`;
    const rec: DecisionRecord = { id, npc: n.p.id, t, triggers, inbox: inbox.map((m) => m.id), policy, output: null, validation: [], fallback: false, llm: [], applied: [] };
    decisions.push(rec);
    const finder = holdsFinding(n);
    const globalCap = realDecisions >= maxDecisions + (finder ? findingReserve : 0);
    if (globalCap || n.mind.decisions >= (finder ? maxPerNpcFinding : maxPerNpc)) {
      if (globalCap) budgetHit = true;
      rec.fallback = true;
      rec.validation.push({ attempt: 0, kind: "budget", errors: ["decision budget reached"] });
      for (const m of inbox) n.mind.memory.push(`${clockOf(t)} ${heardAs(m)}: “${m.text}” (you didn't think much of it)`);
      rec.applied.push(emit("decide", t, `${n.p.name} heard it but didn't think much of it (the simulation reached its decision limit)`, triggers, { actor: n.p.id, place: n.place, data: { decision: id, budget: true } }));
      cfg.onDecision?.(rec);
      return;
    }
    n.mind.decisions++;
    realDecisions++;
    n.mind.lastDecisionAt = t;
    const v = view(n, t, inbox);
    if (policy === "gemma") cfg.onThinking?.(n.p.id, t);
    const res: MindResult =
      policy === "rules" ? decideWithRules(v) : await decideWithGemma(v, cfg.chat!, { variant, temperature, clock0, onEarly: cfg.onEarly ? (x) => cfg.onEarly!(n.p.id, x) : undefined });
    for (const l of res.llm) l.decision = id;
    rec.llm = res.llm;
    rec.validation = res.validation;
    rec.fallback = res.fallback;
    // what residents say out loud never carries swearing, sexual content or slurs (a retelling cannot launder them)
    if (res.output) {
      const o = res.output;
      res.output = { ...o, thought: cleanSpeech(o.thought), understanding: cleanSpeech(o.understanding), actions: o.actions.map((a) => (a.message ? { ...a, message: cleanSpeech(a.message) } : a)) };
    }
    rec.output = res.output;
    apply(n, t, rec, res, inbox);
    cfg.onDecision?.(rec);
  }

  function apply(n: Npc, t: Minutes, rec: DecisionRecord, res: MindResult, inbox: Message[]) {
    const out = res.output;
    const dEv = emit("decide", t, `${n.p.name}: ${out.thought}`, rec.triggers, {
      actor: n.p.id, place: n.place,
      data: { decision: rec.id, understanding: out.understanding, thought: out.thought, feeling: out.feeling, policy: rec.policy, fallback: rec.fallback, actions: out.actions.map((a) => a.type), motive: out.motive },
    });
    rec.applied.push(dEv);
    // claims and beliefs
    const ids: string[] = out.claims.map((c) => {
      if (c.ref !== "new" && n.mind.beliefs.has(c.ref)) return c.ref;
      const cl: Claim = {
        id: `c${claims.size + 1}`, statement: c.statement, topic: c.topic, says: c.says, category: c.category,
        fact: topicFact(c.topic), asserts: c.says === "unclear" ? null : c.says === "yes", origin: rec.triggers[0] ?? dEv, by: n.p.id,
      };
      claims.set(cl.id, cl);
      return cl.id;
    });
    const senders = inbox.map((m) => m.from);
    out.stances.forEach((s) => {
      const cid = ids[s.claim];
      if (!cid) return;
      const prev = n.mind.beliefs.get(cid);
      const conf = res.checked.confidence[s.claim] ?? 0;
      const sources = [...new Set([...(prev?.sources ?? []), ...(res.checked.sources?.[s.claim] ?? senders)])];
      n.mind.beliefs.set(cid, { claim: cid, confidence: conf, sources, updatedAt: t, why: s.why });
      const bEv = emit("belief", t, `${n.p.name}'s confidence in “${claims.get(cid)!.statement}”: ${(prev?.confidence ?? 0).toFixed(2)} → ${conf.toFixed(2)} (${s.verdict})`, [dEv], {
        // `limit` says which engine rule moved the model's number, so the player can be told why
        actor: n.p.id, data: { claim: cid, topic: claims.get(cid)!.topic, says: claims.get(cid)!.says, from: prev?.confidence ?? 0, to: conf, proposed: s.confidence, verdict: s.verdict, why: s.why, limit: res.checked.limits?.[s.claim] },
      });
      rec.applied.push(bEv);
      if (conf >= 0.3) n.lastBelief = bEv;
      n.beliefEvents.set(cid, bEv);
    });
    rec.applied.push(emit("react", t + 0.1, `${n.p.name} ${out.feeling}`, [dEv], { actor: n.p.id, place: n.place, data: { feeling: out.feeling } }));
    publicPressure(t, dEv);
    // what they wanted to do but the rules did not allow: part of the story, shown honestly
    for (const r of res.refused ?? [])
      rec.applied.push(emit("rejected", t + 0.2, `${n.p.name} wanted to ${describe(r.action)}, but ${r.why}`, [dEv], { actor: n.p.id, place: n.place, data: { action: r.action.type, why: r.why, wanted: true } }));
    for (const m of inbox) n.mind.memory.push(`${clockOf(m.at)} ${heardAs(m)}: “${m.text.slice(0, 100)}”`);
    // the plan replaces whatever was left of the previous one
    const plan = (out.actions ?? []).filter((a) => a.type !== "none").slice(0, 2);
    const planId = ++n.planId;
    const claimsFor = (a: ActionIntent) => {
      const cited = (a.cites ?? []).map((c) => (/^#\d+$/.test(c) ? ids[Number(c.slice(1))] : n.mind.beliefs.has(c) ? c : null)).filter(Boolean) as string[];
      return cited.length ? cited : ids;
    };
    const runStep = (k: number, ts: Minutes) => {
      if (planId !== n.planId) return;
      // someone may have come to talk to them in the meantime: finish that first
      if (n.busyUntil > ts + 1e-6) return at(n.busyUntil, () => runStep(k, n.busyUntil));
      // done: head home — unless their next decision is already coming (what they just saw or heard), which will
      // say where to go; walking home and straight back looked like a glitch (P6: the look, then the inspect)
      if (k >= plan.length) return settle(n, ts, dEv);
      const a = plan[k];
      exec(n, a, ts, dEv, claimsFor(a), (te) => runStep(k + 1, te));
    };
    if (plan.length) {
      n.busyUntil = Math.max(n.busyUntil, t + REACT);
      n.mind.memory.push(`${clockOf(t)} You decided to ${plan.map((a) => describe(a)).join(", then ")}`);
      at(t + REACT, () => runStep(0, t + REACT));
    } else {
      n.mind.memory.push(`${clockOf(t)} You decided not to do anything for now.`);
      // nothing more to do here: back to their own place (if they were left standing somewhere)
      at(
        t + REACT,
        () => {
          if (planId === n.planId && n.decisionAt === null && !n.dest && n.busyUntil <= t + REACT + 1e-6) settle(n, t + REACT, dEv);
        },
        IDLE,
      );
    }
  }

  const describe = (a: ActionIntent) => {
    const who = a.target ? name(a.target) : "";
    switch (a.type) {
      case "tell": return `go tell ${who} “${a.message ?? ""}”`;
      case "phone": return `call ${who} and say “${a.message ?? ""}”`;
      case "ask": return `go ask ${who} “${a.message ?? ""}”`;
      case "go_look": return `go take a look at ${placeZh(a.place!)}`;
      case "inspect": return `go inspect ${placeZh(a.place!)}`;
      case "dispatch_police": return `send officers to ${placeZh(a.place!)}`;
      case "close_stage": return "close off the stage";
      case "cancel_festival": return "cancel the Lantern Festival";
      case "publish_article": return "publish an exposé";
      case "public_statement": return "make a public statement";
      case "post_notice": return "put up a notice";
      case "rally": return "rally the stall owners";
      case "close_shop": return "close the shop";
      case "open_shop": return "reopen the shop";
      default: return a.type;
    }
  };

  function walk(n: Npc, to: PlaceId, t: Minutes, cause: string, then: (t: Minutes) => void, home = false, follow?: Npc) {
    if (n.place === to) return then(t);
    const dt = travelMinutes(n.place, to);
    const from = n.place;
    n.dest = to;
    n.busyUntil = t + dt;
    const zh = follow ? `${n.p.name} went along with ${follow.p.name} to ${placeZh(to)}` : `${n.p.name} ${home ? "walked back" : "walked"} from ${placeZh(from)} to ${placeZh(to)}`;
    const ev = emit("move", t, zh, [cause], { actor: n.p.id, place: from, data: { from, to, arrive: t + dt, home, follow: follow?.p.id } });
    at(
      t + dt,
      () => {
        n.place = to;
        n.dest = null;
        emit("arrive", t + dt, `${n.p.name} arrived at ${placeZh(to)}`, [ev], { actor: n.p.id, place: to, data: {} });
        then(t + dt);
      },
      home ? IDLE : undefined,
    );
  }

  function goHome(n: Npc, t: Minutes, cause: string) {
    if (n.place === n.p.home) return;
    walk(n, n.p.home, t, cause, () => {}, true);
  }

  // ---- public pressure on the mayor ----------------------------------------------------------------
  // Deterministic and honest: once a rumour about the mayor or the town's money is held (≥0.3) by three or more other
  // residents, the mayor hears that it is going round. The line states only what those logged beliefs support.
  const MAYOR_TOPICS = new Set(["mayor_fears_pigeons", "mayor_embezzled", "budget_overrun", "fee_covers_budget", "birds_banned", "mayor_owes_baker"]);
  const pressured = new Set<string>();
  function publicPressure(t: Minutes, cause: string) {
    const mayor = npcs.get("mayor");
    if (!mayor) return;
    for (const topic of MAYOR_TOPICS) {
      if (pressured.has(topic)) continue;
      const held = [...npcs.values()].flatMap((o) =>
        o === mayor ? [] : [...o.mind.beliefs.values()].filter((b) => b.confidence >= 0.3 && claims.get(b.claim)?.topic === topic).map((b) => ({ o, b })),
      );
      const holders = new Set(held.map((h) => h.o.p.id));
      if (holders.size < 3) continue;
      pressured.add(topic);
      // the version most people hold is what the mayor hears
      const counts = new Map<string, number>();
      for (const h of held) counts.set(h.b.claim, (counts.get(h.b.claim) ?? 0) + 1);
      const cid = [...counts].sort((x, y) => y[1] - x[1])[0][0];
      at(t + 5, () => deliver(mayor, "crowd", "crowd", "inform", `Several people in town are saying: “${claims.get(cid)!.statement}”`, [cid], t + 5, cause));
    }
  }

  // ---- conversations: approach, talk, answer on the spot, maybe go and look together, then part ------------
  function startConv(a: Npc, b: Npc, until: Minutes) {
    const u = Math.max(until, a.conv?.with === b.p.id ? a.conv.until : 0);
    a.conv = { with: b.p.id, until: u };
    b.conv = { with: a.p.id, until: u };
  }
  /** still in an exchange with someone standing right here */
  function inConv(n: Npc, t: Minutes) {
    const o = n.conv ? npcs.get(n.conv.with) : undefined;
    return !!(n.conv && o && n.conv.until > t + 1e-6 && o.place === n.place && !o.dest);
  }
  /**
   * Done with what they set out to do: stay if their next decision is already coming (it will say where to go),
   * wait for the other person while a conversation is open, otherwise head back to their own place.
   */
  function settle(n: Npc, t: Minutes, cause: string) {
    if (n.decisionAt !== null) return;
    const plan = n.planId;
    if (inConv(n, t)) {
      const until = n.conv!.until;
      at(
        until,
        () => {
          if (plan === n.planId && !n.dest && n.busyUntil <= until + 1e-6) settle(n, until, cause);
        },
        IDLE,
      );
      return;
    }
    goHome(n, t, cause);
  }
  /** people in an open conversation with `n`, standing idle next to them: they come along when `n` goes to look */
  function companionsOf(n: Npc, t: Minutes) {
    return [...npcs.values()].filter(
      (c) => c !== n && c.conv?.with === n.p.id && c.conv.until > t + 1e-6 && c.place === n.place && !c.dest && c.busyUntil <= t + 1e-6 && c.decisionAt === null,
    );
  }

  /**
   * Wait (up to WAIT_MAX from the first try) until someone is free, then run; give up at the current time.
   * Whoever is waiting counts as busy, so no new decision can start a second plan in the meantime.
   */
  function whenFree(self: Npc, o: Npc, t: Minutes, give: (t: Minutes) => void, run: (t: Minutes) => void, since = t) {
    if (o.busyUntil <= t) return run(t);
    if (o.busyUntil - since > WAIT_MAX) return give(t);
    self.busyUntil = Math.max(self.busyUntil, o.busyUntil);
    const retry = o.busyUntil;
    at(retry, () => whenFree(self, o, retry, give, run, since));
  }

  // Saying the same thing to the same person again is blocked (it only burns model calls and loops), unless
  // something changed: the speaker is now much surer or less sure (new evidence), or it is the first time they say
  // it in person after a call — the confrontation at the stage is a scene, not a repeat (P4 lost exactly that one).
  // At most 3 times per claim and person in any case.
  function isRepeat(n: Npc, target: Npc, claimIds: string[], face: boolean) {
    const told = n.mind.told.get(target.p.id);
    if (!claimIds.length || !told || !claimIds.every((c) => told.has(c))) return false;
    return !claimIds.some((c) => {
      const r = told.get(c)!;
      if (r.n >= 3) return false;
      const conf = n.mind.beliefs.get(c)?.confidence ?? r.conf;
      return Math.abs(conf - r.conf) >= 0.25 || (face && !r.face);
    });
  }
  // Saying it again was blocked: instead of a dead end, it sinks in that talking more will not change the other
  // person, and they decide what to do now (act, or let it go) — once per pair, so it can never loop.
  const sunk = new Set<string>();
  function sinkIn(n: Npc, target: Npc, t: Minutes, cause: string) {
    const key = `${n.p.id}>${target.p.id}`;
    if (sunk.has(key)) return;
    sunk.add(key);
    at(t + REACT, () => deliver(n, "self", "hunch", "inform", `I've already told ${target.p.name} about this; saying it again won't change anything. What should I do next?`, [], t + REACT, cause));
  }
  function countTalk(a: Npc, b: Npc) {
    a.talks.set(b.p.id, (a.talks.get(b.p.id) ?? 0) + 1);
    b.talks.set(a.p.id, (b.talks.get(a.p.id) ?? 0) + 1);
  }
  function markTold(n: Npc, target: Npc, claimIds: string[], face: boolean) {
    const told = n.mind.told.get(target.p.id) ?? new Map<string, { n: number; conf: number; face: boolean }>();
    for (const c of claimIds) {
      const r = told.get(c);
      told.set(c, { n: (r?.n ?? 0) + 1, conf: n.mind.beliefs.get(c)?.confidence ?? 0, face: face || !!r?.face });
    }
    n.mind.told.set(target.p.id, told);
  }

  function reject(n: Npc, t: Minutes, cause: string, why: string, a: ActionIntent) {
    return emit("rejected", t, `${n.p.name} couldn't ${describe(a)}: ${why}`, [cause], { actor: n.p.id, data: { action: a.type, why } });
  }

  /** What someone sees at a place: checkable facts (an expert's eye only for an inspection in their trade), the state of
   *  the world there, who is around, and honestly what a glance or someone outside their trade could not tell. */
  /** Someone who has seen a hidden problem with their own trained eyes keeps turning it over: once per finding, after
   *  they have been quiet for a while, if nothing they did has dealt with it and nothing has closed the place, the
   *  thought comes back to them. People act on a worry, not only on messages; what they do with it is still theirs. */
  const mulled = new Set<string>();
  const MULL_QUIET = 25;
  function mullOver(n: Npc, f: (typeof FACTS)[number], t0: Minutes, cause: string) {
    const key = `${n.p.id}>${f.id}`;
    if (mulled.has(key)) return;
    mulled.add(key);
    const place = f.check!.place;
    const handled = () =>
      world.festival === "cancelled" || (place === "stage" && world.stage === "closed") || world.shops[place] === "closed" ||
      events.some((e) => e.actor === n.p.id && e.t >= t0 && (e.type === "state" || e.type === "article" || e.type === "statement" || e.type === "notice" || e.type === "gather"));
    const tryAt = (t: Minutes) => {
      if (handled() || t > endAt - 10) return;
      if (n.mind.decisions >= maxPerNpcFinding || realDecisions >= maxDecisions + findingReserve) return;
      const quietSince = Math.max(t0, n.mind.lastDecisionAt);
      if (t - quietSince < MULL_QUIET || n.decisionAt !== null) {
        const next = (n.decisionAt !== null ? t : quietSince) + MULL_QUIET;
        return at(next, () => tryAt(next));
      }
      const left = Math.round(FESTIVAL_AT - t);
      const plural = (k: number, unit: string) => `${k} ${unit}${k === 1 ? "" : "s"}`;
      const leftZh = left >= 60 ? `${plural(Math.floor(left / 60), "hour")}${left % 60 ? ` ${plural(left % 60, "minute")}` : ""}` : plural(left, "minute");
      deliver(n, "self", "hunch", "inform", `I can't stop thinking about what I saw with my own eyes at ${clockOf(t0)}: ${sentence(f.check!.zh)} The Lantern Festival starts in just ${leftZh}. What should I do next?`, [], t, cause);
    };
    at(t0 + MULL_QUIET, () => tryAt(t0 + MULL_QUIET));
  }

  function lookAround(n: Npc, place: PlaceId, expert: boolean, t: Minutes) {
    const seen: string[] = [];
    // what they were wondering about (their beliefs' topics) is what they notice first
    const onMind = new Set([...n.mind.beliefs.values()].map((b) => topicFact(claims.get(b.claim)?.topic ?? "")).filter(Boolean));
    const checks = FACTS.filter((f) => f.check && f.check.place === place && !(f.check.by === "expert" && !(expert && f.check.roles?.includes(n.p.role))));
    checks.sort((x, y) => Number(onMind.has(y.id)) - Number(onMind.has(x.id)));
    for (const f of checks) {
      n.mind.learned.set(f.id, f.value);
      seen.push(f.check!.zh);
    }
    const highlight = checks.find((f) => onMind.has(f.id))?.check?.zh;
    if (place === "plaza" && world.notices.length) seen.push(`On the notice board: ${world.notices.map((x) => `“${x.text}”`).join(", ")}.`);
    if (world.gatherings[place]) seen.push(`${world.gatherings[place].people.length + world.gatherings[place].extras} people have gathered here: “${world.gatherings[place].cause}”.`);
    if (world.police.deployed && world.police.place === place && (world.police.arriveAt ?? 0) <= t) seen.push("The police are already here.");
    if (place === "stage" && world.stage === "closed") seen.push("The stage has been taped off.");
    if (world.shops[place] === "closed") seen.push(`${cap(placeZh(place))} is closed for the day.`);
    // who is around is part of what you see (and someone you could go and ask)
    const here = [...npcs.values()].filter((o) => o !== n && o.place === place && !o.dest).map((o) => `${o.p.name} (${o.p.roleZh})`);
    // what this look could not have shown them (a glance is not an inspection; not their trade)
    const missed = FACTS.filter((f) => f.check?.place === place && f.check.by === "expert" && !checks.includes(f));
    // a careful look by someone for whom it is not their trade: say so, and who could tell (public roles)
    const whoCan = [...new Set(missed.flatMap((f) => f.check!.roles ?? []))].map((r) => PERSONAS.find((p) => p.role === r)?.roleZh).filter(Boolean);
    const limit = !missed.length ? undefined : expert && whoCan.length ? `You looked carefully, but this isn't your trade and you can't make much of it; it takes someone who knows the work (${whoCan.join(" or ")}) to check this.` : LOOK_LIMITS[place];
    if (!seen.length) seen.push(limit ? `On the surface, everything at ${placeZh(place)} looks normal.` : `Everything at ${placeZh(place)} looks normal; nothing out of the ordinary.`);
    if (limit) seen.push(limit);
    if (here.length) seen.push(`${andList(here)} ${here.length > 1 ? "are" : "is"} here.`);
    return { text: seen.join(" "), highlight: highlight ?? (limit ? `${seen[0]} ${limit}` : seen[0]) };
  }

  function exec(n: Npc, a: ActionIntent, t: Minutes, cause: string, claimIds: string[], next: (t: Minutes) => void) {
    const target = a.target ? npcs.get(a.target) : undefined;
    // a newer decision replaces this plan: continuations of the old one must not act any more
    const plan = n.planId;
    const alive = () => n.planId === plan;
    switch (a.type) {
      case "tell":
      case "ask": {
        if (!target) {
          reject(n, t, cause, "no such person here", a);
          return next(t);
        }
        if (a.type === "tell" && isRepeat(n, target, claimIds, true)) {
          sinkIn(n, target, t, reject(n, t, cause, "already told them the same thing", a));
          return next(t);
        }
        const go = target.dest ?? target.place;
        return walk(n, go, t, cause, (ta) => {
          if (!alive()) return;
          const leaving = target.dest !== null && target.dest !== n.place;
          const arriving = target.dest === n.place;
          if (leaving || (target.place !== n.place && !arriving)) {
            reject(n, ta, cause, `${target.p.name} ${leaving ? "had just left" : "wasn't there"}`, a);
            return next(ta);
          }
          whenFree(n, target, ta, (tg) => { if (alive()) { reject(n, tg, cause, `${target.p.name} was busy the whole time`, a); next(tg); } }, (tb) => {
            if (!alive()) return;
            if (target.place !== n.place || target.dest) {
              reject(n, tb, cause, `${target.p.name} had already left`, a);
              return next(tb);
            }
            n.busyUntil = target.busyUntil = tb + TALK;
            const ev = emit("talk", tb, `${n.p.name} ${a.type === "ask" ? "asked" : "said to"} ${target.p.name}: “${a.message}”`, [cause], {
              actor: n.p.id, target: target.p.id, place: n.place, data: { text: a.message, intent: a.intent ?? (a.type === "ask" ? "ask" : "inform"), claims: claimIds },
            });
            markTold(n, target, claimIds, true);
            countTalk(n, target);
            startConv(n, target, tb + TALK + CONV_LINGER);
            at(tb + TALK, () => {
              deliver(target, n.p.id, "face", a.intent ?? (a.type === "ask" ? "ask" : "inform"), a.message ?? "", claimIds, tb + TALK, ev);
              next(tb + TALK);
            });
          });
        });
      }
      case "phone": {
        if (!target || !n.p.relations[target.p.id]?.phone) {
          reject(n, t, cause, "doesn't have their number", a);
          return next(t);
        }
        if (isRepeat(n, target, claimIds, false)) {
          sinkIn(n, target, t, reject(n, t, cause, "already told them the same thing", a));
          return next(t);
        }
        if (target.busyUntil > t) {
          emit("phone", t, `${n.p.name} called ${target.p.name}, but nobody picked up`, [cause], { actor: n.p.id, target: target.p.id, data: { missed: true } });
          return next(t + 0.5);
        }
        n.busyUntil = target.busyUntil = t + PHONE;
        const ev = emit("phone", t, `${n.p.name} called ${target.p.name}: “${a.message}”`, [cause], {
          actor: n.p.id, target: target.p.id, place: n.place, data: { text: a.message, intent: a.intent ?? "inform", claims: claimIds },
        });
        markTold(n, target, claimIds, false);
        countTalk(n, target);
        at(t + PHONE, () => {
          deliver(target, n.p.id, "phone", a.intent ?? "inform", a.message ?? "", claimIds, t + PHONE, ev);
          next(t + PHONE);
        });
        return;
      }
      case "go_look":
      case "inspect": {
        const place = a.place!;
        // whoever is in a conversation with them comes along (going to look together, not a separate errand)
        const along = companionsOf(n, t);
        const leader = walk(n, place, t, cause, (ta) => {
          const expert = a.type === "inspect";
          const dur = expert ? INSPECT : LOOK;
          n.busyUntil = ta + dur;
          for (const c of along) if (c.place === place || c.dest === place) c.busyUntil = Math.max(c.busyUntil, ta + dur);
          const ev = emit(expert ? "inspect" : "look", ta, `${n.p.name} ${expert ? "carefully inspected" : "looked around"} ${placeZh(place)}`, [cause], { actor: n.p.id, place, data: { with: along.map((c) => c.p.id) } });
          at(ta + dur, () => {
            const seenBy = (who: Npc, careful: boolean, cause2: string, prefix = "") => {
              const r = lookAround(who, place, careful, ta + dur);
              const done = emit(careful ? "inspect" : "look", ta + dur, `${who.p.name}${prefix} saw: ${r.text}`, [cause2], {
                actor: who.p.id, place, data: { found: r.text, highlight: r.highlight, learned: [...who.mind.learned.keys()], with: prefix ? n.p.id : undefined },
              });
              deliver(who, "self", "inspection", "inform", r.text, [], ta + dur, done);
              if (careful) for (const f of FACTS) if (f.check?.by === "expert" && f.check.place === place && who.mind.learned.has(f.id)) mullOver(who, f, ta + dur, done);
              return done;
            };
            const done = seenBy(n, expert, ev);
            // the companion saw it too, with their own eyes (a careful inspection is still the expert's)
            for (const c of along) {
              if (c.place !== place || c.dest) continue;
              seenBy(c, false, done, ` (together with ${n.p.name})`);
              startConv(n, c, ta + dur + CONV_LINGER);
            }
            next(ta + dur);
          });
        });
        // the leader sets off first; the companion walks along beside them
        for (const c of along) {
          if (c.place === place) continue;
          c.planId++;
          walk(c, place, t, cause, () => {}, false, n);
        }
        return leader;
      }
      case "close_shop":
      case "open_shop": {
        const shop = n.p.home;
        if (!(shop in world.shops)) {
          reject(n, t, cause, "has no shop to close", a);
          return next(t);
        }
        return walk(n, shop, t, cause, (ta) => {
          const to = a.type === "close_shop" ? "closed" : "open";
          if (world.shops[shop] === to) return next(ta);
          world.shops[shop] = to;
          const ev = emit("state", ta, `${cap(placeZh(shop))} ${to === "closed" ? "pulled down its shutters and closed for now" : "opened its doors again"}`, [cause], { actor: n.p.id, place: shop, data: { key: `shops.${shop}`, to } });
          spread(ev, ta, shop, `${cap(placeZh(shop))} ${to === "closed" ? "suddenly closed" : "is open again"}`, "crowd", "crowd", { except: [n.p.id], delay: [10, 40], p: 0.5 });
          next(ta + 1);
        });
      }
      case "post_notice":
        return walk(n, "plaza", t, cause, (ta) => {
          n.busyUntil = ta + NOTICE;
          at(ta + NOTICE, () => {
            const id = `n${world.notices.length + 1}`;
            world.notices.push({ id, text: a.message ?? "", by: n.p.id, at: ta + NOTICE });
            const ev = emit("notice", ta + NOTICE, `${n.p.name} put up a notice on the notice board: “${a.message}”`, [cause], { actor: n.p.id, place: "plaza", data: { text: a.message, claims: claimIds } });
            spread(ev, ta + NOTICE, "plaza", a.message ?? "", "notice", "notice", { except: [n.p.id], delay: [15, 50], p: 0.6, claims: claimIds });
            next(ta + NOTICE);
          });
        });
      case "publish_article": {
        const written = new Set(events.filter((e) => e.type === "article" && e.actor === n.p.id).flatMap((e) => e.data.claims as string[]));
        if (claimIds.length && claimIds.every((c) => written.has(c))) {
          reject(n, t, cause, "already wrote about this", a);
          return next(t);
        }
        return walk(n, "news", t, cause, (ta) => {
          n.busyUntil = ta + WRITE;
          emit("state", ta, `${n.p.name} started writing an article`, [cause], { actor: n.p.id, place: "news", data: { key: "writing" } });
          at(ta + WRITE, () => {
            // the headline is what comes before the first line break or colon (English ":" or Chinese "：")
            const msg = a.message ?? "";
            const cut = msg.search(/[\n：:]/);
            const headline = (cut < 0 ? msg : msg.slice(0, cut)).trim();
            const rest = cut < 0 ? "" : msg.slice(cut + 1).trim();
            const art = { id: `a${world.articles.length + 1}`, headline: headline.slice(0, 68), body: rest.slice(0, 510) || headline, by: n.p.id, at: ta + WRITE };
            world.articles.push(art);
            const ev = emit("article", ta + WRITE, `${n.p.name} published “${art.headline}”`, [cause], { actor: n.p.id, place: "news", data: { headline: art.headline, body: art.body, claims: claimIds } });
            spread(ev, ta + WRITE, null, `“${art.headline}” ${art.body}`.slice(0, 272), "article", n.p.id, { except: [n.p.id], delay: [5, 40], p: 0.85, claims: claimIds });
            next(ta + WRITE);
          });
        });
      }
      case "public_statement":
        return walk(n, "townhall", t, cause, (ta) => {
          n.busyUntil = ta + STATEMENT;
          at(ta + STATEMENT, () => {
            world.statements.push({ by: n.p.id, text: a.message ?? "", at: ta + STATEMENT });
            const ev = emit("statement", ta + STATEMENT, `${n.p.name} made a public statement: “${a.message}”`, [cause], { actor: n.p.id, place: "townhall", data: { text: a.message, claims: claimIds } });
            spread(ev, ta + STATEMENT, "townhall", `${n.p.name}'s public statement: ${a.message}`, "crowd", n.p.id, { except: [n.p.id], delay: [5, 25], p: 0.9, claims: claimIds });
            next(ta + STATEMENT);
          });
        });
      case "cancel_festival": {
        if (world.festival !== "scheduled") return next(t);
        world.festival = "cancelled";
        const ev = emit("state", t, `${n.p.name} called off tonight's Lantern Festival: “${a.message}”`, [cause], { actor: n.p.id, place: n.place, data: { key: "festival", to: "cancelled", text: a.message } });
        spread(ev, t, null, `The Lantern Festival is cancelled. ${n.p.name} said: ${a.message}`, "crowd", n.p.id, { except: [n.p.id], delay: [2, 12], p: 1, onDeliver: (o) => o.mind.knows.delete("festival") });
        n.mind.knows.delete("festival");
        return next(t + 2);
      }
      case "dispatch_police": {
        const place = a.place!;
        const arrive = t + 2 + travelMinutes("police", place);
        world.police = { deployed: true, place, arriveAt: arrive };
        const ev = emit("state", t, `${n.p.name} sent officers to ${placeZh(place)}`, [cause], { actor: n.p.id, place: "police", data: { key: "police", to: place, arrive, reason: a.message } });
        at(arrive, () => {
          const ev2 = emit("arrive", arrive, `Officers arrived at ${placeZh(place)}`, [ev], { place, data: { who: "officers" } });
          spread(ev2, arrive, place, `The police have been sent to ${placeZh(place)}`, "crowd", "crowd", { except: [n.p.id], delay: [5, 25], p: 0.7 });
        });
        return next(t + 1);
      }
      case "close_stage":
        return walk(n, "stage", t, cause, (ta) => {
          if (world.stage === "closed") return next(ta);
          world.stage = "closed";
          const ev = emit("state", ta, `${n.p.name} closed off the festival stage`, [cause], { actor: n.p.id, place: "stage", data: { key: "stage", to: "closed", reason: a.message } });
          spread(ev, ta, "stage", "The festival stage has been taped off", "crowd", "crowd", { except: [n.p.id], delay: [5, 25], p: 0.8 });
          next(ta + 1);
        });
      case "rally": {
        const place = a.place!;
        return walk(n, place, t, cause, (ta) => {
          n.busyUntil = ta + RALLY;
          at(ta + RALLY, () => {
            const extras = 2 + Math.floor(rand() * 3); // other stall owners who come along
            world.gatherings[place] = { cause: a.message ?? "", people: [n.p.id], extras };
            const ev = emit("gather", ta + RALLY, `${n.p.name} brought ${extras} stall owners to ${placeZh(place)}: “${a.message}”`, [cause], { actor: n.p.id, place, data: { extras, text: a.message, claims: claimIds } });
            spread(ev, ta + RALLY, place, `${n.p.name} has a group of stall owners gathered at ${placeZh(place)}: ${a.message}`, "crowd", "crowd", { except: [n.p.id], delay: [5, 25], p: 0.8 });
            next(ta + RALLY);
          });
        });
      }
      default:
        reject(n, t, cause, "that can't be done in this world", a);
        return next(t);
    }
  }

  // ---- routine meetings ----------------------------------------------------------------------------
  // what someone carries into a meeting: a belief (≥0.3) of a kind that belongs there; returns its belief event
  const carried = (x: Npc, about?: string[]) => {
    for (const b of [...x.mind.beliefs.values()].sort((p, q) => q.updatedAt - p.updatedAt)) {
      if (b.confidence < 0.3) continue;
      const cat = TOPIC_CATEGORY[claims.get(b.claim)?.topic ?? ""] ?? claims.get(b.claim)?.category;
      if (!about || (cat && about.includes(cat))) return x.beliefEvents.get(b.claim) ?? x.lastBelief;
    }
    return null;
  };
  const carrying = (x: Npc) => carried(x) !== null;
  if (cfg.routine ?? true) {
    for (const r of ROUTINE) {
      const a = npcs.get(r.who);
      const b = npcs.get(r.with);
      if (!a || !b || r.at <= seedAt || r.at > endAt) continue;
      const pointless = () => !(carried(a, r.about) ?? carried(b, r.about));
      at(r.at, () => {
        // only worth playing out if one of them has something on their mind that belongs in this meeting
        const reason = carried(a, r.about) ?? carried(b, r.about);
        if (!reason) return;
        if (a.busyUntil > r.at || b.place !== r.place || b.dest) return;
        // the meeting matters only because of what they carry, so that is its cause
        const go = reason;
        walk(a, r.place, r.at, go, (ta) => {
          if (b.place !== r.place || b.dest) return goHome(a, ta, go);
          const free = Math.max(ta, b.busyUntil);
          at(free, () => {
            a.busyUntil = b.busyUntil = free + 2;
            startConv(a, b, free + 2 + CONV_LINGER);
            const meet = emit("meet", free, `${a.p.name} and ${b.p.name} met at ${placeZh(r.place)} (${r.zh})`, [go], { actor: a.p.id, target: b.p.id, place: r.place, data: { text: r.zh } });
            at(free + 2, () => {
              for (const [x, y] of [[a, b], [b, a]] as const) if (carrying(x)) deliver(x, y.p.id, "meet", "inform", r.zh, [], free + 2, meet);
              // the visitor heads home once the conversation is over, unless a decision gives them something else to do
              const plan = a.planId;
              at(
                free + 2 + REACT,
                () => {
                  if (plan === a.planId && a.busyUntil <= free + 2 + REACT + 1e-6 && !a.dest) settle(a, free + 2 + REACT, meet);
                },
                IDLE,
              );
            });
          });
        });
      }, pointless);
    }
  }

  // ---- the festival's own clock: preparation milestones, then 20:00 -------------------------------
  // They read the world as the log stands (festival.ts) and change nothing by themselves except what the evening
  // looks like; no resident decides anything here. A story that runs out of decisions still reaches 20:00 this way.
  if (cfg.festival ?? true) {
    const infoNow = () => claimInfoOf(events, [...claims.values()]);
    for (const m of MILESTONES) {
      if (m.at <= seedAt || m.at > endAt) continue;
      at(m.at, () => {
        const r = milestoneOf(m.id, events, infoNow());
        emit("milestone", m.at, `${m.zh}: ${r.text}`, r.causes, { place: m.id === "vendors" || m.id === "police" ? "plaza" : "stage", data: { ...r } });
      }, IDLE);
    }
    if (endAt >= FESTIVAL_AT)
      at(FESTIVAL_AT, () => {
        const o = readinessOf(events, [...claims.values()]).outcome;
        const prep = events.filter((e) => e.type === "milestone" && e.data.status !== "ok").map((e) => e.id);
        emit("festival", FESTIVAL_AT, o.text, prep, { place: "plaza", data: { kind: o.kind, short: o.short, tags: o.tags, missing: o.missing, text: o.text } });
      }, IDLE);
  }

  // ---- seed and main loop --------------------------------------------------------------------
  const seedNpc = npcs.get(cfg.seedNpc)!;
  const seedEv = emit("seed", seedAt, `A thought was planted in ${seedNpc.p.name}'s ear: “${cfg.seedText}”`, [], { target: seedNpc.p.id, place: seedNpc.place, data: { text: cfg.seedText } });
  at(seedAt, () =>
    cfg.seedVia === "hunch"
      ? deliver(seedNpc, "hunch", "hunch", "inform", cfg.seedText, [], seedAt, seedEv)
      : deliver(seedNpc, "unknown", "seed", "inform", cfg.seedText, [], seedAt, seedEv),
  );

  const popEarliest = () => {
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].t < queue[k].t || (queue[i].t === queue[k].t && queue[i].seq < queue[k].seq)) k = i;
    return queue.splice(k, 1)[0];
  };
  let endReason: RunResult["ended"]["reason"] = "quiet";
  const whispers: RunResult["whispers"] = [];
  const LULL_LATEST = 240; // 19:00: later than this a second whisper has no evening left to play out in
  const LULL_MIN_LEFT = 5;
  const lull = () =>
    !!cfg.onLull &&
    whispers.length === 0 &&
    maxDecisions - realDecisions >= LULL_MIN_LEFT &&
    [...npcs.values()].every((n) => n.decisionAt === null && !n.mind.inbox.length) &&
    queue.every((q) => q.kind === "task" && q.idle?.() === true) &&
    // the story went quiet because the model stopped answering: a second whisper would fail the same way
    ![...decisions].reverse().find((d) => !d.validation.some((v) => v.kind === "budget"))?.fallback &&
    !cfg.shouldStop?.();
  async function offerWhisper() {
    const t = Math.max(now, ...events.map((e) => e.t)) + 1;
    if (t > LULL_LATEST) return;
    const reached = [...new Set(events.filter((e) => e.type === "deliver" && e.target && e.data.via !== "inspection").map((e) => e.target!))];
    // everything up to the lull has been computed: let playback catch up while the player decides
    cfg.onFrontier?.(t);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = new Promise<null>((res) => (timer = setTimeout(() => res(null), 180_000)));
    const w = await Promise.race([cfg.onLull!({ t, decisionsLeft: maxDecisions - realDecisions, reached }), wait]).catch(() => null);
    clearTimeout(timer); // answered: stop the 3-minute wait instead of leaving it pending
    const n = w && npcs.get(w.npc);
    if (!w || !n || !w.text.trim()) {
      whispers.push({ npc: "", text: "", t, event: "" }); // offered once; declined
      return;
    }
    const ev = emit("seed", t, `Another thought was planted in ${n.p.name}'s ear: “${w.text}”`, [], { target: n.p.id, place: n.place, data: { text: w.text, second: true } });
    whispers.push({ npc: n.p.id, text: w.text, t, event: ev });
    at(t, () => deliver(n, "unknown", "seed", "inform", w.text, [], t, ev));
  }
  while (true) {
    if (cfg.shouldStop?.()) {
      queue.length = 0;
      break;
    }
    if (lull()) await offerWhisper();
    if (!queue.length) break;
    const first = popEarliest();
    if (first.t > endAt) {
      endReason = "time";
      queue.length = 0;
      break;
    }
    now = Math.max(now, first.t);
    if (first.kind === "task") {
      first.run();
      continue;
    }
    cfg.onFrontier?.(first.t);
    // Decisions inside one reaction window cannot affect each other, so run them together.
    const nextTask = Math.min(...queue.filter((q) => q.kind === "task").map((q) => q.t), Infinity);
    const horizon = Math.min(first.t + REACT, nextTask);
    const batch: Item[] = [first];
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.kind === "decide" && q.t < horizon && q.t <= endAt && !batch.some((b) => b.kind === "decide" && b.npc === q.npc)) batch.push(...queue.splice(i, 1));
    }
    await Promise.all(batch.map((b) => (b.kind === "decide" && npcs.get(b.npc)!.decisionAt === b.t ? decide(npcs.get(b.npc)!, b.t) : Promise.resolve())));
  }
  if (budgetHit) endReason = "budget";
  // only whispers the player actually made are part of the story
  for (let i = whispers.length - 1; i >= 0; i--) if (!whispers[i].npc) whispers.splice(i, 1);
  // a quiet story ends a beat after the last thing that happened, not when the last no-op timer
  // (an unneeded routine meeting at 18:30) was checked: the clock and sky would jump hours ahead
  const lastT = Math.max(seedAt, ...events.map((e) => e.t));
  const endT = endReason === "time" ? endAt : Math.min(endAt, lastT + 1);
  emit("end", endT, endReason === "quiet" ? "Nobody acted on it any further, and the thought faded away." : endReason === "time" ? "Time's up." : "The story pauses here (this simulation reached its decision limit).", [], {
    data: { reason: endReason, festival: world.festival },
  });
  cfg.onFrontier?.(Infinity);

  const llmAll: LlmRecord[] = decisions.flatMap((d) => d.llm);
  return {
    config: { ...cfg, chat: undefined, onEvent: undefined, onDecision: undefined, onFrontier: undefined, onThinking: undefined, onLull: undefined } as RunResult["config"],
    whispers,
    events,
    decisions,
    claims: [...claims.values()],
    world,
    minds: Object.fromEntries([...npcs.values()].map((n) => [n.p.id, { place: n.place, beliefs: [...n.mind.beliefs.values()], learned: [...n.mind.learned.entries()], memory: n.mind.memory }])),
    ended: { reason: endReason, t: endT },
    wall: { startedAt: new Date(clock0).toISOString(), ms: Date.now() - clock0 },
    llm: {
      calls: llmAll.length,
      attempts: llmAll.reduce((s, l) => s + l.attempts, 0),
      promptTokens: llmAll.reduce((s, l) => s + l.promptTokens, 0),
      completionTokens: llmAll.reduce((s, l) => s + l.completionTokens, 0),
      platformCost: llmAll.reduce((s, l) => s + l.platformCost, 0),
      estCost: llmAll.reduce((s, l) => s + l.estCost, 0),
      errors: llmAll.filter((l) => l.status !== 200).length,
      fallbacks: decisions.filter((d) => d.fallback).length,
    },
  };
}
