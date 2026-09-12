import { toast, formatDateTime, debounce, escapeHtml } from "./ui.js";

let sb, currentUser, onChange = () => {};
let quill = null;
let notesCache = [];
let activeNoteId = null;

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
  const debouncedContentSave = debounce(async () => {
    if (!activeNoteId) return;
    saveStatus.textContent = "Saving…";
    const delta = quill.getContents();
    const html = document.querySelector("#quill-editor .ql-editor").innerHTML;
    const { error } = await sb.from("notes")
      .update({ content_delta: delta, content_html: html })
      .eq("id", activeNoteId);
    saveStatus.textContent = error ? "Couldn't save — check your connection" : "All changes saved";
    if (!error) {
      const cached = notesCache.find((n) => n.id === activeNoteId);
      if (cached) { cached.content_html = html; }
      renderNotesList();
      onChange();
    }
  }, 600);

  quill.on("text-change", (_delta, _old, source) => {
    if (source === "user") {
      saveStatus.textContent = "Saving…";
      debouncedContentSave();
    }
  });

  const titleInput = document.getElementById("note-title-input");
  const debouncedTitleSave = debounce(async () => {
    if (!activeNoteId) return;
    const title = titleInput.value.trim() || "Untitled note";
    const { error } = await sb.from("notes").update({ title }).eq("id", activeNoteId);
    if (!error) {
      const cached = notesCache.find((n) => n.id === activeNoteId);
      if (cached) cached.title = title;
      renderNotesList();
      onChange();
    }
  }, 500);
  titleInput.addEventListener("input", debouncedTitleSave);

  document.getElementById("new-note-btn").addEventListener("click", createNote);
  document.getElementById("delete-note-btn").addEventListener("click", deleteActiveNote);

  loadNotes();
}

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

function openNote(id) {
  const note = notesCache.find((n) => n.id === id);
  if (!note) return;
  activeNoteId = id;
  document.getElementById("editor-panel").style.display = "block";
  document.getElementById("note-title-input").value = note.title === "Untitled note" ? "" : note.title;
  document.getElementById("note-title-input").placeholder = "Untitled note";
  quill.setContents(note.content_delta && Object.keys(note.content_delta).length ? note.content_delta : { ops: [] });
  document.getElementById("note-save-status").textContent = "All changes saved";
  renderNotesList();
}

async function createNote() {
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
  toast("Note deleted.", "success");
  onChange();

  if (notesCache.length > 0) {
    openNote(notesCache[0].id);
  } else {
    document.getElementById("editor-panel").style.display = "none";
    renderNotesList();
  }
}
