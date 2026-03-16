import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScenePlan } from "../src/ai/planSchema.js";
import { createTutorRoute } from "../server/routes/tutor.js";

function buildPlan() {
  return normalizeScenePlan({
    problem: {
      question: "Find the volume of a cylinder with radius 3 and height 7.",
      questionType: "volume",
      mode: "guided",
    },
    sourceEvidence: {
      inputMode: "multimodal",
      givens: ["radius = 3", "height = 7"],
      diagramSummary: "A labeled cylinder worksheet diagram.",
      conflicts: [],
    },
    objectSuggestions: [{
      id: "primary-object",
      title: "Cylinder",
      object: {
        id: "primary-cylinder",
        shape: "cylinder",
        label: "Cylinder",
        params: { radius: 3, height: 7 },
      },
    }],
    buildSteps: [{
      id: "step-1",
      title: "Place the cylinder",
      instruction: "Place the main cylinder.",
      action: "add",
      suggestedObjectIds: ["primary-object"],
      requiredObjectIds: ["primary-object"],
    }],
    answerScaffold: {
      finalAnswer: "21",
    },
  });
}

function buildAnalyticPlan({ revealFormula = false, revealFullSolution = false } = {}) {
  return normalizeScenePlan({
    problem: {
      question: "Line-plane intersection",
      questionType: "spatial",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    sourceEvidence: {
      inputMode: "text",
      givens: ["P(1,-2,3)", "d=(2,1,-1)", "2x-y+z=7"],
      diagramSummary: "",
      conflicts: [],
    },
    answerScaffold: {
      formula: "n · (p + td) = c",
      finalAnswer: "(1, -2, 3)",
      unit: "",
    },
    analyticContext: {
      subtype: "line_plane_intersection",
      formulaCard: {
        title: "Line-Plane Intersection",
        formula: "n · (p + td) = c",
        explanation: "Substitute the line into the plane.",
      },
      solutionSteps: [{
        id: "step-1",
        title: "Write the line equation",
        formula: "r = p + td",
        explanation: "Start with the line equation.",
      }],
    },
    objectSuggestions: [{
      id: "line-main",
      title: "Line",
      object: {
        id: "line-main",
        shape: "line",
        label: "Line",
        params: { start: [0, 0, 0], end: [1, 1, 1], thickness: 0.08 },
      },
    }],
    buildSteps: [{
      id: "observe",
      title: "Observe",
      instruction: "Rotate the scene.",
      action: "observe",
      suggestedObjectIds: ["line-main"],
      requiredObjectIds: [],
    }],
    lessonStages: [{
      id: "observe",
      title: "Observe",
      goal: "Spot the line and plane.",
      tutorIntro: "Rotate the scene.",
      highlightTargets: ["line-main"],
      suggestedActions: [{
        id: "observe-formula",
        label: "Show Formula",
        kind: "show-formula",
      }],
    }],
    cameraBookmarks: [{
      id: "overview",
      label: "Overview",
      position: [8, 6, 8],
      target: [0, 0, 0],
    }],
    sceneMoments: [{
      id: "observe",
      title: "Observe",
      prompt: "Rotate the scene.",
      goal: "Spot the line and plane.",
      focusTargets: ["line-main"],
      visibleObjectIds: ["line-main"],
      visibleOverlayIds: ["analytic-axes"],
      cameraBookmarkId: "overview",
      revealFormula,
      revealFullSolution,
    }],
    sceneOverlays: [{
      id: "analytic-axes",
      type: "coordinate-frame",
      bounds: { x: [-4, 4], y: [-4, 4], z: [-4, 4], tickStep: 1 },
    }],
  });
}

function buildAnalyticProgressPlan() {
  return normalizeScenePlan({
    problem: {
      question: "Find the angle between AB and AC.",
      questionType: "spatial",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    answerScaffold: {
      formula: "cos(theta) = (AB · AC) / (|AB||AC|)",
    },
    analyticContext: {
      subtype: "vector_angle",
      formulaCard: {
        title: "Angle Between Vectors",
        formula: "cos(theta) = (AB · AC) / (|AB||AC|)",
        explanation: "Compare the two vectors from the same anchor.",
      },
      solutionSteps: [{
        id: "solve",
        title: "Use the dot product",
        formula: "cos(theta) = (AB · AC) / (|AB||AC|)",
        explanation: "Use the visible vectors.",
      }],
    },
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
        highlightObjectIds: ["vector-ab-object"],
      },
      {
        id: "show-ac",
        title: "Show AC",
        instruction: "Reveal AC.",
        action: "observe",
        suggestedObjectIds: ["point-a", "point-b", "point-c", "vector-ab", "vector-ac"],
        requiredObjectIds: [],
        highlightObjectIds: ["vector-ac-object"],
      },
    ],
    lessonStages: [
      {
        id: "plot-points",
        title: "Plot the points",
        goal: "Read the coordinates.",
        tutorIntro: "Start with the points.",
        highlightTargets: ["point-a-object", "point-b-object", "point-c-object"],
      },
      {
        id: "show-ab",
        title: "Show AB",
        goal: "Use AB.",
        tutorIntro: "AB is now shown.",
        highlightTargets: ["vector-ab-object"],
      },
      {
        id: "show-ac",
        title: "Show AC",
        goal: "Use AC.",
        tutorIntro: "AC is now shown.",
        highlightTargets: ["vector-ac-object"],
      },
    ],
    cameraBookmarks: [{
      id: "overview",
      label: "Overview",
      position: [8, 6, 8],
      target: [0, 0, 0],
    }],
    sceneMoments: [
      {
        id: "plot-points",
        title: "Plot the points",
        prompt: "The points are shown on the grid.",
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
        prompt: "AB is now shown.",
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
        prompt: "AC is now shown.",
        goal: "Use AC.",
        focusTargets: ["vector-ac-object"],
        visibleObjectIds: ["point-a", "point-b", "point-c", "vector-ab", "vector-ac"],
        visibleOverlayIds: ["analytic-axes"],
        cameraBookmarkId: "overview",
        revealFormula: true,
        revealFullSolution: false,
      },
    ],
    sceneOverlays: [{
      id: "analytic-axes",
      type: "coordinate-frame",
      bounds: { x: [-4, 6], y: [-4, 6], z: [-4, 4], tickStep: 1 },
    }],
  });
}

