// Logged-in user
// const USER_ID = Number(localStorage.getItem("userId")) || null;

let currentDoubtId = null;
let isAsker = false; 
let currentDoubt = null;   
// --------- URL helper ---------
function getDoubtIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

// --------- Back button ---------
function goBackToDoubts() {
  if (window.history.length > 1) {
    history.back();
  } else {
    window.location.href = "doubts.html";
  }
}
let answerAttachmentUrl = null;

// when image selected
document.addEventListener("change", async (e) => {
  if (e.target.id === "answerImageInput") {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/files/upload`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();

      answerAttachmentUrl = data.url;  // backend returns URL

      document.getElementById("answerImagePreview").innerHTML =
        `<img src="${answerAttachmentUrl}" style="max-width:200px;border-radius:8px;margin-top:6px;" />`;

    } catch (err) {
      console.error(err);
      alert("Failed to upload image");
    }
  }
});

function renderQuestion(d) {
  const box = document.getElementById("questionBlock");
  if (!box) return;

  const initials = (d.asker?.name || "User")
    .split(" ")
    .map((x) => x[0])
    .join("")
    .toUpperCase();

  const statusLabel =
    d.status === "RESOLVED"
      ? `<span class="doubt-status resolved">Resolved</span>`
      : `<span class="doubt-status open">Open</span>`;

  box.innerHTML = `
    <h1 class="question-title">
      ${d.title}
      ${statusLabel}
    </h1>

    <div class="question-tags">
      <span class="subject-chip">${d.subject || ""}</span>
      ${(d.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}
    </div>

    <p class="question-body">${d.description || ""}</p>

    ${
      d.codeSnippet
        ? `
          <div class="code-section">
            <h3 class="code-title">💻 Code</h3>
            <pre class="code-block"><code>${d.codeSnippet}</code></pre>
          </div>
        `
        : ""
    }

    ${
      d.attachmentUrl
        ? `
          <div class="attachment-section">
            <h3 class="attachment-title"> Attachment</h3>
            <a href="${d.attachmentUrl}"
              target="_blank"
              class="attachment-link">View Attached File</a>
          </div>
        `
        : ""
    }

    <div class="question-footer">
      <div class="stats-row">
        <!-- YAHI NEW LIKE BUTTON HAI -->
        <button
          id="question-like-btn"
          type="button"
          class="detail-like-btn"
          onclick="toggleQuestionLike(event)"
        >
          <span class="detail-like-dot"></span>
          <span class="detail-like-label" id="detail-like-label">Like</span>
          <span class="detail-like-count" id="detail-like-count">
            ${d.likeCount || 0}
          </span>
        </button>

        <span class="stat-item">
           ${d.answerCount || 0} Answers
        </span>

        <span class="stat-item">
          ${d.viewCount || 0}
        </span>
      </div>

      <div class="author-row">
        <div class="author-avatar">${initials}</div>
        <div class="author-info">
          <div class="author-name">${d.asker?.name || "Unknown"}</div>
        </div>
      </div>
    </div>
  `;

  // initial liked state (localStorage se)
  if (USER_ID) {
    const likeKey = `doubt_like_${d.id}_${USER_ID}`;
    const btn = document.getElementById("question-like-btn");
    const label = document.getElementById("detail-like-label");
    if (btn && localStorage.getItem(likeKey) === "1") {
      btn.classList.add("liked");
      if (label) label.textContent = "Liked";
    }
  }
}
async function toggleQuestionLike(evt) {
  if (evt) evt.stopPropagation();

  if (!currentDoubt || !USER_ID) {
    console.warn("No doubt / user for like");
    return;
  }

  const btn = document.getElementById("question-like-btn");
  const label = document.getElementById("detail-like-label");
  const countSpan = document.getElementById("detail-like-count");

  const likeKey = `doubt_like_${currentDoubt.id}_${USER_ID}`;
  const alreadyLiked = localStorage.getItem(likeKey) === "1";

  const method = alreadyLiked ? "DELETE" : "POST";

  // chhota sa bounce effect
  if (btn) {
    btn.classList.add("like-bounce");
    btn.addEventListener(
      "animationend",
      () => btn.classList.remove("like-bounce"),
      { once: true }
    );
  }

  try {
    const data = await authFetch(
      `${API}/doubts/${currentDoubt.id}/like`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      }
    );

    const likeCount =
      data?.likeCount ?? data?.like_count ?? currentDoubt.likeCount ?? 0;

    // 🔹 UI par count update
    if (countSpan) countSpan.textContent = likeCount;
    currentDoubt.likeCount = likeCount;

    // 🔹 state + label update
    if (alreadyLiked) {
      localStorage.removeItem(likeKey);
      if (btn) btn.classList.remove("liked");
      if (label) label.textContent = "Like";
    } else {
      localStorage.setItem(likeKey, "1");
      if (btn) btn.classList.add("liked");
      if (label) label.textContent = "Liked";
    }
  } catch (err) {
    console.error("Failed to toggle question like:", err);
  }
}
// --------- Load all answers for this doubt ---------
async function loadAnswers() {
  const box = document.getElementById("answerList");
  if (!box || !currentDoubtId) return;

  try {
    const list = await authFetch(`${API}/doubts/${currentDoubtId}/answers`);

    if (!list || !list.length) {
      box.innerHTML = "<p class='empty-text'>No answers yet.</p>";
      return;
    }

    box.innerHTML = "";
    list.forEach((a) => {
      const initials = (a.solver?.name || "User")
        .split(" ")
        .map((x) => x[0])
        .join("")
        .toUpperCase();

      const mine = USER_ID && a.solver && a.solver.id === USER_ID;

      // local like (front-end only for now)
      const likeKey = `answer_like_${a.id}_${USER_ID || "guest"}`;
      const likedLocal = localStorage.getItem(likeKey) === "1";
      let likeCount = a.likeCount ?? 0;
      if (likedLocal && likeCount === 0) {
        // if backend has no likeCount yet, at least show user like
        likeCount = 1;
      }

      const acceptedBadge = a.accepted
        ? `<span class="accepted-badge">✓ Accepted Answer</span>`
        : "";

      const acceptButton =
        !a.accepted && isAsker
          ? `<button class="answer-accept-btn" onclick="acceptAnswer(${a.id})">
               Mark as Accepted
             </button>`
          : "";

      box.innerHTML += `
        <div class="answer-card ${a.accepted ? "accepted" : ""}" id="answer-${a.id}">
          <div class="answer-header">
            <div class="answer-author">
              <div class="solver-avatar">${initials}</div>
              <div class="solver-meta">
                <div class="solver-name">${a.solver?.name || "User"}</div>
              </div>
            </div>
            <div class="answer-header-actions">
              ${acceptedBadge}
              ${acceptButton}
            </div>
          </div>

          <div class="answer-body">
            <p id="answer-body-${a.id}">${a.body}</p>
          </div>
          ${
            a.attachmentUrl
              ? `<img src="${a.attachmentUrl}" class="answer-image" />`
              : ""
          }

          <div class="answer-actions">
            <button
              class="answer-like-btn"
              data-answer-id="${a.id}"
              data-liked="${likedLocal ? "true" : "false"}"
              onclick="toggleAnswerLike(${a.id})"
            >
              👍 <span id="answer-like-count-${a.id}">${likeCount}</span>
            </button>

            ${
              mine
                ? `<button class="answer-edit-btn" onclick="startEditAnswer(${a.id})">
                     Edit
                   </button>`
                : ""
            }

<button
  class="answer-footer-btn"
  data-role="reply-btn"
  data-answer-id="${a.id}"
  onclick="toggleReplyBox(${a.id})"
>
  Reply
  <span id="reply-count-${a.id}" class="reply-count-badge">0</span>
</button>
          </div>

          <div class="reply-box" id="reply-box-${a.id}" style="display:none;">
            <textarea
              id="reply-input-${a.id}"
              class="reply-input"
              placeholder="Write a reply..."
            ></textarea>
            <div class="reply-actions">
              <button onclick="postReply(${a.id})">Post</button>
              <button onclick="toggleReplyBox(${a.id}, true)">Cancel</button>
            </div>
            <div class="reply-list" id="reply-list-${a.id}"></div>
          </div>
        </div>
      `;

      // load replies (front-end only)
      loadReplies(a.id);

    });
    setTimeout(enableImagePreview, 100);
  } catch (err) {
    console.error(err);
    box.innerHTML = "<p>Failed to load answers.</p>";
  }
}

// --------- Post a new answer ---------
async function postAnswer() {
  const input = document.getElementById("answerInput");
  if (!input || !currentDoubtId) return;

  const text = input.value.trim();
  if (!text) {
    alert("Type something");
    return;
  }

  if (!USER_ID) {
    alert("Login to post an answer.");
    return;
  }

  try {
    await authFetch(`${API}/doubts/${currentDoubtId}/answers`, {
        method: "POST",
        body: JSON.stringify({
          userId: USER_ID,
          body: text,
          attachmentUrl: answerAttachmentUrl,
        }),
      });
      
      // clear preview
      answerAttachmentUrl = null;
      document.getElementById("answerImagePreview").innerHTML = "";
      document.getElementById("answerImageInput").value = "";

    input.value = "";
    loadAnswers();
  } catch (err) {
    console.error(err);
    alert("Failed to post answer");
  }
}

// --------- Accept an answer (only asker) ---------
async function acceptAnswer(answerId) {
  if (!USER_ID) {
    alert("Login to accept an answer.");
    return;
  }

  try {
    await authFetch(`${API}/doubts/answers/${answerId}/accept`, {
      method: "POST",
      body: JSON.stringify({ userId: USER_ID }),
    });

    // Reload doubt + answers so status, badges update
    await initDoubtDetail();
  } catch (err) {
    console.error(err);
    alert("Failed to accept answer");
  }
}

// --------- Edit own answer ---------
function startEditAnswer(answerId) {
  const bodyEl = document.getElementById(`answer-body-${answerId}`);
  if (!bodyEl) return;

  const current = bodyEl.textContent || "";
  const updated = prompt("Edit your solution:", current);

  if (updated === null) return; // cancelled

  const trimmed = updated.trim();
  if (!trimmed) {
    alert("Answer cannot be empty");
    return;
  }

  if (!USER_ID) {
    alert("Login to edit your answer.");
    return;
  }

  authFetch(`${API}/doubts/answers/${answerId}`, {
    method: "PUT",
    body: JSON.stringify({
      userId: USER_ID,
      body: trimmed,
      attachmentUrl: null,
    }),
  })
    .then(() => loadAnswers())
    .catch((err) => {
      console.error(err);
      alert("Failed to update answer");
    });
}

// --------- Like / Unlike an answer (front-end only for now) ---------
function toggleAnswerLike(answerId) {
  if (!USER_ID) {
    alert("Login to like answers.");
    return;
  }

  const key = `answer_like_${answerId}_${USER_ID}`;
  const btn = document.querySelector(
    `button.answer-like-btn[data-answer-id="${answerId}"]`
  );
  const countEl = document.getElementById(`answer-like-count-${answerId}`);

  let count = Number(countEl?.textContent || "0");
  const currentlyLiked = localStorage.getItem(key) === "1";

  if (currentlyLiked) {
    localStorage.removeItem(key);
    count = Math.max(0, count - 1);
    if (btn) btn.setAttribute("data-liked", "false");
  } else {
    localStorage.setItem(key, "1");
    count = count + 1;
    if (btn) btn.setAttribute("data-liked", "true");
  }

  if (countEl) countEl.textContent = String(count);
}

// --------- Reply box toggle (front-end only for now) ---------
function toggleReplyBox(answerId, hideOnly = false) {
  const box = document.getElementById(`reply-box-${answerId}`);
  if (!box) return;

  if (hideOnly) {
    box.style.display = "none";
    return;
  }

  box.style.display = box.style.display === "none" ? "block" : "none";
}

// --------- Load replies from localStorage ---------
function loadReplies(answerId) {
    const listEl = document.getElementById(`reply-list-${answerId}`);
    if (!listEl) return;
  
    authFetch(`${API}/doubts/answers/${answerId}/replies`)
      .then((replies) => {
        if (!replies || !replies.length) {
          listEl.innerHTML = "";
          return;
        }
  
        listEl.innerHTML = replies
          .map(
            (r) => `
          <div class="reply-item">
            <div class="reply-meta">
              <span class="reply-user">${r.replier?.name || "User"}</span>
              <span class="reply-time">
                ${r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
              </span>
            </div>
            <div class="reply-text">${r.text}</div>
          </div>
        `
          )
          .join("");
      })
      .catch((err) => {
        console.error("Failed to load replies", err);
      });
  }

// --------- Post a reply (front-end only for now) ---------
function loadReplies(answerId) {
    const listEl = document.getElementById(`reply-list-${answerId}`);
    const countEl = document.getElementById(`reply-count-${answerId}`);
  
    if (!listEl) return;
  
    authFetch(`${API}/doubts/answers/${answerId}/replies`)
      .then((replies) => {
        if (!replies || !replies.length) {
          listEl.innerHTML = "";
          if (countEl) {
            countEl.textContent = "0";
            countEl.style.display = "none";
          }
          return;
        }
  
        listEl.innerHTML = replies
        .map(
          (r) => `
          <div class="reply-item">
            <div class="reply-meta">
              <span class="reply-user">${r.replier?.name || "User"}</span>
              <span class="reply-time">${
                r.createdAt ? new Date(r.createdAt).toLocaleString() : ""
              }</span>
            </div>
            <div class="reply-text">${r.text}</div>
          </div>
        `
        )
        .join("");
  
        // 🔢 Update reply count badge
        if (countEl) {
          countEl.textContent = replies.length;
          countEl.style.display = "inline-flex";
        }
      })
      .catch((err) => {
        console.error("Failed to load replies", err);
      });
  }

// --------- Init doubt detail (called on load & after accept) ---------
async function initDoubtDetail() {
  const id = getDoubtIdFromUrl();
  if (!id) {
    alert("No doubt id in URL");
    goBackToDoubts();
    return;
  }

  currentDoubtId = Number(id);

  try {
    const url = `${API}/doubts/${currentDoubtId}${
      USER_ID ? `?userId=${USER_ID}` : ""
    }`;
    const doubt = await authFetch(url);
    currentDoubt = doubt;

    isAsker = !!(
      USER_ID &&
      doubt.asker &&
      Number(doubt.asker.id) === Number(USER_ID)
    );

    renderQuestion(doubt);
    loadAnswers();
  } catch (err) {
    console.error(err);
    alert("Failed to load doubt");
  }
}

// --------- Initial load ---------
document.addEventListener("DOMContentLoaded", () => {
  initDoubtDetail();
});
// ---- IMAGE MODAL PREVIEW ----
function enableImagePreview() {
    const modal = document.getElementById("imageModal");
    const modalImg = document.getElementById("imageModalContent");
    const closeBtn = document.querySelector(".image-modal-close");
  
    // Add click listener to all answer images
    document.querySelectorAll(".answer-image").forEach((img) => {
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        modal.style.display = "block";
        modalImg.src = img.src;
      });
    });
  
    // Close on X
    closeBtn.onclick = () => {
      modal.style.display = "none";
    };
  
    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    };
  }
  // Allow notifications.js to force-refresh replies in real time
  window.refreshRepliesFromNotification = function (answerId) {
    console.log("[REALTIME] Refreshing replies for answer:", answerId);
  
    // 1) Reply section ko force-open karo
    const section = document.getElementById(`reply-section-${answerId}`);
    if (section) {
      // agar tum 'hidden' class use kar rahe ho
      section.classList.remove("hidden");
      // agar inline style se hide kiya tha
      section.style.display = "block";
    }
  
    // 2) Replies reload karo
    loadReplies(answerId);
  };

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