// Fronted/academic-profile.js
import { API_BASE } from "./js/api.js";

const TOKEN_KEY = "token";

function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {})
  };
}

/**
 * Dropdown data
 */

// Education levels
const EDUCATION_LEVELS = [
  "10th",
  "11th",
  "12th",
  "Graduation",
  "Masters",
  "Higher Studies"
];

// For each education level, allowed main streams
const MAIN_STREAMS_BY_LEVEL = {
  "10th": ["General"],
  "11th": ["Science", "Arts", "Biology"],
  "12th": ["Science", "Arts", "Biology"],
  "Graduation": ["Engineering", "Medical", "Science", "Commerce", "Arts", "Other"],
  "Masters": ["Engineering", "Medical", "Science", "Commerce", "Arts", "Other"],
  "Higher Studies": ["Engineering", "Medical", "Science", "Commerce", "Arts", "Other"]
};

// For each main stream, specializations
const SPECIALIZATIONS_BY_STREAM = {
  // 10th / generic
  "General": ["General"],

  // 11th / 12th
  "Science": ["PCM", "PCB", "PCMB", "Computer Science", "Other"],
  "Biology": ["PCB", "Biology + Math", "Other"],
  "Arts": ["Humanities", "Political Science", "History", "Sociology", "Other"],

  // Engineering
  "Engineering": [
    "Computer Science",
    "Information Technology",
    "Electronics & Communication",
    "Electrical",
    "Mechanical",
    "Civil",
    "Chemical",
    "Biomedical",
    "Other"
  ],

  // Medical
  "Medical": ["MBBS", "BDS", "Nursing", "Pharmacy", "Physiotherapy", "Other"],

  // Generic UG/PG
  "Science": ["BSc CS", "BSc Physics", "BSc Chemistry", "BSc Maths", "Other"],
  "Commerce": ["BCom", "BBA", "Finance", "Accounting", "Other"],
  "Other": ["Other"]
};

function $(id) {
  return document.getElementById(id);
}

/**
 * Dropdown helpers
 */
function populateSelect(selectEl, options, placeholder = "Select") {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = placeholder;
  selectEl.appendChild(defaultOpt);

  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    selectEl.appendChild(o);
  });
}

function initDropdowns(existing) {
  const eduSelect = $("educationLevel");
  const streamSelect = $("mainStream");
  const specSelect = $("specialization");

  if (!eduSelect || !streamSelect || !specSelect) return;

  // Education level options
  populateSelect(eduSelect, EDUCATION_LEVELS, "Select level");

  // If existing data hai to usko set karo, warna blank
  if (existing) {
    eduSelect.value = existing.educationLevel || "";
  }

  // Based on current edu level, stream options
  function updateStreams() {
    const level = eduSelect.value;
    const streams = MAIN_STREAMS_BY_LEVEL[level] || [];
    populateSelect(streamSelect, streams, streams.length ? "Select stream" : "No options");
    // Clear / recalc specialization also
    updateSpecializations();
  }

  function updateSpecializations() {
    const stream = streamSelect.value;
    const specs = SPECIALIZATIONS_BY_STREAM[stream] || [];
    populateSelect(
      specSelect,
      specs,
      specs.length ? "Select specialization" : "No options"
    );
  }

  eduSelect.addEventListener("change", () => {
    updateStreams();
  });

  streamSelect.addEventListener("change", () => {
    updateSpecializations();
  });

  // Agar existing profile hai to uske hisaab se bhi set karo
  if (existing) {
    if (existing.educationLevel) {
      eduSelect.value = existing.educationLevel;
      updateStreams();
    }
    if (existing.mainStream) {
      streamSelect.value = existing.mainStream;
      updateSpecializations();
    }
    if (existing.specialization) {
      specSelect.value = existing.specialization;
    }
  } else {
    updateStreams(); // initial empty
  }
}

/**
 * Backend calls
 */

async function loadExistingProfile() {
  const statusEl = $("academicProfileStatus");
  try {
    // Pehle /has se check karein
    const hasRes = await fetch(`${API_BASE}/api/profile/academic/has`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!hasRes.ok) {
      throw new Error("Failed to check profile");
    }

    const hasProfile = await hasRes.json();

    if (!hasProfile) {
      initDropdowns(null);
      if (statusEl) {
        statusEl.textContent =
          "No academic profile yet. Please fill your details and save.";
      }
      return;
    }

    // Ab actual profile load karo
    const res = await fetch(`${API_BASE}/api/profile/academic/me`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      throw new Error("Failed to load profile");
    }

    const data = await res.json();
    initDropdowns(data);

    if (statusEl) {
      statusEl.textContent = "Academic profile already saved. You can update it here.";
      statusEl.style.color = "#9AE6B4"; // light green
    }
  } catch (e) {
    console.error("Failed to load academic profile:", e);
    initDropdowns(null);
    if (statusEl) {
      statusEl.textContent =
        "Could not load academic profile. You can still fill and try saving.";
      statusEl.style.color = "#F6E05E"; // yellow
    }
  }
}

async function saveAcademicProfile() {
  const edu = $("educationLevel")?.value || "";
  const stream = $("mainStream")?.value || "";
  const spec = $("specialization")?.value || "";
  const statusEl = $("academicProfileStatus");
  const btn = $("saveAcademicProfileBtn");

  if (!edu || !stream || !spec) {
    if (statusEl) {
      statusEl.textContent = "Please select all three: level, stream and specialization.";
      statusEl.style.color = "#FEB2B2"; // soft red
    }
    return;
  }

  const payload = {
    educationLevel: edu,
    mainStream: stream,
    specialization: spec
  };

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }

    const res = await fetch(`${API_BASE}/api/profile/academic`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error("Failed to save profile");
    }

    const data = await res.json();
    console.log("Saved academic profile:", data);

    if (statusEl) {
      statusEl.textContent =
        "Academic profile saved ✅. Now we will show you content for " +
        data.specialization +
        ".";
      statusEl.style.color = "#9AE6B4";
    }
  } catch (e) {
    console.error(e);
    if (statusEl) {
      statusEl.textContent =
        "Error saving profile. Please check your login and try again.";
      statusEl.style.color = "#FEB2B2";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save Academic Profile";
    }
  }
}

/**
 * Init
 */
document.addEventListener("DOMContentLoaded", () => {
  // Agar ye profile.html nahi hai to kuch mat karo
  const body = document.body;
  if (!body || body.getAttribute("data-page") !== "profile") return;

  loadExistingProfile();

  const btn = $("saveAcademicProfileBtn");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      saveAcademicProfile();
    });
  }
});