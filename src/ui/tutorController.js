import {
  requestScenePlan,
  evaluateBuild,
  askTutor,
  requestSimilarTutorQuestions,
  appendVoiceSessionAudio,
  createVoiceSession,
  interruptVoiceSessionTurn,
  startVoiceSessionTurn,
  stopVoiceSessionTurn,
  subscribeToVoiceSession,
} from "../ai/client.js";
import { buildSceneSnapshotFromSuggestions, normalizeScenePlan } from "../ai/planSchema.js";
import { computeGeometry } from "../core/geometry.js";
import { formatPlanFinalAnswer } from "../core/tutorSolution.js";
import { initLabelRenderer, renderLabels, addLabel, clearLabels } from "../render/labels.js";
import { AnalyticOverlayManager } from "../render/analyticOverlayManager.js";
import { CameraDirector } from "../render/cameraDirector.js";
import { ElectricFieldManager } from "../render/electricFieldManager.js";
import { supports2dCompanionShape } from "../ai/representationMode.js";
import { tutorState } from "../state/tutorState.js";
import {
  currentVerdictEntry,
  deriveHintTypeFromLabel,
  isAutoAdvanceEnabled,
  resolveHintFollowUpActionState,
  resolveTutorActionState,
} from "../core/tutorActions.js";
import { mergeRequiredSceneObjects, shouldSyncAnalyticScene } from "./sceneDirectiveSync.js";
import { initUnfoldDrawer, setUnfoldRepresentationMode, syncUnfoldDrawer } from "./unfoldDrawer.js";
import { hasMathMarkup, renderMathBlockHtml, renderRichTextHtml } from "./mathMarkup.js";
import { MicrophoneCapture } from "./microphoneCapture.js";
import { PcmAudioPlayer } from "./pcmAudioPlayer.js";
import { hideEvidence, initEvidencePanel, registerEvidenceAutoClose, showEvidence } from "./evidencePanel.js";
import { extractPastedQuestionImageFile, prepareQuestionImageForUpload } from "./questionImage.js";
import {
  normalizeTutorReplyText,
  shouldStartLessonFromComposer,
} from "./tutorConversation.js";
import { dispatchTTS } from "./voiceController.js";

let awaitingLearnerResponse = false;
let lastInputSource = "text";
let accumulatedTutorText = "";

let world = null;
let sceneApi = null;
let cameraDirector = null;
let assessmentTimer = null;
let questionImageFile = null;
let questionImagePreviewUrl = null;
let lastSceneFeedback = "SpatialMath will react to what you do in the scene.";
let voiceConversationId = null;
let activeMicCapture = null;
let voiceModeTogglePromise = null;
let voiceTurnStartPromise = null;
let voiceSessionUnsubscribe = null;
let voiceAudioUploadChain = Promise.resolve();
let voiceStreamDraft = null;
let voiceAudioPlayer = null;
let voiceModeEnabled = false;
let voiceTurnOpen = false;
let voiceUserSpeaking = false;
let voiceSessionState = "idle";
let voiceBufferedChunks = [];
let voiceAssistantBargeInUnlockAt = 0;
let voicePlaybackSyncToken = 0;
let lastVoiceAssessment = null;
let lastVoiceTranscript = "";
let lastAnnouncedStageKey = null;
let lastCheckpointKey = null;
let analyticOverlayManager = null;
let electricFieldManager = null;
let analyticFormulaVisible = false;
let analyticFullSolutionVisible = false;
let analyticFormulaDismissed = false;
let lastAppliedAnalyticStageId = null;
let similarQuestionRequest = null;
let stageWrapEl = null;
let currentRepresentationMode = "3d";

let questionSection;
let questionInput;
let questionSubmit;
let questionStatus;
let questionMathPreview;
let questionImageInput;
let questionImageMeta;
let questionImagePreview;
let questionImageThumb;
let questionImageClear;
let buildFromDiagramBtn;
let lessonPanelToggle;
let lessonPanelSummary;
let chatMessages;
let chatInput;
let chatSend;
let chatMathPreview;
let voiceControl;
let voiceRecordBtn;
let voiceBars;
let voiceStatus;
let stageRail;
let stageRailProgress;
let stageRailGoal;
let chatCheckpoint;
let chatCheckpointPrompt;
let checkpointYesBtn;
let checkpointUnsureBtn;
let sceneInfo;
let sceneValidation;
let cameraBookmarkList;
let objectCount;
let stepIndicator;
let formulaCard;
let formulaCardTitle;
let formulaCardEquation;
let formulaCardExplanation;
let formulaCardRevealBtn;
let formulaCardCloseBtn;
let solutionDrawer;
let solutionDrawerTitle;
let solutionDrawerAnswer;
let solutionDrawerAnswerValue;
let solutionDrawerSteps;
let solutionDrawerClose;
let newQuestionBtn;
let latestTutorActionMessage = null;
let latestTutorActionState = { actions: [], stageType: "orient", lastVerdict: null };
let lessonAutoAdvanceTimer = null;
let currentSolutionSections = [];

function clearLessonAutoAdvanceTimer() {
  if (lessonAutoAdvanceTimer) {
    window.clearTimeout(lessonAutoAdvanceTimer);
    lessonAutoAdvanceTimer = null;
  }
}

function resetComposerPulse() {
  chatInput?.classList.remove("input--awaiting");
  if (chatInput) {
    void chatInput.offsetWidth;
    chatInput.classList.add("input--awaiting");
  }
}

function focusComposerWithPlaceholder(placeholder = "") {
  awaitingLearnerResponse = true;
  if (chatInput) {
    chatInput.disabled = false;
    if (placeholder) {
      chatInput.placeholder = placeholder;
    }
    chatInput.focus();
  }
  if (chatSend) chatSend.disabled = false;
  setVoiceButtonState({ active: voiceModeEnabled, disabled: false });
  resetComposerPulse();
}

function formatNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toFixed(digits).replace(/\.00$/, "");
}

function formatKilobytes(bytes) {
  return `${formatNumber(Number(bytes) / 1024, 0)} KB`;
}

function activePlan() {
  return tutorState.plan;
}

function isAnalyticPlan(plan = activePlan()) {
  return plan?.experienceMode === "analytic_auto";
}

function currentSceneMoment(plan = activePlan()) {
  if (!plan?.sceneMoments?.length) return null;
  const currentStepId = tutorState.getCurrentStep()?.id || null;
  return plan.sceneMoments.find((moment) => moment.id === currentStepId)
    || plan.sceneMoments[Math.min(tutorState.currentStep, plan.sceneMoments.length - 1)]
    || plan.sceneMoments[0]
    || null;
}

function firstCompanionObjectId(plan = activePlan()) {
  return (plan?.objectSuggestions || [])
    .find((suggestion) => supports2dCompanionShape(suggestion?.object?.shape))
    ?.object?.id || null;
}

function defaultRepresentationDirective(plan = activePlan()) {
  const representationMode = plan?.representationMode || "3d";
  const companionObjectId = representationMode === "3d" ? null : firstCompanionObjectId(plan);
  const resolvedMode = companionObjectId ? representationMode : "3d";
  return {
    representationMode: resolvedMode,
    companionObjectId,
    companionTitle: resolvedMode === "2d" ? "2D Lesson View" : resolvedMode === "split_2d" ? "2D Companion" : "",
    companionReason: resolvedMode === "2d"
      ? "A flat view makes the surface relationship easier to compare directly."
      : resolvedMode === "split_2d"
        ? "Keep the solid visible while the 2D net shows how each face contributes."
        : "",
  };
}

function isLessonComplete() {
  return Boolean(tutorState.completionState?.complete);
}

function completionPromptKey(plan = activePlan(), suggestions = tutorState.similarQuestions || []) {
  if (!plan) return "";
  return `${plan.problem?.id || "plan"}:${plan.problem?.question || ""}:${suggestions.map((item) => item.prompt).join("|")}`;
}

function currentSnapshot() {
  return sceneApi?.snapshot?.() || { objects: [], selectedObjectId: null };
}

function selectedSceneObject(snapshot = currentSnapshot()) {
  const selectedObjectId = snapshot?.selectedObjectId || sceneApi?.getSelection?.() || null;
  return selectedObjectId ? sceneApi?.getObject?.(selectedObjectId) || null : null;
}

function selectedObjectContext(snapshot = currentSnapshot()) {
  const objectSpec = selectedSceneObject(snapshot);
  if (!objectSpec) return null;

  return {
    id: objectSpec.id,
    label: objectSpec.label || objectSpec.shape,
    shape: objectSpec.shape,
    params: objectSpec.params,
    metrics: computeGeometry(objectSpec.shape, objectSpec.params),
  };
}

