import { normalizeScenePlan } from "../../../src/ai/planSchema.js";
import {
  EPSILON,
  buildAnalyticLessonStages,
  buildAnalyticMoments,
  buildBaseQuestionFields,
  buildCommonAnalyticActions,
  formatNumber,
  normalizePromptText,
  round,
} from "./analyticMath.js";
import {
  DEFAULT_BOARD_ID,
  buildBoardCameraBookmarks,
  buildTextLessonBoard,
  buildTextOverlayStack,
} from "./textBoard.js";

const SYSTEM_CATEGORY = "system of linear equations";
const SYSTEM_SUBTYPE = "system_of_linear_equations";

function cleanZero(value) {
  return Math.abs(Number(value) || 0) <= EPSILON ? 0 : Number(value);
}

function isNumericToken(token = "") {
  return /^-?\d+(?:\.\d+)?$/i.test(token);
}

function isLetterToken(token = "") {
  return /^[a-z]$/i.test(token);
}

function tokenizeLinearPrompt(questionText = "") {
  return normalizePromptText(questionText)
    .replace(/([=+-])/g, " $1 ")
    .replace(/(\d)([a-z])/gi, "$1 $2")
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function parseVariableTerm(tokens = [], start = 0) {
  let index = start;
  let sign = 1;

  if (tokens[index] === "+" || tokens[index] === "-") {
    sign = tokens[index] === "-" ? -1 : 1;
    index += 1;
  }

  if (index >= tokens.length) return null;

  let coefficient = 1;
  if (isNumericToken(tokens[index])) {
    coefficient = Number(tokens[index]);
    index += 1;
  }

  const variable = tokens[index];
  if (!isLetterToken(variable)) return null;
  index += 1;

  return {
    end: index,
    coefficient: sign * coefficient,
    variable: variable.toLowerCase(),
    text: `${sign < 0 ? "-" : ""}${coefficient !== 1 ? coefficient : ""}${variable.toLowerCase()}`,
  };
}

function looksLikeEquationStart(tokens = [], start = 0) {
  let index = start;
  let term = parseVariableTerm(tokens, index);
  if (!term) return false;
  index = term.end;

  while (index < tokens.length && (tokens[index] === "+" || tokens[index] === "-")) {
    term = parseVariableTerm(tokens, index);
    if (!term) break;
    index = term.end;
  }

  return tokens[index] === "=";
}

function parseRhsTerm(tokens = [], start = 0) {
  let index = start;
  let sign = 1;

  if (tokens[index] === "+" || tokens[index] === "-") {
    sign = tokens[index] === "-" ? -1 : 1;
    index += 1;
  }

  if (index >= tokens.length) return null;

  if (isNumericToken(tokens[index])) {
    const first = Number(tokens[index]);
    index += 1;

    if (index < tokens.length && isLetterToken(tokens[index]) && !looksLikeEquationStart(tokens, index)) {
      const symbol = tokens[index].toLowerCase();
      index += 1;
      return {
        end: index,
        kind: "parameter",
        symbol,
        coefficient: sign * first,
      };
    }

    return {
      end: index,
      kind: "constant",
      value: sign * first,
    };
  }

  if (isLetterToken(tokens[index])) {
    const symbol = tokens[index].toLowerCase();
    index += 1;
    return {
      end: index,
      kind: "parameter",
      symbol,
      coefficient: sign,
    };
  }

  return null;
}

function parseEquationAt(tokens = [], start = 0) {
  const lhsTerms = [];
  let index = start;
  let nextTerm = parseVariableTerm(tokens, index);
  if (!nextTerm) return null;

  lhsTerms.push(nextTerm);
  index = nextTerm.end;

  while (index < tokens.length && (tokens[index] === "+" || tokens[index] === "-")) {
    nextTerm = parseVariableTerm(tokens, index);
    if (!nextTerm) break;
    lhsTerms.push(nextTerm);
    index = nextTerm.end;
  }

  if (tokens[index] !== "=") return null;
  index += 1;

  const rhsTerms = [];
  let rhsTerm = parseRhsTerm(tokens, index);
  if (!rhsTerm) return null;
  rhsTerms.push(rhsTerm);
  index = rhsTerm.end;

  while (index < tokens.length && (tokens[index] === "+" || tokens[index] === "-")) {
    rhsTerm = parseRhsTerm(tokens, index);
    if (!rhsTerm) break;
    rhsTerms.push(rhsTerm);
    index = rhsTerm.end;
  }

  return {
    end: index,
    lhsTerms,
    rhsTerms,
    text: `${lhsTerms.map((term, termIndex) => {
      const coeff = term.coefficient;
      const prefix = coeff < 0 ? "-" : (termIndex > 0 ? "+" : "");
      const magnitude = Math.abs(coeff);
      return `${prefix}${magnitude === 1 ? "" : formatNumber(magnitude)}${term.variable}`;
    }).join(" ")} = ${rhsTerms.map((term, termIndex) => {
      if (term.kind === "constant") {
        const prefix = term.value < 0 ? "-" : (termIndex > 0 ? "+" : "");
        return `${prefix}${formatNumber(Math.abs(term.value))}`;
      }
      const prefix = term.coefficient < 0 ? "-" : (termIndex > 0 ? "+" : "");
      const magnitude = Math.abs(term.coefficient);
      return `${prefix}${magnitude === 1 ? "" : formatNumber(magnitude)}${term.symbol}`;
    }).join(" ")}`,
  };
}

function extractSystemEquations(questionText = "") {
  const tokens = tokenizeLinearPrompt(questionText);
  const equations = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const parsed = parseEquationAt(tokens, index);
    if (!parsed) continue;
    equations.push(parsed);
    index = parsed.end - 1;
  }

  return equations;
}

