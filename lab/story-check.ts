// Print the results-card story for recorded runs (sanity check that it only uses real log data).
import { readFileSync, readdirSync } from "node:fs";
import { storyOf } from "../src/town/story.ts";
const files = process.argv.slice(2);
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const run = j.run ?? j;
  const s = storyOf(run);
  console.log(`\n# ${f}\n${s.icon} ${s.headline}\n  ${s.sub}`);
  for (const h of s.spine) console.log(`  ${h.via} ${h.from}→${h.to}: 「${h.text.slice(0, 50)}」${h.verdict ? ` → ${h.verdict} ${Math.round((h.conf ?? 0) * 100)}%` : ""}`);
  if (s.stopper) console.log(`  stopper ${s.stopper.npc}: ${s.stopper.thought}`);
  if (s.closest) console.log(`  closest ${s.closest.npc} could ${s.closest.could}, did ${s.closest.did} (${s.closest.conf})`);
  if (s.wildest) console.log(`  wildest ${s.wildest.from}: heard 「${s.wildest.heard?.slice(0, 30)}」 said 「${s.wildest.text.slice(0, 40)}」 sim ${s.wildest.similarity.toFixed(2)}`);
}
void readdirSync;
