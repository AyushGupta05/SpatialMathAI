import test from "node:test";
import assert from "node:assert/strict";

import { resolveHintFollowUpActionState, resolveTutorActionState } from "../src/core/tutorActions.js";
import { TutorState } from "../src/state/tutorState.js";

test("resolveHintFollowUpActionState escalates hint prompts across repeated help requests", () => {
  const stage = { id: "observe", learningStage: "orient" };

  const firstFollowUp = resolveHintFollowUpActionState({
    plan: {},
    stage,
    learningState: {
      hint_state: {
        current_stage_hints: 1,
        max_hints: 3,
        escalate_next: false,
      },
    },
  });
  assert.equal(firstFollowUp.actions[0].label, "Give me a hint");

  const secondFollowUp = resolveHintFollowUpActionState({
    plan: {},
    stage,
    learningState: {
      hint_state: {
        current_stage_hints: 2,
        max_hints: 3,
        escalate_next: false,
      },
    },
  });
  assert.equal(secondFollowUp.actions[0].label, "Another hint");

  const solutionFollowUp = resolveHintFollowUpActionState({
    plan: {},
    stage,
    learningState: {
      hint_state: {
        current_stage_hints: 3,
        max_hints: 3,
        escalate_next: true,
      },
    },
  });
  assert.equal(solutionFollowUp.actions[0].label, "Show solution");
});

test("TutorState.useHint marks the solution path once the max hint count is reached", () => {
  const state = new TutorState();

  assert.equal(state.useHint(), true);
  assert.equal(state.hint_state.escalate_next, false);
  assert.equal(state.useHint(), true);
  assert.equal(state.hint_state.escalate_next, false);
  assert.equal(state.useHint(), true);
  assert.equal(state.hint_state.escalate_next, true);
});

test("resolveTutorActionState uses verdict-driven actions for non-evaluated turns", () => {
  const actionState = resolveTutorActionState({
    plan: {},
    stage: { id: "stage-1", learningStage: "orient" },
    learningState: {
      learningStage: "orient",
      learnerHistory: [{
        stage: "orient",
        verdict: "STUCK",
        gap: "Missed the key visual cue",
      }],
      hint_state: {
        current_stage_hints: 1,
        max_hints: 3,
        escalate_next: false,
      },
    },
    responseKind: "non_evaluated",
  });

  assert.equal(actionState.lastVerdict, "STUCK");
  assert.equal(actionState.actions[0].label, "Give me a hint");
});

test("resolveTutorActionState trims analytic opening actions to the two most relevant choices", () => {
  const actionState = resolveTutorActionState({
    plan: {
      experienceMode: "analytic_auto",
      sceneMoments: [{
        id: "observe",
        revealFormula: false,
        revealFullSolution: false,
      }],
      lessonStages: [{
        id: "observe",
      }],
    },
    stage: { id: "observe", learningStage: "build" },
    learningState: {
      currentStep: 0,
      learningStage: "build",
    },
    responseKind: "stage_opening",
  });

  assert.deepEqual(actionState.actions.map((action) => action.label), ["What should I notice?", "How do I start?"]);
});
