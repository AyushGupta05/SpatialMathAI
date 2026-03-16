import { converseWithModelFailover } from "./modelInvoker.js";
import { cleanupJson } from "./plan/shared.js";

const MATH_TOKEN_HINT = /[$\\]|[_^]|\d|=|\(|\)|,/;
const SPATIAL_REASONING_HINT = /\b(vector|vectors|line|lines|plane|planes|point|points|angle|angles|distance|projection|normal|midpoint|coordinate|coordinates|dot product|cross product)\b/i;
const LABEL_SEQUENCE_HINT = /\b[A-Z]{1,3}\b(?:\s*(?:,|and|or)\s*\b[A-Z]{1,3}\b)+/;
const PROGRESS_ACK_HINT = /\b(excellent|perfect|great|well done|exactly|correct|good(?:\s+(?:job|work|thinking|reasoning|observation|catch))?|nice work|that'?s right|you got it|spot on|brilliant|fantastic|wonderful|nicely done|awesome|superb)\b/i;
const PROGRESS_FORWARD_CUE_HINT = /\b(now|next|move on|continue|let(?:'|’)s continue|ready to continue|ready for the next|proceed)\b/i;

const EVALUATION_SYSTEM_PROMPT = `You are an evaluation engine for a spatial math tutor.
Given a learner's response to a stage goal, classify it
into exactly one of: CORRECT, PARTIAL, or STUCK.

Rules:
- CORRECT: captures the core idea, even if imprecise language
- PARTIAL: right direction but missing a key component
- STUCK: confused, off-topic, or asks for the answer directly
- Never penalise creative phrasing of correct ideas
- Never mark CORRECT if a core misconception is present

You must respond ONLY with valid JSON. No preamble.`;

const PROGRESSION_SYSTEM_PROMPT = `You are a strict stage progression gate for a spatial-math tutor.
Decide if the tutor should move to the next stage right now.

Return ONLY valid JSON with this exact shape:
{
  "progress": "YES" or "NO",
  "reason": "<short reason>"
}

Rules:
- Consider ALL of the following as potential progression signals:
  - The concept verdict is CORRECT.
  - The tutor reply includes brief praise (for example "great", "excellent", "good", "well done").
  - The tutor reply includes a forward cue (for example "now", "next", "continue", "move on").
- Answer YES when at least ONE of these signals is present AND the learner appears ready for the next stage now.
- If the concept verdict is CORRECT, default to YES unless there is clear unresolved confusion, a missing prerequisite, or some other strong blocker.
- Answer NO when there is unresolved confusion, missing prerequisites, or clear uncertainty, even if some signals are present.
- Reserve NO for strong blockers, not mild caution.
- Never return anything except the JSON object.`;

const FALLBACK_VERDICT = {
  verdict: "PARTIAL",
  confidence: 0.5,
  what_was_right: "",
  gap: "",
  misconception_type: null,
  scene_cue: null,
  tutor_tone: "encouraging",
};

export function isTrivialInteraction(learningStage, userMessage) {
  if (learningStage === "orient") return true;

  const text = String(userMessage || "").trim();
  if (learningStage === "build") {
    const shortButMeaningfulHint = /\b(parallel|perpendicular|intersect|intersection|skew|coplanar|same|different|bigger|smaller|increase|decrease|double|half|equal|not equal|match)\b/i;
    if (
      MATH_TOKEN_HINT.test(text)
      || SPATIAL_REASONING_HINT.test(text)
      || LABEL_SEQUENCE_HINT.test(text)
      || shortButMeaningfulHint.test(text)
    ) {
      return false;
    }
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 10) {
      return true;
    }
  }

  return false;
}

function summarizeLearnerHistory(history = []) {
  if (!history.length) return "None";
  return history
    .filter((entry) => entry?.verdict)
    .slice(-4)
    .map((entry) => `Stage ${entry.stage}: verdict=${entry.verdict}${entry.gap ? `, gap="${entry.gap}"` : ""}`)
    .join("; ") || "None";
}

function cleanNumber(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.abs(next) < 1e-9 ? 0 : next;
}

function formatVector(vector = []) {
  return `(${vector.map((value) => String(cleanNumber(value))).join(", ")})`;
}

function labelsFromStageGoal(stageGoal = "") {
  return [...new Set(
    String(stageGoal || "")
      .toUpperCase()
      .match(/\b[A-Z]{2}\b/g) || []
  )];
}

function vectorFromPoints(start = [], end = []) {
  if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 3 || end.length !== 3) return null;
  const vector = end.map((value, index) => cleanNumber(Number(value) - Number(start[index])));
  return vector.every((value) => Number.isFinite(value)) ? vector : null;
}

function parseTriple(values = "") {
  const numbers = String(values || "")
    .match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value)) || [];
  return numbers.length === 3 ? numbers.map((value) => cleanNumber(value)) : null;
}

