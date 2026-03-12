import {
  requestScenePlan,
  evaluateBuild,
  askTutor,
  requestVoiceResponse,
  fetchChallenges,
  checkChallenge,
} from "../ai/client.js";
import { buildSceneSnapshotFromSuggestions, normalizeScenePlan } from "../ai/planSchema.js";
import { initLabelRenderer, renderLabels, addLabel, clearLabels } from "../render/labels.js";
import { CameraDirector } from "../render/cameraDirector.js";
import { tutorState } from "../state/tutorState.js";

let appContext = null;
let world = null;
let sceneApi = null;
let cameraDirector = null;
let assessmentTimer = null;
let voiceEnabled = false;
let activeChallenge = null;

let questionInput;
let questionSubmit;
let questionStatus;
let scenePlanSection;
let planSummary;
let buildSummary;
let planObjects;
let addAllBtn;
let stepByStepBtn;
let buildManuallyBtn;
let buildStepsSection;
let buildStepsList;
let buildGoalChip;
let challengePromptList;
let voiceTranscript;
let challengeList;
let scoreDisplay;
let chatMessages;
let chatInput;
let chatSend;
let hintBtn;
let hintCount;
let explainBtn;
let voiceToggle;
let answerSection;
let answerInput;
let answerSubmit;
let answerFeedback;
let sceneInfo;
let sceneValidation;
let cameraBookmarkList;
let objectCount;
let stepIndicator;
let stepLabel;
let stepPrev;
let stepNext;

function activePlan() {
  return tutorState.plan;
}

function currentSnapshot() {
  return sceneApi?.snapshot?.() || { objects: [], selectedObjectId: null };
}

function setQuestionStatus(text = "", type = "hidden") {
  if (!questionStatus) return;
  questionStatus.textContent = text;
  questionStatus.className = "question-status";
  if (!text || type === "hidden") {
    questionStatus.classList.add("hidden");
    return;
  }
  if (type === "loading") questionStatus.classList.add("is-loading");
  if (type === "error") questionStatus.classList.add("is-error");
}

