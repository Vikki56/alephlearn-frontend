// Fronted/js/academicGuard.js
import { authFetch } from "./api.js";

// Ye pages pe chalega: doubts, chat, quizzes, leaderboard
// Profile / dashboard pe include mat karo.

async function checkAcademicProfile() {
  try {
    const hasProfile = await authFetch("/api/profile/academic/has", {
      method: "GET"
    });

    if (!hasProfile) {
      showAcademicModal();
    }
  } catch (err) {
    console.error("Error while checking academic profile:", err);
  }
}

function showAcademicModal() {
  if (document.getElementById("ap-guard-modal")) return;

  document.body.classList.add("ap-modal-open");

  const backdrop = document.createElement("div");
  backdrop.id = "ap-guard-modal";
  backdrop.className = "ap-backdrop";

  backdrop.innerHTML = `
    <div class="ap-modal" role="dialog" aria-modal="true">
      <div class="ap-pill">
        <span>STREAM REQUIRED</span>
      </div>

      <div class="ap-icon-circle">
        <span>🎓</span>
      </div>

      <h2 class="ap-modal-title">Complete your academic profile first</h2>

      <p class="ap-modal-sub">
        Chat, Doubts, Quizzes & Leaderboard ka content
        aapke <strong>stream & specialization</strong> par depend karta hai.
      </p>

      <p class="ap-modal-highlight">
        Please select your class / degree → stream → specialization on the Profile page.
        Ye setting baad me change nahi ho paayegi.
      </p>

      <div class="ap-modal-actions">
        <button type="button" class="ap-btn-ghost" id="ap-cancel-btn">
          Back to Dashboard
        </button>
        <button type="button" class="ap-btn-primary" id="ap-go-profile-btn">
          Go to Profile &nbsp;↗
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  document.getElementById("ap-go-profile-btn").addEventListener("click", () => {
    window.location.href = "profile.html";
  });

  document.getElementById("ap-cancel-btn").addEventListener("click", () => {
    window.location.href = "index.html";
  });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      window.location.href = "profile.html";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body?.getAttribute("data-page");

  if (page === "profile" || page === "dashboard") return;

  checkAcademicProfile();
});