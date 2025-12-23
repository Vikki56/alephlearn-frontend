// --- CONFIG ---
export const API_BASE = "http://localhost:8080";

// --- TOAST ---
export function showToast(message, type = "info", ms = 2200) {
  const stack = document.getElementById("toast-stack");
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

// --- FETCH WRAPPER ---
export async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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
  return text ? JSON.parse(text) : {};
}

// --- AUTH STORAGE + UTIL ---
export function saveAuth(token, email) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", email);
}
export function clearPasswords() {
  ["spass", "scpass", "lpass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = "";
      el.type = "password";
    }
  });
}
