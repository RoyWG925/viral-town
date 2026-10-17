// Town pets: a few cats and dogs with small, deterministic habits (no LLM; they never touch the story).
// Cats keep to their own street and spend most of the evening loafing; dogs roam a little further,
// one shiba is out on a walk with its owner, and any cat that finds a dog too close makes a run for it.
import { agentAt, crowd, type Agent } from "./crowdSim";
import { BUILDINGS, fromLocal, onMainCarriageway, type Rect } from "./layout";
import { findPath, walkable } from "./nav";
import { rng } from "./textures";

export type Species = "cat" | "dog";
export type Breed = "calico" | "tabby" | "black" | "tuxedo" | "shiba" | "corgi" | "golden" | "formosan";
/** loaf: a cat tucked up like a loaf of bread, or a dog lying down. */
export type PetMode = "walk" | "stand" | "sit" | "loaf" | "sleep" | "groom" | "sniff" | "zoom";

export interface Pet {
  id: number;
  name: string;
  title: string; // breed in Chinese, for the name tag
  species: Species;
  breed: Breed;
  size: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  walkSpeed: number;
  runSpeed: number;
  speed: number;
  path: { x: number; z: number }[];
  mode: PetMode;
  /** what to do on arriving at the end of the path */
  then: PetMode;
  /** who to face (and greet) on arrival */
  greet: Agent | null;
  timer: number;
  phase: number; // gait
  range: Rect;
  spots: { x: number; z: number; rest: PetMode }[];
  friends: string[]; // crowd posts this pet likes to visit (shopkeepers)
  bubbles: string[];
  bubble: string | null;
  bubbleTimer: number;
  /** seconds of visible happiness (tail going, a hop) after a pat or a greeting */
  happy: number;
  /** seconds the name tag stays up */
  tag: number;
  hover: boolean;
  cooldown: number; // a cat that just fled will not flee again straight away
  best: number;
  stuck: number;
  repath: number;
  /** dogs out on a walk: the townsperson holding the lead, and where they were last seen */
  walked: boolean;
  owner: number | null;
  lastSeen: { x: number; z: number } | null;
  zoom: { cx: number; cz: number; r: number; ang: number; dir: number } | null;
}

export const pets = { list: [] as Pet[] };
// Dev-only handle for inspecting the pets from the browser console.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __pets: typeof pets }).__pets = pets;

let rand = rng(77);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

interface Def {
  name: string;
  title: string;
  species: Species;
  breed: Breed;
  size: number;
  walk: number;
  run: number;
  range: Rect;
  spots: [number, number, PetMode][];
  friends: string[];
  bubbles: string[];
  walked?: boolean;
}

/** A spot out in the open in front of a shop (lx along the frontage, `out` metres from the wall). */
function front(id: string, lx: number, out: number, rest: PetMode): [number, number, PetMode] {
  const b = BUILDINGS.find((x) => x.id === id)!;
  const p = fromLocal(b, lx, b.d / 2 + out);
  return [p.x, p.z, rest];
}