function addChatMessage(role, content) {
  if (!chatMessages) return null;
  chatMessages.querySelector(".chat-welcome")?.remove();
  const message = document.createElement("div");
  message.className = `chat-msg is-${role}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function clearChat() {
  if (chatMessages) chatMessages.innerHTML = "";
}

function updateHintCount() {
  if (hintCount) {
    const remaining = tutorState.maxHints - tutorState.hintsUsed;
    hintCount.textContent = `(${remaining} left)`;
  }
  if (hintBtn) hintBtn.disabled = tutorState.hintsUsed >= tutorState.maxHints;
}

function switchToTab(tabName) {
  document.querySelectorAll(".panel-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.dataset.content === tabName);
  });
}

function showAnswerSection(visible) {
  answerSection?.classList.toggle("hidden", !visible);
}

function showAnswerFeedback(text, correct = false) {
  if (!answerFeedback) return;
  answerFeedback.textContent = text;
  answerFeedback.className = `answer-feedback ${correct ? "is-correct" : "is-incorrect"}`;
  answerFeedback.classList.remove("hidden");
}

function renderSceneInfo() {
  if (!sceneInfo) return;
  const snapshot = currentSnapshot();
  const plan = activePlan();
  const count = snapshot.objects.length;
  objectCount.textContent = String(count);

  if (!plan) {
    sceneInfo.innerHTML = `<p class="muted-text">Ask a question or choose a challenge to generate a guided build.</p>`;
    return;
  }

  sceneInfo.innerHTML = `
    <p style="margin:0 0 6px"><strong>${plan.problem.question}</strong></p>
    <p class="muted-text">${count} object${count === 1 ? "" : "s"} currently in the world</p>
    <p class="muted-text">Formula scaffold: <span class="formula">${plan.answerScaffold.formula || "Ask the tutor to derive it from the scene."}</span></p>
  `;
}

function renderPlanSummary(plan) {
  if (!planSummary || !planObjects || !scenePlanSection) return;
  planSummary.textContent = plan.problem.summary || plan.problem.question;
  if (buildSummary) {
    buildSummary.classList.remove("hidden");
    buildSummary.textContent = plan.overview || "Start with the suggested build, then use the tutor to reason through the measurements.";
  }
  planObjects.innerHTML = plan.objectSuggestions.map((suggestion) => `
    <li>
      <strong>${suggestion.title}</strong><br />
      <span class="muted-text">${suggestion.purpose}</span>
    </li>
  `).join("");
  scenePlanSection.classList.remove("hidden");
}

function renderPrompts(plan) {
  if (!challengePromptList) return;
  challengePromptList.innerHTML = plan.challengePrompts.map((prompt) => `
    <div class="challenge-prompt-card">${prompt.prompt}</div>
  `).join("") || `<div class="challenge-prompt-card">No challenge prompts yet. Build the scene first.</div>`;
}

function renderCameraBookmarks(plan) {
  if (!cameraBookmarkList) return;
  cameraBookmarkList.innerHTML = "";
  (plan.cameraBookmarks || []).forEach((bookmark) => {
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

function renderAnnotations() {
  clearLabels(world.scene);
  const snapshot = currentSnapshot();
  snapshot.objects.forEach((objectSpec) => {
    const [x, y, z] = objectSpec.position;
    addLabel(world.scene, objectSpec.label || objectSpec.shape, [x, y + 0.9, z], "name");
  });
}

function missingSuggestionIds(step, assessment) {
  if (!step || !assessment) return [];
  const byId = new Map(assessment.objectAssessments.map((item) => [item.suggestionId, item]));
  return (step.requiredObjectIds || []).filter((id) => !byId.get(id)?.present);
}

function addSuggestionsById(suggestionIds) {
  const plan = activePlan();
  if (!plan) return;
  const snapshot = currentSnapshot();
  const existingShapes = new Set(snapshot.objects.map((objectSpec) => `${objectSpec.shape}:${JSON.stringify(objectSpec.params)}`));
  const toAdd = plan.objectSuggestions
    .filter((suggestion) => suggestionIds.includes(suggestion.id))
    .filter((suggestion) => !existingShapes.has(`${suggestion.object.shape}:${JSON.stringify(suggestion.object.params)}`))
    .map((suggestion) => suggestion.object);
  if (!toAdd.length) return;
  sceneApi.addObjects(toAdd, { reason: "guided-add" });
  renderAnnotations();
}

function renderSteps(plan, assessment) {
  if (!buildStepsList || !buildStepsSection) return;
  buildStepsSection.classList.remove("hidden");
  const currentStep = tutorState.getCurrentStep();
  buildGoalChip.textContent = currentStep ? currentStep.title : "Ready";

  buildStepsList.innerHTML = plan.buildSteps.map((step, index) => {
    const stepAssessment = assessment?.stepAssessments?.find((item) => item.stepId === step.id);
    const active = tutorState.currentStep === index;
    const complete = Boolean(stepAssessment?.complete);
    const missing = missingSuggestionIds(step, assessment);
    const buttonLabel = missing.length ? `Add ${missing.length} suggestion${missing.length === 1 ? "" : "s"}` : "Review step";
    return `
      <article class="build-step-card${active ? " is-active" : ""}${complete ? " is-complete" : ""}" data-step-id="${step.id}">
        <div class="build-step-top">
          <p class="build-step-title">${step.title}</p>
          <span class="build-step-state">${complete ? "complete" : active ? "active" : "open"}</span>
        </div>
        <p class="build-step-instruction">${step.instruction}</p>
        <p class="build-step-hint">${step.hint || "Use the tutor if you need a short hint."}</p>
        <p class="build-step-feedback ${complete ? "is-good" : "is-warn"}">${stepAssessment?.feedback || "Build this part of the scene to continue."}</p>
        <div class="build-step-actions">
          <button type="button" class="step-card-btn" data-step-action="focus" data-step-id="${step.id}">${buttonLabel}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderAssessment(assessment) {
  if (!sceneValidation) return;
  if (!assessment) {
    sceneValidation.innerHTML = `<p class="muted-text">The tutor will evaluate your scene as you build.</p>`;
    showAnswerSection(false);
    return;
  }

  sceneValidation.innerHTML = `
    <div class="validation-stat"><strong>${assessment.summary.matchedRequiredObjects}/${assessment.summary.totalRequiredObjects}</strong> required objects matched</div>
    <div class="validation-stat"><strong>${Math.round(assessment.summary.completionRatio * 100)}%</strong> build completion</div>
    <div class="validation-stat"><strong>${assessment.answerGate.allowed ? "Ready" : "Not ready"}</strong> to answer<br />${assessment.answerGate.reason}</div>
  `;

  showAnswerSection(Boolean(activeChallenge && assessment.answerGate.allowed));
}

function showStepIndicator() {
  if (!stepIndicator) return;
  const total = tutorState.totalSteps;
  if (!total) {
    stepIndicator.classList.add("hidden");
    return;
  }
  stepIndicator.classList.remove("hidden");
  stepLabel.textContent = `Build ${tutorState.currentStep + 1} / ${total}`;
  stepPrev.disabled = tutorState.currentStep <= 0;
  stepNext.disabled = tutorState.currentStep >= total - 1;
}

async function syncAssessment() {
  const plan = activePlan();
  if (!plan) {
    renderAssessment(null);
    return;
  }
  try {
    const { assessment } = await evaluateBuild({
      plan,
      sceneSnapshot: currentSnapshot(),
      currentStepId: tutorState.getCurrentStep()?.id || null,
    });
    tutorState.setAssessment(assessment);
    renderSteps(plan, assessment);
    renderAssessment(assessment);
    renderSceneInfo();
    showStepIndicator();
  } catch (error) {
    console.error("Assessment sync failed:", error);
  }
}

function scheduleAssessment() {
  window.clearTimeout(assessmentTimer);
  assessmentTimer = window.setTimeout(() => {
    syncAssessment();
    renderAnnotations();
  }, 180);
}

function setPlan(plan, options = {}) {
  const normalizedPlan = normalizeScenePlan(plan);
  activeChallenge = options.challenge || null;
  tutorState.setPlan(normalizedPlan, { mode: options.mode || normalizedPlan.problem.mode || "guided" });
  tutorState.setPhase("plan_ready");
  if (answerFeedback) {
    answerFeedback.textContent = "";
    answerFeedback.classList.add("hidden");
  }
  if (answerInput) answerInput.value = "";
  renderPlanSummary(normalizedPlan);
  renderPrompts(normalizedPlan);
  renderCameraBookmarks(normalizedPlan);
  renderSceneInfo();
  renderSteps(normalizedPlan, tutorState.latestAssessment);
  showStepIndicator();
  if (options.clearScene !== false) {
    sceneApi.clearScene();
  }
}

async function handleQuestionSubmit() {
  const question = questionInput?.value?.trim();
  if (!question) return;

  tutorState.reset();
  activeChallenge = null;
  tutorState.setPhase("parsing");
  questionSubmit.disabled = true;
  setQuestionStatus("Asking Nova Pro for a scene plan...", "loading");

  try {
    const { scenePlan } = await requestScenePlan({ question, mode: "guided", sceneSnapshot: currentSnapshot() });
    setPlan(scenePlan);
    clearChat();
    addChatMessage("system", `Question loaded: "${question}"`);
    addChatMessage("tutor", "I turned your question into a build plan. Pick how you want to construct the scene, and I will guide the reasoning.");
    setQuestionStatus("", "hidden");
  } catch (error) {
    console.error("Plan request failed:", error);
    tutorState.setError(error.message);
    setQuestionStatus(`Error: ${error.message}`, "error");
  } finally {
    questionSubmit.disabled = false;
  }
}

function beginGuidedBuild() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("guided");
  tutorState.setPhase(activeChallenge ? "challenge" : "guided_build");
  sceneApi.clearScene();
  switchToTab("tutor");
  addChatMessage("tutor", "Guided build is ready. Use the step cards to add the scene one layer at a time.");
  scheduleAssessment();
}

