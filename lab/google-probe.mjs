// Which Gemma models the Google AI Studio key can reach, and whether chat + JSON + streaming work.
// Reads GEMINI_API_KEY from .env.local; never prints it.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const key = env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY missing in .env.local");
const hide = (s) => String(s).split(key).join("[key]");
const base = "https://generativelanguage.googleapis.com/v1beta";

const list = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
console.log("models status", list.status);
const j = await list.json();
const gemma = (j.models ?? []).filter((m) => /gemma/i.test(m.name));
for (const m of gemma) console.log(" ", m.name, "|", m.displayName, "| in", m.inputTokenLimit, "out", m.outputTokenLimit, "|", (m.supportedGenerationMethods ?? []).join(","));
if (!gemma.length) console.log(hide(JSON.stringify(j).slice(0, 300)));

const pick = process.argv[2] ?? gemma.map((m) => m.name.replace("models/", "")).find((n) => /gemma-4.*31b/i.test(n)) ?? gemma.map((m) => m.name.replace("models/", "")).find((n) => /27b|31b/.test(n));
console.log("probe model:", pick);
const t0 = Date.now();
const r = await fetch(`${base}/openai/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: pick,
    max_tokens: 120,
    messages: [
      { role: "system", content: "只回覆一個 JSON 物件。" },
      { role: "user", content: '用繁體中文回覆 {"thought":"一句內心獨白","act":"ponder"}，主題：聽說市長怕鴿子。' },
    ],
  }),
});
const body = await r.text();
console.log("chat status", r.status, "ms", Date.now() - t0);
console.log(hide(body).slice(0, 600));
