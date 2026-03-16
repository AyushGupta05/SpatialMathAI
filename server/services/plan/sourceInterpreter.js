import { SOURCE_SUMMARY_PROMPT } from "./prompts.js";
import { heuristicSourceSummary } from "./heuristics.js";
import { cleanupJson } from "./shared.js";
import { converseWithModelFailover } from "../modelInvoker.js";

function normalizeNarrativeList(values = []) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
}

function enrichRelationships({ cleanedQuestion = "", diagramSummary = "", relationships = [] }) {
  const nextRelationships = [...normalizeNarrativeList(relationships)];
  const text = `${cleanedQuestion} ${diagramSummary}`.toLowerCase();

  if (
    /angle between (two |the )?(vectors?|lines?|ab|ac)/i.test(text)
    || (/originate from/i.test(text) && /terminate at/i.test(text))
    || (/vectors?\s*ab/i.test(text) && /vectors?\s*ac/i.test(text))
  ) {
    nextRelationships.push("angle_type:line_line");
  }

  if (
    /angle (between|with) .{0,20}plane/i.test(text)
    || /inclination/i.test(text)
    || /plane equation/i.test(text)
    || /ax\s*\+\s*by\s*\+\s*cz/i.test(text)
  ) {
    nextRelationships.push("angle_type:line_plane");
  }

  if (
    /skew/i.test(text)
    || /non.intersecting/i.test(text)
    || /shortest distance between/i.test(text)
  ) {
    nextRelationships.push("angle_type:skew_distance");
  }

  return [...new Set(nextRelationships)];
}

function finalizeSourceSummary(summary = {}, fallback = {}, questionText = "") {
  const cleanedQuestion = String(summary.cleanedQuestion || fallback.cleanedQuestion || questionText || "").trim();
  const diagramSummary = String(summary.diagramSummary || fallback.diagramSummary || "").trim();

  return {
    ...fallback,
    ...summary,
    cleanedQuestion,
    diagramSummary,
    givens: normalizeNarrativeList(summary.givens ?? fallback.givens),
    labels: normalizeNarrativeList(summary.labels ?? fallback.labels),
    relationships: enrichRelationships({
      cleanedQuestion,
      diagramSummary,
      relationships: summary.relationships ?? fallback.relationships,
    }),
    conflicts: Array.isArray(summary.conflicts)
      ? summary.conflicts
      : fallback.conflicts,
  };
}

export function contentBlocksForSource({ questionText = "", imageAsset = null }) {
  const blocks = [];
  if (imageAsset) {
    blocks.push({
      image: {
        format: imageAsset.format,
        source: { bytes: imageAsset.bytes },
      },
    });
  }
  const promptText = questionText.trim()
    ? `Question text:\n${questionText.trim()}`
    : "Question text: none provided. Infer the problem from the uploaded diagram.";
  blocks.push({ text: promptText });
  return blocks;
}

export async function interpretQuestionSource({ questionText = "", imageAsset = null }) {
  const fallback = heuristicSourceSummary({ questionText, imageAsset });
  if (!questionText.trim() && !imageAsset) {
    return finalizeSourceSummary(fallback, fallback, questionText);
  }

  try {
    const text = await converseWithModelFailover("text", SOURCE_SUMMARY_PROMPT, [
      {
        role: "user",
        content: contentBlocksForSource({ questionText, imageAsset }),
      },
    ], {
      maxTokens: 1200,
      temperature: 0.1,
    });

    const parsed = JSON.parse(cleanupJson(text));
    return finalizeSourceSummary(parsed, fallback, questionText);
  } catch (error) {
    console.warn("Falling back to heuristic source summary:", error?.message || error);
    return finalizeSourceSummary(fallback, fallback, questionText);
  }
}