function addAllSuggestedObjects() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("guided");
  tutorState.setPhase("explore");
  sceneApi.loadSnapshot(buildSceneSnapshotFromSuggestions(plan), "add-all");
  renderAnnotations();
  addChatMessage("tutor", "The full suggested scene is in the world now. Edit it freely, and ask me to explain how the measurements connect to the formula.");
  scheduleAssessment();
}

function beginManualBuild() {
  const plan = activePlan();
  if (!plan) return;
  tutorState.setMode("manual");
  tutorState.setPhase(activeChallenge ? "challenge" : "manual_build");
  sceneApi.clearScene();
  switchToTab("scene");
  addChatMessage("tutor", "Manual build mode is active. Create the geometry yourself, and I will verify what is missing or correct.");
  scheduleAssessment();
}

async function sendTutorMessage(messageText) {
  const plan = activePlan();
  if (!plan) return;
  const text = messageText?.trim();
  if (!text) return;
  addChatMessage("user", text);
  tutorState.addMessage("user", text);

  const typing = addChatMessage("tutor", "...");
  typing.classList.add("loading-dots");

  try {
    const response = await askTutor({
      plan,
      sceneSnapshot: currentSnapshot(),
      learningState: tutorState.snapshot(),
      userMessage: text,
      contextStepId: tutorState.getCurrentStep()?.id || null,
      onChunk: (chunk) => {
        typing.classList.remove("loading-dots");
        typing.textContent = (typing.textContent === "..." ? "" : typing.textContent) + chunk;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      },
      onAssessment: (assessment) => {
        tutorState.setAssessment(assessment);
        renderAssessment(assessment);
        renderSteps(plan, assessment);
      },
    });

    typing.classList.remove("loading-dots");
    typing.textContent = response.text || "I could not generate a tutor reply.";
    tutorState.addMessage("assistant", typing.textContent);

    if (response.assessment) {
      tutorState.setAssessment(response.assessment);
    }

    if (voiceEnabled && typing.textContent) {
      speakText(typing.textContent);
    }
  } catch (error) {
    typing.classList.remove("loading-dots");
    typing.textContent = `Error: ${error.message}`;
  }
}

