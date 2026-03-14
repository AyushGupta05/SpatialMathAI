import { normalizeScenePlan } from "../../src/ai/planSchema.js";
import { normalizeSceneSnapshot } from "../../src/scene/schema.js";

function ratioScore(expected, actual) {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return 0;
  const baseline = Math.max(0.0001, Math.abs(expected));
  const delta = Math.abs(expected - actual) / baseline;
  return Math.max(0, 1 - delta);
}

function objectDimensionScore(expectedObject, actualObject) {
  if (expectedObject.shape !== actualObject.shape) return 0;
  const expectedParams = expectedObject.params || {};
  const actualParams = actualObject.params || {};

  switch (expectedObject.shape) {
    case "cube":
      return ratioScore(expectedParams.size, actualParams.size);
    case "cuboid":
      return (
        ratioScore(expectedParams.width, actualParams.width) +
        ratioScore(expectedParams.height, actualParams.height) +
        ratioScore(expectedParams.depth, actualParams.depth)
      ) / 3;
    case "sphere":
      return ratioScore(expectedParams.radius, actualParams.radius);
    case "cylinder":
    case "cone":
      return (
        ratioScore(expectedParams.radius, actualParams.radius) +
        ratioScore(expectedParams.height, actualParams.height)
      ) / 2;
    case "pyramid":
      return (
        ratioScore(expectedParams.base, actualParams.base) +
        ratioScore(expectedParams.height, actualParams.height)
      ) / 2;
    case "plane":
      return (
        ratioScore(expectedParams.width, actualParams.width) +
        ratioScore(expectedParams.depth, actualParams.depth)
      ) / 2;
    case "line": {
      const expectedLength = Math.hypot(
        expectedParams.end[0] - expectedParams.start[0],
        expectedParams.end[1] - expectedParams.start[1],
        expectedParams.end[2] - expectedParams.start[2]
      );
      const actualLength = Math.hypot(
        actualParams.end[0] - actualParams.start[0],
        actualParams.end[1] - actualParams.start[1],
        actualParams.end[2] - actualParams.start[2]
      );
      return ratioScore(expectedLength, actualLength);
    }
    case "pointMarker":
      return ratioScore(expectedParams.radius, actualParams.radius);
    default:
      return 0;
  }
}

function findBestMatch(suggestion, sceneObjects, usedIds) {
  for (const objectSpec of sceneObjects) {
    if (usedIds.has(objectSpec.id)) continue;
    const metadata = objectSpec.metadata || {};
    if (
      objectSpec.id === suggestion.object.id ||
      metadata.sourceSuggestionId === suggestion.id ||
      metadata.suggestionId === suggestion.id ||
      metadata.guidedObjectId === suggestion.object.id
    ) {
      usedIds.add(objectSpec.id);
      return { object: objectSpec, score: 1 };
    }
  }

  let best = null;
  let bestScore = 0;

  for (const objectSpec of sceneObjects) {
    if (usedIds.has(objectSpec.id)) continue;
    const score = objectDimensionScore(suggestion.object, objectSpec);
    if (score > bestScore) {
      best = objectSpec;
      bestScore = score;
    }
  }

  if (bestScore >= 0.72) {
    usedIds.add(best.id);
    return { object: best, score: bestScore };
  }

  return null;
}

function titlesForSuggestionIds(plan, ids = []) {
  const byId = new Map((plan?.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion.title]));
  return ids.map((id) => byId.get(id) || id);
}

function suggestionById(plan, suggestionId) {
  return plan.objectSuggestions.find((suggestion) => suggestion.id === suggestionId) || null;
}

function defaultActiveStep(plan, stepAssessments) {
  if (!stepAssessments.length) return null;
  const firstIncomplete = stepAssessments.find((step) => !step.complete);
  return firstIncomplete || stepAssessments[stepAssessments.length - 1] || null;
}

function buildCoachFeedback({ plan, snapshot, activeStep, allRequiredComplete }) {
  const selectedObject = snapshot.objects.find((objectSpec) => objectSpec.id === snapshot.selectedObjectId) || null;
  const missingTitles = titlesForSuggestionIds(plan, activeStep?.missingObjectIds || []);

  if (!snapshot.objects.length) {
    const firstRequired = suggestionById(plan, activeStep?.missingObjectIds?.[0] || activeStep?.requiredObjectIds?.[0]);
    return firstRequired
      ? `The lesson scene should already include ${firstRequired.title}. Reload the lesson if it is missing.`
      : "The lesson scene should already be visible. Reload the lesson if it is missing.";
  }

  if (missingTitles.length) {
    return `Next, add ${missingTitles.join(" and ")} for ${activeStep?.title || "the active build step"}.`;
  }

  if (selectedObject && !allRequiredComplete) {
    return `Good. ${selectedObject.label || selectedObject.shape} is selected, so inspect it and finish the current step.`;
  }

  if (allRequiredComplete) {
    if (selectedObject) {
      return `The scene is ready. Use ${selectedObject.label || selectedObject.shape} to make a prediction before solving.`;
    }
    return "The scene is ready. Make a short prediction before asking for the explanation.";
  }

  return `${activeStep?.title || "This step"} looks complete. Move to the next visible relationship.`;
}

