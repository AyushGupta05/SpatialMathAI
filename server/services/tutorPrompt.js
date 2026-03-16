import { normalizeScenePlan } from "../../src/ai/planSchema.js";

function summarizeScene(snapshot) {
  return (snapshot?.objects || [])
    .map((objectSpec) => `${objectSpec.label || objectSpec.id || "object"}: ${objectSpec.shape} ${JSON.stringify(objectSpec.params)}`)
    .join("\n");
}

function summarizeSceneContext(sceneContext = {}) {
  const selection = sceneContext?.selection
    ? `Selected object: ${sceneContext.selection.label} (${sceneContext.selection.shape}) params=${JSON.stringify(sceneContext.selection.params)} metrics=${JSON.stringify(sceneContext.selection.metrics)}`
    : "Selected object: none";
  const liveChallenge = sceneContext?.liveChallenge
    ? `Live challenge: ${sceneContext.liveChallenge.title || sceneContext.liveChallenge.metric} unlocked=${Boolean(sceneContext.liveChallenge.unlocked)} complete=${Boolean(sceneContext.liveChallenge.complete)} current=${sceneContext.liveChallenge.currentValue ?? "n/a"} target=${sceneContext.liveChallenge.targetValue ?? "n/a"} tolerance=${sceneContext.liveChallenge.toleranceValue ?? "n/a"}`
    : "Live challenge: none";
  const sceneFocus = sceneContext?.sceneFocus
    ? `Scene focus: concept=${sceneContext.sceneFocus.concept || "n/a"} insight=${sceneContext.sceneFocus.primaryInsight || "n/a"}`
    : "Scene focus: none";
  const sourceSummary = sceneContext?.sourceSummary
    ? `Source summary: cleanedQuestion=${sceneContext.sourceSummary.cleanedQuestion || "n/a"} givens=${JSON.stringify(sceneContext.sourceSummary.givens || [])} relationships=${JSON.stringify(sceneContext.sourceSummary.relationships || [])}`
    : "Source summary: none";
  const guidance = sceneContext?.guidance
    ? `Guidance: ${sceneContext.guidance.coachFeedback || "n/a"}`
    : "Guidance: none";
  const representation = sceneContext?.representationMode
    ? `Representation mode: ${sceneContext.representationMode}`
    : "Representation mode: 3d";
  return `${selection}\n${liveChallenge}\n${sceneFocus}\n${sourceSummary}\n${guidance}\n${representation}`;
}

function summarizeDerivedValues(analytic = {}) {
  const derived = analytic.derivedValues || {};
  if (!Object.keys(derived).length) return "";
  const entries = Object.entries(derived)
    .map(([key, value]) => `${key} = ${Array.isArray(value) ? `(${value.join(", ")})` : value}`)
    .join(", ");
  return `\nIntermediate computed values: ${entries}`;
}

function summarizeEntities(analytic = {}) {
  const entities = analytic.entities || {};
  const parts = [];
  (entities.lines || []).forEach((line) => {
    parts.push(`${line.label}: point=${JSON.stringify(line.point)} direction=${JSON.stringify(line.direction)}`);
  });
  (entities.points || []).forEach((point) => {
    parts.push(`${point.label}: coordinates=${JSON.stringify(point.coordinates)}`);
  });
  (entities.planes || []).forEach((plane) => {
    parts.push(`${plane.label}: normal=${JSON.stringify(plane.normal)} d=${plane.d}`);
  });
  return parts.length ? `\nEntities: ${parts.join("; ")}` : "";
}

function summarizeAnalyticContext(plan = {}, _sceneContext = {}, contextStepId = null, learningState = {}) {
  if (plan?.experienceMode !== "analytic_auto") return "Analytic context: none";
  const currentMoment = (plan.sceneMoments || []).find((moment) => moment.id === contextStepId)
    || plan.sceneMoments?.[learningState?.currentStep || 0]
    || plan.sceneMoments?.[0]
    || null;
  const analytic = plan.analyticContext || {};
  const steps = (analytic.solutionSteps || [])
    .map((step) => `${step.title}: ${step.formula || step.explanation}`)
    .join("\n");
  return [
    `Analytic subtype: ${analytic.subtype || "unknown"}`,
    `Formula card: ${analytic.formulaCard?.formula || "n/a"}`,
    `Formula explanation: ${analytic.formulaCard?.explanation || "n/a"}`,
    currentMoment ? `Current scene moment: ${currentMoment.title} -> ${currentMoment.prompt}` : "Current scene moment: none",
    steps ? `Deterministic solution steps:\n${steps}` : "Deterministic solution steps: none",
    summarizeEntities(analytic),
    summarizeDerivedValues(analytic),
  ].join("\n");
}

