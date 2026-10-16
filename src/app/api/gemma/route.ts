// Server-side proxy for resident decisions. The Token Factory key never leaves the server.
// Only Gemma, only JSON decisions, size-limited and rate-limited, so it cannot be used as an open relay.
import { makeChat, rateLimiter, type ChatMessage } from "../../../sim/llm.ts";

export const maxDuration = 300;

const limit = rateLimiter(18, 6); // shared by everyone using this server: stay under the 20 rpm account cap
const perIp = new Map<string, number[]>();

export async function POST(req: Request) {
  const key = process.env.TOKENFACTORY_API_KEY;
  if (!key) return Response.json({ error: "server has no model key configured" }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 40) return Response.json({ error: "too many requests" }, { status: 429 });
  recent.push(now);
  perIp.set(ip, recent);

  let body: { messages?: ChatMessage[]; temperature?: number; maxTokens?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > 6) return Response.json({ error: "bad messages" }, { status: 400 });
  if (!messages.every((m) => ["system", "user", "assistant"].includes(m.role) && typeof m.content === "string")) return Response.json({ error: "bad messages" }, { status: 400 });
  if (messages.reduce((n, m) => n + m.content.length, 0) > 24_000) return Response.json({ error: "too long" }, { status: 413 });

  const chat = makeChat({ key, timeoutMs: 60_000, maxAttempts: 8 }, limit);
  const r = await chat(messages, {
    temperature: Math.min(1.2, Math.max(0, Number(body.temperature ?? 0.7))),
    maxTokens: Math.min(1200, Math.max(64, Number(body.maxTokens ?? 900))),
  });
  return Response.json(r);
}
