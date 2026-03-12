import { bootstrapApp } from "./app.js";
import { initTutorController, updateTutorLabels } from "./ui/tutorController.js";

const appContext = bootstrapApp();

// Initialize tutor system
initTutorController(appContext);

// Add label rendering to the animation loop
function tutorRenderLoop() {
  updateTutorLabels();
  requestAnimationFrame(tutorRenderLoop);
}
requestAnimationFrame(tutorRenderLoop);