function normaliseEquationPayload(equations = []) {
  if (!equations.length) return null;

  const variableOrder = [];
  equations.forEach((equation) => {
    equation.lhsTerms.forEach((term) => {
      if (!variableOrder.includes(term.variable)) {
        variableOrder.push(term.variable);
      }
    });
  });

  const rhsSymbols = [...new Set(
    equations.flatMap((equation) =>
      equation.rhsTerms
        .filter((term) => term.kind === "parameter")
        .map((term) => term.symbol)
    )
  )];
  const parameterSymbol = rhsSymbols.length === 1 ? rhsSymbols[0] : null;

  const coefficientMatrix = equations.map((equation) => variableOrder.map((variable) =>
    cleanZero(equation.lhsTerms
      .filter((term) => term.variable === variable)
      .reduce((sum, term) => sum + term.coefficient, 0))
  ));

  const rhsExpressions = equations.map((equation) => equation.rhsTerms.reduce((accumulator, term) => {
    if (term.kind === "constant") {
      return {
        parameterCoeff: accumulator.parameterCoeff,
        constant: accumulator.constant + term.value,
      };
    }
    if (!parameterSymbol || term.symbol !== parameterSymbol) {
      return {
        ...accumulator,
        unsupported: true,
      };
    }
    return {
      parameterCoeff: accumulator.parameterCoeff + term.coefficient,
      constant: accumulator.constant,
    };
  }, {
    parameterCoeff: 0,
    constant: 0,
    unsupported: false,
  }));

  if (rhsExpressions.some((expression) => expression.unsupported)) {
    return null;
  }

  return {
    variableOrder,
    parameterSymbol,
    coefficientMatrix,
    rhsExpressions: rhsExpressions.map(({ parameterCoeff, constant }) => ({
      parameterCoeff: cleanZero(parameterCoeff),
      constant: cleanZero(constant),
    })),
    equations: equations.map((equation) => ({
      text: equation.text.replace(/\s+/g, " ").trim(),
    })),
  };
}

function transpose(matrix = []) {
  if (!matrix.length) return [];
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]));
}