async function handleHint() {
  if (!tutorState.useHint()) {
    addChatMessage("system", "No more hints available.");
    return;
  }
  updateHintCount();
  await sendTutorMessage("Give me one short hint about the next spatial step.");
}

async function handleExplain() {
  const step = tutorState.getCurrentStep();
  if (!step) {
    await sendTutorMessage("Explain how to reason about this scene.");
    return;
  }
  await sendTutorMessage(`Explain this build step: ${step.title}.`);
}

async function speakText(text) {
  if (!text) return;
  try {
    const response = await requestVoiceResponse(text, "auto");
    if (voiceTranscript) {
      voiceTranscript.textContent = response.transcript || text;
    }
    if (response.audioBase64) {
      const binary = atob(response.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: response.contentType || "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      return;
    }
  } catch (error) {
    console.warn("Voice response failed:", error);
  }

  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
  }
}

function bindStepList() {
  buildStepsList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step-action]");
    const card = event.target.closest("[data-step-id]");
    const stepId = button?.dataset.stepId || card?.dataset.stepId;
    if (!stepId) return;

    const plan = activePlan();
    const stepIndex = plan?.buildSteps?.findIndex((step) => step.id === stepId) ?? -1;
    if (stepIndex >= 0) {
      tutorState.goToStep(stepIndex);
      showStepIndicator();
      renderSteps(plan, tutorState.latestAssessment);
    }

    if (button?.dataset.stepAction === "focus") {
      const step = plan?.buildSteps?.[stepIndex];
      if (!step) return;
      const assessment = tutorState.latestAssessment;
      const idsToAdd = missingSuggestionIds(step, assessment);
      if (idsToAdd.length) {
        addSuggestionsById(idsToAdd);
        addChatMessage("system", `Added suggestions for ${step.title}.`);
      } else if (step.cameraBookmarkId) {
        const bookmark = plan.cameraBookmarks.find((candidate) => candidate.id === step.cameraBookmarkId);
        if (bookmark) {
          cameraDirector.animateTo(bookmark.position, bookmark.target, 900);
        }
      }
      scheduleAssessment();
    }
  });
}

async function loadChallengesList() {
  try {
    const { challenges } = await fetchChallenges();
    challengeList.innerHTML = challenges.map((challenge) => `
      <div class="challenge-item" data-id="${challenge.id}">
        <p class="challenge-title">${challenge.title}</p>
        <div class="challenge-meta">
          <span class="challenge-diff ${challenge.difficulty}">${challenge.difficulty}</span>
          <span>${challenge.category}</span>
        </div>
      </div>
    `).join("");

    challengeList.querySelectorAll(".challenge-item").forEach((node) => {
      node.addEventListener("click", () => {
        const challenge = challenges.find((candidate) => candidate.id === node.dataset.id);
        if (!challenge) return;
        activeChallenge = challenge;
        questionInput.value = challenge.question;
        tutorState.startChallenge(challenge.id, challenge.scenePlan);
        setPlan(challenge.scenePlan, { challenge, clearScene: true });
        addChatMessage("system", `Challenge: ${challenge.title}`);
        addChatMessage("tutor", "Build the scene correctly first. The answer box unlocks after the required objects and measurements are in place.");
        beginManualBuild();
      });
    });
  } catch (error) {
    challengeList.innerHTML = `<p class="muted-text">Challenges need the server to be running.</p>`;
    console.error("Challenge load failed:", error);
  }
}

