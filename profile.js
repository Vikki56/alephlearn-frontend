// ==== API CONFIG (simple local helper) ====
const API_BASE = "http://localhost:8080/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  if (!token) {
    return {};
  }
  return {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
}

function showProfileRoot() {
  const root = document.getElementById("profileRoot");
  if (!root) return;
  root.classList.remove("profile-hidden");
  root.classList.add("profile-visible");
}

// 🔹 URL PARAMS → are we viewing someone else?
const urlParams = new URLSearchParams(window.location.search);
const viewedEmail = urlParams.get("email"); // profile.html?email=...
const myEmail = (localStorage.getItem("email") || "").toLowerCase();

// true when we are on SOMEONE ELSE's profile page
const viewingOther =
  viewedEmail &&
  viewedEmail.trim() !== "" &&
  viewedEmail.toLowerCase() !== myEmail;

// ==== DEFAULT UI CONFIG (fallback) ====
const defaultConfig = {
  user_name: "Aleph User",
  username: "@aleph_user",
  branch_name: "No stream selected",
  total_points: "0 Points",
  doubts_solved: "0",
  problems_attempted: "0",
  user_ranking: "#—",
  interests: "Data Structures, Web Development, Machine Learning",
  background_color: "#667eea",
  card_color: "#ffffff",
  text_color: "#2d3748",
  primary_action_color: "#667eea",
  secondary_action_color: "#764ba2",
  font_family: "Inter",
  font_size: 16,
};

// ------- INTERESTS STATE -------
let interests = [];

// render interests chips
function renderInterests() {
  const container = document.getElementById("interestsContainer");
  const hint = document.getElementById("interestHint");
  if (!container || !hint) return;

  container.innerHTML = "";

  if (!interests || interests.length === 0) {
    container.innerHTML =
      '<p style="color:#A0AEC0; font-size:0.85rem; margin:0;">No interests added yet.</p>';
    hint.textContent = viewingOther
      ? "Interests of this learner"
      : "0 / 5 interests added";
    return;
  }

  interests.forEach((interest, index) => {
    const chip = document.createElement("div");
    chip.className = "interest-chip";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = interest;

    // self profile pe hi label click = edit
    if (!viewingOther) {
      labelSpan.addEventListener("click", () => {
        const input = document.getElementById("interestInput");
        if (!input) return;
        input.value = interest;
        interests.splice(index, 1);
        renderInterests();
        // user "Add" dabayega tab backend sync hoga
      });
    }

    const actions = document.createElement("div");
    actions.className = "interest-chip-actions";

    if (!viewingOther) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "interest-chip-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove";

      removeBtn.addEventListener("click", async () => {
        interests.splice(index, 1);
        renderInterests();
        await syncInterestsToBackend();
      });

      actions.appendChild(removeBtn);
    }

    chip.appendChild(labelSpan);
    chip.appendChild(actions);
    container.appendChild(chip);
  });

  if (!viewingOther) {
    hint.textContent = `${interests.length} / 5 interests added`;
  } else {
    hint.textContent = "Interests of this learner";
  }
}

// ------- BACKEND: INTERESTS (self only) -------

async function loadInterestsFromBackend() {
  if (viewingOther) return; // ❌ never load self interests on foreign profile

  try {
    const headers = getAuthHeaders();
    if (!headers.Authorization) return;

    const res = await fetch(`${API_BASE}/profile/interests`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.warn("Failed to load interests:", res.status);
      return;
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      interests = data;
      renderInterests();
    }
  } catch (err) {
    console.error("Error loading interests:", err);
  }
}

async function syncInterestsToBackend() {
  if (viewingOther) return; // foreign profile → no sync

  try {
    const headers = getAuthHeaders();
    if (!headers.Authorization) return;

    const res = await fetch(`${API_BASE}/profile/interests`, {
      method: "PUT",
      headers,
      body: JSON.stringify(interests),
    });
    if (!res.ok) {
      console.warn("Failed to save interests:", res.status);
    }
  } catch (err) {
    console.error("Error saving interests:", err);
  }
}

