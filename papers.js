// papers.js  (type="module")

import { API_BASE } from "./js/api.js";

const TOKEN_KEY = "token";

// TOP of papers.js


const defaultConfig = {
  platform_name: "AlephLearn",
  upload_title: "Upload Previous Year Papers",
  library_title: "Papers Library",
  company_title: "Company Assessment Papers",
  contributors_title: "Top Contributors",
  background_color: "#667eea",
  card_color: "#ffffff",
  text_color: "#2d3748",
  primary_action_color: "#667eea",
  secondary_action_color: "#764ba2",
  font_family: "Inter",
  font_size: 16
};


// const ICONS = {
//   paper: "assets/icons/paper-svgrepo-com.jpeg",
//   view: "assets/icons/view-svgrepo-com.jpeg",
//   like: "assets/icons/like-svgrepo-com.jpeg",
//   delete: "assets/icons/delete-2-svgrepo-com.jpeg",
//   // optional: agar alag download icon hai
//   download: "assets/icons/download-svgrepo-com.jpeg"
// };
const ICONS = {
  paper: "assets/icons/paper.svg",
  view: "assets/icons/view.svg",
  download: "assets/icons/download.svg",
  delete: "assets/icons/delete.svg",
  like: "assets/icons/like.svg"
};


const contributors = [
  { name: "Priya Sharma", papers: 47, badge: "🥇" },
  { name: "Rahul Verma", papers: 42, badge: "🥈" },
  { name: "Sarah Chen", papers: 38, badge: "🥉" },
  { name: "Alex Kumar", papers: 35, badge: "🏅" },
  { name: "Emily Wang", papers: 31, badge: "🏅" },
  { name: "David Lee", papers: 28, badge: "🏅" }
];

let selectedFile = null;
let currentSort = "recent";
let currentSearch = "";
let currentScope = "all";

// ---------- Toast ----------
function showToast(message) {
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toastMessage");
  toastMessage.textContent = message;
  toast.classList.add("active");
  setTimeout(() => {
    toast.classList.remove("active");
  }, 3000);
}

// ---------- Helper: auth header for multipart ----------
function getAuthHeaderOnly() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: "Bearer " + token } : {};
}

function renderPapers(papers) {
  const papersGrid = document.getElementById("papersGrid");
  if (!papersGrid) return;

  if (!papers || papers.length === 0) {
    papersGrid.innerHTML = `
      <div class="empty-state">
        <p>No papers found. Try changing filters or upload one!</p>
      </div>
    `;
    return;
  }

  papersGrid.innerHTML = papers
    .map((paper) => {
      return `
      <div class="paper-card" data-paper-id="${paper.id}">
        <div class="paper-card-inner">
          
          <!-- TOP: ICON + TITLE + META -->
          <div class="paper-card-top">
            <div class="paper-header-row">
              <div class="paper-icon-wrap">
                <img src="${ICONS.paper}" alt="Paper" class="paper-icon-img" />
              </div>
              <div class="paper-header-text">
                <h3 class="paper-title">${paper.subjectName}</h3>
<span class="paper-chip-year">
  ${paper.examYear} • ${paper.examType}
  ${paper.studentYear ? ` • Year ${paper.studentYear}` : ""}
</span>
              </div>
            </div>

            <div class="paper-meta">
              <div class="paper-meta-item">
                <span class="paper-meta-emoji">🏫</span>
                <span class="paper-meta-text">${paper.collegeName}</span>
              </div>
              <div class="paper-meta-item">
                <span class="paper-meta-emoji">👤</span>
                <span class="paper-meta-text">Uploaded by ${paper.uploadedByName}</span>
              </div>
            </div>
          </div>

          <div class="paper-divider"></div>

          <!-- MIDDLE: MAIN ACTION + STATS -->
          <div class="paper-card-middle">
            <div class="paper-primary-action">
              <button class="btn btn-primary" data-view-id="${paper.id}">
                <img src="${ICONS.view}" alt="View" class="btn-icon" />
                <span>View</span>
              </button>
            </div>

            <div class="paper-stats-row">
              <div class="paper-stat">
                <img src="${ICONS.download || ICONS.view}"
                     alt="Downloads"
                     class="paper-stat-icon-img" />
                <div class="paper-stat-text">
                  <span class="paper-stat-value" data-role="download-count">
                    ${paper.downloads}
                  </span>
                  <span class="paper-stat-label">Downloads</span>
                </div>
              </div>

              <div class="paper-stat">
                <img src="${ICONS.like}"
                     alt="Likes"
                     class="paper-stat-icon-img" />
                <div class="paper-stat-text">
                  <span class="paper-stat-value" data-role="like-count">
                    ${paper.likes}
                  </span>
                  <span class="paper-stat-label">Likes</span>
                </div>
              </div>
            </div>
          </div>

          <!-- BOTTOM: ACTION BUTTONS -->
          <div class="paper-card-bottom">
            <div class="paper-actions">
              <button class="btn btn-secondary btn-small" data-download-id="${paper.id}">
                <span>Download</span>
              </button>

              ${
                paper.ownedByMe
                  ? `<button class="btn btn-danger btn-small" data-delete-id="${paper.id}">
                       <img src="${ICONS.delete}" alt="Delete" class="btn-icon" />
                       <span>Delete</span>
                     </button>`
                  : ""
              }

              <button class="btn btn-secondary btn-small" data-like-id="${paper.id}">
                <img src="${ICONS.like}" alt="Like" class="btn-icon" />
                <span>Like</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    `;
    })
    .join("");

  // ------- listeners (same as pehle) -------
  papersGrid.querySelectorAll("[data-view-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-view-id");
      viewPaper(id);
    });
  });

  papersGrid.querySelectorAll("[data-download-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-download-id");
      downloadPaper(id);
    });
  });

  papersGrid.querySelectorAll("[data-like-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-like-id");
      likePaper(id);
    });
  });

  papersGrid.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-id");
      openDeleteModal(id);
    });
  });

  updateLoadMoreButton(papers.length);
}

