// 鎮上日常: small authored everyday scenes that make the town worth watching before (and around) a story.
// Display only: no model, no events, no minds. A scene owns its actors through `a.vig` and lets go the moment the
// playback director touches any of them (a script, an act or a bubble it did not set), so a story always wins.
// Core residents are cast only while no story plays; during a story at most one far-away storySafe scene runs,
// with emoji only (the story's lines stay the only words on screen).
import { FACTS } from "../sim/scenario.ts";
import { BENCHES, BUILDINGS, STAGE, STALLS, fromLocal } from "./layout";
import { agentAt, crowd, perform, vigFree, vigGoto, vigHold, type Agent } from "./crowdSim";
import { show } from "./director";
import { flee, nearWalkable, pets, type Pet } from "./petSim";
import { fx, type RunningScene } from "./fx";
import { ui } from "./ui";
import { clock } from "./clock";
import { LITE } from "./quality";
import { cameraLook, devLook, syncLines } from "./ambientLines";
import { NPC_POST, SCENE_TEXT as TXT } from "./cast";
import { rng } from "./textures";

type P = { x: number; z: number };
/** What a scene waits for between beats: seconds, or a condition. */
type Beat = number | (() => boolean);
type Beats = Generator<Beat, void, void>;

interface Scene {
  key: number;
  def: SceneDef;
  at: P;
  cast: Agent[];
  /** the act and bubble this scene last gave each actor, to tell the director's touch from our own */
  mine: Map<Agent, { act: Agent["act"]; bubble: string | null }>;
  beats: Beats;
  wait: Beat;
  t: number;
  entry: RunningScene;
  /** a moving scene (a chase, a patrol): its ticker spot follows this actor */
  follow: Agent | null;
}

interface Setup {
  at: P;
  cast: Agent[];
  label?: string;
  follow?: Agent;
  play: (s: Scene) => Beats;
}

interface SceneDef {
  id: string;
  label: string;
  /** may run while a story plays: background townsfolk only, never a core resident or anyone the story uses */
  storySafe: boolean;
  hours?: [number, number];
  cooldown: [number, number];
  maxDur: number;
  weight: number;
  /** pick a cast and a spot for right now, or null if the scene can't play now */
  setup(): Setup | null;
}

const DEV = process.env.NODE_ENV !== "production";
// ?calm: no everyday scenes at all (automated playthroughs that want a quiet town)
const CALM = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("calm");
const STORY_GAP = 18; // metres a scene keeps from the story's focus and from anyone thinking
const AGENT_REST = 40; // seconds before the same townsperson is cast again
const SPOTLIGHT = -1; // the scene id that holds the resident the player has selected
// the stage-rush wobble only ever plays on a stage the engine says really is loose
const STAGE_LOOSE = FACTS.find((f) => f.id === "stage_uninspected")?.value === true;

// a stream of its own, so the crowd's seeded randomness is untouched by whatever scenes play
const rand = rng(4242);
const between = (a: number, b: number) => a + rand() * (b - a);
const chance = (p: number) => rand() < p;
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const running: Scene[] = [];
const defRest = new Map<string, number>(); // scene id -> scheduler time it may play again
const agentRest = new Map<Agent, number>();
let now = 0; // scheduler seconds (playback-scaled, like the crowd)
let nextStart = 3;
let lastId = "";
// scene ids start somewhere random, so ids left on agents by a hot-reloaded copy of this module never match ours
let sceneKey = Math.floor(Math.random() * 1e6) * 1000;
let nextSweep = 1;
let quarrelTurn = 0;
let held: Agent | null = null;
let devCap: number | null = null; // dev only: lab screenshots in LITE may allow more than one scene at a time
let lastAgents: Agent[] | null = null;
// a hot-reloaded copy of this module would leave its scenes listed in the ticker: start clean
fx.scenes = [];
fx.version++;

export const storyPlaying = () => show.status === "playing" || show.status === "paused";

// ---- geometry -----------------------------------------------------------------------------------

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const toward = (a: P, b: P) => Math.atan2(b.x - a.x, b.z - a.z);
const ahead = (p: P, face: number, d: number) => ({ x: p.x + Math.sin(face) * d, z: p.z + Math.cos(face) * d });
/** A spot `gap` metres from `host`, on the side `visitor` comes from. */
const beside = (host: P, visitor: P, gap: number) => ahead(host, toward(host, visitor), gap);
/** n spots in a shallow arc `r` metres in front of `c` (facing `face`). */
const arc = (c: P, face: number, n: number, r: number) => Array.from({ length: n }, (_, k) => ahead(c, face + (k - (n - 1) / 2) * 0.6, r));

// ---- who can be cast ----------------------------------------------------------------------------

const agentOf = (npc: string) => (NPC_POST[npc] ? agentAt(NPC_POST[npc]) : null);
const isSelected = (a: Agent) => !!ui.selected && agentOf(ui.selected) === a;

