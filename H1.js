// Hamberger.js  (load as normal <script type="module" src="Hamberger.js"></script>)

document.addEventListener("DOMContentLoaded", () => {
  const burger   = document.getElementById("al-burger");
  const drawer   = document.getElementById("al-drawer");
  const backdrop = document.getElementById("al-drawer-backdrop");
  const closeBtn = drawer ? drawer.querySelector(".al-drawer-close") : null;

  if (!burger || !drawer || !backdrop) {
    console.warn("[al-burger] elements not found");
    return;
  }

  function openDrawer() {
    drawer.classList.add("open");
    backdrop.classList.add("show");
    burger.classList.add("active");
    document.body.style.overflow = "hidden";
    burger.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
    burger.classList.remove("active");
    document.body.style.overflow = "";
    burger.setAttribute("aria-expanded", "false");
  }

  burger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (drawer.classList.contains("open")) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeDrawer);
  }

  backdrop.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) {
      closeDrawer();
    }
  });

  // Drawer ke andar koi link pe click → close & navigate
  drawer.querySelectorAll("a[href]").forEach((a) => {
    a.addEventListener("click", () => {
      closeDrawer();
      // normal link navigation browser handle karega
    });
  });
});




// ========== Mini Profile + Report (AlephLearn chat.html) ==========

// Global helper: safely get text before '@'
function alGetNameFromEmail(email) {
  if (!email) return 'User';
  return (email.split('@')[0] || 'User');
}
// ========== REPORT MODAL (global) ==========
window.openReportModal = function (userIdOrEmail, displayName) {
  const modal    = document.getElementById('reportModal');
  if (!modal) {
    console.warn('[reportModal] #reportModal not found');
    return;
  }

  const nameEl   = document.getElementById('reportUserName');
  const textEl   = document.getElementById('reportText');
  const fileEl   = document.getElementById('reportFile');
  const btnClose = document.getElementById('reportClose');
  const btnCancel= document.getElementById('reportCancel');
  const btnSend  = document.getElementById('reportSend');

  const niceName =
    displayName ||
    (userIdOrEmail && String(userIdOrEmail).includes('@')
      ? String(userIdOrEmail).split('@')[0]
      : 'User');

  if (nameEl) {
    nameEl.textContent = `Reporting: ${niceName}`;
  }
  if (textEl) textEl.value = '';
  if (fileEl) fileEl.value = '';

  const close = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };

  // backdrop close
  const backdrop = modal.querySelector('.al-modal__backdrop');
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', close);
  }

  // X button
  if (btnClose && !btnClose.dataset.bound) {
    btnClose.dataset.bound = '1';
    btnClose.addEventListener('click', close);
  }

  // Cancel button
  if (btnCancel && !btnCancel.dataset.bound) {
    btnCancel.dataset.bound = '1';
    btnCancel.addEventListener('click', close);
  }

  // Send button (abhi demo – sirf console + alert)
  if (btnSend && !btnSend.dataset.bound) {
    btnSend.dataset.bound = '1';
    btnSend.addEventListener('click', () => {
      const reason = (textEl && textEl.value.trim()) || '';
      const file   = fileEl && fileEl.files && fileEl.files[0];

      if (!reason) {
        alert('Please describe the issue before submitting.');
        return;
      }

      console.log('[reportModal] submit (demo):', {
        user: userIdOrEmail,
        displayName,
        reason,
        file
      });

      alert('Report submitted (demo). Backend wiring baad me karenge.');
      close();
    });
  }

  // show modal in center with blur
  modal.style.display = 'flex';
  modal.classList.add('show');
};




