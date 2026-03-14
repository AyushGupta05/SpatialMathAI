import test from "node:test";
import assert from "node:assert/strict";

import { buildTutorResponseMeta } from "../server/services/tutorMetadata.js";

function surfaceAreaPlan() {
  return {
    problem: {
      question: "Find the surface area of a cylinder with radius 3 and height 7.",
      questionType: "surface_area",
    },
    objectSuggestions: [{
      id: "primary-cylinder",
      title: "Cylinder model",
      object: {
        id: "cylinder-main",
        shape: "cylinder",
        params: { radius: 3, height: 7 },
      },
    }],
    buildSteps: [{
      id: "step-main",
      title: "Place the cylinder",
      instruction: "Place the cylinder.",
      suggestedObjectIds: ["primary-cylinder"],
      requiredObjectIds: ["primary-cylinder"],
    }],
    lessonStages: [{
      id: "step-main",
      title: "Place the cylinder",
      checkpointPrompt: "Does this look correct?",
    }],
  };
}

test("buildTutorResponseMeta keeps supported surface-area lessons in split 2D mode", () => {
  const meta = buildTutorResponseMeta({
    plan: surfaceAreaPlan(),
    learningState: { currentStep: 0, learningStage: "build" },
    assessment: {
      guidance: {
        nextRequiredSuggestionIds: ["primary-cylinder"],
      },
    },
  });

  assert.equal(meta.sceneDirective.representationMode, "split_2d");
  assert.equal(meta.sceneDirective.companionObjectId, "cylinder-main");
});

test("buildTutorResponseMeta can switch a supported lesson into full 2D mode for net requests", () => {
  const meta = buildTutorResponseMeta({
    plan: surfaceAreaPlan(),
    learningState: { currentStep: 0, learningStage: "build" },
    assessment: {
      guidance: {
        nextRequiredSuggestionIds: ["primary-cylinder"],
      },
    },
    userMessage: "Show me the net in 2D.",
  });

  assert.equal(meta.sceneDirective.representationMode, "2d");
  assert.equal(meta.sceneDirective.companionObjectId, "cylinder-main");
  assert.match(meta.sceneDirective.companionReason, /flat view/i);
});
