// Gemma on AMD Token Factory (OpenAI-compatible). Pure fetch: the caller passes the key in, so this
// module never reads secrets itself and can be shared by the lab CLI and the server route.
// Never import it from client components.

export const DEFAULT_BASE_URL = "https://developer.amd.com.cn/radeon/api/v1";
export const DEFAULT_MODEL = "Gemma-4-31B-IT";
// Published Token Factory list rate for Gemma-4-31B-IT, points per 1M tokens (input / output).
const RATE_IN = 0.5;
const RATE_OUT = 3.0;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmConfig {
  key: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** network attempts per call (provider errors and timeouts are retried) */
  maxAttempts?: number;
}

export interface LlmCall {
  content: string | null;
  status: number;
  latencyMs: number;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  /** usage.cost as the platform reports it (unit unconfirmed). */
  platformCost: number;
  /** list-rate estimate from token counts */
  estCost: number;
  /** time spent waiting in our own rate limiter (not model latency) */
  queueMs?: number;
  error?: string;
  rateHeaders: Record<string, string>;
  /** which service answered: "amd" (Token Factory) or "google" (AI Studio free tier, used for lab volume tests) */
  provider?: string;
}

/** Callers that need a model: the lab passes a real client, tests pass a recorded one. */
export type Chat = (messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }) => Promise<LlmCall>;

const KEY_RE = /rc-[0-9A-Za-z]{8,}|AIza[0-9A-Za-z_-]{20,}/g;
export const redact = (s: string) => s.replace(KEY_RE, "[REDACTED_KEY]");

export function estimateCost(promptTokens: number, completionTokens: number) {
  return (promptTokens * RATE_IN + completionTokens * RATE_OUT) / 1_000_000;
}

/** Spaces requests so a single process stays under the account's requests-per-minute limit. */
export function rateLimiter(perMinute: number, maxConcurrent: number) {
  const starts: number[] = [];
  let active = 0;
  const waiters: (() => void)[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= maxConcurrent) await new Promise<void>((r) => waiters.push(r));
    active++;
    try {
      for (;;) {
        const now = Date.now();
        while (starts.length && now - starts[0] > 60_000) starts.shift();
        if (starts.length < perMinute) break;
        await sleep(60_000 - (now - starts[0]) + 50);
      }
      starts.push(Date.now());
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

export function makeChat(cfg: LlmConfig, limit?: <T>(fn: () => Promise<T>) => Promise<T>): Chat {
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const model = cfg.model ?? DEFAULT_MODEL;
  const run = limit ?? (<T,>(fn: () => Promise<T>) => fn());
  return async (messages, opts = {}) => {
    const body = JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? cfg.maxTokens ?? 900,
      temperature: opts.temperature ?? cfg.temperature ?? 0.7,
      response_format: { type: "json_object" },
    });
    let attempts = 0;
    let totalLatency = 0;
    let queueMs = 0;
    for (;;) {
      attempts++;
      const queued = Date.now();
      let t0 = Date.now();
      let status = 0;
      let json: unknown = null;
      let rateHeaders: Record<string, string> = {};
      let error: string | undefined;
      try {
        const res = await run(() => {
          t0 = Date.now();
          queueMs += t0 - queued;
          return fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000),
          });
        });
        status = res.status;
        res.headers.forEach((v, k) => {
          if (k.toLowerCase().startsWith("x-ratelimit")) rateHeaders[k] = v;
        });
        json = await res.json().catch(() => null);
      } catch (e) {
        error = redact(String(e));
      }
      totalLatency += Date.now() - t0;
      // 500 here is usually the provider reporting "no available workers": transient, worth retrying.
      if ((status === 429 || status === 500 || status === 502 || status === 503 || status === 0) && attempts < (cfg.maxAttempts ?? 8)) {
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempts, 10) * 1000 + Math.random() * 500));
        continue;
      }
      const j = json as { choices?: { message?: { content?: string } }[]; usage?: Record<string, number>; error?: { message?: string } } | null;
      const usage = j?.usage ?? {};
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      if (!error && status !== 200) error = redact(`HTTP ${status}: ${j?.error?.message ?? ""}`.slice(0, 300));
      rateHeaders = Object.fromEntries(Object.entries(rateHeaders).map(([k, v]) => [k, redact(v)]));
      return {
        content: j?.choices?.[0]?.message?.content ?? null,
        status,
        latencyMs: totalLatency,
        attempts,
        promptTokens,
        completionTokens,
        platformCost: usage.cost ?? 0,
        estCost: estimateCost(promptTokens, completionTokens),
        queueMs,
        error,
        rateHeaders,
        provider: "amd",
      };
    }
  };
}

/**
 * The same Gemma 4 31B through Google AI Studio's free tier (lab testing only; the game uses AMD).
 * Gemma 4 thinks by default there; `thinkingLevel: "minimal"` is the only accepted way to keep it short.
 * Several keys may be given: when one runs out of quota (429), the next one is used.
 */
export function makeGoogleChat(cfg: Omit<LlmConfig, "key" | "baseUrl"> & { keys: string[] }, limit?: <T>(fn: () => Promise<T>) => Promise<T>): Chat {
  const model = cfg.model ?? "gemma-4-31b-it";
  const run = limit ?? (<T,>(fn: () => Promise<T>) => fn());
  let k = 0;
  const hide = (s: string) => cfg.keys.reduce((t, key) => t.split(key).join("[REDACTED_KEY]"), redact(s));
  return async (messages, opts = {}) => {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const body = JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature: opts.temperature ?? cfg.temperature ?? 0.7, maxOutputTokens: opts.maxTokens ?? cfg.maxTokens ?? 900, thinkingConfig: { thinkingLevel: "minimal" } },
    });
    let attempts = 0;
    let totalLatency = 0;
    let queueMs = 0;
    for (;;) {
      attempts++;
      const queued = Date.now();
      let t0 = Date.now();
      let status = 0;
      let json: unknown = null;
      let error: string | undefined;
      try {
        const res = await run(() => {
          t0 = Date.now();
          queueMs += t0 - queued;
          return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": cfg.keys[k], "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(cfg.timeoutMs ?? 90_000),
          });
        });
        status = res.status;
        json = await res.json().catch(() => null);
      } catch (e) {
        error = hide(String(e));
      }
      totalLatency += Date.now() - t0;
      if (status === 429 && k + 1 < cfg.keys.length) {
        k++; // this key's free quota is used up: switch to the next
        continue;
      }
      if ((status === 429 || status === 500 || status === 502 || status === 503 || status === 0) && attempts < (cfg.maxAttempts ?? 6)) {
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempts, 20) * 1000 + Math.random() * 500));
        continue;
      }
      const j = json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: Record<string, number>; error?: { message?: string } } | null;
      const parts = j?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      const u = j?.usageMetadata ?? {};
      if (!error && status !== 200) error = hide(`HTTP ${status}: ${j?.error?.message ?? ""}`.slice(0, 300));
      return {
        content: text || null,
        status,
        latencyMs: totalLatency,
        attempts,
        promptTokens: u.promptTokenCount ?? 0,
        completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        platformCost: 0,
        estCost: 0,
        queueMs,
        error,
        rateHeaders: {},
        provider: "google",
      };
    }
  };
}

/** Strip a ```json fence and parse; returns null and the reason when it is not JSON. */
export function parseJSON(content: string | null): { value: unknown; error: string | null } {
  if (!content) return { value: null, error: "empty response" };
  const text = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: `not JSON: ${String(e).slice(0, 120)}` };
  }
}
