import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

const MODEL_PATH = new URL("./models/hand_landmarker.task", window.location.href).toString();
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const webcamEl = document.querySelector("#webcam");
const overlayEl = document.querySelector("#overlay");
const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const statusEl = document.querySelector("#status");
const ctx = overlayEl.getContext("2d");

const palette = ["#00f5d4", "#ffb703"];

let handLandmarker = null;
let webcamStream = null;
let isRunning = false;
let rafId = null;
let lastVideoTime = -1;

function setStatus(message, state = "ok") {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  const sharedOptions = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, sharedOptions);
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
    });
  }
}

async function ensureLandmarkerReady() {
  if (handLandmarker) {
    return;
  }
  setStatus("Loading MediaPipe model...", "ok");
  handLandmarker = await createHandLandmarker();
}

function syncCanvasToVideo() {
  const { videoWidth, videoHeight } = webcamEl;
  if (!videoWidth || !videoHeight) {
    return;
  }
  if (overlayEl.width !== videoWidth || overlayEl.height !== videoHeight) {
    overlayEl.width = videoWidth;
    overlayEl.height = videoHeight;
  }
}

function drawLandmarks(results) {
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  if (!results?.landmarks?.length) {
    return;
  }

  results.landmarks.forEach((hand, handIndex) => {
    const stroke = palette[handIndex % palette.length];
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = 2;

    for (const [from, to] of HAND_CONNECTIONS) {
      const start = hand[from];
      const end = hand[to];
      ctx.beginPath();
      ctx.moveTo(start.x * overlayEl.width, start.y * overlayEl.height);
      ctx.lineTo(end.x * overlayEl.width, end.y * overlayEl.height);
      ctx.stroke();
    }

    for (const point of hand) {
      ctx.beginPath();
      ctx.arc(point.x * overlayEl.width, point.y * overlayEl.height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

function detectLoop() {
  if (!isRunning || !handLandmarker) {
    return;
  }

  syncCanvasToVideo();
  if (webcamEl.readyState >= 2 && webcamEl.currentTime !== lastVideoTime) {
    lastVideoTime = webcamEl.currentTime;
    const results = handLandmarker.detectForVideo(webcamEl, performance.now());
    drawLandmarks(results);
    const handCount = results?.landmarks?.length ?? 0;
    setStatus(handCount ? `Tracking ${handCount} hand(s)` : "No hands detected", "ok");
  }

  rafId = window.requestAnimationFrame(detectLoop);
}

async function startTracking() {
  if (isRunning) {
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("getUserMedia is not available in this browser.", "error");
    return;
  }

  try {
    await ensureLandmarkerReady();
    webcamStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    webcamEl.srcObject = webcamStream;
    await webcamEl.play();

    startBtn.disabled = true;
    stopBtn.disabled = false;
    isRunning = true;
    lastVideoTime = -1;
    setStatus("Camera active. Detecting landmarks...", "ok");
    detectLoop();
  } catch (error) {
    console.error(error);
    setStatus("Unable to start camera or model.", "error");
  }
}

function stopTracking() {
  isRunning = false;
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
  }

  webcamEl.srcObject = null;
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("Stopped", "idle");
}

startBtn.addEventListener("click", startTracking);
stopBtn.addEventListener("click", stopTracking);
window.addEventListener("beforeunload", stopTracking);