/** A background townsperson free to be cast: a walker (no post or job), out and about, not borrowed by anyone. */
function castable(a: Agent) {
  return (
    !a.script && !a.vig && !a.home && !a.job && !a.post && a.visible > 0.9 && (a.mode === "walk" || a.mode === "idle") &&
    !show.extras.has(a) && (agentRest.get(a) ?? 0) <= now && !pets.list.some((p) => p.owner === a.id)
  );
}

/** A core resident standing at their post, free for their own scene (callers make sure no story is playing). */
function coreFree(post: string) {
  const a = agentAt(post);
  if (!a || a.script || a.vig || a.mode !== "work" || a.visible < 0.9 || isSelected(a) || (agentRest.get(a) ?? 0) > now) return null;
  return a;
}

/** The n castable townsfolk nearest to p (within radius); `weigh` > 1 makes someone count as nearer. */
function nearest(p: P, n: number, radius: number, ok: (a: Agent) => boolean = () => true, weigh: (a: Agent) => number = () => 1) {
  return crowd.agents
    .filter((a) => castable(a) && ok(a) && dist(a, p) < radius)
    .sort((a, b) => dist(a, p) / weigh(a) - dist(b, p) / weigh(b))
    .slice(0, n);
}
const grownUp = (a: Agent) => a.look.who !== "kid";
const kid = (a: Agent) => a.look.who === "kid";

/** Onlookers who are not in the scene: they only smile or react, they are never held. */
function bystanders(p: P, r: number, n: number, except: Agent[]) {
  return crowd.agents
    .filter((o) => !except.includes(o) && !o.script && !o.vig && !o.home && !o.job && !o.post && o.visible > 0.9 && o.mode !== "inside" && dist(o, p) < r)
    .slice(0, n);
}
function react(o: Agent, kind: string, icon: string) {
  perform(o, kind, 1.6);
  if (!o.bubble) {
    o.bubble = icon;
    o.bubbleTimer = 2;
  }
}

/** Residents the story uses (anyone in its log, its focus, anyone thinking), as crowd agents. */
function storyAgents() {
  const ids = new Set<string>(show.thinking);
  if (show.focus) ids.add(show.focus);
  for (const e of show.order) {
    if (e.actor) ids.add(e.actor);
    if (e.target) ids.add(e.target);
  }
  return new Set([...ids].map(agentOf).filter((a): a is Agent => !!a));
}

/** Too close to where the story is happening: its focus, anyone thinking, anyone in the current shot. */
function nearStory(p: P) {
  const who = [show.focus, show.shot?.a, show.shot?.b, ...show.thinking];
  return who.some((npc) => {
    const a = npc ? agentOf(npc) : null;
    return !!a && dist(a, p) < STORY_GAP;
  });
}

// ---- what a scene can do with its actors --------------------------------------------------------

function own(s: Scene, a: Agent) {
  if (!s.mine.has(a)) s.mine.set(a, { act: a.act, bubble: a.bubble });
  if (!s.cast.includes(a)) s.cast.push(a);
}
function go(s: Scene, a: Agent, p: P, speed: number, face: number | null = null) {
  const q = nearWalkable(p.x, p.z) ?? p;
  if (vigGoto(a, q.x, q.z, face, speed, s.key)) return;
  // nowhere to walk: the scene fails rather than teleporting anyone
  vigHold(a, face, s.key);
  if (a.vig) a.vig.failed = true;
}
const hold = (s: Scene, a: Agent, face: number | null) => vigHold(a, face, s.key);
function act(s: Scene, a: Agent, kind: string, dur: number) {
  perform(a, kind, dur);
  s.mine.get(a)!.act = a.act;
}
function emote(s: Scene, a: Agent, icon: string, secs = 2.2) {
  a.bubble = icon;
  a.bubbleTimer = secs;
  s.mine.get(a)!.bubble = icon;
}
/**
 * A short everyday line (日常 style), one speaker per scene at a time. Never while a story plays: then the story's
 * lines are the only words on screen.
 */
function speak(s: Scene, a: Agent, text: string, secs = 2.8) {
  if (storyPlaying()) return;
  for (const o of s.cast) if (o !== a) o.line = null;
  a.line = text;
  a.lineTimer = secs;
}
/** An actor's part is over: back to their own business, while the scene carries on. */
function letGo(s: Scene, a: Agent) {
  if (a.vig?.scene === s.key) vigFree(a);
  s.cast = s.cast.filter((x) => x !== a);
  agentRest.set(a, now + AGENT_REST);
}
const arrived = (...as: Agent[]) => () => as.every((a) => !a.vig || a.vig.arrived);
/** Wait for a condition, but never longer than `secs`. */
const upTo = (secs: number, cond: () => boolean): Beat => {
  const t0 = now;
  return () => cond() || now - t0 > secs;
};

// ---- the scenes ---------------------------------------------------------------------------------

