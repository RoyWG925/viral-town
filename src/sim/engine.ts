// VIRAL simulation engine: a discrete-event world that owns the truth.
// Residents decide (Gemma or rules); the engine validates, moves them, delivers messages, resolves
// inspections against the facts, changes world state and records every cause in the event log.
import { LOOK_LIMITS, TOPIC_CATEGORY, FACTS, FESTIVAL_AT, PERSONAS, PLACES, PUBLIC_INFO, ROUTINE, TOPICS, initialWorld } from "./scenario.ts";

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
}

export interface RunResult {
  config: Omit<SimConfig, "chat" | "onEvent" | "onDecision" | "onFrontier" | "onThinking">;
  events: SimEvent[];
  decisions: DecisionRecord[];
  claims: Claim[];
  world: WorldState;
  minds: Record<NpcId, { place: PlaceId; beliefs: Belief[]; learned: [FactId, boolean][]; memory: string[] }>;
  ended: { reason: "quiet" | "time" | "budget"; t: Minutes };
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

const placeZh = (id: PlaceId) => PLACES.find((p) => p.id === id)?.zh ?? id;
const fact = (id: FactId) => FACTS.find((f) => f.id === id)!;

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
}

type Item = { t: Minutes; seq: number } & ({ kind: "task"; run: () => void } | { kind: "decide"; npc: NpcId });

