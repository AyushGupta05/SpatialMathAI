import { computeGeometry } from "./core/geometry.js";
import { loadCalibration } from "./calibration/store.js";
import { InteractionPipeline } from "./signals/interactionPipeline.js";
import { appState } from "./state/store.js";
import { createWorld } from "./render/world.js";
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

const MODEL_PATH = new URL("../models/hand_landmarker.task", window.location.href).toString();

export function bootstrapApp() {
  const webcamEl = document.querySelector("#webcam");
  const overlayEl = document.querySelector("#overlay");
  const worldMount = document.querySelector("#worldMount");
  const startBtn = document.querySelector("#startBtn");
  const stopBtn = document.querySelector("#stopBtn");
  const shapeTypeEl = document.querySelector("#shapeType");
  const sizeInputEl = document.querySelector("#sizeInput");
  const colorInputEl = document.querySelector("#colorInput");
  const statusEl = document.querySelector("#status");

  const ctx = overlayEl.getContext("2d");
  const world = createWorld(worldMount);

  appState.calibration = loadCalibration();
  const pipeline = new InteractionPipeline({ alpha: appState.calibration.smoothingAlpha });

  let handLandmarker = null;
  let stream = null;
  let rafId = null;
  let running = false;
  let prevPinch = false;
  let activeMesh = null;

  function setStatus(msg, state = "ok") {
    statusEl.textContent = msg;
    statusEl.dataset.state = state;
  }

  async function ensureLandmarker() {
    if (handLandmarker) return;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  function drawDebug(hand) {
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (!hand) return;
    const p = hand[8];
    const x = (1 - p.x) * overlayEl.width;
    const y = p.y * overlayEl.height;
    ctx.strokeStyle = "#f9ff9a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  function updateGeometryMetrics(shape, size) {
    let metrics;
    if (shape === "sphere") metrics = computeGeometry(shape, { r: size * 0.6 });
    else if (shape === "cylinder") metrics = computeGeometry(shape, { r: size * 0.45, h: size * 1.4 });
    else if (shape === "cuboid") metrics = computeGeometry(shape, { w: size * 1.6, h: size, d: size * 0.9 });
    else metrics = computeGeometry("cube", { a: size });

    appState.shape = shape;
    appState.dimension = size;
    appState.volume = metrics.volume;
    appState.surfaceArea = metrics.surfaceArea;
  }

  function detectLoop() {
    if (!running || !handLandmarker) return;

    if (webcamEl.readyState >= 2) {
      const results = handLandmarker.detectForVideo(webcamEl, performance.now());
      const handA = results?.landmarks?.[0] || null;
      const handB = results?.landmarks?.[1] || null;

      drawDebug(handA);
      const interaction = pipeline.update(handA, handB);
      appState.interaction = interaction;

      // adaptive smoothing from jitter
      const dynamicAlpha = Math.max(0.16, Math.min(0.62, 0.55 - interaction.jitter * 2.2));
      pipeline.setAlpha(dynamicAlpha);

      if (handA) {
        const hit = world.projectToGround(handA[8]);
        const pinchStart = interaction.pinch && !prevPinch;
        if (pinchStart && hit) {
          const mesh = world.buildMesh(shapeTypeEl.value, Number(sizeInputEl.value), colorInputEl.value);
          mesh.position.x = hit.x;
          mesh.position.z = hit.z;
          mesh.rotation.y = Math.random() * Math.PI;
          world.scene.add(mesh);
          activeMesh = mesh;
          setStatus(`Placed ${shapeTypeEl.value}`, "ok");
        }

        if (interaction.pinch && activeMesh && hit) {
          activeMesh.position.x = hit.x;
          activeMesh.position.z = hit.z;
          activeMesh.rotation.y = interaction.rotation;

          const scale = 0.45 + interaction.resize * 2.4;
          activeMesh.scale.setScalar(scale);
          updateGeometryMetrics(shapeTypeEl.value, Number(sizeInputEl.value) * scale);
        }

        prevPinch = interaction.pinch;
      }
    }

    rafId = requestAnimationFrame(detectLoop);
  }

  async function start() {
    try {
      await ensureLandmarker();
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      webcamEl.srcObject = stream;
      await webcamEl.play();
      running = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      setStatus("Tracking live interaction signals", "ok");
      detectLoop();
    } catch (e) {
      setStatus(`Start failed: ${e?.message || e}`, "error");
    }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    webcamEl.srcObject = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Stopped", "idle");
  }

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stop);
  window.addEventListener("beforeunload", stop);

  setStatus("Ready. Start camera to begin.", "idle");
}