/** 志明 hurries two helpers; one leans on the stage's left-rear post and it shudders (mimed, never said). */
function* stageRush(s: Scene, zm: Agent, h1: Agent, h2: Agent): Beats {
  const face = STAGE.rot + Math.PI; // looking at the stage from the plaza
  const d = STAGE.d / 2;
  go(s, h1, fromLocal(STAGE, -1.6, d + 0.8), 1.5, face);
  go(s, h2, fromLocal(STAGE, 1.4, d + 0.8), 1.5, face);
  go(s, zm, fromLocal(STAGE, 0, d + 2.6), 1.6, face);
  yield upTo(12, arrived(h1, h2, zm));
  act(s, h1, "worried", 3);
  act(s, h2, "worried", 3);
  act(s, zm, "talk:complain", 2.6);
  emote(s, zm, "⏰", 2.6);
  speak(s, zm, TXT.stageRush.hurry, 3);
  yield 2.6;
  go(s, zm, fromLocal(STAGE, -1.4, d + 2.6), 1.4, face); // pacing, still barking
  act(s, h2, "shrug", 1.6);
  emote(s, h2, "😓");
  yield upTo(5, arrived(zm));
  act(s, zm, "talk:warn", 1.8);
  // a helper wanders round to the left-rear post and leans on it
  const post = fromLocal(STAGE, -STAGE.w / 2 + 0.3, -d + 0.2);
  go(s, h1, fromLocal(STAGE, -STAGE.w / 2 - 0.5, -d + 0.4), 1.2);
  yield upTo(10, arrived(h1));
  hold(s, h1, toward(h1, post));
  yield 0.5;
  act(s, h1, "whisper", 1.2); // the lean
  yield 0.6;
  fx.stageWobbleUntil = performance.now() + 2500;
  act(s, h1, "startled", 1.4);
  emote(s, h1, "😳", 2);
  yield 0.5;
  go(s, zm, beside(h1, zm, 1.1), 2.8);
  yield upTo(6, arrived(zm));
  hold(s, zm, toward(zm, h1));
  act(s, zm, "nervous", 2.6);
  emote(s, zm, "😅", 2.8);
  speak(s, zm, TXT.stageRush.oops, 3);
  yield 2.2;
  act(s, h1, "shrug", 1.6);
  emote(s, h1, "🤷");
  yield 1.4;
  letGo(s, h1);
  letGo(s, h2);
  hold(s, zm, toward(zm, post)); // one more worried look at it
  act(s, zm, "worried", 1.8);
  yield 2;
}

/** A customer asks 阿珠 for a discount; she blows up about the stall fee and glares at the town hall. */
function* haggle(s: Scene, az: Agent, buyer: Agent, spot: P): Beats {
  const st = STALLS[2];
  go(s, buyer, spot, 1.3, st.rot + Math.PI);
  act(s, az, "talk:joke", 2);
  emote(s, az, "🐙");
  speak(s, az, TXT.haggle.hawk, 2.4);
  yield upTo(12, arrived(buyer));
  yield 0.6;
  act(s, buyer, "talk:ask", 2.2);
  emote(s, buyer, "🥺");
  speak(s, buyer, TXT.haggle.ask, 2.4);
  act(s, az, "listen", 2.2);
  yield 2.4;
  const hall = BUILDINGS.find((b) => b.kind === "townhall")!;
  hold(s, az, toward(az, hall));
  act(s, az, "talk:complain", 3);
  emote(s, az, "💢", 3);
  speak(s, az, TXT.haggle.fee, 3.2);
  // now and then the neighbouring vendors chime in: a glimpse of how fast she could rally them
  if (chance(0.3)) {
    for (const post of ["stall-0", "stall-1"]) {
      const v = agentAt(post);
      if (v && !v.script && !v.vig && v.mode === "work") react(v, "talk:complain", "💸");
    }
  }
  yield 3;
  hold(s, az, toward(az, buyer));
  act(s, az, "talk:joke", 1.6);
  if (chance(0.6)) {
    act(s, buyer, "giggle", 1.6);
    emote(s, buyer, "😋");
  } else {
    act(s, buyer, "shrug", 1.6);
    emote(s, buyer, "😅");
  }
  yield 1.8;
}

