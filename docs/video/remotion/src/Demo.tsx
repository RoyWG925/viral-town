// The VIRAL demo video. Every game shot is a real screen recording of the game (lab/video/record.mjs); this file
// only cuts, labels and captions them. Version A has the AI narration, version B carries it as captions instead.
import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import captions from "./captions.json";
import timeline from "./timeline.json";

export const FPS = 30;
type Shot =
  | { kind: "clip"; src: string; from: number; dur: number; rate?: number; label?: string; zoom?: [number, number, number] }
  | { kind: "image"; src: string; dur: number; zoom?: [number, number]; label?: string }
  | { kind: "card"; card: "inputs" | "end"; dur: number };
type Segment = { start: number; shots: Shot[] };
type Timeline = { duration: number; bed: { src: string; from: number; end: { from: number } }; narration: { id: string; start: number }[]; segments: Segment[] };
const T = timeline as Timeline;
export const DURATION = Math.round(T.duration * FPS);

const ink = "#1f2933";
const font = '"Segoe UI", system-ui, sans-serif';
const serif = 'Georgia, "Times New Roman", serif';

function Label({ text }: { text: string }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 22, top: 104, opacity: o, background: "rgba(15,20,28,.78)", color: "#fff", fontFamily: font, fontSize: 22, fontWeight: 600, padding: "8px 18px", borderRadius: 999, letterSpacing: 0.2 }}>
      {text}
    </div>
  );
}

function ClipShot({ s }: { s: Extract<Shot, { kind: "clip" }> }) {
  const f = useCurrentFrame();
  // optional push-in on a detail: [scale, x, y] in source pixels
  const z = s.zoom ? interpolate(f, [0, 24], [1, s.zoom[0]], { extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo src={staticFile(s.src)} trimBefore={Math.round(s.from * FPS)} playbackRate={s.rate ?? 1} muted
        style={s.zoom ? { transform: `scale(${z})`, transformOrigin: `${s.zoom[1]}px ${s.zoom[2]}px` } : undefined} />
      {s.label && <Label text={s.label} />}
    </AbsoluteFill>
  );
}

function ImageShot({ s }: { s: Extract<Shot, { kind: "image" }> }) {
  const f = useCurrentFrame();
  const [z0, z1] = s.zoom ?? [1, 1.06];
  const z = interpolate(f, [0, s.dur * FPS], [z0, z1]);
  return (
    <AbsoluteFill style={{ background: "#fbf6ea" }}>
      <Img src={staticFile(s.src)} style={{ width: "100%", height: "100%", objectFit: "contain", transform: `scale(${z})` }} />
      {s.label && <Label text={s.label} />}
    </AbsoluteFill>
  );
}

const INPUTS = [
  { tag: "🚧 Stage sealed", tone: ["#fde8d7", "#b4400c"], who: "To Molly", said: "“I heard tonight's stage was thrown together from old planks.”", what: "The chief inspects, finds a loose strut and tapes the stage off. Gus slips on a banana peel. The show moves to the open plaza." },
  { tag: "📰 Budget exposé", tone: ["#e6f0f8", "#1f5379"], who: "To Rosa", said: "“The stall fee went up because the mayor spent the money on a new car.”", what: "No car — but the reporter reads the accounts, finds a real 30% overrun and publishes. No closing fireworks." },
  { tag: "🤐 Nothing happens", tone: ["#eceff3", "#5f6b7a"], who: "To Barney", said: "“Tonight's lanterns are cheap junk. One spark and they'll go up in flames.”", what: "He worries — “but it's just one stranger” — and keeps it to himself. The festival goes on as planned." },
];

function InputsCard() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#fbf6ea", padding: "70px 90px", fontFamily: font, color: ink }}>
      <div style={{ fontSize: 24, letterSpacing: 6, textTransform: "uppercase", color: "#ff8a2a", fontWeight: 800 }}>Three real runs · same town</div>
      <div style={{ fontFamily: serif, fontSize: 64, fontWeight: 700, margin: "10px 0 40px" }}>Same town. Different sentence. Different night.</div>
      <div style={{ display: "flex", gap: 36 }}>
        {INPUTS.map((x, i) => {
          const o = interpolate(f, [8 + i * 10, 20 + i * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const y = interpolate(f, [8 + i * 10, 20 + i * 10], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ flex: 1, opacity: o, transform: `translateY(${y}px)`, background: "#fff", borderRadius: 24, padding: "34px 36px", boxShadow: "0 8px 26px rgba(0,0,0,.08)", minHeight: 560 }}>
              <span style={{ display: "inline-block", background: x.tone[0], color: x.tone[1], fontWeight: 800, fontSize: 28, padding: "8px 18px", borderRadius: 999 }}>{x.tag}</span>
              <div style={{ fontWeight: 800, fontSize: 30, marginTop: 24 }}>{x.who}:</div>
              <div style={{ fontWeight: 700, fontSize: 32, lineHeight: 1.3, marginTop: 6 }}>{x.said}</div>
              <div style={{ fontSize: 28, lineHeight: 1.45, color: "#5f6b7a", marginTop: 22 }}>{x.what}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "linear-gradient(180deg,#1b2430,#283445)", fontFamily: font, color: "#fff", alignItems: "center", opacity: o }}>
      <div style={{ marginTop: 90, fontFamily: serif, fontSize: 150, fontWeight: 700, letterSpacing: 4 }}>VIRAL</div>
      <div style={{ fontFamily: serif, fontSize: 52, marginTop: 4 }}>One sentence. A whole town.</div>
      <Img src={staticFile("img/lineup.png")} style={{ height: 380, marginTop: 50 }} />
      <div style={{ fontSize: 34, marginTop: 40, fontWeight: 600 }}>Play it: viral-town.vercel.app · Code: github.com/RoyWG925/viral-town</div>
      <div style={{ fontSize: 26, marginTop: 10, color: "#c9d2dc" }}>Eight residents played by Gemma-4-31B-IT on AMD Token Factory · AMD Developer Hackathon ACT III · Track 4</div>
    </AbsoluteFill>
  );
}

function Captions({ track }: { track: "A" | "B" }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  const c = (captions as Record<string, { start: number; end: number; text: string }[]>)[track].find((x) => t >= x.start && t < x.end);
  // the end card carries its own title
  if (!c || t >= T.duration - 10) return null;
  const o = Math.min(interpolate(t, [c.start, c.start + 0.18], [0, 1], { extrapolateRight: "clamp" }), interpolate(t, [c.end - 0.18, c.end], [1, 0], { extrapolateLeft: "clamp" }));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 104, display: "flex", justifyContent: "center", opacity: o }}>
      <div style={{ maxWidth: 1500, background: "rgba(12,16,22,.78)", color: "#fff", fontFamily: font, fontSize: 44, fontWeight: 600, lineHeight: 1.3, textAlign: "center", padding: "16px 34px", borderRadius: 18, whiteSpace: "pre-line" }}>
        {c.text}
      </div>
    </div>
  );
}

