# VIRAL — submission draft (AMD Developer Hackathon ACT III · Track 4: Create a New Kind of Experience)

> Draft for Roy to review before anything is submitted. The business lines (who pays, prices, the list-rate
> estimate) were signed off by the team on 2026-10-18. Numbers come from lab/runs and PLAYTEST_REPORT.md (final
> English batch: P23).

## Title (5–50 chars)
VIRAL — one whisper, a whole town reacts

## Short description (50–255 chars)
Whisper one sentence to a resident of a small harbor town and watch it spread. Eight AI residents (Gemma on AMD)
believe, doubt, twist and act on it — and by 20:00 the Lantern Festival goes on, shrinks, or falls apart.

## Long description (600–2000 chars)
VIRAL is a butterfly-effect game you play with one sentence. Mistport is getting ready for tonight's Lantern
Festival. You are not a character — you are a thought that spreads. Pick a resident and whisper anything: a rumour,
a joke, a lie, a command. Each of the eight residents is played by Gemma-4-31B-IT running on AMD Token Factory. They
understand your words through what *they* know, want and fear: the café owner whose daughter performs tonight, the
police chief who must see things for himself, the reporter who needs a scoop, the organizer hiding an uninspected
stage. They doubt it, retell it in their own words, phone a friend, go and check, cover something up — or shrug.

A deterministic engine owns the truth and the rules. The model proposes beliefs and actions; the engine validates
every answer, decides what anyone can actually see or do, and logs every cause. The town has its own clock: stage
check at 17:00, doves at 18:00, stalls at 18:30, police at 19:00, rehearsal at 19:30, generator at 19:40. At 20:00 you watch the festival
your sentence produced — lanterns, doves, crowds, a booed mayor, a stage taped off — and then read the front page of
The Mistport Gazette, with the chain of who told whom, what was really true, and one hidden motive you uncovered.

Different sentences, and different listeners, lead to different evenings: a made-up story about the mayor's new car
sends the reporter to the town hall's accounts, where she finds a real budget hole; a worry about the stage, told to
the café owner, gets the stage sealed off; a joke that the mayor is afraid of pigeons ends with him denying it in a
public statement. And the town has its own slapstick lying
around — a banana peel by the notice board, a dove cage held shut with tape, a generator on empty — that only the
residents' own movements can set off: lure the mayor to the plaza and he goes down. Some sentences go nowhere — the
town does not have to care.

## The problem, and who it is for
**The problem: stories either ignore your words or ignore consequences.**
- *Scripted stories* are branching trees authored by hand: expensive, finite, and they only react to the choices the
  writer predicted.
- *Chatbot stories* take any text in and give text out — but nothing in the world changes, nothing is checked, and the
  story forgets what is true.
- *What players want* is to say anything and watch a living world take it seriously: believable people, real
  consequences, and a clear "this happened because you said that".

**How VIRAL answers it.** Your sentence is free text, and the world is not: the town's truth, rules and festival
schedule are authored and enforced by the game, Gemma decides what each resident believes and intends, and every
consequence is logged with its cause — so at 20:00 the front page can show exactly how your sentence became that
evening.

**Who it is for.**
- *Players* who like social sandboxes and short, replayable story games: one sentence, one evening, a front page to
  share — and often a different evening when they try another sentence or another listener.
- *Streamers and audience-driven shows:* the audience writes the sentence, and everyone watches the town react.
- *Media-literacy classrooms:* students watch a rumour mutate through motives and retellings, with the full traceable
  chain as the lesson.

## Technology tags
Gemma, AMD Token Factory, Next.js, React Three Fiber, TypeScript, WebAudio, Remotion

## Track 4 — the five questions

**What the team created.** A small town with eight residents, each with a public role and a hidden card (what they
own, want, fear, their bias, how they gossip, the line they won't cross, their price), secrets about each other,
typed relationships, a festival preparation schedule, a 3D town that acts the story out, an ending composed from
what happened, and a newspaper front page. All authored by the team.

**What the models generate or decide.** For every resident who hears something: how they understand it, how much
they believe each claim (and why), what they feel, what they think privately, and up to two actions in their own
words (tell, phone, ask, go and look, inspect, close a shop, post a notice, publish an article, make a statement,
dispatch police, close the stage, rally the stall owners, cancel the festival). Nothing else — the model never
decides what is true, what someone sees, or whether an action is allowed.

**How quality and consistency are controlled.**
- Each resident sees only their own knowledge, memory and relationships (no shared omniscient prompt).
- Every answer is JSON, normalised and validated: unknown actions, impossible targets, invented facts, leaked
  secrets and belief levels the evidence cannot support are sent back with the reason; after two tries a safe
  fallback is shown honestly as "the model did not answer".
- Big actions need evidence thresholds (you cannot get the stage closed by a stranger's word alone).
- The ending is a pure function of the validated log: same log, same ending, every line traceable to its cause.
- Player input is moderated: commands and jailbreaks are just something a stranger said (residents react in
  character); swearing is masked; sexual content, hate speech and self-harm are refused before any model call.
- Measured on real runs: 302 real-model stories in 42 batches, every run's full log in lab/runs; 157
  automated tests (no model calls) for the validators, engine rules, endings and moderation.

**How much each experience costs.** A full story is 15–38 Gemma calls. Across 92 full stories the AMD Token Factory
platform reported **US$0.0013 per story** (median; US$0.0020 at most) during the event. A sentence that fizzles costs
1–4 calls. At an assumed list rate (US$0.50 per million input tokens, US$3 per million output, no cache
discount) our own estimate is about US$0.03–0.07 per full story. A replayed recording costs
nothing.

**Who would pay, and why.**
- *Players:* a short, replayable story game — free to try, with paid new-town packs.
- *Media-literacy education:* schools and libraries, to let students see how a rumour mutates through motives and
  retellings, with the full traceable chain as the lesson. Pay per classroom licence.
- *Streamers / audience-driven entertainment:* the audience submits the sentence, the stream watches the town react.

## Demo (video ≈ 3 min) — see docs/video/VIDEO_KIT.md for the shot list, narration and subtitles
1. 0:00 Hook (recorded run, 3×): one sentence to Molly → the chief tapes off the stage → Gus slips on the banana peel
   → "Everything is perfectly safe!" → the reporter smells a scoop.
2. 0:18 The premise: the opening (you are a thought that spreads; 20:00; the opportunities lying around).
3. 0:33 Live: a sentence to Chief Harlow; thinking, the walk to the bakery, the inspection.
4. 1:12 Two inputs, two evenings (Track 4 requirement): the stall-fee rumour → a real budget exposé; the lantern
   rumour to Barney → nothing at all.
5. 1:46 How it works: Gemma decides beliefs and intentions, the engine decides what happens; cost per story.
6. 2:16 The 20:00 finale and the front page.
7. 2:40 Cost, who it's for, end.

## Must be true before submitting (checklist)
- [x] Secret scan: neither model key appears in any commit of the history (checked 2026-10-18); MIT LICENSE added.
- [ ] Public GitHub repository (Roy flips it) and README in English.
- [ ] Application URL works without login: https://viral-town.vercel.app
- [ ] Video (MP4/MOV) and slide deck (PDF) uploaded.
- [ ] Cover image.
- [x] Final numbers updated from the English batch (P23).
- [x] The problem and the intended user stated (section "The problem, and who it is for", same as slide 2).
- [x] Business lines signed off by the team (2026-10-18).
