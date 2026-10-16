// Turns a finished run's log into the story the results card tells: a headline for the biggest thing
// that really happened, the chain of retellings that led there ("the spine"), who stopped the rumour
// when it died, and the wildest retelling. Built only from recorded, validated events and fixed
// templates — no model writes or embellishes it.
import type { RunResult } from "../sim/engine.ts";
import { FACTS, PERSONAS, PLACES } from "../sim/scenario.ts";
import { topicFact } from "../sim/view.ts";
import type { SimEvent } from "../sim/types.ts";

const nameOf = (id: string) => PERSONAS.find((p) => p.id === id)?.name ?? id;
const placeZh = (id: string) => PLACES.find((p) => p.id === id)?.zh ?? id;

export interface Hop {
  from: string;
  to: string;
  via: "talk" | "phone";
  text: string;
  /** the version the speaker had heard before passing it on */
  heard?: string;
  /** what the listener then made of it (their stored belief), if they decided */
  verdict?: string;
  conf?: number;
  t: number;
}

export interface StoryCard {
  icon: string;
  headline: string;
  sub: string;
  /** the player's sentence → … → the last version on the way to the outcome */
  spine: Hop[];
  /** when the rumour died: who held it last and what they thought */
  stopper?: { npc: string; thought: string; verdict?: string; conf?: number };
  /** someone who could have done something big, and what they actually did */
  closest?: { npc: string; could: string; did: string; conf?: number };
  /** the retelling that drifted furthest from what was heard */
  wildest?: Hop & { similarity: number };
  /** the world's actual truth about what the player said (authored fact), and whose secret it was */
  truth?: { text: string; value: boolean; secretOf: string[] };
  /** the town ended up talking about something else than the planted sentence: from what, to what, and where it turned */
  drift?: { from: string; to: string; pivot?: Hop };
  reached: string[];
}

const IMPACT: Record<string, string> = {
  mayor: "宣布取消燈籠節",
  police: "派警力",
  journalist: "在新聞部落格發文",
  organizer: "封鎖舞台",
};

/** Consequence rank of an event (higher = bigger). */
function rank(e: SimEvent): number {
  const d = e.data as Record<string, unknown>;
  if (e.type === "state") {
    const key = String(d.key ?? "");
    if (key === "festival") return 9;
    if (key === "police" || key === "stage") return 8;
    if (key.startsWith("shops.")) return 5;
    return 0;
  }
  if (e.type === "article" || e.type === "statement" || e.type === "gather") return 7;
  if (e.type === "notice") return 6;
  if ((e.type === "inspect" || e.type === "look") && d.found) return 2;
  if ((e.type === "talk" || e.type === "phone") && !d.missed) return 1;
  return 0;
}

function similarity(a: string, b: string) {
  // share of characters of b found, in order, in a (LCS / |b|)
  const n = a.length;
  const m = b.length;
  if (!m) return 1;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0] / m;
}

