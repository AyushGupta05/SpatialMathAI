import {
  createVoiceSession,
  startVoiceSessionTurn,
  subscribeToVoiceSession,
} from "../ai/client.js";
import { PcmAudioPlayer } from "./pcmAudioPlayer.js";

let ttsSessionId = null;
let ttsUnsubscribe = null;
let ttsAudioPlayer = null;
let pendingTtsResolve = null;
let pendingTtsTimeoutId = null;
let ttsAudioAppendChain = Promise.resolve();

function ensureAudioPlayer() {
  if (!ttsAudioPlayer) {
    ttsAudioPlayer = new PcmAudioPlayer({ sampleRate: 24000 });
  }
  return ttsAudioPlayer;
}

function clearPendingTtsTimeout() {
  if (!pendingTtsTimeoutId) return;
  window.clearTimeout(pendingTtsTimeoutId);
  pendingTtsTimeoutId = null;
}

function resolvePendingTts() {
  clearPendingTtsTimeout();
  if (!pendingTtsResolve) return;
  pendingTtsResolve();
  pendingTtsResolve = null;
}

function settlePendingTtsAfterPlayback() {
  const player = ttsAudioPlayer;
  if (!player || !player.isPlaying()) {
    resolvePendingTts();
    return;
  }
  player.whenIdle().then(() => {
    resolvePendingTts();
  }).catch(() => {
    resolvePendingTts();
  });
}

function handleTtsEvent(event = {}) {
  if (event.type === "assistant_audio") {
    ttsAudioAppendChain = ttsAudioAppendChain
      .then(() => ensureAudioPlayer()
      .appendBase64Chunk(event.audioBase64, event.sampleRateHertz || 24000)
      .catch((error) => {
        console.warn("Sonic TTS audio playback failed:", error);
      }));
    return;
  }

  if (event.type === "done" || event.type === "interrupted") {
    ttsAudioAppendChain
      .catch(() => {})
      .finally(() => {
        settlePendingTtsAfterPlayback();
      });
  }
}

async function ensureTtsSession() {
  if (ttsSessionId && ttsUnsubscribe) {
    return ttsSessionId;
  }

  const session = await createVoiceSession();
  ttsSessionId = session.conversationId || session.sessionId || ttsSessionId;
  ttsUnsubscribe = subscribeToVoiceSession(ttsSessionId, {
    onEvent: handleTtsEvent,
    onError: (error) => {
      console.warn("Sonic TTS session stream failed:", error);
      resolvePendingTts();
    },
  });
  return ttsSessionId;
}

function replaceFraction(match, numerator, denominator) {
  return `${numerator} over ${denominator}`;
}

export function stripMarkupForSpeech(text = "") {
  return String(text || "")
    .replace(/\$\$([\s\S]+?)\$\$/g, "$1")
    .replace(/\$(?!\$)([\s\S]+?)\$(?!\$)/g, "$1")
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, replaceFraction)
    .replace(/\\vec\s*\{([^}]*)\}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function sonicAvailable() {
  return typeof window !== "undefined" && typeof window.fetch === "function";
}

async function startTextOnlyTurn(text) {
  const sessionId = await ensureTtsSession();
  ensureAudioPlayer().stop();
  ttsAudioAppendChain = Promise.resolve();
  const playbackDone = new Promise((resolve) => {
    pendingTtsResolve = resolve;
    clearPendingTtsTimeout();
    pendingTtsTimeoutId = window.setTimeout(resolvePendingTts, 8000);
  });
  try {
    await startVoiceSessionTurn({
      sessionId,
      mode: "narrate",
      text,
      context: null,
      playbackMode: "auto",
      requires_evaluation: false,
    });
    await playbackDone;
  } catch (error) {
    resolvePendingTts();
    throw error;
  }
}

export async function dispatchTTS(text) {
  if (!sonicAvailable()) return;
  const plainText = stripMarkupForSpeech(text);
  if (!plainText) return;
  await startTextOnlyTurn(plainText);
}
