import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildSolutionRevealText, isExplicitSolutionRequest } from "../../src/core/tutorSolution.js";
import { evaluateBuild } from "../services/buildEvaluator.js";
import { generateFreeformTutorTurn, buildFallbackFreeformTurn } from "../services/freeformTutor.js";
import { evaluateTutorCompletion } from "../services/tutorCompletion.js";
import { buildTutorSystemPrompt, buildFallbackTutorReply, buildFullSolutionReveal } from "../services/tutorPrompt.js";
import { converseStreamWithModelFailover } from "../services/modelInvoker.js";
import { buildTutorResponseMeta } from "../services/tutorMetadata.js";
import { generateSimilarTutorQuestions } from "../services/tutorSimilar.js";
import { evaluateConcept, isTrivialInteraction } from "../services/conceptEvaluator.js";
import { currentVerdictEntry } from "../../src/core/tutorActions.js";

const LEARNING_STAGE_SEQUENCE = ["orient", "build", "predict", "check", "reflect", "challenge"];

function learningMomentStage(plan, learningStage = "build") {
  const moment = plan?.learningMoments?.[learningStage] || {};
  return {
    id: `${learningStage}-stage`,
    learningStage,
    title: moment.title || learningStage,
    goal: moment.goal || "",
    checkpointPrompt: moment.prompt || "",
    checkpoint: moment.prompt ? { prompt: moment.prompt } : null,
    requires_evaluation: ["predict", "check", "reflect"].includes(learningStage),
  };
}

function nextLearningStage(current = "orient", conceptVerdict = null, assessment = null) {
  if (conceptVerdict?.verdict !== "CORRECT") {
    return current;
  }
  if (current === "build" && !assessment?.guidance?.readyForPrediction) {
    return current;
  }
  const index = LEARNING_STAGE_SEQUENCE.indexOf(current);
  if (index < 0) return current;
  return LEARNING_STAGE_SEQUENCE[Math.min(index + 1, LEARNING_STAGE_SEQUENCE.length - 1)];
}

function currentStageForReply(plan, learningState = {}, contextStepId = null, assessment = null) {
  if (["predict", "check", "reflect", "challenge"].includes(learningState?.learningStage)) {
    return learningMomentStage(plan, learningState.learningStage);
  }
  const stageId = contextStepId
    || assessment?.guidance?.currentStepId
    || plan?.buildSteps?.[learningState?.currentStep || 0]?.id
    || null;
  return plan?.lessonStages?.find((stage) => stage.id === stageId)
    || plan?.lessonStages?.[0]
    || null;
}

function stagePayload(stage = null) {
  if (!stage) return null;
  return {
    ...stage,
    checkpoint: stage.checkpoint || (stage.checkpointPrompt ? { prompt: stage.checkpointPrompt } : null),
  };
}

function nextStageForReply(plan, learningState = {}, contextStepId = null, assessment = null, conceptVerdict = null) {
  const currentStage = currentStageForReply(plan, learningState, contextStepId, assessment);
  if (!currentStage) return null;
  if (plan?.experienceMode === "analytic_auto") {
    if (conceptVerdict?.verdict !== "CORRECT") {
      return currentStage;
    }
    const currentIndex = Math.max(0, plan.lessonStages.findIndex((stage) => stage.id === currentStage.id));
    return plan.lessonStages[currentIndex + 1] || currentStage;
  }
  const nextStageKey = nextLearningStage(learningState?.learningStage || "orient", conceptVerdict, assessment);
  if (["predict", "check", "reflect", "challenge"].includes(nextStageKey)) {
    return learningMomentStage(plan, nextStageKey);
  }
  if (conceptVerdict?.verdict !== "CORRECT") {
    return currentStage;
  }
  const currentIndex = Math.max(0, plan.lessonStages.findIndex((stage) => stage.id === currentStage.id));
  return plan.lessonStages[currentIndex + 1] || currentStage;
}

function sceneMomentForStageId(plan, stageId = null) {
  if (!plan?.sceneMoments?.length || !stageId) return null;
  return plan.sceneMoments.find((moment) => moment.id === stageId) || null;
}

function suggestionForId(plan, suggestionId = null) {
  if (!plan?.objectSuggestions?.length || !suggestionId) return null;
  return plan.objectSuggestions.find((suggestion) => suggestion.id === suggestionId) || null;
}

