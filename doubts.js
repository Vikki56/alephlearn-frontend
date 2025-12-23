// ---------------- GLOBAL CONFIG ----------------

const API = "https://alephlearn-backend.onrender.com/api";
// import { authFetch } from "./api.js";   // path as per your project
const USER_ID = Number(localStorage.getItem("userId")) || null;
let VIEW_MODE = "ALL";   // "ALL" = Recent Doubts, "MINE" = My Doubts
let currentDoubts = [];  // last loaded list – edit ke liye
let currentAttachmentUrl = null;
let currentAttachmentName = null;
let currentSearchText = "";
let currentEditingDoubtId = null;
let editOverlay, editTitleInput, editDescInput, editSubjectInput, editSaveBtn, editCancelBtn;
let currentAcademicProfile = null;
let currentMiniProfileEmail = null;
// ------------ JWT + FETCH HELPER ---------------
function getToken() {
  return localStorage.getItem("token");
}



async function openMiniProfile(email) {
  const card = document.getElementById('miniProfileCard');
  if (!card || !email) return;

  try {
    const data = await authFetch(
      `${API}/profile/card?email=${encodeURIComponent(email)}`,
      { method: "GET" }
    );

    // --- basic UI fill ---
    const avatarEl = card.querySelector('.mp-avatar');
    const nameEl   = card.querySelector('.mp-name');
    const detailEl = card.querySelector('.mp-detail');
    const solvedEl = document.getElementById('mpSolved');
    const likesEl  = document.getElementById('mpLikes');

    avatarEl.innerText =
      data.initials || (data.name ? data.name.charAt(0).toUpperCase() : "U");

    nameEl.innerText   = data.name || "Unknown User";
    detailEl.innerText = data.branchLabel || "Student";

    solvedEl.innerText = data.doubtsSolved ?? 0;
    likesEl.innerText  = data.likes ?? 0;

    // --- remember whose card is open ---
    currentMiniProfileEmail = data.email;

    // --- View profile button (opens proper profile) ---
    const viewBtn = document.getElementById("mpViewBtn");
    if (viewBtn) {
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        window.location.href =
          `profile.html?email=${encodeURIComponent(data.email)}`;
      };
    }

    // --- Like button setup ---
    const likeBtn   = document.getElementById("mpLikeBtn");
    const likeLabel = document.getElementById("mpLikeLabel");

    if (likeBtn && likeLabel) {
      const liked = !!data.likedByMe;

      likeBtn.setAttribute("data-liked", liked ? "true" : "false");
      likeLabel.textContent = liked ? "Liked" : "Like";

      if (liked) likeBtn.classList.add("liked");
      else likeBtn.classList.remove("liked");

      likeBtn.onclick = (e) => toggleMiniProfileLike(e);
    }

    // Show card
    card.classList.remove('hidden');
    requestAnimationFrame(() => card.classList.add('show'));

    // Close on outside click
    function handleOutside(e) {
      if (!card.contains(e.target)) {
        card.classList.remove('show');
        setTimeout(() => card.classList.add('hidden'), 200);
        document.removeEventListener('click', handleOutside);
      }
    }
    document.addEventListener('click', handleOutside);

  } catch (err) {
    console.error("Mini profile error:", err);
  }
}





async function toggleMiniProfileLike(e) {
  if (e) e.stopPropagation();

  if (!currentMiniProfileEmail) return;

  const btn       = document.getElementById("mpLikeBtn");
  const labelEl   = document.getElementById("mpLikeLabel");
  const likesSpan = document.getElementById("mpLikes");

  if (!btn || !labelEl || !likesSpan) return;

  try {
    const res = await authFetch(
      `${API}/profile/card/like?email=${encodeURIComponent(currentMiniProfileEmail)}`,
      { method: "POST" }
    );

    // res = { likes: number, likedByMe: boolean }
    likesSpan.textContent = res.likes ?? 0;

    btn.setAttribute("data-liked", res.likedByMe ? "true" : "false");
    labelEl.textContent = res.likedByMe ? "Liked" : "Like";

    if (res.likedByMe) btn.classList.add("liked");
    else btn.classList.remove("liked");

  } catch (err) {
    console.error("Mini profile like toggle error:", err);
  }
}
// 🔹 Common tag suggestions for auto-complete
// 🔹 Subject-wise tag suggestions
// ---------- Tag Suggestions (subject-wise) ----------

// ===== TAGS STATE =====
let currentTags = [];

// ---------------- SUBJECT CATALOG (per stream) ----------------
// Yaha tum apne hisaab se streams/subjects badha sakte ho
// ---------------- SUBJECT CATALOG (per stream) ----------------
// Har stream ke liye subjects – yaha freely add / edit kar sakte ho

