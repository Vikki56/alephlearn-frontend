// quizzes.js  (type="module")

// ----------- CONFIG -------------

const API_BASE = "http://localhost:8080/api";
const TOKEN_KEY = "token"; // <- SAME as localStorage key

function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": "Bearer " + token } : {})
  };
}

// ---- Realtime participants (host view) ----
let realtimeParticipantsInterval = null;
let kickCheckInterval = null; 
let currentWaitingRoomIsHost = false; // kis view me ho: host ya participant

function stopRealtimeParticipantsPolling() {
  if (realtimeParticipantsInterval) {
    clearInterval(realtimeParticipantsInterval);
    realtimeParticipantsInterval = null;
  }
}
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
const QUIZ_LOCK_PREFIX = "quizAttemptLocked_";
const QUIZ_LOCK_REASON_PREFIX = "quizAttemptReason_"; // NEW

function lockQuizForUser(quizId, reason = "attempted") {
  if (!quizId) return;
  try {
    localStorage.setItem(QUIZ_LOCK_PREFIX + quizId, "true");
    localStorage.setItem(QUIZ_LOCK_REASON_PREFIX + quizId, reason);
  } catch (_) {}
}

function getQuizLockInfo(quizId) {
  if (!quizId) return { locked: false, reason: null };
  try {
    const locked =
      localStorage.getItem(QUIZ_LOCK_PREFIX + quizId) === "true";
    const reason =
      localStorage.getItem(QUIZ_LOCK_REASON_PREFIX + quizId) || null;
    return { locked, reason };
  } catch (_) {
    return { locked: false, reason: null };
  }
}

function isQuizLockedForUser(quizId) {
  return getQuizLockInfo(quizId).locked;
}

// export async function apiJoinRealtimeQuiz(quizId) {
//   const res = await fetch(`${API_BASE}/quizzes/${quizId}/join`, {
//     method: "POST",
//     headers: getAuthHeaders(),
//   });
//   return res.json();   // { mode: "WAITING" | "PENDING" | "ENDED" | "BANNED" }
// }

async function apiGetPendingUsers(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/realtime/pending`, {
    headers: getAuthHeaders(),
  });
  return res.json();
}

async function apiApproveUser(quizId, userId) {
  const res = await fetch(
    `${API_BASE}/quizzes/${quizId}/realtime/approve/${userId}`,
    {
      method: "POST",
      headers: getAuthHeaders(),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error("Approve user failed:", res.status, txt);
    return false;
  }
  return true;
}


// ek helper jo correct dialog dikhaye
function showQuizLockedDialog(quizId) {
  const { reason } = getQuizLockInfo(quizId);

  if (reason === "kicked") {
    return appAlert(
      "You were removed from this quiz by the host. You cannot rejoin.",
      {
        title: "Removed by host",
        variant: "warning",
        okText: "OK",
      }
    );
  }

  // default (attempted / finished / left)
  return appAlert(
    "You already responded to this quiz. You cannot join again.",
    {
      title: "Quiz locked",
      variant: "warning",
      okText: "OK",
    }
  );
}

const HIDDEN_PUBLIC_QUIZZES_KEY = "hiddenPublicQuizIds";

function loadHiddenPublicIds() {
  try {
    const raw = localStorage.getItem(HIDDEN_PUBLIC_QUIZZES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch (_) {
    return new Set();
  }
}

function saveHiddenPublicIds(set) {
  try {
    localStorage.setItem(
      HIDDEN_PUBLIC_QUIZZES_KEY,
      JSON.stringify([...set])
    );
  } catch (_) {}
}


function ensureGlobalLeaderboardButton() {
  // Yeh function intentionally empty rakho,
  // kyunki tumne floating trophy hata diya hai.
  // Isse error nahi aayega.
  return;
}





async function loadBannedUsers(quizId) {
  const box = document.getElementById("banned-users-box");
  const list = document.getElementById("banned-users-list");

  if (!box || !list) return;

  const bannedUsers = await apiGetBannedUsers(quizId);

  // ✅ HAMESHA box dikhao, chahe list empty ho
  box.classList.remove("hidden");
  list.innerHTML = "";

  if (!bannedUsers || bannedUsers.length === 0) {
    // empty state text
    list.innerHTML = `
      <div style="
        padding:8px 10px;
        font-size:13px;
        color:#9ca3af;
        text-align:center;
      ">
        No banned users yet.
      </div>
    `;
    return;
  }

  // ✅ yahan sahi property names use karo (userId, username)
  bannedUsers.forEach(u => {
    const row = document.createElement("div");
    row.style.cssText = `
      display:flex; justify-content:space-between;
      align-items:center; padding:10px;
      border-bottom:1px solid rgba(255,255,255,.08);
    `;
  
    row.innerHTML = `
      <span style="color:#fff; font-size:14px;">${u.username}</span>
      <button class="btn btn-small"
        style="padding:4px 10px; background:#4b5cff;"
        data-id="${u.userId}">
        Unban
      </button>
    `;
  
    row.querySelector("button").addEventListener("click", async () => {
      await apiUnbanUser(quizId, u.userId);
      showToast("User unbanned successfully", "success");
      loadBannedUsers(quizId);
    });
  
    list.appendChild(row);
  });
}



function renderParticipantList(participants, quizId) {
  const box = document.getElementById("participantListInner");
  const countLabel = document.getElementById("participantCountText");

  if (!box) return;

  box.innerHTML = "";

  // agar data array hi nahi aaya
  if (!Array.isArray(participants) || participants.length === 0) {
    box.innerHTML = `
      <div style="
            padding:0.85rem 0.9rem;
            font-size:0.85rem;
            color:#9ca3af;
            text-align:center;">
        No participants yet.
      </div>
    `;
    if (countLabel) countLabel.textContent = "0 joined";
    return;
  }

  if (countLabel) {
    countLabel.textContent = `${participants.length} joined`;
  }

  participants.forEach(p => {
    // ✅ yahan se ID ko safe tarike se nikaal rahe hain
    const participantId =
      p.userId ?? p.id ?? p.participantId ?? p.user_id ?? null;

    if (!participantId) {
      console.warn("Participant without id:", p);
      return; // skip karo
    }

    const displayName =
      p.username || p.name || p.fullName || p.email || `User ${participantId}`;

    // removable default: agar backend nahi bheje to true maan lo
    const removable = p.removable !== undefined ? p.removable : true;

    const row = document.createElement("div");
    row.className = "participant-row";
    row.style.cssText = `
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:0.65rem 0.9rem;
      border-bottom:1px solid #111827;
      font-size:0.9rem;
    `;

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";

    const nameEl = document.createElement("span");
    nameEl.textContent = displayName;
    nameEl.style.color = "#e5e7eb";
    nameEl.style.fontWeight = "500";

    if (p.email) {
      nameEl.title = p.email;
    }

    left.appendChild(nameEl);
    row.appendChild(left);

    if (removable) {
      const btn = document.createElement("button");
      btn.textContent = "Remove";
      btn.className = "btn btn-secondary";
      btn.style.fontSize = "0.8rem";
      btn.style.padding = "0.25rem 0.75rem";

      btn.addEventListener("click", async () => {
        const ok = await appConfirm(
          `Remove ${displayName} from quiz?`,
          {
            title: "Remove participant",
            okText: "Remove",
            cancelText: "Cancel",
          }
        );
        if (!ok) return;

        try {
          await fetch(
            `${API_BASE}/quizzes/${quizId}/realtime/participants/${participantId}`,
            {
              method: "DELETE",
              headers: getAuthHeaders(),
            }
          );
          showToast("Participant removed.", "success");
          // list ko dobara reload karo
          refreshParticipantsOnce(quizId);
        } catch (e) {
          console.error(e);
          showToast("Failed to remove participant.", "error");
        }
      });

      row.appendChild(btn);
    }

    box.appendChild(row);
  });
}


async function refreshParticipantsOnce(quizId) {
  try {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}/realtime/participants`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return;
    const participants = await res.json();
    renderParticipantList(participants, quizId);
  } catch (e) {
    console.error("Failed to load participants", e);
  }
}
// ------ Smooth page navigation helper ------
function navigateWithFade(url) {
  try {
    document.body.classList.add("page-fade-out");
  } catch (_) {
    // safety fallback: normal navigation
  }

  setTimeout(() => {
    window.location.href = url;
  }, 180); // 150–200ms is ideal
}


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

// ----------- DOM ELEMENTS -------------

const quizGrid = document.getElementById("quizGrid");           // public quizzes listing
const myQuizzesGrid = document.getElementById("myQuizzesGrid"); // "My Created Quizzes" section
const quizTitleInput = document.getElementById("quizTitle");
const quizDescInput = document.getElementById("quizDescription");
const quizDifficultySelect = document.getElementById("quizDifficulty");
const visibilityToggle = document.getElementById("visibilityToggle");
const publishQuizBtn = document.getElementById("publishQuizBtn");

const quizLinkBox = document.getElementById("quizLinkBox");
const quizShareLink = document.getElementById("quizShareLink");

const modeButtons = document.querySelectorAll(".tab-button")
const contentSections = document.querySelectorAll(".content-section");

// private-link modal elements
const quizTakingModal = document.getElementById("quizTakingModal");
const quizTakingContent = document.getElementById("quizTakingContent");
const visibilityLabel = document.getElementById("visibilityLabel");
const enterBulkDeleteBtn = document.getElementById("enterBulkDeleteBtn");
const bulkDeleteControls = document.getElementById("bulkDeleteControls");
const bulkSelectedCountSpan = document.getElementById("bulkSelectedCount");
const bulkDeleteConfirmBtn = document.getElementById("bulkDeleteConfirmBtn");
const bulkDeleteCancelBtn = document.getElementById("bulkDeleteCancelBtn");
const questionsList = document.getElementById("questionsList");
// const addQuestionBtn = document.getElementById("addQuestionBtn");