function setupInterests() {
  const input = document.getElementById("interestInput");
  const addBtn = document.getElementById("addInterestBtn");
  if (!input || !addBtn) return;

  // Agar kisi aur ka profile dekh rahe → pura row hi disable
  if (viewingOther) {
    const row = document.querySelector(".interest-input-row");
    if (row) row.style.display = "none";
    return;
  }

  async function addInterest() {
    const value = input.value.trim();
    if (!value) return;
    if (interests.length >= 5) {
      showLimitPopup();
      return;
    }
    if (interests.includes(value)) {
      alert("Interest already added.");
      return;
    }
    interests.push(value);
    input.value = "";
    renderInterests();
    await syncInterestsToBackend(); // 🔥 new
  }

  addBtn.addEventListener("click", addInterest);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addInterest();
    }
  });
}

// ------- THEME + DATA BINDING -------
async function onConfigChange(config) {
  const merged = { ...defaultConfig, ...config };

  const userName = merged.user_name;
  const username = merged.username;
  const branchName = merged.branch_name;
  const totalPoints = merged.total_points;
  const doubtsSolved = merged.doubts_solved;
  const problemsAttempted = merged.problems_attempted;
  const userRanking = merged.user_ranking;

  const backgroundColor = merged.background_color;
  const cardColor = merged.card_color;
  const textColor = merged.text_color;
  const primaryActionColor = merged.primary_action_color;
  const secondaryActionColor = merged.secondary_action_color;

  const customFont = merged.font_family;
  const baseFontStack = "Inter, sans-serif";
  const baseSize = merged.font_size;

  // text bindings
  document.getElementById("userName").textContent = userName;
  document.getElementById("username").textContent = username;
  document.getElementById("branchName").innerHTML = `
    <span class="branch-icon">🎓</span><span>${branchName}</span>
  `;
  document.getElementById("totalPoints").textContent = totalPoints;
  document.getElementById("doubtsSolved").textContent = doubtsSolved;
  document.getElementById("problemsAttempted").textContent =
    problemsAttempted;
  document.getElementById("userRanking").textContent = userRanking;

  // avatar initials (2 letters)
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const avatarEl = document.getElementById("avatar");
  if (avatarEl) {
    avatarEl.textContent = initials;
  }

  const headerAvatar = document.getElementById("headerAvatar");
  if (headerAvatar) {
    headerAvatar.textContent = initials;
    headerAvatar.classList.remove("avatar-hidden"); // ✅ visible
  }

  renderInterests();

  // theme
  document.body.style.background = `linear-gradient(135deg, ${backgroundColor} 0%, ${secondaryActionColor} 100%)`;

  const cards = document.querySelectorAll(".card, .profile-header");
  cards.forEach((card) => {
    card.style.background = cardColor;
  });

  const textElements = document.querySelectorAll(
    ".profile-name, .card-title, .stat-label"
  );
  textElements.forEach((el) => {
    el.style.color = textColor;
  });

  const gradientElements = document.querySelectorAll(
    ".points-badge, .btn-primary"
  );
  gradientElements.forEach((el) => {
    el.style.background = `linear-gradient(135deg, ${primaryActionColor}, ${secondaryActionColor})`;
  });

  document.body.style.fontFamily = `${customFont}, ${baseFontStack}`;

  const nameEl = document.querySelector(".profile-name");
  if (nameEl) nameEl.style.fontSize = `${baseSize * 2}px`;

  const unameEl = document.querySelector(".profile-username");
  if (unameEl) unameEl.style.fontSize = `${baseSize * 1.1}px`;

  const branchEl = document.querySelector(".profile-branch");
  if (branchEl) branchEl.style.fontSize = `${baseSize * 0.95}px`;

  document.querySelectorAll(".card-title").forEach((el) => {
    el.style.fontSize = `${baseSize * 1.2}px`;
  });
  document.querySelectorAll(".stat-value").forEach((el) => {
    el.style.fontSize = `${baseSize * 2.5}px`;
  });
  document.querySelectorAll(".stat-label").forEach((el) => {
    el.style.fontSize = `${baseSize * 0.9}px`;
  });
}

