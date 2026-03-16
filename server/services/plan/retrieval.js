import { invokeJsonWithModelFailover } from "../modelInvoker.js";
import { getWorkingModelId, hasAwsCredentials } from "../modelRouter.js";

export const LESSON_EXEMPLARS = [
  {
    id: "cube_volume",
    title: "Volume of a cube",
    description: "Explaining how equal edge lengths combine into cubic volume in a manipulable solid.",
    keywords: ["volume", "cube", "side length", "s cubed", "equal edges", "3d solid"],
    lesson_type: "geometry",
    representation_hint: "solid_first",
    embedding: null,
  },
  {
    id: "cuboid_volume",
    title: "Volume of a cuboid",
    description: "Using length, width, and height to build volume from stacked rectangular layers.",
    keywords: ["volume", "cuboid", "rectangular prism", "length", "width", "height", "lwh"],
    lesson_type: "geometry",
    representation_hint: "solid_first",
    embedding: null,
  },
  {
    id: "cylinder_volume",
    title: "Volume of a cylinder",
    description: "Connecting a circular base area to height so the learner sees why the prism idea still works.",
    keywords: ["volume", "cylinder", "radius", "height", "pi r squared h", "base area"],
    lesson_type: "geometry",
    representation_hint: "solid_first",
    embedding: null,
  },
  {
    id: "cone_volume",
    title: "Volume of a cone",
    description: "Showing why a cone holds one third of the matching cylinder volume.",
    keywords: ["volume", "cone", "radius", "height", "one third", "pi r squared h", "1/3"],
    lesson_type: "geometry",
    representation_hint: "solid_compare",
    embedding: null,
  },
  {
    id: "pyramid_volume",
    title: "Volume of a pyramid",
    description: "Relating a pyramid to a prism with the same base and height using the one-third pattern.",
    keywords: ["volume", "pyramid", "base area", "height", "one third", "prism comparison"],
    lesson_type: "geometry",
    representation_hint: "solid_compare",
    embedding: null,
  },
  {
    id: "sphere_volume",
    title: "Volume of a sphere",
    description: "Building intuition for spherical volume from radius and radial symmetry.",
    keywords: ["volume", "sphere", "radius", "4/3 pi r cubed", "radial symmetry", "curved surface"],
    lesson_type: "geometry",
    representation_hint: "solid_first",
    embedding: null,
  },
  {
    id: "cube_sa",
    title: "Surface area of a cube",
    description: "Counting six congruent square faces to build the total exposed area.",
    keywords: ["surface area", "cube", "six faces", "square faces", "6s squared", "face counting"],
    lesson_type: "geometry",
    representation_hint: "net_preferred",
    embedding: null,
  },
  {
    id: "cuboid_sa",
    title: "Surface area of a cuboid",
    description: "Finding total surface area by grouping opposite rectangular faces into matching pairs.",
    keywords: ["surface area", "cuboid", "face pairs", "rectangles", "2(lw+lh+wh)", "pairs"],
    lesson_type: "geometry",
    representation_hint: "net_preferred",
    embedding: null,
  },
  {
    id: "cylinder_sa",
    title: "Surface area of a cylinder",
    description: "Separating the curved surface from the two circular caps and unfolding the wrapper.",
    keywords: ["surface area", "cylinder", "curved surface", "circle caps", "2pi rh", "2pi r squared"],
    lesson_type: "geometry",
    representation_hint: "net_preferred",
    embedding: null,
  },
  {
    id: "cone_sa",
    title: "Surface area of a cone",
    description: "Combining the circular base with the slanted lateral surface built from slant height.",
    keywords: ["surface area", "cone", "slant height", "lateral area", "pi rl", "base circle"],
    lesson_type: "geometry",
    representation_hint: "net_preferred",
    embedding: null,
  },
  {
    id: "net_unfolding",
    title: "Net unfolding",
    description: "Flattening a solid into 2D pieces so each visible face can be counted once.",
    keywords: ["net unfolding", "surface area", "flatten", "2d net", "faces", "unfold"],
    lesson_type: "geometry",
    representation_hint: "net_preferred",
    embedding: null,
  },
  {
    id: "face_counting",
    title: "Face counting strategy",
    description: "Using visible and opposite face pairs to prevent missing or double-counting surfaces.",
    keywords: ["face counting", "surface area", "pairs", "opposite faces", "count once", "visible faces"],
    lesson_type: "geometry",
    representation_hint: "net_preferred",
    embedding: null,
  },
  {
    id: "line_plane_intersection",
    title: "Line-plane intersection point",
    description: "Tracking how a parametric line meets a plane equation at a single spatial point.",
    keywords: [
      "intersection point",
      "line meets plane",
      "parametric line",
      "plane equation",
      "substitute",
      "find t",
      "point of intersection",
      "line enters plane",
    ],
    lesson_type: "analytic_geometry",
    representation_hint: "vector_overlay",
    embedding: null,
  },
  {
    id: "angle_line_plane",
    title: "Angle between a line and a plane",
    description: "Finding the angle of inclination of a line relative to a flat plane surface using the complement of the angle between the line and the plane normal.",
    keywords: [
      "line plane angle",
      "inclination",
      "plane surface",
      "normal vector",
      "plane equation",
      "complement",
      "90 degrees",
      "perpendicular to plane",
      "line intersects plane",
      "plane normal",
      "dot product with normal",
      "ax+by+cz",
    ],
    lesson_type: "analytic_geometry",
    representation_hint: "vector_overlay",
    embedding: null,
  },
  {
    id: "angle_between_lines",
    title: "Angle between two lines or vectors",
    description: "Finding the angle between two direction vectors or lines using the dot product formula cos(theta) = (AB dot AC)/(|AB||AC|).",
    keywords: [
      "angle between vectors",
      "two lines",
      "direction vector",
      "dot product",
      "arccos",
      "cos theta",
      "AB AC",
      "vector angle",
      "two directions",
      "common point",
      "originate from",
      "terminate at",
      "magnitude",
      "AB dot AC",
      "cosine formula",
      "vector components",
    ],
    lesson_type: "analytic_geometry",
    representation_hint: "vector_overlay",
    embedding: null,
  },
  {
    id: "skew_lines_distance",
    title: "Distance between skew lines",
    description: "Using a cross product to build the shortest connector between two non-intersecting lines.",
    keywords: [
      "skew lines",
      "non-intersecting",
      "non-parallel",
      "shortest distance",
      "cross product",
      "perpendicular distance",
      "d formula",
      "r1 r2 direction vectors",
      "lines in 3D space",
      "no common point",
    ],
    lesson_type: "analytic_geometry",
    representation_hint: "vector_overlay",
    embedding: null,
  },
  {
    id: "coordinate_frame_3d",
    title: "3D coordinate frame",
    description: "Anchoring points, vectors, and planes in a shared axis system so algebra matches the scene.",
    keywords: ["coordinate frame", "3d axes", "points", "vectors", "planes", "reference frame"],
    lesson_type: "analytic_geometry",
    representation_hint: "axis_overlay",
    embedding: null,
  },
  {
    id: "electric_field_single",
    title: "Electric field of a single charge",
    description: "Showing how field direction and strength radiate outward or inward from one point charge.",
    keywords: ["electric field", "single charge", "field lines", "radial", "positive charge", "negative charge"],
    lesson_type: "physics",
    representation_hint: "field_lines",
    embedding: null,
  },
  {
    id: "electric_dipole",
    title: "Electric dipole",
    description: "Explaining how opposite charges create a directional field pattern between them.",
    keywords: ["electric dipole", "field lines", "positive and negative", "opposite charges", "directional pattern"],
    lesson_type: "physics",
    representation_hint: "field_lines",
    embedding: null,
  },
  {
    id: "gaussian_surface",
    title: "Gaussian surface",
    description: "Using a closed surface to connect electric flux to enclosed charge.",
    keywords: ["gaussian surface", "flux", "closed surface", "gauss law", "enclosed charge", "oint"],
    lesson_type: "physics",
    representation_hint: "field_lines",
    embedding: null,
  },
  {
    id: "comparison_scene",
    title: "Comparison scene",
    description: "Setting two related objects side by side so the learner can predict, compare, and revise.",
    keywords: ["comparison", "side by side", "predict", "compare", "scene reasoning", "what changes"],
    lesson_type: "freeform",
    representation_hint: "comparison_overlay",
    embedding: null,
  },
];

