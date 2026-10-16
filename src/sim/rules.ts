// The control group: the same residents driven by hand-written rules instead of Gemma.
// Keyword topic matching, trust-weighted belief, pass it on to the most trusted friend, role reflexes.
// It is meant to be a fair, reasonably smart baseline, not a strawman.
import type { ActionIntent, Category, DecisionOutput, Says } from "./types.ts";
import { checkDecision } from "./validate.ts";
import type { MindResult } from "./mind.ts";
import { confidenceRange, type View } from "./view.ts";

const TOPIC_RULES: { topic: string; all: RegExp[]; category: Category; says?: Says }[] = [
  { topic: "festival_on", all: [/燈籠節|慶典/, /取消|延期|停辦|改到|不辦/], category: "event", says: "no" },
  { topic: "pigeons_release", all: [/鴿/, /放飛|放鴿|白鴿/], category: "event" },
  { topic: "mayor_fears_pigeons", all: [/市長/, /鴿/, /怕|恐懼|嚇/], category: "personal" },
  { topic: "pigeons_sick", all: [/鴿/, /病|傳染|禽流感|髒/], category: "health" },
  { topic: "birds_banned", all: [/禁止|不准|禁/, /鳥|鴿/], category: "policy" },
  { topic: "stage_unsafe", all: [/舞台/, /危險|不安全|垮|塌|撐不住|檢查|鬆/], category: "safety" },
  { topic: "lanterns_flammable", all: [/燈籠/, /火|燒|劣質|易燃/], category: "safety" },
  { topic: "mayor_embezzled", all: [/市長/, /貪|私吞|挪用|拿錢|A錢/], category: "scandal" },
  { topic: "budget_overrun", all: [/預算|經費/, /超支|不夠|爆/], category: "scandal" },
  { topic: "fee_covers_budget", all: [/攤位費/, /補|洞|預算/], category: "policy" },
  { topic: "police_short", all: [/警/, /不夠|一半|人手|不足/], category: "safety" },
  { topic: "oven_unsafe", all: [/烤箱/], category: "safety" },
  { topic: "threat", all: [/炸|攻擊|破壞|搞事|傷害|威脅|暗殺/], category: "crime" },
];
const NEGATION = /不是|沒有|沒那回事|謠言|假的|闢謠|別相信|根本沒/;

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
    const gist = m.text.replace(/〈[^〉]*〉/g, "").replace(/【[^】]*】/g, "").replace(/^(聽說|據說|有人說|我聽說)+/, "").slice(0, 100) || m.text.slice(0, 100);
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
    actions.push({ type: "tell", target: asked.from, intent: "answer", message: conf >= 0.5 ? `我也聽說了：${claim?.statement}` : "我沒聽說這件事。", why: "rule: answer when asked", cites: cite });
  } else if (claim && conf >= 0.5 && role === "police" && ["safety", "crime"].includes(claim.category)) {
    actions.push({ type: "dispatch_police", place: "plaza", message: "加強廣場巡邏", why: "rule: police reflex", cites: cite });
  } else if (claim && conf >= 0.3 && role === "journalist") {
    actions.push({ type: "publish_article", message: `【傳聞】${claim.statement}`, why: "rule: journalist publishes", cites: cite });
  } else if (claim && conf >= 0.5 && role === "vendor" && ["policy", "scandal"].includes(claim.category)) {
    actions.push({ type: "rally", place: "townhall", message: `大家到鎮公所前面討個說法：${claim.statement}`, why: "rule: vendor rally", cites: cite });
  } else if (claim && role === "mayor" && conf >= 0.25 && /市長|mayor/.test(claim.statement)) {
    actions.push({ type: "public_statement", message: "關於最近的傳聞，純屬謠言，燈籠節照常舉行。", why: "rule: mayor denies", cites: cite });
  } else if (claim && conf >= 0.7 && role === "mayor" && claim.category === "safety") {
    actions.push({ type: "cancel_festival", message: "基於安全考量，今晚燈籠節取消。", why: "rule: safety first", cites: cite });
  }
  if (!actions.length && claim && conf >= 0.3 && view.npc.talkative >= 0.5) {
    // do not pass it on to someone who told us, or whom we already told (the engine also refuses repeats)
    const told = new Set(view.memory.filter((l) => l.includes("你決定：") && l.includes(claim.statement.slice(0, 8))).flatMap((l) => view.people.filter((p) => l.includes(p.name)).map((p) => p.id)));
    const friend = view.people.filter((p) => !told.has(p.id) && !view.inbox.some((m) => m.from === p.id)).sort((a, b) => b.relation.trust - a.relation.trust)[0];
    if (friend) actions.push({ type: friend.relation.phone ? "phone" : "tell", target: friend.id, intent: "inform", message: `聽說${claim.statement}`, why: "rule: pass it on", cites: cite });
  }
  if (!actions.length) actions.push({ type: "none", why: "rule: nothing to do" });
  const output: DecisionOutput = {
    understanding: claim ? `有人說：${claim.statement}` : "",
    claims, stances,
    feeling: conf >= 0.5 ? "😮 驚訝" : "🤨 懷疑",
    thought: conf >= 0.5 ? "這是真的嗎？" : "聽聽就好。",
    actions,
  };
  const checked = checkDecision(view, output, { requireReading: false });
  return { output, checked, llm: [], validation: [{ attempt: 1, errors: checked.errors }], fallback: false };
}
