// ---- config ----
const API_BASE = "http://localhost:8080/api";
const TOKEN_KEY = "token";

const QUIZ_LOCK_PREFIX = "quizAttemptLocked_";

// ===== Anti-cheat globals =====
let violationCount = 0;
const MAX_WARNINGS = 3;
let lastViolationAt = 0;
const VIOLATION_COOLDOWN_MS = 2000; // 2s: ek hi action ke multiple events ko merge

function enterFullscreenSafe() {
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  }
}


// ---------- Text answer helpers (for fill-in-the-blank) ----------

// basic normalize: trim + lowercase
function normalizeBasic(text) {
  return (text || "").trim().toLowerCase();
}

// order-insensitive normalize (for formulas etc.)
function normalizeOrderInsensitive(text) {
  // saare non-alphanumeric ko space bana do
  let cleaned = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  // tokens leke sort kardo
  const tokens = cleaned
    .split(" ")
    .map(t => t.trim())
    .filter(Boolean)
    .sort();

  return tokens.join(" ");
}

// Levenshtein distance (small typo allow karne ke liye)
function levenshtein(a, b) {
  a = a || "";
  b = b || "";
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // delete
        dp[i][j - 1] + 1,      // insert
        dp[i - 1][j - 1] + cost // replace
      );
    }
  }
  return dp[m][n];
}

// FINAL smart compare: exact + typo + order-insensitive
function isSmartTextMatch(givenRaw, expectedRaw) {
  if (!givenRaw || !expectedRaw) return false;

  const given = normalizeBasic(givenRaw);
  const expected = normalizeBasic(expectedRaw);

  if (!given || !expected) return false;

  // 1) simple exact match
  if (given === expected) return true;

  // 2) small typo allow (distance <= 1)
  if (levenshtein(given, expected) <= 1) return true;

  // 3) order-insensitive (useful for "a + b" vs "b + a", "tcp protocol" vs "protocol tcp")
  const g2 = normalizeOrderInsensitive(givenRaw);
  const e2 = normalizeOrderInsensitive(expectedRaw);

  if (!g2 || !e2) return false;

  if (g2 === e2) return true;

  if (levenshtein(g2, e2) <= 1) return true;

  return false;
}

function setupAntiCheatGlobalListeners() {
  // 1) Copy / cut / right-click disable
  document.addEventListener("copy", (e) => {
    e.preventDefault();
    showToast("Copy is disabled during the quiz.", "warning");
  });

  document.addEventListener("cut", (e) => e.preventDefault());

  document.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // right-click & long-press menu
  });

  // 2) Common keyboard shortcuts (Ctrl/Cmd + C, X, S, U, A, P)
  document.addEventListener("keydown", async (e) => {
    const key = e.key.toLowerCase();

    // Prevent F12, Ctrl+Shift+I/J on desktop
    if (
      key === "f12" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === "i" || key === "j"))
    ) {
      e.preventDefault();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (["c", "x", "s", "p", "u", "a"].includes(key)) {
        e.preventDefault();
        showToast("Shortcuts are disabled during the quiz.", "warning");
      }
    }

    // Best-effort: PrintScreen (PC only)
    if (key === "printscreen") {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(""); // clear screenshot buffer
      } catch (_) {}
      showToast("Screenshots are restricted during the quiz.", "warning");
      return;
    }
  });

  // 3) Tab change / window blur detect
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      handleViolation("Tab hidden");
    }
  });

  window.addEventListener("blur", () => {
    handleViolation("Window blurred");
  });

  // 4) Fullscreen exit detect
  document.addEventListener("fullscreenchange", () => {
    const inFs = !!document.fullscreenElement;
    if (!inFs) {
      handleViolation("Fullscreen exited");
    }
  });

  // 5) When user returns to browser → force fullscreen again
  window.addEventListener("focus", () => {
    if (!document.fullscreenElement) {
      enterFullscreenSafe();
    }
  });
}