/** 阿德 hands out samples, can't stop talking, and at the end glances back at his own door (mimed, never said). */
function* samples(s: Scene, ad: Agent, fans: Agent[], front: P): Beats {
  const out = ad.home!.face;
  go(s, ad, front, 1.2, out);
  yield upTo(6, arrived(ad));
  act(s, ad, "talk:ask", 2.6);
  emote(s, ad, "🥐", 2.6);
  speak(s, ad, TXT.samples.offer, 2.8);
  const ring = arc(front, out, fans.length, 1.4);
  fans.forEach((f, k) => go(s, f, ring[k], kid(f) ? 1.9 : 1.3, toward(ring[k], front)));
  yield upTo(9, arrived(...fans));
  for (const [k, f] of fans.entries()) {
    act(s, f, kid(f) ? "excited" : "giggle", 1.6);
    emote(s, f, k % 2 ? "😋" : "❤️");
    yield 0.35;
  }
  speak(s, ad, TXT.samples.chatter, 3.4);
  for (let k = 0; k < 3; k++) {
    act(s, ad, "talk:joke", 1.3);
    emote(s, ad, k % 2 ? "😄" : "💬", 1.2);
    for (const f of fans) act(s, f, "listen", 1.3);
    yield 1.3;
  }
  // they edge away; he follows a step, still talking
  for (const f of fans) go(s, f, ahead(f, toward(front, f), 2), 0.8, toward(f, front));
  go(s, ad, ahead(front, out, 0.8), 0.9, out);
  emote(s, ad, "😄");
  speak(s, ad, TXT.samples.follow, 2.4);
  yield 1.6;
  for (const f of fans) {
    emote(s, f, "😅");
    letGo(s, f);
  }
  yield 1.2;
  hold(s, ad, out + Math.PI); // the last beat: a silent look back at his own door
  yield 0.5;
  act(s, ad, "nervous", 1.8);
  emote(s, ad, "😬", 2);
  yield 2;
}

/** 老周 walks slow rounds of the plaza; a kid runs, gets told off, and bolts the moment he turns away. */
function* patrol(s: Scene, zh: Agent, route: P[]): Beats {
  for (const [k, p] of route.entries()) {
    go(s, zh, p, 0.95);
    yield upTo(16, arrived(zh));
    hold(s, zh, null);
    act(s, zh, "nervous", 2.2); // a slow look around
    if (chance(0.5)) emote(s, zh, "🧐");
    yield 2.4;
    if (k === 1) yield* kidRuns(s, zh);
  }
}
function* kidRuns(s: Scene, zh: Agent): Beats {
  const [k] = nearest(zh, 1, 18, kid);
  if (!k) return;
  own(s, k);
  go(s, k, ahead(zh, zh.heading, 2.2), 2.3);
  emote(s, k, "😆");
  yield upTo(7, arrived(k));
  hold(s, k, toward(k, zh));
  hold(s, zh, toward(zh, k));
  act(s, zh, "talk:warn", 2.6);
  emote(s, zh, "☝️", 2.6);
  speak(s, zh, TXT.patrol.scold, 2.8);
  yield 0.8;
  act(s, k, "shrug", 1.8);
  emote(s, k, "😇");
  yield 2.2;
  hold(s, zh, toward(k, zh)); // he turns away…
  act(s, zh, "nervous", 1.8);
  yield 0.6;
  act(s, k, "giggle", 1); // …and off they go again
  emote(s, k, "😜", 2.2);
  go(s, k, ahead(k, toward(zh, k), 6), 2.4);
  yield 1.2;
  hold(s, zh, toward(zh, k));
  act(s, zh, "facepalm", 1.8);
  emote(s, zh, "🤦");
  yield 2;
  letGo(s, k);
}

/** A kid spots a loafing cat and gives chase; the cat bolts, three times, and the grown-ups nearby smile. */
function* catChase(s: Scene, k: Agent, cat: Pet): Beats {
  act(s, k, "excited", 1.2);
  emote(s, k, "😆");
  yield 0.8;
  for (let tries = 0; tries < 3; tries++) {
    const t0 = now;
    while (dist(k, cat) > 1.6) {
      if (now - t0 > 7) return; // never caught up
      go(s, k, cat, 1.9);
      yield 0.6;
    }
    flee(cat, k.x, k.z, "🙀");
    emote(s, k, "😆", 1.2);
    yield 1.2;
  }
  hold(s, k, null);
  if (chance(0.5)) {
    act(s, k, "giggle", 1.8);
    emote(s, k, "😂");
  } else {
    act(s, k, "shrug", 1.8);
    emote(s, k, "🥲");
  }
  for (const o of bystanders(k, 6, 2, s.cast)) react(o, "giggle", "😂");
  yield 2;
}

type Quarrel = (typeof TXT.bicker)[keyof typeof TXT.bicker];