function analyticAssessment(plan, snapshot, currentStepId = null) {
  const sceneMoments = plan.sceneMoments || [];
  const activeStep = plan.buildSteps.find((step) => step.id === currentStepId)
    || plan.buildSteps[0]
    || null;
  const activeMoment = sceneMoments.find((moment) => moment.id === (activeStep?.id || currentStepId))
    || sceneMoments[0]
    || null;
  return {
    summary: {
      objectCount: snapshot.objects.length,
      matchedRequiredObjects: snapshot.objects.length,
      totalRequiredObjects: snapshot.objects.length,
      completionRatio: 1,
      currentStepId: activeStep?.id || currentStepId || null,
    },
    objectAssessments: [],
    stepAssessments: plan.buildSteps.map((step) => ({
      stepId: step.id,
      title: step.title,
      complete: true,
      missingObjectIds: [],
      feedback: `${step.title} is available in the auto-rendered scene.`,
    })),
    activeStep: activeStep
      ? {
        stepId: activeStep.id,
        title: activeStep.title,
        complete: true,
        missingObjectIds: [],
        feedback: activeMoment?.goal || activeStep.instruction || "",
      }
      : null,
    answerGate: {
      allowed: true,
      reason: "The analytic scene is ready for explanation.",
    },
    guidance: {
      currentStepId: activeStep?.id || null,
      currentStepTitle: activeStep?.title || "",
      nextRequiredSuggestionIds: [],
      readyForPrediction: true,
      matchedSuggestionIds: plan.objectSuggestions.map((suggestion) => suggestion.id),
      coachFeedback: activeMoment?.goal || activeStep?.instruction || plan.sceneFocus?.primaryInsight || "Use the scene and formula together.",
      missingTitles: [],
      selectedObjectId: snapshot.selectedObjectId || null,
    },
  };
}

export function evaluateBuild(planInput, snapshotInput, currentStepId = null) {
  const plan = normalizeScenePlan(planInput);
  const snapshot = normalizeSceneSnapshot(snapshotInput);
  if (plan.experienceMode === "analytic_auto") {
    return analyticAssessment(plan, snapshot, currentStepId);
  }
  const usedIds = new Set();

  const objectAssessments = plan.objectSuggestions.map((suggestion) => {
    const match = findBestMatch(suggestion, snapshot.objects, usedIds);
    return {
      suggestionId: suggestion.id,
      objectId: suggestion.object.id,
      title: suggestion.title,
      optional: suggestion.optional,
      matchedObjectId: match?.object?.id || null,
      present: Boolean(match),
      score: Number((match?.score || 0).toFixed(2)),
      feedback: match
        ? `${suggestion.title} is present.`
        : `Missing ${suggestion.title}.`,
    };
  });

  const bySuggestionId = new Map(objectAssessments.map((assessment) => [assessment.suggestionId, assessment]));
  const stepAssessments = plan.buildSteps.map((step) => {
    const requiredIds = step.requiredObjectIds || [];
    const missingObjectIds = requiredIds.filter((id) => !bySuggestionId.get(id)?.present);
    const complete = missingObjectIds.length === 0;
    return {
      stepId: step.id,
      title: step.title,
      complete,
      missingObjectIds,
      feedback: complete
        ? `${step.title} looks complete.`
        : `Still needed for ${step.title}: ${missingObjectIds.join(", ") || "scene details"}.`,
    };
  });

  const requiredObjects = objectAssessments.filter((assessment) => !assessment.optional);
  const matchedRequiredObjects = requiredObjects.filter((assessment) => assessment.present).length;
  const requestedActiveStep = currentStepId
    ? stepAssessments.find((step) => step.stepId === currentStepId) || null
    : null;
  const allRequiredComplete = matchedRequiredObjects >= requiredObjects.length;
  const activeStep = requestedActiveStep || defaultActiveStep(plan, stepAssessments);
  const nextRequiredSuggestionIds = activeStep?.missingObjectIds?.length
    ? activeStep.missingObjectIds
    : [];
  const readyForPrediction = Boolean(activeStep?.complete || allRequiredComplete);
  const matchedSuggestionIds = objectAssessments
    .filter((assessment) => assessment.present)
    .map((assessment) => assessment.suggestionId);
  const coachFeedback = buildCoachFeedback({
    plan,
    snapshot,
    activeStep,
    allRequiredComplete,
  });

  return {
    summary: {
      objectCount: snapshot.objects.length,
      matchedRequiredObjects,
      totalRequiredObjects: requiredObjects.length,
      completionRatio: requiredObjects.length ? Number((matchedRequiredObjects / requiredObjects.length).toFixed(2)) : 1,
      currentStepId: activeStep?.stepId || currentStepId || null,
    },
    objectAssessments,
    stepAssessments,
    activeStep,
    answerGate: {
      allowed: allRequiredComplete,
      reason: allRequiredComplete
        ? "Scene ready enough to answer."
        : "Inspect the remaining key objects before answering.",
    },
    guidance: {
      currentStepId: activeStep?.stepId || null,
      currentStepTitle: activeStep?.title || "",
      nextRequiredSuggestionIds,
      readyForPrediction,
      matchedSuggestionIds,
      coachFeedback,
      missingTitles: titlesForSuggestionIds(plan, nextRequiredSuggestionIds),
      selectedObjectId: snapshot.selectedObjectId || null,
    },
  };
}
