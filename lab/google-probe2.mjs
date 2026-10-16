// Try ways to switch off Gemma 4's thinking on the Gemini API (OpenAI-compatible and native), timing each.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const key = env.GEMINI_API_KEY;
const hide = (s) => String(s).split(key).join("[key]");
const base = "https://generativelanguage.googleapis.com/v1beta";
const model = process.argv[2] ?? "gemma-4-31b-it";
const prompt = '只回覆一個 JSON 物件，用繁體中文：{"thought":"一句內心獨白","act":"ponder"}。主題：聽說市長怕鴿子。';

async function compat(label, extra) {
  const t0 = Date.now();
  const r = await fetch(`${base}/openai/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: "user", content: prompt }], ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  const c = j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 200);
  console.log(`[${label}] ${r.status} ${Date.now() - t0}ms usage=${JSON.stringify(j.usage ?? {})}\n   ${hide(c).slice(0, 160).replace(/\n/g, " ")}`);
}
async function native(label, gen) {
  const t0 = Date.now();
  const r = await fetch(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 200, ...gen } }),
  });
  const j = await r.json().catch(() => ({}));
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text).join("");
  console.log(`[${label}] ${r.status} ${Date.now() - t0}ms usage=${JSON.stringify(j.usageMetadata ?? {})} thoughtParts=${parts.filter((p) => p.thought).length}\n   ${hide(text || JSON.stringify(j).slice(0, 200)).slice(0, 160).replace(/\n/g, " ")}`);
}
await compat("compat reasoning_effort=none", { reasoning_effort: "none" });
await native("native thinkingBudget=0", { thinkingConfig: { thinkingBudget: 0 } });
await native("native thinkingLevel=minimal", { thinkingConfig: { thinkingLevel: "minimal" } });
await native("native includeThoughts=false", { thinkingConfig: { includeThoughts: false } });
await native("native json mime", { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } });
