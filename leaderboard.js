// leaderboard.js
// Ye file leaderboard.html ke liye latest result + leaderboard + history load karti hai.

import "./js/protect.js";           // auth check
import { authFetch } from "./js/api.js";  // JWT wala fetch

// --- DOM refs ---

const latestSummaryEl = document.getElementById("latestResultSummary");
const currentLbBodyEl = document.getElementById("currentQuizLeaderboardBody");
const historyBodyEl = document.getElementById("myHistoryBody");

// optional right-side metrics (agar kabhi add kare)
const scoreEl = document.getElementById("latestScoreValue");
const accEl   = document.getElementById("latestAccuracyValue");
const rankEl  = document.getElementById("latestRankValue");
const timeEl  = document.getElementById("latestTimeValue");

// --- helpers ---

function formatDate(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    return d.toLocaleString();
  } catch {
    return isoString;
  }
}

function formatDuration(ms) {
  if (ms == null) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

// ======================================================
// 1) Latest Attempt + Current Quiz Leaderboard
// ======================================================

async function loadLatestAttemptAndLeaderboard() {
  try {
    // authFetch already JSON return karta hai + token laga deta hai
    const attempt = await authFetch("/api/quizzes/attempts/latest");

    if (!attempt || !attempt.id) {
      if (latestSummaryEl) {
        latestSummaryEl.innerHTML = `
          <p style="color:#94a3b8;font-size:0.9rem;">
You haven’t attempted any quiz yet. Your results will appear here once you take one.
          </p>`;
      }
      return;
    }

    renderLatestSummary(attempt);

    if (attempt.quizId) {
      await loadCurrentQuizLeaderboard(attempt.quizId);
    } else if (currentLbBodyEl) {
      currentLbBodyEl.innerHTML = `
        <tr>
          <td colspan="4" style="padding:0.8rem 0.75rem; color:#94a3b8;">
            Leaderboard data for this quiz isn’t available yet.
          </td>
        </tr>`;
    }
  } catch (err) {
    console.error("Failed to load latest attempt / leaderboard:", err);
    if (latestSummaryEl) {
      latestSummaryEl.innerHTML = `
        <p style="color:#f97373;font-size:0.9rem;">
          No leaderboard data is available for this quiz yet.
        </p>`;
    }
    if (currentLbBodyEl) {
      currentLbBodyEl.innerHTML = `
        <tr>
          <td colspan="4" style="padding:0.8rem 0.75rem; color:#f97373;">
            An error occurred while loading the leaderboard. Please try again later.
          </td>
        </tr>`;
    }
  }
}

function renderLatestSummary(attempt) {
  if (!latestSummaryEl) return;

  const title     = attempt.quizTitle || "Unknown Quiz";
  const submitted = formatDate(attempt.submittedAt);

  const total  = attempt.totalQuestions ?? "-";
  const score  = attempt.score != null ? attempt.score : "-";
  const correct = attempt.correctCount ?? "-";
  const wrong   = attempt.wrongCount ?? "-";
  const skipped = attempt.skippedCount ?? "-";

  let accuracy = "-";
  if (attempt.totalQuestions && attempt.correctCount != null) {
    const pct = (attempt.correctCount * 100) / attempt.totalQuestions;
    accuracy = `${pct.toFixed(1)}%`;
  }

  const timeStr = formatDuration(attempt.timeTakenMillis);

  latestSummaryEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:1.5rem; align-items:flex-start;">
      <div>
        <div style="font-weight:600; margin-bottom:0.25rem;">${title}</div>
        <div style="font-size:0.8rem; color:#94a3b8;">Submitted: ${submitted}</div>
        <div style="font-size:0.8rem; color:#a1a1aa; margin-top:0.5rem;">
          ✅ Correct: <span style="color:#bbf7d0;">${correct}</span>
          &nbsp;|&nbsp; ❌ Wrong: <span style="color:#fecaca;">${wrong}</span>
          &nbsp;|&nbsp; 🚩 Skipped: <span style="color:#e5e7eb;">${skipped}</span>
        </div>
      </div>

      <div style="display:flex; gap:1.5rem; font-size:0.85rem; text-align:right;">
        <div>
          <div style="color:#9ca3af;">Score</div>
          <div style="font-weight:600;">${score} / ${total}</div>
        </div>
        <div>
          <div style="color:#9ca3af;">Accuracy</div>
          <div style="font-weight:600;">${accuracy}</div>
        </div>
        <div>
          <div style="color:#9ca3af;">Time Taken</div>
          <div style="font-weight:600;">${timeStr}</div>
        </div>
      </div>
    </div>
  `;

  // optional metric spans
  setText(scoreEl, `${score} / ${total}`);
  setText(accEl, accuracy);
  setText(timeEl, timeStr);
  // rankEl abhi "-" rehne do (backend se rank nahi aa raha)
}



async function loadCurrentQuizLeaderboard(quizId) {
    if (!currentLbBodyEl) return;
  
    try {
      const entries = await authFetch(`/api/quizzes/${quizId}/leaderboard`);
  
      // 🔒 Jab tak host END nahi karega, backend empty list dega → yahan custom msg dikhega
      if (!Array.isArray(entries) || entries.length === 0) {
        currentLbBodyEl.innerHTML = `
          <tr>
            <td colspan="4" style="padding:0.8rem 0.75rem; color:#94a3b8;">
              Quiz rankings are not available yet. Waiting for the host to release them.
            </td>
          </tr>`;
        return;
      }
  
      currentLbBodyEl.innerHTML = entries
      .map((e) => {
        const t = formatDuration(e.timeTakenMillis);
        return `
          <tr>
            <td>${e.rank}</td>
            <td>${e.username}</td>
            <td>${e.score}</td>
            <td>${t}</td>
          </tr>`;
      })
      .join("");
    } catch (err) {
      console.error("Failed to load current quiz leaderboard:", err);
      currentLbBodyEl.innerHTML = `
        <tr>
          <td colspan="4" style="padding:0.8rem 0.75rem; color:#f97373;">
           Oops! The leaderboard couldn’t be loaded. Please try again.
          </td>
        </tr>`;
    }
  }
  
  /* 🔥 NEW: specific quizId se leaderboard load (host view ke liye) */
/* 🔥 specific quizId se leaderboard load (host view ke liye) */
async function loadLeaderboardForQuizId(quizId) {
    let quizTitle = `Quiz #${quizId}`;
    try {
      const quiz = await authFetch(`/api/quizzes/${quizId}`);
      if (quiz && quiz.title) {
        quizTitle = quiz.title;
      }
    } catch (e) {
      console.error("Failed to load quiz details for title:", e);
    }
  
    if (latestSummaryEl) {
      latestSummaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600; margin-bottom:0.25rem;">Result</div>
            <div style="font-size:0.9rem; color:#94a3b8;">
              ${quizTitle}
            </div>
          </div>
        </div>
      `;
    }
  
    await loadCurrentQuizLeaderboard(quizId);
  }

// ======================================================
// 2) My Quiz History
// ======================================================
async function loadMyHistory() {
    if (!historyBodyEl) return;
  
    try {
      // 🔥 Ab yaha AttemptHistoryItem[] aa raha hai
      const rows = await authFetch("/api/quizzes/attempts/history");
  
      if (!Array.isArray(rows) || rows.length === 0) {
        historyBodyEl.innerHTML = `
          <tr>
            <td colspan="6" style="padding:0.8rem 0.75rem; color:#94a3b8;">
              You don't have any quiz history yet.
            </td>
          </tr>`;
        return;
      }
  
      // Latest quizzes upar dikhane ke liye – higher quizId first
      rows.sort((a, b) => (b.quizId || 0) - (a.quizId || 0));
  
      historyBodyEl.innerHTML = rows
      .map((item, idx) => {
        const bestScore = item.bestScore != null ? item.bestScore : "-";
        const fastest   = item.fastestMs != null ? formatDuration(item.fastestMs) : "-";
        const bestRank  = item.bestRank != null ? item.bestRank : "-";
        const total     = item.totalAttempts ?? "-";
    
        return `
          <tr onclick="window.location.href='leaderboard.html?quizId=${item.quizId}'"
              style="cursor:pointer;">
            <td>${idx + 1}</td>
            <td>${item.quizTitle}</td>
            <td>${bestScore}</td>
            <td>${bestRank !== '-' ? `<span class='rank-badge'>#${bestRank}</span>` : '-'}</td>
            <td>${fastest !== '-' ? `<span class='time-badge'>${fastest}</span>` : '-'}</td>
            <td>${total}</td>
          </tr>`;
      })
      .join("");
    } catch (err) {
      console.error("Failed to load history:", err);
      historyBodyEl.innerHTML = `
        <tr>
          <td colspan="6" style="padding:0.8rem 0.75rem; color:#f97373;">
            We couldn't load your quiz history right now. Please try again later.
          </td>
        </tr>`;
    }

    document.querySelectorAll(".history-row").forEach(row => {
        row.addEventListener("click", () => {
          const quizId = row.getAttribute("data-quiz-id");
          if (quizId) {
            window.location.href = `leaderboard.html?quizId=${quizId}`;
          }
        });
      });
  }

// ======================================================
// init
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const quizIdFromUrl = params.get("quizId");


    document.addEventListener("click", (e) => {
        const row = e.target.closest(".history-row");
        if (!row) return;
      
        const quizId = row.getAttribute("data-quiz-id");
        if (!quizId) return;
      
        window.location.href = `leaderboard.html?quizId=${quizId}`;
      });
  
    // 👉 Agar URL me ?quizId=123 hai (host ne "View Results" se khola)
    if (quizIdFromUrl) {
  
      // 🔥 My Quiz History section hide karo
      if (historyBodyEl) {
        const historyCard =
          historyBodyEl.closest(".dashboard-card") ||
          historyBodyEl.closest(".card") ||
          historyBodyEl.closest("section") ||
          historyBodyEl.parentElement;
  
        if (historyCard) {
          historyCard.style.display = "none";
        }
      }
  
      loadLeaderboardForQuizId(quizIdFromUrl);
      return; // latest attempt + history skip
    }
  
    // normal user flow (latest attempt + usi quiz ka leaderboard)
    loadLatestAttemptAndLeaderboard();
    loadMyHistory();
  });