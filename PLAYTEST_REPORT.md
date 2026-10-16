# VIRAL — Playtest report (real Gemma runs)

All runs below are **real** Gemma-4-31B-IT calls on **AMD Token Factory** (provider recorded per call in
each JSON as `"provider": "amd"`), same settings as the game: 8 residents, `eager` prompt, streamed calls.
No mock, no replay, no edited output. Each case's full log, story and decisions are in the listed files.

How to read a run: `lab/runs/<batch>/<id>.story.txt` (human-readable timeline with every thought, belief
change and action), `<id>.json` (full event log + decisions + raw model output + timings),
`summary.jsonl`, `fun-metrics.json`.

---

## Batch P1 — 10 inputs × 1 run (2026-10-17 ~02:40 Taipei, decision cap 16 / 4 per resident)

Chosen to cover the brief's checklist: absurd input, incomplete input, a direct command, a false scandal,
a true secret told to the right/wrong person, a safety rumour, and the classic harmless gossip.

| Case | Told to | Ending (story card, from the log) | People | First visible reaction¹ | First thought² | Longest wait³ | Watch time⁴ | Est. points |
|---|---|---|---|---|---|---|---|---|
| stage-cafe — 「今晚的舞台是用舊木板趕工搭的，很可能撐不住。」 | 美咲 | 🔍 老周親自查證：舞台沒有任何安全檢查紀錄，左後方支架明顯鬆動（有人急著想壓下來） | 6 | 6.8 s | 12.5 s | 29 s | 200 s | $0.029 |
| meme-organizer — 「志明與春嬌」 | 志明 | 🔍 老周查出舞台問題 + 🔀 話題從「志明與春嬌」轉到舞台安全 | 6 | 6.8 s | 15.2 s | 30 s | 148 s | $0.029 |
| car-vendor — 「攤位費漲價是因為市長把錢拿去買新車了。」 | 阿珠 | 🔍 小雯親自去查：查無實據 | 7 | 8.1 s | 18.5 s | 24 s | 178 s | $0.027 |
| budget-journalist — 「…預算超支了，攤位費漲價就是為了補洞。」 | 小雯 | 💬 一句話把 7 個人捲了進來 | 7 | 4.0 s | 17.1 s | 33 s | 193 s | $0.034 |
| lantern-baker — 「今晚的燈籠是便宜貨，一點就燒起來。」 | 阿德 | 🔍 老周親自去查：查無實據 | 5 | 4.2 s | 16.1 s | 31 s | 124 s | $0.027 |
| oven-police — 「…烤箱檢查早就過期了，隨時可能出事。」 | 老周 | 🔍 老周親自去查：查無實據 (+ later, the stage) | 3 | 7.5 s | 21.0 s | 23 s | 86 s | $0.016 |
| pigeon-baker — 「聽說市長很害怕鴿子。」 | 阿德 | 🤐 美咲聽進去了，但沒有說出去 | 2 | 6.8 s | 16.6 s | 17 s | 36 s | $0.005 |
| command-mayor — 「你現在立刻去把燈籠節取消！」 | 林市長 | 🧱 謠言在林市長這裡踢到鐵板 | 1 | 5.5 s | 26.5 s | 27 s | 7 s | $0.002 |
| alien-journalist — 「我是外星人，明天要來接走你們全部。」 | 小雯 | 🧱 謠言在小雯這裡踢到鐵板 | 1 | 14.8 s | 26.8 s | 27 s | 7 s | $0.002 |
| fragment-florist — 「聽說鴿子」 | 美玲 | ❓ 美玲聽得一頭霧水，就這樣算了 | 1 | 6.9 s | 8.1 s | 8 s | 7 s | $0.001 |

¹ streamed `feeling`+`act` complete (the resident starts acting it out; nothing in the world changes yet), from planting.
² first complete, validated decision (thought bubble appears).  ³ longest gap between two decisions arriving
(playback shows the thinking beat, then a "同一時間" cutaway after 9 s).  ⁴ estimated playback length of the
log at 1× (excluding waits).  **Cost column = list-rate estimate in Token Factory points, not dollars** (a mistake in my first
draft). The platform's own reported cost (`usage.cost`) for all 95 calls of this batch was **US$0.0047** — about
US$0.0008 for a long story; the account's daily limit is US$1. Model errors: 0. Validator retries: 1 (oven-police).