function titlesForSuggestionIds(plan, ids = []) {
  const byId = new Map((plan?.objectSuggestions || []).map((suggestion) => [suggestion.id, suggestion.title]));
  return ids.map((id) => byId.get(id) || id);
}

function stuckStrategy(hintCount = 0) {
  if (hintCount <= 1) return "ANALOGY";
  if (hintCount === 2) return "SIMPLER_QUESTION";
  return "SCENE_FOCUS";
}

function fullSolutionLines(plan = {}) {
  const normalizedPlan = normalizeScenePlan(plan);
  const lines = [];
  const formula = String(normalizedPlan.answerScaffold?.formula || "").trim();
  const explanation = String(normalizedPlan.answerScaffold?.explanation || "").trim();
  const finalAnswer = normalizedPlan.answerScaffold?.finalAnswer;
  const unit = String(normalizedPlan.answerScaffold?.unit || "").trim();
  const analyticSteps = normalizedPlan.analyticContext?.solutionSteps || [];

  if (formula) {
    lines.push(`Formula: ${formula}`);
  }

  if (analyticSteps.length) {
    analyticSteps.forEach((step, index) => {
      const formulaLine = String(step.formula || "").trim();
      const explanationLine = String(step.explanation || "").trim();
      const detail = [formulaLine, explanationLine].filter(Boolean).join(" — ");
      lines.push(`${index + 1}. ${step.title}${detail ? `: ${detail}` : ""}`);
    });
  } else if (explanation) {
    lines.push(explanation);
  }

  if (finalAnswer !== undefined && finalAnswer !== null && String(finalAnswer).trim()) {
    lines.push(`Final answer: ${String(finalAnswer).trim()}${unit ? ` ${unit}` : ""}`);
  }

  return lines.filter(Boolean);
}

function normalizeSolutionText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatSolutionNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  const rounded = Number(next.toFixed(digits));
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function formatFinalAnswerText(answerScaffold = {}) {
  const finalAnswer = answerScaffold?.finalAnswer;
  const unit = normalizeSolutionText(answerScaffold?.unit || "");
  const valueText = Array.isArray(finalAnswer)
    ? `(${finalAnswer.map((value) => String(value).trim()).filter(Boolean).join(", ")})`
    : String(finalAnswer ?? "").trim();
  if (!valueText) return "";
  return unit && !valueText.toLowerCase().includes(unit.toLowerCase())
    ? `${valueText} ${unit}`.trim()
    : valueText;
}

function solutionSourceText(plan = {}) {
  const givens = Array.isArray(plan?.sourceSummary?.givens) ? plan.sourceSummary.givens : [];
  return [
    plan?.sourceSummary?.cleanedQuestion,
    plan?.problem?.question,
    ...givens,
  ].filter(Boolean).join(" ");
}

function parsePointMap(text = "") {
  const points = new Map();
  const pointPattern = /\b([A-Z])\s*\(\s*([-+]?\d*\.?\d+(?:\s*,\s*[-+]?\d*\.?\d+){2})\s*\)/g;
  let match = pointPattern.exec(text);
  while (match) {
    const label = match[1];
    const coordinates = match[2]
      .split(/\s*,\s*/)
      .map((value) => Number(value));
    if (coordinates.length === 3 && coordinates.every((value) => Number.isFinite(value))) {
      points.set(label, coordinates);
    }
    match = pointPattern.exec(text);
  }
  return points;
}

