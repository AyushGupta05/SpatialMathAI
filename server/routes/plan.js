import { Hono } from "hono";
import { generateScenePlan } from "../services/planService.js";
import { extractPlanPayload } from "../services/planRequest.js";

export function createPlanRoute({ planGenerator = generateScenePlan } = {}) {
  const planRoute = new Hono();

  planRoute.post("/", async (c) => {
    try {
      const { questionText, imageAsset, sceneSnapshot = null, mode = "guided" } = await extractPlanPayload(c.req.raw);
      if (!questionText && !imageAsset) {
        return c.json({ error: "question text or an uploaded image is required" }, 400);
      }

      const scenePlan = await planGenerator({
        questionText,
        imageAsset,
        sceneSnapshot,
        mode,
      });
      return c.json({ scenePlan });
    } catch (error) {
      console.error("Plan route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  return planRoute;
}

export default createPlanRoute();
