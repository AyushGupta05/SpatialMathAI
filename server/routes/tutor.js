import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { converseNovaStream, MODEL_IDS } from "../middleware/bedrock.js";
import { evaluateBuild } from "../services/buildEvaluator.js";
import { normalizeScenePlan } from "../../src/ai/planSchema.js";

const tutorRoute = new Hono();

function summarizeScene(snapshot) {
  return (snapshot?.objects || [])
    .map((objectSpec) => `${objectSpec.label || objectSpec.id || "object"}: ${objectSpec.shape} ${JSON.stringify(objectSpec.params)}`)
    .join("\n");
}

function buildSystemPrompt({ plan, sceneSnapshot, learningState, contextStepId, assessment }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps[learningState?.currentStep || 0]
    || null;

  return `You are Nova Lite acting as a concise, warm spatial reasoning tutor.

Problem: ${normalizedPlan.problem.question}
Question type: ${normalizedPlan.problem.questionType}
Overview: ${normalizedPlan.overview}

Current build step:
${currentStep ? `${currentStep.title}: ${currentStep.instruction}` : "No active step"}

Scene snapshot:
${summarizeScene(sceneSnapshot) || "The learner has not built anything yet."}

Build assessment:
${JSON.stringify(assessment.summary)}
Step feedback:
${assessment.stepAssessments.map((step) => `${step.title}: ${step.feedback}`).join("\n")}

Answer gate:
${assessment.answerGate.reason}

Conversation guidance:
- Be concise by default.
- Keep the learner involved in building and reasoning.
- If the build is incomplete, direct attention to the missing object or measurement.
- Do not dump the full solution unless the learner explicitly asks.
- Reference objects and helpers already in the scene when possible.
- If the learner asks for a hint, give the next useful action, not the full answer.`;
}

tutorRoute.post("/", async (c) => {
  try {
    const {
      plan,
      sceneSnapshot,
      learningState = {},
      userMessage,
      contextStepId = null,
    } = await c.req.json();

    if (!plan || !sceneSnapshot || !userMessage || typeof userMessage !== "string") {
      return c.json({ error: "plan, sceneSnapshot, and userMessage are required" }, 400);
    }

    const assessment = evaluateBuild(plan, sceneSnapshot, contextStepId);
    const systemPrompt = buildSystemPrompt({
      plan,
      sceneSnapshot,
      learningState,
      contextStepId,
      assessment,
    });

    const history = Array.isArray(learningState.history) ? learningState.history : [];
    const messages = [];
    for (const message of history.slice(-8)) {
      const role = message.role === "tutor" ? "assistant" : message.role;
      if (!["user", "assistant"].includes(role)) continue;
      if (messages.length && messages[messages.length - 1].role === role) continue;
      messages.push({ role, content: [{ text: String(message.content || "") }] });
    }
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: [{ text: userMessage }] });
    } else {
      messages[messages.length - 1] = { role: "user", content: [{ text: userMessage }] };
    }

    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of converseNovaStream(MODEL_IDS.NOVA_LITE, systemPrompt, messages, {
          maxTokens: 1024,
          temperature: 0.35,
        })) {
          await stream.writeSSE({ data: JSON.stringify({ type: "text", content: chunk }) });
        }
        await stream.writeSSE({ data: JSON.stringify({ type: "assessment", content: assessment }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      } catch (error) {
        console.error("Tutor stream error:", error);
        await stream.writeSSE({ data: JSON.stringify({ type: "error", content: error.message || "Tutor stream failed" }) });
      }
    });
  } catch (error) {
    console.error("Tutor route error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

export default tutorRoute;
