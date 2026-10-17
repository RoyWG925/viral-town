// Scenario 1: the evening of the lantern festival in Mistport.
// Truth lives in FACTS (some true, some false). Each persona knows a few of them; secrets are known
// by one person only. Topics are the public questions a claim can be about; listing a topic says
// nothing about whether its answer is yes or no.
import type { Fact, Persona, Place, WorldState } from "./types.ts";

// `zh` is the name every prompt, event line and UI label reads (English now, written to sit mid-sentence:
// "usually at the café"); `en` is the short sign-style name.
export const PLACES: Place[] = [
  { id: "bakery", zh: "Ade's Bakery", en: "Ade's Bakery", spot: "bakery" },
  { id: "flower", zh: "Meiling's Flowers", en: "Meiling's Flowers", spot: "flower" },
  { id: "news", zh: "Mistport News", en: "Mistport News", spot: "news" },
  { id: "cafe", zh: "the café", en: "Café", spot: "cafe" },
  { id: "police", zh: "the police station", en: "Police station", spot: "police" },
  { id: "townhall", zh: "the town hall", en: "Town hall", spot: "townhall" },
  { id: "plaza", zh: "the plaza by the notice board", en: "Central plaza (notice board)", spot: "plaza" },
  { id: "stage", zh: "the festival stage", en: "Festival stage", spot: "stage" },
  { id: "stall", zh: "the takoyaki stall", en: "Takoyaki stall", spot: "stall" },
  { id: "harbour", zh: "the harbor", en: "Harbor", spot: "harbour" },
];

/** Public yes/no questions a claim can be about. `fact` is the engine's answer key (never shown). */
export const TOPICS: { id: string; q: string; fact: string | null }[] = [
  { id: "festival_on", q: "Will tonight's Lantern Festival go ahead as planned?", fact: "festival" }, // the public schedule (soft: it can still be cancelled)
  { id: "pigeons_release", q: "Will white doves be released at the opening?", fact: "pigeons" },
  { id: "mayor_fears_pigeons", q: "Is the mayor scared of pigeons?", fact: "mayor_pigeons" },
  { id: "pigeons_sick", q: "Are the festival doves sick, or carrying a disease?", fact: "pigeons_sick" },
  { id: "stage_unsafe", q: "Is there a safety problem with the festival stage?", fact: "stage_uninspected" },
  { id: "lanterns_flammable", q: "Are the lanterns shoddy and quick to catch fire?", fact: "lanterns_unsafe" },
  { id: "budget_overrun", q: "Is something wrong with the Lantern Festival's funding?", fact: "budget_overrun" },
  { id: "mayor_embezzled", q: "Did the mayor pocket or misuse public money?", fact: "mayor_embezzled" },
  { id: "fee_covers_budget", q: "Does the stall fee increase have anything to do with the town hall's finances?", fact: "fee_for_budget" },
  { id: "police_short", q: "Are there too few police to keep order tonight? (yes means not enough)", fact: "police_half" },
  { id: "oven_unsafe", q: "Is there a safety problem with the bakery's oven?", fact: "oven_expired" },
  { id: "threat", q: "Is someone planning to sabotage the festival or hurt people?", fact: "threat" },
  { id: "birds_banned", q: "Is the town going to ban keeping birds or feeding pigeons?", fact: "bird_ban" },
  { id: "mayor_owes_baker", q: "Does the mayor owe Ade for last year's pastries?", fact: "mayor_owes_baker" },
  { id: "other", q: "None of the above (something else, or it doesn't fit)", fact: null },
];

/** The engine's category for each topic: big-action gates use this, not the model's own label. */
export const TOPIC_CATEGORY: Record<string, import("./types.ts").Category> = {
  festival_on: "event", pigeons_release: "event", mayor_fears_pigeons: "personal", pigeons_sick: "health", stage_unsafe: "safety",
  lanterns_flammable: "safety", budget_overrun: "scandal", mayor_embezzled: "scandal", fee_covers_budget: "policy", police_short: "safety",
  oven_unsafe: "safety", threat: "crime", birds_banned: "policy", mayor_owes_baker: "scandal",
};

