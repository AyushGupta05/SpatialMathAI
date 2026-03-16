function normalizeStageType(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if ([
    "ORIENT",
    "PREDICT",
    "BUILD",
    "CHECK",
    "REFLECT",
    "CHALLENGE",
    "ANALYTIC_AUTO",
  ].includes(normalized)) {
    return normalized;
  }
  return "ORIENT";
}

function normalizeHintState(hintState = {}) {
  const currentStageHints = Number.isFinite(Number(hintState?.current_stage_hints))
    ? Math.max(0, Number(hintState.current_stage_hints))
    : 0;
  const maxHints = Number.isFinite(Number(hintState?.max_hints))
    ? Math.max(1, Number(hintState.max_hints))
    : 3;
  return {
    current_stage_hints: currentStageHints,
    max_hints: maxHints,
    escalate_next: Boolean(hintState?.escalate_next),
    total_stuck_count: Number.isFinite(Number(hintState?.total_stuck_count))
      ? Math.max(0, Number(hintState.total_stuck_count))
      : 0,
  };
}

function cloneLearningState(learningState = {}) {
  return {
    ...learningState,
    hint_state: normalizeHintState(learningState?.hint_state || {}),
  };
}

function stageFormulaText(plan = {}, stage = null) {
  const challengeFormula = typeof plan?.challenge?.formula === "string" ? plan.challenge.formula.trim() : "";
  const stageFormula = typeof stage?.formula === "string" ? stage.formula.trim() : "";
  const analyticFormula = typeof plan?.analyticContext?.formulaCard?.formula === "string"
    ? plan.analyticContext.formulaCard.formula.trim()
    : "";
  const scaffoldFormula = typeof plan?.answerScaffold?.formula === "string"
    ? plan.answerScaffold.formula.trim()
    : "";
  return challengeFormula || stageFormula || analyticFormula || scaffoldFormula || "";
}

function analyticSceneMoment(plan = {}, stage = null, learningState = {}) {
  if (plan?.experienceMode !== "analytic_auto" || !Array.isArray(plan?.sceneMoments) || !plan.sceneMoments.length) {
    return null;
  }

  const stageId = stage?.id || null;
  if (stageId) {
    const matchedMoment = plan.sceneMoments.find((moment) => moment.id === stageId);
    if (matchedMoment) return matchedMoment;
  }

  const stepIndex = Number.isFinite(Number(learningState?.currentStep))
    ? Math.max(0, Number(learningState.currentStep))
    : 0;
  return plan.sceneMoments[stepIndex] || plan.sceneMoments[0] || null;
}

function analyticActionFlags(plan = {}, stage = null, learningState = {}) {
  const moment = analyticSceneMoment(plan, stage, learningState);
  const revealFullSolution = Boolean(moment?.revealFullSolution);
  return {
    moment,
    revealFormula: Boolean(moment?.revealFormula || revealFullSolution),
    revealFullSolution,
  };
}

function stageTypeForContext(plan = {}, stage = null, learningState = {}) {
  if (plan?.experienceMode === "analytic_auto") {
    return "ANALYTIC_AUTO";
  }
  return normalizeStageType(stage?.learningStage || learningState?.learningStage || "orient");
}

function autoAdvanceEnabled(plan = {}) {
  return plan?.autoAdvance !== false;
}

export function currentVerdictEntry(learningState = {}) {
  const learnerHistory = Array.isArray(learningState?.learnerHistory) ? learningState.learnerHistory : [];
  for (let index = learnerHistory.length - 1; index >= 0; index -= 1) {
    if (learnerHistory[index]?.verdict) {
      return learnerHistory[index];
    }
  }
  return null;
}

export function deriveHintTypeFromLabel(label = "") {
  const normalized = String(label || "").trim();
  switch (normalized) {
    case "What should I focus on?":
    case "What should I notice?":
      return "focus";
    case "How do I start?":
      return "entry";
    case "Give me a hint":
      return "nudge";
    case "Another hint":
      return "deeper";
    case "What am I missing?":
      return "gap";
    case "Walk me through this":
      return "walkthrough";
    case "What should I place next?":
      return "build_next";
    case "Help me think about this":
      return "reflect";
    default:
      return "nudge";
  }
}

