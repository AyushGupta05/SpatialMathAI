import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sceneSpecToPlan } from "../../src/ai/planSchema.js";

const challengesRoute = new Hono();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "challenges.json");

let cachedChallenges = null;

async function loadChallenges() {
  if (!cachedChallenges) {
    const raw = await readFile(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    cachedChallenges = parsed.map((challenge) => ({
      ...challenge,
      scenePlan: sceneSpecToPlan(challenge.sceneSpec, {
        id: challenge.id,
        mode: "guided",
        expectedAnswer: challenge.expectedAnswer,
        tolerance: challenge.tolerance,
        challengePrompt: challenge.question,
      }),
    }));
  }
  return cachedChallenges;
}

challengesRoute.get("/", async (c) => {
  try {
    const challenges = await loadChallenges();
    return c.json({
      challenges: challenges.map((challenge) => ({
        id: challenge.id,
        title: challenge.title,
        difficulty: challenge.difficulty,
        category: challenge.category,
        question: challenge.question,
        scenePlan: challenge.scenePlan,
      })),
    });
  } catch (error) {
    console.error("Challenges list error:", error);
    return c.json({ error: "Failed to load challenges" }, 500);
  }
});

challengesRoute.post("/:id/check", async (c) => {
  try {
    const { id } = c.req.param();
    const { answer } = await c.req.json();
    const challenges = await loadChallenges();
    const challenge = challenges.find((candidate) => candidate.id === id);

    if (!challenge) {
      return c.json({ error: "Challenge not found" }, 404);
    }

    const expected = challenge.expectedAnswer;
    const tolerance = challenge.tolerance || 0.01;
    let correct = false;

    if (typeof expected === "number" && typeof answer === "number") {
      correct = Math.abs(answer - expected) <= tolerance * Math.max(1, Math.abs(expected));
    } else {
      correct = String(answer).trim().toLowerCase() === String(expected).trim().toLowerCase();
    }

    return c.json({
      correct,
      feedback: correct
        ? challenge.successMessage || "Correct. Nice work."
        : `Not quite yet. ${challenge.hints?.[0] || "Check the formula and your measurements."}`,
      expectedAnswer: correct ? expected : undefined,
    });
  } catch (error) {
    console.error("Challenge check error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

export default challengesRoute;