function parseSsePayloads(bodyText) {
  return bodyText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

function createTestTutorRoute(overrides = {}) {
  return createTutorRoute({
    progressionEvaluator: async () => ({
      shouldProgress: false,
      layer1Matched: false,
      layer2Decision: "NO",
      reason: "test default",
    }),
    ...overrides,
  });
}

test("POST /api/tutor streams lesson metadata before tutor text", async () => {
  const plan = buildPlan();
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Let's ";
      yield "start.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "orient", history: [] },
      userMessage: "Help me start",
      contextStepId: "step-1",
    }),
  });

  assert.equal(response.status, 200);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  const text = payloads.filter((entry) => entry.type === "text").map((entry) => entry.content).join("");
  const assessment = payloads.find((entry) => entry.type === "assessment")?.content;

  assert.ok(meta);
  assert.equal(meta.stageStatus.currentStageId, "step-1");
  assert.equal(meta.stageStatus.canAdvance, false);
  assert.equal(meta.actions[0].id, "show_hint");
  assert.equal(meta.actions[0].label, "What should I notice?");
  assert.deepEqual(meta.focusTargets, ["primary-cylinder"]);
  assert.match(meta.systemContextMessage, /Givens: radius = 3, height = 7\./);
  assert.equal(text, "Let's start.");
  assert.ok(assessment.summary);
});