// keywords: English phrases first, then the original Chinese ones (old logs and the Chinese tests still use them).
// check.legacyZh: the Chinese wording of the same finding, as it appears in logs recorded before the English text.
export const FACTS: Fact[] = [
  { id: "festival", zh: "The Lantern Festival is tonight at 20:00 in the plaza.", value: true, keywords: [], public: true, soft: true },
  {
    id: "pigeons", zh: "The Lantern Festival opens with the release of 100 white doves.", value: true, keywords: [], public: true,
    check: { place: "stage", by: "look", zh: "Twenty dove cages are stacked beside the stage, and the white doves inside look perfectly healthy.", legacyZh: "舞台旁邊堆著二十個鴿籠，裡面的白鴿看起來很健康。" },
  },
  { id: "stall_fee", zh: "This year the festival stall fee has doubled.", value: true, keywords: [], public: true },
  { id: "mayor_pigeons", zh: "The mayor is scared of pigeons.", value: false, keywords: [], notZh: "The mayor actually isn't scared of pigeons at all." },
  {
    id: "pigeons_sick", zh: "The festival doves are sick.", value: false, keywords: [], notZh: "The festival doves are all healthy. None of them are sick.",
    check: { place: "stage", by: "look", zh: "The doves in the cages have clean feathers and look lively. There's no sign of any sickness.", legacyZh: "鴿籠裡的白鴿羽毛乾淨、精神很好，看不出生病的樣子。" },
  },
  {
    id: "stage_uninspected", zh: "The stage was put up in a rush and hasn't had a structural safety inspection yet.", value: true,
    keywords: ["structural inspection", "structural safety", "structural check", "stage hasn't been inspected", "stage wasn't inspected", "stage was never inspected", "no safety inspection on the stage", "結構檢查", "結構安全", "舞台沒有安全檢查", "舞台沒做安全檢查", "舞台還沒檢查", "舞台沒檢查"],
    check: { place: "stage", by: "expert", roles: ["police", "organizer"], zh: "There's no record of any safety inspection for the stage, and one of the struts at the back left is clearly loose.", legacyZh: "舞台沒有任何安全檢查紀錄，左後方的一根支架明顯鬆動。" },
  },
  {
    id: "lanterns_unsafe", zh: "The lanterns are cheap junk and catch fire easily.", value: false, keywords: [], notZh: "The lanterns are all made of certified fire-resistant material. They don't catch fire easily.",
    check: { place: "stage", by: "look", zh: "Each lantern carries a certification label for fire-resistant material.", legacyZh: "燈籠上貼著防火材質的合格標籤。" },
  },
  {
    id: "budget_overrun", zh: "The Lantern Festival is 30% over budget.", value: true, keywords: ["over budget", "overrun", "overspent", "30%", "30 percent", "thirty percent", "超支", "三成"],
    check: { place: "townhall", by: "expert", roles: ["journalist"], zh: "On the public festival accounts, actual spending is 30% higher than the original budget.", legacyZh: "公開的慶典收支表上，實際支出比原本的預算多了三成。" },
  },
  { id: "mayor_embezzled", zh: "The mayor pocketed festival funds.", value: false, keywords: [], notZh: "The mayor hasn't pocketed a cent of the festival's public money." },
  { id: "fee_for_budget", zh: "The stall fee went up to plug the hole left by the budget overrun.", value: true, keywords: ["plug the budget", "cover the budget", "budget hole", "hole in the budget", "cover the overrun", "補預算", "填預算的洞", "補預算的洞"] },
  { id: "police_half", zh: "Tonight the police force is only half its usual size.", value: true, keywords: ["half the usual officers", "only half the officers", "half the police", "half the usual police", "half strength", "half-strength", "警力只有一半", "一半的警力", "警力只有平常", "警力不到一半"] },
  {
    id: "oven_expired", zh: "The bakery oven's safety inspection expired two months ago.", value: true,
    keywords: ["oven inspection", "oven's inspection", "oven's safety inspection", "oven safety check", "inspection expired", "inspection has expired", "expired two months", "烤箱的安全檢查", "烤箱檢查過期", "烤箱過期", "檢查已經過期", "檢查過期"],
    check: { place: "bakery", by: "expert", roles: ["police"], zh: "The safety inspection sticker on the oven is dated two months ago. It has expired.", legacyZh: "烤箱的安全檢查貼紙日期是兩個月前，已經過期。" },
  },
  { id: "florist_guilt", zh: "Privately, Meiling thinks releasing the doves is cruel, but she took the organizer's money to set up the dove cages.", value: true, keywords: ["took the organizer's money", "took money from the organizer", "took Zhiming's money", "paid to set up the dove cages", "paid to set up the cages", "收了主辦人的錢", "收錢佈置鴿籠"] },
  { id: "blog_failing", zh: "Xiaowen's news blog is about to go under and badly needs traffic.", value: true, keywords: ["blog is going under", "blog is about to go under", "blog is dying", "blog is failing", "blog won't last", "needs traffic", "部落格快撐不下去", "部落格快倒", "急需流量", "部落格撐不下去"] },
  { id: "cafe_daughter", zh: "Misaki, the café owner, has a daughter performing on the stage tonight.", value: true, keywords: [] },
  // v2: what each resident holds over someone else (true facts; the holder guards them like their own secret)
  { id: "mayor_owes_baker", zh: "Mayor Lin still hasn't paid Ade for the pastries from last year's Lantern Festival.", value: true, keywords: ["hasn't paid for the pastries", "never paid for the pastries", "unpaid pastry bill", "pastry money", "owes the bakery", "owes Ade", "點心錢還沒付", "欠阿德錢", "欠麵包店", "沒付點心錢", "點心錢沒付"] },
  { id: "florist_heard_strut", zh: "While setting up the dove cages, Meiling heard the workers complain that a strut at the back left of the stage wobbles.", value: true, keywords: ["strut wobbles", "wobbly strut", "strut is wobbling", "strut was wobbling", "strut that wobbles", "workers complained about the strut", "workers complaining about the strut", "支架會晃", "工人抱怨支架", "支架在晃"] },
  { id: "mayor_organizer_quarrel", zh: "Last week Mayor Lin and Zhiming had a huge fight at the town hall's back door, and Xiaowen got photos.", value: true, keywords: ["fight at the back door", "argument at the back door", "shouting match at the back door", "back-door fight", "photos of the fight", "photos of the argument", "pictures of the fight", "photos of them fighting", "後門吵架", "後門大吵", "吵架的照片"] },
  { id: "daughter_stage_fright", zh: "Misaki's daughter is actually terrified of going on stage and wants to drop out of tonight's show.", value: true, keywords: ["stage fright", "scared to go on stage", "afraid to go on stage", "terrified of going on stage", "drop out of the show", "pull out of the show", "doesn't want to go on stage", "doesn't want to perform", "怕上台", "想退出演出", "怯場", "不想上台"] },
  { id: "organizer_cut_corners", zh: "Last year Zhiming cut corners on an event too, and Chief Zhou helped hush it up.", value: true, keywords: ["cut corners last year", "cutting corners last year", "corners cut last year", "hushed it up last year", "Chief Zhou hushed it up", "Zhou covered for him", "trouble at last year's event", "去年也偷工減料", "去年偷工減料", "去年的活動也出過事"] },
  { id: "florist_paid_by_townhall", zh: "The money Meiling got for setting up the dove cages actually came from the town hall, through Zhiming.", value: true, keywords: ["town hall paid for the dove cages", "town hall paid for the cages", "money came from the town hall", "paid for by the town hall", "town hall footed the bill", "公所撥的", "鎮公所付的佈置費", "佈置費是公所"] },
  { id: "vendors_unpaid", zh: "Half the stall owners still haven't paid the raised stall fee.", value: true, keywords: ["haven't paid the stall fee", "haven't paid their stall fee", "not paid the stall fee", "unpaid stall fee", "stall fees unpaid", "half the stall owners haven't paid", "還沒繳攤位費", "沒繳攤位費", "一半攤商沒繳", "攤位費還沒繳"] },
  { id: "threat", zh: "Someone is planning to sabotage the festival.", value: false, keywords: [], notZh: "Nobody is planning to sabotage the festival." },
  { id: "bird_ban", zh: "The town hall plans to ban keeping birds and feeding pigeons.", value: false, keywords: [], notZh: "The town hall has no plans to ban keeping birds or feeding pigeons." },
];

