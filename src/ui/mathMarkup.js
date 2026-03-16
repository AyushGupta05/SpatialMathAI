import katex from "../../node_modules/katex/dist/katex.mjs";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

const MATH_TOKEN_PATTERN = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?!\$)[\s\S]+?(?<!\\)\$(?!\$))/g;
const LATEX_INPUT_PATTERN = /(^|[^\\])(\${1,2}|\\\(|\\\[)|\\(?:frac|sqrt|theta|pi|cdot|times|vec|left|right|angle|approx|epsilon|varepsilon|lambda|sigma|phi|alpha|beta|gamma|Delta|oint)|[_^]/;
const STANDALONE_MATH_PATTERN = /[=^_]|[θπ·√≈≤≥∞]|(?:\b(?:sin|cos|tan|theta|pi|epsilon|lambda|sigma|phi|angle|distance|vector|plane|line)\b)/i;
const PROSE_PATTERN = /\b(?:the|and|or|use|if|when|what|which|before|after|look|compare|between|helpful|because|then|find|show|tell|explain)\b/i;

function stripMathDelimiters(value = "") {
  const text = String(value || "").trim();
  if (text.startsWith("$$") && text.endsWith("$$")) return text.slice(2, -2).trim();
  if (text.startsWith("\\[") && text.endsWith("\\]")) return text.slice(2, -2).trim();
  if (text.startsWith("\\(") && text.endsWith("\\)")) return text.slice(2, -2).trim();
  if (text.startsWith("$") && text.endsWith("$")) return text.slice(1, -1).trim();
  return text;
}

function normalizePlainMath(text = "") {
  return stripMathDelimiters(text)
    .replaceAll("·", " \\cdot ")
    .replaceAll("⋅", " \\cdot ")
    .replaceAll("×", " \\times ")
    .replaceAll("÷", " \\div ")
    .replaceAll("≈", " \\approx ")
    .replaceAll("≤", " \\le ")
    .replaceAll("≥", " \\ge ")
    .replaceAll("°", "^\\circ")
    .replace(/(?<!\\)\btheta\b/gi, "\\theta")
    .replace(/(?<!\\)\bpi\b/gi, "\\pi")
    .replace(/(?<!\\)\bepsilon\b/gi, "\\epsilon")
    .replace(/(?<!\\)\blambda\b/gi, "\\lambda")
    .replace(/(?<!\\)\bsigma\b/gi, "\\sigma")
    .replace(/(?<!\\)\bphi\b/gi, "\\phi")
    .replace(/(?<!\\)\balpha\b/gi, "\\alpha")
    .replace(/(?<!\\)\bbeta\b/gi, "\\beta")
    .replace(/(?<!\\)\bgamma\b/gi, "\\gamma")
    .replace(/(?<!\\)\bdelta\b/gi, "\\delta")
    .replace(/\s+x\s+/g, " \\times ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderMathHtml(expression = "", { displayMode = false } = {}) {
  const source = normalizePlainMath(expression);
  if (!source) return "";
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return `<code>${escapeHtml(String(expression || "").trim())}</code>`;
  }
}

function extractMathPlaceholders(text = "") {
  const tokens = [];
  const placeholderText = String(text || "").replace(MATH_TOKEN_PATTERN, (token) => {
    const index = tokens.push(token) - 1;
    return `@@MATH_${index}@@`;
  });
  return {
    placeholderText,
    tokens,
  };
}

function applyInlineMarkdown(text = "") {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\\])_([^_]+)_/g, "$1<em>$2</em>");
}

function tokenToMath(token = "") {
  if (token.startsWith("$$") && token.endsWith("$$")) {
    return { displayMode: true, body: token.slice(2, -2) };
  }
  if (token.startsWith("\\[") && token.endsWith("\\]")) {
    return { displayMode: true, body: token.slice(2, -2) };
  }
  if (token.startsWith("\\(") && token.endsWith("\\)")) {
    return { displayMode: false, body: token.slice(2, -2) };
  }
  if (token.startsWith("$") && token.endsWith("$")) {
    return { displayMode: false, body: token.slice(1, -1) };
  }
  return { displayMode: false, body: token };
}

function restoreMathPlaceholders(text = "", tokens = []) {
  return String(text || "").replace(/@@MATH_(\d+)@@/g, (_match, indexText) => {
    const token = tokens[Number(indexText)] || "";
    const math = tokenToMath(token);
    return renderMathHtml(math.body, { displayMode: math.displayMode });
  });
}

function renderInlineMixedHtml(text = "") {
  const { placeholderText, tokens } = extractMathPlaceholders(text);
  const markdownHtml = applyInlineMarkdown(placeholderText);
  return restoreMathPlaceholders(markdownHtml, tokens);
}

function isStandaloneMathLine(line = "") {
  const normalized = String(line || "").trim();
  if (!normalized) return false;
  if (/^(?:\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\]|\\\([\s\S]+\\\)|(?<!\\)\$[^$\n]+(?<!\\)\$)$/.test(normalized)) {
    return true;
  }
  if (PROSE_PATTERN.test(normalized)) return false;
  if (!STANDALONE_MATH_PATTERN.test(normalized)) return false;
  if (/[.?!]$/.test(normalized)) return false;
  return normalized.split(/\s+/).length <= 10;
}

export function hasMathMarkup(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  return LATEX_INPUT_PATTERN.test(normalized) || isStandaloneMathLine(normalized);
}

export function renderRichTextHtml(content = "") {
  const normalized = String(content || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return `<p class="chat-msg-paragraph"></p>`;
  }

  const lines = normalized.split("\n");
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul class="chat-msg-list">${listItems.join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*]|•)\s+(.+)$/);
    if (bulletMatch) {
      listItems.push(`<li>${renderInlineMixedHtml(bulletMatch[1])}</li>`);
      continue;
    }

    flushList();
    if (isStandaloneMathLine(line)) {
      blocks.push(`<div class="chat-msg-display-math">${renderMathHtml(line, { displayMode: true })}</div>`);
      continue;
    }

    blocks.push(`<p class="chat-msg-paragraph">${renderInlineMixedHtml(line)}</p>`);
  }

  flushList();
  return blocks.join("");
}

export function renderMathBlockHtml(content = "", { displayMode = true } = {}) {
  const normalized = String(content || "").trim();
  if (!normalized) return "";
  return renderMathHtml(normalized, { displayMode });
}
