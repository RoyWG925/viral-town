# VIRAL — demo script (draft)

Goal: in the first 20–30 seconds a viewer should feel "wait — one sentence did THAT?", and by the end understand
that every resident's reaction is a real Gemma decision bounded by an engine.

## 30-second hook (for the submission video's opening)
Use the recording **📼 對老周說「聽說阿德麵包店的烤箱檢查早就過期了…」 → 🚓 警察出動到阿德麵包店** (P5-oven-police) at 2–3×.
1. 0–3 s — wide town shot; caption: *"I told the police officer one thing about a bakery oven."*
2. 3–10 s — 老周 glances around the bakery: "a look can't tell if equipment is safe" → he inspects → the found card:
   the sticker expired two months ago.
3. 10–18 s — he tells 阿德; 阿德 panics and phones 美玲; 美玲 **pulls down her own shop's shutter** and walks to the
   police station to ask how to renew a sticker "for a friend".
4. 18–25 s — 老周: 「妳這位『朋友』是誰？」 → 美玲: 「就是…麵包店的阿德啦！」 → officers dispatched to the bakery.
5. 25–30 s — end title **🚓 警察出動到阿德麵包店** + "🔎 真相揭曉：烤箱檢查真的過期了（阿德的秘密）".
   Voice-over idea: *"She only wanted to help."*

Alternative hooks (also real recordings): P5-lantern-baker (a false lantern rumour → the police find a real loose
strut → the stage is closed) · P5-budget-journalist (the reporter reads the public accounts → exposé → the mayor
drafts a spin). Same sentence, different town: P2-oven-police ended as a stall-fee exposé instead — worth showing
side by side to make the point that nothing is scripted.

## 2–3 minute walkthrough
1. **Premise (10 s)** — the town living on its own: walkers, pets (the calico 麻糬 by the flower shop), shopkeepers.
   "You are a stranger. Whisper one sentence to one resident."
2. **Live input (30 s)** — click 美咲 (café), type 「聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。」.
   Show: the whisper card, the honest thinking pill with a seconds counter, the streamed gesture after ~3–7 s,
   then her thought bubble with the belief bar and her phone call to 老周 with what she added highlighted.
   (Real Gemma, live on AMD Token Factory.)
3. **Switch to a recording** of the same sentence (📼 P2-stage-cafe) at 2× to avoid waiting on stage: 老周
   inspects → "有人親自去查了" → the loose strut → 志明's cover-up attempt ("half-believes but passes it on" tags,
   the mayor's "🏮 有權取消燈籠節？" suspense marker) → **🚧 the stage gets taped off**, bystanders turn to look,
   act title "第三幕 · 事情鬧大了".
4. **Ending (20 s)** — the 霧港小報 end title → results card: headline, the chain of retellings with each
   listener's belief, "差一點" (the mayor could have cancelled the festival), "真相揭曉", the downloadable front page.
5. **How it works (30 s)** — open "🔬 技術紀錄": calls, latency, tokens, platform cost; say the split:
   *Gemma decides how each person understands, believes, feels and acts; the engine owns truth, knowledge and
   what is possible, and validates every answer before anything happens.*
6. **What If (10 s)** — "告訴小雯" with the same sentence: a different person, a different story.

## Numbers you can say (all measured, see PLAYTEST_REPORT.md)
- First visible reaction 2.7–5.4 s (mean 4.3 s over P5's 10 runs, streamed gesture); first full thought 5.8–18.5 s
  (mean 13.0 s); on AMD Token Factory.
- A long story: 22–26 Gemma calls, platform-reported cost US$0.0011–0.0014 (P5).
- Six dramatic sentences, four different endings in one batch (P5); the same sentence can end differently on
  another run (P2 vs P5 oven).
- Commands are not obeyed (0/14 earlier rating); 0 secret leaks in rated decisions; every result card line comes from the log.

## Before recording
- Use a desktop browser at 1280×800 or larger; sound on (voice blips and stings are subtle).
- Let the page warm up 5 s before clicking; use 2× for recordings, 1× for the live part.
