// "The Mistport Gazette" front page as a PNG the player can save and share. Drawn from the story card, which is built
// only from the run's validated events (no extra generation).
import { listOf, nameOf } from "./director";
import type { StoryCard } from "./story";

const W = 1080;
const H = 1350;
// Latin fonts first; the CJK ones stay for lines from the old (Chinese) recorded runs
const FONT = 'system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
// a CJK character or full-width mark is a piece of its own (Chinese wraps anywhere); English wraps between words
const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
// closing punctuation never starts a line: let it hang on the previous one
const NO_START = /^[\u3001\u3002\uFF0C\uFF01\uFF1F\uFF1B\uFF1A\u300D\u300F\uFF09\u2026,.!?;:)\u201D\u2019]/;

/** The pieces a line is built from: a word together with the spaces after it, or one CJK character. */
function pieces(text: string): string[] {
  const out: string[] = [];
  let word = "";
  for (const ch of text) {
    if (CJK.test(ch)) {
      if (word) out.push(word);
      word = "";
      out.push(ch);
    } else if (/\s/.test(ch)) word += ch;
    else {
      if (/\s$/.test(word)) {
        out.push(word);
        word = "";
      }
      word += ch;
    }
  }
  if (word) out.push(word);
  return out;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const piece of pieces(text)) {
    const next = line + piece;
    // `alone`: the line holds only this piece (a fresh line)
    let alone = !line;
    if (line && g.measureText(next.trimEnd()).width > maxW && !NO_START.test(piece)) {
      lines.push(line.trimEnd());
      line = piece;
      alone = true;
    } else line = next;
    // a single word wider than the whole line (a long link): cut it by characters
    while (alone && [...line.trimEnd()].length > 1 && g.measureText(line.trimEnd()).width > maxW) {
      const chars = [...line];
      let k = chars.length - 1;
      while (k > 1 && g.measureText(chars.slice(0, k).join("")).width > maxW) k--;
      lines.push(chars.slice(0, k).join(""));
      line = chars.slice(k).join("");
    }
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  return lines;
}

function block(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const lines = wrap(g, text, maxW);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    // the last line shown ends in an ellipsis that still fits
    let last = shown[maxLines - 1];
    while ([...last].length > 1 && g.measureText(`${last}…`).width > maxW) last = [...last].slice(0, -1).join("");
    shown[maxLines - 1] = `${last.replace(/[\s,;:]+$/, "")}…`;
  }
  shown.forEach((l, i) => g.fillText(l, x, y + i * lh));
  return y + shown.length * lh;
}

/** Sets the largest font (from `size` down to `min`) at which one line of `text` fits in `maxW`. */
function fit(g: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number, min = 16) {
  let s = size;
  for (; s > min; s -= 2) {
    g.font = `${weight} ${s}px ${FONT}`;
    if (g.measureText(text).width <= maxW) return s;
  }
  g.font = `${weight} ${min}px ${FONT}`;
  return min;
}