const SUBJECT_CATALOG = {
  // Default fallback (agar kuch bhi match na ho)
  default_cs: [
    "Data Structures",
    "Algorithms",
    "Web Development",
    "Database",
    "Operating Systems",
    "Computer Networks",
    "OOP in Java",
    "Machine Learning Basics",
  ],

  // ------------- SCHOOL / 11th-12th -------------
  school_pcm: [
    "Physics",
    "Chemistry",
    "Mathematics",
    "JEE Mains PYQs",
    "JEE Advanced PYQs",
  ],

  school_pcb: [
    "Physics",
    "Chemistry",
    "Biology",
    "NEET PYQs",
    "Human Physiology",
    "Genetics & Evolution",
  ],

  school_commerce: [
    "Accountancy",
    "Business Studies",
    "Economics",
    "Statistics",
    "Business Maths",
  ],

  school_arts: [
    "History",
    "Political Science",
    "Geography",
    "Sociology",
    "Psychology",
    "English Literature",
  ],

  // ------------- PROFESSIONAL TRACKS -------------
  ui_ux_design: [
    "UI/UX Basics",
    "User Research",
    "Wireframing",
    "Prototyping",
    "Figma",
    "Usability Testing",
    "Interaction Design",
    "Visual Design",
    "Design Thinking",
  ],

  professional_management: [
    "Product Management Fundamentals",
    "Marketing Basics",
    "Business Strategy",
    "Agile & Scrum",
    "User Research",
    "KPIs & Metrics",
    "Roadmapping",
    "Market Analysis",
    "Competitor Analysis",
    "Go-To-Market Strategy",
  ],

  // ------------- DIPLOMA -------------
  diploma_cse: [
    "C Programming",
    "Data Structures",
    "Computer Networks",
    "DBMS",
    "OS Fundamentals",
    "Web Development",
  ],

  diploma_ece: [
    "Basic Electronics",
    "Electronic Devices & Circuits",
    "Network Theory",
    "Digital Electronics",
    "Analog Electronics",
    "Signals and Systems",
    "Communication Systems",
    "Microprocessors & Microcontrollers",
  ],

  diploma_mech: [
    "Engineering Mechanics",
    "Thermodynamics",
    "Strength of Materials",
    "Fluid Mechanics",
    "Manufacturing Processes",
  ],

  diploma_civil: [
    "Engineering Mechanics",
    "Building Materials",
    "Surveying",
    "Structural Analysis",
    "Transportation Engineering",
  ],

  diploma_electrical: [
    "Basic Electrical Engineering",
    "Circuit Theory",
    "Electrical Machines",
    "Power Systems",
    "Control Systems",
  ],

  // ------------- B.TECH / B.E. (UG Engineering) -------------
  btech_cse: [
    "Data Structures",
    "Algorithms",
    "DBMS",
    "Operating Systems",
    "Computer Networks",
    "OOP (Java/C++)",
    "Software Engineering",
    "Web Development",
    "Machine Learning",
  ],

  btech_it: [
    "Data Structures",
    "Algorithms",
    "DBMS",
    "Web Technologies",
    "Software Engineering",
    "Computer Networks",
  ],

  btech_ece: [
    "Network Theory",
    "Analog Electronics",
    "Digital Electronics",
    "Signals and Systems",
    "Control Systems",
    "Communication Systems",
    "VLSI Design",
    "Microprocessors & Microcontrollers",
  ],

  btech_eee: [
    "Electrical Machines",
    "Power Systems",
    "Power Electronics",
    "Control Systems",
    "Measurements & Instrumentation",
  ],

  btech_mech: [
    "Engineering Mechanics",
    "Thermodynamics",
    "Strength of Materials",
    "Fluid Mechanics",
    "Theory of Machines",
    "Machine Design",
    "Heat Transfer",
    "Manufacturing Processes",
  ],

  btech_civil: [
    "Strength of Materials",
    "Structural Analysis",
    "RCC Design",
    "Steel Structures",
    "Geotechnical Engineering",
    "Transportation Engineering",
    "Environmental Engineering",
  ],

  btech_chemical: [
    "Fluid Flow Operations",
    "Heat Transfer Operations",
    "Mass Transfer Operations",
    "Reaction Engineering",
    "Process Control",
    "Chemical Technology",
  ],

  btech_biomed: [
    "Human Anatomy & Physiology",
    "Biomedical Instrumentation",
    "Bioelectric Signals",
    "Medical Imaging",
    "Biomaterials",
  ],

  // ------------- UG NON-ENGINEERING -------------
  ug_bsc_cs: [
    "Programming in C / C++",
    "Data Structures",
    "Discrete Mathematics",
    "Computer Architecture",
    "DBMS",
    "Operating Systems",
  ],

  ug_bsc_physics: [
    "Classical Mechanics",
    "Electricity & Magnetism",
    "Quantum Mechanics",
    "Solid State Physics",
    "Optics",
    "Thermal Physics",
  ],

  ug_bsc_maths: [
    "Calculus",
    "Linear Algebra",
    "Real Analysis",
    "Complex Analysis",
    "Differential Equations",
    "Numerical Methods",
  ],

  ug_bca: [
    "C Programming",
    "Data Structures",
    "DBMS",
    "Operating Systems",
    "Computer Networks",
    "Web Technologies",
    "Java Programming",
  ],

  ug_bcom: [
    "Financial Accounting",
    "Cost Accounting",
    "Corporate Accounting",
    "Business Law",
    "Taxation",
    "Financial Management",
  ],

  ug_ba: [
    "English Literature",
    "Economics",
    "Political Science",
    "History",
    "Sociology",
  ],

  // ------------- PG / MASTERS -------------
  pg_mca: [
    "Advanced Data Structures",
    "Design & Analysis of Algorithms",
    "Advanced DBMS",
    "Distributed Systems",
    "Cloud Computing",
    "Software Engineering",
  ],

  pg_mtech_cs: [
    "Advanced Algorithms",
    "Distributed Systems",
    "Machine Learning",
    "Deep Learning",
    "Cloud & Edge Computing",
    "Information Security",
  ],

  pg_mtech_ece: [
    "Advanced VLSI",
    "Digital Signal Processing",
    "Wireless Communication",
    "Embedded Systems",
  ],

  pg_mba: [
    "Marketing Management",
    "Financial Management",
    "Operations Management",
    "Organizational Behaviour",
    "Business Analytics",
    "Strategic Management",
  ],

  // ------------- PHD / RESEARCH -------------
  phd_cs: [
    "Research Methodology",
    "Advanced Algorithms",
    "Distributed Systems",
    "Deep Learning",
    "High Performance Computing",
    "Paper Review / Literature Survey",
  ],

  phd_data_science: [
    "Research Methodology",
    "Probability & Statistics for ML",
    "Machine Learning",
    "Deep Learning",
    "Big Data & Distributed ML",
    "Optimization Techniques",
    "Explainable AI",
    "Paper Review / Literature Survey",
  ],

  phd_ece: [
    "Advanced Signal Processing",
    "Advanced Wireless Systems",
    "VLSI & Nanoelectronics",
    "Antenna & RF Design",
  ],

  phd_mech: [
    "Research Methodology",
    "Advanced Thermodynamics",
    "Computational Fluid Dynamics",
    "Finite Element Analysis",
    "Advanced Manufacturing",
    "Literature Survey & Publications",
  ],

  phd_management: [
    "Research Methods in Management",
    "Organizational Theory",
    "Behavioural Finance",
    "Strategic Leadership",
  ],
};

