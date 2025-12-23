(function applyRoleUi() {
    const role = (localStorage.getItem("role") || "").toUpperCase();
    const adminTab = document.getElementById("adminTab");
  
    if (adminTab) {
      adminTab.style.display = (role === "ADMIN") ? "inline-flex" : "none";
    }
  })();