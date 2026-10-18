// synth-audio.mjs — synthesizes original, royalty-free music + SFX as WAV files.
// Pure DSP, no dependencies. Node 24, ESM. Deterministic (seeded PRNG).
// Usage: node synth-audio.mjs   (writes to ./public/audio/)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'public', 'audio');
mkdirSync(OUT, { recursive: true });

const SR = 48000;
const TAU = Math.PI * 2;
const T_START = Date.now();

// ---------- utils ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x5eed2026);
const nz = () => rng() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const lpCoef = (fc) => 1 - Math.exp((-TAU * fc) / SR);
const panGains = (p) => { const a = ((p + 1) * Math.PI) / 4; return [Math.cos(a), Math.sin(a)]; };
const makeBuf = (sec) => { const n = Math.round(sec * SR); return { n, L: new Float32Array(n), R: new Float32Array(n) }; };

// add a mono generator into a stereo buffer; pan may be a number or fn(t)
function addMono(B, t0, dur, pan, fn, send = 0, S = null) {
  const s0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const fixed = typeof pan === 'number';
  let [gl, gr] = fixed ? panGains(pan) : [0.707, 0.707];
  for (let j = 0; j < n; j++) {
    const i = s0 + j;
    if (i >= B.n) break;
    const t = j / SR;
    const v = fn(t);
    if (i < 0) continue;
    if (!fixed) [gl, gr] = panGains(pan(t));
    B.L[i] += v * gl; B.R[i] += v * gr;
    if (send && S) { S.L[i] += v * gl * send; S.R[i] += v * gr * send; }
  }
}
// two decorrelated channels (fresh closures) for stereo width
function twoCh(B, t0, dur, mk, width = 0.5, g = 1) {
  addMono(B, t0, dur, -width, mk(g));
  addMono(B, t0, dur, width, mk(g));
}
function peakOf(B) { let p = 0; for (let i = 0; i < B.n; i++) { const a = Math.abs(B.L[i]), b = Math.abs(B.R[i]); if (a > p) p = a; if (b > p) p = b; } return p; }
function scaleBuf(B, k) { for (let i = 0; i < B.n; i++) { B.L[i] *= k; B.R[i] *= k; } }
function normPeak(B, target = 1) { const p = peakOf(B); if (p > 0) scaleBuf(B, target / p); return B; }
function fadeTail(B, sec) { const m = Math.round(sec * SR); for (let j = 0; j < m; j++) { const i = B.n - 1 - j; const g = j / m; B.L[i] *= g; B.R[i] *= g; } }

// wavetables
const TS = 4096;
function makeTable(harm) {
  const t = new Float32Array(TS + 1); let mx = 0;
  for (let i = 0; i <= TS; i++) { let v = 0; const ph = (TAU * i) / TS; for (const [k, a] of harm) v += a * Math.sin(k * ph); t[i] = v; mx = Math.max(mx, Math.abs(v)); }
  for (let i = 0; i <= TS; i++) t[i] /= mx; return t;
}
const T_PAD = makeTable([[1, 1], [2, 0.32], [3, 0.14], [4, 0.06]]);
const T_BASS = makeTable([[1, 1], [2, 0.45], [3, 0.2], [4, 0.08]]);
const T_SAW = makeTable(Array.from({ length: 18 }, (_, k) => [k + 1, 1 / (k + 1)]));
function wt(t, ph) { const x = ph * TS; const i = x | 0; const f = x - i; return t[i] + (t[i + 1] - t[i]) * f; }

// WAV I/O
function writeWav(path, B) {
  const n = B.n, data = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    data[2 * i] = Math.max(-32768, Math.min(32767, Math.round(B.L[i] * 32767)));
    data[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(B.R[i] * 32767)));
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 4, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 4, 40);
  writeFileSync(path, Buffer.concat([h, Buffer.from(data.buffer)]));
}
function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not wav ' + path);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22), fmt: b.readUInt16LE(off + 8) };
    if (id === 'data') data = { off: off + 8, sz };
    off += 8 + sz + (sz & 1);
  }
  const frames = data.sz / (fmt.ch * 2);
  const L = new Float32Array(frames), R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { L[i] = b.readInt16LE(data.off + i * 4) / 32768; R[i] = b.readInt16LE(data.off + i * 4 + 2) / 32768; }
  return { ...fmt, frames, L, R };
}

// ---------- drum / hit samples (each normalized to peak 1) ----------
function sample(dur, build) { const B = makeBuf(dur); build(B); return normPeak(B, 1); }
const KICK = sample(0.5, (B) => { let ph = 0, lp = 0; addMono(B, 0, 0.5, 0, (t) => {
  const f = 45 + 115 * Math.exp(-t / 0.03); ph += f / SR; const x = nz(); lp += 0.3 * (x - lp);
  const v = Math.sin(TAU * ph) * Math.min(1, t / 0.001) * Math.exp(-t / 0.16) + (x - lp) * 0.3 * Math.exp(-t / 0.0025);
  return Math.tanh(1.4 * v); }); });
