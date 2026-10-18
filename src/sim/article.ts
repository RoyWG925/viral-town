// How a reporter's post becomes a headline and a body. The model writes one message; the headline is what comes
// before the first line break or colon. A label it sometimes puts in front ("HEADLINE:", "Title —", "標題：") is not
// the headline, so it is dropped first.
const LABEL = /^\s*(?:\*\*|#+\s*)?(?:headline|title|標題|标题)(?:\*\*)?(?:\s*[:：]|\s+[-–—])(?:\*\*)?\s*/i;
const BARE_LABEL = /^\s*(?:headline|title|標題|标题)\s*$/i;

export function splitArticle(message: string): { headline: string; body: string } {
  const msg = message.replace(LABEL, "");
  const cut = msg.search(/[\n：:]/);
  const headline = (cut < 0 ? msg : msg.slice(0, cut)).trim().slice(0, 68);
  const body = (cut < 0 ? "" : msg.slice(cut + 1).trim()).slice(0, 510) || headline;
  return { headline, body };
}

/** An article as logged. Logs written before splitArticle may hold the bare label as the headline; the real one
 * then opens the body, in the model's own words. */
export function articleOf(d: { headline?: unknown; body?: unknown }): { headline: string; body: string } {
  const headline = String(d.headline ?? ""), body = String(d.body ?? "");
  return BARE_LABEL.test(headline) && body ? splitArticle(body) : { headline, body };
}
