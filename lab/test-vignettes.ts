// The everyday scenes (鎮上日常 / Everyday life) must never sound like the story: no story topic, no FACTS keyword,
// no story-reaction emoji, no secret put into words. node --test lab/test-vignettes.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";
import { CHAT_PAIRS, DOOR_EMOJI, DOOR_EMOJI_DEFAULT, NPC_POST, SCENE_TEXT, STORY_EMOJI } from "../src/town/cast.ts";

// The lines are English now; the Chinese lists stay so any line still written in Chinese is vetted too.
const BANNED = ["舞台安全", "檢查", "預算", "超支", "烤箱", "警力", "鴿子生病", "部落格", "結構"];
// words that carry a story topic's question (sim/scenario.ts TOPICS), on top of the banned list
const TOPIC_WORDS = ["財務", "公款", "私吞", "挪用", "破壞", "生病", "傳染", "著火", "劣質", "禁止", "不安全", "危險"];
// the same in English, matched as whole words, any case
const BANNED_EN = [
  "stage safety", "safety", "safe", "check", "checked", "checks", "checkup", "inspect", "inspected", "inspection", "inspections",
  "budget", "budgets", "over budget", "overspent", "overspend", "oven", "ovens", "officers", "staffing", "manpower", "sick", "blog", "blogs",
  "structure", "structural",
];
const TOPIC_EN = [
  "finance", "finances", "financial", "funds", "public money", "embezzle", "embezzled", "embezzling", "pocketed", "misused", "sabotage",
  "vandal", "vandals", "threat", "ill", "illness", "disease", "contagious", "infection", "infected", "fire", "on fire", "flammable",
  "shoddy", "substandard", "ban", "banned", "forbidden", "unsafe", "danger", "dangerous",
];
const KEYWORDS = FACTS.flatMap((f) => f.keywords);
const PET_NAMES = ["Mochi", "Tubby", "Sooty", "Nori"]; // petSim.ts's cats (the cat-chase label names one)
const src = (f: string) => readFileSync(new URL(`../src/town/${f}`, import.meta.url), "utf8");
const lower = (s: string) => s.toLowerCase();
const hasWord = (line: string, w: string) => new RegExp(`(^|[^a-z])${w.replace(/ /g, "\\s+")}($|[^a-z])`, "i").test(line);

/** Every string in the scene text table (label functions called with each pet's name). */
function texts(x: unknown): string[] {
  if (typeof x === "string") return [x];
  if (typeof x === "function") return PET_NAMES.map((n) => String(x(n)));
  if (Array.isArray(x)) return x.flatMap(texts);
  if (x && typeof x === "object") return Object.values(x).flatMap(texts);
  return [];
}
/** Every quoted string in the code (comments skipped), as written. */
function quoted(code: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < code.length; ) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      const j = code.indexOf("\n", i);
      i = j < 0 ? code.length : j;
    } else if (c === "/" && code[i + 1] === "*") {
      const j = code.indexOf("*/", i + 2);
      i = j < 0 ? code.length : j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      out.push(code.slice(i + 1, j));
      i = j + 1;
    } else i++;
  }
  return out;
}
const CJK = /[一-鿿]/;
/** Strings that read as words (Chinese, or two English words in a row): catches lines written inline. */
const literals = (code: string) => quoted(code).filter((s) => CJK.test(s) || /[A-Za-z]\s+[A-Za-z]/.test(s));

const ALL = [...texts(SCENE_TEXT), ...["vignettes.ts", "cast.ts", "ambientLines.ts"].flatMap((f) => literals(src(f)))];

test("the scene text table and the scene sources have lines to check", () => {
  assert.ok(texts(SCENE_TEXT).length >= 30, "scene text table is suspiciously small");
  assert.ok(literals(src("vignettes.ts")).length >= 1);
  assert.ok(literals(src("cast.ts")).length >= 30, "cast.ts lines are not being read");
});

test("no everyday line or label uses a banned word, a story-topic word or a FACTS keyword", () => {
  for (const line of ALL) {
    for (const w of [...BANNED, ...TOPIC_WORDS]) assert.ok(!line.includes(w), `“${line}” contains “${w}”`);
    for (const w of [...BANNED_EN, ...TOPIC_EN]) assert.ok(!hasWord(line, w), `“${line}” contains “${w}”`);
    for (const w of KEYWORDS) assert.ok(!lower(line).includes(lower(w)), `“${line}” contains “${w}”`);
  }
});

test("no everyday line repeats a resident's private wants or a secret fact", () => {
  const secret = PERSONAS.flatMap((p) => [
    p.wants,
    ...p.secrets.flatMap((id) => {
      const f = FACTS.find((x) => x.id === id)! as { zh: string; en?: string };
      return [f.zh, f.en ?? ""].filter(Boolean);
    }),
  ]).map(lower);
  for (const line of ALL.map(lower)) {
    // a line that is a piece of a secret: any Chinese line, or an English one of three words or more
    const piece = CJK.test(line) || line.trim().split(/\s+/).length >= 3;
    for (const s of secret) assert.ok(!line.includes(s) && !(piece && s.includes(line)), `“${line}” overlaps “${s}”`);
  }
});

test("ambient emoji pools never use the director's story-reaction emoji", () => {
  const pools = [...Object.values(DOOR_EMOJI).flat(), ...DOOR_EMOJI_DEFAULT, ...CHAT_PAIRS.flat()];
  for (const e of pools) assert.ok(!STORY_EMOJI.some((s) => e.includes(s)), `${e} is a story emoji`);
  // the crowd's and the pets' own pools too (❗ deliver, 😮 surprise, 👀 a passer-by noticing a story talk)
  for (const f of ["crowdSim.ts", "petSim.ts", "vignettes.ts"]) {
    for (const e of ["❗", "😮", "👀"]) assert.ok(!src(f).includes(e), `${f} still uses ${e}`);
  }
});

test("labels are short ticker lines that start with one emoji and a space (the meanwhile cut strips it)", () => {
  const labels = texts([SCENE_TEXT.stageRush.label, SCENE_TEXT.haggle.label, SCENE_TEXT.samples.label, SCENE_TEXT.patrol.label, SCENE_TEXT.catChase.label, SCENE_TEXT.gossip.label, SCENE_TEXT.speech.label, ...Object.values(SCENE_TEXT.bicker).map((b) => b.label)]);
  for (const l of labels) {
    assert.match(l, /^\S+ \S/u, `“${l}” should be "emoji text"`);
    // English needs about 1.7× the characters the Chinese labels had (24)
    assert.ok([...l].length <= 40, `“${l}” is too long for the ticker`);
  }
});

test("cast.ts NPC_POST matches the director's table", () => {
  const m = /NPC_POST: Record<string, string> = \{([^}]*)\}/.exec(src("director.ts"));
  if (!m) return; // the director imports cast.ts's table now
  const director = Object.fromEntries([...m[1].matchAll(/(\w+): "([\w-]+)"/g)].map((x) => [x[1], x[2]]));
  assert.deepEqual(director, NPC_POST);
});