test("POST /api/tutor includes deterministic completion metadata for correct answers", async () => {
  const plan = buildPlan();
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Correct.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "orient", history: [] },
      userMessage: "21",
      contextStepId: "step-1",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;

  assert.deepEqual(meta?.completionState, { complete: true, reason: "correct-answer" });
  assert.equal(meta?.checkpoint, null);
  assert.equal(meta?.stageStatus?.canAdvance, false);
});

test("POST /api/tutor keeps analytic opening actions hint-first before formula reveal", async () => {
  const plan = buildAnalyticPlan();
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Rotate ";
      yield "the scene.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "What should I notice first?",
      contextStepId: "observe",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;

  assert.ok(meta?.sceneDirective);
  assert.equal(meta.sceneDirective.stageId, "observe");
  assert.equal(meta.sceneDirective.cameraBookmarkId, "overview");
  assert.deepEqual(meta.sceneDirective.visibleOverlayIds, ["analytic-axes"]);
  assert.equal(meta?.checkpoint, null);
  assert.deepEqual(meta.actions.map((action) => action.label), ["What should I notice?", "How do I start?"]);
});

test("POST /api/tutor unlocks analytic formula actions when the current moment reveals them", async () => {
  const plan = buildAnalyticPlan({ revealFormula: true });
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Rotate ";
      yield "the scene.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "Show me the setup",
      contextStepId: "observe",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;

  assert.deepEqual(meta.actions.map((action) => action.label), ["Give me a hint", "Show formula"]);
});

test("POST /api/tutor advances analytic scene directives to the next moment after a correct answer", async () => {
  const plan = buildAnalyticProgressPlan();
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "You found AB.";
    },
    conceptEvaluator: async () => ({
      verdict: "CORRECT",
      confidence: 0.98,
      what_was_right: "Computed AB correctly",
      gap: null,
      misconception_type: null,
      scene_cue: null,
      tutor_tone: "encouraging",
    }),
    progressionEvaluator: async () => ({
      shouldProgress: true,
      layer1Matched: true,
      layer2Decision: "YES",
      reason: "learner is ready",
    }),
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "AB = (4, 0, 0)",
      contextStepId: "plot-points",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.filter((entry) => entry.type === "meta").at(-1)?.content;
  const assessment = payloads.find((entry) => entry.type === "assessment")?.content;

  assert.equal(meta?.stageStatus?.currentStageId, "show-ab");
  assert.equal(meta?.sceneDirective?.stageId, "show-ab");
  assert.deepEqual(meta?.sceneDirective?.visibleObjectIds, ["point-a", "point-b", "point-c", "vector-ab"]);
  assert.deepEqual(meta?.focusTargets, ["vector-ab-object"]);
  assert.equal(assessment?.nextStage?.id, "show-ab");
  assert.equal(assessment?.nextLearningStage, "build");
});

test("POST /api/tutor evaluates short analytic vector replies instead of treating them as trivial", async () => {
  const plan = buildAnalyticProgressPlan();
  let conceptEvalCalled = false;
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Now ";
      yield "look at AB.";
    },
    conceptEvaluator: async () => {
      conceptEvalCalled = true;
      return {
        verdict: "CORRECT",
        confidence: 0.96,
        what_was_right: "Identified the vectors from the plotted points",
        gap: null,
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      };
    },
    progressionEvaluator: async () => ({
      shouldProgress: true,
      layer1Matched: true,
      layer2Decision: "YES",
      reason: "learner is ready",
    }),
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: {
        objects: [
          plan.objectSuggestions[0].object,
          plan.objectSuggestions[1].object,
          plan.objectSuggestions[2].object,
        ],
        selectedObjectId: null,
      },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "I get AB and AC",
      contextStepId: "plot-points",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.filter((entry) => entry.type === "meta").at(-1)?.content;

  assert.equal(conceptEvalCalled, true);
  assert.equal(meta?.stageStatus?.currentStageId, "show-ab");
  assert.equal(meta?.sceneDirective?.stageId, "show-ab");
  assert.deepEqual(meta?.sceneDirective?.visibleObjectIds, ["point-a", "point-b", "point-c", "vector-ab"]);
});

