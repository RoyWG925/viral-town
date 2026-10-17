// The small acting library: Gemma picks how a resident visibly reacts, the town plays it.
// Pure presentation — an act never changes the world, so a wrong pick is mapped, never rejected.
export const ACTS = {
  ponder: "stops, chin in hand, to think",
  doubt: "frowns, arms crossed (doubtful)",
  nervous: "glances around nervously",
  startled: "jumps back, startled",
  giggle: "giggles behind a hand",
  angry: "stamps a foot and shakes a fist (angry)",
  shrug: "shrugs (couldn't care less)",
  excited: "bounces with excitement",
  facepalm: "slaps own forehead (exasperated)",
  whisper: "leans in low, all secretive",
  worried: "wrings hands, can't keep still",
  determined: "clenches a fist, chest out (mind made up)",
} as const;
export type Act = keyof typeof ACTS;
export const ACT_IDS = Object.keys(ACTS) as Act[];
export const ACT_LIST = ACT_IDS.map((id) => `${id}=${ACTS[id]}`).join("; ");

/** When the model gives no usable act, read one off its feeling (English words, plus the Chinese of older logs). */
const BY_FEELING: [RegExp, Act][] = [
  [/😱|😨|😧|😲|😳|驚|嚇|shock|startl|surpris|scared|frighten|alarm|stunned/i, "startled"],
  [/😡|😠|😤|🤬|氣|怒|angry|anger|furious|\bmad\b|annoyed|irritat|outrag|livid|fuming/i, "angry"],
  [/😂|🤭|😏|😆|笑|好笑|amused|laugh|funny|giggl|chuckl|smirk|hilarious/i, "giggle"],
  [/🤔|🧐|想|疑惑|好奇|curious|puzzl|confus|wondering|thoughtful|thinking|pondering|unsure/i, "ponder"],
  [/🤨|😒|懷疑|不信|皺眉|doubt|skeptic|sceptic|suspicious|unconvinced|not convinced|disbelie|wary/i, "doubt"],
  [/😰|😟|😥|😬|擔心|不安|緊張|慌|worr|anxious|uneasy|nervous|panic|tense|concerned|afraid/i, "worried"],
  [/🤩|😍|🥳|興奮|期待|開心|excit|thrill|eager|\bhappy|delight|\bglad\b|cheerful/i, "excited"],
  [/🙄|😑|😐|無所謂|不在意|聳|indifferent|whatever|unbothered|shrug|bored|\bmeh\b|don't care/i, "shrug"],
  [/🤦|無奈|傻眼|exasperat|helpless|speechless|facepalm|resigned|fed up/i, "facepalm"],
  [/🤫|秘密|神秘|secret|sneaky|mysterious|hush|\bsly\b/i, "whisper"],
  [/💪|決心|堅定|氣勢|determin|resolute|resolved|\bfirm\b|fired up|steely/i, "determined"],
];
export function actFrom(act: unknown, feeling: string): Act {
  if (typeof act === "string" && act in ACTS) return act as Act;
  for (const [re, a] of BY_FEELING) if (re.test(feeling ?? "")) return a;
  return "ponder";
}
/** Acts that make someone hurry or dawdle on the way to what they decided to do. */
export const HURRY: Act[] = ["startled", "angry", "excited", "worried", "determined"];
export const DAWDLE: Act[] = ["shrug", "doubt"];
