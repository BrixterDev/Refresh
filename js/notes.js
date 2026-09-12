import { toast, formatDateTime, debounce, escapeHtml } from "./ui.js";

let sb, currentUser, onChange = () => {};
let quill = null;
let notesCache = [];
let activeNoteId = null;
let currentMode = "edit"; // "edit" | "view"

// Track "dirty" state so we know if a manual save is needed.
let titleDirty = false;
let contentDirty = false;

// Keep a reference to the last-known clean values, for beforeunload flush.
let lastSavedTitle = "";
let lastSavedDelta = { ops: [] };
let lastSavedHtml = "";

// Pending autosave timers (stored so we can flush on unload)
let pendingSaveTimer = null;

export function initNotes(supabase, user, opts = {}) {
  sb = supabase;
  currentUser = user;
  onChange = opts.onChange || (() => {});

  quill = new Quill("#quill-editor", {
    theme: "snow",
    placeholder: "Start writing — this saves automatically as you type…",
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ["bold", "italic", "underline"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["blockquote", "code-block"],
        ["clean"],
      ],
    },
  });

  const saveStatus = document.getElementById("note-save-status");
  const titleInput = document.getElementById("note-title-input");
  const saveBtn = document.getElementById("save-note-btn");
  const editModeBtn = document.getElementById("mode-edit-btn");
  const viewModeBtn = document.getElementById("mode-view-btn");

  // ---- Autosave content (debounced) ----
  const debouncedContentSave = debounce(() => saveContent(), 600);

  quill.on("text-change", (_delta, _old, source) => {
    if (source !== "user") return;
    contentDirty = true;
    setStatus("Saving…", "saving");
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(() => saveContent(), 600);
    debouncedContentSave();
  });

  // ---- Autosave title (debounced) ----
  const debouncedTitleSave = debounce(() => saveTitle(), 500);
  titleInput.addEventListener("input", () => {
    titleDirty = true;
    setStatus("Saving…", "saving");
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(() => saveTitle(), 500);
    debouncedTitleSave();
  });

  // Also commit title on blur / Enter so it never lingers unsaved.
  titleInput.addEventListener("blur", () => { if (titleDirty) saveTitle(); });
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); titleInput.blur(); }
  });

  // ---- Manual save button ----
  saveBtn.addEventListener("click", async () => {
    await flushSave();
    toast("Note saved.", "success");
  });

  // ---- Mode toggle ----
  editModeBtn.addEventListener("click", () => setMode("edit"));
  viewModeBtn.addEventListener("click", () => setMode("view"));

  document.getElementById("new-note-btn").addEventListener("click", createNote);
  document.getElementById("delete-note-btn").addEventListener("click", deleteActiveNote);

  // ---- Flush pending saves before leaving the page ----
  window.addEventListener("beforeunload", (e) => {
    if (contentDirty || titleDirty) {
      // Best-effort synchronous-ish flush; keepalive helps the request survive.
      flushSave({ keepalive: true });
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Also flush when the tab is hidden (mobile / tab switch).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && (contentDirty || titleDirty)) {
      flushSave();
    }
  });

  loadNotes();
}

// =========================================================
// Save helpers
// =========================================================
function setStatus(text, kind = "") {
  const el = document.getElementById("note-save-status");
  el.textContent = text;
  el.classList.remove("saving", "saved", "error");
  if (kind) el.classList.add(kind);
}

async function saveTitle() {
  if (!activeNoteId || !titleDirty) return;
  const titleInput = document.getElementById("note-title-input");
  const title = titleInput.value.trim() || "Untitled note";
  const { error } = await sb.from("notes").update({ title }).eq("id", activeNoteId);
  if (error) {
    setStatus("Couldn't save title", "error");
    return;
  }
  titleDirty = false;
  lastSavedTitle = title;
  const cached = notesCache.find((n) => n.id === activeNoteId);
  if (cached) cached.title = title;
  renderNotesList();
  onChange();
  if (!contentDirty) setStatus("All changes saved", "saved");
}

async function saveContent() {
  if (!activeNoteId || !contentDirty) return;
  const delta = quill.getContents();
  const html = document.querySelector("#quill-editor .ql-editor").innerHTML;
  const { error } = await sb.from("notes")
    .update({ content_delta: delta, content_html: html })
    .eq("id", activeNoteId);
  if (error) {
    setStatus("Couldn't save — check your connection", "error");
    return;
  }
  contentDirty = false;
  lastSavedDelta = delta;
  lastSavedHtml = html;
  const cached = notesCache.find((n) => n.id === activeNoteId);
  if (cached) { cached.content_html = html; cached.content_delta = delta; }
  renderNotesList();
  onChange();
  if (!titleDirty) setStatus("All changes saved", "saved");
}

// Flush any pending dirty state right now.
async function flushSave(opts = {}) {
  clearTimeout(pendingSaveTimer);
  if (titleDirty) await saveTitle();
  if (contentDirty) await saveContent();
}