function switchToTab(tabName) {
  document.querySelectorAll(".panel-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.dataset.content === tabName);
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function transcriptMessageTextNode(message) {
  return message?.querySelector(".chat-msg-text") || null;
}

function renderChatMessageHtml(content = "", options = {}) {
  const role = options.role || "tutor";
  const normalized = role === "tutor"
    ? normalizeTutorReplyText(content)
    : String(content || "").replace(/\r\n?/g, "\n").trim();
  return renderRichTextHtml(normalized);
}

function setTranscriptMessageText(message, content, options = {}) {
  const node = transcriptMessageTextNode(message);
  if (node) {
    const role = options.role || message?.dataset?.role || "tutor";
    node.innerHTML = renderChatMessageHtml(content, { role });
  }
}

function resizeChatComposer() {
  if (!chatInput) return;
  chatInput.style.height = "0px";
  const nextHeight = Math.min(Math.max(chatInput.scrollHeight, 34), 132);
  chatInput.style.height = `${nextHeight}px`;
}

function updateMathPreview(previewEl, content = "") {
  if (!previewEl) return;
  const normalized = String(content || "").trim();
  const shouldShow = Boolean(normalized) && hasMathMarkup(normalized);
  previewEl.classList.toggle("hidden", !shouldShow);
  previewEl.innerHTML = shouldShow ? renderRichTextHtml(normalized) : "";
}

function normalizeTutorActionStateInput(actionStateInput = [], fallback = {}) {
  if (Array.isArray(actionStateInput)) {
    return {
      actions: actionStateInput,
      stageType: fallback.stageType || "orient",
      lastVerdict: fallback.lastVerdict || null,
    };
  }

  return {
    actions: Array.isArray(actionStateInput?.actions) ? actionStateInput.actions : [],
    stageType: actionStateInput?.stageType || fallback.stageType || "orient",
    lastVerdict: actionStateInput?.lastVerdict || fallback.lastVerdict || null,
  };
}

function scheduleLessonAutoAdvance(message, actionState = {}) {
  clearLessonAutoAdvanceTimer();
  const plan = activePlan();
  if (!message || !plan || isLessonComplete()) return;

  const hasShowConnection = actionState.actions?.some((action) => action.id === "show_connection");
  const hasNextStage = actionState.actions?.some((action) => action.id === "next_stage");
  if (actionState.lastVerdict !== "CORRECT" || !hasShowConnection || hasNextStage || !isAutoAdvanceEnabled(plan)) {
    return;
  }

  lessonAutoAdvanceTimer = window.setTimeout(() => {
    if (latestTutorActionMessage !== message) return;
    renderMessageActions(message, {
      ...actionState,
      actions: [],
    });
    advanceLessonStage();
  }, 3000);
}

function renderMessageActions(message, actionStateInput = []) {
  if (!message) return;
  const fallbackStage = getCurrentStage()?.learningStage || tutorState.learningStage || "orient";
  const actionState = normalizeTutorActionStateInput(actionStateInput, {
    stageType: fallbackStage,
    lastVerdict: null,
  });

  clearLessonAutoAdvanceTimer();
  chatMessages?.querySelectorAll(".tutor-actions").forEach((row) => row.remove());
  latestTutorActionMessage = message;
  latestTutorActionState = {
    actions: actionState.actions.map((action) => ({ ...action })),
    stageType: actionState.stageType,
    lastVerdict: actionState.lastVerdict,
  };
  if (!actionState.actions.length) return;

  const row = document.createElement("div");
  row.className = "tutor-actions";
  row.dataset.stage = String(actionState.stageType || "orient").toLowerCase();
  row.dataset.verdict = String(actionState.lastVerdict || "none").toLowerCase();
  actionState.actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tutor-btn tutor-btn--${action.style || "secondary"}`;
    button.dataset.action = action.id;
    button.textContent = action.label;
    button.addEventListener("click", () => handleTutorAction(action));
    row.appendChild(button);
  });
  message.querySelector(".chat-msg-bubble")?.appendChild(row);
  scheduleLessonAutoAdvance(message, actionState);
}

function addTranscriptMessage(role, content, options = {}) {
  if (!chatMessages) return null;
  chatMessages.querySelector(".chat-welcome")?.remove();

  const message = document.createElement("div");
  message.className = `chat-msg is-${role}`;
  message.dataset.role = role;
  message.dataset.completion = options.completion ? "true" : "false";

  const bubble = document.createElement("div");
  bubble.className = "chat-msg-bubble";

  const text = document.createElement("div");
  text.className = "chat-msg-text";
  text.innerHTML = renderChatMessageHtml(content, {
    role,
    completion: Boolean(options.completion),
  });

  bubble.appendChild(text);
  message.appendChild(bubble);
  chatMessages.appendChild(message);

  if (options.actions?.length) {
    renderMessageActions(message, options.actions);
  } else if (options.actions && !Array.isArray(options.actions)) {
    renderMessageActions(message, options.actions);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function clearTranscript() {
  if (!chatMessages) return;
  chatMessages.innerHTML = `
    <div class="chat-welcome">
      <p class="chat-welcome-title">Let's explore together</p>
      <p class="chat-welcome-text">Ask a question, talk about the current scene, or say "show me something cool" and I'll build a math visual.</p>
    </div>
  `;
}

function setQuestionStatus(text = "", tone = "hidden") {
  if (!questionStatus) return;
  questionStatus.textContent = text;
  questionStatus.className = "question-status";
  if (!text || tone === "hidden") {
    questionStatus.classList.add("hidden");
    return;
  }
  if (tone === "loading") questionStatus.classList.add("is-loading");
  if (tone === "error") questionStatus.classList.add("is-error");
}

function updateVoiceStatus(text = "", tone = "muted") {
  if (!voiceStatus) return;
  voiceStatus.textContent = text;
  voiceStatus.className = "voice-status-text";
  voiceStatus.style.color = "";
  if (!text || tone === "hidden") {
    voiceStatus.classList.add("hidden");
    return;
  }
  voiceStatus.classList.remove("hidden");
  if (tone === "ready") voiceStatus.style.color = "var(--accent)";
  if (tone === "error") voiceStatus.style.color = "var(--danger)";
}

function setVoiceButtonState({ active = voiceModeEnabled, disabled = false } = {}) {
  if (!voiceRecordBtn) return;
  voiceRecordBtn.disabled = disabled;
  voiceRecordBtn.classList.toggle("is-recording", active);
  voiceRecordBtn.textContent = active ? "\u25A0" : "\u{1F3A4}";
  voiceRecordBtn.setAttribute("aria-pressed", String(active));
  voiceRecordBtn.setAttribute("aria-label", active ? "Turn voice mode off" : "Turn voice mode on");
}

function updateVoiceVisualState(state = "idle") {
  if (voiceControl) {
    voiceControl.classList.remove("voice--listening", "voice--processing", "voice--responding");
    if (state !== "idle") {
      voiceControl.classList.add(`voice--${state}`);
    }
  }
  if (voiceBars) {
    voiceBars.style.display = state === "responding" ? "flex" : "none";
  }
}

function ensureVoiceAudioPlayer() {
  if (!voiceAudioPlayer) {
    voiceAudioPlayer = new PcmAudioPlayer({ sampleRate: 24000 });
  }
  return voiceAudioPlayer;
}

function localVoicePlaybackActive() {
  return Boolean(voiceAudioPlayer?.isPlaying());
}

function showVoicePlaybackStatus() {
  updateVoiceVisualState("responding");
  updateVoiceStatus("SpatialMath is responding...", "ready");
}

function queueVoicePlaybackRelease() {
  const player = voiceAudioPlayer;
  if (!player) {
    voiceAssistantBargeInUnlockAt = performance.now() + 320;
    if (!voiceTurnOpen && !voiceUserSpeaking) {
      setVoiceStatusForState("idle");
    }
    return;
  }

  const syncToken = ++voicePlaybackSyncToken;
  player.whenIdle().then(() => {
    if (syncToken !== voicePlaybackSyncToken) {
      return;
    }
    voiceAssistantBargeInUnlockAt = performance.now() + 320;
    if (!voiceTurnOpen && !voiceUserSpeaking) {
      setVoiceStatusForState("idle");
    }
  }).catch(() => {
    if (syncToken !== voicePlaybackSyncToken) {
      return;
    }
    voiceAssistantBargeInUnlockAt = performance.now() + 320;
    if (!voiceTurnOpen && !voiceUserSpeaking) {
      setVoiceStatusForState("idle");
    }
  });
}

function canInterruptAssistantWithSpeech(level = 0) {
  if (localVoicePlaybackActive()) {
    return false;
  }
  if (performance.now() < voiceAssistantBargeInUnlockAt) {
    return false;
  }
  if (voiceSessionState === "responding") {
    return Number(level) >= 0.06;
  }
  return true;
}

function resetVoiceDraft() {
  voiceStreamDraft = {
    userMessage: null,
    assistantMessage: null,
    inputTranscript: "",
    assistantPreviewText: "",
    assistantFinalText: "",
    assistantAudioStarted: false,
  };
  return voiceStreamDraft;
}

function currentVoiceDraft() {
  return voiceStreamDraft || resetVoiceDraft();
}

function rememberVoiceBufferedChunk(chunk) {
  if (!chunk?.audioBase64) return;
  voiceBufferedChunks.push(chunk);
  if (voiceBufferedChunks.length > 4) {
    voiceBufferedChunks = voiceBufferedChunks.slice(-4);
  }
}

function clearVoiceBufferedChunks() {
  voiceBufferedChunks = [];
}

function setVoiceTranscript(content = "") {
  const draft = currentVoiceDraft();
  const transcript = String(content || "").trim();
  draft.inputTranscript = transcript;
  lastVoiceTranscript = transcript;
  if (!transcript) return;
  if (!draft.userMessage) {
    draft.userMessage = addTranscriptMessage("user", transcript);
    return;
  }
  setTranscriptMessageText(draft.userMessage, transcript, { role: "user" });
}

function setVoiceAssistantMessage(content = "", { final = false } = {}) {
  const draft = currentVoiceDraft();
  const nextContent = String(content || "").trim();
  if (!nextContent) return;
  if (final) {
    draft.assistantFinalText = nextContent;
  } else {
    draft.assistantPreviewText = nextContent;
  }
  const messageText = draft.assistantFinalText || draft.assistantPreviewText;
  if (!draft.assistantMessage) {
    draft.assistantMessage = addTranscriptMessage("tutor", messageText);
    return;
  }
  setTranscriptMessageText(draft.assistantMessage, messageText, {
    role: "tutor",
    completion: false,
  });
}

function closeVoiceSessionStream() {
  voiceSessionUnsubscribe?.();
  voiceSessionUnsubscribe = null;
}

async function resetVoiceSessionState() {
  closeVoiceSessionStream();
  voiceConversationId = null;
  voiceStreamDraft = null;
  voiceAudioUploadChain = Promise.resolve();
  voiceModeTogglePromise = null;
  voiceTurnStartPromise = null;
  voiceModeEnabled = false;
  voiceTurnOpen = false;
  voiceUserSpeaking = false;
  voiceSessionState = "idle";
  clearVoiceBufferedChunks();
  voiceAssistantBargeInUnlockAt = 0;
  voicePlaybackSyncToken += 1;
  if (activeMicCapture) {
    await activeMicCapture.stop();
    activeMicCapture = null;
  }
  setVoiceButtonState({ active: false });
  if (voiceAudioPlayer) {
    voiceAudioPlayer.stop();
  }
  updateVoiceStatus("", "hidden");
}

function revokeQuestionPreview() {
  if (questionImagePreviewUrl) {
    URL.revokeObjectURL(questionImagePreviewUrl);
    questionImagePreviewUrl = null;
  }
}

function renderQuestionImageState() {
  const hasImage = Boolean(questionImageFile);
  questionImageMeta?.classList.toggle("hidden", !hasImage);
  questionImagePreview?.classList.toggle("hidden", !hasImage);
  questionImageClear?.classList.toggle("hidden", !hasImage);

  if (!hasImage) {
    if (questionImageMeta) questionImageMeta.textContent = "";
    questionImageThumb?.removeAttribute("src");
    revokeQuestionPreview();
    return;
  }

  if (questionImageMeta) {
    questionImageMeta.textContent = `${questionImageFile.name} - ${formatKilobytes(questionImageFile.size)}`;
  }
  revokeQuestionPreview();
  questionImagePreviewUrl = URL.createObjectURL(questionImageFile);
  if (questionImageThumb) {
    questionImageThumb.src = questionImagePreviewUrl;
  }
}

function validateQuestionImage(file) {
  if (!file) return null;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "Only PNG, JPEG, and WEBP diagrams are supported.";
  }
  if (file.size > 3.75 * 1024 * 1024) {
    return "Uploaded diagram must be 3.75 MB or smaller.";
  }
  return null;
}

function setQuestionImageFile(file, { announcePaste = false } = {}) {
  const errorMessage = validateQuestionImage(file);
  if (errorMessage) {
    questionImageFile = null;
    if (questionImageInput) questionImageInput.value = "";
    renderQuestionImageState();
    setQuestionStatus(errorMessage, "error");
    return false;
  }

  questionImageFile = file || null;
  if (questionImageInput && !file) {
    questionImageInput.value = "";
  }
  renderQuestionImageState();
  setQuestionPanelCollapsed(questionSection?.classList.contains("is-collapsed"), { force: true });
  setQuestionStatus(
    announcePaste && file ? `Pasted image ready: ${file.name}` : "",
    announcePaste && file ? "loading" : "hidden"
  );
  return true;
}

function lessonPanelSummaryText() {
  const plan = activePlan();
  const planQuestion = plan?.sourceSummary?.cleanedQuestion || plan?.problem?.question || "";
  const promptText = questionInput?.value?.trim() || "";
  const imageSummary = questionImageFile?.name ? `Diagram: ${questionImageFile.name}` : "";
  return planQuestion || promptText || imageSummary || "Edit the prompt or upload a different diagram.";
}

function setQuestionPanelCollapsed(collapsed, { force = false } = {}) {
  const canCollapse = Boolean(activePlan());
  const nextCollapsed = Boolean(collapsed && canCollapse);

  if (!force && !canCollapse) {
    questionSection?.classList.remove("is-collapsed");
    questionSection?.setAttribute("data-collapsible", "false");
    lessonPanelToggle?.setAttribute("aria-expanded", "true");
    lessonPanelSummary?.classList.add("hidden");
    return;
  }

  questionSection?.classList.toggle("is-collapsed", nextCollapsed);
  questionSection?.setAttribute("data-collapsible", String(canCollapse));
  lessonPanelToggle?.setAttribute("aria-expanded", String(!nextCollapsed));
  if (lessonPanelSummary) {
    lessonPanelSummary.textContent = lessonPanelSummaryText();
    lessonPanelSummary.classList.toggle("hidden", !nextCollapsed);
  }
  newQuestionBtn?.classList.toggle("hidden", !nextCollapsed);
}

function currentLessonStage(plan = activePlan()) {
  if (!plan?.lessonStages?.length) return null;
  const currentStepId = tutorState.getCurrentStep()?.id || null;
  return plan.lessonStages.find((stage) => stage.id === currentStepId)
    || plan.lessonStages[Math.min(tutorState.currentStep, plan.lessonStages.length - 1)]
    || plan.lessonStages[0]
    || null;
}

function learningMomentStage(stageKey, plan = activePlan()) {
  if (!plan || !stageKey) return null;
  const moment = plan.learningMoments?.[stageKey] || {};
  return {
    id: `${stageKey}-stage`,
    learningStage: stageKey,
    title: moment.title || stageKey,
    goal: moment.goal || "",
    checkpointPrompt: moment.prompt || "",
    checkpoint: moment.prompt ? { prompt: moment.prompt } : null,
    requires_evaluation: ["predict", "check", "reflect"].includes(stageKey),
  };
}

function getCurrentStage(plan = activePlan()) {
  if (!plan) return null;
  if (["predict", "check", "reflect", "challenge"].includes(tutorState.learningStage)) {
    return learningMomentStage(tutorState.learningStage, plan);
  }
  const lessonStage = currentLessonStage(plan);
  if (!lessonStage) return null;
  return {
    ...lessonStage,
    learningStage: lessonStage.learningStage || tutorState.learningStage,
    checkpoint: lessonStage.checkpoint || (lessonStage.checkpointPrompt ? { prompt: lessonStage.checkpointPrompt } : null),
  };
}

function currentStageIndex(plan = activePlan()) {
  const stage = currentLessonStage(plan);
  if (!stage || !plan?.lessonStages?.length) return -1;
  return Math.max(0, plan.lessonStages.findIndex((candidate) => candidate.id === stage.id));
}

function currentStageKey(plan = activePlan()) {
  const stage = currentLessonStage(plan);
  return `${tutorState.learningStage}:${stage?.id || "none"}`;
}

function nextRequiredSuggestion(plan = activePlan(), assessment = tutorState.latestAssessment) {
  const suggestionId = assessment?.guidance?.nextRequiredSuggestionIds?.[0] || null;
  return suggestionId
    ? plan?.objectSuggestions?.find((suggestion) => suggestion.id === suggestionId) || null
    : null;
}

function stageFocusTargets(plan = activePlan(), assessment = tutorState.latestAssessment) {
  const stage = currentLessonStage(plan);
  if (stage?.highlightTargets?.length) {
    return stage.highlightTargets;
  }
  const suggestion = nextRequiredSuggestion(plan, assessment);
  return suggestion?.object?.id ? [suggestion.object.id] : [];
}

function fillPreviewActionObjectSpec(action, plan = activePlan(), assessment = tutorState.latestAssessment) {
  if (!action || action.kind !== "preview-required-object") return action;
  if (action.payload?.objectSpec) return action;

  const suggestionId = action.payload?.suggestionId || nextRequiredSuggestion(plan, assessment)?.id || null;
  if (!suggestionId) return action;

  const suggestion = plan?.objectSuggestions?.find((candidate) => candidate.id === suggestionId) || null;
  if (!suggestion) return action;

  return {
    ...action,
    payload: {
      ...(action.payload || {}),
      suggestionId,
      objectSpec: suggestion.object,
      highlightTargets: action.payload?.highlightTargets?.length
        ? action.payload.highlightTargets
        : [suggestion.object.id],
    },
  };
}

function stageActionsForClient(plan = activePlan(), _assessment = tutorState.latestAssessment) {
  if (!plan) return { actions: [], stageType: "orient", lastVerdict: null };
  const stage = getCurrentStage(plan);
  const learningState = tutorState.snapshot();
  const currentVerdict = currentVerdictEntry(learningState);
  const responseKind = isLessonComplete()
    ? "lesson_complete"
    : currentVerdict?.verdict
      ? "verdict"
      : stage?.requires_evaluation === false
        ? "non_evaluated"
        : "stage_opening";
  return resolveTutorActionState({
    plan,
    stage,
    learningState,
    conceptVerdict: currentVerdict,
    completionState: tutorState.completionState,
    responseKind,
  });
}

function buildSystemContextMessage(plan = activePlan()) {
  if (!plan) return "";
  const evidence = plan.sourceEvidence || {};
  const source = evidence.diagramSummary || "Using the typed prompt as the source.";
  const givens = evidence.givens?.length ? ` Givens: ${evidence.givens.join(", ")}.` : "";
  const conflicts = evidence.conflicts?.length ? ` Check this mismatch: ${evidence.conflicts.join(" ")}` : "";
  const analytic = isAnalyticPlan(plan)
    ? ` SpatialMath auto-drew the scene for ${plan.analyticContext?.subtype?.replaceAll("_", " ") || "analytic geometry"}.`
    : "";
  return `${source}${givens}${conflicts}${analytic}`.trim();
}

function buildStageIntroMessage(plan = activePlan(), assessment = tutorState.latestAssessment) {
  if (!plan) return "";

  const learningStage = tutorState.learningStage;
  const stage = currentLessonStage(plan);

  if (isAnalyticPlan(plan) && stage) {
    const moment = currentSceneMoment(plan);
    return moment?.prompt || stage.tutorIntro || stage.goal || "Take a look at the scene. What stands out to you?";
  }

  if ((learningStage === "orient" || learningStage === "build") && stage) {
    const intro = stage.tutorIntro || stage.goal || "";
    const question = assessment?.guidance?.coachFeedback || lastSceneFeedback || "";
    const representationHint = plan?.representationMode !== "3d"
      ? "Use the 2D companion to compare the surface pieces as you look at the solid."
      : "";
    return [intro, question, representationHint]
      .filter(Boolean)
      .join(" ")
      .trim() || "Look at the scene. What do you notice?";
  }

  if (learningStage === "predict") {
    const moment = plan.learningMoments?.predict || {};
    return moment.prompt || "Before we go further, what's your gut feeling about what happens here?";
  }

  if (learningStage === "check") {
    return "Now look at the scene. Does it match what you expected?";
  }

  if (learningStage === "reflect") {
    return "In your own words, what's the key idea you just saw?";
  }

  return "The scene is yours to explore. What are you curious about?";
}

function updateComposerState() {
  const hasPlan = Boolean(activePlan());
  if (chatInput) {
    chatInput.disabled = !awaitingLearnerResponse;
    if (!hasPlan) {
      chatInput.placeholder = "Chat, ask about the scene, or say 'show me something cool'";
    } else if (isLessonComplete()) {
      chatInput.placeholder = "Ask a follow-up, or type a new math question";
    } else if (tutorState.learningStage === "predict" && !tutorState.predictionState.submitted) {
      chatInput.placeholder = "What's your prediction?";
    } else {
      chatInput.placeholder = "What do you think happens next?";
    }
  }
  if (chatSend) chatSend.disabled = !awaitingLearnerResponse;
  setVoiceButtonState({ active: voiceModeEnabled, disabled: !awaitingLearnerResponse });
}

function setCheckpointState(checkpoint = null) {
  if (!chatCheckpoint || !chatCheckpointPrompt) return;
  if (!checkpoint) {
    chatCheckpoint.classList.add("hidden");
    chatCheckpointPrompt.textContent = "";
    return;
  }
  chatCheckpoint.classList.remove("hidden");
  chatCheckpointPrompt.textContent = checkpoint.prompt || "Does this look correct?";
}

async function fetchSimilarQuestionsOnce() {
  const plan = activePlan();
  const requestedPlanKey = completionPromptKey(plan, []);
  if (!plan || !isLessonComplete()) return;
  if (tutorState.similarQuestions?.length) {
    return;
  }
  if (similarQuestionRequest) {
    await similarQuestionRequest;
    return;
  }

  similarQuestionRequest = requestSimilarTutorQuestions({ plan, limit: 3 })
    .then((payload) => {
      if (completionPromptKey(activePlan(), []) !== requestedPlanKey) return;
      tutorState.setSimilarQuestions(payload?.suggestions || []);
    })
    .catch((error) => {
      console.error("Similar tutor questions failed:", error);
      tutorState.setSimilarQuestions([]);
    })
    .finally(() => {
      similarQuestionRequest = null;
    });

  await similarQuestionRequest;
}

function completeLesson({ reason = "correct-answer", revealSolution = false } = {}) {
  clearLessonAutoAdvanceTimer();
  tutorState.setCompletionState({ complete: true, reason });
  tutorState.setPhase("complete");
  tutorState.setSimilarQuestions(tutorState.similarQuestions || []);
  setCheckpointState(null);
  if (revealSolution) {
    analyticFormulaVisible = true;
    analyticFullSolutionVisible = true;
    analyticFormulaDismissed = false;
  }
  updateStageRail();
  renderAssessment(tutorState.latestAssessment);
  renderSceneInfo();
  void fetchSimilarQuestionsOnce();
}

function normalizeSolutionText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatSolutionNumber(value, digits = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  const rounded = Number(next.toFixed(digits));
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function solutionSourceText(plan = activePlan()) {
  const givens = Array.isArray(plan?.sourceSummary?.givens) ? plan.sourceSummary.givens : [];
  return [
    plan?.sourceSummary?.cleanedQuestion,
    plan?.problem?.question,
    ...givens,
  ].filter(Boolean).join(" ");
}

function parsePointMap(text = "") {
  const points = new Map();
  const pointPattern = /\b([A-Z])\s*\(\s*([-+]?\d*\.?\d+(?:\s*,\s*[-+]?\d*\.?\d+){2})\s*\)/g;
  let match = pointPattern.exec(text);
  while (match) {
    const label = match[1];
    const coordinates = match[2]
      .split(/\s*,\s*/)
      .map((value) => Number(value));
    if (coordinates.length === 3 && coordinates.every((value) => Number.isFinite(value))) {
      points.set(label, coordinates);
    }
    match = pointPattern.exec(text);
  }
  return points;
}

function parseVectorLabels(text = "") {
  const patterns = [
    /angle between (?:two |the )?(?:vectors?|lines?)\s+([A-Z]{2})\s*(?:,|and)\s*([A-Z]{2})/i,
    /vectors?\s+([A-Z]{2})\s*(?:,|and)\s*([A-Z]{2})/i,
    /lines?\s+([A-Z]{2})\s*(?:,|and)\s*([A-Z]{2})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return [match[1].toUpperCase(), match[2].toUpperCase()];
    }
  }

  return [null, null];
}

function vectorFromPoints(start = [], end = []) {
  if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 3 || end.length !== 3) {
    return null;
  }
  return end.map((value, index) => Number(value) - Number(start[index]));
}

function parenthesizedValueTex(value) {
  const formatted = formatSolutionNumber(value);
  return Number(value) < 0 ? `(${formatted})` : formatted;
}

function tupleTex(values = []) {
  return `(${values.map((value) => formatSolutionNumber(value)).join(", ")})`;
}

function tuplePlain(values = []) {
  return `(${values.map((value) => formatSolutionNumber(value)).join(", ")})`;
}

function differenceTupleTex(start = [], end = []) {
  return `(${end.map((value, index) => `${formatSolutionNumber(value)}-${parenthesizedValueTex(start[index])}`).join(", ")})`;
}

function squaredTermsTex(values = []) {
  return values.map((value) => `${parenthesizedValueTex(value)}^2`).join(" + ");
}

function squaredValuesTex(values = []) {
  return values.map((value) => formatSolutionNumber(Number(value) ** 2)).join(" + ");
}

function signedTermsTex(values = []) {
  return values.map((value, index) => {
    const formatted = formatSolutionNumber(Math.abs(Number(value)));
    if (index === 0) {
      return Number(value) < 0 ? `-${formatted}` : formatted;
    }
    return Number(value) < 0 ? `- ${formatted}` : `+ ${formatted}`;
  }).join(" ");
}

function vectorLabelTex(label = "") {
  return `\\overrightarrow{${label}}`;
}

function angleAnswerTex(angleDegrees) {
  return `\\theta = ${formatSolutionNumber(angleDegrees)}^\\circ`;
}

function buildLineLineSolutionSections(plan = activePlan()) {
  const sourceText = solutionSourceText(plan);
  const relationships = Array.isArray(plan?.sourceSummary?.relationships) ? plan.sourceSummary.relationships : [];
  const looksLikeLineLine = relationships.includes("angle_type:line_line")
    || /angle between (?:two |the )?(?:vectors?|lines?)/i.test(sourceText)
    || /vectors?\s+[A-Z]{2}\s*(?:,|and)\s*[A-Z]{2}/i.test(sourceText);

  if (!looksLikeLineLine) return [];

  const points = parsePointMap(sourceText);
  const [vectorOneLabel, vectorTwoLabel] = parseVectorLabels(sourceText);
  if (!vectorOneLabel || !vectorTwoLabel) return [];

  const [startOneLabel, endOneLabel] = vectorOneLabel.split("");
  const [startTwoLabel, endTwoLabel] = vectorTwoLabel.split("");
  const startOne = points.get(startOneLabel);
  const endOne = points.get(endOneLabel);
  const startTwo = points.get(startTwoLabel);
  const endTwo = points.get(endTwoLabel);
  if (!startOne || !endOne || !startTwo || !endTwo) return [];

  const vectorOne = vectorFromPoints(startOne, endOne);
  const vectorTwo = vectorFromPoints(startTwo, endTwo);
  if (!vectorOne || !vectorTwo) return [];

  const dotTerms = vectorOne.map((value, index) => Number(value) * Number(vectorTwo[index]));
  const dotProduct = dotTerms.reduce((total, value) => total + value, 0);
  const vectorOneSquareSum = vectorOne.reduce((total, value) => total + (Number(value) ** 2), 0);
  const vectorTwoSquareSum = vectorTwo.reduce((total, value) => total + (Number(value) ** 2), 0);
  const vectorOneMagnitude = Math.sqrt(vectorOneSquareSum);
  const vectorTwoMagnitude = Math.sqrt(vectorTwoSquareSum);
  const denominator = vectorOneMagnitude * vectorTwoMagnitude;
  if (!denominator) return [];

  const cosineValue = Math.max(-1, Math.min(1, dotProduct / denominator));
  const angleDegrees = (Math.acos(cosineValue) * 180) / Math.PI;
  const angleText = formatSolutionNumber(angleDegrees);
  const isPerpendicular = Math.abs(cosineValue) < 1e-9;

  return [
    {
      type: "prose",
      text: `We need to find the angle theta between vectors ${vectorOneLabel} and ${vectorTwoLabel} using the dot product.`,
    },
    {
      type: "formula",
      label: "Formula",
      tex: `\\theta = \\arccos\\left(\\frac{${vectorLabelTex(vectorOneLabel)} \\cdot ${vectorLabelTex(vectorTwoLabel)}}{|${vectorLabelTex(vectorOneLabel)}|\\,|${vectorLabelTex(vectorTwoLabel)}|}\\right)`,
    },
    {
      type: "step",
      label: "Step 1",
      description: `Find vector ${vectorOneLabel}`,
      tex: `${vectorLabelTex(vectorOneLabel)} = ${endOneLabel} - ${startOneLabel} = ${differenceTupleTex(startOne, endOne)} = ${tupleTex(vectorOne)}`,
      result: tuplePlain(vectorOne),
    },
    {
      type: "step",
      label: "Step 2",
      description: `Find vector ${vectorTwoLabel}`,
      tex: `${vectorLabelTex(vectorTwoLabel)} = ${endTwoLabel} - ${startTwoLabel} = ${differenceTupleTex(startTwo, endTwo)} = ${tupleTex(vectorTwo)}`,
      result: tuplePlain(vectorTwo),
    },
    {
      type: "step",
      label: "Step 3",
      description: `Compute ${vectorOneLabel} dot ${vectorTwoLabel}`,
      tex: `${vectorLabelTex(vectorOneLabel)} \\cdot ${vectorLabelTex(vectorTwoLabel)} = ${vectorOne.map((value, index) => `(${formatSolutionNumber(value)})(${formatSolutionNumber(vectorTwo[index])})`).join(" + ")} = ${signedTermsTex(dotTerms)} = ${formatSolutionNumber(dotProduct)}`,
      result: formatSolutionNumber(dotProduct),
    },
    {
      type: "step",
      label: "Step 4",
      description: `Compute |${vectorOneLabel}|`,
      tex: `|${vectorLabelTex(vectorOneLabel)}| = \\sqrt{${squaredTermsTex(vectorOne)}} = \\sqrt{${squaredValuesTex(vectorOne)}} = \\sqrt{${formatSolutionNumber(vectorOneSquareSum)}}`,
      result: `sqrt(${formatSolutionNumber(vectorOneSquareSum)}) approx ${formatSolutionNumber(vectorOneMagnitude)}`,
    },
    {
      type: "step",
      label: "Step 5",
      description: `Compute |${vectorTwoLabel}|`,
      tex: `|${vectorLabelTex(vectorTwoLabel)}| = \\sqrt{${squaredTermsTex(vectorTwo)}} = \\sqrt{${squaredValuesTex(vectorTwo)}} = \\sqrt{${formatSolutionNumber(vectorTwoSquareSum)}}`,
      result: `sqrt(${formatSolutionNumber(vectorTwoSquareSum)}) approx ${formatSolutionNumber(vectorTwoMagnitude)}`,
    },
    {
      type: "step",
      label: "Step 6",
      description: "Apply the formula",
      tex: `\\theta = \\arccos\\left(\\frac{${formatSolutionNumber(dotProduct)}}{\\sqrt{${formatSolutionNumber(vectorOneSquareSum)}} \\cdot \\sqrt{${formatSolutionNumber(vectorTwoSquareSum)}}}\\right) = \\arccos(${formatSolutionNumber(cosineValue)}) = ${angleText}^\\circ`,
      result: `${angleText} degrees`,
    },
    {
      type: "answer",
      label: "Final answer",
      tex: angleAnswerTex(angleDegrees),
      plain: isPerpendicular
        ? `theta = ${angleText} degrees (the vectors are perpendicular)`
        : `theta = ${angleText} degrees`,
    },
  ];
}

function buildGenericSolutionSections(plan = activePlan()) {
  if (!plan) return [];

  const analytic = plan.analyticContext || {};
  const finalAnswer = formatPlanFinalAnswer(plan);
  const sections = [];
  const questionText = normalizeSolutionText(plan?.sourceSummary?.cleanedQuestion || plan?.problem?.question || "");
  const formulaText = normalizeSolutionText(analytic.formulaCard?.formula || plan?.answerScaffold?.formula || "");

  if (questionText) {
    sections.push({
      type: "prose",
      text: `We need to solve: ${questionText}`,
    });
  }

  if (formulaText) {
    sections.push({
      type: "formula",
      label: "Formula",
      tex: formulaText,
    });
  }

  (analytic.solutionSteps || []).forEach((step, index) => {
    const tex = normalizeSolutionText(step?.formula || "");
    const description = normalizeSolutionText(step?.explanation || step?.title || "");
    if (!tex && !description) return;
    sections.push({
      type: "step",
      label: `Step ${index + 1}`,
      description: description || `Work through ${step?.title || `step ${index + 1}`}.`,
      tex,
      result: null,
    });
  });

  if (finalAnswer.text) {
    sections.push({
      type: "answer",
      label: "Final answer",
      tex: finalAnswer.text,
      plain: `Final answer: ${finalAnswer.text}`,
    });
  }

  return sections;
}

function solutionSectionsForPlan(plan = activePlan()) {
  const lineLineSections = buildLineLineSolutionSections(plan);
  if (lineLineSections.length) return lineLineSections;
  return buildGenericSolutionSections(plan);
}

function renderSolutionSections(sections = []) {
  return sections.map((section) => {
    switch (section.type) {
      case "prose":
        return `<div class="solution-prose">${renderRichTextHtml(section.text || "")}</div>`;

      case "formula":
        return `
          <div class="formula-card">
            <span class="formula-label">${escapeHtml(section.label || "Formula")}</span>
            <div class="formula-display">
              ${renderMathBlockHtml(section.tex || "", { displayMode: true })}
            </div>
          </div>
        `;

      case "step":
        return `
          <div class="solution-step">
            <span class="step-label">${escapeHtml(section.label || "Step")}</span>
            <div class="step-description">${renderRichTextHtml(section.description || "")}</div>
            ${section.tex
              ? `<div class="step-math">${renderMathBlockHtml(section.tex, { displayMode: true })}</div>`
              : ""}
            ${section.result
              ? `<span class="step-result">= ${escapeHtml(section.result)}</span>`
              : ""}
          </div>
        `;

      case "answer":
        return `
          <div class="solution-answer">
            <span class="answer-label">${escapeHtml(section.label || "Final answer")}</span>
            <div class="answer-math">
              ${renderMathBlockHtml(section.tex || section.plain || "", { displayMode: true })}
            </div>
            ${section.plain ? `<div class="step-result">${renderRichTextHtml(section.plain)}</div>` : ""}
          </div>
        `;

      default:
        return "";
    }
  }).join("");
}

function latestVerdictGap() {
  return currentVerdictEntry(tutorState.snapshot())?.gap || null;
}

function solutionTranscriptElement(message = null) {
  const target = message || latestTutorActionMessage;
  return transcriptMessageTextNode(target);
}

function scrollFormulaCardIntoView() {
  if (!formulaCard || formulaCard.classList.contains("hidden")) return;
  formulaCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function revealWorkedSolution(plan = activePlan()) {
  if (!plan) return;
  currentSolutionSections = [];
  tutorState.addLearnerEvent({
    stage: tutorState.currentStep,
    event: "view_solution_clicked",
    hint_count: tutorState.hint_state.current_stage_hints,
  });
  await sendTutorMessage({
    ...buildTutorPayload("show me the solution"),
    hint_state: { ...(tutorState.hint_state || {}) },
  }, {
    showUserMessage: false,
  });
}

function renderAnalyticPanels(plan = activePlan()) {
  const analytic = plan?.analyticContext || null;
  const showFormulaCard = Boolean(
    isAnalyticPlan(plan)
    && analytic
    && !analyticFormulaDismissed
    && (analyticFormulaVisible || currentSceneMoment(plan)?.revealFormula || analyticFullSolutionVisible)
  );
  const showSolutionDrawer = Boolean(isAnalyticPlan(plan) && analytic && !analyticFormulaDismissed && analyticFullSolutionVisible);

  formulaCard?.classList.toggle("hidden", !showFormulaCard);
  solutionDrawer?.classList.toggle("hidden", !showSolutionDrawer);

  if (!showFormulaCard || !analytic) return;

  if (formulaCardTitle) formulaCardTitle.textContent = analytic.formulaCard?.title || "Relevant Formula";
  if (formulaCardEquation) {
    try {
      formulaCardEquation.innerHTML = renderMathBlockHtml(analytic.formulaCard?.formula || plan.answerScaffold?.formula || "", {
        displayMode: true,
      });
    } catch {
      formulaCardEquation.textContent = analytic.formulaCard?.formula || plan.answerScaffold?.formula || "";
    }
  }
  if (formulaCardExplanation) {
    formulaCardExplanation.innerHTML = renderRichTextHtml(analytic.formulaCard?.explanation || plan.answerScaffold?.explanation || "");
  }
  if (formulaCardRevealBtn) {
    const canRevealSolution = showSolutionDrawer || tutorState.hint_state?.escalate_next === true;
    formulaCardRevealBtn.classList.toggle("hidden", !canRevealSolution);
    formulaCardRevealBtn.textContent = showSolutionDrawer ? "Hide Full Solution" : "Show me the solution";
  }

  if (showSolutionDrawer && solutionDrawerTitle && solutionDrawerSteps) {
    solutionDrawerTitle.textContent = analytic.formulaCard?.title || "Worked Solution";
    if (solutionDrawerAnswer && solutionDrawerAnswerValue) {
      solutionDrawerAnswer.classList.add("hidden");
      solutionDrawerAnswerValue.innerHTML = "";
    }
    solutionDrawerSteps.innerHTML = renderSolutionSections(currentSolutionSections.length ? currentSolutionSections : solutionSectionsForPlan(plan));
  }
}

function updateStageRail() {
  const plan = activePlan();
  if (!stageRail || !stageRailProgress || !stageRailGoal) return;
  if (!plan) {
    stageRail.classList.add("hidden");
    updateComposerState();
    return;
  }

  const stage = currentLessonStage(plan);
  const stageIndex = currentStageIndex(plan);
  const learningStage = tutorState.learningStage;

  stageRail.classList.remove("hidden");

  if (isLessonComplete()) {
    stageRailProgress.textContent = "Complete";
    stageRailGoal.textContent = "Solved. Ask a follow-up or start a similar question.";
  } else if ((learningStage === "orient" || learningStage === "build") && stage) {
    stageRailProgress.textContent = `${Math.max(stageIndex + 1, 1)} / ${plan.lessonStages.length}`;
    stageRailGoal.textContent = stage.goal || plan.sceneFocus?.focusPrompt || "";
  } else if (learningStage === "predict") {
    stageRailProgress.textContent = "Predict";
    stageRailGoal.textContent = tutorState.predictionState.submitted
      ? "Check your prediction against the scene."
      : "What's your gut feeling?";
  } else if (learningStage === "check") {
    stageRailProgress.textContent = "Check";
    stageRailGoal.textContent = "Compare your prediction with the scene.";
  } else if (learningStage === "reflect") {
    stageRailProgress.textContent = "Reflect";
    stageRailGoal.textContent = "What's the key idea?";
  } else {
    stageRailProgress.textContent = "Explore";
    stageRailGoal.textContent = "";
  }

  renderAnalyticPanels(plan);
  updateComposerState();
}

function focusStageTargets(targetIds = [], options = {}) {
  if (!sceneApi?.focusObjects) return;
  if (!targetIds?.length) {
    sceneApi.clearFocus?.();
    return;
  }
  sceneApi.focusObjects(targetIds, options);
}

function syncStepFromAssessment(plan, assessment) {
  if (!plan?.buildSteps?.length || !assessment) return;
  const stepId = assessment.guidance?.currentStepId || assessment.activeStep?.stepId || null;
  if (!stepId) return;
  const stepIndex = plan.buildSteps.findIndex((step) => step.id === stepId);
  if (stepIndex >= 0) {
    tutorState.goToStep(stepIndex);
  }
}

function renderSceneInfo() {
  if (!sceneInfo || !objectCount) return;

  const snapshot = currentSnapshot();
  const plan = activePlan();
  const selected = selectedObjectContext(snapshot);
  const count = snapshot.objects.length;

  objectCount.textContent = String(count);

  if (!plan) {
    if (!count) {
      sceneInfo.innerHTML = `<p class="muted-text">No active lesson. Build a scene manually, ask a question, or say "show me something cool."</p>`;
      return;
    }

    const freeformSelectionMarkup = selected
      ? `
        <p class="muted-text" style="margin:8px 0 0">
          Selected: <strong>${escapeHtml(selected.label)}</strong>
          <span class="formula">V = ${formatNumber(selected.metrics.volume)}, SA = ${formatNumber(selected.metrics.surfaceArea)}</span>
        </p>
      `
      : `<p class="muted-text" style="margin:8px 0 0">Select an object, or ask SpatialMath to explain or remix the scene.</p>`;

    sceneInfo.innerHTML = `
      <p style="margin:0 0 6px"><strong>Freeform scene</strong></p>
      <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
      <p class="muted-text">SpatialMath can read this scene, talk about it, and edit it if you ask.</p>
      ${freeformSelectionMarkup}
    `;
    return;
  }

  const selectionMarkup = selected
    ? `
      <p class="muted-text" style="margin:8px 0 0">
        Selected: <strong>${escapeHtml(selected.label)}</strong>
        <span class="formula">V = ${formatNumber(selected.metrics.volume)}, SA = ${formatNumber(selected.metrics.surfaceArea)}</span>
      </p>
    `
    : `<p class="muted-text" style="margin:8px 0 0">Select an object in the scene to inspect its measurements and role.</p>`;

  if (isAnalyticPlan(plan)) {
    const analyticSelectionMarkup = selected
      ? `<p class="muted-text" style="margin:8px 0 0">Selected: <strong>${escapeHtml(selected.label)}</strong> ${escapeHtml(JSON.stringify(selected.params || {}))}</p>`
      : `<p class="muted-text" style="margin:8px 0 0">Select a line, plane, point, or helper to inspect it.</p>`;
    const currentMoment = currentSceneMoment(plan);
    sceneInfo.innerHTML = `
      <p style="margin:0 0 6px"><strong>${escapeHtml(plan.sourceSummary?.cleanedQuestion || plan.problem?.question || "Current lesson")}</strong></p>
      <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently visible in the world</p>
      <p class="muted-text">Current visual step: <span class="formula">${escapeHtml(currentMoment?.title || "Observe")}</span></p>
      <p class="muted-text">Focus: <span class="formula">${escapeHtml(plan.sceneFocus?.primaryInsight || currentMoment?.goal || "")}</span></p>
      ${analyticSelectionMarkup}
    `;
    return;
  }

  sceneInfo.innerHTML = `
    <p style="margin:0 0 6px"><strong>${escapeHtml(plan.sourceSummary?.cleanedQuestion || plan.problem?.question || "Current lesson")}</strong></p>
    <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
    <p class="muted-text">Focus: <span class="formula">${escapeHtml(plan.sceneFocus?.primaryInsight || plan.sceneFocus?.focusPrompt || "Build the scene and inspect the key relationship.")}</span></p>
    ${selectionMarkup}
  `;
}

function renderAssessment(assessment) {
  if (!sceneValidation) return;

  if (isLessonComplete()) {
    sceneValidation.innerHTML = `
      <div class="validation-stat"><strong>Solved</strong></div>
      <div class="validation-stat"><strong>Next move</strong><br />Ask a follow-up or try a similar question.</div>
      <div class="validation-stat"><strong>Answer</strong><br />${escapeHtml(activePlan()?.answerScaffold?.finalAnswer || "Shown in the lesson")}</div>
    `;
    return;
  }

  if (!assessment) {
    if (!activePlan()) {
      sceneValidation.innerHTML = `<p class="muted-text">SpatialMath can chat about anything, inspect the current scene, and build a fresh math visual when you ask.</p>`;
      return;
    }
    sceneValidation.innerHTML = `<p class="muted-text">The tutor will inspect the scene and highlight the next useful idea.</p>`;
    return;
  }

  if (isAnalyticPlan()) {
    const currentMoment = currentSceneMoment();
    const formulaText = activePlan()?.analyticContext?.formulaCard?.formula || activePlan()?.answerScaffold?.formula || "";
    sceneValidation.innerHTML = `
      <div class="validation-stat"><strong>Auto scene ready</strong></div>
      <div class="validation-stat"><strong>${escapeHtml(currentMoment?.title || "Observe")}</strong><br />${escapeHtml(currentMoment?.goal || assessment.guidance?.coachFeedback || "Use the visible scene to reason.")}</div>
      <div class="validation-stat"><strong>Formula</strong><br />${formulaText ? renderMathBlockHtml(formulaText, { displayMode: true }) : "Reveal when ready"}</div>
    `;
    return;
  }

  const guidance = assessment.guidance || {};
  const readyLabel = guidance.readyForPrediction ? "Scene ready" : "Scene preview";
  sceneValidation.innerHTML = `
    <div class="validation-stat"><strong>${readyLabel}</strong></div>
    <div class="validation-stat"><strong>${assessment.summary.objectCount}</strong> object${assessment.summary.objectCount === 1 ? "" : "s"} visible</div>
    <div class="validation-stat"><strong>Next focus</strong><br />${escapeHtml(guidance.coachFeedback || "The tutor is highlighting the next relationship.")}</div>
  `;
}

function renderCameraBookmarks(plan = activePlan()) {
  if (!cameraBookmarkList) return;
  cameraBookmarkList.innerHTML = "";
  (plan?.cameraBookmarks || []).forEach((bookmark) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-bookmark-btn";
    button.textContent = bookmark.label;
    button.addEventListener("click", () => {
      cameraDirector.animateTo(bookmark.position, bookmark.target, 900);
    });
    cameraBookmarkList.appendChild(button);
  });
}

function sceneDirectiveForCurrentMoment(plan = activePlan()) {
  const representation = defaultRepresentationDirective(plan);
  if (!isAnalyticPlan(plan)) {
    return representation;
  }
  const moment = currentSceneMoment(plan);
  if (!moment) return representation;
  return {
    ...representation,
    stageId: moment.id,
    cameraBookmarkId: moment.cameraBookmarkId || null,
    focusTargets: moment.focusTargets || [],
    visibleObjectIds: moment.visibleObjectIds || [],
    visibleOverlayIds: moment.visibleOverlayIds || [],
    revealFormula: Boolean(moment.revealFormula),
    revealFullSolution: Boolean(moment.revealFullSolution),
    representationMode: moment.representationMode || representation.representationMode,
  };
}

function applyRepresentationDirective(sceneDirective = null) {
  const directive = sceneDirective || defaultRepresentationDirective();
  currentRepresentationMode = directive.representationMode || "3d";
  stageWrapEl?.setAttribute("data-representation-mode", currentRepresentationMode);
  setUnfoldRepresentationMode({
    representationMode: currentRepresentationMode,
    companionObjectId: directive.companionObjectId || null,
    companionTitle: directive.companionTitle || "",
    companionReason: directive.companionReason || "",
  });
}

function applySceneDirective(sceneDirective = null, { forceCamera = false } = {}) {
  const plan = activePlan();
  if (!sceneDirective) {
    applyRepresentationDirective(defaultRepresentationDirective(plan));
    return;
  }
  applyRepresentationDirective(sceneDirective);
  if (!isAnalyticPlan(plan)) return;

  const stageId = sceneDirective.stageId || currentSceneMoment(plan)?.id || null;
  const visibleIds = sceneDirective.visibleObjectIds?.length
    ? sceneDirective.visibleObjectIds
    : currentSceneMoment(plan)?.visibleObjectIds || [];
  const requiredSnapshot = buildSceneSnapshotFromSuggestions(plan, visibleIds);
  const snapshot = currentSnapshot();
  const shouldSyncScene = shouldSyncAnalyticScene({
    stageId,
    lastAppliedStageId: lastAppliedAnalyticStageId,
    snapshotObjects: snapshot.objects || [],
    requiredObjects: requiredSnapshot.objects || [],
  });

  if (shouldSyncScene) {
    const mergedObjects = mergeRequiredSceneObjects(snapshot.objects || [], requiredSnapshot.objects || []);
    const selectedObjectId = (snapshot.selectedObjectId && mergedObjects.some((objectSpec) => objectSpec.id === snapshot.selectedObjectId))
      ? snapshot.selectedObjectId
      : (requiredSnapshot.selectedObjectId && mergedObjects.some((objectSpec) => objectSpec.id === requiredSnapshot.selectedObjectId))
        ? requiredSnapshot.selectedObjectId
        : null;
    sceneApi?.loadSnapshot?.({
      objects: mergedObjects,
      selectedObjectId,
    }, "analytic-auto");
  }
  lastAppliedAnalyticStageId = stageId;
  analyticOverlayManager?.render(plan, sceneDirective.visibleOverlayIds || []);

  const bookmark = (plan.cameraBookmarks || []).find((item) => item.id === sceneDirective.cameraBookmarkId);
  if (bookmark && forceCamera) {
    cameraDirector.animateTo(bookmark.position, bookmark.target, 900);
  }

  if (sceneDirective.focusTargets?.length) {
    focusStageTargets(sceneDirective.focusTargets, { selectFirst: true });
  }

  if (sceneDirective.revealFormula) {
    analyticFormulaVisible = true;
    analyticFormulaDismissed = false;
  }
  if (sceneDirective.revealFullSolution) {
    analyticFormulaVisible = true;
    analyticFullSolutionVisible = true;
    analyticFormulaDismissed = false;
  }
  renderAnalyticPanels(plan);
  renderAnnotations();
}

function applyAnalyticSceneState({ forceCamera = false } = {}) {
  if (!isAnalyticPlan()) return;
  applySceneDirective(sceneDirectiveForCurrentMoment(), { forceCamera });
}

function mergeSceneObjects(baseObjects = [], nextObjects = []) {
  const byId = new Map((baseObjects || []).map((objectSpec) => [objectSpec.id, objectSpec]));
  (nextObjects || []).forEach((objectSpec) => {
    if (!objectSpec?.id) return;
    byId.set(objectSpec.id, objectSpec);
  });
  return [...byId.values()];
}

function applyAssistantSceneCommand(sceneCommand = null) {
  if (!sceneCommand?.operations?.length || !sceneApi) return false;

  sceneApi.cancelPreviewAction?.();
  let snapshot = currentSnapshot();
  let changedScene = false;

  sceneCommand.operations.forEach((operation) => {
    switch (operation.kind) {
      case "replace_scene":
        snapshot = sceneApi.loadSnapshot?.({
          objects: operation.objects || [],
          selectedObjectId: operation.selectedObjectId || null,
        }, "assistant-replace") || currentSnapshot();
        changedScene = true;
        break;
      case "merge_objects":
        snapshot = sceneApi.loadSnapshot?.({
          objects: mergeSceneObjects(snapshot.objects || [], operation.objects || []),
          selectedObjectId: snapshot.selectedObjectId || null,
        }, "assistant-merge") || currentSnapshot();
        changedScene = true;
        break;
      case "remove_objects":
        snapshot = sceneApi.loadSnapshot?.({
          objects: (snapshot.objects || []).filter((objectSpec) => !(operation.objectIds || []).includes(objectSpec.id)),
          selectedObjectId: (operation.objectIds || []).includes(snapshot.selectedObjectId) ? null : snapshot.selectedObjectId,
        }, "assistant-remove") || currentSnapshot();
        changedScene = true;
        break;
      case "select_object":
        sceneApi.selectObject?.(operation.objectId || null);
        snapshot = currentSnapshot();
        break;
      case "focus_objects":
        sceneApi.focusObjects?.(operation.targetIds || [], { selectFirst: true });
        break;
      case "clear_scene":
        sceneApi.clearScene?.();
        snapshot = currentSnapshot();
        changedScene = true;
        break;
      case "clear_focus":
        sceneApi.clearFocus?.();
        break;
      case "reset_view":
        sceneApi.resetView?.();
        break;
      default:
        break;
    }
  });

  renderAnnotations();
  renderSceneInfo();
  renderAssessment(activePlan() ? tutorState.latestAssessment : null);
  updateStageRail();
  return changedScene;
}

function renderAnnotations() {
  if (!world?.scene) return;
  if (isAnalyticPlan()) {
    return;
  }
  clearLabels(world.scene);
  currentSnapshot().objects.forEach((objectSpec) => {
    const [x, y, z] = objectSpec.position;
    addLabel(world.scene, objectSpec.label || objectSpec.shape, [x, y + 0.9, z], "name");
  });
}

function announceCurrentStage(force = false) {
  const plan = activePlan();
  if (!plan) return;
  if (isLessonComplete() && !force) return;

  const stageKey = currentStageKey(plan);
  if (!force && lastAnnouncedStageKey === stageKey) return;

  lastAnnouncedStageKey = stageKey;
  if (isAnalyticPlan(plan)) {
    applyAnalyticSceneState({ forceCamera: force });
  } else {
    applyRepresentationDirective(sceneDirectiveForCurrentMoment(plan));
    focusStageTargets(stageFocusTargets(plan), { selectFirst: tutorState.learningStage === "build" });
  }
  const actionState = resolveTutorActionState({
    plan,
    stage: getCurrentStage(plan),
    learningState: tutorState.snapshot(),
    completionState: tutorState.completionState,
    responseKind: "stage_opening",
  });
  addTranscriptMessage("tutor", buildStageIntroMessage(plan), {
    actions: actionState,
  });
}

async function syncAssessment() {
  const plan = activePlan();
  if (!plan) {
    renderAssessment(null);
    renderSceneInfo();
    setCheckpointState(null);
    updateStageRail();
    return;
  }

  try {
    const { assessment } = await evaluateBuild({
      plan,
      sceneSnapshot: currentSnapshot(),
      currentStepId: tutorState.getCurrentStep()?.id || null,
    });
    tutorState.setAssessment(assessment);
    syncStepFromAssessment(plan, assessment);

    if (isAnalyticPlan(plan)) {
      renderAssessment(assessment);
      renderSceneInfo();
      setCheckpointState(null);
      updateStageRail();
      announceCurrentStage();
      return;
    }

    if (
      tutorState.learningStage === "build"
      && assessment.guidance?.readyForPrediction
      && tutorState.currentStep >= Math.max(plan.lessonStages.length - 1, 0)
    ) {
      tutorState.setLearningStage("predict");
      tutorState.resetPrediction(plan.learningMoments?.predict?.prompt || "");
      lastSceneFeedback = "The scene is ready. Make one short prediction before the tutor explains it.";
    }

    renderAssessment(assessment);
    renderSceneInfo();
    updateStageRail();

    const checkpointKey = tutorState.learningStage === "build" && assessment?.activeStep?.complete
      ? `${assessment.activeStep.stepId}:complete`
      : null;

    if (checkpointKey && checkpointKey !== lastCheckpointKey) {
      lastCheckpointKey = checkpointKey;
      setCheckpointState({ prompt: currentLessonStage(plan)?.checkpointPrompt || "Does this match what you expected?" });
    } else if (!checkpointKey) {
      setCheckpointState(null);
    }

    announceCurrentStage();
  } catch (error) {
    console.error("Assessment sync failed:", error);
  }
}

function scheduleAssessment() {
  window.clearTimeout(assessmentTimer);
  assessmentTimer = window.setTimeout(() => {
    syncAssessment();
    renderAnnotations();
  }, 160);
}

function setPlan(plan, options = {}) {
  const normalizedPlan = normalizeScenePlan(plan);
  void resetVoiceSessionState();
  clearLessonAutoAdvanceTimer();
  lastAnnouncedStageKey = null;
  lastCheckpointKey = null;
  analyticFormulaVisible = false;
  analyticFullSolutionVisible = false;
  analyticFormulaDismissed = false;
  lastAppliedAnalyticStageId = null;
  similarQuestionRequest = null;
  currentSolutionSections = [];
  latestTutorActionMessage = null;
  latestTutorActionState = { actions: [], stageType: "orient", lastVerdict: null };
  tutorState.setPlan(normalizedPlan, { mode: options.mode || normalizedPlan.problem?.mode || "guided" });
  tutorState.setPhase(isAnalyticPlan(normalizedPlan) ? "guided_build" : "plan_ready");
  tutorState.setLearningStage(isAnalyticPlan(normalizedPlan) ? "build" : "orient");
  lastSceneFeedback = normalizedPlan.sceneFocus?.primaryInsight || "SpatialMath will react to what you do in the scene.";

  clearTranscript();
  setCheckpointState(null);
  renderCameraBookmarks(normalizedPlan);
  renderSceneInfo();
  renderAssessment(null);
  updateStageRail();

  if (options.clearScene !== false) {
    sceneApi?.clearScene?.();
  }
  sceneApi?.clearFocus?.();
  analyticOverlayManager?.clear();
  if (!isAnalyticPlan(normalizedPlan)) {
    const autoSnapshot = buildSceneSnapshotFromSuggestions(normalizedPlan);
    if (autoSnapshot.objects.length) {
      sceneApi?.loadSnapshot?.(autoSnapshot, "lesson-auto");
    }
  }
  applyRepresentationDirective(defaultRepresentationDirective(normalizedPlan));
  questionSection?.classList.add("is-compact");
  setQuestionPanelCollapsed(true, { force: true });
  switchToTab("tutor");
  const systemContext = isAnalyticPlan(normalizedPlan) ? "" : buildSystemContextMessage(normalizedPlan);
  if (systemContext) {
    addTranscriptMessage("system", systemContext);
  }
  announceCurrentStage(true);
}

async function handleQuestionSubmit(overrides = {}) {
  const questionText = (overrides.questionText ?? questionInput?.value?.trim()) || "";
  const imageFile = overrides.imageFile ?? questionImageFile;
  if (!questionText && !imageFile) return;
  if (questionText && questionInput) {
    questionInput.value = questionText;
    updateMathPreview(questionMathPreview, questionText);
  }

  tutorState.reset();
  tutorState.setPhase("parsing");
  analyticFormulaVisible = false;
  analyticFullSolutionVisible = false;
  analyticFormulaDismissed = false;
  similarQuestionRequest = null;
  analyticOverlayManager?.clear();
  hideEvidence();
  renderAnalyticPanels(null);
  if (questionSubmit) questionSubmit.disabled = true;
  setQuestionStatus("Building a staged lesson from your prompt and scene...", "loading");

  try {
    const uploadImageFile = imageFile
      ? await prepareQuestionImageForUpload(imageFile)
      : null;
    const { scenePlan } = await requestScenePlan({
      questionText,
      imageFile: uploadImageFile,
      mode: "guided",
      sceneSnapshot: currentSnapshot(),
      callbacks: {
        onMultimodalEvidence: async (data) => {
          showEvidence({
            ...data,
            _imageUrl: imageFile ? questionImagePreviewUrl : null,
          });
          registerEvidenceAutoClose();
        },
      },
    });
    setPlan(scenePlan);
    setQuestionStatus("", "hidden");
  } catch (error) {
    console.error("Plan request failed:", error);
    tutorState.setError(error.message);
    setQuestionStatus(`Error: ${error.message}`, "error");
  } finally {
    if (questionSubmit) questionSubmit.disabled = false;
  }
}

function sceneContextPayload(plan, assessment) {
  const selected = selectedObjectContext();
  return {
    objectCount: currentSnapshot().objects.length,
    selection: selected
      ? {
        id: selected.id,
        label: selected.label,
        shape: selected.shape,
        params: selected.params,
        metrics: {
          volume: Number(selected.metrics.volume.toFixed(3)),
          surfaceArea: Number(selected.metrics.surfaceArea.toFixed(3)),
        },
      }
      : null,
    sceneFocus: plan?.sceneFocus || null,
    sourceSummary: plan?.sourceSummary || null,
    guidance: assessment?.guidance || null,
    analyticContext: plan?.analyticContext || null,
    sceneMoment: currentSceneMoment(plan) || null,
    completionState: tutorState.completionState || { complete: false, reason: null },
    representationMode: currentRepresentationMode,
    formulaVisible: analyticFormulaVisible,
    fullSolutionVisible: analyticFullSolutionVisible,
    lastSceneFeedback,
  };
}

function buildTutorPayload(messageText = "") {
  const plan = activePlan();
  return {
    plan,
    sceneSnapshot: currentSnapshot(),
    sceneContext: sceneContextPayload(plan, tutorState.latestAssessment),
    learningState: tutorState.snapshot(),
    userMessage: String(messageText || "").trim(),
    contextStepId: tutorState.getCurrentStep()?.id || null,
  };
}

async function handleLearnerInput(text, options = {}) {
  const {
    input_source = "text",
    skip_server_call = false,
    user_label = null,
    show_user_message = true,
  } = options;
  const normalizedText = String(text || "").trim();

  if (!normalizedText || !awaitingLearnerResponse) return;

  awaitingLearnerResponse = false;
  lastInputSource = input_source;
  accumulatedTutorText = "";
  chatInput?.classList.remove("input--awaiting");

  if (chatInput) chatInput.disabled = true;
  if (chatSend) chatSend.disabled = true;
  setVoiceButtonState({ active: voiceModeEnabled, disabled: true });

  if (skip_server_call) return;

  if (tutorState.learningStage === "predict") {
    tutorState.submitPrediction(normalizedText);
  }

  const payload = buildTutorPayload(normalizedText);
  const currentStage = getCurrentStage();
  const requiresEval = currentStage?.requires_evaluation ?? true;
  payload.requires_evaluation = requiresEval;
  payload.input_source = input_source;
  payload.hint_state = { ...(tutorState.hint_state || {}) };

  await sendTutorMessage(payload, {
    userLabel: user_label,
    showUserMessage: show_user_message,
  });
}

function returnControlToLearner(context = {}) {
  if (awaitingLearnerResponse) return;
  awaitingLearnerResponse = true;

  if (chatInput) {
    chatInput.disabled = false;
    chatInput.focus();
  }
  if (chatSend) chatSend.disabled = false;
  setVoiceButtonState({ active: voiceModeEnabled, disabled: false });

  const placeholders = {
    CORRECT: "What do you think about the next step?",
    PARTIAL: "Have another go \u2014 what do you think now?",
    STUCK: "Take your time \u2014 what are you seeing?",
  };
  const defaultPlaceholder = chatInput?.getAttribute("data-default-placeholder")
    ?? "Ask anything about the scene...";

  let placeholder = defaultPlaceholder;
  if (context.verdict && placeholders[context.verdict]) {
    placeholder = placeholders[context.verdict];
  }
  if (
    context.verdict === "STUCK"
    && tutorState?.hint_state?.escalate_next === true
  ) {
    placeholder = "Walk me through it in your own words.";
  }
  if (isLessonComplete()) {
    placeholder = "What would you like to explore?";
  }
  if (context.verdict === "CORRECT" && context.stage) {
    const checkpointPrompt = context.stage.checkpoint?.prompt || context.stage.checkpointPrompt || "";
    if (checkpointPrompt) {
      placeholder = checkpointPrompt.length > 80
        ? `${checkpointPrompt.slice(0, 77)}...`
        : checkpointPrompt;
    }
  }
  if (chatInput) chatInput.placeholder = placeholder;

  chatInput?.classList.add("input--awaiting");

  if (lastInputSource === "voice" && accumulatedTutorText) {
    dispatchTTS(accumulatedTutorText).catch((error) => {
      console.warn("Sonic TTS failed:", error);
    });
  }
}

function beginGuidedBuild() {
  const plan = activePlan();
  if (!plan) return;
  if (isAnalyticPlan(plan)) {
    tutorState.setMode("guided");
    tutorState.setPhase("guided_build");
    tutorState.setLearningStage("build");
    applyAnalyticSceneState({ forceCamera: true });
    updateStageRail();
    announceCurrentStage(true);
    return;
  }
  tutorState.setMode("guided");
  tutorState.setPhase("guided_build");
  tutorState.setLearningStage("build");
  sceneApi?.cancelPreviewAction?.();
  sceneApi?.clearScene?.();
  lastSceneFeedback = "";
  setCheckpointState(null);
  updateStageRail();
  announceCurrentStage(true);
  scheduleAssessment();
}

function beginManualBuild() {
  const plan = activePlan();
  if (!plan) return;
  if (isAnalyticPlan(plan)) {
    applyAnalyticSceneState({ forceCamera: true });
    return;
  }
  tutorState.setMode("manual");
  tutorState.setPhase("manual_build");
  tutorState.setLearningStage("build");
  sceneApi?.cancelPreviewAction?.();
  sceneApi?.clearScene?.();
  lastSceneFeedback = "";
  setCheckpointState(null);
  updateStageRail();
  announceCurrentStage(true);
  scheduleAssessment();
}

function syncStepFromTutorResponse(response = {}, plan = activePlan()) {
  const stageId = response.stageStatus?.currentStageId || null;
  if (!plan?.lessonStages?.length || !stageId) return;
  const stageIndex = plan.lessonStages.findIndex((stage) => stage.id === stageId);
  if (stageIndex >= 0) {
    tutorState.goToStep(stageIndex);
  }
}

function syncLearningStageFromTutorResponse(response = {}, plan = activePlan()) {
  const nextLearningStage = response.nextLearningStage || response.assessment?.nextLearningStage || null;
  if (!nextLearningStage || nextLearningStage === tutorState.learningStage) {
    return;
  }
  tutorState.setLearningStage(nextLearningStage);
  if (nextLearningStage === "predict") {
    tutorState.resetPrediction(plan?.learningMoments?.predict?.prompt || "");
  }
}

function actionStateFromResponse(response = {}, plan = activePlan()) {
  if (Array.isArray(response.actions) || response.actionState) {
    return {
      actions: Array.isArray(response.actions) ? response.actions : [],
      stageType: response.actionState?.stageType || getCurrentStage(plan)?.learningStage || tutorState.learningStage,
      lastVerdict: response.actionState?.lastVerdict || response.conceptVerdict?.verdict || null,
    };
  }
  return stageActionsForClient(plan, tutorState.latestAssessment);
}

function syncSolutionRevealState(response = {}) {
  if (Array.isArray(response.solutionReveal?.sections)) {
    currentSolutionSections = response.solutionReveal.sections;
  }
}

function applyVoiceTurnResult(response = {}, plan = activePlan()) {
  const draft = voiceStreamDraft;
  const inputTranscript = String(response.inputTranscript || "").trim();
  const assistantText = String(response.assistantText || "").trim();

  if (inputTranscript) {
    tutorState.addMessage("user", inputTranscript);
  }
  if (assistantText) {
    tutorState.addMessage("assistant", assistantText);
  }

  const verdictStage = tutorState.learningStage;
  syncStepFromTutorResponse(response, plan);
  syncLearningStageFromTutorResponse(response, plan);

  if (response.conceptVerdict) {
    tutorState.addVerdict({
      stage: verdictStage,
      stageGoal: response.conceptVerdict.stageGoal || "",
      verdict: response.conceptVerdict.verdict,
      what_was_right: response.conceptVerdict.what_was_right,
      gap: response.conceptVerdict.gap,
      misconception_type: response.conceptVerdict.misconception_type,
    });
  }

  if (response.assessment) {
    tutorState.setAssessment(response.assessment);
  } else if (!plan) {
    tutorState.setAssessment(null);
  } else {
    void syncAssessment();
  }

  if (response.completionState?.complete) {
    completeLesson({
      reason: response.completionState.reason || "correct-answer",
      revealSolution: response.completionState.reason === "revealed-solution" || Boolean(response.sceneDirective?.revealFullSolution),
    });
  }

  syncSolutionRevealState(response);

  const actionState = plan
    ? actionStateFromResponse(response, plan)
    : { actions: [], stageType: tutorState.learningStage, lastVerdict: null };
  if (draft?.assistantMessage) {
    draft.assistantMessage.dataset.completion = response.completionState?.complete ? "true" : "false";
    renderMessageActions(draft.assistantMessage, actionState);
    if (response.solutionReveal?.isSolutionReveal) {
      const solutionEl = solutionTranscriptElement(draft.assistantMessage);
      if (solutionEl) {
        solutionEl.innerHTML = renderRichTextHtml(assistantText);
      }
    }
  }

  if (response.focusTargets?.length) {
    focusStageTargets(response.focusTargets, { selectFirst: true });
  }
  if (response.checkpoint && !isLessonComplete()) {
    setCheckpointState(response.checkpoint);
  } else if (!plan || isLessonComplete()) {
    setCheckpointState(null);
  }
  if (response.sceneDirective) {
    applySceneDirective(response.sceneDirective, { forceCamera: true });
  }
  if (response.sceneCommand) {
    applyAssistantSceneCommand(response.sceneCommand);
  }

  lastSceneFeedback = assistantText || lastSceneFeedback;
  renderAssessment(plan ? tutorState.latestAssessment : null);
  renderSceneInfo();
  updateStageRail();
  if (plan && !isLessonComplete()) {
    announceCurrentStage();
  }
}

async function sendTutorMessage(messageText, options = {}) {
  const payload = messageText && typeof messageText === "object" && "userMessage" in messageText
    ? { ...messageText }
    : buildTutorPayload(messageText);
  const plan = payload.plan || activePlan();
  const text = String(payload.userMessage || "").trim();
  if (!text) return;

  if (options.showUserMessage !== false) {
    addTranscriptMessage("user", options.userLabel || text);
  }
  tutorState.addMessage("user", text);

  const typing = addTranscriptMessage("tutor", "...");
  typing?.classList.add("loading-dots");
  let streamedText = "";
  let pendingVerdict = null;
  let pendingStage = null;
  let pendingLearningStage = null;

  try {
    await askTutor({
      ...payload,
      onChunk: (chunk) => {
        streamedText += chunk;
        accumulatedTutorText += chunk;
        typing?.classList.remove("loading-dots");
        setTranscriptMessageText(typing, streamedText, { role: "tutor", completion: false });
      },
      onAssessment: (assessment) => {
        if (assessment?.summary) {
          tutorState.setAssessment(assessment);
          renderAssessment(assessment);
          renderSceneInfo();
          updateStageRail();
        }
        pendingVerdict = assessment?.verdict ?? null;
        pendingStage = assessment?.nextStage ?? null;
        pendingLearningStage = assessment?.nextLearningStage ?? null;
      },
      onDone: async ({ text: finalText, assessment, meta } = {}) => {
        const response = {
          text: finalText || streamedText || "I could not generate a tutor reply.",
          assessment,
          nextLearningStage: pendingLearningStage,
          ...(meta || {}),
        };
        const conceptVerdict = response.conceptVerdict || (pendingVerdict
          ? {
            verdict: pendingVerdict,
            what_was_right: "",
            gap: null,
            misconception_type: null,
          }
          : null);
        const verdict = conceptVerdict?.verdict || pendingVerdict || null;

        typing?.classList.remove("loading-dots");
        if (typing) {
          typing.dataset.completion = response.completionState?.complete ? "true" : "false";
        }
        setTranscriptMessageText(typing, response.text, {
          role: "tutor",
          completion: Boolean(response.completionState?.complete),
        });

        syncSolutionRevealState(response);
        const verdictStage = tutorState.learningStage;
        syncStepFromTutorResponse(response, plan);
        syncLearningStageFromTutorResponse(response, plan);

        if (conceptVerdict?.verdict) {
          tutorState.addVerdict({
            stage: verdictStage,
            stageGoal: conceptVerdict.stageGoal || "",
            verdict: conceptVerdict.verdict,
            what_was_right: conceptVerdict.what_was_right,
            gap: conceptVerdict.gap,
            misconception_type: conceptVerdict.misconception_type,
          });
        }

        if (response.completionState?.complete) {
          completeLesson({
            reason: response.completionState.reason || "correct-answer",
            revealSolution: response.completionState.reason === "revealed-solution" || Boolean(response.sceneDirective?.revealFullSolution),
          });
        }

        const actionState = options.resolveActions
          ? options.resolveActions(response, { plan, verdict, typing })
          : actionStateFromResponse(response, plan);
        renderMessageActions(typing, actionState);
        if (response.solutionReveal?.isSolutionReveal) {
          const solutionEl = solutionTranscriptElement(typing);
          if (solutionEl) {
            solutionEl.innerHTML = renderRichTextHtml(accumulatedTutorText || response.text);
          }
        }
        tutorState.addMessage("assistant", response.text);

        if (response.assessment?.summary) {
          tutorState.setAssessment(response.assessment);
        } else if (!plan) {
          tutorState.setAssessment(null);
        }
        if (response.focusTargets?.length) {
          focusStageTargets(response.focusTargets, { selectFirst: true });
        }
        if (response.checkpoint && !isLessonComplete()) {
          setCheckpointState(response.checkpoint);
        } else {
          setCheckpointState(null);
        }
        if (response.sceneDirective) {
          applySceneDirective(response.sceneDirective, { forceCamera: true });
        }
        if (response.sceneCommand) {
          applyAssistantSceneCommand(response.sceneCommand);
        }

        lastSceneFeedback = response.text || lastSceneFeedback;
        renderAssessment(plan ? tutorState.latestAssessment : null);
        renderSceneInfo();
        updateStageRail();
        if (plan && !isLessonComplete()) {
          announceCurrentStage();
        }

        await options.afterResponse?.(response, { plan, verdict, typing });
        returnControlToLearner({
          verdict,
          stage: pendingStage,
        });
        pendingVerdict = null;
        pendingStage = null;
        pendingLearningStage = null;
      },
    });
  } catch (error) {
    typing?.classList.remove("loading-dots");
    setTranscriptMessageText(typing, `Error: ${error.message}`, { role: "tutor", completion: false });
    awaitingLearnerResponse = true;
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.focus();
    }
    if (chatSend) chatSend.disabled = false;
    setVoiceButtonState({ active: voiceModeEnabled, disabled: false });
  }
}

async function handleExplain() {
  await handleLearnerInput(`I'm stuck. Give me a small hint about what to focus on in the scene, without giving me the answer.`, {
    input_source: "text",
    user_label: "I need a hint",
  });
}

