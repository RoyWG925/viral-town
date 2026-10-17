// Tiny synthesized sound (WebAudio, no files): voice blips for lines, short stings for real events.
// Quiet by default, mutable, and silent until the player has clicked something (browser autoplay rules).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem("viral.muted") === "1";
} catch {
  /* storage unavailable: default to sound on */
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("viral.muted", m ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = m ? 0 : 0.16;
}

/** Call from a click handler: browsers only allow audio after a user gesture. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.16;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = "triangle", vol = 1, slideTo?: number) {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function noise(at: number, dur: number, vol = 0.5, lowpass = 900) {
  if (!ctx || !master || muted) return;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lowpass;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(at);
}

// each resident has their own voice pitch (Hz)
const VOICE: Record<string, number> = { baker: 150, florist: 290, journalist: 320, cafe: 270, police: 120, mayor: 135, organizer: 175, vendor: 240 };

/** Animalese-style blips for a spoken line (a handful, not one per character). */
export function voice(npc: string, text: string, phone = false) {
  if (!ctx || muted) return;
  const base = VOICE[npc] ?? 200;
  const n = Math.min(12, Math.max(4, Math.round(text.length / 3)));
  const t0 = ctx.currentTime + 0.05;
  const asks = /[？?]$/.test(text.trim());
  for (let i = 0; i < n; i++) {
    const rise = asks && i >= n - 2 ? 1.25 : 1;
    const f = base * Math.pow(2, (((i * 7) % 5) - 2) / 12) * rise;
    tone(phone ? f * 1.1 : f, t0 + i * 0.085, 0.05, phone ? "square" : "triangle", phone ? 0.18 : 0.35);
  }
}

export const sting = {
  whisper() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(880, t, 0.5, "sine", 0.25, 1320);
    tone(1320, t + 0.12, 0.6, "sine", 0.15);
  },
  ring() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const k of [0, 0.18]) tone(1046, t + k, 0.12, "square", 0.15);
  },
  believe() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(523, t, 0.12, "triangle", 0.35);
    tone(659, t + 0.1, 0.18, "triangle", 0.35);
  },
  doubt() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(330, t, 0.25, "triangle", 0.3, 300);
  },
  world() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(110, t, 0.35, "sine", 0.6, 70);
    noise(t, 0.18, 0.35, 600);
  },
  big() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(98, t, 0.6, "sine", 0.7, 55);
    noise(t, 0.3, 0.45, 500);
    for (const [k, f] of [[0.25, 392], [0.4, 494], [0.55, 587]] as const) tone(f, t + k, 0.35, "triangle", 0.3);
  },
  end() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [k, f] of [[0, 523], [0.08, 659], [0.16, 784]] as const) tone(f, t + k, 0.9, "sine", 0.18);
  },
  /** a small goal got ticked: a rubber-stamp thump and a bright two-note pop */
  stamp() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.08, 0.5, 1400);
    tone(160, t, 0.12, "sine", 0.5, 90);
    tone(784, t + 0.07, 0.14, "triangle", 0.3);
    tone(1175, t + 0.15, 0.22, "triangle", 0.25);
  },
};