// Ek common handler: tab change / blur / fullscreen exit sab isse call karein
function handleViolation(reason) {
  const now = Date.now();
  if (now - lastViolationAt < VIOLATION_COOLDOWN_MS) return;
  lastViolationAt = now;

  violationCount++;

  if (violationCount < MAX_WARNINGS) {
    const warnNum = violationCount;
    const baseMsg =
      "Please stay in FULL-SCREEN and do not switch tabs/apps while the quiz is running.";
    const extra =
      reason === "Fullscreen exited"
        ? "\n\nClick 'Continue' to go back to full-screen."
        : "";

    appAlert(
      `Warning ${warnNum}/${MAX_WARNINGS}.\n\n${baseMsg}${extra}`,
      {
        title: "Focus lost",
        variant: "warning",
        okText: "Continue",
      }
    ).then(() => {
      // user wapas aaye → fullscreen enforce karo
      enterFullscreenSafe();
    });
  } else {
    // 3rd time → auto submit
    const submitBtn = document.getElementById("submitAttemptBtn");
    if (submitBtn && !submitBtn.disabled) {
      showToast("Too many focus changes. Submitting your quiz.", "error");
      submitBtn.click();
    }
  }
}

let gQuizIdGlobal = null;

function isQuizLockedForUser(quizId) {
  if (!quizId) return false;
  try {
    return localStorage.getItem(QUIZ_LOCK_PREFIX + quizId) === "true";
  } catch (_) {
    return false;
  }
}

function lockQuizForUser(quizId) {
  if (!quizId) return;
  try {
    localStorage.setItem(QUIZ_LOCK_PREFIX + quizId, "true");
  } catch (_) {}
}
function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
}
// ==== timer helpers ====
let attemptTimerId = null;

function clearAttemptTimer() {
  if (attemptTimerId !== null) {
    clearInterval(attemptTimerId);
    attemptTimerId = null;
  }
}


let attemptStatusPollId = null;

function clearAttemptStatusPoll() {
  if (attemptStatusPollId !== null) {
    clearInterval(attemptStatusPollId);
    attemptStatusPollId = null;
  }
}