// ------------ STREAM RESOLUTION LOGIC ------------
function resolveStreamKey(profile) {
  if (!profile) return "default_cs";

  const lvl  = (profile.educationLevel || "").toLowerCase();
  const main = (profile.mainStream || "").toLowerCase();
  const spec = (profile.specialization || "").toLowerCase();
  const both = `${main} ${spec}`;

  // 0️⃣ PROFESSIONAL TRACKS (industry)
  if (lvl.includes("professional")) {
    // UI / UX / Design
    if (
      main.includes("design") ||
      spec.includes("design") ||
      spec.includes("ui") ||
      spec.includes("ux")
    ) {
      return "ui_ux_design";
    }

    // Product / Management
    if (
      main.includes("management") ||
      spec.includes("management") ||
      spec.includes("product")
    ) {
      return "professional_management";
    }
  }

  // 1️⃣ SCHOOL 11–12
  if (lvl.includes("11") || lvl.includes("12") || lvl.includes("class")) {
    if (spec.includes("pcm")) return "school_pcm";
    if (spec.includes("pcb") || spec.includes("bio")) return "school_pcb";
    if (main.includes("commerce")) return "school_commerce";
    if (main.includes("arts") || main.includes("humanities")) return "school_arts";
  }

  // 2️⃣ DIPLOMA
  if (lvl.includes("diploma")) {
    if (spec.includes("computer") || spec.includes("cse") || spec.includes("cs")) {
      return "diploma_cse";
    }
    if (
      spec.includes("ece") ||
      spec.includes("electronics & communication") ||
      spec.includes("electronics and communication") ||
      spec.includes("electronics & comm") ||
      spec.includes("electronics") ||
      main.includes("ece")
    ) {
      return "diploma_ece";
    }
    if (spec.includes("mechanical") || spec.includes("mech")) {
      return "diploma_mech";
    }
    if (spec.includes("civil")) {
      return "diploma_civil";
    }
    if (spec.includes("electrical")) {
      return "diploma_electrical";
    }
  }

  // 3️⃣ B.TECH / B.E. / ENGINEERING
  if (both.includes("engineering") || both.includes("b.tech") || both.includes("btech")) {
    if (spec.includes("computer") || spec.includes("cse") || spec.includes("cs")) {
      return "btech_cse";
    }
    if (spec.includes("it") || spec.includes("information technology")) {
      return "btech_it";
    }
    if (spec.includes("ece") || spec.includes("electronics")) {
      return "btech_ece";
    }
    if (spec.includes("eee") || spec.includes("electrical")) {
      return "btech_eee";
    }
    if (spec.includes("mechanical") || spec.includes("mech")) {
      return "btech_mech";
    }
    if (spec.includes("civil")) {
      return "btech_civil";
    }
    if (spec.includes("chemical")) {
      return "btech_chemical";
    }
    if (spec.includes("biomedical") || spec.includes("bio-med") || spec.includes("biomed")) {
      return "btech_biomed";
    }
  }

  // 4️⃣ BSc / BCA / BCom / BA
  if (lvl.includes("bsc") || main.includes("b.sc")) {
    if (spec.includes("computer") || spec.includes("cs")) return "ug_bsc_cs";
    if (spec.includes("physics")) return "ug_bsc_physics";
    if (spec.includes("math")) return "ug_bsc_maths";
  }

  if (lvl.includes("bca") || main.includes("bca")) return "ug_bca";

  if (lvl.includes("b.com") || lvl.includes("bcom") || main.includes("commerce ug")) {
    return "ug_bcom";
  }

  if (lvl.includes("ba") || main.includes("arts ug") || main.includes("humanities ug")) {
    return "ug_ba";
  }

  // 5️⃣ PG / Masters
  if (lvl.includes("mca")) return "pg_mca";

  if (lvl.includes("m.tech") || lvl.includes("mtech") || lvl.includes("m.e") || lvl.includes("me")) {
    if (spec.includes("computer") || spec.includes("cs") || spec.includes("cse")) {
      return "pg_mtech_cs";
    }
    if (spec.includes("ece") || spec.includes("electronics")) {
      return "pg_mtech_ece";
    }
  }

  if (lvl.includes("mba")) return "pg_mba";

  // 6️⃣ PhD / Doctorate
  if (lvl.includes("phd") || lvl.includes("ph.d") || lvl.includes("doctorate")) {

    // PhD Data Science / AI / ML
    if (
      both.includes("data science") ||
      spec.includes("machine learning") ||
      spec.includes("ml") ||
      spec.includes("ai") ||
      both.includes("artificial intelligence")
    ) {
      return "phd_data_science";
    }

    // PhD CS / IT
    if (
      spec.includes("computer") ||
      spec.includes("cs") ||
      spec.includes("cse") ||
      main.includes("computer") ||
      main.includes("it & computer")
    ) {
      return "phd_cs";
    }

    if (spec.includes("ece") || spec.includes("electronics")) {
      return "phd_ece";
    }
    if (spec.includes("mechanical") || spec.includes("mech")) {
      return "phd_mech";
    }
    if (spec.includes("management") || spec.includes("business")) {
      return "phd_management";
    }
  }

  // 7️⃣ Fallback
  return "default_cs";
}

// Helper: given profile, return subject list
function getSubjectsForProfile(profile) {
  const key = resolveStreamKey(profile);
  return SUBJECT_CATALOG[key] || SUBJECT_CATALOG.default_cs;
}
function getTagsForProfile(profile) {
  const key = resolveStreamKey(profile);

  return TAG_SUGGESTIONS_STREAM[key] || TAG_SUGGESTIONS_STREAM.default;
}
// Dropdown me actual <option> inject karega
function applySubjectsToDropdown(subjects) {
  const sel = document.getElementById("subject");
  if (!sel) return;

  const previousValue = sel.value;

  // Clear and add "Select Subject"
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select Subject";
  sel.appendChild(placeholder);

  subjects.forEach((subj) => {
    const opt = document.createElement("option");
    opt.value = subj;
    opt.textContent = subj;
    sel.appendChild(opt);
  });

  // agar pehle koi value select thi aur still available hai, use restore karo
  if (previousValue && subjects.includes(previousValue)) {
    sel.value = previousValue;
  }
}
// subject wise suggestions
const TAG_SUGGESTIONS_STREAM = {
  // 🌟 DEFAULT (fallback)
  default: ["general", "notes", "help", "beginner"],

  // ⭐ CSE / IT
  btech_cse: [
    "java", "c++", "python", "debugging", "recursion", "dp",
    "binary-tree", "graph", "oops", "sql", "dsa", "webdev"
  ],

  // ⭐ ECE / EEE
  btech_ece: [
    "circuits", "signals", "network-theory", "semiconductors",
    "amplifiers", "communication", "vlsi"
  ],

  // ⭐ MECHANICAL
  btech_mech: [
    "thermodynamics", "fluid-mechanics", "somm", "manufacturing",
    "ic-engines", "design"
  ],

  // ⭐ 11-12th PCM
  school_pcm: [
    "physics", "chemistry", "maths", "jee", "mains", "advanced",
    "numericals", "formula", "shortcuts"
  ],

  // ⭐ 11-12th PCB
  school_pcb: [
    "botany", "zoology", "neet", "biology", "physics", "chemistry"
  ],

  // ⭐ PHd Computer Science
  phd_cs: [
    "research", "paper-review", "methodology",
    "deep-learning", "distributed-systems"
  ]
};

