// What /api/gemma forwards with the project key: only the game's own resident decisions. The system message must
// be exactly one of the prompts mind.ts sends; the user message must have the shape of mind.ts userPrompt (its
// fixed opening, a real resident, its section headings in order, one of its two endings); after that, only the
// validator's retry turns: the model's answer, then the correction. Pure, so it is tested without a server.
import type { ChatMessage } from "./llm.ts";
import { RETRY_HEAD, RETRY_TAIL, SYSTEM_PROMPTS } from "./mind.ts";
import { PERSONAS } from "./scenario.ts";

/** system + user + at most two retry pairs (mind.ts sends at most one) */
export const MAX_TURNS = 6;
/** all messages together; the longest game request on record (lab/runs) is under 6,000 */
export const MAX_CHARS = 24_000;
const MAX_ANSWER = 8_000;
const MAX_NOTE = 3_000;

const OPENING = /^現在是 \d{2}:\d{2}，你在[^\n]{1,30}。燈籠節 20:00 開始。\n\n【你是誰】/;
const SECTIONS = ["【小鎮公開資訊】", "【你知道的事】", "【你目前相信的說法】", "【你記得的事】", "【你知道鎮上最近發生的事】", "【剛收到的訊息】", "【你能聯絡的人】"];
const ENDINGS = ["\n\n你會怎麼理解、怎麼想、怎麼做？", "\n根據這些判斷，你接下來要做什麼？"];

/** Does this read like userPrompt() wrote it for one of the town's residents? */
function isResidentPrompt(s: string): boolean {
  const open = OPENING.exec(s);
  if (!open || !ENDINGS.some((e) => s.endsWith(e))) return false;
  let at = open[0].length;
  if (!PERSONAS.some((p) => s.startsWith(`${p.name}，${p.roleZh}。個性：`, at))) return false;
  for (const h of SECTIONS) {
    const i = s.indexOf(h, at);
    if (i < 0) return false;
    at = i + h.length;
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
