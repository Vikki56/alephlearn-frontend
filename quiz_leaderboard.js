const API_BASE = "http://localhost:8080/api";
const TOKEN_KEY = "token";

function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
}

function getQuizIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("quizId");
}

async function fetchQuizDetail(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Failed to load quiz for leaderboard:", t);
    throw new Error("Failed to load quiz");
  }
  return await res.json();
}

async function fetchLeaderboard(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/leaderboard`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Failed to load leaderboard:", t);
    throw new Error("Failed to load leaderboard");
  }
  return await res.json(); // List<LeaderboardEntryDto>
}

function formatMillis(ms) {
  if (ms == null) return "-";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function renderLeaderboard(quiz, entries) {
  const titleEl = document.getElementById("leaderboardQuizTitle");
  const subEl = document.getElementById("leaderboardSubtitle");
  const container = document.getElementById("leaderboardContainer");

  if (titleEl) titleEl.textContent = quiz.title || "Quiz Leaderboard";
  if (subEl)
    subEl.textContent = `Showing top ${entries.length} attempts • Higher score first, tie broken by lower time.`;

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No attempts yet</h3>
        <p>Once users submit this quiz, rankings will appear here.</p>
      </div>
    `;
    return false;              // ⬅️ IMPORTANT: bool return
  }

  const rowsHtml = entries
    .map((e) => {
      let medal = "";
      if (e.rank === 1) medal = "🥇";
      else if (e.rank === 2) medal = "🥈";
      else if (e.rank === 3) medal = "🥉";

      return `
        <tr>
          <td>${medal || e.rank}</td>
          <td>${e.username}</td>
          <td>${e.score}</td>
          <td>${formatMillis(e.timeTakenMillis)}</td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>User</th>
          <th>Score</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  return true;                 // ⬅️ data aa gaya
}

/* 🔁 AUTO REFRESH PART */
let leaderboardPollHandle = null;

function startLeaderboardAutoRefresh(quizId, quiz) {
  if (!quizId) return;

  if (leaderboardPollHandle) {
    clearInterval(leaderboardPollHandle);
    leaderboardPollHandle = null;
  }

  // har 4 sec me entries reload karo
  leaderboardPollHandle = setInterval(async () => {
    try {
      const entries = await fetchLeaderboard(quizId);
      const hasData = renderLeaderboard(quiz, entries);

      // jaise hi proper ranking aa jaye, polling stop
      if (hasData) {
        clearInterval(leaderboardPollHandle);
        leaderboardPollHandle = null;
      }
    } catch (err) {
      console.error("Auto-refresh leaderboard failed:", err);
    }
  }, 4000);
}

/* MAIN INIT */

function initLeaderboardPage() {
  const quizId = getQuizIdFromUrl();
  if (!quizId) {
    alert("Missing quizId in URL");
    return;
  }

  document
    .getElementById("backToQuizzesBtn")
    ?.addEventListener("click", () => {
      window.location.href = "quizzes.html";
    });

  Promise.all([fetchQuizDetail(quizId), fetchLeaderboard(quizId)])
    .then(([quiz, entries]) => {
      renderLeaderboard(quiz, entries);          // first paint
      startLeaderboardAutoRefresh(quizId, quiz); // 🔥 start polling
    })
    .catch((err) => {
      console.error(err);
      alert("Unable to load leaderboard.");
    });
}

document.addEventListener("DOMContentLoaded", initLeaderboardPage);