import assert from "node:assert/strict";
import { test } from "node:test";

import { csvDollars, toCsv } from "./csv.ts";

test("plain rows join with commas and CRLF", () => {
  assert.equal(toCsv([["a", "b"], ["c", 1]]), "a,b\r\nc,1");
});

test("cells with commas, quotes, or newlines are quoted/escaped", () => {
  assert.equal(toCsv([["Cheddar, sharp"]]), '"Cheddar, sharp"');
  assert.equal(toCsv([['He said "hi"']]), '"He said ""hi"""');
  assert.equal(toCsv([["line1\nline2"]]), '"line1\nline2"');
});

test("csvDollars formats cents", () => {
  assert.equal(csvDollars(1234), "12.34");
  assert.equal(csvDollars(0), "0.00");
  assert.equal(csvDollars(-500), "-5.00");
});
