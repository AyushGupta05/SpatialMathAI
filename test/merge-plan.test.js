import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { mergeGeneratedPlan } from "../server/services/plan/mergePlan.js";

function baselineCuboidPlan() {
  return normalizeScenePlan({
    problem: {
      question: "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?",
      questionType: "surface_area",
      mode: "guided",
    },
    sourceSummary: {
      inputMode: "multimodal",
      rawQuestion: "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?",
      cleanedQuestion: "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?",
      givens: ["length 6cm", "width 4cm", "height 3cm"],
      labels: [],
      relationships: [],
      diagramSummary: "A labeled cuboid worksheet diagram.",
    },
    objectSuggestions: [{
      id: "primary-cuboid",
      title: "Cuboid model",
      object: {
        id: "cuboid-main",
        shape: "cuboid",
        label: "Cuboid",
        params: { width: 4, height: 3, depth: 6 },
      },
    }],
    buildSteps: [{
      id: "place-cuboid",
      title: "Place the cuboid",
      instruction: "Look at the cuboid and its dimensions.",
      action: "observe",
      suggestedObjectIds: ["primary-cuboid"],
      requiredObjectIds: ["primary-cuboid"],
    }],
    answerScaffold: {
      formula: "SA = 2(lw + lh + wh)",
    },
  });
}

function noisyNovaCuboidPlan() {
  return normalizeScenePlan({
    problem: {
      question: "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?",
      questionType: "surface_area",
      mode: "guided",
    },
    sourceSummary: {
      inputMode: "multimodal",
      rawQuestion: "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?",
      cleanedQuestion: "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?",
      givens: ["length 6cm", "width 4cm", "height 3cm"],
      labels: ["Top Face"],
      relationships: [],
      diagramSummary: "A labeled cuboid worksheet diagram.",
    },
    objectSuggestions: [
      {
        id: "primary-cuboid",
        title: "Cuboid model",
        object: {
          id: "cuboid-main",
          shape: "cuboid",
          label: "Cuboid",
          params: { width: 4, height: 3, depth: 6 },
        },
      },
      {
        id: "top-face",
        title: "Top Face",
        object: {
          id: "top-face-object",
          shape: "plane",
          label: "Top Face",
          params: { width: 4, depth: 6 },
          position: [0, 3, 0],
        },
      },
      {
        id: "front-face",
        title: "Front Face",
        object: {
          id: "front-face-object",
          shape: "plane",
          label: "Front Face",
          params: { width: 4, depth: 3 },
          position: [0, 1.5, 3],
        },
      },
    ],
    buildSteps: [{
      id: "inspect-faces",
      title: "Inspect the faces",
      instruction: "Compare the top face and the front face.",
      action: "observe",
      suggestedObjectIds: ["primary-cuboid", "top-face", "front-face"],
      requiredObjectIds: ["primary-cuboid", "top-face", "front-face"],
    }],
    answerScaffold: {
      formula: "SA = 2(lw + lh + wh)",
    },
  });
}

test("mergeGeneratedPlan prefers the cleaner baseline scaffold for multimodal solid metric lessons", () => {
  const baselinePlan = baselineCuboidPlan();
  const novaPlan = noisyNovaCuboidPlan();
  const merged = mergeGeneratedPlan({
    baselinePlan,
    novaPlan,
    workingQuestion: baselinePlan.problem.question,
    mode: "guided",
  });

  assert.deepEqual(
    merged.objectSuggestions.map((suggestion) => suggestion.id),
    baselinePlan.objectSuggestions.map((suggestion) => suggestion.id),
  );
  assert.equal(merged.objectSuggestions.some((suggestion) => suggestion.object.shape === "plane"), false);
  assert.deepEqual(
    merged.buildSteps.map((step) => step.id),
    baselinePlan.buildSteps.map((step) => step.id),
  );
});