async function requestTutorHint(action = {}) {
  const gap = action.payload?.gap || latestVerdictGap();
  const hintType = action.payload?.hint_type || deriveHintTypeFromLabel(action.label || "");
  tutorState.useHint();
  await sendTutorMessage({
    ...buildTutorPayload("__hint_request__"),
    userMessage: "__hint_request__",
    requires_evaluation: false,
    hint_type: hintType,
    gap: hintType === "gap" ? gap || "" : "",
    hint_level: tutorState.hint_state.current_stage_hints,
    hint_state: { ...(tutorState.hint_state || {}) },
  }, {
    showUserMessage: false,
    resolveActions: (_response, { plan }) => resolveHintFollowUpActionState({
      plan,
      stage: getCurrentStage(plan),
      learningState: tutorState.snapshot(),
      completionState: tutorState.completionState,
    }),
  });
}

async function requestConnectionBridge(plan = activePlan()) {
  const nextStageActionState = resolveTutorActionState({
    plan,
    stage: getCurrentStage(plan),
    learningState: tutorState.snapshot(),
    conceptVerdict: { verdict: "CORRECT" },
    completionState: tutorState.completionState,
    responseKind: "connection_followup",
  });
  await sendTutorMessage({
    ...buildTutorPayload("__connection_request__"),
    userMessage: "__connection_request__",
    requires_evaluation: false,
    hint_state: { ...(tutorState.hint_state || {}) },
  }, {
    showUserMessage: false,
    resolveActions: () => (isAutoAdvanceEnabled(plan) ? {
      ...latestTutorActionState,
      actions: [],
    } : nextStageActionState),
    afterResponse: async (_response, { typing }) => {
      if (!isAutoAdvanceEnabled(plan)) return;
      clearLessonAutoAdvanceTimer();
      lessonAutoAdvanceTimer = window.setTimeout(() => {
        if (latestTutorActionMessage !== typing) return;
        renderMessageActions(typing, {
          ...latestTutorActionState,
          actions: [],
        });
        advanceLessonStage();
      }, 2000);
    },
  });
}

