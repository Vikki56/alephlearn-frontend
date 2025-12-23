// --- CONFIG ---
const API_BASE = "https://alephlearn-backend.onrender.com";
const $ = (id) => document.getElementById(id);

// --- ELEMENTS ---
const tabSign      = $("tab-sign");
const tabLog       = $("tab-log");
const signupPanel  = $("signupPanel");
const loginPanel   = $("loginPanel");
const signupForm   = $("signupForm");
const loginForm    = $("loginForm");
const forgotForm   = $("forgotForm");
const resetForm    = $("resetForm");
const devToken     = $("devToken");

$("resetSuccess")?.classList.add("hidden");  
// --- helpers ---
function toggleHidden(el, hide) {
  if (!el) return;
  el.classList.toggle("hidden", hide);
  el.setAttribute("aria-hidden", hide ? "true" : "false");
  el.style.display = hide ? "none" : "grid";
}

function showToast(msg, type = "info", ms = 2200) {
  const s = document.getElementById("toast-stack") || (() => {
    const d = document.createElement("div");
    d.id = "toast-stack";
    Object.assign(d.style, {
      position:"fixed", right:"20px", bottom:"20px",
      display:"flex", flexDirection:"column", gap:"8px", zIndex:"9999"
    });
    document.body.appendChild(d);
    return d;
  })();

  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    background: type==="success" ? "#22c55e" : type==="error" ? "#ef4444" : "#2563eb",
    color:"#fff", padding:"10px 16px", borderRadius:"10px", fontWeight:"600",
    opacity:"0", transform:"translateY(10px)", transition:"opacity .25s, transform .25s"
  });
  s.appendChild(t);
  requestAnimationFrame(()=>{ t.style.opacity="1"; t.style.transform="translateY(0)"; });
  setTimeout(()=>{ t.style.opacity="0"; t.style.transform="translateY(10px)"; setTimeout(()=>t.remove(),250); }, ms);
}

// gologin
function goLogin() {
  history.replaceState(null, "", "Auth.html#login"); // cleans ?token from URL
  setView("login");
}

function getHashParam(name) {
  const q = (location.hash.split("?")[1] || "");
  return new URLSearchParams(q).get(name);
}
function applyRoute() {
  const hash = location.hash || "#login";

  if (hash.startsWith("#reset")) {
    const t = getHashParam("token");
    if (t) {
      $("rpToken").value = t;        // fill hidden input
      setView("reset");
    } else {
      showToast("Reset link is invalid or expired.", "error");
      setView("forgot");
    }
    return;
  }

  if (hash.startsWith("#signup")) return setView("signup");
  if (hash.startsWith("#forgot")) return setView("forgot");
  return setView("login");
}




// initialize


async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {})
  });

  const text = await res.text();

  // ✅ message extractor (JSON or plain)
  const msg = (() => {
    try {
      const j = text ? JSON.parse(text) : null;
      return j?.message || j?.error || text || res.statusText;
    } catch {
      return text || res.statusText;
    }
  })();

  // ✅ BLOCKED/BANNED => force logout + show popup on Auth.html
  if (res.status === 403) {
    sessionStorage.setItem("blocked_msg", msg || "Account blocked/banned. Contact admin.");
    // login page hi hai, bas toast/alert + stop
    throw new Error(msg || "Blocked");
  }

  if (!res.ok) throw new Error(msg || "Request failed");

  return text ? JSON.parse(text) : {};
}

function saveAuth(token, email, role) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", email);
  if (role) localStorage.setItem("role", role);
}

// --- view switching (single source of truth) ---
function setView(view) {
  const showSignup = view === "signup";
  const showLogin  = view === "login";
  const showForgot = view === "forgot";
  const showReset  = view === "reset";

  // high-level panels
  toggleHidden(signupPanel, !showSignup);
  toggleHidden(loginPanel,  !(showLogin || showForgot || showReset));

  // sub-forms inside loginPanel
  toggleHidden(loginForm,  !showLogin);
  toggleHidden(forgotForm, !showForgot);
  toggleHidden(resetForm,  !showReset);
  // Always hide success card unless we are explicitly showing it
toggleHidden($("resetSuccess"), true);

  // tabs
  tabSign?.classList.toggle("active", showSignup);
  tabLog ?.classList.toggle("active", !showSignup);

  // focus
  if (showSignup) $("fullName")?.focus();
  if (showLogin)  $("lemail")?.focus();
  if (showForgot) $("fpEmail")?.focus();
  if (showReset)  $("rpToken")?.focus();
}




// expose for any legacy calls
function switchLoginView(which) { setView(which); }

// tabs
tabSign?.addEventListener("click", (e) => { e.preventDefault(); setView("signup"); });
tabLog ?.addEventListener("click", (e) => { e.preventDefault(); setView("login");  });




// remember email
(function rememberEmailInit(){
  const box = $("remember");
  const em  = $("lemail");
  const saved = localStorage.getItem("rememberEmail");
  if (saved && em) { em.value = saved; box && (box.checked = true); }
  loginForm?.addEventListener("submit", () => {
    if (box?.checked) localStorage.setItem("rememberEmail", em.value.trim());
    else localStorage.removeItem("rememberEmail");
  });
})();

// prevent aggressive autofill on login email
(function preventEmailAutofill(){
  const form = $("loginForm"), email = $("lemail");
  if (!form || !email) return;
  form.setAttribute("autocomplete","section-auth off");
  email.setAttribute("autocomplete","off");
  email.setAttribute("autocapitalize","none");
  email.setAttribute("spellcheck","false");
  email.name = "username_" + Math.random().toString(36).slice(2);
  email.readOnly = true;
  const unlock = () => (email.readOnly = false);
  email.addEventListener("pointerdown", unlock, {once:true});
  email.addEventListener("focus", unlock, {once:true});
})();

