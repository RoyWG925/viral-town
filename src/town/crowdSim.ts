// Background townsfolk: a cheap deterministic crowd simulation (no LLM).
// Social-force steering toward points of interest, plus simple activities.
import { BALLOON_SELLER, BUILDINGS, DOCK_ROUTE, OBSTACLE_CIRCLES, POIS, STAGE, STALLS, doorX, fromLocal, onCrossing, type Poi, type Who } from "./layout";
import { findPath, randomWalkable, walkable } from "./nav";
import { rng } from "./textures";

export type Mode = "walk" | "idle" | "inside" | "sit" | "chat" | "play" | "work";
export type Hat = "none" | "cap" | "sunhat" | "beanie" | "chef";
export type HairStyle = "short" | "bun" | "long" | "bald" | "pony" | "pigtails" | "afro" | "spiky";

export interface Look {
  who: Who;
  headScale: number;
  backpack: string | null;
  glasses: boolean;
  scarf: string | null;
  skirt: boolean;
  apron: string | null;
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  hairStyle: HairStyle;
  hat: Hat;
  hatColor: string;
  scale: number;
  blush: boolean;
}

export interface Agent {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  speed: number;
  path: { x: number; z: number }[];
  mode: Mode;
  timer: number;
  poi: Poi | null;
  partner: number | null;
  bubble: string | null;
  bubbleTimer: number;
  progressTimer: number;
  bestDist: number;
  look: Look;
  phase: number;
  visible: number;
  prop: "balloons" | "crate" | "phone" | null;
  /** Shopkeepers: their post by the door, and whether they are out on an errand (1) or heading back (2). */
  home: { x: number; z: number; face: number } | null;
  errand: 0 | 1 | 2;
  /** Dockworkers shuttle crates between a boat and the warehouse. */
  job: { a: { x: number; z: number }; b: { x: number; z: number }; toB: boolean } | null;
  /** Where this worker belongs (building id, "stall-2", "stage", "officer-1"...), so playback can find them. */
  post: string | null;
  /** While set, the playback director drives this agent instead of the crowd rules. */
  script: Script | null;
}

export interface Script {
  kind: "goto" | "hold";
  x: number;
  z: number;
  face: number | null; // heading to turn to once there (null: keep facing the way they walked)
  speed: number;
  arrived: boolean;
}

const SKIN = ["#f6d1b3", "#e8b48f", "#c98e65", "#9b6644", "#6e4630", "#f2c9a0"];
const SHIRT = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#b983ff", "#ff8fab", "#ff9f43", "#2ec4b6", "#f9f871", "#ffffff", "#3d405b", "#e76f51"];
const PANTS = ["#3d405b", "#22223b", "#6d597a", "#2a9d8f", "#e9c46a", "#264653", "#8d6e63", "#5c6bc0"];
const HAIR = ["#2b1d14", "#4a2c1a", "#7b4b2a", "#d8a35d", "#f1c27d", "#1b1b1b", "#6bcb77", "#ff8fab", "#4d96ff", "#b983ff"];
const HATS: Hat[] = ["none", "none", "none", "none", "cap", "sunhat", "beanie"];
const GREY = ["#d9d9d9", "#bdbdbd", "#f2f2f2", "#9e9e9e"];
const STYLES: HairStyle[] = ["short", "short", "bun", "long", "pony", "pigtails", "afro", "spiky"];
const CHAT = ["💬", "😂", "❗", "🤔", "🎉", "😮", "🏮", "👀"];
const ACTIVITY_BUBBLE: Record<string, string[]> = {
  sit: ["☕", "💬", "😌", "🥐"], browse: ["👀", "🛍️", "🌸", "📰", "🌽", "🍬"], enter: [], play: ["😆", "🎵", "⭐"], picnic: ["🍙", "😌", "🦆"], linger: ["⛵", "🌇", "📸", "🐟"],
  tend: ["💧", "🌱", "🌻"], wait: ["🚌", "⌚"],
};

export const crowd = { agents: [] as Agent[] };
/** Other small things people step around (the town's cats and dogs). */
export const extraObstacles = { list: [] as { x: number; z: number }[] };
// Dev-only handle for inspecting the crowd from the browser console.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __crowd: typeof crowd }).__crowd = crowd;