function updateLoadMoreButton(papersOrLength) {
  // total papers count nikal lo (array ya number dono handle)
  const total =
    Array.isArray(papersOrLength)
      ? papersOrLength.length
      : typeof papersOrLength === "number"
        ? papersOrLength
        : 0;

  const papersGrid = document.getElementById("papersGrid");
  // 🔥 sirf Papers Library ka load-more pick karna hai
  const loadMoreWrapper = document.querySelector(".papers-load-more");
  const btn = document.getElementById("papersLoadMoreBtn");

  if (!papersGrid || !loadMoreWrapper || !btn) return;

  const labelSpan = btn.querySelector("span:last-child");

  // 1 row ~ 5 cards, 2 rows ~ 10 (screen pe depend karta hai),
  // thoda safe rakhne ke liye 10 le lete hain
  const THRESHOLD = 10;

  if (total <= THRESHOLD) {
    loadMoreWrapper.style.display = "none";
    papersGrid.classList.remove("papers-expanded", "papers-collapsed");
    btn.onclick = null;
    return;
  }

  // default: collapsed (2 row)
  loadMoreWrapper.style.display = "flex";
  papersGrid.classList.add("papers-collapsed");
  papersGrid.classList.remove("papers-expanded");
  papersGrid.scrollTop = 0;
  if (labelSpan) labelSpan.textContent = "Load More Papers";

  btn.onclick = () => {
    const isExpanded = papersGrid.classList.contains("papers-expanded");

    if (isExpanded) {
      // back to 2 rows
      papersGrid.classList.remove("papers-expanded");
      papersGrid.classList.add("papers-collapsed");
      papersGrid.scrollTop = 0;
      if (labelSpan) labelSpan.textContent = "Load More Papers";
    } else {
      // full scroll
      papersGrid.classList.remove("papers-collapsed");
      papersGrid.classList.add("papers-expanded");
      if (labelSpan) labelSpan.textContent = "Less View";
    }
  };
}

// ---------- RENDER CONTRIBUTORS ----------
function renderContributors(contributors) {
  const contributorsGrid = document.getElementById("contributorsGrid");
  if (!contributorsGrid) return;

  if (!contributors || contributors.length === 0) {
    contributorsGrid.innerHTML = `
      <div class="empty-state">
        <p>No contributors yet. Upload a paper to become the first!</p>
      </div>
    `;
    return;
  }

  contributorsGrid.innerHTML = contributors
    .map((contributor) => {
      const initials = contributor.name
        .split(" ")
        .map((n) => n[0])
        .join("");
      return `
        <div class="contributor-card">
          <div class="contributor-avatar">
            ${initials}
            <div class="contributor-badge">🏅</div>
          </div>
          <h4 class="contributor-name">${contributor.name}</h4>
          <p class="contributor-stats">Active Contributor</p>
          <div class="contributor-papers">${contributor.totalPapers} Papers</div>
        </div>
      `;
    })
    .join("");
}


