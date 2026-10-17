// Playback director: plays a finished (or still-growing) simulation log in the 3D town.
// It never asks the model anything; it only re-enacts recorded, validated events in order.
import type { RunResult } from "../sim/engine.ts";
import { SPOTS } from "../sim/geo.ts";
import { PERSONAS, PLACES } from "../sim/scenario.ts";
import { gapSeconds } from "../sim/timing.ts";
import type { SimEvent } from "../sim/types.ts";
import { clockOf } from "../sim/view.ts";
import { actFrom, DAWDLE, HURRY, type Act } from "../sim/acts.ts";
import { agentAt, crowd, faceToward, perform, releaseScript, scriptGoto, scriptHold, type Agent } from "./crowdSim";
import { sting, voice } from "./sfx";
import { pets } from "./petSim";

/** Which crowd agent plays each core resident. */
export const NPC_POST: Record<string, string> = {
  baker: "bakery", florist: "flower", journalist: "news", cafe: "cafe", police: "police", mayor: "townhall", organizer: "stage", vendor: "stall-2",
};
export const POST_NPC = Object.fromEntries(Object.entries(NPC_POST).map(([k, v]) => [v, k]));
export const agentFor = (npc: string): Agent | null => (NPC_POST[npc] ? agentAt(NPC_POST[npc]) : null);
export const nameOf = (npc: string) => PERSONAS.find((p) => p.id === npc)?.name ?? npc;
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;

export type Tone = "seed" | "thought" | "speech" | "world" | "system";
export interface Caption {
  key: number;
  who: string; // npc id or ""
  icon: string;
  text: string;
  sub?: string;
  tone: Tone;
  at: number; // director clock
  /** also shown as a line in the town (the caption bar can skip it while the auto director is on) */
  bubbled?: boolean;
}

/** What the camera should show now; the camera rig glides there and the director keeps each shot a moment. */
export interface Shot {
  kind: "close" | "two" | "medium" | "wide" | "overview";
  a?: string; // resident in shot
  b?: string; // second resident (two-shot)
  at?: { x: number; z: number }; // a place (wide shots, or where someone is heading)
  dist: number;
  prio: number;
  since: number; // director clock
}

/** A line shown in the town over someone's head: what they said, thought, or found. */
export interface Say {
  key: number;
  npc: string;
  kind: "speech" | "phone" | "thought" | "found" | "seed" | "thinking";
  /** wall-clock ms when a "thinking" line started (the honest seconds counter) */
  since?: number;
  text: string;
  /** the version they had heard, for showing how it changed in the retelling */
  heard?: string;
  to?: string;
  understanding?: string;
  /** a thought that ends in deciding to do nothing */
  ignoring?: boolean;
  /** whose head the line is drawn over (defaults to npc): a phone line moves to the listener at the cut */
  anchor?: string;
  belief?: { verdict: string; conf: number };
  /** the speaker's own confidence when they said it (from their stored belief) */
  speakerConf?: number;
  /** what the line is for (inform, warn, ask…), as the model labelled the action */
  intent?: string;
  until: number;
}

export interface StageWorld {
  shops: Record<string, "open" | "closed">;
  stage: "open" | "closed";
  police: { deployed: boolean; place: string | null };
  notices: string[];
  articles: string[];
  gatherings: Record<string, number>;
  festival: "scheduled" | "cancelled" | "postponed";
}

const freshWorld = (): StageWorld => ({ shops: {}, stage: "open", police: { deployed: false, place: null }, notices: [], articles: [], gatherings: {}, festival: "scheduled" });

export const show = {
  status: "idle" as "idle" | "playing" | "paused" | "done",
  run: null as RunResult | null,
  /** true while the simulation is still producing events (streamed playback) */
  growing: false,
  order: [] as SimEvent[],
  i: 0,
  clock: 0,
  speed: 1,
  gameT: 0,
  gapUntil: null as number | null, // compressed idle time before the next event
  stepUntil: 0, // minimum time the current event stays on screen
  waitFor: null as null | (() => boolean),
  stepStarted: 0,
  captions: [] as Caption[],
  world: freshWorld(),
  focus: null as string | null, // npc the camera follows
  infected: new Set<string>(),
  links: [] as { from: string; to: string; at: number; msg?: string; conf?: number }[],
  extras: new Set<Agent>(), // background agents borrowed for crowds
  stalled: false, // waiting for the simulation to produce the next event
  props: [] as { a: Agent; until: number }[], // temporary props (phones) to take away later
  focusLater: null as { npc: string; at: number } | null, // camera cut planned within the current event
  frontier: Infinity, // game time before which the streamed log is final
  thinking: new Set<string>(), // residents whose model call is under way right now
  thinkingShown: "",
  shot: null as Shot | null,
  says: [] as Say[],
  /** where each resident stands on the rumour now (from the engine's belief records, as they play) */
  stance: {} as Record<string, { verdict: string; conf: number }>,
  thinkingSince: {} as Record<string, number>,
  /** streamed first reaction while the decision is still being written (presentation only) */
  early: {} as Record<string, { feeling: string; act: string }>,
  /** long model waits: when the current wait started, and a short "meanwhile" look around town (presentation only) */
  stallSince: 0,
  meanwhile: null as null | { label: string; until: number },
  /** act titles: a short card the first time the story crosses a real threshold (from event types only) */
  title: null as null | { text: string; until: number },
  titlesShown: new Set<string>(),
  lastAct: {} as Record<string, Act>,
  /** counts load() calls, so the camera can tell a new story (or a replay) from a streamed update */
  loads: 0,
  version: 0,
};

