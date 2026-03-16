let panelEl = null;
let firstObjectListener = null;
let closeTimerId = null;

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderList(items = []) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    return '<li class="evidence-panel-empty">No extracted givens yet.</li>';
  }
  return values.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function buildEvidencePanelHTML(data = {}) {
  const score = Math.max(0, Math.min(1, Number(data?.retrieval?.similarity_score || 0)));
  const scorePercent = Math.round(score * 100);
  const matchTitle = escapeHtml(data?.retrieval?.matched_title || "No match yet");
  const summary = escapeHtml(data?.extracted?.diagram_summary || "No diagram summary provided.");
  const why = escapeHtml(data?.retrieval?.why || "");
  const imageMarkup = data.input_had_image && data._imageUrl
    ? `
      <div class="evidence-panel-media-frame">
        <img
          src="${escapeHtml(data._imageUrl)}"
          class="evidence-panel-image"
          alt="uploaded diagram"
        />
      </div>
      <span class="badge badge-info">Diagram input</span>
    `
    : `
      <div class="evidence-panel-source-card">
        <span class="badge badge-muted">Text input</span>
        <p class="evidence-panel-source-copy">Parsed directly from the typed problem statement.</p>
      </div>
    `;

  return `
    <div class="agent-trace-card evidence-panel-grid">
      <div class="evidence-panel-column">
        ${imageMarkup}
      </div>
      <div class="evidence-panel-column">
        <div class="evidence-panel-heading">
          <p class="label-muted">Spatial Math AI extracted</p>
          <span class="evidence-panel-score">${scorePercent}% match</span>
        </div>
        <ul class="evidence-panel-list">
          ${renderList(data?.extracted?.givens || [])}
        </ul>
        <p class="evidence-panel-summary">${summary}</p>
        <div class="evidence-panel-divider"></div>
        <p class="label-muted">Matched lesson type</p>
        <strong class="evidence-panel-match">${matchTitle}</strong>
        <div class="score-bar">
          <div class="score-bar-fill" style="width:${score * 100}%"></div>
        </div>
        ${why ? `<span class="tag">${why}</span>` : ""}
      </div>
    </div>
  `;
}

function clearPendingClose() {
  if (firstObjectListener) {
    document.removeEventListener("scene:first-object", firstObjectListener);
    firstObjectListener = null;
  }
  if (closeTimerId) {
    window.clearTimeout(closeTimerId);
    closeTimerId = null;
  }
}

export function initEvidencePanel(containerEl) {
  if (!containerEl || panelEl) return panelEl;
  panelEl = document.createElement("div");
  panelEl.className = "agent-trace evidence-panel evidence--hidden";
  panelEl.setAttribute("aria-hidden", "true");
  containerEl.prepend(panelEl);
  return panelEl;
}

export function showEvidence(data) {
  if (!panelEl) return;
  clearPendingClose();
  panelEl.innerHTML = buildEvidencePanelHTML(data);
  panelEl.classList.add("evidence--visible");
  panelEl.classList.remove("evidence--hidden");
  panelEl.setAttribute("aria-hidden", "false");
}

export function registerEvidenceAutoClose(delayMs = 800) {
  if (!panelEl) return;
  clearPendingClose();
  firstObjectListener = () => {
    firstObjectListener = null;
    closeEvidence(delayMs);
  };
  document.addEventListener("scene:first-object", firstObjectListener, { once: true });
}

export function closeEvidence(delayMs = 0) {
  if (!panelEl) return;
  clearPendingClose();
  closeTimerId = window.setTimeout(() => {
    closeTimerId = null;
    if (!panelEl) return;
    panelEl.classList.remove("evidence--visible");
    panelEl.classList.add("evidence--hidden");
    panelEl.setAttribute("aria-hidden", "true");
  }, delayMs);
}

export function hideEvidence() {
  if (!panelEl) return;
  clearPendingClose();
  panelEl.classList.remove("evidence--visible");
  panelEl.classList.add("evidence--hidden");
  panelEl.innerHTML = "";
  panelEl.setAttribute("aria-hidden", "true");
}
