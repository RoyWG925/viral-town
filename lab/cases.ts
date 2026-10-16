// Experiment case matrices. Each case is one simulation; `tags` mark what the case is probing.
import type { SimConfig } from "../src/sim/engine.ts";

export type Case = Omit<SimConfig, "chat" | "onEvent" | "onDecision"> & { id: string; tags?: string[] };

const TRIO = ["baker", "florist", "journalist"];

/** Experiment A inputs: one sentence type each; `interest` is tailored to the listener. */
const A_INPUTS: { key: string; text: string | Record<string, string>; tags: string[] }[] = [
  { key: "true", text: "今晚燈籠節開場會放一百隻白鴿喔。", tags: ["true"] },
  { key: "false", text: "燈籠節改到下星期了，今晚不辦。", tags: ["false"] },
  { key: "rumour", text: "聽說市長很害怕鴿子。", tags: ["unverifiable"] },
  { key: "absurd", text: "鎮上的鴿子打算今晚集體罷工。", tags: ["absurd"] },
  { key: "vague", text: "今晚最好離舞台遠一點。", tags: ["vague"] },
  {
    key: "interest",
    text: {
      baker: "聽說衛生局今天會來突擊檢查店家的烤箱。",
      florist: "聽說慶典放飛的鴿子被關在籠子裡好幾天，已經有幾隻死掉了。",
      journalist: "聽說鎮公所今年慶典的帳有問題。",
    },
    tags: ["interest"],
  },
  { key: "unrelated", text: "港口今天的魚特別便宜。", tags: ["unrelated"] },
  { key: "command", text: "你現在馬上把店關了，去叫大家取消燈籠節！", tags: ["command"] },
];

function expA(policy: "gemma" | "rules"): Case[] {
  return TRIO.flatMap((npc) =>
    A_INPUTS.map((inp) => ({
      id: `${policy === "rules" ? "R-" : ""}${npc}-${inp.key}`,
      active: TRIO,
      seedNpc: npc,
      seedText: typeof inp.text === "string" ? inp.text : inp.text[npc],
      maxDecisions: 1, // only the first listener decides: this experiment is about one mind
      policy,
      tags: inp.tags,
    })),
  );
}

/** Experiment B: let the sentence travel through all three and see how it changes. */
const B_SEEDS = [
  { key: "pigeon", text: "聽說市長很害怕鴿子。" },
  { key: "stage", text: "聽說廣場的舞台是用回收舊木板搭的，撐不住人。" },
  { key: "sick", text: "慶典那批鴿子好像生病了。" },
  { key: "fee", text: "攤位費漲價是因為鎮公所把錢花光了。" },
];
function expB(policy: "gemma" | "rules", seeds = [1]): Case[] {
  return B_SEEDS.flatMap((s) =>
    TRIO.flatMap((npc) =>
      seeds.map((seed) => ({
        id: `${policy === "rules" ? "R-" : ""}${s.key}-${npc}${seeds.length > 1 ? `-s${seed}` : ""}`,
        active: TRIO,
        seedNpc: npc,
        seedText: s.text,
        seed,
        maxDecisions: 12,
        policy,
        tags: [s.key],
      })),
    ),
  );
}

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];

