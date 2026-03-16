import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalyticPlan, detectAnalyticSubtype } from "../server/services/plan/analytic.js";

const linePlaneIntersectionPrompt = "A line passes through the point P(1, -2, 3) with direction d = (2, 1, -1). The plane Pi has equation 2x - y + z = 7. Find the coordinates of the point where the line intersects the plane.";
const linePlaneIntersectionNaturalPrompt = "A line passes through the point (1, -2, 3) and moves in the direction of the vector (2, 1, -1). There is a plane in space whose equation is 2x - y + z = 7. Find the coordinates of the point where the line intersects the plane.";
const linePlaneAnglePrompt = "A line has direction vector (3, -2, 1) and a plane has equation 2x + y - 2z = 6. Find the angle between the line and the plane.";
const linePlaneAngleVariantPrompt = "Find the angle between a line with direction vector (3, -2, 1) and a plane given by 2x + y - 2z = 6.";
const linePlaneAngleAnchoredPrompt = "In three-dimensional space, a line L passes through the point A(1, 2, -1) and has direction vector d = (2, -1, 3). A plane P has equation 2x - y + 2z = 7. Find the acute angle between the line L and the plane P.";
const linePlaneAngleBracketPrompt = "In three-dimensional space, a line L passes through the point A(1, 2, -1) and has direction vector d = ⟨2, -1, 3⟩. A plane P has equation 2x - y + 2z = 7. Find the acute angle between the line L and the plane P.";
const skewLinesPrompt = "Two lines in space are given by r1 = (1,2,0) + t(2,-1,3), r2 = (4,-1,2) + s(1,2,-1). Find the shortest distance between the two skew lines.";
const skewLinesUnicodePrompt = "Two lines in space are given by r₁ = (1, 2, 0) + t(2, -1, 3), r₂ = (4, -1, 2) + s(1, 2, -1). Find the shortest distance between the two skew lines.";
const skewLinesUnlabeledPrompt = "Two lines in space are given by (1,2,0) + t(2,-1,3) and (4,-1,2) + s(1,2,-1). Find the shortest distance between the two skew lines.";
const linearSystemPrompt = `Find the values of k for which the following system of equations has no solutions and the value of k for the system to have an infinite number of solutions.

x - 3y + z = 3
x + 5y - 2z = 1
16y - 6z = k`;

test("detectAnalyticSubtype recognizes supported analytic prompts", () => {
  assert.equal(detectAnalyticSubtype(linePlaneIntersectionPrompt), "line_plane_intersection");
  assert.equal(detectAnalyticSubtype(linePlaneIntersectionNaturalPrompt), "line_plane_intersection");
  assert.equal(detectAnalyticSubtype(linePlaneAnglePrompt), "line_plane_angle");
  assert.equal(detectAnalyticSubtype(linePlaneAngleVariantPrompt), "line_plane_angle");
  assert.equal(detectAnalyticSubtype(skewLinesPrompt), "skew_lines_distance");
  assert.equal(detectAnalyticSubtype(skewLinesUnicodePrompt), "skew_lines_distance");
  assert.equal(detectAnalyticSubtype(skewLinesUnlabeledPrompt), "skew_lines_distance");
  assert.equal(detectAnalyticSubtype(linearSystemPrompt), "system_of_linear_equations");
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
  assert.deepEqual(plan.sceneMoments[0].visibleObjectIds, ["line-main", "plane-main"]);
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

test("buildAnalyticPlan accepts natural language line-plane intersection wording", () => {
  const plan = buildAnalyticPlan(linePlaneIntersectionNaturalPrompt, {
    cleanedQuestion: linePlaneIntersectionNaturalPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.experienceMode, "analytic_auto");
  assert.equal(plan.analyticContext?.subtype, "line_plane_intersection");
  assert.deepEqual(plan.sceneMoments[0].visibleObjectIds, ["line-main", "plane-main"]);
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

test("buildAnalyticPlan keeps the actual anchor point for line-plane angle scenes", () => {
  const plan = buildAnalyticPlan(linePlaneAngleAnchoredPrompt, {
    cleanedQuestion: linePlaneAngleAnchoredPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.analyticContext?.subtype, "line_plane_angle");
  assert.deepEqual(plan.analyticContext?.entities?.lines?.[0]?.point, [1, 2, -1]);
  assert.ok(plan.objectSuggestions.some((item) => item.id === "point-anchor"));
  assert.ok(plan.sceneMoments[0]?.visibleObjectIds.includes("point-anchor"));
});

test("buildAnalyticPlan accepts worksheet-style direction vectors written with angle brackets", () => {
  const plan = buildAnalyticPlan(linePlaneAngleBracketPrompt, {
    cleanedQuestion: linePlaneAngleBracketPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.analyticContext?.subtype, "line_plane_angle");
  assert.deepEqual(plan.analyticContext?.entities?.lines?.[0]?.point, [1, 2, -1]);
  assert.deepEqual(plan.analyticContext?.entities?.lines?.[0]?.direction, [2, -1, 3]);
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
  const lineOne = plan.objectSuggestions.find((item) => item.id === "line-one")?.object;
  const lineOneLength = Math.hypot(
    lineOne.params.end[0] - lineOne.params.start[0],
    lineOne.params.end[1] - lineOne.params.start[1],
    lineOne.params.end[2] - lineOne.params.start[2],
  );
  assert.ok(lineOneLength > 12.9);
});

test("buildAnalyticPlan accepts worksheet-style skew-lines prompts with unicode subscripts", () => {
  const plan = buildAnalyticPlan(skewLinesUnicodePrompt, {
    cleanedQuestion: skewLinesUnicodePrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.analyticContext?.subtype, "skew_lines_distance");
  assert.equal(plan.sceneMoments[0].visibleObjectIds.length, 2);
});

test("buildAnalyticPlan creates a guided lesson for a parametric linear system", () => {
  const plan = buildAnalyticPlan(linearSystemPrompt, {
    cleanedQuestion: linearSystemPrompt,
    inputMode: "text",
  });

  assert.ok(plan);
  assert.equal(plan.experienceMode, "analytic_auto");
  assert.equal(plan.problem.questionType, "system of linear equations");
  assert.equal(plan.analyticContext?.subtype, "system_of_linear_equations");
  assert.equal(plan.analyticContext?.derivedValues?.infiniteSolutions, "-4");
  assert.equal(plan.analyticContext?.derivedValues?.noSolutionCondition, "k != -4");
  assert.match(plan.answerScaffold.finalAnswer || "", /k = -4/i);
  assert.ok(plan.sceneMoments.some((moment) => moment.visibleOverlayIds.some((id) => id.includes("linear-system-answer"))));
  assert.ok(plan.objectSuggestions.some((item) => item.id === "analysis-board"));
});
