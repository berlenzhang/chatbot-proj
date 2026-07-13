import { getDocument, GlobalWorkerOptions, TextLayer } from "./vendor/pdfjs/pdf.min.mjs";

GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.mjs";

const API_BASE = "http://localhost:8000";

// ── Element refs ──────────────────────────────────────────────────────────────
const dropzone      = document.getElementById("dropzone");
const fileInput     = document.getElementById("fileInput");
const statusBar     = document.getElementById("uploadStatus");
const viewerContent = document.getElementById("viewerContent");
const docSelect     = document.getElementById("docSelect");
const deleteBtn     = document.getElementById("deleteBtn");
const chatHistory   = document.getElementById("chatHistory");
const questionInput = document.getElementById("questionInput");
const sendBtn       = document.getElementById("sendBtn");
const layout         = document.getElementById("layout");
const sidebar        = document.getElementById("sidebar");
const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
const sidebarOpenBtn  = document.getElementById("sidebarOpenBtn");
const viewerPanel    = document.getElementById("viewerPanel");
const chatPanel      = document.getElementById("chatPanel");
const panelResizer   = document.getElementById("panelResizer");

// Filename currently loaded in the viewer, or null if nothing is shown.
// Used to gate citation navigation to the doc that's actually on screen.
let currentViewerFilename = null;
let currentPdfDoc = null;      // PDFDocumentProxy, only set when viewing a PDF
let currentPdfPageNum = 1;
let currentRawText = null;     // full text content, only set when viewing TXT/DOCX

// ── Sidebar collapse ──────────────────────────────────────────────────────────
sidebarCloseBtn.addEventListener("click", () => {
  sidebar.classList.add("collapsed");
  sidebarOpenBtn.hidden = false;
});
sidebarOpenBtn.addEventListener("click", () => {
  sidebar.classList.remove("collapsed");
  sidebarOpenBtn.hidden = true;
});

// ── Panel resizer (drag to resize preview vs. chat panels) ────────────────────
const MIN_PANEL_WIDTH = 240;

function resizePanels(clientX) {
  const totalWidth = viewerPanel.getBoundingClientRect().width + chatPanel.getBoundingClientRect().width;

  let viewerWidth = clientX - viewerPanel.getBoundingClientRect().left;
  viewerWidth = Math.max(MIN_PANEL_WIDTH, Math.min(viewerWidth, totalWidth - MIN_PANEL_WIDTH));
  const ratio = viewerWidth / totalWidth;

  // Store the split as flex-grow ratios (basis 0), not fixed pixel widths, so the
  // two panels always divide up whatever space they're given — including the extra
  // width freed when the sidebar is collapsed — instead of leaving it as a gap.
  viewerPanel.style.flex = `${ratio} 1 0%`;
  chatPanel.style.flex = `${1 - ratio} 1 0%`;
}

function startResize(e) {
  e.preventDefault();
  layout.classList.add("resizing");
  panelResizer.classList.add("resizing");

  function onMove(ev) {
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    resizePanels(clientX);
  }
  function onEnd() {
    layout.classList.remove("resizing");
    panelResizer.classList.remove("resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);
  document.addEventListener("touchmove", onMove);
  document.addEventListener("touchend", onEnd);
}

panelResizer.addEventListener("mousedown", startResize);
panelResizer.addEventListener("touchstart", startResize);
panelResizer.addEventListener("keydown", e => {
  const step = 20;
  const viewerRect = viewerPanel.getBoundingClientRect();
  if (e.key === "ArrowLeft") resizePanels(viewerRect.right - step);
  else if (e.key === "ArrowRight") resizePanels(viewerRect.right + step);
});

// ── Upload ────────────────────────────────────────────────────────────────────
dropzone.addEventListener("dragover",  e => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", ()  => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  handleFile(e.dataTransfer.files[0]);
});
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
fileInput.addEventListener("change", e => handleFile(e.target.files[0]));

async function handleFile(file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["pdf", "docx", "txt"].includes(ext)) {
    setStatus(`Unsupported type: .${ext}. Use PDF, DOCX, or TXT.`, "error");
    return;
  }

  setStatus("Uploading and indexing… this may take a moment.", "info");
  sendBtn.disabled = true;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res  = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed.");
    setStatus(`Indexed ${data.chunk_count} chunks from "${data.filename}".`, "success");
    addToSelector(data.filename);
    showActiveDocument(data.filename);
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    sendBtn.disabled = false;
    fileInput.value = "";
  }
}