async function loadContributors() {
  try {
    const res = await fetch(`${API_BASE}/api/papers/contributors`);
    if (!res.ok) throw new Error("Failed to load contributors");
    const data = await res.json();
    renderContributors(data);
    // updateLoadMoreButton(data);
  } catch (e) {
    console.error(e);
    // optional: showToast("Failed to load contributors");
  }
}
// ---------- API calls for papers ----------
async function loadPapers() {
  try {
    const params = new URLSearchParams();

    // Search
    if (currentSearch) params.append("search", currentSearch);

    // Sort: recent / popular
    if (currentSort) params.append("sort", currentSort);

    // 👇 SCOPE IMPORTANT
    // All Papers chip → GLOBAL
    // Baaki sab → STREAM + GLOBAL
    params.append("scope", currentScope);

    // 👇 STREAM KEY dedo
    const streamKey = localStorage.getItem("aleph_stream_key");
    if (streamKey) params.append("streamKey", streamKey);

    const headers = {};
    const token = localStorage.getItem("token");
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch(`${API_BASE}/api/papers?${params.toString()}`, {
      method: "GET",
      headers
    });

    if (!res.ok) throw new Error("Failed to load papers");

    const data = await res.json();
    renderPapers(data);
  } catch (err) {
    console.error(err);
    showToast("Failed to load papers");
  }
}

function viewPaper(id) {
  window.open(`${API_BASE}/api/papers/${id}/view`, "_blank");
}

function downloadPaper(id) {
  // file open karo (backend yahi pe download count update karega)
  window.open(`${API_BASE}/api/papers/${id}/download`, "_blank");

  // 🧠 FRONTEND: same card ka download counter turant badha do
  const card = document.querySelector(`.paper-card[data-paper-id="${id}"]`);
  if (!card) return;

  const downloadCountSpan = card.querySelector('[data-role="download-count"]');
  if (!downloadCountSpan) return;

  const current = parseInt(downloadCountSpan.textContent.trim(), 10) || 0;
  downloadCountSpan.textContent = current + 1;
}

async function likePaper(id) {
  const likeButton = document.querySelector(`button[data-like-id="${id}"]`);
  const card = document.querySelector(`.paper-card[data-paper-id="${id}"]`);
  const likeCountSpan = card?.querySelector('[data-role="like-count"]');

  try {
    const res = await fetch(`${API_BASE}/api/papers/${id}/like`, {
      method: "POST",
      headers: {
        ...getAuthHeaderOnly()
      }
    });

    if (!res.ok) {
      throw new Error("Failed to like paper");
    }

    const updated = await res.json();

    if (likeCountSpan && typeof updated.likes === "number") {
      likeCountSpan.textContent = updated.likes;
    }

    if (likeButton) {
      likeButton.classList.add("paper-liked");
    }

    // showToast("Liked 👍");
  } catch (e) {
    console.error(e);
    showToast("You need to be logged in to like");
  }
}

let paperToDelete = null;

function openDeleteModal(id) {
  paperToDelete = id;
  document.getElementById("deleteModal").style.display = "flex";
}

function closeDeleteModal() {
  document.getElementById("deleteModal").style.display = "none";
  paperToDelete = null;
}

document.getElementById("cancelDelete").addEventListener("click", closeDeleteModal);

document.getElementById("confirmDelete").addEventListener("click", async () => {
  if (!paperToDelete) return;

  try {
    const res = await fetch(`${API_BASE}/api/papers/${paperToDelete}`, {
      method: "DELETE",
      headers: {
        ...getAuthHeaderOnly()
      }
    });

    if (!res.ok && res.status !== 204) throw new Error("Failed");

    closeDeleteModal();
    loadPapers();
    showToast("Paper deleted");
  } catch (err) {
    console.error(err);
    closeDeleteModal();
    showToast("Only uploader can delete this paper");
  }
});

const collegeSelect = document.getElementById("collegeName");
const collegeOtherInput = document.getElementById("collegeNameOther");

collegeSelect.addEventListener("change", () => {
  if (collegeSelect.value === "__other__") {
    collegeOtherInput.style.display = "block";
  } else {
    collegeOtherInput.style.display = "none";
    collegeOtherInput.value = "";
  }
  checkFormValidity();
});

// ---------- Upload form handling ----------
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const selectedFileDiv = document.getElementById("selectedFile");
const submitBtn = document.getElementById("submitPaper");

