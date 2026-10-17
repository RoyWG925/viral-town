// Background music, synthesized in the browser (WebAudio, no files, no licences): a light music-box tune in the
// afternoon, warmer pads at dusk, a hush at night, and a festival tune for the 20:00 finale. Moods crossfade; the
// tune is generated from a small seeded pattern so it does not loop identically. It plays through the same master
// as the sound effects, so the mute button silences both, and it waits for the first click like all browser audio.
import { audioOut } from "./sfx";

export type Mood = "day" | "dusk" | "night" | "festival" | "off";

// pentatonic scales (MIDI note numbers)
const C_PENTA = [60, 62, 64, 67, 69, 72, 74, 76];
const A_MINOR_PENTA = [57, 60, 62, 64, 67, 69, 72];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Style {
  bpm: number;
  scale: number[];
  /** chance a step has a melody note */
  density: number;
  /** bass root notes per bar */
  bass: number[];
  lead: OscillatorType;
  leadVol: number;
  pad: boolean;
  drums: boolean;
  vol: number;
}
const STYLES: Record<Exclude<Mood, "off">, Style> = {
  day: { bpm: 96, scale: C_PENTA, density: 0.42, bass: [48, 45, 41, 43], lead: "triangle", leadVol: 0.22, pad: false, drums: false, vol: 0.5 },
  dusk: { bpm: 78, scale: A_MINOR_PENTA, density: 0.28, bass: [45, 41, 48, 43], lead: "sine", leadVol: 0.2, pad: true, drums: false, vol: 0.45 },
  night: { bpm: 64, scale: A_MINOR_PENTA, density: 0.14, bass: [45, 41], lead: "sine", leadVol: 0.16, pad: true, drums: false, vol: 0.35 },
  festival: { bpm: 118, scale: C_PENTA, density: 0.7, bass: [48, 48, 43, 45], lead: "square", leadVol: 0.1, pad: false, drums: true, vol: 0.55 },
};

let mood: Mood = "off";
let gain: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextAt = 0;
let step = 0;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function voiceNote(ctx: AudioContext, out: AudioNode, freq: number, at: number, dur: number, type: OscillatorType, vol: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function drum(ctx: AudioContext, out: AudioNode, at: number, kind: "low" | "wood") {
  if (kind === "wood") return voiceNote(ctx, out, 1600, at, 0.05, "triangle", 0.12);
  // a soft festival drum: a falling sine thump
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, at);
  o.frequency.exponentialRampToValueAtTime(55, at + 0.18);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + 0.3);
}

/** schedule the next half second of music, one eighth note at a time */
function tick() {
  const a = audioOut();
  if (!a || mood === "off") return;
  const { ctx, master } = a;
  if (!gain) {
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
  }
  const s = STYLES[mood];
  const eighth = 60 / s.bpm / 2;
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + 0.5) {
    const bar = Math.floor(step / 8) % s.bass.length;
    const inBar = step % 8;
    if (inBar === 0) {
      voiceNote(ctx, gain, hz(s.bass[bar]), nextAt, eighth * 7, "sine", 0.18);
      if (s.pad) for (const iv of [7, 12, 16]) voiceNote(ctx, gain, hz(s.bass[bar] + iv), nextAt, eighth * 8, "sine", 0.035);
    }
    if (s.drums) {
      if (inBar === 0 || inBar === 4) drum(ctx, gain, nextAt, "low");
      if (inBar === 2 || inBar === 6 || (inBar === 7 && rand() < 0.4)) drum(ctx, gain, nextAt, "wood");
    }
    if (rand() < s.density) {
      // a gentle contour: mostly steps, sometimes a leap
      const k = Math.floor(rand() * s.scale.length);
      voiceNote(ctx, gain, hz(s.scale[k] + (mood === "night" ? 12 : 0)), nextAt, eighth * (rand() < 0.3 ? 2 : 1.2), s.lead, s.leadVol);
    }
    nextAt += eighth;
    step++;
  }
}

/** Change the music's mood (crossfades); "off" fades it out. Safe to call often and before audio is unlocked. */
export function setMusic(next: Mood) {
  if (typeof window === "undefined" || next === mood) return;
  mood = next;
  const a = audioOut();
  if (a && gain) {
    const t = a.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(next === "off" ? 0 : STYLES[next].vol, t + 1.5);
  }
  if (next === "off") return;
  if (!timer) timer = setInterval(() => {
    tick();
    // fade in once audio exists (the first click unlocks it)
    const b = audioOut();
    if (b && gain && mood !== "off" && gain.gain.value === 0) gain.gain.linearRampToValueAtTime(STYLES[mood].vol, b.ctx.currentTime + 2);
  }, 200);
}