// Dev-only handle for inspecting playback from the browser console.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __show: typeof show }).__show = show;

let captionKey = 0;
function caption(c: Omit<Caption, "key" | "at">) {
  show.captions.push({ ...c, key: ++captionKey, at: show.clock });
  if (show.captions.length > 6) show.captions.shift();
  show.version++;
}

const sortEvents = (evs: SimEvent[]) => [...evs].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));

/** Start playing a run. With `growing`, more events will arrive through `update`. */
export function load(run: RunResult, growing = false) {
  reset();
  show.run = run;
  show.growing = growing;
  show.order = sortEvents(run.events);
  show.status = "playing";
  show.loads++;
  // everyone involved goes back to their post first
  for (const id of Object.keys(run.minds)) {
    const a = agentFor(id);
    if (a?.home) scriptGoto(a, a.home.x, a.home.z, a.home.face);
  }
  show.version++;
}

/** Streamed playback: the simulation produced more events. */
export function update(run: RunResult, finished: boolean, frontier = Infinity) {
  show.run = run;
  show.frontier = finished ? Infinity : frontier;
  const seen = new Set(show.order.map((e) => e.id));
  const fresh = run.events.filter((e) => !seen.has(e.id));
  if (fresh.length) {
    // never reorder what has already played; new events append in time order
    const played = show.order.slice(0, show.i);
    const rest = sortEvents([...show.order.slice(show.i), ...fresh]);
    show.order = [...played, ...rest];
  }
  show.growing = !finished;
  show.version++;
}

export function reset() {
  for (const a of crowd.agents) {
    if (a.script) releaseScript(a);
    if (a.prop === "phone") a.prop = null;
  }
  for (const post of ["officer-0", "officer-1"]) {
    const o = agentAt(post);
    if (o) Object.assign(o, { mode: "inside", timer: Infinity, visible: 0, x: o.home!.x, z: o.home!.z, script: null });
  }
  Object.assign(show, {
    status: "idle", run: null, growing: false, order: [], i: 0, clock: 0, gameT: 0, gapUntil: null, stepUntil: 0, waitFor: null, stepStarted: 0,
    captions: [], world: freshWorld(), focus: null, infected: new Set(), links: [], extras: new Set(), stalled: false, frontier: Infinity, props: [], focusLater: null,
    thinking: new Set(), thinkingShown: "", shot: null, says: [], lastAct: {}, stance: {}, thinkingSince: {}, early: {}, stallSince: 0, meanwhile: null, title: null, titlesShown: new Set(),
  });
  show.version++;
}

export function restart() {
  if (!show.run) return;
  const run = show.run;
  const growing = show.growing;
  const frontier = show.frontier;
  load(run, growing);
  show.frontier = frontier;
}


// ---- camera shots and in-town lines --------------------------------------------------------------

const SHOT_DIST: Record<Shot["kind"], number> = { close: 17, two: 20, medium: 24, wide: 34, overview: 60 };
const MIN_HOLD = 1.2; // seconds of playback a shot stays before an equal or lower priority shot may replace it

function setShot(kind: Shot["kind"], opts: Partial<Omit<Shot, "kind" | "since">> = {}) {
  const prio = opts.prio ?? 1;
  const cur = show.shot;
  if (cur && show.clock - cur.since < MIN_HOLD && prio < cur.prio) return;
  show.shot = { kind, dist: opts.dist ?? SHOT_DIST[kind], prio, a: opts.a, b: opts.b, at: opts.at, since: show.clock };
}

let sayKey = 0;
function say(npc: string, kind: Say["kind"], text: string, seconds: number, extra: Partial<Say> = {}) {
  // one line per person at a time; at most three people talking on screen
  show.says = show.says.filter((x) => x.npc !== npc && x.anchor !== npc && x.until > show.clock);
  show.says.push({ key: ++sayKey, npc, kind, text, until: show.clock + seconds, ...extra });
  if (show.says.length > 3) show.says.shift();
}

