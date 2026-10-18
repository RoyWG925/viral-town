// Builds the two subtitle tracks from narration.txt and the rendered WAVs (their real lengths).
//   node docs/video/make-srt.mjs
// subtitles-A.srt: short captions for the version WITH narration (the voice says the rest).
// subtitles-B.srt: the narration itself as captions, for the version WITHOUT narration.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// where each narration clip starts on the timeline (seconds) — matches VIDEO_KIT.md's shot list
const START = { "vo-01": 0.5, "vo-02": 18, "vo-03": 25, "vo-04": 33, "vo-05": 72, "vo-06": 98, "vo-07": 108, "vo-08": 112, "vo-09": 138, "vo-10": 162, "vo-11": 174 };
// version A: short on-screen captions [start, end, text]
const SHORT = [
  [0.5, 8, "I told Molly one sentence."],
  [8, 17.5, "Within the hour: the stage was taped off."],
  [18, 24.5, "You are not a character. You are a thought that spreads."],
  [25, 32, "Tonight at 20:00: the Lantern Festival."],
  [33, 42, "Live · real Gemma on AMD Token Factory"],
  [72, 80, "Same town. Different sentence."],
  [98, 104, "Sometimes nobody cares."],
  [108, 112, "Gemma decides what people believe and intend."],
  [112, 122, "The engine decides what actually happens."],
  [138, 148, "At 20:00 you see what your sentence did."],
  [162, 173, "CAPTION_COST"],
  [174, 179, "One sentence. A whole town."],
];

const wavSeconds = (f) => {
  const b = readFileSync(f);
  let i = 12, rate = 0;
  while (i < b.length) {
    const id = b.toString("ascii", i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === "fmt ") rate = b.readUInt32LE(i + 16); // byte rate
    if (id === "data") return size / rate;
    i += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${f}`);
};
const ts = (s) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
// split a narration line into cues of about two short lines each, timed by length
const chunks = (text) => {
  const sentences = text.match(/[^.!?:]+[.!?:]?/g).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    if (out.length && (out.at(-1) + " " + s).length <= 84) out[out.length - 1] += " " + s;
    else out.push(s);
  }
  const split = (c) => {
    if (c.length <= 84) return [c];
    // prefer the comma nearest the middle, then fall back to words
    const commas = [...c.matchAll(/, /g)].map((m) => m.index).filter((i) => i > 20 && c.length - i > 20);
    if (commas.length) {
      const i = commas.reduce((a, b) => (Math.abs(b - c.length / 2) < Math.abs(a - c.length / 2) ? b : a));
      const a = c.slice(0, i + 1), b = c.slice(i + 2);
      return [...(split(a) ?? [a]), ...(split(b) ?? [b])];
    }
    return null;
  };
  return out.flatMap((c) => {
    const byComma = split(c);
    if (byComma && byComma.every(Boolean)) return byComma;
    if (c.length <= 84) return [c];
    const words = c.split(" "), half = [];
    let cur = "";
    for (const w of words) { if ((cur + " " + w).trim().length > 84) { half.push(cur.trim()); cur = w; } else cur += " " + w; }
    return [...half, cur.trim()];
  });
};
const wrap = (c) => {
  if (c.length <= 42) return c;
  const mid = c.lastIndexOf(" ", Math.ceil(c.length / 2) + 4);
  return c.slice(0, mid) + "\n" + c.slice(mid + 1);
};

const lines = readFileSync(join(here, "narration.txt"), "utf8").split(/\r?\n/).filter((l) => /^vo-\d+\s*\|/.test(l));
const cuesB = [];
for (const l of lines) {
  const [id, text] = l.split("|").map((x) => x.trim());
  const wav = join(here, "vo", `${id}.wav`);
  if (!(id in START)) throw new Error(`${id} has no START`);
  if (!existsSync(wav)) throw new Error(`${id}.wav not rendered`);
  const dur = wavSeconds(wav), parts = chunks(text), total = parts.reduce((s, p) => s + p.length, 0);
  let t = START[id];
  for (const p of parts) {
    const d = (dur * p.length) / total;
    cuesB.push([t, t + d, p]);
    t += d;
  }
}
const srt = (cues) => cues.map(([a, b, x], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${wrap(x)}\n`).join("\n");
const cost = readFileSync(join(here, "narration.txt"), "utf8").match(/costs ([^.]+)\./)?.[1];
writeFileSync(join(here, "subtitles-A.srt"), srt(SHORT.map(([a, b, x]) => [a, b, x === "CAPTION_COST" ? `${cost[0].toUpperCase()}${cost.slice(1)} per story · Gemma on AMD` : x])));
writeFileSync(join(here, "subtitles-B.srt"), srt(cuesB));
// overlaps would mean the START table is too tight for the voice
for (let i = 1; i < cuesB.length; i++) if (cuesB[i][0] < cuesB[i - 1][1] - 0.01) console.log(`overlap before: ${cuesB[i][2].slice(0, 40)}…`);
console.log(`wrote subtitles-A.srt (${SHORT.length} cues), subtitles-B.srt (${cuesB.length} cues), ends at ${ts(cuesB.at(-1)[1])}`);