function buildSceneSnapshotForMoment(plan, moment = null) {
  if (!moment?.visibleObjectIds?.length) {
    return { objects: [], selectedObjectId: null };
  }
  return {
    objects: moment.visibleObjectIds
      .map((suggestionId) => suggestionForId(plan, suggestionId)?.object || null)
      .filter(Boolean)
      .map((objectSpec) => ({ ...objectSpec })),
    selectedObjectId: null,
  };
}

function lineCountForMoment(plan, moment = null) {
  if (!moment?.visibleObjectIds?.length) return 0;
  return moment.visibleObjectIds.reduce((count, suggestionId) => {
    const suggestion = suggestionForId(plan, suggestionId);
    return suggestion?.object?.shape === "line" ? count + 1 : count;
  }, 0);
}

function objectLabelsForMoment(plan, moment = null) {
  if (!moment?.visibleObjectIds?.length) return [];
  return moment.visibleObjectIds
    .map((suggestionId) => suggestionForId(plan, suggestionId))
    .filter(Boolean)
    .map((suggestion) => String(suggestion.object?.label || suggestion.title || suggestion.id || "").trim())
    .filter(Boolean);
}

function visualRevealRequestTarget(plan, learningState = {}, contextStepId = null, assessment = null, userMessage = "") {
  if (plan?.experienceMode !== "analytic_auto" || !plan?.sceneMoments?.length) {
    return null;
  }

  const lower = String(userMessage || "").toLowerCase();
  const wantsVisualReveal = /\b(draw|show|reveal|display|visuali[sz]e|plot|add|bring up|move on|next|continue)\b/.test(lower);
  const reportsMissingVisual = /\b(not|aren't|isn't|missing|dont|don't|do not|cant|can't)\b.*\b(drawn|shown|visible|there)\b/.test(lower);
  if (!wantsVisualReveal && !reportsMissingVisual) {
    return null;
  }

  const currentStage = currentStageForReply(plan, learningState, contextStepId, assessment);
  const currentIndex = Math.max(0, plan.sceneMoments.findIndex((moment) => moment.id === currentStage?.id));
  const futureMoments = plan.sceneMoments.slice(currentIndex + 1);
  if (!futureMoments.length) {
    return null;
  }

  const asksForFormula = /\bformula|solution|answer\b/.test(lower);
  const requestedLabels = [...new Set(
    (plan.objectSuggestions || [])
      .map((suggestion) => String(suggestion.object?.label || suggestion.title || suggestion.id || "").trim())
      .filter(Boolean)
      .filter((label) => lower.includes(label.toLowerCase()))
  )];
  const pluralVectorRequest = /\bvectors\b/.test(lower) || /\blines\b/.test(lower);
  const singularVectorRequest = /\bvector\b/.test(lower) || /\bline\b/.test(lower);

  const scoredMoments = futureMoments
    .filter((moment) => asksForFormula || !moment.revealFullSolution)
    .map((moment, index) => {
      const labels = objectLabelsForMoment(plan, moment);
      const lineCount = lineCountForMoment(plan, moment);
      let score = 0;

      if (requestedLabels.length) {
        score += requestedLabels.reduce((sum, label) => sum + (labels.includes(label) ? 4 : 0), 0);
      }
      if (pluralVectorRequest) {
        score += lineCount >= 2 ? 4 : lineCount;
      } else if (singularVectorRequest) {
        score += lineCount >= 1 ? 2 : 0;
      }
      if (wantsVisualReveal && index === 0) {
        score += 1;
      }
      if (reportsMissingVisual && lineCount > 0) {
        score += 2;
      }
      if (!asksForFormula && moment.revealFormula) {
        score -= 1;
      }

      return { moment, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!scoredMoments.length) {
    return futureMoments[0] || null;
  }
  if (scoredMoments[0].score <= 0) {
    return futureMoments[0] || null;
  }
  return scoredMoments[0].moment;
}

async function streamAnalyticVisualRevealReply(c, requestPayload) {
  const {
    plan,
    learningState = {},
    contextStepId = null,
    userMessage = "",
  } = requestPayload;

  const assessment = evaluateBuild(plan, requestPayload.sceneSnapshot, contextStepId);
  const targetMoment = visualRevealRequestTarget(plan, learningState, contextStepId, assessment, userMessage);
  if (!targetMoment) {
    return null;
  }

  const targetAssessment = evaluateBuild(plan, buildSceneSnapshotForMoment(plan, targetMoment), targetMoment.id);
  const responseMeta = buildTutorResponseMeta({
    plan,
    learningState,
    contextStepId: targetMoment.id,
    assessment: targetAssessment,
    completionState: { complete: false, reason: null },
    userMessage,
    conceptVerdict: null,
    responseKind: "non_evaluated",
  });
  responseMeta.stageStatus = {
    ...(responseMeta.stageStatus || {}),
    currentStageId: targetMoment.id,
  };
  responseMeta.nextLearningStage = learningState?.learningStage || "build";

  const revealText = targetMoment.prompt
    ? `Let's reveal the next visual step. ${targetMoment.prompt}`
    : "Let's reveal the next visual step in the scene.";

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: responseMeta }) });
    await stream.writeSSE({ data: JSON.stringify({ type: "text", content: revealText }) });
    await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: targetAssessment }) });
    await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
  });
}

