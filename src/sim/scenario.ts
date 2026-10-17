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
  { id: "mayor_owes_baker", q: "市長是不是欠阿德去年的點心錢？", fact: "mayor_owes_baker" },
  { id: "other", q: "以上都不是（其他事情或無法歸類）", fact: null },
];

/** The engine's category for each topic: big-action gates use this, not the model's own label. */
export const TOPIC_CATEGORY: Record<string, import("./types.ts").Category> = {
  festival_on: "event", pigeons_release: "event", mayor_fears_pigeons: "personal", pigeons_sick: "health", stage_unsafe: "safety",
  lanterns_flammable: "safety", budget_overrun: "scandal", mayor_embezzled: "scandal", fee_covers_budget: "policy", police_short: "safety",
  oven_unsafe: "safety", threat: "crime", birds_banned: "policy", mayor_owes_baker: "scandal",
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
  // v2: what each resident holds over someone else (true facts; the holder guards them like their own secret)
  { id: "mayor_owes_baker", zh: "林市長去年燈籠節的點心錢還沒付給阿德。", value: true, keywords: ["點心錢還沒付", "欠阿德錢", "欠麵包店", "沒付點心錢", "點心錢沒付"] },
  { id: "florist_heard_strut", zh: "美玲搭鴿籠時，聽到工人抱怨舞台左後方的支架會晃。", value: true, keywords: ["支架會晃", "工人抱怨支架", "支架在晃"] },
  { id: "mayor_organizer_quarrel", zh: "上週林市長和志明在鎮公所後門大吵一架，小雯拍到了照片。", value: true, keywords: ["後門吵架", "後門大吵", "吵架的照片"] },
  { id: "daughter_stage_fright", zh: "美咲的女兒其實很怕上台，想退出今晚的演出。", value: true, keywords: ["怕上台", "想退出演出", "怯場", "不想上台"] },
  { id: "organizer_cut_corners", zh: "去年志明辦活動也偷工減料，是老周幫忙壓下來的。", value: true, keywords: ["去年也偷工減料", "去年偷工減料", "去年的活動也出過事"] },
  { id: "florist_paid_by_townhall", zh: "美玲佈置鴿籠的錢，其實是鎮公所撥給志明的。", value: true, keywords: ["公所撥的", "鎮公所付的佈置費", "佈置費是公所"] },
  { id: "vendors_unpaid", zh: "有一半攤商還沒繳漲價後的攤位費。", value: true, keywords: ["還沒繳攤位費", "沒繳攤位費", "一半攤商沒繳", "攤位費還沒繳"] },
  { id: "threat", zh: "有人計畫在慶典上搞破壞。", value: false, keywords: [], notZh: "沒有人計畫在慶典上搞破壞。" },
  { id: "bird_ban", zh: "鎮公所打算禁止養鳥或餵鴿子。", value: false, keywords: [], notZh: "鎮公所沒有打算禁止養鳥或餵鴿子。" },
];

export const PUBLIC_INFO = "今晚 20:00 中央廣場舉行燈籠節，開場會放飛 100 隻白鴿；今年攤位費漲了一倍，不少攤商有怨言。";

const rel = (trust: number, phone: boolean, zh: string, more: { type?: string; past?: string } = {}) => ({ trust, phone, zh, ...more });