let rand = rng(2026);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

const occupied = new Set<Poi>();

function choosePoi(a: Agent): Poi {
  const exclusive = (p: Poi) => p.activity === "sit" || p.activity === "picnic";
  const options = POIS.filter((p) => p !== a.poi && !(exclusive(p) && occupied.has(p)));
  const w = (p: Poi) => (p.weight * (p.likes?.[a.look.who] ?? 1)) / (1 + Math.hypot(p.x - a.x, p.z - a.z) / 16);
  const total = options.reduce((s, p) => s + w(p), 0);
  let r = rand() * total;
  for (const p of options) {
    r -= w(p);
    if (r <= 0) return p;
  }
  return options[0];
}

function routeTo(a: Agent, poi: Poi) {
  const path = findPath(a.x, a.z, poi.x + between(-0.2, 0.2), poi.z + between(-0.2, 0.2), 60000);
  a.poi = poi;
  a.bestDist = Infinity;
  a.progressTimer = 0;
  if (!path) {
    a.mode = "idle";
    a.timer = 1;
    return;
  }
  a.path = path;
  a.mode = "walk";
}

function release(a: Agent) {
  if (a.poi) occupied.delete(a.poi);
}

function headTo(a: Agent, x: number, z: number) {
  const path = findPath(a.x, a.z, x, z, 60000);
  a.poi = null;
  a.bestDist = Infinity;
  a.progressTimer = 0;
  a.path = path ?? [];
  a.mode = path ? "walk" : "idle";
  a.timer = 1;
}

function goSomewhere(a: Agent) {
  release(a);
  if (a.job) {
    // carry a crate up from the boat, walk back empty
    a.job.toB = !a.job.toB;
    const t = a.job.toB ? a.job.b : a.job.a;
    a.prop = a.job.toB ? null : "crate";
    headTo(a, t.x + between(-0.4, 0.4), t.z + between(-0.4, 0.4));
    return;
  }
  if (a.home && a.errand) {
    a.errand = 2;
    headTo(a, a.home.x, a.home.z);
    return;
  }
  const poi = choosePoi(a);
  if (poi.activity === "sit" || poi.activity === "picnic") occupied.add(poi);
  routeTo(a, poi);
}

function randomLook(who: Who = rand() < 0.16 ? "kid" : rand() < 0.15 ? "elder" : "adult"): Look {
  const hat = who === "elder" && rand() < 0.4 ? "sunhat" : pick(HATS);
  return {
    who,
    headScale: who === "kid" ? 1.12 : 1,
    backpack: who !== "elder" && rand() < 0.25 ? pick(SHIRT) : null,
    glasses: who === "elder" ? rand() < 0.7 : rand() < 0.15,
    scarf: rand() < 0.18 ? pick(SHIRT) : null,
    skirt: rand() < 0.3,
    apron: null,
    skin: pick(SKIN),
    shirt: pick(SHIRT),
    pants: pick(PANTS),
    hair: who === "elder" ? pick(GREY) : pick(HAIR),
    hairStyle: hat !== "none" ? "short" : who === "elder" ? pick(["short", "bald", "bun"] as HairStyle[]) : pick(STYLES),
    hat,
    hatColor: pick(SHIRT),
    scale: who === "kid" ? between(0.66, 0.76) : who === "elder" ? between(0.88, 0.96) : between(0.92, 1.06),
    blush: who === "kid" || rand() > 0.5,
  };
}

function randomSpot() {
  return randomWalkable(rand);
}

