import { requestScenePlan } from "../ai/client.js";
import { showEvidence } from "./evidencePanel.js";
import {
  applyGeneratedPlan,
  getQuestionImagePreviewUrl,
  primeTutorInputs,
  startTutorTurn,
} from "./tutorController.js";

function ensureCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function generateDemoImage() {
  const svgString = `<svg
    xmlns="http://www.w3.org/2000/svg"
    width="200" height="160" viewBox="0 0 200 160">
    <rect x="20" y="50" width="100" height="70"
      fill="#f9fafb" stroke="#374151"
      stroke-width="1.5"/>
    <path d="M20,50 L55,20 L155,20 L120,50 Z"
      fill="#f3f4f6" stroke="#374151"
      stroke-width="1.5"/>
    <path d="M120,50 L155,20 L155,90 L120,120 Z"
      fill="#e5e7eb" stroke="#374151"
      stroke-width="1.5"/>
    <text x="65" y="90"
      font-family="sans-serif" font-size="12"
      fill="#374151">l = 6</text>
    <text x="128" y="60"
      font-family="sans-serif" font-size="12"
      fill="#374151">w = 4</text>
    <text x="4" y="90"
      font-family="sans-serif" font-size="11"
      fill="#6b7280">h=3</text>
    <path d="M18,50 L18,120"
      stroke="#9ca3af" stroke-width="1"
      stroke-dasharray="3,3"/>
  </svg>`;

  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const canvas = ensureCanvas(200, 160);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 200, 160);
        ctx.drawImage(img, 0, 0);
        const pngBlob = typeof canvas.convertToBlob === "function"
          ? await canvas.convertToBlob({ type: "image/png" })
          : await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, "image/png"));
        URL.revokeObjectURL(url);
        resolve(pngBlob);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    img.src = url;
  });
}

function insertDemoBanner() {
  const banner = document.createElement("div");
  banner.id = "demo-banner";
  Object.assign(banner.style, {
    background: "var(--color-info-bg, #eff6ff)",
    color: "var(--color-info-text, #1d4ed8)",
    padding: "8px 16px",
    fontSize: "13px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "relative",
    zIndex: "200",
  });
  banner.innerHTML = `
    <span>Demo mode - surface area lesson with diagram upload and voice interaction</span>
    <button
      type="button"
      style="background:none;border:none;cursor:pointer;font-size:18px;color:inherit;line-height:1"
      aria-label="Close demo banner"
    >x</button>
  `;
  banner.querySelector("button")?.addEventListener("click", () => {
    banner.style.display = "none";
  });
  document.body.prepend(banner);
}

function insertDemoOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "demo-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background: "var(--color-surface, #f9fafb)",
    border: "0.5px solid var(--color-border, #e5e7eb)",
    borderRadius: "12px",
    padding: "12px 14px",
    fontSize: "12px",
    opacity: "0.9",
    zIndex: "100",
    minWidth: "190px",
  });
  overlay.innerHTML = `
    <div style="font-weight:500;margin-bottom:8px">Demo beats</div>
    <div class="beat" id="demo-beat-1">
      <span class="beat-dot"></span>
      Nova reads the diagram
    </div>
    <div class="beat" id="demo-beat-2">
      <span class="beat-dot"></span>
      Scene builds from it
    </div>
    <div class="beat" id="demo-beat-3">
      <span class="beat-dot"></span>
      Try voice: speak answer
    </div>
  `;
  document.body.appendChild(overlay);
}

function fillDemoBeat(index) {
  document.getElementById(`demo-beat-${index}`)?.classList.add("done");
}

async function runDemoSequence() {
  const promptText = "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?";
  const imageBlob = window._demoImageBlob || null;
  const imageUrl = getQuestionImagePreviewUrl();

  document.addEventListener("scene:first-object", () => {
    console.info("Demo: scene ready");
    fillDemoBeat(2);
    window.setTimeout(() => {
      void startTutorTurn("Let's start.");
    }, 800);
  }, { once: true });

  const payload = await requestScenePlan(promptText, imageBlob, {
    onMultimodalEvidence: async (data) => {
      showEvidence({
        ...data,
        _imageUrl: imageUrl,
      });
      fillDemoBeat(1);
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    },
  });

  applyGeneratedPlan(payload.scenePlan);
}

export async function initDemoMode() {
  const promptText = "What is the surface area of a cuboid with length 6cm, width 4cm, and height 3cm?";
  const demoImageBlob = await generateDemoImage();
  const demoImageFile = new File([demoImageBlob], "demo-cuboid.png", { type: "image/png" });

  window._demoImageBlob = demoImageFile;
  primeTutorInputs({
    text: promptText,
    imageFile: demoImageFile,
  });
  document.querySelector(".agent-trace")?.classList.remove("hidden");

  insertDemoBanner();
  insertDemoOverlay();
  document.addEventListener("demo:voice-turn-complete", () => fillDemoBeat(3), { once: true });

  window.setTimeout(() => {
    void runDemoSequence();
  }, 500);
}
