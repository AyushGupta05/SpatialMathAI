function extensionForMimeType(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  const subtype = type.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return subtype || "png";
}

export function createPastedQuestionImageFile(blob) {
  if (!(blob instanceof Blob)) return null;
  const type = blob.type || "image/png";
  if (!type.startsWith("image/")) return null;
  return new File([blob], `pasted-question.${extensionForMimeType(type)}`, { type });
}

export function extractPastedQuestionImageFile(clipboardItems) {
  const items = Array.isArray(clipboardItems) ? clipboardItems : [...(clipboardItems || [])];
  const imageItem = items.find((item) => item?.type?.startsWith("image/") && typeof item.getAsFile === "function");
  if (!imageItem) return null;
  return createPastedQuestionImageFile(imageItem.getAsFile());
}