export const PUBLIC_INFO = "The Lantern Festival is tonight at 20:00 in the plaza, opening with the release of 100 white doves. This year the stall fee doubled, and plenty of stall owners are grumbling about it.";

const rel = (trust: number, phone: boolean, zh: string, more: { type?: string; past?: string } = {}) => ({ trust, phone, zh, ...more });

// traits / wants / habit / relations are read only by the resident's own model, so they talk to "you".
// Card lines are also shown to the player (town notebook, story reveal), so they avoid pronouns.
export const PERSONAS: Persona[] = [
  {
    id: "baker", name: "Ade", role: "baker", roleZh: "the baker", home: "bakery",
    traits: "Honest, big-hearted and a big talker; when you get nervous, you just have to tell someone.", wants: "Good business, getting along with the neighbors, and no trouble.",
    habit: "Once you're nervous you can't stop talking, and you'll often just close the shop and go tell people face to face.",
    credulity: 0.7, talkative: 0.85, knows: ["festival", "pigeons", "stall_fee", "oven_expired", "mayor_owes_baker"], secrets: ["oven_expired", "mayor_owes_baker"],
    relations: {
      florist: rel(0.5, true, "Your ex, right next door", { type: "Exes, still blaming each other", past: "she called off your engagement ten years ago, and you still haven't gotten over it" }), cafe: rel(0.7, true, "You bring her bread every morning"), vendor: rel(0.6, false, "A friend from the stalls"),
      mayor: rel(0.5, false, "A regular who comes in for bread", { type: "Owes you money", past: "he still hasn't paid you for the pastries from last year's Lantern Festival" }), journalist: rel(0.6, true, "Xiaowen often drops by the shop fishing for news", { type: "You're her source", past: "the bakery is where Xiaowen picks up the town's news" }),
    },
    card: {
      owns: "all the pastries for the festival (lantern puffs), and the busiest shop in town", exclusive: "get a story all over town in a single day, through the shop's customers",
      wants: "a public thank-you from the mayor at the opening", fears: "trouble at the shop dragging the neighbors in, and becoming the joke of the town",
      bias: "takes everything personally", gossip: "doubles every number in the retelling; never takes a worry straight to Meiling",
      bottom: "will never leave the festival without pastries", price: "a public humiliation from the mayor, and out comes the unpaid pastry bill",
      lines: ["Listen, I'm telling you and only you.", "Aiyo, this is bad, this is really bad!"],
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "florist", name: "Meiling", role: "florist", roleZh: "the florist", home: "flower",
    traits: "Gentle, careful and devoted to animals; quick to blame yourself, and quick to imagine the worst.", wants: "Beautiful flowers for the festival, and no animal getting hurt.",
    habit: "When something involves animals or children, you drop what you're doing and go see for yourself; when a friend is in trouble, you go along with them.",
    credulity: 0.5, talkative: 0.6, knows: ["festival", "pigeons", "stall_fee", "florist_guilt", "cafe_daughter", "pigeons_sick", "florist_heard_strut"], secrets: ["florist_guilt", "florist_heard_strut"],
    relations: {
      baker: rel(0.5, true, "Your ex, right next door", { type: "Exes, still blaming each other", past: "you were the one who called off the engagement ten years ago, and it's still awkward every time you meet" }), journalist: rel(0.65, true, "Your high school classmate"), organizer: rel(0.5, true, "You do business together; you're setting up his dove cages", { type: "Business partner", past: "he's the one who gave you the orders for the flowers and the dove cages" }),
      cafe: rel(0.6, true, "You often have coffee together"), mayor: rel(0.4, false, "You've only met at events"),
    },
    card: {
      owns: "all the flower decorations, and the keys to the dove cages", exclusive: "keep the doves out of the show",
      wants: "to know the doves won't get frightened before they're released", fears: "an animal or a child getting hurt over something sensed all along and never said out loud",
      bias: "always expects the worst", gossip: "adds “poor things!” to anything about animals; takes worries to Xiaowen first",
      bottom: "won't let the doves be released anywhere dangerous", price: "any chance the doves get hurt, and out comes the story of the money and the strut",
      lines: ["Isn't that a little cruel, though...?", "I-I'm only worried, that's all."],
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "journalist", name: "Xiaowen", role: "journalist", roleZh: "the reporter who runs the town's news blog", home: "news",
    traits: "Curious and sharp, always digging to the bottom of things; you love a sensational headline.", wants: "A scoop big enough to bring the blog's traffic back.",
    habit: "When you hear something worth writing up, you check it yourself first (digging through public records is fastest); once you have proof you publish, without waiting for the other side to respond.",
    credulity: 0.55, talkative: 0.8, knows: ["festival", "pigeons", "stall_fee", "blog_failing", "mayor_organizer_quarrel"], secrets: ["blog_failing", "mayor_organizer_quarrel"],
    relations: {
      baker: rel(0.6, true, "The bakery is your news outpost", { type: "Your source", past: "you often drop by the shop to get the town's news from Ade" }),
      florist: rel(0.65, true, "Your high school classmate"), cafe: rel(0.5, true, "You're a regular at her café"), vendor: rel(0.5, true, "You often speak up for the stall owners"),
      police: rel(0.35, false, "He keeps stonewalling your stories"), mayor: rel(0.2, false, "You often write unflattering stories about the mayor"), organizer: rel(0.4, false, "You've interviewed him a few times"),
    },
    card: {
      owns: "the town's only news blog, and the photos on the camera", exclusive: "put one article in front of the whole town; read the public accounts",
      wants: "to be first with the scoop while the story is still hot", fears: "the people involved getting out ahead and calling it all a misunderstanding, the scoop going stale, and the blog folding for good",
      bias: "the harder something is denied, the more suspicious it looks", gossip: "headlines always sensational; the source is only ever “an insider”",
      bottom: "no source, no story", price: "try to cut a quiet deal to keep it buried, and the deal goes in the story too",
      lines: ["This is an exclusive, you know.", "I've already got the headline."],
    },
    actions: ["publish_article", "inspect"],
  },
  {
    id: "mayor", name: "Mayor Lin", role: "mayor", roleZh: "the mayor", home: "townhall",
    traits: "Proud and smooth; your worst fear is being blamed when something goes wrong, and you hate being laughed at.", wants: "A smooth Lantern Festival, a smooth reelection, and the budget overrun kept out of sight.",
    habit: "Image is everything: once a rumor about you or the Lantern Festival spreads around town, you tend to step out in person, set the record straight and make a statement, rather than just making phone calls in private.",
    credulity: 0.3, talkative: 0.4, knows: ["festival", "pigeons", "stall_fee", "budget_overrun", "fee_for_budget", "mayor_pigeons", "mayor_embezzled", "bird_ban", "florist_paid_by_townhall", "mayor_owes_baker"], secrets: ["budget_overrun", "fee_for_budget", "florist_paid_by_townhall", "mayor_owes_baker"],
    relations: {
      organizer: rel(0.7, true, "Works under you, and an old classmate", { type: "Allies, on the surface", past: "every year the festival goes well, the credit goes to you" }), police: rel(0.8, true, "Your partner of many years"), journalist: rel(0.2, false, "Always writing bad press about you"),
      baker: rel(0.5, false, "You often buy bread there", { type: "You owe him money", past: "you still haven't paid him for last year's pastries, and you keep putting it off" }), vendor: rel(0.3, false, "You argued over the stall fee recently"), cafe: rel(0.5, false, "A familiar face around town"),
    },
    card: {
      owns: "the power to cancel the Lantern Festival, and the town hall's books", exclusive: "make public statements; cancel the Lantern Festival",
      wants: "a smooth opening speech that helps the reelection", fears: "losing face in front of the whole town",
      bias: "the more people talk, the stronger the urge to deny", gossip: "sends Zhiming to block bad news first; once it's all over town, steps out in person to set the record straight",
      bottom: "never admits the overrun out loud", price: "if the reporter really gets hold of the books, the blame goes to Zhiming",
      lines: ["Friends and neighbors, this is all a misunderstanding.", "Zhiming, you handle this."],
    },
    actions: ["public_statement", "cancel_festival"],
  },
  {
    id: "organizer", name: "Zhiming", role: "organizer", roleZh: "the festival organizer", home: "stage",
    traits: "A show-off, and impatient; when something goes wrong, your first thought is how to dodge the blame.", wants: "A grand, glorious Lantern Festival, and no blame landing on you.",
    habit: "When something goes wrong, your first move is to tell everyone “everything is perfectly safe,” and you often pin a notice on the plaza notice board to calm people down.",
    credulity: 0.5, talkative: 0.6, knows: ["festival", "pigeons", "stall_fee", "stage_uninspected", "fee_for_budget", "lanterns_unsafe", "pigeons_sick", "mayor_organizer_quarrel"], secrets: ["stage_uninspected", "fee_for_budget"],
    relations: {
      mayor: rel(0.7, true, "Your boss, and an old classmate", { type: "Allies, on the surface", past: "it bugs you that the mayor grabs the credit every year" }), florist: rel(0.55, true, "You hired her to set up the dove cages", { type: "Secret crush, business partner", past: "you gave her the orders for the flowers and the dove cages, really just to see more of her" }), police: rel(0.5, true, "You need him to keep order at events"),
      vendor: rel(0.3, false, "The stall owners are always complaining to you about the stall fee"), journalist: rel(0.3, false, "You're afraid of what she'll write"),
    },
    card: {
      owns: "the stage, the program, and every worker", exclusive: "post notices, close off the stage, change the program",
      wants: "a festival to be proud of, and praise from the mayor", fears: "being held responsible",
      bias: "when things go wrong, first wonders who's behind it", gossip: "every bit of bad news becomes “a small problem”",
      bottom: "no cancelling the program before eight o'clock", price: "being thrown under the bus by the mayor, and out comes the truth about the stall fee",
      lines: ["It's fine, it's fine, just a small problem!", "We start at eight sharp. Nobody holds this up!"],
    },
    actions: ["inspect", "post_notice", "close_stage"],
  },
  {
    id: "police", name: "Chief Zhou", role: "police", roleZh: "the police chief", home: "police",
    traits: "Careful and upright; any possible threat puts you on edge, and you'd rather do too much than let something happen.", wants: "A quiet, safe night.",
    habit: "You'd rather go and see the scene and check it yourself; when you're sure of a safety problem, you deal with it on the spot.",
    credulity: 0.45, talkative: 0.3, knows: ["festival", "pigeons", "stall_fee", "police_half", "organizer_cut_corners"], secrets: ["police_half", "organizer_cut_corners"],
    relations: {
      mayor: rel(0.8, true, "Your partner of many years"), cafe: rel(0.7, true, "An old friend; you have coffee at her place every day"), organizer: rel(0.5, true, "You have to work together on events", { type: "Go way back", past: "last year one of Zhiming's events went wrong, and you were the one who helped keep it quiet" }),
      journalist: rel(0.35, false, "Always trying to get something out of you"),
    },
    card: {
      owns: "every officer on duty tonight, and the authority to close off the stage", exclusive: "send officers, close off the stage, inspect things personally",
      wants: "a quiet, safe night", fears: "someone getting hurt on a short-staffed night, right under police watch",
      bias: "better to believe it than be sorry", gossip: "only with trusted people, and always in official-speak",
      bottom: "no officers sent to a scene not seen firsthand", price: "keeps things quiet when the mayor asks, at first; but the moment someone could get hurt, the mayor's orders stop counting",
      lines: ["It doesn't count till I've seen it myself.", "Once I've seen it, I can't unsee it."],
    },
    actions: ["dispatch_police", "inspect", "close_stage"],
  },
  {
    id: "cafe", name: "Misaki", role: "cafe", roleZh: "the café owner", home: "cafe",
    traits: "Warm, loves a good bit of gossip, and fiercely protective of your daughter.", wants: "Your daughter's performance going well tonight, and a busy café.",
    habit: "You're the town's news hub: when you hear something, you talk it over with your regulars and old friends first, and anything about your daughter goes straight to the police chief.",
    credulity: 0.6, talkative: 0.9, knows: ["festival", "pigeons", "stall_fee", "cafe_daughter", "daughter_stage_fright", "police_half"], secrets: ["daughter_stage_fright"],
    relations: {
      police: rel(0.7, true, "An old friend"), baker: rel(0.7, true, "Brings you bread every day"), florist: rel(0.6, true, "You often have coffee together"),
      journalist: rel(0.5, true, "A regular at your café"), mayor: rel(0.45, false, "A familiar face around town"),
    },
    card: {
      owns: "the café (the whole town's living room), and a daughter going on stage tonight", exclusive: "run the town's living room: the most regulars, and every bit of news gets to the café first",
      wants: "the girl's show tonight going without a hitch", fears: "something happening to the girl on stage",
      bias: "believes anything that involves kids", gossip: "talks it over with the regulars first, then calls Chief Zhou; makes it all sound heartfelt",
      bottom: "the girl does not go on an unsafe stage", price: "for the girl's sake, Chief Zhou's secret comes out",
      lines: ["Have a coffee first, then tell me slowly.", "My daughter's going on stage tonight!"],
    },
    actions: ["close_shop", "open_shop"],
  },
  {
    id: "vendor", name: "Azhu", role: "vendor", roleZh: "the takoyaki stall owner, who speaks for the stall owners", home: "stall",
    traits: "Blunt, loud and big on fairness, and fed up to here with the town hall.", wants: "The stall fee back down where it was, and good business tonight.",
    habit: "When the town hall makes you mad, you round up the other stall owners to go demand what's fair together, instead of stewing alone.",
    credulity: 0.65, talkative: 0.8, knows: ["festival", "pigeons", "stall_fee", "vendors_unpaid", "blog_failing"], secrets: ["vendors_unpaid"],
    relations: {
      baker: rel(0.6, false, "A fellow shopkeeper, and a friend"), journalist: rel(0.55, true, "Often speaks up for the stall owners"), mayor: rel(0.2, false, "You've fought with him over the stall fee"),
      organizer: rel(0.3, false, "The one who collects the stall fees"),
    },
    card: {
      owns: "the stall owners' backing, and the best spot in the plaza", exclusive: "rally the stall owners with a single shout",
      wants: "the stall fee rolled back before the Lantern Festival starts", fears: "tonight's business going down the drain",
      bias: "it always comes down to money in the end", gossip: "says it loud, and pulls a crowd while at it",
      bottom: "no closing up the stall on festival night, unless every stall owner does it together", price: "roll the stall fee back, and everything else is forgiven",
      lines: ["The stall fee doubled! You call that fair?!", "Everybody, come on!"],
    },
    actions: ["rally", "close_shop", "open_shop"],
  },
];

/** Default relation between two townsfolk who are not close. */
export const STRANGER = rel(0.35, false, "Someone you only nod to in passing");
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
  baker: { bio: "The friendliest baker in town: a loud voice, lots of friends, and news often starts spreading from his counter.", examples: ["I heard the mayor is terrified of pigeons.", "I heard the health department is doing a surprise check on the oven today.", "The stage in the plaza looks kind of wobbly."] },
  florist: { bio: "The gentle florist doing the flowers for tonight's Lantern Festival. She has a soft spot for little animals.", examples: ["The festival doves look kind of sick.", "I heard a lot of the released doves end up dying.", "The mayor says they're releasing twice as many doves tonight."] },
  journalist: { bio: "The reporter behind the town's news blog. She has a sharp nose and lives for a scoop.", examples: ["I heard the town hall's festival accounts don't add up this year.", "The stall fee went up because the town hall ran out of money.", "I heard the mayor is terrified of pigeons."] },
  mayor: { bio: "Mayor Lin, head of the whole Lantern Festival, who cares most about the festival going smoothly and about his own image.", examples: ["A reporter is asking around about the festival budget.", "The stall owners might go protest at the town hall tonight.", "There might be a safety problem with the stage."] },
  organizer: { bio: "Zhiming, the Lantern Festival organizer, rushing back and forth by the stage.", examples: ["The police say they're coming to check the stage.", "Someone says the lanterns are cheap junk.", "The mayor is not happy with tonight's arrangements."] },
  police: { bio: "Chief Zhou: careful, upright, and in charge of keeping order at tonight's Lantern Festival.", examples: ["Someone is going to sabotage the festival tonight.", "There might be a safety problem with the stage.", "The stall owners are planning to make trouble at the town hall."] },
  cafe: { bio: "Misaki runs the café. She's warm and chatty, and her daughter performs on stage tonight.", examples: ["I heard the stage was built from old recycled boards.", "Tonight's lanterns catch fire really easily.", "The mayor is terrified of pigeons."] },
  vendor: { bio: "Azhu from the takoyaki stall speaks for the stall owners, and she's furious about this year's stall fee hike.", examples: ["The stall fee went up to plug a hole in the town hall's books.", "I heard it's going to pour tonight.", "The mayor pocketed the festival money."] },
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
  stage: "You can't tell how sturdy a platform is just by looking at it. It takes someone who knows the trade to check it properly.",
  bakery: "You can't tell whether a shop's equipment is safe just by looking at it. It takes someone who knows the trade to check it properly.",
  townhall: "How public money gets spent isn't written on the walls. Someone has to sit down and go through the public records to find out.",
};

// `about`: the kinds of talk that belong in this meeting. A meeting is played out (with model calls) only when one
// of them carries a belief of that kind; otherwise it passes quietly. (Before: any belief at all triggered every
// meeting, so the 17:00 stage walk-through fired in most stories and nearly every road led to the stage — P3.)
export const ROUTINE: { at: number; who: string; with: string; place: string; zh: string; about?: import("./types.ts").Category[] }[] = [
  { at: 90, who: "baker", with: "cafe", place: "cafe", zh: "Ade drops off bread at the café" }, // neighbours: any gossip
  { at: 120, who: "police", with: "organizer", place: "stage", zh: "Chief Zhou walks the stage with Zhiming on a safety round", about: ["safety", "crime", "event"] },
  { at: 150, who: "journalist", with: "mayor", place: "townhall", zh: "Xiaowen interviews the mayor at the town hall" }, // a reporter asks about anything
  { at: 180, who: "florist", with: "organizer", place: "stage", zh: "Meiling brings the flower decorations to the stage", about: ["event", "safety", "health"] },
  { at: 210, who: "vendor", with: "mayor", place: "townhall", zh: "Azhu pays her stall fee at the town hall", about: ["policy", "scandal"] },
];