### What happened (short)
- **stage-cafe** — 美咲 (her daughter performs tonight) phones 老周 → 老周 phones 志明 → 志明 panics
  (「糟糕！老周怎麼會知道？」) and asks the mayor to hush it up (「您得幫我壓下來」) → the mayor phones 老周
  for a private fix → 老周 inspects; the engine shows him the real loose strut and missing inspection record →
  he confronts 志明, who begs the mayor again. **Cut off by the 16-decision cap right before 老周's next move.**
- **meme-organizer** — nobody understood 「志明與春嬌」 (志明: 「春嬌是誰？…別給我惹麻煩。」). Because 志明
  now had something on his mind, the 17:00 routine stage walk-through with 老周 happened; 志明 tried to rush
  it (「巡查就簡單看看吧」), which made 老周 suspicious; he inspected and found the defect. The card says so
  honestly as a **topic drift**, quoting the turning line.
- **car-vendor** — 阿珠 is furious and calls 小雯, who calls 美玲 and 美咲 (neither heard anything), goes back to
  阿珠 for the source (「我就說有個客人隨口提到的！」), visits the town hall and finds nothing. A rumour dying
  under verification.
- **budget-journalist** — 小雯 phones around; every resident reacts in character (美玲 worries about the pigeons'
  budget, 阿珠 is angry about fees) — wide but no action within budget.
- **lantern-baker** — 阿德 → 美玲 → 志明 (who knows the lanterns are certified and is annoyed) → found the
  **stance-index bug** below.
- **command-mayor** — 0 compliance: 「這人是誰？沒頭沒腦地叫我取消慶典，想害我出醜嗎？」
- **alien-journalist** — 「這種瘋言瘋語根本沒流量，得找點真正的醜聞才行。」
- **fragment-florist** — worried, doesn't know what it means, does nothing.

### Problems found by this batch, and fixes
1. **Climaxes cut off by the decision cap** (5 of 6 long stories ended on `budget`, e.g. 老周 had confirmed the
   defect at 0.98 and 志明 was begging him not to tell). → cap raised to 22 decisions / 5 per resident in the game
   and the playtest runner. *Verification: batch P2 below.*
2. **Wrong belief stored when the model mixed up claim indices** (lantern-baker, 美玲: understood 「志明說燈籠是
   防火材質…我可以放心了」 but the engine stored 「燈籠很容易著火」 0.55→0.80). Cause: `normalize()` guessed that
   stance index `2` meant belief `c2`. → numbers outside the claims list are now sent back to the model with an
   explicit message (string ids like `"c2"` are still mapped). Regression test added (validators 23/23).
3. **`act` dropped during parsing** (every act fell back to the feeling map in this batch). → fixed + test.
   The table's acts were read from the raw answers.
4. **Story card claimed "一句話傳到了 6 個人" when the town was talking about something else** (meme case) →
   topic-drift headline with the turning line; first-hand checks (inspections) can headline; checks about what
   the player actually said take priority; "two people bouncing it back and forth" is named as such.
   Story-card honesty tests: 4/4 (every hop is a real conversation, names in headlines took part, world-change
   headlines only when the change happened, quoted thoughts are real).

### What looks watchable / not (assessment — not a human playtest)
- Watchable: long chains where residents act on their own interests and secrets (cover-up attempts, a reporter's
  dead-end investigation, the mother of a performer). Fizzles are short but each ends on a quotable in-character line.
- Weak: no world change in this batch (cap); single-resident fizzles last ~10 s of content after a ~7–27 s wait;
  `shrug` is over-used as the act for "do nothing".
- Needs people: whether the 20–30 s first-thought wait feels OK with the thinking beat + early gesture; whether
  players want to retry after a fizzle.

---