export function createTutorRoute({
  streamModel = converseStreamWithModelFailover,
  freeformTurnGenerator = generateFreeformTutorTurn,
  completionEvaluator = evaluateTutorCompletion,
  conceptEvaluator = evaluateConcept,
  trivialityCheck = isTrivialInteraction,
  similarQuestionGenerator = generateSimilarTutorQuestions,
} = {}) {
  const tutorRoute = new Hono();

  function hintInstructionForType(hintType = "nudge", gap = "") {
    switch (hintType) {
      case "focus":
        return "The learner wants to know what to focus on in the current scene. Describe ONE specific thing visible in the 3D scene that is most relevant to the stage goal. Do not mention the formula. Max 2 sentences.";
      case "entry":
        return "The learner does not know how to start. Give them the first step only - not the full approach. Frame it as a question they can answer by looking at the scene. Max 2 sentences.";
      case "nudge":
        return "The learner is stuck. Give a single targeted observation that redirects their attention without revealing the answer. Reference something specific in the current scene. End with a question. Max 2 sentences.";
      case "deeper":
        return "The learner has already had one hint and is still stuck. Give a more direct scaffold - break the problem into a simpler sub-question. Still do not give the answer. End with a question. Max 2 sentences.";
      case "gap":
        return `The learner partially understands but missed: ${gap || "an important missing step"}. Acknowledge what they got right in one clause. Then redirect specifically to ${gap || "that gap"} using a question about what they see in the scene. Max 2 sentences.`;
      case "walkthrough":
        return "Walk the learner through the first step of the analytic approach. Name the method. Give step 1 only. End by asking them to try step 2. Max 3 sentences.";
      case "build_next":
        return "Tell the learner which object or element should be placed next in the scene and why it matters for the problem. Do not place it for them. Max 2 sentences.";
      case "reflect":
        return "Help the learner connect what they just calculated to what they can see in the scene. Ask them to describe in their own words what the result means visually. Max 2 sentences.";
      default:
        return "Give one concise hint that points to the most relevant visible clue in the scene. End with a question. Max 2 sentences.";
    }
  }

  async function streamSpecialTutorReply(c, requestPayload, {
    instruction = "",
    responseKind = "non_evaluated",
    maxTokens = 300,
    temperature = 0.3,
  } = {}) {
    const {
      plan,
      sceneSnapshot,
      sceneContext = null,
      learningState = {},
      userMessage,
      contextStepId = null,
      hint_state = null,
    } = requestPayload;
    const effectiveLearningState = {
      ...learningState,
      hint_state: hint_state || learningState?.hint_state || null,
    };
    const effectiveSceneContext = {
      ...(sceneContext || {}),
      hint_state: effectiveLearningState.hint_state || null,
    };
    const modelUserMessage = userMessage === "__hint_request__"
      ? "Please give me a hint for this stage."
      : userMessage === "__connection_request__"
        ? "How does this connect to the next idea?"
        : userMessage;
    const assessment = evaluateBuild(plan, sceneSnapshot, contextStepId);
    const currentVerdict = currentVerdictEntry(effectiveLearningState);
    const responseMeta = buildTutorResponseMeta({
      plan,
      learningState: effectiveLearningState,
      contextStepId,
      assessment,
      completionState: { complete: false, reason: null },
      userMessage,
      conceptVerdict: currentVerdict,
      responseKind,
    });
    const systemPrompt = `${buildTutorSystemPrompt({
      plan,
      sceneSnapshot,
      sceneContext: effectiveSceneContext,
      learningState: effectiveLearningState,
      contextStepId,
      assessment,
      conceptVerdict: currentVerdict,
    })}

Additional instruction for this turn:
${instruction}`.trim();
    const history = Array.isArray(effectiveLearningState.history) ? effectiveLearningState.history : [];
    const messages = [];
    for (const message of history.slice(-8)) {
      const role = message.role === "tutor" ? "assistant" : message.role;
      if (!["user", "assistant"].includes(role)) continue;
      if (messages.length && messages[messages.length - 1].role === role) continue;
      messages.push({ role, content: [{ text: String(message.content || "") }] });
    }
    while (messages.length && messages[0].role !== "user") {
      messages.shift();
    }
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: [{ text: modelUserMessage }] });
    } else {
      messages[messages.length - 1] = { role: "user", content: [{ text: modelUserMessage }] };
    }

    return streamSSE(c, async (stream) => {
      try {
        await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: responseMeta }) });
        for await (const chunk of streamModel("text", systemPrompt, messages, {
          maxTokens,
          temperature,
        })) {
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: chunk }) });
        }
        await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessment }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      } catch (error) {
        console.error("Tutor special stream error:", error);
        const fallbackText = buildFallbackTutorReply({
          plan,
          assessment,
          sceneContext: effectiveSceneContext,
          userMessage,
          contextStepId,
        });
        await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: responseMeta }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "text", content: typeof fallbackText === "string" ? fallbackText : "Take another look at the scene." }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessment }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "done", fallback: true }) });
      }
    });
  }

  async function handleHintRequest(c, requestPayload) {
    return streamSpecialTutorReply(c, requestPayload, {
      instruction: hintInstructionForType(requestPayload?.hint_type, requestPayload?.gap || ""),
      responseKind: "verdict",
      maxTokens: 300,
      temperature: 0.25,
    });
  }

  async function handleConnectionRequest(c, requestPayload) {
    return streamSpecialTutorReply(c, requestPayload, {
      instruction: "In 1-2 sentences, explain how the concept just demonstrated (from the completed stage) connects to what comes next in the lesson. Be concrete - reference the specific objects or measurements visible in the scene. Do not repeat what was just learned. End with a forward-looking statement.",
      responseKind: "connection_followup",
      maxTokens: 300,
      temperature: 0.2,
    });
  }

  async function streamGuidedTutorReply(c, requestPayload, { skipEvaluation = false } = {}) {
    const {
      plan,
      sceneSnapshot,
      sceneContext = null,
      learningState = {},
      userMessage,
      contextStepId = null,
      hint_state = null,
    } = requestPayload;
    const effectiveLearningState = {
      ...learningState,
      hint_state: hint_state || learningState?.hint_state || null,
    };
    const effectiveSceneContext = {
      ...(sceneContext || {}),
      hint_state: effectiveLearningState.hint_state || null,
    };

    const assessment = evaluateBuild(plan, sceneSnapshot, contextStepId);
    const revealSolution = isExplicitSolutionRequest(userMessage);
    const numericCompletion = revealSolution
      ? { complete: true, reason: "revealed-solution" }
      : completionEvaluator({ plan, userMessage });

    let conceptVerdict = null;
    if (numericCompletion.complete) {
      conceptVerdict = {
        verdict: "CORRECT",
        confidence: 1.0,
        what_was_right: "Correct answer",
        gap: null,
        misconception_type: null,
        scene_cue: null,
        tutor_tone: "encouraging",
      };
    } else if (!skipEvaluation && !revealSolution && !trivialityCheck(effectiveLearningState?.learningStage, userMessage)) {
      const currentStage = currentStageForReply(plan, effectiveLearningState, contextStepId, assessment);
      const currentStep = plan.buildSteps?.find((s) => s.id === contextStepId)
        || plan.buildSteps?.[effectiveLearningState?.currentStep || 0];
      const stageGoal = currentStage?.goal
        || currentStep?.instruction
        || currentStep?.focusConcept
        || plan.sceneFocus?.primaryInsight
        || plan.learningMoments?.[effectiveLearningState?.learningStage]?.goal
        || "";
      try {
        conceptVerdict = await conceptEvaluator({
          stageGoal,
          learnerInput: userMessage,
          lessonContext: { plan, assessment },
          prediction: effectiveLearningState?.predictionState?.response || "",
          learnerHistory: effectiveLearningState?.learnerHistory || [],
        });
      } catch (err) {
        console.error("Concept evaluation failed:", err);
        conceptVerdict = null;
      }
    }

    const completionState = numericCompletion.complete
      ? numericCompletion
      : { complete: false, reason: null };
    const nextStage = nextStageForReply(plan, effectiveLearningState, contextStepId, assessment, conceptVerdict);
    const nextLearningStageKey = plan?.experienceMode === "analytic_auto"
      ? (effectiveLearningState?.learningStage || "build")
      : nextLearningStage(effectiveLearningState?.learningStage || "orient", conceptVerdict, assessment);

    const responseKind = revealSolution
      ? "solution_shown"
      : conceptVerdict?.verdict
        ? "verdict"
        : skipEvaluation || requestPayload?.requires_evaluation === false
          ? "non_evaluated"
          : "stage_opening";
    const solutionReveal = revealSolution ? buildFullSolutionReveal(plan, effectiveSceneContext) : null;
    const responseMeta = buildTutorResponseMeta({
      plan,
      learningState: effectiveLearningState,
      contextStepId,
      assessment,
      completionState,
      userMessage,
      conceptVerdict,
      responseKind,
      solutionReveal: solutionReveal
        ? {
          isSolutionReveal: true,
          sections: solutionReveal.sections,
        }
        : null,
    });
    if (nextStage?.id) {
      responseMeta.stageStatus = {
        ...(responseMeta.stageStatus || {}),
        currentStageId: nextStage.id,
      };
      if (
        plan?.experienceMode === "analytic_auto"
        && conceptVerdict?.verdict === "CORRECT"
        && !completionState.complete
      ) {
        const nextSceneMoment = sceneMomentForStageId(plan, nextStage.id);
        if (nextSceneMoment) {
          responseMeta.focusTargets = nextSceneMoment.focusTargets?.length
            ? nextSceneMoment.focusTargets
            : responseMeta.focusTargets;
          responseMeta.sceneDirective = {
            ...(responseMeta.sceneDirective || {}),
            stageId: nextSceneMoment.id,
            cameraBookmarkId: nextSceneMoment.cameraBookmarkId || responseMeta.sceneDirective?.cameraBookmarkId || null,
            focusTargets: responseMeta.focusTargets,
            visibleObjectIds: nextSceneMoment.visibleObjectIds || [],
            visibleOverlayIds: nextSceneMoment.visibleOverlayIds || [],
            revealFormula: Boolean(nextSceneMoment.revealFormula),
            revealFullSolution: Boolean(nextSceneMoment.revealFullSolution),
          };
        }
      }
    }
    responseMeta.nextLearningStage = nextLearningStageKey;
    if (conceptVerdict?.verdict === "CORRECT" && nextStage?.checkpointPrompt) {
      responseMeta.checkpoint = {
        prompt: nextStage.checkpointPrompt,
        options: ["yes", "not_sure"],
      };
    }

    const assessmentPayload = {
      ...(assessment || {}),
      verdict: conceptVerdict?.verdict ?? null,
      nextStage: stagePayload(nextStage),
      nextLearningStage: nextLearningStageKey,
    };
    const systemPrompt = buildTutorSystemPrompt({
      plan,
      sceneSnapshot,
      sceneContext: effectiveSceneContext,
      learningState: effectiveLearningState,
      contextStepId,
      assessment,
      conceptVerdict,
    });

    const history = Array.isArray(effectiveLearningState.history) ? effectiveLearningState.history : [];
    const messages = [];
    for (const message of history.slice(-8)) {
      const role = message.role === "tutor" ? "assistant" : message.role;
      if (!["user", "assistant"].includes(role)) continue;
      if (messages.length && messages[messages.length - 1].role === role) continue;
      messages.push({ role, content: [{ text: String(message.content || "") }] });
    }
    while (messages.length && messages[0].role !== "user") {
      messages.shift();
    }
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: [{ text: userMessage }] });
    } else {
      messages[messages.length - 1] = { role: "user", content: [{ text: userMessage }] };
    }

    return streamSSE(c, async (stream) => {
      try {
        await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: { ...responseMeta, conceptVerdict } }) });
        if (revealSolution && solutionReveal) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "text",
              content: solutionReveal.transcriptText || buildSolutionRevealText(plan) || "Here is the worked solution.",
            }),
          });
          await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessmentPayload }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
          return;
        }
        for await (const chunk of streamModel("text", systemPrompt, messages, {
          maxTokens: 1024,
          temperature: 0.35,
        })) {
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: chunk }) });
        }
        await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessmentPayload }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      } catch (error) {
        console.error("Tutor stream error:", error);
        const fallbackText = revealSolution && solutionReveal
          ? solutionReveal.transcriptText
          : buildFallbackTutorReply({
          plan,
          assessment,
          sceneContext: effectiveSceneContext,
          userMessage,
          contextStepId,
        });
        await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: responseMeta }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "text", content: fallbackText }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessmentPayload }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "done", fallback: true }) });
      }
    });
  }

  async function handleConversationalReply(c, requestPayload) {
    return streamGuidedTutorReply(c, requestPayload, { skipEvaluation: true });
  }

  tutorRoute.post("/", async (c) => {
    try {
      const {
        plan,
        sceneSnapshot,
        sceneContext = null,
        learningState = {},
        userMessage,
        contextStepId = null,
        requires_evaluation = true,
        input_source = "text",
        hint_state = null,
        hint_type = null,
        gap = null,
        hint_level = null,
      } = await c.req.json();

      if (!sceneSnapshot || !userMessage || typeof userMessage !== "string") {
        return c.json({ error: "sceneSnapshot and userMessage are required" }, 400);
      }

      if (userMessage === "__hint_request__") {
        return handleHintRequest(c, {
          plan,
          sceneSnapshot,
          sceneContext,
          learningState,
          userMessage,
          contextStepId,
          input_source,
          hint_state,
          hint_type,
          gap,
          hint_level,
        });
      }

      if (userMessage === "__connection_request__") {
        return handleConnectionRequest(c, {
          plan,
          sceneSnapshot,
          sceneContext,
          learningState,
          userMessage,
          contextStepId,
          input_source,
          hint_state,
        });
      }

      if (!plan) {
        let freeformTurn;
        try {
          freeformTurn = await freeformTurnGenerator({
            sceneSnapshot,
            sceneContext,
            learningState,
            userMessage,
          });
        } catch (error) {
          console.error("Tutor freeform error:", error);
          freeformTurn = buildFallbackFreeformTurn({
            sceneSnapshot,
            sceneContext,
            userMessage,
          });
        }

        return streamSSE(c, async (stream) => {
          await stream.writeSSE({ data: JSON.stringify({ type: "meta", content: freeformTurn.meta || null }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: freeformTurn.text || "I am here. Ask me about the scene or tell me what to build." }) });
          await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
        });
      }

      const analyticRevealResponse = await streamAnalyticVisualRevealReply(c, {
        plan,
        sceneSnapshot,
        sceneContext,
        learningState,
        userMessage,
        contextStepId,
      });
      if (analyticRevealResponse) {
        return analyticRevealResponse;
      }
      if (requires_evaluation === false) {
        return handleConversationalReply(c, {
          plan,
          sceneSnapshot,
          sceneContext,
          learningState,
          userMessage,
          contextStepId,
          input_source,
          hint_state,
        });
      }

      return streamGuidedTutorReply(c, {
        plan,
        sceneSnapshot,
        sceneContext,
        learningState,
        userMessage,
        contextStepId,
        input_source,
        hint_state,
      });
    } catch (error) {
      console.error("Tutor route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  tutorRoute.post("/similar", async (c) => {
    try {
      const { plan, limit = 3 } = await c.req.json();
      if (!plan) {
        return c.json({ error: "plan is required" }, 400);
      }

      const suggestions = await similarQuestionGenerator({
        plan,
        limit,
      });
      return c.json({ suggestions: suggestions.slice(0, 3) });
    } catch (error) {
      console.error("Tutor similar route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  return tutorRoute;
}

const tutorRoute = createTutorRoute();

export default tutorRoute;