test("POST /api/tutor keeps the current stage when progression gate returns NO", async () => {
  const plan = buildAnalyticProgressPlan();
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Great work on AB.";
    },
    conceptEvaluator: async () => ({
      verdict: "CORRECT",
      confidence: 0.98,
      what_was_right: "Computed AB correctly",
      gap: null,
      misconception_type: null,
      scene_cue: null,
      tutor_tone: "encouraging",
    }),
    progressionEvaluator: async () => ({
      shouldProgress: false,
      layer1Matched: true,
      layer2Decision: "NO",
      reason: "Still needs one more check.",
    }),
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "AB = (4, 0, 0)",
      contextStepId: "plot-points",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.filter((entry) => entry.type === "meta").at(-1)?.content;
  const assessment = payloads.find((entry) => entry.type === "assessment")?.content;

  assert.equal(meta?.stageStatus?.currentStageId, "plot-points");
  assert.equal(meta?.stageProgress?.shouldProgress, false);
  assert.equal(assessment?.nextStage?.id, "plot-points");
  assert.equal(assessment?.stageProgress?.layer2Decision, "NO");
});

test("POST /api/tutor exposes the solution action on analytic final reveal stages", async () => {
  const plan = buildAnalyticPlan({ revealFormula: true, revealFullSolution: true });
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Rotate ";
      yield "the scene.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "What does this tell me?",
      contextStepId: "observe",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;

  assert.deepEqual(meta.actions.map((action) => action.label), ["Show formula", "Show solution"]);
});

test("POST /api/tutor escalates stuck analytic learners to the solution action only", async () => {
  const plan = buildAnalyticPlan({ revealFormula: true, revealFullSolution: true });
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Let's look again.";
    },
    conceptEvaluator: async () => ({
      verdict: "STUCK",
      confidence: 0.4,
      what_was_right: "",
      gap: "Missed the visible intersection",
      misconception_type: null,
      scene_cue: null,
      tutor_tone: "encouraging",
    }),
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: {
        currentStep: 0,
        learningStage: "check",
        history: [],
        hint_state: {
          current_stage_hints: 2,
          max_hints: 3,
          escalate_next: false,
          total_stuck_count: 2,
        },
      },
      userMessage: "I still don't get it",
      contextStepId: "observe",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;

  assert.deepEqual(meta.actions.map((action) => action.id), ["view_solution"]);
  assert.equal(meta.actions[0].label, "Show solution");
});

test("POST /api/tutor reveals the worked solution deterministically when asked directly", async () => {
  const plan = buildAnalyticPlan();
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "This should not run.";
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "build", history: [] },
      userMessage: "show me the final answer",
      contextStepId: "observe",
    }),
  });

  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  const text = payloads.filter((entry) => entry.type === "text").map((entry) => entry.content).join("");

  assert.deepEqual(meta?.completionState, { complete: true, reason: "revealed-solution" });
  assert.equal(meta?.sceneDirective?.revealFullSolution, true);
  assert.equal(meta?.sceneDirective?.revealFormula, true);
  assert.equal(meta?.solutionReveal?.isSolutionReveal, true);
  assert.ok(Array.isArray(meta?.solutionReveal?.sections));
  assert.match(text, /Final answer/i);
  assert.match(text, /\(1, -2, 3\)/);
});

test("POST /api/tutor runs concept evaluation for non-trivial stages", async () => {
  const plan = buildPlan();
  let conceptEvalCalled = false;
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Good insight.";
    },
    conceptEvaluator: async () => {
      conceptEvalCalled = true;
      return {
        verdict: "PARTIAL",
        confidence: 0.75,
        what_was_right: "Identified the faces",
        gap: "Missed pairing",
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      };
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "check", history: [] },
      userMessage: "I think the surface area involves all the faces somehow",
      contextStepId: "step-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(conceptEvalCalled, true);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  assert.equal(meta?.conceptVerdict?.verdict, "PARTIAL");
  assert.equal(meta?.completionState?.complete, false);
});