async function loadLeaderboard(quizId) {
  if (!quizId) return;

  const section = document.getElementById("leaderboardSection");
  const body = document.getElementById("leaderboardBody");
  if (!section || !body) return;

  try {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}/leaderboard`, {
      method: "GET",
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Failed to load leaderboard:", txt);
      showToast("Failed to load leaderboard.", "error");
      return;
    }

    const data = await res.json(); // array of LeaderboardEntryDto

    if (!data.length) {
      body.innerHTML = `<p style="color:#a0aec0;">No attempts yet.</p>`;
    } else {
      body.innerHTML = `
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
            ${data
              .map(
                (e) => `
              <tr>
                <td>${e.rank}</td>
                <td>${e.username}</td>
                <td>${e.score}</td>
                <td>${(e.timeTakenMillis / 1000).toFixed(1)}s</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;
    }

    section.style.display = "block";
  } catch (err) {
    console.error(err);
    showToast("Failed to load leaderboard.", "error");
  }
}


let questions = [];

function updateBulkSelectedCount() {
  bulkSelectedCountSpan.textContent = `${bulkSelectedIds.size} selected`;
}

let isPublicQuiz = true;  // default – toggle se change hoga
let currentAttemptTimerId = null;
let currentAttemptSecondsLeft = 0;
const quizDurationInput = document.getElementById("quizDuration");
let realtimePollId = null;
let bulkDeleteMode = false;
let bulkSelectedIds = new Set();


// Host must start quiz within 10 minutes
let hostStartCountdown = null;
const HOST_START_LIMIT = 10 * 60; 
const HOST_DEADLINE_PREFIX = "quizHostDeadline_";
// ---------- QUESTION BUILDER ----------
// ==== Nice popup / toast helper (quizzes page) ====

let quizToastHideTimer = null;

function showQuizToast(message, variant = "info") {
  let toast = document.getElementById("quizToast");
  if (!toast) {
    console.warn("quizToast element not found");
    alert(message); // emergency fallback
    return;
  }
// ---------- AlephLearn Global Dialog Helpers ----------

// ---- Toast helpers (shared) ----

  const iconEl = document.getElementById("quizToastIcon");
  const titleEl = document.getElementById("quizToastTitle");
  const msgEl = document.getElementById("quizToastMessage");
  const closeBtn = document.getElementById("quizToastClose");

  // variant → icon & title
  let title = "Notice";
  let icon = "🔔";

  if (variant === "success") {
    title = "Success";
    icon = "✅";
  } else if (variant === "error") {
    title = "Error";
    icon = "⚠️";
  } else if (variant === "warning") {
    title = "Warning";
    icon = "⚠️";
  }

  if (iconEl) iconEl.textContent = icon;
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  toast.classList.remove(
    "quiz-toast--success",
    "quiz-toast--error",
    "quiz-toast--warning"
  );
  if (variant === "success") toast.classList.add("quiz-toast--success");
  if (variant === "error") toast.classList.add("quiz-toast--error");
  if (variant === "warning") toast.classList.add("quiz-toast--warning");

  toast.classList.add("quiz-toast--visible");

  if (closeBtn && !closeBtn.dataset._bound) {
    closeBtn.addEventListener("click", () => {
      toast.classList.remove("quiz-toast--visible");
    });
    closeBtn.dataset._bound = "true";
  }

  if (quizToastHideTimer) clearTimeout(quizToastHideTimer);
  quizToastHideTimer = setTimeout(() => {
    toast.classList.remove("quiz-toast--visible");
  }, 3500);
}
// ---------- QUESTION BUILDER ----------

const addQuestionBtn = document.getElementById("addQuestionBtn");
const questionsContainer = document.getElementById("questionsContainer");
let questionCounter = 0;

if (addQuestionBtn && questionsContainer) {
  addQuestionBtn.addEventListener("click", () => {
    createQuestionCard();
  });

  // pehle se ek empty card de sakte ho (optional)
  // createQuestionCard();
}


function initLeaderboardFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const quizId = params.get("leaderboardId");
  if (!quizId) return;

  loadLeaderboard(quizId);
}
function collectQuestionsFromUI() {
  if (!questionsContainer) return [];

  const cards = questionsContainer.querySelectorAll(".question-card");
  const questions = [];

  let hasError = false;
  if (!cards.length) {
    showToast("Please add at least one question before publishing.");
    return null;           // publish flow yahin se ruk jayega
  }

  cards.forEach((card, idx) => {
    if (hasError) return;

    const qNum = idx + 1;


const type = card.dataset.type || "MULTIPLE_CHOICE";

const bodyMcq  = card.querySelector(".question-body--mcq");
const bodyTf   = card.querySelector(".question-body--tf");
const bodyCode = card.querySelector(".question-body--code");

if (type === "MULTIPLE_CHOICE") {
  const text = bodyMcq
    .querySelector(".question-text-input")
    .value.trim();

  const optionInputs = bodyMcq.querySelectorAll(".question-option-input");
  const options = Array.from(optionInputs).map((inp) => inp.value.trim());
  const filled = options.filter((o) => o.length > 0);

  const correctSelect = bodyMcq.querySelector(".question-correct-select");
  const correctIndex = Number(correctSelect.value) || 0;

  if (!text) {
    showToast(`Please enter question text for Q${qNum}`);
    bodyMcq.scrollIntoView({ behavior: "smooth", block: "center" });
    hasError = true;
    return;
  }

// 🔒 MCQ: All options required
if (filled.length < optionInputs.length) {
  showToast(`Q${qNum}: Please fill all options.`);
  bodyMcq.scrollIntoView({ behavior: "smooth", block: "center" });
  hasError = true;
  return;
}

  if (!options[correctIndex]) {
    showToast(`Q${qNum}: Correct option must not be empty.`);
    bodyMcq.scrollIntoView({ behavior: "smooth", block: "center" });
    hasError = true;
    return;
  }

  questions.push({
    type: "MULTIPLE_CHOICE",   // 🔥 backend enum
    text,
    options,
    correctIndex,
    correctBool: null,
    codingAnswer: null,
  });

} else if (type === "TRUE_FALSE") {
  const text = bodyTf
    .querySelector(".question-text-input")
    .value.trim();

  if (!text) {
    showToast(`Please enter statement for True/False Q${qNum}`);
    bodyTf.scrollIntoView({ behavior: "smooth", block: "center" });
    hasError = true;
    return;
  }

  const tfSelect = bodyTf.querySelector(".question-tf-correct-select");
  const val = tfSelect.value === "true";

  questions.push({
    type: "TRUE_FALSE",
    text,
    options: ["True", "False"],
    correctIndex: val ? 0 : 1,
    correctBool: val,
    codingAnswer: null,
  });

} else if (type === "CODING") {
  const text = bodyCode
    .querySelector(".question-text-input")
    .value.trim();
  const answerKey = bodyCode
    .querySelector(".question-code-answer-input")
    .value.trim();

  if (!text) {
    showToast(`Please enter problem statement for coding Q${qNum}`);
    bodyCode.scrollIntoView({ behavior: "smooth", block: "center" });
    hasError = true;
    return;
  }

  questions.push({
    type: "CODING",
    text,
    options: [],
    correctIndex: null,
    correctBool: null,
    codingAnswer: answerKey,
  });
}
  });

  if (hasError) {
    return null; // publishing stop
  }

  return questions;
}



function createQuestionCard(initial = {}, index = questionsContainer.children.length) {
  const card = document.createElement("div");
  card.className = "question-card";
  const qNumber = index + 1;

  const type = initial.type || "MULTIPLE_CHOICE"; // MCQ | TF | CODE

  const existingText = initial.text || "";
  const existingOptions = initial.options || ["", "", "", ""];
  const existingCorrect = Number.isInteger(initial.correctIndex)
    ? initial.correctIndex
    : 0;
  const existingAnswerKey = initial.answerKey || "";

  card.innerHTML = `
<div class="question-card-header">
  <div class="question-header-left">
    <div class="question-chip">Q${qNumber}</div>
  </div>
      <div class="question-type-wrap">
        <span class="question-type-label">Question type</span>
<select class="question-type-select">
  <option value="MULTIPLE_CHOICE">Multiple choice</option>
  <option value="TRUE_FALSE">True / False</option>
  <option value="CODING">Fill in the Blank</option>
</select>
      </div>

      <div class="question-actions">
        <button type="button" class="question-drag-handle" title="Drag to reorder">
          ⠿
        </button>
        <button type="button" class="question-delete-btn" title="Delete question">
          ✕
        </button>
      </div>
    </div>

    <!-- MCQ BODY -->
    <div class="question-body question-body--mcq">
      <textarea
        class="question-text-input"
        placeholder="Type your question here..."
      >${existingText}</textarea>

      <div class="question-options-row">
        <div class="question-option">
          <input
            type="text"
            class="question-option-input"
            data-option-index="0"
            value="${existingOptions[0] || ""}"
            placeholder="Option 1"
          />
        </div>
        <div class="question-option">
          <input
            type="text"
            class="question-option-input"
            data-option-index="1"
            value="${existingOptions[1] || ""}"
            placeholder="Option 2"
          />
        </div>
        <div class="question-option">
          <input
            type="text"
            class="question-option-input"
            data-option-index="2"
            value="${existingOptions[2] || ""}"
            placeholder="Option 3"
          />
        </div>
        <div class="question-option">
          <input
            type="text"
            class="question-option-input"
            data-option-index="3"
            value="${existingOptions[3] || ""}"
            placeholder="Option 4"
          />
        </div>
      </div>

      <div class="question-footer-row">
        <label class="question-correct-label">
          Correct answer:
          <select class="question-correct-select">
            <option value="0">Option 1</option>
            <option value="1">Option 2</option>
            <option value="2">Option 3</option>
            <option value="3">Option 4</option>
          </select>
        </label>
      </div>
    </div>

    <!-- TRUE / FALSE BODY -->
    <div class="question-body question-body--tf">
      <textarea
        class="question-text-input"
        placeholder="Type your statement here..."
      >${existingText}</textarea>

      <div class="question-footer-row">
        <label class="question-correct-label">
          Correct answer:
          <select class="question-tf-correct-select">
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      </div>
    </div>

    <!-- CODING BODY -->
    <div class="question-body question-body--code">
      <textarea
        class="question-text-input"
        placeholder="Describe the coding question / problem..."
      >${existingText}</textarea>

      <div class="question-footer-row code-footer">
        <label class="question-code-answer-label">
          Answer / expected output (optional)
          <textarea
            class="question-code-answer-input"
            placeholder="Write reference solution, expected output, or notes for manual evaluation..."
          >${existingAnswerKey}</textarea>
        </label>
      </div>
    </div>
  `;

  const deleteBtn = card.querySelector(".question-delete-btn");
const dragHandle = card.querySelector(".question-drag-handle");

  // set type select initial
  const typeSelect = card.querySelector(".question-type-select");
  typeSelect.value = type;

  // set existing correct values
  const mcqSelect = card.querySelector(".question-correct-select");
  if (mcqSelect) mcqSelect.value = String(existingCorrect);

  const tfSelect = card.querySelector(".question-tf-correct-select");
  if (tfSelect && initial.type === "TRUE_FALSE") {
    tfSelect.value = initial.correctIndex === 0 ? "true" : "false";
  }

  const codeAnswerInput = card.querySelector(".question-code-answer-input");
  if (codeAnswerInput && existingAnswerKey) {
    codeAnswerInput.value = existingAnswerKey;
  }

  // type switch helper
  function applyQuestionType(t) {
    // t ab backend enum hoga: MULTIPLE_CHOICE / TRUE_FALSE / CODING
    card.dataset.type = t;
  
    card.querySelectorAll(".question-body").forEach((body) => {
      body.style.display = "none";
    });
  
    if (t === "MULTIPLE_CHOICE") {
      card.querySelector(".question-body--mcq").style.display = "block";
    } else if (t === "TRUE_FALSE") {
      card.querySelector(".question-body--tf").style.display = "block";
    } else {
      card.querySelector(".question-body--code").style.display = "block";
    }
  }

  typeSelect.addEventListener("change", () => {
    applyQuestionType(typeSelect.value);
  });

  applyQuestionType(type);

  // delete
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
  
    const ok = await appConfirm("Delete this question?", {
      title: "Delete question",
      okText: "Delete",
    });
  
    if (!ok) return;
  
    card.remove();
    renumberQuestionPills();
  });

  // drag behaviour (tumhara existing helper)
  setupQuestionDrag(card);

  questionsContainer.appendChild(card);
  renumberQuestionPills();
}


function renumberQuestionPills() {
  const cards = questionsContainer.querySelectorAll(".question-card");
  cards.forEach((c, idx) => {
    const pill = c.querySelector(".question-chip");
    if (pill) pill.textContent = `Q${idx + 1}`;
  });
}

/* Drag & drop between cards */

/* Drag & drop between cards */

function setupQuestionDrag(card) {
  card.setAttribute("draggable", "true");

  card.addEventListener("dragstart", () => {
    card.classList.add("dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    renumberQuestionPills();
  });
}

if (questionsContainer) {
  questionsContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    const afterElement = getDragAfterQuestion(questionsContainer, e.clientY);
    const dragging = questionsContainer.querySelector(".question-card.dragging");
    if (!dragging) return;

    if (afterElement == null) {
      questionsContainer.appendChild(dragging);
    } else {
      questionsContainer.insertBefore(dragging, afterElement);
    }
  });
}

function getDragAfterQuestion(container, y) {
  const cards = [
    ...container.querySelectorAll(".question-card:not(.dragging)"),
  ];

  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  cards.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  });

  return closest.element;
}
// function reorderQuestions() {
//   const cards = [...questionsContainer.querySelectorAll(".question-card:not(.dragging)")];
//   const dragging = questionsContainer.querySelector(".question-card.dragging");

//   const afterElement = getDragAfterElement(questionsContainer, window.dragY);

//   if (!afterElement) {
//     questionsContainer.appendChild(dragging);
//   } else {
//     questionsContainer.insertBefore(dragging, afterElement);
//   }
// }
// function getDragAfterElement(container, y) {
//   const cards = [...container.querySelectorAll(".question-card:not(.dragging)")];

//   return cards.reduce((closest, child) => {
//     const box = child.getBoundingClientRect();
//     const offset = y - box.top - box.height / 2;
//     if (offset < 0 && offset > closest.offset) {
//       return { offset: offset, element: child };
//     } else {
//       return closest;
//     }
//   }, { offset: Number.NEGATIVE_INFINITY }).element;
// }

// if (questionsContainer) {
//   questionsContainer.addEventListener("dragover", (e) => {
//     e.preventDefault();
//     const afterElement = getDragAfterQuestion(questionsContainer, e.clientY);
//     const dragging = questionsContainer.querySelector(".question-card.dragging");
//     if (!dragging) return;

//     if (afterElement == null) {
//       questionsContainer.appendChild(dragging);
//     } else {
//       questionsContainer.insertBefore(dragging, afterElement);
//     }
//   });
// }

// function getDragAfterQuestion(container, y) {
//   const cards = [
//     ...container.querySelectorAll(".question-card:not(.dragging)"),
//   ];

//   let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

//   cards.forEach((child) => {
//     const box = child.getBoundingClientRect();
//     const offset = y - box.top - box.height / 2;
//     if (offset < 0 && offset > closest.offset) {
//       closest = { offset, element: child };
//     }
//   });

//   return closest.element;
// }



modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const mode = btn.dataset.mode; // "participate" | "create"
    contentSections.forEach(sec => sec.classList.remove("active"));

    if (mode === "participate") {
      document.getElementById("participate-section").classList.add("active");
    } else if (mode === "create") {
      document.getElementById("create-section").classList.add("active");
    }
  });
});



function updateWaitingRoomMessage(statusValue, isHost) {
  const msgEl = document.querySelector(".waiting-message-text");
  if (!msgEl) return;

  let msg = "";

  if (statusValue === "WAITING") {
    msg = isHost
      ? "You are the host – start the quiz when everyone is ready."
      : "Waiting for the host to start the quiz…";
  } else if (statusValue === "LIVE") {
    msg = isHost
      ? "Quiz is LIVE. Participants are attempting the quiz."
      : "Quiz is LIVE. Host may start your attempt any moment.";
  } else if (statusValue === "COMPLETED" || statusValue === "ENDED") {
    msg = isHost
      ? "Quiz is over. You can now view the results."
      : "This quiz has ended. You can’t attempt it anymore.";
  } else {
    msg = "";
  }

  msgEl.textContent = msg;
}
// function renderQuestions() {
//   questionsList.innerHTML = "";

//   if (!questions.length) {
//     questionsList.innerHTML = `
//       <p style="color:#6b7280; font-size:0.9rem; margin-bottom:0.75rem;">
//         No questions added yet. Click <strong>"+ Add Question"</strong> to start.
//       </p>`;
//     return;
//   }

//   questions.forEach((q, index) => {
//     const card = document.createElement("div");
//     card.className = "question-card";

//     card.innerHTML = `
//       <div class="question-card-header">
//         <span class="question-index">Q${index + 1}</span>
//         <button class="question-remove-btn" data-index="${index}">Remove</button>
//       </div>

//       <div class="form-group">
//         <label class="form-label">Question Text</label>
//         <textarea class="form-input q-text" rows="2" data-index="${index}"></textarea>
//       </div>

//       <div class="options-grid">
//         ${["A","B","C","D"].map((label, optIdx) => `
//           <div class="option-item">
//             <label class="form-label small-label">Option ${label}</label>
//             <input type="text"
//                    class="form-input q-option"
//                    data-index="${index}"
//                    data-opt="${optIdx}" />
//             <label class="correct-pill">
//               <input type="radio"
//                      name="correct-${index}"
//                      class="q-correct"
//                      data-index="${index}"
//                      value="${optIdx}" />
//               Correct
//             </label>
//           </div>
//         `).join("")}
//       </div>
//     `;

//     questionsList.appendChild(card);

//     // populate values
//     card.querySelector(".q-text").value = q.text;
//     card.querySelectorAll(".q-option").forEach(input => {
//       const optIdx = Number(input.dataset.opt);
//       input.value = q.options[optIdx] ?? "";
//     });
//     card.querySelectorAll(".q-correct").forEach(r => {
//       r.checked = Number(r.value) === q.correctIndex;
//     });

//     // listeners
//     card.querySelector(".q-text").addEventListener("input", (e) => {
//       questions[index].text = e.target.value;
//     });

//     card.querySelectorAll(".q-option").forEach(input => {
//       input.addEventListener("input", (e) => {
//         const optIdx = Number(e.target.dataset.opt);
//         questions[index].options[optIdx] = e.target.value;
//       });
//     });

//     card.querySelectorAll(".q-correct").forEach(radio => {
//       radio.addEventListener("change", (e) => {
//         questions[index].correctIndex = Number(e.target.value);
//       });
//     });

//     card.querySelector(".question-remove-btn").addEventListener("click", () => {
//       questions.splice(index, 1);
//       renderQuestions();
//     });
//   });
// }


if (visibilityToggle && visibilityLabel) {
  visibilityToggle.addEventListener("click", () => {
    visibilityToggle.classList.toggle("active");
    isPublicQuiz = !isPublicQuiz;

    visibilityLabel.textContent = isPublicQuiz
      ? "Public Quiz (Anyone can access)"
      : "Private Quiz (Only via link)";
  });
}


async function apiEndQuizForCard(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/end`, {
    method: "POST",
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Failed to end quiz:", txt);
    throw new Error("Failed to end quiz");
  }
}
// ---- Realtime polling ----
let realtimePollHandle = null;

function startRealtimeStatusPolling(quiz, isHost) {
  const quizId = quiz.id || quiz.quizId;
  if (!quizId) return;

  // purana interval clear
  if (realtimePollHandle) {
    clearInterval(realtimePollHandle);
  }

  realtimePollHandle = setInterval(async () => {
    try {
      const status = await apiGetRealtimeStatus(quizId);
      // backend se: { quizStatus, joinedCount, remainingSeconds } ya similar
      // tumhare RealtimeStatusResponse ke fields ke naam check kar lena:
      // yaha assume kar raha hoon: { status, joinedCount, remainingSeconds }

      const statusTextEl = document.getElementById("realtimeStatusText");
      const joinedTextEl = document.getElementById("realtimeJoinedText");

      if (statusTextEl) {
        statusTextEl.textContent = `Status: ${status.status}`;
      }
      if (joinedTextEl) {
        joinedTextEl.textContent = `Participants joined: ${status.joinedCount}`;
      }
      updateWaitingRoomMessage(status.status, isHost);
      // QUIZ LIVE ho gayi
       // QUIZ LIVE ho gayi
// QUIZ LIVE ho gayi
if (status.status === "LIVE") {
  // host ka countdown band
  if (isHost && hostStartCountdown) {
    clearInterval(hostStartCountdown);
    hostStartCountdown = null;
    const tEl = document.getElementById("hostStartTimerText");
    if (tEl) tEl.style.display = "none";
  }

  // ⭐ Participant ke liye: sirf APPROVED hone par hi redirect
  if (!isHost) {
    try {
      const stateRes = await fetch(
        `${API_BASE}/quizzes/${quizId}/join-state`,
        { headers: getAuthHeaders() }
      );

      if (stateRes.ok) {
        const data = await stateRes.json(); // { state: "NONE" | "PENDING" | "APPROVED" | "BANNED" }

        if (data.state === "APPROVED") {
          // ab attempt ready hai → quiz page
          clearInterval(realtimePollHandle);
          navigateWithFade(`quiz_attempt.html?id=${quizId}&realtime=true`);
        }else if (data.state === "PENDING") {
          // ✅ Quiz LIVE hai, par host ne abhi allow nahi kiya
          const msgEl = document.querySelector(
            "#quizTakingContent .quiz-modal-subtext"
          );
          if (msgEl) {
            msgEl.textContent =
              "🔴 Quiz is LIVE. You’re in waiting room now. Host will approve you soon...";
          }
        }
        // PENDING / NONE / BANNED => waiting room me hi rehne do
      }
    } catch (e) {
      console.error("Failed to check join-state while LIVE:", e);
    }
  }
}

// QUIZ ENDED ya COMPLETED (expire)
if (status.status === "ENDED" || status.status === "COMPLETED") {
  clearInterval(realtimePollHandle);

  if (isHost && hostStartCountdown) {
    clearInterval(hostStartCountdown);
    hostStartCountdown = null;
    const tEl = document.getElementById("hostStartTimerText");
    if (tEl) {
      tEl.style.display = "block";
      tEl.textContent = "Quiz expired. You can’t start it anymore.";
    }
    const startBtn = document.getElementById("startRealtimeQuizBtn");
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.5";
    }
  } else {
    showToast("Quiz expired / ended.", "warning");
    closeQuizTakingModal();
  }
}
    } catch (err) {
      console.error("Realtime poll error:", err);
    }
  }, 2000); // har 2 sec me poll
}


// ----------- CREATE QUIZ (PUBLIC / PRIVATE) -------------

publishQuizBtn.addEventListener("click", async () => {
  const title = quizTitleInput.value.trim();
  const description = quizDescInput.value.trim();
  const diffValue = quizDifficultySelect.value || "easy";

  if (!title) {
    showQuizToast("Please enter quiz title.", "warning");
    return;
  }

  const difficulty = diffValue.toUpperCase();

  let durationSeconds = null;
  if (quizDurationInput && quizDurationInput.value) {
    const mins = Number(quizDurationInput.value);
    if (!Number.isNaN(mins) && mins > 0) {
      durationSeconds = mins * 60;
    }
  }

  const questions = collectQuestionsFromUI();
  if (questions === null) {
    publishQuizBtn.disabled = false;
    publishQuizBtn.innerHTML = `<span>🚀</span> <span>Publish Quiz</span>`;
    return;
  }

  const payload = {
    title,
    description,
    difficulty,
    public: isPublicQuiz,
    realtime: true,
    durationSeconds,
    questions,
  };

  try {
    publishQuizBtn.disabled = true;
    publishQuizBtn.textContent = "Publishing...";

    const res = await fetch(`${API_BASE}/quizzes`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Create quiz failed:", errText);
      showQuizToast("Failed to publish quiz. Check console for details.", "error");
      return;
    }

    const data = await res.json();
    console.log("Quiz created:", data);

    // 🔥 Backend kabhi `id` kabhi `quizId` bhej sakta hai
    const createdQuizId =
      data.id != null ? data.id : data.quizId != null ? data.quizId : null;

    // 🔥 joinCode ke sab possible naam cover karo
    const createdJoinCode =
      data.joinCode || data.code || data.privateCode || data.quizCode || null;

    if (createdQuizId != null) {
      // host deadline storage (realtime)
      localStorage.setItem(`quizHostCreatedAt_${createdQuizId}`, String(Date.now()));
    }

    if (createdQuizId != null && createdJoinCode) {
      // sahi key se store karo -> quizJoinCode_<quizId>
      localStorage.setItem(`quizJoinCode_${createdQuizId}`, createdJoinCode);
    }

    // reset form inputs
    quizTitleInput.value = "";
    quizDescInput.value = "";
    quizDifficultySelect.value = "easy";
    if (quizDurationInput) quizDurationInput.value = "";

    // questions UI clear
    if (questionsContainer) {
      questionsContainer.innerHTML = "";
      questionCounter = 0;
    }

    const isPublicCreated = data.public === true || data.isPublic === true;

    if (isPublicCreated) {
      // 🔹 PUBLIC + REALTIME QUIZ → directly open waiting room
      quizLinkBox.style.display = "none";
      quizShareLink.textContent = "";
    
      try {
        const fullQuiz = await fetchQuizById(createdQuizId);
    
        openRealtimeWaitingRoom({
          ...fullQuiz,
          host: true,
          isHost: true,
        });
    
        showQuizToast(
          "Public realtime quiz created. Waiting room opened!",
          "success"
        );
      } catch (e) {
        console.error("Failed to open waiting room after public create:", e);
        showQuizToast(
          "Public quiz created! Open it from 'My quizzes' to manage.",
          "warning"
        );
      }
    
      await loadPublicQuizzes();
    } else {
      // 🔹 PRIVATE + REALTIME QUIZ
    
      quizLinkBox.style.display = "none";
      quizShareLink.textContent = "";
    
      if (!createdQuizId) {
        showQuizToast(
          "Quiz created but ID missing. Open it from 'My quizzes'.",
          "warning"
        );
        return;
      }
    
      try {
        const fullQuiz = await fetchQuizById(createdQuizId);
    
        openRealtimeWaitingRoom({
          ...fullQuiz,
          id: createdQuizId,
          joinCode: createdJoinCode || fullQuiz.joinCode,
          host: true,
          isHost: true,
        });
    
        showQuizToast(
          "Private realtime quiz created. Waiting room opened!",
          "success"
        );
      } catch (e) {
        console.error("Failed to open waiting room after create:", e);
        showQuizToast(
          "Private quiz created! Open it from 'My quizzes' to manage.",
          "warning"
        );
      }
    }
  } catch (err) {
    console.error(err);
    showToast("Error while publishing quiz.");
  } finally {
    publishQuizBtn.disabled = false;
    publishQuizBtn.innerHTML = `<span>🚀</span> <span>Publish Quiz</span>`;
  }
});


function collectQuestionsFromDOM() {
  if (!questionsContainer) return [];

  const cards = [...questionsContainer.querySelectorAll(".question-card")];
  if (!cards.length) {
    throw new Error("Please add at least one question before publishing.");
  }

  const questions = [];

  cards.forEach((card, idx) => {
    const qText = card
      .querySelector(".question-textarea")
      ?.value.trim();

    const optionInputs = [
      ...card.querySelectorAll(".option-input"),
    ];
    const radios = [...card.querySelectorAll(".correct-radio")];

    if (!qText) {
      throw new Error(`Question ${idx + 1} is empty.`);
    }
    const options = [];
    let correctCount = 0;

    optionInputs.forEach((input, i) => {
      const text = input.value.trim();
      if (!text) return; // empty option skip

      const isCorrect = radios[i]?.checked;
      if (isCorrect) correctCount += 1;

      options.push({
        text,
        correct: !!isCorrect,
      });
    });

    if (options.length < 4) {
      throw new Error(
        `Question ${idx + 1} must have at least 4 non-empty options.`
      );
    }

    if (correctCount !== 1) {
      throw new Error(
        `Question ${idx + 1} must have exactly one correct option.`
      );
    }

    questions.push({
      text: qText,
      options,
    });
  });

  return questions;
}

function showQuizResult(score, total) {
  quizTakingContent.innerHTML = `
  <div class="card" style="position: relative;">
      
      <!-- 🏆 TOP-RIGHT BUTTON -->
      <button id="viewLeaderboardBtn"
              class="result-leaderboard-btn"
              title="View leaderboard">🏆</button>
      <div class="card-header">
        <h2 class="card-title">
          <span>🏆</span>
          <span>Quiz Result</span>
        </h2>
      </div>

      <div class="card-body" style="text-align:center;">
        <p style="font-size:1.05rem; margin-bottom:0.5rem;">
          Your score:
          <strong>${score}</strong> / <strong>${total}</strong>
        </p>
        <p class="quiz-modal-subtext" style="margin-bottom:1.3rem;">
          Nice work! You can view detailed attempts & leaderboard on the main page.
        </p>
      </div>

      <div class="card-footer">
        <button class="btn btn-primary" id="resultOkBtn">
          <span>✅</span>
          <span>Back to quizzes</span>
        </button>
      </div>
    </div>
  `;
// 🏆 Leaderboard button → open quizzes.html leaderboard mode
document.getElementById("viewLeaderboardBtn")?.addEventListener("click", () => {
  window.location.href = `quizzes.html?leaderboardId=${lastQuizId}`;
});
  quizTakingModal.style.display = "flex";

  document
    .getElementById("resultOkBtn")
    .addEventListener("click", () => {
      closeQuizTakingModal();
    });
}

// ----------- LOAD PUBLIC QUIZZES -------------

async function loadPublicQuizzes() {
  try {
    const res = await fetch(`${API_BASE}/quizzes/public`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      console.error("Failed to load public quizzes:", await res.text());
      return;
    }

    const quizzes = await res.json();
    renderPublicQuizzes(quizzes);
  } catch (err) {
    console.error("Error loading public quizzes:", err);
  }
}



async function checkKickStatus(quizId) {
  try {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}/attempt/me`, {
      headers: getAuthHeaders(),
    });

    if (res.status === 404) {
      // ✅ host ne remove kar diya (banned)
      if (kickCheckInterval) {
        clearInterval(kickCheckInterval);
        kickCheckInterval = null;
      }
      stopRealtimeParticipantsPolling();

      await appAlert(
        "You were removed from this quiz by the host. You cannot join again unless the host allows you.",
        {
          title: "Removed by host",
          variant: "warning",
          okText: "OK",
        }
      );

      navigateWithFade("quizzes.html");
      return;
    }

    // 200 OK -> attempt still exists, kuch mat karo
  } catch (err) {
    console.error("Kick-check failed", err);
  }
}
function renderPublicQuizzes(quizzes) {
  const hiddenIds = loadHiddenPublicIds();
  const visibleQuizzes = (quizzes || []).filter(
    q => !hiddenIds.has(String(q.id))
  );

  if (!visibleQuizzes.length) {
    quizGrid.innerHTML = `
      <div class="empty-state">
        <h3>No public quizzes yet</h3>
        <p>Use the "Create Quiz" tab above to publish your first quiz.</p>
      </div>`;
    return;
  }

  quizGrid.innerHTML = "";

  visibleQuizzes.forEach(q => {
    const isRealtime =
      q.realtime === true || q.isRealtime === true;
    const isPublic =
      q.isPublic === true || q.public === true;

    const card = document.createElement("div");
    card.className = "quiz-card";
    card.dataset.id = q.id;

    if (bulkDeleteMode) {
      card.classList.add("bulk-selectable");
      if (bulkSelectedIds.has(String(q.id))) {
        card.classList.add("selected-for-delete");
      }
    }

    card.innerHTML = `
      <div class="quiz-card-inner">
        <div class="quiz-card-top">
          <div class="quiz-title-row">
            <h3 class="quiz-title">${q.title}</h3>
            <span class="quiz-difficulty diff-${q.difficulty.toLowerCase()}">
              ${q.difficulty}
            </span>
          </div>
          <p class="quiz-desc">${q.description || ""}</p>
        </div>

        <div class="quiz-card-bottom">
          <div class="quiz-meta">
            <span class="quiz-type-pill">
              ${isPublic ? "Public" : "Private"}
            </span>
            ${
              isRealtime
                ? `<span class="quiz-type-pill quiz-type-pill--live">Realtime</span>`
                : `<span class="quiz-type-pill">Standard</span>`
            }
          </div>
          <button class="quiz-btn ${isRealtime ? "manage-realtime-btn" : "attempt-btn"}"
                  data-id="${q.id}">
            ▶ ${isRealtime ? "Waiting Room" : "Attempt"}
          </button>
        </div>
      </div>
    `;

    quizGrid.appendChild(card);
  });

  // bulk–selection mode
  quizGrid.querySelectorAll(".quiz-card").forEach(cardEl => {
    const id = cardEl.dataset.id;

    cardEl.addEventListener("click", e => {
      if (!bulkDeleteMode) return;
      if (e.target.closest("button")) return;

      const key = String(id);
      if (bulkSelectedIds.has(key)) {
        bulkSelectedIds.delete(key);
        cardEl.classList.remove("selected-for-delete");
      } else {
        bulkSelectedIds.add(key);
        cardEl.classList.add("selected-for-delete");
      }
      updateBulkSelectedCount();
    });
  });

  // normal buttons jab bulk mode OFF ho
  if (!bulkDeleteMode) {
    quizGrid.querySelectorAll(".manage-realtime-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const quizId = btn.getAttribute("data-id");
        const quiz = quizzes.find(q => String(q.id) === String(quizId));
        if (!quiz) return;

        const isHost = quiz.host === true || quiz.isHost === true;

        if (!isHost) {
          try {
            const status = await apiGetRealtimeStatus(quizId);
            if (status.status === "ENDED" || status.status === "COMPLETED") {
              await appAlert("This quiz has already ended.", {
                title: "Quiz ended",
                variant: "warning",
                okText: "OK"
              });
              return;
            }
          } catch (err) {
            console.error("Failed to check quiz status before join:", err);
            showToast("Unable to join this quiz right now.", "error");
            return;
          }
        }

        if (!isHost && isQuizLockedForUser(quizId)) {
          showQuizLockedDialog(quizId);
          return;
        }

        try {
          await apiJoinRealtimeQuiz(quiz.id);
        } catch (e) {
          console.error("Failed to join realtime quiz", e);
          showQuizToast("Unable to join realtime quiz. Please login first.", "error");
          return;
        }

        let fullQuiz;
        try {
          fullQuiz = await fetchQuizById(quiz.id || quiz.quizId);
        } catch (err) {
          console.error("Failed to fetch full quiz details:", err);
          fullQuiz = quiz;
        }

        openRealtimeWaitingRoom({
          ...fullQuiz,
          ...(isHost ? { host: true, isHost: true } : {})
        });
      });
    });

    quizGrid.querySelectorAll(".attempt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const quizId = btn.getAttribute("data-id");
        if (!quizId) return;
        navigateWithFade(`quiz_attempt.html?id=${quizId}`);
      });
    });
  }
}


