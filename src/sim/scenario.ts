// Scenario 1: the evening of the lantern festival in Mistport.
// Truth lives in FACTS (some true, some false). Each persona knows a few of them; secrets are known
// by one person only. Topics are the public questions a claim can be about; listing a topic says
// nothing about whether its answer is yes or no.
import type { Fact, Persona, Place, WorldState } from "./types.ts";

export const PLACES: Place[] = [
  { id: "bakery", zh: "阿德麵包店", en: "Ade's Bakery", spot: "bakery" },
  { id: "flower", zh: "美玲花店", en: "Meiling's Flowers", spot: "flower" },
  { id: "news", zh: "霧港新聞社", en: "Mistport News", spot: "news" },
  { id: "cafe", zh: "咖啡廳", en: "Café", spot: "cafe" },
  { id: "police", zh: "警察局", en: "Police station", spot: "police" },
  { id: "townhall", zh: "鎮公所", en: "Town hall", spot: "townhall" },
  { id: "plaza", zh: "中央廣場（布告欄旁）", en: "Central plaza (notice board)", spot: "plaza" },
  { id: "stage", zh: "慶典舞台", en: "Festival stage", spot: "stage" },
  { id: "stall", zh: "章魚燒攤", en: "Takoyaki stall", spot: "stall" },
  { id: "harbour", zh: "港口", en: "Harbour", spot: "harbour" },
];

/** Public yes/no questions a claim can be about. `fact` is the engine's answer key (never shown). */
export const TOPICS: { id: string; q: string; fact: string | null }[] = [
  { id: "festival_on", q: "今晚的燈籠節會照常舉行嗎？", fact: "festival" }, // the public schedule (soft: it can still be cancelled)
  { id: "pigeons_release", q: "開場會放飛白鴿嗎？", fact: "pigeons" },
  { id: "mayor_fears_pigeons", q: "市長是不是很怕鴿子？", fact: "mayor_pigeons" },
  { id: "pigeons_sick", q: "慶典的鴿子是不是生病或有傳染病？", fact: "pigeons_sick" },
  { id: "stage_unsafe", q: "慶典舞台是不是有安全問題？", fact: "stage_uninspected" },
  { id: "lanterns_flammable", q: "燈籠是不是劣質、容易著火？", fact: "lanterns_unsafe" },
  { id: "budget_overrun", q: "燈籠節的經費是不是出了問題？", fact: "budget_overrun" },
  { id: "mayor_embezzled", q: "市長是不是私吞或挪用了公款？", fact: "mayor_embezzled" },
  { id: "fee_covers_budget", q: "攤位費漲價是不是跟鎮公所的財務狀況有關？", fact: "fee_for_budget" },
  { id: "police_short", q: "今晚維持秩序的警察夠不夠？（回答 yes 表示不夠）", fact: "police_half" },
  { id: "oven_unsafe", q: "麵包店的烤箱是不是有安全問題？", fact: "oven_expired" },
  { id: "threat", q: "是不是有人要在慶典上搞破壞或傷害別人？", fact: "threat" },
  { id: "birds_banned", q: "鎮上是不是要禁止養鳥或餵鴿子？", fact: "bird_ban" },
  { id: "other", q: "以上都不是（其他事情或無法歸類）", fact: null },
];

/** The engine's category for each topic: big-action gates use this, not the model's own label. */
export const TOPIC_CATEGORY: Record<string, import("./types.ts").Category> = {
  festival_on: "event", pigeons_release: "event", mayor_fears_pigeons: "personal", pigeons_sick: "health", stage_unsafe: "safety",
  lanterns_flammable: "safety", budget_overrun: "scandal", mayor_embezzled: "scandal", fee_covers_budget: "policy", police_short: "safety",
  oven_unsafe: "safety", threat: "crime", birds_banned: "policy",
};

