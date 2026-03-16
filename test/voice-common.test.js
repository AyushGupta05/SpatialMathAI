import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConversationPreambleEvents,
  buildVoiceCoachPrompt,
  normalizeVoiceHistoryForRealtime,
} from "../server/services/voiceCommon.js";

test("normalizeVoiceHistoryForRealtime drops leading assistant-only history", () => {
  const normalized = normalizeVoiceHistoryForRealtime([
    { role: "assistant", content: "Hello there." },
    { role: "user", content: "Can you help?" },
    { role: "assistant", content: "Of course." },
  ]);

  assert.deepEqual(normalized, [
    { role: "user", content: "Can you help?" },
    { role: "assistant", content: "Of course." },
  ]);
});

test("buildConversationPreambleEvents only sends realtime history once it starts with a user turn", () => {
  const events = buildConversationPreambleEvents({
    promptName: "voice-turn",
    systemPrompt: "System prompt",
    history: [
      { role: "assistant", content: "Bad leading assistant turn." },
      { role: "user", content: "What should I do next?" },
      { role: "assistant", content: "Look at the highlighted vector." },
    ],
  });

  const historyStarts = events
    .filter((event) => event?.event?.contentStart?.contentName?.startsWith("history_"))
    .map((event) => ({
      role: event.event.contentStart.role,
      contentName: event.event.contentStart.contentName,
    }));

  assert.deepEqual(historyStarts, [
    { role: "USER", contentName: "history_0" },
    { role: "ASSISTANT", contentName: "history_1" },
  ]);
});

test("buildConversationPreambleEvents keeps audio output configured even for caption_only playback", () => {
  const events = buildConversationPreambleEvents({
    promptName: "voice-turn",
    systemPrompt: "System prompt",
    playbackMode: "caption_only",
    history: [],
  });

  const promptStart = events.find((event) => event?.event?.promptStart)?.event?.promptStart;
  assert.ok(promptStart?.audioOutputConfiguration);
  assert.equal(promptStart.audioOutputConfiguration.mediaType, "audio/lpcm");
});

test("buildConversationPreambleEvents raises the realtime Sonic token cap", () => {
  const events = buildConversationPreambleEvents({
    promptName: "voice-turn",
    systemPrompt: "System prompt",
    history: [],
  });

  const sessionStart = events.find((event) => event?.event?.sessionStart)?.event?.sessionStart;
  assert.equal(sessionStart?.inferenceConfiguration?.maxTokens, 5000);
});

test("buildVoiceCoachPrompt without scene context answers directly and does not force overly short replies", () => {
  const prompt = buildVoiceCoachPrompt({}, { history: [] });

  assert.match(prompt, /Answer the user's question directly and completely/i);
  assert.match(prompt, /usually 2-5/i);
  assert.match(prompt, /do not force one every turn/i);
});
