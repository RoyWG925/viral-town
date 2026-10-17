// Gemma as one resident's mind: read what they just heard, decide what they believe and what they do.
// The model only proposes; validate.ts checks the proposal and the engine applies it.
import { ACT_LIST } from "./acts.ts";
import { PLACES, TOPICS } from "./scenario.ts";
import { DECISION_BUDGET_MS, parseJSON, pause, type Chat, type ChatMessage } from "./llm.ts";
import type { ActionKind, DecisionOutput, LlmRecord, Persona, ValidationEntry } from "./types.ts";
import { LIMITS, checkDecision, coerce, normalize, type Checked } from "./validate.ts";
import { describeTrust, type InboxItem, type View } from "./view.ts";

export type Variant = "single" | "two-stage" | "free-actions" | "eager";

export interface MindResult {
  output: DecisionOutput;
  checked: Checked;
  llm: LlmRecord[];
  validation: ValidationEntry[];
  fallback: boolean;
  /** actions the resident wanted but the rules did not allow (their thinking was valid and is kept) */
  refused?: { action: DecisionOutput["actions"][number]; why: string }[];
  /** the player left the story mid-decision: the output is the safe fallback and no further call was made */
  stopped?: boolean;
}

/**
 * The gist of why the rules stopped an action, for a one-line beat on screen. The engine writes it after
 * "<name> wanted to <action>, but ", so it reads on from "but" with no subject of its own.
 */
