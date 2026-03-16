import { analyticSubtypeForQuestion, normalizePromptText } from "./analyticMath.js";
import {
  SYSTEM_SUBTYPE,
  buildLinearSystemPlan,
  parseLinearSystemQuestion,
} from "./analyticLinearSystem.js";
import { buildLinePlaneAnglePlan, buildLinePlaneIntersectionPlan } from "./analyticLinePlane.js";
import { buildSkewLinesDistancePlan } from "./analyticSkew.js";

function detectLinearSystemSubtype(questionText = "") {
  const normalized = normalizePromptText(questionText).toLowerCase();
  if (!/\b(system|equations?)\b/.test(normalized) && !/\bno solutions?\b/.test(normalized)) {
    return null;
  }
  return parseLinearSystemQuestion(questionText) ? SYSTEM_SUBTYPE : null;
}

export function detectAnalyticSubtype(questionText = "") {
  return analyticSubtypeForQuestion(questionText) || detectLinearSystemSubtype(questionText);
}

export function buildAnalyticPlan(questionText = "", sourceSummary = {}) {
  const sourceQuestion = questionText || sourceSummary.cleanedQuestion || "";
  const linearSystemPlan = buildLinearSystemPlan(sourceQuestion, sourceSummary);
  if (linearSystemPlan) {
    return linearSystemPlan;
  }
  const subtype = detectAnalyticSubtype(sourceQuestion);
  if (!subtype) {
    return buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
      || buildLinePlaneAnglePlan(sourceQuestion, sourceSummary)
      || buildSkewLinesDistancePlan(sourceQuestion, sourceSummary);
  }

  switch (subtype) {
    case "line_plane_intersection":
      return buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
        || buildLinePlaneAnglePlan(sourceQuestion, sourceSummary)
        || buildSkewLinesDistancePlan(sourceQuestion, sourceSummary);
    case "line_plane_angle":
      return buildLinePlaneAnglePlan(sourceQuestion, sourceSummary)
        || buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
        || buildSkewLinesDistancePlan(sourceQuestion, sourceSummary);
    case "skew_lines_distance":
      return buildSkewLinesDistancePlan(sourceQuestion, sourceSummary)
        || buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
        || buildLinePlaneAnglePlan(sourceQuestion, sourceSummary);
    case SYSTEM_SUBTYPE:
      return buildLinearSystemPlan(sourceQuestion, sourceSummary)
        || buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
        || buildLinePlaneAnglePlan(sourceQuestion, sourceSummary)
        || buildSkewLinesDistancePlan(sourceQuestion, sourceSummary);
    default:
      return buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
        || buildLinePlaneAnglePlan(sourceQuestion, sourceSummary)
        || buildSkewLinesDistancePlan(sourceQuestion, sourceSummary);
  }
}