async function loadSimilarProblem(plan = activePlan()) {
  if (!plan) return;
  const suggestions = tutorState.similarQuestions?.length
    ? tutorState.similarQuestions
    : (await requestSimilarTutorQuestions({ plan, limit: 1 }))?.suggestions || [];
  const nextPrompt = suggestions[0]?.prompt || "";
  if (!nextPrompt) return;
  await handleQuestionSubmit({ questionText: nextPrompt, imageFile: null });
}

async function handleComposerSubmit() {
  const plan = activePlan();
  if (!awaitingLearnerResponse) return;
  const text = chatInput?.value?.trim();
  if (!text) return;

  chatInput.value = "";
  updateMathPreview(chatMathPreview, "");
  resizeChatComposer();

  if (shouldStartLessonFromComposer({
    text,
    hasPlan: Boolean(plan),
    lessonComplete: isLessonComplete(),
  })) {
    await handleQuestionSubmit({ questionText: text, imageFile: null });
    return;
  }

  await handleLearnerInput(text, { input_source: "text" });
}

function buildVoiceContext(plan = activePlan()) {
  const currentStage = getCurrentStage(plan);
  return {
    plan,
    sceneSnapshot: currentSnapshot(),
    sceneContext: sceneContextPayload(plan, tutorState.latestAssessment),
    learningState: tutorState.snapshot(),
    contextStepId: tutorState.getCurrentStep()?.id || null,
    requires_evaluation: currentStage?.requires_evaluation ?? false,
  };
}

