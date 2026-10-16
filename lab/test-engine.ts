// Engine invariants, checked over many rule-policy runs (no model calls). node --test lab/test-engine.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, type RunResult } from "../src/sim/engine.ts";
import { FACTS } from "../src/sim/scenario.ts";

const ALL8 = ["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"];
const SENTENCES = [
  "聽說市長很害怕鴿子。", "聽說廣場的舞台是趕工搭的，可能撐不住人。", "攤位費漲價是因為鎮公所把錢花光了。",
  "慶典那批鴿子好像生病了。", "今晚好像有人要在慶典上搞破壞。", "港口今天的魚特別便宜。",
];

async function runs(): Promise<{ run: RunResult; frontiers: number[]; emittedAfter: { t: number; frontier: number }[] }[]> {
  const out = [];
  for (const [i, text] of SENTENCES.entries()) {
    for (const npc of ["baker", "journalist", "vendor", "police"]) {
      for (const seed of [1, 7]) {
        const frontiers: number[] = [];
        const emittedAfter: { t: number; frontier: number }[] = [];
        let frontier = -Infinity;
        const run = await simulate({
          active: ALL8, seedNpc: npc, seedText: text, seed: seed + i, policy: "rules", maxDecisions: 30, maxPerNpc: 6,
          onFrontier: (t) => {
            frontiers.push(t);
            frontier = Math.max(frontier, t === Infinity ? frontier : t);
          },
          onEvent: (e) => {
            if (e.t < frontier - 1e-6) emittedAfter.push({ t: e.t, frontier });
          },
        });
        out.push({ run, frontiers, emittedAfter });
      }
    }
  }
  return out;
}

const all = await runs();

test("every run terminates with an end event", () => {
  for (const { run } of all) assert.equal(run.events.at(-1)?.type, "end");
});

test("a story that runs out ends right after its last event, not at a later no-op timer", () => {
  for (const { run } of all) {
    if (run.ended.reason === "time") continue;
    const before = run.events.slice(0, -1).map((e) => e.t);
    const last = Math.max(20, ...before);
    assert.ok(run.ended.t >= last && run.ended.t <= last + 1 + 1e-9, `ended ${run.ended.t} vs last event ${last}`);
  }
});

test("every belief the engine changed says which limit moved it", () => {
  for (const { run } of all) {
    for (const e of run.events.filter((x) => x.type === "belief")) {
      const d = e.data as { to: number; proposed: number; limit?: { why: { kind: string } } };
      if (Math.abs(d.to - d.proposed) > 1e-9) assert.ok(d.limit?.why.kind, `belief ${e.id} moved ${d.proposed}→${d.to} without a limit`);
    }
  }
});

test("every world change traces back to the planted sentence", () => {
  for (const { run } of all) {
    const byId = new Map(run.events.map((e) => [e.id, e]));
    const seed = run.events.find((e) => e.type === "seed")!;
    for (const e of run.events.filter((x) => ["state", "notice", "article", "statement", "gather"].includes(x.type))) {
      const stack = [e];
      const seen = new Set<string>();
      let found = false;
      while (stack.length) {
        const x = stack.pop()!;
        if (x.id === seed.id) { found = true; break; }
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        for (const c of x.causes) { const y = byId.get(c); if (y) stack.push(y); }
      }
      assert.ok(found, `${run.config.seedText} / ${e.zh} has no causal path to the seed`);
    }
  }
});

test("nothing is emitted earlier than a frontier already reported (streamed playback is safe)", () => {
  for (const { run, emittedAfter } of all) assert.deepEqual(emittedAfter, [], `${run.config.seedNpc}: ${JSON.stringify(emittedAfter.slice(0, 3))}`);
});

test("only scenario residents ever act or receive messages", () => {
  for (const { run } of all) {
    const active = new Set(run.config.active);
    for (const e of run.events) {
      if (e.actor) assert.ok(active.has(e.actor), `actor ${e.actor}`);
      if (e.target) assert.ok(active.has(e.target), `target ${e.target}`);
    }
  }
});

test("decision caps hold", () => {
  for (const { run } of all) {
    const real = run.decisions.filter((d) => !d.validation.some((v) => v.errors.includes("decision budget reached")));
    assert.ok(real.length <= 30);
    const per = new Map<string, number>();
    for (const d of real) per.set(d.npc, (per.get(d.npc) ?? 0) + 1);
    for (const [npc, n] of per) assert.ok(n <= 6, `${npc} decided ${n} times`);
  }
});

test("a resident never talks to two people at once", () => {
  for (const { run } of all) {
    const busy = new Map<string, { from: number; to: number }[]>();
    for (const e of run.events.filter((x) => x.type === "talk")) {
      for (const who of [e.actor!, e.target!]) {
        const spans = busy.get(who) ?? [];
        for (const s of spans) assert.ok(e.t >= s.to - 1e-6 || e.t + 3 <= s.from + 1e-6, `${who} double-booked at ${e.t}`);
        spans.push({ from: e.t, to: e.t + 3 });
        busy.set(who, spans);
      }
    }
  }
});

test("hearing the same claim again from the same person does not trigger a new decision", () => {
  for (const { run } of all) {
    for (const e of run.events.filter((x) => x.type === "deliver" && x.data.repeat)) {
      const triggered = run.decisions.some((d) => d.triggers.includes(e.id));
      assert.ok(!triggered, `repeat delivery ${e.id} triggered a decision`);
    }
  }
});

test("inspections only reveal facts that are checkable at that place, with their true value", () => {
  for (const { run } of all) {
    for (const e of run.events.filter((x) => (x.type === "look" || x.type === "inspect") && x.data.found)) {
      for (const f of FACTS.filter((x) => x.check && String(e.data.found).includes(x.check.zh))) {
        assert.equal(f.check!.place, e.place, `${f.id} revealed at ${e.place}`);
        if (f.check!.by === "expert") assert.equal(e.type, "inspect");
      }
    }
  }
});

test("time moves forward for each resident's own actions", () => {
  for (const { run } of all) {
    for (const npc of run.config.active) {
      const ts = run.events.filter((e) => e.actor === npc && ["talk", "phone", "look", "inspect", "notice", "article", "statement", "gather"].includes(e.type)).map((e) => e.t);
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1] - 1e-6, `${npc} acted back in time`);
    }
  }
});