/** Two neighbours squabble over something small; a passer-by snickers; it ends in a sigh or a grudging truce. */
function* bicker(s: Scene, a: Agent, b: Agent, at: P, words: Quarrel): Beats {
  quarrelTurn++;
  const pa = { x: at.x - 0.55, z: at.z };
  const pb = { x: at.x + 0.55, z: at.z };
  go(s, a, pa, 1.3, toward(pa, pb));
  go(s, b, pb, 1.3, toward(pb, pa));
  yield upTo(10, arrived(a, b));
  hold(s, a, toward(a, b));
  hold(s, b, toward(b, a));
  act(s, a, "talk:complain", 2.4);
  emote(s, a, "😠");
  speak(s, a, words.a, 2.6);
  act(s, b, "listen", 1.2);
  yield 1.4;
  act(s, b, "talk:deny", 2.2);
  emote(s, b, "🙄");
  speak(s, b, words.b, 2.6);
  yield 2.4;
  act(s, a, "angry", 1.6);
  act(s, b, "angry", 1.6);
  emote(s, a, "💢");
  emote(s, b, "💢");
  for (const o of bystanders(a, 7, 1, s.cast)) react(o, "giggle", "😂");
  yield 1.8;
  if (chance(0.5)) {
    act(s, a, "facepalm", 1.6);
    act(s, b, "facepalm", 1.6);
    yield 1.6;
  } else {
    act(s, a, "shrug", 1.8);
    act(s, b, "shrug", 1.8);
    emote(s, a, "🤝");
    speak(s, a, words.truce, 2.4);
    yield 2;
  }
}

/** 美咲 whispers small talk to two customers; one of them passes it on to the next person they meet. */
function* gossip(s: Scene, mi: Agent, ears: Agent[], front: P): Beats {
  const out = mi.home!.face;
  go(s, mi, front, 1.1, out);
  const ring = arc(front, out, ears.length, 1.2);
  ears.forEach((e, k) => go(s, e, ring[k], 1.3, toward(ring[k], front)));
  yield upTo(9, arrived(mi, ...ears));
  act(s, mi, "whisper", 2.8);
  emote(s, mi, "🤫", 2.8);
  speak(s, mi, pick(TXT.gossip.topics), 3.2);
  for (const e of ears) act(s, e, "listen", 2.8);
  yield 2.8;
  for (const e of ears) {
    act(s, e, "startled", 1);
    emote(s, e, "😲", 1.4);
    yield 0.3;
  }
  yield 0.8;
  for (const e of ears) {
    act(s, e, "giggle", 1.6);
    emote(s, e, "😂", 1.6);
  }
  act(s, mi, "giggle", 1.6);
  yield 1.8;
  // and off it goes: one of them tells the next person they meet (no words after the first line)
  const [carrier, other] = ears;
  letGo(s, mi);
  if (other) letGo(s, other);
  const [next] = nearest(carrier, 1, 12, grownUp);
  if (!next) return;
  own(s, next);
  hold(s, next, toward(next, carrier));
  go(s, carrier, beside(next, carrier, 1.0), 1.4);
  yield upTo(8, arrived(carrier));
  hold(s, carrier, toward(carrier, next));
  act(s, carrier, "whisper", 2);
  emote(s, carrier, "🤫", 2);
  act(s, next, "listen", 2);
  yield 2;
  act(s, next, "startled", 1);
  emote(s, next, "😲", 1.4);
  yield 1.2;
  act(s, next, "giggle", 1.4);
  emote(s, next, "😆");
  yield 1.4;
}

/** 林市長 rehearses a speech on the steps, loses his place, and beams at anyone who walks past. */
function* speech(s: Scene, my: Agent): Beats {
  const out = my.home!.face;
  const waved = new Set<Agent>();
  hold(s, my, out);
  // wait a while, switching the public smile on for every passer-by
  function* rehearse(secs: number): Beats {
    const t0 = now;
    while (now - t0 < secs) {
      const p = crowd.agents.find((o) => o !== my && !waved.has(o) && o.mode === "walk" && o.visible > 0.9 && dist(o, my) < 5);
      if (!p) {
        yield 0.25;
        continue;
      }
      waved.add(p);
      hold(s, my, toward(my, p));
      act(s, my, "determined", 1.2); // a raised hand
      emote(s, my, "😁", 1.6);
      yield 1.4;
      hold(s, my, out);
      act(s, my, "doubt", 1); // and the smile drops
      yield 0.8;
    }
  }
  act(s, my, "talk:inform", 3);
  emote(s, my, "🎤", 3);
  speak(s, my, TXT.speech.open, 3);
  yield* rehearse(3);
  act(s, my, "ponder", 1.8);
  yield* rehearse(1.8);
  act(s, my, "talk:inform", 2.6);
  emote(s, my, "🎤", 2.6);
  speak(s, my, TXT.speech.lost, 2.8);
  yield* rehearse(2.8);
  act(s, my, "facepalm", 1.8);
  emote(s, my, "😓");
  yield* rehearse(4);
}

const building = (id: string) => BUILDINGS.find((b) => b.id === id)!;
/** Where neighbours squabble: the mart's bikes, the flower shop's pots, a bench by the fountain. */
const QUARRELS = (() => {
  const mart = building("mart");
  const flower = building("flower");
  const bench = BENCHES[1];
  return [
    { at: fromLocal(mart, -1.4, mart.d / 2 + 1.9), words: TXT.bicker.bike, elders: false },
    { at: fromLocal(flower, -flower.w / 2 + 1.0, flower.d / 2 + 1.5), words: TXT.bicker.pot, elders: false },
    { at: fromLocal(bench, 0, 1.3), words: TXT.bicker.bench, elders: true },
  ];
})();