function standbyVoiceStatus() {
  return voiceModeEnabled ? "Voice mode on. Start speaking any time." : "";
}

function setVoiceStatusForState(state = voiceSessionState) {
  updateVoiceVisualState(state);
  if (state === "connecting") {
    updateVoiceStatus("Connecting voice session...", "ready");
    return;
  }
  if (state === "listening") {
    updateVoiceStatus("Listening...", "ready");
    return;
  }
  if (state === "processing") {
    updateVoiceStatus(lastVoiceTranscript ? `SpatialMath heard: ${lastVoiceTranscript}` : "Processing...", "ready");
    return;
  }
  if (state === "responding") {
    updateVoiceStatus("SpatialMath is responding...", "ready");
    return;
  }
  updateVoiceStatus(standbyVoiceStatus(), voiceModeEnabled ? "ready" : "hidden");
}

function handleVoiceSessionEvent(event = {}) {
  switch (event.type) {
    case "state":
      voiceSessionState = event.state || "idle";
      if (voiceSessionState === "idle" && localVoicePlaybackActive()) {
        showVoicePlaybackStatus();
        queueVoicePlaybackRelease();
        return;
      }
      setVoiceStatusForState(voiceSessionState);
      return;
    case "assessment":
      lastVoiceAssessment = event;
      return;
    case "input_transcript":
      setVoiceTranscript(event.content || "");
      setVoiceStatusForState("processing");
      void handleLearnerInput(event.content || "", {
        input_source: "voice",
        skip_server_call: true,
        show_user_message: false,
      });
      return;
    case "assistant_text":
      setVoiceAssistantMessage(event.content || "", {
        final: event.generationStage === "FINAL",
      });
      return;
    case "assistant_audio":
      if (!currentVoiceDraft().assistantAudioStarted) {
        currentVoiceDraft().assistantAudioStarted = true;
        voiceAssistantBargeInUnlockAt = performance.now() + 1200;
      }
      ensureVoiceAudioPlayer()
        .appendBase64Chunk(event.audioBase64, event.sampleRateHertz || 24000)
        .catch((error) => {
          console.error("Voice audio playback failed:", error);
        });
      return;
    case "interrupted":
      voiceTurnOpen = false;
      voiceUserSpeaking = false;
      voiceAssistantBargeInUnlockAt = 0;
      voicePlaybackSyncToken += 1;
      ensureVoiceAudioPlayer().stop();
      setVoiceStatusForState("idle");
      return;
    case "done": {
      const draft = currentVoiceDraft();
      const hadAssistantAudio = Boolean(draft.assistantAudioStarted);
      if (event.inputTranscript) {
        setVoiceTranscript(event.inputTranscript);
      }
      setVoiceAssistantMessage(event.assistantText || "SpatialMath did not return a voice reply.", {
        final: true,
      });
      voiceConversationId = event.conversationId || voiceConversationId;
      voiceTurnOpen = false;
      voiceUserSpeaking = false;
      applyVoiceTurnResult(event);
      if (!hadAssistantAudio) {
        accumulatedTutorText = event.assistantText || "";
      }
      voiceStreamDraft = null;
      if (hadAssistantAudio && localVoicePlaybackActive()) {
        showVoicePlaybackStatus();
        queueVoicePlaybackRelease();
      } else {
        voiceAssistantBargeInUnlockAt = hadAssistantAudio ? performance.now() + 320 : 0;
        setVoiceStatusForState("idle");
      }
      returnControlToLearner({
        verdict: lastVoiceAssessment?.verdict || event.conceptVerdict?.verdict || null,
        stage: getCurrentStage(),
      });
      if (lastInputSource === "voice") {
        document.dispatchEvent(new CustomEvent("demo:voice-turn-complete"));
      }
      return;
    }
    default:
      return;
  }
}

