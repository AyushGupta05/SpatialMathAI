import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { evaluateBuild } from "../server/services/buildEvaluator.js";

const basePlan = normalizeScenePlan({
  problem: {
    question: "Find the volume of a cylinder with radius 3 and height 7.",
    questionType: "volume",
  },
  objectSuggestions: [
    {
      id: "primary-object",
      title: "Cylinder model",
      optional: false,
      roles: ["primary"],
      object: {
        id: "primary-object",
        label: "Cylinder",
        shape: "cylinder",
        params: { radius: 3, height: 7 },
        metadata: { role: "primary", roles: ["primary"] },
      },
    },
    {
      id: "radius-helper",
      title: "Radius marker",
      optional: false,
      roles: ["radius", "measurement"],
      object: {
        id: "radius-line",
        label: "Radius",
        shape: "line",
        params: {
          start: [0, 3.5, 0],
          end: [3, 3.5, 0],
          thickness: 0.08,
        },
        metadata: { role: "radius", roles: ["radius", "measurement"] },
      },
    },
  ],
  buildSteps: [{
    id: "step-build",
    title: "Build the cylinder",
    instruction: "Place the cylinder and its radius helper.",
    action: "add",
    suggestedObjectIds: ["primary-object", "radius-helper"],
    requiredObjectIds: ["primary-object", "radius-helper"],
  }],
});

test("evaluateBuild returns actionable guidance while the build is incomplete", () => {
  const assessment = evaluateBuild(basePlan, {
    objects: [],
    selectedObjectId: null,
  });

  assert.equal(assessment.guidance.readyForPrediction, false);
  assert.deepEqual(assessment.guidance.nextRequiredSuggestionIds, ["primary-object", "radius-helper"]);
  assert.match(assessment.guidance.coachFeedback, /scene should already/i);
});

test("evaluateBuild marks the lesson ready for prediction when required objects are present", () => {
  const assessment = evaluateBuild(basePlan, {
    objects: [
      basePlan.objectSuggestions[0].object,
      {
        ...basePlan.objectSuggestions[1].object,
        id: "radius-line-live",
        metadata: {
          ...basePlan.objectSuggestions[1].object.metadata,
          sourceSuggestionId: "radius-helper",
        },
      },
    ],
    selectedObjectId: "primary-object",
  });

  assert.equal(assessment.guidance.readyForPrediction, true);
  assert.deepEqual(assessment.guidance.nextRequiredSuggestionIds, []);
  assert.equal(assessment.answerGate.allowed, true);
  assert.match(assessment.guidance.coachFeedback, /scene is ready/i);
});

test("evaluateBuild keeps analytic_auto guidance aligned with the current staged moment", () => {
  const analyticPlan = normalizeScenePlan({
    problem: {
      question: "Find the angle between AB and AC.",
      questionType: "spatial",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    objectSuggestions: [
      {
        id: "point-a",
        title: "Point A",
        object: {
          id: "point-a-object",
          shape: "pointMarker",
          label: "A",
          position: [1, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "point-b",
        title: "Point B",
        object: {
          id: "point-b-object",
          shape: "pointMarker",
          label: "B",
          position: [5, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "point-c",
        title: "Point C",
        object: {
          id: "point-c-object",
          shape: "pointMarker",
          label: "C",
          position: [1, 4, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "vector-ab",
        title: "Vector AB",
        object: {
          id: "vector-ab-object",
          shape: "line",
          label: "AB",
          params: { start: [1, 1, 0], end: [5, 1, 0], thickness: 0.06 },
        },
      },
      {
        id: "vector-ac",
        title: "Vector AC",
        object: {
          id: "vector-ac-object",
          shape: "line",
          label: "AC",
          params: { start: [1, 1, 0], end: [1, 4, 0], thickness: 0.06 },
        },
      },
    ],
    buildSteps: [
      {
        id: "plot-points",
        title: "Plot the points",
        instruction: "Read the plotted points.",
        action: "observe",
        suggestedObjectIds: ["point-a", "point-b", "point-c"],
        requiredObjectIds: [],
      },
      {
        id: "show-ab",
        title: "Show AB",
        instruction: "Reveal AB.",
        action: "observe",
        suggestedObjectIds: ["point-a", "point-b", "point-c", "vector-ab"],
        requiredObjectIds: [],
      },
      {
        id: "show-ac",
        title: "Show AC",
        instruction: "Reveal AC.",
        action: "observe",
        suggestedObjectIds: ["point-a", "point-b", "point-c", "vector-ab", "vector-ac"],
        requiredObjectIds: [],
      },
    ],
    sceneMoments: [
      {
        id: "plot-points",
        title: "Plot the points",
        prompt: "Points A, B, and C are shown on the grid.",
        goal: "Read the coordinates.",
        focusTargets: ["point-a-object", "point-b-object", "point-c-object"],
        visibleObjectIds: ["point-a", "point-b", "point-c"],
        visibleOverlayIds: ["analytic-axes"],
        cameraBookmarkId: "overview",
        revealFormula: false,
        revealFullSolution: false,
      },
      {
        id: "show-ab",
        title: "Show AB",
        prompt: "Vector AB is now shown from A.",
        goal: "Use AB.",
        focusTargets: ["vector-ab-object"],
        visibleObjectIds: ["point-a", "point-b", "point-c", "vector-ab"],
        visibleOverlayIds: ["analytic-axes"],
        cameraBookmarkId: "overview",
        revealFormula: false,
        revealFullSolution: false,
      },
      {
        id: "show-ac",
        title: "Show AC",
        prompt: "Vectors AB and AC are now shown from A.",
        goal: "Use AC.",
        focusTargets: ["vector-ac-object"],
        visibleObjectIds: ["point-a", "point-b", "point-c", "vector-ab", "vector-ac"],
        visibleOverlayIds: ["analytic-axes"],
        cameraBookmarkId: "overview",
        revealFormula: true,
        revealFullSolution: false,
      },
    ],
  });

  const assessment = evaluateBuild(analyticPlan, {
    objects: [
      analyticPlan.objectSuggestions[0].object,
      analyticPlan.objectSuggestions[1].object,
      analyticPlan.objectSuggestions[2].object,
    ],
    selectedObjectId: null,
  }, "plot-points");

  assert.equal(assessment.guidance.currentStepId, "plot-points");
  assert.equal(assessment.guidance.readyForPrediction, false);
  assert.deepEqual(assessment.guidance.matchedSuggestionIds, ["point-a", "point-b", "point-c"]);
  assert.equal(assessment.stepAssessments[0].complete, true);
  assert.equal(assessment.stepAssessments[1].complete, false);
  assert.match(assessment.stepAssessments[1].feedback, /later analytic stage/i);
  assert.match(assessment.guidance.coachFeedback, /Points A, B, and C are shown/i);
});
