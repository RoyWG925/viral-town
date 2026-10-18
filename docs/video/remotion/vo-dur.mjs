// Lengths of the narration WAVs → src/vo-dur.json (the promo times its captions and music ducking from these).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const out = {};
for (const f of readdirSync("public/vo2").filter((x) => x.endsWith(".wav"))) {
  const b = readFileSync(`public/vo2/${f}`);
  out[f.replace(/\.wav$/, "")] = +((b.length - 44) / b.readUInt32LE(28)).toFixed(3);
}
writeFileSync("src/vo-dur.json", JSON.stringify(out, null, 1));
console.log(out);