// Each pet has a home turf next to the shops it hangs around (coordinates from the town plan).
const DEFS: Def[] = [
  {
    name: "麻糬", title: "三花短腿貓", species: "cat", breed: "calico", size: 0.95, walk: 0.7, run: 2.3,
    range: { x0: -25, x1: -9, z0: -7, z1: 11 },
    spots: [front("flower", -1.0, 1.7, "loaf"), front("flower", 1.4, 1.5, "groom"), front("bakery", 1.2, 1.9, "sleep"), front("bakery", -1.6, 1.8, "sit"), [-12.4, -4.4, "loaf"]],
    friends: ["flower", "bakery"], bubbles: ["🌸", "😺", "喵~", "🥐"],
  },
  {
    name: "胖橘", title: "橘貓", species: "cat", breed: "tabby", size: 1.12, walk: 0.55, run: 2.0,
    range: { x0: 11, x1: 28, z0: 0, z1: 12 },
    spots: [[15.0, 9.9, "sleep"], [17.4, 10.3, "sleep"], [21.2, 9.4, "loaf"], [24.4, 3.4, "loaf"]],
    friends: ["cafe", "mart"], bubbles: ["☕", "😪", "喵~", "🐟"],
  },
  {
    name: "煤球", title: "黑貓", species: "cat", breed: "black", size: 0.95, walk: 0.85, run: 2.6,
    range: { x0: 9, x1: 25, z0: -21, z1: -2 },
    spots: [[12.8, -3.4, "loaf"], [11.0, -8.8, "sit"], [19.2, -16.0, "loaf"], [22.8, -16.2, "groom"]],
    friends: ["books", "news"], bubbles: ["📚", "😼", "喵~", "✨"],
  },
  {
    name: "海苔", title: "賓士貓", species: "cat", breed: "tuxedo", size: 1, walk: 0.8, run: 2.5,
    range: { x0: 31, x1: 46, z0: -17, z1: 2 },
    spots: [[33.8, -6.2, "sit"], [34.2, -11.8, "loaf"], [44.6, -8.0, "loaf"], [44.8, -2.6, "sleep"]],
    friends: ["seafood"], bubbles: ["🐟", "😋", "喵~", "⛵"],
  },
  {
    name: "阿柴", title: "柴犬", species: "dog", breed: "shiba", size: 1, walk: 1.2, run: 2.8, walked: true,
    range: { x0: -62, x1: 58, z0: -38, z1: 32 }, spots: [], friends: [], bubbles: ["🐾", "😊", "汪!"],
  },
  {
    name: "奶油", title: "柯基", species: "dog", breed: "corgi", size: 1, walk: 1.0, run: 3.0,
    range: { x0: -63, x1: -41, z0: -20, z1: 10 },
    spots: [[-53.4, 6.2, "sit"], [-47.4, 6.8, "sniff"], [-50.0, 1.8, "loaf"], [-44.4, -4.0, "sit"], [-56.0, -8.0, "sniff"]],
    friends: [], bubbles: ["🐾", "😆", "汪!", "🎾"],
  },
  {
    name: "布丁", title: "黃金獵犬", species: "dog", breed: "golden", size: 1.08, walk: 1.0, run: 3.2,
    range: { x0: -12, x1: 11, z0: -4, z1: 10 },
    spots: [[-1.6, 7.4, "sit"], [6.0, 1.4, "sniff"], [-4.6, 2.6, "sleep"], [3.4, 8.2, "sit"], [-8.6, 4.8, "loaf"]],
    friends: [], bubbles: ["❤️", "🎾", "汪!", "😊"],
  },
  {
    name: "小黑", title: "台灣土狗", species: "dog", breed: "formosan", size: 1.05, walk: 1.1, run: 3.3,
    range: { x0: 31, x1: 46, z0: -38, z1: -14 },
    spots: [[34.8, -21.6, "sleep"], [44.8, -30.0, "sit"], [44.8, -18.6, "sit"], [41.8, -27.8, "sniff"]],
    friends: [], bubbles: ["🐾", "⚓", "汪!", "🦴"],
  },
];

/** The nearest walkable point within ~2 m, or null. */
export function nearWalkable(x: number, z: number) {
  if (walkable(x, z)) return { x, z };
  for (let r = 0.25; r <= 2; r += 0.25)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (walkable(px, pz)) return { x: px, z: pz };
    }
  return null;
}
const inRange = (p: Pet, x: number, z: number) => x >= p.range.x0 && x <= p.range.x1 && z >= p.range.z0 && z <= p.range.z1;
const visibleAgent = (a: Agent) => a.visible > 0.5 && a.mode !== "inside";

