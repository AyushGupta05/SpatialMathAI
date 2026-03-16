import { hideEvidence } from "../ui/evidencePanel.js";

const API_BASE = "/api";

async function readJsonOrError(response, fallbackMessage) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => ({ error: fallbackMessage }));
  throw new Error(payload.error || fallbackMessage);
}

function isBinaryLike(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.arrayBuffer === "function";
}

function normalizePlanRequest(input, imageFileOrCallbacks, callbacksArg) {
  if (input && typeof input === "object" && !isBinaryLike(input)) {
    return {
      questionText: input.questionText || input.question || "",
      imageFile: input.imageFile || null,
      sceneSnapshot: input.sceneSnapshot || null,
      mode: input.mode || "guided",
      callbacks: input.callbacks || {},
    };
  }

  return {
    questionText: String(input || ""),
    imageFile: isBinaryLike(imageFileOrCallbacks) ? imageFileOrCallbacks : null,
    sceneSnapshot: null,
    mode: "guided",
    callbacks: !isBinaryLike(imageFileOrCallbacks) ? (imageFileOrCallbacks || callbacksArg || {}) : (callbacksArg || {}),
  };
}

export async function requestScenePlan(input, imageFileOrCallbacks = null, callbacksArg = {}) {
  const {
    questionText = "",
    imageFile = null,
    sceneSnapshot = null,
    mode = "guided",
    callbacks = {},
  } = normalizePlanRequest(input, imageFileOrCallbacks, callbacksArg);
  const { onMultimodalEvidence, onPlan } = callbacks;
  const nextQuestion = String(questionText || "");
  let response;

  hideEvidence();

  if (imageFile) {
    const formData = new FormData();
    formData.set("question", nextQuestion);
    formData.set("mode", mode);
    if (sceneSnapshot) {
      formData.set("sceneSnapshot", JSON.stringify(sceneSnapshot));
    }
    formData.set("image", imageFile);
    response = await fetch(`${API_BASE}/plan`, {
      method: "POST",
      body: formData,
    });
  } else {
    response = await fetch(`${API_BASE}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText: nextQuestion, sceneSnapshot, mode }),
    });
  }

  if (!response.ok) {
    return readJsonOrError(response, "Failed to generate scene plan");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Plan stream was unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = null;
  let dataLines = [];
  let finalPayload = null;

  const flushEvent = async () => {
    if (!eventName || !dataLines.length) {
      eventName = null;
      dataLines = [];
      return;
    }
    const data = JSON.parse(dataLines.join("\n"));
    if (eventName === "multimodal_evidence") {
      await onMultimodalEvidence?.(data);
    } else if (eventName === "plan") {
      onPlan?.(data);
      finalPayload = data;
    }
    eventName = null;
    dataLines = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        await flushEvent();
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
  }

  if (buffer.trim()) {
    const lines = buffer.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
  }
  await flushEvent();

  if (!finalPayload) {
    throw new Error("Plan stream ended before a plan event was received");
  }

  if (finalPayload?.scenePlan) {
    finalPayload.scenePlan = {
      ...finalPayload.scenePlan,
      sourceEvidence: finalPayload.sourceEvidence || finalPayload.scenePlan.sourceEvidence || null,
      agentTrace: finalPayload.agentTrace || finalPayload.scenePlan.agentTrace || [],
      demoPreset: finalPayload.demoPreset || finalPayload.scenePlan.demoPreset || null,
    };
  }
  return finalPayload;
}

export async function evaluateBuild({ plan, sceneSnapshot, currentStepId = null }) {
  const response = await fetch(`${API_BASE}/build/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, sceneSnapshot, currentStepId }),
  });
  return readJsonOrError(response, "Failed to evaluate build");
}

