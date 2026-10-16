# VIRAL — one whisper, a living town, a chain reaction nobody scripted

> Draft for the AMD Developer Hackathon ACT III (Track 4 · Gemma on AMD). Not published; review before submitting.

You are a passing stranger in **霧港鎮 Mistport**, a small town getting ready for tonight's lantern festival.
Click one of eight residents and whisper **one sentence** — anything. Then watch.

Each resident understands it through what *they* know, want, fear and hide; they may laugh it off, doubt it,
phone a friend, go and check for themselves, cover something up, or tell the wrong person. The town plays it out:
people walk over, make calls, inspect the stage, close shops, post notices. When it ends you get the front page of
the 霧港小報 — what your sentence turned into, through whose mouths, and who stopped it.

## What the model does and what the game does

| Gemma 4 31B (on AMD) decides | The engine (authored, deterministic) decides |
|---|---|
| how each resident understands what they heard | the world's truth (17 facts, true and false) |
| what they privately think and feel, and their visible reaction | who knows what (each resident only sees their own knowledge) |
| how much they believe each claim, and why | how far a belief may go (trust, credulity, sources, what they know) |
| whether to act, and what to say in their own words | whether an action is legal and possible (phone numbers, roles, places) |
| | what someone actually sees when they go and look |
| | thresholds for big actions (police, closing the stage, cancelling the festival) |

Every model answer is JSON that the engine parses, normalises and validates; anything invalid goes back to the model
with the reason. Only validated actions change the world, and every event records its causes, so the results card
can trace any outcome back to the sentence. Streamed tokens are used only to start a resident's gesture early; the
world never changes before the full answer is validated.

## Why this needs an LLM
- Free text in: absurd, partial, commanding or misleading sentences all get a reaction in character. In an A/B on
  24 first reactions, Gemma's reaction matched the sentence's meaning 21/24 times vs 11/24 for a keyword-rule
  baseline; commands ("cancel the festival now!") were obeyed 0 times.
- Each hop is a real retelling in the speaker's own words, with what they added highlighted against what they heard.
- Misunderstandings come from motive (the mother of a performer, the organiser hiding an uninspected stage, the
  mayor who likes a false rumour that protects him) — 12/12 misreadings rated as motivated in an assisted rating.
- Scripted rumour systems (Prom Week, Persona 2, Dwarf Fortress) propagate fixed tokens; VIRAL's payload is any sentence.

## AMD / Gemma
- Model: **Gemma-4-31B-IT on AMD Token Factory** (OpenAI-compatible endpoint), streamed, JSON mode.
- Measured on our runs: a decision reads ~1.8k tokens and writes ~200; with streaming the first visible reaction
  arrives in 2.7–9.9 s (mean 4.3 s over 10 stories in batch P5) and the first full decision in 5.8–36.7 s (mean 13–15 s);
  the platform's prompt cache hit rate was ~60%; a long story (22–26 calls) costs US$0.0011–0.0015 as reported by the
  platform. Warming the cache before the first call made no clear difference (A/B, n=4).
- Prepared (not run): self-hosting on an AMD Instinct MI300X with vLLM — `deploy/amd-mi300x/`.

## Run it
```
npm install
# server-side only; never commit it
set TOKENFACTORY_API_KEY=...        (PowerShell: $env:TOKENFACTORY_API_KEY="...")
npm run dev                         # then open the printed localhost URL
```
"📼 錄製的實驗" replays real recorded Gemma runs instantly (clearly labelled; no model calls).

## Lab (evidence)
- `node lab/playtest.ts P1` — real-model playtest batch (10 inputs incl. absurd, fragment, command); logs in `lab/runs/`.
- `node lab/fun-metrics.ts lab/runs/P1` — first visible reaction, longest wait, beats/minute, endings.
- `node lab/e2e.mjs live cafe "…"` — headless browser playthrough with screenshots (`lab/shots/`).
- Tests (no model calls): `node --test lab/test-validators.ts lab/test-engine.ts lab/test-story.ts lab/test-faults.ts`
  — validators, engine invariants, the results card only retelling the log, and model failures / engine rules with a
  scripted fake model.
- `node lab/e2e-prod.mjs http://localhost:3005` — UI-only smoke test against a production build (`next build && next start`).
- Notes: `lab/LAB_NOTES.md` (experiments A–E), `PLAYTEST_REPORT.md`, `OVERNIGHT_PROGRESS.md`.

## What the playtests showed
Six dramatic sentences per batch, real Gemma each time (PLAYTEST_REPORT.md): in P5 they ended four different ways, in
P6 four of six changed the world — e.g. a *false* rumour that the mayor bought a car with stall fees sent the reporter
to the public accounts, where she found the *real* 30% overrun; her exposé made the mayor ask the police to "keep order"
at the stalls, so the headline was 🚓 警察出動到章魚燒攤. Weak sentences (memes, fragments, commands) stop at the first
resident within seconds, by design.

## Known limits
- Waits: a long story needs ~3–6 minutes of model time; playback streams while it runs (thinking beats, cutaways),
  and recordings replay at 2–3×.
- A story stops at 22 model decisions (7 per resident) to bound time and cost; long stories often reach it and the
  card says so honestly.
- Many sentences fizzle at the first resident — by design; the town does not have to care.
- Entertainment value has been assessed with metrics and AI-assisted ratings, not yet with human playtesters.