// ----------- LOAD MY CREATED QUIZZES -------------

async function loadMyQuizzes() {
  if (!myQuizzesGrid) return;

  try {
    const res = await fetch(`${API_BASE}/quizzes/mine`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      console.error("Failed to load my quizzes:", await res.text());
      return;
    }

    const quizzes = await res.json();
    renderMyQuizzes(quizzes);
  } catch (err) {
    console.error("Error loading my quizzes:", err);
  }
}

function renderMyQuizzes(quizzes) {
  const visible = (quizzes || []).filter(q => q.status !== "ENDED");

  if (!visible.length) {
    myQuizzesGrid.innerHTML = `
      <div class="empty-state">
        <h3>You haven't created any quizzes yet</h3>
        <p>Click the "Create Quiz" tab above to add your first quiz.</p>
      </div>`;
    return;
  }

  myQuizzesGrid.innerHTML = "";

  visible.forEach(q => {
    const isRealtime = true; // tumhari app me hamesha realtime
    const isPublic   = q.isPublic === true || q.public === true;

    const card = document.createElement("div");
    card.className = "quiz-card";
    card.dataset.id = q.id;

    if (bulkDeleteMode) {
      card.classList.add("bulk-selectable");
      if (bulkSelectedIds.has(String(q.id))) {
        card.classList.add("selected-for-delete");
      }
    }

    card.innerHTML = `
      <div class="quiz-card-inner">
        <div class="quiz-card-top">
          <div class="quiz-title-row">
            <h3 class="quiz-title">${q.title}</h3>
            <span class="quiz-difficulty diff-${q.difficulty.toLowerCase()}">
              ${q.difficulty}
            </span>
          </div>
          <p class="quiz-desc">${q.description || ""}</p>
        </div>

        <div class="quiz-card-bottom">
          <div class="quiz-meta">
            <span class="quiz-type-pill">
              ${isPublic ? "Public" : "Private"}
            </span>
            <span class="quiz-type-pill quiz-type-pill--live">
              Realtime
            </span>
          </div>

          <div class="quiz-card-actions">
            <button class="quiz-btn manage-realtime-btn" data-id="${q.id}">
              ▶ Waiting Room
            </button>
            ${
              q.status === "ENDED"
                ? `<button class="quiz-btn view-leaderboard-btn" data-id="${q.id}">
                     🏆 View Results
                   </button>`
                : ""
            }
          </div>
        </div>
      </div>
    `;

    myQuizzesGrid.appendChild(card);
  });

  // bulk select
  myQuizzesGrid.querySelectorAll(".quiz-card").forEach(cardEl => {
    const id = cardEl.dataset.id;

    cardEl.addEventListener("click", e => {
      if (!bulkDeleteMode) return;
      if (e.target.closest("button")) return;

      const key = String(id);
      if (bulkSelectedIds.has(key)) {
        bulkSelectedIds.delete(key);
        cardEl.classList.remove("selected-for-delete");
      } else {
        bulkSelectedIds.add(key);
        cardEl.classList.add("selected-for-delete");
      }
      updateBulkSelectedCount();
    });
  });

  if (!bulkDeleteMode) {
    myQuizzesGrid.querySelectorAll(".manage-realtime-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const quizId = btn.getAttribute("data-id");
        const quiz = visible.find(q => String(q.id) === String(quizId));
        if (!quiz) return;

        try {
          await apiJoinRealtimeQuiz(quiz.id);
        } catch (err) {
          console.error("Failed to join realtime quiz as host", err);
          showToast("Unable to join realtime quiz.");
          return;
        }

        const fullQuiz = await fetchQuizById(quiz.id || quiz.quizId);
        openRealtimeWaitingRoom({ ...fullQuiz, host: true, isHost: true });
      });
    });

    myQuizzesGrid.querySelectorAll(".view-leaderboard-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const quizId = btn.getAttribute("data-id");
        window.location.href = `leaderboard.html?quizId=${quizId}`;
      });
    });
  }
}

