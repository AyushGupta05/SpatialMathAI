import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { generateScenePlan } from "../services/planService.js";
import { extractPlanPayload } from "../services/planRequest.js";

function normalizePlanPayload(result) {
  if (result?.scenePlan) {
    return {
      scenePlan: result.scenePlan,
      sourceEvidence: result.sourceEvidence || result.scenePlan.sourceEvidence || null,
      agentTrace: result.agentTrace || result.scenePlan.agentTrace || [],
      demoPreset: result.demoPreset || result.scenePlan.demoPreset || null,
      retrieval: result.retrieval || null,
    };
  }

  return {
    scenePlan: result,
    sourceEvidence: result?.sourceEvidence || null,
    agentTrace: result?.agentTrace || [],
    demoPreset: result?.demoPreset || null,
    retrieval: null,
  };
}

export function createPlanRoute({ planGenerator = generateScenePlan } = {}) {
  const planRoute = new Hono();

  planRoute.post("/", async (c) => {
    try {
      const { questionText, imageAsset, sceneSnapshot = null, mode = "guided" } = await extractPlanPayload(c.req.raw);
      if (!questionText && !imageAsset) {
        return c.json({ error: "question text or an uploaded image is required" }, 400);
      }

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      return streamSSE(c, async (stream) => {
        const emit = async (eventName, data) => {
          const payload = eventName === "plan"
            ? normalizePlanPayload(data)
            : data;
          await stream.writeSSE({
            event: eventName,
            data: JSON.stringify(payload),
          });
        };

        await planGenerator({
          questionText,
          imageAsset,
          sceneSnapshot,
          mode,
        }, emit);
      });
    } catch (error) {
      console.error("Plan route error:", error);
      return c.json({ error: error.message || "Internal server error" }, 500);
    }
  });

  return planRoute;
}

export default createPlanRoute();
