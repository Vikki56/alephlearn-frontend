// index.js  (load as type="module")

import { API_BASE, authFetch } from "./js/api.js";

function formatRank(rank, totalUsers) {
  if (!rank || rank <= 0) return "-";
  if (!totalUsers || totalUsers <= 0) return `#${rank}`;
  return `#${rank} / ${totalUsers}`;
}

function formatQuizScore(scorePercent) {
  if (scorePercent == null || isNaN(scorePercent)) return "-";
  // 0–1 ya 0–100 dono handle
  if (scorePercent <= 1) {
    return Math.round(scorePercent * 100) + "%";
  }
  return Math.round(scorePercent) + "%";
}

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

  if (item.messagesCount != null) {
    spans.push(`💬 ${item.messagesCount} messages`);
  }
  if (item.activeCount != null) {
    spans.push(`🟢 ${item.activeCount} active`);
  }
  if (item.lastActivityLabel) {
    spans.push(item.lastActivityLabel);
  }

  if (spans.length === 0) {
    spans.push("Recently active");
  }

  spans.forEach((txt) => {
    const s = document.createElement("span");
    s.textContent = txt;
    meta.appendChild(s);
  });

  div.appendChild(title);
  div.appendChild(sub);
  div.appendChild(meta);

  // Optional: click to navigate if URL present
  if (item.url) {
    div.style.cursor = "pointer";
    div.addEventListener("click", () => {
      window.location.href = item.url;
    });
  }

  return div;
}

async function loadDashboard() {
    const titleEl = document.querySelector(".h1");
    const subtitleEl = document.querySelector(".sub");
  
    const activeChatsEl = document.getElementById("statActiveChats");
    const doubtsSolvedEl = document.getElementById("statDoubtsSolved");
    const quizScoreEl = document.getElementById("statQuizScore");
    const rankEl = document.getElementById("statRank");
  
    const trendingContainer = document.getElementById("trendingList");
  
    try {
      // 🔥 authFetch already JSON data de raha hai
      const data = await authFetch(`${API_BASE}/api/dashboard/summary`, {
        headers: { Accept: "application/json" },
      });
  
      console.log("Dashboard summary:", data);
  
      if (!data || typeof data !== "object") {
        console.error("Unexpected dashboard response:", data);
        return;
      }
  
      // --------- Profile / welcome text ----------
      const profile = data.profile || data.profileSummary || null;
  
      if (profile?.name && titleEl) {
        const firstName = profile.name.split(" ")[0];
        titleEl.textContent = `Welcome back, ${firstName}! 🚀`;
      }
  
      if (subtitleEl && profile?.branchLabel) {
        subtitleEl.textContent = `${profile.branchLabel} • Keep your streak going!`;
      }
  
      // --------- Stats cards ----------
      if (activeChatsEl) {
        const activeChats =
          data.activeChats ??
          data.activeChatCount ??
          data.liveChatRooms ??
          0;
        activeChatsEl.textContent = activeChats;
      }
  
      if (doubtsSolvedEl) {
        const doubtsSolved =
          profile?.doubtsSolved ??
          data.doubtsSolved ??
          data.totalDoubtsSolved ??
          0;
        doubtsSolvedEl.textContent = doubtsSolved;
      }
  
      if (quizScoreEl) {
        const quizScorePercent =
          data.quickStats?.latestQuizScorePercent ?? null;
    
        quizScoreEl.textContent = formatQuizScore(quizScorePercent);
      }
  
      if (rankEl) {
        const rank =
          profile?.rankGlobal ??
          data.rankGlobal ??
          data.rank ??
          null;
        const totalUsers =
          profile?.totalUsersGlobal ??
          data.totalUsers ??
          data.totalUsersGlobal ??
          null;
        rankEl.textContent = formatRank(rank, totalUsers);
      }
  
      // --------- Trending ----------
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
            const node = createTrendingItem({
              title: item.title,
              subtitle: item.subtitle,
              snippet: item.snippet,
              messagesCount: item.messagesCount,
              activeCount: item.activeCount,
              lastActivityLabel: item.lastActivityLabel,
              url: item.url,
            });
            trendingContainer.appendChild(node);
          });
        }
      }
    } catch (err) {
      console.error("Dashboard fetch failed:", err);
    }finally{
        document.body.classList.add("dashboard-loaded");
    }
  }
  
  document.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
    setupNavbarAvatar();
  });






















function setupNavbarAvatar() {
    const avatar = document.getElementById("navbarAvatar");
    if (!avatar) return;
  
    try {
      // 1) Try full user object
      const userJson = localStorage.getItem("user");
      let user = null;
      if (userJson) {
        try {
          user = JSON.parse(userJson);
        } catch (_) {
          user = null;
        }
      }
  
      // 2) Try to get name from multiple possible keys
      let name =
        (user && (user.name || user.fullName || user.username)) ||
        localStorage.getItem("userName") ||
        localStorage.getItem("name") ||
        "";
  
      let email =
        (user && (user.email || user.userEmail)) ||
        localStorage.getItem("userEmail") ||
        localStorage.getItem("email") ||
        "";
  
      // Agar name empty hai lekin email hai, to email se naam bana lo
      if (!name && email) {
        name = email.split("@")[0];
      }
  
      if (!name) return;
  
      // Generate initials
      let initials = "U";
      const parts = name.trim().split(" ");
      if (parts.length === 1) {
        initials = parts[0][0].toUpperCase();
      } else {
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
      }
  
      // 🔮 Purple gradient avatar
      avatar.style.background = "linear-gradient(135deg, #8b5cf6, #ec4899)";
      avatar.style.color = "#ffffff";
      avatar.textContent = initials;
  
      // ⭐ Avatar click → Open profile
      avatar.style.cursor = "pointer";
      avatar.onclick = () => {
        window.location.href = "profile.html";
      };
  
    } catch (e) {
      console.error("Avatar load error:", e);
    }
  }
  
  // Call automatically on page load
  document.querySelectorAll('.js-logout').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.removeItem("token");
      window.location.href = "./auth.html";
    });
  });