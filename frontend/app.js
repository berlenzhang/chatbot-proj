const API_BASE = "http://localhost:8000";

// ── Element refs ──────────────────────────────────────────────────────────────
const dropzone      = document.getElementById("dropzone");
const fileInput     = document.getElementById("fileInput");
const statusBar     = document.getElementById("uploadStatus");
const summaryDiv    = document.getElementById("summaryContent");
const docSelect     = document.getElementById("docSelect");
const deleteBtn     = document.getElementById("deleteBtn");
const chatHistory   = document.getElementById("chatHistory");
const questionInput = document.getElementById("questionInput");
const sendBtn       = document.getElementById("sendBtn");

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
    renderSummary(data.summary);
    addToSelector(data.filename);
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    sendBtn.disabled = false;
    fileInput.value = "";
  }
}

function renderSummary(text) {
  summaryDiv.innerHTML = text
    .split(/\n+/)
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join("");
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
    summaryDiv.innerHTML = '<p class="placeholder">Upload a document to see its summary here.</p>';
  } catch (err) {
    setStatus(`Delete failed: ${err.message}`, "error");
  }
});

// ── Query ─────────────────────────────────────────────────────────────────────
sendBtn.addEventListener("click", sendMessage);
questionInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
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
    return `<li>
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