export const FACTS: Fact[] = [
  { id: "festival", zh: "今晚 20:00 在中央廣場舉行燈籠節。", value: true, keywords: [], public: true, soft: true },
  {
    id: "pigeons", zh: "燈籠節開場會放飛 100 隻白鴿。", value: true, keywords: [], public: true,
    check: { place: "stage", by: "look", zh: "舞台旁邊堆著二十個鴿籠，裡面的白鴿看起來很健康。" },
  },
  { id: "stall_fee", zh: "今年慶典的攤位費漲了一倍。", value: true, keywords: [], public: true },
  { id: "mayor_pigeons", zh: "市長很怕鴿子。", value: false, keywords: [], notZh: "市長其實一點都不怕鴿子。" },
  {
    id: "pigeons_sick", zh: "慶典的鴿子生病了。", value: false, keywords: [], notZh: "慶典的鴿子都很健康，沒有生病。",
    check: { place: "stage", by: "look", zh: "鴿籠裡的白鴿羽毛乾淨、精神很好，看不出生病的樣子。" },
  },
  {
    id: "stage_uninspected", zh: "舞台是趕工搭的，還沒做結構安全檢查。", value: true, keywords: ["結構檢查", "結構安全", "舞台沒有安全檢查", "舞台沒做安全檢查", "舞台還沒檢查", "舞台沒檢查"],
    check: { place: "stage", by: "expert", roles: ["police", "organizer"], zh: "舞台沒有任何安全檢查紀錄，左後方的一根支架明顯鬆動。" },
  },
  {
    id: "lanterns_unsafe", zh: "燈籠是劣質品，容易著火。", value: false, keywords: [], notZh: "燈籠都是合格的防火材質，不容易著火。",
    check: { place: "stage", by: "look", zh: "燈籠上貼著防火材質的合格標籤。" },
  },
  {
    id: "budget_overrun", zh: "燈籠節的預算超支了三成。", value: true, keywords: ["超支", "三成"],
    check: { place: "townhall", by: "expert", roles: ["journalist"], zh: "公開的慶典收支表上，實際支出比原本的預算多了三成。" },
  },
  { id: "mayor_embezzled", zh: "市長私吞了慶典的公款。", value: false, keywords: [], notZh: "市長沒有私吞任何慶典的公款。" },
  { id: "fee_for_budget", zh: "攤位費漲價是為了補預算超支的洞。", value: true, keywords: ["補預算", "填預算的洞", "補預算的洞"] },
  { id: "police_half", zh: "今晚的警力只有平常的一半。", value: true, keywords: ["警力只有一半", "一半的警力", "警力只有平常", "警力不到一半"] },
  {
    id: "oven_expired", zh: "麵包店烤箱的安全檢查已經過期兩個月。", value: true, keywords: ["烤箱的安全檢查", "烤箱檢查過期", "烤箱過期", "檢查已經過期", "檢查過期"],
    check: { place: "bakery", by: "expert", roles: ["police"], zh: "烤箱的安全檢查貼紙日期是兩個月前，已經過期。" },
  },
  { id: "florist_guilt", zh: "美玲私下覺得放鴿子很殘忍，但收了主辦人的錢負責佈置鴿籠。", value: true, keywords: ["收了主辦人的錢", "收錢佈置鴿籠"] },
  { id: "blog_failing", zh: "小雯的新聞部落格快撐不下去了，急需流量。", value: true, keywords: ["部落格快撐不下去", "部落格快倒", "急需流量", "部落格撐不下去"] },
  { id: "cafe_daughter", zh: "咖啡廳老闆美咲的女兒今晚要在舞台上表演。", value: true, keywords: [] },
  { id: "threat", zh: "有人計畫在慶典上搞破壞。", value: false, keywords: [], notZh: "沒有人計畫在慶典上搞破壞。" },
  { id: "bird_ban", zh: "鎮公所打算禁止養鳥或餵鴿子。", value: false, keywords: [], notZh: "鎮公所沒有打算禁止養鳥或餵鴿子。" },
];