// ----------- PRIVATE LINK HANDLING -------------

function getJoinCodeFromLocation() {
  const url = new URL(window.location.href);

  // 1) ?code=xxxx
  const queryCode = url.searchParams.get("code");
  if (queryCode) return queryCode;

  // 2) /quizzes/<code> (just in case future me route aise ho)
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && !last.endsWith(".html") && last !== "quizzes") {
    return last;
  }

  return null;
}

async function handlePrivateLinkOpen() {
  const joinCode = getJoinCodeFromLocation();
  if (!joinCode) return; // normal page open, nothing special

  console.log("Opening via private link, joinCode =", joinCode);

  try {
    const res = await fetch(`${API_BASE}/quizzes/code/${encodeURIComponent(joinCode)}`, {
      method: "GET"
    });

    if (!res.ok) {
      console.error("Failed to load quiz by code:", await res.text());
      showToast("This quiz link is invalid or no longer available.");
      return;
    }

    

    const quiz = await res.json();
    const isRealtime = quiz.realtime === true || quiz.isRealtime === true;
    const quizId = quiz.id || quiz.quizId;
    
    // 🛑 NEW: realtime private quiz already LIVE/ENDED ho to join block
    if (isRealtime) {
      try {
        const status = await apiGetRealtimeStatus(quizId);
    
        // ✅ LIVE allowed, sirf ended/completed pe block
        if (status.status === "ENDED" || status.status === "COMPLETED") {
          await appAlert(
            "This quiz has already ended.",
            {
              title: "Quiz ended",
              variant: "warning",
              okText: "OK",
            }
          );
          return;
        }
      } catch (err) {
        console.error("Failed to check status for private link:", err);
        showToast("Unable to join this quiz right now.", "error");
        return;
      }
    }
    
    if (isQuizLockedForUser(quizId)) {
      showQuizLockedDialog(quizId);
      return;
    }

    if (isRealtime) {
      // realtime + link -> directly join + go to waiting room
      try {
        await apiJoinRealtimeQuiz(quiz.id || quiz.quizId);
        const fullQuiz = await fetchQuizById(quiz.id || quiz.quizId);
        openRealtimeWaitingRoom(fullQuiz);
      } catch (e) {
        console.error("Failed to join realtime quiz via link:", e);
        showToast("Unable to join realtime quiz. Please login first.");
      }
    } else {
      // normal private (non-realtime) -> old modal flow
      showPrivateQuizModal(quiz);
    }

  } catch (err) {
    console.error(err);
    showToast("Error while loading quiz from link.");
  }
}

