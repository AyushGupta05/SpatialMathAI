export const VALID_REPRESENTATION_MODES = ["3d", "split_2d", "2d"];

export function normalizeRepresentationMode(value, fallback = "3d") {
  return VALID_REPRESENTATION_MODES.includes(value) ? value : fallback;
}

export function supports2dCompanionShape(shape = "") {
  return [
    "cube",
    "cuboid",
    "sphere",
    "cylinder",
    "cone",
    "pyramid",
  ].includes(String(shape || "").trim().toLowerCase());
}

export function inferRepresentationMode({
  experienceMode = "builder",
  questionType = "spatial",
  question = "",
  primaryShape = "",
} = {}) {
  if (experienceMode === "analytic_auto") {
    return "3d";
  }
  if (!supports2dCompanionShape(primaryShape)) {
    return "3d";
  }

  const normalizedQuestion = String(question || "").toLowerCase();
  if (/\b(net|unfold|unfolded|flatten|flat pattern|2d view|flat view)\b/.test(normalizedQuestion)) {
    return "2d";
  }
  if (String(questionType || "").trim() === "surface_area") {
    return "split_2d";
  }
  return "3d";
}
