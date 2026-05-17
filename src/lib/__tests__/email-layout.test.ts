import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emailButton,
  escapeHtml,
  infoCard,
  lineItemsTable,
  renderEmail,
} from "../email-layout.ts";

test("escapeHtml escapes the five chars", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("renderEmail wraps content with shell + escapes string fields", () => {
  const html = renderEmail({
    preheader: "pre <x>",
    eyebrow: "ORDER",
    heading: "Hi <Bob>",
    bodyHtml: "<p data-test='x'>BODYMARKER</p>",
    footerNote: "note",
  });
  assert.equal(html.match(/<!doctype html>/gi)?.length, 1);
  assert.ok(html.includes("pre &lt;x&gt;"));
  assert.ok(html.includes("Hi &lt;Bob&gt;"));
  assert.ok(html.includes("ORDER"));
  assert.ok(html.includes("<p data-test='x'>BODYMARKER</p>"));
  assert.ok(html.includes("Made in a Home Kitchen"));
  assert.ok(html.includes("note"));
});

test("emailButton: variant styling + escaped href", () => {
  const p = emailButton("https://x.test/a?b=1&c=2", "Go");
  assert.ok(p.includes('href="https://x.test/a?b=1&amp;c=2"'));
  assert.ok(p.includes("#a55d1f"));
  const s = emailButton("https://x.test", "No", "secondary");
  assert.ok(s.includes("#fffdf2"));
});

test("lineItemsTable: row per item + total, escapes label", () => {
  const t = lineItemsTable(
    [
      { label: "2× A<b>", amount: "$2.00" },
      { label: "1× B", amount: "$1.00" },
    ],
    { label: "Total", amount: "$3.00" },
  );
  assert.equal((t.match(/<tr>/g) ?? []).length, 3);
  assert.ok(t.includes("2× A&lt;b&gt;"));
  assert.ok(t.includes("$3.00"));
});

test("infoCard: tone backgrounds", () => {
  assert.ok(infoCard("hi").includes("#fbedd6"));
  assert.ok(infoCard("hi", "sage").includes("#eef3df"));
});
