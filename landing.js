// ===============================
// Basic UI: burger + smooth scroll
// ===============================
const burger = document.getElementById("burger");
const navLinks = document.getElementById("navLinks");

burger?.addEventListener("click", () => {
  navLinks?.classList.toggle("open");
});

// close menu on click
navLinks?.addEventListener("click", (e) => {
  if (e.target?.tagName === "A") navLinks.classList.remove("open");
});

// smooth scroll
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href");
    if (!href || href === "#") return;
    const el = document.querySelector(href);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    navLinks?.classList.remove("open");
  });
});

// ===============================
// Coming Soon modal (ONLY for AI pricing buttons)
// ===============================
const comingSoonModal = document.getElementById("comingSoonModal");
const csCloseBtn = document.getElementById("csClose");
const csBackdrop = comingSoonModal?.querySelector(".cs-backdrop");

function openComingSoon() {
  if (!comingSoonModal) return;
  comingSoonModal.classList.add("show"); // use .show in css
}

function closeComingSoon() {
  if (!comingSoonModal) return;
  comingSoonModal.classList.remove("show");
}

// Only buttons/links having .js-coming-soon will open this
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".js-coming-soon");
  if (!btn) return;
  e.preventDefault();
  openComingSoon();
});

csCloseBtn?.addEventListener("click", closeComingSoon);
csBackdrop?.addEventListener("click", closeComingSoon);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeComingSoon();
});

// ===============================
// Support Modal: Contact + Report Bug (Backend Connected)
// ===============================
const API_BASE = "https://alephlearn-backend.onrender.com/api";
const token = () => localStorage.getItem("token") || localStorage.getItem("jwt") || "";

async function api(path, opts = {}) {
  const t = token();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? JSON.parse(text) : null;
}

const supportModal = document.getElementById("supportModal");
const supportTitle = document.getElementById("supportTitle");
const supportText = document.getElementById("supportText");
const supportClose = document.getElementById("supportClose");

const supportForm = document.getElementById("supportForm");
const supportMsg = document.getElementById("supportMsg");
const sfType = document.getElementById("sfType");

const supportBackdrop = supportModal?.querySelector(".cs-backdrop");

function openSupport(type) {
  if (!supportModal) return;

  supportMsg.textContent = "";
  supportForm?.reset();

  if (type === "BUG") {
    supportTitle.textContent = "Report a Bug";
    supportText.innerHTML = `Tell us what broke. This will create an admin report automatically.`;
    document.getElementById("sfSubject").value = "Bug report";
    sfType.value = "BUG";
  } else {
    supportTitle.textContent = "Contact Us";
    supportText.innerHTML = `Send us a message. We'll get back soon.`;
    sfType.value = "CONTACT";
  }

  supportModal.classList.add("open");
  supportModal.setAttribute("aria-hidden", "false");
}

function closeSupport() {
  if (!supportModal) return;
  supportModal.classList.remove("open");
  supportModal.setAttribute("aria-hidden", "true");
}

document.querySelectorAll(".js-contact").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openSupport("CONTACT");
  });
});

document.querySelectorAll(".js-report").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openSupport("BUG");
  });
});

supportClose?.addEventListener("click", closeSupport);
supportBackdrop?.addEventListener("click", closeSupport);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSupport();
});

supportForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supportMsg) return;

  supportMsg.textContent = "Sending…";

  const payload = {
    name: document.getElementById("sfName").value.trim(),
    email: document.getElementById("sfEmail").value.trim(),
    subject: document.getElementById("sfSubject").value.trim(),
    message: document.getElementById("sfMessage").value.trim(),
  };

  try {
    if ((sfType?.value || "CONTACT") === "BUG") {
      // ✅ Bug -> create report (public endpoint recommended)
      // If your backend endpoint is different, change it here.
      await api("/api/reports/bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: payload.email,
          title: payload.subject,
          page: "Landing Page",
          steps: payload.message,
          expected: "",
          actual: "",
          device: navigator.userAgent,
        }),
      });

      supportMsg.textContent = "Bug reported ✅ Admin will review it.";
    } else {
      // ✅ Contact -> public contact endpoint
      await api("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      supportMsg.textContent = "Message sent ✅ We’ll contact you soon.";
    }

    setTimeout(closeSupport, 900);
  } catch (err) {
    supportMsg.textContent = err?.message || "Failed. Try again.";
  }
});
