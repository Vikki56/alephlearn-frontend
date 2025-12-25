// Fronted/js/profile-academic.js
import { authFetch, showToast } from "./api.js";

let levelsBox, streamsBox, specBox;
let OPTIONS = null;
let PROFILE_LOCKED = false;

document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  if (!body || body.getAttribute("data-page") !== "profile") return;

  levelsBox = document.getElementById("educationLevel");
  streamsBox = document.getElementById("mainStream");
  specBox = document.getElementById("specialization");

  if (!levelsBox || !streamsBox || !specBox) return;

  initAcademicProfile();
});

/* -----------------------------------
 *  INIT
 * ----------------------------------- */

async function initAcademicProfile() {
  try {
    await loadOptions();

    await loadExistingProfile();

    setupListeners();

    const btn = document.getElementById("saveAcademicProfileBtn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        saveAcademicProfile();
      });
    }
  } catch (err) {
    console.error(err);
  }
}

/* -----------------------------------
 *  OPTIONS LOAD
 * ----------------------------------- */

async function loadOptions() {
  try {
    OPTIONS = await authFetch("/api/profile/academic/options", {
      method: "GET"
    });

    if (!OPTIONS || !Array.isArray(OPTIONS.educationLevels)) {
      throw new Error("Invalid options payload");
    }

    populate(levelsBox, OPTIONS.educationLevels, "Select level");
  } catch (err) {
    console.error("Error loading academic options:", err);
    showStatus(
      "Failed to load academic options. You can still try selecting & saving.",
      "#FEB2B2"
    );
    showToast("Failed to load academic options", "error");
  }
  console.log("OPTIONS LOADED →", OPTIONS);
}

/* -----------------------------------
 *  EXISTING PROFILE
 * ----------------------------------- */

async function loadExistingProfile() {
  const statusEl = document.getElementById("academicProfileStatus");

  try {
    const hasProfile = await authFetch("/api/profile/academic/has", {
      method: "GET"
    });

    if (!hasProfile) {
      if (statusEl) {
        statusEl.textContent =
          "No academic profile yet. Please fill your details and save.";
        statusEl.style.color = "#A0AEC0";
      }
      return;
    }
    PROFILE_LOCKED = true;

    const data = await authFetch("/api/profile/academic/me", {
      method: "GET"
    });

    prefillDropdowns(data);
    lockProfileUI();

    if (statusEl) {
      statusEl.textContent =
        "Academic profile is locked 🔒. You cannot change it.";
      statusEl.style.color = "#9AE6B4";
    }
  } catch (err) {
    console.error("Failed to load academic profile:", err);
    if (statusEl) {
      statusEl.textContent =
        "Could not load academic profile. You can still fill and try saving.";
      statusEl.style.color = "#F6E05E";
    }
  }
}

function prefillDropdowns(existing) {
  if (!existing || !OPTIONS) return;

  const { educationLevel, mainStream, specialization } = existing;

  if (educationLevel) {
    levelsBox.value = educationLevel;
  }

  const streams = educationLevel ? getStreamsByLevel(educationLevel) : [];
  populate(streamsBox, streams, "Select stream");
  if (mainStream) {
    streamsBox.value = mainStream;
  }

  const specs =
    educationLevel && mainStream
      ? getSpecsByCombo(educationLevel, mainStream)
      : [];
  populate(specBox, specs, "Select specialization");
  if (specialization) {
    specBox.value = specialization;
  }
}

/* -----------------------------------
 *  DROPDOWN INTERACTIONS
 * ----------------------------------- */

function setupListeners() {
  levelsBox.addEventListener("change", () => {
    const lvl = levelsBox.value;

    streamsBox.innerHTML = "";
    specBox.innerHTML = "";

    if (!lvl) {
      populate(streamsBox, [], "Select stream");
      populate(specBox, [], "Select specialization");
      return;
    }

    const streams = getStreamsByLevel(lvl);
    populate(streamsBox, streams, "Select stream");
  });

  streamsBox.addEventListener("change", () => {
    const lvl = levelsBox.value;
    const stream = streamsBox.value;

    specBox.innerHTML = "";

    if (!lvl || !stream) {
      populate(specBox, [], "Select specialization");
      return;
    }

    const specs = getSpecsByCombo(lvl, stream);
    populate(specBox, specs, "Select specialization");
  });
}

/* -----------------------------------
 *  CUSTOM CONFIRM MODAL
 * ----------------------------------- */
