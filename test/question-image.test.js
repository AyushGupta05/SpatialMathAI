import test from "node:test";
import assert from "node:assert/strict";

import {
  createPastedQuestionImageFile,
  extractPastedQuestionImageFile,
  MAX_PROVIDER_IMAGE_ASPECT_RATIO,
  normalizeQuestionImageLayout,
} from "../src/ui/questionImage.js";

test("createPastedQuestionImageFile renames clipboard images consistently", () => {
  const file = createPastedQuestionImageFile(new Blob(["hello"], { type: "image/png" }));

  assert.ok(file instanceof File);
  assert.equal(file.name, "pasted-question.png");
  assert.equal(file.type, "image/png");
});

test("extractPastedQuestionImageFile returns the first image clipboard item", () => {
  const imageBlob = new Blob(["image-bytes"], { type: "image/webp" });
  const clipboardItems = [
    { type: "text/plain", getAsFile: () => null },
    { type: "image/webp", getAsFile: () => imageBlob },
  ];

  const file = extractPastedQuestionImageFile(clipboardItems);

  assert.ok(file instanceof File);
  assert.equal(file.name, "pasted-question.webp");
  assert.equal(file.type, "image/webp");
});

test("extractPastedQuestionImageFile ignores clipboard data without an image", () => {
  const clipboardItems = [{ type: "text/plain", getAsFile: () => null }];

  const file = extractPastedQuestionImageFile(clipboardItems);

  assert.equal(file, null);
});

test("normalizeQuestionImageLayout pads tall uploads so the provider aspect ratio stays within bounds", () => {
  const layout = normalizeQuestionImageLayout(120, 4200);

  assert.equal(layout.drawHeight, 2048);
  assert.equal(layout.canvasHeight, 2048);
  assert.equal(layout.canvasWidth, Math.ceil(2048 / MAX_PROVIDER_IMAGE_ASPECT_RATIO));
  assert.ok((layout.canvasHeight / layout.canvasWidth) <= MAX_PROVIDER_IMAGE_ASPECT_RATIO);
  assert.equal(layout.needsProcessing, true);
});

test("normalizeQuestionImageLayout leaves ordinary uploads untouched", () => {
  const layout = normalizeQuestionImageLayout(1200, 800);

  assert.equal(layout.canvasWidth, 1200);
  assert.equal(layout.canvasHeight, 800);
  assert.equal(layout.drawWidth, 1200);
  assert.equal(layout.drawHeight, 800);
  assert.equal(layout.needsProcessing, false);
});