function rref(matrix = []) {
  const working = matrix.map((row) => row.map((value) => cleanZero(value)));
  const pivotColumns = [];
  let leadRow = 0;

  for (let column = 0; column < (working[0]?.length || 0) && leadRow < working.length; column += 1) {
    let pivotRow = leadRow;
    while (pivotRow < working.length && Math.abs(working[pivotRow][column]) <= EPSILON) {
      pivotRow += 1;
    }
    if (pivotRow >= working.length) continue;

    if (pivotRow !== leadRow) {
      [working[leadRow], working[pivotRow]] = [working[pivotRow], working[leadRow]];
    }

    const pivot = working[leadRow][column];
    for (let currentColumn = column; currentColumn < working[leadRow].length; currentColumn += 1) {
      working[leadRow][currentColumn] = cleanZero(working[leadRow][currentColumn] / pivot);
    }

    for (let row = 0; row < working.length; row += 1) {
      if (row === leadRow) continue;
      const factor = working[row][column];
      if (Math.abs(factor) <= EPSILON) continue;
      for (let currentColumn = column; currentColumn < working[row].length; currentColumn += 1) {
        working[row][currentColumn] = cleanZero(working[row][currentColumn] - (factor * working[leadRow][currentColumn]));
      }
    }

    pivotColumns.push(column);
    leadRow += 1;
  }

  return {
    matrix: working,
    pivotColumns,
  };
}

