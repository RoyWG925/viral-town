// A reporter's post → headline and body, including the label the model sometimes writes in front.
// node --test lab/test-article.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { articleOf, splitArticle } from "../src/sim/article.ts";

test("the headline is what comes before the first line break or colon", () => {
  assert.deepEqual(splitArticle("Stage Shut Down!\nThe chief taped it off."), { headline: "Stage Shut Down!", body: "The chief taped it off." });
  assert.deepEqual(splitArticle("舞台被封：警長拉起封鎖線"), { headline: "舞台被封", body: "警長拉起封鎖線" });
  assert.deepEqual(splitArticle("Just one line"), { headline: "Just one line", body: "Just one line" });
});

test("a leading HEADLINE: / Title — / 標題： label is not the headline", () => {
  const msg = "HEADLINE: MAYOR'S FESTIVAL FINANCE FIASCO! \n\nAn insider has revealed a shocking truth.";
  assert.deepEqual(splitArticle(msg), { headline: "MAYOR'S FESTIVAL FINANCE FIASCO!", body: "An insider has revealed a shocking truth." });
  assert.equal(splitArticle("**Headline:** Doves Gone\nThey flew off.").headline, "Doves Gone");
  assert.equal(splitArticle("Title — Stage Shut\nbody").headline, "Stage Shut");
  assert.equal(splitArticle("標題：舞台被封\n內文").headline, "舞台被封");
  // a headline that merely starts with the word stays whole
  assert.equal(splitArticle("Headlines can lie\nbody").headline, "Headlines can lie");
});

test("old logs with the bare label as the headline read correctly", () => {
  // as logged by P23/car-vendor before the fix
  const logged = { headline: "HEADLINE", body: "MAYOR'S FESTIVAL FINANCE FIASCO! \n\nAn insider has revealed a shocking truth." };
  assert.deepEqual(articleOf(logged), { headline: "MAYOR'S FESTIVAL FINANCE FIASCO!", body: "An insider has revealed a shocking truth." });
  assert.deepEqual(articleOf({ headline: "Stage Shut", body: "x" }), { headline: "Stage Shut", body: "x" });
});
