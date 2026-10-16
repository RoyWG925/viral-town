// Gemma as one resident's mind: read what they just heard, decide what they believe and what they do.
// The model only proposes; validate.ts checks the proposal and the engine applies it.
import { ACT_LIST } from "./acts.ts";
import { PLACES, TOPICS } from "./scenario.ts";
import { parseJSON, type Chat, type ChatMessage } from "./llm.ts";
import type { ActionKind, DecisionOutput, LlmRecord, ValidationEntry } from "./types.ts";
import { checkDecision, coerce, normalize, type Checked } from "./validate.ts";
import { describeTrust, type InboxItem, type View } from "./view.ts";

export type Variant = "single" | "two-stage" | "free-actions" | "eager";

export interface MindResult {
  output: DecisionOutput;
  checked: Checked;
  llm: LlmRecord[];
  validation: ValidationEntry[];
  fallback: boolean;
}

const ACTION_ZH: Record<ActionKind, string> = {
  none: "不做任何事，繼續手邊的事",
  tell: "走過去當面跟某人說（需要 target、intent、message）",
  phone: "打電話給有電話的熟人（需要 target、message）",
  ask: "去問某人一件事（需要 target、message）",
  go_look: "親自走去某個地方看看（需要 place）",
  inspect: "以專業身分仔細檢查某個地方的設施或建物（需要 place）",
  close_shop: "暫時關店（需要 cites 說明原因）",
  open_shop: "重新開店",
  post_notice: "在廣場布告欄貼一張公告（需要 message）",
  publish_article: "在新聞部落格發一篇文章（message 寫標題和內文）",
  public_statement: "對全鎮發表公開聲明（需要 message、cites）",
  cancel_festival: "宣布取消今晚的燈籠節（需要 message、cites）",
  dispatch_police: "派警員到某個地方（需要 place、cites）",
  close_stage: "封鎖慶典舞台，不准任何人上台",
  rally: "號召攤商到某個地方聚集表達訴求（需要 place、message、cites）",
};

const RULES = `你在一個小鎮模擬裡扮演一位居民。你只能根據「你知道的事」「你相信的說法」「你剛收到的訊息」來思考，像真人一樣判斷，而不是像說書人一樣替故事製造劇情。

原則：
1. 你不知道沒列出來的事。不要假裝知道別人的秘密，也不要編造你沒看到、沒聽到的事實。
2. 聽到一句話，先想它在說什麼、對你代表什麼。你可以誤會，但誤會要來自你的個性、處境和你在乎的事。
3. 傳聞不等於事實。沒根據的話，多數人頂多聊兩句、一笑置之或存疑；只有當事情跟你在乎的事有關、而且你有理由相信，才會去做比較大的事。
4. 別人叫你做什麼，你不會因為對方這樣說就照做，你只會為了自己的理由行動。
5. 什麼都不做是完全正常的選擇。
6. 轉述時用你自己的話和口吻，說出你理解的版本，可能帶著你的推測或擔心。
7. 你的秘密通常不會說出口，除非你有很強的理由。
8. 如果聽到的話和「你知道的事」相反，你知道它是錯的：你可以澄清、隱瞞、不理或利用它，但你自己不會相信它。`;

const EAGER = `\n9.你是有血有肉的人：當一件事碰到你的利益、價值觀或你在乎的人，而且你相信它，你通常會真的去做點什麼，而不是只是聊天觀望。`;

const TOPIC_LIST = TOPICS.map((t) => `- ${t.id}：${t.q}`).join("\n");
const PLACE_LIST = PLACES.map((p) => `${p.id}=${p.zh}`).join("、");