// =========================================================
// Mode (edit / view)
// =========================================================
function setMode(mode) {
  currentMode = mode;
  const editWrap = document.getElementById("editor-edit-wrap");
  const viewWrap = document.getElementById("editor-view-wrap");
  const editBtn = document.getElementById("mode-edit-btn");
  const viewBtn = document.getElementById("mode-view-btn");
  const titleInput = document.getElementById("note-title-input");
  const saveBtn = document.getElementById("save-note-btn");

  const isEdit = mode === "edit";
  editWrap.style.display = isEdit ? "block" : "none";
  viewWrap.style.display = isEdit ? "none" : "block";
  editBtn.classList.toggle("active", isEdit);
  viewBtn.classList.toggle("active", !isEdit);

  // In view mode, lock the title and hide the save button.
  titleInput.readOnly = !isEdit;
  saveBtn.style.display = isEdit ? "inline-flex" : "none";

  if (!isEdit) {
    const html = document.querySelector("#quill-editor .ql-editor").innerHTML;
    const rendered = document.getElementById("note-rendered");
    rendered.innerHTML = html || `<p style="color:#7a7256;">This note is empty.</p>`;
  }
}

// =========================================================
// Load / render list
// =========================================================
async function loadNotes() {
  const { data, error } = await sb.from("notes").select("*").order("updated_at", { ascending: false });
  if (error) {
    document.getElementById("notes-list").innerHTML = `<p style="font-size:13px;color:var(--text-dim);">Couldn't load your notes.</p>`;
    return;
  }
  notesCache = data || [];
  renderNotesList();

  if (notesCache.length > 0 && !activeNoteId) {
    openNote(notesCache[0].id);
  } else if (notesCache.length === 0) {
    document.getElementById("editor-panel").style.display = "none";
  }
}

function renderNotesList() {
  const list = document.getElementById("notes-list");

  if (notesCache.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No notes yet</h3>
        <p>Jot down what your professor emphasized while it's still fresh — it's saved as you type.</p>
      </div>`;
    return;
  }

  list.innerHTML = notesCache.map((note) => {
    const snippet = (note.content_html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return `
      <div class="note-item ${note.id === activeNoteId ? "active" : ""}" data-id="${note.id}">
        <h4>${escapeHtml(note.title)}</h4>
        <div class="snippet">${escapeHtml(snippet) || "Empty note"}</div>
        <span class="date">${formatDateTime(note.updated_at)}</span>
      </div>`;
  }).join("");

  list.querySelectorAll(".note-item").forEach((item) => {
    item.addEventListener("click", () => openNote(item.dataset.id));
  });
}

// =========================================================
// Open / create / delete
// =========================================================
async function openNote(id) {
  // Flush the currently active note before switching away.
  if (activeNoteId && activeNoteId !== id && (titleDirty || contentDirty)) {
    await flushSave();
  }

  const note = notesCache.find((n) => n.id === id);
  if (!note) return;

  activeNoteId = id;
  titleDirty = false;
  contentDirty = false;

  document.getElementById("editor-panel").style.display = "block";
  const titleInput = document.getElementById("note-title-input");
  titleInput.value = note.title === "Untitled note" ? "" : note.title;
  titleInput.placeholder = "Untitled note";

  const delta = (note.content_delta && Object.keys(note.content_delta).length)
    ? note.content_delta
    : { ops: [] };
  quill.setContents(delta, "silent");

  lastSavedTitle = note.title;
  lastSavedDelta = delta;
  lastSavedHtml = note.content_html || "";

  setStatus("All changes saved", "saved");
  setMode("edit");
  renderNotesList();
}

async function createNote() {
  // Save current one first so we don't lose anything.
  if (activeNoteId && (titleDirty || contentDirty)) await flushSave();

  const { data, error } = await sb.from("notes").insert({
    user_id: currentUser.id,
    title: "Untitled note",
    content_delta: { ops: [] },
    content_html: "",
  }).select().single();

  if (error) {
    toast("Couldn't create a new note.", "error");
    return;
  }
  notesCache.unshift(data);
  openNote(data.id);
  onChange();
  document.getElementById("note-title-input").focus();
}

async function deleteActiveNote() {
  if (!activeNoteId) return;
  if (!confirm("Delete this note? This can't be undone.")) return;

  const { error } = await sb.from("notes").delete().eq("id", activeNoteId);
  if (error) {
    toast("Couldn't delete this note.", "error");
    return;
  }
  notesCache = notesCache.filter((n) => n.id !== activeNoteId);
  activeNoteId = null;
  titleDirty = false;
  contentDirty = false;
  toast("Note deleted.", "success");
  onChange();

  if (notesCache.length > 0) {
    openNote(notesCache[0].id);
  } else {
    document.getElementById("editor-panel").style.display = "none";
    renderNotesList();
  }
}
