// protect.js
import { getToken, clearAuth, authFetch } from "./api.js";



function parseJwt(t){ try{ return JSON.parse(atob(t.split(".")[1]||"")); }catch{return null;} }
function isTokenValid(t){ const p=parseJwt(t); return t && (!p?.exp || Date.now()<p.exp*1000); }



async function verifyWithServer(token){
  try{
    const res = await fetch("https://alephlearn-backend.onrender.com/api/ping", {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.ok;
  }catch{ return false; }
}

(async () => {
  const token = getToken();
  if (!isTokenValid(token) || !(await verifyWithServer(token))){
    clearAuth();
    const next = encodeURIComponent(location.pathname+location.search+location.hash);
    location.replace(`Auth.html#login?next=${next}`);
    return;
  }
  // expose for pages
  window.authFetch = (url, opts={}) => authFetch(url, opts);

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    clearAuth(); location.replace("Auth.html#login");
  });
})();
function getRoleFromToken(token){
  const p = parseJwt(token) || {};
  const r =
    p.role ||
    (Array.isArray(p.roles) ? p.roles[0] : null) ||
    (Array.isArray(p.authorities) ? p.authorities[0] : null);
  return (r || "").toString().toUpperCase();
}
(function adminLinkToggle(){
  const token = getToken();
  const role = getRoleFromToken(token) || (localStorage.getItem("role")||"").toUpperCase();

  document.querySelectorAll(".js-admin-link").forEach(a => {
    a.style.display = (role === "ADMIN") ? "" : "none";
  });
})();
window.showBlockedModal = function(message){
  const modal = document.getElementById("blockedModal");
  const msg = document.getElementById("blockedMessage");
  if (!modal || !msg) return;

  msg.innerHTML = message;
  modal.classList.add("show");
};

window.closeBlockedModal = function(){
  document.getElementById("blockedModal")?.classList.remove("show");
};// ✅ Override all browser alerts -> show our custom modal instead
(() => {
  const nativeAlert = window.alert;

  window.alert = (message) => {
    const modal = document.getElementById("blockedModal");
    const msgEl = document.getElementById("blockedMessage");

    if (modal && msgEl) {
      msgEl.innerHTML = String(message || "");
      modal.classList.add("show");
      return;
    }

    nativeAlert(message);
  };
})();