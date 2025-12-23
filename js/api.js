// AlephLearn API helper (PROD-safe)
// Single source of truth for API base URL across pages.

const isFile = location.protocol === "file:";
const looksLikeDev =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.port === "5500" || location.port === "5173" || location.port === "3000";

const ORIGIN_OVERRIDE =
  localStorage.getItem("backendOrigin") ||
  sessionStorage.getItem("backendOrigin") ||
  window.API_BASE;

const PROD_API_BASE = "https://alephlearn-backend.onrender.com";
export const API_BASE = (ORIGIN_OVERRIDE || (isFile || looksLikeDev ? "http://localhost:8080" : PROD_API_BASE))
  .replace(/\/$/, "");

// expose for legacy scripts
window.API_BASE = API_BASE;

function getToken() {
  return localStorage.getItem("token") || localStorage.getItem("jwt") || "";
}

export async function apiFetch(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...opts, headers });
  return res;
}

export async function authFetch(path, opts = {}) {
  const token = getToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return apiFetch(path, { ...opts, headers });
}

export async function readJsonSafe(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  if (!text) return null;
  if (ct.includes("application/json")) {
    try { return JSON.parse(text); } catch { return { _raw: text }; }
  }
  // if HTML came back, return raw text so caller can show a useful error
  return { _raw: text };
}

export async function getJson(path, opts = {}) {
  const res = await authFetch(path, { ...opts, method: "GET" });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText || "Request failed");
  return data;
}

export async function postJson(path, body, opts = {}) {
  const res = await authFetch(path, {
    ...opts,
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body ?? {})
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText || "Request failed");
  return data;
}