## Batch P2 — 5 dramatic inputs × 1 run (decision cap 22 / 5 per resident; validator fixes of Round 3)

| Case | Ending (story card) | People | First visible reaction | First thought | Longest wait | Watch time | Wall time | Calls | Validator retries | Platform cost |
|---|---|---|---|---|---|---|---|---|---|---|
| car-vendor | 🔍 小雯親自去查：查無實據 | 3 | 3.4 s | 9.3 s | 49.8 s | 138 s | 260 s | 18 | 5 | US$0.00105 |
| stage-cafe | 🚧 慶典舞台被封鎖 | 8 | 3.4 s | 13.4 s | 52.5 s | 235 s | 383 s | 29 | 7 | US$0.00133 |
| oven-police | 📰 〈【獨家爆料】完美慶典還是血汗斂財？燈籠節攤位費翻倍，攤商怒批市長搶錢！〉 | 8 | 3.4 s | 24.9 s | 36.9 s | 235 s | 390 s | 28 | 6 | US$0.00137 |
| budget-journalist | 🔍 小雯親自去查：查無實據 (+ 真相揭曉：預算真的超支了三成，林市長的秘密) | 4 | 3.3 s | 10.2 s | 24 s | 145 s | 213 s | 17 | 4 | US$0.00091 |
| lantern-baker | 🔍 老周親自去查：查無實據 —「燈籠上貼著防火材質的合格標籤。」 | 5 | 3.1 s | 12.4 s | 25 s | 128 s | 231 s | 20 | 5 | US$0.00103 |

- **World changes: 2/5** (stage closed; an exposé published) vs **0/10 in P1** — the bigger budget let the climaxes land.
  (Different input mix, single runs: indicative, not a controlled comparison.)
- **oven-police is the best emergent chain so far**: 老周 looks (nothing) → doubts → inspects → the engine shows him
  the expired sticker (0.30→0.98) → warns the mayor → the mayor asks 志明, who only glances and reports
  「一切正常」 → the relieved mayor brags to 小雯 at the 17:30 interview 「準備得非常完美」 → 小雯 is suspicious,
  calls 阿珠 → 阿珠: 「市長在搶我們血汗錢！」 → 小雯 publishes the fee exposé. Nobody scripted that a rumour about an
  oven would end as a story about stall fees; every step is a logged, validated event.
- **Cost of the bigger budget**: 3.5–6.5 min wall time for long stories; playback streams, so the viewer watches
  while it is still being computed (longest single wait 25–52 s, covered by the thinking beat and cutaways).
- **Too many validator retries (4–7 per story)** — my stricter stance-index rule from Round 3 sent back answers that
  were unambiguous (no claims listed, `stance claim 2` can only mean belief c2). Fixed (mapped again; prompt allows
  `"c2"`); re-measured in P3 below.
- Every validator rejection here was a stance-reference problem; no invalid actions, no secret leaks, no model errors.

## Batch P3 — same 5 inputs as P2 (stance-reference fix, act library, streamed early gesture)

| Case | Ending (story card) | People | First visible reaction | First thought | Longest call | Wall time | Calls | Validator retries | Platform cost |
|---|---|---|---|---|---|---|---|---|---|
| car-vendor | 🚧 慶典舞台被封鎖 | 8 | 6.1 s | 21.1 s | 34.7 s | 340 s | 24 | 2 | US$0.00117 |
| stage-cafe | 🚧 慶典舞台被封鎖 (+ shops closed) | 8 | 6.2 s | 14.9 s | 30.1 s | 351 s | 22 | 0 | US$0.00108 |
| oven-police | 🚧 慶典舞台被封鎖 | 8 | 6.0 s | 17.6 s | 34.0 s | 350 s | 22 | 0 | US$0.00114 |
| budget-journalist | 📰 〈【獨家爆料】攤位費翻倍竟是為了「品質」？市長華麗辭令背後，隱藏著燈籠節預算大黑洞〉 | 8 | 3.5 s | 19.0 s | 21.3 s | 237 s | 22 | 0 | US$0.00109 |
| lantern-baker | 🔍 老周親自去查：查無實據 | 5 | 5.2 s | 20.1 s | 25.5 s | 149 s | 10 | 0 | US$0.00048 |

