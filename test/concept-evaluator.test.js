import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateConcept,
  evaluateStageProgression,
  hasPositiveTutorSignal,
  isTrivialInteraction,
} from "../server/services/conceptEvaluator.js";

test("isTrivialInteraction returns true for orient stage", () => {
  assert.equal(isTrivialInteraction("orient", "ok"), true);
  assert.equal(isTrivialInteraction("orient", "I think the surface area is 24"), true);
});

test("isTrivialInteraction returns true for short build messages without math", () => {
  assert.equal(isTrivialInteraction("build", "ok"), true);
  assert.equal(isTrivialInteraction("build", "got it"), true);
  assert.equal(isTrivialInteraction("build", "yes"), true);
  assert.equal(isTrivialInteraction("build", "I see"), true);
});

test("isTrivialInteraction returns false for substantive build messages", () => {
  assert.equal(isTrivialInteraction("build", "I think the area of each face is length times width"), false);
  assert.equal(isTrivialInteraction("build", "the formula uses $lw + lh + wh$"), false);
  assert.equal(isTrivialInteraction("build", "maybe around 42"), false);
  assert.equal(isTrivialInteraction("build", "I get AB and AC"), false);
  assert.equal(isTrivialInteraction("build", "AB = B - A and AC = C - A"), false);
});

test("isTrivialInteraction returns false for predict/check/reflect/challenge", () => {
  assert.equal(isTrivialInteraction("predict", "ok"), false);
  assert.equal(isTrivialInteraction("check", "yes"), false);
  assert.equal(isTrivialInteraction("reflect", "I see"), false);
  assert.equal(isTrivialInteraction("challenge", "got it"), false);
});

test("evaluateConcept returns CORRECT for confident correct verdict", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "surface area is the total area of all faces",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "CORRECT",
        confidence: 0.92,
        what_was_right: "Correctly identified surface area as total face area",
        gap: null,
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      }),
    },
  );

  assert.equal(result.verdict, "CORRECT");
  assert.equal(result.confidence, 0.92);
  assert.equal(result.what_was_right, "Correctly identified surface area as total face area");
});

test("evaluateConcept downgrades CORRECT to PARTIAL when confidence < 0.65", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "something about faces",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "CORRECT",
        confidence: 0.55,
        what_was_right: "Mentioned faces",
        gap: "Vague understanding",
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      }),
    },
  );

  assert.equal(result.verdict, "PARTIAL");
  assert.equal(result.confidence, 0.55);
});

test("evaluateConcept returns STUCK verdict", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "I have no idea",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "STUCK",
        confidence: 0.88,
        what_was_right: "",
        gap: "No understanding demonstrated",
        misconception_type: "no_attempt",
        scene_cue: "highlight_net_faces",
        tutor_tone: "supportive",
      }),
    },
  );

  assert.equal(result.verdict, "STUCK");
  assert.equal(result.scene_cue, "highlight_net_faces");
  assert.equal(result.tutor_tone, "supportive");
});

test("evaluateConcept falls back to PARTIAL on LLM error", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => {
        throw new Error("model unavailable");
      },
    },
  );

  assert.equal(result.verdict, "PARTIAL");
  assert.equal(result.confidence, 0.5);
});

test("evaluateConcept falls back to PARTIAL on malformed JSON", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "understand surface area",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => "this is not json at all",
    },
  );

  assert.equal(result.verdict, "PARTIAL");
  assert.equal(result.confidence, 0.5);
});

test("evaluateConcept normalizes unknown verdict to PARTIAL", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "test",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => JSON.stringify({
        verdict: "UNKNOWN",
        confidence: 0.8,
        what_was_right: "",
      }),
    },
  );

  assert.equal(result.verdict, "PARTIAL");
});

test("evaluateConcept strips markdown code fences from response", async () => {
  const result = await evaluateConcept(
    {
      stageGoal: "test",
      learnerInput: "test",
      lessonContext: {},
      prediction: "",
      learnerHistory: [],
    },
    {
      converseWithModelFailover: async () => "```json\n" + JSON.stringify({
        verdict: "CORRECT",
        confidence: 0.9,
        what_was_right: "Good answer",
        gap: null,
      }) + "\n```",
    },
  );

  assert.equal(result.verdict, "CORRECT");
  assert.equal(result.what_was_right, "Good answer");
});

test("evaluateConcept deterministically flags vector component mistakes", async () => {
  const result = await evaluateConcept({
    stageGoal: "Use AB and AC to set up the angle formula.",
    learnerInput: "AB=(3,-3,4) and AC=(1,3,3)",
    lessonContext: {
      plan: {
        analyticContext: {
          entities: {
            points: [
              { label: "A", coordinates: [1, 2, -1] },
              { label: "B", coordinates: [4, -1, 3] },
              { label: "C", coordinates: [0, 5, 2] },
            ],
            lines: [
              { label: "AB", direction: [3, -3, 4] },
              { label: "AC", direction: [-1, 3, 3] },
            ],
          },
        },
      },
    },
    prediction: "",
    learnerHistory: [],
  });

  assert.equal(result.verdict, "PARTIAL");
  assert.match(result.what_was_right, /AB/i);
  assert.match(result.gap || "", /AC/i);
  assert.match(result.gap || "", /-1, 3, 3/);
});

