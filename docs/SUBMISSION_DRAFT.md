# VIRAL — submission draft (AMD Developer Hackathon ACT III · Track 4: Create a New Kind of Experience)

> Draft for Roy to review before anything is submitted. Lines marked **[confirm]** are claims or choices only the
> team can sign off (business model, prices). Numbers come from lab/runs and PLAYTEST_REPORT.md; update them after
> the final English batch.

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
check at 17:00, doves at 18:00, stalls at 18:30, police at 19:00, rehearsal at 19:30. At 20:00 you watch the festival
your sentence produced — lanterns, doves, crowds, a booed mayor, a stage taped off — and then read the front page of
The Mistport Gazette, with the chain of who told whom, what was really true, and one hidden motive you uncovered.

Different sentences, and different listeners, lead to different evenings: a false lantern rumour can send the
reporter to the town hall's accounts and expose a real budget hole; the same worry told to the café owner gets the
stage closed. A harmless joke can fill the square with curious visitors. And the town has its own slapstick lying
around — a banana peel by the notice board, a dove cage held shut with tape, a generator on empty — that only the
residents' own movements can set off: lure the mayor to the plaza and he goes down. Some sentences go nowhere — the
town does not have to care.

## Technology tags
Gemma, AMD Token Factory, AMD Instinct (via Token Factory), Next.js, React Three Fiber, WebAudio, TypeScript

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
- Measured on real runs: PLAYTEST_REPORT.md (20+ batches, every run's full log in lab/runs).

**How much each experience costs.** A full story is 20–36 Gemma calls. During the event the platform reported about
**US$0.001 per story** (US$0.008–0.009 per batch of 8 stories). **[confirm]** At list rates our own estimate is about
US$0.03–0.05 per story. A replayed recording costs nothing.

**Who would pay, and why. [confirm — pick one or two]**
- *Players:* a short, replayable story game — free to try, small one-time price or paid "new town" packs.
- *Media-literacy education:* schools and libraries, to let students see how a rumour mutates through motives and
  retellings, with the full traceable chain as the lesson. Pay per classroom licence.
- *Streamers / audience-driven entertainment:* the audience submits the sentence, the stream watches the town react.

## Demo (video ≤ 5 min) — outline
1. 0:00 Hook (recording, sped up): one false lantern rumour → the reporter finds a real budget hole → exposé →
   stage closed → vendors march → 20:00 festival postponed.
2. 0:30 The premise: the opening (you are a thought that spreads; 20:00; the clues).
3. 1:00 Live: whisper to the café owner; thinking beats, retellings, the police chief inspects.
4. 2:00 The 20:00 finale scene, then the front page; Details: truth, chain, Behind the scenes (calls, cost).
5. 3:00 Two inputs, two evenings (Track 4 requirement): same sentence to someone else / a harmless joke that packs
   the square.
6. 3:40 How it works: model vs engine split, validation, moderation, cost per story.
7. 4:20 Who it's for. End.

## Must be true before submitting (checklist)
- [x] Secret scan: neither model key appears in any commit of the history (checked 2026-10-18); MIT LICENSE added.
- [ ] Public GitHub repository (Roy flips it) and README in English.
- [ ] Application URL works without login: https://viral-town.vercel.app
- [ ] Video (MP4/MOV) and slide deck (PDF) uploaded.
- [ ] Cover image.
- [ ] Final numbers updated from the English batch.