function parseVectorLabels(text = "") {
  const patterns = [
    /angle between (?:two |the )?(?:vectors?|lines?)\s+([A-Z]{2})\s*(?:,|and)\s*([A-Z]{2})/i,
    /vectors?\s+([A-Z]{2})\s*(?:,|and)\s*([A-Z]{2})/i,
    /lines?\s+([A-Z]{2})\s*(?:,|and)\s*([A-Z]{2})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return [match[1].toUpperCase(), match[2].toUpperCase()];
    }
  }

  return [null, null];
}

function vectorFromPoints(start = [], end = []) {
  if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 3 || end.length !== 3) {
    return null;
  }
  return end.map((value, index) => Number(value) - Number(start[index]));
}

function parenthesizedValueTex(value) {
  const formatted = formatSolutionNumber(value);
  return Number(value) < 0 ? `(${formatted})` : formatted;
}

function tupleTex(values = []) {
  return `(${values.map((value) => formatSolutionNumber(value)).join(", ")})`;
}

function tuplePlain(values = []) {
  return `(${values.map((value) => formatSolutionNumber(value)).join(", ")})`;
}

function differenceTupleTex(start = [], end = []) {
  return `(${end.map((value, index) => `${formatSolutionNumber(value)}-${parenthesizedValueTex(start[index])}`).join(", ")})`;
}

function squaredTermsTex(values = []) {
  return values.map((value) => `${parenthesizedValueTex(value)}^2`).join(" + ");
}

function squaredValuesTex(values = []) {
  return values.map((value) => formatSolutionNumber(Number(value) ** 2)).join(" + ");
}

function signedTermsTex(values = []) {
  return values.map((value, index) => {
    const formatted = formatSolutionNumber(Math.abs(Number(value)));
    if (index === 0) {
      return Number(value) < 0 ? `-${formatted}` : formatted;
    }
    return Number(value) < 0 ? `- ${formatted}` : `+ ${formatted}`;
  }).join(" ");
}

function vectorLabelTex(label = "") {
  return `\\overrightarrow{${label}}`;
}

