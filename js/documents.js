import { toast, formatDate, formatBytes, escapeHtml } from "./ui.js";
import { BUCKETS } from "./config.js";

let sb, currentUser, onChange = () => {};
let selectedFile = null;
let currentColor = "amber";

// state for whichever document is open in the viewer
let activeDoc = null;
let activeHighlights = [];
let activeRawText = null; // for txt/md documents

const DOC_ICON = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2.5h8l5 5V20a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 20V4A1.5 1.5 0 016 2.5z"/><path d="M14 2.5V8h5"/></svg>`;

export function initDocuments(supabase, user, opts = {}) {
  sb = supabase;
  currentUser = user;
  onChange = opts.onChange || (() => {});

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  wireUploadModal();
  wireHighlightToolbar();
  loadDocuments();
}

// =========================================================
// Upload
// =========================================================
function wireUploadModal() {
  const openBtn = document.getElementById("open-doc-upload");
  const modal = document.getElementById("doc-upload-modal");
  const dropzone = document.getElementById("doc-dropzone");
  const fileInput = document.getElementById("doc-file-input");
  const submitBtn = document.getElementById("doc-upload-submit");
  const titleField = document.getElementById("doc-title-field");
  const subjectField = document.getElementById("doc-subject-field");
  const progressEl = document.getElementById("doc-upload-progress");

  openBtn.addEventListener("click", () => {
    resetForm();
    modal.style.display = "flex";
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "txt", "md"].includes(ext)) {
      toast("Please choose a PDF, TXT, or Markdown file.", "error");
      return;
    }
    selectedFile = file;
    dropzone.querySelector("div").textContent = file.name;
    if (!titleField.value) titleField.value = file.name.replace(/\.[^/.]+$/, "");
    submitBtn.disabled = false;
    submitBtn.textContent = "Upload document";
  }

  function resetForm() {
    selectedFile = null;
    fileInput.value = "";
    titleField.value = "";
    subjectField.value = "";
    progressEl.innerHTML = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Choose a file first";
    dropzone.querySelector("div").textContent = "Drop a PDF, TXT, or Markdown file here";
  }

  submitBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    progressEl.innerHTML = `
      <div class="upload-row"><span class="name">${escapeHtml(selectedFile.name)}</span></div>
      <div class="progress-track"><div class="progress-fill" id="doc-progress-fill"></div></div>
    `;

    try {
      const ext = selectedFile.name.split(".").pop().toLowerCase();
      const path = `${currentUser.id}/${Date.now()}-${sanitizeFilename(selectedFile.name)}`;

      const { error: uploadError } = await sb.storage
        .from(BUCKETS.documents)
        .upload(path, selectedFile, { upsert: false });
      if (uploadError) throw uploadError;

      document.getElementById("doc-progress-fill").style.width = "100%";

      let pageCount = null;
      if (ext === "pdf" && window.pdfjsLib) {
        try {
          const buf = await selectedFile.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
          pageCount = pdf.numPages;
        } catch (_) { /* best effort */ }
      }

      const { error: insertError } = await sb.from("documents").insert({
        user_id: currentUser.id,
        title: titleField.value.trim() || selectedFile.name,
        subject: subjectField.value.trim() || null,
        storage_path: path,
        file_name: selectedFile.name,
        file_type: ext,
        file_size: selectedFile.size,
        page_count: pageCount,
      });
      if (insertError) throw insertError;

      toast("Document uploaded.", "success");
      document.getElementById("doc-upload-modal").style.display = "none";
      loadDocuments();
      onChange();
    } catch (err) {
      console.error(err);
      toast(err.message || "Upload failed. Please try again.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload document";
    }
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// =========================================================
// Listing
// =========================================================
async function loadDocuments() {
  const grid = document.getElementById("documents-grid");
  const { data, error } = await sb.from("documents").select("*").order("uploaded_at", { ascending: false });

  if (error) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>Couldn't load your documents: ${escapeHtml(error.message)}</p></div>`;
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <h3>No documents yet</h3>
        <p>Upload a reviewer or handout — you'll be able to highlight the passages that matter as you go through it.</p>
        <button class="btn btn-primary" onclick="document.getElementById('open-doc-upload').click()">Upload a document</button>
      </div>`;
    return;
  }

  grid.innerHTML = data.map((doc) => `
    <div class="card" data-id="${doc.id}">
      <div class="card-media" data-action="open">
        ${DOC_ICON}
      </div>
      <div class="card-body">
        <div class="card-title-row">
          <div class="card-title" data-role="title-display">${escapeHtml(doc.title)}</div>
          <button class="icon-btn" data-action="edit-title" title="Rename">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/></svg>
          </button>
        </div>
        <div class="card-meta">
          <span>${formatDate(doc.uploaded_at)}</span>
          <span class="dot">·</span>
          <span>${doc.file_type.toUpperCase()}</span>
          <span class="dot">·</span>
          <span>${formatBytes(doc.file_size)}</span>
          ${doc.page_count ? `<span class="dot">·</span><span>${doc.page_count}p</span>` : ""}
        </div>
        ${doc.subject ? `<div class="card-tags"><span class="tag">${escapeHtml(doc.subject)}</span></div>` : ""}
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm" data-action="open" style="flex:1;">Open &amp; highlight</button>
          <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
        </div>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll(".card").forEach((card) => {
    const id = card.dataset.id;
    const doc = data.find((d) => d.id === id);
    card.querySelectorAll('[data-action="open"]').forEach((el) => el.addEventListener("click", () => openDocument(doc)));
    card.querySelector('[data-action="edit-title"]').addEventListener("click", () => beginTitleEdit(card, doc));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteDocument(doc));
  });
}

