// Browser-side model client: every resident decision goes through the server route that holds the key.
import { rateLimiter, type Chat, type LlmCall } from "./llm.ts";

const limit = rateLimiter(18, 4);

export const remoteChat: Chat = (messages, opts = {}) =>
  limit(async () => {
    const t0 = Date.now();
    try {
      const stream = !!opts.onDelta;
      const r = await fetch("/api/gemma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, temperature: opts.temperature, maxTokens: opts.maxTokens, stream }),
      });
      if (stream && r.status === 200 && r.body) {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const j = JSON.parse(line) as { text?: string; done?: LlmCall };
            if (j.done) return j.done;
            if (typeof j.text === "string") opts.onDelta!(j.text);
          }
        }
        throw new Error("stream ended without a result");
      }
      const j = (await r.json()) as Partial<LlmCall> & { error?: string };
      if (r.status !== 200 && j.content === undefined) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j as LlmCall;
    } catch (e) {
      return {
        content: null, status: 0, latencyMs: Date.now() - t0, attempts: 1, promptTokens: 0, completionTokens: 0,
        platformCost: 0, estCost: 0, error: String(e), rateHeaders: {},
      };
    }
  });