async function showActiveDocument(filename) {
  currentViewerFilename = filename;
  currentPdfDoc = null;
  currentRawText = null;

  if (!filename) {
    viewerContent.innerHTML = '<p class="placeholder">Upload a document to preview it here.</p>';
    return;
  }

  const ext = filename.split(".").pop().toLowerCase();
  const url = `${API_BASE}/documents/${encodeURIComponent(filename)}/file`;

  if (ext === "pdf") {
    viewerContent.innerHTML = `
      <div class="pdf-nav">
        <button id="prevPageBtn" class="btn-page" type="button">&lsaquo;</button>
        <span class="pdf-nav-label">Page</span>
        <input id="pageInput" class="page-input" type="number" min="1" inputmode="numeric" aria-label="Go to page" />
        <span class="pdf-nav-label" id="pageTotalLabel"></span>
        <button id="nextPageBtn" class="btn-page" type="button">&rsaquo;</button>
      </div>
      <div class="pdf-page-wrap">
        <canvas id="pdfCanvas"></canvas>
        <div id="pdfTextLayer" class="textLayer"></div>
      </div>`;
    document.getElementById("prevPageBtn").addEventListener("click", () => renderPdfPage(currentPdfPageNum - 1));
    document.getElementById("nextPageBtn").addEventListener("click", () => renderPdfPage(currentPdfPageNum + 1));
    const pageInput = document.getElementById("pageInput");
    const jumpToTypedPage = () => {
      const target = parseInt(pageInput.value, 10);
      if (Number.isNaN(target)) {
        pageInput.value = currentPdfPageNum;
        return;
      }
      renderPdfPage(target);
    };
    pageInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); jumpToTypedPage(); pageInput.blur(); }
    });
    pageInput.addEventListener("blur", jumpToTypedPage);
    try {
      currentPdfDoc = await getDocument(url).promise;
      pageInput.max = currentPdfDoc.numPages;
      await renderPdfPage(1);
    } catch (err) {
      viewerContent.innerHTML = `<p class="placeholder">Couldn't load preview: ${escapeHtml(err.message)}</p>`;
    }
  } else {
    try {
      const res = await fetch(url);
      currentRawText = await res.text();
      viewerContent.innerHTML = '<pre id="textViewer" class="text-viewer"></pre>';
      document.getElementById("textViewer").textContent = currentRawText;
    } catch (err) {
      viewerContent.innerHTML = `<p class="placeholder">Couldn't load preview: ${escapeHtml(err.message)}</p>`;
    }
  }
}

async function renderPdfPage(pageNum, highlightExcerpt = null) {
  if (!currentPdfDoc) return;
  pageNum = Math.min(Math.max(pageNum, 1), currentPdfDoc.numPages);
  currentPdfPageNum = pageNum;
  document.getElementById("pageInput").value = pageNum;
  document.getElementById("pageTotalLabel").textContent = `of ${currentPdfDoc.numPages}`;

  const page = await currentPdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.3 });

  const canvas = document.getElementById("pdfCanvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const wrap = document.querySelector(".pdf-page-wrap");
  wrap.style.width = `${viewport.width}px`;
  wrap.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

  const textLayerDiv = document.getElementById("pdfTextLayer");
  textLayerDiv.innerHTML = "";
  textLayerDiv.style.setProperty("--scale-factor", viewport.scale);
  const textContent = await page.getTextContent();
  const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
  await textLayer.render();

  if (highlightExcerpt) {
    highlightInPdfTextLayer(textLayerDiv, textContent, highlightExcerpt);
  }
}