export function applyVerdictToLearningState(learningState = {}, conceptVerdict = null) {
  const nextState = cloneLearningState(learningState);
  const verdict = conceptVerdict?.verdict || null;
  if (verdict === "STUCK") {
    nextState.hint_state.current_stage_hints += 1;
    nextState.hint_state.total_stuck_count += 1;
    if (nextState.hint_state.current_stage_hints >= nextState.hint_state.max_hints) {
      nextState.hint_state.escalate_next = true;
    }
  } else if (verdict === "CORRECT") {
    nextState.hint_state.current_stage_hints = 0;
    nextState.hint_state.escalate_next = false;
  }
  return nextState;
}

function button(id, label, style, payload = {}) {
  return {
    id,
    label,
    style,
    kind: id,
    payload,
  };
}

function showHint(label, payload = {}) {
  return button("show_hint", label, "secondary", {
    ...payload,
    hint_type: deriveHintTypeFromLabel(label),
  });
}

function analyticInitialActions(plan = {}, stage = null, learningState = {}) {
  const { revealFormula, revealFullSolution } = analyticActionFlags(plan, stage, learningState);
  const actions = [
    showHint(revealFormula || revealFullSolution ? "Give me a hint" : "What should I notice?"),
  ];

  if (revealFormula || revealFullSolution) {
    actions.push(button("show_formula", "Show formula", "secondary"));
  }
  if (revealFullSolution) {
    actions.push(button("view_solution", "Show solution", "danger-muted"));
  }

  return actions;
}

function initialActionsForStage(plan = {}, stage = null, learningState = {}) {
  const stageType = stageTypeForContext(plan, stage, learningState);
  const hasFormula = Boolean(stageFormulaText(plan, stage));

  switch (stageType) {
    case "ORIENT":
      return [showHint("What should I focus on?")];
    case "PREDICT":
      return [showHint("How do I start?")];
    case "BUILD":
      return [showHint("What should I place next?")];
    case "CHECK":
      return hasFormula
        ? [showHint("Give me a hint"), button("show_formula", "Show formula", "secondary")]
        : [showHint("Give me a hint")];
    case "REFLECT":
      return [showHint("Help me think about this")];
    case "CHALLENGE":
      return hasFormula
        ? [showHint("Give me a hint"), button("show_formula", "Show formula", "secondary")]
        : [showHint("Give me a hint")];
    case "ANALYTIC_AUTO":
      return analyticInitialActions(plan, stage, learningState);
    default:
      return [showHint("Give me a hint")];
  }
}

function actionsForCorrect(plan = {}) {
  if (autoAdvanceEnabled(plan)) {
    return [button("show_connection", "How does this connect?", "secondary")];
  }
  return [
    button("show_connection", "How does this connect?", "secondary"),
    button("next_stage", "I'm ready to continue", "primary"),
  ];
}

function actionsForPartial(gap = null) {
  return [
    button("try_again", "Let me try again", "primary", { gap: gap || null }),
    showHint("What am I missing?", { gap: gap || null }),
  ];
}

function actionsForStuck(plan = {}, stage = null, learningState = {}) {
  const hintState = normalizeHintState(learningState?.hint_state || {});
  const stageType = stageTypeForContext(plan, stage, learningState);
  const formulaAction = button("show_formula", "Show formula", "secondary");
  const analyticFlags = analyticActionFlags(plan, stage, learningState);

  if (hintState.escalate_next || hintState.current_stage_hints >= hintState.max_hints) {
    return [button("view_solution", "Show solution", "danger-muted")];
  }

  if (hintState.current_stage_hints === 1) {
    if (stageType === "ANALYTIC_AUTO") {
      return analyticFlags.revealFormula
        ? [showHint("Give me a hint"), formulaAction]
        : [showHint("Give me a hint")];
    }
    if (["CHECK", "CHALLENGE"].includes(stageType) && stageFormulaText(plan, stage)) {
      return [showHint("Give me a hint"), formulaAction];
    }
    return [showHint("Give me a hint")];
  }

  if (hintState.current_stage_hints >= 2) {
    if (stageType === "ANALYTIC_AUTO") {
      return analyticFlags.revealFormula
        ? [showHint("Another hint"), formulaAction]
        : [showHint("Another hint")];
    }
    return stageFormulaText(plan, stage)
      ? [showHint("Another hint"), formulaAction]
      : [showHint("Another hint")];
  }

  return initialActionsForStage(plan, stage, learningState);
}