export function spawnPets(seed = 77) {
  rand = rng(seed);
  pets.list = DEFS.map((d, id) => {
    const spots = d.spots.map(([x, z, rest]) => ({ ...(nearWalkable(x, z) ?? { x, z }), rest })).filter((s) => walkable(s.x, s.z) && !onMainCarriageway(s.x, s.z));
    const start = spots.length ? pick(spots) : { x: 0, z: 2, rest: "sit" as PetMode };
    const p: Pet = {
      id, name: d.name, title: d.title, species: d.species, breed: d.breed, size: d.size,
      x: start.x, z: start.z, vx: 0, vz: 0, heading: between(-Math.PI, Math.PI),
      walkSpeed: d.walk, runSpeed: d.run, speed: d.walk, path: [], mode: start.rest, then: "stand", greet: null,
      timer: between(2, 12), phase: rand() * 10, range: d.range, spots, friends: d.friends, bubbles: d.bubbles,
      bubble: null, bubbleTimer: 0, happy: 0, tag: 0, hover: false, cooldown: 0, best: Infinity, stuck: 0, repath: 0,
      walked: !!d.walked, owner: null, lastSeen: null, zoom: null,
    };
    return p;
  });
  return pets.list;
}

function say(p: Pet, text: string, seconds = 2.2) {
  p.bubble = text;
  p.bubbleTimer = seconds;
}

function routeTo(p: Pet, x: number, z: number, then: PetMode, speed = p.walkSpeed) {
  const path = findPath(p.x, p.z, x, z, 30000);
  if (!path) return false;
  p.path = path;
  p.mode = "walk";
  p.then = then;
  p.speed = speed;
  p.best = Infinity;
  p.stuck = 0;
  return true;
}

function rest(p: Pet, mode: PetMode) {
  p.path = [];
  p.vx = p.vz = 0;
  p.mode = mode;
  const cat = p.species === "cat";
  p.timer =
    mode === "sleep" ? between(25, 55) : mode === "loaf" ? (cat ? between(12, 26) : between(8, 16)) : mode === "groom" ? between(5, 9) : mode === "sniff" ? between(2, 4) : mode === "zoom" ? between(4, 6) : between(5, 11);
  if (mode === "sleep") say(p, "💤", 2.5);
  else if (rand() < 0.3) say(p, pick(p.bubbles));
}

function wander(p: Pet, reach: number, then: PetMode) {
  for (let n = 0; n < 12; n++) {
    const x = p.x + between(-reach, reach);
    const z = p.z + between(-reach, reach);
    if (!inRange(p, x, z) || !walkable(x, z) || onMainCarriageway(x, z)) continue;
    if (routeTo(p, x, z, then)) return true;
  }
  return false;
}

/** Walk up to a townsperson (a favourite shopkeeper first) and sit by them for a fuss. */
function goGreet(p: Pet) {
  const friends = p.friends.map((f) => agentAt(f)).filter((a): a is Agent => !!a && visibleAgent(a) && !a.script && !a.vig && a.mode === "work" && !a.errand && inRange(p, a.x, a.z));
  const near = crowd.agents.filter(
    (a) => visibleAgent(a) && !a.script && !a.vig && !a.job && ["idle", "sit", "chat", "work"].includes(a.mode) && inRange(p, a.x, a.z) && Math.hypot(a.x - p.x, a.z - p.z) < 8,
  );
  const who = friends.length && rand() < 0.6 ? pick(friends) : near.length ? pick(near) : null;
  if (!who) return false;
  const dx = p.x - who.x;
  const dz = p.z - who.z;
  const d = Math.hypot(dx, dz) || 1;
  const spot = nearWalkable(who.x + (dx / d) * 0.8, who.z + (dz / d) * 0.8);
  if (!spot || !routeTo(p, spot.x, spot.z, "sit")) return false;
  p.greet = who;
  return true;
}

/** A dog's zoomies: tight laps in an open patch of ground. */
function goZoom(p: Pet) {
  const r = between(1.2, 1.8);
  const ang = rand() * Math.PI * 2;
  const cx = p.x - Math.cos(ang) * r;
  const cz = p.z - Math.sin(ang) * r;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    if (!walkable(cx + Math.cos(a) * r, cz + Math.sin(a) * r)) return false;
  }
  p.zoom = { cx, cz, r, ang, dir: rand() < 0.5 ? -1 : 1 };
  rest(p, "zoom");
  say(p, pick(["😆", "汪!", "💨"]), 1.8);
  return true;
}

