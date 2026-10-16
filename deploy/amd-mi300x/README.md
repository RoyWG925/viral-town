# Self-hosting Gemma 4 31B on an AMD Instinct MI300X (prepared, not executed)

**Status:** prepared only. No GPU was created and no money was spent: creating an AMD Developer Cloud droplet
needs the account owner's credit (the AI Developer Program's US$100 had not arrived) or a payment method.

## Why
The shared Token Factory endpoint is limited to 20 requests/min and US$1/day, and its speed varies with load:
first token 2.7–9 s and 9–82 tokens/s **[measured]**; a decision takes 17.5 s median **[measured, 257 calls]**.
A dedicated MI300X running vLLM is reported at **58 tok/s (bf16) / 71 tok/s (fp8) for a single Gemma 4 31B
request [3rd-party: xbill, DEV Community, Oct 2026]**, which would make a ~200-token decision about 3–4 s and a
whole story ~15–20 s of model time **[estimate — measure before claiming it]**. It also removes the per-minute and
daily limits.

## Steps (account owner)
1. AMD Developer Cloud → "My AMD Home": check the US$100 credit; if absent, adding a card enables pay-as-you-go
   (~US$1.99/h for 1×MI300X per lablab's tutorial — check the live price). Create a **1×MI300X** droplet from the
   **vLLM Quick Start** image. **Destroy** it when done (powered-off droplets are still billed).
2. On the droplet: `export VLLM_API_KEY=<long random secret>` then `bash serve.sh`.
3. Point the game server at it — no code change:
   ```
   GEMMA_BASE_URL=http://<droplet-ip>:8000/v1
   GEMMA_MODEL=google/gemma-4-31B-it
   GEMMA_API_KEY=<the same secret>
   ```
   Unset them to fall back to Token Factory. Calls are recorded with `provider: "amd-selfhost"`.
4. Measure: `GEMMA_BASE_URL=… GEMMA_MODEL=… GEMMA_API_KEY=… LAB_RPM=60 LAB_PARALLEL=3 node lab/playtest.ts S1 stage-cafe,meme-organizer`
   and compare `firstEarlyMs` / `latencyMs` with batches P1/P2 in `PLAYTEST_REPORT.md`.

## Staged plan if something fails
1. bf16, plain (above) — the configuration with published numbers.
2. Speculative decoding with the MTP drafter `google/gemma-4-31B-it-assistant`: reported 3.19× on H100;
   **unverified on ROCm for 31B**.
3. fp8 checkpoint (1.2–1.45× faster in the 3rd-party sweep).

Reported ROCm gotchas: Gemma 4 needs a Gemma-4-capable ROCm vLLM image; keep the Triton attention backend;
do not enable AITER (slower in the sweep).
