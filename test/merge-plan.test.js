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

test("mergeGeneratedPlan keeps the baseline scaffold for text-only solid metric lessons", () => {
  const baselinePlan = baselineCuboidPlan();
  const novaPlan = noisyNovaCuboidPlan();
  baselinePlan.sourceSummary.inputMode = "text";
  novaPlan.sourceSummary.inputMode = "text";

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
});

test("mergeGeneratedPlan keeps an analytic baseline scaffold intact", () => {
  const baselinePlan = normalizeScenePlan({
    problem: {
      question: "Find the angle between AB and AC.",
      questionType: "spatial",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    sourceSummary: {
      inputMode: "text",
      rawQuestion: "Find the angle between AB and AC.",
      cleanedQuestion: "Find the angle between AB and AC.",
      givens: ["A(0,0,0)", "B(3,-3,4)", "C(-1,3,3)"],
      labels: [],
      relationships: [],
      diagramSummary: "",
    },
    objectSuggestions: [{
      id: "point-a",
      title: "Point A",
      object: {
        id: "point-a-object",
        shape: "pointMarker",
        label: "A",
        position: [0, 0, 0],
        params: { radius: 0.1 },
      },
    }],
    buildSteps: [{
      id: "plot-points",
      title: "Plot the points",
      instruction: "Read the plotted givens.",
      action: "observe",
      suggestedObjectIds: ["point-a"],
      requiredObjectIds: [],
    }],
    lessonStages: [{
      id: "plot-points",
      title: "Plot the points",
      goal: "Read the plotted givens.",
      tutorIntro: "The givens are shown.",
      highlightTargets: ["point-a-object"],
    }],
    sceneMoments: [{
      id: "plot-points",
      title: "Plot the points",
      prompt: "The givens are shown.",
      goal: "Read the plotted givens.",
      focusTargets: ["point-a-object"],
      visibleObjectIds: ["point-a"],
      visibleOverlayIds: ["analytic-axes"],
      cameraBookmarkId: "overview",
      revealFormula: false,
      revealFullSolution: false,
    }],
    cameraBookmarks: [{
      id: "overview",
      label: "Overview",
      position: [8, 6, 8],
      target: [0, 0, 0],
    }],
    sceneOverlays: [{
      id: "analytic-axes",
      type: "coordinate-frame",
      bounds: { x: [-4, 4], y: [-4, 4], z: [-4, 4], tickStep: 1 },
    }],
    answerScaffold: {
      formula: "cos(theta) = (AB dot AC) / (|AB||AC|)",
    },
    analyticContext: {
      subtype: "vector_angle",
      formulaCard: {
        title: "Angle Between Vectors",
        formula: "cos(theta) = (AB dot AC) / (|AB||AC|)",
        explanation: "Compare the two vectors from the same anchor.",
      },
      solutionSteps: [{
        id: "stage-1",
        title: "Read the givens",
        formula: "",
        explanation: "Start with the plotted points.",
      }],
    },
  });

  const novaPlan = normalizeScenePlan({
    problem: {
      question: "ignored",
      questionType: "spatial",
      mode: "guided",
    },
    sourceSummary: {
      inputMode: "multimodal",
      rawQuestion: "ignored",
      cleanedQuestion: "ignored",
      givens: ["diagram labels"],
      labels: ["AB", "AC"],
      relationships: ["Angle at A"],
      diagramSummary: "A worksheet image with labelled vectors.",
    },
    objectSuggestions: [
      {
        id: "nova-a",
        title: "Point A",
        object: {
          id: "nova-a-object",
          shape: "pointMarker",
          label: "A",
          position: [1, 1, 0],
          params: { radius: 0.1 },
        },
      },
      {
        id: "nova-b",
        title: "Point B",
        object: {
          id: "nova-b-object",
          shape: "pointMarker",
          label: "B",
          position: [5, 1, 0],
          params: { radius: 0.1 },
        },
      },
    ],
    buildSteps: [
      {
        id: "nova-stage-1",
        title: "Nova stage 1",
        instruction: "Different scaffold stage.",
        action: "observe",
        suggestedObjectIds: ["nova-a"],
        requiredObjectIds: [],
      },
      {
        id: "nova-stage-2",
        title: "Nova stage 2",
        instruction: "Another stage.",
        action: "observe",
        suggestedObjectIds: ["nova-a", "nova-b"],
        requiredObjectIds: [],
      },
    ],
    lessonStages: [
      {
        id: "nova-stage-1",
        title: "Nova stage 1",
        goal: "Different stage goal.",
        tutorIntro: "Nova intro.",
        highlightTargets: ["nova-a-object"],
      },
      {
        id: "nova-stage-2",
        title: "Nova stage 2",
        goal: "Another stage goal.",
        tutorIntro: "Nova follow-up.",
        highlightTargets: ["nova-b-object"],
      },
    ],
  });

  const merged = mergeGeneratedPlan({
    baselinePlan,
    novaPlan,
    workingQuestion: baselinePlan.problem.question,
    mode: "guided",
  });

  assert.equal(merged.experienceMode, "analytic_auto");
  assert.deepEqual(
    merged.objectSuggestions.map((suggestion) => suggestion.id),
    baselinePlan.objectSuggestions.map((suggestion) => suggestion.id),
  );
  assert.deepEqual(
    merged.buildSteps.map((step) => step.id),
    baselinePlan.buildSteps.map((step) => step.id),
  );
  assert.deepEqual(
    merged.lessonStages.map((stage) => stage.id),
    baselinePlan.lessonStages.map((stage) => stage.id),
  );
  assert.deepEqual(
    merged.sceneMoments.map((moment) => moment.id),
    baselinePlan.sceneMoments.map((moment) => moment.id),
  );
  assert.equal(merged.sourceSummary.inputMode, "multimodal");
});