function nextThing(p: Pet) {
  p.greet = null;
  p.zoom = null;
  const r = rand();
  const spot = p.spots.length ? pick(p.spots) : null;
  if (p.species === "cat") {
    if (r < 0.4 && spot && routeTo(p, spot.x, spot.z, spot.rest)) return;
    if (r < 0.6 && wander(p, 6, pick(["loaf", "sit", "groom"] as PetMode[]))) return;
    if (r < 0.75 && goGreet(p)) return;
    rest(p, pick(["loaf", "groom", "sit"] as PetMode[]));
    return;
  }
  if (r < 0.32 && wander(p, 9, pick(["sniff", "stand", "sit"] as PetMode[]))) return;
  if (r < 0.5 && spot && routeTo(p, spot.x, spot.z, spot.rest)) return;
  if (r < 0.64 && goGreet(p)) return;
  if (r < 0.78 && goZoom(p)) return;
  rest(p, pick(["sniff", "sit", "loaf"] as PetMode[]));
}

function arrive(p: Pet) {
  p.path = [];
  p.vx = p.vz = 0;
  const who = p.greet;
  rest(p, p.then);
  if (who) {
    p.heading = Math.atan2(who.x - p.x, who.z - p.z);
    p.happy = 3.5;
    say(p, p.species === "cat" ? pick(["❤️", "喵~", "😺"]) : pick(["❤️", "汪!", "🐾"]));
    // the person is pleased to see them (only background townsfolk; residents in a story or a scene are left alone)
    if (!who.script && !who.vig && !who.bubble) {
      who.bubble = pick(["😍", "😊", "🥰"]);
      who.bubbleTimer = 2.2;
    }
    p.greet = null;
  }
}

const TAU = Math.PI * 2;
function turn(from: number, to: number, k: number) {
  let d = ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (d < -Math.PI) d += TAU;
  return from + d * k;
}

/** Follow the path: "arrived" at its end, "stuck" if it gave up, null while still on the way. */
function move(p: Pet, dt: number, ignore: Agent | null = null): "arrived" | "stuck" | null {
  const t = p.path[0];
  if (!t) return "arrived";
  const dx = t.x - p.x;
  const dz = t.z - p.z;
  const dist = Math.hypot(dx, dz);
  if (dist < (p.path.length > 1 ? 0.45 : 0.25)) {
    p.path.shift();
    p.best = Infinity;
    p.stuck = 0;
    return p.path.length === 0 ? "arrived" : null;
  }
  if (dist < p.best - 0.2) {
    p.best = dist;
    p.stuck = 0;
  } else if ((p.stuck += dt) > 4) {
    p.path = [];
    return "stuck";
  }
  const slow = Math.min(1, dist / 0.5);
  const dvx = (dx / dist) * p.speed * slow;
  const dvz = (dz / dist) * p.speed * slow;
  let fx = (dvx - p.vx) * 4;
  let fz = (dvz - p.vz) * 4;
  // keep a little space from people and from each other
  const push = (ox: number, oz: number, r: number) => {
    const ex = p.x - ox;
    const ez = p.z - oz;
    const d2 = ex * ex + ez * ez;
    if (d2 < 0.0001 || d2 > r * r) return;
    const d = Math.sqrt(d2);
    const k = (r - d) * 8;
    fx += (ex / d) * k;
    fz += (ez / d) * k;
  };
  for (const a of crowd.agents) if (a !== ignore && visibleAgent(a)) push(a.x, a.z, 0.55);
  for (const o of pets.list) if (o !== p) push(o.x, o.z, 0.5);
  p.vx += fx * dt;
  p.vz += fz * dt;
  const sp = Math.hypot(p.vx, p.vz);
  const max = p.speed * 1.2;
  if (sp > max) {
    p.vx = (p.vx / sp) * max;
    p.vz = (p.vz / sp) * max;
  }
  let nx = p.x + p.vx * dt;
  let nz = p.z + p.vz * dt;
  // slide along walls rather than walking into them
  if (!walkable(nx, nz) && walkable(p.x, p.z)) {
    if (walkable(nx, p.z)) nz = p.z;
    else if (walkable(p.x, nz)) nx = p.x;
    else {
      nx = p.x;
      nz = p.z;
    }
  }
  p.x = nx;
  p.z = nz;
  if (sp > 0.1) p.heading = turn(p.heading, Math.atan2(p.vx, p.vz), Math.min(1, dt * 9));
  p.phase += dt * sp * (p.species === "cat" ? 11 : 9);
  return null;
}