async function handleAnswerSubmit() {
  if (!activeChallenge) return;
  const answer = Number(answerInput?.value);
  if (!Number.isFinite(answer)) {
    showAnswerFeedback("Enter a valid number first.", false);
    return;
  }
  if (!tutorState.latestAssessment?.answerGate?.allowed) {
    showAnswerFeedback("Finish the build check before answering.", false);
    return;
  }

  try {
    const result = await checkChallenge(activeChallenge.id, answer);
    showAnswerFeedback(result.feedback, result.correct);
    if (result.correct) {
      tutorState.recordCorrect();
      scoreDisplay.textContent = `Score: ${tutorState.score}`;
      tutorState.setPhase("complete");
    } else {
      tutorState.recordIncorrect();
    }
  } catch (error) {
    showAnswerFeedback(`Error: ${error.message}`, false);
  }
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

  chatSend?.addEventListener("click", () => {
    const text = chatInput?.value?.trim();
    if (!text) return;
    chatInput.value = "";
    sendTutorMessage(text);
  });
  chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      chatSend.click();
    }
  });

  addAllBtn?.addEventListener("click", addAllSuggestedObjects);
  stepByStepBtn?.addEventListener("click", beginGuidedBuild);
  buildManuallyBtn?.addEventListener("click", beginManualBuild);
  hintBtn?.addEventListener("click", handleHint);
  explainBtn?.addEventListener("click", handleExplain);
  voiceToggle?.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle("is-active", voiceEnabled);
    voiceTranscript.textContent = voiceEnabled ? "Voice is enabled. Tutor responses will appear here." : "Voice is off.";
  });

  document.getElementById("demoBtn")?.addEventListener("click", () => {
    questionInput.value = "A cylinder has radius 3 and height 10. What is its volume?";
    handleQuestionSubmit().then(() => beginGuidedBuild());
  });

  answerSubmit?.addEventListener("click", handleAnswerSubmit);
  answerInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAnswerSubmit();
    }
  });

  stepPrev?.addEventListener("click", () => {
    tutorState.prevStep();
    showStepIndicator();
    renderSteps(activePlan(), tutorState.latestAssessment);
  });
  stepNext?.addEventListener("click", () => {
    tutorState.nextStep();
    showStepIndicator();
    renderSteps(activePlan(), tutorState.latestAssessment);
  });

  bindStepList();
}

function bindDom() {
  questionInput = document.getElementById("questionInput");
  questionSubmit = document.getElementById("questionSubmit");
  questionStatus = document.getElementById("questionStatus");
  scenePlanSection = document.getElementById("scenePlanSection");
  planSummary = document.getElementById("planSummary");
  buildSummary = document.getElementById("buildSummary");
  planObjects = document.getElementById("planObjects");
  addAllBtn = document.getElementById("addAllBtn");
  stepByStepBtn = document.getElementById("stepByStepBtn");
  buildManuallyBtn = document.getElementById("buildManuallyBtn");
  buildStepsSection = document.getElementById("buildStepsSection");
  buildStepsList = document.getElementById("buildStepsList");
  buildGoalChip = document.getElementById("buildGoalChip");
  challengePromptList = document.getElementById("challengePromptList");
  voiceTranscript = document.getElementById("voiceTranscript");
  challengeList = document.getElementById("challengeList");
  scoreDisplay = document.getElementById("scoreDisplay");
  chatMessages = document.getElementById("chatMessages");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");
  hintBtn = document.getElementById("hintBtn");
  hintCount = document.getElementById("hintCount");
  explainBtn = document.getElementById("explainBtn");
  voiceToggle = document.getElementById("voiceToggle");
  answerSection = document.getElementById("answerSection");
  answerInput = document.getElementById("answerInput");
  answerSubmit = document.getElementById("answerSubmit");
  answerFeedback = document.getElementById("answerFeedback");
  sceneInfo = document.getElementById("sceneInfo");
  sceneValidation = document.getElementById("sceneValidation");
  cameraBookmarkList = document.getElementById("cameraBookmarkList");
  objectCount = document.getElementById("objectCount");
  stepIndicator = document.getElementById("stepIndicator");
  stepLabel = document.getElementById("stepLabel");
  stepPrev = document.getElementById("stepPrev");
  stepNext = document.getElementById("stepNext");
}

export function initTutorController(context) {
  appContext = context;
  world = context.world;
  sceneApi = context.sceneApi;
  cameraDirector = new CameraDirector(world.camera, world.controls);

  const stageWrap = document.querySelector(".stage-wrap");
  if (stageWrap) {
    initLabelRenderer(stageWrap);
  }

  bindDom();
  bindEvents();
  updateHintCount();
  renderAssessment(null);
  renderSceneInfo();
  loadChallengesList();

  sceneApi.onSceneChange(() => {
    renderSceneInfo();
    scheduleAssessment();
  });

  if (new URLSearchParams(window.location.search).has("demo")) {
    questionInput.value = "A cylinder has radius 3 and height 10. What is its volume?";
    handleQuestionSubmit().then(() => beginGuidedBuild());
  }
}

export function updateTutorLabels() {
  if (world) {
    renderLabels(world.scene, world.camera);
  }
}