function buildLineLineRevealSections(plan = {}) {
  const sourceText = solutionSourceText(plan);
  const relationships = Array.isArray(plan?.sourceSummary?.relationships) ? plan.sourceSummary.relationships : [];
  const looksLikeLineLine = relationships.includes("angle_type:line_line")
    || /angle between (?:two |the )?(?:vectors?|lines?)/i.test(sourceText)
    || /vectors?\s+[A-Z]{2}\s*(?:,|and)\s*[A-Z]{2}/i.test(sourceText);

  if (!looksLikeLineLine) return [];

  const points = parsePointMap(sourceText);
  const [vectorOneLabel, vectorTwoLabel] = parseVectorLabels(sourceText);
  if (!vectorOneLabel || !vectorTwoLabel) return [];

  const [startOneLabel, endOneLabel] = vectorOneLabel.split("");
  const [startTwoLabel, endTwoLabel] = vectorTwoLabel.split("");
  const startOne = points.get(startOneLabel);
  const endOne = points.get(endOneLabel);
  const startTwo = points.get(startTwoLabel);
  const endTwo = points.get(endTwoLabel);
  if (!startOne || !endOne || !startTwo || !endTwo) return [];

  const vectorOne = vectorFromPoints(startOne, endOne);
  const vectorTwo = vectorFromPoints(startTwo, endTwo);
  if (!vectorOne || !vectorTwo) return [];

  const dotTerms = vectorOne.map((value, index) => Number(value) * Number(vectorTwo[index]));
  const dotProduct = dotTerms.reduce((total, value) => total + value, 0);
  const vectorOneSquareSum = vectorOne.reduce((total, value) => total + (Number(value) ** 2), 0);
  const vectorTwoSquareSum = vectorTwo.reduce((total, value) => total + (Number(value) ** 2), 0);
  const vectorOneMagnitude = Math.sqrt(vectorOneSquareSum);
  const vectorTwoMagnitude = Math.sqrt(vectorTwoSquareSum);
  const denominator = vectorOneMagnitude * vectorTwoMagnitude;
  if (!denominator) return [];

  const cosineValue = Math.max(-1, Math.min(1, dotProduct / denominator));
  const angleDegrees = (Math.acos(cosineValue) * 180) / Math.PI;
  const angleText = formatSolutionNumber(angleDegrees);
  const isPerpendicular = Math.abs(cosineValue) < 1e-9;

  return [
    {
      type: "prose",
      text: `We need to find the angle theta between vectors ${vectorOneLabel} and ${vectorTwoLabel} using the dot product.`,
    },
    {
      type: "formula",
      label: "Formula",
      tex: `\\theta = \\arccos\\left(\\frac{${vectorLabelTex(vectorOneLabel)} \\cdot ${vectorLabelTex(vectorTwoLabel)}}{|${vectorLabelTex(vectorOneLabel)}|\\,|${vectorLabelTex(vectorTwoLabel)}|}\\right)`,
    },
    {
      type: "step",
      label: "Step 1",
      description: `Find vector ${vectorOneLabel}`,
      tex: `${vectorLabelTex(vectorOneLabel)} = ${endOneLabel} - ${startOneLabel} = ${differenceTupleTex(startOne, endOne)} = ${tupleTex(vectorOne)}`,
      result: tuplePlain(vectorOne),
    },
    {
      type: "step",
      label: "Step 2",
      description: `Find vector ${vectorTwoLabel}`,
      tex: `${vectorLabelTex(vectorTwoLabel)} = ${endTwoLabel} - ${startTwoLabel} = ${differenceTupleTex(startTwo, endTwo)} = ${tupleTex(vectorTwo)}`,
      result: tuplePlain(vectorTwo),
    },
    {
      type: "step",
      label: "Step 3",
      description: `Compute ${vectorOneLabel} dot ${vectorTwoLabel}`,
      tex: `${vectorLabelTex(vectorOneLabel)} \\cdot ${vectorLabelTex(vectorTwoLabel)} = ${vectorOne.map((value, index) => `(${formatSolutionNumber(value)})(${formatSolutionNumber(vectorTwo[index])})`).join(" + ")} = ${signedTermsTex(dotTerms)} = ${formatSolutionNumber(dotProduct)}`,
      result: formatSolutionNumber(dotProduct),
    },
    {
      type: "step",
      label: "Step 4",
      description: `Compute |${vectorOneLabel}|`,
      tex: `|${vectorLabelTex(vectorOneLabel)}| = \\sqrt{${squaredTermsTex(vectorOne)}} = \\sqrt{${squaredValuesTex(vectorOne)}} = \\sqrt{${formatSolutionNumber(vectorOneSquareSum)}}`,
      result: `sqrt(${formatSolutionNumber(vectorOneSquareSum)}) approx ${formatSolutionNumber(vectorOneMagnitude)}`,
    },
    {
      type: "step",
      label: "Step 5",
      description: `Compute |${vectorTwoLabel}|`,
      tex: `|${vectorLabelTex(vectorTwoLabel)}| = \\sqrt{${squaredTermsTex(vectorTwo)}} = \\sqrt{${squaredValuesTex(vectorTwo)}} = \\sqrt{${formatSolutionNumber(vectorTwoSquareSum)}}`,
      result: `sqrt(${formatSolutionNumber(vectorTwoSquareSum)}) approx ${formatSolutionNumber(vectorTwoMagnitude)}`,
    },
    {
      type: "step",
      label: "Step 6",
      description: "Apply the formula",
      tex: `\\theta = \\arccos\\left(\\frac{${formatSolutionNumber(dotProduct)}}{\\sqrt{${formatSolutionNumber(vectorOneSquareSum)}} \\cdot \\sqrt{${formatSolutionNumber(vectorTwoSquareSum)}}}\\right) = \\arccos(${formatSolutionNumber(cosineValue)}) = ${angleText}^\\circ`,
      result: `${angleText} degrees`,
    },
    {
      type: "answer",
      label: "Final answer",
      tex: `\\theta = ${angleText}^\\circ`,
      plain: isPerpendicular
        ? `Final answer: ${angleText} degrees (the vectors are perpendicular)`
        : `Final answer: ${angleText} degrees`,
    },
  ];
}