// ---------- AlephLearn Global Dialog Helpers ----------
// ---- Toast helpers (shared) ----
function ensureToastRoot() {
    let root = document.getElementById("alephToastRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "alephToastRoot";
      root.className = "toast-root";
      document.body.appendChild(root);
    }
    return root;
  }
  
  
  /**
   * type: "info" | "success" | "error"
   */
  function showToast(message, type = "info") {
    const root = ensureToastRoot();
  
    const icon =
      type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️";
  
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-inner">
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" aria-label="Close">&times;</button>
      </div>
    `;
  
    root.appendChild(toast);
  
    const close = () => {
      toast.classList.add("toast-hide");
      toast.addEventListener(
        "transitionend",
        () => toast.remove(),
        { once: true }
      );
    };
  
    toast.querySelector(".toast-close").addEventListener("click", close);
  
    // auto hide
    setTimeout(close, 4500);
  }
function openAppDialogInternal({
    title = "AlephLearn",
    message = "",
    variant = "info", // "info" | "warning" | "success"
    okText = "OK",
    cancelText = "Cancel",
    showCancel = false,
  }) {
    const overlay = document.getElementById("appDialogOverlay");
    const dialog = document.getElementById("appDialog");
    const iconEl = document.getElementById("appDialogIcon");
    const titleEl = document.getElementById("appDialogTitle");
    const msgEl = document.getElementById("appDialogMessage");
    const okBtn = document.getElementById("appDialogOkBtn");
    const cancelBtn = document.getElementById("appDialogCancelBtn");
  
    if (!overlay || !dialog || !okBtn || !cancelBtn) {
      // safety fallback
      window.originAlert?.(message) ?? window.alert(message);
      return Promise.resolve(false);
    }
  
    // variant classes
    dialog.classList.remove("app-dialog--warning", "app-dialog--success");
    if (variant === "warning") dialog.classList.add("app-dialog--warning");
    if (variant === "success") dialog.classList.add("app-dialog--success");
  
    titleEl.textContent = title;
    msgEl.textContent = message;
  
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = showCancel ? "inline-flex" : "none";
  
    return new Promise((resolve) => {
      function cleanup(result) {
        overlay.classList.remove("is-open");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onOverlay);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
  
      function onOk(e) {
        e.stopPropagation();
        cleanup(true);
      }
  
      function onCancel(e) {
        e.stopPropagation();
        cleanup(false);
      }
  
      function onOverlay(e) {
        if (e.target === overlay && showCancel) {
          cleanup(false);
        }
      }
  
      function onKey(e) {
        if (e.key === "Escape" && showCancel) {
          cleanup(false);
        }
        if (e.key === "Enter") {
          cleanup(true);
        }
      }
  
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      overlay.addEventListener("click", onOverlay);
      document.addEventListener("keydown", onKey);
  
      // open with animation
      requestAnimationFrame(() => {
        overlay.classList.add("is-open");
      });
    });
  }
  
  // alert-style dialog
  function appAlert(message, options = {}) {
    return openAppDialogInternal({
      title: options.title || "AlephLearn",
      message,
      variant: options.variant || "info",
      okText: options.okText || "OK",
      showCancel: false,
    });
  }
  
  // confirm-style dialog (returns Promise<boolean>)
  function appConfirm(message, options = {}) {
    return openAppDialogInternal({
      title: options.title || "Are you sure?",
      message,
      variant: options.variant || "warning",
      okText: options.okText || "Yes",
      cancelText: options.cancelText || "Cancel",
      showCancel: true,
    });
  }
  
  // native alert override -> sabhi alert() yahi style use kare
  if (!window.originAlert) {
    window.originAlert = window.alert;
  }
  window.alert = function (message) {
    appAlert(String(message));
  };

function formatSeconds(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

function startAttemptTimer(totalSeconds) {
  clearAttemptTimer();

  const label = document.getElementById("quizTimerLabel");
  if (!label) return;

  let remaining = totalSeconds;
  label.textContent = formatSeconds(remaining);

  attemptTimerId = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearAttemptTimer();
      label.textContent = "Time over";
      const submitBtn = document.getElementById("submitAttemptBtn");
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
      }
      return;
    }
    label.textContent = formatSeconds(remaining);
  }, 1000);
}

// ---- placeholder (backup) ----
function buildPlaceholderQuestionsForQuiz(quiz) {
  return [
    {
      id: 1,
      text: `Sample Question 1 for "${quiz.title}"`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 0,
    },
  ];
}

// ==== pagination state (NEW) ====
const PAGE_SIZE = 10;             // ek page par kitne questions
let gQuiz = null;
let gQuestions = [];
let gIsRealtime = false;
let gDurationSeconds = null;
let gUserAnswers = [];
let gCurrentPage = 0;
let gTextAnswers = [];

function saveCurrentPageAnswers() {
  const container = document.getElementById("questionsPageContainer");
  if (!container || !gQuestions.length) return;

  const start = gCurrentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, gQuestions.length);

  for (let idx = start; idx < end; idx++) {
    const q = gQuestions[idx];

    // 🔹 Fill-in-the-blank (CODING type ko text answer treat kar rahe hain)
    if (q.type === "CODING" || q.type === "Coding") {
      const input = container.querySelector(`#fib_${idx}`);
      if (input) {
        gTextAnswers[idx] = input.value.trim();
      }
      continue;
    }

    // 🔹 Baaki – MCQ / TRUE_FALSE (radio)
    const checked = container.querySelector(`input[name="q${idx}"]:checked`);
    if (checked) {
      gUserAnswers[idx] = Number(checked.value);
    } else if (gUserAnswers[idx] === undefined) {
      gUserAnswers[idx] = null;
    }
  }
}

