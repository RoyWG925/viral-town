# VIRAL — demo video kit (≈ 3:00, two versions)

Official limits (lablab): a video link, **under 5 minutes and under 300 MB**; Track 4 asks the demo to show the
experience **changing for at least two different inputs** and to explain what we made, what the model decides,
how quality is controlled, the cost per experience, and who pays.

Two versions, same picture:
- **A — with narration**: the WAV files in `docs/video/vo/` (offline AI voice, Microsoft David) + `subtitles-A.srt`
  (short on-screen captions, the narration is spoken).
- **B — no narration**: music + `subtitles-B.srt` (the narration lines become captions, same timing).

Edit in Clipchamp (built into Windows 11) or any editor: drop the screen recordings on the timeline in the order
below, add the WAVs at the listed start times (A), import the SRT (or type the captions), add music under everything
at low volume (the game's own synthesized BGM can be recorded with the screen, or use any royalty-free track).

Regenerate after changing a line: `powershell -ExecutionPolicy Bypass -File docs/video/render-vo.ps1`, then
`node docs/video/make-srt.mjs` (it times the captions from the real WAV lengths and the start times below).

## Honesty rules for the edit (keep these — judges check)
- Every replay is a **real Gemma run** recorded by the game: put a small label on it, e.g. "Recorded run · real Gemma
  on AMD · 3×". Live footage gets "Live" in the corner. Sped-up parts say so.
- Never splice two different runs so they look like one chain of events.
- Numbers on screen come from the logs in `lab/runs` (cost per story, calls), with where they come from.

## Capture settings
- Browser window 1920×1080 (or 1280×720), site: https://viral-town.vercel.app (after today's deploy).
- Recordings: 📼 Recorded runs → pick the run → ▶ plays; press **H** to hide the interface for clean town shots, H again
  to show it. Speed: the play pill's 1×/2×/3× button.
- The opening: click 🎬 next to "Recorded runs" to play it again.
- Live part: click a resident, type the sentence, Plant the thought. Model thinking takes 10–40 s per step; keep
  the real wait in the recording and speed it up in the edit with a "sped up" label.

## Shot list

| # | Time | Picture (what to record) | Caption (A) | Narration (A) starts |
|---|---|---|---|---|
| 1 | 0:00–0:18 | **Hook** — 📼 *To Molly: "I heard tonight's stage was thrown together from old planks…"* at 3×, cut to its beats: Molly phones Chief Harlow → the Chief inspects the stage (loose strut) → tape goes up → **Gus slips on the banana peel** → Gus's "Everything is perfectly safe!" notice → Penny: "that's a headline" | "I told Molly one sentence." → "Within the hour: the stage was taped off." | vo-01 at 0:00.5 |
| 2 | 0:18–0:33 | **The concept** — the opening (🎬): title card, the stakes, the stage, the empty generator, the taped dove cage, the banana peel | "You are not a character. You are a thought that spreads." / "Tonight at 20:00: the Lantern Festival." | vo-02 at 0:18, vo-03 at 0:25 |
| 3 | 0:33–1:12 | **One experiment, live** — click **Chief Harlow**, type *"I heard the safety check on Barney's bakery oven expired ages ago."*, plant it. Show the thinking bubble, the Chief walking to the bakery and inspecting, what he finds, him telling Barney. Speed up waits (label). | "Live · real Gemma on AMD Token Factory" | vo-04 at 0:33 |
| 4 | 1:12–1:46 | **Different input, different town** (Track 4 requirement) — 📼 *To Rosa: "The stall fee went up because the mayor spent the money on a new car."*: Penny checks the town hall accounts, finds a real 30% overrun, publishes; the mayor calls it a misunderstanding. Then 5 seconds of 📼 *To Barney: "Tonight's lanterns are cheap junk…"*: Barney worries, keeps it to himself, the festival goes on | "Same town. Different sentence." / "Sometimes nobody cares." | vo-05 at 1:12, vo-06 at 1:38 |
| 5 | 1:46–2:16 | **Why it needs AI** — Details → Behind the scenes on a results page (calls, latency, cost), plus the diagram (`docs/video/diagram.png`) | "Gemma decides what people believe and intend." / "The engine decides what actually happens." | vo-07 at 1:48, vo-08 at 1:52 |
| 6 | 2:16–2:40 | **The payoff** — the 20:00 finale of the hook run (the show on the open plaza, doves released there), then The Mistport Gazette front page, then Play again | "At 20:00 you see what your sentence did." | vo-09 at 2:18 |
| 7 | 2:40–3:00 | **Close** — town overview at dusk (`docs/slides/shots/town.png` or live), the title | "Less than a quarter of a cent per story · Gemma on AMD" / "One sentence. A whole town." | vo-10 at 2:42, vo-11 at 2:54 |

## Narration script (A)
See `docs/video/narration.txt`; each line is rendered to `docs/video/vo/vo-NN.wav`.
vo-10 names who it is for ("players who love social sandboxes, and streamers whose audience writes the sentence");
the team signed off this business line on 2026-10-18.

## Chosen runs (P23, English, real Gemma-4-31B-IT on AMD Token Factory)
- **Hook / payoff:** `P23-stage-cafe` — reach 8, 31 calls, platform-reported US$0.0016. Stage sealed, Gus slips on the
  banana peel at 15:44 on his way to post a cover-up notice, festival scaled down to the open plaza.
- **Contrast:** `P23-car-vendor` — reach 8, 36 calls. Penny inspects the accounts (a true 30% overrun), publishes,
  the mayor goes public with "a misunderstanding"; the Chief later finds the loose strut too; closing fireworks off.
- **Fizzle:** `P23-lantern-baker` — 2 calls. Barney believes it a little ("it's just one stranger") and tells no one.
- **Live (not a recording):** the oven sentence to Chief Harlow was `P23-oven-police` in the batch — the Chief went
  to inspect within the first minutes, so there is something to see early. A live run can turn out differently;
  that is the point, keep whatever happens.