/** Someone out for a walk: an adult passer-by, the nearest one to the dog. */
function chooseOwner(p: Pet): Agent | null {
  const options = crowd.agents.filter((a) => !a.home && !a.job && !a.post && !a.script && !a.vig && a.look.who === "adult" && visibleAgent(a));
  if (!options.length) return null;
  const best = options.reduce((b, a) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
  p.owner = best.id;
  return best;
}

function stepWalked(p: Pet, dt: number) {
  let o = p.owner !== null ? crowd.agents[p.owner] : null;
  if (!o || o.id !== p.owner || o.home || o.job || o.post) {
    o = chooseOwner(p);
    // first walk of the evening: start right at their heels
    if (o && p.lastSeen === null) {
      const s = nearWalkable(o.x - Math.sin(o.heading) * 0.9, o.z - Math.cos(o.heading) * 0.9);
      if (s) Object.assign(p, s);
    }
  }
  if (!o) {
    if (p.mode !== "sit") rest(p, "sit");
    return;
  }
  if (o.mode === "inside" || o.visible < 0.3) {
    // they popped into a shop: wait by the door
    const door = p.lastSeen ?? { x: o.x, z: o.z };
    const dx = p.x - door.x;
    const dz = p.z - door.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > 1.4 && p.mode !== "walk") {
      const spot = nearWalkable(door.x + (dx / d) * 0.9, door.z + (dz / d) * 0.9);
      if (!spot || !routeTo(p, spot.x, spot.z, "sit", p.walkSpeed * 1.4)) rest(p, "sit");
    }
    if (p.mode === "walk") {
      if (move(p, dt) !== null) rest(p, "sit");
    } else if (p.mode === "sit") p.heading = turn(p.heading, Math.atan2(door.x - p.x, door.z - p.z), Math.min(1, dt * 4));
    p.timer = 99;
    return;
  }
  p.lastSeen = { x: o.x, z: o.z };
  // heel: a little behind and to the side of the person holding the lead
  const bx = o.x - Math.sin(o.heading) * 0.85 - Math.cos(o.heading) * 0.35;
  const bz = o.z - Math.cos(o.heading) * 0.85 + Math.sin(o.heading) * 0.35;
  // the heel spot can be inside a bench or a wall: aim for (and sit at) the nearest place a dog can stand
  const target = nearWalkable(bx, bz) ?? { x: o.x, z: o.z };
  const d = Math.hypot(target.x - p.x, target.z - p.z);
  if (o.mode !== "walk" && d < 0.5) {
    if (p.mode !== "sit") {
      rest(p, "sit");
      if (rand() < 0.4) say(p, pick(p.bubbles));
    }
    p.timer = 99;
    p.heading = turn(p.heading, o.heading, Math.min(1, dt * 3));
    return;
  }
  // caught up with an owner who is stuck in a crowd: stand there instead of treading air
  if (d < 0.3) {
    if (p.mode === "walk") rest(p, "stand");
    p.timer = 99;
    p.heading = turn(p.heading, o.heading, Math.min(1, dt * 3));
    return;
  }
  if ((p.repath -= dt) <= 0 || !p.path.length) {
    p.repath = 0.5;
    p.path = d > 1.6 ? findPath(p.x, p.z, target.x, target.z, 20000) ?? [target] : [target];
    p.best = Infinity;
    p.stuck = 0;
  }
  p.mode = "walk";
  // a resident in a story walks at the director's pace, faster than they stroll
  const os = o.script && !o.script.arrived ? o.script.speed : o.speed;
  p.speed = d > 2.5 ? Math.max(p.runSpeed * 0.8, os * 1.25) : Math.max(os * 1.1, p.walkSpeed * Math.min(1.4, 0.5 + d));
  move(p, dt, o);
}

