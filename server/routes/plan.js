import { Hono } from "hono";
import { generateScenePlan } from "../services/planService.js";

const planRoute = new Hono();

planRoute.post("/", async (c) => {
  try {
    const { question, sceneSnapshot = null, mode = "guided" } = await c.req.json();
    if (!question || typeof question !== "string") {
      return c.json({ error: "question is required" }, 400);
    }

    const scenePlan = await generateScenePlan({ question: question.trim(), sceneSnapshot, mode });
    return c.json({ scenePlan });
  } catch (error) {
    console.error("Plan route error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

export default planRoute;
