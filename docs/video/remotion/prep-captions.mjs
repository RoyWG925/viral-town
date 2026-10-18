// Subtitle tracks (from viral-town/docs/video/make-srt.mjs) → src/captions.json for the composition.
//   node prep-captions.mjs
import { readFileSync, writeFileSync } from "node:fs";

const parse = (file) =>
  readFileSync(file, "utf8")
    .replace(/\r/g, "")
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const [, times, ...text] = block.split("\n");
      const [a, b] = times.split(" --> ").map((x) => {
        const [h, m, rest] = x.split(":");
        const [s, ms] = rest.split(",");
        return +h * 3600 + +m * 60 + +s + +ms / 1000;
      });
      return { start: a, end: b, text: text.join("\n") };
    });

writeFileSync("src/captions.json", JSON.stringify({ A: parse("src/subtitles-A.srt"), B: parse("src/subtitles-B.srt") }, null, 1));
console.log("wrote src/captions.json");