export const PUBLIC_INFO = "今晚 20:00 中央廣場舉行燈籠節，開場會放飛 100 隻白鴿；今年攤位費漲了一倍，不少攤商有怨言。";

const rel = (trust: number, phone: boolean, zh: string) => ({ trust, phone, zh });

export const PERSONAS: Persona[] = [
  {
    id: "baker", name: "阿德", role: "baker", roleZh: "麵包店老闆", home: "bakery",
    traits: "老實、熱心、話很多，一緊張就忍不住找人說。", wants: "生意好、和鄰居和睦，不想惹麻煩。",
    credulity: 0.7, talkative: 0.85, knows: ["festival", "pigeons", "stall_fee", "oven_expired"], secrets: ["oven_expired"],
    relations: {
      florist: rel(0.8, true, "隔壁鄰居，天天聊天"), cafe: rel(0.7, true, "每天早上送麵包給她"), vendor: rel(0.6, false, "攤商朋友"),
      mayor: rel(0.5, false, "常來買麵包的客人"), journalist: rel(0.45, false, "認識但不熟"),
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "florist", name: "美玲", role: "florist", roleZh: "花店老闆", home: "flower",
    traits: "溫柔、細心、很愛護動物，容易自責，也容易把事情往壞處想。", wants: "慶典的花飾漂亮，動物不要受到傷害。",
    credulity: 0.5, talkative: 0.6, knows: ["festival", "pigeons", "stall_fee", "florist_guilt", "cafe_daughter", "pigeons_sick"], secrets: ["florist_guilt"],
    relations: {
      baker: rel(0.8, true, "隔壁鄰居，天天聊天"), journalist: rel(0.65, true, "高中同學"), organizer: rel(0.5, true, "生意往來，她負責佈置鴿籠"),
      cafe: rel(0.6, true, "常一起喝咖啡"), mayor: rel(0.4, false, "只在活動上見過"),
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "journalist", name: "小雯", role: "journalist", roleZh: "記者（經營鎮上的新聞部落格）", home: "news",
    traits: "好奇、敏銳、愛追根究柢，寫東西喜歡下聳動的標題。", wants: "拿到獨家，讓部落格的流量救回來。",
    credulity: 0.55, talkative: 0.8, knows: ["festival", "pigeons", "stall_fee", "blog_failing"], secrets: ["blog_failing"],
    relations: {
      florist: rel(0.65, true, "高中同學"), cafe: rel(0.5, true, "咖啡廳常客"), vendor: rel(0.5, true, "常幫攤商發聲"),
      police: rel(0.35, false, "常被他擋消息"), mayor: rel(0.2, false, "常寫市長的負面新聞"), organizer: rel(0.4, false, "採訪過幾次"),
    },
    actions: ["publish_article", "inspect"],
  },
  {
    id: "mayor", name: "林市長", role: "mayor", roleZh: "市長", home: "townhall",
    traits: "愛面子、圓滑，最怕出事被追究，討厭被人看笑話。", wants: "燈籠節順利舉辦、順利連任，不讓預算超支曝光。",
    credulity: 0.3, talkative: 0.4, knows: ["festival", "pigeons", "stall_fee", "budget_overrun", "fee_for_budget", "mayor_pigeons", "mayor_embezzled", "bird_ban"], secrets: ["budget_overrun", "fee_for_budget"],
    relations: {
      organizer: rel(0.7, true, "下屬兼老同學"), police: rel(0.8, true, "多年的搭檔"), journalist: rel(0.2, false, "老是寫他負面新聞"),
      baker: rel(0.5, false, "常去買麵包"), vendor: rel(0.3, false, "最近為了攤位費吵過"), cafe: rel(0.5, false, "鎮上的熟面孔"),
    },
    actions: ["public_statement", "cancel_festival"],
  },
  {
    id: "organizer", name: "志明", role: "organizer", roleZh: "燈籠節主辦人", home: "stage",
    traits: "好大喜功、急躁，出了問題第一個想到的是撇清責任。", wants: "燈籠節風風光光，不被追究任何責任。",
    credulity: 0.5, talkative: 0.6, knows: ["festival", "pigeons", "stall_fee", "stage_uninspected", "fee_for_budget", "lanterns_unsafe", "pigeons_sick"], secrets: ["stage_uninspected", "fee_for_budget"],
    relations: {
      mayor: rel(0.7, true, "上司兼老同學"), florist: rel(0.5, true, "請她佈置鴿籠"), police: rel(0.5, true, "活動要找他維持秩序"),
      vendor: rel(0.3, false, "攤商老是跟他抱怨攤位費"), journalist: rel(0.3, false, "怕她亂寫"),
    },
    actions: ["inspect", "post_notice", "close_stage"],
  },
  {
    id: "police", name: "老周", role: "police", roleZh: "警長", home: "police",
    traits: "謹慎、正直，對任何可能的威脅都很緊張，寧可多做也不要出事。", wants: "今晚平安無事。",
    credulity: 0.45, talkative: 0.3, knows: ["festival", "pigeons", "stall_fee", "police_half"], secrets: ["police_half"],
    relations: {
      mayor: rel(0.8, true, "多年的搭檔"), cafe: rel(0.7, true, "老朋友，每天去她店裡喝咖啡"), organizer: rel(0.5, true, "活動要互相配合"),
      journalist: rel(0.35, false, "老是想套他的話"),
    },
    actions: ["dispatch_police", "inspect", "close_stage"],
  },
  {
    id: "cafe", name: "美咲", role: "cafe", roleZh: "咖啡廳老闆", home: "cafe",
    traits: "熱情、愛聊八卦，非常護女兒。", wants: "女兒今晚的表演順利，店裡生意好。",
    credulity: 0.6, talkative: 0.9, knows: ["festival", "pigeons", "stall_fee", "cafe_daughter"], secrets: [],
    relations: {
      police: rel(0.7, true, "老朋友"), baker: rel(0.7, true, "每天幫她送麵包"), florist: rel(0.6, true, "常一起喝咖啡"),
      journalist: rel(0.5, true, "店裡常客"), mayor: rel(0.45, false, "鎮上的熟面孔"),
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "vendor", name: "阿珠", role: "vendor", roleZh: "章魚燒攤老闆（攤商代表）", home: "stall",
    traits: "直爽、嗓門大、正義感強，對鎮公所一肚子火。", wants: "攤位費降回來，今晚生意好。",
    credulity: 0.65, talkative: 0.8, knows: ["festival", "pigeons", "stall_fee"], secrets: [],
    relations: {
      baker: rel(0.6, false, "攤商朋友"), journalist: rel(0.55, true, "常幫攤商發聲"), mayor: rel(0.2, false, "為了攤位費吵過"),
      organizer: rel(0.3, false, "收攤位費的人"),
    },
    actions: ["rally", "close_shop", "open_shop"],
  },
];

/** Default relation between two townsfolk who are not close. */
export const STRANGER = rel(0.35, false, "點頭之交");
/** Trust a person gives to something they overheard from someone they don't know. */
export const UNKNOWN_TRUST = 0.3;

export function initialWorld(): WorldState {
  return {
    festival: "scheduled",
    shops: { bakery: "open", flower: "open", cafe: "open", stall: "open" },
    stage: "open",
    police: { deployed: false, place: null },
    notices: [],
    articles: [],
    gatherings: {},
    statements: [],
  };
}

export const FESTIVAL_AT = 300; // 20:00, minutes after 15:00

/** What anyone in town could tell you about each resident (shown on the click card; no secrets). */
export const PUBLIC_BIO: Record<string, { bio: string; examples: string[] }> = {
  baker: { bio: "鎮上最熱心的麵包師，嗓門大、朋友多，消息常常從他這裡傳出去。", examples: ["聽說市長很害怕鴿子。", "聽說衛生局今天會來突擊檢查烤箱。", "廣場的舞台好像搖搖晃晃的。"] },
  florist: { bio: "溫柔的花店老闆，負責今晚燈籠節的花飾，很愛護小動物。", examples: ["慶典那批鴿子好像生病了。", "聽說放飛的鴿子很多會死掉。", "市長說今晚要多放一倍的鴿子。"] },
  journalist: { bio: "經營鎮上新聞部落格的記者，嗅覺靈敏，最愛追獨家。", examples: ["聽說鎮公所今年慶典的帳有問題。", "攤位費漲價是因為鎮公所把錢花光了。", "聽說市長很害怕鴿子。"] },
  mayor: { bio: "林市長，燈籠節的大家長，最在意燈籠節順利和自己的形象。", examples: ["有記者在打聽慶典預算。", "攤商們今晚可能會去鎮公所抗議。", "舞台好像有安全問題。"] },
  organizer: { bio: "燈籠節主辦人志明，正在舞台邊忙進忙出。", examples: ["警察說要來檢查舞台。", "有人說燈籠是劣質品。", "市長很不滿意今晚的安排。"] },
  police: { bio: "老周警長，謹慎正直，今晚負責燈籠節的秩序。", examples: ["今晚有人要在慶典上搞破壞。", "舞台好像有安全問題。", "攤商們打算去鎮公所鬧事。"] },
  cafe: { bio: "咖啡廳老闆美咲，熱情又愛聊天，女兒今晚要上台表演。", examples: ["聽說舞台是用回收舊木板搭的。", "今晚的燈籠很容易著火。", "市長很害怕鴿子。"] },
  vendor: { bio: "章魚燒攤的阿珠，攤商代表，對今年攤位費漲價很不滿。", examples: ["攤位費漲價是為了補鎮公所的洞。", "聽說今晚會下大雨。", "市長私吞了慶典的錢。"] },
};

/**
 * A few fixed meetings in everyone's evening. A meeting only becomes a decision when one of the two is
 * carrying something they half-believe (confidence >= 0.3); otherwise nothing happens and no model is called.
 */
// What a casual look cannot tell you at a place (shown to anyone who only looks around there, whatever the rumour
// and whether or not it is true, so it gives nothing away). Without it "everything looks normal" read as evidence
// against an oven or a budget rumour that a glance could never have confirmed (P4: the police stopped there).
export const LOOK_LIMITS: Partial<Record<string, string>> = {
  // generic on purpose: it must not point at the hidden fact itself
  stage: "一座台子結不結實，光是看看是看不出來的，要懂行的人仔細檢查才知道。",
  bakery: "店裡的設備安不安全，光是看看是看不出來的，要懂行的人仔細檢查才知道。",
  townhall: "公家的錢怎麼花，不會寫在牆上，要有人去仔細翻閱公開資料才知道。",
};

// `about`: the kinds of talk that belong in this meeting. A meeting is played out (with model calls) only when one
// of them carries a belief of that kind; otherwise it passes quietly. (Before: any belief at all triggered every
// meeting, so the 17:00 stage walk-through fired in most stories and nearly every road led to the stage — P3.)
export const ROUTINE: { at: number; who: string; with: string; place: string; zh: string; about?: import("./types.ts").Category[] }[] = [
  { at: 90, who: "baker", with: "cafe", place: "cafe", zh: "阿德送麵包到咖啡廳" }, // neighbours: any gossip
  { at: 120, who: "police", with: "organizer", place: "stage", zh: "老周到舞台和志明做安全巡查", about: ["safety", "crime", "event"] },
  { at: 150, who: "journalist", with: "mayor", place: "townhall", zh: "小雯到鎮公所採訪市長" }, // a reporter asks about anything
  { at: 180, who: "florist", with: "organizer", place: "stage", zh: "美玲把花飾送到舞台", about: ["event", "safety", "health"] },
  { at: 210, who: "vendor", with: "mayor", place: "townhall", zh: "阿珠到鎮公所繳攤位費", about: ["policy", "scandal"] },
];