// ------- BACKEND: FETCH PROFILE /me (self) -------
async function fetchProfileAndApply() {
  try {
    const headers = getAuthHeaders();
    if (!headers.Authorization) {
      console.warn("No token in localStorage, showing default profile.");
      await onConfigChange(defaultConfig);
      renderLoginStreakGrid([]); // 👈 guest → sab grey
      return;
    }

    const res = await fetch(`${API_BASE}/profile/me`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      console.error("Failed to load profile", res.status);
      await onConfigChange(defaultConfig);
      renderLoginStreakGrid([]); // error case
      return;
    }

    const data = await res.json();

    const loginDates = Array.isArray(data.loginDatesThisYear)
      ? data.loginDatesThisYear
      : [];
    renderLoginStreakGrid(loginDates);

    const prettyPoints =
      typeof data.totalPoints === "number"
        ? data.totalPoints.toLocaleString("en-IN") + " Points"
        : defaultConfig.total_points;

    const rankText =
      typeof data.rankGlobal === "number" && data.rankGlobal > 0
        ? `#${data.rankGlobal}`
        : defaultConfig.user_ranking;

    const cfgFromBackend = {
      user_name: data.name || defaultConfig.user_name,
      username: data.email
        ? "@" + data.email.split("@")[0]
        : defaultConfig.username,
      branch_name: data.branchLabel || defaultConfig.branch_name,
      total_points: prettyPoints,
      doubts_solved:
        data.doubtsSolved != null
          ? String(data.doubtsSolved)
          : defaultConfig.doubts_solved,
      problems_attempted:
        data.problemsAttempted != null
          ? String(data.problemsAttempted)
          : defaultConfig.problems_attempted,
      user_ranking: rankText,
    };

    await onConfigChange(cfgFromBackend);

    const streakDaysEl = document.getElementById("streakDaysValue");
    if (streakDaysEl && typeof data.daysActiveThisYear === "number") {
      streakDaysEl.textContent = data.daysActiveThisYear;
    }

    const rankSubtitleEl = document.getElementById("rankSubtitle");
    if (rankSubtitleEl) {
      if (
        typeof data.totalUsersGlobal === "number" &&
        data.totalUsersGlobal > 0
      ) {
        rankSubtitleEl.textContent = `Out of ${data.totalUsersGlobal} learners`;
      } else {
        rankSubtitleEl.textContent = "Out of all AlephLearn learners";
      }
    }
  } catch (err) {
    console.error("Error fetching profile:", err);
    await onConfigChange(defaultConfig);
    renderLoginStreakGrid([]); // fallback
  }
}

// ------- BACKEND: FETCH OTHER USER PROFILE (by email) -------
async function fetchOtherProfileAndApply(email) {
  try {
    const headers = getAuthHeaders(); // may or may not have auth
    const res = await fetch(
      `${API_BASE}/profile/card?email=${encodeURIComponent(email)}`,
      {
        method: "GET",
        headers,
      }
    );

    if (!res.ok) {
      console.error("Failed to load foreign profile", res.status);
      await onConfigChange(defaultConfig);
      renderLoginStreakGrid([]);
      return;
    }

    const data = await res.json();

    // foreign profile: no login streak info yet → all grey
    renderLoginStreakGrid([]);

    const rankText =
      typeof data.rank === "number" && data.rank > 0
        ? `#${data.rank}`
        : defaultConfig.user_ranking;

    const cfg = {
      user_name: data.name || defaultConfig.user_name,
      username: data.email
        ? "@" + data.email.split("@")[0]
        : defaultConfig.username,
      branch_name: data.branchLabel || defaultConfig.branch_name,
      total_points: defaultConfig.total_points, // Mini card me nahi hai, so default
      doubts_solved:
        data.doubtsSolved != null
          ? String(data.doubtsSolved)
          : defaultConfig.doubts_solved,
      problems_attempted:
        data.problemsAttempted != null
          ? String(data.problemsAttempted)
          : defaultConfig.problems_attempted,
      user_ranking: rankText,
    };

    await onConfigChange(cfg);

    const rankSubtitleEl = document.getElementById("rankSubtitle");
    if (rankSubtitleEl) {
      if (typeof data.totalUsers === "number" && data.totalUsers > 0) {
        rankSubtitleEl.textContent = `Out of ${data.totalUsers} learners`;
      } else {
        rankSubtitleEl.textContent = "Out of all AlephLearn learners";
      }
    }

    // likes from mini profile
    const likeCountEl = document.getElementById("likeCount");
    if (likeCountEl && typeof data.likes === "number") {
      likeCount = data.likes;
      likeCountEl.textContent = data.likes;
    }

    const likeBtn = document.getElementById("likeBtn");
    if (likeBtn && data.likedByMe) {
      likeBtn.classList.add("liked");
    }

    // interests if provided
    if (Array.isArray(data.interests)) {
      interests = data.interests;
      renderInterests();
    }
  } catch (err) {
    console.error("Error loading foreign profile:", err);
    await onConfigChange(defaultConfig);
    renderLoginStreakGrid([]);
  }
}

