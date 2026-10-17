// Gemma on AMD Token Factory (OpenAI-compatible). Pure fetch: the caller passes the key in, so this
// module never reads secrets itself and can be shared by the lab CLI and the server route.
// Never import it from client components.

export const DEFAULT_BASE_URL = "https://developer.amd.com.cn/radeon/api/v1";
export const DEFAULT_MODEL = "Gemma-4-31B-IT";
// Published Token Factory list rate for Gemma-4-31B-IT, points per 1M tokens (input / output).
const RATE_IN = 0.5;
const RATE_OUT = 3.0;

/**
 * One resident decision's whole time budget: every attempt in mind.ts and every retry inside the chat client,
 * waits included. Half the server route's 300 s maxDuration, so one route call (which never gets more than this)
 * always finishes inside it. Two 60 s timeouts and a normal answer still fit; in P20 (lab, three stories at once)
 * 9 of 144 decisions took longer, each after repeated 60 s stalled streams.
 */
export const DECISION_BUDGET_MS = 150_000;

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
  /** total ms for one call, every attempt and back-off included (default: only maxAttempts limits it) */
  budgetMs?: number;
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
  /** streamed calls: ms from sending the request to the first generated text */
  ttftMs?: number;
  /** which service answered: "amd" (Token Factory) or "google" (AI Studio free tier, used for lab volume tests) */
  provider?: string;
}

/** Callers that need a model: the lab passes a real client, tests pass a recorded one. An aborted `signal` (the
 *  player left the story, or the decision's time is spent) ends the call in flight and every retry after it. */
export type Chat = (messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number; onDelta?: (textSoFar: string) => void; signal?: AbortSignal }) => Promise<LlmCall>;

/** Sleep for ms, waking early when the signal aborts. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

const KEY_RE = /rc-[0-9A-Za-z]{8,}|AIza[0-9A-Za-z_-]{20,}/g;
export const redact = (s: string) => s.replace(KEY_RE, "[REDACTED_KEY]");

export function estimateCost(promptTokens: number, completionTokens: number) {
  return (promptTokens * RATE_IN + completionTokens * RATE_OUT) / 1_000_000;
}

/**
 * Spaces requests so a single process stays under the account's requests-per-minute limit. A slot is held until
 * `fn` settles, so `fn` must cover the whole request, body included: a stream holds its slot until it is fully read
 * or aborted. A caller whose signal aborts while still waiting leaves the line and never runs `fn`.
 */
export function rateLimiter(perMinute: number, maxConcurrent: number) {
  const starts: number[] = [];
  let active = 0;
  const waiters: (() => void)[] = [];
  const slot = (signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        signal?.removeEventListener("abort", done);
        const i = waiters.indexOf(done);
        if (i >= 0) waiters.splice(i, 1);
        resolve();
      };
      waiters.push(done);
      signal?.addEventListener("abort", done);
    });
  return async function run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    while (active >= maxConcurrent && !signal?.aborted) await slot(signal);
    if (signal?.aborted) {
      if (active < maxConcurrent) waiters.shift()?.(); // pass on a wake-up this caller may have been given
      throw signal.reason;
    }
    active++;
    try {
      for (;;) {
        const now = Date.now();
        while (starts.length && now - starts[0] > 60_000) starts.shift();
        if (starts.length < perMinute) break;
        await pause(60_000 - (now - starts[0]) + 50, signal);
        if (signal?.aborted) throw signal.reason;
      }
      starts.push(Date.now());
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

export function makeChat(cfg: LlmConfig, limit?: <T>(fn: () => Promise<T>, signal?: AbortSignal) => Promise<T>): Chat {
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const model = cfg.model ?? DEFAULT_MODEL;
  const run = limit ?? (<T,>(fn: () => Promise<T>) => fn());
  return async (messages, opts = {}) => {
    const stream = !!opts.onDelta;
    const body = JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? cfg.maxTokens ?? 900,
      temperature: opts.temperature ?? cfg.temperature ?? 0.7,
      response_format: { type: "json_object" },
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    });
    // one budget for the whole call, retries and back-offs included; the caller's signal ends it at once
    const until = cfg.budgetMs ? Date.now() + cfg.budgetMs : Infinity;
    const over = () => !!opts.signal?.aborted || Date.now() >= until;
    let attempts = 0;
    let totalLatency = 0;
    let queueMs = 0;
    let ttftMs: number | undefined;
    for (;;) {
      attempts++;
      ttftMs = undefined;
      const queued = Date.now();
      let t0 = Date.now();
      let status = 0;
      let json: unknown = null;
      let rateHeaders: Record<string, string> = {};
      let error: string | undefined;
      try {
        // the body is read inside the limiter too: a streamed answer keeps its slot until it is complete
        await run(async () => {
          t0 = Date.now();
          queueMs += t0 - queued;
          const timeout = AbortSignal.timeout(Math.max(1, Math.min(cfg.timeoutMs ?? 60_000, until - t0)));
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
            body,
            signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
          });
          status = res.status;
          res.headers.forEach((v, k) => {
            if (k.toLowerCase().startsWith("x-ratelimit")) rateHeaders[k] = v;
          });
          if (stream && status === 200 && res.body) {
            // server-sent events: collect the text, report it as it grows, keep the final usage
            opts.onDelta!("");
            let text = "";
            let usage: Record<string, number> | undefined;
            let buf = "";
            const dec = new TextDecoder();
            for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
              buf += dec.decode(part, { stream: true });
              let nl;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                  const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: Record<string, number> };
                  const d = j.choices?.[0]?.delta?.content;
                  if (d) {
                    if (ttftMs === undefined) ttftMs = Date.now() - t0;
                    text += d;
                    opts.onDelta!(text);
                  }
                  if (j.usage) usage = j.usage;
                } catch {
                  /* a partial line; the rest arrives with the next chunk */
                }
              }
            }
            json = { choices: [{ message: { content: text } }], usage: usage ?? {} };
            if (!text) status = 0; // an empty stream is a failed call
          } else json = await res.json().catch(() => null);
        }, opts.signal);
      } catch (e) {
        error = redact(String(e));
      }
      totalLatency += Date.now() - t0;
      // 500 here is usually the provider reporting "no available workers": transient, worth retrying.
      if ((status === 429 || status === 500 || status === 502 || status === 503 || status === 0) && attempts < (cfg.maxAttempts ?? 8) && !over()) {
        await pause(Math.min(Math.min(2 ** attempts, 10) * 1000 + Math.random() * 500, until - Date.now()), opts.signal);
        if (!over()) continue;
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
        ttftMs,
        provider: baseUrl === DEFAULT_BASE_URL ? "amd" : "amd-selfhost",
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