function showPrivateQuizModal(quiz) {
  const isRealtime = quiz.realtime === true || quiz.isRealtime === true;

  // participate tab ko active rakhna
  modeButtons.forEach((b) => b.classList.remove("active"));
  contentSections.forEach((sec) => sec.classList.remove("active"));
  document.querySelector('[data-mode="participate"]').classList.add("active");
  document.getElementById("participate-section").classList.add("active");

  quizTakingContent.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">
          <span>🔒</span>
          <span>${isRealtime ? "Realtime Quiz Invite" : "Private Quiz Invite"}</span>
        </h2>
      </div>

      <div class="card-body">
        <h3 style="margin-bottom:0.4rem; font-size:1.2rem; font-weight:600;">
          ${quiz.title}
        </h3>

        <p class="quiz-modal-subtext" style="margin-bottom:0.6rem;">
          ${quiz.description || "No description provided."}
        </p>

        <p style="margin-bottom:0.35rem;">
          Difficulty: <strong>${quiz.difficulty}</strong>
        </p>

        <p class="quiz-modal-subtext" style="margin-top:0.4rem;">
          This quiz is <strong>private</strong> – only people with this link can access it.
        </p>
      </div>

      <div class="card-footer">
        <button id="closePrivateQuizBtn" class="btn btn-secondary">
          <span>✕</span> <span>Close</span>
        </button>

        ${
          isRealtime
            ? `
        <button id="hostStartQuizBtn" class="btn btn-secondary">
          <span>🚀</span> <span>Start Now (Host)</span>
        </button>`
            : ""
        }

        <button id="primaryQuizBtn" class="btn btn-primary">
          <span>▶</span>
          <span>${isRealtime ? "Join Waiting Room" : "Start Quiz"}</span>
        </button>
      </div>
    </div>
  `;

  quizTakingModal.style.display = "flex";

  // handlers
  document
    .getElementById("closePrivateQuizBtn")
    .addEventListener("click", () => closeQuizTakingModal());

  const primaryBtn = document.getElementById("primaryQuizBtn");
  if (primaryBtn) {
    primaryBtn.addEventListener("click", async () => {
      const quizId = quiz.id || quiz.quizId;
      if (isRealtime) {
        try {
          const quizId = quiz.id || quiz.quizId;
      
          if (isQuizLockedForUser(quizId)) {
            showQuizLockedDialog(quizId);
            return;
          }
      
          await apiJoinRealtimeQuiz(quizId);
          openRealtimeWaitingRoom(quiz);
        } catch (e) {
          showToast("Unable to join realtime quiz. Are you logged in?");
        }
      } else {
        navigateWithFade(`quiz_attempt.html?id=${quizId}`);
      }
    });
  }

  const hostBtn = document.getElementById("hostStartQuizBtn");
  if (hostBtn && isRealtime) {
    hostBtn.addEventListener("click", async () => {
      const quizId = quiz.id || quiz.quizId;
      try {
        await apiJoinRealtimeQuiz(quizId);
        await apiStartRealtimeQuiz(quizId);
        openRealtimeWaitingRoom(quiz);
      } catch (e) {
        showToast("Only the quiz creator can start this realtime quiz.");
      }
    });
  }
}

function ensureLoggedInForRealtime() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showToast("Please login to join this quiz.");
    throw new Error("Not logged in");
  }
}

async function apiJoinRealtimeQuiz(quizId) {
  ensureLoggedInForRealtime();
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/join`, {
    method: "POST",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Join realtime failed:", t);

    if (t && t.toLowerCase().includes("banned")) {
      await appAlert(
        "You were removed from this quiz by the host. Ask the host to allow you again.",
        {
          title: "Removed by host",
          variant: "warning",
          okText: "OK",
        }
      );
    } else {
      showToast("Unable to join realtime quiz.", "error");
    }

    throw new Error(t);
  }
}