/** The decision behind an event (walking back through its causes). */
function decisionBehind(e: SimEvent) {
  const run = show.run;
  if (!run) return null;
  const byId = new Map(run.events.map((x) => [x.id, x]));
  let frontier = [e];
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next: SimEvent[] = [];
    for (const x of frontier) {
      if (x.type === "decide") return run.decisions.find((d) => d.id === x.data.decision) ?? null;
      for (const c of x.causes) {
        const y = byId.get(c);
        if (y) next.push(y);
      }
    }
    frontier = next;
  }
  return null;
}

/** What the speaker had heard before deciding to pass it on (the newest message they acted on). */
function heardBefore(e: SimEvent) {
  const dec = decisionBehind(e);
  const run = show.run;
  if (!dec || !run) return undefined;
  const texts = run.events
    .filter((x) => x.type === "deliver" && dec.inbox.includes(String(x.data.message)) && x.data.via !== "inspection" && x.data.via !== "meet" && !(x.data.via === "crowd" && !(x.data.claims as string[] | undefined)?.length))
    .map((x) => String(x.data.text));
  return texts.at(-1);
}

const VERDICT_ZH: Record<string, string> = { believe: "相信", doubt: "半信半疑", disbelieve: "不信" };

/** How sure the speaker was of what THIS line carries — only when they pass it on (inform/warn), not when correcting it. */
function passOnConf(e: SimEvent): number | undefined {
  if (e.data.intent !== "inform" && e.data.intent !== "warn") return undefined;
  let best: SimEvent | undefined;
  for (const c of (e.data.claims as string[] | undefined) ?? []) {
    const b = show.run?.events.filter((x) => x.type === "belief" && x.actor === e.actor && x.data.claim === c && x.t <= e.t).at(-1);
    if (b && (!best || Number(b.data.to) > Number(best.data.to))) best = b;
  }
  return best && best.data.verdict !== "disbelieve" ? Number(best.data.to) : undefined;
}

export const pause = () => {
  if (show.status === "playing") show.status = "paused";
  show.version++;
};
export const resume = () => {
  if (show.status === "paused") show.status = "playing";
  show.version++;
};
export const setSpeed = (s: number) => {
  show.speed = s;
  show.version++;
};
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __setSpeed: typeof setSpeed }).__setSpeed = setSpeed;

function bubble(npc: string | undefined, icon: string, seconds = 2.5) {
  const a = npc ? agentFor(npc) : null;
  if (!a) return;
  a.bubble = icon;
  a.bubbleTimer = seconds;
}

const emoji = (feeling: string) => [...(feeling || "🤔")].find((ch) => /\p{Extended_Pictographic}/u.test(ch)) ?? "🤔";
const INTENT_ICON: Record<string, string> = { warn: "⚠️", ask: "❓", joke: "😂", deny: "✋", complain: "😤", request: "🙏", answer: "💬", inform: "💬" };
const readTime = (text: string, base = 2.2, perChar = 1 / 14, max = 6) => Math.min(max, base + text.length * perChar);

/** Point just in front of someone, on the side the visitor comes from. */
function approach(visitor: Agent, host: Agent) {
  const dx = visitor.x - host.x;
  const dz = visitor.z - host.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: host.x + (dx / d) * 1.3, z: host.z + (dz / d) * 1.3 };
}

/** Somewhere pleasant to glance at while the model thinks: a pet, or a busy corner (never a story resident). */
let meanwhileTurn = 0;
function meanwhileSpot(): { at: { x: number; z: number }; label: string } | null {
  const options: { at: { x: number; z: number }; label: string }[] = [];
  for (const p of pets.list) options.push({ at: { x: p.x, z: p.z }, label: `${p.name}（${p.title}）${p.mode === "sleep" ? "在打盹" : p.mode === "walk" ? "在閒晃" : "在發呆"}` });
  const chatting = crowd.agents.find((a) => a.mode === "chat" && !a.script && a.visible > 0.5);
  if (chatting) options.push({ at: { x: chatting.x, z: chatting.z }, label: "鎮民在閒聊別的事" });
  if (!options.length) return null;
  return options[meanwhileTurn++ % options.length];
}

/**
 * Townsfolk near a real public change stop and look (presentation only: they hold no beliefs and spread nothing).
 */
