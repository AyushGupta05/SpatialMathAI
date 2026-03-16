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

export function createTutorRoute({
  streamModel = converseStreamWithModelFailover,
  freeformTurnGenerator = generateFreeformTutorTurn,
  completionEvaluator = evaluateTutorCompletion,
  conceptEvaluator = evaluateConcept,
  trivialityCheck = isTrivialInteraction,
  similarQuestionGenerator = generateSimilarTutorQuestions,
} = {}) {
  const tutorRoute = new Hono();

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
      const currentStep = plan.buildSteps?.find((s) => s.id === contextStepId)
        || plan.buildSteps?.[effectiveLearningState?.currentStep || 0];
      const stageGoal = currentStep?.focusConcept
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
    const nextLearningStageKey = nextLearningStage(effectiveLearningState?.learningStage || "orient", conceptVerdict, assessment);

    const responseMeta = buildTutorResponseMeta({
      plan,
      learningState: effectiveLearningState,
      contextStepId,
      assessment,
      completionState,
      userMessage,
      conceptVerdict,
    });
    if (nextStage?.id) {
      responseMeta.stageStatus = {
        ...(responseMeta.stageStatus || {}),
        currentStageId: nextStage.id,
      };
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
    const deterministicRevealText = revealSolution ? buildSolutionRevealText(plan) : "";
    const escalatedRevealText = !revealSolution
      && conceptVerdict?.verdict === "STUCK"
      && effectiveLearningState?.hint_state?.escalate_next === true
      ? buildFullSolutionReveal(plan, effectiveSceneContext)
      : "";
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
        if (revealSolution || escalatedRevealText) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "text",
              content: revealSolution
                ? deterministicRevealText || "Here is the worked solution."
                : escalatedRevealText,
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
        const fallbackText = escalatedRevealText || buildFallbackTutorReply({
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
      } = await c.req.json();

      if (!sceneSnapshot || !userMessage || typeof userMessage !== "string") {
        return c.json({ error: "sceneSnapshot and userMessage are required" }, 400);
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
