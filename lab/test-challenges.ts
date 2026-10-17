// Tonight's goals are stamped only from what the log contains. node --test lab/test-challenges.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { RunResult } from "../src/sim/engine.ts";
import { FACTS, PERSONAS } from "../src/sim/scenario.ts";
import { CHALLENGES, GOALS_STORAGE_KEY, challengesHit, mergeProgress, type ChallengeHit } from "../src/sim/challenges.ts";
import type { SimEvent } from "../src/sim/types.ts";

const load = (dirs: string[]) => {
  const out: { name: string; run: RunResult }[] = [];
  for (const dir of dirs.filter((d) => existsSync(d)))
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
      const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
      const run = (j.run ?? j) as RunResult;
      if (run.events) out.push({ name: `${dir}/${f}`, run });
    }
  return out;
};
const LAB = load(["P5", "P6", "P7", "P8", "P9"].map((p) => `lab/runs/${p}`));
const RECORDED = load(["public/recorded"]);
const ALL = [...LAB, ...RECORDED];
const cfgOf = (run: RunResult) => ({ seedNpc: run.config.seedNpc, seedText: run.config.seedText, active: run.config.active, claims: run.claims });
// the director's play order
const sorted = (evs: SimEvent[]) => [...evs].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
const ids = (hits: ChallengeHit[]) => hits.map((h) => h.id).sort();

/** An independent recount straight from the raw log (deliberately shares no code with challenges.ts). */
function recount(run: RunResult): string[] {
  const ev = run.events;
  const seedNpc = run.config.seedNpc;
  const state = (key: string, to?: string) => ev.some((e) => e.type === "state" && e.data.key === key && (to === undefined || e.data.to === to));
  // planted claims the way story.ts finds them: what the first listener recorded in their first real decision
  const first = ev.find((e) => e.type === "decide" && e.actor === seedNpc && !e.data.budget);
  const planted = (run.claims ?? []).filter((c) => first && c.by === seedNpc && (c.origin === first.id || first.causes.includes(c.origin)));
  const plantedFalse = planted.some((c) => !c.fact || FACTS.find((f) => f.id === c.fact)?.value === false);
  const truth =
    plantedFalse &&
    ev.some(
      (e) =>
        (e.type === "inspect" || e.type === "look") &&
        FACTS.some((f) => f.value && f.check?.by === "expert" && !planted.some((c) => c.fact === f.id) && String(e.data.found ?? "").includes(f.check.zh)),
    );
  const heard = new Set(ev.filter((e) => e.type === "deliver" && e.data.via !== "inspection" && e.data.via !== "meet").map((e) => e.target));
  const knows = (a: string, b: string) => !!PERSONAS.find((p) => p.id === a)?.relations[b];
  const isResident = (id?: string) => PERSONAS.some((p) => p.id === id);
  const strangers = ev.some(
    (e) => e.type === "talk" && e.actor !== seedNpc && isResident(e.actor) && isResident(e.target) && !knows(e.actor!, e.target!) && !knows(e.target!, e.actor!),
  );
  const got: Record<string, boolean> = {
    town: heard.size >= Math.min(6, run.config.active.length),
    truth,
    stage: state("stage", "closed"),
    article: ev.some((e) => e.type === "article"),
    police: state("police"),
    strangers,
    shop: ev.some((e) => e.type === "state" && String(e.data.key).startsWith("shops.") && e.data.to === "closed"),
    gather: ev.some((e) => e.type === "gather"),
    statement: ev.some((e) => e.type === "statement" && e.actor === "mayor"),
    cancel: state("festival", "cancelled"),
  };
  return Object.keys(got).filter((k) => got[k]).sort();
}

const STAGE_CHECK = FACTS.find((f) => f.id === "stage_uninspected")!.check!.zh;
const BUDGET_CHECK = FACTS.find((f) => f.id === "budget_overrun")!.check!.zh;

// the kind of event each goal's stamp must point at
const STAMPED_BY: Record<string, string[]> = {
  town: ["deliver"], truth: ["inspect", "look"], stage: ["state"], article: ["article"], police: ["state"], strangers: ["talk"],
  shop: ["state"], gather: ["gather"], statement: ["statement"], cancel: ["state"],
};

test("the goal list keeps the shared contract: 6 visible, then 4 hidden", () => {
  assert.equal(GOALS_STORAGE_KEY, "viral.goals.v1");
  assert.deepEqual(CHALLENGES.map((c) => c.id), ["town", "truth", "stage", "article", "police", "strangers", "shop", "gather", "statement", "cancel"]);
  assert.deepEqual(CHALLENGES.map((c) => !!c.hidden), [false, false, false, false, false, false, true, true, true, true]);
  assert.deepEqual(Object.keys(STAMPED_BY).sort(), CHALLENGES.map((c) => c.id).sort());
});

