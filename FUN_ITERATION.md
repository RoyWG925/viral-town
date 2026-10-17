# VIRAL — fun-first iteration (2026-10-17)

The owner's brief: it already reads as a watchable AI town simulation, but not yet as a game with pull. Priorities for
this round, in order: gameplay → a living world → natural interactions → watchability & visuals → stability → delivery.
Evidence: PLAYTEST_REPORT.md (P10–P13), the research notes in lab/research/fun-iteration/, the design docs in docs/.

## The loop we are building toward
**Pick a person → whisper one sentence → watch the town turn it into something you didn't expect → read the paper →
learn one more thing about someone → try again, aiming at something.**

Each part now has a hook:
- **Pick**: role cards ("🚓 執法者：能派警力、封鎖舞台、親自檢查；很難被陌生人說服"), phone webs on the map, and
  the 📓 journal show who is a tool for what.
- **Watch**: continuous conversations, everyday scenes, readable residents, a story clock that turns "燈籠節不妙".
- **Paper**: the headline, why it happened, small-goal stamps, the 20:00 festival outcome, one 🔓 discovery.
- **Again**: small goals left (今晚的小目標 n/6), a near miss turned into a one-click What If, a journal with ？？？ left.

## What changed, by the owner's critique

| Critique | What we did |
|---|---|
| NPCs walk home between every step (A visits B, goes home, comes back; B walks to A to reply) | **Conversations are one continuous scene** in the engine: the speaker waits for the reply, the listener answers on the spot, a companion walks along to look at something together, visitors leave when it is over. Tests prove the old behaviour fails them. |
| "An AI butterfly-effect demo, not a game" | **今晚的小目標** (Untitled Goose Game's to-do list): 6 goals stamped only by events that have already played, 4 hidden ones; **🔓 one discovery per story** into a **📓 journal**; the **20:00 outcome** gives every story a stake. |
| The town moves but is not alive | **鎮上日常**: everyday scenes on a scheduler that yields the instant a story needs anyone — 志明 yelling at stage hands (and the stage post wobbling), 阿珠 haggling over the fee, 阿德's samples, 老周's patrol and the kid who won't stop running, 美咲's gossip circle, the mayor rehearsing a speech; kids chase the calico cat, neighbours squabble over a bike. No model calls, never story topics. |
| Free text but no free play; residents too alike | **Character cards in nouns** (owns / only they can / wants tonight / fears / bias / gossip habit / bottom line / price / two lines), **seven secrets about each other** (the mayor owes the baker; the café owner knows the police are half-staffed…), **relationships with a kind and a past** (阿德 and 美玲 are exes), **habits** and an honest **public-pressure** rule: the mayor now goes out to deny things (0 statements in 38 runs before, 2 in 8 after). |
| Only big events | **Small dramas from the model itself**: "the denial makes it worse" (美咲: 「市長特地發聲明否認怕鴿子，這反而讓傳聞更像真的。」), a florist closing her own shop to help a friend and getting the police sent to him, 志明's 「沒事沒事，小問題！」 in every crisis. |
| Waiting for the system | Everyday scenes fill model waits ("同一時間，…"), a single "現在發生什麼" line, a compact play pill, routine-meeting countdowns ("⏰ 再 10 分鐘：老周要去舞台找志明巡查"). |
| Second action mid-show? | **補一句**, offered once and only at a real lull (it costs no model calls unless taken). Tested (P11): repeating a weak sentence does not help; bridging a stuck rumour does. Kept as an option, not the default loop. |
| Core NPCs look like everyone else | Signature kits: top hat + sash + cane, peaked cap + badge, beret + camera, tall toque + baguette, sunhat with a dove, apron + tray, hi-vis + headset + clipboard, headband + takoyaki; own gaits and idle tells; the crowd's palette softened so the eight pop. |
| Town too even | Town hall flags, banners, red carpet and press podium; stage backdrop, truss and dove cages; bunting on the shopping street; a harbour crane and gulls; public-fact chalkboards; no map or nav changes. |
| Night too dark, glow too strong | Brighter dusk/night bounce, a soft viewer-side fill, calmer lanterns/lamps/neon, bloom threshold 1.25 at 0.5. |
| UI too big, tool-like | A clock pill with the festival countdown, a cast strip, the goals chip, one now-line, a corner play pill; town statistics and always-open control panels removed. Umbrellas and stall awnings fade when the camera films someone under them. |

## Cut or hidden
Town statistics ("92 位鎮民：45 人在走動…"), the always-open time slider / view / speed panels, the 12× explore speed,
the 720 px transport bar, decimal belief numbers in captions, the four stat tiles and numeric What-If comparison on the
results, identical "告訴X" pills, spoiler headlines in the recordings list, core residents wandering into other shops,
the story's reaction emoji in background chats. Considered and rejected: new residents (老師, 市長的對手 — too risky
before the deadline; their roles live in the secret web), any-time intervention, prediction bets, rewards/timers.

## Inspirations, honestly mapped
- **Untitled Goose Game** → the to-do list of small goals, stamped live.
- **Hitman** → everyday scenes that hint at real secrets (the stage post that wobbles when 志明 yells), routine meetings
  you can plan around, the "opportunity" of telling the right person before 17:00.
- **Plague Inc.** → one seed, a visible spread, a ticker of what is happening, the festival as the thing under threat.
- **RimWorld / Dwarf Fortress** → characters with concrete fears, prices and grudges whose stories emerge, a
  readable cause chain afterwards.
- **The Sims** → visible relationship lines, needs/wants per person, idle personality.
- **Two Point** → readable silhouettes by role, a town that is a stage for small comic incidents.

## Measured (real Gemma on AMD, see PLAYTEST_REPORT.md P10–P16)
- Phone calls fell from 45% of all actions (P5–P9) to 10–19% (P12–P16): people walk over and talk.
- The mayor makes public statements (0 in 38 runs before habits/pressure; 2 in 8 in P10).
- Residents name a line of their own card behind ~93% of decisions (motive); reveals prefer undiscovered lines.
- 20:00 festival over P5–P11 logs: on 20, reduced 18, postponed 1 (dramatic inputs); weak inputs always on.
- With all v2 settings live, ≈33% of dramatic stories reach a world change (P12–P16), down from ≈60–85% — richer,
  more hesitant characters; a tuning choice left to the owner.
- Tests: 94 unit/engine tests across 11 suites, all passing; production build and UI smoke test pass.

## Still not satisfied with
- No human playtest yet; every "is it fun" judgement here comes from logs, screenshots and the owner's own play.
- The trade-off above: deeper characters, fewer public climaxes.
- Provider latency swings (first visible 3–18 s this afternoon); the v2 prompt is longer.
- Everyday scenes and kits were verified in screenshots and the browser pane, not in a long human session.