function renderQuestionsPage() {
    const container = document.getElementById("questionsPageContainer");
    const pageIndicator = document.getElementById("pageIndicator");
    if (!container || !gQuestions.length) return;
  
    const totalPages = Math.ceil(gQuestions.length / PAGE_SIZE) || 1;
    if (gCurrentPage < 0) gCurrentPage = 0;
    if (gCurrentPage > totalPages - 1) gCurrentPage = totalPages - 1;
  
    const start = gCurrentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, gQuestions.length);
  
    const html = gQuestions
    .slice(start, end)
    .map((q, localIdx) => {
      const idx = start + localIdx;
  
      // 🔹 CODING => Fill in the blank (single-line input)
      if (q.type === "CODING" || q.type === "Coding") {
        return `
          <div class="question-block" style="margin-bottom:1.5rem;">
            <div class="question-text" style="font-weight:600;margin-bottom:0.35rem;">
              ${idx + 1}. ${q.text}
            </div>
            <div class="fib-wrapper">
              <input
                id="fib_${idx}"
                type="text"
                autocomplete="off"
                spellcheck="false"
                class="fib-input"
                style="
                  width:100%;
                  padding:0.6rem 0.9rem;
                  border-radius:0.75rem;
                  border:1px solid rgba(129,140,248,0.5);
                  background:rgba(15,23,42,0.9);
                  color:#E5E7EB;
                  font-size:0.95rem;
                  outline:none;
                "
                placeholder="Type your answer here..."
              />
            </div>
          </div>
        `;
      }
  
      // 🔹 MCQ / TRUE_FALSE
      const opts = q.options
        .map(
          (opt, oi) => `
          <label class="option-row" style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.25rem;">
            <input type="radio" name="q${idx}" value="${oi}">
            <span>${opt}</span>
          </label>`
        )
        .join("");
  
      return `
        <div class="question-block" style="margin-bottom:1.5rem;">
          <div class="question-text" style="font-weight:600;margin-bottom:0.35rem;">
            ${idx + 1}. ${q.text}
          </div>
          <div class="options">${opts}</div>
        </div>`;
    })
    .join("");
  
    container.innerHTML = html;
  
 // restore user-selected options / text
for (let idx = start; idx < end; idx++) {
  const q = gQuestions[idx];

  if (q.type === "CODING" || q.type === "Coding") {
    const input = container.querySelector(`#fib_${idx}`);
    if (input && gTextAnswers[idx]) {
      input.value = gTextAnswers[idx];
    }
  } else {
    const chosen = gUserAnswers[idx];
    if (chosen != null) {
      const input = container.querySelector(
        `input[name="q${idx}"][value="${chosen}"]`
      );
      if (input) input.checked = true;
    }
  }
}
  
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${gCurrentPage + 1} of ${totalPages}`;
    }
  
    // ----- BUTTON VISIBILITY RULES -----
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
  
    // hide both when ≤ 10 questions
    if (gQuestions.length <= PAGE_SIZE) {
      prevBtn.style.display = "none";
      nextBtn.style.display = "none";
      return;
    }
  
    // Previous button only on pages >= 1
    if (gCurrentPage === 0) {
      prevBtn.style.display = "none";
    } else {
      prevBtn.style.display = "inline-flex";
    }
  
    // Next button only if NOT last page
    if (gCurrentPage >= totalPages - 1) {
      nextBtn.style.display = "none";
    } else {
      nextBtn.style.display = "inline-flex";
    }
  }

// ---- backend → FE normalize ----
function normalizeBackendQuestions(rawQuestions) {
  if (!rawQuestions || !rawQuestions.length) {
    return null;
  }

  return rawQuestions.map((q, idx) => {
    let options = [];
    if (Array.isArray(q.options) && q.options.length) {
      options = q.options;
    } else {
      options = [q.option1, q.option2, q.option3, q.option4].filter(
        (o) => o && o.length
      );
    }

    if (q.type === "TRUE_FALSE" && options.length === 0) {
      options = ["True", "False"];
    }

    return {
      id: q.id || idx + 1,
      text: q.text || "",
      type: q.type,
      options,
      correctIndex:
        typeof q.correctIndex === "number" ? q.correctIndex : 0,
      correctBool:
        typeof q.correctBool === "boolean" ? q.correctBool : null,
      codingAnswer: q.codingAnswer || null,
    };
  });
}

// ---- submit API ----
async function submitQuizScore(quizId, isRealtime, score) {
  const params = new URLSearchParams();
  params.set("isRealtime", isRealtime ? "true" : "false");
  if (typeof score === "number") {
    params.set("score", String(score));
  }

  const res = await fetch(
    `${API_BASE}/quizzes/${quizId}/submit?${params.toString()}`,
    {
      method: "POST",
      headers: getAuthHeaders(),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    console.error("Submit quiz failed:", t);
    throw new Error(t);
  }
}

// ---- realtime status API (for attempt page) ----
async function apiGetRealtimeStatus(quizId) {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}/status`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
  
    if (!res.ok) {
      const txt = await res.text();
      console.error("Status poll failed:", txt);
      throw new Error("Failed to get realtime status");
    }
  
    return await res.json(); // { status, joinedCount, remainingSeconds, ... }
  }


  function startAttemptStatusPolling(quizId) {
    clearAttemptStatusPoll();
  
    attemptStatusPollId = setInterval(async () => {
      try {
        // 1️⃣ Quiz ka status check (tumhara purana code)
        const status = await apiGetRealtimeStatus(quizId);
  
        if (status.status === "ENDED") {
          clearAttemptStatusPoll();
          clearAttemptTimer();
  
          // local lock – dubara join nahi kar sake
          lockQuizForUser(quizId);
  
          appAlert(
            "Host ne quiz end kar diya. Aapka attempt ab close ho chuka hai.",
            {
              title: "Quiz ended",
              variant: "warning",
              okText: "Back to quizzes",
            }
          ).then(() => {
            window.location.href = "quizzes.html";
          });
          return; // yahi se nikal jao
        }
  
        // 2️⃣ YAHAN PE KICK / BAN CHECK ADD KARO 👇
        const resp = await fetch(
          `${API_BASE}/quizzes/${quizId}/attempt/me`,
          {
            method: "GET",
            headers: getAuthHeaders(),
          }
        );
  
        if (resp.status === 404) {
          // attempt delete / realtime=false => host ne remove/ban kar diya
          clearAttemptStatusPoll();
          clearAttemptTimer();
          lockQuizForUser(quizId);
  
          appAlert(
            "You were removed by the host from this quiz.",
            {
              title: "Removed",
              variant: "warning",
              okText: "Back to quizzes",
            }
          ).then(() => {
            window.location.href = "quizzes.html";
          });
          return;
        }
  
        if (resp.status === 401) {
          // logged-out case
          window.location.href = "login.html";
          return;
        }
  
      } catch (e) {
        console.error("Attempt status poll error:", e);
      }
    }, 2000);
  }

