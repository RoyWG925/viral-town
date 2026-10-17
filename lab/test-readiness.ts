// 慶典準備度: the 20:00 outcome is a rule over the validated log. node --test lab/test-readiness.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readinessOf, THRESHOLD } from "../src/sim/readiness.ts";
import type { SimEvent } from "../src/sim/types.ts";

let k = 0;
const ev = (type: SimEvent["type"], data: Record<string, unknown> = {}, extra: Partial<SimEvent> = {}): SimEvent => ({ id: `e${++k}`, t: k, type, causes: [], data, zh: "", ...extra }) as SimEvent;

test("a quiet evening keeps the festival on; talk alone moves nothing", () => {
  const r = readinessOf([ev("seed"), ev("deliver", { via: "seed" }), ev("decide"), ev("talk", { text: "hi" }), ev("phone", { text: "hi" }), ev("move"), ev("end")]);
  assert.equal(r.outcome.kind, "on");
  assert.equal(r.changes.length, 0);
});

test("a closed stage shrinks the festival; add police and it is postponed; a cancel is a cancel", () => {
  const stage = [ev("state", { key: "stage", to: "closed" })];
  assert.equal(readinessOf(stage).outcome.kind, "reduced");
  assert.ok(readinessOf(stage).outcome.text.includes("舞台不能用"));
  assert.equal(readinessOf([...stage, ev("state", { key: "police", to: "stage" })]).outcome.kind, "postponed");
  assert.equal(readinessOf([ev("state", { key: "festival", to: "cancelled" })]).outcome.kind, "cancelled");
});

test("both food and flowers gone name what is missing", () => {
  const r = readinessOf([ev("state", { key: "shops.flower", to: "closed" }), ev("state", { key: "shops.bakery", to: "closed" })]);
  assert.equal(r.outcome.kind, "reduced");
  assert.ok(r.outcome.missing.join().includes("花飾") && r.outcome.missing.join().includes("點心"));
  assert.ok(r.meters.supplies < THRESHOLD);
});

test("a money scandal in print hits the money; the same log always gives the same outcome", () => {
  const claims = [{ id: "c1", topic: "budget_overrun" }];
  const log = [ev("article", { claims: ["c1"], headline: "x" })];
  const a = readinessOf(log, claims);
  assert.ok(a.meters.money < THRESHOLD && a.outcome.missing.join().includes("經費"));
  assert.deepEqual(readinessOf(log, claims), a);
});

test("over the real P5–P11 logs: weak inputs stay on, dramatic ones end several ways, none dominates", () => {
  const DRAMA = ["stage-cafe", "oven-police", "budget-journalist", "lantern-baker", "car-vendor", "pigeon-baker", "pigeon-cafe", "wobble-organizer"];
  const tally: Record<string, number> = {};
  let n = 0;
  for (const b of ["P5", "P6", "P7", "P8", "P9", "P10", "P11"])
    for (const f of readdirSync(`lab/runs/${b}`).filter((x) => x.endsWith(".json") && x !== "fun-metrics.json")) {
      const run = JSON.parse(readFileSync(`lab/runs/${b}/${f}`, "utf8")).run;
      const r = readinessOf(run.events, run.claims);
      if (!DRAMA.includes(f.replace(".json", ""))) {
        assert.equal(r.outcome.kind, "on", `${b}/${f}: a weak input should not hurt the festival`);
        continue;
      }
      n++;
      tally[r.outcome.kind] = (tally[r.outcome.kind] ?? 0) + 1;
    }
  console.log("dramatic outcomes", n, tally);
  assert.ok(Object.keys(tally).length >= 2);
  assert.ok(Math.max(...Object.values(tally)) / n <= 0.6, "no single ending should dominate");
});