const KICK_SOFT = sample(0.4, (B) => { let ph = 0; addMono(B, 0, 0.4, 0, (t) => {
  const f = 50 + 70 * Math.exp(-t / 0.03); ph += f / SR; return Math.sin(TAU * ph) * Math.min(1, t / 0.002) * Math.exp(-t / 0.11); }); });
const CLAP = sample(0.35, (B) => twoCh(B, 0, 0.35, () => { let l1 = 0, l2 = 0; const a1 = lpCoef(3200), a2 = lpCoef(900); return (t) => {
  const x = nz(); l1 += a1 * (x - l1); l2 += a2 * (l1 - l2); const bp = l1 - l2; let env = 0;
  for (const o of [0, 0.011, 0.022]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) / 0.005));
  if (t >= 0.022) env = Math.max(env, 0.6 * Math.exp(-(t - 0.022) / 0.07)); return bp * env; }; }, 0.35));
const HATS = [0, 1, 2, 3].map(() => sample(0.12, (B) => twoCh(B, 0, 0.12, () => { let l1 = 0, l2 = 0; const a1 = lpCoef(6000), a2 = lpCoef(9000); return (t) => {
  const x = nz(); l1 += a1 * (x - l1); const h1 = x - l1; l2 += a2 * (h1 - l2); return (h1 - l2) * Math.min(1, t / 0.0005) * Math.exp(-t / 0.022); }; }, 0.3)));
const SHAKERS = [0, 1].map(() => sample(0.12, (B) => twoCh(B, 0, 0.12, () => { let l1 = 0; const a1 = lpCoef(5000); return (t) => {
  const x = nz(); l1 += a1 * (x - l1); return (x - l1) * Math.min(1, t / 0.008) * Math.exp(-t / 0.03); }; }, 0.35)));
const RIM = sample(0.08, (B) => { let l1 = 0, l2 = 0; const a1 = lpCoef(4000), a2 = lpCoef(1200); addMono(B, 0, 0.08, -0.2, (t) => {
  const x = nz(); l1 += a1 * (x - l1); l2 += a2 * (l1 - l2);
  return 0.6 * Math.sin(TAU * 1750 * t) * Math.exp(-t / 0.01) + 0.4 * Math.sin(TAU * 480 * t) * Math.exp(-t / 0.012) + 0.8 * (l1 - l2) * Math.exp(-t / 0.004); }); });
function crashSample(dur, tau) { return sample(dur, (B) => twoCh(B, 0, dur, () => { let l1 = 0, l2 = 0; const a1 = lpCoef(3500), a2 = lpCoef(11000); return (t) => {
  const x = nz(); l1 += a1 * (x - l1); const h = x - l1; l2 += a2 * (h - l2);
  return l2 * Math.min(1, t / 0.002) * (Math.exp(-t / tau) + 0.4 * Math.exp(-t / 0.06)) * Math.min(1, (dur - t) / 0.05); }; }, 0.6)); }
const CRASH = crashSample(3.5, 0.75);
const CRASH_BIG = crashSample(6.0, 1.4);
const TICK_HI = sample(0.03, (B) => addMono(B, 0, 0.03, 0.3, (t) => Math.sin(TAU * 2800 * t) * Math.exp(-t / 0.004) + nz() * 0.3 * Math.exp(-t / 0.001)));
const TICK_LO = sample(0.03, (B) => addMono(B, 0, 0.03, -0.3, (t) => Math.sin(TAU * 2000 * t) * Math.exp(-t / 0.004) + nz() * 0.3 * Math.exp(-t / 0.001)));
const SUB_BOOM = sample(2.2, (B) => { let ph = 0; addMono(B, 0, 2.2, 0, (t) => {
  const f = 38 + 32 * Math.exp(-t / 0.15); ph += f / SR; return Math.tanh(1.3 * Math.sin(TAU * ph) * Math.min(1, t / 0.003) * Math.exp(-t / 0.6)); }); });

// ---------- music ----------
const DUR = 166.0;
const M = makeBuf(DUR);
const SEND = makeBuf(DUR);
function place(S, t0, g) { const s0 = Math.round(t0 * SR); for (let j = 0; j < S.n; j++) { const i = s0 + j; if (i >= M.n) break; M.L[i] += S.L[j] * g; M.R[i] += S.R[j] * g; } }

function marimba(t0, midi, g, pan = 0.15, send = 0.3) { const f = mtof(midi);
  addMono(M, t0, 1.0, pan, (t) => g * Math.min(1, t / 0.002) * (Math.sin(TAU * f * t) * Math.exp(-t / 0.35) + 0.22 * Math.sin(TAU * f * 3.93 * t) * Math.exp(-t / 0.05) + 0.05 * Math.sin(TAU * f * 9.2 * t) * Math.exp(-t / 0.015)), send, SEND); }