function parseLearnerVectorClaims(learnerInput = "") {
  const claims = new Map();
  const normalized = String(learnerInput || "")
    .replaceAll("\u27e8", "(")
    .replaceAll("\u27e9", ")")
    .replaceAll("\u3008", "(")
    .replaceAll("\u3009", ")")
    .replaceAll("<", "(")
    .replaceAll(">", ")");
  const pattern = /(?:vector\s*)?([A-Z]{2})\s*(?:=|:|is)\s*\(([^)]+)\)/gi;
  let match = pattern.exec(normalized);
  while (match) {
    const label = String(match[1] || "").toUpperCase();
    const vector = parseTriple(match[2]);
    if (label && vector) {
      claims.set(label, vector);
    }
    match = pattern.exec(normalized);
  }
  return claims;
}

function collectPointMapFromPlan(plan = {}) {
  const points = new Map();
  const addPoint = (label = "", coordinates = null) => {
    const cleanLabel = String(label || "").trim().toUpperCase();
    const coords = Array.isArray(coordinates) && coordinates.length === 3
      ? coordinates.map((value) => cleanNumber(value))
      : null;
    if (!/^[A-Z]$/.test(cleanLabel) || !coords || !coords.every((value) => Number.isFinite(value))) return;
    points.set(cleanLabel, coords);
  };

  (plan?.analyticContext?.entities?.points || []).forEach((point) => {
    addPoint(point?.label, point?.coordinates);
  });

  (plan?.objectSuggestions || []).forEach((suggestion) => {
    if (suggestion?.object?.shape !== "pointMarker") return;
    addPoint(suggestion.object?.label || suggestion?.title, suggestion.object?.position);
  });

  return points;
}

function collectExpectedVectorMap(plan = {}) {
  const expected = new Map();
  const pointMap = collectPointMapFromPlan(plan);

  const setVector = (label = "", vector = null) => {
    const cleanLabel = String(label || "").trim().toUpperCase();
    const cleanVector = Array.isArray(vector) && vector.length === 3
      ? vector.map((value) => cleanNumber(value))
      : null;
    if (!/^[A-Z]{2}$/.test(cleanLabel) || !cleanVector || !cleanVector.every((value) => Number.isFinite(value))) return;
    expected.set(cleanLabel, cleanVector);
  };

  const setFromLabelPoints = (label = "", fallback = null) => {
    const cleanLabel = String(label || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cleanLabel)) {
      setVector(cleanLabel, fallback);
      return;
    }
    const start = pointMap.get(cleanLabel[0]);
    const end = pointMap.get(cleanLabel[1]);
    const derived = vectorFromPoints(start, end);
    setVector(cleanLabel, derived || fallback);
  };

  (plan?.analyticContext?.entities?.lines || []).forEach((line) => {
    setFromLabelPoints(line?.label, line?.direction);
  });

  (plan?.objectSuggestions || []).forEach((suggestion) => {
    if (suggestion?.object?.shape !== "line") return;
    const label = suggestion.object?.label || suggestion?.title || "";
    const fallback = vectorFromPoints(suggestion.object?.params?.start, suggestion.object?.params?.end);
    setFromLabelPoints(label, fallback);
  });

  return expected;
}

