# VIRAL — demo video kit (≈ 2:50, two versions)

Official limits (lablab): a video link, **under 5 minutes and under 300 MB**; Track 4 asks the demo to show the
experience **changing for at least two different inputs** and to explain what we made, what the model decides,
how quality is controlled, the cost per experience, and who pays.

Two versions, same picture:
- **A — with narration**: the WAV files in `docs/video/vo/` (offline AI voice, Microsoft David) + `subtitles-A.srt`
  (short on-screen captions, the narration is spoken).
- **B — no narration**: music + `subtitles-B.srt` (the narration lines become captions).

Edit in Clipchamp (built into Windows 11) or any editor: drop the screen recordings on the timeline in the order
below, add the WAVs at the listed times (A), import the SRT (or type the captions), add music under everything at
low volume (the game's own synthesized BGM can be recorded with the screen, or use any royalty-free track).

## Honesty rules for the edit (keep these — judges check)
- Every replay is a **real Gemma run** recorded by the game: put a small label on it, e.g. "Recorded run · real Gemma
  on AMD · 3×". Live footage gets "Live" in the corner. Sped-up parts say so.
- Never splice two different runs so they look like one chain of events.
- Numbers on screen come from PLAYTEST_REPORT.md (cost per story, calls), with where they come from.

## Capture settings
- Browser window 1920×1080 (or 1280×720), site: https://viral-town.vercel.app (after today's deploy).
- Recordings: 📼 Recorded runs → pick the run → ▶ plays; press **H** to hide the interface for clean town shots, H again
  to show it. Speed: the play pill's 1×/2×/3× button.
- The opening: click 🎬 next to "Recorded runs" to play it again.
- Live part: click a resident, type the sentence, Plant the thought. Model thinking takes 10–40 s per step; keep
  the real wait in the recording and speed it up in the edit with a "sped up" label.

## Shot list

| # | Time | Picture (what to record) | Caption (A: short / B: full) | Narration (A) |
|---|---|---|---|---|
| 1 | 0:00–0:12 | **Hook** — recorded run `HOOK_RUN` at 3×, cut to its biggest beats: `HOOK_BEATS` | "I told `HOOK_WHO` one sentence." → "`HOOK_RESULT`" | vo-01 |
| 2 | 0:12–0:30 | **The concept** — the opening (🎬): title card, the stakes, the stage, the empty generator, the taped dove cage, the banana peel | "You are not a character. You are a thought that spreads." / "Tonight at 20:00: the Lantern Festival." | vo-02 |
| 3 | 0:30–1:10 | **One experiment, live** — click `LIVE_WHO`, type `LIVE_TEXT`, plant it. Show the thinking bubble, the first reaction, a retelling (the highlighted changed words), someone going to check. Speed up waits (label). | "Live · real Gemma on AMD Token Factory" | vo-03, vo-04 |
| 4 | 1:10–1:45 | **Different input, different town** (Track 4 requirement) — two contrasting recorded runs side by side or back to back: `CONTRAST_1` and `CONTRAST_2`, then a 5-second fizzle `FIZZLE_RUN` | "Same town. Different sentence." / "Sometimes nobody cares." | vo-05, vo-06 |
| 5 | 1:45–2:15 | **Why it needs AI** — Details → Behind the scenes on a results page (calls, latency, cost), plus the diagram (`docs/video/diagram.png`) | "Gemma decides what people believe and intend. The engine decides what actually happens." | vo-07, vo-08 |
| 6 | 2:15–2:40 | **The payoff** — the 20:00 finale of a big run (lanterns, doves or none, crowd, the mayor), then The Mistport Gazette front page, then Play again → same sentence to someone else | "At 20:00 you see what your sentence did." | vo-09 |
| 7 | 2:40–2:55 | **Close** — town overview at dusk, the title | "About $0.001 per story · Gemma on AMD · Who it's for: players who like social sandboxes and shareable stories" / "One sentence. A whole town." | vo-10 |

The placeholders (`HOOK_RUN`, …) are filled in from today's English test runs — see "Chosen runs" below.

## Narration script (A)
See `docs/video/narration.txt`; each line is rendered to `docs/video/vo/vo-NN.wav`.

## Chosen runs
(filled after the English batches)
