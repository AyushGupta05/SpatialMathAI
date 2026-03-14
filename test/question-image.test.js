import test from "node:test";
import assert from "node:assert/strict";

import { createPastedQuestionImageFile, extractPastedQuestionImageFile } from "../src/ui/questionImage.js";

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
