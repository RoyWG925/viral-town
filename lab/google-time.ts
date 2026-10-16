// Time one decision-sized call through the Google adapter (prints timings only).
import { readFileSync } from "node:fs";
import { makeGoogleChat } from "../src/sim/llm.ts";
const env = readFileSync(".env.local", "utf8");
const keys = [...env.matchAll(/^GEMINI_API_KEY(?:_\d+)?=(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
const chat = makeGoogleChat({ keys, temperature: 0.7, maxTokens: 700, timeoutMs: 240_000, maxAttempts: 1 });
const sys = readFileSync("src/sim/mind.ts", "utf8").slice(1500, 5200);
const t0 = Date.now();
const r = await chat([
  { role: "system", content: "你在一個小鎮模擬裡扮演一位居民。規則：\n" + sys },
  { role: "user", content: '你是麵包店老闆阿德。陌生客人說：「聽說市長很害怕鴿子。」只回覆 JSON：{"feeling":"","thought":"","act":"ponder","actions":[{"type":"none"}]}' },
]);
console.log("keys", keys.length, "status", r.status, "ms", Date.now() - t0, "prompt", r.promptTokens, "out", r.completionTokens, "err", r.error ?? "", "\n", (r.content ?? "").slice(0, 200));