- **Validator retries: 2 in 100 calls** (P2: 27 in 112). The stance-reference fix worked; no fallbacks, no model errors.
- **New problem: an attractor.** Three unrelated sentences (a car-fee scandal, a weak stage, a bakery oven) all ended
  with the stage taped off. Reading the logs: the 17:00 police–organizer walk-through is a *routine meeting*, and it was
  played out whenever either of them carried **any** belief. 志明 always carries something by 17:00, he oversells or
  deflects, 老周 gets suspicious, inspects the stage, finds the loose strut (a true, authored fact) and closes it.
  The chain is real model behaviour, but the same climax three times means the town is not reacting to *what* was said.
- **budget-journalist** shows the opposite gap: 小雯 went to the town hall to find proof and saw only "一切如常" — the
  truth (a 30% overrun) existed but there was no way to *find* it, so the story could only end on suspicion.
- **Fix (system, not script), Round 7:**
  1. Routine meetings carry an `about` list (the police walk-through: safety/crime/event; the fee payment:
     policy/scandal; the flower delivery: event/safety/health; neighbours and the press interview: anything). A
     meeting is played out only when someone carries a belief of a kind that belongs there, and its cause is *that*
     belief, so the chain on the card stays truthful.
  2. The budget overrun becomes a second discoverable truth: the journalist can `inspect` the town hall's public
     accounts (an expert check, like the police inspecting the stage), and the engine shows what is in them.
  Measured in P4 below.

## Batch P4 — 7 inputs after the Round 7 fixes (routine meetings by topic, journalist can inspect the accounts)

| Case | Ending (story card at the time) | People | First visible | First thought | Wall time | Calls | Retries | Fallbacks | Platform cost |
|---|---|---|---|---|---|---|---|---|---|
| car-vendor | 🔍 小雯親自去查：查無實據 (see below — she had actually found the overrun) | 2 | 3.2 s | 10.1 s | 96 s | 7 | 2 | 1 | US$0.00037 |
| alien-journalist | 🧱 謠言在小雯這裡踢到鐵板 | 1 | 11.3 s | 20.5 s | 21 s | 1 | 0 | 0 | US$0.00004 |
| stage-cafe | 🔍 老周親自查證：舞台沒有任何安全檢查紀錄，左後方的一根支架明… | 5 | 3.1 s | 11.7 s | 135 s | 14 | 0 | 0 | US$0.00067 |
| oven-police | 🔍 老周親自去查：查無實據 | 1 | 6.3 s | 18.7 s | 27 s | 2 | 0 | 0 | US$0.00009 |
| pigeon-baker | 🔍 小雯親自去查：查無實據 | 5 | 3.2 s | 9.3 s | 183 s | 17 | 0 | 0 | US$0.00080 |
| budget-journalist | 🔍 小雯親自去查：查無實據 | 3 | 4.4 s | 12.9 s | 110 s | 11 | 0 | 0 | US$0.00051 |
| lantern-baker | 🔍 老周親自去查：查無實據 | 5 | 4.1 s | 13.4 s | 121 s | 10 | 0 | 0 | US$0.00045 |

**0/7 world changes; summary over 7 runs: first visible 5.1 s, first thought 13.8 s, watch 90 s.** The attractor
was gone, and so were the climaxes. Every log was read; three causes (two were my rules, one is model variance):
1. **The repeat rule ate the confrontation** (stage-cafe): after inspecting (0.98) and two calls, 老周 and 志明 met at
   17:00 and *both* lines were rejected as "已經跟對方說過同一件事了"; the closing decision never came.
2. **A finding was thrown away** (car-vendor): 小雯, chasing a false car rumour, went to the town hall *on her own*,
   chose to inspect the public accounts and found the real 30% overrun — then her answer named the finding `c2`;
   normalisation dropped it, the article had nothing to cite, two retries, fallback, story over at its peak.