function musicbox(t0, midi, g, pan = -0.25, send = 0.4) { const f = mtof(midi);
  addMono(M, t0, 1.5, pan, (t) => g * Math.min(1, t / 0.001) * (Math.sin(TAU * f * t) * Math.exp(-t / 0.7) + 0.25 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.25) + 0.1 * Math.sin(TAU * 3 * f * t) * Math.exp(-t / 0.12) + 0.06 * Math.sin(TAU * 4.2 * f * t) * Math.exp(-t / 0.05)) / 1.2, send, SEND); }
function pluck(t0, midi, g, pan = 0, send = 0.2) { const f = mtof(midi);
  addMono(M, t0, 0.6, pan, (t) => { let v = 0; for (let k = 1; k <= 5; k++) v += (Math.sin(TAU * f * k * t) * Math.exp(-t * (5 + 9 * k))) / k; return v * 0.5 * g * Math.min(1, t / 0.001); }, send, SEND); }
function bass(t0, midi, dur, g) { const f = mtof(midi); let ph = 0, lp = 0; const a = lpCoef(900);
  addMono(M, t0, dur + 0.05, 0, (t) => { ph += f / SR; if (ph >= 1) ph -= 1;
    let env = Math.min(1, t / 0.004) * (0.55 + 0.45 * Math.exp(-t / 0.12)); if (t > dur) env *= Math.max(0, 1 - (t - dur) / 0.05);
    lp += a * (wt(T_BASS, ph) - lp); return lp * env * g; }); }
function pad(t0, dur, midis, g, att = 0.2, rel = 0.5, cutoff = 2200) {
  for (const m of midis) for (const [pan, det] of [[-0.55, -0.004], [0.55, 0.004]]) {
    const f = mtof(m) * (1 + det); let ph = rng(), lp = 0; const a = lpCoef(cutoff);
    addMono(M, t0, dur + rel, pan, (t) => { ph += f / SR; if (ph >= 1) ph -= 1;
      let env = t < att ? t / att : 1; if (t > dur) env *= Math.max(0, 1 - (t - dur) / rel);
      lp += a * (wt(T_PAD, ph) - lp); return lp * env * g; }); } }
function bell(t0, midis, g, tau, len) { // ringing chord, detuned L/R
  for (const m of midis) for (const [pan, det] of [[-0.5, -0.003], [0.5, 0.003]]) {
    const f = mtof(m) * (1 + det); let ph = rng();
    addMono(M, t0, len, pan, (t) => { ph += f / SR; if (ph >= 1) ph -= 1; return wt(T_PAD, ph) * g * Math.min(1, t / 0.004) * Math.exp(-t / tau); }); } }
function stab(t0, midis, g, tau = 0.4) {
  midis.forEach((m, idx) => { const pan = idx === 0 ? 0 : idx % 2 ? 0.35 : -0.35; const f = mtof(m); let ph = rng(), lp = 0;
    addMono(M, t0, Math.min(tau * 5, 6), pan, (t) => { ph += f / SR; if (ph >= 1) ph -= 1;
      const fc = 500 + 4500 * Math.exp(-t / 0.15); lp += (1 - Math.exp((-TAU * fc) / SR)) * (wt(T_SAW, ph) - lp);
      return lp * g * Math.min(1, t / 0.003) * Math.exp(-t / tau); }); }); }
function riser(t0, dur, g) {
  twoCh(M, t0, dur, () => { let lp = 0; return (t) => { const u = t / dur; const fc = 200 * Math.pow(40, u); lp += lpCoef(fc) * (nz() - lp);
    return lp * g * u * u * Math.min(1, (dur - t) / 0.01); }; }, 0.5);
  let ph = 0; addMono(M, t0, dur, 0, (t) => { const u = t / dur; ph += (200 * Math.pow(6, u)) / SR; return 0.12 * g * u * u * Math.sin(TAU * ph) * Math.min(1, (dur - t) / 0.01); });
}

