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

### Round 4 — independent code review of tonight's work (3 lenses, every finding re-verified)
28 findings, **19 confirmed real and fixed** (`c914a4a`). The ones that mattered most for honesty:
- the story card's "topic changed" check never found the player's own topic, so 7/10 P1 cards claimed a drift that
  did not happen (my bug) → claims are matched to the message that triggered the decision; drift now fires only on
  the 2 runs where the talk really moved (meme → stage, oven → stage);
- bubbles showed a routine-meeting schedule line ("阿德送麵包到咖啡廳") as "聽到的是…" before an unrelated rumour →
  meeting/crowd lines are no longer treated as what someone heard;
- a model failure (fallback) could be shown as the resident's choice ("謠言在 X 這裡踢到鐵板「（沒能做出判斷）」") →
  now "故事在 X 這裡中斷 — 模型沒有給出有效回答";
- belief pills and thread colours showed the listener's latest stance, not their reaction to that message → per message;
- "自己也只信 X%，卻照傳" used the wrong claim and appeared on denials → only when passing on (inform/warn), with the
  confidence in the claim actually carried;
- phone line disappeared at the cut to the listener → it moves over; the player can always take the camera, and a
  new story brings the director back; audio unlocks on every path into playback.

### Round 5 — P2: does the bigger budget let climaxes land?
Same seeds, decision cap 22 / 5 per resident (`lab/runs/P2`). **World changes went from 0/10 (P1) to 2 of the first 3**:
- stage-cafe → **🚧 老周 closed the stage**; 8 residents involved; 志明 tells 阿珠 it is 「例行性的最後安全檢查」; 小雯 investigates.
- oven-police → 老周 looks (nothing), doubts, inspects, **finds the expired sticker** (0.30→0.98), warns the mayor; the
  mayor asks 志明, who only glances (「一切正常」) and reassures him; at the 17:30 interview the relieved mayor brags
  「準備得非常完美」; 小雯 is suspicious, 阿珠 vents about fees → **📰 小雯 publishes 〈完美慶典還是血汗斂財？…〉**.
  A rumour about an oven ended as an exposé about stall fees — every step is in the log.
- Cost of this: ~6.5 min wall time for a long story (28 calls) and 5–7 validator retries per story, caused by my
  stricter stance-index rule (Round 3) → **numbers that can only mean a belief (no claims listed) are mapped again,
  and the prompt now allows `"c2"`** (test 24/24). To be measured in P3.

### Cost correction
The "$" figures in my first report were list-rate *points*. The platform's own `usage.cost` for all 95 P1 calls was
**US$0.0047** (≈ US$0.0008 per long story); today's account usage after ~200 calls: **US$0.0096 of the US$1 limit**.
The provider's prompt-cache hit rate today: **59%** (reported by `/v1/usage`). UI and reports now show the real figure.

### Demo recordings (instant, labelled "📼 錄製的實驗", real Gemma output, no model calls)
`public/recorded/`: P2 stage closed · P2 oven→fee exposé · P1 meme → stage defect (topic drift) · P1 car rumour
checked and found baseless · P1 command → the mayor's suspicion · C1 stage closed (earlier engine version).

### Round 6 — make the story's shape felt, and the ending pay off
From the research's "suspense over surprise" and "the recounting is what gets shared":
- **Act titles** at real thresholds (first retelling · first phone call · first first-hand check · first public act ·
  first institutional act) — e.g. 「第三幕 · 事情鬧大了」. Derived from event types only.
- **Suspense marker** ("Hitchcock's bomb"): when a resident with real power (police, mayor, journalist, organizer)
  believes it at ≥60% and has not acted yet, a pulsing chip shows what they *could* do —「🚧 有權封鎖舞台、派警力？」.
  Capability + belief only, never a prediction.
- **真相揭曉** on the results card and the share card: the world's actual fact about the topic the player raised,
  and whose secret it was (e.g. 「燈籠節的預算超支了三成（林市長的秘密）」 after 小雯 found nothing at the town hall).
  This turns "查無實據" from an anticlimax into an "原來如此".
