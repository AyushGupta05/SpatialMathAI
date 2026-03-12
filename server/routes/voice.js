import { Hono } from "hono";
import { respondWithVoice } from "../services/voiceController.js";

const voiceRoute = new Hono();

voiceRoute.post("/respond", async (c) => {
  try {
    const { text, playbackMode = "auto" } = await c.req.json();
    if (!text || typeof text !== "string") {
      return c.json({ error: "text is required" }, 400);
    }

    const response = await respondWithVoice({ text, playbackMode });
    return c.json(response);
  } catch (error) {
    console.error("Voice route error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

export default voiceRoute;