function getSelectedSubject() {
  const sel = document.getElementById("subject");
  return sel ? sel.value : "DEFAULT";
}

function addTagFromSuggestion(tagName) {
  const input = document.getElementById("tagsInput");
  if (!input) return;

  input.value = tagName;

  // tumhara existing handleTagInput reuse kar rahe hain
  const fakeEvent = {
    key: "Enter",
    target: input,
    preventDefault() {},
  };
  handleTagInput(fakeEvent);


  const suggestionsBox = document.getElementById("tagSuggestions");
  if (suggestionsBox) {
    suggestionsBox.style.display = "none";
    suggestionsBox.innerHTML = "";
  }
}


function showTagSuggestions() {
  const suggestionsBox = document.getElementById("tagSuggestions");
  const inputEl        = document.getElementById("tagsInput");
  const subjectEl      = document.getElementById("subject");

  if (!suggestionsBox || !inputEl || !subjectEl) return;

  // Base tags → default
  let list = getTagsForProfile(currentAcademicProfile);

  // Selected subject tags merge
  const subjectVal = subjectEl.value;
  if (subjectVal && TAG_SUGGESTIONS[subjectVal]) {
    list = [
      ...getTagsForProfile(currentAcademicProfile),
      ...TAG_SUGGESTIONS[subjectVal]   // subject specific
    ];
  }

  // Input search filter
  const q = inputEl.value.trim().toLowerCase();
  if (q) {
    list = list.filter((t) => t.toLowerCase().includes(q));
  }

  // Hide if none
  if (!list.length) {
    suggestionsBox.style.display = "none";
    suggestionsBox.innerHTML = "";
    return;
  }

  suggestionsBox.innerHTML = list
    .map(
      (t) => `
        <div class="suggestion-item"
             onclick="addTagFromSuggestion('${t.replace("#", "")}')">
          <span>${t}</span>
          <span class="suggestion-badge">SUGGESTED</span>
        </div>
      `
    )
    .join("");

  suggestionsBox.style.display = "block";
}

// suggestion click → tag add
document.addEventListener("click", (e) => {
  const pill = e.target.closest(".tag-suggestion-pill");
  if (!pill) return;

  const tag = pill.getAttribute("data-tag");
  addTag(tag);

  const input = document.getElementById("tagsInput");
  if (input) input.value = "";

  showTagSuggestions();
});

// tags-area ke bahar click → dropdown hide
document.addEventListener("click", (e) => {
  const area = document.querySelector(".tags-area");
  const wrapper = document.getElementById("tagSuggestions");
  if (!area || !wrapper) return;

  if (!area.contains(e.target)) {
    wrapper.style.display = "none";
  }
});

function hideTagSuggestions() {
  const wrapper = document.getElementById("tagSuggestions");
  if (wrapper) {
    wrapper.style.display = "none";
  }
}

function selectSuggestedTag(tag) {
  const tagsContainer = document.getElementById("tagsContainer");
  const input = document.getElementById("tagsInput");
  if (!tagsContainer || !input) return;

  // duplicate mat add karo
  const exists = Array.from(
    document.querySelectorAll("#tagsContainer .tag")
  ).some((el) =>
    el.childNodes[0].textContent.trim().toLowerCase() === tag.toLowerCase()
  );
  if (exists) {
    hideTagSuggestions();
    return;
  }

  const chip = document.createElement("div");
  chip.className = "tag";
  chip.innerHTML = `
    ${tag}
    <span class="tag-remove" onclick="removeTag(this)">×</span>
  `;
  tagsContainer.insertBefore(chip, input);
  hideTagSuggestions();
}

// Page ke kahin bhi click karoge to suggestions band
document.addEventListener("click", (e) => {
  const box = document.getElementById("tagSuggestions");
  const input = document.getElementById("tagsInput");
  if (!box || !input) return;

  if (!box.contains(e.target) && e.target !== input) {
    hideTagSuggestions();
  }
});
function clearAttachment() {
  currentAttachmentUrl = null;
  currentAttachmentName = null;

  const attachmentName = document.getElementById("attachmentName");
  const attachmentPreview = document.getElementById("attachmentPreview");

  if (attachmentName) attachmentName.textContent = "";
  if (attachmentPreview) attachmentPreview.style.display = "none";

  // Optional: clear actual file input too
  const attachmentInput = document.getElementById("attachmentInput");
  if (attachmentInput) attachmentInput.value = "";
}

// Always returns parsed JSON (or null) – throws on error
async function authFetch(url, options = {}) {
  const token = localStorage.getItem("token");

  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}

  if (!res.ok) throw new Error(raw || `HTTP ${res.status}`);

  return data;
}


async function loadActivityStats() {
  if (!USER_ID) return;

  try {
    const stats = await authFetch(`${API}/activity?userId=${USER_ID}`);

    const doubtsEl   = document.getElementById("activity-doubts-count");
    const answersEl  = document.getElementById("activity-answers-count");
    const acceptedEl = document.getElementById("activity-accepted-count");

    if (doubtsEl)   doubtsEl.textContent   = stats.doubtsPosted      ?? 0;
    if (answersEl)  answersEl.textContent  = stats.answersGiven      ?? 0;
    if (acceptedEl) acceptedEl.textContent = stats.solutionsAccepted ?? 0;
  } catch (err) {
    console.error("Failed to load activity stats", err);
  }
}
async function loadMyAcademicProfile() {
  try {
    // ✅ ALWAYS use API base
    const has = await authFetch(`${API}/profile/academic/has`, { method: "GET" });

    if (!has) {
      // profile nahi hai → default subjects dikhado
      applySubjectsToDropdown(getSubjectsForProfile(null));
      return;
    }

    const data = await authFetch(`${API}/profile/academic/me`, { method: "GET" });
    currentAcademicProfile = data;

    // Top par stream badge (agar tumne HTML me add kiya ho)
    updateDoubtStreamBadge(data);

    // 🔥 Stream ke hisaab se subjects set karo
    const subjects = getSubjectsForProfile(data);
    applySubjectsToDropdown(subjects);
  } catch (err) {
    console.error("Failed to load academic profile for doubts:", err);
    // error hua toh bhi at least default CS list de do
    applySubjectsToDropdown(getSubjectsForProfile(null));
  }
}