function buildGenericRevealSections(plan = {}) {
  const analytic = plan?.analyticContext || {};
  const formula = normalizeSolutionText(analytic.formulaCard?.formula || plan?.answerScaffold?.formula || "");
  const finalAnswer = formatFinalAnswerText(plan?.answerScaffold || {});
  const sections = [];
  const questionText = normalizeSolutionText(plan?.sourceSummary?.cleanedQuestion || plan?.problem?.question || "");

  if (questionText) {
    sections.push({
      type: "prose",
      text: `We need to solve: ${questionText}`,
    });
  }

  if (formula) {
    sections.push({
      type: "formula",
      label: "Formula",
      tex: formula,
    });
  }

  (analytic.solutionSteps || []).forEach((step, index) => {
    const tex = normalizeSolutionText(step?.formula || "");
    const description = normalizeSolutionText(step?.explanation || step?.title || "");
    if (!tex && !description) return;
    sections.push({
      type: "step",
      label: `Step ${index + 1}`,
      description: description || `Work through ${step?.title || `step ${index + 1}`}.`,
      tex,
      result: null,
    });
  });

  if (finalAnswer) {
    sections.push({
      type: "answer",
      label: "Final answer",
      tex: finalAnswer,
      plain: `Final answer: ${finalAnswer}`,
    });
  }

  return sections;
}

function buildFullSolutionSections(plan = {}) {
  const lineLineSections = buildLineLineRevealSections(plan);
  if (lineLineSections.length) return lineLineSections;
  return buildGenericRevealSections(plan);
}

function serializeFullSolutionSections(sections = []) {
  return sections.map((section) => {
    switch (section.type) {
      case "prose":
        return section.text || "";
      case "formula":
        return [`${section.label || "Formula"}:`, section.tex ? `$$${section.tex}$$` : ""]
          .filter(Boolean)
          .join("\n");
      case "step":
        return [
          `${section.label || "Step"}${section.description ? ` - ${section.description}` : ""}`,
          section.tex ? `$$${section.tex}$$` : "",
          section.result ? `= ${section.result}` : "",
        ].filter(Boolean).join("\n");
      case "answer":
        return [
          section.label || "Final answer",
          section.tex ? `$$${section.tex}$$` : "",
          section.plain || "",
        ].filter(Boolean).join("\n");
      default:
        return "";
    }
  }).filter(Boolean).join("\n\n");
}

export function buildFullSolutionReveal(plan, _sceneContext = null) {
  const normalizedPlan = normalizeScenePlan(plan);
  const sections = buildFullSolutionSections(normalizedPlan);
  const serializedSections = serializeFullSolutionSections(sections);
  const intro = `Let's work through the full solution for ${normalizedPlan.sourceSummary.cleanedQuestion || normalizedPlan.problem.question}.`;
  return {
    intro,
    sections,
    transcriptText: [
      intro,
      serializedSections || fullSolutionLines(normalizedPlan).join("\n\n"),
    ].filter(Boolean).join("\n\n"),
  };
}

function buildVerdictInstructions(verdict, learningState = {}) {
  if (!verdict) return "";

  const hintState = learningState?.hint_state || {};
  const hintCount = hintState.current_stage_hints || 0;

  switch (verdict.verdict) {
    case "CORRECT":
      return `

=== EVALUATION RESULT: CORRECT ===
The learner demonstrated correct understanding.
What they understood: ${verdict.what_was_right}

Response rules for this turn:
- Tone: warm but not over-the-top. Do NOT say "Great job!" or "Excellent!"
- Reference what they specifically said that was right.
- Bridge naturally to the next stage concept. Max 2 sentences before the bridge.
- End with a question that opens the next concept.`;

    case "PARTIAL":
      return `

=== EVALUATION RESULT: PARTIAL ===
What was right: ${verdict.what_was_right}
The gap: ${verdict.gap || "unspecified"}
Misconception type: ${verdict.misconception_type || "none identified"}

Response rules for this turn:
- Explicitly name what they got right FIRST.
- Then redirect to the gap using a scene reference ("look at the highlighted faces...").
- Do NOT reveal the answer yet.
- End with a targeted question that isolates the gap.
- Max 3 sentences total. This constraint is not optional.`;

    case "STUCK":
      if (hintState?.escalate_next === true) {
        return `

=== EVALUATION RESULT: STUCK ===
The learner has exhausted the hint path.
Response rules for this turn:
- Acknowledge that they have pushed this stage far enough for now.
- Invite them to tap "Show me the solution" if they want the full worked solution.
- Do NOT reveal the worked solution yet.
- Keep it to 2 sentences max.`;
      }
      return `

=== EVALUATION RESULT: STUCK ===
Misconception type: ${verdict.misconception_type || "none identified"}
Hint level: ${hintCount + 1} (consecutive times stuck on this stage)
Strategy: ${stuckStrategy(hintCount)}

Response rules for this turn:
- Use the ${stuckStrategy(hintCount)} strategy. Pick ONE approach only:
  - ANALOGY: if they're confused about the concept itself, relate it to something concrete
  - SIMPLER_QUESTION: break the current question into a smaller, answerable piece
  - SCENE_FOCUS: point them to a specific object or relationship visible in the scene
- Keep it short. One question at the end. No answer.${hintCount >= 2 ? "\n- Mention that they can tap 'View Solution' if they'd like to see the full worked solution." : ""}`;

    default:
      return "";
  }
}

