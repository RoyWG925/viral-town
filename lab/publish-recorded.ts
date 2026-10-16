// Copy selected real Gemma runs from the lab into public/recorded so the game can replay them
// (clearly labelled as recorded, never presented as live). Only runs with real model calls qualify.
// node lab/publish-recorded.ts C1/stage-cafe B1/pigeon-baker ...
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { storyOf } from "../src/town/story.ts";

const out = "public/recorded";
mkdirSync(out, { recursive: true });
const indexFile = `${out}/index.json`;
const index: { id: string; npc: string; text: string; at: string; reach: number; world: number; festival: string; calls: number; headline?: string }[] =
  existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : [];

for (const ref of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(`lab/runs/${ref}.json`, "utf8"));
  const run = j.run;
  const calls = run.decisions.flatMap((d: { llm: unknown[] }) => d.llm).length;
  if (run.config.policy !== "gemma" || calls === 0) {
    console.log(`skip ${ref}: not a Gemma run`);
    continue;
  }
  if (run.decisions.some((d: { llm: { status: number }[] }) => d.llm.length && d.llm.every((l) => l.status !== 200))) {
    console.log(`skip ${ref}: has decisions where the model never answered`);
    continue;
  }
  // strip raw prompts' sizes only; keep everything needed to replay and to audit
  const id = ref.replace(/\//g, "-");
  writeFileSync(`${out}/${id}.json`, JSON.stringify(run));
  const entry = {
    id, npc: run.config.seedNpc, text: run.config.seedText, at: run.wall.startedAt,
    reach: j.metrics.reach, world: j.metrics.worldChanges, festival: run.world.festival, calls,
    headline: (() => {
      const c = storyOf(run);
      return `${c.icon} ${c.headline}`;
    })(),
  };
  const k = index.findIndex((x) => x.id === id);
  if (k >= 0) index[k] = entry;
  else index.push(entry);
  console.log(`published ${id}`);
}
writeFileSync(indexFile, JSON.stringify(index, null, 1));
