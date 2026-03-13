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
  assert.match(assessment.guidance.coachFeedback, /Start by placing/i);
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