async function ensureVoiceSessionConnected() {
  if (voiceConversationId && voiceSessionUnsubscribe) {
    return voiceConversationId;
  }

  if (!voiceConversationId) {
    const session = await createVoiceSession();
    voiceConversationId = session.conversationId || session.sessionId || voiceConversationId;
  }
  closeVoiceSessionStream();
  voiceSessionUnsubscribe = subscribeToVoiceSession(voiceConversationId, {
    onEvent: handleVoiceSessionEvent,
    onError: (error) => {
      console.error("Voice session stream error:", error);
      updateVoiceStatus("Voice session disconnected. Click the mic to reconnect.", "error");
      closeVoiceSessionStream();
    },
  });
  return voiceConversationId;
}

function queueVoiceAudioChunk(chunk) {
  if (!chunk?.audioBase64) {
    return;
  }
  if (!voiceConversationId || !voiceTurnOpen || !voiceUserSpeaking) {
    rememberVoiceBufferedChunk(chunk);
    return;
  }
  voiceAudioUploadChain = voiceAudioUploadChain
    .then(() => appendVoiceSessionAudio({
      sessionId: voiceConversationId,
      audioBase64: chunk.audioBase64,
      mimeType: chunk.mimeType,
    }))
    .catch((error) => {
      console.error("Voice audio upload failed:", error);
      updateVoiceStatus(`Voice error: ${error.message}`, "error");
    });
}