export const PERSONAS: Persona[] = [
  {
    id: "baker", name: "阿德", role: "baker", roleZh: "麵包店老闆", home: "bakery",
    traits: "老實、熱心、話很多，一緊張就忍不住找人說。", wants: "生意好、和鄰居和睦，不想惹麻煩。",
    habit: "一緊張就停不下嘴，常常乾脆把店關了、親自跑去當面找人講。",
    credulity: 0.7, talkative: 0.85, knows: ["festival", "pigeons", "stall_fee", "oven_expired", "mayor_owes_baker"], secrets: ["oven_expired", "mayor_owes_baker"],
    relations: {
      florist: rel(0.5, true, "隔壁的前任", { type: "前任，互相埋怨", past: "她十年前退了婚，他到現在還放不下" }), cafe: rel(0.7, true, "每天早上送麵包給她"), vendor: rel(0.6, false, "攤商朋友"),
      mayor: rel(0.5, false, "常來買麵包的客人", { type: "債主", past: "去年燈籠節的點心錢，市長到現在還沒付" }), journalist: rel(0.6, true, "小雯常來店裡打聽消息", { type: "情報來源", past: "麵包店是小雯的消息站" }),
    },
    card: {
      owns: "慶典全部的點心（燈籠酥）、鎮上最熱鬧的店面", exclusive: "店裡的客人一天就能把話傳遍全鎮",
      wants: "開場時被市長公開感謝", fears: "被當成笑話",
      bias: "什麼事都覺得是衝著他來", gossip: "講到數字一定加倍；心事從不直接跟美玲說",
      bottom: "不會讓慶典沒有點心", price: "被市長公開羞辱，他就把欠款的事說出來",
      lines: ["我跟你說，這事我只跟你講。", "哎唷，這下慘了啦！"],
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "florist", name: "美玲", role: "florist", roleZh: "花店老闆", home: "flower",
    traits: "溫柔、細心、很愛護動物，容易自責，也容易把事情往壞處想。", wants: "慶典的花飾漂亮，動物不要受到傷害。",
    habit: "跟動物或孩子有關的事，她會放下手邊工作親自去看；朋友有難，她會陪著去。",
    credulity: 0.5, talkative: 0.6, knows: ["festival", "pigeons", "stall_fee", "florist_guilt", "cafe_daughter", "pigeons_sick", "florist_heard_strut"], secrets: ["florist_guilt", "florist_heard_strut"],
    relations: {
      baker: rel(0.5, true, "隔壁的前任", { type: "前任，互相埋怨", past: "十年前是她退的婚，至今見面還是尷尬" }), journalist: rel(0.65, true, "高中同學"), organizer: rel(0.5, true, "生意往來，她負責佈置鴿籠", { type: "生意夥伴", past: "花飾和鴿籠的訂單都是他給的" }),
      cafe: rel(0.6, true, "常一起喝咖啡"), mayor: rel(0.4, false, "只在活動上見過"),
    },
    card: {
      owns: "全部的花飾、鴿籠的鑰匙", exclusive: "能讓鴿子不上場",
      wants: "放鴿子前確定牠們不會受驚", fears: "動物受傷",
      bias: "凡事往最壞處想", gossip: "跟動物有關的一定加一句「好可憐」；心事先跟小雯說",
      bottom: "不讓鴿子在危險的地方被放飛", price: "只要鴿子可能受傷，她就會把收錢和支架的事說出來",
      lines: ["這樣會不會太可憐了……", "我、我只是擔心而已。"],
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "journalist", name: "小雯", role: "journalist", roleZh: "記者（經營鎮上的新聞部落格）", home: "news",
    traits: "好奇、敏銳、愛追根究柢，寫東西喜歡下聳動的標題。", wants: "拿到獨家，讓部落格的流量救回來。",
    habit: "聽到值得寫的事，會先自己去查證（翻公開資料、找當事人問），有把握就發文。",
    credulity: 0.55, talkative: 0.8, knows: ["festival", "pigeons", "stall_fee", "blog_failing", "mayor_organizer_quarrel"], secrets: ["blog_failing", "mayor_organizer_quarrel"],
    relations: {
      baker: rel(0.6, true, "麵包店是她的消息站", { type: "情報來源", past: "常去店裡跟阿德打聽鎮上的消息" }),
      florist: rel(0.65, true, "高中同學"), cafe: rel(0.5, true, "咖啡廳常客"), vendor: rel(0.5, true, "常幫攤商發聲"),
      police: rel(0.35, false, "常被他擋消息"), mayor: rel(0.2, false, "常寫市長的負面新聞"), organizer: rel(0.4, false, "採訪過幾次"),
    },
    card: {
      owns: "鎮上唯一的新聞部落格、相機裡的照片", exclusive: "一篇文章全鎮都看得到；會翻公開帳目",
      wants: "八點前發出一篇能救部落格的獨家", fears: "被別人搶先報導，部落格就此倒掉",
      bias: "越否認的事越可疑", gossip: "標題一定聳動；消息來源只說「消息人士」",
      bottom: "沒有任何來源，就不發文", price: "有人給她更大的獨家，她就先壓下另一則",
      lines: ["這可是獨家喔。", "你確定？我可要寫了。"],
    },
    actions: ["publish_article", "inspect"],
  },
  {
    id: "mayor", name: "林市長", role: "mayor", roleZh: "市長", home: "townhall",
    traits: "愛面子、圓滑，最怕出事被追究，討厭被人看笑話。", wants: "燈籠節順利舉辦、順利連任，不讓預算超支曝光。",
    habit: "最在意形象：有關他或燈籠節的傳言一旦在鎮上傳開，他傾向親自出面澄清、發表聲明，而不是只私下打電話。",
    credulity: 0.3, talkative: 0.4, knows: ["festival", "pigeons", "stall_fee", "budget_overrun", "fee_for_budget", "mayor_pigeons", "mayor_embezzled", "bird_ban", "florist_paid_by_townhall", "mayor_owes_baker"], secrets: ["budget_overrun", "fee_for_budget", "florist_paid_by_townhall", "mayor_owes_baker"],
    relations: {
      organizer: rel(0.7, true, "下屬兼老同學", { type: "表面盟友", past: "每年慶典辦得好，功勞都算在市長身上" }), police: rel(0.8, true, "多年的搭檔"), journalist: rel(0.2, false, "老是寫他負面新聞"),
      baker: rel(0.5, false, "常去買麵包", { type: "欠債", past: "去年的點心錢還沒付給他，一直拖著" }), vendor: rel(0.3, false, "最近為了攤位費吵過"), cafe: rel(0.5, false, "鎮上的熟面孔"),
    },
    card: {
      owns: "燈籠節的取消權、鎮公所的帳本", exclusive: "公開聲明、取消燈籠節",
      wants: "開場致詞順利，為連任加分", fears: "在全鎮面前丟臉",
      bias: "越多人在說，他越想否認", gossip: "壞消息從不親口說，都叫志明去說",
      bottom: "絕不親口承認超支", price: "記者真的拿到帳本，他就把責任推給志明",
      lines: ["各位鄉親，這完全是誤會。", "志明，這件事你去處理。"],
    },
    actions: ["public_statement", "cancel_festival"],
  },
  {
    id: "organizer", name: "志明", role: "organizer", roleZh: "燈籠節主辦人", home: "stage",
    traits: "好大喜功、急躁，出了問題第一個想到的是撇清責任。", wants: "燈籠節風風光光，不被追究任何責任。",
    habit: "出了狀況，第一反應是對外說「一切都很安全」，常在廣場布告欄貼公告安撫大家。",
    credulity: 0.5, talkative: 0.6, knows: ["festival", "pigeons", "stall_fee", "stage_uninspected", "fee_for_budget", "lanterns_unsafe", "pigeons_sick", "mayor_organizer_quarrel"], secrets: ["stage_uninspected", "fee_for_budget"],
    relations: {
      mayor: rel(0.7, true, "上司兼老同學", { type: "表面盟友", past: "不滿市長每年搶功" }), florist: rel(0.55, true, "請她佈置鴿籠", { type: "暗戀、生意夥伴", past: "花飾和鴿籠的訂單都是他給的，其實是想多見她" }), police: rel(0.5, true, "活動要找他維持秩序"),
      vendor: rel(0.3, false, "攤商老是跟他抱怨攤位費"), journalist: rel(0.3, false, "怕她亂寫"),
    },
    card: {
      owns: "舞台、節目表、所有工人", exclusive: "貼公告、封鎖舞台、調整節目",
      wants: "慶典辦得風光，被市長誇獎", fears: "被追究責任",
      bias: "出了事先想是誰害他", gossip: "壞消息一律說成「小問題」",
      bottom: "八點前絕不取消節目", price: "市長要犧牲他，他就說出攤位費的真相",
      lines: ["沒事沒事，小問題！", "八點準時開始，誰都不准拖！"],
    },
    actions: ["inspect", "post_notice", "close_stage"],
  },
  {
    id: "police", name: "老周", role: "police", roleZh: "警長", home: "police",
    traits: "謹慎、正直，對任何可能的威脅都很緊張，寧可多做也不要出事。", wants: "今晚平安無事。",
    habit: "寧可親自去現場看、去查；有把握的安全問題，他會當場處置。",
    credulity: 0.45, talkative: 0.3, knows: ["festival", "pigeons", "stall_fee", "police_half", "organizer_cut_corners"], secrets: ["police_half", "organizer_cut_corners"],
    relations: {
      mayor: rel(0.8, true, "多年的搭檔"), cafe: rel(0.7, true, "老朋友，每天去她店裡喝咖啡"), organizer: rel(0.5, true, "活動要互相配合", { type: "老交情", past: "去年志明的活動出了問題，是他幫忙壓下來的" }),
      journalist: rel(0.35, false, "老是想套他的話"),
    },
    card: {
      owns: "今晚全部的警力、封鎖舞台的權力", exclusive: "派警力、封鎖舞台、親自檢查",
      wants: "今晚平安無事，不被市長怪罪", fears: "人潮失控而警力不夠",
      bias: "寧可信其有", gossip: "只跟信任的人講，而且打官腔",
      bottom: "沒親眼看過現場，不派警力", price: "市長要他壓下來，他會先壓；但只要孩子可能受傷，他就不聽市長的",
      lines: ["我得親眼看過才算數。", "這事我會處理，你先別張揚。"],
    },
    actions: ["dispatch_police", "inspect", "close_stage"],
  },
  {
    id: "cafe", name: "美咲", role: "cafe", roleZh: "咖啡廳老闆", home: "cafe",
    traits: "熱情、愛聊八卦，非常護女兒。", wants: "女兒今晚的表演順利，店裡生意好。",
    habit: "她是鎮上的消息中心，聽到事情習慣先找熟客和老朋友聊，為了女兒的事會直接找警長。",
    credulity: 0.6, talkative: 0.9, knows: ["festival", "pigeons", "stall_fee", "cafe_daughter", "daughter_stage_fright", "police_half"], secrets: ["daughter_stage_fright"],
    relations: {
      police: rel(0.7, true, "老朋友"), baker: rel(0.7, true, "每天幫她送麵包"), florist: rel(0.6, true, "常一起喝咖啡"),
      journalist: rel(0.5, true, "店裡常客"), mayor: rel(0.45, false, "鎮上的熟面孔"),
    },
    card: {
      owns: "咖啡廳（全鎮的客廳）、今晚要登台的女兒", exclusive: "電話簿最滿，誰都打得到",
      wants: "女兒今晚順利演出", fears: "女兒在台上出事",
      bias: "只要扯到孩子就全信", gossip: "先跟熟客聊，再打給老周；講得很溫情",
      bottom: "不讓女兒上不安全的舞台", price: "為了女兒，她會說出老周的秘密",
      lines: ["先喝杯咖啡，慢慢說。", "我女兒今晚要上台耶！"],
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "vendor", name: "阿珠", role: "vendor", roleZh: "章魚燒攤老闆（攤商代表）", home: "stall",
    traits: "直爽、嗓門大、正義感強，對鎮公所一肚子火。", wants: "攤位費降回來，今晚生意好。",
    habit: "對鎮公所不滿時，習慣揪其他攤商一起去討公道，而不是一個人生悶氣。",
    credulity: 0.65, talkative: 0.8, knows: ["festival", "pigeons", "stall_fee", "vendors_unpaid", "blog_failing"], secrets: ["vendors_unpaid"],
    relations: {
      baker: rel(0.6, false, "攤商朋友"), journalist: rel(0.55, true, "常幫攤商發聲"), mayor: rel(0.2, false, "為了攤位費吵過"),
      organizer: rel(0.3, false, "收攤位費的人"),
    },
    card: {
      owns: "攤商們的支持、廣場最好的攤位", exclusive: "一聲號召，攤商就聚過來",
      wants: "燈籠節開始前讓攤位費降回來", fears: "今晚生意泡湯",
      bias: "任何事最後都跟錢有關", gossip: "大聲講，順便拉群眾",
      bottom: "慶典當晚不收攤，除非全體攤商一起", price: "只要攤位費降回來，她什麼都不追究",
      lines: ["攤位費漲一倍，你說合理嗎！", "大家一起來！"],
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
