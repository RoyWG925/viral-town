// Screen recordings (MediaRecorder WebM: no duration, no seek index, variable frame timing) → constant 30 fps
// H.264/AAC MP4 with a keyframe every half second, so the edit can cut anywhere. Uses Remotion's own ffmpeg, on the
// GPU encoder (NVENC) unless CPU=1.
//   node transcode.mjs [clip,...]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Remotion's own full ffmpeg, called directly (npx.cmd would split arguments at "=" and ",")
export const FFMPEG = join("node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
const dir = join("public", "clips");
const names = process.argv[2] ? process.argv[2].split(",") : readdirSync(dir).filter((f) => f.endsWith(".webm")).map((f) => f.replace(/\.webm$/, ""));
for (const n of names) {
  const src = join(dir, `${n}.webm`);
  if (!existsSync(src)) { console.log(`skip ${n}: no recording`); continue; }
  const t0 = Date.now();
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", src,
    "-r", "30", "-fps_mode", "cfr", ...(process.env.CPU ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17"] : ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-bf", "0"]), "-g", "15", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", join(dir, `${n}.mp4`)], { stdio: "inherit" });
  console.log(`${n}.mp4 in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