// ---- quiz detail API ----
async function fetchQuizById(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Failed to load quiz by id:", txt);
    throw new Error("Failed to load quiz details");
  }

  return await res.json();
}

function closeQuizTakingModal() {
  clearAttemptTimer();
  // attempt page se wapas quizzes list pe bhej do
  window.location.href = "quizzes.html";
}

function showQuizResult(score, total, quizId) {
    const quizTakingContent = document.getElementById("quizTakingContent");
  
    quizTakingContent.innerHTML = `
      <div class="card" style="max-width:480px;margin:2rem auto;text-align:center;position:relative;">
  
        <!-- 🏆 TOP-RIGHT LEADERBOARD BUTTON -->
        <button id="viewLeaderboardBtn"
                class="result-leaderboard-btn"
                title="View leaderboard">
          🏆
        </button>
  
        <div class="card-header">
          <h2 class="card-title">
            <span>🏆</span>
            <span>Quiz Result</span>
          </h2>
        </div>
  
        <div style="padding:1.5rem;">
          <p style="font-size:1.1rem;margin-bottom:0.75rem;">
            Your score:
            <strong>${score}</strong> / <strong>${total}</strong>
          </p>
          <p style="color:#718096;margin-bottom:1.5rem;">
            Great job! Check leaderboard & attempts on the main page.
          </p>
          <button class="btn btn-primary" id="resultOkBtn">
            <span>✅</span>
            <span>Back to quizzes</span>
          </button>
        </div>
      </div>
    `;
  
    // Back button
    document.getElementById("resultOkBtn").addEventListener("click", () => {
      closeQuizTakingModal();
    });
  
// 🏆 Trophy icon → dedicated leaderboard page
const lbBtn = document.getElementById("viewLeaderboardBtn");
if (lbBtn && quizId) {
  lbBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();      // koi aur click handler interfere na kare
    window.location.href = `leaderboard.html?quizId=${quizId}`;
  });
}
  }