// ---- Realtime status API ----
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

  return await res.json(); // { status, joinedCount, remainingSeconds }
}
async function apiStartRealtimeQuiz(quizId) {
  ensureLoggedInForRealtime();
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/start`, {
    method: "POST",
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("Start realtime failed:", t);
    throw new Error(t);
  }
}

async function apiEndRealtimeQuiz(quizId) {
  ensureLoggedInForRealtime();
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/end`, {
    method: "POST",           // <- backend me ye endpoint bana lena
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("End realtime failed:", t);
    throw new Error(t);
  }
}

// async function apiGetRealtimeStatus(quizId) {
//   const res = await fetch(`${API_BASE}/quizzes/${quizId}/status`, {
//     method: "GET"
//   });
//   if (!res.ok) {
//     const t = await res.text();
//     console.error("Status realtime failed:", t);
//     throw new Error(t);
//   }
//   return res.json();
// }
function closeQuizTakingModal() {
  clearAttemptTimer();

  if (realtimePollHandle) {
    clearInterval(realtimePollHandle);
    realtimePollHandle = null;
  }

  if (hostStartCountdown) {
    clearInterval(hostStartCountdown);
    hostStartCountdown = null;
  }

  if (kickCheckInterval) {
    clearInterval(kickCheckInterval);
    kickCheckInterval = null;
  }

  quizTakingModal.style.display = "none";
  quizTakingContent.innerHTML = "";
}
// Format seconds as mm:ss
// ==== Attempt timer (global) ====
let attemptTimerId = null;

function clearAttemptTimer() {
  if (attemptTimerId !== null) {
    clearInterval(attemptTimerId);
    attemptTimerId = null;
  }
}

// HH:MM:SS format helper (agar already hai to isko skip kar sakta hai)
function formatSeconds(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
      // ⛔ Timer khatam – auto submit
      clearAttemptTimer();
      label.textContent = "Time over";

      const submitBtn = document.getElementById("submitAttemptBtn");
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click(); // 🔥 yahi se same submit flow chalega
      }

      return;
    }

    label.textContent = formatSeconds(remaining);
  }, 1000);
}

// Phase-1: dummy questions (front-end only)
function buildPlaceholderQuestionsForQuiz(quiz) {
  return [
    {
      id: 1,
      text: `Sample Question 1 for "${quiz.title}"`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 0
    },
    {
      id: 2,
      text: "Sample Question 2 (placeholder)",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 1
    },
    {
      id: 3,
      text: "Sample Question 3 (placeholder)",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 2
    }
  ];
}


function normalizeBackendQuestions(rawQuestions) {
  if (!rawQuestions || !rawQuestions.length) {
    return null;
  }

  return rawQuestions.map((q, idx) => {
    // options array agar already mila ho
    let options = [];
    if (Array.isArray(q.options) && q.options.length) {
      options = q.options;
    } else {
      // nahi to option1..4 se bana lo (DB style)
      options = [q.option1, q.option2, q.option3, q.option4].filter(
        (o) => o && o.length
      );
    }

    // True/False ke liye agar options empty hain to default
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

// Backend submit call: /api/quizzes/{quizId}/submit?isRealtime=false&score=..
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
      headers: getAuthHeaders()
    }
  );

  if (!res.ok) {
    const t = await res.text();
    console.error("Submit quiz failed:", t);
    throw new Error(t);
  }
}
async function fetchQuizById(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}`, {
    method: "GET",
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Failed to load quiz by id:", txt);
    throw new Error("Failed to load quiz details");
  }

  return await res.json();   // yaha se full quiz + questions aayega
}

// function renderQuizAttemptUI(quiz, overrideDurationSeconds = null) {
//   const quizId = quiz.id || quiz.quizId;
//   if (!quizId) {
//     alert("Quiz ID missing in response.");
//     return;
//   }
  
//   const isRealtime = quiz.realtime === true || quiz.isRealtime === true;
  
//   // Pehle backend wale questions try karo
//   let questions = normalizeBackendQuestions(quiz.questions);
  
//   // Agar backend se questions nahi aaye to fallback placeholder
//   if (!questions || !questions.length) {
//     questions = buildPlaceholderQuestionsForQuiz(quiz);
//   }

//   // 🔥 IMPORTANT: duration override support for realtime-sync
//   const durationSeconds =
//     overrideDurationSeconds !== null && overrideDurationSeconds !== undefined
//       ? overrideDurationSeconds
//       : quiz.durationSeconds !== undefined && quiz.durationSeconds !== null
//       ? quiz.durationSeconds
//       : null;

//   const difficultyLabel = quiz.difficulty || "";

//   const questionsHtml = questions
//     .map((q, idx) => {
//       const opts = q.options
//         .map(
//           (opt, oi) => `
//         <label class="option-row" style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.25rem;">
//           <input type="radio" name="q${idx}" value="${oi}">
//           <span>${opt}</span>
//         </label>
//       `
//         )
//         .join("");

//       return `
//         <div class="question-block" style="margin-bottom:1.25rem;">
//           <div class="question-text" style="font-weight:600;margin-bottom:0.35rem;">
//             ${idx + 1}. ${q.text}
//           </div>
//           <div class="options">
//             ${opts}
//           </div>
//         </div>
//       `;
//     })
//     .join("");

//   quizTakingContent.innerHTML = `
//     <div class="card">
//       <div class="card-header attempt-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
//         <div>
//           <h2 class="card-title">
//             <span>🧠</span> <span>${quiz.title}</span>
//           </h2>
//           <p class="quiz-desc" style="color:#718096;margin-top:0.25rem;">
//             ${quiz.description || ""}
//           </p>
//         </div>
//         <div class="attempt-meta" style="text-align:right;font-size:0.9rem;">
//           <div>
//             <span class="badge difficulty-${difficultyLabel.toLowerCase()}">
//               ${difficultyLabel}
//             </span>
//           </div>
//           <div style="margin-top:0.35rem;">
//             Time:
//             <strong id="quizTimerLabel">
//               ${durationSeconds ? formatSeconds(durationSeconds) : "No limit"}
//             </strong>
//           </div>
//         </div>
//       </div>
//       <div class="attempt-body" style="padding:1.5rem 1.5rem 1rem;">
//         ${questionsHtml}
//       </div>
//       <div class="attempt-footer" style="display:flex;justify-content:flex-end;gap:0.75rem;padding:0 1.5rem 1.5rem;">
//         <button class="btn btn-secondary" id="cancelAttemptBtn">
//           <span>✕</span> <span>Cancel</span>
//         </button>
//         <button class="btn btn-primary" id="submitAttemptBtn">
//           <span>✅</span> <span>Submit Quiz</span>
//         </button>
//       </div>
//     </div>
//   `;

//   quizTakingModal.style.display = "block";

//   // Cancel
//   document
//     .getElementById("cancelAttemptBtn")
//     .addEventListener("click", () => {
//       closeQuizTakingModal();
//     });

//   // Submit
//   document
//     .getElementById("submitAttemptBtn")
//     .addEventListener("click", async () => {
//       clearAttemptTimer();
//       // collect answers
//       const chosen = [];
//       questions.forEach((q, idx) => {
//         const checked = quizTakingContent.querySelector(
//           `input[name="q${idx}"]:checked`
//         );
//         chosen.push(checked ? Number(checked.value) : null);
//       });

//       let score = 0;
//       questions.forEach((q, idx) => {
//         if (chosen[idx] === q.correctIndex) score++;
//       });

