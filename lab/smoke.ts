// Phase 1 smoke test: is the Token Factory endpoint reachable today, how fast, and what does a call cost?
// Usage: node lab/smoke.ts
import { makeChat, parseJSON, redact } from "../src/sim/llm.ts";

const key = process.env.TOKENFACTORY_API_KEY;
if (!key) throw new Error("Set TOKENFACTORY_API_KEY first.");
const chat = makeChat({ key, temperature: 0.2, maxTokens: 120 });

const r = await chat([
  { role: "system", content: "Reply with JSON only." },
  { role: "user", content: '用一句繁體中文描述黃昏的小鎮，回覆 {"line": "..."}' },
]);
const parsed = parseJSON(r.content);
console.log(JSON.stringify({ status: r.status, latencyMs: r.latencyMs, attempts: r.attempts, promptTokens: r.promptTokens, completionTokens: r.completionTokens, platformCost: r.platformCost, estCost: r.estCost, rateHeaders: r.rateHeaders, parsed: parsed.value, error: r.error ?? parsed.error }, null, 2));

// Account usage endpoint (exists on Token Factory; shape not documented, so print it as-is, redacted).
const u = await fetch("https://developer.amd.com.cn/radeon/api/v1/usage", { headers: { Authorization: `Bearer ${key}` } }).catch((e) => e);
if (u instanceof Response) console.log("usage", u.status, redact((await u.text()).slice(0, 600)));
else console.log("usage endpoint error", redact(String(u)));