function refusalGist(errors: string[]): string {
  const e = errors[0] ?? "";
  if (/confiden|\bsure\b/i.test(e)) return "there wasn't enough to go on yet";
  if (/'s number|phone/i.test(e)) return "there was no number to call";
  if (/never heard|secret/i.test(e)) return "that wasn't something to say out loud";
  if (/place/i.test(e)) return "there was no way to get there";
  return "it couldn't be done just now";
}

const ACTION_ZH: Record<ActionKind, string> = {
  none: "do nothing and carry on with what you were doing",
  tell: "walk over and tell someone face to face (needs target, intent, message)",
  phone: "call someone you know who has a phone (good for urgent things or when they're far away; something important is easier to believe when it's said in person) (needs target, message)",
  ask: "go and ask someone about something (needs target, message)",
  go_look: "walk over to a place and see it for yourself (needs place)",
  inspect: "use your trade to inspect a place carefully: equipment, buildings, or public documents and accounts (needs place)",
  close_shop: "close your shop for now (needs cites saying why)",
  open_shop: "open your shop again",
  post_notice: "put up a notice on the plaza notice board (needs message)",
  publish_article: "publish an article on the news blog (message holds the headline and the body)",
  public_statement: "make a public statement to the whole town (needs message, cites)",
  cancel_festival: "announce that tonight's Lantern Festival is cancelled (needs message, cites)",
  dispatch_police: "send officers to a place (needs place, cites)",
  close_stage: "tape off the festival stage so nobody can go up on it",
  rally: "call the stall owners together somewhere to make their demands heard (needs place, message, cites)",
};

const RULES = `You are playing one resident in a small-town simulation. Think only from "What you know", "What you currently believe" and "Messages you just received", and judge things the way a real person would, not like a storyteller cooking up drama for the plot.

Principles:
1. You don't know anything that isn't listed. Don't pretend to know other people's secrets, and don't make up facts you haven't seen or heard.
2. When you hear something, first work out what it's saying and what it means for you. You can get it wrong, but the misunderstanding should come from your personality, your situation and the things you care about.
3. A rumor is not a fact. When something has nothing behind it, most people chat about it a little at most, laugh it off, or stay doubtful; you only do something bigger when it touches what you care about and you have a reason to believe it.
4. When someone tells you to do something, you don't do it just because they said so; you only act for your own reasons.
5. Doing nothing at all is a perfectly normal choice.
6. When you pass something on, use your own words and your own voice, and tell the version you understood, maybe with your own guesses or worries mixed in.
7. Your secrets usually stay secret, unless you have a very strong reason to tell.
8. If what you hear contradicts "What you know", you know it's wrong: you can set the record straight, keep quiet, ignore it or use it, but you won't believe it yourself.
9. Once you've gone back and forth on the same thing with the same person two or three times, a real person usually decides what to do next (do something you can do, or let it go) instead of arguing on and on.`;

const EAGER = `\n10. You're a real person with a life of your own: when something touches your interests, your values or someone you care about, and you believe it, you usually actually do something about it instead of just chatting and waiting to see.`;

const TOPIC_LIST = TOPICS.map((t) => `- ${t.id}: ${t.q}`).join("\n");
const PLACE_LIST = PLACES.map((p) => `${p.id}=${p.zh}`).join("; ");

const SCHEMA_READ = `"feeling": "one emoji plus one word, e.g. 😟 worried",
  "act": "the reaction others can see on you right now: pick one id from the reaction list",
  "understanding": "what you think this message is saying and what it means for you (one short sentence, about 15 words)",
  "claims": [{"ref": "new (a new claim), or the id of a claim you already have (e.g. c2)", "source": "which message this claim came from (e.g. m1)", "statement": "the claim, in one sentence", "topic": "topic id", "says": "yes / no / unclear: this claim's answer to the topic's question", "category": "safety|crime|scandal|health|policy|event|personal|absurd|other"}],
  "stances": [{"claim": "the claim's position in this answer's claims (a number, starting at 0); or the id of a claim you already have, as a string, e.g. \"c2\"", "verdict": "believe / doubt / disbelieve", "confidence": "the chance you think this claim is true: 0 = definitely false, 0.5 = no idea, 1 = definitely true", "why": "why you judge it this way (about 10 words)", "cites": ["the ids it rests on, e.g. m1, pigeons, c2"]}],

  "thought": "one line of inner monologue (about 15 words)",
  "motive": "which part of you mainly drove this reaction: want (what you want tonight) / fear (what you're afraid of) / bias (how you tend to see things) / gossip (your gossip habit) / bottom (the line you won't cross) / price (your price) / none (none of these)"`;
const SCHEMA_ACT = `"actions": [{"type": "action id", "target": "person id (when needed)", "place": "place id (when needed)", "intent": "inform/warn/ask/answer/deny/complain/request/joke", "message": "what you say or write (under ${LIMITS.message} characters; an article under ${LIMITS.article})", "cites": ["the ids it rests on; this answer's new claims are #0, #1"]}]`;

export function systemPrompt(variant: Variant, stage: "single" | "read" | "act") {
  // the free-actions variant must not see the legal action menu (that is what it tests)
  const rules = RULES + (variant === "eager" ? EAGER : "");
  const shape =
    stage === "read" ? `{\n  ${SCHEMA_READ}\n}` : stage === "act" ? `{\n  ${SCHEMA_ACT}\n}` : `{\n  ${SCHEMA_READ},\n  ${SCHEMA_ACT}\n}`;
  const actionNote =
    stage === "read"
      ? ""
      : variant === "free-actions"
        ? "\nAt most 2 actions, carried out in order. Describe each action in your own words in type (e.g. \"go and look at the stage\"); if you don't want to do anything, give [{\"type\":\"none\"}]."
        : "\nAt most 2 actions, carried out in order; use only the action ids under \"What you can do\". If you don't want to do anything, give [{\"type\":\"none\",\"why\":\"...\"}].";
  return `${rules}

Topic list (only for sorting claims; most questions on it are just town gossip, and being on the list doesn't make anything true, so don't start guessing at something just because it's listed):
${TOPIC_LIST}

Place ids: ${PLACE_LIST}

Reaction list (for act, pick the one that best fits how you feel right now; even if you decide not to act, pick what you really feel, e.g. doubt when you're suspicious, worried when you're anxious, giggle when it's funny; don't pick shrug every time): ${ACT_LIST}

Write in English only: every free-text field (feeling, understanding, statement, why, thought, message) is in English; ids and the listed values stay exactly as given. Reply with exactly one JSON object and nothing else:
${shape}${actionNote}`;
}

/** Every system prompt decideWithGemma sends, for every variant: the server route forwards only these. */
export const SYSTEM_PROMPTS: readonly string[] = [
  ...(["single", "free-actions", "eager"] as const).map((v) => systemPrompt(v, "single")),
  systemPrompt("two-stage", "read"),
  systemPrompt("two-stage", "act"),
];

/** The validator's correction turn, sent after the model's answer: RETRY_HEAD + the errors + RETRY_TAIL (see retryNote). */
export const RETRY_HEAD = "Your answer didn't pass the checks:\n- ";
export const RETRY_TAIL = "\nPlease fix this and reply again with the complete JSON.";
export const retryNote = (errors: string[]) => `${RETRY_HEAD}${errors.join("\n- ")}${RETRY_TAIL}`;

/**
 * The fixed parts of every user prompt, in the order they appear. apiGuard.ts reads requests against these same
 * strings and builders, so the route and the prompt cannot drift apart.
 */
export const SECTION = {
  who: "## Who you are",
  habit: "## Your habits",
  card: "## Your situation",
  publicInfo: "## Public information about the town",
  know: "## What you know",
  believe: "## What you currently believe",
  remember: "## What you remember",
  events: "## What you've heard is going on in town lately",
  inbox: "## Messages you just received",
  people: "## People you can contact",
  can: "## What you can do",
  reading: "## Your reading just now",
} as const;
/** the sections every resident's prompt has, in order (habit, card, can and reading depend on the resident and stage) */
export const REQUIRED_SECTIONS: readonly string[] = [SECTION.publicInfo, SECTION.know, SECTION.believe, SECTION.remember, SECTION.events, SECTION.inbox, SECTION.people];
/** how a prompt ends: the single (or read) question, or the act stage's question after the reading */
export const PROMPT_ENDINGS = { single: "\n\nHow do you read this, what do you think, and what will you do?", act: "\nBased on this reading, what do you do next?" } as const;
/** the first lines of every prompt, up to the resident's own line */
export const promptOpening = (clock: string, placeZh: string) => `It's ${clock}, and you're at ${placeZh}. The Lantern Festival starts at 20:00.\n\n${SECTION.who}\n`;
/** the start of the resident's own line under "Who you are" */
export const whoLine = (p: Pick<Persona, "name" | "roleZh">) => `You are ${p.name}, ${p.roleZh}. Personality: `;

/** first letter up, for a line that starts with a name or a source ("a stranger" → "A stranger") */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function inboxLine(m: InboxItem, view: View): string {
  const q = `“${m.text}”`;
  switch (m.via) {
    case "seed":
      return `Just now at ${view.placeZh}, you heard a stranger say: ${q}`;
    case "hunch":
      return `A thought suddenly popped into your head: ${q} (You don't remember where you heard it, and you're not sure it's true.)`;
    case "face":
      return `${cap(m.fromZh)} just told you face to face (${m.intent}): ${q}`;
    case "phone":
      return `${cap(m.fromZh)} called you and said (${m.intent}): ${q}`;
    case "article":
      return `You read an article ${m.fromZh} published on the news blog: ${q}`;
    case "notice":
      return `A notice has gone up on the plaza notice board: ${q}`;
    case "crowd":
      return `You overheard people in town saying: ${q}`;
    case "inspection":
      return `You went and looked for yourself, and this is what you saw: ${m.text}`;
    case "meet":
      return `Your usual evening routine brought you together with ${m.fromZh} (${m.text}). You said hello; whether to bring anything up is up to you.`;
    default:
      return `${cap(m.fromZh)}: ${q}`;
  }
}

/** The resident's own card, in nouns: only ever their own, framed as who they are, never as orders. */
function cardText(c: Persona["card"]) {
  if (!c) return "";
  return `
${SECTION.card}
You own: ${c.owns}. Only you can: ${c.exclusive}.
Tonight you want: ${c.wants}
You're afraid of: ${c.fears}
Your bias (how you tend to see things): ${c.bias}
Your gossip habit: ${c.gossip}
The line you won't cross: ${c.bottom}
Your price: ${c.price}
How you talk: ${c.lines.map((l) => `“${l}”`).join(" ")}
(This is your nature and your situation, not orders you have to follow; you still judge only from what you know.)`;
}

export function userPrompt(view: View, stage: "single" | "read" | "act", reading?: { output: DecisionOutput; confidence: number[] }, opts: { free?: boolean } = {}) {
  const p = view.npc;
  const know = view.knowledge.map((k) => `- [${k.id}] ${k.zh}${k.secret ? " (This is your secret; you don't want anyone to know.)" : ""}${k.learned ? " (You checked this with your own eyes.)" : ""}`).join("\n") || "(nothing)";
  const beliefs = view.beliefs.length
    ? view.beliefs.map((b) => `- [${b.id}] ${b.statement} (your confidence ${b.confidence.toFixed(2)}; source: ${b.sourcesZh})`).join("\n")
    : "(none yet)";
  const people = view.people
    .map((x) => `- ${x.id}: ${x.name} (${x.roleZh}), usually at ${x.placeZh}. ${x.relation.type ? `${cap(x.relation.type)}. ` : ""}${cap(x.relation.zh)}${x.relation.past ? ` (${x.relation.past})` : ""}. ${cap(describeTrust(x.relation.trust))} what they say; ${x.relation.phone ? "you have their number" : "you don't have their number, so it has to be in person"}${x.talks && x.talks >= 2 ? `; you've already talked ${x.talks} times tonight` : ""}.`)
    .join("\n") || "(there's nobody you can reach right now)";
  const actions = ["none" as ActionKind, ...view.actions].map((a) => `- ${a}: ${ACTION_ZH[a]}`).join("\n");
  const inbox = view.inbox.map((m) => `- [${m.id}] ${inboxLine(m, view)}`).join("\n");
  const memory = view.memory.length ? view.memory.slice(-8).map((m) => `- ${m}`).join("\n") : "(nothing)";
  const events = view.publicEvents.length ? view.publicEvents.slice(-6).map((m) => `- ${m}`).join("\n") : "(you haven't heard of anything)";
  let s = `${promptOpening(view.clock, view.placeZh)}${whoLine(p)}${p.traits} What you care about: ${p.wants}${p.habit ? `
${SECTION.habit}
${p.habit} (This is what you usually tend to do, not something you have to do.)` : ""}${cardText(p.card)}
${SECTION.publicInfo}
${view.publicInfo}
${SECTION.know}
${know}
${SECTION.believe}
${beliefs}
${SECTION.remember}
${memory}
${SECTION.events}
${events}
${SECTION.inbox}
${inbox}
${SECTION.people}
${people}`;
  if (stage !== "read" && !opts.free) s += `\n${SECTION.can}\n${actions}`;
  if (stage === "act" && reading) {
    const lines = reading.output.claims.map((c, i) => `- #${i} ${c.statement} (your confidence ${reading.confidence[i]?.toFixed(2) ?? "0"})`).join("\n");
    s += `\n${SECTION.reading}\nYour understanding: ${reading.output.understanding}\nYour thought: ${reading.output.thought}\n${lines || "(no specific claim formed)"}${PROMPT_ENDINGS.act}`;
  } else s += PROMPT_ENDINGS.single;
  return s;
}

const FALLBACK: DecisionOutput = { understanding: "", claims: [], stances: [], feeling: "😶 frozen", thought: "(couldn't come to a decision)", actions: [{ type: "none", why: "fallback" }] };

/** Pull "feeling" and "act" out of a partly generated JSON answer, once both are complete. */
export function earlyReaction(text: string): { feeling: string; act: string } | null {
  const f = /"feeling"\s*:\s*"([^"]*)"/.exec(text);
  const a = /"act"\s*:\s*"([^"]*)"/.exec(text);
  return f && a ? { feeling: f[1], act: a[1] } : null;
}

