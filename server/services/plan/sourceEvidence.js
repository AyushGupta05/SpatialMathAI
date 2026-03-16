function uniqueStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
  )];
}

export function buildSourceEvidence(sourceSummary = {}) {
  const rawDiagramSummary = typeof sourceSummary.diagramSummary === "string" ? sourceSummary.diagramSummary.trim() : "";
  const diagramSummary = /^no diagram provided/i.test(rawDiagramSummary) ? "" : rawDiagramSummary;
  return {
    inputMode: sourceSummary.inputMode || "text",
    givens: uniqueStrings(sourceSummary.givens || []),
    labels: uniqueStrings(sourceSummary.labels || []),
    diagramSummary,
    conflicts: uniqueStrings(sourceSummary.conflicts || []),
  };
}
