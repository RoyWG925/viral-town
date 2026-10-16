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
