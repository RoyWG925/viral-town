// Availability probe: one tiny Gemma call per interval, no retries, appended to lab/runs/probe.jsonl.
// Usage: node lab/probe.ts [minutes=40] [intervalSeconds=60]
import { appendFileSync, mkdirSync } from "node:fs";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, redact } from "../src/sim/llm.ts";

const key = process.env.TOKENFACTORY_API_KEY;
if (!key) throw new Error("Set TOKENFACTORY_API_KEY first.");
const minutes = Number(process.argv[2] ?? 40);
const every = Number(process.argv[3] ?? 60) * 1000;
mkdirSync("lab/runs", { recursive: true });
const end = Date.now() + minutes * 60_000;
while (Date.now() < end) {
  const t0 = Date.now();
  let row: Record<string, unknown>;
  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: "user", content: 'Reply {"ok":true}' }], max_tokens: 12, temperature: 0, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    const code = /"code":"([a-z_]+)"/.exec(text)?.[1] ?? null;
    row = { at: new Date(t0).toISOString(), status: res.status, ms: Date.now() - t0, code };
  } catch (e) {
    row = { at: new Date(t0).toISOString(), status: 0, ms: Date.now() - t0, code: redact(String(e)).slice(0, 80) };
  }
  appendFileSync("lab/runs/probe.jsonl", JSON.stringify(row) + "\n");
  await new Promise((r) => setTimeout(r, Math.max(0, every - (Date.now() - t0))));
}
