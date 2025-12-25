import { authFetch, clearAuth } from "./api.js";
function toast(msg, type="info", ms=2200){
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(()=> t.remove(), ms);
}

function prettyConfirm(message, title="Confirm"){
  return new Promise((resolve) => {
    const modal = document.getElementById("al-modal");
    const mTitle = document.getElementById("al-modal-title");
    const mMsg = document.getElementById("al-modal-msg");
    const btnOk = document.getElementById("al-modal-ok");
    const btnCancel = document.getElementById("al-modal-cancel");

    if (!modal || !btnOk || !btnCancel) return resolve(false);

    mTitle.textContent = title;
    mMsg.textContent = message;

    const close = (ans) => {
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
      btnOk.onclick = null;
      btnCancel.onclick = null;
      modal.querySelector("[data-close='1']")?.removeEventListener("click", onBackdrop);
      resolve(ans);
    };

    const onBackdrop = () => close(false);

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");

    btnOk.onclick = () => close(true);
    btnCancel.onclick = () => close(false);
    modal.querySelector("[data-close='1']")?.addEventListener("click", onBackdrop);
  });
}
// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const blockedTbody = document.getElementById("blockedTbody");
const bannedTbody  = document.getElementById("bannedTbody");
const blockedMsg   = document.getElementById("blockedMsg");
const bannedMsg    = document.getElementById("bannedMsg");

const refreshBlocked = document.getElementById("refreshBlocked");
const refreshBanned  = document.getElementById("refreshBanned");
async function listBlocked() {
  return authFetch("/api/admin/users/blocked", { method: "GET" });
}
async function listBanned() {
  return authFetch("/api/admin/users/banned", { method: "GET" });
}
async function unbanUser(userId) {
  return authFetch(`/api/admin/users/${userId}/unban`, { method: "POST" });
}
function safe(v){ return (v ?? "").toString(); }

function blockedRow(u){
  return `
  <tr style="border-top:1px solid rgba(148,163,184,.15);">
    <td style="padding:8px 6px;">${safe(u.id)}</td>
    <td style="padding:8px 6px;">${escapeHtml(u.name)}</td>
    <td style="padding:8px 6px;">${escapeHtml(u.email)}</td>
    <td style="padding:8px 6px; opacity:.85;">${escapeHtml(u.blockedUntil)}</td>
    <td style="padding:8px 6px; opacity:.85;">${escapeHtml(u.blockReason)}</td>
    <td style="padding:8px 6px;">
      <button class="btn btn-secondary" data-unban="${u.id}" type="button">Unblock</button>
    </td>
  </tr>`;
}

function bannedRow(u){
  return `
  <tr style="border-top:1px solid rgba(148,163,184,.15);">
    <td style="padding:8px 6px;">${safe(u.id)}</td>
    <td style="padding:8px 6px;">${escapeHtml(u.name)}</td>
    <td style="padding:8px 6px;">${escapeHtml(u.email)}</td>
    <td style="padding:8px 6px; opacity:.85;">${escapeHtml(u.blockReason)}</td>
    <td style="padding:8px 6px;">
      <button class="btn btn-secondary" data-unban="${u.id}" type="button">Unban</button>
    </td>
  </tr>`;
}
async function loadBlocked(){
  if (!blockedTbody) return;

  if (blockedMsg) blockedMsg.textContent = "Loading blocked…"; 
  blockedTbody.innerHTML =
    `<tr><td colspan="6" style="padding:10px 6px; opacity:.7;">Loading…</td></tr>`;

  try{
    const list = await listBlocked();
    if (!list?.length){
      blockedTbody.innerHTML = `<tr><td colspan="6" style="padding:10px 6px; opacity:.7;">No blocked users</td></tr>`;
      blockedMsg.textContent = "0 blocked users.";
      return;
    }
    blockedTbody.innerHTML = list.map(blockedRow).join("");
    blockedMsg.textContent = `✅ Loaded ${list.length} blocked users.`;
  }catch(e){
    blockedTbody.innerHTML = `<tr><td colspan="6" style="padding:10px 6px; color:#fca5a5;">${escapeHtml(e.message)}</td></tr>`;
    blockedMsg.textContent = "Failed.";
  }
}

async function loadBanned(){
  if (!bannedTbody) return;

  if (bannedMsg) bannedMsg.textContent = "Loading banned…";
  bannedTbody.innerHTML =
    `<tr><td colspan="5" style="padding:10px 6px; opacity:.7;">Loading…</td></tr>`;

  try{
    const list = await listBanned();
    if (!list?.length){
      bannedTbody.innerHTML = `<tr><td colspan="5" style="padding:10px 6px; opacity:.7;">No banned users</td></tr>`;
      bannedMsg.textContent = "0 banned users.";
      return;
    }
    bannedTbody.innerHTML = list.map(bannedRow).join("");
    bannedMsg.textContent = ` Loaded ${list.length} banned users.`;
  }catch(e){
    bannedTbody.innerHTML = `<tr><td colspan="5" style="padding:10px 6px; color:#fca5a5;">${escapeHtml(e.message)}</td></tr>`;
    bannedMsg.textContent = "Failed.";
  }
}
refreshBlocked?.addEventListener("click", loadBlocked);
refreshBanned?.addEventListener("click", loadBanned);