export function buildTutorSystemPrompt({ plan, sceneSnapshot, sceneContext, learningState, contextStepId, assessment, conceptVerdict }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps[learningState?.currentStep || 0]
    || null;
  const learningStage = learningState?.learningStage || "orient";
  const learningMoment = normalizedPlan.learningMoments?.[learningStage] || {};

  return `You are SpatialMath, a spatial-maths tutor inspired by 3Blue1Brown's visual teaching and Khan Academy's Socratic tutoring.

Your core philosophy:
- NEVER give the answer directly. Guide the learner to discover it themselves through the 3D scene.
- Show, don't tell. Point to what's visible in the scene rather than explaining abstractly.
- Ask one focused question at a time. "What do you notice about..." or "What would happen if..."
- Build intuition before formulas. The scene IS the explanation.
- Be warm, curious, and brief. Sound like a thoughtful guide, not a textbook.
- Keep your answers VERY CONCISE. Avoid long paragraphs. Use markdown bullet points generously to improve readability and break up ideas.
- ALWAYS end with exactly one question that nudges the learner to think or look at the scene.

Problem: ${normalizedPlan.sourceSummary.cleanedQuestion || normalizedPlan.problem.question}
Question type: ${normalizedPlan.problem.questionType}
Overview: ${normalizedPlan.overview}
Learning stage: ${learningStage}
Current lesson focus: ${normalizedPlan.sceneFocus.primaryInsight}

Current build step:
${currentStep ? `${currentStep.title}: ${currentStep.instruction}` : "No active step"}

Current lesson card intent:
Title: ${learningMoment.title || learningStage}
Coach message: ${learningMoment.coachMessage || ""}
Goal: ${learningMoment.goal || ""}
Prediction prompt: ${learningMoment.prompt || ""}

Scene snapshot:
${summarizeScene(sceneSnapshot) || "The learner has not built anything yet."}

Focused scene context:
${summarizeSceneContext(sceneContext)}

Analytic lesson context:
${summarizeAnalyticContext(normalizedPlan, sceneContext, contextStepId, learningState)}

Build assessment:
${JSON.stringify(assessment.summary)}
Step feedback:
${assessment.stepAssessments.map((step) => `${step.title}: ${step.feedback}`).join("\n")}
Guidance feedback:
${assessment.guidance?.coachFeedback || "n/a"}

Answer gate:
${assessment.answerGate.reason}

Exact answer: ${normalizedPlan.answerScaffold?.finalAnswer || "not available"}${normalizedPlan.answerScaffold?.unit ? ` ${normalizedPlan.answerScaffold.unit}` : ""}

Answer-checking rules (CRITICAL - follow precisely):
When the learner submits a numeric answer or asks "is X correct?", you MUST check it against the exact answer above. You have every intermediate value and entity listed in the analytic context. Use them.

CASE 1 — CLOSE ENOUGH (within ~5% or reasonable rounding, e.g. 2.3 vs 2.3094):
  Say: "Correct! [brief praise]. For exact precision, it's [exact answer]. [One sentence connecting the answer to the scene, e.g. 'That matches the length of the golden segment connecting the two lines.']"

CASE 2 — WRONG but you can diagnose the mistake:
  Before responding, silently run through these checks using the intermediate computed values and entities above:
  - Did they swap v1 and v2? (Compute what the answer would be with swapped vectors)
  - Did they forget the absolute value? (Would the answer be negative of theirs?)
  - Did they forget to divide by |v1 x v2|? (Is their answer the unnormalized dot product?)
  - Did they use the wrong formula entirely? (e.g. point-to-line instead of line-to-line)
  - Did they confuse a point coordinate with a direction vector?
  - Did they make an arithmetic error in the cross product or dot product?
  - Did they swap numerator and denominator?
  Once you identify the likely source, respond: "Not quite. Check [specific step] — look at [specific variable or value in the scene]. Did you [specific action that would produce their wrong answer]? Try recalculating just that part."
  NEVER reveal the correct answer when they're wrong. Guide them to fix their specific mistake.

CASE 3 — WRONG and you cannot figure out where it came from:
  Say: "That's not matching what the scene shows. Let's work through it together — what formula did you start with? Walk me through your steps and I'll help you spot where it went off track."
  Then guide them step-by-step through the solution, asking them to compute each intermediate value one at a time.

Conversation rules:
- Keep responses easy to scan:
  1. Start with one orienting sentence.
  2. Optionally add up to 2 bullets for the key visual clues.
  3. End with exactly one question that nudges the learner to think or look at the scene.
- ALWAYS end with a question that nudges the learner to think or look at the scene. Examples:
  "What do you notice about how these two shapes compare?"
  "Look at the highlighted edge. What happens to the volume if you stretch it?"
  "Before I show you the formula, what's your gut feeling?"
- When the learner asks "what's the answer?" or "just tell me", respond with:
  "Let's figure it out together. Look at [specific scene element] - what does it tell you?"
  If they insist, say: "I can show you the solution - tap 'View Solution' when you're ready. But first, what's your best guess?"
- If the build is incomplete, point to the specific missing piece in the scene.
- If the stage is predict, help them commit to a prediction. Don't explain yet.
- If the stage is check, ask them to compare their prediction with what the scene shows.
- If the stage is reflect, prompt them to state the insight in their own words.
- Reference specific objects by name. Say "look at cylinder A" not "consider the shape."
- When a selected object is available, anchor to its actual dimensions and metrics.
- When the learner is stuck, give the smallest useful nudge, not a full explanation.
- Never recite formulas unless the learner has already attempted reasoning and asks to see one.
- Never say "Great question!" or similar filler. Jump straight into the guiding thought.${buildVerdictInstructions(conceptVerdict, learningState)}`;
}