export function spawnCrowd(n: number, seed = 2026) {
  rand = rng(seed);
  occupied.clear();
  crowd.agents = Array.from({ length: n }, (_, id) => {
    const s = randomSpot();
    const look = randomLook();
    const speed = look.who === "kid" ? between(1.3, 1.9) : look.who === "elder" ? between(0.65, 0.95) : between(1.0, 1.6);
    const a: Agent = {
      id, x: s.x, z: s.z, vx: 0, vz: 0, heading: between(-Math.PI, Math.PI), speed,
      path: [], mode: "idle", timer: between(0, 3), poi: null, partner: null, bubble: null, bubbleTimer: 0,
      progressTimer: 0, bestDist: Infinity, look, phase: rand() * 10, visible: 1, prop: null, home: null, errand: 0, job: null, post: null, script: null,
    };
    return a;
  });
  // Stall vendors and the balloon seller stay at work all evening.
  const worker = (x: number, z: number, heading: number, look: Partial<Look>, extra: Partial<Agent> = {}) =>
    crowd.agents.push({
      id: crowd.agents.length, x, z, vx: 0, vz: 0, heading, speed: between(0.9, 1.2), path: [], mode: "work", timer: 0, poi: null,
      partner: null, bubble: null, bubbleTimer: 0, progressTimer: 0, bestDist: Infinity,
      look: { ...randomLook("adult"), hairStyle: "short", backpack: null, skirt: false, ...look }, phase: rand() * 10, visible: 1,
      prop: null, home: null, errand: 0, job: null, post: null, script: null, ...extra,
    });
  STALLS.forEach((st, i) => {
    const p = fromLocal(st, 0, -0.75);
    worker(p.x, p.z, st.rot, { apron: st.roof[0], hat: i === 2 ? "chef" : "cap" }, { post: `stall-${i}`, home: { x: p.x, z: p.z, face: st.rot } });
  });
  worker(BALLOON_SELLER.x, BALLOON_SELLER.z, 0, { hat: "sunhat" }, { prop: "balloons" });
  for (const b of BUILDINGS) {
    if (b.kind === "house" || b.kind === "warehouse" || b.kind === "townhall") continue;
    const side = doorX(b) > 0 ? -1.1 : 1.1;
    let p = fromLocal(b, doorX(b) + side, b.d / 2 + 0.7);
    if (!walkable(p.x, p.z)) p = fromLocal(b, doorX(b), b.d / 2 + 0.9);
    const police = b.kind === "police";
    const home = { x: p.x, z: p.z, face: b.rot };
    worker(
      p.x, p.z, b.rot,
      police
        ? { shirt: "#2f4b8f", pants: "#22223b", hat: "cap", hatColor: "#22305f" }
        : { apron: b.awning?.[0] ?? b.trim, hat: b.kind === "ramen" || b.kind === "bakery" ? "chef" : "none" },
      { home, post: b.id },
    );
  }
  // The mayor works on the town hall steps; the festival organiser fusses around the stage.
  const hall = BUILDINGS.find((b) => b.kind === "townhall")!;
  const steps = fromLocal(hall, 2.2, hall.d / 2 + 2.4);
  worker(steps.x, steps.z, hall.rot, { shirt: "#3d405b", pants: "#22223b", hat: "none", glasses: true, scarf: "#c0392b" }, { home: { x: steps.x, z: steps.z, face: hall.rot }, post: "townhall" });
  const stageFront = fromLocal(STAGE, 1.6, STAGE.d / 2 + 0.9);
  worker(stageFront.x, stageFront.z, STAGE.rot, { shirt: "#e2574c", pants: "#264653", hat: "cap", hatColor: "#ffd93d" }, { home: { x: stageFront.x, z: stageFront.z, face: STAGE.rot }, post: "stage" });
  // Two officers wait inside the police station until someone dispatches them.
  const station = BUILDINGS.find((b) => b.kind === "police")!;
  for (let i = 0; i < 2; i++) {
    const d = fromLocal(station, doorX(station) + (i ? 0.6 : -0.6), station.d / 2 + 0.6);
    worker(d.x, d.z, station.rot, { shirt: "#2f4b8f", pants: "#22223b", hat: "cap", hatColor: "#22305f" }, { post: `officer-${i}`, visible: 0, mode: "inside", timer: Infinity, home: { x: d.x, z: d.z, face: station.rot } });
  }
  for (let i = 0; i < 3; i++) {
    const a = { x: DOCK_ROUTE.from.x + between(-0.8, 0.8), z: DOCK_ROUTE.from.z + between(-1.2, 1.2) };
    const b = { x: DOCK_ROUTE.to.x - i * 1.6, z: DOCK_ROUTE.to.z + between(-0.6, 0.6) };
    worker(a.x + i * 6, a.z + i * 2, 0, { shirt: pick(["#e76f51", "#3d405b", "#2a9d8f"]), hat: pick(["beanie", "cap"] as Hat[]) }, {
      job: { a, b, toB: i % 2 === 1 }, speed: between(1.0, 1.2),
    });
  }
  for (const a of crowd.agents) if (a.job) goSomewhere(a);
  // Start mid-activity so the town already looks busy on the first frame.
  for (const a of crowd.agents) {
    if (a.mode === "work" || a.job) continue;
    const r = rand();
    if (r < 0.2) {
      const seat = POIS.find((p) => p.activity === "sit" && !occupied.has(p));
      if (seat) {
        occupied.add(seat);
        Object.assign(a, { x: seat.x, z: seat.z, heading: seat.face, poi: seat, mode: "sit", timer: between(4, 20) });
        continue;
      }
    }
    if (r < 0.75) goSomewhere(a);
  }
  // A few neighbours are already chatting when the player arrives.
  const idle = crowd.agents.filter((a) => a.mode === "idle" && !a.job);
  for (let i = 0; i + 1 < idle.length && i < 8; i += 2) {
    const [a, b] = [idle[i], idle[i + 1]];
    if (walkable(a.x + 0.9, a.z + 0.3)) {
      b.x = a.x + 0.9;
      b.z = a.z + 0.3;
      startChat(a, b);
    }
  }
}