function updateDoubtStreamBadge(p) {
  const badge = document.getElementById("doubtStreamBadge");
  const text  = document.getElementById("doubtStreamText");
  if (!badge || !text || !p) return;

  const lvl  = p.educationLevel || "Unknown Level";
  const main = p.mainStream || "Unknown Stream";
  const spec = p.specialization || "General";

  text.innerHTML = `
    <span class="level">${lvl}</span>
    <span>·</span>
    <span class="stream">${main}</span>
    <span>·</span>
    <span class="spec">${spec}</span>
  `;

  badge.classList.remove("hidden");
}


// --- EXPOSE FUNCTIONS FOR INLINE HTML HANDLERS ---
window.showTagSuggestions = showTagSuggestions;
window.handleTagInput    = handleTagInput;
window.postDoubt         = postDoubt;
window.setVisibility     = setVisibility;
window.openPreview       = openPreview;
window.removeTag         = removeTag;

// ---------------- UI CONFIG ----------------
const defaultConfig = {
  platform_name: "AlephLearn",
  page_title: "Doubts & Solutions",
  ask_doubt_title: "Ask a Doubt",
  feed_title: "Recent Doubts",
  leaderboard_title: "Top Solvers",
  background_color: "#f5f7fa",
  card_color: "#ffffff",
  text_color: "#2d3748",
  primary_action_color: "#667eea",
  secondary_action_color: "#764ba2",
  font_family: "Inter",
  font_size: 16,
};

let currentVisibility = "public";

function showToast(message) {
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toastMessage");
  if (!toast || !toastMessage) {
    alert(message);
    return;
  }
  toastMessage.textContent = message;
  toast.classList.add("active");
  setTimeout(() => toast.classList.remove("active"), 3000);
}

// container helper
function getTagsContainer() {
  return document.getElementById("tagsContainer");
}

// UI pe chips redraw
function renderTagChips() {
  const container = getTagsContainer();
  if (!container) return;

  // sirf input ko bacha ke baaki chips hatao
  const input = document.getElementById("tagsInput");
  container.innerHTML = "";
  currentTags.forEach((tag) => {
    const chip = document.createElement("div");
    chip.className = "tag";
    chip.innerHTML = `
      ${tag}
      <span class="tag-remove" data-tag="${tag}">×</span>
    `;
    container.appendChild(chip);
  });
  container.appendChild(input);
}

// new tag add
function addTag(rawTag) {
  const t = rawTag.trim().toLowerCase();
  if (!t) return;

  if (!currentTags.includes(t)) {
    currentTags.push(t);
    renderTagChips();
    showTagSuggestions();
  }
}

// chip remove click (event delegation ko use kar rahe)
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tag-remove")) {
    const tag = e.target.getAttribute("data-tag");
    currentTags = currentTags.filter((t) => t !== tag);
    renderTagChips();
    showTagSuggestions();
  }
});

function buildPreviewHtml() {
  const subject     = document.getElementById("subject").value.trim();
  const title       = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();
  const codeSnippet = document.getElementById("code").value.trim();
  const tags        = collectTags();

  return `
    <div class="doubt-card preview">
      <h2 class="doubt-title">${title || "(No title)"}</h2>
      <div class="doubt-meta">
        <span class="subject-chip">${subject || "No subject"}</span>
        ${
          tags
            .map((t) => `<span class="tag">${t}</span>`)
            .join("")
        }
      </div>
      <p class="doubt-desc">
        ${description || "No description yet..."}
      </p>
      ${
        codeSnippet
          ? `<pre class="code-block"><code>${codeSnippet}</code></pre>`
          : ""
      }
    </div>
  `;
}

function openPreview() {
  const modal   = document.getElementById("previewModal");
  const content = document.getElementById("previewContent");
  if (!modal || !content) return;

  content.innerHTML = buildPreviewHtml();
  modal.style.display = "block";
}

function closePreview() {
  const modal = document.getElementById("previewModal");
  if (modal) modal.style.display = "none";
}
// ========== CREATE DOUBT ==========