// --- submit: signup
signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("fullName").value.trim();
  const email= $("semail").value.trim();
  const p1   = $("spass").value;
  const p2   = $("scpass").value;
  if (!name || !email || !p1 || !p2) return showToast("Fill all fields", "info");
  if (p1 !== p2) return showToast("Passwords do not match", "error");
  try {
    const data = await apiPost("/api/auth/signup", { name, email, password:p1 });
    const role = data.user?.role || "USER";
    saveAuth(data.token, email, role);
    const userId = data.user?.id ?? data.id ?? data.userId;

if (userId) {
  localStorage.setItem("userId", String(userId));
  console.log("Saved userId after signup:", userId);
} else {
  console.warn("Signup response does not contain user id", data);
}
    localStorage.setItem("role", role);

    localStorage.setItem("displayName", name);
    localStorage.setItem("userEmail",   email);
    showToast("Account created!", "success");
  } catch (err) {
    showToast(err.message || "Sign up failed", "error");
  }
});

// --- submit: login
// --- LOGIN (updated, field names match backend)
$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("lemail").value.trim();
  const password = $("lpass").value;
  try {
    const data = await apiPost("/api/auth/login", { email, password });
    // store the token
    localStorage.setItem("token", data.token);
    // optional: compatibility
    localStorage.setItem("jwt", data.token);

const userId = data.user?.id ?? data.id ?? data.userId;

if (userId) {
  localStorage.setItem("userId", String(userId));
  console.log("Saved userId in localStorage:", userId);
} else {
  console.warn("Login response does not contain user id", data);
}
    const inferredName =
      (data.user?.name || data.name || email.split("@")[0])
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
    localStorage.setItem("userEmail",   email);
    localStorage.setItem("displayName", inferredName || "Anonymous");

    showToast("Login successful", "success");

    // ✅ Save role
    const role = data.user?.role || "USER";
    localStorage.setItem("role", role);

    // ✅ Role-based redirect
    if (role === "TEACHER") {
      location.replace("quizzes.html");
    } else if (role === "ADMIN") {
      location.replace("admin.html");
    } else {
      const next = new URL(location.href).hash.includes("next=")
        ? decodeURIComponent(location.hash.split("next=")[1])
        : "index.html";
      location.replace(next);
    }
  } catch (err) {
    showToast(err.message || "Invalid credentials", "error");
  }
});

// --- forgot/reset flow
$("forgotBtn")  ?.addEventListener("click", () => setView("forgot"));
$("cancelReset")?.addEventListener("click", () => setView("login"));
// Back buttons (for both forms)
const backForgot = $("backToLoginForgot");
if (backForgot) backForgot.onclick = () => setView("login");

const backReset = $("backToLoginReset");
if (backReset) backReset.onclick = () => setView("login");

$("sendReset")?.addEventListener("click", async () => {
  const email = $("fpEmail").value.trim();
  if (!email) return showToast("Enter your email", "info");
  try {
    const data = await apiPost("/api/auth/forgot", { email });
    devToken && (devToken.style.display = "block", devToken.textContent = `DEV token: ${data.token}`);
    showToast("Reset link sent", "success");
    setView("reset");
  } catch (err) {
    showToast(err.message || "Failed to send link", "error");
  }
});

$("doReset")?.addEventListener("click", async () => {
  const token = $("rpToken").value.trim();
  const p1    = $("rpPass").value;
  const p2    = $("rpPass2").value;
  if (!token || !p1 || !p2) return showToast("Fill all fields", "info");
  if (p1 !== p2) return showToast("Passwords do not match", "error");
  try {
    await apiPost("/api/auth/reset", { token, newPassword:p1 });
    showToast("Password updated", "success");
    // Show success card briefly then go to login
    $("resetForm")?.classList.add("hidden");
    $("resetSuccess")?.classList.remove("hidden");
    $("loginForm") ?.classList.add("hidden");
    $("forgotForm")?.classList.add("hidden");
    $("resetForm") ?.classList.add("hidden");
    $("resetSuccess")?.classList.remove("hidden");
    setTimeout(() => { $("resetSuccess")?.classList.add("hidden"); setView("login"); }, 1500);
  } catch (err) {
    showToast(err.message || "Reset failed", "error");
  }
});

function initPasswordToggles() {
  document.querySelectorAll(".pw-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-target");
      const input = document.getElementById(id);
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.setAttribute("aria-pressed", String(!showing));
      input.focus();
    });
  });
}

// --- LOGOUT (global) ---
function logout() {
  // 1) chat cache clean
  Object.keys(localStorage)
    .filter(k => k.startsWith("hidden_") || k.startsWith("lh_"))
    .forEach(k => localStorage.removeItem(k));

  // 2) auth + user info clear
  localStorage.removeItem("token");
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
  localStorage.removeItem("email");
  localStorage.removeItem("userEmail");
  localStorage.removeItem("userId");
  localStorage.removeItem("displayName");
  localStorage.removeItem("role");

  // 3) back to login page
  window.location.href = "Auth.html#login";
}

// optionally: make it available globally
window.logout = logout;
document.addEventListener("DOMContentLoaded", initPasswordToggles);

applyRoute();
requestAnimationFrame(() => {
  document.documentElement.classList.remove("al-preload-auth");
});

// optional fallback (JS error ho to bhi page show ho jaye)
setTimeout(() => {
  document.documentElement.classList.remove("al-preload-auth");
}, 1500);
window.addEventListener("hashchange", applyRoute);