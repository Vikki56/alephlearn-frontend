import { apiPost, saveAuth, showToast, clearPasswords } from "./api.js";

// Tabs
const tabSign = document.getElementById("tab-sign");
const tabLog  = document.getElementById("tab-log");
const signupForm = document.getElementById("signupForm");
const loginForm  = document.getElementById("loginForm");

function showSignup() {
  tabSign.classList.add("active");
  tabLog.classList.remove("active");
  signupForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  loginForm.reset();
  clearPasswords();
}
function showLogin() {
  tabLog.classList.add("active");
  tabSign.classList.remove("active");
  loginForm.classList.remove("hidden");
  signupForm.classList.add("hidden");
  signupForm.reset();
  clearPasswords();
}
tabSign.addEventListener("click", showSignup);
tabLog .addEventListener("click", showLogin);

// Show/hide password
document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === "password" ? "text" : "password";
    btn.textContent = input.type === "password" ? "👁" : "🙈";
  });
});

// Signup submit
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name  = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const p1    = document.getElementById("spass").value;
  const p2    = document.getElementById("scpass").value;

  if (!name || !email || !p1 || !p2) return showToast("Please fill all fields.", "info");
  if (p1.length < 6)                  return showToast("Password must be at least 6 characters.", "info");
  if (p1 !== p2)                      return showToast("Passwords do not match.", "info");

  try {
    const data = await apiPost("/api/auth/signup", { name, email, password: p1 });
    saveAuth(data.token, email);
    showToast("Account created. Welcome!", "success");
    setTimeout(() => (window.location.href = "dashboard.html"), 900);
  } catch (err) {
    showToast(err.message || "Sign up failed.", "error");
  }
});

// Login submit
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("lemail").value.trim();
  const pass  = document.getElementById("lpass").value;

  if (!email || !pass) return showToast("Please enter email and password.", "info");

  try {
    const data = await apiPost("/api/auth/login", { email, password: pass });
    saveAuth(data.token, email);
    showToast("Logged in successfully!", "success");
    setTimeout(() => (window.location.href = "dashboard.html"), 700);
  } catch (err) {
    const msg = /401|unauthorized|invalid/i.test(err.message)
      ? "Invalid email or password."
      : (err.message || "Login failed.");
    showToast(msg, "error");
  }
});

// Clear fields on page show
window.addEventListener("pageshow", clearPasswords);

// Hard-stop email autofill in login
(function hardStopEmailAutofill() {
  const form  = document.getElementById("loginForm");
  const email = document.getElementById("lemail");
  if (!form || !email) return;

  form.setAttribute("autocomplete", "section-auth off");
  email.setAttribute("autocomplete", "section-auth username");
  email.setAttribute("autocapitalize", "none");
  email.setAttribute("spellcheck", "false");
  email.name = "username_" + Math.random().toString(36).slice(2);

  email.value = "";
  window.addEventListener("pageshow", () => { email.value = ""; });

  email.readOnly = true;
  const unlock = () => { email.readOnly = false; };
  email.addEventListener("pointerdown", unlock, { once: true });
  email.addEventListener("focus", unlock, { once: true });
})();