const DEFS: SceneDef[] = [
  {
    id: "stage-rush", label: TXT.stageRush.label, storySafe: false, hours: [15, 19.6], cooldown: [90, 150], maxDur: 34, weight: 1.3,
    setup() {
      const zm = STAGE_LOOSE ? coreFree("stage") : null;
      if (!zm) return null;
      const front = fromLocal(STAGE, 0, STAGE.d / 2 + 1.2);
      const helpers = nearest(front, 2, 26, (a) => a.look.who === "adult");
      return helpers.length < 2 ? null : { at: front, cast: [zm, ...helpers], play: (s) => stageRush(s, zm, helpers[0], helpers[1]) };
    },
  },
  {
    id: "haggle", label: TXT.haggle.label, storySafe: false, cooldown: [70, 130], maxDur: 24, weight: 1.2,
    setup() {
      const az = coreFree("stall-2");
      if (!az) return null;
      const spot = fromLocal(STALLS[2], 0, 1.5);
      const [buyer] = nearest(spot, 1, 20, grownUp);
      return buyer ? { at: spot, cast: [az, buyer], play: (s) => haggle(s, az, buyer, spot) } : null;
    },
  },
  {
    id: "samples", label: TXT.samples.label, storySafe: false, hours: [15, 19.5], cooldown: [80, 140], maxDur: 30, weight: 1.2,
    setup() {
      const ad = coreFree("bakery");
      if (!ad?.home) return null;
      const front = ahead(ad.home, ad.home.face, 1.4);
      const fans = nearest(front, 3, 16, () => true, (a) => (kid(a) ? 3 : 1));
      return fans.length < 2 ? null : { at: front, cast: [ad, ...fans], play: (s) => samples(s, ad, fans, front) };
    },
  },
  {
    id: "patrol", label: TXT.patrol.label, storySafe: false, cooldown: [90, 150], maxDur: 50, weight: 1.1,
    setup() {
      const zh = coreFree("police");
      if (!zh) return null;
      const route = [{ x: -9.0, z: -10.4 }, { x: -2.2, z: -8.8 }, { x: 3.4, z: -10.6 }];
      return { at: { x: zh.x, z: zh.z }, cast: [zh], follow: zh, play: (s) => patrol(s, zh, route) };
    },
  },
  {
    id: "gossip", label: TXT.gossip.label, storySafe: false, cooldown: [90, 160], maxDur: 32, weight: 1,
    setup() {
      const mi = coreFree("cafe");
      if (!mi?.home) return null;
      const front = ahead(mi.home, mi.home.face, 1.3);
      const ears = nearest(front, 2, 18, grownUp);
      return ears.length < 2 ? null : { at: front, cast: [mi, ...ears], play: (s) => gossip(s, mi, ears, front) };
    },
  },
  {
    id: "speech", label: TXT.speech.label, storySafe: false, hours: [15, 19.8], cooldown: [80, 140], maxDur: 22, weight: 0.9,
    setup() {
      const my = coreFree("townhall");
      return my?.home ? { at: { x: my.home.x, z: my.home.z }, cast: [my], play: (s) => speech(s, my) } : null;
    },
  },
  {
    id: "cat-chase", label: TXT.catChase.label("a cat"), storySafe: true, cooldown: [60, 110], maxDur: 26, weight: 1,
    setup() {
      const look = cameraLook();
      const cats = pets.list
        .filter((p) => p.species === "cat" && !p.walked && ["loaf", "sit", "groom", "stand"].includes(p.mode))
        .sort((a, b) => dist(a, look) - dist(b, look));
      for (const cat of cats) {
        const [k] = nearest(cat, 1, 12, kid);
        if (k) return { at: { x: cat.x, z: cat.z }, cast: [k], label: TXT.catChase.label(cat.name), follow: k, play: (s) => catChase(s, k, cat) };
      }
      return null;
    },
  },
  {
    id: "bicker", label: TXT.bicker.bike.label, storySafe: true, cooldown: [60, 110], maxDur: 24, weight: 1,
    setup() {
      // take turns among the quarrel spots in view, so the plaza doesn't replay the same squabble
      const look = cameraLook();
      const inView = QUARRELS.filter((x) => dist(x.at, look) < Math.max(20, look.dist * 0.7));
      const q = inView.length ? inView[quarrelTurn % inView.length] : [...QUARRELS].sort((a, b) => dist(a.at, look) - dist(b.at, look))[0];
      const pair = nearest(q.at, 2, 22, grownUp, (a) => (q.elders && a.look.who === "elder" ? 3 : 1));
      return pair.length < 2 ? null : { at: q.at, cast: pair, label: q.words.label, play: (s) => bicker(s, pair[0], pair[1], q.at, q.words) };
    },
  },
];

// ---- the scheduler ------------------------------------------------------------------------------