const EMBEDDING_READY_COUNT = LESSON_EXEMPLARS.length;
const embeddingCache = new Map();
let lexicalFallbackWarned = false;
let warmupPromise = null;

function tokenize(text = "") {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

function buildEmbeddingText(exemplar = {}) {
  return [
    exemplar.title,
    exemplar.description,
    Array.isArray(exemplar.keywords) ? exemplar.keywords.join(", ") : "",
  ].filter(Boolean).join(". ");
}

function normalizeRelationships(values = []) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function buildQueryText(questionText = "", sourceSummary = {}) {
  const cleanedQuestion = String(sourceSummary.cleanedQuestion || questionText || "").trim();
  const relationships = normalizeRelationships(sourceSummary.relationships);
  const diagramSummary = String(sourceSummary.diagramSummary || "").trim();
  return [
    cleanedQuestion,
    relationships.length ? relationships.join(". ") : "",
    diagramSummary,
  ].filter(Boolean).join(". ");
}

function lexicalScore(query, exemplar) {
  const queryTokens = tokenize(query);
  const exemplarTokens = tokenize(buildEmbeddingText(exemplar));
  let overlap = 0;
  for (const token of queryTokens) {
    if (exemplarTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, queryTokens.size);
}

function whyForMatch(query, exemplar) {
  const queryTokens = tokenize(query);
  const matches = (exemplar.keywords || [])
    .map((keyword) => {
      const overlap = [...tokenize(keyword)].filter((token) => queryTokens.has(token)).length;
      return { keyword, overlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.keyword.localeCompare(b.keyword))
    .slice(0, 2)
    .map((entry) => entry.keyword);

  return matches.length ? matches.join(", ") : exemplar.lesson_type;
}

function applyTypeConflictGuard(sortedMatches = [], relationships = []) {
  if (!sortedMatches.length) return null;

  let topMatch = sortedMatches[0];
  const queryHasLineLineTag = relationships.includes("angle_type:line_line");
  const queryHasLinePlaneTag = relationships.includes("angle_type:line_plane");

  if (queryHasLineLineTag && topMatch.exemplarId === "angle_line_plane") {
    const lineLineMatch = sortedMatches.find((match) => match.exemplarId === "angle_between_lines");
    if (lineLineMatch && topMatch.score - lineLineMatch.score < 0.08) {
      topMatch = lineLineMatch;
    }
  }

  if (queryHasLinePlaneTag && topMatch.exemplarId === "angle_between_lines") {
    const linePlaneMatch = sortedMatches.find((match) => match.exemplarId === "angle_line_plane");
    if (linePlaneMatch && topMatch.score - linePlaneMatch.score < 0.08) {
      topMatch = linePlaneMatch;
    }
  }

  return topMatch;
}

function dotProduct(a = [], b = []) {
  const length = Math.min(a.length, b.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += Number(a[index] || 0) * Number(b[index] || 0);
  }
  return score;
}

function vectorMagnitude(values = []) {
  return Math.sqrt(values.reduce((total, value) => total + (Number(value || 0) ** 2), 0));
}

function cosineSimilarity(a = [], b = []) {
  const denominator = vectorMagnitude(a) * vectorMagnitude(b);
  if (!denominator) return 0;
  return dotProduct(a, b) / denominator;
}

function parseEmbeddingResponse(payload = {}) {
  if (Array.isArray(payload.embedding)) return payload.embedding;
  if (Array.isArray(payload.embeddings?.[0]?.embedding)) return payload.embeddings[0].embedding;
  if (Array.isArray(payload.output?.embedding)) return payload.output.embedding;
  return null;
}

async function embedText(text) {
  if (!hasAwsCredentials()) return null;
  if (embeddingCache.has(text)) return embeddingCache.get(text);

  try {
    const payload = await invokeJsonWithModelFailover("embeddings", {
      schemaVersion: "nova-multimodal-embed-v1",
      taskType: "SINGLE_EMBEDDING",
      singleEmbeddingParams: {
        embeddingPurpose: "TEXT_RETRIEVAL",
        text: {
          truncationMode: "END",
          value: text,
        },
      },
    });
    const embedding = parseEmbeddingResponse(payload);
    if (Array.isArray(embedding) && embedding.length) {
      embeddingCache.set(text, embedding);
      return embedding;
    }
  } catch (error) {
    console.warn("Embedding lookup failed:", error?.message || error);
  }

  return null;
}

function warnLexicalFallback() {
  if (lexicalFallbackWarned) return;
  lexicalFallbackWarned = true;
  console.warn("Nova MME unavailable \u2014 lexical fallback active");
}

export function getLessonExemplarById(exemplarId = "") {
  return LESSON_EXEMPLARS.find((exemplar) => exemplar.id === exemplarId) || null;
}

export async function warmLessonExemplars() {
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    if (!hasAwsCredentials()) {
      warnLexicalFallback();
      return false;
    }

    let readyCount = 0;
    for (const exemplar of LESSON_EXEMPLARS) {
      const embedding = await embedText(buildEmbeddingText(exemplar));
      exemplar.embedding = Array.isArray(embedding) ? embedding : null;
      if (exemplar.embedding) {
        readyCount += 1;
      }
    }

    if (readyCount === EMBEDDING_READY_COUNT) {
      console.info(`Exemplar embeddings ready: ${EMBEDDING_READY_COUNT}/${EMBEDDING_READY_COUNT}`);
      return true;
    }

    warnLexicalFallback();
    return false;
  })();

  return warmupPromise;
}

export async function retrieveLessonExemplar({ questionText = "", sourceSummary = {} }) {
  const cleanedQuestion = String(sourceSummary.cleanedQuestion || questionText || "").trim();
  const relationships = normalizeRelationships(sourceSummary.relationships);
  const query = buildQueryText(questionText, sourceSummary);
  const fallbackExemplar = LESSON_EXEMPLARS[0];

  if (!query) {
    return {
      exemplarId: fallbackExemplar.id,
      matchedTitle: fallbackExemplar.title,
      score: 0,
      why: fallbackExemplar.lesson_type,
    };
  }

  const queryEmbedding = await embedText(query);
  if (queryEmbedding) {
    const scoredMatches = [];

    for (const exemplar of LESSON_EXEMPLARS) {
      const exemplarEmbedding = exemplar.embedding || await embedText(buildEmbeddingText(exemplar));
      exemplar.embedding = exemplarEmbedding || exemplar.embedding || null;
      if (!exemplarEmbedding) continue;
      scoredMatches.push({
        exemplar,
        exemplarId: exemplar.id,
        score: cosineSimilarity(queryEmbedding, exemplarEmbedding),
      });
    }

    const sortedMatches = scoredMatches
      .sort((a, b) => b.score - a.score || a.exemplar.title.localeCompare(b.exemplar.title));
    const topMatch = applyTypeConflictGuard(sortedMatches, relationships);

    if (topMatch?.exemplar) {
      return {
        exemplarId: topMatch.exemplar.id,
        matchedTitle: topMatch.exemplar.title,
        score: Number(topMatch.score.toFixed(2)),
        why: whyForMatch(cleanedQuestion || query, topMatch.exemplar),
      };
    }
  } else {
    warnLexicalFallback();
  }

  const sortedMatches = LESSON_EXEMPLARS
    .map((exemplar) => ({
      exemplar,
      exemplarId: exemplar.id,
      score: lexicalScore(query, exemplar),
    }))
    .sort((a, b) => b.score - a.score || a.exemplar.title.localeCompare(b.exemplar.title));
  const topMatch = applyTypeConflictGuard(sortedMatches, relationships)
    || {
      exemplar: fallbackExemplar,
      score: 0,
    };

  return {
    exemplarId: topMatch.exemplar.id,
    matchedTitle: topMatch.exemplar.title,
    score: Number(topMatch.score.toFixed(2)),
    why: whyForMatch(cleanedQuestion || query, topMatch.exemplar),
  };
}

export function getLastUsedTextModel() {
  return getWorkingModelId("text");
}

