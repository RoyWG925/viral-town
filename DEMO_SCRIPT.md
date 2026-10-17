# VIRAL — demo script (draft)

Goal: in the first 20–30 seconds a viewer should feel "wait — one sentence did THAT?", and by the end understand
that every resident's reaction is a real Gemma decision bounded by an engine.

All recordings named here are in **📼 錄製的實驗**. They are real Gemma runs from batches P19–P20, recorded on the
rules the game uses now (22 decisions; 7 per resident; 11 plus a reserve of 3 for whoever has seen a hidden
problem first-hand). Logs are in `lab/runs/P19/` and `lab/runs/P20/`.

## 30-second hook (for the submission video's opening)
Use **📼 對阿德說「今晚的燈籠是便宜貨，一點就燒起來。」** (P19-lantern-baker) at 3×, cut down in editing.
1. **0–4 s** — Wide town shot. Caption: *"I told the baker the lanterns were cheap and would catch fire. That wasn't true."*
2. **4–10 s** — 阿德 phones 小雯: 「這事我只跟你講」. She checks the stage and finds the lanterns carry fire-safety
   labels. Then she reads the town hall's public accounts: **spending is 30% over budget**.
3. **10–16 s** — She asks the mayor. The mayor phones 志明 to cover it up (「你趕快想個說法來擋掉」). 志明: 「沒事沒事，小問題！」
   Her exposé goes up: 〈【驚爆！慶典預算黑洞，市長如何揮霍公款？】〉
4. **16–24 s** — The town escalates it:
   - 阿德 retells it as **六成**.
   - 美玲 pulls down her flower shop's shutter.
   - 志明 posts a reassurance notice.
   - 老周 stops trusting 「沒事」: he inspects the stage, finds the loose strut and **closes the stage**.
   - 阿珠 marches four vendors to the town hall.
5. **24–30 s** — End title **🚧 慶典舞台被封鎖** with the festival outcome 「延後舉行」. Voice-over idea:
   *"The lanterns were fine. Everything else wasn't."*

Alternative hooks (also real recordings):
- **P20-stage-cafe** — the café owner hears the stage is unsafe (her daughter performs tonight) and phones 老周.
  He inspects, hears 志明's 「沒事沒事，小問題！」, and closes the stage within half an hour; later he sends officers.
  Festival: postponed.
- **P20-budget-journalist** — exposé, then a shop closes, then the mayor's denial, then a vendors' protest.
- **P20-wobble-organizer** — only 「舞台好像在晃。」, told to the one man who knows the stage was never inspected.
  He keeps quiet. At the 17:00 patrol he brags 「沒事沒事」, but 老周 inspects anyway and closes the stage:
  「我說過我看過了，就不能當沒看到。」

Same sentence, different town: P19-oven-police reached the stage via the 17:00 routine patrol (police sent there),
while the same oven sentence in P17 and P20 stopped at 老周 verifying the expired sticker. This shows that nothing
is scripted.

## 2–3 minute walkthrough
1. **Premise (10 s)** — The town living on its own: walkers, pets, everyday scenes (志明 yelling at the stage
   crew, 阿珠 haggling). "You are a stranger. Whisper one sentence to one resident."
2. **Live input (30 s)** — Click 美咲 (café) and show her role card (what she can do, who she can phone). Type
   「聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。」. Show:
   - the thinking beat with its seconds counter;
   - the streamed gesture, then her thought with the belief bar;
   - her call to 老周.

   This is real Gemma on AMD Token Factory. In the evening peak the first thought can take 20–45 s, so cut there.
3. **Switch to the recording** of the same sentence (📼 P20-stage-cafe) at 2×:
   - 老周 inspects → "有人親自去查了" → the loose strut;
   - 志明's 「沒事沒事，小問題！」 → **🚧 the stage gets taped off**, and the clock turns 「🏮 燈籠節不妙」;
   - act title "第三幕 · 事情鬧大了".
4. **Ending (25 s)** — The 霧港小報 end title, then the results card:
   - the headline and the chain of retellings with each listener's belief;
   - the stamped small goals and the 🏮 20:00 outcome;
   - **🔓 你發現了**: one hidden line of a resident's card, now in the 📓 journal;
   - the downloadable front page.
5. **How it works (30 s)** — Open "🔬 技術紀錄" (calls, latency, tokens, platform cost) and say the split:
   *Gemma decides how each person understands, believes, feels and acts; the engine owns truth, knowledge and
   what is possible, and validates every answer before anything happens.*
6. **What If (10 s)** — "告訴小雯" with the same sentence: a different person, a different story.

## Numbers you can say (all measured, see PLAYTEST_REPORT.md)
- 10 of 16 dramatic stories reached a public moment (stage closed, police sent, exposé, statement, protest) in
  P19–P20. Every closure followed 老周's own inspection, and every exposé followed 小雯's own reading of the accounts.
- Response times:
  - best case (P5, daytime): first visible reaction 2.7–9.9 s, mean 4.3 s;
  - evening peak (P19–P20): 7.6–17.8 s for the first reaction and 21.5–45 s for the first thought, as batch means.
- A long story makes 22–36 Gemma calls; platform-reported cost is about US$0.001 per story.
- In an earlier rated sample, commands were obeyed 0/14 times and no secrets leaked; every results-card line
  comes from the log.

## Before recording
- Use a desktop browser at 1280×800 or larger, with sound on (the voice blips and stings are subtle).
- Let the page warm up 5 s before clicking. Use 2–3× for recordings and 1× for the live part.
- Record the live part in the daytime if possible; the provider is slowest in the evening.
