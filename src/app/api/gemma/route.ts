// Server-side proxy for resident decisions. The Token Factory key never leaves the server.
// Only the game's own decision requests (apiGuard.ts), only Gemma, only JSON, rate-limited, so it cannot be used as an open relay.
import { DECISION_BUDGET_MS, makeChat, rateLimiter, type ChatMessage } from "../../../sim/llm.ts";
import { checkGameMessages } from "../../../sim/apiGuard.ts";

export const maxDuration = 300;

const limit = rateLimiter(18, 6); // shared by everyone using this server: stay under the 20 rpm account cap
const perIp = new Map<string, number[]>();

export async function POST(req: Request) {
  // default: AMD Token Factory. To use a self-hosted vLLM on an AMD Instinct GPU, set GEMMA_BASE_URL,
  // GEMMA_MODEL and GEMMA_API_KEY (see deploy/amd-mi300x/README.md); nothing else changes.
  const key = process.env.GEMMA_API_KEY ?? process.env.TOKENFACTORY_API_KEY;
  if (!key) return Response.json({ error: "server has no model key configured" }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 40) return Response.json({ error: "too many requests" }, { status: 429 });
  recent.push(now);
  perIp.set(ip, recent);

  let body: { messages?: ChatMessage[]; temperature?: number; maxTokens?: number; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const bad = checkGameMessages(body?.messages); // a JSON null body is a bad request, not a crash
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const messages = body!.messages!.map(({ role, content }) => ({ role, content }));

  // one call never runs past one decision's budget, well inside maxDuration, whatever the caller does
  const chat = makeChat({ key, baseUrl: process.env.GEMMA_BASE_URL || undefined, model: process.env.GEMMA_MODEL || undefined, timeoutMs: 60_000, maxAttempts: 8, budgetMs: DECISION_BUDGET_MS }, limit);
  const params = {
    temperature: Math.min(1.2, Math.max(0, Number(body.temperature ?? 0.7))),
    maxTokens: Math.min(1200, Math.max(64, Number(body.maxTokens ?? 900))),
  };
  // a caller that goes away (left the story, closed the tab, ran out of time) stops the upstream call and its retries
  if (!body.stream) return Response.json(await chat(messages, { ...params, signal: req.signal }));
  // streamed: one JSON object per line, {"text": "...so far"} while generating, then {"done": LlmCall}
  const enc = new TextEncoder();
  const gone = new AbortController();
  const signal = AbortSignal.any([req.signal, gone.signal]);
  const out = new ReadableStream({
    async start(controller) {
      const send = (x: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(x) + "\n"));
        } catch {
          /* the reader has gone away */
        }
      };
      let last = 0;
      const r = await chat(messages, {
        ...params,
        signal,
        onDelta: (text) => {
          // a few updates per second is plenty for the early reaction
          if (text && Date.now() - last < 150) return;
          last = Date.now();
          send({ text });
        },
      });
      send({ done: r });
      try {
        controller.close();
      } catch {
        /* already cancelled */
      }
    },
    cancel() {
      gone.abort();
    },
  });
  return new Response(out, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