function renderQuizAttemptUI(quiz, overrideDurationSeconds = null) {
    const quizId = quiz.id || quiz.quizId;
    if (!quizId) {
      alert("Quiz ID missing in response.");
      return;
    }
    gQuizIdGlobal = quizId;
    const isRealtime =
      quiz.realtime === true || quiz.isRealtime === true;
  
    let questions = normalizeBackendQuestions(quiz.questions);
    if (!questions || !questions.length) {
      questions = buildPlaceholderQuestionsForQuiz(quiz);
    }
  
    // duration handling (same as before)
    const durationSeconds =
      overrideDurationSeconds !== null &&
      overrideDurationSeconds !== undefined
        ? overrideDurationSeconds
        : quiz.durationSeconds !== undefined && quiz.durationSeconds !== null
        ? quiz.durationSeconds
        : null;
  
    const difficultyLabel = quiz.difficulty || "";
    const quizTakingContent = document.getElementById("quizTakingContent");
  
    // ---- store globals for pagination ----
    gQuiz = quiz;
    gQuestions = questions;
    gIsRealtime = isRealtime;
    gDurationSeconds = durationSeconds;
    gUserAnswers = new Array(gQuestions.length).fill(null);
    gCurrentPage = 0;
    window.quizStartTime = Date.now();
    gTextAnswers = new Array(gQuestions.length).fill("");
  
    quizTakingContent.innerHTML = `
    <div class="quiz-attempt-wrapper">
  
      <div class="attempt-header attempt-header-clean">
        <div>
          <h2 class="card-title">
            <span>🧠</span> <span>${quiz.title}</span>
          </h2>
          <p class="quiz-desc">
            ${quiz.description || ""}
          </p>
        </div>
  
        <div style="text-align:right;">
          <span class="badge difficulty-${difficultyLabel.toLowerCase()}">
            ${difficultyLabel}
          </span>
  
          <div style="margin-top:6px;">
            Time:
            <strong id="quizTimerLabel">
              ${gDurationSeconds ? formatSeconds(gDurationSeconds) : "No limit"}
            </strong>
          </div>
  
          <div id="pageIndicator" style="margin-top:4px;"></div>
        </div>
      </div>
  
      <div style="padding-top:10px;">
        <div id="questionsPageContainer"></div>
      </div>
  
      <div class="attempt-footer">
        <button class="btn btn-secondary" id="cancelAttemptBtn">
          <span>✕</span> <span>Leave</span>
        </button>
  
        <button class="btn btn-secondary" id="prevPageBtn">
          <span>←</span> <span>Previous</span>
        </button>
  
        <button class="btn btn-secondary" id="nextPageBtn">
          <span>→</span> <span>Next</span>
        </button>
  
        <button class="btn btn-primary" id="submitAttemptBtn">
          <span>✅</span> <span>Submit Quiz</span>
        </button>
      </div>
  
    </div>
  `;
  
    // ---- button handlers ----
    document
    .getElementById("cancelAttemptBtn")
    .addEventListener("click", async () => {
      const params = new URLSearchParams(window.location.search);
      const quizId = params.get("id");
  
      const ok = await appConfirm(
        "Are you sure you want to leave the quiz? You won't be able to join again.",
        {
          title: "Leave quiz",
          okText: "Leave",
          cancelText: "Stay",
        }
      );
  
      if (!ok) return;
  
      clearAttemptTimer();
      clearAttemptStatusPoll();
  
      // lock – dubara join block
      lockQuizForUser(quizId);
  
      appAlert("You left the quiz. You cannot join again.", {
        title: "Quiz left",
        variant: "warning",
        okText: "OK",
      }).then(() => {
        window.location.href = "quizzes.html";
      });
    });
  
    document
      .getElementById("prevPageBtn")
      .addEventListener("click", () => {
        saveCurrentPageAnswers();
        gCurrentPage -= 1;
        renderQuestionsPage();
      });
  
    document
      .getElementById("nextPageBtn")
      .addEventListener("click", () => {
        saveCurrentPageAnswers();
        gCurrentPage += 1;
        renderQuestionsPage();
      });
  
      document
      .getElementById("submitAttemptBtn")
      .addEventListener("click", async () => {
    
        // Save last page answers
        saveCurrentPageAnswers();
    
        // calculate time taken
        const timeTaken = window.quizStartTime
          ? Date.now() - window.quizStartTime
          : null;
    
        // selected options array
        const selectedOptions = gUserAnswers.map(v =>
          v === undefined ? null : v
        );
        const textAnswers = gTextAnswers.slice();   // NEW
    
        try {
          // NEW API CALL
          await fetch(`${API_BASE}/quizzes/${gQuizIdGlobal}/attempt`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              selectedOptions: selectedOptions,
              textAnswers: textAnswers,        
              timeTakenMillis: timeTaken,
              realtime: gIsRealtime
            })
          });
    
          // lock user
          lockQuizForUser(gQuizIdGlobal);
    
          clearAttemptTimer();
          clearAttemptStatusPoll();
    
// local score (just for UI)
let score = 0;
gQuestions.forEach((q, i) => {
  // 🔹 Fill-in-the-blank (CODING type)
  if (q.type === "CODING" || q.type === "Coding") {
    const givenRaw = gTextAnswers[i] || "";
    if (!givenRaw) return;

    // Multiple acceptable answers: CSV in codingAnswer
    // Example: "O(1), constant, constant time"
    const expectedList = (q.codingAnswer || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (!expectedList.length) return;

    // Agar koi bhi expected smart-compare se match ho gaya → +1
    const matched = expectedList.some(exp => isSmartTextMatch(givenRaw, exp));
    if (matched) {
      score++;
    }

  } else {
    // 🔹 MCQ / TRUE_FALSE
    if (gUserAnswers[i] === q.correctIndex) score++;
  }
});
    
          showQuizResult(score, gQuestions.length, gQuizIdGlobal);
    
        } catch (err) {
          console.error(err);
          showToast("Failed to submit quiz.", "error");
        }
    });
  
    // ---- start timer as before ----
