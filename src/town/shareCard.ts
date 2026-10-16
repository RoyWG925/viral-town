// "霧港小報" front page as a PNG the player can save and share. Drawn from the story card, which is built
// only from the run's validated events (no extra generation).
import { nameOf } from "./director";
import type { StoryCard } from "./story";

const W = 1080;
const H = 1350;
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function block(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const lines = wrap(g, text, maxW);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].slice(0, -1) + "…";
  shown.forEach((l, i) => g.fillText(l, x, y + i * lh));
  return y + shown.length * lh;
}

export function drawShareCard(card: StoryCard, seedNpc: string, seedText: string, stats: { reach: number; depth: number; world: number; festival: string }) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // paper
  g.fillStyle = "#fbf6ea";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#2b2622";
  g.textBaseline = "top";
  // masthead
  g.font = `900 92px ${FONT}`;
  g.fillText("霧港小報", 70, 60);
  g.font = `600 26px ${FONT}`;
  g.fillStyle = "#7a6f62";
  g.fillText("MISTPORT GAZETTE · 燈籠節之夜 · 號外", 74, 170);
  g.fillRect(70, 214, W - 140, 6);
  g.fillRect(70, 226, W - 140, 2);
  // headline
  g.fillStyle = "#1d1916";
  g.font = `900 64px ${FONT}`;
  let y = block(g, `${card.icon} ${card.headline}`, 70, 260, W - 140, 80, 3) + 10;
  if (card.sub) {
    g.font = `500 32px ${FONT}`;
    g.fillStyle = "#4a423b";
    y = block(g, card.sub, 70, y, W - 140, 46, 3) + 24;
  }
  // the sentence
  g.fillStyle = "#6d28d9";
  g.fillRect(70, y, W - 140, 4);
  y += 22;
  g.font = `700 30px ${FONT}`;
  g.fillText(`起因：有人對${nameOf(seedNpc)}低聲說了一句`, 70, y);
  y += 48;
  g.font = `800 40px ${FONT}`;
  g.fillStyle = "#2b2622";
  y = block(g, `「${seedText}」`, 70, y, W - 140, 54, 2) + 26;
  // the chain
  for (const h of card.spine.slice(0, 4)) {
    g.font = `700 28px ${FONT}`;
    g.fillStyle = "#b45309";
    g.fillText(`${h.via === "phone" ? "📞" : "💬"} ${nameOf(h.from)} → ${nameOf(h.to)}`, 70, y);
    y += 40;
    g.font = `500 28px ${FONT}`;
    g.fillStyle = "#3b342e";
    y = block(g, `「${h.text}」`, 100, y, W - 200, 40, 2) + 18;
    if (y > H - 300) break;
  }
  if (card.closest && y < H - 260) {
    g.font = `600 28px ${FONT}`;
    g.fillStyle = "#7a6f62";
    y = block(g, `📌 差一點：${nameOf(card.closest.npc)}可以${card.closest.could}，但他選擇${card.closest.did}。`, 70, y + 6, W - 140, 40, 2) + 16;
  }
  // stats bar
  const by = H - 200;
  g.fillStyle = "#2b2622";
  g.fillRect(70, by, W - 140, 3);
  const cells = [
    [`${stats.reach}`, "被捲入的居民"],
    [`${stats.depth}`, "傳播層數"],
    [`${stats.world}`, "世界變化"],
    [stats.festival, "燈籠節"],
  ];
  cells.forEach(([v, k], i) => {
    const x = 70 + i * ((W - 140) / 4);
    g.font = `900 52px ${FONT}`;
    g.fillStyle = "#c2410c";
    g.fillText(v, x, by + 24);
    g.font = `500 24px ${FONT}`;
    g.fillStyle = "#7a6f62";
    g.fillText(k, x, by + 90);
  });
  g.font = `500 22px ${FONT}`;
  g.fillStyle = "#9a8f82";
  g.fillText("VIRAL · 每位居民由 Gemma 4（AMD）依自己知道的事判斷；本報內容全部來自模擬事件紀錄", 70, H - 56);
  return c;
}

export function downloadShareCard(...args: Parameters<typeof drawShareCard>) {
  const c = drawShareCard(...args);
  const a = document.createElement("a");
  a.download = `viral-${Date.now()}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}