export async function askTutor({
  plan,
  sceneSnapshot,
  sceneContext = null,
  learningState,
  userMessage,
  contextStepId,
  onChunk,
  onAssessment,
  onMeta,
  onDone,
  input_source = "text",
  requires_evaluation = true,
  hint_state = null,
}) {
  const response = await fetch(`${API_BASE}/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan,
      sceneSnapshot,
      sceneContext,
      learningState,
      userMessage,
      contextStepId,
      input_source,
      requires_evaluation,
      hint_state,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Tutor request failed" }));
    throw new Error(payload.error || "Tutor request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let latestAssessment = null;
  let latestMeta = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop();

    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const payload = JSON.parse(part.slice(6));
      if (payload.type === "text" && payload.content) {
        fullText += payload.content;
        onChunk?.(payload.content);
      }
      if (payload.type === "meta" && payload.content) {
        latestMeta = payload.content;
        await onMeta?.(latestMeta);
      }
      if (payload.type === "assessment" && payload.content) {
        latestAssessment = payload.content;
        await onAssessment?.(latestAssessment);
      }
      if (payload.type === "done") {
        await onDone?.({
          text: fullText,
          assessment: latestAssessment,
          meta: latestMeta,
          done: payload,
        });
      }
      if (payload.type === "error") {
        throw new Error(payload.content || "Tutor stream error");
      }
    }
  }

  return { text: fullText, assessment: latestAssessment, ...latestMeta };
}

export async function requestSimilarTutorQuestions({ plan, limit = 3 }) {
  const response = await fetch(`${API_BASE}/tutor/similar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, limit }),
  });
  return readJsonOrError(response, "Failed to load similar tutor questions");
}

export async function requestVoiceResponse(input, playbackMode = "auto") {
  const payload = typeof input === "string"
    ? { text: input, playbackMode, mode: "narrate" }
    : { playbackMode, ...input };
  const response = await fetch(`${API_BASE}/voice/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return {
      transcript: typeof input === "string" ? input : input?.text || "",
      audioBase64: null,
      contentType: null,
      source: "browser-fallback",
      fallbackUsed: true,
    };
  }
  return response.json();
}

export async function createVoiceSession() {
  const response = await fetch(`${API_BASE}/voice/session`, {
    method: "POST",
  });
  return readJsonOrError(response, "Failed to create a voice session");
}

export function subscribeToVoiceSession(sessionId, { onEvent, onError } = {}) {
  const source = new EventSource(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/events`);
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      onEvent?.(payload);
    } catch (error) {
      onError?.(error);
    }
  };
  source.onerror = (error) => {
    onError?.(error);
  };
  return () => source.close();
}

export async function startVoiceSessionTurn({
  sessionId,
  playbackMode = "auto",
  voiceId = null,
  mode = "coach",
  context = null,
  text = "",
  requires_evaluation = true,
}) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playbackMode,
      voiceId,
      mode,
      context,
      text,
      requires_evaluation,
    }),
  });
  return readJsonOrError(response, "Failed to start the voice session");
}

export async function appendVoiceSessionAudio({
  sessionId,
  audioBase64,
  mimeType = "audio/lpcm;rate=16000;channels=1;sampleSizeBits=16",
}) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      mimeType,
    }),
  });
  return readJsonOrError(response, "Failed to stream microphone audio");
}

export async function stopVoiceSessionTurn(sessionId) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
  return readJsonOrError(response, "Failed to stop the voice session");
}

export async function interruptVoiceSessionTurn(sessionId) {
  const response = await fetch(`${API_BASE}/voice/session/${encodeURIComponent(sessionId)}/interrupt`, {
    method: "POST",
  });
  return readJsonOrError(response, "Failed to interrupt the voice session");
}

export async function fetchCapabilities() {
  const response = await fetch(`${API_BASE}/capabilities`);
  return readJsonOrError(response, "Failed to load capabilities");
}

export async function fetchChallenges() {
  const response = await fetch(`${API_BASE}/challenges`);
  return readJsonOrError(response, "Failed to load challenges");
}

export async function checkChallenge(challengeId, answer) {
  const response = await fetch(`${API_BASE}/challenges/${challengeId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  return readJsonOrError(response, "Failed to check challenge answer");
}