/** Dev-only record for checking the rules in a real replay (window.__vig). */
const vigLog = {
  started: [] as { id: string; playing: boolean; cast: string[]; storyGap: number }[],
  ended: [] as { id: string; why: string; secs: number }[],
  /** any frame where a story-time scene holds a core resident or story agent, or sits too close to the story */
  violations: [] as string[],
  audits: 0,
};
const keep = <T,>(xs: T[], x: T) => {
  xs.push(x);
  if (xs.length > 200) xs.shift();
};

function storyGapOf(p: P) {
  const who = [show.focus, ...show.thinking].map((n) => (n ? agentOf(n) : null)).filter((a): a is Agent => !!a);
  return who.length ? Math.min(...who.map((a) => dist(a, p))) : Infinity;
}

function whyEnd(s: Scene, playing: boolean, story: Set<Agent>): string | null {
  if (playing && !s.def.storySafe) return "story";
  if (s.t > s.def.maxDur) return "timeout";
  for (const a of s.cast) {
    if (a.script) return "director";
    if (!a.vig || a.vig.scene !== s.key) return "taken";
    if (a.vig.failed) return "stuck";
    const m = s.mine.get(a)!;
    if ((a.act && a.act !== m.act) || (a.bubble && a.bubble !== m.bubble)) return "director";
    if (a.visible < 0.5 || a.mode === "inside") return "gone";
    if (isSelected(a)) return "selected";
    if (playing && (a.post || show.extras.has(a) || story.has(a))) return "story";
  }
  if (playing && nearStory(s.at)) return "story-near";
  return null;
}

function end(s: Scene, why: string) {
  const i = running.indexOf(s);
  if (i < 0) return;
  running.splice(i, 1);
  for (const a of s.cast) {
    if (a.vig?.scene === s.key) vigFree(a);
    agentRest.set(a, now + AGENT_REST);
  }
  defRest.set(s.def.id, now + between(...s.def.cooldown));
  fx.scenes = fx.scenes.filter((x) => x !== s.entry);
  fx.version++;
  if (DEV) keep(vigLog.ended, { id: s.def.id, why, secs: Math.round(s.t * 10) / 10 });
}

function advance(s: Scene, dt: number) {
  s.t += dt;
  if (s.follow) {
    s.at = { x: s.follow.x, z: s.follow.z };
    s.entry.at = s.at;
  }
  if (typeof s.wait === "number") {
    s.wait -= dt;
    if (s.wait > 0) return;
  } else if (!s.wait()) return;
  let r: IteratorResult<Beat, void>;
  try {
    r = s.beats.next();
  } catch (err) {
    if (DEV) console.warn("[vignettes]", s.def.id, err);
    end(s, "error");
    return;
  }
  if (r.done) end(s, "done");
  else s.wait = r.value;
}

function start(def: SceneDef, setup: Setup, playing: boolean) {
  const s: Scene = {
    key: ++sceneKey, def, at: setup.at, cast: [], mine: new Map(), beats: null as unknown as Beats, wait: 0, t: 0, follow: setup.follow ?? null,
    entry: { id: def.id, label: setup.label ?? def.label, at: { ...setup.at }, storySafe: def.storySafe, since: performance.now() },
  };
  // everyone stops what they were doing; the first beat sends them where they need to be
  for (const a of setup.cast) {
    own(s, a);
    hold(s, a, null);
  }
  s.beats = setup.play(s);
  running.push(s);
  fx.scenes = [...fx.scenes, s.entry];
  fx.version++;
  lastId = def.id;
  if (DEV) keep(vigLog.started, { id: def.id, playing, cast: setup.cast.map((a) => a.post ?? a.look.who), storyGap: Math.round(storyGapOf(s.at)) });
  advance(s, 0);
}

/** Start one scene near where the camera looks (weighted by closeness). False if nothing could play. */
function tryStart(playing: boolean, story: Set<Agent>) {
  const look = cameraLook();
  const R = Math.max(16, look.dist * 0.55);
  const options: { def: SceneDef; setup: Setup; w: number }[] = [];
  for (const def of DEFS) {
    if (def.id === lastId || (defRest.get(def.id) ?? 0) > now || running.some((s) => s.def === def)) continue;
    if (playing && !def.storySafe) continue;
    if (def.hours && (clock.hour < def.hours[0] || clock.hour > def.hours[1])) continue;
    const setup = def.setup();
    if (!setup) continue;
    const d = dist(setup.at, look);
    if (d > 1.4 * R || running.some((s) => dist(s.at, setup.at) < 10)) continue;
    if (playing && (nearStory(setup.at) || setup.cast.some((a) => a.post || story.has(a)))) continue;
    options.push({ def, setup, w: def.weight / (1 + (d / R) ** 2) });
  }
  if (!options.length) return false;
  let r = rand() * options.reduce((t, o) => t + o.w, 0);
  const choice = options.find((o) => (r -= o.w) <= 0) ?? options[options.length - 1];
  start(choice.def, choice.setup, playing);
  return true;
}