function checkFormValidity() {
  let college = document.getElementById("collegeName").value.trim();
  const subject = document.getElementById("subjectName").value.trim();
  const year = document.getElementById("examYear").value.trim();
  const examType = document.getElementById("examType").value.trim();
  const studentYear = document.getElementById("studentYear").value.trim();

  if (college === "__other__") {
    college = document.getElementById("collegeNameOther").value.trim();
  }

  submitBtn.disabled = !(college && subject && year && examType && studentYear && selectedFile);
}

uploadArea.addEventListener("click", () => {
  fileInput.click();
});

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileSelect(files[0]);
  }
});

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

function handleFileSelect(file) {
  selectedFile = file;
  document.getElementById("fileName").textContent = file.name;
  document.getElementById("fileSize").textContent =
    (file.size / (1024 * 1024)).toFixed(2) + " MB";
  selectedFileDiv.classList.add("active");
  checkFormValidity();
}

document.getElementById("removeFile").addEventListener("click", () => {
  selectedFile = null;
  selectedFileDiv.classList.remove("active");
  fileInput.value = "";
  checkFormValidity();
});

document
  .getElementById("collegeName")
  .addEventListener("change", checkFormValidity);
document
  .getElementById("subjectName")
  .addEventListener("input", checkFormValidity);
document
  .getElementById("examYear")
  .addEventListener("change", checkFormValidity);
document
  .getElementById("examType")
  .addEventListener("change", checkFormValidity);
  document
  .getElementById("studentYear")
  .addEventListener("change", checkFormValidity);

// Submit upload to backend
submitBtn.addEventListener("click", async () => {

  let college = document.getElementById("collegeName").value.trim();
  if (college === "__other__") {
    college = document.getElementById("collegeNameOther").value.trim();
  }
  // const college = document.getElementById("collegeName").value.trim();
  const subject = document.getElementById("subjectName").value.trim();
  const year = document.getElementById("examYear").value.trim();
  const examType = document.getElementById("examType").value.trim();

  if (!selectedFile) {
    showToast("Please select a file first");
    return;
  }
  const studentYear = document.getElementById("studentYear").value.trim();
  const formData = new FormData();
  formData.append("collegeName", college);
  formData.append("subjectName", subject);
  formData.append("examYear", year);
  formData.append("examType", examType);
  formData.append("file", selectedFile);
  formData.append("studentYear", studentYear);

  try {
    const res = await fetch(`${API_BASE}/api/papers`, {
      method: "POST",
      headers: {
        ...getAuthHeaderOnly()
      },
      body: formData
    });

    const text = await res.text();

    if (!res.ok) {
      // 🔹 Backend ka proper error nikaal lo (jaise duplicate message)
      let msg = "Upload failed";
      try {
        const j = JSON.parse(text);
        if (j && j.message) msg = j.message;
      } catch (_) {
        if (text) msg = text;
      }

      // Unauthorized case alag
      if (res.status === 401 || res.status === 403) {
        msg = "You need to be logged in to upload";
      }

      throw new Error(msg);
    }

    // ok -> success
    if (text) {
      // response body agar JSON hai to ignore / parse kar sakte ho (optional)
      try { JSON.parse(text); } catch {}
    }

    showToast("Paper uploaded successfully! 🎉");

    // Reset form
    document.getElementById("collegeName").value = "";
    document.getElementById("collegeNameOther").value = "";
    document.getElementById("collegeNameOther").style.display = "none";
    document.getElementById("subjectName").value = "";
    document.getElementById("examYear").value = "";
    document.getElementById("examType").value = "";
    document.getElementById("studentYear").value = "";
    selectedFile = null;
    selectedFileDiv.classList.remove("active");
    fileInput.value = "";
    submitBtn.disabled = true;

    await loadPapers();
  } catch (e) {
    console.error(e);
    showToast(e.message || "Upload failed");
  }
});

// ---------- Filters & Search ----------
// ---------- Filters & Search ----------
document.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document
      .querySelectorAll(".filter-chip")
      .forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");

    const filter = chip.dataset.filter;

    if (filter === "all") {
      // All Papers → sab papers (global + saare streams)
      currentScope = "all";
      currentSort = "recent";
    } else if (filter === "college") {
      // My Stream → sirf user ka stream, recent
      currentScope = "stream";
      currentSort = "recent";
    } else if (filter === "recent") {
      // Recent (My Stream) → sirf user stream, recent
      currentScope = "stream";
      currentSort = "recent";
    } else if (filter === "popular") {
      // Popular (My Stream) → sirf user stream, downloads desc
      currentScope = "stream";
      currentSort = "popular";
    } else {
      // fallback
      currentScope = "stream";
      currentSort = "recent";
    }

    loadPapers();
  });
});

