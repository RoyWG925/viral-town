// The control group: the same residents driven by hand-written rules instead of Gemma.
// Keyword topic matching, trust-weighted belief, pass it on to the most trusted friend, role reflexes.
// It is meant to be a fair, reasonably smart baseline, not a strawman.
import type { ActionIntent, Category, DecisionOutput, Says } from "./types.ts";
import { checkDecision } from "./validate.ts";
import type { MindResult } from "./mind.ts";
import { confidenceRange, type View } from "./view.ts";

// Each pattern matches the English the game now speaks and the Chinese of the older lab logs.
const TOPIC_RULES: { topic: string; all: RegExp[]; category: Category; says?: Says }[] = [
  { topic: "festival_on", all: [/燈籠節|慶典|festival/i, /取消|延期|停辦|改到|不辦|cancel|postpone|call(ed|ing)? off|delay|moved to|won't happen|not happening/i], category: "event", says: "no" },
  { topic: "pigeons_release", all: [/鴿|pigeon|dove/i, /放飛|放鴿|白鴿|releas|let (them|the \w+) (go|fly)|white dove/i], category: "event" },
  { topic: "mayor_fears_pigeons", all: [/市長|mayor/i, /鴿|pigeon|dove|bird/i, /怕|恐懼|嚇|afraid|scared|fear|terrif|frighten|phobi/i], category: "personal" },
  { topic: "pigeons_sick", all: [/鴿|pigeon|dove/i, /病|傳染|禽流感|髒|sick|\bill\b|disease|infect|bird flu|dirty/i], category: "health" },
  { topic: "birds_banned", all: [/禁止|不准|禁|\bban|forbid|not allowed|prohibit/i, /鳥|鴿|bird|pigeon|dove/i], category: "policy" },
  { topic: "stage_unsafe", all: [/舞台|stage/i, /危險|不安全|垮|塌|撐不住|檢查|鬆|danger|unsafe|collaps|fall down|give way|wobbl|shaky|loose|inspect|unstable|(won't|can't|not|n't) hold/i], category: "safety" },
  { topic: "lanterns_flammable", all: [/燈籠|lantern/i, /火|燒|劣質|易燃|fire|burn|flammable|cheap|shoddy|catch/i], category: "safety" },
  { topic: "mayor_embezzled", all: [/市長|mayor/i, /貪|私吞|挪用|拿錢|A錢|embezzl|pocket|stole|steal|skim|siphon|misus|took (the )?money|kickback|corrupt/i], category: "scandal" },
  { topic: "budget_overrun", all: [/預算|經費|budget|funds|funding/i, /超支|不夠|爆|\bover|ran out|run out|short|blown|not enough|overspen/i], category: "scandal" },
  { topic: "fee_covers_budget", all: [/攤位費|stall fee|booth fee/i, /補|洞|預算|cover|hole|budget|gap|plug/i], category: "policy" },
  { topic: "police_short", all: [/警|police|officer|\bcops?\b/i, /不夠|一半|人手|不足|short|half|not enough|understaffed|thin/i], category: "safety" },
  { topic: "oven_unsafe", all: [/烤箱|oven/i], category: "safety" },
  { topic: "threat", all: [/炸|攻擊|破壞|搞事|傷害|威脅|暗殺|bomb|attack|sabotag|wreck|(make|cause|stir up) trouble|hurt|harm|threat|assassin|explo/i], category: "crime" },
];
// a denial, in either language (plain "not" is too common in English to count: "might not hold" is no denial)
const NEGATION = /不是|沒有|沒那回事|謠言|假的|闢謠|別相信|根本沒|not true|isn't true|is false|completely false|untrue|\bfake\b|just a rumou?r|only a rumou?r|nonsense|don't believe|no truth|never happened|made up|baseless|debunk/i;

function topicOf(text: string) {
  for (const r of TOPIC_RULES) if (r.all.every((re) => re.test(text))) return r;
  return { topic: "other", category: "other" as Category, says: "yes" as Says };
}

export function decideWithRules(view: View): MindResult {
  const actions: ActionIntent[] = [];
  const claims: DecisionOutput["claims"] = [];
  const stances: DecisionOutput["stances"] = [];
  const sources = view.inbox.map((m) => m.from);
  for (const m of view.inbox) {
    if (m.intent === "ask") continue; // a question asserts nothing
    const r = topicOf(m.text);
    // denials flip the claim
    const denied = m.intent === "deny" || NEGATION.test(m.text);
    const base = r.says ?? "yes";
    const says: Says = denied ? (base === "yes" ? "no" : "yes") : base;
    const existing = view.beliefs.find((b) => b.topic === r.topic && r.topic !== "other");
    // drop an article's headline, tags like [Rumor] and "I heard" openers, so what is left is the claim itself
    const gist =
      m.text
        .replace(/〈[^〉]*〉/g, "").replace(/^“[^”]*”\s+(?=\S)/, "").replace(/【[^】]*】/g, "").replace(/\[[^\]]*\]\s*/g, "")
        .replace(/^(聽說|據說|有人說|我聽說)+/, "").replace(/^((i heard|i've heard|word is|rumou?r has it|someone said|people say|they say|apparently)( that)?[:,]?\s+)+/i, "")
        .trim().slice(0, 170) || m.text.slice(0, 170);
    claims.push({ ref: existing?.id ?? "new", statement: gist, topic: r.topic, says, category: r.category });
    const range = confidenceRange(view, r.topic, says, [...new Set([...(existing?.sources ?? []), ...sources])], m.senderConf);
    // corroboration never lowers belief: keep the higher of what they had and what this source supports
    const fresh = Math.min(range.max, Math.max(range.min, m.trust * (0.6 + 0.6 * view.npc.credulity) + (existing ? 0.1 : 0)));
    const conf = Math.max(existing?.confidence ?? 0, fresh);
    stances.push({ claim: claims.length - 1, verdict: conf >= 0.5 ? "believe" : conf >= 0.25 ? "doubt" : "disbelieve", confidence: Number(conf.toFixed(2)), why: "rule", cites: [m.id] });
  }
  const best = stances.reduce((b, s) => (s.confidence > (b?.confidence ?? -1) ? s : b), undefined as (typeof stances)[number] | undefined);
  const claim = best ? claims[best.claim] : undefined;
  const conf = best?.confidence ?? 0;
  const role = view.npc.role;
  const asked = view.inbox.find((m) => m.intent === "ask");
  const cite = best ? [`#${best.claim}`] : [];
  if (asked && view.people.some((p) => p.id === asked.from)) {
    actions.push({ type: "tell", target: asked.from, intent: "answer", message: conf >= 0.5 ? `I heard that too: ${claim?.statement}` : "I haven't heard anything about that.", why: "rule: answer when asked", cites: cite });
  } else if (claim && conf >= 0.5 && role === "police" && ["safety", "crime"].includes(claim.category)) {
    actions.push({ type: "dispatch_police", place: "plaza", message: "Step up patrols on the plaza", why: "rule: police reflex", cites: cite });
  } else if (claim && conf >= 0.3 && role === "journalist") {
    actions.push({ type: "publish_article", message: `[Rumor] ${claim.statement}`, why: "rule: journalist publishes", cites: cite });
  } else if (claim && conf >= 0.5 && role === "vendor" && ["policy", "scandal"].includes(claim.category)) {
    actions.push({ type: "rally", place: "townhall", message: `Everyone to the town hall, we want answers: ${claim.statement}`, why: "rule: vendor rally", cites: cite });
  } else if (claim && role === "mayor" && conf >= 0.25 && /市長|mayor/i.test(claim.statement)) {
    actions.push({ type: "public_statement", message: "The recent rumors are completely false. The Lantern Festival goes ahead as planned.", why: "rule: mayor denies", cites: cite });
  } else if (claim && conf >= 0.7 && role === "mayor" && claim.category === "safety") {
    actions.push({ type: "cancel_festival", message: "For safety reasons, tonight's Lantern Festival is cancelled.", why: "rule: safety first", cites: cite });
  }
  if (!actions.length && claim && conf >= 0.3 && view.npc.talkative >= 0.5) {
    // do not pass it on to someone who told us, or whom we already told (the engine also refuses repeats)
    const told = new Set(view.memory.filter((l) => (l.includes("你決定：") || l.includes("You decided to")) && l.includes(claim.statement.slice(0, 14))).flatMap((l) => view.people.filter((p) => l.includes(p.name)).map((p) => p.id)));
    const friend = view.people.filter((p) => !told.has(p.id) && !view.inbox.some((m) => m.from === p.id)).sort((a, b) => b.relation.trust - a.relation.trust)[0];
    if (friend) actions.push({ type: friend.relation.phone ? "phone" : "tell", target: friend.id, intent: "inform", message: `I heard: ${claim.statement}`, why: "rule: pass it on", cites: cite });
  }
  if (!actions.length) actions.push({ type: "none", why: "rule: nothing to do" });
  const output: DecisionOutput = {
    understanding: claim ? `Someone said: ${claim.statement}` : "",
    claims, stances,
    feeling: conf >= 0.5 ? "😮 Surprised" : "🤨 Doubtful",
    thought: conf >= 0.5 ? "Is that true?" : "I'll take that with a grain of salt.",
    actions,
  };
  const checked = checkDecision(view, output, { requireReading: false });
  return { output, checked, llm: [], validation: [{ attempt: 1, errors: checked.errors }], fallback: false };
}