const PROG = [
  { bass: 36, fifth: 43, chord: [60, 64, 67], arp: [60, 64, 67, 72, 76, 72, 67, 64], low: [36, 43, 48, 55, 60, 64] },
  { bass: 33, fifth: 40, chord: [57, 60, 64], arp: [57, 60, 64, 69, 72, 69, 64, 60], low: [33, 40, 45, 52, 57, 60] },
  { bass: 41, fifth: 48, chord: [57, 60, 65], arp: [57, 60, 65, 69, 72, 69, 65, 60], low: [41, 48, 53, 57, 60, 65] },
  { bass: 43, fifth: 50, chord: [55, 59, 62], arp: [55, 59, 62, 67, 71, 67, 62, 59], low: [43, 50, 55, 59, 62, 67] },
];
// [beat, midi, durBeats] — C-major pentatonic lead, 4 bars
const PH_A = [[0, 76], [0.5, 79], [1, 81], [1.5, 79], [2, 76], [3, 72], [3.5, 74],
  [4, 76], [4.5, 76], [5, 74], [5.5, 72], [6, 69], [7, 72],
  [8, 81], [8.5, 79], [9, 81], [9.5, 84], [10, 81], [11, 79], [11.5, 76],
  [12, 74], [12.5, 76], [13, 79], [13.5, 74], [14, 79], [15.5, 74]];
const PH_B = [[0, 72], [0.5, 76], [1, 79], [1.5, 81], [2, 79], [2.5, 76], [3, 79],
  [4, 81], [4.5, 84], [5, 81], [5.5, 79], [6, 76], [7, 74], [7.5, 76],
  [8, 84], [8.5, 81], [9, 79], [9.5, 81], [10, 84], [10.5, 86], [11, 84],
  [12, 81], [12.5, 79], [13, 76], [13.5, 74], [14, 79], [15, 74], [15.5, 76]];
const BASS_PAT = [[0, 'r', 0.7], [1.5, 'f', 0.4], [2, 'r', 0.4], [2.75, 'o', 0.2], [3.5, 'f', 0.4]];
const bassNote = (ch, w) => (w === 'r' ? ch.bass : w === 'f' ? ch.fifth : ch.bass + 12);
const bars = (s, e) => { const r = []; for (let b = s, k = 0; b < e - 1e-9; b += 2, k++) r.push([b, k, PROG[k % 4]]); return r; };

function drive(s, e, o = {}) {
  for (const [b, k, ch] of bars(s, e)) {
    place(KICK, b, 0.9); place(KICK, b + 1.0, 0.85);
    if (o.extraKick) place(KICK, b + 1.75, 0.55);
    place(CLAP, b + 0.5, 0.42); place(CLAP, b + 1.5, 0.42);
    for (let j = 0; j < 8; j++) place(HATS[j % 4], b + j * 0.25, j % 2 ? 0.17 : 0.11);
    if (o.hats16) for (let j = 0; j < 8; j++) place(HATS[(j + 2) % 4], b + j * 0.25 + 0.125, 0.07);
    if (o.crashEveryBar) place(CRASH, b, 0.3);
    for (const [bt, w, d] of BASS_PAT) bass(b + bt * 0.5, bassNote(ch, w), d * 0.5, 0.36);
    pad(b, 2.0, ch.chord, o.padG ?? 0.03, 0.05, 0.25);
    if (o.arp) for (let j = 0; j < 8; j++) pluck(b + j * 0.25, ch.arp[j] + 12, 0.08, j % 2 ? 0.4 : -0.4, 0.15);
  }
  const leads = o.leads || [PH_A];
  for (let p = s, m = 0; p < e - 1e-9; p += 8, m++) for (const [bt, midi] of leads[m % leads.length]) {
    const t = p + bt * 0.5; if (t >= e - 1e-6) continue;
    marimba(t, midi, o.leadG ?? 0.3);
    if (o.musicbox) musicbox(t, midi + 12, 0.17);
  }
}
function accent(t, ch, g = 1) { place(CRASH, t, 0.4 * g); stab(t, ch.low.slice(1), 0.09 * g, 0.45); place(SUB_BOOM, t, 0.35 * g); }