function crowdLooks(at: { x: number; z: number }, radius: number, icons: string[]) {
  let k = 0;
  for (const o of crowd.agents) {
    if (o.script || o.home || o.job || o.visible < 0.5 || o.mode === "inside" || o.mode === "sit") continue;
    const d = Math.hypot(o.x - at.x, o.z - at.z);
    if (d > radius) continue;
    o.heading = Math.atan2(at.x - o.x, at.z - o.z);
    perform(o, k % 3 === 0 ? "startled" : "nervous", 1.6 + (k % 4) * 0.3);
    if (k % 2 === 0) {
      o.bubble = icons[k % icons.length];
      o.bubbleTimer = 2.2;
    }
    k++;
  }
}

function borrowCrowd(near: { x: number; z: number }, n: number, icon: string) {
  const picks = crowd.agents
    .filter((a) => !a.script && !a.home && !a.job && a.visible > 0.5 && a.mode !== "inside")
    .sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z))
    .slice(0, n);
  picks.forEach((a, k) => {
    const ang = (k / Math.max(1, n)) * Math.PI * 1.4 - 0.7;
    const x = near.x + Math.sin(ang) * (2.2 + (k % 2) * 0.8);
    const z = near.z + Math.cos(ang) * (2.2 + (k % 2) * 0.8);
    scriptGoto(a, x, z, Math.atan2(near.x - x, near.z - z), 2.2);
    a.bubble = icon;
    a.bubbleTimer = 4;
    show.extras.add(a);
  });
}

/** The first time the story reaches a new kind of event, name the act (escalation the viewer can feel). */
function actTitle(e: SimEvent) {
  const d = e.data as Record<string, unknown>;
  const pick =
    (e.type === "talk" || e.type === "phone") && !d.missed && e.actor !== show.run?.config.seedNpc && !show.titlesShown.has("retold")
      ? ["retold", "第一幕 · 傳出去了"]
      : e.type === "phone" && !d.missed && !show.titlesShown.has("phone")
        ? ["phone", "消息上了電話線"]
        : e.type === "inspect" && !show.titlesShown.has("check")
          ? ["check", "有人親自去查了"]
          : (e.type === "notice" || e.type === "article" || e.type === "statement") && !show.titlesShown.has("public")
            ? ["public", "第二幕 · 全鎮都會知道"]
            : (e.type === "state" && ["police", "stage", "festival"].includes(String(d.key)) || e.type === "gather") && !show.titlesShown.has("big")
              ? ["big", "第三幕 · 事情鬧大了"]
              : null;
  if (!pick) return;
  show.titlesShown.add(pick[0]);
  show.title = { text: pick[1], until: show.clock + 2.2 };
}