//       try {
//         await submitQuizScore(quizId, isRealtime, score);
//         showQuizResult(score, questions.length); // ⬅️ next section ka function
//         if (quiz.public === true || quiz.isPublic === true) {
//           await loadPublicQuizzes();
//         }
//         // closeQuizTakingModal();
//       } catch (e) {
//         console.error(e);
//         alert("Failed to submit quiz.");
//       }
//     });

//   if (durationSeconds) {
//     startAttemptTimer(durationSeconds);
//   } else {
//     clearAttemptTimer();
//   }
// }

// ----------- INIT ON PAGE LOAD -------------

// document.addEventListener("DOMContentLoaded", () => {
//   loadPublicQuizzes();
//   loadMyQuizzes();
//   handlePrivateLinkOpen();

//   initLeaderboardFromQuery();
//   ensureGlobalLeaderboardButton();   // ⬅️ NEW LINE

//   const closeBtn = document.getElementById("closeLeaderboardBtn");
//   if (closeBtn) {
//     closeBtn.addEventListener("click", () => {
//       const section = document.getElementById("leaderboardSection");
//       if (section) section.style.display = "none";
//     });
//   }
// });


// enterBulkDeleteBtn.addEventListener("click", () => {
//   bulkDeleteMode = true;
//   bulkSelectedIds = new Set();
//   bulkDeleteControls.style.display = "flex";
//   enterBulkDeleteBtn.style.display = "none";
//   updateBulkSelectedCount();
//   loadMyQuizzes();   // re-render with selection styling
// });

// bulkDeleteCancelBtn.addEventListener("click", () => {
//   bulkDeleteMode = false;
//   bulkSelectedIds = new Set();
//   bulkDeleteControls.style.display = "none";
//   enterBulkDeleteBtn.style.display = "inline-flex";
//   loadMyQuizzes();   // normal mode
// });

// bulkDeleteConfirmBtn.addEventListener("click", async () => {
//   if (!bulkSelectedIds.size) {
//     alert("No quizzes selected.");
//     return;
//   }

//   const ok = confirm(`Delete ${bulkSelectedIds.size} selected quizzes?`);
//   if (!ok) return;

//   try {
//     const ids = Array.from(bulkSelectedIds);
//     await Promise.all(ids.map(id => apiEndQuizForCard(id)));
//     bulkDeleteMode = false;
//     bulkSelectedIds = new Set();
//     bulkDeleteControls.style.display = "none";
//     enterBulkDeleteBtn.style.display = "inline-flex";
//     await loadMyQuizzes();
//   } catch (e) {
//     console.error(e);
//     alert("Failed to delete some quizzes.");
//   }
// });
if (enterBulkDeleteBtn && bulkDeleteControls && bulkDeleteConfirmBtn && bulkDeleteCancelBtn) {
  enterBulkDeleteBtn.addEventListener("click", () => {
    bulkDeleteMode = true;
    bulkSelectedIds = new Set();
    bulkDeleteControls.style.display = "flex";
    enterBulkDeleteBtn.style.display = "none";
    updateBulkSelectedCount();
    loadMyQuizzes();   // selection styling ke saath re-render
  });

  bulkDeleteCancelBtn.addEventListener("click", () => {
    bulkDeleteMode = false;
    bulkSelectedIds = new Set();
    bulkDeleteControls.style.display = "none";
    enterBulkDeleteBtn.style.display = "inline-flex";
    loadMyQuizzes();   // normal mode wapas
  });

  bulkDeleteConfirmBtn.addEventListener("click", async () => {
    if (!bulkSelectedIds.size) {
      showToast("No quizzes selected.");
      return;
    }

    const ok = await appConfirm(
      `Delete ${bulkSelectedIds.size} selected quizzes?`,
      {
        title: "Delete quizzes",
        okText: "Delete",
      }
    );
    if (!ok) return;

    try {
      const ids = Array.from(bulkSelectedIds);
  
      // 1) local hide list update (public list se hatane ke liye)
      const hiddenIds = loadHiddenPublicIds();
      ids.forEach(id => hiddenIds.add(String(id)));
      saveHiddenPublicIds(hiddenIds);
  
      // 2) backend pe delete / end koshish karo (sirf apne quizzes pe succeed hoga)
      await Promise.all(
        ids.map(id =>
          apiEndQuizForCard(id).catch(() => null) // agar error aaye to ignore
        )
      );
  
      bulkDeleteMode = false;
      bulkSelectedIds = new Set();
      bulkDeleteControls.style.display = "none";
      enterBulkDeleteBtn.style.display = "inline-flex";
  
      // 3) dono lists reload
      await loadMyQuizzes();
      await loadPublicQuizzes();
    } catch (e) {
      console.error(e);
      showToast("Failed to delete some quizzes.");
    }
  });
}