function vectorsMatch(expected = [], actual = [], tolerance = 0.05) {
  return expected.length === 3
    && actual.length === 3
    && expected.every((value, index) => Math.abs(Number(value) - Number(actual[index])) <= tolerance);
}

function vectorMismatchMessage(label, expected, actual) {
  const axisLabels = ["x", "y", "z"];
  const mismatchedIndexes = [0, 1, 2].filter((index) => Math.abs(Number(expected[index]) - Number(actual[index])) > 0.05);
  if (mismatchedIndexes.length === 1) {
    const index = mismatchedIndexes[0];
    const signMismatch = Math.sign(Number(expected[index])) !== Math.sign(Number(actual[index]))
      && Math.abs(Number(expected[index])) > 0.05
      && Math.abs(Number(actual[index])) > 0.05;
    return `${label} has the wrong ${axisLabels[index]} component${signMismatch ? " (sign)" : ""}. It should be ${formatVector(expected)}.`;
  }
  return `${label} should be ${formatVector(expected)}, not ${formatVector(actual)}.`;
}

function deterministicVectorVerdict({ stageGoal = "", learnerInput = "", lessonContext = {} } = {}) {
  const plan = lessonContext?.plan || null;
  if (!plan) return null;

  const claims = parseLearnerVectorClaims(learnerInput);
  if (!claims.size) return null;

  const expectedVectors = collectExpectedVectorMap(plan);
  const pointMap = collectPointMapFromPlan(plan);
  [...claims.keys()].forEach((label) => {
    if (expectedVectors.has(label) || !/^[A-Z]{2}$/.test(label)) return;
    const start = pointMap.get(label[0]);
    const end = pointMap.get(label[1]);
    const derived = vectorFromPoints(start, end);
    if (derived) {
      expectedVectors.set(label, derived);
    }
  });
  if (!expectedVectors.size) return null;

  const relevantClaims = [...claims.entries()].filter(([label]) => expectedVectors.has(label));
  if (!relevantClaims.length) return null;

  const requiredLabels = labelsFromStageGoal(stageGoal).filter((label) => expectedVectors.has(label));
  const missingRequired = requiredLabels.filter((label) => !claims.has(label));

  const correct = [];
  const wrong = [];
  relevantClaims.forEach(([label, actual]) => {
    const expected = expectedVectors.get(label);
    if (vectorsMatch(expected, actual)) {
      correct.push(label);
      return;
    }
    wrong.push({ label, expected, actual });
  });

  if (!wrong.length && !missingRequired.length) {
    return {
      verdict: "CORRECT",
      confidence: 0.98,
      what_was_right: correct.length ? `${correct.join(" and ")} ${correct.length === 1 ? "is" : "are"} correct.` : "Your vector setup is correct.",
      gap: null,
      misconception_type: null,
      scene_cue: null,
      tutor_tone: "encouraging",
    };
  }

  const wrongMsg = wrong.length
    ? vectorMismatchMessage(wrong[0].label, wrong[0].expected, wrong[0].actual)
    : "";
  const missingMsg = missingRequired.length
    ? `You still need ${missingRequired.join(" and ")}.`
    : "";
  const gap = [wrongMsg, missingMsg, "Use endpoint subtraction (end - start), e.g., AC = C - A."]
    .filter(Boolean)
    .join(" ");

  return {
    verdict: "PARTIAL",
    confidence: 0.96,
    what_was_right: correct.length ? `${correct.join(" and ")} ${correct.length === 1 ? "is" : "are"} correct.` : "",
    gap,
    misconception_type: wrong.length ? "vector_component_error" : "incomplete_vector_setup",
    scene_cue: wrong.length ? `highlight_${wrong[0].label.toLowerCase()}` : "highlight_vectors",
    tutor_tone: "redirecting",
  };
}

