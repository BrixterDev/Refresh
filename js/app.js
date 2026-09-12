import { supabase } from "./supabaseClient.js";
import { toast, initials, formatDate, formatDateTime } from "./ui.js";
import { initVideos } from "./videos.js";
import { initDocuments } from "./documents.js";
import { initNotes } from "./notes.js";

// ---------------------------------------------------------
// Auth guard
// ---------------------------------------------------------
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  window.location.href = "index.html";
}
const user = session.user;

document.getElementById("user-email").textContent = user.email;
document.getElementById("user-avatar").textContent = initials(user.user_metadata?.full_name || user.email);
document.getElementById("greeting-name").textContent =
  (user.user_metadata?.full_name || user.email || "reviewer").split(" ")[0];

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") window.location.href = "index.html";
});

document.getElementById("signout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

// ---------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");

function switchView(name) {
  navItems.forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
}

navItems.forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.view));
});

// ---------------------------------------------------------
// Generic modal close wiring (open handlers live in each module)
// ---------------------------------------------------------
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.dataset.closeModal).style.display = "none";
  });
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay").forEach((o) => (o.style.display = "none"));
  }
});

export function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((o) => (o.style.display = "none"));
}

// ---------------------------------------------------------
// Overview
// ---------------------------------------------------------
async function loadOverview() {
  const statsEl = document.getElementById("overview-stats");
  const recentEl = document.getElementById("overview-recent");

  const [{ count: videoCount }, { count: docCount }, { count: noteCount }] = await Promise.all([
    supabase.from("lectures").select("id", { count: "exact", head: true }),
    supabase.from("documents").select("id", { count: "exact", head: true }),
    supabase.from("notes").select("id", { count: "exact", head: true }),
  ]);

  statsEl.innerHTML = `
    <div class="card" style="padding:20px;">
      <div style="font-family:var(--font-mono); font-size:28px; color:var(--brass-strong);">${videoCount ?? 0}</div>
      <div style="color:var(--text-dim); font-size:13px; margin-top:4px;">Lecture videos saved</div>
    </div>
    <div class="card" style="padding:20px;">
      <div style="font-family:var(--font-mono); font-size:28px; color:var(--brass-strong);">${docCount ?? 0}</div>
      <div style="color:var(--text-dim); font-size:13px; margin-top:4px;">Documents in your binder</div>
    </div>
    <div class="card" style="padding:20px;">
      <div style="font-family:var(--font-mono); font-size:28px; color:var(--brass-strong);">${noteCount ?? 0}</div>
      <div style="color:var(--text-dim); font-size:13px; margin-top:4px;">Notes written</div>
    </div>
  `;

  const { data: recentLectures } = await supabase
    .from("lectures")
    .select("id, title, uploaded_at, subject")
    .order("uploaded_at", { ascending: false })
    .limit(3);

  const { data: recentNotes } = await supabase
    .from("notes")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(3);

  const recentItems = [
    ...(recentLectures || []).map((l) => ({
      kind: "Lecture video", title: l.title, when: l.uploaded_at, view: "videos",
    })),
    ...(recentNotes || []).map((n) => ({
      kind: "Note", title: n.title, when: n.updated_at, view: "notes",
    })),
  ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 6);

  if (recentItems.length === 0) {
    recentEl.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <h3>Your binder is empty, for now</h3>
        <p>Upload your first lecture recording or reviewer to get started — this page fills in as you go.</p>
      </div>`;
    return;
  }

  recentEl.innerHTML = recentItems.map((item) => `
    <div class="card" style="padding:16px;">
      <div class="tag" style="margin-bottom:10px; display:inline-block;">${item.kind}</div>
      <div class="card-title" style="margin-bottom:6px;">${escapeHtmlLocal(item.title)}</div>
      <div class="card-meta">${formatDate(item.when)}</div>
    </div>
  `).join("");

  recentEl.querySelectorAll(".card").forEach((card, i) => {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => switchView(recentItems[i].view));
  });
}

function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export async function refreshOverview() {
  await loadOverview();
}

// ---------------------------------------------------------
// Boot
// ---------------------------------------------------------
initVideos(supabase, user, { onChange: refreshOverview });
initDocuments(supabase, user, { onChange: refreshOverview });
initNotes(supabase, user, { onChange: refreshOverview });
loadOverview();