// A 0–6: drone + riser + ticks
pad(0, 6.0, [36, 43, 48], 0.1, 2.5, 0.3, 900);
riser(0.3, 5.7, 0.35);
for (let t = 0; t < 6 - 1e-9; t += 0.5) place((t * 2) % 2 ? TICK_LO : TICK_HI, t, 0.07 + 0.02 * (t / 6));
for (let t = 4.25; t < 6 - 1e-9; t += 0.5) place(TICK_LO, t, 0.06);
// B 6–34 (big hit at 6.0)
place(KICK, 6, 1.0); place(SUB_BOOM, 6, 0.6); place(CRASH_BIG, 6, 0.5); stab(6, [36, 43, 48, 55, 60], 0.11, 1.0); bell(6, [36, 48, 55], 0.05, 1.2, 4);
drive(6, 34, { leads: [PH_A] });
// C 34–44: accents + quiet pad + riser
[[34, 0], [35.5, 2], [37.5, 3]].forEach(([t, c]) => { place(KICK, t, 1.0); stab(t, PROG[c].low, 0.1, 0.5); place(CRASH, t, 0.4); });
place(KICK, 40, 1.0); place(SUB_BOOM, 40, 0.75); place(CRASH_BIG, 40, 0.55); stab(40, [36, 43, 48, 55, 60, 64, 67], 0.11, 1.1); bell(40, [36, 48, 55, 64], 0.05, 1.5, 5);
pad(34.3, 5.5, [55, 60, 64], 0.035, 1.0, 0.8, 1500);
pad(40.5, 1.6, [57, 60, 65], 0.035, 0.6, 0.5, 1500);
for (let t = 38; t < 42 - 1e-9; t += 0.5) place(TICK_HI, t, 0.05);
riser(42, 2.0, 0.3);
for (let t = 43, j = 0; t < 44 - 1e-9; t += 0.125, j++) place(CLAP, t, 0.05 + 0.25 * (j / 8));
// D 44–68: lighter groove
for (const [b, k, ch] of bars(44, 68)) {
  place(KICK_SOFT, b, 0.55); place(KICK_SOFT, b + 1.0, 0.5);
  place(RIM, b + 0.5, 0.25); place(RIM, b + 1.5, 0.25); place(RIM, b + 1.75, 0.09);
  for (let j = 0; j < 8; j++) place(SHAKERS[j % 2], b + j * 0.25, j % 2 ? 0.08 : 0.05);
  for (let j = 0; j < 8; j++) pluck(b + j * 0.25, ch.arp[j], 0.17, j % 2 ? 0.35 : -0.35, 0.25);
  bass(b, ch.bass, 1.8, 0.26);
  pad(b, 2.0, ch.chord, 0.025, 0.3, 0.4, 1600);
}
// E 68–96: driving, varied lead, accents every 8 s
drive(68, 96, { leads: [PH_B, PH_A] });
for (let t = 68, k = 0; t < 96 - 1e-9; t += 8, k++) accent(t, PROG[0]);
// F 96–130: steady mid groove, lower level
place(CRASH, 96, 0.22); stab(96, PROG[0].chord, 0.05, 0.4);
for (const [b, k, ch] of bars(96, 130)) {
  place(KICK, b, 0.6); place(KICK, b + 1.0, 0.55);
  place(CLAP, b + 0.5, 0.22); place(CLAP, b + 1.5, 0.22);
  for (let j = 0; j < 8; j++) place(HATS[j % 4], b + j * 0.25, j % 2 ? 0.09 : 0.06);
  for (const [bt, w, d] of BASS_PAT) bass(b + bt * 0.5, bassNote(ch, w), d * 0.5, 0.28);
  for (let j = 0; j < 8; j++) pluck(b + j * 0.25, ch.arp[j], 0.12, j % 2 ? 0.35 : -0.35, 0.2);
  pad(b, 2.0, ch.chord, 0.025, 0.2, 0.3, 1600);
  if (k % 2 === 1) { marimba(b, ch.chord[2] + 12, 0.14); marimba(b + 0.75, ch.chord[1] + 12, 0.11); }
}
// G 130–148: climax
place(CRASH_BIG, 130, 0.35); place(SUB_BOOM, 130, 0.4);
drive(130, 148, { leads: [PH_A, PH_B], musicbox: true, hats16: true, crashEveryBar: true, extraKick: true, arp: true, padG: 0.035 });
// H 148–166: gentle decrescendo then final chord at 158
for (const [b, k, ch] of bars(148, 158)) {
  const gh = 1 - (0.6 * (b - 148)) / 10;
  pad(b, 2.0, ch.chord, 0.04 * gh, 0.3, 0.6, 1800);
  bass(b, ch.bass, 1.8, 0.2 * gh);
  place(KICK_SOFT, b, 0.3 * gh);
  place(RIM, b + 0.5, 0.12 * gh); place(RIM, b + 1.5, 0.12 * gh);
  for (let j = 0; j < 8; j++) place(SHAKERS[j % 2], b + j * 0.25, (j % 2 ? 0.07 : 0.045) * gh);
  musicbox(b, ch.chord[2] + 12, 0.14 * gh); musicbox(b + 1.0, ch.chord[1] + 12, 0.1 * gh);
}
place(KICK, 158, 1.0); place(SUB_BOOM, 158, 0.6); place(CRASH_BIG, 158, 0.5);
stab(158, [36, 48, 55, 60, 64, 67, 72], 0.08, 2.0);
bell(158, [36, 48, 55, 60, 64, 67, 72, 76], 0.035, 2.4, 8);
musicbox(158, 84, 0.2); marimba(158, 72, 0.25);

