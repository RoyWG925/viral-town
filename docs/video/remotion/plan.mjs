// The edit: which seconds of which recording go where. Cut points come from the recordings' own logs
// (public/clips/<clip>.json: when each story event appeared on screen). Writes src/timeline.json.
//   node plan.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const log = (n) => JSON.parse(readFileSync(`public/clips/${n}.json`, "utf8")).log;
const mark = (n, label) => log(n).find((e) => e.kind === "mark" && e.label === label)?.t;
const REC = "📼 Recorded run · real Gemma on AMD · 3× · cut for time";
const clip = (src, label) => (from, dur, extra = {}) => ({ kind: "clip", src: `clips/${src}.mp4`, from, dur, label, ...extra });

const hook = clip("hook", REC), opening = clip("opening"), contrast = clip("contrast", REC), fizzle = clip("fizzle", REC);
const segments = [];
let at = 0;
const seg = (shots) => { segments.push({ start: at, shots }); at += shots.reduce((s, x) => s + x.dur, 0); };

// 0:00 hook — one sentence to Molly: phone call, inspection, tape, banana peel, "perfectly safe", the reporter
seg([hook(3.3, 2.0), hook(6.8, 2.6), hook(15.6, 2.8), hook(20.4, 2.0), hook(26.6, 2.4), hook(31.0, 2.4), hook(54.1, 3.8)]);
// 0:18 the premise — the opening's beats: title, the festival, the stage, the generator, the banana peel, your move
seg([opening(2.0, 3.5), opening(7.0, 2.6), opening(11.2, 2.4), opening(15.4, 2.4), opening(23.8, 2.6), opening(32.0, 1.5)]);
// 0:33 one experiment, live
// [from, to, speed] in the recording; every shot says it is live and how much it is sped up
if (existsSync("public/clips/live.mp4")) {
  const LIVE = (r) => `● Live · real Gemma on AMD${r > 1 ? ` · ${r}×` : ""}`;
  const parts = [
    [2.0, 12.6, 1.7], // the role card, typing the sentence, planting it
    [12.6, 23.4, 4], // waiting for the first decision
    [23.4, 37.5, 2], // "I must check it" — the walk to the bakery
    [37.5, 45.4, 1.5], // a look: you can't tell by looking
    [45.4, 51.2, 2], // "Looking isn't inspecting"
    [51.2, 60.2, 1.25], // the inspection: the sticker expired two months ago
    [60.2, 72.4, 1.6], // he tells Barney
  ];
  seg(parts.map(([from, to, r]) => ({ kind: "clip", src: "clips/live.mp4", from, dur: (to - from) / r, rate: r, label: LIVE(r) })));
}
at = Math.max(at, 72);
// 1:12 a different sentence to a different resident — the reporter finds a real budget hole
seg([contrast(5.0, 2.2), contrast(7.3, 2.0), contrast(9.3, 2.3), contrast(15.3, 3.0), contrast(20.3, 2.6), contrast(24.8, 2.4), contrast(27.2, 2.2), contrast(84.8, 2.2), contrast(132.5, 2.5), contrast(179.3, 1.6)]);
// 1:35 and one that goes nowhere
seg([fizzle(2.9, 3.5), fizzle(13.0, 2.0), fizzle(23.0, 2.5)]);
// 1:43 the three evenings side by side
seg([{ kind: "card", card: "inputs", dur: 5 }]);
// 1:48 why it needs AI: the split, then the hook run's own behind-the-scenes numbers
seg([{ kind: "image", src: "img/diagram.png", dur: 14, zoom: [1, 1.05] },
  hook(mark("hook", "details") - 0.1, 14, { label: "📼 Same run, Behind the scenes: every model call, its time and its cost", zoom: [1.55, 960, 760] })]);
// 2:16 the payoff: 20:00 at normal speed, then the front page
const fin = mark("finale", "finale");
const finEnd = JSON.parse(readFileSync("public/clips/finale.json", "utf8")).seconds - 0.15;
const res = mark("finale", "results");
seg([clip("finale", "📼 Recorded run · real Gemma on AMD · 20:00 at normal speed")(fin - 0.3, res + 0.3 - (fin - 0.3)),
  clip("finale", "📼 The front page of that run")(res + 0.3, finEnd - (res + 0.3), { zoom: [1.65, 960, 540] })]);
// close: dusk over the plaza until 2:50, then the title
seg([clip("town")(1.0, 170 - at), { kind: "card", card: "end", dur: 10 }]);

const START = { "vo-01": 0.5, "vo-02": 18, "vo-03": 25, "vo-04": 33, "vo-05": 72, "vo-06": 98, "vo-07": 108, "vo-08": 112, "vo-09": 138, "vo-10": 162, "vo-11": 174 };
const timeline = { duration: at, bed: { src: "clips/bed-audio.mp4", from: 0.5, end: { from: 159.5 } }, narration: Object.entries(START).map(([id, start]) => ({ id, start })), segments };
writeFileSync("src/timeline.json", JSON.stringify(timeline, null, 1));
console.log("timeline", at.toFixed(1), "s,", segments.length, "segments");
for (const s of segments) console.log(s.start.toFixed(1).padStart(6), s.shots.map((x) => x.kind === "clip" ? x.src.split("/")[1] : x.kind === "image" ? x.src : x.card).join(" "));