// ========== CREATE DOUBT ==========
async function postDoubt(e) {
  // Form submit se page refresh na ho
  if (e && e.preventDefault) e.preventDefault();

  const subject     = document.getElementById("subject").value.trim();
  const title       = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();
  const codeSnippet = document.getElementById("code").value.trim();

  if (!subject || !title || !description) {
    alert("Please fill in subject, title, and description.");
    return;
  }

  const tags       = collectTags();
  const visibility = "PUBLIC";
  const userId     = Number(localStorage.getItem("userId"));

  if (!userId) {
    alert("User not logged in");
    return;
  }

  const payload = {
    subject,
    title,
    description,
    codeSnippet,
    attachmentUrl: currentAttachmentUrl,
    tags,
    visibility,
    userId,
  };

  console.log("Posting doubt payload:", payload);

  try {
    // authFetch already parses JSON automatically
    const saved = await authFetch(`${API}/doubts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("Saved doubt:", saved);

    // ✅ Success actions
    showToast("Doubt posted successfully!");
    document.getElementById("doubtForm")?.reset();
    document.getElementById("tagsContainer").innerHTML = "";

    // ✅ Attachment ko reset karo
    currentAttachmentUrl = null;
    currentAttachmentName = null;

    const attachmentInfoEl = document.getElementById("attachmentInfo");
    if (attachmentInfoEl) attachmentInfoEl.textContent = "";

    // ✅ Feed reload
    await loadDoubtsFeed();

  } catch (err) {
    console.error("Network/JS error while posting doubt:", err);
    alert(err.message || "Failed to post");
  }
}

// ========== LIST DOUBTS ==========

async function loadDoubtsFeed(opts = {}) {
  const onlyMine = opts.onlyMine || false;

  const feed = document.getElementById("doubtsFeed");
  if (!feed) return;

  feed.innerHTML = `<p style="text-align:center;color:#777;">Loading...</p>`;

  try {
    let url;
    if (onlyMine && USER_ID) {
      // /api/doubts/mine?userId=...
      url = `${API}/doubts/mine?userId=${USER_ID}&page=0&size=10`;
    } else {
      // filters (if present in HTML)
      const fSubject = document.getElementById("filterSubject");
      const fStatus  = document.getElementById("filterStatus");
      const fSort    = document.getElementById("filterSort");

      const subject =
        fSubject && fSubject.value && fSubject.value !== "ALL"
          ? fSubject.value
          : null;
      const status =
        fStatus && fStatus.value && fStatus.value !== "ALL"
          ? fStatus.value
          : null;
      const sort = fSort && fSort.value ? fSort.value : "LATEST";

      const params = new URLSearchParams({
        page: 0,
        size: 10,
        sort,
      });

      // ✅ yahan se extra filters
      if (subject) params.append("subject", subject);
      if (status) params.append("status", status);

      // ✅ sabse important – userId ALWAYS bhejo
      if (USER_ID) {
        params.append("userId", USER_ID);
      }

      url = `${API}/doubts?${params.toString()}`;
    }

    const page = await authFetch(url);
    const list = page?.content || [];

    let filtered = list;
    if (currentSearchText) {
      const q = currentSearchText.toLowerCase();

      filtered = list.filter((d) => {
        const title   = (d.title || "").toLowerCase();
        const desc    = (d.description || "").toLowerCase();
        const subject = (d.subject || "").toLowerCase();
        const tags    = (d.tags || []).join(" ").toLowerCase();

        return (
          title.includes(q) ||
          desc.includes(q) ||
          subject.includes(q) ||
          tags.includes(q)
        );
      });
    }
    if (filtered.length === 0) {
      feed.innerHTML = `<p style="text-align:center;color:#777;">No doubts yet.</p>`;
      return;
    }

    feed.innerHTML = "";
    filtered.forEach((d) => {
      const initials = (d.asker?.name || "User")
        .split(" ")
        .map((x) => x[0])
        .join("")
        .toUpperCase();

      feed.innerHTML += `
        <div class="doubt-card" onclick="openDoubtDetail(${d.id})">
          <div class="doubt-header">
            <div>
              <h3 class="doubt-title">${d.title}</h3>
              <div class="doubt-meta">
                <span class="subject-chip">${d.subject || ""}</span>
                <div class="doubt-tags">
                  ${(d.tags || [])
                    .map((t) => `<span class="tag">${t}</span>`)
                    .join("")}
                </div>
              </div>
            </div>
            <span class="status-badge ${
              d.status === "RESOLVED" ? "status-resolved" : "status-open"
            }">
              ${d.status || "OPEN"}
            </span>
          </div>

          <p class="doubt-description">
            ${(d.description || "").slice(0, 160)}...
          </p>

          ${opts.onlyMine ? `
            <button class="edit-btn"
              onclick="editDoubt(event, ${d.id});">
               Edit
            </button>
          ` : ""}

          ${
            d.attachmentUrl
              ? `<a href="${d.attachmentUrl}" target="_blank"
                    class="attachment-pill">📎 Attachment</a>`
              : ""
          }

          <div class="doubt-stats" onclick="event.stopPropagation()">
            <!-- Yaha ab LIKE NAHI hai, sirf answers & views -->
              <span class="stat-item">
    <span>👍</span>
    <span id="like-count-${d.id}">${d.likeCount || 0}</span>
  </span>
            <span class="stat-item">
              <span></span>
              <span>${d.answerCount || 0} Answers</span>
            </span>

            <span class="stat-item">
              <span>View</span>
              <span>${d.viewCount || 0}</span>
            </span>

            <div class="doubt-author">
              <div
                class="author-avatar"
                ondblclick="openMiniProfile('${d.asker?.email || ""}')"
              >
                ${initials}
              </div>
              <span>${d.asker?.name || "Unknown"}</span>
            </div>
          </div>
        </div>
      `;
    });
  } catch (err) {
    console.error(err);
    feed.innerHTML = "Failed to load doubts.";
  }
}

// document.addEventListener("DOMContentLoaded", () => {
//   loadDoubtsFeed();

//   // 🔍 Search box wiring
//   const searchInput = document.getElementById("searchInput");
//   if (searchInput) {
//     searchInput.addEventListener("input", () => {
//       currentSearchText = searchInput.value.trim();
//       loadDoubtsFeed();        // search text change → list refresh
//     });
//   }

//   const attachBtn = document.getElementById("attachBtn");
//   const attachmentInput = document.getElementById("attachmentInput");
//   const attachmentInfo = document.getElementById("attachmentInfo");
// });
// Filter events (if controls exist)
document.getElementById("filterSubject")?.addEventListener("change", () =>
  loadDoubtsFeed()
);
document.getElementById("filterStatus")?.addEventListener("change", () =>
  loadDoubtsFeed()
);
document.getElementById("filterSort")?.addEventListener("change", () =>
  loadDoubtsFeed()
);
document.getElementById("btnMyDoubts")?.addEventListener("click", () =>
  loadDoubtsFeed({ onlyMine: true })
);
document.getElementById("btnAllDoubts")?.addEventListener("click", () =>
  loadDoubtsFeed({ onlyMine: false })
);


// --------- Edit doubt (My Doubts only) ---------
async function editDoubt(ev, id) {
  // card click par detail page open na ho isliye
  if (ev && ev.stopPropagation) ev.stopPropagation();

  currentEditingDoubtId = id;
  if (!editOverlay) return;

  try {
    // latest data le lo
    const doubt = await authFetch(`${API}/doubts/${id}`);

    editTitleInput.value = doubt.title || "";
    editDescInput.value = doubt.description || "";
    editSubjectInput.value = doubt.subject || "";

    showEditModal();
  } catch (err) {
    console.error("Failed to load doubt for editing", err);
    alert("Could not load doubt for editing.");
  }
}
async function applyEditFromModal() {
  if (!currentEditingDoubtId) {
    hideEditModal();
    return;
  }

  const newTitle = editTitleInput.value.trim();
  const newDesc = editDescInput.value.trim();
  const newSubject = editSubjectInput.value.trim();

  if (!newTitle) {
    alert("Title cannot be empty.");
    return;
  }

  try {
    await authFetch(`${API}/doubts/${currentEditingDoubtId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle,
        description: newDesc,
        subject: newSubject || null,
        // tags ko abhi yahi rehne do, tum future me modal se bhi bhej sakte ho
      }),
    });

    hideEditModal();

    // My Doubts tab pe ho toh sirf mine load karo,
    // warna normal feed load kar do — ye logic tumhare paas pehle se hoga,
    // simplest: hamesha normal reload:
    loadDoubtsFeed({ onlyMine: true });// ya jo bhi flag tum use kar rahe ho
  } catch (err) {
    console.error("Failed to update doubt", err);
    alert("Failed to update doubt.");
  }
  loadDoubtsFeed({ onlyMine: true });
}

function showEditModal() {
  if (!editOverlay) return;
  editOverlay.style.display = "flex";
}