function apply(e: SimEvent) {
  const actor = e.actor;
  const target = e.target;
  const d = e.data as Record<string, unknown>;
  actTitle(e);
  show.gameT = e.t;
  let hold = 0;
  show.waitFor = null;
  switch (e.type) {
    case "seed": {
      show.infected.add(target!);
      show.focus = target!;
      bubble(target, "💭", 3.5);
      caption({ who: target!, icon: "💭", tone: "seed", text: `一個念頭鑽進了${nameOf(target!)}的腦袋`, sub: `「${String(d.text)}」` });
      say(target!, "seed", String(d.text), 4);
      sting.whisper();
      show.captions[show.captions.length - 1].bubbled = true;
      setShot("close", { a: target, prio: 2 });
      hold = 3.2;
      break;
    }
    case "deliver": {
      const via = String(d.via);
      if (via === "inspection" || via === "seed" || d.repeat) break;
      show.infected.add(target!);
      if (via === "face" || via === "phone") {
        if (d.from && typeof d.from === "string" && agentFor(d.from)) show.links.push({ from: d.from, to: target!, at: show.clock, msg: String(d.message) });
        bubble(target, "❗", 1.6);
        hold = 0.5;
      } else {
        bubble(target, via === "article" ? "📰" : via === "notice" ? "📋" : "👂", 2.5);
        hold = 0.9;
      }
      break;
    }
    case "decide": {
      const dec = show.run?.decisions.find((x) => x.id === d.decision);
      const out = dec?.output;
      if (!out || d.budget) {
        bubble(actor, "😶", 1.5);
        hold = 0.8;
        break;
      }
      show.focus = actor!;
      show.infected.add(actor!);
      const a = agentFor(actor!);
      // think on the spot, unless they are still walking somewhere (then think while walking)
      if (a && !(a.script?.kind === "goto" && !a.script.arrived)) scriptHold(a, a.script?.face ?? a.home?.face ?? null);
      bubble(actor, emoji(out.feeling), 3.5);
      const doing = out.actions.every((x) => x.type === "none") ? "（決定先不理會）" : "";
      caption({ who: actor!, icon: emoji(out.feeling), tone: "thought", text: out.thought, sub: `${out.understanding}${doing}` });
      hold = readTime(out.thought + out.understanding, 2.4, 1 / 20, 5.5);
      // the reaction Gemma chose, acted out; how much they now believe it, from the engine's record
      const act = actFrom(out.act, out.feeling);
      show.lastAct[actor!] = act;
      if (a) perform(a, act, Math.max(2.4, hold));
      const belief = show.run?.events.find((x) => x.type === "belief" && x.causes[0] === e.id);
      if (belief) {
        show.stance[actor!] = { verdict: String(belief.data.verdict), conf: Number(belief.data.to) };
        for (const l of show.links) if (l.to === actor && l.msg && dec!.inbox.includes(l.msg)) l.conf = Number(belief.data.to);
        if (Number(belief.data.to) >= 0.5) sting.believe();
        else sting.doubt();
      }
      delete show.thinkingSince[actor!];
      delete show.early[actor!];
      say(actor!, "thought", out.thought, hold + 1.2, {
        understanding: out.understanding,
        ignoring: !!doing,
        belief: belief ? { verdict: VERDICT_ZH[String(belief.data.verdict)] ?? String(belief.data.verdict), conf: Number(belief.data.to) } : undefined,
      });
      setShot("close", { a: actor, prio: 2 });
      break;
    }
    case "move": {
      const a = agentFor(actor!);
      if (!a) break;
      if (d.home) {
        // walking back to their post plays in the background, at playback speed
        if (a.home) scriptGoto(a, a.home.x, a.home.z, a.home.face);
        break;
      }
      // walking along with the person they were talking to: side by side, at the same pace; the camera stays on the leader
      if (d.follow) {
        const lead = agentFor(String(d.follow));
        const spot = SPOTS[String(d.to)];
        if (lead?.script?.kind === "goto") {
          const g = lead.script;
          scriptGoto(a, g.x + 1.1, g.z + 0.8, null, g.speed ?? 3.2);
        } else scriptGoto(a, spot.x + 1.1, spot.z + 0.8, null, 3.2);
        caption({ who: actor!, icon: "👫", tone: "world", text: `${nameOf(actor!)}跟著${nameOf(String(d.follow))}一起往${placeZh(String(d.to))}走去` });
        hold = 0.4;
        break;
      }
      // where exactly: in front of whoever they are going to talk to, else the place's spot
      const nextTalk = show.order.slice(show.i + 1).find((x) => x.actor === actor && ["talk", "look", "inspect", "notice", "article", "statement", "gather", "state"].includes(x.type));
      const host = nextTalk?.type === "talk" && nextTalk.target ? agentFor(nextTalk.target) : null;
      const spot = SPOTS[String(d.to)];
      const p = host && Math.hypot(host.x - spot.x, host.z - spot.z) < 6 ? approach(a, host) : spot;
      const last = show.lastAct[actor!];
      scriptGoto(a, p.x, p.z, null, last && HURRY.includes(last) ? 4.4 : last && DAWDLE.includes(last) ? 2.6 : 3.2);
      show.focus = actor!;
      setShot("medium", { a: actor, at: { x: p.x, z: p.z }, prio: 1 });
      caption({ who: actor!, icon: "🚶", tone: "world", text: `${nameOf(actor!)}往${placeZh(String(d.to))}走去` });
      show.waitFor = () => !!a.script?.arrived;
      hold = 0.8;
      break;
    }
    case "talk": {
      const a = agentFor(actor!);
      const b = agentFor(target!);
      if (a && b) {
        // both must be standing there before the conversation plays
        const walking = (x: Agent) => x.script?.kind === "goto" && !x.script.arrived;
        if (walking(a) || walking(b)) {
          show.i--;
          show.waitFor = () => !walking(a) && !walking(b);
          show.stepStarted = show.clock;
          show.stepUntil = show.clock + 0.3;
          return;
        }
        scriptHold(a, faceToward(a, b.x, b.z));
        scriptHold(b, faceToward(b, a.x, a.z));
      }
      const talkHold = readTime(String(d.text), 2.6, 1 / 13, 6.5);
      if (a) perform(a, `talk:${String(d.intent)}`, talkHold);
      if (b) perform(b, "listen", talkHold);
      say(actor!, "speech", String(d.text), talkHold + 1, { heard: heardBefore(e), to: target, speakerConf: passOnConf(e), intent: String(d.intent) });
      voice(actor!, String(d.text));
      setShot("two", { a: actor, b: target, prio: 2 });
      bubble(actor, INTENT_ICON[String(d.intent)] ?? "💬", 4);
      bubble(target, "👂", 4);
      // passers-by notice the conversation
      if (a) {
        for (const o of crowd.agents) {
          if (o === a || o === b || o.script || o.home || o.job || o.visible < 0.5) continue;
          if (Math.hypot(o.x - a.x, o.z - a.z) > 5) continue;
          o.bubble = "👀";
          o.bubbleTimer = 2.5;
          if (o.mode === "idle" || o.mode === "chat") o.heading = Math.atan2(a.x - o.x, a.z - o.z);
        }
      }
      show.focus = actor!;
      caption({ who: actor!, icon: INTENT_ICON[String(d.intent)] ?? "💬", tone: "speech", text: `「${String(d.text)}」`, sub: `${nameOf(actor!)} 對 ${nameOf(target!)} 說` });
      hold = readTime(String(d.text), 2.6, 1 / 13, 6.5);
      break;
    }
    case "phone": {
      bubble(actor, "📞", 3.5);
      if (!d.missed) bubble(target, "📞", 3.5);
      show.focus = actor!;
      // both pick up a phone; halfway through, the camera cuts to the listener
      for (const who of d.missed ? [actor] : [actor, target]) {
        const x = who ? agentFor(who) : null;
        if (x && x.prop !== "balloons" && x.prop !== "crate") {
          x.prop = "phone";
          show.props.push({ a: x, until: show.clock + (d.missed ? 1.5 : readTime(String(d.text), 2.4, 1 / 13, 6)) });
        }
      }
      if (!d.missed && target) show.focusLater = { npc: target, at: show.clock + readTime(String(d.text), 2.4, 1 / 13, 6) * 0.55 };
      if (!d.missed) {
        const callHold = readTime(String(d.text), 2.4, 1 / 13, 6);
        const ca = agentFor(actor!);
        const cb = target ? agentFor(target) : null;
        if (ca) perform(ca, `talk:${String(d.intent)}`, callHold);
        if (cb) perform(cb, "listen", callHold);
        say(actor!, "phone", String(d.text), callHold + 1, { heard: heardBefore(e), to: target, speakerConf: passOnConf(e), intent: String(d.intent) });
        sting.ring();
        voice(actor!, String(d.text), true);
      }
      setShot("close", { a: actor, prio: 2 });
      caption({ who: actor!, icon: "📞", tone: d.missed ? "system" : "speech", text: d.missed ? `${nameOf(actor!)}打給${nameOf(target!)}，沒人接` : `「${String(d.text)}」`, sub: d.missed ? undefined : `${nameOf(actor!)} 打電話給 ${nameOf(target!)}` });
      hold = d.missed ? 1.5 : readTime(String(d.text), 2.4, 1 / 13, 6);
      break;
    }
    case "look":
    case "inspect": {
      bubble(actor, "🔍", 3);
      if (d.found) {
        caption({ who: actor!, icon: "🔍", tone: "world", text: String(d.found), sub: `${nameOf(actor!)}${e.type === "inspect" ? "檢查後發現" : "親眼看到"}` });
        hold = readTime(String(d.found), 2.4, 1 / 16, 6);
        say(actor!, "found", String(d.highlight ?? d.found), hold + 1);
        if (String(d.highlight ?? d.found) === String(d.found) && String(d.found).length <= 60) show.captions[show.captions.length - 1].bubbled = true;
        const fa = agentFor(actor!);
        if (fa) perform(fa, e.type === "inspect" ? "ponder" : "nervous", hold);
      } else hold = 1.2;
      setShot("medium", { a: actor, prio: 2 });
      show.focus = actor!;
      break;
    }
    case "state": {
      const key = String(d.key ?? "");
      if (key === "writing") {
        bubble(actor, "✍️", 3);
        hold = 0.8;
        break;
      }

      if (key.startsWith("shops.")) {
        show.world.shops[key.slice(6)] = d.to as "open" | "closed";
        caption({ who: actor ?? "", icon: d.to === "closed" ? "🔒" : "🔓", tone: "world", text: e.zh });
      } else if (key === "stage") {
        show.world.stage = "closed";
        caption({ who: actor ?? "", icon: "🚧", tone: "world", text: e.zh });
      } else if (key === "police") {
        show.world.police = { deployed: true, place: String(d.to) };
        const spot = SPOTS[String(d.to)];
        ["officer-0", "officer-1"].forEach((post, k) => {
          const o = agentAt(post);
          if (!o) return;
          o.visible = 0.2;
          scriptGoto(o, spot.x + (k ? 1.4 : -1.4), spot.z + 1.2, null, 3.6);
        });
        bubble(actor, "🚓", 3);
        caption({ who: actor ?? "", icon: "🚓", tone: "world", text: e.zh, sub: d.reason ? `「${String(d.reason)}」` : undefined });
      } else if (key === "festival") {
        show.world.festival = d.to as StageWorld["festival"];
        caption({ who: actor ?? "", icon: "🏮", tone: "world", text: "燈籠節取消了", sub: d.text ? `「${String(d.text)}」` : undefined });
      } else caption({ who: actor ?? "", icon: "✨", tone: "world", text: e.zh });
      show.focus = actor ?? show.focus;
      setShot("wide", { a: actor, at: e.place ? SPOTS[e.place] : undefined, prio: 3 });
      if (key !== "writing") (key === "festival" || key === "stage" || key === "police" ? sting.big : sting.world)();
      {
        const pa = actor ? agentFor(actor) : null;
        const spotAt = e.place ? SPOTS[e.place] : pa ? { x: pa.x, z: pa.z } : null;
        if (spotAt && key !== "writing") crowdLooks(spotAt, key === "festival" ? 40 : 14, key === "festival" ? ["😱", "❗", "🏮"] : ["😮", "❗", "👀"]);
      }
      hold = 3.2;
      break;
    }
    case "notice":
      show.world.notices.push(String(d.text));
      bubble(actor, "📋", 3);
      caption({ who: actor!, icon: "📋", tone: "world", text: `「${String(d.text)}」`, sub: `${nameOf(actor!)}在廣場布告欄貼了公告` });
      setShot("wide", { a: actor, at: SPOTS.plaza, prio: 3 });
      crowdLooks(SPOTS.plaza, 12, ["👀", "❓", "📋"]);
      hold = readTime(String(d.text), 2.6, 1 / 14, 6);
      break;
    case "article": {
      show.world.articles.push(String(d.headline));
      bubble(actor, "📰", 3);
      // a few passers-by look at their phones
      crowd.agents.filter((a) => !a.script && !a.home && a.visible > 0.5).slice(0, 40).filter((_, k) => k % 6 === 0).forEach((a) => {
        a.bubble = "📱";
        a.bubbleTimer = 3;
      });
      caption({ who: actor!, icon: "📰", tone: "world", text: `〈${String(d.headline)}〉`, sub: `${nameOf(actor!)}在新聞部落格發文` });
      setShot("wide", { a: actor, prio: 3 });
      hold = 3.6;
      break;
    }
    case "statement": {
      bubble(actor, "📣", 4);
      const spot = SPOTS.townhall;
      borrowCrowd(spot, 6, "👀");
      caption({ who: actor!, icon: "📣", tone: "speech", text: `「${String(d.text)}」`, sub: `${nameOf(actor!)}發表公開聲明` });
      say(actor!, "speech", String(d.text), readTime(String(d.text), 3, 1 / 14, 6.5) + 1);
      setShot("wide", { a: actor, at: spot, prio: 3 });
      hold = readTime(String(d.text), 3, 1 / 14, 6.5);
      break;
    }
    case "gather": {
      const place = e.place ?? "townhall";
      const spot = SPOTS[place];
      show.world.gatherings[place] = Number(d.extras ?? 2) + 1;
      ["stall-0", "stall-1", "stall-3", "stall-4"].slice(0, Number(d.extras ?? 2)).forEach((post, k) => {
        const v = agentAt(post);
        if (v) {
          scriptGoto(v, spot.x + (k - 1.5) * 1.2, spot.z + 2, Math.PI, 2.6);
          v.bubble = "✊";
          v.bubbleTimer = 5;
        }
      });
      borrowCrowd(spot, 5, "👀");
      bubble(actor, "✊", 5);
      caption({ who: actor!, icon: "✊", tone: "world", text: `「${String(d.text)}」`, sub: e.zh.split("：")[0] });
      setShot("wide", { at: spot, prio: 3 });
      hold = readTime(String(d.text), 3, 1 / 14, 6.5);
      break;
    }
    case "meet": {
      const a = agentFor(actor!);
      const b = agentFor(target!);
      if (a && b) {
        scriptHold(a, faceToward(a, b.x, b.z));
        scriptHold(b, faceToward(b, a.x, a.z));
      }
      bubble(actor, "👋", 2.5);
      bubble(target, "👋", 2.5);
      show.focus = actor!;
      caption({ who: actor!, icon: "🕔", tone: "world", text: String(d.text), sub: `${clockOf(e.t)} 的例行碰面` });
      setShot("two", { a: actor, b: target, prio: 2 });
      hold = 2.5;
      break;
    }
    case "rejected": {
      // ✋ they wanted to do something big and the rules held them back (a beat); 🤷 an action that just failed
      const icon = d.wanted ? "✋" : "🤷";
      bubble(actor, icon, d.wanted ? 2.6 : 2);
      caption({ who: actor ?? "", icon, tone: "system", text: e.zh });
      hold = d.wanted ? 2.4 : 1.6;
      break;
    }
    case "end": {
      const fest = show.world.festival === "cancelled" ? "燈籠節被取消了。" : "燈籠節照常舉行。";
      const reason = String(d.reason);
      const text = reason === "budget" ? "這個晚上的故事，先看到這裡。" : reason === "time" ? "20:00，燈籠節的時間到了。" : String(e.zh);
      caption({ who: "", icon: "🏁", tone: "system", text, sub: fest });
      setShot("overview", { prio: 4 });
      sting.end();
      hold = 2.5;
      break;
    }
    default:
      break;
  }
  show.stepStarted = show.clock;
  show.stepUntil = show.clock + hold;
  show.version++;
}

