import { Hono } from "hono";
import { evaluateBuild } from "../services/buildEvaluator.js";

const buildRoute = new Hono();

buildRoute.post("/evaluate", async (c) => {
  try {
    const { plan, sceneSnapshot, currentStepId = null } = await c.req.json();
    if (!plan || !sceneSnapshot) {
      return c.json({ error: "plan and sceneSnapshot are required" }, 400);
    }

    const assessment = evaluateBuild(plan, sceneSnapshot, currentStepId);
    return c.json({ assessment });
  } catch (error) {
    console.error("Build evaluate error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

export default buildRoute;