function beginTitleEdit(card, doc) {
  const row = card.querySelector(".card-title-row");
  const display = row.querySelector('[data-role="title-display"]');
  const input = document.createElement("input");
  input.type = "text";
  input.className = "card-title-input";
  input.value = doc.title;
  display.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== doc.title) {
      const { error } = await sb.from("documents").update({ title: newTitle }).eq("id", doc.id);
      if (!error) { doc.title = newTitle; toast("Title updated.", "success"); onChange(); }
      else toast("Couldn't save the new title.", "error");
    }
    const newDisplay = document.createElement("div");
    newDisplay.className = "card-title";
    newDisplay.dataset.role = "title-display";
    newDisplay.textContent = doc.title;
    input.replaceWith(newDisplay);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = doc.title; input.blur(); }
  });
  input.addEventListener("blur", commit, { once: true });
}

async function deleteDocument(doc) {
  if (!confirm(`Remove "${doc.title}" from your binder? Highlights on it will be removed too.`)) return;
  const { error: storageError } = await sb.storage.from(BUCKETS.documents).remove([doc.storage_path]);
  const { error: dbError } = await sb.from("documents").delete().eq("id", doc.id);
  if (dbError) { toast("Couldn't delete this document.", "error"); return; }
  toast("Document removed.", "success");
  loadDocuments();
  onChange();
  if (storageError) console.warn("Storage cleanup issue:", storageError.message);
}

// =========================================================
// Viewer + highlighting
// =========================================================
function wireHighlightToolbar() {
  document.querySelectorAll("#hl-swatches .hl-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      document.querySelectorAll("#hl-swatches .hl-swatch").forEach((s) => s.classList.remove("active"));
      sw.classList.add("active");
      currentColor = sw.dataset.color;
    });
  });

  document.getElementById("doc-viewer-modal").addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]")) {
      activeDoc = null;
      activeHighlights = [];
      document.getElementById("viewer-page-area").innerHTML = "";
    }
  });
}

async function openDocument(doc) {
  activeDoc = doc;
  document.getElementById("viewer-title").textContent = doc.title;
  document.getElementById("doc-viewer-modal").style.display = "flex";
  const pageArea = document.getElementById("viewer-page-area");
  pageArea.innerHTML = `<p style="color:#7a7256; font-family:var(--font-ui); padding:20px;">Loading…</p>`;

  const [{ data: urlData, error: urlError }, { data: highlights, error: hlError }] = await Promise.all([
    sb.storage.from(BUCKETS.documents).createSignedUrl(doc.storage_path, 3600),
    sb.from("highlights").select("*").eq("document_id", doc.id).order("created_at", { ascending: true }),
  ]);

  if (urlError) {
    pageArea.innerHTML = `<p style="padding:20px;">Couldn't open this file.</p>`;
    return;
  }
  activeHighlights = highlights || [];
  renderHighlightList();

  if (doc.file_type === "pdf") {
    await renderPdf(pageArea, urlData.signedUrl);
  } else {
    const res = await fetch(urlData.signedUrl);
    activeRawText = await res.text();
    renderTextDocument(pageArea);
  }

  wireSelectionPopover(pageArea);
}