const TAU = Math.PI * 2;
function turn(from: number, to: number, k: number) {
  let d = ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (d < -Math.PI) d += TAU;
  return from + d * k;
}

function arrive(a: Agent) {
  const p = a.poi;
  a.vx = a.vz = 0;
  if (a.home && a.errand === 2) {
    a.mode = "work";
    a.errand = 0;
    return;
  }
  if (!p) {
    // dockworkers set the crate down or pick one up; anyone else just pauses
    a.mode = "idle";
    a.timer = a.job ? between(1.5, 3.5) : between(1, 3);
    if (a.job) a.prop = a.job.toB ? "crate" : null;
    return;
  }
  if (p.activity === "enter") {
    a.mode = "inside";
    a.timer = between(10, 24);
  } else if (p.activity === "sit" || p.activity === "picnic") {
    a.mode = "sit";
    a.timer = between(20, 45);
    a.x = p.x;
    a.z = p.z;
  } else if (p.activity === "play") {
    a.mode = "play";
    a.timer = between(10, 20);
  } else {
    a.mode = "idle";
    a.timer = p.activity === "browse" ? between(6, 14) : p.activity === "tend" ? between(12, 24) : between(8, 18);
  }
  const options = ACTIVITY_BUBBLE[p.activity];
  if (options?.length && rand() < 0.45) {
    a.bubble = pick(options);
    a.bubbleTimer = between(1.6, 3);
  }
}

function startChat(a: Agent, b: Agent) {
  a.mode = b.mode = "chat";
  a.vx = a.vz = b.vx = b.vz = 0;
  a.partner = b.id;
  b.partner = a.id;
  a.timer = b.timer = between(4, 9);
  a.bubble = pick(CHAT);
  a.bubbleTimer = 1.6;
  b.bubble = null;
}

// ---- playback scripting ------------------------------------------------------------------------

export const agentAt = (post: string) => crowd.agents.find((a) => a.post === post) ?? null;

/** Send an agent somewhere under the director's control. */
export function scriptGoto(a: Agent, x: number, z: number, face: number | null = null, speed = 3.2) {
  release(a);
  a.partner = null;
  a.script = { kind: "goto", x, z, face, speed, arrived: false };
  const path = findPath(a.x, a.z, x, z, 80000);
  a.path = path ?? [{ x, z }];
  a.bestDist = Infinity;
  a.progressTimer = 0;
  a.mode = "walk";
}

/** Keep an agent standing where they are, optionally turning to face something. */
export function scriptHold(a: Agent, face: number | null = null) {
  release(a);
  a.partner = null;
  a.path = [];
  a.vx = a.vz = 0;
  a.script = { kind: "hold", x: a.x, z: a.z, face, speed: 0, arrived: true };
  a.mode = "idle";
}

/** Hand an agent back to the crowd rules: workers return to their post. */
export function releaseScript(a: Agent) {
  if (!a.script) return;
  a.script = null;
  if (a.home) {
    a.errand = 2;
    headTo(a, a.home.x, a.home.z);
  } else goSomewhere(a);
}

