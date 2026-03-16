import test from "node:test";
import assert from "node:assert/strict";

import { TutorState } from "../src/state/tutorState.js";

test("TutorState uses analytic lesson stages as the step source", () => {
  const state = new TutorState();
  state.setPlan({
    problem: {
      id: "analytic-progress",
      question: "Find the angle between AB and AC.",
      mode: "guided",
    },
    experienceMode: "analytic_auto",
    buildSteps: [{
      id: "plot-points",
      title: "Plot the points",
      instruction: "Read the givens.",
    }],
    lessonStages: [
      {
        id: "plot-points",
        title: "Plot the points",
        goal: "Read the givens.",
      },
      {
        id: "show-ab",
        title: "Show AB",
        goal: "Use AB.",
      },
      {
        id: "show-ac",
        title: "Show AC",
        goal: "Use AC.",
      },
    ],
    learningMoments: {},
  }, { mode: "guided" });

  assert.equal(state.totalSteps, 3);
  assert.equal(state.goToStep(1), true);
  assert.equal(state.getCurrentStep()?.id, "show-ab");
  assert.equal(state.nextStep(), true);
  assert.equal(state.getCurrentStep()?.id, "show-ac");
});
