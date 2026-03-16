import test from "node:test";
import assert from "node:assert/strict";

import { cleanupJson } from "../server/services/plan/shared.js";

test("cleanupJson extracts fenced JSON and repairs invalid backslashes inside strings", () => {
  const raw = [
    "```json",
    "{",
    '  "cleanedQuestion": "Use the line r = a + t\\d to meet the plane",',
    '  "diagramSummary": "Equation shown as x\\y = 3",',
    '  "givens": ["r = a + t\\d"]',
    "}",
    "```",
  ].join("\n");

  const parsed = JSON.parse(cleanupJson(raw));

  assert.equal(parsed.cleanedQuestion, "Use the line r = a + t\\d to meet the plane");
  assert.equal(parsed.diagramSummary, "Equation shown as x\\y = 3");
  assert.deepEqual(parsed.givens, ["r = a + t\\d"]);
});

test("cleanupJson trims non-json narration around the payload", () => {
  const parsed = JSON.parse(cleanupJson('Here you go: {"ok":true,"value":"A"} Thanks!'));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value, "A");
});
