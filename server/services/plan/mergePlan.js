import { normalizeScenePlan } from "../../../src/ai/planSchema.js";

const SOLID_METRIC_SHAPES = new Set(["cube", "cuboid", "sphere", "cylinder", "cone", "pyramid"]);

function primaryShape(plan = {}) {
  return plan?.objectSuggestions?.[0]?.object?.shape || "";
}

function shouldPreferBaselineMetricScaffold(baselinePlan = {}, novaPlan = {}) {
  const questionType = baselinePlan?.problem?.questionType || "";
  if (!["surface_area", "volume"].includes(questionType)) {
    return false;
  }

  if (!SOLID_METRIC_SHAPES.has(primaryShape(baselinePlan))) {
    return false;
  }

  const inputMode = novaPlan?.sourceSummary?.inputMode || baselinePlan?.sourceSummary?.inputMode || "";
  return inputMode === "image" || inputMode === "multimodal";
}

export function mergeGeneratedPlan({ baselinePlan, novaPlan, workingQuestion, mode }) {
  const preserveAnalytic = baselinePlan?.experienceMode === "analytic_auto";
  if (preserveAnalytic) {
    return normalizeScenePlan({
      ...baselinePlan,
      problem: {
        ...baselinePlan.problem,
        ...novaPlan.problem,
        question: workingQuestion,
        mode,
      },
      sourceSummary: {
        ...baselinePlan.sourceSummary,
        ...novaPlan.sourceSummary,
      },
      agentTrace: (novaPlan.agentTrace?.length || 0)
        ? novaPlan.agentTrace
        : baselinePlan.agentTrace,
      demoPreset: novaPlan.demoPreset || baselinePlan.demoPreset || null,
    });
  }
  const preferNovaScaffold = !preserveAnalytic && novaPlan?.experienceMode === "analytic_auto";
  const preferBaselineMetricScaffold = !preserveAnalytic
    && !preferNovaScaffold
    && shouldPreferBaselineMetricScaffold(baselinePlan, novaPlan);
  return normalizeScenePlan({
    ...baselinePlan,
    ...novaPlan,
    problem: {
      ...baselinePlan.problem,
      ...novaPlan.problem,
      question: workingQuestion,
      mode,
    },
    sourceSummary: {
      ...baselinePlan.sourceSummary,
      ...novaPlan.sourceSummary,
    },
    sceneFocus: {
      ...baselinePlan.sceneFocus,
      ...novaPlan.sceneFocus,
    },
    learningMoments: {
      ...baselinePlan.learningMoments,
      ...novaPlan.learningMoments,
    },
    overview: novaPlan.overview || baselinePlan.overview,
    objectSuggestions: preferBaselineMetricScaffold
      ? baselinePlan.objectSuggestions
      : preferNovaScaffold
      ? (novaPlan.objectSuggestions?.length ? novaPlan.objectSuggestions : baselinePlan.objectSuggestions)
      : (novaPlan.objectSuggestions?.length || 0) >= baselinePlan.objectSuggestions.length
      ? novaPlan.objectSuggestions
      : baselinePlan.objectSuggestions,
    buildSteps: preferBaselineMetricScaffold
      ? baselinePlan.buildSteps
      : preferNovaScaffold
      ? (novaPlan.buildSteps?.length ? novaPlan.buildSteps : baselinePlan.buildSteps)
      : (novaPlan.buildSteps?.length || 0) >= baselinePlan.buildSteps.length
      ? novaPlan.buildSteps
      : baselinePlan.buildSteps,
    cameraBookmarks: preferBaselineMetricScaffold
      ? baselinePlan.cameraBookmarks
      : preferNovaScaffold
      ? (novaPlan.cameraBookmarks?.length ? novaPlan.cameraBookmarks : baselinePlan.cameraBookmarks)
      : (novaPlan.cameraBookmarks?.length || 0)
      ? novaPlan.cameraBookmarks
      : baselinePlan.cameraBookmarks,
    answerScaffold: {
      ...baselinePlan.answerScaffold,
      ...novaPlan.answerScaffold,
    },
    challengePrompts: preferBaselineMetricScaffold
      ? baselinePlan.challengePrompts
      : preferNovaScaffold
      ? (novaPlan.challengePrompts?.length ? novaPlan.challengePrompts : baselinePlan.challengePrompts)
      : (novaPlan.challengePrompts?.length || 0)
      ? novaPlan.challengePrompts
      : baselinePlan.challengePrompts,
    liveChallenge: novaPlan.liveChallenge || baselinePlan.liveChallenge || null,
    sourceEvidence: novaPlan.sourceEvidence || baselinePlan.sourceEvidence || null,
    experienceMode: preserveAnalytic ? baselinePlan.experienceMode : (novaPlan.experienceMode || baselinePlan.experienceMode || "builder"),
    analyticContext: preserveAnalytic ? baselinePlan.analyticContext : (novaPlan.analyticContext || baselinePlan.analyticContext || null),
    sceneMoments: preserveAnalytic || preferBaselineMetricScaffold
      ? baselinePlan.sceneMoments
      : (novaPlan.sceneMoments || baselinePlan.sceneMoments || []),
    sceneOverlays: preserveAnalytic || preferBaselineMetricScaffold
      ? baselinePlan.sceneOverlays
      : (novaPlan.sceneOverlays || baselinePlan.sceneOverlays || []),
    agentTrace: (novaPlan.agentTrace?.length || 0)
      ? novaPlan.agentTrace
      : baselinePlan.agentTrace,
    demoPreset: novaPlan.demoPreset || baselinePlan.demoPreset || null,
  });
}