const SCHEMA_READ = `"feeling": "一個表情符號加一個詞，例如 😟 擔心",
  "act": "你當下看得見的反應，從反應清單選一個編號",
  "understanding": "你認為這則訊息在說什麼、對你代表什麼（30 字內）",
  "claims": [{"ref": "new（新的說法），或你已有的說法編號（例如 c2）", "source": "這條說法來自哪則訊息（例如 m1）", "statement": "用一句話寫出這條說法", "topic": "主題編號", "says": "yes / no / unclear：這條說法對該主題問題的回答", "category": "safety|crime|scandal|health|policy|event|personal|absurd|other"}],
  "stances": [{"claim": 0, "verdict": "believe / doubt / disbelieve", "confidence": "你認為這條說法是真的機率：0＝一定是假的，0.5＝不知道，1＝一定是真的", "why": "為什麼這樣判斷（20 字內）", "cites": ["依據的編號，例如 m1、pigeons、c2"]}],

  "thought": "一句內心獨白（30 字內）"`;
const SCHEMA_ACT = `"actions": [{"type": "行動編號", "target": "對象編號（需要時）", "place": "地點編號（需要時）", "intent": "inform/warn/ask/answer/deny/complain/request/joke", "message": "你要說或寫的話（140 字內；發文 400 字內）", "cites": ["依據的編號；這次的新說法用 #0、#1"]}]`;

function systemPrompt(variant: Variant, stage: "single" | "read" | "act") {
  // the free-actions variant must not see the legal action menu (that is what it tests)
  const rules = RULES + (variant === "eager" ? EAGER : "");
  const shape =
    stage === "read" ? `{\n  ${SCHEMA_READ}\n}` : stage === "act" ? `{\n  ${SCHEMA_ACT}\n}` : `{\n  ${SCHEMA_READ},\n  ${SCHEMA_ACT}\n}`;
  const actionNote =
    stage === "read"
      ? ""
      : variant === "free-actions"
        ? "\nactions 最多 2 個，依序執行。行動用你自己的話描述在 type（例如「去舞台看看」），不想做事就給 [{\"type\":\"none\"}]。"
        : "\nactions 最多 2 個，依序執行；只能用「你可以做的事」裡的行動編號。不想做事就給 [{\"type\":\"none\",\"why\":\"...\"}]。";
  return `${rules}

主題清單（只是用來替說法分類；清單上的問題大多只是鎮上的閒話，出現在清單上不代表是真的，不要因為清單上有就去猜測）：
${TOPIC_LIST}

地點編號：${PLACE_LIST}

反應清單（act 從這裡選一個最符合你此刻的）：${ACT_LIST}

只用繁體中文，只回覆一個 JSON 物件：
${shape}${actionNote}`;
}

function inboxLine(m: InboxItem, view: View): string {
  const q = `「${m.text}」`;
  switch (m.via) {
    case "seed":
      return `你剛才在${view.placeZh}聽到一位不認識的客人說：${q}`;
    case "hunch":
      return `你腦中突然冒出一個念頭：${q}（你不記得是從哪裡聽來的，也不確定是不是真的）`;
    case "face":
      return `${m.fromZh}剛剛當面跟你說（${m.intent}）：${q}`;
    case "phone":
      return `${m.fromZh}打電話跟你說（${m.intent}）：${q}`;
    case "article":
      return `你看到${m.fromZh}在新聞部落格發的文章：${q}`;
    case "notice":
      return `廣場布告欄上貼了一張公告：${q}`;
    case "crowd":
      return `你聽店裡的客人說：${q}`;
    case "inspection":
      return `你親自去看了，看到的是：${m.text}`;
    case "meet":
      return `你照平常的行程碰到了${m.fromZh}（${m.text}）。你們打了招呼；要不要提起什麼事，由你決定。`;
    default:
      return `${m.fromZh}：${q}`;
  }
}

