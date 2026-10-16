// Does warming the provider's prompt cache (sending the shared system prompt a few seconds early) cut the
// time to the first token of a real decision? A/B on AMD Token Factory, streamed.
//   node lab/warm-probe.ts [pairs=3]
import { makeChat, type ChatMessage } from "../src/sim/llm.ts";
import { systemPrompt } from "../src/sim/mind.ts";

const key = process.env.TOKENFACTORY_API_KEY!;
const chat = makeChat({ key, temperature: 0.7, maxTokens: 400, timeoutMs: 90_000, maxAttempts: 3 });
const pairs = Number(process.argv[2] ?? 3);
const user = '你是麵包店老闆阿德。剛才一位陌生客人說：「聽說今晚的舞台是用舊木板趕工搭的，很可能撐不住。」請照格式回覆 JSON。';
const ttft = async (msgs: ChatMessage[]) => {
  const r = await chat(msgs, { onDelta: () => {} });
  return { ttft: r.ttftMs ?? null, total: r.latencyMs, status: r.status };
};
const rows = [];
for (let i = 0; i < pairs; i++) {
  // cold: a unique first line makes the whole prefix new to the cache
  const coldSys = `（第 ${Date.now()}-${i} 次）\n` + systemPrompt("eager", "single");
  const cold = await ttft([{ role: "system", content: coldSys }, { role: "user", content: user }]);
  // warm: send the same prefix once (1 token), wait 3 s, then the real call
  const warmSys = `（暖身 ${Date.now()}-${i}）\n` + systemPrompt("eager", "single");
  await chat([{ role: "system", content: warmSys }, { role: "user", content: "好" }], { maxTokens: 1 });
  await new Promise((r) => setTimeout(r, 3000));
  const warm = await ttft([{ role: "system", content: warmSys }, { role: "user", content: user }]);
  rows.push({ cold, warm });
  console.log(`pair ${i + 1}: cold first token ${cold.ttft} ms (total ${cold.total}) | warm first token ${warm.ttft} ms (total ${warm.total})`);
}
const mean = (xs: (number | null)[]) => Math.round(xs.filter((x): x is number => x !== null).reduce((a, b) => a + b, 0) / Math.max(1, xs.filter((x) => x !== null).length));
console.log(`mean first token: cold ${mean(rows.map((r) => r.cold.ttft))} ms vs warm ${mean(rows.map((r) => r.warm.ttft))} ms`);
