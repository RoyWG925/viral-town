// Narration for the promo with Gemini text-to-speech. The key is read from viral-town/.env.local and is never printed.
//   node tts.mjs models            → which TTS models this key can use
//   node tts.mjs say <id> [voice]  → public/vo2/<id>.wav for one line from LINES
//   node tts.mjs all [voice]       → every line
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = readFileSync("../viral-town/.env.local", "utf8");
const KEY = env.match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\s]+)"?/m)?.[1];
if (!KEY) throw new Error("GEMINI_API_KEY not found in .env.local");
const API = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
const STYLE = "Read this as the voice-over of an upbeat, playful video-game trailer: warm, confident, crisp, with a small smile. Keep the pacing tight.";

export const LINES = {
  "vo-a": "I told Molly one sentence.",
  "vo-c": "Eight residents. Every one keeps a secret. No script.",
  "vo-d": "Pick anyone. Whisper anything. Then watch them decide. Every choice is Gemma, running on AMD.",
  "vo-d1": "Pick anyone.",
  "vo-d2": "Whisper anything.",
  "vo-d3": "Then watch them decide.",
  "vo-d4": "Every choice is Gemma, running on AMD.",
  "vo-e1": "Same town. A different sentence. A different night.",
  "vo-e2": "And sometimes, nobody cares.",
  "vo-f1": "We built the town and its rules. Gemma decides what each resident believes, says and does. The engine decides what actually happens.",
  "vo-f2": "A full story costs less than a quarter of a cent. Made for players, streamers and classrooms.",
  "vo-g": "At eight o'clock, see what your sentence did.",
  "vo-h": "One sentence. A whole town. What will yours do?",
};

const wav = (pcm, rate) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

async function say(id, voice = "Puck") {
  const text = LINES[id];
  if (!text) throw new Error(`no line ${id}`);
  const r = await fetch(`${API}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${STYLE}\n\n${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`no audio in reply: ${JSON.stringify(j).slice(0, 300)}`);
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  const pcm = Buffer.from(part.inlineData.data, "base64");
  mkdirSync("public/vo2", { recursive: true });
  writeFileSync(`public/vo2/${id}.wav`, wav(pcm, rate));
  console.log(`${id}: ${(pcm.length / 2 / rate).toFixed(2)} s, ${part.inlineData.mimeType}, usage ${JSON.stringify(j.usageMetadata ?? {})}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "models") {
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": KEY } });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  console.log((j.models ?? []).map((m) => m.name).filter((n) => /tts/i.test(n)).join("\n") || "(no TTS models listed)");
} else if (cmd === "say") await say(a, b);
else if (cmd === "all") for (const id of Object.keys(LINES)) await say(id, a);
