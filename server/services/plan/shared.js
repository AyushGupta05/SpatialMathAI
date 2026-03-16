function stripCodeFences(text = "") {
  let cleaned = String(text || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

function extractJsonSubstring(text = "") {
  const trimmed = String(text || "").trim();
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const firstStart = [objectStart, arrayStart]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstStart == null) {
    return trimmed;
  }

  const opening = trimmed[firstStart];
  const closing = opening === "[" ? "]" : "}";
  const lastEnd = trimmed.lastIndexOf(closing);
  if (lastEnd < firstStart) {
    return trimmed.slice(firstStart);
  }
  return trimmed.slice(firstStart, lastEnd + 1);
}

function sanitizeJsonStringContent(text = "") {
  let result = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (!inString) {
      result += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (escaping) {
      if (!/["\\/bfnrtu]/.test(char)) {
        result += "\\";
      }
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = false;
      continue;
    }

    if (char === "\n") {
      result += "\\n";
      continue;
    }
    if (char === "\r") {
      result += "\\r";
      continue;
    }
    if (char === "\t") {
      result += "\\t";
      continue;
    }

    result += char;
  }

  if (escaping) {
    result += "\\";
  }

  return result;
}

export function cleanupJson(text) {
  const withoutFences = stripCodeFences(text);
  const jsonLike = extractJsonSubstring(withoutFences);
  return sanitizeJsonStringContent(jsonLike);
}
