// The small acting library: Gemma picks how a resident visibly reacts, the town plays it.
// Pure presentation — an act never changes the world, so a wrong pick is mapped, never rejected.
export const ACTS = {
  ponder: "停下來托著下巴想",
  doubt: "皺眉、雙手抱胸（懷疑）",
  nervous: "緊張地四處張望",
  startled: "嚇一跳往後退",
  giggle: "掩嘴偷笑",
  angry: "生氣跺腳、揮拳",
  shrug: "聳聳肩（不在意）",
  excited: "興奮地蹦跳",
  facepalm: "拍額頭（無奈）",
  whisper: "壓低身子、神秘兮兮",
  worried: "搓著手、坐立不安",
  determined: "握拳、挺起胸（下定決心）",
} as const;
export type Act = keyof typeof ACTS;
export const ACT_IDS = Object.keys(ACTS) as Act[];
export const ACT_LIST = ACT_IDS.map((id) => `${id}=${ACTS[id]}`).join("、");

/** When the model gives no usable act, read one off its feeling. */
const BY_FEELING: [RegExp, Act][] = [
  [/😱|😨|😧|😲|😳|驚|嚇/, "startled"],
  [/😡|😠|😤|🤬|氣|怒/, "angry"],
  [/😂|🤭|😏|😆|笑|好笑/, "giggle"],
  [/🤔|🧐|想|疑惑|好奇/, "ponder"],
  [/🤨|😒|懷疑|不信|皺眉/, "doubt"],
  [/😰|😟|😥|😬|擔心|不安|緊張|慌/, "worried"],
  [/🤩|😍|🥳|興奮|期待|開心/, "excited"],
  [/🙄|😑|😐|無所謂|不在意|聳/, "shrug"],
  [/🤦|無奈|傻眼/, "facepalm"],
  [/🤫|秘密|神秘/, "whisper"],
  [/💪|決心|堅定|氣勢/, "determined"],
];
export function actFrom(act: unknown, feeling: string): Act {
  if (typeof act === "string" && act in ACTS) return act as Act;
  for (const [re, a] of BY_FEELING) if (re.test(feeling ?? "")) return a;
  return "ponder";
}
/** Acts that make someone hurry or dawdle on the way to what they decided to do. */
export const HURRY: Act[] = ["startled", "angry", "excited", "worried", "determined"];
export const DAWDLE: Act[] = ["shrug", "doubt"];
