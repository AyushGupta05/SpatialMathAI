import test from "node:test";
import assert from "node:assert/strict";

import { isEditableTarget, shouldIgnoreSceneHotkeys } from "../src/ui/sceneHotkeys.js";

test("isEditableTarget recognizes form fields and contenteditable elements", () => {
  assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableTarget({ tagName: "input" }), true);
  assert.equal(isEditableTarget({ isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "DIV" }), false);
});

test("shouldIgnoreSceneHotkeys yields scene shortcuts while typing", () => {
  const textarea = { tagName: "TEXTAREA" };

  assert.equal(shouldIgnoreSceneHotkeys({ key: "Backspace", target: textarea }), true);
  assert.equal(shouldIgnoreSceneHotkeys({ key: "Delete", target: textarea }), true);
  assert.equal(shouldIgnoreSceneHotkeys({ key: "Escape", target: textarea }), true);
  assert.equal(shouldIgnoreSceneHotkeys({ key: "z", ctrlKey: true, shiftKey: false, target: textarea }), true);
  assert.equal(shouldIgnoreSceneHotkeys({ key: "Delete", target: { tagName: "DIV" } }), false);
});
