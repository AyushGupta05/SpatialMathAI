import { bootstrapApp } from "./app.js";
import { initTutorController, updateTutorLabels } from "./ui/tutorController.js";
import { initDemoMode } from "./ui/demoMode.js";

const appContext = bootstrapApp();
const isDemoMode = new URLSearchParams(window.location.search).get("demo") === "true";

// Initialize tutor system
initTutorController(appContext);
if (isDemoMode) {
  void initDemoMode();
}

// Add label rendering to the animation loop
function tutorRenderLoop() {
  updateTutorLabels();
  requestAnimationFrame(tutorRenderLoop);
}
requestAnimationFrame(tutorRenderLoop);