document
  .getElementById("searchInput")
  .addEventListener("input", (e) => {
    currentSearch = e.target.value.toLowerCase();
    loadPapers();
  });

// ---------- Config / theming (same as before) ----------
// ---------- Config / theming (safe) ----------
async function onConfigChange(config = {}) {
  const merged = { ...defaultConfig, ...config };

  const uploadTitleEl       = document.getElementById("uploadTitle");
  const libraryTitleEl      = document.getElementById("libraryTitle");
  const companyTitleEl      = document.getElementById("companyTitle");
  const contributorsTitleEl = document.getElementById("contributorsTitle");
  const platformNameEl      = document.getElementById("platformName");

  if (platformNameEl) {
    platformNameEl.textContent = merged.platform_name;
  }
  if (uploadTitleEl) {
    uploadTitleEl.textContent = merged.upload_title;
  }
  if (libraryTitleEl) {
    libraryTitleEl.textContent = merged.library_title;
  }
  if (companyTitleEl) {
    companyTitleEl.textContent = merged.company_title;
  }
  if (contributorsTitleEl) {
    contributorsTitleEl.textContent = merged.contributors_title;
  }

  const backgroundColor      = merged.background_color;
  const secondaryActionColor = merged.secondary_action_color;
  const customFont           = merged.font_family;
  const baseFontStack        = "Inter, sans-serif";
  const baseSize             = merged.font_size;

  // document.body.style.background =
  //   `linear-gradient(135deg, ${backgroundColor} 0%, ${secondaryActionColor} 100%)`;
  document.body.style.fontFamily = `${customFont}, ${baseFontStack}`;
  document.body.style.fontSize   = `${baseSize}px`;
}
if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange,
    mapToCapabilities: (config) => ({
      recolorables: [
        {
          get: () =>
            config.background_color ||
            defaultConfig.background_color,
          set: (value) => {
            config.background_color = value;
            window.elementSdk.setConfig({
              background_color: value
            });
          }
        },
        {
          get: () =>
            config.card_color || defaultConfig.card_color,
          set: (value) => {
            config.card_color = value;
            window.elementSdk.setConfig({ card_color: value });
          }
        },
        {
          get: () =>
            config.text_color || defaultConfig.text_color,
          set: (value) => {
            config.text_color = value;
            window.elementSdk.setConfig({ text_color: value });
          }
        },
        {
          get: () =>
            config.primary_action_color ||
            defaultConfig.primary_action_color,
          set: (value) => {
            config.primary_action_color = value;
            window.elementSdk.setConfig({
              primary_action_color: value
            });
          }
        },
        {
          get: () =>
            config.secondary_action_color ||
            defaultConfig.secondary_action_color,
          set: (value) => {
            config.secondary_action_color = value;
            window.elementSdk.setConfig({
              secondary_action_color: value
            });
          }
        }
      ],
      borderables: [],
      fontEditable: {
        get: () =>
          config.font_family || defaultConfig.font_family,
        set: (value) => {
          config.font_family = value;
          window.elementSdk.setConfig({ font_family: value });
        }
      },
      fontSizeable: {
        get: () =>
          config.font_size || defaultConfig.font_size,
        set: (value) => {
          config.font_size = value;
          window.elementSdk.setConfig({ font_size: value });
        }
      }
    }),
    mapToEditPanelValues: (config) =>
      new Map([
        [
          "platform_name",
          config.platform_name || defaultConfig.platform_name
        ],
        [
          "upload_title",
          config.upload_title || defaultConfig.upload_title
        ],
        [
          "library_title",
          config.library_title || defaultConfig.library_title
        ],
        [
          "company_title",
          config.company_title || defaultConfig.company_title
        ],
        [
          "contributors_title",
          config.contributors_title ||
            defaultConfig.contributors_title
        ]
      ])
  });
}
// ---------- AUTO-GENERATE YEAR DROPDOWN ----------
// ---------- AUTO-GENERATE YEAR DROPDOWN ----------
const yearSelect = document.getElementById("examYear");
if (yearSelect) {
  const currentYear = new Date().getFullYear();

  // reset kar de default option ke saath
  yearSelect.innerHTML = `<option value="">Select Year</option>`;

  for (let y = currentYear; y >= 2010; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = y;
    yearSelect.appendChild(opt);
  }
}
// ---------- INIT ----------
// ---------- INIT ----------
loadContributors();      // 🔹 API se top contributors
onConfigChange(defaultConfig);
loadPapers();

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