export function buildFallbackTutorReply({ plan, assessment, sceneContext, userMessage, contextStepId }) {
  const normalizedPlan = normalizeScenePlan(plan);
  const assessmentStepId = assessment?.summary?.currentStepId || null;
  const currentStep = normalizedPlan.buildSteps.find((step) => step.id === contextStepId)
    || normalizedPlan.buildSteps.find((step) => step.id === assessmentStepId)
    || normalizedPlan.buildSteps[0]
    || null;
  const currentStepAssessment = currentStep
    ? assessment?.stepAssessments?.find((step) => step.stepId === currentStep.id) || null
    : null;
  const missingTitles = currentStepAssessment
    ? titlesForSuggestionIds(normalizedPlan, currentStepAssessment.missingObjectIds || [])
    : [];
  const lowerMessage = String(userMessage || "").toLowerCase();
  const liveChallenge = sceneContext?.liveChallenge || null;
  const selected = sceneContext?.selection || null;
  const learningStage = sceneContext?.guidance?.readyForPrediction ? "predict-ready" : "building";
  const companionHint = normalizedPlan.representationMode !== "3d"
    ? "Use the 2D companion to compare each face once."
    : "";

  const finalAnswer = normalizedPlan.answerScaffold?.finalAnswer;
  const answerMatch = lowerMessage.match(/(?:is\s+(?:the\s+)?answer\s+|(?:^|\s))(\d+(?:\.\d+)?)/);
  if (finalAnswer && answerMatch) {
    const userAnswer = parseFloat(answerMatch[1]);
    const expected = parseFloat(finalAnswer);
    if (Number.isFinite(userAnswer) && Number.isFinite(expected)) {
      const tolerance = Math.max(Math.abs(expected) * 0.05, 0.05);
      if (Math.abs(userAnswer - expected) <= tolerance) {
        const isExact = String(userAnswer) === String(expected);
        return isExact
          ? `Correct! That's exactly right. Look at the highlighted segment in the scene — its length matches your answer perfectly.`
          : `Correct! For exact precision, the answer is ${finalAnswer}. Look at the highlighted segment in the scene — its length matches.`;
      }
      return `That's not matching what the scene shows. Let's work through it together — what formula did you start with? Walk me through your steps and I'll help you spot where it went off track.`;
    }
  }

  if (normalizedPlan.experienceMode === "analytic_auto") {
    const currentMoment = normalizedPlan.sceneMoments.find((moment) => moment.id === contextStepId)
      || normalizedPlan.sceneMoments[0]
      || null;
    if (/(formula|equation)/.test(lowerMessage)) {
      return `${normalizedPlan.analyticContext?.formulaCard?.formula || normalizedPlan.answerScaffold.formula || "The formula card is ready."} ${normalizedPlan.analyticContext?.formulaCard?.explanation || ""}`.trim();
    }
    if (/(next|highlight|show)/.test(lowerMessage)) {
      return currentMoment?.goal
        ? `${currentMoment.goal} Use the highlighted objects, then reveal the next visual step when you're ready.`
        : "Use the highlighted objects, then reveal the next visual step when you're ready.";
    }
    return `${currentMoment?.prompt || normalizedPlan.sceneFocus?.primaryInsight || "Use the scene to explain the idea."} ${normalizedPlan.answerScaffold.formula ? `The key formula here is ${normalizedPlan.answerScaffold.formula}.` : ""}`.trim();
  }

  if (liveChallenge?.unlocked && /(target|challenge|goal)/.test(lowerMessage)) {
    return `The live ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} target is ${liveChallenge.targetValue ?? "not set yet"}. The current value is ${liveChallenge.currentValue ?? "unknown"} and SpatialMath accepts about +/-${liveChallenge.toleranceValue ?? "0"} tolerance.`;
  }

  if (/(hint|next|stuck|help)/.test(lowerMessage)) {
    if (missingTitles.length) {
      return `Look at the scene. What's missing? Think about what ${missingTitles.join(" and ")} would add to the picture. ${companionHint}`.trim();
    }
    if (assessment?.guidance?.readyForPrediction) {
      return `The scene is set. ${companionHint} Before I explain anything, what's your gut feeling about the answer?`.trim();
    }
    if (!assessment?.answerGate?.allowed) {
      return "There's still something to build. Look at the scene - what shape or relationship is missing?";
    }
    if (liveChallenge?.unlocked && !liveChallenge.complete) {
      return `What would you need to change so the ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} moves from ${liveChallenge.currentValue} toward ${liveChallenge.targetValue}?`;
    }
  }

  if (/(why|explain|formula)/.test(lowerMessage)) {
    if (selected) {
      return `Look at ${selected.label}. Its volume is ${selected.metrics?.volume ?? "unknown"} and surface area is ${selected.metrics?.surfaceArea ?? "unknown"}. ${companionHint} What do those numbers tell you about the shape?`.trim();
    }
    return `Look at the objects in the scene. ${companionHint} ${missingTitles.length ? `What would change if you added ${missingTitles.join(", ")}?` : "What relationship do you notice between them?"}`.trim();
  }

  if (learningStage === "predict-ready") {
    return "The scene is ready. Before we go further, what do you think the answer will be?";
  }

  if (!assessment?.answerGate?.allowed) {
    return missingTitles.length
      ? `Look at the scene. ${companionHint} What would ${missingTitles.join(" and ")} add to the picture?`.trim()
      : "There's more to build. What do you think is missing from the scene?";
  }

  if (liveChallenge?.unlocked && !liveChallenge.complete) {
    return `The scene is built. The ${liveChallenge.metric === "surfaceArea" ? "surface area" : "volume"} is currently ${liveChallenge.currentValue}. How would you get it to ${liveChallenge.targetValue}?`;
  }

  return "What do you notice in the scene? What stands out to you?";
}
