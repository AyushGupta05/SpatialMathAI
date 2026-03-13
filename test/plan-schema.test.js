import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";

test("normalizeScenePlan preserves lesson metadata and fills defaults", () => {
  const plan = normalizeScenePlan({
    problem: {
      question: "Find the volume of a cylinder with radius 3 and height 7.",
      questionType: "volume",
    },
    sourceSummary: {
      inputMode: "multimodal",
      rawQuestion: "Volume of cylinder",
      cleanedQuestion: "Find the volume of a cylinder with radius 3 and height 7.",
      givens: ["radius = 3", "height = 7"],
      labels: ["r", "h"],
      relationships: ["radius and height belong to the same cylinder"],
      diagramSummary: "A labelled cylinder diagram.",
    },
    sceneFocus: {
      concept: "radius vs height",
      primaryInsight: "Radius and height play different roles in the volume formula.",
      focusPrompt: "Focus on which measurement is radial and which is vertical.",
    },
    learningMoments: {
      predict: {
        prompt: "Which visible value is the radius?",
      },
    },
    objectSuggestions: [{
      id: "primary-object",
      title: "Cylinder model",
      roles: ["primary", "cylinder"],
      object: {
        id: "primary-object",
        shape: "cylinder",
        params: { radius: 3, height: 7 },
        metadata: { role: "primary" },
      },
    }],
    buildSteps: [{
      id: "step-main",
      title: "Place the cylinder",
      instruction: "Place the main cylinder.",
      action: "add",
      suggestedObjectIds: ["primary-object"],
      requiredObjectIds: ["primary-object"],
    }],
  });

  assert.equal(plan.sourceSummary.inputMode, "multimodal");
  assert.deepEqual(plan.sourceSummary.givens, ["radius = 3", "height = 7"]);
  assert.equal(plan.sceneFocus.concept, "radius vs height");
  assert.equal(plan.objectSuggestions[0].roles[0], "primary");
  assert.deepEqual(plan.objectSuggestions[0].object.metadata.roles, ["primary", "cylinder"]);
  assert.equal(plan.learningMoments.predict.prompt, "Which visible value is the radius?");
  assert.equal(plan.learningMoments.reflect.title, "Reflect");
  assert.ok(plan.learningMoments.challenge.whyItMatters.length > 0);
});
