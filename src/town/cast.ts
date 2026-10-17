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

/** Ticker labels (shown in the 「日常」 line, emoji first) and the short lines the scenes speak. */
export const SCENE_TEXT = {
  stageRush: { label: "🏮 志明在舞台邊催工人趕工", hurry: "快一點！八點就要開始了！", oops: "沒事沒事！別碰！" },
  haggle: { label: "🐙 阿珠又在跟客人抱怨攤位費", hawk: "章魚燒！剛起鍋！", ask: "算便宜一點嘛？", fee: "攤位費漲一倍，怎麼便宜！" },
  samples: { label: "🥐 阿德在門口發試吃，話匣子關不起來", offer: "剛出爐！試吃看看！", chatter: "跟你們說喔，我年輕的時候…", follow: "欸欸，還沒說完…" },
  patrol: { label: "👮 老周在廣場慢慢巡邏", scold: "廣場上別用跑的！" },
  catChase: { label: (cat: string) => `🐱 有個小孩在追${cat}` },
  bicker: {
    bike: { label: "🚲 兩個鄰居為了腳踏車吵起來了", a: "腳踏車又擋到我家門口！", b: "哪有！明明是你的！", truce: "好啦好啦，我牽走。" },
    pot: { label: "🪴 鄰居為了一盆花在拌嘴", a: "你家花盆又擺到路中間了！", b: "那是貓推的啦！", truce: "…好啦，一起搬。" },
    bench: { label: "🪑 兩位老鄰居在搶長椅", a: "這是我先坐的！", b: "上面又沒寫你的名字！", truce: "好啦，一人一半。" },
  },
  gossip: {
    label: "☕ 美咲又在跟客人說悄悄話",
    // neutral small talk only: dating, weather, a cute dog, her daughter's turn on stage (all public)
    topics: ["欸，聽說書店老闆在跟人約會！", "明天好像會出大太陽喔。", "公園那隻柯基又胖了一圈！", "我女兒今晚要上台，記得來看！"],
  },
  speech: { label: "🎩 林市長在鎮公所前練習演講", open: "各位鄉親父老…", lost: "今晚呢…呃…第幾頁？" },
};
