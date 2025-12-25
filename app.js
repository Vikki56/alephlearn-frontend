const API_BASE = "https://alephlearn-backend.onrender.com"; 

function getNext() {
  const hash = location.hash || "";
  const q = hash.split("?")[1] || "";
  const params = new URLSearchParams(q);
  return params.get("next") || "dashboard.html";
}

// --- Toast helper ---
function ensureToastStack() {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

export function showToast(message, type = "info", ms = 2200) {
  const stack = ensureToastStack();
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;

  stack.appendChild(t);

  const remove = () => {
    t.style.animation = "toast-out .18s ease-in forwards";
    setTimeout(() => t.remove(), 180);
  };

  const timer = setTimeout(remove, ms);
  t.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
}
document.addEventListener("DOMContentLoaded", () => {
  const tabSign = document.getElementById("tab-sign");
  const tabLog = document.getElementById("tab-log");
  const signupForm = document.getElementById("signupForm");
  const loginForm = document.getElementById("loginForm");


signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name  = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const p1    = document.getElementById("spass").value;
    const p2    = document.getElementById("scpass").value;

    if (!name || !email || !p1 || !p2) return showToast("Please fill all fields.", "info");
    if (p1.length < 6) return showToast("Password must be at least 6 characters.", "info");
    if (p1 !== p2) return showToast("Passwords do not match.", "info");

    try {
      const data = await apiPost("/api/auth/signup", { name, email, password: p1 });
      const role = data.user?.role || "USER";
      saveAuth(data.token, email, role);
      showToast("🎉 Account created successfully!", "success");
      setTimeout(() => (window.location.href = getNext()), 900);
    } catch (err) {
      showToast(err.message || "Signup failed.", "error");
    }
  });

  // --- LOGIN ---
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("lemail").value.trim();
    const pass  = document.getElementById("lpass").value;

    if (!email || !pass) return showToast("Please enter email and password.", "info");

    try {
      const data = await apiPost("/api/auth/login", { email, password: pass });
      const role = data.user?.role || "USER";
      saveAuth(data.token, email, role);
      showToast("✅ Logged in successfully!", "success");

      setTimeout(() => {
        if (role === "TEACHER") window.location.href = "quizzes.html";
        else if (role === "ADMIN") window.location.href = "admin.html";
        else window.location.href = getNext();
      }, 700);
    } catch (err) {
      const msg = /401|unauthorized|invalid/i.test(err.message)
        ? "Invalid email or password."
        : (err.message || "Login failed.");
      showToast(msg, "error");
    }
  });



  if (tabSign && tabLog && signupForm && loginForm) {

    tabSign.addEventListener("click", () => {
      tabSign.classList.add("active");
      tabLog.classList.remove("active");
      signupForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
      loginForm.reset();
      clearPasswords?.(); 
    });

  
    tabLog.addEventListener("click", () => {
      tabLog.classList.add("active");
      tabSign.classList.remove("active");
      loginForm.classList.remove("hidden");
      signupForm.classList.add("hidden");
      signupForm.reset();
      clearPasswords?.();
    });
  }


  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      btn.textContent = input.type === "password" ? "👁" : "🙈";
    });
  });


});

// --- API helper ---
async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const text = await res.text();
  if (!res.ok) {
    try {
      const err = JSON.parse(text);
      throw new Error(err.message || res.statusText);
    } catch {
      throw new Error(res.statusText || "Invalid email or password.");
    }
  }
  return JSON.parse(text || "{}");
}


function saveAuth(token, email, role) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", email);
  if (role) localStorage.setItem("role", role);
}
function clearPasswords() {
  ["spass", "scpass", "lpass"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ""; el.type = "password"; }
  });
}
window.addEventListener("pageshow", clearPasswords);

// --- Prevent autofill on login ---
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

(function initFxBurgerDrawer() {
  const checkbox = document.getElementById('fx-burger-check');
  const drawer = document.getElementById('fx-drawer');
  const closeBtn = document.getElementById('fx-drawer-close');
  const backdrop = document.getElementById('fx-backdrop');

  if (!checkbox || !drawer || !backdrop) return;

  function openDrawer() {
    drawer.classList.add('open');
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('show'));
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
    checkbox.checked = false;
    setTimeout(() => (backdrop.hidden = true), 220);
    document.body.style.overflow = '';
  }

  checkbox.addEventListener('change', e =>
    e.target.checked ? openDrawer() : closeDrawer()
  );

  closeBtn?.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer();
  });
  drawer.addEventListener('click', e => {
    if (e.target.closest('a')) closeDrawer();
  });
})();