// ping-pong delay on lead send (dotted 8th)
{
  const D = Math.round(0.375 * SR), fb = 0.32, wet = 0.5, a = lpCoef(4000);
  const yL = new Float32Array(M.n), yR = new Float32Array(M.n); let lL = 0, lR = 0;
  for (let i = D; i < M.n; i++) {
    const inp = (SEND.L[i - D] + SEND.R[i - D]) * 0.5;
    lL += a * (inp + fb * yR[i - D] - lL); yL[i] = lL;
    lR += a * (fb * yL[i - D] - lR); yR[i] = lR;
    M.L[i] += yL[i] * wet; M.R[i] += yR[i] * wet;
  }
}
// final fade 161 -> 166 (raised cosine), last sample exactly 0
{
  const i0 = Math.round(161 * SR);
  for (let i = i0; i < M.n; i++) { const u = (i - i0) / (M.n - 1 - i0); const g = 0.5 * (1 + Math.cos(Math.PI * u)); M.L[i] *= g; M.R[i] *= g; }
}

// ---------- section leveling + limiter ----------
const SECTIONS = [['A', 0, 6], ['B', 6, 34], ['C', 34, 44], ['D', 44, 68], ['E', 68, 96], ['F', 96, 130], ['G', 130, 148], ['H', 148, 166]];
const TARGET = { B: -17, D: -22, E: -17, F: -22, G: -16.5 };
const CEIL = dbToLin(-1);
function rmsDb(L, R, t0, t1) { const i0 = Math.round(t0 * SR), i1 = Math.min(L.length, Math.round(t1 * SR)); let s = 0; for (let i = i0; i < i1; i++) s += L[i] * L[i] + R[i] * R[i]; return linToDb(Math.sqrt(s / (2 * (i1 - i0)))); }
function secGains(g) { const G = { ...g, A: g.B, C: Math.sqrt(g.B * g.E), H: g.G }; return SECTIONS.map(([n]) => G[n]); }
function limiter(L, R, ceil, look = 0.004, rel = 0.12) {
  const n = L.length, g = new Float32Array(n); let minG = 1;
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); g[i] = p > ceil ? ceil / p : 1; }
  const step = 1 / Math.round(look * SR);
  for (let i = n - 2; i >= 0; i--) { const v = g[i + 1] + step; if (v < g[i]) g[i] = v; }
  const rc = 1 - Math.exp(-1 / (rel * SR)); let cur = 1;
  for (let i = 0; i < n; i++) { cur += (1 - cur) * rc; if (g[i] < cur) cur = g[i]; L[i] *= cur; R[i] *= cur; if (cur < minG) minG = cur; }
  return minG;
}
function master(gains) {
  const G = secGains(gains), L = new Float32Array(M.n), R = new Float32Array(M.n), ramp = Math.round(0.03 * SR);
  SECTIONS.forEach(([, s, e], idx) => { const i0 = Math.round(s * SR), i1 = Math.round(e * SR), g = G[idx], gn = idx + 1 < G.length ? G[idx + 1] : g;
    for (let i = i0; i < i1; i++) { const rem = i1 - i; const gg = rem < ramp ? g + (gn - g) * (1 - rem / ramp) : g; L[i] = M.L[i] * gg; R[i] = M.R[i] * gg; } });
  const minG = limiter(L, R, CEIL);
  let p = 0; for (let i = 0; i < M.n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  const k = CEIL / p; for (let i = 0; i < M.n; i++) { L[i] *= k; R[i] *= k; }
  return { n: M.n, L, R, minG };
}
let gains = {};
for (const n of Object.keys(TARGET)) { const [, s, e] = SECTIONS.find((x) => x[0] === n); gains[n] = dbToLin(TARGET[n] - rmsDb(M.L, M.R, s, e)); }
let out;
for (let it = 0; it < 6; it++) {
  out = master(gains); let maxErr = 0;
  for (const n of Object.keys(TARGET)) { const [, s, e] = SECTIONS.find((x) => x[0] === n); const err = TARGET[n] - rmsDb(out.L, out.R, s, e); maxErr = Math.max(maxErr, Math.abs(err)); gains[n] *= dbToLin(err); }
  console.log(`master iter ${it}: max section error ${maxErr.toFixed(2)} dB, max limiter GR ${linToDb(out.minG).toFixed(1)} dB`);
  if (maxErr < 0.25) break;
}
writeWav(join(OUT, 'music.wav'), out);

// ---------- SFX ----------
function sfx(name, dur, build) { const B = makeBuf(dur); build(B); normPeak(B, dbToLin(-3)); fadeTail(B, Math.min(0.004, dur * 0.1)); writeWav(join(OUT, name), B); }

sfx('type.wav', 0.06, (B) => { let lp = 0; const a = lpCoef(2500); addMono(B, 0, 0.06, 0.05, (t) => {
  const x = nz(); lp += a * (x - lp); const click = (x - lp) * Math.exp(-t / 0.0025);
  const body = Math.sin(TAU * 2100 * t) * Math.exp(-t / 0.005) * 0.5 + Math.sin(TAU * 320 * t) * Math.exp(-t / 0.012) * 0.6;
  let second = 0; if (t > 0.022) { const u = t - 0.022; second = 0.3 * Math.sin(TAU * 1500 * u) * Math.exp(-u / 0.004) + 0.15 * nz() * Math.exp(-u / 0.0015); }
  return click + body * Math.min(1, t / 0.0003) + second; }); });

sfx('thump.wav', 0.7, (B) => { let ph = 0, lp = 0; const a = lpCoef(250); addMono(B, 0, 0.7, 0, (t) => {
  const f = 36 + 90 * Math.exp(-t / 0.06); ph += f / SR; lp += a * (nz() - lp);
  return Math.tanh(2 * (Math.sin(TAU * ph) * Math.min(1, t / 0.002) * Math.exp(-t / 0.2) + lp * 4 * Math.exp(-t / 0.06))); }); });

sfx('slip.wav', 0.9, (B) => { let ph = 0, pb = 0, lp = 0; const a = lpCoef(3000); addMono(B, 0, 0.9, 0, (t) => {
  let v = 0;
  if (t < 0.62) { const u = t / 0.62; const f = 1900 * Math.pow(300 / 1900, u) * (1 + 0.012 * Math.sin(TAU * 6 * t)); ph += f / SR;
    lp += a * (nz() - lp); const env = Math.min(1, t / 0.012) * Math.min(1, (0.62 - t) / 0.04);
    v += env * (0.7 * Math.sin(TAU * ph) + 0.12 * Math.sin(2 * TAU * ph) + 0.05 * lp); }
  if (t >= 0.64) { const u = t - 0.64; pb += (55 + 60 * Math.exp(-u / 0.03)) / SR; v += 0.8 * Math.sin(TAU * pb) * Math.exp(-u / 0.07) * Math.min(1, u / 0.002); }
  return v; }); });

sfx('stamp.wav', 0.5, (B) => { let ph = 0, l1 = 0, l2 = 0; const a1 = lpCoef(5000), a2 = lpCoef(900); addMono(B, 0, 0.5, 0, (t) => {
  const f = 50 + 90 * Math.exp(-t / 0.025); ph += f / SR; const thud = Math.sin(TAU * ph) * Math.exp(-t / 0.09) * Math.min(1, t / 0.001);
  const x = nz(); l1 += a1 * (x - l1); l2 += a2 * (l1 - l2); const slap = (l1 - l2) * 3 * Math.exp(-t / 0.018);
  return Math.tanh(1.5 * (thud + slap)); }); });

sfx('phone.wav', 1.2, (B) => { let ph = 0; const pulses = [[0, 0.48], [0.58, 1.06]]; addMono(B, 0, 1.2, 0, (t) => {
  const f = Math.floor(t * 40) % 2 ? 1480 : 1180; ph += f / SR; let env = 0;
  for (const [s, e] of pulses) if (t >= s) { const at = Math.min(1, (t - s) / 0.005); env = Math.max(env, at * (t < e ? 1 : Math.exp(-(t - e) / 0.03))); }
  return env * (Math.sin(TAU * ph) + 0.3 * Math.sin(2 * TAU * ph) + 0.12 * Math.sin(3 * TAU * ph)) * (0.85 + 0.15 * Math.sin(TAU * 20 * t)); }); });

sfx('tape.wav', 0.6, (B) => twoCh(B, 0, 0.6, () => { let l1 = 0, l2 = 0, gr = 1, grT = 0, grS = 1; return (t) => {
  const u = t / 0.6; const fc = 600 * Math.pow(3500 / 600, Math.min(1, u * 1.3));
  const x = nz(); l1 += lpCoef(fc * 1.8) * (x - l1); l2 += lpCoef(fc * 0.5) * (l1 - l2);
  if (t >= grT) { gr = 0.25 + 0.75 * rng(); grT = t + 0.002 + 0.006 * rng(); } grS += 0.2 * (gr - grS);
  const env = Math.min(1, t / 0.004) * (t < 0.42 ? 1 : Math.exp(-(t - 0.42) / 0.05)) + 1.5 * Math.exp(-t / 0.004);
  return (l1 - l2) * grS * env * (1 + 0.3 * Math.sin(TAU * 45 * t)); }; }, 0.35));

sfx('paper.wav', 0.6, (B) => {
  for (const side of [0, 1]) { let l1 = 0, l2 = 0, gr = 1, grT = 0, grS = 1;
    addMono(B, 0, 0.6, (t) => -0.6 + 1.2 * Math.min(1, t / 0.45) + (side ? 0.15 : -0.15), (t) => {
      const fc = t < 0.22 ? 900 * Math.pow(5, t / 0.22) : 4500 * Math.pow(0.4, Math.min(1, (t - 0.22) / 0.3));
      const x = nz(); l1 += lpCoef(Math.min(16000, fc * 1.7)) * (x - l1); l2 += lpCoef(fc * 0.5) * (l1 - l2);
      if (t >= grT) { gr = 0.3 + 0.7 * rng(); grT = t + 0.003 + 0.01 * rng(); } grS += 0.15 * (gr - grS);
      const env = t < 0.25 ? 0.15 + 0.85 * Math.sin((Math.PI / 2) * (t / 0.25)) : Math.exp(-(t - 0.25) / 0.09);
      return (l1 - l2) * grS * env; }); }
  let lp = 0; const a = lpCoef(400); addMono(B, 0.33, 0.25, 0.2, (t) => { lp += a * (nz() - lp); return lp * 3 * Math.exp(-t / 0.03) * Math.min(1, t / 0.002); });
});

sfx('whoosh.wav', 0.4, (B) => {
  for (const side of [0, 1]) { let l1 = 0, l2 = 0;
    addMono(B, 0, 0.4, (t) => -0.7 + 1.4 * (t / 0.4) + (side ? 0.12 : -0.12), (t) => {
      const fc = t < 0.17 ? 400 * Math.pow(15, t / 0.17) : 6000 * Math.pow(0.1, (t - 0.17) / 0.23);
      const x = nz(); l1 += lpCoef(fc) * (x - l1); l2 += lpCoef(150) * (l1 - l2);
      const env = t < 0.17 ? 0.15 + 0.85 * Math.pow(t / 0.17, 1.5) : Math.exp(-(t - 0.17) / 0.06);
      return (l1 - l2) * env; }); }
});

sfx('pop.wav', 0.12, (B) => { let ph = 0; addMono(B, 0, 0.12, 0, (t) => {
  ph += (350 + 900 * (1 - Math.exp(-t / 0.012))) / SR; return Math.sin(TAU * ph) * Math.min(1, t / 0.0008) * Math.exp(-t / 0.028) + 0.15 * nz() * Math.exp(-t / 0.0008); }); });

sfx('tick.wav', 0.04, (B) => { let lp = 0; addMono(B, 0, 0.04, 0, (t) => {
  const x = nz(); lp += 0.4 * (x - lp);
  return (Math.sin(TAU * 3200 * t) * 0.7 + Math.sin(TAU * 5100 * t) * 0.3) * Math.exp(-t / 0.004) * Math.min(1, t / 0.0002) + (x - lp) * 0.5 * Math.exp(-t / 0.0012); }); });

// ---------- verification (read back from disk) ----------
const EXPECT = { 'music.wav': 166.0, 'type.wav': 0.06, 'thump.wav': 0.7, 'slip.wav': 0.9, 'stamp.wav': 0.5, 'phone.wav': 1.2, 'tape.wav': 0.6, 'paper.wav': 0.6, 'whoosh.wav': 0.4, 'pop.wav': 0.12, 'tick.wav': 0.04 };
let ok = true;
console.log('\nfile          dur(s)    peak dBFS  onset(ms)  fmt');
for (const [f, d] of Object.entries(EXPECT)) {
  const w = readWav(join(OUT, f)); let p = 0, onset = -1, clip = 0;
  for (let i = 0; i < w.frames; i++) { const a = Math.max(Math.abs(w.L[i]), Math.abs(w.R[i])); if (a > p) p = a; if (a >= 32767 / 32768) clip++; }
  for (let i = 0; i < w.frames; i++) if (Math.max(Math.abs(w.L[i]), Math.abs(w.R[i])) >= p * 0.01) { onset = i; break; }
  const dur = w.frames / w.sr, pdb = linToDb(p);
  const bad = Math.abs(dur - d) > 0.5 / SR || clip > 0 || pdb < -40 || w.sr !== SR || w.ch !== 2 || w.bits !== 16 ||
    (f === 'music.wav' ? Math.abs(pdb + 1) > 0.1 : Math.abs(pdb + 3) > 0.2);
  if (bad) ok = false;
  console.log(`${f.padEnd(13)} ${dur.toFixed(4).padStart(8)}  ${pdb.toFixed(2).padStart(8)}  ${((onset * 1000) / SR).toFixed(2).padStart(8)}   ${w.sr}/${w.ch}ch/${w.bits}bit ${bad ? '  <-- PROBLEM' : ''}`);
  if (f === 'music.wav') {
    const res = SECTIONS.map(([n, s, e]) => `${n}(${s}-${e}) ${rmsDb(w.L, w.R, s, e).toFixed(1)}`);
    console.log('  section RMS dBFS: ' + res.join(' | '));
    const tail = rmsDb(w.L, w.R, 165.5, 166); console.log(`  last 0.5 s RMS: ${tail.toFixed(1)} dBFS, last sample: ${w.L[w.frames - 1]}, ${w.R[w.frames - 1]}`);
  }
}
console.log(`\n${ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} in ${((Date.now() - T_START) / 1000).toFixed(1)} s`);
if (!ok) process.exitCode = 1;