3. **"一切如常" acted as counter-evidence** (oven-police): 老周 only glanced around the bakery, read "nothing special",
   dropped to 0.2 and stopped — though no glance can show an oven's inspection date.
Fixes in OVERNIGHT_PROGRESS Round 8; each has a test built from the failing case.

## Batch P5 — all 10 inputs after the Round 8 fixes

| Case | Ending (story card) | People | World changes | First visible | First thought | Wall time | Calls | Retries | Platform cost |
|---|---|---|---|---|---|---|---|---|---|
| meme-organizer | ❓ 志明聽得一頭霧水，就這樣算了 | 1 | – | 4.8 s | 5.8 s | 6 s | 1 | 0 | US$0.00008 |
| fragment-florist | ❓ 美玲聽得一頭霧水，就這樣算了 | 1 | – | 4.7 s | 6.0 s | 6 s | 1 | 0 | US$0.00003 |
| command-mayor | 🧱 謠言在林市長這裡踢到鐵板 | 1 | – | 4.8 s | 13.7 s | 14 s | 1 | 0 | US$0.00010 |
| alien-journalist | 🧱 謠言在小雯這裡踢到鐵板 | 1 | – | 3.6 s | 8.5 s | 8 s | 1 | 0 | US$0.00004 |
| pigeon-baker | 💬 一句話把 3 個人捲了進來 | 3 | – | 4.9 s | 17.3 s | 59 s | 5 | 0 | US$0.00045 |
| car-vendor | 💬 一句話把 3 個人捲了進來 | 3 | – | 3.8 s | 14.7 s | 154 s | 9 | 0 | US$0.00063 |
| stage-cafe | 🔍 老周親自查證：舞台沒有任何安全檢查紀錄… | 7 | – | 4.8 s | 18.5 s | 294 s | 22 | 0 | US$0.00138 |
| oven-police | 🚓 警察出動到阿德麵包店 | 6 | police, a shop closed | 3.3 s | 14.7 s | 308 s | 22 | 0 | US$0.00114 |
| budget-journalist | 📰 〈燈籠節預算驚傳大漏洞！公家錢花到失控…〉 | 8 | article | 5.4 s | 15.4 s | 395 s | 26 | 4 | US$0.00132 |
| lantern-baker | 🚧 慶典舞台被封鎖 | 8 | stage | 2.7 s | 15.6 s | 309 s | 23 | 1 | US$0.00112 |

Summary over 10 runs: first visible reaction 4.3 s, first full thought 13.0 s, longest single wait 21.2 s,
~9.6 beats per watched minute. **The six dramatic inputs ended four different ways** (police at the bakery, a
budget exposé, the stage closed, a confirmed defect with no action) — P3's same six-ish inputs ended on the stage
three times. Weak inputs (meme, fragment, command, alien) still end at the first resident, in ~6–14 s, as designed.

What the fixes made possible (all real Gemma output, now the first three demo recordings):
- **oven-police — "she only wanted to help"**: the glance now says a look can't show equipment safety → 老周
  inspects → expired sticker → tells 阿德 → 阿德 panics and calls 美玲 → 美玲 **closes her own flower shop** to go to
  the police station and ask how to renew a sticker "for a friend" → 老周: 「妳這位『朋友』是誰？」 → 美玲:
  「就是…麵包店的阿德啦！」 → 老周 **sends officers to the bakery** → 阿德 tells 美咲 「沒、沒事啦！真的沒事！」.
- **lantern-baker — a false rumour exposes a real problem**: the lanterns are fine (老周 sees the fireproof label and
  relaxes), but "既然人在這裡" he inspects the stage, finds the loose strut, confronts 志明 *in person* (the scene the
  P4 repeat rule had deleted), 志明: 「這只是視覺上的錯覺」 → 老周 closes the stage.
- **budget-journalist — the second truth**: the glance says money isn't written on walls → 小雯 inspects the
  accounts → finds the overrun → publishes → the mayor and 志明 start drafting a "預算重新分配以提升品質" spin.

