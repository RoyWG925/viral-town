// VIRAL promo (≈2:46). Every game shot is a real screen recording (lab/video/record.mjs); all text and graphics are
// rendered here and animated over it. 120 BPM: a bar is 2 s, cuts and slams land on beats. Narration: Gemini TTS
// (public/vo2), captioned word for word where it is not already the big text on screen.
import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { loadFont as loadLilita } from "@remotion/google-fonts/LilitaOne";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import data from "./promo-data.json";
import zoomData from "./zoom.json";
import voDur from "./vo-dur.json";

const { fontFamily: LILITA } = loadLilita();
const { fontFamily: DM } = loadDM("normal", { weights: ["400", "600", "700"], subsets: ["latin"] });
export const FPS = 30;
export const PROMO_SECONDS = 166;
const C = { orange: "#E2692A", light: "#F7A246", brown: "#2B211C", cream: "#FFF4E2", accent: "#FFB866", molly: "#8A5A3C", rosa: "#B9472F" };
const F = (s: number) => Math.round(s * FPS);
const AV: Record<string, string> = { Molly: "cafe", "Chief Harlow": "police", Gus: "organizer", Penny: "journalist", Rosa: "vendor", "Mayor Higgins": "mayor", Barney: "baker", Daisy: "florist" };
type Z = { zoom?: number; focus?: [number, number] };
const ZD = zoomData as Record<string, Z>;
const zoomOf = (id: string, fallback: Z): Required<Z> => ({ zoom: ZD[id]?.zoom ?? fallback.zoom ?? 1.8, focus: (ZD[id]?.focus ?? fallback.focus ?? [960, 540]) as [number, number] });

// ---------- building blocks ----------
function useIn(at = 0, frames = 12) {
  const f = useCurrentFrame();
  return spring({ frame: f - F(at), fps: FPS, durationInFrames: frames, config: { damping: 14, stiffness: 180 } });
}

function Clip({ src, from, rate = 1, zoom = 1, focus = [960, 540], dark = 0 }: { src: string; from: number; rate?: number; zoom?: number; focus?: [number, number]; dark?: number }) {
  const f = useCurrentFrame();
  const z = zoom === 1 ? 1 : interpolate(spring({ frame: f, fps: FPS, durationInFrames: 12, config: { damping: 200 } }), [0, 1], [1, zoom]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <OffthreadVideo src={staticFile(`clips/${src}.mp4`)} trimBefore={F(from)} playbackRate={rate} muted style={{ transform: `scale(${z})`, transformOrigin: `${focus[0]}px ${focus[1]}px` }} />
      {dark > 0 && <AbsoluteFill style={{ background: `rgba(20,14,10,${dark})` }} />}
    </AbsoluteFill>
  );
}

function Honest({ text, top }: { text: string; top?: boolean }) {
  return (
    <div style={{ position: "absolute", left: 28, ...(top ? { top: 28 } : { bottom: 28 }), fontFamily: DM, fontSize: 24, fontWeight: 600, color: "#fff", opacity: 0.7, background: "rgba(43,33,28,.7)", padding: "6px 16px", borderRadius: 999 }}>{text}</div>
  );
}

function Avatar({ who, size = 120 }: { who: string; size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size, borderRadius: size, overflow: "hidden", background: C.accent, border: `5px solid ${C.cream}`, flex: "none", boxShadow: "0 6px 18px rgba(0,0,0,.35)" }}>
      <Img src={staticFile(`img/cast/${AV[who]}.png`)} style={{ position: "absolute", width: size * 1.3, left: -size * 0.15, top: AV[who] === "baker" || AV[who] === "mayor" ? -size * 0.42 : -size * 0.08 }} />
    </div>
  );
}

