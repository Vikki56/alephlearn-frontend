const API_BASE = "https://alephlearn-backend.onrender.com";

const LOCKED_STATUSES = ["BLOCKED", "BANNED", "RESOLVED", "REJECTED"];
const HIDE_FROM_LIST  = ["BLOCKED", "BANNED"]; // feed clean

function token() {
  return localStorage.getItem("token") || localStorage.getItem("jwt") || "";
}

function mustBeAdmin() {
  const role = (localStorage.getItem("role") || "").toUpperCase();
  if (role !== "ADMIN") {
    alert("Access denied");
    location.replace("index.html");
    return false;
  }
  return true;
}

async function api(path, opts = {}) {
  const t = token();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? JSON.parse(text) : null;
}

async function fetchProofBlob(reportId) {
  const t = token();
  const res = await fetch(`${API_BASE}/api/admin/reports/${reportId}/proof`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!res.ok) throw new Error("Proof not found / not allowed");
  return await res.blob();
}

function el(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusOptions(current) {
  const options = ["OPEN", "IN_REVIEW", "WARNED", "BLOCKED", "BANNED", "RESOLVED", "REJECTED"];
  const cur = String(current || "").toUpperCase();
  return options
    .map(s => `<option value="${s}" ${s === cur ? "selected" : ""}>${s}</option>`)
    .join("");
}

function rowHtml(r) {
  const stUpper = String(r.status || "").toUpperCase();
  const locked = LOCKED_STATUSES.includes(stUpper);

  const target = `${r.targetType} #${r.targetId}`;
  const proofBtn = r.hasProof
    ? `<button class="btn btn-secondary" data-proof="${r.id}" type="button">View</button>`
    : `<span style="opacity:.6;">No</span>`;

  const statusCell = locked
    ? `<span class="status-pill locked">${escapeHtml(stUpper)}</span>`
    : `
      <select data-status="${r.id}" class="form-input" style="padding:6px;">
        ${statusOptions(stUpper)}
      </select>
      <input data-days="${r.id}" class="form-input"
        style="padding:6px; margin-top:6px; display:${(stUpper === "BLOCKED") ? "block" : "none"};"
        placeholder="Block days (e.g. 3)" type="number" min="1" />
    `;

  // NOTES CELL
  const notesCell = locked
    ? `<span style="opacity:.75;">Locked</span>`
    : `
      <input data-notes="${r.id}" class="form-input" style="padding:6px;" placeholder="admin notes..."
        value="${escapeHtml(r.adminNotes || "")}">
      <input data-reason="${r.id}" class="form-input" style="padding:6px; margin-top:6px;"
        placeholder="action reason (optional)" />
    `;

  // ACTION CELL
  const actionCell = locked
    ? `<span style="opacity:.7;">—</span>`
    : `<button class="btn btn-primary" data-save="${r.id}" type="button">Save</button>`;

  return `
    <tr data-status-row="${r.id}"
        data-server-status="${escapeHtml(stUpper)}"
        style="border-top:1px solid rgba(255,255,255,.08);">
      <td style="padding:8px 6px;">${r.id}</td>
      <td style="padding:8px 6px;">${escapeHtml(target)}</td>
      <td style="padding:8px 6px;">${escapeHtml(r.reason || "")}</td>

      <td style="padding:8px 6px; opacity:.9;">
        ${escapeHtml(r.description || "")}
      </td>

      <td style="padding:8px 6px;">${escapeHtml(r.reporterEmail || "")}</td>
      <td style="padding:8px 6px;">${proofBtn}</td>

      <td style="padding:8px 6px;">${statusCell}</td>
      <td style="padding:8px 6px;">${notesCell}</td>
      <td style="padding:8px 6px;">${actionCell}</td>
    </tr>
  `;
}

async function loadReports() {
  const tbody = el("reportsTbody");
  const msg = el("reportsMsg");

  try {
    msg.textContent = "Loading reports…";
    const list = await api("/api/admin/reports");

    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="padding:10px 6px; opacity:.7;">No reports</td></tr>`;
      msg.textContent = "0 reports loaded.";
      return;
    }

    //  hide already punished reports (feed clean)
    const filtered = list.filter(r => {
      const st = String(r.status || "").toUpperCase();
      return !HIDE_FROM_LIST.includes(st);
    });

    tbody.innerHTML = filtered.map(rowHtml).join("");
    msg.textContent = `Loaded ${filtered.length} reports.`;

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:10px 6px; color:#fca5a5;">${escapeHtml(e.message)}</td></tr>`;
    msg.textContent = "Failed.";
  }
}

async function saveStatus(reportId) {
  const row = document.querySelector(`tr[data-status-row="${reportId}"]`);
  const serverStatus = String(row?.getAttribute("data-server-status") || "").toUpperCase();

  
  if (LOCKED_STATUSES.includes(serverStatus)) {
    el("reportsMsg").textContent = `Report #${reportId} is locked (${serverStatus}).`;
    return;
  }

  const st = document.querySelector(`[data-status="${reportId}"]`)?.value;
  const stUpper = String(st || "").toUpperCase();

  const notes  = document.querySelector(`[data-notes="${reportId}"]`)?.value || "";
  const days   = document.querySelector(`[data-days="${reportId}"]`)?.value;
  const reason = document.querySelector(`[data-reason="${reportId}"]`)?.value || "";

  await api(`/api/admin/reports/${reportId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: stUpper,
      adminNotes: notes,
      blockDays: days ? Number(days) : null,
      actionReason: reason || null
    })
  });

  await loadReports();
  el("reportsMsg").textContent = `Report #${reportId} updated `;

  document.getElementById("refreshBlocked")?.click();
  document.getElementById("refreshBanned")?.click();
}

document.addEventListener("click", async (e) => {
  const proofId = e.target?.getAttribute?.("data-proof");
  const saveId  = e.target?.getAttribute?.("data-save");

  try {
    if (proofId) {
      const blob = await fetchProofBlob(proofId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    if (saveId) {
      await saveStatus(saveId);
    }
  } catch (err) {
    el("reportsMsg").textContent = err.message || "Action failed";
  }
});

document.addEventListener("change", (e) => {
  const reportId = e.target?.getAttribute?.("data-status");
  if (!reportId) return;

  const st = String(e.target.value || "").toUpperCase();
  const daysInput = document.querySelector(`[data-days="${reportId}"]`);
  if (daysInput) {
    daysInput.style.display = (st === "BLOCKED") ? "block" : "none";
  }
});

el("refreshReports")?.addEventListener("click", loadReports);

if (mustBeAdmin()) loadReports();