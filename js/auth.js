import { supabase } from "./supabaseClient.js";
import { toast } from "./ui.js";

// If already signed in, skip straight to the dashboard.
const { data: { session } } = await supabase.auth.getSession();
if (session) {
  window.location.href = "dashboard.html";
}

// --- tab switching ---
const tabs = document.querySelectorAll(".auth-tab");
const forms = document.querySelectorAll(".auth-form");
const heading = document.getElementById("auth-heading");
const lede = document.getElementById("auth-lede");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    forms.forEach((f) => f.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    document.getElementById(`${target}-form`).classList.add("active");
    if (target === "login") {
      heading.textContent = "Welcome back";
      lede.textContent = "Sign in to reach your binder.";
    } else {
      heading.textContent = "Set up your binder";
      lede.textContent = "Takes a minute. No credit card, no fine print.";
    }
  });
});

// --- login ---
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginSubmit = document.getElementById("login-submit");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Signing in…";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  loginSubmit.disabled = false;
  loginSubmit.textContent = "Sign in";

  if (error) {
    loginError.textContent = error.message === "Invalid login credentials"
      ? "That email and password don't match our records."
      : error.message;
    return;
  }
  window.location.href = "dashboard.html";
});

// --- signup ---
const signupForm = document.getElementById("signup-form");
const signupError = document.getElementById("signup-error");
const signupSubmit = document.getElementById("signup-submit");

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupError.textContent = "";
  signupSubmit.disabled = true;
  signupSubmit.textContent = "Creating account…";

  const full_name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name } },
  });

  signupSubmit.disabled = false;
  signupSubmit.textContent = "Create account";

  if (error) {
    signupError.textContent = error.message;
    return;
  }

  if (data.session) {
    window.location.href = "dashboard.html";
  } else {
    toast("Account created. Check your email to confirm, then sign in.", "success");
    document.querySelector('.auth-tab[data-tab="login"]').click();
  }
});