export async function simulate(cfg: SimConfig): Promise<RunResult> {
  const seedAt = cfg.seedAt ?? 20;
  const endAt = cfg.endAt ?? FESTIVAL_AT;
  const policy = cfg.policy ?? "gemma";
  const variant = cfg.variant ?? "single";
  const temperature = cfg.temperature ?? 0.7;
  const maxDecisions = cfg.maxDecisions ?? 30;
  const maxPerNpc = cfg.maxPerNpc ?? 6;
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
      p, place: p.home, dest: null, busyUntil: 0, decisionAt: null, triggers: [], publicEvents: [], heard: [], planId: 0, lastBelief: null, beliefEvents: new Map(),
      mind: { knows: new Set(p.knows), learned: new Map(), beliefs: new Map(), inbox: [], memory: [], decisions: 0, lastDecisionAt: -99, told: new Map(), heardKeys: new Set() },
    });
  }
  const SOURCE_ZH: Record<string, string> = { unknown: "一位陌生客人", crowd: "客人們", notice: "布告欄", self: "你自己", news: "新聞", hunch: "自己的念頭" };
  const name = (id: string) => npcs.get(id)?.p.name ?? SOURCE_ZH[id] ?? id;

  const emit = (type: EventType, t: Minutes, zh: string, causes: string[], fields: Partial<SimEvent> = {}): string => {
    // full precision: rounding here would let events slip below a frontier already reported to playback
    const e: SimEvent = { id: `e${events.length + 1}`, t, type, causes: [...new Set(causes)], data: {}, zh, ...fields, w: Date.now() - clock0 };
    events.push(e);
    cfg.onEvent?.(e);
    return e.id;
  };
  const at = (t: Minutes, run: () => void) => queue.push({ t, seq: seq++, kind: "task", run });

  // ---- messages and decisions --------------------------------------------------------------
  let msgN = 0;
  function deliver(to: Npc, from: Message["from"], via: Message["via"], intent: Intent, text: string, claimIds: string[], t: Minutes, cause: string) {
    const sender = npcs.get(from);
    const senderConf = sender && claimIds.length ? Math.max(...claimIds.map((c) => sender.mind.beliefs.get(c)?.confidence ?? 0)) : undefined;
    const m: Message = { id: `m${++msgN}`, from, to: to.p.id, via, intent, text, claims: claimIds, at: t, event: cause, senderConf };
    const how: Record<string, string> = {
      face: `聽${name(from)}說：「${text}」`, phone: `在電話裡聽${name(from)}說：「${text}」`, inspection: `親眼看到：${text}`,
      article: `看到${name(from)}的文章：${text}`, notice: `看到布告欄：「${text}」`, crowd: `聽客人說：${text}`, seed: `聽到一位陌生客人說：「${text}」`,
      hunch: `腦中突然冒出一個念頭：「${text}」`,
      meet: `碰到了${name(from)}（${text}）`,
    };
    const ev = emit("deliver", t, `${to.p.name}${how[via] ?? `得知：${text}`}`, [cause], {
      target: to.p.id, actor: npcs.has(from) ? from : undefined, place: to.place, data: { message: m.id, via, intent, text, claims: claimIds, from },
    });
    m.event = ev;
    to.heard.push(text);
    // Hearing the same thing again from the same person adds nothing: remember it, don't re-decide.
    const repeat = claimIds.length > 0 && claimIds.every((c) => to.mind.heardKeys.has(`${from}|${c}`));
    for (const c of claimIds) to.mind.heardKeys.add(`${from}|${c}`);
    if (repeat) {
      events[events.length - 1].data.repeat = true;
      to.mind.memory.push(`${clockOf(t)} ${name(from)}又跟你說了一次：「${text.slice(0, 40)}」`);
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
      knowledge.push({ id, zh: f.value ? f.zh : (f.notZh ?? `這不是真的：${f.zh.replace(/。$/, "")}。`), secret: n.p.secrets.includes(id), learned: false });
    }
    for (const [id, value] of n.mind.learned) {
      if (id in known) continue;
      known[id] = value;
      const f = fact(id);
      knowledge.push({ id, zh: f.check?.zh ?? (value ? f.zh : (f.notZh ?? `這不是真的：${f.zh}`)), secret: false, learned: true });
    }
    const items: InboxItem[] = inbox.map((m) => ({ id: m.id, from: m.from, fromZh: name(m.from), via: m.via, intent: m.intent, text: m.text, trust: trustIn(n.p, m.from), senderConf: m.senderConf }));
    return {
      npc: n.p, t, clock: clockOf(t), place: n.place, placeZh: placeZh(n.place), knowledge, known,
      beliefs: [...n.mind.beliefs.values()].map((b) => {
        const c = claims.get(b.claim)!;
        return { id: c.id, statement: c.statement, topic: c.topic, says: c.says, category: c.category, confidence: b.confidence, sources: b.sources, sourcesZh: b.sources.map(name).join("、") };
      }),
      inbox: items,
      memory: n.mind.memory,
      // residents know where people usually are, not where they are right now; the engine finds them
      people: [...npcs.values()].filter((o) => o !== n).map((o) => ({
        id: o.p.id, name: o.p.name, roleZh: o.p.roleZh, place: o.p.home, placeZh: placeZh(o.p.home),
        relation: n.p.relations[o.p.id] ?? { trust: 0.35, phone: false, zh: "點頭之交" }, busy: false,
      })),
      actions: ["tell", "phone", "ask", "go_look", ...n.p.actions],
      publicEvents: n.publicEvents,
      heardText: [...n.heard, ...n.mind.memory, TOPIC_TEXT].join(" "),
      publicInfo: PUBLIC_INFO,
    };
  }

  async function decide(n: Npc, t: Minutes) {
    n.decisionAt = null;
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
    const globalCap = realDecisions >= maxDecisions;
    if (globalCap || n.mind.decisions >= maxPerNpc) {
      if (globalCap) budgetHit = true;
      rec.fallback = true;
      rec.validation.push({ attempt: 0, kind: "budget", errors: ["decision budget reached"] });
      for (const m of inbox) n.mind.memory.push(`${clockOf(t)} ${name(m.from)}說：「${m.text}」（你沒有多想）`);
      rec.applied.push(emit("decide", t, `${n.p.name}聽了，但沒有多想（模擬達到決策上限）`, triggers, { actor: n.p.id, place: n.place, data: { decision: id, budget: true } }));
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
    rec.output = res.output;
    apply(n, t, rec, res, inbox);
    cfg.onDecision?.(rec);
  }

  function apply(n: Npc, t: Minutes, rec: DecisionRecord, res: MindResult, inbox: Message[]) {
    const out = res.output;
    const dEv = emit("decide", t, `${n.p.name}：${out.thought}`, rec.triggers, {
      actor: n.p.id, place: n.place,
      data: { decision: rec.id, understanding: out.understanding, thought: out.thought, feeling: out.feeling, policy: rec.policy, fallback: rec.fallback, actions: out.actions.map((a) => a.type) },
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
      const bEv = emit("belief", t, `${n.p.name}對「${claims.get(cid)!.statement}」的信心：${(prev?.confidence ?? 0).toFixed(2)} → ${conf.toFixed(2)}（${s.verdict}）`, [dEv], {
        // `limit` says which engine rule moved the model's number, so the player can be told why
        actor: n.p.id, data: { claim: cid, from: prev?.confidence ?? 0, to: conf, proposed: s.confidence, verdict: s.verdict, why: s.why, limit: res.checked.limits?.[s.claim] },
      });
      rec.applied.push(bEv);
      if (conf >= 0.3) n.lastBelief = bEv;
      n.beliefEvents.set(cid, bEv);
    });
    rec.applied.push(emit("react", t + 0.1, `${n.p.name} ${out.feeling}`, [dEv], { actor: n.p.id, place: n.place, data: { feeling: out.feeling } }));
    for (const m of inbox) n.mind.memory.push(`${clockOf(m.at)} ${m.from === "self" ? "你親眼看到" : `${name(m.from)}${m.via === "phone" ? "打電話" : ""}說`}：「${m.text.slice(0, 60)}」`);
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
      if (k >= plan.length) return goHome(n, ts, dEv);
      const a = plan[k];
      exec(n, a, ts, dEv, claimsFor(a), (te) => runStep(k + 1, te));
    };
    if (plan.length) {
      n.busyUntil = Math.max(n.busyUntil, t + REACT);
      n.mind.memory.push(`${clockOf(t)} 你決定：${plan.map((a) => describe(a)).join("，然後")}`);
      at(t + REACT, () => runStep(0, t + REACT));
    } else n.mind.memory.push(`${clockOf(t)} 你決定先不做什麼。`);
  }

  const describe = (a: ActionIntent) => {
    const who = a.target ? name(a.target) : "";
    switch (a.type) {
      case "tell": return `去跟${who}說「${a.message ?? ""}」`;
      case "phone": return `打電話給${who}說「${a.message ?? ""}」`;
      case "ask": return `去問${who}「${a.message ?? ""}」`;
      case "go_look": return `去${placeZh(a.place!)}看看`;
      case "inspect": return `去檢查${placeZh(a.place!)}`;
      default: return a.type;
    }
  };

  function walk(n: Npc, to: PlaceId, t: Minutes, cause: string, then: (t: Minutes) => void, home = false) {
    if (n.place === to) return then(t);
    const dt = travelMinutes(n.place, to);
    const from = n.place;
    n.dest = to;
    n.busyUntil = t + dt;
    const ev = emit("move", t, `${n.p.name}從${placeZh(from)}${home ? "走回" : "走向"}${placeZh(to)}`, [cause], { actor: n.p.id, place: from, data: { from, to, arrive: t + dt, home } });
    at(t + dt, () => {
      n.place = to;
      n.dest = null;
      emit("arrive", t + dt, `${n.p.name}到了${placeZh(to)}`, [ev], { actor: n.p.id, place: to, data: {} });
      then(t + dt);
    });
  }

  function goHome(n: Npc, t: Minutes, cause: string) {
    if (n.place === n.p.home) return;
    walk(n, n.p.home, t, cause, () => {}, true);
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
  function markTold(n: Npc, target: Npc, claimIds: string[], face: boolean) {
    const told = n.mind.told.get(target.p.id) ?? new Map<string, { n: number; conf: number; face: boolean }>();
    for (const c of claimIds) {
      const r = told.get(c);
      told.set(c, { n: (r?.n ?? 0) + 1, conf: n.mind.beliefs.get(c)?.confidence ?? 0, face: face || !!r?.face });
    }
    n.mind.told.set(target.p.id, told);
  }

  function reject(n: Npc, t: Minutes, cause: string, why: string, a: ActionIntent) {
    return emit("rejected", t, `${n.p.name}沒能${describe(a)}：${why}`, [cause], { actor: n.p.id, data: { action: a.type, why } });
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
          reject(n, t, cause, "找不到這個人", a);
          return next(t);
        }
        if (a.type === "tell" && isRepeat(n, target, claimIds, true)) {
          reject(n, t, cause, "已經跟對方說過同一件事了", a);
          return next(t);
        }
        const go = target.dest ?? target.place;
        return walk(n, go, t, cause, (ta) => {
          if (!alive()) return;
          const leaving = target.dest !== null && target.dest !== n.place;
          const arriving = target.dest === n.place;
          if (leaving || (target.place !== n.place && !arriving)) {
            reject(n, ta, cause, `${target.p.name}${leaving ? "剛好離開了" : "不在這裡"}`, a);
            return next(ta);
          }
          whenFree(n, target, ta, (tg) => { if (alive()) { reject(n, tg, cause, `${target.p.name}一直在忙`, a); next(tg); } }, (tb) => {
            if (!alive()) return;
            if (target.place !== n.place || target.dest) {
              reject(n, tb, cause, `${target.p.name}已經離開了`, a);
              return next(tb);
            }
            n.busyUntil = target.busyUntil = tb + TALK;
            const ev = emit("talk", tb, `${n.p.name}對${target.p.name}說：「${a.message}」`, [cause], {
              actor: n.p.id, target: target.p.id, place: n.place, data: { text: a.message, intent: a.intent ?? (a.type === "ask" ? "ask" : "inform"), claims: claimIds },
            });
            markTold(n, target, claimIds, true);
            at(tb + TALK, () => {
              deliver(target, n.p.id, "face", a.intent ?? (a.type === "ask" ? "ask" : "inform"), a.message ?? "", claimIds, tb + TALK, ev);
              next(tb + TALK);
            });
          });
        });
      }
      case "phone": {
        if (!target || !n.p.relations[target.p.id]?.phone) {
          reject(n, t, cause, "沒有對方的電話", a);
          return next(t);
        }
        if (isRepeat(n, target, claimIds, false)) {
          reject(n, t, cause, "已經跟對方說過同一件事了", a);
          return next(t);
        }
        if (target.busyUntil > t) {
          emit("phone", t, `${n.p.name}打給${target.p.name}，但對方沒接`, [cause], { actor: n.p.id, target: target.p.id, data: { missed: true } });
          return next(t + 0.5);
        }
        n.busyUntil = target.busyUntil = t + PHONE;
        const ev = emit("phone", t, `${n.p.name}打電話給${target.p.name}：「${a.message}」`, [cause], {
          actor: n.p.id, target: target.p.id, place: n.place, data: { text: a.message, intent: a.intent ?? "inform", claims: claimIds },
        });
        markTold(n, target, claimIds, false);
        at(t + PHONE, () => {
          deliver(target, n.p.id, "phone", a.intent ?? "inform", a.message ?? "", claimIds, t + PHONE, ev);
          next(t + PHONE);
        });
        return;
      }
      case "go_look":
      case "inspect": {
        const place = a.place!;
        return walk(n, place, t, cause, (ta) => {
          const expert = a.type === "inspect";
          const dur = expert ? INSPECT : LOOK;
          n.busyUntil = ta + dur;
          const ev = emit(expert ? "inspect" : "look", ta, `${n.p.name}在${placeZh(place)}${expert ? "仔細檢查" : "到處看看"}`, [cause], { actor: n.p.id, place, data: {} });
          at(ta + dur, () => {
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
            if (place === "plaza" && world.notices.length) seen.push(`布告欄上貼著：${world.notices.map((x) => `「${x.text}」`).join("、")}`);
            if (world.gatherings[place]) seen.push(`這裡聚集了 ${world.gatherings[place].people.length + world.gatherings[place].extras} 個人在${world.gatherings[place].cause}`);
            if (world.police.deployed && world.police.place === place && (world.police.arriveAt ?? 0) <= ta + dur) seen.push("警察已經在這裡了。");
            if (place === "stage" && world.stage === "closed") seen.push("舞台已經被封鎖了。");
            if (world.shops[place] === "closed") seen.push(`${placeZh(place)}今天暫停營業。`);
            // who is around is part of what you see (and someone you could go and ask)
            const here = [...npcs.values()].filter((o) => o !== n && o.place === place && !o.dest).map((o) => `${o.p.name}（${o.p.roleZh}）`);
            // what this look could not have shown them (a glance is not an inspection; not their trade)
            const missed = FACTS.some((f) => f.check?.place === place && f.check.by === "expert" && !checks.includes(f));
            const limit = missed ? LOOK_LIMITS[place] : undefined;
            if (!seen.length) seen.push(limit ? `${placeZh(place)}表面上看起來一切如常。` : `${placeZh(place)}看起來一切如常，沒看到什麼特別的。`);
            if (limit) seen.push(limit);
            if (here.length) seen.push(`${here.join("、")}在這裡。`);
            const text = seen.join(" ");
            const done = emit(expert ? "inspect" : "look", ta + dur, `${n.p.name}看到：${text}`, [ev], { actor: n.p.id, place, data: { found: text, highlight: highlight ?? seen[0], learned: [...n.mind.learned.keys()] } });
            deliver(n, "self", "inspection", "inform", text, [], ta + dur, done);
            next(ta + dur);
          });
        });
      }
      case "close_shop":
      case "open_shop": {
        const shop = n.p.home;
        if (!(shop in world.shops)) {
          reject(n, t, cause, "你沒有店可以關", a);
          return next(t);
        }
        return walk(n, shop, t, cause, (ta) => {
          const to = a.type === "close_shop" ? "closed" : "open";
          if (world.shops[shop] === to) return next(ta);
          world.shops[shop] = to;
          const ev = emit("state", ta, `${placeZh(shop)}${to === "closed" ? "拉下鐵門，暫停營業" : "重新開門營業"}`, [cause], { actor: n.p.id, place: shop, data: { key: `shops.${shop}`, to } });
          spread(ev, ta, shop, `${placeZh(shop)}${to === "closed" ? "突然關店了" : "又開門了"}`, "crowd", "crowd", { except: [n.p.id], delay: [10, 40], p: 0.5 });
          next(ta + 1);
        });
      }
      case "post_notice":
        return walk(n, "plaza", t, cause, (ta) => {
          n.busyUntil = ta + NOTICE;
          at(ta + NOTICE, () => {
            const id = `n${world.notices.length + 1}`;
            world.notices.push({ id, text: a.message ?? "", by: n.p.id, at: ta + NOTICE });
            const ev = emit("notice", ta + NOTICE, `${n.p.name}在布告欄貼了公告：「${a.message}」`, [cause], { actor: n.p.id, place: "plaza", data: { text: a.message, claims: claimIds } });
            spread(ev, ta + NOTICE, "plaza", a.message ?? "", "notice", "notice", { except: [n.p.id], delay: [15, 50], p: 0.6, claims: claimIds });
            next(ta + NOTICE);
          });
        });
      case "publish_article": {
        const written = new Set(events.filter((e) => e.type === "article" && e.actor === n.p.id).flatMap((e) => e.data.claims as string[]));
        if (claimIds.length && claimIds.every((c) => written.has(c))) {
          reject(n, t, cause, "已經寫過這件事了", a);
          return next(t);
        }
        return walk(n, "news", t, cause, (ta) => {
          n.busyUntil = ta + WRITE;
          emit("state", ta, `${n.p.name}開始寫文章`, [cause], { actor: n.p.id, place: "news", data: { key: "writing" } });
          at(ta + WRITE, () => {
            const [headline, ...rest] = (a.message ?? "").split(/[\n：:]/);
            const art = { id: `a${world.articles.length + 1}`, headline: headline.slice(0, 40), body: rest.join("：").slice(0, 300) || headline, by: n.p.id, at: ta + WRITE };
            world.articles.push(art);
            const ev = emit("article", ta + WRITE, `${n.p.name}發文〈${art.headline}〉`, [cause], { actor: n.p.id, place: "news", data: { headline: art.headline, body: art.body, claims: claimIds } });
            spread(ev, ta + WRITE, null, `〈${art.headline}〉${art.body}`.slice(0, 160), "article", n.p.id, { except: [n.p.id], delay: [5, 40], p: 0.85, claims: claimIds });
            next(ta + WRITE);
          });
        });
      }
      case "public_statement":
        return walk(n, "townhall", t, cause, (ta) => {
          n.busyUntil = ta + STATEMENT;
          at(ta + STATEMENT, () => {
            world.statements.push({ by: n.p.id, text: a.message ?? "", at: ta + STATEMENT });
            const ev = emit("statement", ta + STATEMENT, `${n.p.name}發表公開聲明：「${a.message}」`, [cause], { actor: n.p.id, place: "townhall", data: { text: a.message, claims: claimIds } });
            spread(ev, ta + STATEMENT, "townhall", `${n.p.name}的公開聲明：${a.message}`, "crowd", n.p.id, { except: [n.p.id], delay: [5, 25], p: 0.9, claims: claimIds });
            next(ta + STATEMENT);
          });
        });
      case "cancel_festival": {
        if (world.festival !== "scheduled") return next(t);
        world.festival = "cancelled";
        const ev = emit("state", t, `${n.p.name}宣布取消今晚的燈籠節：「${a.message}」`, [cause], { actor: n.p.id, place: n.place, data: { key: "festival", to: "cancelled", text: a.message } });
        spread(ev, t, null, `燈籠節取消了。${n.p.name}說：${a.message}`, "crowd", n.p.id, { except: [n.p.id], delay: [2, 12], p: 1, onDeliver: (o) => o.mind.knows.delete("festival") });
        n.mind.knows.delete("festival");
        return next(t + 2);
      }
      case "dispatch_police": {
        const place = a.place!;
        const arrive = t + 2 + travelMinutes("police", place);
        world.police = { deployed: true, place, arriveAt: arrive };
        const ev = emit("state", t, `${n.p.name}派警員前往${placeZh(place)}`, [cause], { actor: n.p.id, place: "police", data: { key: "police", to: place, arrive, reason: a.message } });
        at(arrive, () => {
          const ev2 = emit("arrive", arrive, `警員抵達${placeZh(place)}`, [ev], { place, data: { who: "officers" } });
          spread(ev2, arrive, place, `警察出動到${placeZh(place)}了`, "crowd", "crowd", { except: [n.p.id], delay: [5, 25], p: 0.7 });
        });
        return next(t + 1);
      }
      case "close_stage":
        return walk(n, "stage", t, cause, (ta) => {
          if (world.stage === "closed") return next(ta);
          world.stage = "closed";
          const ev = emit("state", ta, `${n.p.name}封鎖了慶典舞台`, [cause], { actor: n.p.id, place: "stage", data: { key: "stage", to: "closed", reason: a.message } });
          spread(ev, ta, "stage", "慶典舞台被拉起封鎖線了", "crowd", "crowd", { except: [n.p.id], delay: [5, 25], p: 0.8 });
          next(ta + 1);
        });
      case "rally": {
        const place = a.place!;
        return walk(n, place, t, cause, (ta) => {
          n.busyUntil = ta + RALLY;
          at(ta + RALLY, () => {
            const extras = 2 + Math.floor(rand() * 3); // other stall owners who come along
            world.gatherings[place] = { cause: a.message ?? "", people: [n.p.id], extras };
            const ev = emit("gather", ta + RALLY, `${n.p.name}帶著 ${extras} 位攤商聚到${placeZh(place)}：「${a.message}」`, [cause], { actor: n.p.id, place, data: { extras, text: a.message, claims: claimIds } });
            spread(ev, ta + RALLY, place, `${n.p.name}帶著一群攤商聚在${placeZh(place)}：${a.message}`, "crowd", "crowd", { except: [n.p.id], delay: [5, 25], p: 0.8 });
            next(ta + RALLY);
          });
        });
      }
      default:
        reject(n, t, cause, "這個行動在世界裡無法執行", a);
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
            const meet = emit("meet", free, `${a.p.name}和${b.p.name}在${placeZh(r.place)}碰面（${r.zh}）`, [go], { actor: a.p.id, target: b.p.id, place: r.place, data: { text: r.zh } });
            at(free + 2, () => {
              for (const [x, y] of [[a, b], [b, a]] as const) if (carrying(x)) deliver(x, y.p.id, "meet", "inform", r.zh, [], free + 2, meet);
              // the visitor heads home afterwards unless a decision gives them something else to do
              at(free + 4, () => {
                if (a.busyUntil <= free + 4 && a.place !== a.p.home && !a.dest) goHome(a, free + 4, meet);
              });
            });
          });
        });
      });
    }
  }

  // ---- seed and main loop --------------------------------------------------------------------
  const seedNpc = npcs.get(cfg.seedNpc)!;
  const seedEv = emit("seed", seedAt, `一個念頭被植入${seedNpc.p.name}耳中：「${cfg.seedText}」`, [], { target: seedNpc.p.id, place: seedNpc.place, data: { text: cfg.seedText } });
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
  while (queue.length) {
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
  // a quiet story ends a beat after the last thing that happened, not when the last no-op timer
  // (an unneeded routine meeting at 18:30) was checked: the clock and sky would jump hours ahead
  const lastT = Math.max(seedAt, ...events.map((e) => e.t));
  const endT = endReason === "time" ? endAt : Math.min(endAt, lastT + 1);
  emit("end", endT, endReason === "quiet" ? "沒有人再採取行動，這個念頭停了下來。" : endReason === "time" ? "時間到了。" : "故事先告一段落（達到這次模擬的判斷上限）。", [], {
    data: { reason: endReason, festival: world.festival },
  });
  cfg.onFrontier?.(Infinity);

  const llmAll: LlmRecord[] = decisions.flatMap((d) => d.llm);
  return {
    config: { ...cfg, chat: undefined, onEvent: undefined, onDecision: undefined, onFrontier: undefined, onThinking: undefined } as RunResult["config"],
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