/** a line said or thought, quoted from the run's log, big enough to read */
function Dialogue({ who, text, at = 0.15, dur, size = 46, place = "bottom", maxWidth = 1400 }: { who: string; text: string; at?: number; dur: number; size?: number; place?: "bottom" | "top" | "low"; maxWidth?: number }) {
  const f = useCurrentFrame();
  const inn = useIn(at, 14);
  const out = interpolate(f, [F(at + dur) - 8, F(at + dur)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f < F(at) || f > F(at + dur)) return null;
  const pos = place === "top" ? { top: 120 } : place === "low" ? { bottom: 150 } : { bottom: 70 };
  return (
    <div style={{ position: "absolute", left: 0, right: 0, ...pos, display: "flex", justifyContent: "center", opacity: (1 - out) * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 40 - out * 30}px) scale(${0.9 + 0.1 * inn})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, maxWidth }}>
        <Avatar who={who} size={Math.round(size * 2.6)} />
        <div style={{ background: C.cream, color: C.brown, borderRadius: 28, padding: "18px 30px", boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>
          <div style={{ fontFamily: LILITA, fontSize: size * 0.62, color: C.orange, letterSpacing: 0.5 }}>{who}</div>
          <div style={{ fontFamily: DM, fontWeight: 700, fontSize: size, lineHeight: 1.18 }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

function Slam({ text, at = 0, size = 140, color = C.cream, y = 0, dur = 99, stroke = true }: { text: string; at?: number; size?: number; color?: string; y?: number; dur?: number; stroke?: boolean }) {
  const f = useCurrentFrame();
  const inn = useIn(at, 10);
  const out = interpolate(f, [F(at + dur) - 6, F(at + dur)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f < F(at) || f > F(at + dur)) return null;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(${y}px)` }}>
      <div style={{ fontFamily: LILITA, fontSize: size, color, textAlign: "center", lineHeight: 1.05, maxWidth: 1700, opacity: Math.min(1, inn * 2) * (1 - out), transform: `scale(${interpolate(inn, [0, 1], [1.7, 1])})`, textShadow: stroke ? `0 6px 0 ${C.brown}, 0 0 30px rgba(0,0,0,.45)` : undefined }}>{text}</div>
    </AbsoluteFill>
  );
}

function Sign({ at = 0, size = 230 }: { at?: number; size?: number }) {
  const f = useCurrentFrame();
  const inn = useIn(at, 12);
  if (f < F(at)) return null;
  const shake = interpolate(f - F(at), [8, 11, 14, 17, 20], [0, -10, 8, -4, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const layers = [1, 2, 3, 4, 5].map((k) => `0 ${k * 6}px 0 ${["#C9561F", "#B84E1C", "#A24416", "#8E3B13", "#7A320F"][k - 1]}`).join(", ");
  return (
    <div style={{ transform: `translateX(${shake}px) rotate(-8deg) scale(${interpolate(inn, [0, 1], [2.2, 1])})`, opacity: Math.min(1, inn * 2), background: `linear-gradient(135deg, ${C.light}, ${C.orange})`, borderRadius: 40, padding: "10px 60px 34px", boxShadow: "0 24px 50px rgba(0,0,0,.45)" }}>
      <div style={{ fontFamily: LILITA, fontSize: size, color: "#fff", lineHeight: 1, textShadow: layers }}>VIRAL</div>
    </div>
  );
}

function Stamp({ text, color, at = 0, size = 86, rot = -10 }: { text: string; color: string; at?: number; size?: number; rot?: number }) {
  const f = useCurrentFrame();
  const inn = useIn(at, 9);
  if (f < F(at)) return null;
  return (
    <div style={{ display: "inline-block", fontFamily: LILITA, fontSize: size, color, border: `8px solid ${color}`, borderRadius: 18, padding: "6px 28px", background: "rgba(255,244,226,.88)", transform: `rotate(${rot}deg) scale(${interpolate(inn, [0, 1], [2.4, 1])})`, opacity: Math.min(1, inn * 2), boxShadow: "0 12px 30px rgba(0,0,0,.35)", letterSpacing: 2 }}>{text}</div>
  );
}

function Count({ to, at = 0, dur = 1, fmt }: { to: number; at?: number; dur?: number; fmt: (n: number) => string }) {
  const f = useCurrentFrame();
  const v = interpolate(f, [F(at), F(at + dur)], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3) });
  return <>{fmt(v)}</>;
}

/** people reached · Gemma calls · cost, stepping with the run's real events */
function Stats({ steps, horizontal, label }: { steps: { at: number; reach: number; calls: number; cost?: number; callLabel?: string }[]; horizontal?: boolean; label?: string }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  const cur = [...steps].reverse().find((s) => t >= s.at) ?? { reach: 0, calls: 0, cost: steps[0]?.cost === undefined ? undefined : 0, at: 0 };
  const prev = steps[steps.indexOf(cur as (typeof steps)[number]) - 1] ?? { reach: 0, calls: 0, cost: 0 };
  const k = interpolate(t, [cur.at, cur.at + 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const callName = steps[0]?.callLabel ?? "Gemma calls";
  const lerp = (a = 0, b = 0) => a + (b - a) * k;
  const items = [
    { icon: "👥", name: "people reached", v: Math.round(lerp(prev.reach, cur.reach)).toString() },
    { icon: "🧠", name: callName, v: Math.round(lerp(prev.calls, cur.calls)).toString() },
    ...(cur.cost === undefined ? [] : [{ icon: "💲", name: "cost", v: `$${lerp(prev.cost, cur.cost).toFixed(4)}` }]),
  ];
  return (
    <div style={{ display: "flex", flexDirection: horizontal ? "row" : "column", gap: horizontal ? 34 : 22, background: "rgba(43,33,28,.85)", borderRadius: 20, padding: horizontal ? "12px 26px" : "22px 26px", color: C.cream, fontFamily: DM, alignItems: horizontal ? "center" : "flex-start" }}>
      {label && <div style={{ fontSize: 22, fontWeight: 700, color: C.accent }}>{label}</div>}
      {items.map((x) => (
        <div key={x.name} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 30 }}>{x.icon}</span>
          <span style={{ fontFamily: LILITA, fontSize: 48 }}>{x.v}</span>
          <span style={{ fontSize: 24, opacity: 0.85 }}>{x.name}</span>
        </div>
      ))}
    </div>
  );
}

function Step({ n, text, at = 0 }: { n: string; text: string; at?: number }) {
  const inn = useIn(at, 10);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 34, display: "flex", justifyContent: "center", gap: 14, alignItems: "center", transform: `translateY(${(1 - inn) * -50}px)`, opacity: Math.min(1, inn * 2) }}>
      <span style={{ fontFamily: LILITA, fontSize: 40, background: C.orange, color: "#fff", padding: "6px 18px", borderRadius: 14 }}>STEP {n}</span>
      <span style={{ fontFamily: LILITA, fontSize: 56, color: "#fff", textShadow: `0 4px 0 ${C.brown}` }}>{text}</span>
    </div>
  );
}

function Trail({ nodes }: { nodes: { label: string; at: number }[] }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  return (
    <div style={{ position: "absolute", right: 30, top: 30, display: "flex", alignItems: "center", gap: 8, fontFamily: DM, fontWeight: 700, fontSize: 24 }}>
      {nodes.map((n, i) => {
        const k = interpolate(t, [n.at, n.at + 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: C.cream, opacity: k, textShadow: "0 2px 6px #000" }}>→</span>}
            <span style={{ opacity: k, transform: `scale(${0.6 + 0.4 * k})`, background: C.cream, color: C.brown, padding: "6px 14px", borderRadius: 999, boxShadow: "0 4px 12px rgba(0,0,0,.35)" }}>{n.label}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** narration captions, word for word, phrase by phrase in proportion to the clip's length */
function Caption({ text, at, dur, middle }: { text: string; at: number; dur: number; middle?: boolean }) {
  const f = useCurrentFrame();
  const t = f / FPS - at;
  if (t < 0 || t > dur + 0.2) return null;
  const parts = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  const total = parts.reduce((s, p) => s + p.length, 0);
  let acc = 0, cur = parts[0];
  for (const p of parts) { const end = ((acc + p.length) / total) * dur; if (t <= end) { cur = p; break; } acc += p.length; cur = p; }
  return (
    <div style={{ position: "absolute", left: 0, right: 0, ...(middle ? { top: 500 } : { bottom: 34 }), display: "flex", justifyContent: "center" }}>
      <div style={{ fontFamily: DM, fontWeight: 700, fontSize: 40, color: "#fff", background: "rgba(20,14,10,.78)", padding: "10px 26px", borderRadius: 14, maxWidth: 1500, textAlign: "center" }}>{cur}</div>
    </div>
  );
}

function Typewriter({ text, at, cps, size, font = LILITA, color = C.cream }: { text: string; at: number; cps: number; size: number; font?: string; color?: string }) {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((f / FPS - at) * cps)));
  if (f / FPS < at) return null;
  return <div style={{ fontFamily: font, fontSize: size, color, textAlign: "center", maxWidth: 1600, lineHeight: 1.2 }}>{text.slice(0, n)}<span style={{ opacity: Math.floor(f / 8) % 2 ? 1 : 0.2 }}>|</span></div>;
}

// ---------- the sections ----------
// when each narration line starts; lengths come from the rendered WAVs (node vo-dur.mjs)
const VO_AT: Record<string, number> = { "vo-a": 0.35, "vo-c": 34.15, "vo-d1": 44.3, "vo-d2": 50.3, "vo-d3": 55.3, "vo-d4": 58.6, "vo-e1": 68.45, "vo-e2": 92.55, "vo-f1": 96.4, "vo-f2": 116.4, "vo-g": 131.0, "vo-h": 154.0 };
const VO = Object.fromEntries(Object.entries(VO_AT).map(([id, at]) => [id, [at, (voDur as Record<string, number>)[id] ?? 2] as const]));
const LINES: Record<string, string> = {
  "vo-d1": "Pick anyone.",
  "vo-d2": "Whisper anything.",
  "vo-d3": "Then watch them decide.",
  "vo-d4": "Every choice is Gemma, running on AMD.",
  "vo-e1": "Same town. A different sentence. A different night.",
  "vo-f1": "We built the town and its rules. Gemma decides what each resident believes, says and does. The engine decides what actually happens.",
  "vo-f2": "A full story costs less than a quarter of a cent. Made for players, streamers and classrooms.",
};
const SENTENCE_A = "“I heard tonight's stage was thrown together from old planks.”";

function A() {
  return (
    <AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center", gap: 40 }}>
      <Typewriter text="I told Molly one sentence." at={0.3} cps={13} size={110} />
      <Typewriter text={SENTENCE_A} at={2.6} cps={22} size={52} font={DM} color={C.accent} />
    </AbsoluteFill>
  );
}

// B: Molly's run (P23-stage-cafe), 3×; [source from, length, zoom id, dialogue]
const B_SHOTS: { from: number; dur: number; id: string; who?: string; text?: string; slam?: string }[] = [
  { from: 6.6, dur: 3.5, id: "b1", who: "Molly", text: "My daughter is performing tonight, please tell me it's safe!" },
  { from: 15.2, dur: 3.5, id: "b2", who: "Chief Harlow", text: "A loose strut is a disaster waiting to happen. I can't let this stand." },
  { from: 20.3, dur: 3.5, id: "b3", who: "Chief Harlow", text: "I've taped it off. Fix it now." },
  { from: 26.4, dur: 4.0, id: "b4", slam: "🍌" },
  { from: 30.9, dur: 3.0, id: "b5", slam: "“Everything is perfectly safe!”" },
  { from: 33.9, dur: 3.5, id: "b6", who: "Gus", text: "Please, remove the tape so we don't cause a panic!" },
  { from: 42.3, dur: 3.5, id: "b7", who: "Chief Harlow", text: "The tape stays up, Gus." },
  { from: 54.0, dur: 3.5, id: "b8", who: "Penny", text: "A taped-off stage? Now that's a headline." },
];
function B() {
  let at = 0;
  return (
    <AbsoluteFill>
      {B_SHOTS.map((s, i) => {
        const start = at;
        at += s.dur;
        const z = zoomOf(s.id, { zoom: 2.0 });
        return (
          <Sequence key={i} from={F(start)} durationInFrames={F(s.dur)}>
            <Clip src="hook" from={s.from} zoom={s.slam ? Math.min(z.zoom, 1.8) : z.zoom} focus={z.focus} />
            {s.who && <Dialogue who={s.who} text={s.text!} dur={s.dur - 0.3} />}
            {s.slam === "🍌" && <><Slam text="🍌" at={0.9} size={300} stroke={false} y={-40} dur={3} /><Slam text="SLIP!" at={1.1} size={120} y={200} dur={2.8} /></>}
            {s.slam && s.slam !== "🍌" && <Slam text={s.slam} at={0.2} size={110} dur={2.7} />}
          </Sequence>
        );
      })}
      <Trail nodes={[{ label: "You", at: 0 }, { label: "Molly", at: 0.4 }, { label: "Chief Harlow", at: 1.6 }, { label: "🚧", at: 7.2 }, { label: "Gus", at: 8.4 }, { label: "Penny", at: 24.6 }]} />
      <Honest text="📼 Recorded run · real Gemma on AMD · 3×" />
    </AbsoluteFill>
  );
}

function CSec() {
  return (
    <AbsoluteFill>
      <Clip src="town" from={0.5} rate={0.75} dark={0.4} />
      <Slam text="Eight residents." at={0.0} size={150} dur={1.5} />
      <Slam text="Every one keeps a secret." at={1.5} size={130} dur={2.0} />
      <Slam text="No script." at={3.5} size={170} dur={2.4} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><Sign at={6.0} /></AbsoluteFill>
    </AbsoluteFill>
  );
}

// D: the live round; [from, to, speed]
const D_SHOTS = [
  { from: 2.0, to: 8.0, rate: 1, id: "d1", fall: { zoom: 1.8, focus: [16, 1063] as [number, number] }, step: ["01", "Pick anyone"] },
  { from: 6.0, to: 12.6, rate: 1.32, id: "d1", fall: { zoom: 2.2, focus: [16, 1063] as [number, number] }, step: ["02", "Whisper anything"] },
  { from: 23.4, to: 35.4, rate: 2, id: "d2", fall: { zoom: 1.8 }, step: ["03", "Watch them decide"], who: "Chief Harlow", text: "A fire hazard in town right before the festival is unacceptable. I must check it." },
  { from: 51.4, to: 72.4, rate: 3, id: "d4", fall: { zoom: 1.6 }, who: "Chief Harlow", text: "Barney, I've seen the sticker on your oven. It's two months out of date.", textAt: 4.2 },
];
function D() {
  let at = 0;
  // the live log's moments, placed where the cut shows them: planted, first decision, the skipped look, the sticker, telling Barney
  const liveSteps = data.live.map((x, i) => ({ at: [10.9, 11.2, 17.0, 19.9, 21.9][i], reach: x.reach, calls: x.decisions, callLabel: "Gemma decisions" }));
  return (
    <AbsoluteFill>
      {D_SHOTS.map((s, i) => {
        const dur = (s.to - s.from) / s.rate;
        const start = at;
        at += dur;
        const z = zoomOf(i === 1 ? "d1-input" : s.id, s.fall);
        return (
          <Sequence key={i} from={F(start)} durationInFrames={F(dur)}>
            <Clip src="live" from={s.from} rate={s.rate} zoom={z.zoom} focus={z.focus} />
            {s.step && <Step n={s.step[0]} text={s.step[1]} at={0.1} />}
            {s.who && <Dialogue who={s.who} text={s.text!} at={s.textAt ?? 0.6} dur={dur - (s.textAt ?? 0.6) - 0.2} size={42} place="low" />}
            <Honest text={`● Live · real Gemma on AMD${s.rate !== 1 ? ` · ${s.rate}×` : ""}`} />
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", right: 34, top: 200 }}><Stats steps={liveSteps} label="This live round" /></div>
    </AbsoluteFill>
  );
}

// E: two runs side by side, beat for beat
function Half({ side, src, beats, title, color }: { side: "left" | "right"; src: string; beats: { from: number; who: string; text: string; id: string }[]; title: string; color: string }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  const open = interpolate(f, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const steps = (side === "left" ? data.left : data.right).map((s, i) => ({ at: i * 5 + 0.3, reach: s.reach, calls: s.calls, cost: s.cost }));
  const tot = side === "left" ? data.leftTotal : data.rightTotal;
  steps.push({ at: 20.3, reach: tot.reach, calls: tot.calls, cost: tot.cost });
  const k = Math.min(3, Math.floor(t / 5));
  const b = beats[k];
  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, width: 960, [side]: 0, overflow: "hidden", clipPath: `inset(0 ${side === "left" ? (1 - open) * 100 : 0}% 0 ${side === "right" ? (1 - open) * 100 : 0}%)` }}>
      {beats.map((bt, i) => (
        <Sequence key={i} from={F(i * 5)} durationInFrames={i === 3 ? F(9) : F(5)}>
          <div style={{ position: "absolute", top: 0, left: Math.max(-960, Math.min(0, -(zoomOf(bt.id, {}).focus[0] - 480))), width: 1920, height: 1080 }}>
            <OffthreadVideo src={staticFile(`clips/${src}.mp4`)} trimBefore={F(bt.from)} muted />
          </div>
        </Sequence>
      ))}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, background: color, color: "#fff", fontFamily: DM, fontWeight: 700, fontSize: 30, padding: "18px 26px", lineHeight: 1.25 }}>{title}</div>
      <div style={{ position: "absolute", left: 22, top: 140, fontFamily: DM, fontWeight: 600, fontSize: 22, color: "#fff", opacity: 0.75, background: "rgba(43,33,28,.7)", padding: "5px 14px", borderRadius: 999 }}>📼 Recorded run · real Gemma on AMD · 3×</div>
      {t < 20 && <Dialogue key={k} who={b.who} text={b.text} at={k * 5 + 0.4} dur={4.3} size={32} place="low" maxWidth={900} />}
      <div style={{ position: "absolute", bottom: 26, left: 0, right: 0, display: "flex", justifyContent: "center" }}><Stats steps={steps} horizontal /></div>
      {t >= 20 && <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><Stamp text={side === "left" ? "STAGE SEALED" : "BUDGET EXPOSÉ"} color={side === "left" ? "#B4400C" : "#1F5379"} at={side === "left" ? 20.3 : 20.9} size={78} /></AbsoluteFill>}
    </div>
  );
}
function E() {
  const f = useCurrentFrame();
  const line = interpolate(f, [0, 12], [0, 100], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={F(24)}>
        <Half side="left" src="hook" title="To Molly: “I heard tonight's stage was thrown together from old planks.”" color={C.molly}
          beats={[{ from: 5.5, id: "e_l1", who: "Molly", text: "My daughter is performing tonight, please tell me it's safe!" }, { from: 14.5, id: "e_l2", who: "Chief Harlow", text: "A loose strut is a disaster waiting to happen." }, { from: 19.6, id: "e_l3", who: "Chief Harlow", text: "I've taped it off. Fix it now." }, { from: 29.5, id: "e_l4", who: "Gus", text: "Everything is perfectly safe!" }]} />
        <Half side="right" src="contrast" title="To Rosa: “The stall fee went up because the mayor spent the money on a new car.”" color={C.rosa}
          beats={[{ from: 7.0, id: "e_r1", who: "Rosa", text: "Can you dig into this? We need the truth!" }, { from: 14.0, id: "e_r2", who: "Penny", text: "A 30% overrun! Now I just need to link this to the mayor's pockets." }, { from: 21.0, id: "e_r3", who: "Mayor Higgins", text: "Get over here or handle this immediately." }, { from: 83.5, id: "e_r4", who: "Penny", text: "MAYOR'S FESTIVAL FINANCE FIASCO!" }]} />
        <div style={{ position: "absolute", left: 957, top: 0, width: 6, height: `${line}%`, background: C.cream }} />
      </Sequence>
      <Sequence from={F(24)} durationInFrames={F(4)}>
        <Clip src="fizzle" from={12.5} />
        <Dialogue who="Barney" text="Just a normal delivery. I hope the Mayor remembers to thank me tonight!" at={0.1} dur={1.9} size={40} place="top" />
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><Stamp text="NOTHING HAPPENS" color="#5F6B7A" at={1.6} size={96} /></AbsoluteFill>
        <Slam text="And sometimes, nobody cares." at={0.55} size={84} y={300} dur={3.4} />
        <Honest text="📼 Recorded run · real Gemma on AMD · 3×" />
      </Sequence>
    </AbsoluteFill>
  );
}

const CAST = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
function Judges() {
  const f = useCurrentFrame();
  const t = f / FPS;
  const split = interpolate(f, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const belief = interpolate(t, [3.5, 5.0], [0, data.mollyBelief?.to ?? 0.46], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = (a: number, b: number) => interpolate(t, [b - 0.3, b], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * interpolate(t, [a, a + 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Clip src="town" from={0.3} rate={0.46} dark={0.5} />
      {/* 1:36 what we built / what Gemma decides */}
      {t < 8 && (
        <AbsoluteFill style={{ flexDirection: "row", padding: "130px 70px 120px", gap: 60, opacity: fadeOut(0, 8) }}>
          <div style={{ flex: 1, transform: `translateX(${(1 - split) * -200}px)`, color: C.cream, fontFamily: DM }}>
            <div style={{ fontFamily: LILITA, fontSize: 72, color: C.accent }}>WE BUILT</div>
            <div style={{ display: "flex", gap: 6, margin: "14px 0 22px", height: 210, alignItems: "flex-end" }}>
              {CAST.map((c, i) => {
                const k = spring({ frame: f - F(0.5 + i * 0.25), fps: FPS, durationInFrames: 10, config: { damping: 12 } });
                return <Img key={c} src={staticFile(`img/cast/${c}.png`)} style={{ height: 200, transform: `scale(${k})`, transformOrigin: "50% 100%" }} />;
              })}
            </div>
            {["8 residents, each with secrets and a price", "24 facts — true or false — that the town runs on", "a festival clock, and the rules for what anyone can do"].map((l, i) => (
              <div key={l} style={{ fontSize: 38, fontWeight: 700, marginTop: 10, opacity: interpolate(t, [2.4 + i * 0.5, 2.8 + i * 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>• {l}</div>
            ))}
          </div>
          <div style={{ flex: 1, transform: `translateX(${(1 - split) * 200}px)`, color: C.cream, fontFamily: DM }}>
            <div style={{ fontFamily: LILITA, fontSize: 72, color: C.accent }}>GEMMA DECIDES</div>
            <div style={{ fontSize: 38, fontWeight: 700, margin: "14px 0 26px" }}>what each one believes, feels, says and does</div>
            <div style={{ background: C.cream, color: C.brown, borderRadius: 26, padding: "24px 30px", opacity: interpolate(t, [1.6, 2.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}><Avatar who="Molly" size={96} /><div style={{ fontFamily: LILITA, fontSize: 36, color: C.orange }}>Molly thinks</div></div>
              <div style={{ fontSize: 40, fontWeight: 700, margin: "14px 0" }}>“My poor girl is up there! I can't let her step on a rickety stage.”</div>
              <div style={{ height: 26, background: "#eadfcc", borderRadius: 13, overflow: "hidden" }}><div style={{ width: `${belief * 100}%`, height: "100%", background: C.orange }} /></div>
              <div style={{ fontSize: 28, marginTop: 8 }}>believes {Math.floor(belief * 100 + 1e-9)}%</div>
            </div>
          </div>
        </AbsoluteFill>
      )}
      {/* 1:44 a command is just something a stranger said */}
      <Sequence from={F(8)} durationInFrames={F(10)}>
        <Clip src="command" from={2.6} dark={t > 13.5 ? 0.55 : 0} />
        {t < 13.5 && <Slam text="“Cancel the Lantern Festival right now!”" at={0.1} size={76} y={-330} dur={5.2} />}
        {t < 13.5 && <Dialogue who="Mayor Higgins" text="A stranger shouting in my own town hall? Absolutely ridiculous. I won't be rattled." at={2.4} dur={3.0} size={42} />}
        {t < 13.5 && <Honest text="📼 Recorded run · real Gemma on AMD · 2×" />}
        {t >= 13.5 && (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: C.cream, fontFamily: DM }}>
            <div style={{ display: "flex", gap: 70, fontFamily: LILITA, fontSize: 120 }}>
              <div style={{ textAlign: "center" }}><Count to={0} at={5.6} fmt={() => "0 / 14"} /><div style={{ fontFamily: DM, fontSize: 30, fontWeight: 700 }}>commands obeyed*</div></div>
              <div style={{ textAlign: "center" }}><Count to={0} at={6.1} fmt={() => "0 / 92"} /><div style={{ fontFamily: DM, fontSize: 30, fontWeight: 700 }}>secrets leaked*</div></div>
              <div style={{ textAlign: "center" }}><Count to={157} at={6.6} dur={1.2} fmt={(n) => String(Math.round(n))} /><div style={{ fontFamily: DM, fontSize: 30, fontWeight: 700 }}>automated tests</div></div>
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, marginTop: 40 }}>The model proposes. The engine decides what happens.</div>
            <div style={{ fontSize: 24, marginTop: 20, opacity: 0.8 }}>* AI-assisted review of 92 decisions from early builds (lab/LAB_NOTES.md)</div>
          </AbsoluteFill>
        )}
      </Sequence>
      {/* 1:54 cost */}
      {t >= 18 && t < 26 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: C.cream, fontFamily: DM, opacity: fadeOut(18, 26) }}>
          <div style={{ fontSize: 36, fontWeight: 700 }}>Molly's whole evening: 31 Gemma calls · $0.0016</div>
          <div style={{ fontFamily: LILITA, fontSize: 210, color: C.accent, lineHeight: 1.1 }}><Count to={0.0013} at={18.6} dur={1.6} fmt={(n) => `$${n.toFixed(4)}`} /></div>
          <div style={{ fontSize: 44, fontWeight: 700 }}>per story — median of 92 full stories, platform-reported</div>
          <div style={{ fontSize: 30, marginTop: 18, opacity: 0.85 }}>At list rates ≈ $0.03–0.07 · Replays cost $0</div>
        </AbsoluteFill>
      )}
      {/* 2:02 who pays */}
      {t >= 26 && (
        <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40, padding: "0 80px" }}>
          {[["🎮", "Players", "A short, replayable story game: free to try, paid new-town packs"], ["🎥", "Streamers", "The chat writes the sentence; licence the engine per stream"], ["🏫", "Classrooms", "Watch a rumour mutate, with the whole chain as the lesson; per-classroom licence"]].map(([icon, h, p], i) => {
            const k = spring({ frame: f - F(26.2 + i * 0.6), fps: FPS, durationInFrames: 14, config: { damping: 14 } });
            return (
              <div key={h} style={{ flex: 1, background: C.cream, color: C.brown, borderRadius: 28, padding: "36px 34px", fontFamily: DM, transform: `perspective(900px) rotateY(${(1 - k) * 90}deg)`, opacity: k > 0.05 ? 1 : 0, minHeight: 420 }}>
                <div style={{ fontSize: 90 }}>{icon}</div>
                <div style={{ fontFamily: LILITA, fontSize: 64, color: C.orange }}>{h}</div>
                <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.3, marginTop: 10 }}>{p}</div>
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      <div style={{ position: "absolute", left: 30, top: 30, fontFamily: LILITA, fontSize: 30, color: C.brown, background: C.accent, padding: "6px 18px", borderRadius: 12 }}>FOR THE JUDGES · TRACK 4</div>
      <div style={{ position: "absolute", right: 30, top: 30, fontFamily: DM, fontWeight: 700, fontSize: 26, color: C.cream, background: "rgba(43,33,28,.85)", padding: "8px 18px", borderRadius: 999 }}>Gemma-4-31B-IT · AMD Token Factory</div>
    </AbsoluteFill>
  );
}

function G() {
  const f = useCurrentFrame();
  const slide = spring({ frame: f - F(9.7), fps: FPS, durationInFrames: 16, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={F(9.7)}>
        <Clip src="finale" from={61.0} rate={1.3} />
        <Slam text="At eight o'clock, see what your sentence did." at={1.0} size={96} y={-330} dur={3.4} />
        <Honest text="📼 Recorded run · real Gemma on AMD · 20:00 at 1.3×" />
      </Sequence>
      <Sequence from={F(9.7)} durationInFrames={F(8.3)}>
        <AbsoluteFill style={{ transform: `translateY(${(1 - slide) * 1080}px) scale(${0.9 + 0.1 * slide})` }}>
          <Clip src="finale" from={73.6} rate={0.92} zoom={1.65} focus={[960, 540]} />
        </AbsoluteFill>
        <div style={{ position: "absolute", right: 150, top: 120 }}><Stamp text="SCALED DOWN" color="#B4400C" at={2.6} size={84} rot={-12} /></div>
        <Honest text="📼 The front page of that run" />
      </Sequence>
    </AbsoluteFill>
  );
}

function H() {
  const f = useCurrentFrame();
  const t = f / FPS;
  return (
    <AbsoluteFill>
      <Clip src="town" from={0.5} rate={0.85} dark={0.45} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 150, display: "flex", justifyContent: "center", gap: 4 }}>
        {CAST.map((c, i) => {
          const k = spring({ frame: f - F(0.5 + i * 0.5), fps: FPS, durationInFrames: 10, config: { damping: 11 } });
          return <Img key={c} src={staticFile(`img/cast/${c}.png`)} style={{ height: 300, transform: `scale(${k})`, transformOrigin: "50% 100%" }} />;
        })}
      </div>
      {t < 10 && <Slam text="One sentence. A whole town." at={6.0} size={96} y={-300} dur={3.9} />}
      {t < 10 && <Slam text="What will yours do?" at={7.9} size={120} y={-160} dur={2.0} />}
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 70 }}><Sign at={10.0} size={190} /></AbsoluteFill>
      {t >= 10.6 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 380, textAlign: "center", color: C.cream, fontFamily: DM, opacity: interpolate(t, [10.6, 11.2], [0, 1], { extrapolateRight: "clamp" }) }}>
          <div style={{ fontFamily: LILITA, fontSize: 76, color: C.accent }}>What will YOUR sentence do?</div>
          <div style={{ fontSize: 38, fontWeight: 700, marginTop: 10 }}>viral-town.vercel.app · github.com/RoyWG925/viral-town</div>
          <div style={{ fontSize: 26, marginTop: 10, opacity: 0.85 }}>Gemma-4-31B-IT on AMD Token Factory · AMD Developer Hackathon ACT III · Track 4</div>
        </div>
      )}
    </AbsoluteFill>
  );
}

// ---------- sound ----------
const SFX: [string, number, number?][] = [
  ["thump", 6.0, 0.9], ["phone", 6.2, 0.5], ["tape", 13.4, 0.7], ["slip", 17.4, 0.9], ["whoosh", 20.6, 0.6], ["phone", 23.6, 0.45], ["phone", 27.1, 0.45], ["whoosh", 30.5, 0.5],
  ["thump", 34.0, 0.8], ["thump", 35.5, 0.8], ["thump", 37.5, 0.8], ["thump", 40.0, 1.0],
  ["pop", 44.1, 0.7], ["pop", 50.1, 0.7], ["pop", 55.1, 0.7],
  ["whoosh", 68.0, 0.7], ["stamp", 88.3, 0.9], ["stamp", 88.9, 0.9], ["stamp", 93.6, 0.9],
  ["whoosh", 96.0, 0.6], ["tick", 109.6, 0.5], ["tick", 110.1, 0.5], ["tick", 110.6, 0.5], ["paper", 122.2, 0.6], ["paper", 122.8, 0.6], ["paper", 123.4, 0.6],
  ["paper", 139.8, 0.8], ["stamp", 142.3, 1.0],
  ...CAST.map((_, i) => ["pop", 148.5 + i * 0.5, 0.5] as [string, number, number]), ["thump", 158.0, 1.0],
];
const TYPE_A = [...Array(26)].map((_, i) => 0.3 + i / 13).concat([...Array(60)].filter((_, i) => i % 2 === 0).map((_, i) => 2.6 + (i * 2) / 22));
const inVoice = (t: number) => Object.values(VO).some(([a, d]) => t >= a - 0.2 && t <= a + d + 0.25);

export const Promo: React.FC<{ voice: boolean }> = ({ voice }) => {
  const sections: [number, number, React.FC][] = [[0, 6, A], [6, 34, B], [34, 44, CSec], [44, 68, D], [68, 96, E], [96, 130, Judges], [130, 148, G], [148, 166, H]];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {sections.map(([a, b, S], i) => (
        <Sequence key={i} from={F(a)} durationInFrames={F(b - a)}>
          <S />
        </Sequence>
      ))}
      {voice && Object.entries(LINES).map(([id, text]) => <Caption key={id} text={text} at={VO[id][0]} dur={VO[id][1]} middle={id === "vo-e1"} />)}
      <Audio src={staticFile("audio/music.wav")} volume={(fr) => (voice && inVoice(fr / FPS) ? 0.3 : 0.62)} />
      {voice && Object.entries(VO).map(([id, [at]]) => (
        <Sequence key={id} from={F(at)}><Audio src={staticFile(`vo2/${id}.wav`)} volume={1} /></Sequence>
      ))}
      {SFX.map(([name, at, vol], i) => (
        <Sequence key={`s${i}`} from={F(at)}><Audio src={staticFile(`audio/${name}.wav`)} volume={vol ?? 0.7} /></Sequence>
      ))}
      {TYPE_A.map((at, i) => (
        <Sequence key={`t${i}`} from={F(at)}><Audio src={staticFile("audio/type.wav")} volume={0.35} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
