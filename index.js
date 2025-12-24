// index.js (dashboard)  load as type="module"
import { API_BASE, authFetch } from "./js/api.js";

// ---------- small cache helpers ----------
const DASH_KEY = "dash_summary_cache_v1";
const DASH_TTL_MS = 60 * 1000; // 60s

function readDashCache() {
  try {
    const raw = localStorage.getItem(DASH_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.ts || !obj?.data) return null;
    return obj;
  } catch {
    return null;
  }
}
function writeDashCache(data) {
  try {
    localStorage.setItem(DASH_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

// ---------- warm backend (helps cold start a bit) ----------
async function warmBackend() {
  try {
    await fetch(`${API_BASE}/api/ping`, { cache: "no-store", keepalive: true });
  } catch {}
}

// ---------- formatters ----------
function formatRank(rank, totalUsers) {
  if (!rank || rank <= 0) return "-";
  if (!totalUsers || totalUsers <= 0) return `#${rank}`;
  return `#${rank} / ${totalUsers}`;
}
function formatQuizScore(scorePercent) {
  if (scorePercent == null || isNaN(scorePercent)) return "-";
  if (scorePercent <= 1) return Math.round(scorePercent * 100) + "%";
  return Math.round(scorePercent) + "%";
}

// ---------- render ----------
function createTrendingItem(item) {
  const div = document.createElement("div");
  div.className = "item";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.textContent = item.title || "Untitled discussion";

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.style.margin = "6px 0";
  sub.textContent =
    item.subtitle ||
    item.snippet ||
    "No description available, but something interesting is going on here…";

  const meta = document.createElement("div");
  meta.className = "meta";

  const spans = [];
  if (item.messagesCount != null) spans.push(`💬 ${item.messagesCount} messages`);
  if (item.activeCount != null) spans.push(`🟢 ${item.activeCount} active`);
  if (item.lastActivityLabel) spans.push(item.lastActivityLabel);
  if (spans.length === 0) spans.push("Recently active");

  spans.forEach((txt) => {
    const s = document.createElement("span");
    s.textContent = txt;
    meta.appendChild(s);
  });

  div.appendChild(title);
  div.appendChild(sub);
  div.appendChild(meta);

  if (item.url) {
    div.style.cursor = "pointer";
    div.addEventListener("click", () => (window.location.href = item.url));
  }
  return div;
}

function renderDashboard(data) {
  if (!data || typeof data !== "object") return;

  const titleEl = document.querySelector(".h1");
  const subtitleEl = document.querySelector(".sub");

  const activeChatsEl = document.getElementById("statActiveChats");
  const doubtsSolvedEl = document.getElementById("statDoubtsSolved");
  const quizScoreEl = document.getElementById("statQuizScore");
  const rankEl = document.getElementById("statRank");

  const trendingContainer = document.getElementById("trendingList");

  const profile = data.profile || data.profileSummary || null;

  if (profile?.name && titleEl) {
    const firstName = profile.name.split(" ")[0];
    titleEl.textContent = `Welcome back, ${firstName}! 🚀`;
  }

  if (subtitleEl && profile?.branchLabel) {
    subtitleEl.textContent = `${profile.branchLabel} • Keep your streak going!`;
  }

  if (activeChatsEl) {
    activeChatsEl.textContent =
      data.activeChats ?? data.activeChatCount ?? data.liveChatRooms ?? 0;
  }

  if (doubtsSolvedEl) {
    doubtsSolvedEl.textContent =
      profile?.doubtsSolved ?? data.doubtsSolved ?? data.totalDoubtsSolved ?? 0;
  }

  if (quizScoreEl) {
    const quizScorePercent = data.quickStats?.latestQuizScorePercent ?? null;
    quizScoreEl.textContent = formatQuizScore(quizScorePercent);
  }

  if (rankEl) {
    const rank = profile?.rankGlobal ?? data.rankGlobal ?? data.rank ?? null;
    const totalUsers =
      profile?.totalUsersGlobal ?? data.totalUsers ?? data.totalUsersGlobal ?? null;
    rankEl.textContent = formatRank(rank, totalUsers);
  }

  if (trendingContainer) {
    trendingContainer.innerHTML = "";
    const trending = data.trending || data.trendingDiscussions || [];

    if (!Array.isArray(trending) || trending.length === 0) {
      const msg = document.createElement("div");
      msg.className = "item";
      msg.innerHTML =
        `<div class="sub" style="margin:6px 0; color:#9ca3af;">` +
        `No trending discussions yet. Ask doubts or join chat to start something 🔥` +
        `</div>`;
      trendingContainer.appendChild(msg);
    } else {
      trending.forEach((item) => {
        trendingContainer.appendChild(
          createTrendingItem({
            title: item.title,
            subtitle: item.subtitle,
            snippet: item.snippet,
            messagesCount: item.messagesCount,
            activeCount: item.activeCount,
            lastActivityLabel: item.lastActivityLabel,
            url: item.url,
          })
        );
      });
    }
  }
}

// ---------- main load ----------
async function loadDashboardFresh() {
  const data = await authFetch(`${API_BASE}/api/dashboard/summary`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  writeDashCache(data);
  renderDashboard(data);
}

function setupNavbarAvatar() {
  const avatar = document.getElementById("navbarAvatar");
  if (!avatar) return;

  try {
    const userJson = localStorage.getItem("user");
    let user = null;
    if (userJson) {
      try { user = JSON.parse(userJson); } catch { user = null; }
    }

    let name =
      (user && (user.name || user.fullName || user.username)) ||
      localStorage.getItem("userName") ||
      localStorage.getItem("name") ||
      localStorage.getItem("displayName") ||
      "";

    let email =
      (user && (user.email || user.userEmail)) ||
      localStorage.getItem("userEmail") ||
      localStorage.getItem("email") ||
      "";

    if (!name && email) name = email.split("@")[0];
    if (!name) return;

    let initials = "U";
    const parts = name.trim().split(" ");
    initials = parts.length === 1
      ? parts[0][0].toUpperCase()
      : (parts[0][0] + parts[1][0]).toUpperCase();

    avatar.style.background = "linear-gradient(135deg, #8b5cf6, #ec4899)";
    avatar.style.color = "#fff";
    avatar.textContent = initials;

    avatar.style.cursor = "pointer";
    avatar.onclick = () => (window.location.href = "profile.html");
  } catch (e) {
    console.error("Avatar load error:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupNavbarAvatar();
  warmBackend(); // don't await

  // ✅ 1) show cached instantly (if exists)
  const cached = readDashCache();
  if (cached?.data) {
    renderDashboard(cached.data);
    document.body.classList.add("dashboard-loaded");
  }

  // ✅ 2) refresh in background (always)
  loadDashboardFresh()
    .catch((e) => console.error("Dashboard fetch failed:", e))
    .finally(() => document.body.classList.add("dashboard-loaded"));
});