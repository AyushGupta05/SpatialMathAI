import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalyticPlan, detectAnalyticSubtype } from "../server/services/plan/analytic.js";

const linePlaneIntersectionPrompt = "A line passes through the point P(1, -2, 3) with direction d = (2, 1, -1). The plane Pi has equation 2x - y + z = 7. Find the coordinates of the point where the line intersects the plane.";
const linePlaneAnglePrompt = "A line has direction vector (3, -2, 1) and a plane has equation 2x + y - 2z = 6. Find the angle between the line and the plane.";
const linePlaneAngleVariantPrompt = "Find the angle between a line with direction vector (3, -2, 1) and a plane given by 2x + y - 2z = 6.";
const skewLinesPrompt = "Two lines in space are given by r1 = (1,2,0) + t(2,-1,3), r2 = (4,-1,2) + s(1,2,-1). Find the shortest distance between the two skew lines.";

test("detectAnalyticSubtype recognizes supported analytic prompts", () => {
  assert.equal(detectAnalyticSubtype(linePlaneIntersectionPrompt), "line_plane_intersection");
  assert.equal(detectAnalyticSubtype(linePlaneAnglePrompt), "line_plane_angle");
  assert.equal(detectAnalyticSubtype(linePlaneAngleVariantPrompt), "line_plane_angle");
  assert.equal(detectAnalyticSubtype(skewLinesPrompt), "skew_lines_distance");
});

test("buildAnalyticPlan creates an auto-rendered line-plane intersection lesson", () => {
  const plan = buildAnalyticPlan(linePlaneIntersectionPrompt, {
    cleanedQuestion: linePlaneIntersectionPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.experienceMode, "analytic_auto");
  assert.equal(plan.analyticContext?.subtype, "line_plane_intersection");
  assert.ok(plan.objectSuggestions.some((item) => item.id === "plane-main"));
  assert.ok(plan.objectSuggestions.some((item) => item.id === "normal-guide"));
  assert.ok(plan.objectSuggestions.some((item) => item.id === "intersection-point"));
  assert.equal(plan.sceneMoments.length, 5);
  assert.deepEqual(plan.analyticContext?.derivedValues?.intersection, [1, -2, 3]);
  assert.match(plan.analyticContext?.formulaCard?.formula || "", /n ·/);
});

test("buildAnalyticPlan creates an angle lesson with the correct formula and result", () => {
  const plan = buildAnalyticPlan(linePlaneAnglePrompt, {
    cleanedQuestion: linePlaneAnglePrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.analyticContext?.subtype, "line_plane_angle");
  assert.equal(plan.answerScaffold.formula, "sin(theta) = |d · n| / (|d||n|)");
  assert.ok(Number(plan.analyticContext?.derivedValues?.angleDegrees) > 10);
  assert.ok(Number(plan.analyticContext?.derivedValues?.angleDegrees) < 11);
  assert.ok(plan.sceneOverlays.some((overlay) => overlay.id === "angle-result-label"));
});

test("buildAnalyticPlan accepts plane-angle wording from the simplified worksheet prompt", () => {
  const plan = buildAnalyticPlan(linePlaneAngleVariantPrompt, {
    cleanedQuestion: linePlaneAngleVariantPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.experienceMode, "analytic_auto");
  assert.equal(plan.analyticContext?.subtype, "line_plane_angle");
  assert.ok(plan.objectSuggestions.some((item) => item.id === "normal-guide"));
});

test("buildAnalyticPlan creates a skew-lines lesson with the shortest segment", () => {
  const plan = buildAnalyticPlan(skewLinesPrompt, {
    cleanedQuestion: skewLinesPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.analyticContext?.subtype, "skew_lines_distance");
  assert.ok(plan.objectSuggestions.some((item) => item.id === "shortest-segment"));
  assert.ok(plan.sceneMoments.some((moment) => moment.visibleObjectIds.includes("shortest-segment")));
  assert.equal(plan.answerScaffold.formula, "distance = |(p2 - p1) · (v1 x v2)| / |v1 x v2|");
  assert.ok(Number(plan.analyticContext?.derivedValues?.distance) > 2.3);
  assert.ok(Number(plan.analyticContext?.derivedValues?.distance) < 2.31);
});