// ---------- PDF rendering ----------
async function renderPdf(container, url) {
  container.innerHTML = "";
  const pdf = await window.pdfjsLib.getDocument(url).promise;
  const targetWidth = Math.min(container.clientWidth - 20, 760);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const pageDiv = document.createElement("div");
    pageDiv.className = "pdf-page";
    pageDiv.dataset.page = String(pageNum);
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = "block";
    pageDiv.appendChild(canvas);

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.position = "absolute";
    textLayerDiv.style.left = "0";
    textLayerDiv.style.top = "0";
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    textLayerDiv.style.opacity = "1";
    pageDiv.appendChild(textLayerDiv);

    const textContent = await page.getTextContent();
    window.pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
      textDivs: [],
    });

    const overlayLayer = document.createElement("div");
    overlayLayer.className = "hl-overlay-layer";
    overlayLayer.style.position = "absolute";
    overlayLayer.style.left = "0";
    overlayLayer.style.top = "0";
    overlayLayer.style.width = "100%";
    overlayLayer.style.height = "100%";
    overlayLayer.style.pointerEvents = "none";
    pageDiv.appendChild(overlayLayer);

    container.appendChild(pageDiv);

    drawOverlaysForPage(pageDiv, pageNum);
  }
}

function drawOverlaysForPage(pageDiv, pageNum) {
  const overlayLayer = pageDiv.querySelector(".hl-overlay-layer");
  overlayLayer.innerHTML = "";
  const w = pageDiv.clientWidth, h = pageDiv.clientHeight;

  activeHighlights
    .filter((hl) => hl.page_number === pageNum)
    .forEach((hl) => {
      (hl.anchor.rects || []).forEach((r) => {
        const rectEl = document.createElement("div");
        rectEl.className = "hl-overlay-rect";
        rectEl.style.left = `${r.xFrac * w}px`;
        rectEl.style.top = `${r.yFrac * h}px`;
        rectEl.style.width = `${r.wFrac * w}px`;
        rectEl.style.height = `${r.hFrac * h}px`;
        rectEl.style.background = colorVar(hl.color);
        rectEl.style.pointerEvents = "auto";
        rectEl.title = "Click to remove this highlight";
        rectEl.addEventListener("click", () => removeHighlight(hl.id));
        overlayLayer.appendChild(rectEl);
      });
    });
}

function redrawAllPdfOverlays(container) {
  container.querySelectorAll(".pdf-page").forEach((pageDiv) => {
    drawOverlaysForPage(pageDiv, Number(pageDiv.dataset.page));
  });
}

// ---------- Plain text / markdown rendering ----------
function renderTextDocument(container) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "text-doc";

  const sorted = [...activeHighlights].sort((a, b) => a.anchor.start - b.anchor.start);
  let html = "";
  let cursor = 0;
  sorted.forEach((hl) => {
    const { start, end } = hl.anchor;
    if (start < cursor) return; // skip overlapping, keeps renderer simple & robust
    html += escapeHtml(activeRawText.slice(cursor, start));
    html += `<mark class="user-hl" data-color="${hl.color}" data-id="${hl.id}">${escapeHtml(activeRawText.slice(start, end))}</mark>`;
    cursor = end;
  });
  html += escapeHtml(activeRawText.slice(cursor));
  wrap.innerHTML = html;

  wrap.querySelectorAll("mark.user-hl").forEach((mark) => {
    mark.addEventListener("click", () => removeHighlight(mark.dataset.id));
    mark.title = "Click to remove this highlight";
  });

  container.appendChild(wrap);
}

function colorVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--hl-${name}`).trim() || "#E8B84B";
}

// ---------- Selection → highlight ----------
function wireSelectionPopover(pageArea) {
  pageArea.addEventListener("mouseup", () => {
    const existing = document.querySelector(".selection-popover");
    if (existing) existing.remove();

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!pageArea.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().trim();
    if (!text) return;

    const rect = range.getBoundingClientRect();
    const areaRect = pageArea.getBoundingClientRect();

    const popover = document.createElement("div");
    popover.className = "selection-popover";
    popover.style.left = `${rect.left - areaRect.left + pageArea.scrollLeft}px`;
    popover.style.top = `${rect.top - areaRect.top + pageArea.scrollTop - 42}px`;
    popover.innerHTML = ["amber", "mint", "sky", "brick"]
      .map((c) => `<div class="hl-swatch${c === currentColor ? " active" : ""}" data-color="${c}"></div>`)
      .join("");
    pageArea.appendChild(popover);

    popover.querySelectorAll(".hl-swatch").forEach((sw) => {
      sw.addEventListener("mousedown", async (e) => {
        e.preventDefault(); // keep selection alive until we've read it
        const color = sw.dataset.color;
        await createHighlightFromSelection(range, text, color, pageArea);
        popover.remove();
        selection.removeAllRanges();
      });
    });
  });

  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".selection-popover")) {
      const existing = document.querySelector(".selection-popover");
      if (existing && !pageArea.contains(e.target)) existing.remove();
    }
  });
}

async function createHighlightFromSelection(range, text, color, pageArea) {
  if (!activeDoc) return;

  let anchor, pageNumber = 1;

  if (activeDoc.file_type === "pdf") {
    const pageDiv = range.commonAncestorContainer.parentElement?.closest(".pdf-page")
      || range.startContainer.parentElement?.closest(".pdf-page");
    if (!pageDiv) { toast("Select text within a single page.", "error"); return; }
    pageNumber = Number(pageDiv.dataset.page);
    const pageRect = pageDiv.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        xFrac: (r.left - pageRect.left) / pageRect.width,
        yFrac: (r.top - pageRect.top) / pageRect.height,
        wFrac: r.width / pageRect.width,
        hFrac: r.height / pageRect.height,
      }));
    if (rects.length === 0) return;
    anchor = { rects };
  } else {
    const wrap = pageArea.querySelector(".text-doc");
    const { start, end } = rangeToTextOffsets(wrap, range);
    anchor = { start, end };
  }

  const { data, error } = await sb
    .from("highlights")
    .insert({
      document_id: activeDoc.id,
      user_id: currentUser.id,
      page_number: pageNumber,
      color,
      selected_text: text.slice(0, 500),
      anchor,
    })
    .select()
    .single();

  if (error) {
    toast("Couldn't save that highlight.", "error");
    return;
  }

  activeHighlights.push(data);
  renderHighlightList();

  if (activeDoc.file_type === "pdf") {
    redrawAllPdfOverlays(pageArea);
  } else {
    renderTextDocument(pageArea);
    wireSelectionPopover(pageArea);
  }
}

function rangeToTextOffsets(container, range) {
  const full = container.textContent;
  const preStart = document.createRange();
  preStart.selectNodeContents(container);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

async function removeHighlight(id) {
  if (!confirm("Remove this highlight?")) return;
  const { error } = await sb.from("highlights").delete().eq("id", id);
  if (error) { toast("Couldn't remove the highlight.", "error"); return; }
  activeHighlights = activeHighlights.filter((h) => h.id !== id);
  renderHighlightList();

  const pageArea = document.getElementById("viewer-page-area");
  if (activeDoc?.file_type === "pdf") {
    redrawAllPdfOverlays(pageArea);
  } else {
    renderTextDocument(pageArea);
    wireSelectionPopover(pageArea);
  }
}

function renderHighlightList() {
  const list = document.getElementById("hl-list");
  if (activeHighlights.length === 0) {
    list.innerHTML = `<p style="font-size:12px; color:var(--text-faint);">Select any text in the document to highlight it.</p>`;
    return;
  }
  const sorted = [...activeHighlights].sort((a, b) => a.page_number - b.page_number);
  list.innerHTML = sorted.map((hl) => `
    <div class="hl-item" data-id="${hl.id}" style="border-left-color:${colorVar(hl.color)};">
      <span class="hl-quote">"${escapeHtml(hl.selected_text.slice(0, 90))}${hl.selected_text.length > 90 ? "…" : ""}"</span>
      <span class="hl-page">${activeDoc.file_type === "pdf" ? `Page ${hl.page_number}` : "In document"}</span>
    </div>
  `).join("");

  list.querySelectorAll(".hl-item").forEach((item) => {
    item.addEventListener("click", () => {
      const hl = activeHighlights.find((h) => h.id === item.dataset.id);
      if (!hl) return;
      const pageArea = document.getElementById("viewer-page-area");
      const target = activeDoc.file_type === "pdf"
        ? pageArea.querySelector(`.pdf-page[data-page="${hl.page_number}"]`)
        : pageArea.querySelector(`mark[data-id="${hl.id}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}