function openRealtimeWaitingRoom(quiz) {
  const quizId = quiz.id || quiz.quizId;
  const isHost = quiz.host === true || quiz.isHost === true;

  const title = quiz.title || "Realtime Quiz";

  // ---- joinCode nikaalo (object + localStorage fallback) ----
  let code =
    quiz.joinCode ||
    quiz.code ||
    quiz.privateCode ||
    quiz.quizCode ||
    "";

  if (!code && quizId) {
    const stored = localStorage.getItem(`quizJoinCode_${quizId}`);
    if (stored) {
      code = stored;
    }
  }

  // sirf PRIVATE realtime quiz ke liye share link chahiye
  const shouldShowShareBox = isHost && quiz.realtime && !quiz.public;

  const shareUrl =
    code && shouldShowShareBox
      ? (() => {
          const { origin, pathname } = window.location;
          const dir = pathname.substring(0, pathname.lastIndexOf("/"));
          return `${origin}${dir}/quizzes.html?code=${code}`;
        })()
      : "";

  let messageText;
  const st = quiz.status || "WAITING";

  if (isHost) {
    if (st === "WAITING") {
      messageText = "You are the host – start the quiz when everyone is ready.";
    } else if (st === "LIVE") {
      messageText = "Quiz is LIVE. Participants are attempting the quiz.";
    } else if (st === "COMPLETED" || st === "ENDED") {
      messageText = "Quiz is over. You can now view the results.";
    } else {
      messageText = "";
    }
  } else {
    if (st === "WAITING") {
      messageText = "Waiting for the host to start the quiz…";
    } else if (st === "LIVE") {
      messageText = "Quiz is LIVE. Waiting for host approval…";
    } else if (st === "COMPLETED" || st === "ENDED") {
      messageText = "This quiz has ended.";
    } else {
      messageText = "";
    }
  }

  const participants = quiz.joinedCount ?? quiz.participants ?? 0;

  // pichla participants polling band karo
  stopRealtimeParticipantsPolling();

  const actionsHtml = isHost
    ? `
      <button class="btn btn-secondary" id="endRealtimeQuizBtn">
        <span>✕</span> <span>End Quiz</span>
      </button>

      <button class="btn btn-primary"
              id="startRealtimeQuizBtn"
              style="${quiz.status === "WAITING" ? "" : "display:none;"}">
        <span>▶</span> <span>Start Quiz (Host)</span>
      </button>

      <button class="btn btn-secondary"
              id="viewResultsBtn"
              style="display:${quiz.status === "ENDED" ? "inline-flex" : "none"};">
        <span>🏆</span> <span>View Results</span>
      </button>
   `
    : `
      <button class="btn btn-secondary" id="leaveRealtimeBtn">
        <span>✕</span> <span>Leave</span>
      </button>
   `;

  // ------------ UI ------------
  quizTakingContent.innerHTML = `
    <div class="card waiting-room-card">
      <!-- HEADER -->
      <div class="card-header waiting-header">
        <button id="backToQuizzesBtn"
                class="btn btn-secondary waiting-back-btn">
          ← Back
        </button>

        <div class="waiting-header-center">
          <h2 class="card-title">
            <span>⏱️</span>
            <span>Realtime Quiz Waiting Room</span>
          </h2>
        </div>

        <div class="waiting-header-right">
          <p id="realtimeStatusText" class="waiting-status-pill">
            Status: <strong>${quiz.status || "WAITING"}</strong>
          </p>
        </div>
      </div>

      <!-- BODY: 2-COLUMN LAYOUT -->
      <div class="card-body waiting-layout">
        <!-- LEFT COLUMN: INFO + SHARE + TIMER -->
        <div class="waiting-left">
          <h3 class="waiting-quiz-title">
            ${title}
          </h3>

          <div class="waiting-meta-row">
            <span class="waiting-meta-pill ${
              quiz.public ? "meta-public" : "meta-private"
            }">
              ${quiz.public ? "Public" : "Private"}
            </span>
            <span class="waiting-meta-pill meta-role">
              Role: ${isHost ? "Host" : "Participant"}
            </span>
          </div>


          ${
            shouldShowShareBox && shareUrl
              ? `
          <div class="waiting-share-box">
            <p class="waiting-share-title">
              Share this link with your participants:
            </p>
            <div class="waiting-share-row">
              <code id="waitingRoomShareLink" class="waiting-share-link">
                ${shareUrl}
              </code>
              <button id="copyWaitingLinkBtn"
                      class="btn btn-secondary waiting-copy-btn">
                Copy
              </button>
            </div>
          </div>
          `
              : ""
          }

          <p id="hostStartTimerText" class="waiting-timer-text" style="display:none;"></p>

          <div class="waiting-info-block">
            <p id="realtimeJoinedText" class="waiting-joined-text">
              Participants joined: <strong>${participants}</strong>
            </p>
            <p class="quiz-modal-subtext waiting-message-text">
              ${messageText}
            </p>
          </div>
        </div>

        <!-- RIGHT COLUMN: LISTS (HOST ONLY) -->
        ${
          isHost
            ? `
        <div class="waiting-right">
          <!-- Participants -->
          <div id="participantListBox" class="waiting-panel">
            <div class="waiting-panel-header">
              <span class="waiting-panel-title">Participants</span>
              <span id="participantCountText" class="waiting-panel-count">
                0 joined
              </span>
            </div>
            <div id="participantListInner" class="waiting-panel-body waiting-panel-scroll">
              <!-- filled by JS -->
            </div>
          </div>

          <!-- Pending join requests -->
          <div id="pending-users-box" class="waiting-panel hidden">
            <div class="waiting-panel-header">
              <span class="waiting-panel-title">⏳ Join Requests</span>
            </div>
            <div id="pending-users-list" class="waiting-panel-body waiting-panel-scroll">
              <!-- filled by JS -->
            </div>
          </div>

          <!-- Banned users -->
          <div id="banned-users-box" class="waiting-panel hidden">
            <div class="waiting-panel-header">
              <span class="waiting-panel-title">🚫 Banned Users</span>
            </div>
            <div id="banned-users-list" class="waiting-panel-body waiting-panel-scroll">
              <!-- filled by JS -->
            </div>
          </div>
        </div>
        `
            : ""
        }
      </div>

      <!-- FOOTER -->
      <div class="card-footer waiting-footer">
        ${actionsHtml}
      </div>
    </div>
  `;

  quizTakingModal.style.display = "flex";

  // ---- Copy link ----
  const copyBtn = document.getElementById("copyWaitingLinkBtn");
  const linkEl  = document.getElementById("waitingRoomShareLink");
  if (copyBtn && linkEl) {
    copyBtn.addEventListener("click", () => {
      const text = linkEl.textContent.trim();
      navigator.clipboard.writeText(text)
        .then(() => showToast("Link copied to clipboard!", "success"))
        .catch(() => showToast("Could not copy link.", "error"));
    });
  }

  // ---- Back button ----
  document.getElementById("backToQuizzesBtn")?.addEventListener("click", () => {
    stopRealtimeParticipantsPolling();
    navigateWithFade("quizzes.html");
  });

  // ===== HOST / PARTICIPANT BUTTON LOGIC =====
  if (isHost) {
    const startBtn = document.getElementById("startRealtimeQuizBtn");
    const hostTimerEl = document.getElementById("hostStartTimerText");
    const statusTextEl = document.getElementById("realtimeStatusText");

    if (startBtn) {
      startBtn.addEventListener("click", async () => {
        try {
          await apiStartRealtimeQuiz(quizId);
          localStorage.setItem("hostQuizRan_" + quizId, "true");
          localStorage.removeItem(HOST_DEADLINE_PREFIX + quizId);
          showToast("Quiz started! Participants can now attempt the quiz.", "success");

          if (hostStartCountdown) {
            clearInterval(hostStartCountdown);
            hostStartCountdown = null;
          }
          if (hostTimerEl) hostTimerEl.style.display = "none";
          if (statusTextEl) statusTextEl.innerHTML = "Status: <strong>LIVE</strong>";
          startBtn.style.display = "none";
        } catch (e) {
          console.error(e);
          showToast("Failed to start quiz.");
        }
      });
    }

    document
      .getElementById("endRealtimeQuizBtn")
      ?.addEventListener("click", async () => {
        const ok = await appConfirm(
          "End quiz for everyone? Participants will see final leaderboard.",
          {
            title: "End realtime quiz",
            okText: "End quiz",
            cancelText: "Keep running",
          }
        );
        if (!ok) return;

        try {
          await apiEndRealtimeQuiz(quizId);

          try {
            localStorage.removeItem("quizHostDeadline_" + quizId);
            localStorage.removeItem("hostQuizRan_" + quizId);
          } catch (_) {}

          stopRealtimeParticipantsPolling();
          showToast("Quiz ended. Opening results…", "success");

          closeQuizTakingModal();
          await loadPublicQuizzes();
          await loadMyQuizzes();

          navigateWithFade(`leaderboard.html?quizId=${quizId}`);
        } catch (e) {
          console.error(e);
          showToast("Failed to end quiz.");
        }
      });
  } else {
    const leaveBtn = document.getElementById("leaveRealtimeBtn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", async () => {
        const ok = await appConfirm(
          "Are you sure you want to leave this quiz? You won't be able to join again.",
          {
            title: "Leave quiz",
            okText: "Leave",
            cancelText: "Stay",
          }
        );
        if (!ok) return;

        lockQuizForUser(quizId, "attempted");

        try {
          await fetch(`${API_BASE}/quizzes/${quizId}/leave`, {
            method: "POST",
            headers: getAuthHeaders(),
          });
        } catch (e) {
          console.error("Failed to leave quiz", e);
        } finally {
          stopRealtimeParticipantsPolling();
          closeQuizTakingModal();
        }
      });
    }
  }

  // 🔁 Participant kick-check
  if (!isHost) {
    if (kickCheckInterval) {
      clearInterval(kickCheckInterval);
    }
    kickCheckInterval = setInterval(() => {
      checkKickStatus(quizId);
    }, 3000);
  }

  const viewBtn = document.getElementById("viewResultsBtn");
  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      stopRealtimeParticipantsPolling();
      navigateWithFade(`leaderboard.html?quizId=${quizId}`);
    });
  }

  // --------- PARTICIPANTS / PENDING / BANNED (HOST ONLY) ---------
  async function loadParticipantsOnce() {
    if (!isHost) return;

    try {
      const res = await fetch(
        `${API_BASE}/quizzes/${quizId}/realtime/participants`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error("Failed participants fetch");

      const data = await res.json();
      renderParticipantList(data, quizId);

      const joinedText = document.getElementById("realtimeJoinedText");
      if (joinedText) {
        joinedText.innerHTML = `Participants joined: <strong>${data.length}</strong>`;
      }
    } catch (e) {
      console.error("Failed to load realtime participants", e);
    }
  }

  async function loadPendingUsers(quizId) {
    const box  = document.getElementById("pending-users-box");
    const list = document.getElementById("pending-users-list");
    if (!box || !list) return;

    const pending = await apiGetPendingUsers(quizId);

    if (!pending || !pending.length) {
      box.classList.add("hidden");
      list.innerHTML = "";
      return;
    }

    box.classList.remove("hidden");
    list.innerHTML = "";

    pending.forEach((u) => {
      const userId =
        u.userId ?? u.id ?? u.participantId ?? u.user_id ?? null;

      const displayName =
        u.username || u.name || u.fullName || u.email || `User ${userId ?? ""}`;

      if (!userId) {
        console.warn("Pending user without ID, cannot approve:", u);
        return;
      }

      const row = document.createElement("div");
      row.style.cssText = `
        display:flex;
        justify-content:space-between;
        align-items:center;
        padding:10px;
        border-bottom:1px solid rgba(255,255,255,.08);
      `;
      row.innerHTML = `
        <span style="color:#fff; font-size:14px;">${displayName}</span>
        <button class="btn btn-small"
                style="padding:4px 10px; background:#4b5cff;"
                data-id="${userId}">
          Allow
        </button>
      `;

      row.querySelector("button").addEventListener("click", async () => {
        const ok = await apiApproveUser(quizId, userId);
        if (!ok) {
          showToast("Failed to approve user. See console.", "error");
          return;
        }

        showToast("User approved", "success");
        loadPendingUsers(quizId);
        loadParticipantsOnce(quizId);
      });

      list.appendChild(row);
    });
  }

  if (isHost) {
    loadParticipantsOnce();
    loadBannedUsers(quizId);
    loadPendingUsers(quizId);

    realtimeParticipantsInterval = setInterval(() => {
      loadParticipantsOnce();
      loadBannedUsers(quizId);
      loadPendingUsers(quizId);
    }, 5000);
  }

  // -------- realtime status + host countdown (same logic as pehle) --------
  startRealtimeStatusPolling(quiz, isHost);

  if (isHost) {
    const hostTimerEl = document.getElementById("hostStartTimerText");
    if (
      quiz.status === "LIVE" ||
      quiz.status === "COMPLETED" ||
      quiz.status === "ENDED"
    ) {
      if (hostTimerEl) hostTimerEl.style.display = "none";
      return;
    }

    if (!hostTimerEl) return;
    hostTimerEl.style.display = "block";

    if (hostStartCountdown) {
      clearInterval(hostStartCountdown);
      hostStartCountdown = null;
    }

    let deadlineMs;
    const storedDeadline = localStorage.getItem(HOST_DEADLINE_PREFIX + quizId);

    if (storedDeadline) {
      deadlineMs = Number(storedDeadline);
    } else {
      let baseMs;
      if (quiz.createdAt) {
        baseMs = new Date(quiz.createdAt).getTime();
      } else {
        const storedCreated = localStorage.getItem(`quizHostCreatedAt_${quizId}`);
        baseMs = storedCreated ? Number(storedCreated) : Date.now();
      }
      deadlineMs = baseMs + HOST_START_LIMIT * 1000;
      localStorage.setItem(HOST_DEADLINE_PREFIX + quizId, String(deadlineMs));
    }

    function tick() {
      const diffMs = deadlineMs - Date.now();

      if (diffMs <= 0) {
        clearInterval(hostStartCountdown);
        hostStartCountdown = null;

        hostTimerEl.textContent =
          "Quiz expired (host did not start in time).";

        localStorage.removeItem(HOST_DEADLINE_PREFIX + quizId);

        fetch(`${API_BASE}/quizzes/${quizId}/expire`, {
          method: "POST",
          headers: getAuthHeaders(),
        }).catch(console.error);

        appAlert("Quiz expired because you did not start in time.", {
          title: "Quiz expired",
          variant: "warning",
          okText: "Got it",
        });
        stopRealtimeParticipantsPolling();
        closeQuizTakingModal();
        return;
      }

      const secondsLeft = Math.floor(diffMs / 1000);
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
      const s = String(secondsLeft % 60).padStart(2, "0");

      hostTimerEl.textContent =
        `Start quiz within ${m}:${s} or it will expire automatically.`;
    }

    tick();
    hostStartCountdown = setInterval(tick, 1000);
  }
}



const publishTopBtn = document.getElementById("publishQuizBtnTop");
if (publishTopBtn) {
  publishTopBtn.addEventListener("click", () => {
    document.getElementById("publishQuizBtn").click();
  });
}

// document.addEventListener("dragover", (e) => {
//   e.preventDefault();
//   window.dragY = e.clientY;
// });

document.addEventListener("DOMContentLoaded", () => {

  loadPublicQuizzes();
  loadMyQuizzes();
  handlePrivateLinkOpen();
  initLeaderboardFromQuery();

  // Add this 👇
  const globalLbBtn = document.getElementById("openGlobalLeaderboard");
  if (globalLbBtn) {
    globalLbBtn.addEventListener("click", () => {
      window.location.href = "leaderboard.html";
    });
  }
});

async function apiGetBannedUsers(quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/banned`, {
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    console.error("Failed to load banned users:", await res.text());
    return [];
  }

  return await res.json(); // [{userId, username, email, removable}]
}

async function apiUnbanUser(quizId, userId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/unban/${userId}`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  return res.ok;
}

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
document.addEventListener("DOMContentLoaded", setupNavbarAvatar);
document.querySelectorAll('.js-logout').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.removeItem("token");
    window.location.href = "./auth.html";
  });
});