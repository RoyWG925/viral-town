// What /api/gemma forwards with the project key: only the game's own resident decisions. The system message must
// be exactly one of the prompts mind.ts sends; the user message must have the shape of mind.ts userPrompt (its
// fixed opening at one of the town's places, a real resident, its section headings in order, one of its two endings);
// after that, only the validator's retry turns: the model's answer, then the correction. Every marker here comes from
// mind.ts itself, so the guard and the prompt cannot drift apart. Pure, so it is tested without a server.
import type { ChatMessage } from "./llm.ts";
import { PROMPT_ENDINGS, REQUIRED_SECTIONS, RETRY_HEAD, RETRY_TAIL, SYSTEM_PROMPTS, promptOpening, whoLine } from "./mind.ts";
import { PERSONAS, PLACES } from "./scenario.ts";

/** system + user + at most two retry pairs (mind.ts sends at most one) */
export const MAX_TURNS = 6;
/**
 * all messages together. The English prompts run about 2.3× the Chinese ones (the longest Chinese request on record
 * in lab/runs was under 6,000): a fake run with every field at its cap and every first answer sent back peaked at
 * about 23,300 (system about 6,000, resident's prompt up to 14,500, plus the retry), so this keeps 2× headroom.
 */
export const MAX_CHARS = 48_000;
const MAX_ANSWER = 8_000;
const MAX_NOTE = 6_000;

const ENDINGS = Object.values(PROMPT_ENDINGS);
const CLOCK = /^\d{2}:\d{2}$/;
// where the clock sits in the opening line, read off the opening itself
const CLOCK_AT = promptOpening("\u0000", "").indexOf("\u0000");

/** Length of the prompt's opening (clock, one of the town's places, the "Who you are" heading), or -1. */
function openingLength(s: string): number {
  const clock = s.slice(CLOCK_AT, CLOCK_AT + 5);
  if (!CLOCK.test(clock)) return -1;
  for (const p of PLACES) for (const name of [p.zh, p.id]) {
    const open = promptOpening(clock, name);
    if (s.startsWith(open)) return open.length;
  }
  return -1;
}

/** Does this read like userPrompt() wrote it for one of the town's residents? */
function isResidentPrompt(s: string): boolean {
  let at = openingLength(s);
  if (at < 0 || !ENDINGS.some((e) => s.endsWith(e))) return false;
  if (!PERSONAS.some((p) => s.startsWith(whoLine(p), at))) return false;
  for (const h of REQUIRED_SECTIONS) {
    const i = s.indexOf(`\n${h}\n`, at);
    if (i < 0) return false;
    at = i + h.length + 1;
  }
  return true;
}

/** null when the game itself sends exactly this; otherwise a short reason for the 400. */
export function checkGameMessages(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > MAX_TURNS || messages.length % 2) return "bad messages";
  if (!messages.every((m) => m && typeof m === "object" && ["system", "user", "assistant"].includes(m.role) && typeof m.content === "string")) return "bad messages";
  const ms = messages as ChatMessage[];
  if (ms.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return "too long";
  if (ms[0].role !== "system" || !SYSTEM_PROMPTS.includes(ms[0].content)) return "not the game's system prompt";
  if (ms[1].role !== "user" || !isResidentPrompt(ms[1].content)) return "not a resident's decision";
  for (let i = 2; i < ms.length; i += 2) {
    const [answer, note] = [ms[i], ms[i + 1]];
    if (answer.role !== "assistant" || answer.content.length > MAX_ANSWER) return "not a validator retry";
    if (note.role !== "user" || note.content.length > MAX_NOTE || !note.content.startsWith(RETRY_HEAD) || !note.content.endsWith(RETRY_TAIL)) return "not a validator retry";
  }
  return null;
}