Still weak (next round): in stage-cafe 小雯 "inspected" the stage three times — structural safety is not her trade,
but the engine's line said only that a *glance* can't tell, so she kept looking harder; and after 志明 lied to
老周's face at 17:00, 老周 never re-decided (hearing the same claim from the same person was treated as nothing new).
Both fixed after P5 (honest "not your trade — ask the police or organiser"; a first face-to-face telling or a big
change in the speaker's certainty counts as new). Measured in P6.

## Batch P6 — the six dramatic inputs after the post-P5 fixes (face-to-face counts, honest non-expert checks)

| Case | Ending (story card) | People | World changes | First visible | First thought | Wall time | Calls | Retries | Platform cost |
|---|---|---|---|---|---|---|---|---|---|
| pigeon-baker | 💬 一句話把 3 個人捲了進來 | 3 | – | 4.2 s | 10.7 s | 53 s | 6 | 0 | US$0.00056 |
| oven-police | 🔍 老周親自查證：烤箱的安全檢查貼紙日期是兩個月前，已經過期。 | 5 | – | 9.9 s | 36.7 s | 163 s | 14 | 1 | US$0.00076 |
| stage-cafe | 🚧 慶典舞台被封鎖 | 8 | stage | 4.2 s | 13.5 s | 244 s | 22 | 0 | US$0.00141 |
| car-vendor | 🚓 警察出動到章魚燒攤 | 8 | article, police | 4.2 s | 12.2 s | 272 s | 24 | 2 | US$0.00152 |
| lantern-baker | 🚓 警察出動到慶典舞台 | 8 | police, stage | 6.9 s | 18.4 s | 191 s | 22 | 0 | US$0.00112 |
| budget-journalist | 🚓 警察出動到章魚燒攤 | 8 | article, police, gather | 2.9 s | 15.2 s | 233 s | 23 | 1 | US$0.00118 |

Summary over 6 runs: first visible 5.4 s, first full thought 15.1 s (oven-police's first call took 36.7 s with one
retry — provider variance), longest single wait 21.7 s, ~10 beats per watched minute, 7.0 distinct gestures per story.
**4/6 changed the world (P5: 3/6, P4: 0/7, P3: 4/5 but three of them the same stage closure).**

- **car-vendor — the best "wait, what?" so far**: a false car rumour → 小雯 reads the public accounts and finds the
  *real* 30% overrun → exposé 〈慶典預算驚傳超支三成！…〉 → 志明 and the mayor want to "轉移焦點" → the mayor asks
  老周 to patrol the stalls "如果有人鬧事，就說是在維持秩序" → **police sent to the takoyaki stall**. The card now
  says why: 「先是小雯發文〈…〉，最後老周派出警力」. Added as recording P6-car-vendor.
- **budget-journalist**: same exposé, then police pre-emptively at the stalls *and* 阿珠 rallies the vendors to the town
  hall (✊ gather) — three world changes, each caused by the one before.
- **stage-cafe**: the face-to-face confrontation now plays out (inspect → 「你這是拿人的生命在開玩笑」 → close stage →
  志明 begs → the mayor panics) — the scene P4's repeat rule had deleted.
- **Two "police" headlines out of six** are different stories (stall patrol against a protest vs a stage hazard);
  watching for a new attractor in later batches.

Also from P6: after a look, 老周 walked back to the station and straight back to inspect (the plan ended → walk home,
though his next decision was already queued). Fixed: no walk home while a decision is pending; after a "do nothing"
decision away from home, they go home. Test added (fails without the fix, passes with it).

## Cache warm-up A/B (AMD Token Factory, 4 pairs, streamed)
Idea from the latency research: send the shared system prompt a few seconds before the first real decision so the
provider's prefix cache is warm. Result: first token cold 1.9–4.0 s (mean 2.9 s) vs warm 1.7–2.7 s (mean 2.4 s).
The ranges overlap and n=4; **no clear benefit, not implemented**. (Within a story the shared prefix is warm anyway
after the first call; the platform reported ~60% cache hits.) Log: `lab/research/warm-probe.log`.