function renderLoginStreakGrid(loginDates) {
  const container = document.getElementById("streakContainer");
  if (!container) return;

  container.innerHTML = "";

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-11

  const monthName = today.toLocaleString("default", { month: "short" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const activeDays = new Set();
  if (Array.isArray(loginDates)) {
    loginDates.forEach((str) => {
      if (!str) return;
      const d = new Date(str);
      if (!isNaN(d) && d.getFullYear() === year && d.getMonth() === month) {
        activeDays.add(d.getDate());
      }
    });
  }

  const row = document.createElement("div");
  row.className = "streak-row";

  const label = document.createElement("div");
  label.className = "streak-month-label";
  label.textContent = monthName;
  row.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "streak-month-grid";

  for (let d = 1; d <= daysInMonth; d++) {
    const dayEl = document.createElement("div");
    dayEl.className = "streak-day";

    if (activeDays.has(d)) {
      dayEl.classList.add("active");
    } else {
      dayEl.classList.add("inactive");
    }

    grid.appendChild(dayEl);
  }

  row.appendChild(grid);
  container.appendChild(row);
}

let likeCount = 0;
let isLiked = false;

// ------- BACKEND: LIKES (self only) -------

async function loadLikesFromBackend() {
  if (viewingOther) return; // foreign profile like-count mini card se aa raha

  try {
    const headers = getAuthHeaders();
    if (!headers.Authorization) {
      document.getElementById("likeCount").textContent = likeCount;
      return;
    }

    const res = await fetch(`${API_BASE}/profile/likes/me`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.warn("Failed to load likes:", res.status);
      return;
    }
    const data = await res.json();
    likeCount = data.likes || 0;
    isLiked = !!data.likedByMe;

    const likeCountEl = document.getElementById("likeCount");
    if (likeCountEl) likeCountEl.textContent = likeCount;

    const likeBtn = document.getElementById("likeBtn");
    if (likeBtn) {
      if (isLiked) likeBtn.classList.add("liked");
      else likeBtn.classList.remove("liked");
    }
  } catch (err) {
    console.error("Error loading likes:", err);
  }
}

function setupLikeButton() {
  const likeBtn = document.getElementById("likeBtn");
  const likeCountEl = document.getElementById("likeCount");
  if (!likeBtn || !likeCountEl) return;

  // Foreign profile → abhi ke liye sirf count show, no toggle
  if (viewingOther) {
    likeBtn.classList.add("like-readonly");
    likeBtn.disabled = true;
    return;
  }

  likeBtn.addEventListener("click", async () => {
    try {
      const headers = getAuthHeaders();
      if (!headers.Authorization) {
        alert("Please login to like your profile.");
        return;
      }

      const res = await fetch(`${API_BASE}/profile/likes/me/toggle`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        console.warn("Failed to toggle like:", res.status);
        return;
      }
      const data = await res.json();
      likeCount = data.likes || 0;
      isLiked = !!data.likedByMe;

      likeCountEl.textContent = likeCount;

      if (isLiked) {
        likeBtn.classList.add("liked");
      } else {
        likeBtn.classList.remove("liked");
      }

      const icon = likeBtn.querySelector(".btn-icon");
      if (!icon) return;
      icon.style.transform = "scale(1.3)";
      setTimeout(() => {
        icon.style.transform = "scale(1)";
      }, 300);
    } catch (err) {
      console.error("Error toggling like:", err);
    }
  });
}

// -------- elementSdk (for builder) --------
if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange,
    mapToCapabilities: (config) => ({
      recolorables: [
        {
          get: () => config.background_color || defaultConfig.background_color,
          set: (value) => {
            config.background_color = value;
            window.elementSdk.setConfig({ background_color: value });
          },
        },
        {
          get: () => config.card_color || defaultConfig.card_color,
          set: (value) => {
            config.card_color = value;
            window.elementSdk.setConfig({ card_color: value });
          },
        },
        {
          get: () => config.text_color || defaultConfig.text_color,
          set: (value) => {
            config.text_color = value;
            window.elementSdk.setConfig({ text_color: value });
          },
        },
        {
          get: () =>
            config.primary_action_color ||
            defaultConfig.primary_action_color,
          set: (value) => {
            config.primary_action_color = value;
            window.elementSdk.setConfig({ primary_action_color: value });
          },
        },
        {
          get: () =>
            config.secondary_action_color ||
            defaultConfig.secondary_action_color,
          set: (value) => {
            config.secondary_action_color = value;
            window.elementSdk.setConfig({ secondary_action_color: value });
          },
        },
      ],
      borderables: [],
      fontEditable: {
        get: () => config.font_family || defaultConfig.font_family,
        set: (value) => {
          config.font_family = value;
          window.elementSdk.setConfig({ font_family: value });
        },
      },
      fontSizeable: {
        get: () => config.font_size || defaultConfig.font_size,
        set: (value) => {
          config.font_size = value;
          window.elementSdk.setConfig({ font_size: value });
        },
      },
    }),
    mapToEditPanelValues: (config) =>
      new Map([
        ["user_name", config.user_name || defaultConfig.user_name],
        ["username", config.username || defaultConfig.username],
        ["branch_name", config.branch_name || defaultConfig.branch_name],
        ["total_points", config.total_points || defaultConfig.total_points],
        ["doubts_solved", config.doubts_solved || defaultConfig.doubts_solved],
        [
          "problems_attempted",
          config.problems_attempted || defaultConfig.problems_attempted,
        ],
        ["user_ranking", config.user_ranking || defaultConfig.user_ranking],
        ["interests", config.interests || defaultConfig.interests],
      ]),
  });
}