function confirmAcademicLock() {
  return new Promise((resolve) => {
    if (document.getElementById("ap-confirm-modal")) return resolve(false);

    const backdrop = document.createElement("div");
    backdrop.id = "ap-confirm-modal";
    backdrop.className = "ap-backdrop";

    backdrop.innerHTML = `
      <div class="ap-modal" role="dialog" aria-modal="true" style="max-width: 420px;">
        <div class="ap-pill">
          <span>FINAL STEP</span>
        </div>

        <div class="ap-icon-circle">
          <span>🔒</span>
        </div>

        <h2 class="ap-modal-title">Lock Academic Profile?</h2>

        <p class="ap-modal-sub">
          Once saved, your academic profile will be <strong>permanently locked</strong>.
          You cannot change your level, stream, or specialization later.
        </p>

        <p class="ap-modal-highlight">
          Are you absolutely sure you want to continue?
        </p>

        <div class="ap-modal-actions">
          <button type="button" class="ap-btn-ghost" id="ap-confirm-cancel">
            Cancel
          </button>
          <button type="button" class="ap-btn-primary" id="ap-confirm-ok">
            Yes, lock it 🔒
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    document.getElementById("ap-confirm-cancel").onclick = () => {
      backdrop.remove();
      resolve(false);
    };

    document.getElementById("ap-confirm-ok").onclick = () => {
      backdrop.remove();
      resolve(true);
    };

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.remove();
        resolve(false);
      }
    });
  });
}

/* -----------------------------------
 *  SAVE PROFILE
 * ----------------------------------- */

async function saveAcademicProfile() {
  const statusEl = document.getElementById("academicProfileStatus");
  const btn = document.getElementById("saveAcademicProfileBtn");

  if (PROFILE_LOCKED) {
    showStatus(
      "Academic profile is locked 🔒. You cannot change it.",
      "#A0AEC0"
    );
    showToast("Profile is locked and cannot be changed", "info");
    return;
  }

  const edu = levelsBox?.value || "";
  const stream = streamsBox?.value || "";
  const spec = specBox?.value || "";

  if (!edu || !stream || !spec) {
    showStatus(
      "Please select all three: level, stream and specialization.",
      "#FEB2B2"
    );
    return;
  }

  const sure = await confirmAcademicLock();
  if (!sure) {
    showStatus(
      "Profile not saved. You can still change your level, stream & specialization.",
      "#A0AEC0"
    );
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

    const data = await authFetch("/api/profile/academic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    showStatus(
      "Academic profile saved ✅. Now we will show you content for " +
        data.specialization +
        ".",
      "#9AE6B4"
    );
    showToast("Academic profile saved", "success");

    PROFILE_LOCKED = true;
    lockProfileUI();
  } catch (err) {
    console.error("Error saving academic profile:", err);
    showStatus(
      "Error saving profile. Please check your login and try again.",
      "#FEB2B2"
    );
    showToast("Error saving academic profile", "error");
  } finally {
    if (btn) {
      if (PROFILE_LOCKED) {
        btn.disabled = true;
        btn.textContent = "Academic Profile Locked";
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
      } else {
        btn.disabled = false;
        btn.textContent = "Save Academic Profile";
      }
    }
  }
}

/* -----------------------------------
 *  UI LOCK HELPER
 * ----------------------------------- */

function lockProfileUI() {
  [levelsBox, streamsBox, specBox].forEach((el) => {
    if (!el) return;
    el.disabled = true;
    el.classList.add("ap-locked-field");
  });

  const btn = document.getElementById("saveAcademicProfileBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Academic Profile Locked";
    btn.style.opacity = "0.6";
    btn.style.cursor = "not-allowed";
  }
}

/* -----------------------------------
 *  HELPERS
 * ----------------------------------- */

function populate(select, list, placeholder = "Select") {
  if (!select) return;

  select.innerHTML = "";

  const def = document.createElement("option");
  def.value = "";
  def.textContent = placeholder;
  select.appendChild(def);

  (list || []).forEach((v) => {
    const op = document.createElement("option");
    op.value = v;
    op.textContent = v;
    select.appendChild(op);
  });
}

function getStreamsByLevel(level) {
  if (!OPTIONS) return [];

  const allStreams = OPTIONS.mainStreams || [];

  if (!Array.isArray(OPTIONS.validCombos) || OPTIONS.validCombos.length === 0) {
    return [...allStreams];
  }

  const s = new Set();

  allStreams.forEach((stream) => {
    const hasAnySpec = (OPTIONS.specializations || []).some((spec) =>
      (OPTIONS.validCombos || []).includes(comboKey(level, stream, spec))
    );

    if (hasAnySpec) {
      s.add(stream);
    }
  });

  return [...s];
}

function getSpecsByCombo(level, stream) {
  if (!OPTIONS) return [];

  const allSpecs = OPTIONS.specializations || [];

  if (!Array.isArray(OPTIONS.validCombos) || OPTIONS.validCombos.length === 0) {
    return [...allSpecs];
  }

  const s = new Set();

  allSpecs.forEach((spec) => {
    if ((OPTIONS.validCombos || []).includes(comboKey(level, stream, spec))) {
      s.add(spec);
    }
  });

  return [...s];
}

function comboKey(l, s, sp) {
  const norm = (x) => (x || "").trim().toUpperCase();
  return `${norm(l)}|${norm(s)}|${norm(sp)}`;
}

function showStatus(msg, color) {
  const statusEl = document.getElementById("academicProfileStatus");
  if (!statusEl) return;
  statusEl.textContent = msg;
  if (color) statusEl.style.color = color;
}