/**
 * The signal every model call of one decision carries. It aborts when the player leaves the story (shouldStop,
 * checked every 250 ms) or when the decision's time budget is spent, which ends the call in flight, every retry
 * inside the chat client, and any wait between attempts here.
 */
function watchDecision(shouldStop: (() => boolean) | undefined, budgetMs: number) {
  const ac = new AbortController();
  const stopped = () => !!shouldStop?.();
  const check = () => {
    if (stopped()) ac.abort();
  };
  const poll = shouldStop ? setInterval(check, 250) : undefined;
  const timer = setTimeout(() => ac.abort(), budgetMs);
  check();
  return { signal: ac.signal, stopped, budgetMs, done: () => (clearInterval(poll), clearTimeout(timer)) };
}
type Watch = ReturnType<typeof watchDecision>;

async function ask(
  chat: Chat, messages: ChatMessage[], view: View, stage: "single" | "read" | "act", npcId: string, clock0: number, temperature: number,
  check: (o: DecisionOutput) => Checked, llm: LlmRecord[], validation: ValidationEntry[], watch: Watch,
  onEarly?: (x: { feeling: string; act: string }) => void,
): Promise<{ out: DecisionOutput; checked: Checked; refused?: MindResult["refused"] } | null> {
  let msgs = messages;
  let last: DecisionOutput | null = null;
  // two chances for the model to give a valid answer; provider outages get extra tries on top
  let modelFailures = 0;
  for (let attempt = 1; attempt <= 2 + Math.min(modelFailures, 3); attempt++) {
    // the player left the story, or this decision's time is spent: no more calls
    if (watch.signal.aborted) {
      validation.push({ attempt, stage, kind: "model", errors: [watch.stopped() ? "stopped: the player left the story" : `decision time budget spent (${watch.budgetMs / 1000} s)`] });
      break;
    }
    const start = Date.now() - clock0;
    let told = false;
    const r = await chat(msgs, {
      temperature,
      maxTokens: stage === "read" ? 700 : 1000,
      signal: watch.signal,
      // stream only when someone wants the early reaction; it is shown as a gesture, never as a decision
      onDelta: onEarly
        ? (text) => {
            if (told) return;
            const x = earlyReaction(text);
            if (x) {
              told = true;
              onEarly(x);
            }
          }
        : undefined,
    });
    llm.push({
      provider: r.provider, decision: "", npc: npcId, stage, wallStartMs: start, wallEndMs: Date.now() - clock0, latencyMs: r.latencyMs, attempts: r.attempts,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens, platformCost: r.platformCost, estCost: r.estCost,
      status: r.status, error: r.error, raw: r.content, promptChars: msgs.reduce((n, m) => n + m.content.length, 0), ttftMs: r.ttftMs,
    });
    if (r.status !== 200 || !r.content) {
      validation.push({ attempt, stage, kind: "model", errors: [`model error: ${r.error ?? r.status}`] });
      modelFailures++;
      await pause(8000, watch.signal);
      continue;
    }
    const parsed = parseJSON(r.content);
    const { out: rawOut, errors: shapeErrors } = coerce(parsed.value);
    const errors = parsed.error ? [parsed.error] : [...shapeErrors];
    let checked: Checked | null = null;
    const norm = rawOut ? normalize(view, rawOut) : null;
    const out = norm ? norm.out : null;
    if (out && !parsed.error) {
      checked = check(out);
      errors.push(...checked.errors);
    }
    validation.push({ attempt, stage, kind: errors.length ? "validator" : "ok", errors, notes: norm?.notes.length ? norm.notes : undefined });
    if (out && checked && errors.length === 0) return { out, checked };
    if (out && !parsed.error) last = out;
    msgs = [...msgs, { role: "assistant", content: r.content }, { role: "user", content: retryNote(errors) }];
  }
  // a story nobody is watching keeps nothing, not even a salvaged reading
  if (watch.stopped()) return null;
  // Out of tries. If the resident's reading of the situation was valid and only what they wanted to *do* broke a
  // rule (e.g. sending the police on one stranger's word), keep their real thinking, keep the actions that are
  // allowed, and record the refused ones as a visible beat — instead of replacing everything with "😶 frozen".
  if (last) {
    const none = [{ type: "none" as const, why: "refused" }];
    const reading = check({ ...last, actions: none });
    if (!reading.errors.length) {
      const keep: DecisionOutput["actions"] = [];
      const refused: NonNullable<MindResult["refused"]> = [];
      for (const a of last.actions) {
        if (a.type === "none") continue;
        const e = check({ ...last, actions: [a] }).errors;
        if (e.length) refused.push({ action: a, why: refusalGist(e) });
        else keep.push(a);
      }
      const out = { ...last, actions: keep.length ? keep : none };
      validation.push({ attempt: 0, stage, kind: "salvaged", errors: refused.map((r) => `${r.action.type}: ${r.why}`) });
      return { out, checked: check(out), refused };
    }
  }
  return null;
}

