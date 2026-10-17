// The everyday scenes (鎮上日常) must never sound like the story: no story topic, no FACTS keyword, no story-reaction
// emoji, no secret put into words. node --test lab/test-vignettes.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";
import { CHAT_PAIRS, DOOR_EMOJI, DOOR_EMOJI_DEFAULT, NPC_POST, SCENE_TEXT, STORY_EMOJI } from "../src/town/cast.ts";

const BANNED = ["舞台安全", "檢查", "預算", "超支", "烤箱", "警力", "鴿子生病", "部落格", "結構"];
// words that carry a story topic's question (sim/scenario.ts TOPICS), on top of the banned list
const TOPIC_WORDS = ["財務", "公款", "私吞", "挪用", "破壞", "生病", "傳染", "著火", "劣質", "禁止", "不安全", "危險"];
const KEYWORDS = FACTS.flatMap((f) => f.keywords);
const PET_NAMES = ["麻糬", "胖橘", "煤球", "海苔"];
const src = (f: string) => readFileSync(new URL(`../src/town/${f}`, import.meta.url), "utf8");

/** Every string in the scene text table (label functions called with each pet's name). */
function texts(x: unknown): string[] {
  if (typeof x === "string") return [x];
  if (typeof x === "function") return PET_NAMES.map((n) => String(x(n)));
  if (Array.isArray(x)) return x.flatMap(texts);
  if (x && typeof x === "object") return Object.values(x).flatMap(texts);
  return [];
}
/** Every quoted string with Chinese in it, straight from the source (catches lines written inline). */
const literals = (code: string) => [...code.matchAll(/(["'`])((?:\\.|(?!\1).)*?[一-鿿](?:\\.|(?!\1).)*?)\1/g)].map((m) => m[2]);

const ALL = [...texts(SCENE_TEXT), ...["vignettes.ts", "cast.ts", "ambientLines.ts"].flatMap((f) => literals(src(f)))];

test("the scene text table and the scene sources have lines to check", () => {
  assert.ok(texts(SCENE_TEXT).length >= 30, "scene text table is suspiciously small");
  assert.ok(literals(src("vignettes.ts")).length >= 1);
});

test("no everyday line or label uses a banned word, a story-topic word or a FACTS keyword", () => {
  for (const line of ALL) {
    for (const w of [...BANNED, ...TOPIC_WORDS, ...KEYWORDS]) assert.ok(!line.includes(w), `「${line}」 contains 「${w}」`);
  }
});

test("no everyday line repeats a resident's private wants or a secret fact", () => {
  const secret = PERSONAS.flatMap((p) => [p.wants, ...p.secrets.map((id) => FACTS.find((f) => f.id === id)!.zh)]);
  for (const line of ALL) for (const s of secret) assert.ok(!line.includes(s) && !s.includes(line), `「${line}」 overlaps 「${s}」`);
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
    assert.match(l, /^\S+ \S/u, `「${l}」 should be "emoji text"`);
    assert.ok([...l].length <= 24, `「${l}」 is too long for the ticker`);
  }
});

test("cast.ts NPC_POST matches the director's table", () => {
  const m = /NPC_POST: Record<string, string> = \{([^}]*)\}/.exec(src("director.ts"));
  if (!m) return; // the director imports cast.ts's table now
  const director = Object.fromEntries([...m[1].matchAll(/(\w+): "([\w-]+)"/g)].map((x) => [x[1], x[2]]));
  assert.deepEqual(director, NPC_POST);
});