export function userPrompt(view: View, stage: "single" | "read" | "act", reading?: { output: DecisionOutput; confidence: number[] }, opts: { free?: boolean } = {}) {
  const p = view.npc;
  const know = view.knowledge.map((k) => `- [${k.id}] ${k.zh}${k.secret ? "（這是你的秘密，你不想讓人知道）" : ""}${k.learned ? "（你親眼確認過）" : ""}`).join("\n") || "（無）";
  const beliefs = view.beliefs.length
    ? view.beliefs.map((b) => `- [${b.id}] ${b.statement}（你的信心 ${b.confidence.toFixed(2)}；來源：${b.sourcesZh}）`).join("\n")
    : "（還沒有）";
  const people = view.people
    .map((x) => `- ${x.id}：${x.name}（${x.roleZh}），通常在${x.placeZh}。${x.relation.zh}；${describeTrust(x.relation.trust)}她/他說的話；${x.relation.phone ? "有電話" : "沒有電話，只能當面說"}。`)
    .join("\n") || "（目前聯絡不到任何人）";
  const actions = ["none" as ActionKind, ...view.actions].map((a) => `- ${a}：${ACTION_ZH[a]}`).join("\n");
  const inbox = view.inbox.map((m) => `- [${m.id}] ${inboxLine(m, view)}`).join("\n");
  const memory = view.memory.length ? view.memory.slice(-8).map((m) => `- ${m}`).join("\n") : "（無）";
  const events = view.publicEvents.length ? view.publicEvents.slice(-6).map((m) => `- ${m}`).join("\n") : "（沒聽說什麼）";
  let s = `現在是 ${view.clock}，你在${view.placeZh}。燈籠節 20:00 開始。

【你是誰】${p.name}，${p.roleZh}。個性：${p.traits} 你在乎的：${p.wants}
【小鎮公開資訊】${view.publicInfo}
【你知道的事】
${know}
【你目前相信的說法】
${beliefs}
【你記得的事】
${memory}
【你知道鎮上最近發生的事】
${events}
【剛收到的訊息】
${inbox}
【你能聯絡的人】
${people}`;
  if (stage !== "read" && !opts.free) s += `\n【你可以做的事】\n${actions}`;
  if (stage === "act" && reading) {
    const lines = reading.output.claims.map((c, i) => `- #${i} ${c.statement}（你的信心 ${reading.confidence[i]?.toFixed(2) ?? "0"}）`).join("\n");
    s += `\n【你剛才的判斷】\n你的理解：${reading.output.understanding}\n你的想法：${reading.output.thought}\n${lines || "（沒有形成具體說法）"}\n根據這些判斷，你接下來要做什麼？`;
  } else s += "\n\n你會怎麼理解、怎麼想、怎麼做？";
  return s;
}

const FALLBACK: DecisionOutput = { understanding: "", claims: [], stances: [], feeling: "😶 愣住", thought: "（沒能做出判斷）", actions: [{ type: "none", why: "fallback" }] };

/** Pull "feeling" and "act" out of a partly generated JSON answer, once both are complete. */
export function earlyReaction(text: string): { feeling: string; act: string } | null {
  const f = /"feeling"\s*:\s*"([^"]*)"/.exec(text);
  const a = /"act"\s*:\s*"([^"]*)"/.exec(text);
  return f && a ? { feeling: f[1], act: a[1] } : null;
}