// Collapses whitespace AND invisible formatting characters (zero-width space/
// joiners, BOM) that PDF exporters often glue onto bullet markers — these show
// up in server-extracted excerpt text but not in pdf.js's own text extraction,
// so they must be stripped for the two to line up. Returns a mapping from each
// normalized-string index back to its index in the original `text`, so a match
// found in the normalized string can be located in the original.
const INVISIBLE_OR_WHITESPACE = new RegExp("[\\s\\u200B\\u200C\\u200D\\uFEFF]");

function buildNormalizedMap(text) {
  let norm = "";
  const map = []; // map[normIndex] = index into `text`
  let inGap = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (INVISIBLE_OR_WHITESPACE.test(ch)) {
      if (!inGap) {
        norm += " ";
        map.push(i);
        inGap = true;
      }
    } else {
      norm += ch;
      map.push(i);
      inGap = false;
    }
  }
  return { norm, map };
}

function normalizeWhitespace(str) {
  return buildNormalizedMap(str).norm.trim();
}

function highlightInPdfTextLayer(container, textContent, excerpt) {
  const items = textContent.items;
  let joined = "";
  const itemRanges = []; // itemRanges[i] = {start, end} within `joined` for items[i]
  for (const item of items) {
    const start = joined.length;
    joined += item.str;
    itemRanges.push({ start, end: joined.length });
    // Only insert a break at an actual line boundary. Items are sometimes split
    // sub-word (e.g. a "fi" ligature glyph split from the rest of "field") with
    // no real space between them — unconditionally inserting one there would
    // corrupt the word and break the excerpt match.
    if (item.hasEOL) joined += "\n";
  }

  const { norm, map } = buildNormalizedMap(joined);
  const anchor = normalizeWhitespace(excerpt).slice(0, 120);
  if (!anchor) return;
  const normIdx = norm.indexOf(anchor);
  if (normIdx === -1) return; // no match on this page — leave unhighlighted, not an error
  const rawStart = map[normIdx];
  const rawEnd = map[normIdx + anchor.length - 1] + 1;

  const spans = container.querySelectorAll("span");
  let firstMatch = null;
  itemRanges.forEach((range, i) => {
    if (range.end > rawStart && range.start < rawEnd) {
      const span = spans[i];
      if (span) {
        span.classList.add("chunk-highlight");
        if (!firstMatch) firstMatch = span;
      }
    }
  });
  if (firstMatch) {
    firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function highlightInText(rawText, excerpt) {
  const { norm, map } = buildNormalizedMap(rawText);
  const anchor = normalizeWhitespace(excerpt).slice(0, 120);
  if (!anchor) return null;
  const idx = norm.indexOf(anchor);
  if (idx === -1) return null;
  return { start: map[idx], end: map[idx + anchor.length - 1] + 1 };
}

function renderTextViewer(rawText, highlightExcerpt = null) {
  const textViewer = document.getElementById("textViewer");
  if (!textViewer) return;

  if (!highlightExcerpt) {
    textViewer.textContent = rawText;
    return;
  }
  const range = highlightInText(rawText, highlightExcerpt);
  if (!range) {
    textViewer.textContent = rawText;
    return;
  }
  textViewer.innerHTML =
    escapeHtml(rawText.slice(0, range.start)) +
    `<mark class="chunk-highlight" id="chunkHighlight">${escapeHtml(rawText.slice(range.start, range.end))}</mark>` +
    escapeHtml(rawText.slice(range.end));
  document.getElementById("chunkHighlight").scrollIntoView({ block: "center", behavior: "smooth" });
}

function navigateViewerTo(source, page, excerpt) {
  if (source !== currentViewerFilename) return;  // ignore citations for a different doc
  if (currentPdfDoc) {
    if (!page) return;                            // PDFs need a page to know where to render
    renderPdfPage(page, excerpt);
  } else if (currentRawText !== null) {
    if (!excerpt) return;                         // TXT/DOCX have no page concept (always 0)
    renderTextViewer(currentRawText, excerpt);
  }
}

function addToSelector(filename) {
  if (![...docSelect.options].some(o => o.value === filename)) {
    const opt = new Option(filename, filename);
    docSelect.appendChild(opt);
  }
  docSelect.value = filename;
  deleteBtn.disabled = false;
}

function setStatus(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = `status-bar ${type}`;
}

// ── Document selector & delete ────────────────────────────────────────────────
docSelect.addEventListener("change", () => {
  deleteBtn.disabled = !docSelect.value;
  showActiveDocument(docSelect.value || null);
});

deleteBtn.addEventListener("click", async () => {
  const filename = docSelect.value;
  if (!filename) return;
  if (!confirm(`Delete "${filename}" from the index?`)) return;

  try {
    const res  = await fetch(`${API_BASE}/documents/${encodeURIComponent(filename)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Delete failed.");
    [...docSelect.options].find(o => o.value === filename)?.remove();
    docSelect.value = "";
    deleteBtn.disabled = true;
    setStatus(`Deleted "${filename}".`, "success");
    showActiveDocument(null);
  } catch (err) {
    setStatus(`Delete failed: ${err.message}`, "error");
  }
});

// ── Query ─────────────────────────────────────────────────────────────────────
sendBtn.addEventListener("click", sendMessage);
questionInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

chatHistory.addEventListener("click", e => {
  const li = e.target.closest(".citations li");
  if (!li) return;
  navigateViewerTo(li.dataset.source, Number(li.dataset.page), li.dataset.excerpt);
});

async function sendMessage() {
  const question = questionInput.value.trim();
  if (!question) return;
  questionInput.value = "";

  appendBubble("user", question, []);
  const pendingId = appendBubble("assistant", "Thinking…", [], "pending");

  const body = { question };
  if (docSelect.value) body.filename = docSelect.value;

  try {
    const res  = await fetch(`${API_BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Query failed.");
    updateBubble(pendingId, data.answer, data.citations);
    navigateViewerTo(data.citations?.[0]?.source, data.citations?.[0]?.page, data.citations?.[0]?.excerpt);
  } catch (err) {
    updateBubble(pendingId, `Error: ${err.message}`, []);
  }
}

let bubbleCounter = 0;

function appendBubble(role, text, citations, extraClass = "") {
  const id = `bubble-${bubbleCounter++}`;
  const div = document.createElement("div");
  div.id = id;
  div.className = `bubble ${role} ${extraClass}`.trim();
  div.innerHTML = buildBubbleHTML(text, citations);
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return id;
}

function updateBubble(id, text, citations) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("pending");
  el.innerHTML = buildBubbleHTML(text, citations);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function buildBubbleHTML(text, citations) {
  const textHTML = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  return textHTML + renderCitations(citations);
}

function renderCitations(citations) {
  if (!citations || citations.length === 0) return "";
  const items = citations.map(c => {
    const loc = c.page ? `Page ${c.page}` : "No page info";
    return `<li data-source="${escapeHtml(c.source)}" data-page="${c.page || 0}" data-excerpt="${escapeHtml(c.excerpt)}">
      <strong>${escapeHtml(c.source)}</strong> — ${loc} (chunk&nbsp;${c.chunk_index})
      <em>${escapeHtml(c.excerpt)}</em>
    </li>`;
  }).join("");
  return `<details class="citations">
    <summary>Sources (${citations.length})</summary>
    <ul>${items}</ul>
  </details>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Load existing documents on page start ─────────────────────────────────────
async function loadDocuments() {
  try {
    const res  = await fetch(`${API_BASE}/documents`);
    if (!res.ok) return;
    const data = await res.json();
    data.documents.forEach(d => {
      if (![...docSelect.options].some(o => o.value === d.filename)) {
        docSelect.appendChild(new Option(d.filename, d.filename));
      }
    });
  } catch (_) {
    // Backend not running yet — silent fail
  }
}

document.addEventListener("DOMContentLoaded", loadDocuments);