function nullspaceBasis(matrix = []) {
  if (!matrix.length || !matrix[0]?.length) return [];
  const { matrix: reduced, pivotColumns } = rref(matrix);
  const freeColumns = [...Array(matrix[0].length).keys()].filter((column) => !pivotColumns.includes(column));

  return freeColumns.map((freeColumn) => {
    const vector = Array(matrix[0].length).fill(0);
    vector[freeColumn] = 1;

    pivotColumns.forEach((pivotColumn, rowIndex) => {
      vector[pivotColumn] = cleanZero(-reduced[rowIndex][freeColumn]);
    });

    return vector;
  });
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function normalizeDependencyVector(vector = []) {
  const rounded = vector.map((value) => {
    const nearestInteger = Math.round(value);
    return Math.abs(value - nearestInteger) <= 1e-6 ? nearestInteger : round(value, 6);
  });

  if (rounded.every((value) => Number.isInteger(value))) {
    const divisor = rounded.reduce((current, value) => {
      if (!value) return current;
      return greatestCommonDivisor(current || value, value);
    }, 0) || 1;
    return rounded.map((value) => cleanZero(value / divisor));
  }

  const firstNonZero = rounded.find((value) => Math.abs(value) > EPSILON);
  if (!firstNonZero) return rounded.map(() => 0);
  return rounded.map((value) => cleanZero(value / Math.abs(firstNonZero)));
}

function dependencyCondition(dependency = [], rhsExpressions = []) {
  return dependency.reduce((accumulator, weight, index) => ({
    parameterCoeff: cleanZero(accumulator.parameterCoeff + (weight * (rhsExpressions[index]?.parameterCoeff || 0))),
    constant: cleanZero(accumulator.constant + (weight * (rhsExpressions[index]?.constant || 0))),
  }), {
    parameterCoeff: 0,
    constant: 0,
  });
}

function valuesAlmostEqual(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 1e-6;
}

function solveConsistency(conditions = []) {
  let requiredValue = null;

  for (const condition of conditions) {
    if (Math.abs(condition.parameterCoeff) <= EPSILON) {
      if (Math.abs(condition.constant) <= EPSILON) continue;
      return { kind: "none", value: null };
    }

    const candidate = cleanZero(-condition.constant / condition.parameterCoeff);
    if (requiredValue == null) {
      requiredValue = candidate;
      continue;
    }
    if (!valuesAlmostEqual(requiredValue, candidate)) {
      return { kind: "none", value: null };
    }
  }

  if (requiredValue == null) {
    return { kind: "all", value: null };
  }

  return {
    kind: "value",
    value: cleanZero(requiredValue),
  };
}

function formatEquationReference(index) {
  return `E_${index + 1}`;
}

function formatSignedMultiple(value, reference) {
  const scalar = cleanZero(value);
  if (Math.abs(scalar) <= EPSILON) return "";
  const sign = scalar < 0 ? "-" : "";
  const magnitude = Math.abs(scalar);
  if (Math.abs(magnitude - 1) <= EPSILON) {
    return `${sign}${reference}`;
  }
  return `${sign}${formatNumber(magnitude)}${reference}`;
}

function formatRelationFromDependency(dependency = [], targetIndex = -1) {
  const targetWeight = dependency[targetIndex];
  if (targetIndex < 0 || Math.abs(targetWeight) <= EPSILON) return "";

  const references = dependency
    .map((weight, index) => {
      if (index === targetIndex || Math.abs(weight) <= EPSILON) return "";
      return formatSignedMultiple(cleanZero(-weight / targetWeight), formatEquationReference(index));
    })
    .filter(Boolean);

  if (!references.length) return "";

  const expression = references
    .join(" + ")
    .replace(/\+\s-\s/g, "- ");

  return `${formatEquationReference(targetIndex)} = ${expression}`;
}

function buildLinearSystemClassification(system = null) {
  if (!system?.coefficientMatrix?.length) return null;
  if (!system.parameterSymbol) return null;

  const dependencies = nullspaceBasis(transpose(system.coefficientMatrix))
    .map((dependency) => normalizeDependencyVector(dependency))
    .filter((dependency) => dependency.some((value) => Math.abs(value) > EPSILON));
  if (!dependencies.length) return null;

  const parameterEquationIndex = system.rhsExpressions.findIndex((expression) => Math.abs(expression.parameterCoeff) > EPSILON);
  const rank = rref(system.coefficientMatrix).pivotColumns.length;
  const consistency = solveConsistency(dependencies.map((dependency) => dependencyCondition(dependency, system.rhsExpressions)));

  const relation = parameterEquationIndex >= 0
    ? formatRelationFromDependency(dependencies.find((dependency) => Math.abs(dependency[parameterEquationIndex]) > EPSILON) || [], parameterEquationIndex)
    : "";
  const dependency = dependencies.find((entry) => entry.some((value) => Math.abs(value) > EPSILON)) || [];
  const relationCondition = dependencyCondition(dependency, system.rhsExpressions);
  const expectedConstant = parameterEquationIndex >= 0
    ? cleanZero(system.rhsExpressions[parameterEquationIndex].constant - relationCondition.constant)
    : null;
  const infiniteSolutions = rank < system.variableOrder.length && consistency.kind === "value"
    ? consistency.value
    : rank < system.variableOrder.length && consistency.kind === "all"
      ? "all"
      : null;
  const noSolutionCondition = consistency.kind === "value"
    ? `${system.parameterSymbol} != ${formatNumber(consistency.value)}`
    : consistency.kind === "none"
      ? "all values"
      : null;

  return {
    rank,
    dependency,
    relation,
    consistency,
    parameterEquationIndex,
    expectedConstant,
    infiniteSolutions,
    noSolutionCondition,
  };
}

function commonLearningMoments(sceneMoments = [], category = SYSTEM_CATEGORY, insight = "") {
  return {
    orient: {
      title: "Read the system",
      coachMessage: sceneMoments[0]?.prompt || "",
      goal: sceneMoments[0]?.goal || "",
      prompt: sceneMoments[0]?.prompt || "",
      insight: "",
      whyItMatters: `Seeing the whole ${category} first makes the consistency check easier to follow.`,
    },
    build: {
      title: "Compare equations",
      coachMessage: sceneMoments[1]?.prompt || sceneMoments[0]?.prompt || "",
      goal: sceneMoments[1]?.goal || "",
      prompt: sceneMoments[1]?.prompt || "",
      insight: "",
      whyItMatters: "The left-hand sides tell you whether the equations can all be true together.",
    },
    predict: {
      title: "Make the condition",
      coachMessage: sceneMoments[2]?.prompt || "",
      goal: sceneMoments[2]?.goal || "",
      prompt: sceneMoments[2]?.prompt || "",
      insight,
      whyItMatters: "A single compatibility condition decides whether the system is consistent.",
    },
    check: {
      title: "Classify",
      coachMessage: sceneMoments[3]?.prompt || "",
      goal: sceneMoments[3]?.goal || "",
      prompt: sceneMoments[3]?.prompt || "",
      insight: "",
      whyItMatters: "Rank and consistency tell you whether the solutions disappear or become a family.",
    },
    reflect: {
      title: "Explain",
      coachMessage: sceneMoments[4]?.prompt || "",
      goal: sceneMoments[4]?.goal || "",
      prompt: sceneMoments[4]?.prompt || "",
      insight,
      whyItMatters: "Reflection helps the learner reuse the same logic on the next parametric system.",
    },
    challenge: {
      title: "Ask More",
      coachMessage: "Ask about any equation, row relation, or consistency step.",
      goal: "Keep the explanation tied to the visible equations.",
      prompt: "Which part of the system should Spatial Math AI unpack next?",
      insight: "",
      whyItMatters: "Follow-up questions stay anchored to the system on the board.",
    },
  };
}

function buildMomentSteps(sceneMoments = [], objectIds = []) {
  return sceneMoments.map((moment, index) => ({
    id: moment.id,
    title: moment.title,
    instruction: moment.goal,
    hint: moment.prompt,
    action: index < 2 ? "observe" : "answer",
    focusConcept: SYSTEM_CATEGORY,
    coachPrompt: moment.prompt,
    suggestedObjectIds: objectIds,
    requiredObjectIds: objectIds,
    cameraBookmarkId: moment.cameraBookmarkId,
    highlightObjectIds: moment.focusTargets || [],
  }));
}

export function parseLinearSystemQuestion(questionText = "") {
  const equations = extractSystemEquations(questionText);
  if (equations.length < 2) return null;

  const normalized = normaliseEquationPayload(equations);
  if (!normalized?.variableOrder?.length) return null;

  return normalized;
}

export function buildLinearSystemPlan(questionText = "", sourceSummary = {}) {
  const lowerQuestion = normalizePromptText(questionText).toLowerCase();
  if (!/\b(system|equations?)\b/.test(lowerQuestion) && !/\bno solutions?\b/.test(lowerQuestion) && !/\binfinite\b/.test(lowerQuestion)) {
    return null;
  }

  const system = parseLinearSystemQuestion(questionText);
  if (!system?.parameterSymbol) return null;

  const classification = buildLinearSystemClassification(system);
  if (!classification?.relation || classification.consistency.kind === "none" && classification.rank >= system.variableOrder.length) {
    return null;
  }

  const infiniteValue = classification.infiniteSolutions === "all"
    ? "all values"
    : classification.infiniteSolutions != null
      ? formatNumber(classification.infiniteSolutions)
      : null;
  const noSolutionText = classification.noSolutionCondition
    ? classification.noSolutionCondition
    : classification.consistency.kind === "all"
      ? "never"
      : "all values";
  const finalAnswer = infiniteValue && infiniteValue !== "all values"
    ? `Infinite solutions when ${system.parameterSymbol} = ${infiniteValue}; no solutions when ${system.parameterSymbol} != ${infiniteValue}.`
    : infiniteValue === "all values"
      ? "The system has infinitely many solutions for every parameter value."
      : `No solutions for ${noSolutionText}.`;

  const overview = "Show the equations on a lesson board, compare the dependent rows, and use the consistency condition to decide when the system has no solution or infinitely many solutions.";
  const board = buildTextLessonBoard({
    id: DEFAULT_BOARD_ID,
    label: "System board",
    title: "System board",
    purpose: "Keep the full system and the consistency check visible while the tutor walks through the parameter logic.",
    width: 11,
    height: 8,
    color: "#22304a",
  });

  const baseOverlays = buildTextOverlayStack([
    "System of linear equations",
    ...system.equations.map((equation, index) => `${formatEquationReference(index)}: ${equation.text}`),
    `Task: decide when the system has no solutions and when it has infinitely many solutions.`,
  ], {
    prefix: "linear-system-base",
    startY: 6.1,
    step: 1.04,
    z: 0.2,
  });
  const relationOverlay = buildTextOverlayStack([
    `Dependent row relation: ${classification.relation}`,
    `So the right-hand side must match the same relation.`,
  ], {
    prefix: "linear-system-relation",
    startY: 1.0,
    step: 0.92,
    z: 0.2,
    style: "annotation",
  });
  const conditionText = infiniteValue && infiniteValue !== "all values"
    ? `Consistency condition: ${system.parameterSymbol} = ${infiniteValue}`
    : `Consistency condition: the right-hand side already matches for every ${system.parameterSymbol}.`;
  const conditionOverlay = buildTextOverlayStack([
    conditionText,
    `Rank of coefficients = ${classification.rank}, variables = ${system.variableOrder.length}`,
  ], {
    prefix: "linear-system-condition",
    startY: -1.1,
    step: 0.92,
    z: 0.2,
    style: "annotation",
  });
  const answerOverlay = buildTextOverlayStack([
    `Infinite solutions: ${infiniteValue ? `${system.parameterSymbol} = ${infiniteValue}` : "none"}`,
    `No solutions: ${noSolutionText}`,
  ], {
    prefix: "linear-system-answer",
    startY: -2.95,
    step: 0.92,
    z: 0.2,
    style: "formula",
  });
  const sceneOverlays = [
    ...baseOverlays,
    ...relationOverlay,
    ...conditionOverlay,
    ...answerOverlay,
  ];
  const overlayIds = Object.fromEntries(sceneOverlays.map((overlay) => [overlay.id, overlay.id]));
  const cameraBookmarks = buildBoardCameraBookmarks({
    id: "system-board",
    label: "System board",
    description: "Frame the equations and the consistency notes together.",
    position: [0, 3.2, 12.5],
    target: [0, 2.8, 0],
  });

  const sceneMoments = buildAnalyticMoments([
    {
      id: "observe",
      title: "Observe",
      prompt: "Read the three equations first and notice that the question is asking for consistency, not a single numeric solution.",
      goal: "Identify the full system and the parameter you need to classify.",
      focusTargets: [DEFAULT_BOARD_ID],
      visibleObjectIds: [DEFAULT_BOARD_ID],
      visibleOverlayIds: baseOverlays.map((overlay) => overlay.id),
      cameraBookmarkId: "system-board",
    },
    {
      id: "relate",
      title: "Relate",
      prompt: "Compare the coefficient rows. The third left-hand side is not independent; it is forced by the first two equations.",
      goal: "Spot the row dependency before touching the parameter.",
      focusTargets: [DEFAULT_BOARD_ID],
      visibleObjectIds: [DEFAULT_BOARD_ID],
      visibleOverlayIds: [
        ...baseOverlays.map((overlay) => overlay.id),
        ...relationOverlay.map((overlay) => overlay.id),
      ],
      cameraBookmarkId: "system-board",
    },
    {
      id: "condition",
      title: "Condition",
      prompt: "Once the left-hand side is fixed by the first two equations, the right-hand side has to satisfy the same relation. That gives the key value of the parameter.",
      goal: "Turn the row relation into the consistency condition.",
      focusTargets: [DEFAULT_BOARD_ID],
      visibleObjectIds: [DEFAULT_BOARD_ID],
      visibleOverlayIds: [
        ...baseOverlays.map((overlay) => overlay.id),
        ...relationOverlay.map((overlay) => overlay.id),
        ...conditionOverlay.map((overlay) => overlay.id),
      ],
      cameraBookmarkId: "system-board",
      revealFormula: true,
    },
    {
      id: "classify",
      title: "Classify",
      prompt: "Now classify the system. When the condition is met, the system stays consistent with fewer independent equations than variables, so it has infinitely many solutions. Otherwise it becomes inconsistent.",
      goal: "Separate the infinite-solution case from the no-solution case.",
      focusTargets: [DEFAULT_BOARD_ID],
      visibleObjectIds: [DEFAULT_BOARD_ID],
      visibleOverlayIds: [
        ...baseOverlays.map((overlay) => overlay.id),
        ...relationOverlay.map((overlay) => overlay.id),
        ...conditionOverlay.map((overlay) => overlay.id),
        ...answerOverlay.map((overlay) => overlay.id),
      ],
      cameraBookmarkId: "system-board",
      revealFormula: true,
    },
    {
      id: "explain",
      title: "Explain",
      prompt: "Explain the logic in one sentence: the equations are dependent on the left, so the parameter only decides whether that dependence stays consistent or becomes contradictory.",
      goal: "Connect dependency, consistency, and the final classification.",
      focusTargets: [DEFAULT_BOARD_ID],
      visibleObjectIds: [DEFAULT_BOARD_ID],
      visibleOverlayIds: Object.values(overlayIds),
      cameraBookmarkId: "system-board",
      revealFormula: true,
      revealFullSolution: true,
    },
  ]);

  const lessonStages = buildAnalyticLessonStages(sceneMoments)
    .map((stage, index) => ({
      ...stage,
      suggestedActions: buildCommonAnalyticActions(index < sceneMoments.length - 1),
    }));

  const formulaText = `${classification.relation} \\Rightarrow ${system.parameterSymbol} = ${infiniteValue || "?"}`;
  const solutionSteps = [
    {
      id: "step-compare-rows",
      title: "Compare the coefficient rows",
      formula: classification.relation,
      explanation: "The third equation does not add a new left-hand-side pattern. Its coefficients are a dependent combination of the first two rows.",
    },
    {
      id: "step-match-constants",
      title: "Match the right-hand side",
      formula: conditionText,
      explanation: "A dependent left-hand side can only stay consistent when the constants follow the same relation.",
    },
    {
      id: "step-classify-rank",
      title: "Use rank to classify the system",
      formula: `rank = ${classification.rank} < ${system.variableOrder.length}`,
      explanation: "Because there are fewer independent equations than variables, consistency produces infinitely many solutions instead of a unique one.",
    },
    {
      id: "step-answer",
      title: "State the final classification",
      formula: finalAnswer,
      explanation: "The parameter decides whether the dependent third equation matches the first two or contradicts them.",
    },
  ];

  return normalizeScenePlan({
    ...buildBaseQuestionFields(questionText, SYSTEM_SUBTYPE, {
      ...sourceSummary,
      cleanedQuestion: sourceSummary.cleanedQuestion || questionText,
    }, overview),
    problem: {
      id: `analytic-${SYSTEM_SUBTYPE}`,
      question: sourceSummary.cleanedQuestion || questionText,
      questionType: SYSTEM_CATEGORY,
      summary: overview,
      mode: "guided",
    },
    sceneFocus: {
      concept: SYSTEM_CATEGORY,
      primaryInsight: "A dependent system stays solvable only when the constants obey the same row relation as the coefficients.",
      focusPrompt: "Compare the dependent row first, then test whether the parameter keeps the system consistent.",
      judgeSummary: "The learner identifies the row dependency, turns it into a consistency condition, and then classifies the system using rank.",
    },
    learningMoments: commonLearningMoments(sceneMoments, SYSTEM_CATEGORY, "The parameter controls consistency, not the row dependency itself."),
    objectSuggestions: [board],
    buildSteps: buildMomentSteps(sceneMoments, [DEFAULT_BOARD_ID]),
    lessonStages,
    cameraBookmarks,
    answerScaffold: {
      finalAnswer,
      unit: "",
      formula: formulaText,
      explanation: "Compare the dependent row on the left-hand side, force the constants to match, and then use rank to decide between infinitely many solutions and no solution.",
      checks: [
        "Find the row dependency in the coefficient matrix.",
        "Match the constants using the same dependency.",
        "Use rank to decide whether the consistent case is infinite or unique.",
      ],
    },
    analyticContext: {
      subtype: SYSTEM_SUBTYPE,
      entities: {
        points: [],
        lines: [],
        planes: [],
      },
      derivedValues: {
        parameterSymbol: system.parameterSymbol,
        variableOrder: system.variableOrder,
        rank: classification.rank,
        infiniteSolutions: infiniteValue,
        noSolutionCondition: noSolutionText,
      },
      formulaCard: {
        title: "Consistency Check",
        formula: formulaText,
        explanation: "The left-hand side is already dependent, so the parameter only decides whether the third equation agrees with the first two or contradicts them.",
      },
      solutionSteps,
    },
    sceneMoments,
    sceneOverlays,
    challengePrompts: [{
      id: "system-follow-up",
      prompt: "Why does a dependent third equation give infinitely many solutions only when its constant matches the first two equations?",
      expectedKind: "text",
      expectedAnswer: null,
      tolerance: 0,
    }],
    liveChallenge: null,
  });
}

export { SYSTEM_CATEGORY, SYSTEM_SUBTYPE };
