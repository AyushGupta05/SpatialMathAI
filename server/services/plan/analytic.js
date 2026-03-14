import { analyticSubtypeForQuestion } from "./analyticMath.js";
import { buildLinePlaneAnglePlan, buildLinePlaneIntersectionPlan } from "./analyticLinePlane.js";
import { buildSkewLinesDistancePlan } from "./analyticSkew.js";

export function detectAnalyticSubtype(questionText = "") {
  return analyticSubtypeForQuestion(questionText);
}

export function buildAnalyticPlan(questionText = "", sourceSummary = {}) {
  const sourceQuestion = questionText || sourceSummary.cleanedQuestion || "";
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
    default:
      return buildLinePlaneIntersectionPlan(sourceQuestion, sourceSummary)
        || buildLinePlaneAnglePlan(sourceQuestion, sourceSummary)
        || buildSkewLinesDistancePlan(sourceQuestion, sourceSummary);
  }
}
