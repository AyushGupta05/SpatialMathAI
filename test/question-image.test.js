import test from "node:test";
import assert from "node:assert/strict";

import {
  createPastedQuestionImageFile,
  extractPastedQuestionImageFile,
  MAX_PROVIDER_IMAGE_ASPECT_RATIO,
  normalizeQuestionImageLayout,
  prepareQuestionImageForUpload,
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

test("prepareQuestionImageForUpload pads tall images before they reach the model", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const originalFile = globalThis.File;
  const drawCalls = [];
  const fillCalls = [];

  class FakeCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        fillStyle: "",
        fillRect: (...args) => {
          fillCalls.push(args);
        },
        drawImage: (...args) => {
          drawCalls.push(args);
        },
      };
    }

    async convertToBlob({ type }) {
      return new Blob([Uint8Array.from([1, 2, 3, 4])], { type });
    }
  }

  class FakeFile extends Blob {
    constructor(parts, name, options = {}) {
      super(parts, options);
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
    }
  }

  globalThis.createImageBitmap = async () => ({
    width: 120,
    height: 2600,
    close() {},
  });
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.File = FakeFile;

  try {
    const file = new File([Uint8Array.from([9, 9, 9])], "worksheet.png", { type: "image/png" });
    const prepared = await prepareQuestionImageForUpload(file);
    const layout = normalizeQuestionImageLayout(120, 2600);

    assert.equal(prepared.name, "worksheet-prepared.png");
    assert.equal(prepared.type, "image/png");
    assert.deepEqual(fillCalls[0], [0, 0, layout.canvasWidth, layout.canvasHeight]);
    assert.equal(drawCalls[0][1], layout.offsetX);
    assert.equal(drawCalls[0][2], layout.offsetY);
    assert.equal(drawCalls[0][3], layout.drawWidth);
    assert.equal(drawCalls[0][4], layout.drawHeight);
    assert.ok((layout.canvasHeight / layout.canvasWidth) <= MAX_PROVIDER_IMAGE_ASPECT_RATIO);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    globalThis.File = originalFile;
  }
});

test("prepareQuestionImageForUpload returns the original file when preprocessing is unnecessary", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  globalThis.createImageBitmap = async () => ({
    width: 640,
    height: 480,
    close() {},
  });
  globalThis.OffscreenCanvas = class UnexpectedCanvas {
    constructor() {
      throw new Error("Canvas should not be created for ordinary uploads");
    }
  };

  try {
    const file = new File([Uint8Array.from([1, 2, 3])], "ordinary.png", { type: "image/png" });
    const prepared = await prepareQuestionImageForUpload(file);

    assert.equal(prepared, file);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
