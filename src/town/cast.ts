// Who is who in the everyday town, and every word the everyday scenes (鎮上日常) may say.
// Pure data with no imports, so lab/test-vignettes.ts can vet all of it in node: no story topic, no FACTS keyword,
// no story-reaction emoji. Secrets are never spoken here; at most they are mimed (an emoji, a wobble).

/** Which crowd post plays each core resident. director.ts keeps the same table (it should import this one). */
export const NPC_POST: Record<string, string> = {
  baker: "bakery", florist: "flower", journalist: "news", cafe: "cafe", police: "police", mayor: "townhall", organizer: "stage", vendor: "stall-2",
};
export const CORE_POSTS = new Set(Object.values(NPC_POST));
export const isCorePost = (post: string | null) => !!post && CORE_POSTS.has(post);

/**
 * Emoji the playback director uses for story beats and world changes (a delivery ❗, a passer-by noticing a talk 👀,
 * a statement 📣, a notice 📋…). Ambient pools never use them, so a background chat can't be misread as the rumour.
 */
export const STORY_EMOJI = ["❗", "😮", "👀", "👂", "💭", "📞", "📣", "📋", "📰", "✊", "🚓", "🔍", "🚧", "🔒", "📱"];

/** What each shopkeeper shows now and then at their door: their own little character, not a generic wave. */
export const DOOR_EMOJI: Record<string, string[]> = {
  bakery: ["🥐", "🍞", "😄", "👋"], // 阿德: chatty, waves at everyone
  flower: ["🌷", "💐", "🌸", "🐱"], // 美玲: flowers and animals
  news: ["📸", "📝", "🧐", "☕"], // 小雯: always on the lookout
  cafe: ["☕", "🍰", "😊", "🎶"], // 美咲: the hostess
  police: ["🫡", "🧐", "⌚", "☕"], // 老周: on duty, never quite relaxed
  townhall: ["🎩", "😁", "👋", "📜"], // 林市長: the public smile
  stage: ["⏰", "💦", "😤", "🏮"], // 志明: in a hurry, always
  "stall-2": ["🐙", "🔥", "💪", "😆"], // 阿珠: loud and proud
  "stall-0": ["🌽", "🔥", "😊"],
  "stall-1": ["🍬", "🌈", "😊"],
  "stall-3": ["🐟", "🧊", "😊"],
  "stall-4": ["🍊", "🍎", "😊"],
  books: ["📚", "🤓", "☕"],
  ramen: ["🍜", "🔥", "😋"],
  mart: ["🛒", "🍙", "😊"],
  seafood: ["🦐", "🐟", "😊"],
};
export const DOOR_EMOJI_DEFAULT = ["👋", "😊", "✨"];

/** Background chats: what one neighbour says and what the other answers about 0.8 s later. */
export const CHAT_PAIRS: [string, string][] = [
  ["🏮", "🎉"], ["🐙", "😋"], ["🌇", "😌"], ["🐱", "🥰"], ["⚓", "🐟"], ["💬", "😂"], ["🤔", "💡"], ["🎶", "😆"], ["☕", "😊"], ["🎈", "🤩"],
];

/**
 * Ticker labels (shown in the "Everyday life" line, emoji first) and the short lines the scenes speak.
 * A label also follows "Meanwhile, " in the director's cutaway (vignettes.ts meanwhileScene lowercases a leading
 * "A"/"Two"/"Neighbors"), so each one reads as a clause: a name or a plain subject, then what they are doing.
 */
export const SCENE_TEXT = {
  stageRush: { label: "🏮 Gus is rushing the stage crew", hurry: "Hurry up! We start at eight!", oops: "It's fine, it's fine! Don't touch!" },
  haggle: { label: "🐙 Rosa is griping about the stall fee", hawk: "Takoyaki! Hot off the griddle!", ask: "Can you go a little cheaper?", fee: "My stall fee doubled! Cheaper? Ha!" },
  samples: { label: "🥐 Barney is handing out samples", offer: "Just baked! Have a taste!", chatter: "Let me tell you, back in my day…", follow: "Hey, wait, I'm not finished…" },
  patrol: { label: "👮 Chief Harlow is on patrol", scold: "No running on the plaza!" },
  catChase: { label: (cat: string) => `🐱 A kid is chasing ${cat}` },
  bicker: {
    bike: { label: "🚲 Two neighbors are arguing over a bike", a: "Your bike's blocking my door again!", b: "No way! That's your bike!", truce: "Fine, fine, I'll move it." },
    pot: { label: "🪴 Neighbors squabble over a flowerpot", a: "Your flowerpot's in the road again!", b: "The cat pushed it!", truce: "…Fine. Let's move it together." },
    bench: { label: "🪑 Two old-timers both want the bench", a: "I was sitting here first!", b: "I don't see your name on it!", truce: "Fine. Half each." },
  },
  gossip: {
    label: "☕ Molly's whispering to customers again",
    // neutral small talk only: dating, weather, a cute dog, her daughter's turn on stage (all public)
    topics: ["Psst, I hear the bookshop owner is seeing someone!", "They say it'll be sunny tomorrow.", "That corgi in the park got even chubbier!", "My daughter's on stage tonight. Come watch!"],
  },
  speech: { label: "🎩 The mayor rehearses a speech", open: "Ladies and gentlemen of Mistport…", lost: "Tonight… um… which page was I on?" },
};