- **Downloadable front page** (🗞️ 下載小報, canvas PNG) built from the same story card.
- **README draft**, **DEMO_SCRIPT.md** (30-second hook + 2–3 min walkthrough), **deploy/amd-mi300x/** (self-host plan,
  not executed), endpoint switch via `GEMMA_BASE_URL` / `GEMMA_MODEL` / `GEMMA_API_KEY`.

### Round 7 — P3 found an attractor: every road led to the stage
P3 re-ran P2's five inputs after the stance fix (validator retries 27 → 2 per ~100 calls). But three unrelated
sentences (a car-fee scandal, a weak stage, a bakery oven) all ended 🚧 stage closed. Cause, from the logs: the 17:00
police–organizer walk-through (a *routine* meeting) played out whenever either carried **any** belief; 志明 always
does by then, deflects, 老周 inspects and finds the loose strut. Real model behaviour, but the town was reacting to
*whether* something was said, not *what*. Fixes (system rules, no scripted outcomes):
- Routine meetings carry the kinds of talk that belong there (`about`); one is played out only if someone carries
  a belief of that kind, and that belief becomes the cause on the card.
- A second discoverable truth: the journalist can `inspect` the town hall's public accounts (expert check) and
  find the 30% overrun — so budget rumours have their own climax instead of borrowing the stage's.

### Round 8 — P4: the attractor was gone, and so were the climaxes (0/7 world changes)
P4 (7 inputs) had no stage-closure monoculture — but also no world change at all, and stories of 21–183 s instead
of 4–6 min. Reading every log, three distinct causes, two of them my bugs:
1. **The repeat rule ate the confrontation.** 老周 inspected, found the loose strut (0.98), phoned 志明 twice,
   then at 17:00 they met face to face — and both lines were rejected as "已經跟對方說過同一件事了". The scene
   where he would have closed the stage never happened. → A repeat to the same person is now allowed if the
   speaker's confidence moved ≥0.25 since they last said it, or it is the first time *in person* after a call;
   never more than 3 times per claim and person. (Tests added.)
2. **A self-named finding was thrown away.** 小雯 inspected the town hall unprompted and found the overrun — the
   new system working — then her next answer called the finding `c2`; normalisation renamed it "new", dropped the
   stance pointing at "c2", dropped the claim, and her article had nothing to cite → fallback, story over at its
   peak. → Self-named new claims keep their name for stances and citations. (Regression test from that answer.)
3. **"Everything looks normal" was misleading evidence.** 老周 only *looked* around the bakery, was told
   "一切如常", lowered his belief to 0.2 and stopped. A glance can never show an oven's inspection date. → At places
   with things only an expert can check, a casual look now also says (generically, true or false rumour alike)
   that this cannot be judged by looking. Test checks it never names or hints the hidden fact.
Plus a real limit of n=1 batches: oven-police inspected in P2 and only looked in P4 — the model's sampling alone
changes the story. P5 re-runs all ten inputs; conclusions from single runs stay labelled as indicative.

### Round 9 — P5: six dramatic sentences, four different endings
P5 re-ran all ten inputs. The six dramatic ones ended four ways (🚓 police sent to the bakery after 美玲 closed her
own shop to "help a friend"; 📰 the budget exposé after 小雯 read the accounts; 🚧 the stage closed after a *false*
lantern rumour led 老周 to inspect the stage; 🔍 a confirmed defect with no action); weak inputs still stop at once.
Validator retries 5 in 91 calls, no fallbacks. Details and full chains in PLAYTEST_REPORT.md. Changes after reading
every P5 log (all with tests):
- **Listener side of the repeat rule**: hearing the same claim from the same person again no longer re-triggers a
  decision — *except* the first time it is said to your face, or when the speaker is now much surer/less sure.
  (老周 never answered 志明's face-to-face lie at 17:00.)
- **A non-expert's inspection says so honestly** and names who could tell (public roles: police / organiser for the
  stage, police for equipment, the reporter for accounts). 小雯 had "inspected" the stage three times in a row.
- **Story card**: "went to check A, dug up B" is now a headline (「小雯本來在查別的事，卻查出：燈籠節的預算超支了
  三成」) instead of "查無實據"; the truth reveal falls back to the story's first claim when the first listener only
  passed it on; "差一點" needs a ≥0.6 belief of a kind that would justify the move (a budget scandal is no reason to
  cancel a festival; 45% is not a near miss); no gendered pronouns in card templates.
- **Recordings**: P5-oven-police, P5-lantern-baker, P5-budget-journalist added first; P1-car-vendor and the
  old-engine C1 removed. DEMO_SCRIPT's hook is now the oven chain ("she only wanted to help").
- **Production check**: `next build` passes (TypeScript clean) in a separate worktree; `next start` + a UI-only
  playthrough (`lab/e2e-prod.mjs`) shows **0 console errors**. The 8 "synchronously unmount a root" warnings seen in
  dev replays come from React StrictMode's dev-only double mount of drei `<Html>` (4 bubble slots + 4 power chips),
  not from playback. `eslint` reports 23 React-Compiler rule hits in r3f frame-loop code (mutating three.js objects
  in `useFrame`, timers in render) — idiomatic for r3f, not runtime errors; left as is to avoid touching visuals.

### Round 10 — P6: 4/6 stories change the world, in different ways
After the post-P5 fixes, the six dramatic inputs gave: stage closed after a face-to-face confrontation; police sent to
the takoyaki stall after a *false* car rumour led to a *true* budget exposé and the mayor wanted protests contained;
police + stage after the lantern rumour; exposé → police → vendors rallying at the town hall; a confirmed oven defect;
a 3-person pigeon chat. Changes: the card's subtitle now names the earlier big happenings that caused the headline
(「先是小雯發文〈…〉，最後老周派出警力」, causal ancestors from the log); P6-car-vendor added as a recording;
no walk-home-and-back when the next decision is already queued (test verified to fail without the fix).
Cache warm-up A/B: no clear effect (cold 2.9 s vs warm 2.4 s mean first token, n=4, overlapping) — not implemented.

### Round 11 — a live playthrough ended at the first step; now the refusal is the story
A headless *live* game (real Gemma, the oven sentence to 老周) ended after one decision: he wanted to send officers to
the bakery at once; one stranger's sentence caps his certainty below the 0.5 that a dispatch needs; the retry message
did not say so (the model only sees its own 0.6), he insisted, and after two tries the engine replaced everything with
"😶 愣住（沒能做出判斷）". Two changes (tests from that exact answer):
- Retry messages for big actions now state the engine-bounded confidence and why (「以你目前的消息來源，你對它的把握
  其實只有 0.45：只是聽人說的…」).
- If, after the tries, the resident's *reading* is valid and only an action breaks a rule, their real thinking and
  belief are kept, allowed actions still run, and each refused one becomes a visible ✋ beat
  (「老周想派警力到阿德麵包店，但把握還不夠」); the story card can end on it. Counted separately as `refusedWishes`
  (not a fallback, not a retry). Model outages and unparseable answers still fall back to the honest "中斷" ending.
Also: the café umbrellas fade when a resident in shot stands under one (a 16:30 café scene was all canopy); the
"found" bubble now shows the "a glance can't tell" line that motivates the next inspection.

### Round 12 — second samples (P8, P9): variance, the investigator's budget, three card fixes
- P7 and P8 ran the *same* configuration: 5/6 vs 2/6 dramatic stories changed the world — single runs vary a lot.
  P8's stage story stopped because the mayor asked 老周 to hold off (in character) and then 老周 used his 7th decision
  on a second inspection. Per-resident cap 7 → 9 (global 22 unchanged). P9: 4/6; **P7–P9 together 11/18**.
- Story card: "差一點" picks the surest resident and the relevant move (「老周明明可以封鎖舞台，最後卻選擇親自去檢查」);
  no false "drift" when the player's sentence already said it; among equally big happenings the later (the outcome)
  is the headline. Recording headlines recomputed (unchanged).
- AMD usage check: US$0.041 of the US$1 daily limit used by the end of these batches (platform `/v1/usage`).

## 2. Measurements so far

| What | Value | Kind |
|---|---|---|
| AMD Token Factory, 257 earlier calls: prompt ≈ 1,800 tok, output ≈ 200 tok, median 17.5 s, p90 44 s | | [measured] |
| AMD streaming probe, short prompt: first token 3.4–9.0 s, then 54–82 tok/s | | [measured] |
| AMD, 2,600-token prompt twice: first token 6.6 s → 2.7 s on the cached second call (2,600/2,601 tokens cached) | | [measured] |
| AMD cache warm-up A/B, 4 pairs: first token cold mean 2.9 s (1.9–4.0) vs warm 2.4 s (1.7–2.7) — no clear effect | | [measured] |
| Playtests P5–P9 (38 stories): first visible reaction batch means 3.5–5.4 s, first full thought 10.2–15.1 s, 9.5–11.8 beats/min | | [measured] |
| Dramatic inputs changing the world, final configurations P7–P9: 11/18 (per batch 5/6, 2/6, 4/6) | | [measured] |
| AMD platform cost for the whole night's testing: US$0.041 (daily limit US$1); a long story ≈ US$0.001–0.0015 | | [measured] |
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

1. **No human playtest yet.** Entertainment value is argued from metrics (first reaction ~4–5 s, ~10 beats/min,
   endings) and from reading every log, not from players. 3–5 people watching recordings + one live try would
   settle "is it fun to watch" far better than more batches.
2. **n = 1 per input per batch.** The same sentence ends differently on different runs (P2 vs P5 vs P6 oven). That is
   the product working, but rates ("4/6 changed the world") are indicative only; run 3× per input before quoting
   rates in the submission.
3. **The 22-decision cap** is reached by most long stories (8 of 12 dramatic runs in P5–P6); endings are fine, but the
   tail (e.g. the mayor's spin statement) gets cut. Options: prioritise residents with power when the budget runs low,
   or 26–30 for recordings only. Not changed tonight.
4. **Wall time** of long stories is 3–6.5 min; live play streams it, the demo uses recordings at 2–3×.
5. **Dev-only warnings**: React StrictMode double-mounts drei `<Html>` → 8 console warnings in dev; production has 0.
6. **Lint**: 23 React-Compiler rule hits in r3f frame-loop code; not runtime errors; left alone.
7. **Needs your decision**: deployment target and when; public repo contents; the submission video (DEMO_SCRIPT.md
   has a hook and walkthrough); MI300X self-hosting only if you add credit / approve cost.