export const faceToward = (a: Agent, x: number, z: number) => Math.atan2(x - a.x, z - a.z);

function stepScript(a: Agent, agents: Agent[], dt: number) {
  const s = a.script!;
  a.visible = Math.min(1, a.visible + dt * 3);
  if (s.kind === "goto" && !s.arrived) {
    const keep = a.speed;
    a.speed = s.speed;
    walkStep(a, agents, dt, true);
    a.speed = keep;
    if (!a.path.length || Math.hypot(a.x - s.x, a.z - s.z) < 0.5) {
      s.arrived = true;
      a.path = [];
      a.vx = a.vz = 0;
      a.mode = "idle";
    }
    return;
  }
  if (s.face !== null) a.heading = turn(a.heading, s.face, Math.min(1, dt * 6));
}

export function stepCrowd(dt: number) {
  const agents = crowd.agents;
  for (const a of agents) {
    if (a.bubble) {
      a.bubbleTimer -= dt;
      if (a.bubbleTimer <= 0) a.bubble = null;
    }
    if (a.script) {
      stepScript(a, agents, dt);
      continue;
    }
    switch (a.mode) {
      case "walk":
        walk(a, agents, dt);
        if (!a.job && !a.home && rand() < dt * 0.08 && !onCrossing(a.x, a.z)) {
          const b = agents.find((o) => o !== a && o.mode === "walk" && !o.job && !o.home && !o.script && (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < 2.5 && !onCrossing(o.x, o.z));
          if (b) {
            release(a);
            release(b);
            a.poi = b.poi = null;
            startChat(a, b);
          }
        }
        break;
      case "inside":
        a.visible = Math.max(0, a.visible - dt * 3);
        a.timer -= dt;
        if (a.timer <= 0) goSomewhere(a);
        break;
      case "play":
        a.phase += dt * 9;
        a.timer -= dt;
        if (a.timer <= 0) goSomewhere(a);
        break;
      case "work":
        a.visible = Math.min(1, a.visible + dt * 3);
        if (a.home) {
          a.heading = turn(a.heading, a.home.face, 0.1);
          // now and then a shopkeeper pops out: to the plaza, a neighbour's door, the bench outside
          if (rand() < dt * 0.006 && !a.post?.startsWith("stall-")) {
            const near = POIS.filter((p) => p.activity !== "sit" && p.activity !== "picnic" && p.activity !== "play" && Math.hypot(p.x - a.x, p.z - a.z) < 22 && Math.hypot(p.x - a.x, p.z - a.z) > 3);
            if (near.length) {
              a.errand = 1;
              routeTo(a, pick(near));
              break;
            }
          }
          if (!a.bubble && rand() < dt * 0.05) {
            a.bubble = pick(["👋", "😊", "📣", "✨"]);
            a.bubbleTimer = 1.8;
          }
          break;
        }
        if (!a.bubble && rand() < dt * 0.12) {
          a.bubble = a.prop === "balloons" ? "🎈" : pick(["📣", "😊", "🌽", "🍬", "🐙"]);
          a.bubbleTimer = 2;
        }
        break;
      case "sit":
        if (a.poi) a.heading = turn(a.heading, a.poi.face, 0.2);
        a.timer -= dt;
        if (a.timer <= 0) goSomewhere(a);
        break;
      case "chat": {
        const b = a.partner !== null ? agents[a.partner] : null;
        if (!b || b.mode !== "chat") {
          a.mode = "idle";
          a.partner = null;
          a.timer = 1;
          break;
        }
        a.heading = turn(a.heading, Math.atan2(b.x - a.x, b.z - a.z), 0.15);
        if (!a.bubble && !b.bubble && rand() < dt * 1.2) {
          a.bubble = pick(CHAT);
          a.bubbleTimer = 1.5;
        }
        a.timer -= dt;
        if (a.timer <= 0) {
          a.partner = b.partner = null;
          goSomewhere(a);
          goSomewhere(b);
        }
        break;
      }
      case "idle": {
        a.visible = Math.min(1, a.visible + dt * 3);
        if (a.poi && a.poi.activity !== "linger") a.heading = turn(a.heading, a.poi.face, 0.15);
        if (a.job && a.timer > 0) {
          a.timer -= dt;
          if (a.timer <= 0) goSomewhere(a);
          break;
        }
        a.timer -= dt;
        if (rand() < dt * 1.2) {
          const b = agents.find((o) => o !== a && o.mode === "idle" && !o.script && (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < 10);
          if (b) {
            startChat(a, b);
            break;
          }
        }
        if (a.timer <= 0) goSomewhere(a);
        break;
      }
    }
  }
}

function walk(a: Agent, agents: Agent[], dt: number) {
  walkStep(a, agents, dt, false);
}

function walkStep(a: Agent, agents: Agent[], dt: number, scripted: boolean) {
  a.visible = Math.min(1, a.visible + dt * 3);
  const target = a.path[0];
  if (!target) {
    if (!scripted) arrive(a);
    return;
  }
  const dx = target.x - a.x;
  const dz = target.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < (a.path.length > 1 ? 0.6 : 0.35)) {
    a.path.shift();
    a.bestDist = Infinity;
    a.progressTimer = 0;
    if (!a.path.length && !scripted) arrive(a);
    return;
  }
  // Give up on targets we cannot reach (blocked by a crowd or an obstacle).
  if (dist < a.bestDist - 0.3) {
    a.bestDist = dist;
    a.progressTimer = 0;
  } else if ((a.progressTimer += dt) > 6) {
    if (scripted) {
      // a scripted walk must get there: hop past whatever is in the way
      a.x = target.x;
      a.z = target.z;
      a.progressTimer = 0;
      return;
    }
    goSomewhere(a);
    return;
  }
  const slow = Math.min(1, dist / 0.8);
  const dvx = (dx / dist) * a.speed * slow;
  const dvz = (dz / dist) * a.speed * slow;
  let fx = (dvx - a.vx) * 3;
  let fz = (dvz - a.vz) * 3;

  for (const o of agents) {
    if (o === a || o.mode === "inside") continue;
    const ox = a.x - o.x;
    const oz = a.z - o.z;
    const d2 = ox * ox + oz * oz;
    if (d2 > 0.0001 && d2 < 0.8) {
      const d = Math.sqrt(d2);
      const k = (0.9 - d) * 7;
      fx += (ox / d) * k;
      fz += (oz / d) * k;
    }
  }
  for (const o of extraObstacles.list) {
    const ox = a.x - o.x;
    const oz = a.z - o.z;
    const d2 = ox * ox + oz * oz;
    if (d2 > 0.0001 && d2 < 0.36) {
      const d = Math.sqrt(d2);
      const k = (0.6 - d) * 6;
      fx += (ox / d) * k;
      fz += (oz / d) * k;
    }
  }
  const avoid = (nx: number, nz: number, gap: number) => {
    if (gap > 0.7) return;
    const k = (0.7 - gap) * 12;
    fx += nx * k;
    fz += nz * k;
    // Slide around the obstacle on the side facing the goal.
    const side = Math.sign(nx * dvz - nz * dvx) || 1;
    fx += -nz * side * k * 0.6;
    fz += nx * side * k * 0.6;
  };
  for (const c of OBSTACLE_CIRCLES) {
    const ox = a.x - c.x;
    const oz = a.z - c.z;
    const d = Math.hypot(ox, oz);
    if (d < c.r + 0.7 && d > 0.001) avoid(ox / d, oz / d, d - c.r);
  }

  a.vx += fx * dt;
  a.vz += fz * dt;
  const sp = Math.hypot(a.vx, a.vz);
  const max = a.speed * 1.25;
  if (sp > max) {
    a.vx = (a.vx / sp) * max;
    a.vz = (a.vz / sp) * max;
  }
  let nx = a.x + a.vx * dt;
  let nz = a.z + a.vz * dt;
  // Slide along walls instead of walking through them (unless already standing in one, e.g. up from a bench).
  if (!walkable(nx, nz) && walkable(a.x, a.z)) {
    if (walkable(nx, a.z)) nz = a.z;
    else if (walkable(a.x, nz)) nx = a.x;
    else {
      nx = a.x;
      nz = a.z;
    }
  }
  a.x = nx;
  a.z = nz;
  if (sp > 0.15) a.heading = turn(a.heading, Math.atan2(a.vx, a.vz), Math.min(1, dt * 8));
  a.phase += dt * sp * 6.5;
}
