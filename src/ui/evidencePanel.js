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
    return "<li>No extracted givens yet.</li>";
  }
  return values.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function buildEvidencePanelHTML(data = {}) {
  const score = Math.max(0, Math.min(1, Number(data?.retrieval?.similarity_score || 0)));
  const imageMarkup = data.input_had_image && data._imageUrl
    ? `
      <img
        src="${escapeHtml(data._imageUrl)}"
        style="max-width:120px;border-radius:4px"
        alt="uploaded diagram"
      />
      <span class="badge badge-info">Spatial Math AI read this image</span>
    `
    : `<span class="badge badge-muted">Text input</span>`;

  return `
    <div class="agent-trace-card evidence-panel-grid">
      <div class="evidence-panel-column">
        ${imageMarkup}
      </div>
      <div class="evidence-panel-column">
        <p class="label-muted">Spatial Math AI extracted</p>
        <ul class="evidence-panel-list">
          ${renderList(data?.extracted?.givens || [])}
        </ul>
        <em>${escapeHtml(data?.extracted?.diagram_summary || "No diagram summary provided.")}</em>
        <hr />
        <p class="label-muted">Matched lesson type</p>
        <strong>${escapeHtml(data?.retrieval?.matched_title || "No match yet")}</strong>
        <div class="score-bar">
          <div class="score-bar-fill" style="width:${score * 100}%"></div>
        </div>
        <span class="tag">${escapeHtml(data?.retrieval?.why || "")}</span>
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
    closeTimerId = window.setTimeout(() => {
      closeTimerId = null;
      if (!panelEl) return;
      panelEl.classList.remove("evidence--visible");
      panelEl.classList.add("evidence--hidden");
      panelEl.setAttribute("aria-hidden", "true");
    }, delayMs);
  };
  document.addEventListener("scene:first-object", firstObjectListener, { once: true });
}

export function hideEvidence() {
  if (!panelEl) return;
  clearPendingClose();
  panelEl.classList.remove("evidence--visible");
  panelEl.classList.add("evidence--hidden");
  panelEl.innerHTML = "";
  panelEl.setAttribute("aria-hidden", "true");
}