test("goal copy invites without promising and gives nothing hidden away", () => {
  const secrets = FACTS.filter((f) => PERSONAS.some((p) => p.secrets.includes(f.id)) || f.check?.by === "expert");
  const banned = ["烤箱", "預算", "超支", "支架", "鬆動", "安全檢查", "部落格", "流量", "一半", "收了", ...PERSONAS.map((p) => p.wants)];
  for (const c of CHALLENGES) {
    const text = `${c.zh} ${c.hint}`;
    assert.ok(!text.replace(/機會/g, "").includes("會"), `${c.id}: says 會 (promise); use 能/有機會`);
    for (const w of banned) assert.ok(!text.includes(w), `${c.id}: mentions ${w}`);
    for (const f of secrets) for (const k of [f.zh, f.check?.zh, ...f.keywords].filter(Boolean)) assert.ok(!text.includes(k!), `${c.id}: leaks ${f.id}`);
  }
});

test("per-goal counts over real runs equal an independent recount; stamps point at the matching event", () => {
  const rows = CHALLENGES.map((c) => {
    const n = (set: typeof ALL) => set.filter(({ run }) => challengesHit(run.events, cfgOf(run)).some((h) => h.id === c.id)).length;
    return { goal: `${c.icon} ${c.id}${c.hidden ? " (???)" : ""}`, zh: c.zh, [`P5-P9 /${LAB.length}`]: n(LAB), [`recorded /${RECORDED.length}`]: n(RECORDED) };
  });
  console.log("\n今晚的小目標: runs that achieve each goal");
  console.table(rows);
  for (const { name, run } of ALL) {
    const hits = challengesHit(run.events, cfgOf(run));
    assert.deepEqual(ids(hits), recount(run), name);
    assert.equal(new Set(hits.map((h) => h.id)).size, hits.length, `${name}: one stamp per goal`);
    for (const h of hits) {
      const e = run.events.find((x) => x.id === h.eventId);
      assert.ok(e && STAMPED_BY[h.id].includes(e.type), `${name}: ${h.id} stamped by ${e?.type ?? "a missing event"}`);
      assert.equal(h.t, e!.t, name);
      assert.match(h.evidence, /^\d\d:\d\d \S/, `${name}: evidence starts with the clock`);
      assert.ok(h.evidence.length <= 48, `${name}: evidence too long: ${h.evidence}`);
    }
  }
});

test("P5–P9 baseline matches the specialists' tallies (38 Gemma runs)", { skip: LAB.length !== 38 && "the P5–P9 set changed" }, () => {
  const count = (id: string) => LAB.filter(({ run }) => challengesHit(run.events, cfgOf(run)).some((h) => h.id === id)).length;
  assert.deepEqual(
    { police: count("police"), truth: count("truth"), stage: count("stage"), article: count("article"), strangers: count("strangers"), shop: count("shop"), statement: count("statement"), cancel: count("cancel") },
    { police: 5, truth: 8, stage: 8, article: 7, strangers: 3, shop: 2, statement: 0, cancel: 0 },
  );
});

test("a played prefix never stamps more, or earlier, than the full run", () => {
  for (const { name, run } of ALL) {
    for (const order of [run.events, sorted(run.events)]) {
      const full = challengesHit(order, cfgOf(run));
      for (let k = 0; k <= order.length; k++) {
        const prefix = order.slice(0, k);
        for (const h of challengesHit(prefix, cfgOf(run))) {
          const i = prefix.findIndex((e) => e.id === h.eventId);
          assert.ok(i >= 0 && i < k, `${name}@${k}: ${h.id} stamped by an unplayed event`);
          assert.deepEqual(h, full.find((x) => x.id === h.id), `${name}@${k}: ${h.id} differs from the full run`);
        }
      }
    }
  }
});

test("without claim topics the made-up-rumour goal never fires; a topic on the belief event is enough", () => {
  for (const { name, run } of ALL) {
    const topic = new Map(run.claims.map((c) => [c.id, c.topic]));
    // recordings made since v2 already carry the topic on belief events: take it off to test the blind case
    const untagged = run.events.map((e) => (e.type === "belief" ? { ...e, data: { ...e.data, topic: undefined } } : e));
    const blind = challengesHit(untagged, { ...cfgOf(run), claims: undefined });
    assert.ok(!blind.some((h) => h.id === "truth"), `${name}: guessed a planted topic`);
    // what the engine logs now that belief events carry their topic
    const tagged = untagged.map((e) => (e.type === "belief" ? { ...e, data: { ...e.data, topic: topic.get(String(e.data.claim)) } } : e));
    assert.deepEqual(challengesHit(tagged, { ...cfgOf(run), claims: undefined }), challengesHit(run.events, cfgOf(run)), name);
  }
});