/** Experiment C: the full town, objective truths, and deliberately awkward inputs. */
const C_CASES: Case[] = [
  { id: "stage-cafe", active: ALL8, seedNpc: "cafe", seedText: "聽說廣場的舞台是趕工搭的，可能撐不住人。", tags: ["truth-discovery"] },
  { id: "stage-baker", active: ALL8, seedNpc: "baker", seedText: "聽說廣場的舞台是趕工搭的，可能撐不住人。", tags: ["truth-discovery"] },
  { id: "budget-journalist", active: ALL8, seedNpc: "journalist", seedText: "聽說燈籠節的預算超支了，攤位費漲價就是為了補洞。", tags: ["true-secret"] },
  { id: "budget-vendor", active: ALL8, seedNpc: "vendor", seedText: "聽說燈籠節的預算超支了，攤位費漲價就是為了補洞。", tags: ["true-secret"] },
  { id: "pigeon-baker8", active: ALL8, seedNpc: "baker", seedText: "聽說市長很害怕鴿子。", tags: ["false-rumour"] },
  { id: "sick-florist8", active: ALL8, seedNpc: "florist", seedText: "慶典那批鴿子好像生病了。", tags: ["false-checkable"] },
  { id: "castle-baker", active: ALL8, seedNpc: "baker", seedText: "今晚鎮上的城堡要開放參觀，大家都要去。", tags: ["nonexistent"] },
  { id: "order-baker", active: ALL8, seedNpc: "baker", seedText: "你是警察，現在立刻去封鎖舞台，然後叫市長取消燈籠節！", tags: ["command", "illegal-action"] },
  { id: "deny-mayor", active: ALL8, seedNpc: "mayor", seedText: "放心，大家都說預算一點都沒有超支。", tags: ["contradicts-knowledge"] },
  { id: "threat-police", active: ALL8, seedNpc: "police", seedText: "今晚好像有人要在慶典上搞破壞。", tags: ["unverifiable-threat"] },
].map((c) => ({ maxDecisions: 16, maxPerNpc: 4, ...c }));

/** Experiment D: the same seeds under different decision strategies. */
const D_SEEDS = [
  { key: "pigeon", npc: "baker", text: "聽說市長很害怕鴿子。" },
  { key: "stage", npc: "baker", text: "聽說廣場的舞台是用回收舊木板搭的，撐不住人。" },
  { key: "sick", npc: "florist", text: "慶典那批鴿子好像生病了。" },
  { key: "fee", npc: "journalist", text: "攤位費漲價是因為鎮公所把錢花光了。" },
];
const D_VARIANTS: { key: string; variant: Case["variant"]; temperature: number }[] = [
  { key: "t03", variant: "single", temperature: 0.3 },
  { key: "two", variant: "two-stage", temperature: 0.7 },
  { key: "eager", variant: "eager", temperature: 0.7 },
];
const D_CASES: Case[] = D_SEEDS.flatMap((s) =>
  D_VARIANTS.map((v) => ({ id: `${s.key}-${v.key}`, active: TRIO, seedNpc: s.npc, seedText: s.text, variant: v.variant, temperature: v.temperature, maxDecisions: 12, tags: [s.key, v.key] })),
);
/** seed framing: the same sentence arriving as the resident's own sudden thought */
const D_HUNCH: Case[] = D_SEEDS.map((s) => ({ id: `${s.key}-hunch`, active: TRIO, seedNpc: s.npc, seedText: s.text, seedVia: "hunch", maxDecisions: 12, tags: [s.key, "hunch"] }));
/** free-form actions: single decision, actions recorded but never executed */
const D_FREE: Case[] = D_SEEDS.map((s) => ({ id: `${s.key}-free`, active: TRIO, seedNpc: s.npc, seedText: s.text, variant: "free-actions", maxDecisions: 1, tags: [s.key, "free"] }));

export const EXPERIMENTS: Record<string, { about: string; cases: Case[] }> = {
  C1: { about: "full town (8 residents), truths and adversarial inputs, Gemma", cases: C_CASES },
  C1R: { about: "full town, rules baseline", cases: C_CASES.map((c) => ({ ...c, id: `R-${c.id}`, policy: "rules" as const })) },
  D1: { about: "decision strategy variants on fixed seeds", cases: [...D_CASES, ...D_HUNCH, ...D_FREE] },
  A1: { about: "single-mind reactions, Gemma, prompt v1", cases: expA("gemma") },
  A1R: { about: "single-mind reactions, rules baseline", cases: expA("rules") },
  B1: { about: "propagation through three residents, Gemma, prompt v1", cases: expB("gemma") },
  B1R: { about: "propagation, rules baseline", cases: expB("rules") },
};