export interface DecideOptions {
  variant: Variant;
  temperature: number;
  clock0: number;
  onEarly?: (x: { feeling: string; act: string }) => void;
  /** true once the player has left the story: the call in flight is aborted and no further call is made */
  shouldStop?: () => boolean;
  /** this decision's whole time budget, both retry layers included (default DECISION_BUDGET_MS) */
  budgetMs?: number;
}

export async function decideWithGemma(view: View, chat: Chat, opts: DecideOptions): Promise<MindResult> {
  const watch = watchDecision(opts.shouldStop, opts.budgetMs ?? DECISION_BUDGET_MS);
  try {
    const res = await decideOnce(view, chat, opts, watch);
    return res.fallback && watch.stopped() ? { ...res, stopped: true } : res;
  } finally {
    watch.done();
  }
}

async function decideOnce(view: View, chat: Chat, opts: DecideOptions, watch: Watch): Promise<MindResult> {
  const llm: LlmRecord[] = [];
  const validation: ValidationEntry[] = [];
  const npcId = view.npc.id;
  const free = opts.variant === "free-actions";
  if (opts.variant !== "two-stage") {
    const msgs: ChatMessage[] = [
      { role: "system", content: systemPrompt(opts.variant, "single") },
      { role: "user", content: userPrompt(view, "single", undefined, { free }) },
    ];
    const res = await ask(chat, msgs, view, "single", npcId, opts.clock0, opts.temperature, (o) => checkDecision(view, free ? { ...o, actions: [] } : o, { requireActions: !free }), llm, validation, watch, opts.onEarly);
    if (!res) return { output: FALLBACK, checked: checkDecision(view, FALLBACK, { requireReading: false }), llm, validation, fallback: true };
    if (res.refused?.length) return { output: res.out, checked: res.checked, llm, validation, fallback: false, refused: res.refused };
    if (free) {
      // free-form actions are recorded for the experiment but never executed
      const freeActs = res.out.actions;
      const checkedFree = checkDecision(view, res.out);
      return { output: { ...res.out, actions: [{ type: "none", why: `free-form: ${freeActs.map((a) => a.type).join(" / ")}` }] }, checked: { ...res.checked, warnings: [...res.checked.warnings, ...checkedFree.errors.map((e) => `free action rejected: ${e}`)] }, llm, validation, fallback: false };
    }
    return { output: res.out, checked: res.checked, llm, validation, fallback: false };
  }
  // two-stage: read first, let the engine bound the confidences, then decide what to do
  const readMsgs: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.variant, "read") },
    { role: "user", content: userPrompt(view, "read") },
  ];
  const read = await ask(chat, readMsgs, view, "read", npcId, opts.clock0, opts.temperature, (o) => checkDecision(view, { ...o, actions: [] }, { requireActions: false }), llm, validation, watch);
  if (!read) return { output: FALLBACK, checked: checkDecision(view, FALLBACK, { requireReading: false }), llm, validation, fallback: true };
  const actMsgs: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.variant, "act") },
    { role: "user", content: userPrompt(view, "act", { output: read.out, confidence: read.checked.confidence }) },
  ];
  const act = await ask(chat, actMsgs, view, "act", npcId, opts.clock0, opts.temperature, (o) => checkDecision(view, { ...read.out, actions: o.actions }, { requireReading: true }), llm, validation, watch);
  if (!act && watch.stopped()) return { output: FALLBACK, checked: checkDecision(view, FALLBACK, { requireReading: false }), llm, validation, fallback: true };
  const actions = act ? act.out.actions : [{ type: "none" as const, why: "fallback" }];
  const output = { ...read.out, actions };
  return { output, checked: checkDecision(view, output), llm, validation, fallback: !act };
}