export function storyOf(run: RunResult): StoryCard {
  const events = [...run.events].sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const byId = new Map(events.map((e) => [e.id, e]));
  const decisionOf = (id: unknown) => run.decisions.find((d) => d.id === id);
  const seed = events.find((e) => e.type === "seed");
  const seedNpc = run.config.seedNpc;
  const seedText = run.config.seedText;

  // what a speaker had heard: the newest message in the inbox of the decision behind this event
  const decisionBehind = (e: SimEvent) => {
    let frontier = [e];
    for (let k = 0; k < 6 && frontier.length; k++) {
      const next: SimEvent[] = [];
      for (const x of frontier) {
        if (x.type === "decide") return decisionOf(x.data.decision) ?? null;
        for (const c of x.causes) {
          const y = byId.get(c);
          if (y) next.push(y);
        }
      }
      frontier = next;
    }
    return null;
  };
  const heardBy = (e: SimEvent) => {
    const dec = decisionBehind(e);
    if (!dec) return undefined;
    return events
      .filter((x) => x.type === "deliver" && dec.inbox.includes(String(x.data.message)) && x.data.via !== "inspection" && x.data.via !== "meet" && !(x.data.via === "crowd" && !(x.data.claims as string[] | undefined)?.length))
      .map((x) => String(x.data.text))
      .at(-1);
  };
  // what the listener made of it: their first belief after hearing it
  const verdictAfter = (npc: string, t: number) => {
    const b = events.find((x) => x.type === "belief" && x.actor === npc && x.t >= t);
    return b ? { verdict: String(b.data.verdict), conf: Number(b.data.to) } : {};
  };
  // what the listener made of THIS message: the belief formed by the decision whose inbox held it
  const verdictOf = (hop: SimEvent): { verdict?: string; conf?: number } => {
    const del = events.find((x) => x.type === "deliver" && x.causes[0] === hop.id);
    const dec = del && run.decisions.find((d) => d.inbox.includes(String(del.data.message)));
    const dEv = dec && events.find((x) => x.type === "decide" && x.data.decision === dec.id);
    const b = dEv && events.find((x) => x.type === "belief" && x.causes.includes(dEv.id));
    return b ? { verdict: String(b.data.verdict), conf: Number(b.data.to) } : {};
  };
  const hopOf = (e: SimEvent): Hop => ({ from: e.actor!, to: e.target!, via: e.type as "talk" | "phone", text: String(e.data.text), heard: heardBy(e), t: e.t, ...verdictOf(e) });
  const hops = events.filter((e) => (e.type === "talk" || e.type === "phone") && !e.data.missed && e.actor && e.target).map(hopOf);

  // the biggest real outcome, and the path of causes from the planted sentence to it
  const top = events.reduce<SimEvent | null>((best, e) => (rank(e) > (best ? rank(best) : 0) ? e : best), null);
  let spine: Hop[] = [];
  if (top) {
    const prev = new Map<string, string>();
    const queue = [top.id];
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      if (seed && id === seed.id) break;
      for (const c of byId.get(id)?.causes ?? []) if (!seen.has(c)) (seen.add(c), prev.set(c, id), queue.push(c));
    }
    const path: SimEvent[] = [];
    for (let id: string | undefined = seed?.id; id; id = prev.get(id)) path.push(byId.get(id)!);
    spine = path.filter((e) => (e.type === "talk" || e.type === "phone") && !e.data.missed).map(hopOf);
    if (top.type === "talk" || top.type === "phone") spine = spine.length ? spine : [hopOf(top)];
  }
  if (!spine.length && hops.length) {
    // no big outcome: follow the longest chain of retellings
    spine = [hops[0]];
    for (const h of hops.slice(1)) if (h.from === spine.at(-1)!.to && h.t >= spine.at(-1)!.t) spine.push(h);
  }

  const reached = [...new Set(events.filter((e) => e.type === "deliver" && e.target && e.data.via !== "inspection").map((e) => e.target!))];
  const wildest = hops
    .filter((h) => h.heard)
    .map((h) => ({ ...h, similarity: similarity(h.heard!, h.text) }))
    .sort((a, b) => a.similarity - b.similarity)[0];

  const firstDecide = events.find((e) => e.type === "decide" && e.actor === seedNpc && !e.data.budget);
  // claims record the message that triggered the decision as their origin
  const seedClaims = (run.claims ?? []).filter((c) => firstDecide && c.by === seedNpc && (c.origin === firstDecide.id || firstDecide.causes.includes(c.origin)));
  const card: StoryCard = { icon: "💬", headline: "", sub: "", spine, reached, wildest: wildest && wildest.similarity < 0.55 ? wildest : undefined };

  // topic drift: what the seed listener made of the sentence vs. what most people ended up holding beliefs about
  const claims = run.claims ?? [];
  const seedTopics = new Set(seedClaims.map((c) => c.topic));
  const people = new Map<string, Set<string>>();
  for (const c of claims) {
    if (!people.has(c.topic)) people.set(c.topic, new Set());
    people.get(c.topic)!.add(c.by);
  }
  const dominant = [...people.entries()].filter(([t]) => t !== "other").sort((a, b) => b[1].size - a[1].size)[0];
  if (dominant && dominant[1].size >= 2 && !seedTopics.has(dominant[0])) {
    const first = claims.find((c) => c.topic === dominant[0])!;
    // the first retelling on the way from the planted sentence to that first claim is where the talk turned
    const origin = byId.get(first.origin);
    let pivot: Hop | undefined;
    if (origin && seed) {
      const prev = new Map<string, string>();
      const queue = [origin.id];
      const seen = new Set(queue);
      while (queue.length) {
        const id = queue.shift()!;
        if (id === seed.id) break;
        for (const c of byId.get(id)?.causes ?? []) if (!seen.has(c)) (seen.add(c), prev.set(c, id), queue.push(c));
      }
      for (let id: string | undefined = seed.id; id; id = prev.get(id)) {
        const e = byId.get(id);
        // keep the last one: the retelling the new topic's first holder heard right before deciding
        if (e && (e.type === "talk" || e.type === "phone") && !e.data.missed) pivot = hopOf(e);
      }
    }
    card.drift = { from: seedText, to: first.statement, pivot };
  }
  // the most telling first-hand check: someone went to look and the engine showed them the real state of
  // something the story is about (the planted topic, the topic most people ended up on, or what they believed)
  const clipS = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const storyTopics = new Set<string>(seedClaims.map((c) => c.topic));
  {
    const counts = new Map<string, Set<string>>();
    for (const c of run.claims ?? []) if (c.topic !== "other") (counts.get(c.topic) ?? counts.set(c.topic, new Set()).get(c.topic)!).add(c.by);
    const dom = [...counts.entries()].sort((x, y) => y[1].size - x[1].size)[0];
    if (dom) storyTopics.add(dom[0]);
  }
  const storyFacts = new Set([...storyTopics].map((t) => topicFact(t)).filter(Boolean) as string[]);
  let checked: { e: SimEvent; text: string; dir: "up" | "down"; coverUp: boolean } | null = null;
  const seedFacts = new Set(seedClaims.map((c) => topicFact(c.topic)).filter(Boolean) as string[]);
  const aboutSeed = (e: SimEvent) => {
    const found = String(e.data.found ?? "");
    return FACTS.some((f) => f.check && seedFacts.has(f.id) && found.includes(f.check.zh)) || (/一切如常/.test(found) && e.actor === seedNpc);
  };
  const looks = events.filter((x) => x.type === "inspect" || x.type === "look");
  // checks about what the player said first, then expert inspections, then the rest
  looks.sort((x, y) => Number(aboutSeed(y)) - Number(aboutSeed(x)) || (x.type === "inspect" ? -1 : 0) - (y.type === "inspect" ? -1 : 0));
  for (const e of looks) {
    const found = String(e.data.found ?? "");
    if (!found) continue;
    const fact = FACTS.find((f) => f.check && storyFacts.has(f.id) && found.includes(f.check.zh));
    const nothing = /一切如常/.test(found);
    if (!fact && !nothing) continue;
    const before = events.filter((x) => x.type === "belief" && x.actor === e.actor && x.t < e.t).at(-1);
    const after = before && events.find((x) => x.type === "belief" && x.actor === e.actor && x.t >= e.t && x.data.claim === before.data.claim);
    const dir: "up" | "down" = nothing || (fact && !fact.value) || (before && after && Number(after.data.to) < Number(before.data.to) - 0.1) ? "down" : "up";
    if (nothing && !(before && Number(before.data.to) >= 0.3)) continue; // finding nothing only matters if they had something to check
    const coverUp = hops.some((h) => /壓下來|壓住|別說|不要說出去|敷衍|私下處理|低調/.test(h.text));
    checked = { e, text: fact ? fact.check!.zh : found.split(/\s+/)[0], dir, coverUp };
    break;
  }
  const d = (top?.data ?? {}) as Record<string, unknown>;
  const actor = top?.actor ? nameOf(top.actor) : "";
  const hopsN = spine.length;
  const via = hopsN ? `，經過 ${hopsN} 次轉述` : "";
  if (top && rank(top) >= 5) {
    if (top.type === "state" && d.key === "festival") Object.assign(card, { icon: "🏮", headline: "燈籠節取消了！", sub: `${actor}宣布取消${via}。一切從你對${nameOf(seedNpc)}說的一句話開始。` });
    else if (top.type === "state" && d.key === "stage") Object.assign(card, { icon: "🚧", headline: "慶典舞台被封鎖", sub: `${actor}下令封鎖${via}。` });
    else if (top.type === "state" && d.key === "police") Object.assign(card, { icon: "🚓", headline: `警察出動到${placeZh(String(d.to))}`, sub: `${actor}派出警力${via}。` });
    else if (top.type === "state") Object.assign(card, { icon: "🔒", headline: `${placeZh(String(d.key).slice(6))}暫停營業`, sub: `${actor}決定關店${via}。` });
    else if (top.type === "article") Object.assign(card, { icon: "📰", headline: `〈${String(d.headline)}〉`, sub: `${actor}寫成了新聞${via}。` });
    else if (top.type === "statement") Object.assign(card, { icon: "📣", headline: `${actor}出面發表聲明`, sub: `「${String(d.text).slice(0, 40)}」` });
    else if (top.type === "gather") Object.assign(card, { icon: "✊", headline: "攤商聚集討公道", sub: `${actor}號召大家${via}。` });
    else if (top.type === "notice") Object.assign(card, { icon: "📋", headline: "廣場布告欄貼出公告", sub: `「${String(d.text).slice(0, 40)}」` });
  } else if (checked) {
    // no world change, but someone went and saw the truth for themselves: that is the payoff
    const who = nameOf(checked.e.actor!);
    Object.assign(card, {
      icon: "🔍",
      headline: checked.dir === "down" ? `${who}親自去查：查無實據` : `${who}親自查證：${clipS(checked.text, 22)}`,
      sub: checked.dir === "down" ? `「${clipS(checked.text, 40)}」` : checked.coverUp ? "有人急著想把事情壓下來，但真相已經被看見了。" : `${reached.length} 個人被捲了進來，但目前還沒有人採取大動作。`,
    });
  } else if (card.drift && reached.length >= 3) {
    const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
    Object.assign(card, {
      icon: "🔀",
      headline: `你說「${clip(seedText, 10)}」，最後鎮上在談「${clip(card.drift.to, 14)}」`,
      sub: card.drift.pivot ? `話題在 ${nameOf(card.drift.pivot.from)}對${nameOf(card.drift.pivot.to)}說「${clip(card.drift.pivot.text, 26)}」時轉了彎。` : `${reached.length} 個人被捲了進來。`,
    });
  } else if (reached.length >= 3) {
    Object.assign(card, { icon: "💬", headline: `一句話把 ${reached.length} 個人捲了進來`, sub: "鎮上議論紛紛，但還沒有人真的採取大動作。" });
  }

  if (!card.headline) {
    // the rumour died: name who it stopped with, in their own words
    const lastDec = [...run.decisions].reverse().find((x) => x.output && x.npc);
    const stop = lastDec?.output;
    if (lastDec?.fallback) {
      // the model gave no valid answer: say so instead of inventing a reaction for the resident
      Object.assign(card, { icon: "⚠️", headline: `故事在${nameOf(lastDec.npc)}這裡中斷`, sub: "模型沒有給出有效回答，引擎改用安全預設，沒有讓任何事發生。" });
    } else if (lastDec && stop) {
      // where they ended up: their latest stored belief, not just the last decision's
      const lastB = events.filter((x) => x.type === "belief" && x.actor === lastDec.npc).at(-1);
      const b = lastB ? { verdict: String(lastB.data.verdict), conf: Number(lastB.data.to) } : {};
      card.stopper = { npc: lastDec.npc, thought: stop.thought, ...b };
      const dismissive = !b.conf || b.conf < 0.35;
      // the same two people talking it over is not spreading: say so instead of "didn't tell anyone"
      const talkers = new Set(hops.flatMap((h) => [h.from, h.to]));
      const bounced = hops.length >= 2 && talkers.size === 2;
      const [p1, p2] = [...talkers];
      const toldSomeone = hops.some((h) => h.from === lastDec.npc);
      Object.assign(card, {
        icon: bounced ? "🔁" : !lastB ? "❓" : dismissive ? "🧱" : "🤐",
        headline: bounced
          ? `話在${nameOf(p1)}和${nameOf(p2)}之間打轉，沒有再傳出去`
          : !lastB
            ? `${nameOf(lastDec.npc)}聽得一頭霧水，就這樣算了`
            : dismissive
            ? `謠言在${nameOf(lastDec.npc)}這裡踢到鐵板`
            : toldSomeone
              ? `${nameOf(lastDec.npc)}說完就沒有下文了`
              : `${nameOf(lastDec.npc)}聽進去了，但沒有說出去`,
        sub: `「${stop.thought}」`,
      });
    } else Object.assign(card, { icon: "🍃", headline: "這句話沒有激起任何漣漪", sub: "" });
  }

  // the reveal: what was actually true about the topic the player raised (from the world's authored facts)
  const seedFact = seedClaims.map((c) => topicFact(c.topic)).find(Boolean);
  const fact = seedFact ? FACTS.find((f) => f.id === seedFact) : undefined;
  if (fact && !fact.public) {
    card.truth = {
      text: fact.value ? fact.zh : (fact.notZh ?? `其實並沒有這回事：${fact.zh}`),
      value: fact.value,
      secretOf: PERSONAS.filter((p) => p.secrets.includes(fact.id)).map((p) => p.id),
    };
  }

  // the closest call: someone who could have done something big, and what they actually did
  for (const npc of ["mayor", "police", "journalist", "organizer"]) {
    if (!reached.includes(npc) && seedNpc !== npc) continue;
    const decs = run.decisions.filter((x) => x.npc === npc && x.output && !x.fallback);
    if (!decs.length) continue;
    const did = decs.flatMap((x) => x.output!.actions).find((a) => a.type !== "none");
    const bigDone = events.some((e) => e.actor === npc && rank(e) >= 5);
    if (bigDone) continue;
    const lastB = events.filter((x) => x.type === "belief" && x.actor === npc).at(-1);
    if (!lastB || Number(lastB.data.to) < 0.3) continue;
    const b = { conf: Number(lastB.data.to) };
    const doing = did ? { phone: "打電話給別人", tell: "跑去跟別人說", ask: "去問別人", go_look: "自己跑去看", inspect: "親自去檢查", post_notice: "貼了公告", public_statement: "發表聲明" }[did.type as string] ?? "做了別的事" : "什麼也沒做";
    card.closest = { npc, could: IMPACT[npc], did: doing, conf: b.conf };
    break;
  }
  return card;
}