function actionsForCompletion() {
  return [
    button("ask_followup", "Ask a follow-up", "secondary"),
    button("try_similar", "Try a similar problem", "primary"),
  ];
}

export function resolveTutorActionState({
  plan = {},
  stage = null,
  learningState = {},
  conceptVerdict = null,
  completionState = null,
  responseKind = "stage_opening",
} = {}) {
  const derivedLearningState = cloneLearningState(learningState);
  const stageType = stageTypeForContext(plan, stage, derivedLearningState);
  const lastVerdict = conceptVerdict?.verdict
    || currentVerdictEntry(derivedLearningState)?.verdict
    || null;

  if (completionState?.complete || responseKind === "solution_shown" || responseKind === "lesson_complete") {
    return {
      stageType,
      lastVerdict,
      actions: actionsForCompletion(),
    };
  }

  if (responseKind === "connection_followup" && !autoAdvanceEnabled(plan)) {
    return {
      stageType,
      lastVerdict: "CORRECT",
      actions: [button("next_stage", "I'm ready to continue", "primary")],
    };
  }

  if (responseKind === "stage_opening" || responseKind === "non_evaluated") {
    return {
      stageType,
      lastVerdict,
      actions: initialActionsForStage(plan, stage, derivedLearningState),
    };
  }

  if (lastVerdict === "CORRECT") {
    return {
      stageType,
      lastVerdict,
      actions: actionsForCorrect(plan),
    };
  }

  if (lastVerdict === "PARTIAL") {
    const gap = conceptVerdict?.gap || currentVerdictEntry(derivedLearningState)?.gap || null;
    const actions = actionsForPartial(gap);
    if (stageType === "ANALYTIC_AUTO" && analyticActionFlags(plan, stage, derivedLearningState).revealFormula) {
      actions.push(button("show_formula", "Show formula", "secondary"));
    }
    return {
      stageType,
      lastVerdict,
      actions,
    };
  }

  if (lastVerdict === "STUCK") {
    return {
      stageType,
      lastVerdict,
      actions: actionsForStuck(plan, stage, derivedLearningState),
    };
  }

  return {
    stageType,
    lastVerdict,
    actions: initialActionsForStage(plan, stage, derivedLearningState),
  };
}

export function resolveHintFollowUpActionState({
  plan = {},
  stage = null,
  learningState = {},
  completionState = null,
} = {}) {
  const derivedLearningState = cloneLearningState(learningState);
  const stageType = stageTypeForContext(plan, stage, derivedLearningState);
  const hintState = normalizeHintState(derivedLearningState?.hint_state || {});
  const lastVerdict = currentVerdictEntry(derivedLearningState)?.verdict || null;

  if (completionState?.complete) {
    return {
      stageType,
      lastVerdict,
      actions: actionsForCompletion(),
    };
  }

  if (hintState.current_stage_hints > 0 || hintState.escalate_next) {
    return {
      stageType,
      lastVerdict: "STUCK",
      actions: actionsForStuck(plan, stage, derivedLearningState),
    };
  }

  return {
    stageType,
    lastVerdict,
    actions: initialActionsForStage(plan, stage, derivedLearningState),
  };
}

export function formulaTextForCurrentStage(plan = {}, stage = null) {
  return stageFormulaText(plan, stage);
}

export function isAutoAdvanceEnabled(plan = {}) {
  return autoAdvanceEnabled(plan);
}