// ------- BOOT FLOW -------
setupLikeButton();
setupInterests();

async function bootProfile() {
  const token = localStorage.getItem("token");

  // Guest (no token): either view other (if email given) or default
  if (!token) {
    if (viewingOther && viewedEmail) {
      await fetchOtherProfileAndApply(viewedEmail);
    } else {
      await onConfigChange(defaultConfig);
      renderLoginStreakGrid([]);
    }
    showProfileRoot();
    return;
  }

  // Logged in
  if (viewingOther && viewedEmail) {
    // someone else's profile
    await fetchOtherProfileAndApply(viewedEmail);

    // academic card & inputs ko hide/lock
    const academicCard = document.getElementById("academicProfileCard");
    if (academicCard) {
      academicCard.style.display = "none";
    }

    showProfileRoot();
    return;
  }

  // self profile
  await fetchProfileAndApply();
  await loadInterestsFromBackend();
  await loadLikesFromBackend();
  showProfileRoot();
}

bootProfile();

function showLimitPopup() {
  const popup = document.getElementById("limitPopup");
  if (!popup) return;
  popup.style.display = "flex";
}

document.getElementById("popupOkBtn").addEventListener("click", () => {
  document.getElementById("limitPopup").style.display = "none";
});

// ===== Scoring popup =====
function showScoringPopup() {
  const popup = document.getElementById("scoringPopup");
  if (!popup) return;
  popup.style.display = "flex";
}

function hideScoringPopup() {
  const popup = document.getElementById("scoringPopup");
  if (!popup) return;
  popup.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const scoringBtn = document.getElementById("howScoringBtn");
  const scoringCloseBtn = document.getElementById("scoringCloseBtn");
  const scoringOverlay = document.getElementById("scoringPopup");

  if (scoringBtn) {
    scoringBtn.addEventListener("click", () => {
      showScoringPopup();
    });
  }

  if (scoringCloseBtn) {
    scoringCloseBtn.addEventListener("click", () => {
      hideScoringPopup();
    });
  }

  if (scoringOverlay) {
    scoringOverlay.addEventListener("click", (e) => {
      if (e.target === scoringOverlay) {
        hideScoringPopup();
      }
    });
  }
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
document.querySelectorAll('.js-logout').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.removeItem("token");
    window.location.href = "./auth.html";
  });
});
// Call automatically on page load
document.addEventListener("DOMContentLoaded", setupNavbarAvatar);