/** While the player has a resident selected (the whisper moment), they stop what they are doing and face the camera. */
function spotlight(playing: boolean) {
  const a = !playing && ui.selected ? agentOf(ui.selected) : null;
  if (held && held !== a) {
    if (held.vig?.scene === SPOTLIGHT) vigFree(held);
    held = null;
  }
  if (!a || a.script || (a.vig && a.vig.scene !== SPOTLIGHT)) return;
  const cam = cameraLook();
  const face = Math.atan2(cam.cx - a.x, cam.cz - a.z);
  if (a.vig) a.vig.face = face;
  else vigHold(a, face, SPOTLIGHT);
  held = a;
}

/** Anyone still held by a scene that no longer exists (e.g. after a hot reload) goes back to their own business. */
function sweepOrphans() {
  for (const a of crowd.agents) {
    const v = a.vig;
    if (v && (v.scene === SPOTLIGHT ? a !== held : !running.some((s) => s.key === v.scene))) vigFree(a);
  }
}

function audit(playing: boolean, story: Set<Agent>) {
  if (!DEV || !playing) return;
  for (const s of running) {
    vigLog.audits++;
    if (!s.def.storySafe) keep(vigLog.violations, `${s.def.id}: not storySafe`);
    if (nearStory(s.at)) keep(vigLog.violations, `${s.def.id}: within ${STORY_GAP} m of the story`);
    for (const a of s.cast) if (a.post || story.has(a) || show.extras.has(a)) keep(vigLog.violations, `${s.def.id}: cast ${a.post ?? a.id}`);
  }
}

/** Run the everyday scenes for one frame (called at the end of stepCrowd, with the crowd's dt). */
export function stepVignettes(dt: number) {
  // a fresh crowd (hot reload, a new spawn): scenes holding the old agents are meaningless
  if (lastAgents !== crowd.agents) {
    if (lastAgents) endAllScenes();
    lastAgents = crowd.agents;
  }
  now += dt;
  const playing = storyPlaying();
  const story = playing ? storyAgents() : new Set<Agent>();
  if (!CALM) {
    for (const s of [...running]) {
      const why = whyEnd(s, playing, story);
      if (why) end(s, why);
      else advance(s, dt);
    }
    const max = devCap ?? (LITE || playing ? 1 : 3);
    while (running.length > max) end(running[0], "limit");
    if (now >= nextStart && running.length < max) nextStart = now + (tryStart(playing, story) ? (playing ? between(12, 20) : between(6, 10)) : 2);
  }
  spotlight(playing);
  if (now >= nextSweep) {
    nextSweep = now + 1;
    sweepOrphans();
  }
  audit(playing, story);
  syncLines(crowd.agents);
}

/** End every scene and hand its actors back (a new story is loading, or the town resets). */
export function endAllScenes() {
  for (const s of [...running]) end(s, "reset");
}

/**
 * For the director's "meanwhile" cutaway: a storySafe scene playing now, away from the story (label without its
 * emoji). It follows "Meanwhile, ", so a plain subject ("A kid…", "Two neighbors…") starts lowercase; names stay.
 */
export function meanwhileScene(): { at: P; label: string } | null {
  const s = running.find((x) => x.def.storySafe && !nearStory(x.at));
  if (!s) return null;
  const label = s.entry.label.replace(/^\S+\s/, "");
  return { at: { ...s.at }, label: /^(A|An|The|Two|Some|Neighbors)\b/.test(label) ? label[0].toLowerCase() + label.slice(1) : label };
}

/** Ask for a storySafe scene as soon as possible (a long model wait is coming up). */
export function kickScene() {
  if (running.length === 0) nextStart = Math.min(nextStart, now);
}

fx.hooks.endAllScenes = endAllScenes;
fx.hooks.meanwhileScene = meanwhileScene;
fx.hooks.kickScene = kickScene;

if (DEV && typeof window !== "undefined") {
  (window as unknown as { __vig: unknown }).__vig = {
    log: vigLog,
    running: () => running.map((s) => ({ id: s.def.id, label: s.entry.label, secs: Math.round(s.t), cast: s.cast.map((a) => a.post ?? a.id), at: s.at })),
    endAll: endAllScenes,
    fx,
    look: devLook,
    cap: (n: number | null) => (devCap = n),
    /** which scenes could start right now (cooldowns and the camera aside) */
    probe: () => Object.fromEntries(DEFS.map((d) => [d.id, !!d.setup()])),
    /** start one scene now, ignoring cooldowns and the camera (for screenshots) */
    force: (id: string) => {
      const def = DEFS.find((d) => d.id === id);
      const setup = def?.setup();
      if (!def || !setup || (storyPlaying() && !def.storySafe)) return false;
      start(def, setup, storyPlaying());
      return true;
    },
  };
}