test("evaluateConcept deterministically marks correct named vectors as CORRECT", async () => {
  let called = false;
  const result = await evaluateConcept({
    stageGoal: "Use AB and AC to set up the angle formula.",
    learnerInput: "AB=(3,-3,4) and AC=(-1,3,3)",
    lessonContext: {
      plan: {
        analyticContext: {
          entities: {
            points: [
              { label: "A", coordinates: [1, 2, -1] },
              { label: "B", coordinates: [4, -1, 3] },
              { label: "C", coordinates: [0, 5, 2] },
            ],
          },
        },
      },
    },
    prediction: "",
    learnerHistory: [],
  }, {
    converseWithModelFailover: async () => {
      called = true;
      return "{}";
    },
  });

  assert.equal(called, false);
  assert.equal(result.verdict, "CORRECT");
});

test("hasPositiveTutorSignal detects progression acknowledgements", () => {
  assert.equal(hasPositiveTutorSignal("Great work. Let's move forward."), true);
  assert.equal(hasPositiveTutorSignal("Excellent reasoning on that step."), true);
  assert.equal(hasPositiveTutorSignal("Let's inspect one more detail first."), false);
});

test("evaluateStageProgression can progress based on CORRECT verdict even without layer-1 signal when gate says YES", async () => {
  let called = false;
  const result = await evaluateStageProgression({
    currentStage: { id: "stage-1", goal: "Read the setup" },
    nextStage: { id: "stage-2", goal: "Use AB" },
    learningState: { learningStage: "build" },
    nextLearningStage: "build",
    conceptVerdict: { verdict: "CORRECT" },
    learnerInput: "AB = (4,0,0)",
    tutorReply: "Try checking one more thing.",
    assessment: {},
  }, {
    converseWithModelFailover: async () => {
      called = true;
      return "{\"progress\":\"YES\",\"reason\":\"ready\"}";
    },
  });

  assert.equal(called, true);
  assert.equal(result.layer1Matched, false);
  assert.equal(result.layer2Decision, "YES");
  assert.equal(result.shouldProgress, true);
});

test("evaluateStageProgression respects layer-2 YES decision", async () => {
  const result = await evaluateStageProgression({
    currentStage: { id: "stage-1", goal: "Read the setup" },
    nextStage: { id: "stage-2", goal: "Use AB" },
    learningState: { learningStage: "build" },
    nextLearningStage: "build",
    conceptVerdict: { verdict: "CORRECT" },
    learnerInput: "AB = (4,0,0)",
    tutorReply: "Great job. You're ready for the next step.",
    assessment: {},
  }, {
    converseWithModelFailover: async () => "{\"progress\":\"YES\",\"reason\":\"stage goal satisfied\"}",
  });

  assert.equal(result.layer1Matched, true);
  assert.equal(result.layer2Decision, "YES");
  assert.equal(result.shouldProgress, true);
});

test("evaluateStageProgression still progresses on CORRECT when the NO reason is weak", async () => {
  const result = await evaluateStageProgression({
    currentStage: { id: "stage-1", goal: "Read the setup" },
    nextStage: { id: "stage-2", goal: "Use AB" },
    learningState: { learningStage: "build" },
    nextLearningStage: "build",
    conceptVerdict: { verdict: "CORRECT" },
    learnerInput: "AB = (4,0,0)",
    tutorReply: "Excellent work.",
    assessment: {},
  }, {
    converseWithModelFailover: async () => "{\"progress\":\"NO\",\"reason\":\"needs one more confirmation\"}",
  });

  assert.equal(result.layer1Matched, true);
  assert.equal(result.layer2Decision, "NO");
  assert.equal(result.shouldProgress, true);
});

test("evaluateStageProgression blocks CORRECT when the NO reason signals unresolved confusion", async () => {
  const result = await evaluateStageProgression({
    currentStage: { id: "stage-1", goal: "Read the setup" },
    nextStage: { id: "stage-2", goal: "Use AB" },
    learningState: { learningStage: "build" },
    nextLearningStage: "build",
    conceptVerdict: { verdict: "CORRECT" },
    learnerInput: "AB = (4,0,0)",
    tutorReply: "Excellent work, but there is still unresolved confusion about the setup.",
    assessment: {},
  }, {
    converseWithModelFailover: async () => "{\"progress\":\"NO\",\"reason\":\"unresolved confusion about the prerequisite setup\"}",
  });

  assert.equal(result.layer1Matched, true);
  assert.equal(result.layer2Decision, "NO");
  assert.equal(result.shouldProgress, false);
});

test("evaluateStageProgression can progress on praise even when concept verdict is not CORRECT when gate says YES", async () => {
  let called = false;
  const result = await evaluateStageProgression({
    currentStage: { id: "stage-1", goal: "Read the setup" },
    nextStage: { id: "stage-2", goal: "Use AB" },
    learningState: { learningStage: "build" },
    nextLearningStage: "build",
    conceptVerdict: { verdict: "PARTIAL" },
    learnerInput: "AB = (4,0,0)",
    tutorReply: "Great effort.",
    assessment: {},
  }, {
    converseWithModelFailover: async () => {
      called = true;
      return "{\"progress\":\"YES\",\"reason\":\"ready\"}";
    },
  });

  assert.equal(called, true);
  assert.equal(result.layer2Decision, "YES");
  assert.equal(result.shouldProgress, true);
});
