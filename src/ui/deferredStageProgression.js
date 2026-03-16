function normalizeStageId(value = "") {
  return String(value || "").trim();
}

function nextLessonStageId(plan = {}, currentStageId = "") {
  const normalizedStageId = normalizeStageId(currentStageId);
  if (!Array.isArray(plan?.lessonStages) || !plan.lessonStages.length || !normalizedStageId) {
    return null;
  }
  const currentIndex = plan.lessonStages.findIndex((stage) => stage?.id === normalizedStageId);
  if (currentIndex < 0 || currentIndex >= plan.lessonStages.length - 1) {
    return null;
  }
  return normalizeStageId(plan.lessonStages[currentIndex + 1]?.id || "");
}

export function randomDeferredAdvanceInputs(randomFn = Math.random) {
  const value = Number(randomFn?.());
  if (!Number.isFinite(value)) return 1;
  return Math.floor(Math.abs(value) * 2) + 1;
}

export function resolveDeferredStageAdvance({
  pendingAdvance = null,
  plan = {},
  currentStageId = "",
  backendSaidNo = false,
  backendProgressed = false,
  consumedLearnerInput = false,
  randomFn = Math.random,
} = {}) {
  const normalizedStageId = normalizeStageId(currentStageId);
  const targetStageId = nextLessonStageId(plan, normalizedStageId);
  let nextPending = pendingAdvance?.sourceStageId && pendingAdvance?.targetStageId
    ? {
      sourceStageId: normalizeStageId(pendingAdvance.sourceStageId),
      targetStageId: normalizeStageId(pendingAdvance.targetStageId),
      inputsRemaining: Math.max(0, Number(pendingAdvance.inputsRemaining || 0)),
    }
    : null;

  if (!plan?.experienceMode || plan.experienceMode !== "analytic_auto") {
    return { pendingAdvance: null, overrideStageId: null };
  }

  if (!normalizedStageId || !targetStageId) {
    return { pendingAdvance: null, overrideStageId: null };
  }

  if (nextPending && normalizedStageId !== nextPending.sourceStageId) {
    nextPending = null;
  }

  if (backendProgressed) {
    return { pendingAdvance: null, overrideStageId: null };
  }

  if (nextPending && consumedLearnerInput) {
    nextPending.inputsRemaining = Math.max(0, nextPending.inputsRemaining - 1);
  }

  if (
    nextPending
    && nextPending.sourceStageId === normalizedStageId
    && nextPending.targetStageId === targetStageId
    && nextPending.inputsRemaining <= 0
  ) {
    return {
      pendingAdvance: null,
      overrideStageId: nextPending.targetStageId,
    };
  }

  if (backendSaidNo) {
    if (
      nextPending
      && nextPending.sourceStageId === normalizedStageId
      && nextPending.targetStageId === targetStageId
    ) {
      return {
        pendingAdvance: nextPending,
        overrideStageId: null,
      };
    }
    return {
      pendingAdvance: {
        sourceStageId: normalizedStageId,
        targetStageId,
        inputsRemaining: randomDeferredAdvanceInputs(randomFn),
      },
      overrideStageId: null,
    };
  }

  return {
    pendingAdvance: null,
    overrideStageId: null,
  };
}
