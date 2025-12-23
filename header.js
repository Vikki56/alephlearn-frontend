document.addEventListener("DOMContentLoaded", () => {
    const burger = document.getElementById("al-burger");
    const drawer = document.getElementById("alDrawer");
    const closeBtn = document.getElementById("alDrawerClose");
    const backdrop = document.getElementById("alDrawerBackdrop");
  
    function openDrawer() {
      drawer.classList.add("show");
      document.body.style.overflow = "hidden";
    }
  
    function closeDrawer() {
      drawer.classList.remove("show");
      document.body.style.overflow = "";
    }
  
    burger?.addEventListener("click", openDrawer);
    closeBtn?.addEventListener("click", closeDrawer);
    backdrop?.addEventListener("click", closeDrawer);
  });