// ---- start timer as before ----
if (gDurationSeconds) {
  startAttemptTimer(gDurationSeconds);
} else {
  clearAttemptTimer();
}

// 🔁 realtime quiz hai to status polling bhi start karo
if (gIsRealtime) {
  startAttemptStatusPolling(quizId);
} else {
  clearAttemptStatusPoll();
}

// pehle questions render karo
renderQuestionsPage();

// 🔒 Full-screen consent popup
appAlert(
  "For a secure attempt, this quiz will run in FULL-SCREEN.\n\nClick 'Start quiz' to continue.",
  {
    title: "Enter full-screen mode",
    variant: "warning",
    okText: "Start quiz"
  }
).then(() => {
  // yeh .then user ke OK button ke click se hi trigger hoga
  enterFullscreenSafe();
});
  }

// ---- page init ----
document.addEventListener("DOMContentLoaded", async () => {
  setupAntiCheatGlobalListeners();
    const params = new URLSearchParams(window.location.search);
    const quizId = params.get("id");
    const isRealtimeParam = params.get("realtime") === "true";
    const remainingParam = params.get("remaining");
    const remainingSeconds = remainingParam ? Number(remainingParam) : null;
  
    if (!quizId) {
      showToast("Quiz id missing in URL.", "error");
      return;
    }
  
    // 🔒 already attempted / left → page pe hi block kar do (normal users)
    if (isQuizLockedForUser(quizId)) {
      alert("You have already responded to this quiz. You cannot join again.");
      window.location.href = "quizzes.html";
      return;
    }
  
    try {
      const quiz = await fetchQuizById(quizId);
  
      // 🛑 YAHAN HOST BLOCK DAALNA HAI
      if (quiz.host === true || quiz.isHost === true) {
        alert("Hosts cannot attempt their own quiz.");
        window.location.href = "quizzes.html";
        return;
      }
  
      quiz.realtime = isRealtimeParam || quiz.realtime || quiz.isRealtime;
      renderQuizAttemptUI(quiz, remainingSeconds);
    } catch (e) {
      console.error(e);
      showToast("Failed to load quiz.", "error");
    }
  });