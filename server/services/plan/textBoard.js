const DEFAULT_BOARD_ID = "analysis-board";

export function buildTextLessonBoard({
  id = DEFAULT_BOARD_ID,
  label = "Lesson board",
  title = "Lesson board",
  purpose = "Use the board to keep the important equations and checks visible during the walkthrough.",
  width = 10,
  height = 7,
  color = "#1d3557",
  position = [0, 3.2, -0.6],
  rotation = [Math.PI / 2, 0, 0],
  optional = false,
  tags = ["primary", "board"],
  roles = ["board", "reference"],
} = {}) {
  return {
    id,
    title,
    purpose,
    optional,
    tags,
    roles,
    object: {
      id,
      label,
      shape: "plane",
      color,
      position,
      rotation,
      params: {
        width,
        depth: height,
      },
      metadata: {
        role: roles[0] || "board",
        roles,
        lessonBoard: true,
      },
    },
  };
}

export function buildTextOverlayStack(
  lines = [],
  {
    prefix = "board-line",
    startY = 5.4,
    step = 1.04,
    x = 0,
    z = 0.18,
    style = "formula",
  } = {},
) {
  return (Array.isArray(lines) ? lines : [])
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `${prefix}-${index + 1}`,
      type: "text",
      position: [x, startY - (index * step), z],
      text,
      style,
    }));
}

export function buildBoardCameraBookmarks({
  id = "board-overview",
  label = "Board",
  description = "Frame the lesson board and its guided notes.",
  position = [0, 3.2, 12],
  target = [0, 3.0, 0],
} = {}) {
  return [{
    id,
    label,
    description,
    position,
    target,
  }];
}

export { DEFAULT_BOARD_ID };