function buildEvaluationMessage({ stageGoal, learnerInput, prediction, learnerHistory }) {
  return [
    `Stage goal: "${stageGoal}"`,
    `Learner's prediction: "${prediction || "none"}"`,
    `Learner's response: "${learnerInput}"`,
    `Previous interactions: ${summarizeLearnerHistory(learnerHistory)}`,
    "",
    "Return JSON:",
    `{`,
    `  "verdict": "CORRECT" | "PARTIAL" | "STUCK",`,
    `  "confidence": <number 0-1>,`,
    `  "what_was_right": "<string>",`,
    `  "gap": "<string or null>",`,
    `  "misconception_type": "<string or null>",`,
    `  "scene_cue": "<string or null>",`,
    `  "tutor_tone": "encouraging" | "redirecting" | "supportive"`,
    `}`,
  ].join("\n");
}

function hasForwardProgressCue(text = "") {
  return PROGRESS_FORWARD_CUE_HINT.test(String(text || ""));
}

function summarizeAssessmentForProgress(assessment = {}) {
  return {
    readyForPrediction: Boolean(assessment?.guidance?.readyForPrediction),
    activeStepComplete: Boolean(assessment?.activeStep?.complete),
    objectCount: Number(assessment?.summary?.objectCount || 0),
    guidance: String(assessment?.guidance?.coachFeedback || ""),
  };
}

function buildProgressionMessage({
  currentStageId,
  currentStageGoal,
  nextStageId,
  learningStage,
  nextLearningStage,
  conceptVerdict,
  learnerInput,
  tutorReply,
  prediction,
  learnerHistory,
  assessment,
}) {
  return [
    `Current stage id: "${currentStageId || "unknown"}"`,
    `Current stage goal: "${currentStageGoal || ""}"`,
    `Candidate next stage id: "${nextStageId || "none"}"`,
    `Current learning stage: "${learningStage || "unknown"}"`,
    `Candidate next learning stage: "${nextLearningStage || learningStage || "unknown"}"`,
    `Concept verdict: "${conceptVerdict?.verdict || "none"}"`,
    `Concept gap: "${conceptVerdict?.gap || ""}"`,
    `Learner prediction: "${prediction || ""}"`,
    `Learner response: "${learnerInput || ""}"`,
    `Tutor response: "${tutorReply || ""}"`,
    `Layer-1 praise detected: ${hasPositiveTutorSignal(tutorReply) ? "true" : "false"}`,
    `Tutor forward cue detected: ${hasForwardProgressCue(tutorReply) ? "true" : "false"}`,
    `Assessment summary: ${JSON.stringify(summarizeAssessmentForProgress(assessment))}`,
    `Learner history summary: ${summarizeLearnerHistory(learnerHistory)}`,
  ].join("\n");
}

function parseProgressDecision(raw = "") {
  const rawText = String(raw || "").trim();
  let parsed = null;
  try {
    parsed = JSON.parse(cleanupJson(rawText));
  } catch {
    parsed = null;
  }
  const token = String(parsed?.progress || parsed?.decision || parsed?.answer || rawText).toUpperCase();
  const decision = token.includes("YES") ? "YES" : token.includes("NO") ? "NO" : "NO";
  return {
    decision,
    reason: String(parsed?.reason || parsed?.why || "").trim(),
    raw: rawText,
  };
}

export function hasPositiveTutorSignal(tutorReply = "") {
  const text = String(tutorReply || "").trim();
  if (!text) return false;
  // Many good tutor replies begin with context then praise; accept praise anywhere early.
  const windowText = text.slice(0, 260);
  return PROGRESS_ACK_HINT.test(windowText);
}

function hasStrongProgressBlockSignal(text = "") {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;
  return /\b(unresolved|confus|uncertain|not ready|missing prerequisite|missing prereq|missing foundation|missing step|missing setup|incomplete|incorrect|wrong|misconception|still unclear|needs correction|revisit|retry|try again|verify first|check first|before continuing)\b/.test(normalized);
}

