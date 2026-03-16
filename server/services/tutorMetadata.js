import { normalizeScenePlan } from "../../src/ai/planSchema.js";
import { supports2dCompanionShape } from "../../src/ai/representationMode.js";
import { applyVerdictToLearningState, resolveTutorActionState } from "../../src/core/tutorActions.js";

function suggestionById(plan, suggestionId) {
  return plan.objectSuggestions.find((suggestion) => suggestion.id === suggestionId) || null;
}

function sceneMomentForStage(plan, stageId = null, learningState = {}) {
  if (!plan?.sceneMoments?.length) return null;
  return plan.sceneMoments.find((moment) => moment.id === stageId)
    || plan.sceneMoments[learningState?.currentStep || 0]
    || plan.sceneMoments[0]
    || null;
}

function currentLessonStage(plan, learningState = {}, contextStepId = null, assessment = null) {
  const explicitId = contextStepId
    || assessment?.guidance?.currentStepId
    || plan.buildSteps[learningState?.currentStep || 0]?.id
    || null;
  return plan.lessonStages.find((stage) => stage.id === explicitId)
    || plan.lessonStages[0]
    || null;
}

function preferredCompanionObjectId(plan, assessment = null) {
  const suggestionIds = assessment?.guidance?.nextRequiredSuggestionIds || [];
  for (const suggestionId of suggestionIds) {
    const suggestion = suggestionById(plan, suggestionId);
    if (suggestion?.object?.shape && supports2dCompanionShape(suggestion.object.shape)) {
      return suggestion.object.id;
    }
  }

  return plan.objectSuggestions.find((suggestion) => supports2dCompanionShape(suggestion.object.shape))?.object?.id || null;
}

function requestedRepresentationMode(plan, userMessage = "") {
  const lower = String(userMessage || "").toLowerCase();
  if (!lower) return plan.representationMode || "3d";
  if (/\b(net|unfold|unfolded|flatten|flat pattern|2d)\b/.test(lower)) {
    return plan.representationMode === "3d" ? "split_2d" : "2d";
  }
  if (/\b(orbit|rotate|spin|3d|perspective)\b/.test(lower)) {
    return "3d";
  }
  return plan.representationMode || "3d";
}

function representationDirectiveForReply(plan, assessment = null, userMessage = "") {
  const preferredMode = requestedRepresentationMode(plan, userMessage);
  const companionObjectId = preferredMode === "3d" ? null : preferredCompanionObjectId(plan, assessment);
  const representationMode = companionObjectId ? preferredMode : "3d";

  return {
    representationMode,
    companionObjectId,
    companionTitle: representationMode === "2d" ? "2D Lesson View" : representationMode === "split_2d" ? "2D Companion" : "",
    companionReason: representationMode === "2d"
      ? "A flat view makes the surface relationship easier to compare face by face."
      : representationMode === "split_2d"
        ? "Keep the solid in 3D while the net shows how each visible face contributes."
        : "",
  };
}

function systemContextMessage(plan) {
  const evidence = plan.sourceEvidence;
  const givens = evidence?.givens?.length ? `Givens: ${evidence.givens.join(", ")}.` : "";
  const diagram = evidence?.diagramSummary ? `Source: ${evidence.diagramSummary}` : "Source: text prompt only.";
  const conflicts = evidence?.conflicts?.length ? ` Check the mismatch: ${evidence.conflicts.join(" ")}` : "";
  return `${diagram} ${givens}${conflicts}`.trim();
}

function sceneCueFocusTargets(sceneCue, plan) {
  if (!sceneCue || typeof sceneCue !== "string") return [];
  const allObjectIds = (plan.objectSuggestions || []).map((s) => s.object?.id).filter(Boolean);
  const match = sceneCue.match(/highlight_(.+)/);
  if (match) {
    const target = match[1];
    const found = allObjectIds.filter((id) => id.includes(target));
    return found.length ? found : [];
  }
  return [];
}