test("recorded P5-lantern-baker: the made-up lantern rumour is stamped on 老周's inspection that finds the strut", () => {
  const rec = RECORDED.find((r) => r.name.endsWith("P5-lantern-baker.json"));
  if (!rec) return;
  const h = challengesHit(rec.run.events, cfgOf(rec.run)).find((x) => x.id === "truth");
  const e = rec.run.events.find((x) => x.id === h?.eventId);
  assert.ok(e && e.type === "inspect" && e.actor === "police" && String(e.data.found).includes(STAGE_CHECK), h?.evidence);
});

// A hand-built evening with a second whisper (補一句): a true rumour first, then a made-up one to someone else.
const ev = (id: number, t: number, type: SimEvent["type"], x: Partial<SimEvent> = {}): SimEvent => ({ id: `e${id}`, t, type, causes: [], data: {}, zh: `${type}${id}`, ...x });
const TWO_WHISPERS: SimEvent[] = [
  ev(1, 20, "seed", { target: "baker", data: { text: "舞台好像在晃" } }),
  ev(2, 20, "deliver", { target: "baker", causes: ["e1"], data: { via: "seed" } }),
  ev(3, 20.2, "decide", { actor: "baker", causes: ["e2"] }),
  ev(4, 20.2, "belief", { actor: "baker", causes: ["e3"], data: { claim: "c1", topic: "stage_unsafe" } }),
  ev(5, 60, "inspect", { actor: "police", place: "stage", data: { found: `${STAGE_CHECK} 志明在這裡。` } }),
  ev(6, 70, "talk", { actor: "vendor", target: "police", data: { text: "老周！" } }),
  ev(7, 100, "seed", { target: "vendor", data: { text: "市長拿慶典的錢買新車", second: true } }),
  ev(8, 100, "deliver", { target: "vendor", causes: ["e7"], data: { via: "seed" } }),
  ev(9, 100.2, "decide", { actor: "vendor", causes: ["e8"] }),
  ev(10, 100.2, "belief", { actor: "vendor", causes: ["e9"], data: { claim: "c2", topic: "mayor_embezzled" } }),
  ev(11, 130, "inspect", { actor: "police", place: "stage", data: { found: STAGE_CHECK } }),
  ev(12, 150, "inspect", { actor: "journalist", place: "townhall", data: { found: BUDGET_CHECK } }),
  ev(13, 160, "talk", { actor: "vendor", target: "police", data: { text: "老周！" } }),
  ev(14, 170, "talk", { actor: "police", target: "vendor", data: { text: "阿珠。" } }),
];

test("a second whisper plants claims too, judged as of each event", () => {
  const cfg = { seedNpc: "baker", seedText: "舞台好像在晃" };
  const hit = (evs: SimEvent[], id: string) => challengesHit(evs, cfg).find((h) => h.id === id)?.eventId;
  // the stage was the player's own (true) rumour, so finding it is no accident; the overrun under a made-up car story is
  assert.equal(hit(TWO_WHISPERS, "truth"), "e12");
  assert.equal(hit(TWO_WHISPERS.slice(0, 11), "truth"), undefined);
  // 阿珠 walking up to 老周 counts before anyone whispered to her, not after
  assert.equal(hit(TWO_WHISPERS, "strangers"), "e6");
  assert.equal(hit(TWO_WHISPERS.filter((e) => e.id !== "e6"), "strangers"), "e14");
  // the first whisper alone was true: no made-up rumour, no stamp
  assert.equal(hit(TWO_WHISPERS.filter((e) => Number(e.id.slice(1)) < 7 || e.id === "e12"), "truth"), undefined);
});

test("the notebook keeps the first stamp and marks replays", () => {
  const h = (id: string): ChallengeHit => ({ id, eventId: "e1", t: 10, evidence: "15:10 x" });
  const a = mergeProgress({}, [h("police")], { at: "2026-10-17T10:00:00.000Z", headline: "🚓 警察出動", recorded: true });
  assert.deepEqual(a, { police: { at: "2026-10-17T10:00:00.000Z", headline: "🚓 警察出動", recorded: true } });
  // a later replay changes nothing (and hands back the same object, so nothing needs saving)
  assert.equal(mergeProgress(a, [h("police")], { at: "2026-10-17T11:00:00.000Z", recorded: true }), a);
  // the player's own story replaces a replay-only stamp
  const b = mergeProgress(a, [h("police"), h("stage")], { at: "2026-10-17T12:00:00.000Z", headline: "🚧 舞台封鎖" });
  assert.deepEqual(b.police, { at: "2026-10-17T12:00:00.000Z", headline: "🚧 舞台封鎖" });
  assert.equal(a.police.recorded, true, "prev is not mutated");
  // their own later story keeps the earlier stamp; an older one merged late takes its place
  assert.equal(mergeProgress(b, [h("stage")], { at: "2026-10-17T13:00:00.000Z" }), b);
  assert.equal(mergeProgress(b, [h("stage")], { at: "2026-10-17T09:00:00.000Z" }).stage.at, "2026-10-17T09:00:00.000Z");
  assert.equal(mergeProgress(b, [], { at: "2026-10-17T13:00:00.000Z" }), b);
});
