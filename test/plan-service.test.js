import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalyticPlannerInput } from "../server/services/planService.js";

test("buildAnalyticPlannerInput prefers the raw typed question for deterministic analytic lessons", () => {
  const rawQuestion = "A line passes through the point (1, -2, 3) and moves in the direction of the vector (2, 1, -1). There is a plane in space whose equation is 2x - y + z = 7. Question: Find the coordinates of the point where the line intersects the plane.";
  const sourceSummary = {
    inputMode: "text",
    rawQuestion,
    cleanedQuestion: "Find the intersection point of a line and a plane.",
    givens: [
      "Line passes through point (1, -2, 3)",
      "Line direction vector is (2, 1, -1)",
      "Plane equation: 2x - y + z = 7",
    ],
  };

  const analyticInput = buildAnalyticPlannerInput({ questionText: rawQuestion, sourceSummary });

  assert.equal(analyticInput.questionText, rawQuestion);
  assert.equal(analyticInput.sourceSummary.cleanedQuestion, rawQuestion);
  assert.deepEqual(analyticInput.sourceSummary.givens, sourceSummary.givens);
});

test("buildAnalyticPlannerInput keeps interpreted text when no raw question is available", () => {
  const sourceSummary = {
    inputMode: "image",
    cleanedQuestion: "Find the point where the line intersects the plane.",
  };

  const analyticInput = buildAnalyticPlannerInput({ questionText: "", sourceSummary });

  assert.equal(analyticInput.questionText, sourceSummary.cleanedQuestion);
  assert.equal(analyticInput.sourceSummary.cleanedQuestion, sourceSummary.cleanedQuestion);
});
