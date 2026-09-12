import { toast, formatDate, formatBytes, formatDuration, escapeHtml } from "./ui.js";
import { BUCKETS } from "./config.js";

let sb, currentUser, onChange = () => {};
let selectedFile = null;

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 5.5v13l11-6.5z"/></svg>`;

export function initVideos(supabase, user, opts = {}) {
  sb = supabase;
  currentUser = user;
  onChange = opts.onChange || (() => {});

  wireUploadModal();
  loadVideos();
}

function wireUploadModal() {
  const openBtn = document.getElementById("open-video-upload");
  const modal = document.getElementById("video-upload-modal");
  const dropzone = document.getElementById("video-dropzone");
  const fileInput = document.getElementById("video-file-input");
  const submitBtn = document.getElementById("video-upload-submit");
  const titleField = document.getElementById("video-title-field");
  const subjectField = document.getElementById("video-subject-field");
  const progressEl = document.getElementById("video-upload-progress");

  openBtn.addEventListener("click", () => {
    resetUploadForm();
    modal.style.display = "flex";
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFileChosen(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFileChosen(fileInput.files[0]);
  });

  function handleFileChosen(file) {
    selectedFile = file;
    dropzone.querySelector("div").textContent = file.name;
    if (!titleField.value) {
      titleField.value = file.name.replace(/\.[^/.]+$/, "");
    }
    submitBtn.disabled = false;
    submitBtn.textContent = "Upload recording";
  }

  function resetUploadForm() {
    selectedFile = null;
    fileInput.value = "";
    titleField.value = "";
    subjectField.value = "";
    progressEl.innerHTML = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Choose a file first";
    dropzone.querySelector("div").textContent = "Drop a video file here, or click to browse";
  }

  submitBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";

    const rowId = crypto.randomUUID();
    progressEl.innerHTML = `
      <div class="upload-row">
        <span class="name">${escapeHtml(selectedFile.name)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="up-progress-fill"></div></div>
    `;

    try {
      const duration = await readVideoDuration(selectedFile).catch(() => null);
      const path = `${currentUser.id}/${Date.now()}-${sanitizeFilename(selectedFile.name)}`;

      const { error: uploadError } = await sb.storage
        .from(BUCKETS.videos)
        .upload(path, selectedFile, { upsert: false });

      if (uploadError) throw uploadError;

      document.getElementById("up-progress-fill").style.width = "100%";

      const { error: insertError } = await sb.from("lectures").insert({
        user_id: currentUser.id,
        title: titleField.value.trim() || selectedFile.name,
        subject: subjectField.value.trim() || null,
        storage_path: path,
        file_name: selectedFile.name,
        file_size: selectedFile.size,
        duration_seconds: duration,
      });

      if (insertError) throw insertError;

      toast("Lecture video uploaded.", "success");
      modal.style.display = "none";
      loadVideos();
      onChange();
    } catch (err) {
      console.error(err);
      toast(err.message || "Upload failed. Please try again.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload recording";
    }
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = reject;
    video.src = URL.createObjectURL(file);
  });
}

async function loadVideos() {
  const grid = document.getElementById("videos-grid");
  const { data, error } = await sb
    .from("lectures")
    .select("*")
    .order("uploaded_at", { ascending: false });

  if (error) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>Couldn't load your videos: ${escapeHtml(error.message)}</p></div>`;
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <h3>No lecture videos yet</h3>
        <p>Upload the recording from today's class and it'll show up here with the date you saved it.</p>
        <button class="btn btn-primary" onclick="document.getElementById('open-video-upload').click()">Upload a recording</button>
      </div>`;
    return;
  }

  grid.innerHTML = data.map((lecture) => `
    <div class="card" data-id="${lecture.id}">
      <div class="card-media" data-action="play">
        <div class="play-ring">${PLAY_ICON}</div>
      </div>
      <div class="card-body">
        <div class="card-title-row">
          <div class="card-title" data-role="title-display">${escapeHtml(lecture.title)}</div>
          <button class="icon-btn" data-action="edit-title" title="Rename">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/></svg>
          </button>
        </div>
        <div class="card-meta">
          <span>${formatDate(lecture.uploaded_at)}</span>
          <span class="dot">·</span>
          <span>${formatDuration(lecture.duration_seconds)}</span>
          <span class="dot">·</span>
          <span>${formatBytes(lecture.file_size)}</span>
        </div>
        ${lecture.subject ? `<div class="card-tags"><span class="tag">${escapeHtml(lecture.subject)}</span></div>` : ""}
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm" data-action="play" style="flex:1;">Play</button>
          <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
        </div>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll(".card").forEach((card) => {
    const id = card.dataset.id;
    const lecture = data.find((l) => l.id === id);

    card.querySelectorAll('[data-action="play"]').forEach((el) =>
      el.addEventListener("click", () => playVideo(lecture))
    );
    card.querySelector('[data-action="edit-title"]').addEventListener("click", () => beginTitleEdit(card, lecture));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteVideo(lecture));
  });
}

function beginTitleEdit(card, lecture) {
  const row = card.querySelector(".card-title-row");
  const display = row.querySelector('[data-role="title-display"]');
  const input = document.createElement("input");
  input.type = "text";
  input.className = "card-title-input";
  input.value = lecture.title;
  display.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== lecture.title) {
      const { error } = await sb.from("lectures").update({ title: newTitle }).eq("id", lecture.id);
      if (error) {
        toast("Couldn't save the new title.", "error");
      } else {
        lecture.title = newTitle;
        toast("Title updated.", "success");
        onChange();
      }
    }
    const newDisplay = document.createElement("div");
    newDisplay.className = "card-title";
    newDisplay.dataset.role = "title-display";
    newDisplay.textContent = lecture.title;
    input.replaceWith(newDisplay);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = lecture.title; input.blur(); }
  });
  input.addEventListener("blur", commit, { once: true });
}

async function playVideo(lecture) {
  const { data, error } = await sb.storage
    .from(BUCKETS.videos)
    .createSignedUrl(lecture.storage_path, 3600);

  if (error) {
    toast("Couldn't open this video.", "error");
    return;
  }

  document.getElementById("player-title").textContent = lecture.title;
  const videoEl = document.getElementById("player-video");
  videoEl.src = data.signedUrl;
  document.getElementById("video-player-modal").style.display = "flex";

  document.getElementById("video-player-modal").addEventListener("click", function handler(e) {
    if (e.target.closest("[data-close-modal]") || e.target === this) {
      videoEl.pause();
      videoEl.src = "";
    }
  }, { once: true });
}

async function deleteVideo(lecture) {
  if (!confirm(`Remove "${lecture.title}" from your binder? This can't be undone.`)) return;

  const { error: storageError } = await sb.storage.from(BUCKETS.videos).remove([lecture.storage_path]);
  const { error: dbError } = await sb.from("lectures").delete().eq("id", lecture.id);

  if (dbError) {
    toast("Couldn't delete this video.", "error");
    return;
  }
  toast("Video removed.", "success");
  loadVideos();
  onChange();
  if (storageError) console.warn("Storage cleanup issue:", storageError.message);
}
