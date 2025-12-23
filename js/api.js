// ✅ Single backend origin (works in local + production)
const ORIGIN_OVERRIDE = (localStorage.getItem('backendOrigin') || '').trim();

const isLocal =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.protocol === "file:";

export const API_BASE = ORIGIN_OVERRIDE
  ? ORIGIN_OVERRIDE
  : (isLocal ? "http://localhost:8080" : "https://alephlearn-backend.onrender.com");

// keep for legacy scripts that read window.API_BASE
window.API_BASE = API_BASE;

// --- TOAST ---
export function showToast(message, type = "info", ms = 2200) {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    stack.setAttribute("aria-atomic", "true");
    document.body.appendChild(stack);
  }

  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  stack.appendChild(t);

  const remove = () => {
    t.style.animation = "toast-out .18s ease-in forwards";
    setTimeout(() => t.remove(), 180);
  };
  setTimeout(remove, ms);
  t.addEventListener("click", remove);
}

// --- ERROR NORMALIZER ---
function normalizeError(statusText, text) {
  try {
    const j = JSON.parse(text);
    return j.message || statusText || "Something went wrong.";
  } catch {
    if (text && /<\/?[a-z][\s\S]*>/i.test(text))
      return statusText || "Request failed.";
    return text || statusText || "Request failed.";
  }
}

async function handleResponse(res) {
  const text = await res.text();
  if (!res.ok) throw new Error(normalizeError(res.statusText, text));
  return text ? JSON.parse(text) : {};
}

// --- BASIC FETCH WRAPPERS ---
export async function apiGet(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    return await handleResponse(res);
  } catch (e) {
    throw new Error(e.message || "Network error");
  }
}

export async function apiPost(path, data) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    });
    return await handleResponse(res);
  } catch (e) {
    throw new Error(e.message || "Network error");
  }
}

// --- AUTH STORAGE + UTIL ---
const KEY_TOKEN = "token";
const KEY_USER  = "user";

export function saveAuth(token, email) {
  localStorage.setItem(KEY_TOKEN, token);
  localStorage.setItem(KEY_USER, email);
}
export function getToken() {
  return localStorage.getItem(KEY_TOKEN);
}
export function getUserEmail() {
  return localStorage.getItem(KEY_USER);
}
export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
  localStorage.removeItem("email");
  localStorage.removeItem("userEmail");
  localStorage.removeItem("role");
  localStorage.removeItem("userId");
}

export function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* 🔹 NEW: fetchWithAuth usable from non-module scripts (like leaderboard.js) */
export async function fetchWithAuth(input, options = {}) {
  const url = typeof input === "string" ? input : input;
  const headers = { ...(options.headers || {}), ...authHeader() };

  return fetch(url, { ...options, headers });
}

// expose globally so <script src="leaderboard.js"> can see it
if (typeof window !== "undefined") {
  window.fetchWithAuth = fetchWithAuth;
}

// Auth-aware fetch you can reuse anywhere
export async function authFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = { ...(options.headers || {}), ...authHeader() };

  const res = await fetch(url, { ...options, headers });

  // read body once
  const text = await res.text();

  // ✅ 401 => normal logout (already)
  if (res.status === 401) {
    clearAuth();
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(`Auth.html#login?next=${next}`);
    throw new Error("Unauthorized");
  }

  // ✅ 403 => BLOCKED/BANNED => forced logout + popup
  if (res.status === 403) {
    let msg = "Your account is blocked/banned. Contact admin.";
    try {
      const j = text ? JSON.parse(text) : null;
      msg = j?.message || msg;
    } catch {
      if (text) msg = text;
    }

    // store message for Auth.html to show
    sessionStorage.setItem("blocked_msg", msg);

    // logout + redirect
    clearAuth();
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(`Auth.html#login?blocked=1&next=${next}`);

    throw new Error(msg);
  }

  // other errors
  if (!res.ok) throw new Error(text || res.statusText || "Request failed");
  return text ? JSON.parse(text) : {};
}

// POST helper with JWT
export function apiAuthPost(path, data) {
  return authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
}

// --- CLEAR PASSWORD FIELDS ---
export function clearPasswords() {
  ["spass", "scpass", "lpass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = "";
      el.type = "password";
    }
  });
}