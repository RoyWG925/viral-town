# The demo video, as code

Every game shot in the video is a real screen recording of the game; this folder only cuts, labels and captions them.

1. **Record** (from the repo root, dev server on :3002): `node lab/video/record.mjs opening,hook,finale,bed,contrast,fizzle,town,live ../viral-video/public/clips`
   - A headless Chromium on the GPU plays the game through its own interface and records its own tab
     (MediaRecorder, VP9 + Opus), writing a log of when every story event appeared on screen (`clip-logs/`).
   - `hook`, `contrast`, `fizzle` and `finale` replay the 📼 recorded P23 runs; `live` whispers to Chief Harlow and
     makes real model calls; `bed` is the hook run again for the game's own synthesized music.
2. **Edit** in a separate folder with Remotion installed (`npm i remotion @remotion/cli @remotion/media-utils react react-dom`),
   with these files and `public/vo/*.wav` (from `docs/video/vo`), `public/img/` (diagram, line-up):
   - `node transcode.mjs` — WebM → constant-30 fps MP4 with a keyframe every half second (Remotion's ffmpeg, NVENC);
   - `node prep-captions.mjs` — `docs/video/subtitles-A/B.srt` → `src/captions.json`;
   - `node plan.mjs` — the cut points, taken from the clip logs → `src/timeline.json`;
   - `npx remotion render src/index.ts DemoNarrated out/VIRAL-demo-narrated.mp4` (and `DemoCaptioned`).

Honesty, as in `docs/video/VIDEO_KIT.md`: every replay is labelled "Recorded run · real Gemma on AMD", the live part
"Live · real Gemma on AMD" with its speed-up, and no shot splices two different runs together.