document.addEventListener("click", async (e) => {
  const id = e.target?.getAttribute?.("data-unban");
  if (!id) return;

  const ok = await prettyConfirm(`Unban/Unblock user #${id}?`, "Unban / Unblock");
  if (!ok) return;
  
  try{
    await unbanUser(id);
    toast(` User #${id} unbanned/unblocked`, "success");
    await loadBlocked();
    await loadBanned();
  }catch(err){
    toast(err.message || "Unban failed", "error");
  }
});
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function show(el, msg, type = "info") {
  if (!el) return;
  el.textContent = msg || "";
  el.style.color =
    type === "success" ? "#22c55e" :
    type === "error"   ? "#ef4444" : "#94a3b8";
}

// ---------- admin guard ----------
(function adminGuard() {
  const role = (localStorage.getItem("role") || "").toUpperCase();
  const t = localStorage.getItem("token") || localStorage.getItem("jwt") || "";
  if (!t) {
    location.replace("Auth.html#login?next=" + encodeURIComponent("admin.html"));
    return;
  }
  if (role !== "ADMIN") {
    showBlockedModal("Access denied. Admins only.");
    location.replace("index.html");
    return;
  }
})();

// ---------- elements ----------
const form = $("createTeacherForm");
const msgCreate = $("createMsg");
const msgList = $("listMsg");
const tbody = $("teachersTbody");
const btnRefresh = $("refreshTeachers");

// ---------- API calls ----------
async function createTeacher({ name, email, password }) {
  return authFetch("/api/admin/users/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
}

async function listTeachers() {
  return authFetch("/api/admin/users/teachers", { method: "GET" });
}

// ---------- UI ----------
function rowHtml(t) {
  const nm = t?.name ?? t?.fullName ?? "—";
  const em = t?.email ?? "—";
  const rl = String(t?.role ?? "TEACHER").toUpperCase();
  return `
    <tr style="border-top:1px solid rgba(148,163,184,.15);">
      <td style="padding:8px 6px;">${escapeHtml(nm)}</td>
      <td style="padding:8px 6px;">${escapeHtml(em)}</td>
      <td style="padding:8px 6px; opacity:.85;">${escapeHtml(rl)}</td>
    </tr>
  `;
}

function setLoading() {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="3" style="padding:10px 6px; opacity:.7;">Loading…</td></tr>`;
}

function setEmpty(msg = "No teachers yet.") {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="3" style="padding:10px 6px; opacity:.7;">${escapeHtml(msg)}</td></tr>`;
}

// ---------- events ----------
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  show(msgCreate, "Creating teacher…", "info");

  const name = $("tName")?.value.trim();
  const email = $("tEmail")?.value.trim();
  const password = $("tPass")?.value;

  if (!name || !email || !password) return show(msgCreate, "Fill all fields.", "error");
  if (password.length < 6) return show(msgCreate, "Password must be at least 6 characters.", "error");

  try {
    const created = await createTeacher({ name, email, password });
    show(msgCreate, "✅ Teacher created successfully.", "success");
    form.reset();

    if (tbody) {
      const hasPlaceholder = tbody.querySelector("td[colspan='3']");
      if (hasPlaceholder) tbody.innerHTML = "";
      tbody.insertAdjacentHTML("afterbegin", rowHtml(created ?? { name, email, role: "TEACHER" }));
      show(msgList, "Teacher added (local). Add list API for real listing.", "info");
    }
  } catch (err) {
    const m = err?.message || "Failed to create teacher.";
    if (/unauthorized/i.test(m)) {
      clearAuth();
      location.replace("Auth.html#login?next=" + encodeURIComponent("admin.html"));
      return;
    }
    show(msgCreate, m, "error");
  }
});

btnRefresh?.addEventListener("click", loadTeachers);

async function loadTeachers() {
  show(msgList, "Loading teachers…", "info");
  setLoading();

  try {
    const list = await listTeachers();
    const teachers = Array.isArray(list) ? list : (list?.items || list?.data || []);
    if (!teachers.length) {
      setEmpty();
      show(msgList, "0 teachers found.", "info");
      return;
    }
    tbody.innerHTML = teachers.map(rowHtml).join("");
    show(msgList, ` Loaded ${teachers.length} teachers.`, "success");
  } catch (err) {
    setEmpty("Teacher list API not available yet.");
    show(
      msgList,
      "List endpoint missing. If you want list: add GET /api/admin/users/teachers in backend.",
      "error"
    );
  }
}

loadTeachers();
loadBlocked();
loadBanned();