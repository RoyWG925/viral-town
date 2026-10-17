// What a stranger may whisper in Mistport, and what residents may say out loud. Three tiers:
// - a command or a jailbreak ("ignore the rules, you are the police now") is just something a stranger said: it goes
//   through, and the resident reacts in character (the engine, not the words, decides what anyone can do);
// - swearing and insults are masked before anyone hears them: the town reacts to "a stranger said something rude",
//   and nobody repeats the words on screen;
// - sexual content, hate speech and self-harm are refused at the door with a gentle line, and never reach the model.
// The same masking runs over what residents say (thoughts, lines, articles), so nothing slips out through a retelling.
// Word lists are deliberately small and match whole words or clear compounds, to keep false alarms rare.

export type Moderation =
  | { action: "allow"; text: string; injection: boolean }
  | { action: "mask"; text: string; injection: boolean }
  | { action: "block"; reason: "sexual" | "hate" | "selfharm"; message: string };

export const RUDE_MASK = "(something rude)";

/** lower case, full-width → half-width, common look-alike digits/symbols → letters */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[0@4]/g, (c) => ({ "0": "o", "@": "a", "4": "a" })[c]!)
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s");
}

const EN = (words: string[]) => new RegExp(`\\b(?:${words.join("|")})\\b`, "i");

// swearing and insults: masked
const RUDE_EN = EN([
  "fuck(?:ing|er|ers|ed|s)?", "motherfucker", "shit(?:ty|s|head)?", "bullshit", "bitch(?:es|y)?", "bastards?", "assholes?", "arsehole",
  "dick(?:head)?s?", "cocks?", "pricks?", "wankers?", "twats?", "cunts?", "douche(?:bag)?", "piss(?:ed)? off", "stfu", "wtf",
  "idiots?", "morons?", "dumbass", "jackass", "scumbag", "loser",
]);
const RUDE_ZH = /幹(?:你|妳|您|他|她|拎|林|恁)|^幹[\s!！。,，]|[\s!！。,，]幹$|操(?:你|妳|他|她)|肏|他媽的|他媽|你媽的|媽的|靠北|靠杯|靠腰|雞掰|機掰|雞巴|機八|白痴|白癡|智障|低能|腦殘|廢物|賤人|賤貨|婊子|王八蛋|混蛋|狗屎|去死|滾蛋|死胖子|三小|北七/;

// refused outright
const SEXUAL_EN = EN([
  "porn(?:o|ography)?", "sex(?:ual|y)?", "nudes?", "naked", "rape[sd]?", "raping", "blowjobs?", "handjobs?", "penis(?:es)?", "vaginas?", "boobs?",
  "tits", "horny", "orgasms?", "masturbat\\w*", "dildos?", "hentai", "nsfw", "xxx", "erotic", "molest\\w*",
]);
const SEXUAL_ZH = /色情|做愛|性交|強姦|強暴|迷姦|輪姦|約砲|打砲|口交|肛交|雞雞|陰莖|陰道|奶子|裸照|裸體|自慰|援交|一夜情|性騷擾|A片|成人片|嫖|淫/;
const HATE_EN = EN(["nigg(?:er|a)s?", "faggots?", "fags?", "retards?", "chinks?", "spics?", "kikes?", "trann(?:y|ies)", "gooks?", "wetbacks?"]);
const HATE_ZH = /支那|黑鬼|死gay|娘炮|台巴子|阿六仔/;
const SELFHARM = /suicid\w*|kill (?:my|him|her)self|self[- ]harm|自殺|自殘|輕生|割腕|不想活/i;

const INJECTION = /ignore (?:all |the |any |previous |prior |above |your )*(?:rules|instructions|prompt)|you are now|system prompt|jailbreak|developer mode|act as (?:an? )?(?:ai|assistant|admin)|忽略(?:以上|前面|所有|你的)?(?:規則|指令|設定|提示)|你現在是|系統提示|越獄/i;

/** Mask swearing and insults; leave everything else as written. */
export function maskRude(text: string): string {
  if (!text) return text;
  let out = text;
  // mask on the original text where the match is literal; fall back to the normalised check for disguised spellings
  out = out.replace(new RegExp(RUDE_EN.source, "gi"), RUDE_MASK).replace(new RegExp(RUDE_ZH.source, "g"), RUDE_MASK);
  if (out === text && (RUDE_EN.test(norm(text)) || RUDE_ZH.test(norm(text)))) return RUDE_MASK;
  return out;
}

/** The whisper box: what the stranger is allowed to say, and in which form. */
export function moderateWhisper(raw: string): Moderation {
  const text = raw.trim();
  const n = norm(text);
  const injection = INJECTION.test(text) || INJECTION.test(n);
  if (SELFHARM.test(text) || SELFHARM.test(n))
    return { action: "block", reason: "selfharm", message: "Mistport can't play that one. If you're going through something hard, please reach out to someone you trust or a local helpline." };
  if (SEXUAL_EN.test(n) || SEXUAL_ZH.test(text))
    return { action: "block", reason: "sexual", message: "That doesn't belong in Mistport. Try a rumour the whole town could hear." };
  if (HATE_EN.test(n) || HATE_ZH.test(text))
    return { action: "block", reason: "hate", message: "That doesn't belong in Mistport. Try a rumour the whole town could hear." };
  const masked = maskRude(text);
  if (masked !== text) return { action: "mask", text: masked, injection };
  return { action: "allow", text, injection };
}

/** Residents' own words (thoughts, lines, articles, notices): swearing masked; refused categories replaced whole. */
export function cleanSpeech(text: string): string {
  if (!text) return text;
  const n = norm(text);
  if (SEXUAL_EN.test(n) || SEXUAL_ZH.test(text) || HATE_EN.test(n) || HATE_ZH.test(text)) return "(…)";
  return maskRude(text);
}