/** `stamps`: the small goals this run ticked (icon + words), printed above the stats. */
export function drawShareCard(card: StoryCard, seedNpc: string, seedText: string, stats: { reach: number; depth: number; world: number; festival: string }, stamps: string[] = []) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // the lowest the story text may run: above the stats bar, and above the stamps (one or two lines) when there are any
  g.font = `800 28px ${FONT}`;
  const stampText = stamps.length ? `Goals stamped:  ${stamps.join("  ·  ")}` : "";
  const stampLines = stamps.length ? Math.min(2, wrap(g, stampText, W - 140).length) : 0;
  const floor = H - 200 - stampLines * 40 - (stampLines ? 20 : 0);
  // paper
  g.fillStyle = "#fbf6ea";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#2b2622";
  g.textBaseline = "top";
  // masthead
  fit(g, "The Mistport Gazette", 900, 92, W - 140, 60);
  g.fillText("The Mistport Gazette", 70, 60);
  g.font = `600 26px ${FONT}`;
  g.fillStyle = "#7a6f62";
  g.fillText("MISTPORT · LANTERN FESTIVAL NIGHT · SPECIAL EDITION", 74, 170);
  g.fillRect(70, 214, W - 140, 6);
  g.fillRect(70, 226, W - 140, 2);
  // headline: as large as it can be in three lines
  g.fillStyle = "#1d1916";
  const headline = `${card.icon} ${card.headline}`;
  let size = 64;
  for (; size > 48; size -= 8) {
    g.font = `900 ${size}px ${FONT}`;
    if (wrap(g, headline, W - 140).length <= 3) break;
  }
  g.font = `900 ${size}px ${FONT}`;
  let y = block(g, headline, 70, 260, W - 140, Math.round(size * 1.25), 3) + 10;
  if (card.sub) {
    g.font = `500 32px ${FONT}`;
    g.fillStyle = "#4a423b";
    y = block(g, card.sub, 70, y, W - 140, 44, 3) + 24;
  }
  // the sentence
  g.fillStyle = "#6d28d9";
  g.fillRect(70, y, W - 140, 4);
  y += 22;
  g.font = `700 30px ${FONT}`;
  g.fillText(`How it started: someone whispered to ${nameOf(seedNpc)}`, 70, y);
  y += 48;
  g.font = `800 36px ${FONT}`;
  g.fillStyle = "#2b2622";
  y = block(g, `“${seedText}”`, 70, y, W - 140, 48, 3) + 26;
  // a second whisper is part of the cause too: never credit one sentence with a two-sentence outcome
  for (const w of card.whispers) {
    g.font = `700 30px ${FONT}`;
    g.fillStyle = "#6d28d9";
    y = block(g, `Then one more line to ${nameOf(w.npc)}: “${w.text}”`, 70, y, W - 140, 42, 2) + 22;
  }
  // the chain (fewer hops when there is a truth to reveal: the reveal matters more). A long chain shows how it
  // started and how it ended — the surprise is usually at the end — with the middle counted, not hidden.
  const room = (card.truth ? 3 : 4) - (stamps.length ? 1 : 0);
  const long = card.spine.length > room;
  const hops = long ? [card.spine[0], ...card.spine.slice(-(room - 1))] : card.spine;
  for (const [k, h] of hops.entries()) {
    if (long && k === 1) {
      const skipped = card.spine.length - room;
      g.font = `600 26px ${FONT}`;
      g.fillStyle = "#9a8f82";
      g.fillText(`⋯ ${skipped} more ${skipped === 1 ? "retelling" : "retellings"} in between ⋯`, 100, y);
      y += 44;
    }
    g.font = `700 28px ${FONT}`;
    g.fillStyle = "#b45309";
    g.fillText(`${h.via === "phone" ? "📞" : "💬"} ${nameOf(h.from)} → ${nameOf(h.to)}`, 70, y);
    y += 40;
    g.font = `500 28px ${FONT}`;
    g.fillStyle = "#3b342e";
    y = block(g, `“${h.text}”`, 100, y, W - 200, 38, 2) + 18;
    if (y > floor - 100) break;
  }
  if (card.truth && y < floor - 50) {
    g.font = `700 28px ${FONT}`;
    g.fillStyle = "#1f2937";
    // two lines if there is room, else one (the reveal is worth more than the near miss below)
    const secret = card.truth.secretOf.length ? ` (a secret ${listOf(card.truth.secretOf.map(nameOf))} kept)` : "";
    y = block(g, `🔎 The truth: ${card.truth.text}${secret}`, 70, y + 6, W - 140, 38, y < floor - 90 ? 2 : 1) + 16;
  }
  if (card.reveal && y < floor - 70) {
    g.font = `600 26px ${FONT}`;
    g.fillStyle = "#6d28d9";
    y = block(g, `🔓 You found out: ${nameOf(card.reveal.npc)}'s ${card.reveal.label} — ${card.reveal.text}`, 70, y + 6, W - 140, 36, y < floor - 110 ? 2 : 1) + 12;
  }
  if (card.closest && y < floor - 90) {
    g.font = `600 28px ${FONT}`;
    g.fillStyle = "#7a6f62";
    block(g, `📌 So close: ${nameOf(card.closest.npc)} could ${card.closest.could}, but chose to ${card.closest.did} instead.`, 70, y + 6, W - 140, 38, 2);
  }
  // the goals this story stamped, right above the stats
  const by = H - 200;
  if (stamps.length) {
    g.font = `800 28px ${FONT}`;
    g.fillStyle = "#c2410c";
    block(g, stampText, 70, by - 12 - stampLines * 40, W - 140, 38, stampLines);
  }
  // stats bar: each number and its label fitted to its quarter of the width
  g.fillStyle = "#2b2622";
  g.fillRect(70, by, W - 140, 3);
  const cellW = (W - 140) / 4;
  const cells = [
    [`${stats.reach}`, stats.reach === 1 ? "person drawn in" : "people drawn in"],
    [`${stats.depth}`, stats.depth === 1 ? "hop deep" : "hops deep"],
    [`${stats.world}`, stats.world === 1 ? "town change" : "town changes"],
    [stats.festival, "the festival"],
  ];
  cells.forEach(([v, k], i) => {
    const x = 70 + i * cellW;
    fit(g, v, 900, 52, cellW - 16, 28);
    g.fillStyle = "#c2410c";
    g.fillText(v, x, by + 24);
    fit(g, k, 500, 24, cellW - 12, 16);
    g.fillStyle = "#7a6f62";
    g.fillText(k, x, by + 90);
  });
  g.font = `500 22px ${FONT}`;
  g.fillStyle = "#9a8f82";
  block(g, "VIRAL · Every resident is played by Gemma 4 (on AMD), judging only from what they know. Everything in this paper comes from the simulation's event log.", 70, H - 76, W - 140, 28, 2);
  return c;
}

export function downloadShareCard(...args: Parameters<typeof drawShareCard>) {
  const c = drawShareCard(...args);
  const a = document.createElement("a");
  a.download = `viral-${Date.now()}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}