export function buildTutorResponseMeta({
  plan: planInput,
  learningState = {},
  contextStepId = null,
  assessment = null,
  completionState = null,
  userMessage = "",
  conceptVerdict = null,
  responseKind = "stage_opening",
  solutionReveal = null,
}) {
  const plan = normalizeScenePlan(planInput);
  const revealSolution = completionState?.reason === "revealed-solution";
  const fallbackStage = currentLessonStage(plan, learningState, contextStepId, assessment);
  const stage = revealSolution && plan.experienceMode === "analytic_auto"
    ? plan.lessonStages.at(-1) || fallbackStage
    : fallbackStage;
  const sceneMoment = revealSolution && plan.experienceMode === "analytic_auto"
    ? plan.sceneMoments?.at(-1) || sceneMomentForStage(plan, stage?.id || null, learningState)
    : sceneMomentForStage(plan, stage?.id || null, learningState);
  const representation = representationDirectiveForReply(plan, assessment, userMessage);
  const nextRequiredSuggestionIds = assessment?.guidance?.nextRequiredSuggestionIds || [];
  const focusTargets = plan.experienceMode === "analytic_auto"
    ? (sceneMoment?.focusTargets?.length ? sceneMoment.focusTargets : (stage?.highlightTargets || []))
    : stage?.highlightTargets?.length
      ? stage.highlightTargets
      : nextRequiredSuggestionIds
        .map((id) => suggestionById(plan, id)?.object?.id)
        .filter(Boolean);

  const cueFocusTargets = sceneCueFocusTargets(conceptVerdict?.scene_cue, plan);
  const mergedFocusTargets = cueFocusTargets.length
    ? [...new Set([...focusTargets, ...cueFocusTargets])]
    : focusTargets;

  const learningStateForActions = conceptVerdict?.verdict
    ? applyVerdictToLearningState(learningState, conceptVerdict)
    : learningState;
  const actionState = resolveTutorActionState({
    plan,
    stage,
    learningState: learningStateForActions,
    conceptVerdict,
    completionState,
    responseKind,
  });
  const actions = actionState.actions.map((action) => ({
    ...action,
    payload: {
      ...(action.payload || {}),
      stageId: stage?.id || null,
    },
  }));

  return {
    actions,
    escalation: learningState?.hint_state?.escalate_next
      ? {
        triggered: true,
        hint_count: learningState.hint_state.current_stage_hints,
        action: "full_solution_revealed",
      }
      : null,
    focusTargets: mergedFocusTargets,
    checkpoint: completionState?.complete
      ? null
      : plan.experienceMode === "analytic_auto"
      ? null
      : assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction
      ? {
        prompt: stage?.checkpointPrompt || "Does this look correct?",
        options: ["yes", "not_sure"],
      }
      : null,
    stageStatus: {
      currentStageId: stage?.id || null,
      canAdvance: completionState?.complete
        ? false
        : plan.experienceMode === "analytic_auto"
        ? true
        : Boolean(assessment?.activeStep?.complete || assessment?.guidance?.readyForPrediction),
    },
    systemContextMessage: systemContextMessage(plan),
    actionState: {
      stageType: actionState.stageType,
      lastVerdict: actionState.lastVerdict,
    },
    completionState: completionState?.complete
      ? { complete: true, reason: completionState.reason || "correct-answer" }
      : { complete: false, reason: null },
    solutionReveal,
    sceneDirective: {
      ...representation,
      stageId: sceneMoment?.id || stage?.id || null,
      cameraBookmarkId: plan.experienceMode === "analytic_auto"
        ? sceneMoment?.cameraBookmarkId || stage?.cameraBookmarkId || null
        : null,
      focusTargets: mergedFocusTargets,
      visibleObjectIds: plan.experienceMode === "analytic_auto" ? (sceneMoment?.visibleObjectIds || []) : [],
      visibleOverlayIds: plan.experienceMode === "analytic_auto" ? (sceneMoment?.visibleOverlayIds || []) : [],
      revealFormula: Boolean(plan.experienceMode === "analytic_auto" && (sceneMoment?.revealFormula || revealSolution)),
      revealFullSolution: Boolean(plan.experienceMode === "analytic_auto" && (sceneMoment?.revealFullSolution || revealSolution)),
    },
  };
}
