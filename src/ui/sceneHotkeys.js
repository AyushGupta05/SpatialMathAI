function contentEditableValue(target) {
  if (!target || typeof target !== "object") return null;
  if (typeof target.getAttribute === "function") {
    return target.getAttribute("contenteditable");
  }
  return target.contentEditable ?? null;
}

export function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;

  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (["input", "textarea", "select"].includes(tagName)) {
    return true;
  }

  if (target.isContentEditable === true) {
    return true;
  }

  const contentEditable = contentEditableValue(target);
  if (typeof contentEditable === "string" && contentEditable.toLowerCase() !== "false") {
    return true;
  }

  if (typeof target.closest === "function") {
    return Boolean(target.closest("input, textarea, select, [contenteditable], [contenteditable='true']"));
  }

  return false;
}

export function shouldIgnoreSceneHotkeys(event = {}) {
  if (!isEditableTarget(event?.target)) return false;

  if (["Escape", "Delete", "Backspace"].includes(event.key)) {
    return true;
  }

  return (event.key === "z" || event.key === "Z")
    && (event.ctrlKey || event.metaKey)
    && !event.shiftKey;
}
