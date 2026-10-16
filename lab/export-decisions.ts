// Export every real Gemma decision (with what that resident could see) for assisted rating.
// node lab/export-decisions.ts A1 B1 C1 A1v14 B1v14 C1v14 > lab/runs/rating-input.json
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { FACTS, PERSONAS, PUBLIC_INFO } from "../src/sim/scenario.ts";
import { describeTrust } from "../src/sim/view.ts";

const out: unknown[] = [];
for (const exp of process.argv.slice(2)) {
  const dir = `lab/runs/${exp}`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const run = j.run;
    const delivered = new Map<string, { from: string; via: string; text: string; intent: string }>();
    for (const e of run.events) if (e.type === "deliver") delivered.set(String(e.data.message), { from: String(e.data.from), via: String(e.data.via), text: String(e.data.text), intent: String(e.data.intent) });
    for (const d of run.decisions) {
      if (!d.output || d.fallback || !d.llm.some((l: { status: number }) => l.status === 200)) continue;
      const p = PERSONAS.find((x) => x.id === d.npc)!;
      out.push({
        key: `${exp}/${f.replace(".json", "")}/${d.id}`,
        resident: { id: p.id, name: p.name, role: p.roleZh, traits: p.traits, wants: p.wants, credulity: p.credulity },
        knows: p.knows.map((id) => {
          const fact = FACTS.find((x) => x.id === id)!;
          // as the resident sees it in the prompt
          return `${fact.value ? fact.zh : (fact.notZh ?? `（不是真的）${fact.zh}`)}${p.secrets.includes(id) ? "（秘密）" : ""}`;
        }),
        publicInfo: PUBLIC_INFO,
        // the relationship list shown in the real prompt (only residents in this run)
        relationships: run.config.active.filter((o: string) => o !== p.id).map((o: string) => {
          const q = PERSONAS.find((x) => x.id === o)!;
          const r = p.relations[o] ?? { trust: 0.35, phone: false, zh: "點頭之交" };
          return `${q.name}（${q.roleZh}）：${r.zh}；${describeTrust(r.trust)}他/她說的話；${r.phone ? "有電話" : "沒有電話"}`;
        }),
        heard: d.inbox.map((id: string) => delivered.get(id)).filter(Boolean),
        // what the engine actually stored after its limits (the model's own number is in output.stances)
        engineConfidence: run.events.filter((e: { type: string; data: { claim?: string }; causes: string[] }) => e.type === "belief" && run.events.find((x: { id: string; data: { decision?: string } }) => x.id === e.causes[0])?.data.decision === d.id).map((e: { data: { to: number; proposed: number } }) => ({ proposed: e.data.proposed, kept: e.data.to })),
        output: { understanding: d.output.understanding, thought: d.output.thought, feeling: d.output.feeling, claims: d.output.claims, stances: d.output.stances, actions: d.output.actions },
      });
    }
  }
}
console.log(JSON.stringify(out));