function hideEditModal() {
  if (!editOverlay) return;
  editOverlay.style.display = "none";
  currentEditingDoubtId = null;
}


// ========== LIKE DOUBT (only once per user) ==========
async function toggleLike(doubtId, e) {
  if (e) e.stopPropagation();

  if (!USER_ID) {
    showToast("Please login to like doubts.");
    return;
  }

  const btn =
    e?.currentTarget || document.getElementById(`like-btn-${doubtId}`);
  if (!btn) {
    console.warn("Like button not found for doubt", doubtId);
    return;
  }

  let liked = btn.getAttribute("data-liked") === "true";

  try {
    let res;
    if (!liked) {
      // LIKE
      res = await authFetch(`${API}/doubts/${doubtId}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      });
      btn.setAttribute("data-liked", "true");
      btn.classList.add("liked");
    } else {
      // UNLIKE
      res = await authFetch(`${API}/doubts/${doubtId}/like`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      });
      btn.setAttribute("data-liked", "false");
      btn.classList.remove("liked");
    }

    // count update karo
    const feedSpan   = document.getElementById(`like-count-${doubtId}`);
    const detailSpan = document.getElementById("detail-like-count");

    if (feedSpan)   feedSpan.textContent   = res.likeCount;
    if (detailSpan) detailSpan.textContent = res.likeCount;
  } catch (err) {
    console.error("Toggle like error:", err);
    showToast("Failed to update like.");
  }
}

async function unlikeDoubt(id, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (!USER_ID) {
    showToast("Please login to unlike doubts.");
    return;
  }

  try {
    const data = await authFetch(`${API}/doubts/${id}/unlike`, {
      method: "POST",
      body: JSON.stringify({ userId: USER_ID }),
    });

    const newCount =
      data && typeof data.likeCount === "number" ? data.likeCount : null;

    const feedSpan = document.getElementById(`like-count-${id}`);
    if (feedSpan && newCount !== null) {
      feedSpan.textContent = newCount;
    }

    const detailSpan = document.getElementById(`like-count-detail-${id}`);
    if (detailSpan && newCount !== null) {
      detailSpan.textContent = newCount;
    }
  } catch (err) {
    console.error("Unlike failed", err);
    showToast(err.message || "Failed to unlike");
  }
}

// ========== DOUBT DETAIL + ANSWERS ==========

// just above bottom of file, replace old openDoubtDetail
function openDoubtDetail(id) {
  // go to separate detail page with ?id=...
  window.location.href = `doubt-detail.html?id=${id}`;
}

async function loadAnswers(id) {
  const box = document.getElementById("answerList");

  try {
    const list = await authFetch(`${API}/doubts/${id}/answers`);

    if (!list.length) {
      box.innerHTML = "<p>No answers yet.</p>";
      return;
    }

    box.innerHTML = list.map(a => `
      <div class="answer-card ${a.accepted ? "accepted" : ""}">
        <div class="answer-header">
          <div class="answer-author-info">
            <div class="solver-avatar">
              ${(a.solver.name || "U")
                .split(" ").map(x => x[0]).join("").toUpperCase()}
            </div>
            <p class="solver-name">${a.solver.name}</p>
          </div>
          ${a.accepted ? 
            '<span class="accepted-badge">✓ Accepted</span>' : ""}
        </div>
        <div class="answer-body">
          <p>${a.body}</p>
        </div>
      </div>
    `).join("");

  } catch (err) {
    console.error(err);
    box.innerHTML = "<p>Failed to load answers.</p>";
  }
}

async function postAnswer(id) {
  const input = document.getElementById("answerInput");
  if (!input) return;

  const text = input.value.trim();
  if (!text) {
    showToast("Type something");
    return;
  }

  if (!USER_ID) {
    showToast("Login to post an answer.");
    return;
  }

  try {
    await authFetch(`${API}/doubts/${id}/answers`, {
      method: "POST",
      body: JSON.stringify({
        userId: USER_ID,
        body: text,
        attachmentUrl: null,
      }),
    });
    input.value = "";
    showToast("Answer posted!");
    loadAnswers(id, true);
  } catch (err) {
    console.error(err);
    showToast("Network error");
  }
}

// Accept answer (mark doubt resolved)
async function acceptAnswer(answerId, doubtId) {
  if (!USER_ID) {
    showToast("Login first.");
    return;
  }
  try {
    await authFetch(`${API}/doubts/answers/${answerId}/accept`, {
      method: "POST",
      body: JSON.stringify({ userId: USER_ID }),
    });
    showToast("Answer accepted!");
    loadAnswers(doubtId, true);
    loadDoubtsFeed(); // status badge update
  } catch (err) {
    console.error(err);
    showToast("Failed to accept answer");
  }
}


// ✅ Add a single tag chip to UI (if not already present)
function addTagChip(label) {
  const value = (label || "").trim();
  if (!value) return;

  const tagsContainer = document.getElementById("tagsContainer");
  if (!tagsContainer) return;

  // already added?
  const existing = Array.from(
    tagsContainer.querySelectorAll(".tag")
  ).some((t) =>
    t.textContent.replace("×", "").trim().toLowerCase() === value.toLowerCase()
  );

  if (existing) return;

  const chip = document.createElement("span");
  chip.className = "tag";
  chip.innerHTML = `
    ${value}
    <button class="tag-remove" type="button" onclick="removeTag(this)">×</button>
  `;

  const inputEl = document.getElementById("tagsInput");
  tagsContainer.insertBefore(chip, inputEl || null);
}


// ✅ Get suggestions based on current subject selection


// ========== TAGS, VISIBILITY, MODAL CLOSE ==========
function handleTagInput(e) {
  if (e.key === "Enter") {
    e.preventDefault();

    const input = document.getElementById("tagsInput");
    if (!input) return;

    const value = input.value.trim();
    if (!value) return;

    const tagsContainer = document.getElementById("tagsContainer");
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.innerHTML = `
      ${value}
      <button class="tag-remove" type="button" onclick="removeTag(this)">×</button>
    `;
    tagsContainer.insertBefore(chip, input);
    input.value = "";
  }
}

function removeTag(el) {
  if (el && el.parentElement) {
    el.parentElement.remove();
  }
}

function collectTags() {
  const tags = [];
  document
    .querySelectorAll("#tagsContainer .tag")
    .forEach((t) => {
      const text = t.textContent.replace("×", "").trim();
      if (text) tags.push(text);
    });
  return tags;
}

function setVisibility(type) {
  currentVisibility = type;
  const pub = document.getElementById("publicRadio");
  const priv = document.getElementById("privateRadio");
  if (!pub || !priv) return;
  pub.classList.remove("active");
  priv.classList.remove("active");
  if (type === "public") pub.classList.add("active");
  else priv.classList.add("active");
}

function closeDoubtDetail() {
  const modal = document.getElementById("doubtModal");
  if (modal) modal.classList.remove("active");
  document.body.style.overflow = "auto";
  loadDoubtsFeed();
}

document.getElementById("doubtModal")?.addEventListener("click", (e) => {
  if (e.target.id === "doubtModal") {
    closeDoubtDetail();
  }
});

// ========== OPTIONAL ELEMENT SDK HOOKS ==========

function onConfigChange(config) {
  const platformName = config.platform_name || defaultConfig.platform_name;
  const askDoubtTitle = config.ask_doubt_title || defaultConfig.ask_doubt_title;
  const feedTitle = config.feed_title || defaultConfig.feed_title;
  const leaderboardTitle =
    config.leaderboard_title || defaultConfig.leaderboard_title;

  const customFont = config.font_family || defaultConfig.font_family;
  const baseFontStack = "Inter, sans-serif";
  const baseSize = config.font_size || defaultConfig.font_size;

  const nameEl = document.getElementById("platformName");
  if (nameEl) nameEl.textContent = platformName;

  const askTitleEl = document.getElementById("askDoubtTitle");
  if (askTitleEl) askTitleEl.textContent = askDoubtTitle;

  const feedTitleEl = document.getElementById("feedTitle");
  if (feedTitleEl) feedTitleEl.textContent = feedTitle;

  const lbTitleEl = document.getElementById("leaderboardTitle");
  if (lbTitleEl) lbTitleEl.textContent = leaderboardTitle;

  document.body.style.fontFamily = `${customFont}, ${baseFontStack}`;
  document.body.style.fontSize = `${baseSize}px`;
}

if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange,
    mapToCapabilities: (config) => ({
      recolorables: [],
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
        ["platform_name", config.platform_name || defaultConfig.platform_name],
        ["page_title", config.page_title || defaultConfig.page_title],
        ["ask_doubt_title", config.ask_doubt_title || defaultConfig.ask_doubt_title],
        ["feed_title", config.feed_title || defaultConfig.feed_title],
        [
          "leaderboard_title",
          config.leaderboard_title || defaultConfig.leaderboard_title,
        ],
      ]),
  });
}

onConfigChange(defaultConfig);

document.addEventListener("DOMContentLoaded", () => {
  // 🔹 initial data load
  loadDoubtsFeed();
  loadActivityStats();
  loadMyAcademicProfile();

  // ----------------- TAB SWITCHING -----------------
  const askTab     = document.querySelector('.nav-link:nth-child(1)');
  const myTab      = document.querySelector('.nav-link:nth-child(2)');
  const mainLayout = document.getElementById('mainLayout');
  const leftPanel  = document.querySelector('.left-panel');
  const feedTitle  = document.getElementById('feedTitle');

  editOverlay     = document.getElementById("editDoubtOverlay");
  editTitleInput  = document.getElementById("editTitleInput");
  editDescInput   = document.getElementById("editDescInput");
  editSubjectInput= document.getElementById("editSubjectInput");
  editSaveBtn     = document.getElementById("editSaveBtn");
  editCancelBtn   = document.getElementById("editCancelBtn");

  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", hideEditModal);
  }
  if (editSaveBtn) {
    editSaveBtn.addEventListener("click", applyEditFromModal);
  }

  if (askTab && myTab && mainLayout && leftPanel && feedTitle) {
    askTab.addEventListener('click', (e) => {
      e.preventDefault();
      askTab.classList.add('active');
      myTab.classList.remove('active');

      mainLayout.classList.remove('my-doubts-layout');
      leftPanel.style.display = 'block';
      feedTitle.textContent = 'Recent Doubts';

      loadDoubtsFeed({ onlyMine: false });
    });

    myTab.addEventListener('click', (e) => {
      e.preventDefault();
      myTab.classList.add('active');
      askTab.classList.remove('active');

      mainLayout.classList.add('my-doubts-layout');
      leftPanel.style.display = 'none';
      feedTitle.textContent = 'My Doubts';

      loadDoubtsFeed({ onlyMine: true });
    });
  }

  // 🔍 search box
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      currentSearchText = searchInput.value.trim();
      loadDoubtsFeed();
    });
  }

  // 🔹 TAG INPUT → SUGGESTIONS
  const tagInput = document.getElementById("tagsInput");
  if (tagInput) {
    tagInput.addEventListener("focus", showTagSuggestions);
    tagInput.addEventListener("input", showTagSuggestions);
  }

  const subjectSelect = document.getElementById("subject");
  if (subjectSelect) {
    subjectSelect.addEventListener("change", () => {
      const tagInput = document.getElementById("tagsInput");
      if (tagInput) tagInput.value = "";
      showTagSuggestions();
    });
  }
  // 📎 file attachment
  const attachBtn       = document.getElementById("attachBtn");
  const attachmentInput = document.getElementById("attachmentInput");
  const attachmentInfo  = document.getElementById("attachmentInfo");

  if (attachBtn && attachmentInput) {
    attachBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachmentInput.click();
    });

    attachmentInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const fd = new FormData();
        fd.append("file", file);

        const token = localStorage.getItem("token");
        const headers = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API}/files/upload`, {
          method: "POST",
          headers,
          body: fd,
        });

        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();

        currentAttachmentUrl  = data.url;
        currentAttachmentName = data.name || file.name;

        if (attachmentInfo) {
          attachmentInfo.textContent = `Attached: ${currentAttachmentName}`;
        }
      } catch (err) {
        console.error("File upload error", err);
        alert("Failed to upload file");
      }
    });
  }
});




function updateDoubtStreamBadge(p) {
  const badge = document.getElementById("doubtStreamBadge");
  const text  = document.getElementById("doubtStreamText");
  if (!badge || !text || !p) return;

  const lvl  = p.educationLevel || "Unknown Level";
  const main = p.mainStream || "Unknown Stream";
  const spec = p.specialization || "General";

  text.innerHTML = `
    <span class="level">${lvl}</span>
    <span>·</span>
    <span class="stream">${main}</span>
    <span>·</span>
    <span class="spec">${spec}</span>
  `;

  badge.classList.remove("hidden");
}


// ---- DYNAMIC NAVBAR AVATAR ----
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
window.addEventListener("load", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("al-preload");
    });
  });
});