function Fade({ dur, children }: { dur: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const n = dur * FPS;
  const o = Math.min(interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" }), interpolate(f, [n - 8, n], [1, 0], { extrapolateLeft: "clamp" }));
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

export const Demo: React.FC<{ narration: boolean }> = ({ narration }) => {
  const { fps } = useVideoConfig();
  // the music bed: the game's own soundtrack, recorded with the hook run; quieter under the voice
  const speaking = (fr: number) => narration && isInVoice(fr / fps);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {T.segments.map((seg, i) => {
        let at = seg.start;
        const segDur = seg.shots.reduce((s, x) => s + x.dur, 0);
        return (
          <Sequence key={i} from={Math.round(seg.start * fps)} durationInFrames={Math.round(segDur * fps)}>
            <Fade dur={segDur}>
              {seg.shots.map((s, j) => {
                const from = Math.round((at - seg.start) * fps);
                at += s.dur;
                return (
                  <Sequence key={j} from={from} durationInFrames={Math.round(s.dur * fps)}>
                    {s.kind === "clip" ? <ClipShot s={s} /> : s.kind === "image" ? <ImageShot s={s} /> : s.card === "inputs" ? <InputsCard /> : <EndCard />}
                  </Sequence>
                );
              })}
            </Fade>
          </Sequence>
        );
      })}
      <Captions track={narration ? "A" : "B"} />
      {/* the recording runs out before the end card: the end card gets the festival tune from the same recording */}
      <Sequence durationInFrames={DURATION - 10 * fps + 15}>
        <Audio src={staticFile(T.bed.src)} trimBefore={Math.round(T.bed.from * fps)} volume={(fr) => {
          const fadeIn = interpolate(fr, [0, 20], [0, 1], { extrapolateRight: "clamp" });
          const fadeOut = interpolate(fr, [DURATION - 10 * fps - 15, DURATION - 10 * fps + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (speaking(fr) ? 0.3 : narration ? 0.7 : 1) * fadeIn * fadeOut;
        }} />
      </Sequence>
      <Sequence from={DURATION - 10 * fps - 15}>
        <Audio src={staticFile(T.bed.src)} trimBefore={Math.round(T.bed.end.from * fps)} volume={(fr) => {
          const fadeIn = interpolate(fr, [0, 30], [0, 1], { extrapolateRight: "clamp" });
          const fadeOut = interpolate(fr, [10 * fps - 45, 10 * fps + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const t = (DURATION - 10 * fps - 15 + fr) / fps;
          return (narration && isInVoice(t) ? 0.3 : narration ? 0.7 : 1) * fadeIn * fadeOut;
        }} />
      </Sequence>
      {narration && T.narration.map((n) => (
        <Sequence key={n.id} from={Math.round(n.start * fps)}>
          <Audio src={staticFile(`vo/${n.id}.wav`)} volume={1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// when the voice is on: the narration clips' spans, from the B track (the narration as captions)
function isInVoice(t: number) {
  return captions.B.some((c) => t >= c.start - 0.25 && t <= c.end + 0.25);
}