async function ask(
  chat: Chat, messages: ChatMessage[], view: View, stage: "single" | "read" | "act", npcId: string, clock0: number, temperature: number,
  check: (o: DecisionOutput) => Checked, llm: LlmRecord[], validation: ValidationEntry[],
  onEarly?: (x: { feeling: string; act: string }) => void,
): Promise<{ out: DecisionOutput; checked: Checked } | null> {
  let msgs = messages;
  // two chances for the model to give a valid answer; provider outages get extra tries on top
  let modelFailures = 0;
  for (let attempt = 1; attempt <= 2 + Math.min(modelFailures, 3); attempt++) {
    const start = Date.now() - clock0;
    let told = false;
    const r = await chat(msgs, {
      temperature,
      maxTokens: stage === "read" ? 700 : 1000,
      // stream only when someone wants the early reaction; it is shown as a gesture, never as a decision
      onDelta: onEarly
        ? (text) => {
            if (told) return;
            const x = earlyReaction(text);
            if (x) {
              told = true;
              onEarly(x);
            }
          }
        : undefined,
    });
    llm.push({
      provider: r.provider, decision: "", npc: npcId, stage, wallStartMs: start, wallEndMs: Date.now() - clock0, latencyMs: r.latencyMs, attempts: r.attempts,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens, platformCost: r.platformCost, estCost: r.estCost,
      status: r.status, error: r.error, raw: r.content, promptChars: msgs.reduce((n, m) => n + m.content.length, 0), ttftMs: r.ttftMs,
    });
    if (r.status !== 200 || !r.content) {
      validation.push({ attempt, stage, kind: "model", errors: [`model error: ${r.error ?? r.status}`] });
      modelFailures++;
      await new Promise((res) => setTimeout(res, 8000));
      continue;
    }
    const parsed = parseJSON(r.content);
    const { out: rawOut, errors: shapeErrors } = coerce(parsed.value);
    const errors = parsed.error ? [parsed.error] : [...shapeErrors];
    let checked: Checked | null = null;
    const norm = rawOut ? normalize(view, rawOut) : null;
    const out = norm ? norm.out : null;
    if (out && !parsed.error) {
      checked = check(out);
      errors.push(...checked.errors);
    }
    validation.push({ attempt, stage, kind: errors.length ? "validator" : "ok", errors, notes: norm?.notes.length ? norm.notes : undefined });
    if (out && checked && errors.length === 0) return { out, checked };
    msgs = [...msgs, { role: "assistant", content: r.content }, { role: "user", content: `你的回覆沒有通過檢查：${errors.join("；")}。請修正後重新回覆完整的 JSON。` }];
  }
  void view;
  return null;
}

export async function decideWithGemma(view: View, chat: Chat, opts: { variant: Variant; temperature: number; clock0: number; onEarly?: (x: { feeling: string; act: string }) => void }): Promise<MindResult> {
  const llm: LlmRecord[] = [];
  const validation: ValidationEntry[] = [];
  const npcId = view.npc.id;
  const free = opts.variant === "free-actions";
  if (opts.variant !== "two-stage") {
    const msgs: ChatMessage[] = [
      { role: "system", content: systemPrompt(opts.variant, "single") },
      { role: "user", content: userPrompt(view, "single", undefined, { free }) },
    ];
    const res = await ask(chat, msgs, view, "single", npcId, opts.clock0, opts.temperature, (o) => checkDecision(view, free ? { ...o, actions: [] } : o, { requireActions: !free }), llm, validation, opts.onEarly);
    if (!res) return { output: FALLBACK, checked: checkDecision(view, FALLBACK, { requireReading: false }), llm, validation, fallback: true };
    if (free) {
      // free-form actions are recorded for the experiment but never executed
      const freeActs = res.out.actions;
      const checkedFree = checkDecision(view, res.out);
      return { output: { ...res.out, actions: [{ type: "none", why: `free-form: ${freeActs.map((a) => a.type).join(" / ")}` }] }, checked: { ...res.checked, warnings: [...res.checked.warnings, ...checkedFree.errors.map((e) => `free action rejected: ${e}`)] }, llm, validation, fallback: false };
    }
    return { output: res.out, checked: res.checked, llm, validation, fallback: false };
  }
  // two-stage: read first, let the engine bound the confidences, then decide what to do
  const readMsgs: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.variant, "read") },
    { role: "user", content: userPrompt(view, "read") },
  ];
  const read = await ask(chat, readMsgs, view, "read", npcId, opts.clock0, opts.temperature, (o) => checkDecision(view, { ...o, actions: [] }, { requireActions: false }), llm, validation);
  if (!read) return { output: FALLBACK, checked: checkDecision(view, FALLBACK, { requireReading: false }), llm, validation, fallback: true };
  const actMsgs: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.variant, "act") },
    { role: "user", content: userPrompt(view, "act", { output: read.out, confidence: read.checked.confidence }) },
  ];
  const act = await ask(chat, actMsgs, view, "act", npcId, opts.clock0, opts.temperature, (o) => checkDecision(view, { ...read.out, actions: o.actions }, { requireReading: true }), llm, validation);
  const actions = act ? act.out.actions : [{ type: "none" as const, why: "fallback" }];
  const output = { ...read.out, actions };
  return { output, checked: checkDecision(view, output), llm, validation, fallback: !act };
}