test("POST /api/tutor skips concept evaluation for trivial orient stage", async () => {
  const plan = buildPlan();
  let conceptEvalCalled = false;
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Welcome.";
    },
    conceptEvaluator: async () => {
      conceptEvalCalled = true;
      return { verdict: "CORRECT", confidence: 1.0, what_was_right: "", gap: null, scene_cue: null, tutor_tone: "encouraging" };
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "orient", history: [] },
      userMessage: "ok",
      contextStepId: "step-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(conceptEvalCalled, false);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  assert.equal(meta?.conceptVerdict, null);
});

test("POST /api/tutor bypasses concept evaluation when numeric answer matches", async () => {
  const plan = buildPlan();
  let conceptEvalCalled = false;
  const tutorRoute = createTestTutorRoute({
    streamModel: async function* streamTutor() {
      yield "Correct!";
    },
    conceptEvaluator: async () => {
      conceptEvalCalled = true;
      return { verdict: "PARTIAL", confidence: 0.5, what_was_right: "", gap: null, scene_cue: null, tutor_tone: "encouraging" };
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { currentStep: 0, learningStage: "check", history: [] },
      userMessage: "21",
      contextStepId: "step-1",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(conceptEvalCalled, false);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  assert.equal(meta?.conceptVerdict?.verdict, "CORRECT");
  assert.equal(meta?.completionState?.complete, true);
});

test("POST /api/tutor supports freeform scene chat without a lesson plan", async () => {
  const tutorRoute = createTestTutorRoute();

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { history: [] },
      userMessage: "Show me something cool",
    }),
  });

  assert.equal(response.status, 200);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  const text = payloads.filter((entry) => entry.type === "text").map((entry) => entry.content).join("");

  assert.equal(meta.mode, "freeform");
  assert.ok(meta.actions.some((action) => action.kind === "freeform-prompt"));
  assert.ok(meta.sceneCommand);
  assert.equal(meta.sceneCommand.operations[0].kind, "replace_scene");
  assert.ok(meta.sceneCommand.operations[0].objects.length > 0);
  assert.equal(payloads.some((entry) => entry.type === "assessment"), false);
  assert.match(text, /scene|line|point|angle|connector/i);
});

test("POST /api/tutor freeform requests fall back safely when the freeform generator throws", async () => {
  const tutorRoute = createTestTutorRoute({
    freeformTurnGenerator: async () => {
      throw new Error("boom");
    },
  });

  const response = await tutorRoute.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sceneSnapshot: { objects: [], selectedObjectId: null },
      learningState: { history: [] },
      userMessage: "What can you do?",
    }),
  });

  assert.equal(response.status, 200);
  const payloads = parseSsePayloads(await response.text());
  const meta = payloads.find((entry) => entry.type === "meta")?.content;
  const text = payloads.filter((entry) => entry.type === "text").map((entry) => entry.content).join("");

  assert.equal(meta.mode, "freeform");
  assert.match(text, /AI backend|scene|build/i);
  assert.equal(payloads.some((entry) => entry.type === "done"), true);
});

test("POST /api/tutor/similar returns similar question suggestions", async () => {
  const tutorRoute = createTestTutorRoute({
    similarQuestionGenerator: async () => ([
      { label: "One", prompt: "Question one", source: "template" },
      { label: "Two", prompt: "Question two", source: "template" },
      { label: "Three", prompt: "Question three", source: "template" },
    ]),
  });

  const response = await tutorRoute.request("/similar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan: buildAnalyticPlan(),
      limit: 3,
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.suggestions.length, 3);
  assert.deepEqual(payload.suggestions.map((item) => item.label), ["One", "Two", "Three"]);
});
