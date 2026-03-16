import test from "node:test";
import assert from "node:assert/strict";

import {
  randomDeferredAdvanceInputs,
  resolveDeferredStageAdvance,
} from "../src/ui/deferredStageProgression.js";

function analyticPlan() {
  return {
    experienceMode: "analytic_auto",
    lessonStages: [
      { id: "stage-1", title: "Stage 1" },
      { id: "stage-2", title: "Stage 2" },
      { id: "stage-3", title: "Stage 3" },
    ],
  };
}

test("randomDeferredAdvanceInputs returns only 1 or 2", () => {
  assert.equal(randomDeferredAdvanceInputs(() => 0.0), 1);
  assert.equal(randomDeferredAdvanceInputs(() => 0.49), 1);
  assert.equal(randomDeferredAdvanceInputs(() => 0.5), 2);
  assert.equal(randomDeferredAdvanceInputs(() => 0.99), 2);
});

test("resolveDeferredStageAdvance starts a deferred advance after a backend NO", () => {
  const result = resolveDeferredStageAdvance({
    plan: analyticPlan(),
    currentStageId: "stage-1",
    backendSaidNo: true,
    randomFn: () => 0.8,
  });

  assert.deepEqual(result, {
    pendingAdvance: {
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
      inputsRemaining: 2,
    },
    overrideStageId: null,
  });
});

test("resolveDeferredStageAdvance does not reset the countdown on repeated backend NOs", () => {
  const first = resolveDeferredStageAdvance({
    plan: analyticPlan(),
    currentStageId: "stage-1",
    backendSaidNo: true,
    randomFn: () => 0.8,
  });

  const second = resolveDeferredStageAdvance({
    pendingAdvance: first.pendingAdvance,
    plan: analyticPlan(),
    currentStageId: "stage-1",
    backendSaidNo: true,
    consumedLearnerInput: true,
    randomFn: () => 0.1,
  });

  assert.deepEqual(second, {
    pendingAdvance: {
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
      inputsRemaining: 1,
    },
    overrideStageId: null,
  });
});

test("resolveDeferredStageAdvance forces the next stage once the deferred countdown reaches zero", () => {
  const initialized = resolveDeferredStageAdvance({
    plan: analyticPlan(),
    currentStageId: "stage-1",
    backendSaidNo: true,
    randomFn: () => 0.2,
  });

  const resolved = resolveDeferredStageAdvance({
    pendingAdvance: initialized.pendingAdvance,
    plan: analyticPlan(),
    currentStageId: "stage-1",
    backendSaidNo: true,
    consumedLearnerInput: true,
  });

  assert.deepEqual(resolved, {
    pendingAdvance: null,
    overrideStageId: "stage-2",
  });
});
