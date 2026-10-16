# VIRAL — Overnight progress (2026-10-17, from 01:45 Taipei)

Deadline: **2026-10-18 18:00 Taipei** (lablab ACT III). Everything below is local; nothing was published,
pushed or deployed. Checkpoints are local git commits (`git log`).

Legend for numbers: **[measured]** = from our own runs/logs, **[3rd-party]** = someone else's benchmark,
**[estimate]** = reasoning, not measured.

---

## 1. What changed tonight (round by round)

### Round 0 — inventory and safety
- Local git checkpoint of the working version before any change (`baf7649`). `.env*` is git-ignored; keys
  scanned before every commit (only false positive: a React version string in package-lock).
- Google AI Studio free-tier key added by the user in `.env.local` (`GEMINI_API_KEY`, `GEMINI_API_KEY_2`).
  Never printed, never committed.

### Round 1 — make Gemma's cognition visible on screen
Problem: the simulation was rich but the screen showed "A tells B, B believes" as captions; residents stood
still while text appeared at the bottom.

Research (4 parallel researchers: watchability, systemic comedy, camera direction, emergent narrative —
sources in `lab/research/`): the strongest shared conclusions were
1. *legibility over depth* (Sylvester's "Simulation Dream"): only cognition that reaches the screen counts;
2. *suspense over surprise* (Hitchcock): show who just heard what and that they are thinking — latency becomes anticipation;
3. *show the cause next to the effect* (RimWorld mood lines): belief % with the line that caused it;
4. *the recounting is what gets shared* (story sifting, Dwarf Fortress legends): a curated recap built only from the log;
5. never fake: no content before the model answers, no LLM-written recap, no invented crowd beliefs.

Built:
- **Acting library chosen by Gemma** (`src/sim/acts.ts`): 12 visible reactions (ponder, doubt/arms crossed,
  nervous look-around, startled step-back, giggle behind hand, angry stomp, shrug, excited bounce, facepalm,
  whisper lean, worried hand-wringing, determined fist). Gemma returns `act`; the engine maps unknown values
  from the feeling (never rejects — presentation only). Talking/listening get their own gestures by intent
  (warn = pointing, ask = palms up, deny = waving no…). Walk pace follows the act (startled/determined hurry,
  doubt/shrug dawdle). Implemented as pose layers over the procedural townsfolk (`src/town/Crowd.tsx`).
- **In-town lines** (`src/town/Says.tsx`): speech bubbles above the speaker show the exact retold line, the
  version they had heard, and the 1–3 biggest changes highlighted (character LCS diff, names/greetings ignored);
  thought clouds show the inner monologue, what they understood, and a belief bar from the engine's stored
  confidence; "親眼看到" cards for inspections (the thing they came to check first — engine now orders checks by
  what the looker was wondering about); honest tag 「自己也只信 40%，卻照傳」 when someone passes on what they
  only half believe.
- **Camera director** (`director.ts` shots + `TownScene.tsx` CameraRig): shot per event type — close on a
  thinker, two-shot for a conversation, close on the caller then cut to the listener on phone calls, medium
  leading toward the destination when someone walks, wide on world changes, overview of everyone the thought
  reached at the end. Priorities + 1.2 s minimum hold; viewing angle never spins; the moment the player drags
  the camera, the director steps aside ("🎬 自動導演 / 🎥 自由鏡頭" toggle).
- **Bystanders** turn and react to real public changes only (presentation, they hold no beliefs).
- **Threads** between residents coloured by what the listener made of it (red believed / amber unsure / grey rejected).
- **Thinking beat**: while a model call is pending the resident ponders, a dots line with a real seconds
  counter shows — no words until the answer exists.
- **Results story card** (`src/town/story.ts`, `StoryCardView.tsx`): headline of the biggest real outcome,
  the chain of retellings that led there with each listener's belief, and — when the rumour died — who it died
  with (quoting their own thought) and the "closest call" (someone who could have done something big and what
  they actually did). Template-only, from validated events.

### Round 2 — latency: stream the first reaction, keep decisions honest
- `llm.ts` streams (SSE) when asked; `/api/gemma` forwards it as NDJSON; `feeling` and `act` are now the first
  fields of the JSON. As soon as both are complete the resident starts acting them out — **before** the decision
  is complete. Nothing changes the world until the full answer is parsed and validated.
- `ttftMs` recorded per call.
- Bug found by the first real playtest: `coerce()` dropped the new `act` field, so every act fell back to the
  feeling map. Fixed + regression test.

---

## 2. Measurements so far

| What | Value | Kind |
|---|---|---|
| AMD Token Factory, 257 earlier calls: prompt ≈ 1,800 tok, output ≈ 200 tok, median 17.5 s, p90 44 s | | [measured] |
| AMD streaming probe, short prompt: first token 3.4–9.0 s, then 54–82 tok/s | | [measured] |
| AMD, 2,600-token prompt twice: first token 6.6 s → 2.7 s on the cached second call (2,600/2,601 tokens cached) | | [measured] |
| Google AI Studio free tier, Gemma 4 31B, decision-sized call (1,849 in / 90 out): **177 s** | | [measured] |
| First playtest story (pigeon-baker, AMD, streamed): first visible reaction **6.8 s**, first full decision 16.6 s | | [measured] |
| Gemma 4 31B on one MI300X (vLLM): 58 tok/s bf16, 71 tok/s fp8 single request | | [3rd-party] (xbill, DEV, Oct 2026) |
| Self-hosted MI300X decision: ~2–4.5 s; story ~15–20 s of model time | | [estimate] |

Google free tier is far too slow for interactive use; it is kept only for slow background regression batches.

---

### Round 3 — first real playtest batch (P1, 10 inputs on AMD) and what it changed
See `PLAYTEST_REPORT.md` for every case. Findings that changed the build:
1. **The decision cap cut off the climaxes** (5/6 long stories ended on the 16-decision cap, e.g. right after
   老周 confirmed the loose strut at 0.98 and 志明 begged him to keep quiet). → 22 decisions / 5 per resident.
2. **A wrong belief got stored** when the model numbered its stances against a different list (美玲 "relieved"
   but stored 0.80 that the lanterns burn). `normalize()` had guessed; ambiguous numbers are now sent back.
3. **`act` was dropped while parsing** → fixed; tests added (validators 23/23).
4. **Story card honesty**: "一句話傳到了 6 個人" was wrong when the town drifted to another topic → drift headline
   quoting the turning line; first-hand checks can headline; checks about the player's actual topic win;
   "two people bouncing it back and forth" is named. `lab/test-story.ts` 4/4 over rule runs, recordings and P1.
5. Acts over-used `shrug` for "do nothing" → prompt asks for the real feeling.

### Decision: should the player act during the show?
Options weighed (brief §七): A watch only (camera), B one more sentence when it dies, C limited second
intervention, D bets/predictions.
- Evidence: 4/10 P1 inputs died at the first resident — all of them *weak sentences* (absurd, fragment,
  command). The other 6 ran 86–200 s of content with 3–7 residents involved; there the player is watching, and a
  mid-show prompt would interrupt exactly the part that works.
- A fizzle is now a short, quotable ending ("🧱 謠言在林市長這裡踢到鐵板 —「想害我出醜嗎？」") followed by
  one-click What If (same sentence to someone else / new sentence), which already gives the "try again" loop.
- A second whisper costs another 5–25 s model wait mid-show and muddies "I only said ONE sentence".
- **Chosen: A (watch, with auto director / free camera) + the What If loop. No second intervention.** Revisit
  only with human playtest evidence that players feel helpless mid-show. (A "continue the same evening" mode
  that keeps residents' beliefs is the natural next step if that evidence appears.)

## 3. Open problems / next

(updated as the night goes on)