export async function evaluateStageProgression(input = {}, deps = {}) {
  const currentStageId = String(input?.currentStage?.id || "").trim();
  const nextStageId = String(input?.nextStage?.id || "").trim();
  const candidateExists = Boolean(nextStageId) && nextStageId !== currentStageId;
  const verdict = String(input?.conceptVerdict?.verdict || "").toUpperCase();
  const layer1Matched = hasPositiveTutorSignal(input?.tutorReply || "");

  if (!candidateExists) {
    return {
      shouldProgress: false,
      layer1Matched,
      layer2Decision: "NO",
      reason: "No distinct next stage is available.",
    };
  }

  const converse = deps.converseWithModelFailover || converseWithModelFailover;
  const userText = buildProgressionMessage({
    currentStageId,
    currentStageGoal: input?.currentStage?.goal || "",
    nextStageId,
    learningStage: input?.learningState?.learningStage || "",
    nextLearningStage: input?.nextLearningStage || "",
    conceptVerdict: input?.conceptVerdict || null,
    learnerInput: input?.learnerInput || "",
    tutorReply: input?.tutorReply || "",
    prediction: input?.learningState?.predictionState?.response || "",
    learnerHistory: input?.learningState?.learnerHistory || [],
    assessment: input?.assessment || {},
  });

  try {
    const raw = await converse("text", PROGRESSION_SYSTEM_PROMPT, [{
      role: "user",
      content: [{ text: userText }],
    }], {
      maxTokens: 180,
      temperature: 0,
    });
    const decision = parseProgressDecision(raw);
    const layer2Decision = decision.decision;
    const isCorrect = verdict === "CORRECT";
    const strongBlock = layer2Decision === "NO" && (
      hasStrongProgressBlockSignal(decision.reason)
      || hasStrongProgressBlockSignal(input?.tutorReply || "")
      || hasStrongProgressBlockSignal(input?.conceptVerdict?.gap || "")
    );
    const anySignal = isCorrect || layer1Matched || layer2Decision === "YES";
    return {
      shouldProgress: layer2Decision === "YES" || (isCorrect && !strongBlock && anySignal),
      layer1Matched,
      layer2Decision,
      reason: decision.reason,
    };
  } catch (error) {
    console.error("Stage progression gate failed:", error?.message || error);
    return {
      shouldProgress: false,
      layer1Matched: true,
      layer2Decision: "NO",
      reason: "Progression gate unavailable.",
    };
  }
}

function normalizeVerdict(parsed = {}) {
  let verdict = ["CORRECT", "PARTIAL", "STUCK"].includes(parsed.verdict)
    ? parsed.verdict
    : "PARTIAL";
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;
  let gap = parsed.gap || null;
  let scene_cue = parsed.scene_cue || null;
  let tutor_tone = parsed.tutor_tone || "encouraging";

  if (verdict === "CORRECT" && confidence < 0.75) {
    verdict = "PARTIAL";
    gap = "Spatial Math AI was uncertain - checking understanding";
    scene_cue = null;
    console.log(`[eval] CORRECT→PARTIAL override, confidence=${confidence}`);
  }

  if (verdict === "STUCK" && confidence < 0.65) {
    tutor_tone = "neutral";
  }

  return {
    verdict,
    confidence,
    what_was_right: String(parsed.what_was_right || ""),
    gap,
    misconception_type: parsed.misconception_type || null,
    scene_cue,
    tutor_tone,
  };
}

export async function evaluateConcept(
  { stageGoal, learnerInput, lessonContext = null, prediction, learnerHistory },
  deps = {},
) {
  const deterministicVerdict = deterministicVectorVerdict({
    stageGoal,
    learnerInput,
    lessonContext,
  });
  if (deterministicVerdict) {
    return deterministicVerdict;
  }

  const converse = deps.converseWithModelFailover || converseWithModelFailover;

  const userText = buildEvaluationMessage({
    stageGoal,
    learnerInput,
    prediction,
    learnerHistory,
  });

  const messages = [{ role: "user", content: [{ text: userText }] }];

  try {
    const raw = await converse("text", EVALUATION_SYSTEM_PROMPT, messages, {
      maxTokens: 512,
      temperature: 0.1,
    });
    const parsed = JSON.parse(cleanupJson(raw));
    return normalizeVerdict(parsed);
  } catch (error) {
    console.error("Concept evaluation parse/call error:", error?.message || error);
    return { ...FALLBACK_VERDICT };
  }
}