async function flushBufferedVoiceAudio() {
  const bufferedChunks = [...voiceBufferedChunks];
  clearVoiceBufferedChunks();
  for (const chunk of bufferedChunks) {
    queueVoiceAudioChunk(chunk);
  }
  await voiceAudioUploadChain;
}

async function interruptActiveVoiceTurn() {
  if (!voiceConversationId || !voiceTurnOpen) {
    return;
  }
  voiceTurnOpen = false;
  voiceUserSpeaking = false;
  clearVoiceBufferedChunks();
  ensureVoiceAudioPlayer().stop();
  try {
    await interruptVoiceSessionTurn(voiceConversationId);
  } catch (error) {
    console.error("Voice interrupt failed:", error);
    updateVoiceStatus(`Voice error: ${error.message}`, "error");
  }
}

async function startVoiceConversationTurn() {
  if (voiceTurnOpen) return;
  if (voiceTurnStartPromise) {
    await voiceTurnStartPromise.catch(() => {});
    return;
  }

  voiceTurnStartPromise = (async () => {
    try {
      const sessionId = await ensureVoiceSessionConnected();
      lastVoiceAssessment = null;
      resetVoiceDraft();
      voiceAudioUploadChain = Promise.resolve();
      const voiceContext = buildVoiceContext();
      const sessionStart = await startVoiceSessionTurn({
        sessionId,
        mode: "coach",
        context: voiceContext,
        playbackMode: "auto",
        requires_evaluation: voiceContext.requires_evaluation ?? false,
      });
      if (sessionStart.fallbackUsed) {
        updateVoiceStatus("Voice replied in captions.", "ready");
        return;
      }
      voiceTurnOpen = true;
      await flushBufferedVoiceAudio();
      updateVoiceStatus("Listening...", "ready");
    } catch (error) {
      console.error("Voice turn start failed:", error);
      updateVoiceStatus(`Voice error: ${error.message}`, "error");
      voiceTurnOpen = false;
    } finally {
      voiceTurnStartPromise = null;
    }
  })();

  await voiceTurnStartPromise;
}

async function handleVoiceSpeechStart({ level } = {}) {
  if (!voiceModeEnabled || voiceUserSpeaking) return;
  if (!canInterruptAssistantWithSpeech(level)) {
    return;
  }
  voiceUserSpeaking = true;
  ensureVoiceAudioPlayer().stop();
  if (voiceTurnOpen && voiceSessionState !== "listening") {
    await interruptActiveVoiceTurn();
  }
  await startVoiceConversationTurn();
}

async function handleVoiceSpeechEnd() {
  if (!voiceUserSpeaking) return;
  voiceUserSpeaking = false;
  if (voiceTurnStartPromise) {
    await voiceTurnStartPromise.catch(() => {});
  }
  if (!voiceTurnOpen || !voiceConversationId) {
    return;
  }
  updateVoiceStatus("Thinking...", "ready");
  try {
    await voiceAudioUploadChain;
    await stopVoiceSessionTurn(voiceConversationId);
  } catch (error) {
    console.error("Voice turn stop failed:", error);
    updateVoiceStatus(`Voice error: ${error.message}`, "error");
  }
}

async function enableVoiceMode() {
  if (voiceModeEnabled) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    updateVoiceStatus("This browser cannot capture microphone audio.", "error");
    return;
  }

  try {
    await ensureVoiceSessionConnected();
    voiceModeEnabled = true;
    activeMicCapture = new MicrophoneCapture({
      onChunk: queueVoiceAudioChunk,
      onSpeechStart: (event) => {
        void handleVoiceSpeechStart(event);
      },
      onSpeechEnd: () => {
        void handleVoiceSpeechEnd();
      },
      collectChunks: false,
    });
    await activeMicCapture.start({
      onChunk: queueVoiceAudioChunk,
      onSpeechStart: (event) => {
        void handleVoiceSpeechStart(event);
      },
      onSpeechEnd: () => {
        void handleVoiceSpeechEnd();
      },
      collectChunks: false,
    });
    setVoiceButtonState({ active: true });
    setVoiceStatusForState("idle");
  } catch (error) {
    console.error("Voice mode start failed:", error);
    voiceModeEnabled = false;
    if (activeMicCapture) {
      await activeMicCapture.stop().catch(() => {});
      activeMicCapture = null;
    }
    updateVoiceStatus(`Voice error: ${error.message}`, "error");
    setVoiceButtonState({ active: false });
  }
}

async function disableVoiceMode() {
  voiceModeEnabled = false;
  voiceUserSpeaking = false;
  voiceSessionState = "idle";
  clearVoiceBufferedChunks();
  voiceAssistantBargeInUnlockAt = 0;
  voicePlaybackSyncToken += 1;
  if (activeMicCapture) {
    await activeMicCapture.stop().catch(() => {});
    activeMicCapture = null;
  }
  ensureVoiceAudioPlayer().stop();

  if (voiceTurnStartPromise) {
    await voiceTurnStartPromise.catch(() => {});
  }
  if (voiceTurnOpen && voiceConversationId) {
    if (voiceSessionState === "listening") {
      try {
        await stopVoiceSessionTurn(voiceConversationId);
      } catch (error) {
        console.error("Voice stop on mode exit failed:", error);
      }
    } else {
      await interruptActiveVoiceTurn();
    }
  }

  voiceTurnOpen = false;
  closeVoiceSessionStream();
  setVoiceButtonState({ active: false });
  updateVoiceStatus("", "hidden");
}

async function toggleVoiceMode() {
  if (voiceModeTogglePromise) {
    await voiceModeTogglePromise.catch(() => {});
    return;
  }
  setVoiceButtonState({ active: voiceModeEnabled, disabled: true });
  voiceModeTogglePromise = (voiceModeEnabled ? disableVoiceMode() : enableVoiceMode())
    .finally(() => {
      voiceModeTogglePromise = null;
      setVoiceButtonState({ active: voiceModeEnabled, disabled: false });
    });
  await voiceModeTogglePromise;
}

function advanceLessonStage() {
  const plan = activePlan();
  if (!plan) return;

  if (isAnalyticPlan(plan)) {
    if (tutorState.currentStep < plan.lessonStages.length - 1) {
      tutorState.nextStep();
      lastSceneFeedback = "";
      setCheckpointState(null);
      updateStageRail();
      applyAnalyticSceneState({ forceCamera: true });
      announceCurrentStage(true);
      return;
    }
    analyticFormulaVisible = true;
    analyticFullSolutionVisible = true;
    renderAnalyticPanels(plan);
    completeLesson({ reason: "correct-answer", revealSolution: true });
    updateStageRail();
    return;
  }

  if (tutorState.learningStage === "orient") {
    beginGuidedBuild();
    return;
  }

  if (tutorState.learningStage === "build") {
    if (tutorState.currentStep < plan.lessonStages.length - 1) {
      tutorState.nextStep();
      lastSceneFeedback = "";
      setCheckpointState(null);
      updateStageRail();
      announceCurrentStage(true);
      scheduleAssessment();
      return;
    }

    tutorState.setLearningStage("predict");
    tutorState.resetPrediction(plan.learningMoments?.predict?.prompt || "");
    lastSceneFeedback = "";
    setCheckpointState(null);
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "predict") {
    if (!tutorState.predictionState.submitted) {
      addTranscriptMessage("tutor", "Before we move on, type what you think will happen.");
      return;
    }
    tutorState.setLearningStage("check");
    lastSceneFeedback = "";
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "check") {
    tutorState.setLearningStage("reflect");
    lastSceneFeedback = "";
    updateStageRail();
    announceCurrentStage(true);
    return;
  }

  if (tutorState.learningStage === "reflect") {
    tutorState.setLearningStage("challenge");
    lastSceneFeedback = "";
    updateStageRail();
    announceCurrentStage(true);
  }
}