/**
 * Make a pet bolt a few metres away from a point (a dog, a kid giving chase), staying on its own turf when it can.
 * `icon` skips the random pick, so callers outside the pets' own rules leave the pets' random stream untouched.
 */
export function flee(p: Pet, fromX: number, fromZ: number, icon?: string) {
  const dx = p.x - fromX;
  const dz = p.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  let spot: { x: number; z: number } | null = null;
  let offTurf: { x: number; z: number } | null = null;
  search: for (const dist of [4, 3, 2]) {
    for (const swing of [0, 0.6, -0.6, 1.2, -1.2]) {
      const a = Math.atan2(dx / d, dz / d) + swing;
      const x = p.x + Math.sin(a) * dist;
      const z = p.z + Math.cos(a) * dist;
      if (!walkable(x, z)) continue;
      if (inRange(p, x, z)) {
        spot = { x, z };
        break search;
      }
      offTurf ??= { x, z };
    }
  }
  spot ??= offTurf;
  if (!spot) return false;
  p.greet = null;
  p.zoom = null;
  p.path = [spot];
  p.mode = "walk";
  p.then = "loaf";
  p.speed = p.runSpeed;
  p.best = Infinity;
  p.stuck = 0;
  p.cooldown = 12;
  say(p, icon ?? pick(["🙀", "😾"]), 1.8);
  return true;
}

/** Cats bolt from any dog that gets too close; the dog is delighted. */
function scare(cat: Pet) {
  if (cat.cooldown > 0 || (cat.mode === "walk" && cat.speed === cat.runSpeed)) return;
  const dog = pets.list.find((d) => d.species === "dog" && Math.hypot(d.x - cat.x, d.z - cat.z) < 1.8);
  if (!dog || !flee(cat, dog.x, dog.z)) return;
  if (!dog.bubble) say(dog, pick(["汪!", "💨", "😆"]), 1.6);
  dog.happy = Math.max(dog.happy, 2);
}

/** A pat from the player: a happy noise, a hop, and the name tag. */
export function pat(p: Pet) {
  p.happy = 3.5;
  p.tag = 6;
  if (p.mode === "sleep") rest(p, "sit");
  say(p, p.species === "cat" ? pick(["❤️", "喵~", "😻"]) : pick(["❤️", "汪!", "🐾"]), 2.4);
}

export function stepPets(dt: number) {
  for (const p of pets.list) {
    if (p.bubble) {
      p.bubbleTimer -= dt;
      if (p.bubbleTimer <= 0) p.bubble = null;
    }
    p.happy = Math.max(0, p.happy - dt);
    p.tag = Math.max(0, p.tag - dt);
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.species === "cat") scare(p);
    if (p.walked) {
      stepWalked(p, dt);
      continue;
    }
    if (p.mode === "walk") {
      const r = move(p, dt);
      if (r === "arrived") arrive(p);
      else if (r === "stuck") {
        // could not get there: drop the plan (and any greeting) and think again shortly
        p.greet = null;
        p.vx = p.vz = 0;
        rest(p, "stand");
        p.timer = between(0.5, 1.5);
      }
      continue;
    }
    if (p.mode === "zoom" && p.zoom) {
      const z = p.zoom;
      z.ang += (dt * p.runSpeed * z.dir) / z.r;
      const nx = z.cx + Math.cos(z.ang) * z.r;
      const nz = z.cz + Math.sin(z.ang) * z.r;
      if (walkable(nx, nz)) {
        p.vx = (nx - p.x) / Math.max(dt, 1e-3);
        p.vz = (nz - p.z) / Math.max(dt, 1e-3);
        p.x = nx;
        p.z = nz;
        p.heading = Math.atan2(p.vx, p.vz);
        p.phase += dt * p.runSpeed * 9;
      } else p.timer = 0;
    }
    if (p.mode === "sleep" && !p.bubble && rand() < dt * 0.25) say(p, "💤", 2);
    p.timer -= dt;
    if (p.timer <= 0) nextThing(p);
  }
}
