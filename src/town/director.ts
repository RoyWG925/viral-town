// Playback director: plays a finished (or still-growing) simulation log in the 3D town.
// It never asks the model anything; it only re-enacts recorded, validated events in order.
import type { RunResult } from "../sim/engine.ts";
import { SPOTS } from "../sim/geo.ts";
import { PERSONAS, PLACES } from "../sim/scenario.ts";
import { gapSeconds } from "../sim/timing.ts";
import type { SimEvent } from "../sim/types.ts";
import { clockOf } from "../sim/view.ts";
import { agentAt, crowd, faceToward, releaseScript, scriptGoto, scriptHold, type Agent } from "./crowdSim";

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
  links: [] as { from: string; to: string; at: number }[],
  extras: new Set<Agent>(), // background agents borrowed for crowds
  stalled: false, // waiting for the simulation to produce the next event
  props: [] as { a: Agent; until: number }[], // temporary props (phones) to take away later
  focusLater: null as { npc: string; at: number } | null, // camera cut planned within the current event
  frontier: Infinity, // game time before which the streamed log is final
  thinking: new Set<string>(), // residents whose model call is under way right now
  thinkingShown: "",
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
    thinking: new Set(), thinkingShown: "",
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

function apply(e: SimEvent) {
  const actor = e.actor;
  const target = e.target;
  const d = e.data as Record<string, unknown>;
  show.gameT = e.t;
  let hold = 0;
  show.waitFor = null;
  switch (e.type) {
    case "seed": {
      show.infected.add(target!);
      show.focus = target!;
      bubble(target, "💭", 3.5);
      caption({ who: target!, icon: "💭", tone: "seed", text: `一個念頭鑽進了${nameOf(target!)}的腦袋`, sub: `「${String(d.text)}」` });
      hold = 3.2;
      break;
    }
    case "deliver": {
      const via = String(d.via);
      if (via === "inspection" || via === "seed" || d.repeat) break;
      show.infected.add(target!);
      if (via === "face" || via === "phone") {
        if (d.from && typeof d.from === "string" && agentFor(d.from)) show.links.push({ from: d.from, to: target!, at: show.clock });
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
      // where exactly: in front of whoever they are going to talk to, else the place's spot
      const nextTalk = show.order.slice(show.i + 1).find((x) => x.actor === actor && ["talk", "look", "inspect", "notice", "article", "statement", "gather", "state"].includes(x.type));
      const host = nextTalk?.type === "talk" && nextTalk.target ? agentFor(nextTalk.target) : null;
      const spot = SPOTS[String(d.to)];
      const p = host && Math.hypot(host.x - spot.x, host.z - spot.z) < 6 ? approach(a, host) : spot;
      scriptGoto(a, p.x, p.z, null);
      show.focus = actor!;
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
      } else hold = 1.2;
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
      hold = 3.2;
      break;
    }
    case "notice":
      show.world.notices.push(String(d.text));
      bubble(actor, "📋", 3);
      caption({ who: actor!, icon: "📋", tone: "world", text: `「${String(d.text)}」`, sub: `${nameOf(actor!)}在廣場布告欄貼了公告` });
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
      hold = 3.6;
      break;
    }
    case "statement": {
      bubble(actor, "📣", 4);
      const spot = SPOTS.townhall;
      borrowCrowd(spot, 6, "👀");
      caption({ who: actor!, icon: "📣", tone: "speech", text: `「${String(d.text)}」`, sub: `${nameOf(actor!)}發表公開聲明` });
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
      hold = 2.5;
      break;
    }
    case "rejected":
      bubble(actor, "🤷", 2);
      caption({ who: actor ?? "", icon: "🤷", tone: "system", text: e.zh });
      hold = 1.6;
      break;
    case "end": {
      const fest = show.world.festival === "cancelled" ? "燈籠節被取消了。" : "燈籠節照常舉行。";
      const reason = String(d.reason);
      const text = reason === "budget" ? "這個晚上的故事，先看到這裡。" : reason === "time" ? "20:00，燈籠節的時間到了。" : String(e.zh);
      caption({ who: "", icon: "🏁", tone: "system", text, sub: fest });
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
    show.focus = show.focusLater.npc;
    show.focusLater = null;
  }
  // the current event's minimum time on screen, and any walk it waits for
  if (show.clock < show.stepUntil) return;
  if (show.waitFor && !show.waitFor() && show.clock - show.stepStarted < 45) return;
  show.waitFor = null;
  if (show.i >= show.order.length || (show.growing && show.order[show.i].t >= show.frontier)) {
    if (show.growing) {
      if (!show.stalled) {
        show.stalled = true;
        show.version++;
      }
      // while Gemma works, the residents it is thinking for visibly think
      for (const npc of show.thinking) {
        const a = agentFor(npc);
        if (a && (!a.bubble || a.bubbleTimer < 0.3)) {
          a.bubble = "🤔";
          a.bubbleTimer = 2;
        }
      }
      const who = [...show.thinking].map(nameOf).join("、");
      if (who && who !== show.thinkingShown) {
        show.thinkingShown = who;
        show.focus = [...show.thinking][0];
        caption({ who: [...show.thinking][0], icon: "🤔", tone: "system", text: `${who}正在想……`, sub: "Gemma 正在依照他知道的事推理" });
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
    show.thinkingShown = "";
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