async function handleTutorAction(action = {}) {
  switch (action.kind) {
    case "freeform-prompt":
      await handleLearnerInput(action.payload?.prompt || action.label || "Show me something interesting.", {
        input_source: "text",
        user_label: action.label || action.payload?.prompt || "Try that",
      });
      return;
    case "clear-scene":
      sceneApi?.clearScene?.();
      setCheckpointState(null);
      renderAssessment(activePlan() ? tutorState.latestAssessment : null);
      renderSceneInfo();
      updateStageRail();
      renderAnnotations();
      return;
    case "start-suggested-question":
      if (action.payload?.prompt) {
        await handleQuestionSubmit({ questionText: action.payload.prompt, imageFile: null });
      }
      return;
    default:
      break;
  }

  const plan = activePlan();
  if (!plan) return;

  switch (action.kind) {
    case "highlight-key-idea":
      applyAnalyticSceneState({ forceCamera: true });
      break;
    case "show_formula":
    case "show-formula":
      if (analyticFormulaVisible && !formulaCard?.classList.contains("hidden")) {
        scrollFormulaCardIntoView();
        break;
      }
      analyticFormulaVisible = true;
      analyticFormulaDismissed = false;
      renderAnalyticPanels(plan);
      scrollFormulaCardIntoView();
      break;
    case "show_hint":
      await requestTutorHint(action);
      break;
    case "try_again":
      focusComposerWithPlaceholder(action.payload?.gap || latestVerdictGap() || "Have another go");
      break;
    case "show_connection":
      clearLessonAutoAdvanceTimer();
      await requestConnectionBridge(plan);
      break;
    case "next_stage":
    case "reveal-next-step":
      renderMessageActions(latestTutorActionMessage, {
        ...latestTutorActionState,
        actions: [],
      });
      advanceLessonStage();
      break;
    case "view_solution":
      if (tutorState.hint_state?.escalate_next !== true) {
        break;
      }
      await revealWorkedSolution(plan);
      break;
    case "reveal-full-solution":
      await revealWorkedSolution(plan);
      break;
    case "ask_followup":
      focusComposerWithPlaceholder("What would you like to explore?");
      break;
    case "try_similar":
      await loadSimilarProblem(plan);
      break;
    case "reset-view":
      applyAnalyticSceneState({ forceCamera: true });
      break;
    case "start-guided-build":
      beginGuidedBuild();
      break;
    case "build-manually":
      beginManualBuild();
      break;
    case "preview-required-object": {
      const preparedAction = fillPreviewActionObjectSpec(action, plan, tutorState.latestAssessment);
      if (!preparedAction?.payload?.objectSpec) {
        addTranscriptMessage("system", "There is nothing to preview yet. Ask the tutor to explain the stage first.");
        return;
      }

      const preview = sceneApi?.previewAction?.(preparedAction.payload || preparedAction);
      if (preview) {
        focusStageTargets(preparedAction.payload.highlightTargets || [], { selectFirst: false });
        addTranscriptMessage("tutor", `Here's ${preview.label || preview.shape}. Does this look right to you?`, {
          actions: [
            {
              id: `${preparedAction.id}-confirm`,
              label: "Place it",
              kind: "confirm-preview",
              payload: { stageId: preparedAction.payload?.stageId || null },
            },
            {
              id: `${preparedAction.id}-cancel`,
              label: "Not quite",
              kind: "cancel-preview",
              payload: { stageId: preparedAction.payload?.stageId || null },
            },
          ],
        });
      }
      break;
    }
    case "confirm-preview": {
      const placedObject = sceneApi?.confirmPreviewAction?.();
      if (placedObject) {
        scheduleAssessment();
      }
      break;
    }
    case "cancel-preview":
      sceneApi?.cancelPreviewAction?.();
      focusStageTargets(stageFocusTargets(plan));
      break;
    case "explain-stage":
      await handleExplain();
      break;
    case "skip-stage":
      if (tutorState.currentStep < plan.lessonStages.length - 1) {
        tutorState.nextStep();
        setCheckpointState(null);
        updateStageRail();
        announceCurrentStage(true);
      } else {
        advanceLessonStage();
      }
      break;
    case "continue-stage":
      setCheckpointState(null);
      advanceLessonStage();
      break;
    case "show-mistake":
      await handleLearnerInput(action.payload?.prompt || "Something doesn't look right. Give me a nudge about what to check in the scene.", {
        input_source: "text",
        user_label: "Something's off - help me see it",
      });
      break;
    default:
      break;
  }
}

function handleSceneMutation(detail) {
  const plan = activePlan();
  if (!detail || detail.type !== "objects") return;

  if (!plan) {
    if (detail.reason === "place" && detail.object?.label) {
      lastSceneFeedback = `Placed ${detail.object.label}.`;
    } else if (detail.reason === "drag-end" && detail.object?.label) {
      lastSceneFeedback = `Updated ${detail.object.label}.`;
    } else if (detail.reason === "remove" && detail.object?.label) {
      lastSceneFeedback = `Removed ${detail.object.label}.`;
    } else if (detail.reason === "assistant-replace") {
      lastSceneFeedback = "Loaded a fresh scene.";
    } else if (detail.reason === "assistant-merge") {
      lastSceneFeedback = "Updated the scene.";
    } else if (detail.reason === "assistant-remove") {
      lastSceneFeedback = "Removed objects from the scene.";
    } else if (detail.reason === "clear") {
      lastSceneFeedback = "Cleared the scene.";
    }

    renderSceneInfo();
    renderAssessment(null);
    updateStageRail();
    syncUnfoldDrawer();
    renderAnnotations();
    return;
  }

  if (isAnalyticPlan(plan) && detail.reason === "analytic-auto") {
    renderSceneInfo();
    updateStageRail();
    return;
  }
  if (!isAnalyticPlan(plan) && detail.reason === "lesson-auto") {
    renderSceneInfo();
    updateStageRail();
    syncUnfoldDrawer();
    scheduleAssessment();
    return;
  }

  if (detail.reason === "place" && detail.object?.label) {
    lastSceneFeedback = `Placed ${detail.object.label}.`;
  } else if (detail.reason === "drag-end" && detail.object?.label) {
    lastSceneFeedback = `Updated ${detail.object.label}.`;
  } else if (detail.reason === "remove" && detail.object?.label) {
    lastSceneFeedback = `Removed ${detail.object.label}.`;
  }

  if (tutorState.learningStage === "predict" && tutorState.predictionState.submitted) {
    tutorState.setLearningStage("check");
  }

  renderSceneInfo();
  updateStageRail();
  syncUnfoldDrawer();
  scheduleAssessment();
}

function bindEvents() {
  document.querySelectorAll(".panel-tab").forEach((button) => {
    button.addEventListener("click", () => switchToTab(button.dataset.tab));
  });

  questionSubmit?.addEventListener("click", handleQuestionSubmit);
  questionInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleQuestionSubmit();
    }
  });

  questionImageInput?.addEventListener("change", () => {
    const file = questionImageInput.files?.[0] || null;
    setQuestionImageFile(file);
  });

  questionImageClear?.addEventListener("click", () => {
    setQuestionImageFile(null);
  });

  questionInput?.addEventListener("paste", (event) => {
    const file = extractPastedQuestionImageFile(event.clipboardData?.items);
    if (!file) return;
    event.preventDefault();
    setQuestionImageFile(file, { announcePaste: true });
  });

  buildFromDiagramBtn?.addEventListener("click", () => questionImageInput?.click());
  newQuestionBtn?.addEventListener("click", () => {
    tutorState.reset();
    void resetVoiceSessionState();
    clearLessonAutoAdvanceTimer();
    analyticFormulaVisible = false;
    analyticFullSolutionVisible = false;
    analyticFormulaDismissed = false;
    lastAppliedAnalyticStageId = null;
    similarQuestionRequest = null;
    currentSolutionSections = [];
    latestTutorActionMessage = null;
    latestTutorActionState = { actions: [], stageType: "orient", lastVerdict: null };
    analyticOverlayManager?.clear();
    sceneApi?.clearScene?.();
    sceneApi?.clearFocus?.();
    applyRepresentationDirective({ representationMode: "3d" });
    clearTranscript();
    hideEvidence();
    renderAnalyticPanels(null);
    renderAssessment(null);
    renderSceneInfo();
    updateStageRail();
    setQuestionPanelCollapsed(false, { force: true });
    questionSection?.classList.remove("is-compact");
    if (questionInput) {
      questionInput.value = "";
      updateMathPreview(questionMathPreview, "");
      questionInput.focus();
    }
    if (chatInput) {
      chatInput.value = "";
      updateMathPreview(chatMathPreview, "");
      resizeChatComposer();
      chatInput.classList.remove("input--awaiting");
    }
    awaitingLearnerResponse = true;
    updateComposerState();
  });
  lessonPanelToggle?.addEventListener("click", () => {
    if (!activePlan()) return;
    const isCollapsed = questionSection?.classList.contains("is-collapsed");
    setQuestionPanelCollapsed(!isCollapsed, { force: true });
  });
  voiceRecordBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    void toggleVoiceMode();
  });
  voiceRecordBtn?.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      void toggleVoiceMode();
    }
  });
  chatSend?.addEventListener("click", handleComposerSubmit);
  chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleComposerSubmit();
    }
  });
  checkpointYesBtn?.addEventListener("click", () => handleTutorAction({
    id: "checkpoint-yes",
    label: "Yes",
    kind: "continue-stage",
    payload: { stageId: currentLessonStage()?.id || null },
  }));
  checkpointUnsureBtn?.addEventListener("click", () => handleTutorAction({
    id: "checkpoint-not-sure",
    label: "Not sure",
    kind: "show-mistake",
    payload: { prompt: currentLessonStage()?.mistakeProbe || "Show me the mistake in this stage." },
  }));
  formulaCardRevealBtn?.addEventListener("click", () => {
    if (analyticFullSolutionVisible) {
      analyticFullSolutionVisible = false;
      renderAnalyticPanels(activePlan());
      return;
    }
    handleTutorAction({
      id: "view_solution",
      label: "Show me the solution",
      kind: "view_solution",
    });
  });
  formulaCardCloseBtn?.addEventListener("click", () => {
    analyticFormulaVisible = false;
    analyticFullSolutionVisible = false;
    analyticFormulaDismissed = true;
    renderAnalyticPanels(activePlan());
  });
  solutionDrawerClose?.addEventListener("click", () => {
    analyticFullSolutionVisible = false;
    renderAnalyticPanels(activePlan());
  });
}

function bindDom() {
  questionSection = document.querySelector(".question-section");
  questionInput = document.getElementById("questionInput");
  questionSubmit = document.getElementById("questionSubmit");
  questionStatus = document.getElementById("questionStatus");
  questionMathPreview = document.getElementById("questionMathPreview");
  questionImageInput = document.getElementById("questionImageInput");
  questionImageMeta = document.getElementById("questionImageMeta");
  questionImagePreview = document.getElementById("questionImagePreview");
  questionImageThumb = document.getElementById("questionImageThumb");
  questionImageClear = document.getElementById("questionImageClear");
  buildFromDiagramBtn = document.getElementById("questionImageTrigger");
  lessonPanelToggle = document.getElementById("lessonPanelToggle");
  lessonPanelSummary = document.getElementById("lessonPanelSummary");
  chatMessages = document.getElementById("chatMessages");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");
  chatMathPreview = document.getElementById("chatMathPreview");
  voiceControl = document.getElementById("voiceControl");
  voiceRecordBtn = document.getElementById("voiceRecordBtn");
  voiceBars = document.getElementById("voiceBars");
  voiceStatus = document.getElementById("voiceStatus");
  stageRail = document.getElementById("stageRail");
  stageRailProgress = document.getElementById("stageRailProgress");
  stageRailGoal = document.getElementById("stageRailGoal");
  chatCheckpoint = document.getElementById("chatCheckpoint");
  chatCheckpointPrompt = document.getElementById("chatCheckpointPrompt");
  checkpointYesBtn = document.getElementById("checkpointYesBtn");
  checkpointUnsureBtn = document.getElementById("checkpointUnsureBtn");
  sceneInfo = document.getElementById("sceneInfo");
  sceneValidation = document.getElementById("sceneValidation");
  cameraBookmarkList = document.getElementById("cameraBookmarkList");
  objectCount = document.getElementById("objectCount");
  stepIndicator = document.getElementById("stepIndicator");
  formulaCard = document.getElementById("formulaCard");
  formulaCardTitle = document.getElementById("formulaCardTitle");
  formulaCardEquation = document.getElementById("formulaCardEquation");
  formulaCardExplanation = document.getElementById("formulaCardExplanation");
  formulaCardRevealBtn = document.getElementById("formulaCardRevealBtn");
  formulaCardCloseBtn = document.getElementById("formulaCardCloseBtn");
  solutionDrawer = document.getElementById("solutionDrawer");
  solutionDrawerTitle = document.getElementById("solutionDrawerTitle");
  solutionDrawerAnswer = document.getElementById("solutionDrawerAnswer");
  solutionDrawerAnswerValue = document.getElementById("solutionDrawerAnswerValue");
  solutionDrawerSteps = document.getElementById("solutionDrawerSteps");
  solutionDrawerClose = document.getElementById("solutionDrawerClose");
  newQuestionBtn = document.getElementById("newQuestionBtn");
}

export function initTutorController(context) {
  world = context.world;
  sceneApi = context.sceneApi;
  cameraDirector = new CameraDirector(world.camera, world.controls);
  analyticOverlayManager = new AnalyticOverlayManager(world, sceneApi);
  electricFieldManager = new ElectricFieldManager(world, sceneApi);

  stageWrapEl = document.querySelector(".stage-wrap");
  if (stageWrapEl) {
    initEvidencePanel(stageWrapEl);
    initLabelRenderer(stageWrapEl);
  }

  bindDom();
  bindEvents();
  initUnfoldDrawer(context);
  clearTranscript();
  renderQuestionImageState();
  setQuestionPanelCollapsed(false, { force: true });
  renderAssessment(null);
  renderSceneInfo();
  updateStageRail();
  renderAnalyticPanels(null);
  applyRepresentationDirective({ representationMode: "3d" });
  updateComposerState();
  stepIndicator?.classList.add("hidden");

  sceneApi.onSceneEvent((detail) => {
    if (detail.type === "objects") {
      handleSceneMutation(detail);
    }
  });

  sceneApi.onSelectionChange(() => {
    const selected = selectedObjectContext();
    if (selected) {
      lastSceneFeedback = `Selected ${selected.label}. Use it to inspect the current idea.`;
      if (tutorState.learningStage === "predict" && tutorState.predictionState.submitted) {
        tutorState.setLearningStage("check");
      }
    }
    renderSceneInfo();
    updateStageRail();
    syncUnfoldDrawer();
  });

  questionInput?.addEventListener("input", () => {
    updateMathPreview(questionMathPreview, questionInput.value);
    if (questionSection?.classList.contains("is-collapsed")) {
      setQuestionPanelCollapsed(true, { force: true });
    }
  });
  chatInput?.addEventListener("input", () => {
    chatInput.classList.remove("input--awaiting");
    resizeChatComposer();
    updateMathPreview(chatMathPreview, chatInput.value);
  });

  awaitingLearnerResponse = true;
  updateComposerState();
  resizeChatComposer();
  updateMathPreview(questionMathPreview, questionInput?.value || "");
  updateMathPreview(chatMathPreview, chatInput?.value || "");
}

export function primeTutorInputs({ text = "", imageFile = null } = {}) {
  if (questionInput) {
    questionInput.value = String(text || "");
    updateMathPreview(questionMathPreview, questionInput.value);
  }
  if (imageFile) {
    setQuestionImageFile(imageFile);
  }
}

export function applyGeneratedPlan(scenePlan) {
  if (!scenePlan) return;
  setPlan(scenePlan);
  setQuestionStatus("", "hidden");
}

export function getQuestionImagePreviewUrl() {
  return questionImagePreviewUrl;
}

export async function startTutorTurn(text = "Let's start.") {
  await handleLearnerInput(text, { input_source: "text" });
}

export function updateTutorLabels() {
  if (world) {
    renderLabels(world.scene, world.camera);
  }
  electricFieldManager?.update();
  syncUnfoldDrawer();
}



