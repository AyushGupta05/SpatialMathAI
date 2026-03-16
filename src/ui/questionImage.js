function extensionForMimeType(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  const subtype = type.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return subtype || "png";
}

export const MAX_PROVIDER_IMAGE_ASPECT_RATIO = 20;
export const MAX_UPLOAD_IMAGE_DIMENSION = 2048;
const MAX_UPLOAD_IMAGE_BYTES = 3.75 * 1024 * 1024;

function clampPositiveInteger(value, fallback) {
  const next = Math.round(Number(value));
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function ceilPositiveInteger(value, fallback) {
  const next = Math.ceil(Number(value));
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function fileNameWithSuffix(name = "", suffix = "prepared", type = "image/png") {
  const trimmedName = String(name || "").trim();
  const ext = extensionForMimeType(type);
  const baseName = trimmedName.replace(/\.[^.]+$/, "") || "question-image";
  return `${baseName}-${suffix}.${ext}`;
}

function buildCanvasToBlobAttempts(preferredType = "image/png") {
  const normalizedType = String(preferredType || "").trim().toLowerCase();
  if (normalizedType === "image/jpeg") {
    return [
      { type: "image/jpeg", quality: 0.95 },
      { type: "image/jpeg", quality: 0.86 },
      { type: "image/webp", quality: 0.92 },
      { type: "image/png" },
    ];
  }
  if (normalizedType === "image/webp") {
    return [
      { type: "image/webp", quality: 0.96 },
      { type: "image/webp", quality: 0.88 },
      { type: "image/png" },
      { type: "image/jpeg", quality: 0.9 },
    ];
  }
  return [
    { type: "image/png" },
    { type: "image/webp", quality: 0.96 },
    { type: "image/webp", quality: 0.88 },
    { type: "image/jpeg", quality: 0.92 },
  ];
}

function canvasToBlob(canvas, type = "image/png", quality = undefined) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });
  }
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Canvas export failed"));
      }, type, quality);
    });
  }
  throw new Error("This browser cannot export diagram uploads");
}

function createWorkingCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("This browser cannot prepare diagram uploads");
}

async function loadRenderableImage(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(ctx, x, y, width, height) {
        ctx.drawImage(bitmap, x, y, width, height);
      },
      close() {
        bitmap.close?.();
      },
    };
  }

  if (
    typeof Image !== "function"
    || typeof URL === "undefined"
    || typeof URL.createObjectURL !== "function"
    || typeof URL.revokeObjectURL !== "function"
  ) {
    throw new Error("This browser cannot decode diagram uploads");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to read the uploaded diagram"));
      element.src = objectUrl;
    });
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      draw(ctx, x, y, width, height) {
        ctx.drawImage(image, x, y, width, height);
      },
      close() {},
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function exportPreparedImage(canvas, originalFile) {
  const attempts = buildCanvasToBlobAttempts(originalFile?.type || "image/png");
  let smallestExport = null;

  for (const attempt of attempts) {
    const blob = await canvasToBlob(canvas, attempt.type, attempt.quality).catch(() => null);
    if (!blob) continue;
    const file = new File([blob], fileNameWithSuffix(originalFile?.name, "prepared", attempt.type), {
      type: attempt.type,
    });
    if (!smallestExport || file.size < smallestExport.size) {
      smallestExport = file;
    }
    if (file.size <= MAX_UPLOAD_IMAGE_BYTES) {
      return file;
    }
  }

  return smallestExport || originalFile;
}

export function normalizeQuestionImageLayout(width, height, options = {}) {
  const maxAspectRatio = Math.max(1, Number(options.maxAspectRatio ?? MAX_PROVIDER_IMAGE_ASPECT_RATIO));
  const maxDimension = Math.max(64, Number(options.maxDimension ?? MAX_UPLOAD_IMAGE_DIMENSION));
  const sourceWidth = clampPositiveInteger(width, 1);
  const sourceHeight = clampPositiveInteger(height, 1);
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const drawWidth = clampPositiveInteger(sourceWidth * scale, 1);
  const drawHeight = clampPositiveInteger(sourceHeight * scale, 1);

  let canvasWidth = drawWidth;
  let canvasHeight = drawHeight;
  if ((drawWidth / drawHeight) > maxAspectRatio) {
    canvasHeight = ceilPositiveInteger(drawWidth / maxAspectRatio, drawHeight);
  }
  if ((drawHeight / drawWidth) > maxAspectRatio) {
    canvasWidth = ceilPositiveInteger(drawHeight / maxAspectRatio, drawWidth);
  }

  return {
    sourceWidth,
    sourceHeight,
    drawWidth,
    drawHeight,
    canvasWidth,
    canvasHeight,
    offsetX: Math.floor((canvasWidth - drawWidth) / 2),
    offsetY: Math.floor((canvasHeight - drawHeight) / 2),
    needsProcessing: canvasWidth !== sourceWidth
      || canvasHeight !== sourceHeight
      || drawWidth !== sourceWidth
      || drawHeight !== sourceHeight,
  };
}

export async function prepareQuestionImageForUpload(file, options = {}) {
  if (!(file instanceof Blob)) return file || null;
  const renderable = await loadRenderableImage(file);
  try {
    const layout = normalizeQuestionImageLayout(renderable.width, renderable.height, options);
    if (!layout.needsProcessing) {
      return file;
    }

    const canvas = createWorkingCanvas(layout.canvasWidth, layout.canvasHeight);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("This browser cannot render diagram uploads");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
    renderable.draw(ctx, layout.offsetX, layout.offsetY, layout.drawWidth, layout.drawHeight);

    return exportPreparedImage(canvas, file);
  } finally {
    renderable.close?.();
  }
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
