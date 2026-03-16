function firstValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isStandardQuestionType(value = "") {
  return ["volume", "surface_area", "composite", "spatial", "comparison"].includes(String(value || "").trim());
}

export function buildDemoPreset({ plan, sourceSummary, exemplar = null }) {
  const customCategory = !isStandardQuestionType(plan?.problem?.questionType) ? plan?.problem?.questionType : "";
  const category = exemplar?.lesson_type || customCategory || "geometry";
  const concept = plan?.sceneFocus?.concept || sourceSummary?.cleanedQuestion || "spatial reasoning";
  const insight = plan?.sceneFocus?.judgeSummary || plan?.overview || "SpatialMath turns a worksheet into an interactive 3D lesson.";

  return {
    title: firstValue(exemplar?.title, `SpatialMath: ${concept}`),
    scriptBeat: firstValue(
      exemplar?.representation_hint,
      `We start from a flat worksheet, turn it into a live 3D lesson, and let SpatialMath coach the learner through build, prediction, and feedback. ${insight}`
    ),
    recommendedCategory: category,
  };
}