/** Advance playback; call every frame with real seconds. */
export function tick(dt: number) {
  if (show.status !== "playing") return;
  show.clock += dt * show.speed;
  // put phones away and make planned camera cuts
  if (show.props.length) {
    show.props = show.props.filter((p) => {
      if (show.clock < p.until) return true;
      if (p.a.prop === "phone") p.a.prop = null;
      return false;
    });
  }
  if (show.focusLater && show.clock >= show.focusLater.at) {
    for (const s of show.says) if (s.kind === "phone" && s.to === show.focusLater.npc) s.anchor = show.focusLater.npc;
    show.focus = show.focusLater.npc;
    setShot("close", { a: show.focusLater.npc, prio: 2 });
    show.focusLater = null;
  }
  if (show.says.length && show.says[0].until < show.clock) show.says = show.says.filter((x) => x.until >= show.clock);
  // the current event's minimum time on screen, and any walk it waits for
  if (show.clock < show.stepUntil) return;
  if (show.waitFor && !show.waitFor() && show.clock - show.stepStarted < 45) return;
  show.waitFor = null;
  if (show.i >= show.order.length || (show.growing && show.order[show.i].t >= show.frontier)) {
    if (show.growing) {
      if (!show.stalled) {
        show.stalled = true;
        show.stallSince = show.clock;
        show.version++;
      }
      // a long wait: glance at the town living its life for a few seconds, then back to the thinker
      const waited = show.clock - show.stallSince;
      if (show.meanwhile && show.clock >= show.meanwhile.until) {
        show.meanwhile = null;
        const back = [...show.thinking][0] ?? show.focus;
        if (back) setShot("close", { a: back, prio: 2 });
        show.stallSince = show.clock;
        show.version++;
      } else if (!show.meanwhile && waited > 9) {
        const spot = meanwhileSpot();
        if (spot) {
          show.meanwhile = { label: spot.label, until: show.clock + 4.5 };
          setShot("medium", { at: spot.at, dist: 22, prio: 2 });
          show.version++;
        }
      }
      // while Gemma works, the residents it is thinking for visibly think (no words until the answer exists)
      for (const npc of show.thinking) {
        const a = agentFor(npc);
        show.thinkingSince[npc] ??= Date.now();
        const early = show.early[npc];
        if (a && !a.act) perform(a, early ? actFrom(early.act, early.feeling) : "ponder", 3);
        const line = show.says.find((x) => x.npc === npc && x.kind === "thinking");
        if (line && early && !line.text) line.text = emoji(early.feeling);
        if (!show.says.some((x) => x.npc === npc && x.kind === "thinking")) say(npc, "thinking", "", 9999, { since: show.thinkingSince[npc] });
      }
      show.says = show.says.filter((x) => x.kind !== "thinking" || show.thinking.has(x.npc));
      const who = [...show.thinking].map(nameOf).join("、");
      if (who && who !== show.thinkingShown) {
        show.thinkingShown = who;
        show.focus = [...show.thinking][0];
        setShot("close", { a: show.focus, prio: 1 });
        caption({ who: [...show.thinking][0], icon: "🤔", tone: "system", text: `${who}正在想……`, sub: `Gemma 正在依照${who}知道的事推理` });
        show.captions[show.captions.length - 1].bubbled = true;
      }
      return;
    }
    if (show.status === "playing") {
      show.status = "done";
      // release everyone a little later so the final scene can be seen
      for (const a of crowd.agents) if (a.script && !a.post?.startsWith("officer")) releaseScript(a);
      for (const a of show.extras) releaseScript(a);
      show.version++;
    }
    return;
  }
  if (show.stalled) {
    show.stalled = false;
    show.meanwhile = null;
    show.thinkingShown = "";
    show.says = show.says.filter((x) => x.kind !== "thinking");
    show.version++;
  }
  const e = show.order[show.i];
  const prevT = show.i > 0 ? show.order[show.i - 1].t : e.t;
  if (show.gapUntil === null) show.gapUntil = show.clock + gapSeconds(e.t - prevT);
  if (show.clock < show.gapUntil) return;
  show.gapUntil = null;
  show.i++;
  apply(e);
}

export const clockText = () => clockOf(show.gameT);
