
// --- API BASE (dev vs prod) ---
// ✅ Dev: http://localhost:8080
// ✅ Prod: Render backend (or later api.alephlearn.com)
window.API_BASE = window.API_BASE || 'http://localhost:8080';
const ORIGIN_OVERRIDE = (localStorage.getItem('backendOrigin') || '').trim();
const isFile = location.origin === 'null' || location.protocol === 'file:';
const looksLikeDev = /:\d+$/.test(location.origin) && !location.origin.endsWith(':8080');
const looksLikeProd = /(^|\.)alephlearn\.com$/.test(location.hostname) || location.hostname.endsWith('.pages.dev');
const PROD_BACKEND = 'https://alephlearn-backend.onrender.com';

const API_BASE = ORIGIN_OVERRIDE
  || (isFile || looksLikeDev ? 'http://localhost:8080' : (looksLikeProd ? PROD_BACKEND : location.origin));
window.API_BASE = API_BASE;
let currentProfileUserId = null;
const reportModal = document.getElementById('reportModal');

// ---- Render cold-start mitigation ----
// Render free services often "sleep"; first request can take a few seconds.
// We ping /api/ping ASAP (no auth) so that heavy calls (rooms/messages/profile) feel faster.
function warmBackend() {
  try {
    fetch(`${API_BASE}/api/ping`, { cache: 'no-store' }).catch(()=>{});
  } catch (_) {}
}

// fire-and-forget warmup
warmBackend();

// frontend/js/chat.js
// IMPORTANT: Do NOT import authFetch from api.js here.
// This file already defines its own authFetch() wrapper later (returns a fetch Response
// and handles 401/403 + blocked modal). Importing would cause a duplicate identifier error.

// ---- room state (single source of truth) ----
let currentRoom = 'default';
let roomId = currentRoom; // legacy alias used across file

// ====== KICK / MODERATION (client-side helpers) ======
const KICKED_ROOMS_KEY = 'alephlearn.kickedRooms'; // roomId -> true

function getKickedRooms(){
  try { return JSON.parse(localStorage.getItem(KICKED_ROOMS_KEY) || '{}') || {}; }
  catch { return {}; }
}
function setRoomKicked(room){
  if(!room) return;
  const m = getKickedRooms();
  m[room] = true;
  localStorage.setItem(KICKED_ROOMS_KEY, JSON.stringify(m));
}
function isRoomKicked(room){
  if(!room) return false;
  const m = getKickedRooms();
  return !!m[room];
}

function parseDoubtQuestionId(room){
  if(!room) return null;
  const m = String(room).match(/\/doubt-q-(\d+)$/);
  if(!m) return null;
  const qid = Number(m[1]);
  return Number.isFinite(qid) ? qid : null;
}
function parseSubject(room){
  if(!room) return '';
  const i = String(room).indexOf('/');
  return i >= 0 ? String(room).slice(0,i) : String(room);
}


/**
 * Call when claimer actually joins the private doubt room
 * This locks the claim (expiresAt = null)
 */
export async function notifyJoined(questionId) {
  try {
    await authFetch(`/api/rooms/claim/${questionId}/joined`, {
      method: "POST"
    });
    console.log("Claim locked for question:", questionId);
  } catch (e) {
    console.error("Failed to notify joined:", e);
  }
}


// ====== REALTIME NOTIFICATIONS (claim/answer/etc.) ======
let stompClient = null;

/**
 * Needs these script tags in chat.html (before this module loads):
 *  <script src="https://cdn.jsdelivr.net/npm/sockjs-client@1/dist/sockjs.min.js"></script>
 *  <script src="https://cdn.jsdelivr.net/npm/stompjs@2.3.3/lib/stomp.min.js"></script>
 */
async function initNotifications() {
  try {
    const SockJS = window.SockJS;
    const Stomp = window.Stomp;
    if (!SockJS || !Stomp) {
      console.warn("SockJS/Stomp not loaded -> notifications disabled");
      return;
    }

    // get my userId from backend
    const meRes = await authFetch(`${API_BASE}/api/profile/me`);
    if (!meRes || !meRes.ok) {
      console.warn("Can't start notifications: /api/profile/me failed", meRes?.status, meRes?.statusText);
      return;
    }
    const me = await meRes.json();

    // backend payload can vary: try common shapes
    const myId = me?.id ?? me?.userId ?? me?.user?.id ?? me?.data?.id ?? null;
    if (!myId) {
      console.warn("Can't start notifications: /api/profile/me didn't return a usable id", me);
      return;
    }

    const socket = new SockJS(`${API_BASE}/ws/notify`);
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.connect({}, () => {
      const dest = `/topic/notifications.user-${myId}`;
      stompClient.subscribe(dest, (msg) => {
        try {
          const n = JSON.parse(msg.body);
          // TODO: replace alert with your custom toast UI
          alert(n.message || "New notification");
        } catch (e) {
          console.warn("Bad notification payload", e);
        }
      });
      console.log("Notifications subscribed:", dest);
    });

  } catch (e) {
    console.error("initNotifications failed:", e);
  }
}

// ====== ROLE HELPERS (author/admin ko detect karne ke liye) ======
function getJwtPayload() {
  const token = localStorage.getItem("token");
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = atob(base64);
    return JSON.parse(payloadJson);
  } catch (e) {
    console.error("Failed to parse JWT payload", e);
    return null;
  }
}

function isAuthorUser() {
  const payload = getJwtPayload();
  if (!payload) return false;

  // 1) direct role field
  if (payload.role === "ADMIN" || payload.role === "AUTHOR") {
    return true;
  }

  // 2) authorities array
  if (Array.isArray(payload.authorities)) {
    return (
      payload.authorities.includes("ROLE_ADMIN") ||
      payload.authorities.includes("ROLE_AUTHOR")
    );
  }

  return false;
}

function resolveStreamKey(profile) {
  if (!profile) return 'btech_cse';

  // backend se jo bhi aa raha ho, usme se meaningful fields pick karo
  const {
    educationLevel,
    mainStream,
    branch,
    streamKey
  } = profile;

  // agar backend already streamKey bhej raha ho to wahi use kar le
  if (streamKey && typeof streamKey === 'string' && streamKey.trim()) {
    return streamKey.trim();
  }

  const parts = [];
  if (educationLevel) parts.push(String(educationLevel));
  if (mainStream)     parts.push(String(mainStream));
  if (branch)         parts.push(String(branch));

  if (!parts.length) return 'btech_cse';

  // "B.Tech", "CSE" → "btech_cse"
  return parts
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'btech_cse';
}

// !???changesshfjkjjhfgjhdfghjfdgfjhdshfjggfvjhbvhjbhvghjfgvhjdf
// jfdhgjfksghjfkdhjfghkjfgbjgbjfdbjhdfsbghfdjbhjfdbghjfdbhfdjbhdfj,ghgfjdjhsf,bjdfh,
// 362837528356823562938563986329382389239823528396ydgsjhdjgsd?
// fgjshdfgjvb632589753296235087605207230575987520-473089729687

// changesss kr rha hujfjsdhgbhjdbhd
// hdjggjhdvbsdhjsjhdeuyfg ewuyeyu3758415384719619428612984241896619248218944219842196241921y48218







  // modal prompt
  function showPromptModal({title="Create Study Group", label="New study group title", placeholder="", okText="OK", cancelText="Cancel", value=""}={}){
    return new Promise(resolve=>{
      const modal=document.getElementById('promptModal');
      const input=document.getElementById('promptInput');
      const titleEl=document.getElementById('promptTitle');
      const labelEl=document.getElementById('promptLabel');
      const okBtn=modal.querySelector('[data-ok]');
      const cancelBtn=modal.querySelector('[data-cancel]');
      const closeBtn=modal.querySelector('[data-close]');

      titleEl.textContent=title; labelEl.textContent=label;
      input.placeholder=placeholder||input.placeholder; input.value=value||"";
      okBtn.textContent=okText; cancelBtn.textContent=cancelText;


      // --- Voice recorder state (global) ---


      function close(val){
        modal.classList.remove('show'); setTimeout(()=>{modal.style.display='none'},50);
        okBtn.removeEventListener('click',onOk); cancelBtn.removeEventListener('click',onCancel);
        closeBtn.removeEventListener('click',onCancel); document.removeEventListener('keydown',onKey);
        resolve(val);
      }
      function onOk(){ close(input.value.trim()||null); }
      function onCancel(){ close(null); }
      function onKey(e){ if(e.key==='Escape')onCancel(); if(e.key==='Enter'&&!e.shiftKey)onOk(); }

      modal.style.display='block'; requestAnimationFrame(()=>modal.classList.add('show'));
      setTimeout(()=>input.focus(),50);
      okBtn.addEventListener('click',onOk); cancelBtn.addEventListener('click',onCancel);
      closeBtn.addEventListener('click',onCancel); document.addEventListener('keydown',onKey);
    });
  }

// 🔧 Improved Confirm Modal with "danger" variant
// ---- Confirm Modal (self-installing) ----
// ------- Confirm Modal (robust) -------

// ------- /Confirm Modal -------

  function showEditModal({title="Edit message", label="Update your message", value="", okText="Save", cancelText="Cancel"}={}) {
    return new Promise(resolve => {
      const modal  = document.getElementById('editModal');
      const titleE = document.getElementById('editTitle');
      const labelE = document.getElementById('editLabel');
      const input  = document.getElementById('editInput');
      const okBtn  = modal.querySelector('[data-ok]');
      const cancel = modal.querySelector('[data-cancel]');
      const closeX = modal.querySelector('[data-close]');

      titleE.textContent = title;
      labelE.textContent = label;
      input.value        = value;
      okBtn.textContent  = okText;
      cancel.textContent = cancelText;

      function close(val){
        modal.classList.remove('show');
        setTimeout(()=>{ modal.style.display='none'; }, 180);
        okBtn.removeEventListener('click',onOk);
        cancel.removeEventListener('click',onCancel);
        closeX.removeEventListener('click',onCancel);
        document.removeEventListener('keydown',onKey);
        resolve(val);
      }
      function onOk(){ close(input.value.trim()); }
      function onCancel(){ close(null); }
      function onKey(e){
        if(e.key==='Escape') onCancel();
        if(e.key==='Enter' && (e.metaKey || e.ctrlKey)) onOk(); // Cmd/Ctrl+Enter to save
      }

      modal.style.display='block';
      requestAnimationFrame(()=> modal.classList.add('show'));
      setTimeout(()=> input.focus(), 60);

      okBtn.addEventListener('click',onOk);
      cancel.addEventListener('click',onCancel);
      closeX.addEventListener('click',onCancel);
      document.addEventListener('keydown',onKey);
    });
  }



function showChoices({title="Choose", message="", choices=[]}){
  return new Promise(resolve=>{
    const wrap = document.createElement('div');
    wrap.className = 'al-modal'; wrap.style.display='block';
    wrap.innerHTML = `
      <div class="al-modal__backdrop"></div>
      <div class="al-modal__card" role="dialog" aria-modal="true">
        <div class="al-modal__header">
          <h3>${title}</h3>
          <button class="al-x" data-x>✖</button>
        </div>
        <div class="al-modal__body">
          <div style="color:#9ca3af;margin-bottom:8px">${message}</div>
          <div class="al-choices">
            ${choices.map(c=>`<button class="al-chip" data-choice="${c}">${c}</button>`).join('')}
          </div>
        </div>
        <div class="al-modal__footer" style="justify-content:flex-end">
          <button class="al-btn al-btn--ghost" data-cancel>Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (val)=>{ wrap.classList.remove('show'); setTimeout(()=>wrap.remove(),120); resolve(val); };
    wrap.querySelector('[data-x]').onclick = ()=>done(null);
    wrap.querySelector('[data-cancel]').onclick = ()=>done(null);
    wrap.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-choice]');
      if (b) done(b.getAttribute('data-choice'));
    });
    requestAnimationFrame(()=>wrap.classList.add('show'));
  });
}

(() => {
  'use strict';

  (function(){
    const nav   = document.querySelector('.nav');
    const btn   = document.querySelector('.nav-toggle');
    const links = document.querySelector('.links');
    // ...
  })();
   

  function showSolverJoinModal() {
    return new Promise((resolve) => {
      const backdrop = document.getElementById("solverJoinModal");
      if (!backdrop) return resolve(false);
  
      const btnJoin = backdrop.querySelector("[data-solver-modal-join]");
      const btnLater = backdrop.querySelector("[data-solver-modal-later]");
      const btnClose = backdrop.querySelector("[data-solver-modal-close]");
  
      const cleanup = (value) => {
        backdrop.classList.add("hidden");
        btnJoin?.removeEventListener("click", onJoin);
        btnLater?.removeEventListener("click", onLater);
        btnClose?.removeEventListener("click", onClose);
        resolve(value);
      };
  
      const onJoin = () => cleanup(true);
      const onLater = () => cleanup(false);
      const onClose = () => cleanup(false);
  
      btnJoin?.addEventListener("click", onJoin);
      btnLater?.addEventListener("click", onLater);
      btnClose?.addEventListener("click", onClose);
  
      backdrop.classList.remove("hidden");
    });
  }


  function getJwtPayload() {
    const token = localStorage.getItem("token");
    if (!token) return null;
  
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
  
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payloadJson = atob(base64);
      return JSON.parse(payloadJson);
    } catch (e) {
      console.error("Failed to parse JWT payload", e);
      return null;
    }
  }
  
  function isAuthorUser() {
    const payload = getJwtPayload();
    if (!payload) return false;
  
    // 🔥 yahan tumhare JWT ke hisaab se checks:
    if (payload.role === "ADMIN" || payload.role === "AUTHOR") {
      return true;
    }
  
    if (Array.isArray(payload.authorities)) {
      return (
        payload.authorities.includes("ROLE_ADMIN") ||
        payload.authorities.includes("ROLE_AUTHOR")
      );
    }
  
    return false;
  }

  const seenMessages = new Set();
let ws = null;

function QE(sel, root=document){ return root.querySelector(sel); }
function QEA(sel, root=document){ return [...root.querySelectorAll(sel)]; }
function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function normalize(s=''){ return s.trim().toLowerCase(); }

// --- identity helpers (used by moderation UI) ---
// NOTE: optional-chaining on an *undefined identifier* still throws ReferenceError.
function getUserEmail(){
  const em = (window.USER_EMAIL || window.userEmail || localStorage.getItem('userEmail') || '');
  return normalize(String(em || ''));
}
// function setComposerVisible(v){ const c = QE('#qaComposer'); if (c) c.hidden = !v; }
function identityParam(){
  const who = (window.USER_EMAIL || window.DISPLAY_NAME || '').trim();
  return encodeURIComponent(who);
}
let mediaRecorder = null;
let micStream = null;
let recChunks = [];
let recordedBlob = null;
let isRecording = false;

let currentAcademicProfile = null;
function getChatSubjectKey(p) {
  if (!p) return "btech_cse";

  const key = `${p.educationLevel}_${p.mainStream}_${p.specialization}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");

  return key || "btech_cse";
}

function setActionsSpace() {
  const actions = document.getElementById('input-actions');
  const wrap = document.querySelector('.chat-input-wrapper');
  if (!actions || !wrap) return;
  // +6px safety so the bar doesn't kiss the buttons
  wrap.style.setProperty('--actions-width', (actions.offsetWidth + 6) + 'px');
}
setActionsSpace();
window.addEventListener('resize', setActionsSpace);

function bindOnce(el, type, handler) {
  if (!el) return;
  const key = `bound_${type}`;
  if (el.dataset[key] === '1') return;
  el.addEventListener(type, handler);
  el.dataset[key] = '1';
}
async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(micStream);
    // after: mediaRecorder = new MediaRecorder(stream, { mimeType: ... });
    recChunks = [];
    mediaRecorder.ondataavailable = e => e.data && recChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      window.__voiceOnStop(blob); // show review bar
    };
    mediaRecorder.start();
  } catch (err) {
    alert('Mic permission denied or unavailable.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    // after: mediaRecorder.stop();
setTimeout(() => {
  if (window.recordedBlob && document.getElementById('voice-review')) {
    // in case onstop didn’t fire due to a browser quirk or earlier code
    const url = URL.createObjectURL(window.recordedBlob);
    const a = document.getElementById('voice-audio');
    a.src = url;
    document.getElementById('voice-review').classList.add('show');
    document.getElementById('message-input').classList.add('has-clip');
  }
}, 0);
    micStream?.getTracks()?.forEach(t => t.stop());
  }
}

// ===== Inline voice note (WhatsApp-style) =====
// elements you already query
document.addEventListener('DOMContentLoaded', () => {
  // Ensure chat message list is scrollable (some CSS updates can break it)
  try {
    const list = document.querySelector('#chat-messages');
    if (list) {
      list.style.overflowY = 'auto';
      list.style.overscrollBehavior = 'contain';
      list.style.webkitOverflowScrolling = 'touch';
    }
  } catch {}

const inputEl     = document.getElementById('message-input');
const reviewDiv   = document.getElementById('voice-review');
const reviewAudio = document.getElementById('voice-audio');
// --- custom playbar sync ---
const vpCur   = document.querySelector('.vp-cur');
const vpDur   = document.querySelector('.vp-dur');
const vpBar   = document.getElementById('vp-bar');
const vpInner = document.getElementById('vp-inner');
  const vpKnob      = document.getElementById('vp-knob');
  const playBtn = document.getElementById('voice-play');
const audioEl = document.getElementById('voice-audio');
const delBtn      = document.getElementById('voice-delete');
const micBtn      = document.getElementById('mic-btn');
const sendBtn     = document.getElementById('send-btn');




// const vpInner = document.getElementById('vpInner');
const timeStart = document.getElementById('vpTimeStart');
const timeEnd = document.getElementById('vpTimeEnd');
// ⛔ If any required node is missing, skip wiring to avoid null.addEventListener crash
  if (!inputEl || !reviewDiv || !reviewAudio || !playBtn || !delBtn || !micBtn || !sendBtn || !vpBar || !vpKnob) {
    console.warn('[voice] UI not present on this page – skipping init');
    return;
  }

reviewAudio.addEventListener('loadedmetadata', () => {
  if (reviewAudio.duration && !isNaN(reviewAudio.duration)) {
    timeEnd.textContent = formatTime(reviewAudio.duration);
  }
});

reviewAudio.addEventListener('timeupdate', () => {
  if (!reviewAudio.duration || isNaN(reviewAudio.duration)) return;
  const pct = (reviewAudio.currentTime / reviewAudio.duration) * 100;
  vpInner.style.width = `${Math.min(100, pct)}%`;
  timeStart.textContent = formatTime(reviewAudio.currentTime);
});

// helper to format seconds -> M:SS
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function mmss(t){
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t/60);
  const s = Math.floor(t%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

if (playBtn && audioEl) {
  playBtn.addEventListener('click', () => {
    if (!audioEl.src) return; // nothing to play yet
    if (audioEl.paused) {
      audioEl.play();
      playBtn.textContent = '⏸';   // pause icon
    } else {
      audioEl.pause();
      playBtn.textContent = '▶';   // play icon
    }
  });

  // auto reset button when audio ends
  audioEl.addEventListener('ended', () => {
    playBtn.textContent = '▶';
  });
}

function syncProgress(){
  if(!reviewAudio || !vpCur || !vpDur || !vpInner) return;
  const dur = reviewAudio.duration || 0;
  const cur = reviewAudio.currentTime || 0;
  vpCur.textContent = mmss(cur);
  vpDur.textContent = mmss(dur);
  const p = dur ? (cur/dur)*100 : 0;
  vpInner.style.width = `${p}%`;
}

reviewAudio.addEventListener('loadedmetadata', syncProgress);
reviewAudio.addEventListener('timeupdate', syncProgress);

vpBar.addEventListener('click', (e)=>{
  const r = vpBar.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  if (isFinite(reviewAudio.duration) && reviewAudio.duration > 0) {
    reviewAudio.currentTime = frac * reviewAudio.duration;
  }
});



function showClip(blobUrl){
  reviewAudio.src = blobUrl;
  reviewDiv.classList.add('show');
  inputEl.classList.add('has-clip');   // gives vertical room inside the field
}

function resetClip(){
  reviewAudio.src = '';
  reviewDiv.classList.remove('show');
  inputEl.classList.remove('has-clip');
  window.recordedBlob = null;
}
// make them safe buttons
micBtn?.setAttribute('type','button');
sendBtn?.setAttribute('type','button');
delBtn?.setAttribute('type','button');

// kill any old inline handlers if they exist
if (sendBtn) sendBtn.onclick = null;
if (delBtn)  delBtn.onclick  = null;
if (micBtn)  micBtn.onclick  = null;

// helper: bind only once
function bindOnce(el, evt, fn) {
  if (!el) return;
  const key = `__once_${evt}`;
  if (el[key]) return;
  el.addEventListener(evt, fn);
  el[key] = true;
}

// show/hide bar and padding on the input
// function showClip(blobUrl) {
//   reviewAudio.src = blobUrl;
//   reviewDiv.style.display = 'flex';
//   inputEl.classList.add('has-clip');
// }

// function resetClip() {
//   reviewAudio.src = '';
//   reviewDiv.style.display = 'none';
//   inputEl.classList.remove('has-clip');
//   window.recordedBlob = null;
//   micBtn?.setAttribute('aria-pressed','false');
// }

// hook delete
bindOnce(delBtn, 'click', (e) => { e.preventDefault(); resetClip(); });

// mic toggle (uses your existing start/stop functions)
bindOnce(micBtn, 'click', () => {
  const pressed = micBtn.getAttribute('aria-pressed') === 'true';
  if (pressed) {
    stopRecording?.();               
    micBtn.setAttribute('aria-pressed','false');
  } else {
    startRecording?.();               
    micBtn.setAttribute('aria-pressed','true');
  }
});

window.__voiceOnStop = function (blob) {
  window.recordedBlob = blob;
  const url = URL.createObjectURL(blob);
  showClip(url);
};

bindOnce(sendBtn, 'click', async () => {
  if (window.recordedBlob) {
    try {
      const base = (window.API_BASE || window.API_BASE_QA || location.origin);
      const fd = new FormData();
      fd.append('audio', window.recordedBlob, 'voice.webm');

      const up = await authFetch(`${base}/api/messages/upload-audio`, { method:'POST', body: fd });
      if (!up.ok) { alert('Audio upload failed.'); return; }

      const { url } = await up.json();
      const payload = `AUDIO|${url}`;

      if (typeof window.sendMessage === 'function') {
        await window.sendMessage(payload);
      } else {
        const inp = document.getElementById('message-input');
        if (inp) {
          inp.value = payload;
          inp.dispatchEvent(new Event('input', { bubbles:true }));
          document.getElementById('send-btn')?.click();
        }
      }
      resetClip();
    } catch (e) {
      console.error(e);
      alert('Upload error — check network or backend.');
    }
  } else {

  }
});
});


(function initEmojiDrawer(){
  const btn   = document.getElementById('emoji-btn');
  const panel = document.getElementById('emoji-panel');
  const input = document.getElementById('message-input');
  if (!btn || !panel || !input) return; 

  const EMOJIS = ("😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😇 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 🙄 😏 😴 🤤 😪 😮 😲 😳 🥺 😭 😤 😠 😡 🤬 🤯 😱 😨 😰 😥 😓 🤗 🤝 👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 👊 ✊ 👏 🙌 🫶 👐 🤲 🙏 💪 💖 💗 💓 💕 💞 💘 💝 💟 ❣️ 💔 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🔥 💯 ✨ ⭐ 🌟 💫 🎉 🎊 🥳 🍕 🍔 🍟 🌮 🍜 🍩 🍪 🍫 🍰 🍦 ☕ 🍵 🧋 🥤 🍺 🍻 🎵 🎶 🎧 🎮 🕹️ 📷 📸 🎬 🏆 🥇 🥈 🥉 🏅 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🌞 🌙 ⭐ ☔ 🌈 🌧️ ⛄ 🐶 🐱 🐼 🐻 🐨 🐯 🦁 🐷 🐸 🐵 🐔 🐣 🐥 🐧 🐶").split(/\s+/);

  function build() {
    panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'emoji-panel__head';

    const search = document.createElement('input');
    search.className = 'emoji-panel__search';
    search.type = 'search';
    search.placeholder = 'Search emoji…';
    head.appendChild(search);

    const grid = document.createElement('div');
    grid.className = 'emoji-panel__grid';
    panel.appendChild(head);
    panel.appendChild(grid);

    function render(list){
      grid.innerHTML = '';
      list.forEach(e => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'emoji-cell';
        cell.textContent = e;
        cell.addEventListener('click', () => {
          insertAtCursor(input, e + ' ');
          close();
          input.focus();
        });
        grid.appendChild(cell);
      });
    }
    render(EMOJIS);

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      if (!q) return render(EMOJIS);

      const MAP = KEYWORD_MAP; 
      const filtered = EMOJIS.filter(e => (MAP[e]||'').includes(q));
      render(filtered.length ? filtered : EMOJIS);
    });
  }

  const KEYWORD_MAP = (() => {
    const m = {};
    const add = (e, words) => m[e] = words.toLowerCase();
    add('😀','grinning happy smile');
    add('😂','joy laugh tears');
    add('😍','love heart eyes');
    add('🥰','in love hearts');
    add('😢','cry sad');
    add('😭','loudly crying');
    add('😡','angry mad');
    add('👍','thumbs up like');
    add('👎','thumbs down dislike');
    add('🙏','pray thanks please');
    add('🎉','party celebration confetti');
    add('🔥','fire lit');
    add('💯','100 perfect');
    add('❤️','heart love');
    add('🍕','pizza');
    add('☕','coffee');
    add('🎮','game controller');
    add('🐶','dog');
    add('🐱','cat');
    return m;
  })();

  function open() {
    if (panel.hasAttribute('hidden')) {
      build();
      panel.removeAttribute('hidden');
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onEsc, true);
    }
  }
  function close() {
    if (!panel.hasAttribute('hidden')) {
      panel.setAttribute('hidden','');
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onEsc, true);
    }
  }
  function toggle() { panel.hasAttribute('hidden') ? open() : close(); }

  function onDocClick(e){
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    close();
  }
  function onEsc(e){ if (e.key === 'Escape') close(); }

  function insertAtCursor(el, text){
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new Event('input', {bubbles:true}));
  }

  btn.setAttribute('type','button');
  btn.addEventListener('click', toggle);
})();


function isAskerOf(q) {
  const meEmail = (window.USER_EMAIL || '').trim().toLowerCase();
  const meName  = (window.DISPLAY_NAME || '').trim().toLowerCase();

  const askedRaw =
    (q.askedByEmail || q.userEmail || q.askedBy || '').trim().toLowerCase();

  return !!askedRaw && (askedRaw === meEmail || askedRaw === meName);
}

const OUTBOX_KEY = 'al.outbox.' + (window.USER_EMAIL || 'anon');

function loadOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); }
  catch { return []; }
}

function saveOutbox(arr) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr));
}

const LH_KEY = (room) => `al.localHistory.${room}`;

function lhLoad(room) {
  try { return JSON.parse(localStorage.getItem(LH_KEY(room)) || '[]'); } catch { return []; }
}
function lhSave(room, arr) {
  localStorage.setItem(LH_KEY(room), JSON.stringify(arr));
}
function lhPush(room, msgObj) {
  const arr = lhLoad(room);
  arr.push(msgObj);
  lhSave(room, arr);
}
function lhRemove(room, ts) {
  const arr = lhLoad(room).filter(m => m.ts !== ts);
  lhSave(room, arr);
}
function saveOutbox(arr) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr));

}

let outbox = loadOutbox();

function drainOutbox() {
  if (!ws || ws.readyState !== 1) { saveOutbox(outbox); return; }
  while (outbox.length) {
    const raw = outbox.shift();
    try { ws.send(raw); }
    catch { outbox.unshift(raw); break; } 
  }
  saveOutbox(outbox);
}

function addSystemCardToChat(html) {
  const stream = document.getElementById('stream'); 
  if (!stream) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg sys';         
  wrap.style.display = 'flex';
  wrap.style.justifyContent = 'flex-start';
  wrap.innerHTML = html;
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;
}
async function postCardToServer(room, qid, html, textFallback){
  try {
    await authFetch('/api/chat/share', {
      method:'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ room, qid, html, text: textFallback })
    });
  } catch(e) { }
}

function buildPlainShareText(q, ans){
  const t = (q.title || 'Untitled').trim();
  let s = `Q: ${t}\nStatus: ${q.status || 'OPEN'}`;
  if (ans) {
    s += `\nAccepted answer by ${ans.author || ans.authorEmail || 'anon'}:\n` +
         (ans.body ? ans.body.trim().slice(0,1000) : '(image)');
  }
  return s;
}
function flushOutbox() {
  const buf = loadOutbox();
  while (ws && ws.readyState === 1 && buf.length) {
    ws.send(buf.shift());
  }
  saveOutbox(buf);
}
  let SIMULATION = false;

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const escapeHTML = s => (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const timeLabel  = ts => ts ? new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  let currentUser  = 'You';
// ========= Confirm Modal (nice UI) =========
let __cmRoot = null;

function ensureConfirmModal() {
  if (__cmRoot) return __cmRoot;

  const style = document.createElement('style');
  style.textContent = `
  .cm__backdrop{
    position:fixed;
    inset:0;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:20px;
    z-index:2147483647;
    background:rgba(2,6,23,.55);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    opacity:0;
    pointer-events:none;
    transition:opacity .18s ease;
  }
  .cm__backdrop.cm--open{
    opacity:1;
    pointer-events:auto;
  }

  .cm__panel{
    width:min(520px, 94vw);
    border-radius:22px;
    overflow:hidden;
    border:1px solid rgba(148,163,184,.22);
    background:linear-gradient(180deg, rgba(15,23,42,.96), rgba(2,6,23,.96));
    box-shadow:0 28px 90px rgba(0,0,0,.55);
    transform:translateY(10px) scale(.985);
    transition:transform .18s ease;
  }
  .cm__backdrop.cm--open .cm__panel{
    transform:translateY(0) scale(1);
  }

  .cm__hdr{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:16px 16px 10px 16px;
    border-bottom:1px solid rgba(148,163,184,.14);
  }
  .cm__title{
    display:flex;
    align-items:center;
    gap:10px;
    font-weight:800;
    letter-spacing:.2px;
    color:#e5e7eb;
    font-size:16px;
  }
  .cm__badge{
    width:34px;height:34px;
    display:grid;place-items:center;
    border-radius:12px;
    background:rgba(56,189,248,.18);
    border:1px solid rgba(56,189,248,.22);
    box-shadow:0 10px 26px rgba(56,189,248,.12);
  }
  .cm__x{
    width:36px;height:36px;
    border-radius:12px;
    border:1px solid rgba(148,163,184,.22);
    background:rgba(15,23,42,.55);
    color:#e5e7eb;
    font-size:18px;
    cursor:pointer;
    display:grid;place-items:center;
    transition:transform .12s ease, background-color .12s ease;
  }
  .cm__x:hover{ background:rgba(30,41,59,.75); }
  .cm__x:active{ transform:scale(.97); }

  .cm__body{
    padding:14px 16px 6px 16px;
    color:#cbd5e1;
    line-height:1.45;
    font-size:14px;
    white-space:pre-wrap;
  }

  .cm__ftr{
    padding:14px 16px 16px 16px;
    display:flex;
    gap:10px;
    justify-content:flex-end;
  }

  .cm-btn{
    padding:10px 14px;
    font-size:14px;
    border:0;
    cursor:pointer;
    transition:.13s transform, .13s box-shadow, .13s background-color, .13s opacity;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    white-space:nowrap;
    border-radius:14px;
    min-width:92px;
  }
  .cm-btn:active{
    transform:scale(.98);
    box-shadow:none;
  }

  .cm-btn--ghost{
    background:rgba(15,23,42,.65);
    color:#e5e7eb;
    border:1px solid rgba(148,163,184,.22);
  }
  .cm-btn--ghost:hover{ background:rgba(30,41,59,.75); }

  .cm-btn--primary{
    color:#0b1120;
    background:linear-gradient(135deg,#38bdf8,#6366f1);
    box-shadow:0 10px 30px rgba(37,99,235,.35);
  }
  .cm-btn--primary:hover{ opacity:.95; }

  .cm-btn--danger{
    color:#0b1120;
    background:linear-gradient(135deg,#fb7185,#f97316);
    box-shadow:0 10px 30px rgba(248,113,113,.30);
  }
  .cm-btn--danger:hover{ opacity:.95; }

  @media (max-width: 480px){
    .cm__panel{ width:min(560px, 96vw); border-radius:18px; }
    .cm__ftr{ justify-content:stretch; }
    .cm-btn{ flex:1; min-width:0; }
  }
`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'cm__backdrop';
  root.innerHTML = `
    <div class="cm__panel" role="dialog" aria-modal="true" aria-labelledby="cm_title">
      <div class="cm__hdr">
        <div class="cm__title">
          <div class="cm__badge">💬</div>
          <span id="cm_title">Confirm</span>
        </div>
        <button id="cm_close" class="cm__x" aria-label="Close">×</button>
      </div>
      <div id="cm_body" class="cm__body">Are you sure?</div>
      <div class="cm__ftr">
        <button id="cm_cancel" class="cm-btn cm-btn--ghost">Cancel</button>
        <button id="cm_ok" class="cm-btn cm-btn--primary">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  __cmRoot = root;
  return root;
}

function showConfirmModal({
  title = 'Confirm',
  body  = 'Are you sure?',
  okText = 'OK',
  cancelText = 'Cancel',
  variant = 'primary'   // 'primary' | 'danger' | 'ghost'
} = {}) {
  const root    = ensureConfirmModal();
  const titleEl = root.querySelector('#cm_title');
  const bodyEl  = root.querySelector('#cm_body');
  const okBtn   = root.querySelector('#cm_ok');
  const cancel  = root.querySelector('#cm_cancel');
  const closeX  = root.querySelector('#cm_close');

  titleEl.textContent = title;
  bodyEl.textContent  = body;
  cancel.textContent  = cancelText;
  okBtn.textContent   = okText;

  // reset classes
  okBtn.className = 'cm-btn';
  if (variant === 'danger')      okBtn.classList.add('cm-btn--danger');
  else if (variant === 'ghost')  okBtn.classList.add('cm-btn--ghost');
  else                           okBtn.classList.add('cm-btn--primary');

  return new Promise(resolve => {
    const cleanup = (val) => {
      root.classList.remove('cm--open');
      setTimeout(() => resolve(val), 40);
      okBtn.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      closeX.removeEventListener('click', onCancel);
      root.removeEventListener('mousedown', onBack);
      window.removeEventListener('keydown', onKey);
    };
    const onOk    = () => cleanup(true);
    const onCancel= () => cleanup(false);
    const onBack  = (e) => { if (e.target === root) onCancel(); };
    const onKey   = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter')  onOk();
    };

    okBtn.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeX.addEventListener('click', onCancel);
    root.addEventListener('mousedown', onBack);
    window.addEventListener('keydown', onKey);

    root.classList.add('cm--open');
    setTimeout(() => okBtn.focus(), 0);
  });
}

window.ensureConfirmModal = ensureConfirmModal;
window.showConfirmModal   = showConfirmModal;
// ========= /Confirm Modal =========
// ===== /Confirm Modal =====
// expose to global so console/tests can call it
window.ensureConfirmModal = ensureConfirmModal;
window.showConfirmModal   = showConfirmModal;
// ===== /Confirm Modal =====





/* ---------- Identity (display name & email) ---------- */
// Read name/email from JWT if available
function readUserFromToken() {
  const token = localStorage.getItem('token') || '';
  let name = '', email = '';
  try {
    const payload = JSON.parse(
      atob((token.split('.')[1] || '').replace(/-/g,'+').replace(/_/g,'/'))
    );

    name =
      payload.name ||
      payload.given_name ||
      payload.preferred_username ||
      payload.sub || '';

    email =
      payload.email ||
      payload.username ||
      payload.user_name ||
      payload.sub || '';
  } catch (_) {}

  return { name, email };
}

// ==== IDs (put near the top, with other globals) ====
const DEVICE_ID = localStorage.getItem('deviceId') || (() => {
  const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  localStorage.setItem('deviceId', id);
  return id;
})();

const TAB_ID = sessionStorage.getItem('tabId') || (() => {
  const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  sessionStorage.setItem('tabId', id);
  return id;
})();

const CLIENT_ID = `${DEVICE_ID}:${TAB_ID}`;
window.CLIENT_ID = CLIENT_ID; // (optional) useful for console debugging

// one-time cleanup if you had an old clientId in localStorage
localStorage.removeItem('clientId');
localStorage.removeItem('al.clientId');

// --- same-origin cross-tab relay for local testing ---
const tabBus = ('BroadcastChannel' in window) ? new BroadcastChannel('al-chat') : null;


// function setComposerVisible(show) {
//   const wrap = document.getElementById('qaComposer');
//   if (!wrap) return;
//   if (show) wrap.removeAttribute('hidden');
//   else wrap.setAttribute('hidden', '');
// }

async function renderClaimOrAskerBar(q, amAsker, amClaimer) {
  const bar = document.getElementById('qaDActions');
  if (!bar) return;
  bar.innerHTML = '';

  if (amAsker) {
    // Asker buttons (Share + Delete) – keep your existing handlers
    const share = document.createElement('button');
    share.className = 'primary';
    share.textContent = 'Share in Chat';
    share.onclick = () => qaShareToChat(q.id, q);

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete Question';
    del.onclick = async () => {
const ok = await showConfirmModal({
  title: 'Delete answer',
  body: 'This will delete your answer.',
  okText: 'Delete',
  cancelText: 'Cancel',
  variant: 'danger'
});
if (!ok) return;
// ... proceed with DELETE fetch ...
      const r = await authFetch(`${API_BASE_QA}/api/questions/${q.id}`, { method: 'DELETE' });
      if (!r.ok) { alert(await r.text()); return; }
      document.getElementById('qaViewModal')?.setAttribute('hidden', '');
      qaLoadList?.();
    };

    bar.appendChild(share);
    bar.appendChild(del);
    return;
  }

  // Everyone else: show CLAIM state
  const btn = document.createElement('button');
  btn.id = 'qaClaimBtn';
  btn.className = 'primary';

  const claimedCount = Number(q.claimedCount ?? 0);
  const maxClaimers = q.maxClaimers ?? 0;
  const isFull = maxClaimers > 0 && claimedCount >= maxClaimers;
  const locked = String(q.status || '').toUpperCase() === 'LOCKED';

  if (locked) {
    btn.textContent = 'Locked';
    btn.disabled = true;
  } else if (amClaimer) {
    btn.textContent = 'Claimed';
    btn.disabled = true;
  } else if (isFull) {
    btn.textContent = 'Claim full';
    btn.disabled = true;
  } else {
    btn.textContent = 'Claim';
    btn.onclick = async () => {
      const r = await authFetch(`${API_BASE_QA}/api/questions/${q.id}/claim`, { method: 'POST' });
      if (!r.ok) { alert(await r.text()); return; }
      // re-open to refresh counts + permissions
      await qaOpen(q.id);
    };
  }

  bar.appendChild(btn);
}






tabBus && (tabBus.onmessage = (ev) => {
  const m = ev.data;
  if (!m || m.type !== 'message') return;
  if (m.room !== window.currentRoom) return;
  if (m.clientId === window.CLIENT_ID) return; // same tab
  if ((m.userEmail || '').toLowerCase() !== (window.USER_EMAIL || '').toLowerCase()) return; // different account → ignore
  addMessageToList({
    id: null,
    user: m.userName || m.user || 'User',
    text: m.text || '',
    ts: m.ts || Date.now(),
    mine: false,
    deleted: false,
    editedAt: null,
    reply: m.reply || null,
    clientId: m.clientId || ''
  });
});

function initials(name) {
  const s = (name || '').trim();
  if (!s) return 'AN';
  return s.split(/\s+/).map(x => x[0]).join('').toUpperCase().slice(0, 2);
}

// normalized helpers
// const normalize = v => (v || '').toString().trim().toLowerCase();

function setUserDisplay(name) {
  const clean = (name || '').trim();
  const key   = window.USER_EMAIL || 'anon';

  // persist per-account display name
  const NAME_MAP_KEY = 'al.displayNames';
  const map = JSON.parse(localStorage.getItem(NAME_MAP_KEY) || '{}');
  map[key] = clean || 'You';
  localStorage.setItem(NAME_MAP_KEY, JSON.stringify(map));

  window.DISPLAY_NAME = clean || 'You';
  localStorage.setItem('displayName', window.DISPLAY_NAME);
  localStorage.setItem('qa_user', window.DISPLAY_NAME); // backward compatibility

  // update avatar initials
  const av = document.querySelector('.avatar');
  if (av) av.textContent = initials(window.DISPLAY_NAME);

  window.currentUser = window.DISPLAY_NAME;
}


// bootstrap once per load
(function bootstrapIdentity(){
  const fromJwt = readUserFromToken();
  const storedName  = (localStorage.getItem('displayName') || localStorage.getItem('qa_user') || '').trim();
  const storedEmail = (localStorage.getItem('userEmail') || '').trim();

window.DISPLAY_NAME = (fromJwt.name || storedName || 'You');
  window.USER_EMAIL   = (fromJwt.email || storedEmail || '');

  localStorage.setItem('displayName', window.DISPLAY_NAME);
  if (window.USER_EMAIL) localStorage.setItem('userEmail', window.USER_EMAIL);

  // reflect into UI
  const av = document.querySelector('.avatar');
  if (av) av.textContent = initials(window.DISPLAY_NAME);

  window.currentUser = window.DISPLAY_NAME;
  currentUser = window.DISPLAY_NAME;
})();


// ---- per-account display names (keyed by email) ----
const NAME_MAP_KEY = 'al.displayNames';
const nameMap = JSON.parse(localStorage.getItem(NAME_MAP_KEY) || '{}');

if (window.USER_EMAIL && nameMap[window.USER_EMAIL]) {
  window.DISPLAY_NAME = nameMap[window.USER_EMAIL];
}

// Call this whenever the user edits their display name
window.setUserDisplay = (name) => {
  const key = window.USER_EMAIL || 'anon';
  nameMap[key] = name;
  localStorage.setItem(NAME_MAP_KEY, JSON.stringify(nameMap));
  window.DISPLAY_NAME = name;
  window.currentUser  = name;   // keep the chat label in sync
};
// one public function to let user change the display name from your “Edit name” button
window.changeQaUser = async function(){
  const next = prompt('Enter your display name', window.DISPLAY_NAME || '');
  if (!next) return;
  setUserDisplay(next);
  window.currentUser = window.DISPLAY_NAME;
  currentUser = window.DISPLAY_NAME;
  alert('Name updated.');
};




const askedByOf = (q) =>
  normalize(q?.askedByEmail || q?.askedBy || q?.askedByRaw || q?.asked_by || '');

function isAsker(q){
  const qEmail = normalize(q?.askedByEmail || '');
  const myEmail = normalize(window.USER_EMAIL || '');
  if (qEmail && myEmail) return qEmail === myEmail;
  // fallback if backend didn’t send askedByEmail
  return normalize(q?.askedBy || q?.askedByRaw || '') === normalize(window.DISPLAY_NAME || '');
}

function identityParam() {
  return encodeURIComponent(window.USER_EMAIL || window.DISPLAY_NAME || '');
}

  // function setUserName(name) {
  //   const clean = (name || '').trim();
  //   window.QA_USER = clean;
  //   localStorage.setItem('qa_user', clean);
  //   if (typeof currentUser !== 'undefined') currentUser = clean || 'You';
  //   const av = document.querySelector('.avatar');
  //   if (av) av.textContent = initials(clean);
  // }

  // Load from storage on startup (auto-seed anon if empty)
  // (function bootstrapUserName(){
  //   const saved = (localStorage.getItem('qa_user') || '').trim();
  //   const seed  = saved ? saved : `anon-${Math.floor(Math.random()*9000+1000)}`;
  //   setUserName(seed);
  // })();





  // Safety: if a "12 online" pill shows up later, replace it with the Q&A button.
document.addEventListener('DOMContentLoaded', () => {
  const selectors = ['#onlineBadge', '.online-pill', '.presence-pill', '.online-count'];
  let pill = selectors.map(s => document.querySelector(s)).find(Boolean);
  if (!pill) {
    // fallback: find any small badge that literally says "online"
    pill = Array.from(document.querySelectorAll('div,span')).find(
      el => /^\s*\d+\s*online\s*$/i.test(el.textContent || '')
    );
  }
  if (pill && !document.getElementById('qaToggle')) {
    const btn = document.createElement('button');
    btn.id = 'qaToggle';
    btn.className = 'button-33';
    btn.type = 'button';
    btn.textContent = 'Q&A';
    pill.replaceWith(btn);

    // if your original code used qaToggle?.addEventListener(...), it may have already run.
    // This ensures the new button works even if it was created after that line:
btn.addEventListener('click', async () => {
  const qaPanel = document.getElementById('qaPanel');
  qaPanel?.classList.add('open');
  await qaLoadList(); 
});
  }
});


  // ---------- Private doubt room actions ----------
  function isPrivateDoubtRoom(room) {
    if (!room) return false;
    const slug = room.includes('/') ? room.split('/').slice(1).join('/') : room;
    return slug.startsWith('doubt-q-');
  }

  function ensurePhotoUploadButton() {
    let btn = document.getElementById('photoUploadBtn');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'photoUploadBtn';
    btn.className = 'button-33';
    btn.type = 'button';
    btn.textContent = 'Photo';

    // hidden file input
    let input = document.getElementById('photoUploadInput');
    if (!input) {
      input = document.createElement('input');
      input.id = 'photoUploadInput';
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
    }

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      
      // ✅ Private doubt room: treat Photo as SOLUTION (store as Answer so we get answerId)
      const roomNow = (typeof currentRoom !== 'undefined') ? currentRoom : '';
      if (typeof isPrivateDoubtRoom === 'function' && isPrivateDoubtRoom(roomNow)) {
        const qid = (typeof parseDoubtQuestionId === 'function') ? parseDoubtQuestionId(roomNow) : null;
        if (qid) {
          try {
            const baseQA = (window.API_BASE_QA || window.API_BASE || location.origin);
            const fd = new FormData();
            fd.append('text', '');
            fd.append('image', file, file.name || 'solution.png');
            const res = await authFetch(`${baseQA}/api/questions/${qid}/answers`, { method: 'POST', body: fd });
            if (!res.ok) { alert(await res.text()); input.value = ''; return; }
            const ans = await res.json();
            const imgUrl = (ans && (ans.imageUrl || ans.imageURL)) ? (ans.imageUrl || ans.imageURL) : '';
            const payload = `SOL|${ans.id}|IMG|${imgUrl}`;
            if (typeof window.sendMessage === 'function') {
              await window.sendMessage(payload);
            } else {
              const inp = document.getElementById('message-input');
              if (inp) {
                inp.value = payload;
                inp.dispatchEvent(new Event('input', { bubbles:true }));
                document.getElementById('send-btn')?.click();
              }
            }
          } catch (e) {
            alert('Solution upload error: ' + (e?.message || e));
          } finally {
            input.value = '';
          }
          return;
        }
      }
try {
        const base = (window.API_BASE || window.API_BASE_QA || location.origin);
        const fd = new FormData();
        fd.append('file', file, file.name || 'image.png');

        const up = await authFetch(`${base}/api/files/upload`, { method: 'POST', body: fd });
        if (!up.ok) {
          const t = await up.text().catch(()=>'');
          alert('Image upload failed' + (t ? (': ' + t) : '.'));
          input.value = '';
          return;
        }

        let data = null;
        try { data = await up.json(); } catch { data = null; }
        const url = (data && (data.url || data.fileUrl || data.path)) ? (data.url || data.fileUrl || data.path) : null;
        if (!url) {
          alert('Upload succeeded but no URL returned.');
          input.value = '';
          return;
        }

        const payload = `IMG|${url}`;

        if (typeof window.sendMessage === 'function') {
          await window.sendMessage(payload);
        } else {
          const inp = document.getElementById('message-input');
          if (inp) {
            inp.value = payload;
            inp.dispatchEvent(new Event('input', { bubbles:true }));
            document.getElementById('send-btn')?.click();
          }
        }
      } catch (e) {
        alert('Image upload error: ' + (e?.message || e));
      } finally {
        input.value = '';
      }
    });

    // place button next to Q&A toggle if present
    const qaBtn = document.getElementById('qaToggle');
    if (qaBtn && qaBtn.parentNode) {
      qaBtn.insertAdjacentElement('afterend', btn);
    } else {
      document.body.appendChild(btn);
    }

    return btn;
  }

  function updateTopButtonsForRoom(room) {
    const qaBtn = document.getElementById('qaToggle');
    const photoBtn = ensurePhotoUploadButton();
    const isPrivate = isPrivateDoubtRoom(room);

    // Private doubt rooms: hide Q&A, show Photo
    if (qaBtn) qaBtn.style.display = isPrivate ? 'none' : '';
    if (photoBtn) photoBtn.style.display = isPrivate ? '' : 'none';
  }

  // ---------- AI button + modal (Resolved Doubts → AI Explanation) ----------
  function ensureAiButton() {
    // ✅ We do NOT show a global AI button in chat header.
    // AI should only be triggered from "Explain with AI" on resolved Q&A posts.
	    return null;
    const existing = document.getElementById('aiBtn') || document.getElementById('aiToggle');
    if (existing) {
      existing.style.display = 'none';
      existing.setAttribute('aria-hidden', 'true');
    }

    // Also hide any pill/button that literally says "AI" (legacy UI).
    Array.from(document.querySelectorAll('button, a, .button-33, .pill, .chip'))
      .filter(el => (el?.textContent || '').trim().toUpperCase() === 'AI')
      .forEach(el => {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      });

    return null;
  }

  
  // ✅ Remove any global AI button in chat header (AI should be only via "Explain with AI" on resolved posts)
  function removeGlobalAiButtons() {
    try {
      // common id used earlier
      const byId = document.getElementById('aiBtn');
      if (byId) byId.remove();

      // remove any header pill/button that literally says "AI"
      const candidates = Array.from(document.querySelectorAll('button,a,div,span'))
        .filter(el => {
          const t = (el.textContent || '').trim();
          if (t !== 'AI') return false;
          // avoid removing AI text inside messages
          const inHeader = el.closest('.chat-header, header, .topbar, nav, .chatTop, .chat-top');
          const looksLikeBtn = el.tagName === 'BUTTON' || el.tagName === 'A' || el.classList.contains('pill') || el.classList.contains('btn');
          return !!inHeader && looksLikeBtn;
        });

      candidates.forEach(el => el.remove());
    } catch (e) { /* ignore */ }
  }

  // run now + on next paint (some UIs render header late)
  removeGlobalAiButtons();
  setTimeout(removeGlobalAiButtons, 0);
function ensureAiModal() {
    let modal = document.getElementById('aiModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'aiModal';
    modal.style.cssText = `
      position: fixed; inset: 0; display: none; z-index: 99999;
      background: rgba(0,0,0,.55); align-items: center; justify-content: center;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: min(920px, 92vw); height: min(80vh, 720px);
      background: #0f172a; color: #e5e7eb; border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px; overflow: hidden; display:flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,.55);
    `;

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.08)">
        <div>
          <div style="font-weight:700; font-size:15px">AI Explanations</div>
          <div style="opacity:.7; font-size:12px">Resolved doubts (accepted answer) → generate AI explanation</div>
        </div>
        <button id="aiModalClose" style="background:transparent; border:0; color:#e5e7eb; font-size:20px; cursor:pointer">×</button>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:12px; flex:1; min-height:0">
        <div style="border:1px solid rgba(255,255,255,.08); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; min-height:0">
          <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08); font-weight:600">Your Resolved Doubts</div>
          <div id="aiResolvedList" style="padding:10px 12px; overflow:auto; flex:1; min-height:0"></div>
        </div>

        <div style="border:1px solid rgba(255,255,255,.08); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; min-height:0">
          <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08); font-weight:600">AI Chat</div>
          <div id="aiChat" style="padding:10px 12px; overflow:auto; flex:1; min-height:0; white-space:pre-wrap"></div>
          <div style="display:flex; gap:8px; padding:10px 12px; border-top:1px solid rgba(255,255,255,.08)">
            <input id="aiChatInput" placeholder="Ask a follow-up…" style="flex:1; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:#0b1220; color:#e5e7eb" />
            <button id="aiChatSend" style="padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:#1f2937; color:#e5e7eb; cursor:pointer">Send</button>
          </div>
        </div>
      </div>
    `;

    modal.appendChild(card);
    document.body.appendChild(modal);

    const close = () => { modal.style.display = 'none'; };
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    card.querySelector('#aiModalClose')?.addEventListener('click', close);
    return modal;
  }

  let currentExplanationId = null;

  async function openAiModal() {
    const modal = ensureAiModal();
    modal.style.display = 'flex';

    const listEl = modal.querySelector('#aiResolvedList');
    const chatEl = modal.querySelector('#aiChat');
    const inputEl = modal.querySelector('#aiChatInput');
    const sendBtn = modal.querySelector('#aiChatSend');

    if (listEl) listEl.innerHTML = '<div style="opacity:.75">Loading…</div>';
    if (chatEl) chatEl.textContent = 'Select a resolved doubt → Generate AI explanation.';
    currentExplanationId = null;

    // 1) load resolved list
    const res = await authFetch(`${API_BASE}/api/ai/resolved?page=0&size=50`);
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      throw new Error(`Resolved list failed (${res.status}): ${t}`);
    }
    const page = await res.json();
    const items = Array.isArray(page?.content) ? page.content : [];

    if (!items.length) {
      listEl.innerHTML = `
        <div style="opacity:.8; line-height:1.5">
          No resolved doubts found for your account.
          <br><br>
          To appear here, a doubt must be <b>RESOLVED</b> and have an <b>accepted answer</b>.
        </div>`;
      return;
    }

    listEl.innerHTML = '';
    items.forEach(it => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:10px; margin-bottom:10px;';
      row.innerHTML = `
        <div style="font-weight:700; margin-bottom:4px">${escapeHTML(it.title || ('Doubt #' + it.doubtId))}</div>
        <div style="opacity:.7; font-size:12px; margin-bottom:10px">${escapeHTML(it.subject || '')}</div>
        <button data-did="${it.doubtId}" style="padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:#111827; color:#e5e7eb; cursor:pointer">Generate</button>
      `;
      row.querySelector('button')?.addEventListener('click', async (e) => {
        const doubtId = Number(e.currentTarget.getAttribute('data-did'));
        if (!Number.isFinite(doubtId)) return;
        chatEl.textContent = 'Generating AI explanation…';

        const cr = await authFetch(`${API_BASE}/api/ai/explanations`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ doubtId })
        });
        const payload = await cr.json().catch(()=> ({}));
        if (!cr.ok) {
          throw new Error(payload?.message || payload?.error || `AI create failed (${cr.status})`);
        }

        currentExplanationId = payload.explanationId || payload.id || null;
        if (!currentExplanationId) {
          chatEl.textContent = 'AI created, but no explanationId returned.';
          return;
        }
        await loadAiMessages(currentExplanationId);
      });

      listEl.appendChild(row);
    });

    // 2) send follow-ups
    const send = async () => {
      if (!currentExplanationId) {
        alert('First generate an explanation from the left list.');
        return;
      }
      const text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      await authFetch(`${API_BASE}/api/ai/explanations/${currentExplanationId}/messages`, {
        method:'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text })
      }).catch(()=>{});
      await loadAiMessages(currentExplanationId);
    };
    sendBtn?.addEventListener('click', send);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  async function loadAiMessages(explanationId) {
    const modal = document.getElementById('aiModal');
    const chatEl = modal?.querySelector('#aiChat');
    if (!chatEl) return;

    const r = await authFetch(`${API_BASE}/api/ai/explanations/${explanationId}/messages`);
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      chatEl.textContent = `Failed to load messages (${r.status}): ${t}`;
      return;
    }
    const items = await r.json().catch(()=> []);
    const lines = (Array.isArray(items) ? items : []).map(m => {
      const who = (m.sender || m.role || '').toUpperCase() || 'AI';
      return `${who}: ${m.message || m.text || ''}`;
    });
    chatEl.textContent = lines.join('\n\n') || 'No messages yet.';
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // Ensure AI button exists + is wired
  // ✅ Global AI button removed: only show "Explain with AI" on RESOLVED posts.
  removeGlobalAiButtons();


  // ---------------------------------------------------------------------------
  // ✅ AI for resolved private doubt-rooms (question-based rooms)
  // Private room slug is: subject + "/doubt-q-" + questionId (from Questions module)
  // But /api/ai/* expects doubtId (from Doubts module). That mismatch causes:
  // "Doubt not found" (500) when you click "Explain with AI" on a resolved room.
  // Fix: for rooms like "*/doubt-q-<id>", generate explanation using:
  // POST /api/aiqa/explain { questionId }
  // and render the returned explanation inside the same AI modal UI.
  // ---------------------------------------------------------------------------
  async function openAiForRoom(room) {
    try {
      if (!room || typeof room !== 'string') {
        openAiModal();
        return;
      }

      // Extract questionId from ".../doubt-q-<id>"
      const slug = room.includes('/') ? room.split('/').slice(1).join('/') : room;
      const m = slug.match(/doubt-q-(\d+)/i);
      if (!m) {
        // Not a question-based room -> fallback to library modal
        openAiModal();
        return;
      }
      const questionId = parseInt(m[1], 10);
      if (!questionId) {
        openAiModal();
        return;
      }

      // Open modal first
      openAiModal();

      // UI refs (created by openAiModal)
      const listBox = document.getElementById('aiResolvedList');
      const chatBox = document.getElementById('aiChatBox');
      const hint = document.getElementById('aiChatHint');
      const input = document.getElementById('aiUserInput');
      const sendBtn = document.getElementById('aiSendBtn');

      if (listBox) {
        listBox.innerHTML = `
          <div style="padding:10px; color:#cfd8ff;">
            <div style="font-weight:700; margin-bottom:6px;">Resolved room</div>
            <div style="opacity:.8; font-size:13px;">Room: <span style="opacity:.95;">${escapeHtml(room)}</span></div>
            <div style="opacity:.8; font-size:13px;">Question ID: <b>${questionId}</b></div>
            <div style="margin-top:10px; font-size:12px; opacity:.8;">Generating explanation from the accepted answer…</div>
          </div>
        `;
      }

      if (hint) hint.textContent = 'Generating explanation from accepted answer…';
      if (chatBox) chatBox.innerHTML = '';
      if (input) { input.value = ''; input.disabled = true; }
      if (sendBtn) sendBtn.disabled = true;

      // Call question-based AI endpoint
      const res = await authFetch(`${API_BASE}/api/aiqa/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId })
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { explanation: text }; }

      if (!res.ok) {
        const msg = (typeof data === 'string') ? data : (data?.message || data?.error || text || `HTTP ${res.status}`);
        if (hint) hint.textContent = 'Failed to generate AI explanation.';
        if (chatBox) {
          chatBox.innerHTML = `<div style="color:#ffb4b4; padding:10px; white-space:pre-wrap;">${escapeHtml(msg)}</div>`;
        }
        return;
      }

      const explanation = (data && data.explanation) ? String(data.explanation) : String(text || '');
      if (hint) hint.textContent = 'AI Explanation (based on accepted answer):';
      if (chatBox) {
        // Render as pre text (markdown-ish) for now
        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.margin = '0';
        pre.style.padding = '10px';
        pre.style.color = '#e9eeff';
        pre.textContent = explanation;
        chatBox.appendChild(pre);
      }

      // Follow-ups: for now keep input disabled (because /api/aiqa has no follow-up chat)
      // We intentionally avoid changing extra functionality here.
    } catch (e) {
      console.error('openAiForRoom failed', e);
      try { openAiModal(); } catch (_) {}
    }
  }

  // Expose globally (used by "Explain with AI" button on question cards)
  window.openAiForRoom = openAiForRoom;



  /* ---------- Edit name modal wiring ---------- */
  const editBtn    = document.getElementById('qaEditNameBtn');
  const editModal  = document.getElementById('editModal');
  const editInput  = document.getElementById('editInput');
  const editOkBtn  = editModal?.querySelector('[data-ok]');
  const editCancel = editModal?.querySelector('[data-cancel]');
  const editCloseX = editModal?.querySelector('[data-close]');

  function openEditModal() {
    if (!editModal) return;
    editInput.value = window.DISPLAY_NAME || '';
    editModal.style.display = 'block';
    editInput.focus();
  }
  function closeEditModal() {
    if (!editModal) return;
    editModal.style.display = 'none';
  }

  editBtn?.addEventListener('click', openEditModal);
  editOkBtn?.addEventListener('click', () => {
    const name = (editInput.value || '').trim();
    if (!name) return;
    setUserDisplay(name);
    window.currentUser = window.DISPLAY_NAME;
    currentUser = window.DISPLAY_NAME;
    closeEditModal();
  });
  editCancel?.addEventListener('click', closeEditModal);
  editCloseX?.addEventListener('click', closeEditModal);

  // Fallback inline prompt (also bound to window)
  // function changeQaUser() {
  //   const cfg = {
  //     title: "Edit display name",
  //     label: "Enter your display name",
  //     placeholder: (window.QA_USER || "Your name"),
  //     okText: "Save",
  //     cancelText: "Cancel",
  //     value: (window.QA_USER || "")
  //   };
  //   if (typeof showPromptModal === 'function') {
  //     showPromptModal(cfg).then(next => {
  //       if (next == null) return;
  //       const name = next.trim();
  //       if (!name) {
  //         showNiceAlert?.("Name can’t be empty.", { title: "Oops", icon: "⚠" });
  //         return;
  //       }
  //       setUserName(name);
  //       showNiceAlert?.(`Your name is now <b>${escapeHTML(name)}</b>.`, { title: "Updated", icon: "✅" });
  //     });
  //   } else {
  //     const next = prompt(cfg.title, window.QA_USER || '');
  //     if (!next) return;
  //     // setUserName(next);
  //     alert('Name updated.');
  //   }
  // }
  // window.changeQaUser = changeQaUser;

  /* ---------- Toast / Alerts ---------- */
  function showToast(text){
    const t = document.createElement('div');
    t.className = 'al-toast'; t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(()=> t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),250); }, 1600);
  }
// Sleek bottom-right alert card (used for "Private doubt room created" etc.)
function showNiceAlert(
  message,
  { title = "Heads up", okText = "OK", icon = "ℹ️" } = {}
) {
  return new Promise((resolve) => {
    // Root overlay (for positioning bottom-right)
    const root = document.createElement("div");
    root.className = "nice-alert-root";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "flex-end",
      zIndex: "99998",
      pointerEvents: "none", // only card will take clicks
    });

    root.innerHTML = `
      <div class="al-modal__backdrop" style="background:transparent;"></div>
      <div class="nice-alert"
           role="alertdialog"
           aria-modal="true"
           aria-label="${title}"
           style="
             pointer-events:auto;
             margin:24px;
             max-width:380px;
             width:100%;
             background:radial-gradient(circle at top, #020617, #020617);
             border-radius:16px;
             border:1px solid rgba(148,163,184,.45);
             box-shadow:0 24px 60px rgba(15,23,42,.95);
             padding:14px 16px 12px 16px;
             color:#e5e7eb;
             font-family:system-ui,-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;
           ">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="
              width:32px;
              height:32px;
              border-radius:999px;
              background:linear-gradient(135deg,#38bdf8,#6366f1);
              display:flex;
              align-items:center;
              justify-content:center;
              flex-shrink:0;
              font-size:18px;
          ">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <h3 style="margin:0;font-size:14px;font-weight:600;letter-spacing:.01em;">
                ${title}
              </h3>
              <button class="al-x"
                      data-x
                      aria-label="Close"
                      style="
                        background:transparent;
                        border:0;
                        color:#9ca3af;
                        font-size:16px;
                        cursor:pointer;
                        border-radius:999px;
                        padding:2px 4px;
                      ">
                ✕
              </button>
            </div>
            <p style="
                margin:6px 0 0 0;
                font-size:13px;
                line-height:1.6;
                color:#cbd5f5;
            ">
              ${message}
            </p>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;">
          <button class="al-btn"
                  data-ok
                  style="
                    border-radius:999px;
                    padding:6px 16px;
                    font-size:13px;
                    border:0;
                    background:linear-gradient(135deg,#38bdf8,#6366f1);
                    color:#0b1120;
                    cursor:pointer;
                    box-shadow:0 10px 30px rgba(37,99,235,.55);
                  ">
            ${okText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    const panel = root.querySelector(".nice-alert");
    // entry animation
    panel.style.transform = "translateY(20px)";
    panel.style.opacity = "0";
    panel.style.transition =
      "transform .18s ease-out, opacity .18s ease-out";

    requestAnimationFrame(() => {
      root.style.pointerEvents = "auto";
      panel.style.transform = "translateY(0)";
      panel.style.opacity = "1";
    });

    const close = () => {
      panel.style.transform = "translateY(10px)";
      panel.style.opacity = "0";
      setTimeout(() => {
        root.remove();
        resolve();
      }, 160);
    };

    const okBtn = root.querySelector("[data-ok]");
    const xBtn = root.querySelector("[data-x]");

    okBtn && okBtn.addEventListener("click", close);
    xBtn && xBtn.addEventListener("click", close);

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") close();
      },
      { once: true }
    );
  });
}

  // Pretty-alert shim: convert window.alert() to your modal
(function patchAlert(){
  const nativeAlert = window.alert;
  window.alert = function(msg){
    try {
      // showNiceAlert returns a Promise — no need to block like native alert
      return showNiceAlert(escapeHTML(String(msg)), { title: 'Heads up', icon: 'ℹ️' });
    } catch {
      // if something fails, fall back to the native one
      nativeAlert(msg);
    }
  };
})();

function svgCheck() {
  return `
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="rgba(255,255,255,.16)" stroke="rgba(255,255,255,.35)"/>
  <path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function buildAcceptedAnswerCard({ q, a, apiBase }) {
  const img = a?.imageUrl ? (a.imageUrl.startsWith('http') ? a.imageUrl : `${apiBase}${a.imageUrl}`) : '';
  const title = (q?.title || '(untitled)').slice(0,120);
  const author = a?.author || 'Anonymous';
  const txt = (a?.body || '').trim();
  const sub = txt ? escapeHTML(txt.slice(0,120)) : '(no text)';
  const media = img
    ? `<div class="sc-media"><img src="${img}" alt="answer image" data-previewable></div>`
    : `<div class="sc-media placeholder">(no image)</div>`;

  return `
<div class="shared-card accepted" role="group" aria-label="Accepted answer for ${escapeHTML(title)}">
  ${media}
  <div class="sc-details">
    <div class="sc-badge" aria-label="Accepted Answer">${svgCheck()} Accepted Answer</div>
    <h3 class="sc-title">${escapeHTML(title)}</h3>
    <div class="sc-meta">by ${escapeHTML(author)}${txt ? ` — ${sub}` : ''}</div>
  </div>
</div>`;
}

function buildQuestionCard({ q, apiBase }) {
  const img = q?.imageUrl ? (q.imageUrl.startsWith('http') ? q.imageUrl : `${apiBase}${q.imageUrl}`) : '';
  const title = (q?.title || '(untitled)').slice(0,140);
  const body = (q?.body || '').trim();
  const sub = body ? escapeHTML(body.slice(0,140)) : '(no details)';
  const media = img
    ? `<div class="sc-media"><img src="${img}" alt="question image" data-previewable></div>`
    : `<div class="sc-media placeholder">(no image)</div>`;

  return `
<div class="shared-card question" role="group" aria-label="Question: ${escapeHTML(title)}">
  ${media}
  <div class="sc-details">
    <div class="sc-badge">Question</div>
    <h3 class="sc-title">${escapeHTML(title)}</h3>
    <div class="sc-meta">${sub}</div>
  </div>
</div>`;
}

  /* ---------- Image Preview (optional) ---------- */
  function enableImagePreview() {
    const modal   = document.getElementById('imgModal');
    const modalImg= document.getElementById('imgModalContent');
    const closeBtn= document.getElementById('imgModalClose');
    if (!modal || !modalImg || !closeBtn) return;
    document.body.addEventListener('click', (e) => {
      const img = e.target.closest('img[data-previewable]');
      if (!img) return;
      modal.style.display = 'flex';
      modalImg.src = img.src;
    });
    closeBtn.onclick = () => (modal.style.display = 'none');
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
  }
  enableImagePreview();

  /* ---------- Clipboard ---------- */
  async function copyToClipboard(text){
    try{
      await navigator.clipboard.writeText(text || '');
      showToast('Copied');
    }catch{
      const ta = document.createElement('textarea');
      ta.value = text || ''; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); showToast('Copied'); }catch{}
      ta.remove();
    }
  }

  /* ---------- Backend / WS ---------- */

  // const ORIGIN_OVERRIDE = (localStorage.getItem('backendOrigin') || '').trim();
  // const isFile      = location.origin === 'null' || location.protocol === 'file:';
  // const looksLikeDev= /:\d+$/.test(location.origin) && !location.origin.endsWith(':8080');

  const WS_URL      = API_BASE.replace(/^http:/,'ws:').replace(/^https:/,'wss:') + '/ws/chat';
// --- unified WebSocket sender (use this everywhere) ---

async function persistAfterSend({ room, text, ts, replyToId, name, email, node }) {
  try {
    const [subject, slug] = room.split('/');
    const res = await authFetch(`${API_BASE}/api/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject, slug, text, ts,
        clientId: CLIENT_ID,
        user: name, userName: name, userEmail: email,
        ...(replyToId ? { replyToId } : {})
      })
    });

    if (!res.ok) {
      console.warn('persist failed:', res.status, await res.text());
      // leave localHistory entry in place so it survives refresh
      return;
    }

    const saved = await res.json().catch(() => ({}));
    // success → remove from local fallback cache
    lhRemove(room, ts);

    // reflect server id on the DOM node (helps edits/deletes)
    if (saved?.id && node) node.dataset.id = String(saved.id);

  } catch (e) {
    console.warn('persist error:', e);
    // keep local cache; user refresh won’t lose the message
  }
}
// Accepts string OR plain object; queues and flushes
function wsSend(payload) {
  const raw = (typeof payload === 'string') ? payload : JSON.stringify(payload);
  outbox.push(raw);
  drainOutbox();
}
// --- unified WebSocket sender (use this everywhere) ---











  // --- JWT Auth helpers ---
function authHeaders(extra = {}) {
  const t = localStorage.getItem("token");
  return t ? { ...extra, Authorization: "Bearer " + t } : { ...extra };
}

async function authFetch(url, options = {}) {
  const headers = authHeaders(options.headers || {});
  return fetch(url, { ...options, headers });
}

  // window.wsSend = function(payload){
  //   try {
  //     if (window.ws && window.ws.readyState === 1) {
  //       window.Jtypeof payload === 'string' ? payload : JSON.stringify(payload));
  //     }
  //   } catch (e) { /* ignore */ }
  // };

  // function wsSendSafe(obj){
  //   try {
  //     if (window.ws && ws.readyState === 1) {
  //       ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  //     }
  //   } catch (_) {}
  // }

async function tryFetch(url) {
  try { const r = await authFetch(url, { method: "GET" }); return r.ok; }
  catch { return false; }
}
  async function initBackendOrSim(){
    SIMULATION = !(await tryFetch(API_BASE + '/api/ping').catch(()=>false));
    connectWS();
  }
  function connectWS(){
    if(SIMULATION){ ws=null; return; }
    try{
      ws = new WebSocket(WS_URL);
      window.ws = ws;
      ws.onopen = () => {
        drainOutbox();
      
        const name  = (window.DISPLAY_NAME || 'anon').trim();
        const email = (window.USER_EMAIL || '').trim().toLowerCase();
        const identity = email || name; // agar email nahi, to at least name stable rahe
      
        wsSend({
          type: 'join',
          room: currentRoom,
          userName: name,
          userEmail: identity,   // backend email yahi lega
          user: identity         // fallback ke liye bhi same
        });


        // ✅ If this is a private doubt room (…/doubt-q-<id>), tell backend that we joined
        // This locks the claim (expiresAt = null) so scheduler won't free the slot.
        const mQ = currentRoom.match(/\/doubt-q-(\d+)$/);
        if (mQ) {
          const qid = Number(mQ[1]);
          if (!Number.isNaN(qid)) {
            notifyJoined(qid).catch(() => {});
          }
        }
      };
ws.onclose = () => { ws = null; setTimeout(connectWS, 1500); };
ws.onerror = () => { ws = null; setTimeout(connectWS, 1500); };
      ws.onmessage = onWsMessage;
    }catch{ SIMULATION = true; ws=null; }
  }

  /* ---------- Reactions ---------- */
  const REACTIONS = ['👍','❤️','😂','😮','😢','👏','🔥','🙏'];
  const reactionStore = new Map(); // Map<messageId, Map<emoji, Set<user>>>

  function ensureRxBuckets(id, emoji){
    const k = String(id);
    let byEmoji = reactionStore.get(k);
    if (!byEmoji){ byEmoji = new Map(); reactionStore.set(k, byEmoji); }
    let users = byEmoji.get(emoji);
    if (!users){ users = new Set(); byEmoji.set(emoji, users); }
    return { byEmoji, users };
  }
  function chipLabel(emoji, users){
    const n = users.size;
    const count = n > 99 ? '99+' : String(n);
    return `${emoji} ${count}`;
  }
  function renderReactionsRow(wrap){
    const id = wrap?.dataset?.id;
    if (!id) return;
    const row = wrap.querySelector('.msg-reactions');
    const content = wrap.querySelector('.message-content');
    if (!row || !content) return;

    const byEmoji = reactionStore.get(String(id));
    row.innerHTML = '';
    let hasAny = false;
    if (byEmoji && byEmoji.size){
      for (const [emoji, users] of byEmoji.entries()){
        if (!users || users.size === 0) continue;
        hasAny = true;
        const chip = document.createElement('div');
        chip.className = 'rx-chip';
        chip.textContent = chipLabel(emoji, users);
        chip.title = [...users].join(', ');
        row.appendChild(chip);
      }
    }
    row.style.display = hasAny ? 'inline-flex' : 'none';
    wrap.classList.toggle('has-reactions', hasAny);
  }
  function showReactionPicker(anchorEl, messageId){
    document.querySelectorAll('.rx-popover').forEach(n=>n.remove());
    const pop = document.createElement('div');
    pop.className = 'rx-popover';
    pop.innerHTML = `
      <button data-emoji="👍">👍</button>
      <button data-emoji="❤️">❤️</button>
      <button data-emoji="😂">😂</button>
      <button data-emoji="👏">👏</button>
      <button data-emoji="🔥">🔥</button>
      <button class="rx-close" aria-label="Close">✖</button>
    `;
    document.body.appendChild(pop);

    const r = anchorEl.getBoundingClientRect();
    const pad = 8;
    const desiredTop  = Math.max(pad, r.top - pop.offsetHeight - 10);
    let desiredLeft   = r.left + (r.width/2) - (pop.offsetWidth/2);
    desiredLeft = Math.max(pad, Math.min(desiredLeft, window.innerWidth - pop.offsetWidth - pad));
    pop.style.top  = `${desiredTop}px`;
    pop.style.left = `${desiredLeft}px`;

    pop.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-emoji]');
      if (btn){
        const emoji = btn.getAttribute('data-emoji');
        if (!messageId){ pop.remove(); return; }
        if (ws && ws.readyState === 1){
          wsSend({ type:'reaction', id: String(messageId), emoji, user: currentUser });
        }
        pop.remove();
      }
      if (e.target.closest('.rx-close')) pop.remove();
    }, { passive:false });

    const onDoc = (ev)=>{
      if (!pop.contains(ev.target)){
        pop.remove(); document.removeEventListener('mousedown', onDoc);
        document.removeEventListener('touchstart', onDoc);
      }
    };
    setTimeout(()=>{
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('touchstart', onDoc, { passive:true });
    }, 0);
  }

  /* ---------- WS dedupe ---------- */
  const _seen = new Set();
  function seenOnceForMessage(msg){
    if (msg?.id) {
      const key = 'id:' + msg.id;
      if (_seen.has(key)) return true;
      _seen.add(key);
      setTimeout(()=>_seen.delete(key), 60000);
      return false;
    }
    const u  = msg?.user || '';
    const t  = (msg?.text || '').slice(0, 50);
    const ts = msg?.ts || '';
    const key = `sig:${ts}:${u}:${t}`;
    if (_seen.has(key)) return true;
    _seen.add(key);
    setTimeout(()=>_seen.delete(key), 60000);
    return false;
  }



function enhanceAudioBubbles(root = document) {
  const bubbles = root.querySelectorAll('.audio-bubble');
  bubbles.forEach(bub => {
    if (bub._wired) return;
    bub._wired = true;

    const audio = bub.querySelector('audio');
    const btn   = bub.querySelector('.ab-btn');
    const fill  = bub.querySelector('.ab-fill');
    const tPos  = bub.querySelector('[data-role="pos"]');
    const tDur  = bub.querySelector('[data-role="dur"]');

    const fmt = s => {
      s = Math.max(0, Math.floor(s));
      const m = Math.floor(s/60), r = s%60;
      return `${m}:${String(r).padStart(2,'0')}`;
    };

    // Load duration
    audio.addEventListener('loadedmetadata', () => {
      tDur.textContent = fmt(audio.duration || 0);
    });

    // Sync progress
    audio.addEventListener('timeupdate', () => {
      const pct = (audio.currentTime / (audio.duration || 1)) * 100;
      fill.style.width = `${pct}%`;
      tPos.textContent = fmt(audio.currentTime);
    });

    // End -> reset
    audio.addEventListener('ended', () => {
      btn.textContent = '▶';
      btn.classList.remove('playing');
      btn.classList.add('paused');
    });

    // Play/Pause
    btn.addEventListener('click', async () => {
      // pause any other playing bubble
      document.querySelectorAll('.audio-bubble audio').forEach(a => {
        if (a !== audio && !a.paused) a.pause();
      });

      if (audio.paused) {
        try {
          await audio.play();
          btn.textContent = '❚❚';
          btn.classList.remove('paused');
          btn.classList.add('playing');
        } catch (e) {
          console.error(e);
        }
      } else {
        audio.pause();
        btn.textContent = '▶';
        btn.classList.remove('playing');
        btn.classList.add('paused');
      }
    });

    // Click on bar to seek
    bub.querySelector('.ab-bar').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct  = (e.clientX - rect.left) / rect.width;
      audio.currentTime = (audio.duration || 0) * Math.min(1, Math.max(0, pct));
    });
  });
}


  
// Cache minimal info from the list so detail view can use it if API omits fields
window.QUESTION_CACHE = {};

  /* ---------- Q&A Drawer ---------- */
  const API_BASE_QA = (typeof API_BASE !== 'undefined' && API_BASE)
    ? API_BASE
    : ((() => {
        const isFile2 = location.origin === 'null' || location.protocol === 'file:';
        const looksLikeDev2 = /:\d+$/.test(location.origin) && !location.origin.endsWith(':8080');
        return (isFile2 || looksLikeDev2) ? 'http://localhost:8080' : location.origin;
      })());
      window.API_BASE = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : API_BASE_QA;
      window.API_BASE_QA = API_BASE_QA;
// window.API_BASE = API_BASE;
  const qaToggle      = document.getElementById('qaToggle');
  const qaPanel       = document.getElementById('qaPanel');
  const qaClose       = document.getElementById('qaClose');
  const qaList        = document.getElementById('qaList');

  const qaTitleIn     = document.getElementById('qaTitle');
  const qaBodyIn      = document.getElementById('qaBody');
  const qaMaxIn       = document.getElementById('qaMax');
  const qaAskBtn      = document.getElementById('qaAskBtn');

  const detailWrap    = document.getElementById('qaDetail');
  const qaDTitle      = document.getElementById('qaDTitle');
  const qaDBody       = document.getElementById('qaDBody');
  const qaDMeta       = document.getElementById('qaDMeta');
  const qaDClaimBtn   = document.getElementById('qaDClaimBtn');
  const qaDAnswerArea = document.getElementById('qaDAnswerArea');
  const qaDAnswerText = document.getElementById('qaDAnswerText');
  const qaDSendAnswer = document.getElementById('qaDSendAnswer');
  const qaDAnswers    = document.getElementById('qaDAnswers');
  const qaDBackBtn    = document.getElementById('qaDBackBtn');

  let currentQid = null;




window.openMiniProfile = async function (userInfo) {
  const modal = document.getElementById('miniProfileModal');
  if (!modal) {
    console.warn('[miniProfile] modal not found');
    return;
  }

  const nameEl      = document.getElementById('mpName');
  const streamEl    = document.getElementById('mpStream');
  const avatarEl    = document.getElementById('mpAvatar');
  const interestsEl = document.getElementById('mpInterests');
  const doubtsEl    = document.getElementById('mpDoubts');
  const problemsEl  = document.getElementById('mpProblems');
  const rankEl      = document.getElementById('mpRank');
  const likeCountEl = document.getElementById('mpLikeCount');
  const likeBtn     = document.getElementById('mpLikeBtn');
  const reportBtn   = document.getElementById('mpReportBtn')

  // userInfo → email + name
  userInfo = userInfo || {};
  const email = userInfo.email || userInfo.id || '';
  let name   = userInfo.name || userInfo.userName ||
               (email && email.includes('@') ? email.split('@')[0] : 'User');

  if (!email) {
    console.warn('[miniProfile] no email in userInfo', userInfo);
    return;
  }

  // basic skeleton values
  const initials = (name || 'U').trim().slice(0, 2).toUpperCase();
  if (nameEl)   nameEl.textContent   = name || 'User';
  if (avatarEl) avatarEl.textContent = initials;
  if (streamEl) streamEl.textContent = 'Loading…';
  if (doubtsEl)   doubtsEl.textContent   = '—';
  if (problemsEl) problemsEl.textContent = '—';
  if (rankEl)     rankEl.textContent     = '—';
  if (likeCountEl) likeCountEl.textContent = '—';

  if (interestsEl) interestsEl.innerHTML = '';

  // show modal
  modal.style.display = 'flex';
  modal.classList.add('show');

  try {
    const res = await authFetch(
      `${API_BASE}/api/profile/card?email=${encodeURIComponent(email)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error('Profile load failed: ' + res.status);

    const data = await res.json();
    console.log('[miniProfile] data:', data);

    // overwrite name if backend ne diya
    name = data.name || name;
    const initials2 = (data.initials || name.slice(0, 2) || 'U').toUpperCase();

    if (avatarEl) avatarEl.textContent = initials2;
    if (nameEl)   nameEl.textContent   = name;
    if (streamEl) streamEl.textContent = data.branchLabel || '—';

    if (doubtsEl)   doubtsEl.textContent   = data.doubtsSolved ?? 0;
    if (problemsEl) problemsEl.textContent = data.problemsAttempted ?? 0;
    if (rankEl) {
      rankEl.textContent =
        data.rank && data.rank > 0 ? `#${data.rank}` : '—';
    }

    if (interestsEl) {
      interestsEl.innerHTML = '';
      (data.interests || []).forEach(lbl => {
        const chip = document.createElement('div');
        chip.className = 'mini-chip';
        chip.textContent = lbl;
        interestsEl.appendChild(chip);
      });
    }

    if (likeCountEl) {
      likeCountEl.textContent = `${data.likes ?? 0} likes`;
    }

    if (likeBtn) {
      likeBtn.dataset.targetEmail = email;
      likeBtn.textContent = data.likedByMe ? '💔 Unlike' : '❤️ Like';
    }
    if (reportBtn) {
      reportBtn.dataset.targetEmail = email;
      reportBtn.dataset.targetName  = name;
    }
  } catch (err) {
    console.error('[miniProfile] error', err);
    if (streamEl) streamEl.textContent = 'Failed to load profile';
  }

    // ensure report button click opens modal
    if (reportBtn && !reportBtn.dataset.bound) {
      reportBtn.dataset.bound = '1';
      reportBtn.addEventListener('click', () => {
        const targetEmail = reportBtn.dataset.targetEmail || email;
        const targetName  = reportBtn.dataset.targetName  || name;
        openReportModal(targetEmail, targetName);
      });
    }
};

// ---- REPORT BUTTON WORKING (FIXED) ----
document.getElementById("avatarMenu")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.act;
  const email  = window.currentAvatarEmail || "";   // yahi se user email milegi
  const name   = window.currentAvatarName  || "";

  if (action === "view") {
    openMiniProfile({ email, name });
  }

  if (action === "report") {
    openReportModal(email, name);
  }
});

// Avatar double-click = open menu
document.querySelectorAll(".chat-msg .avatar").forEach(av => {
  av.addEventListener("dblclick", (e) => {
    const email = av.dataset.email;
    const name  = av.dataset.name;

    window.currentAvatarEmail = email;
    window.currentAvatarName  = name;

    const menu = document.getElementById("avatarMenu");
    menu.style.display = "block";
    menu.style.left = e.pageX + "px";
    menu.style.top  = e.pageY + "px";
  });
});



// ========== Report Modal from mini profile / avatar menu ==========
window.openReportModal = function (targetEmail, targetName) {
  const modal   = document.getElementById('reportModal');
  if (!modal) {
    console.warn('[reportModal] #reportModal not found');
    return;
  }

  const nameEl  = document.getElementById('reportUserName');
  const textEl  = document.getElementById('reportText');
  const fileEl  = document.getElementById('reportFile');
  const btnClose  = document.getElementById('reportClose');
  const btnCancel = document.getElementById('reportCancel');
  const btnSend   = document.getElementById('reportSend');
  const backdrop  = modal.querySelector('.al-modal__backdrop');

  // store target on modal
  modal.dataset.targetEmail = targetEmail || '';
  modal.dataset.targetName  = targetName  || '';

  if (nameEl) {
    const label = targetName || targetEmail || 'user';
    nameEl.textContent = `Reporting: ${label}`;
  }
  if (textEl) textEl.value = '';
  if (fileEl) fileEl.value = '';

  const close = () => { modal.style.display = 'flex' === modal.style.display
                               ? (modal.style.display = 'none')
                               : (modal.style.display = 'none'); };

  // close handlers (bind once)
  [btnClose, btnCancel, backdrop].forEach(el => {
    if (el && !el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', close);
    }
  });

  if (btnSend && !btnSend.dataset.bound) {
    btnSend.dataset.bound = '1';
    btnSend.addEventListener('click', () => {
      const reason = (textEl && textEl.value.trim()) || '';
      const file   = fileEl && fileEl.files && fileEl.files[0];

      if (!reason) {
        alert('Please describe the issue before submitting.');
        return;
      }

      // TODO: yahan baad me backend POST /api/report-user wire karenge
      console.log('[REPORT DEMO]', {
        targetEmail: modal.dataset.targetEmail,
        targetName : modal.dataset.targetName,
        reason,
        file
      });

      alert('Report submitted (demo only, backend pending).');
      close();
    });
  }

  // finally open
  modal.style.display = 'flex';
};

const fileInput = document.getElementById("reportFile");
const fileNameEl = document.getElementById("reportFileName");

if (fileInput) {
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      fileNameEl.textContent = fileInput.files[0].name;
    } else {
      fileNameEl.textContent = "No file chosen";
    }
  });
}



// close helpers
function hideMiniProfile() {
  const modal = document.getElementById('miniProfileModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
}

document.getElementById('mpClose')?.addEventListener('click', hideMiniProfile);

document
  .querySelector('#miniProfileModal .al-modal__backdrop')
  ?.addEventListener('click', hideMiniProfile);

// LIKE button wiring (real backend)
document.getElementById('mpLikeBtn')?.addEventListener('click', async () => {
  const btn   = document.getElementById('mpLikeBtn');
  const email = btn?.dataset.targetEmail;
  if (!email) return;

  try {
    const res = await authFetch(
      `${API_BASE}/api/profile/card/like?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
    if (!res.ok) throw new Error('Like failed');
    const data = await res.json();

    const likeCountEl = document.getElementById('mpLikeCount');
    if (likeCountEl) likeCountEl.textContent = `${data.likes ?? 0} likes`;

    btn.textContent = data.likedByMe ? '💔 Unlike' : '❤️ Like';
  } catch (e) {
    console.error(e);
    alert('Failed to update like');
  }
});

// simple fallback report handler (agar kahin aur define nahi hai)
if (typeof window.openReportModal !== 'function') {
  window.openReportModal = function (userId, name) {
    const reason = prompt(`Why do you want to report ${name || userId || 'this user'}?`);
    if (!reason) return;
    alert('Report submitted (demo): ' + reason);
    console.log('Report sent:', { userId, name, reason });
  };
}
// // Open Q&A drawer
qaToggle?.addEventListener('click', async () => {
  document.body.classList.add('qa-open');
  document.getElementById('qaPanel')?.classList.add('open');
  // modal/composer should not be visible when just opening the drawer
  document.getElementById('qaViewModal')?.setAttribute('hidden','');
  document.getElementById('qaComposer')?.setAttribute('hidden','');
  await qaLoadList();
});

function openReportModal(userId, userName) {
  if (!userId) return;
  currentProfileUserId = userId;
  document.getElementById('reportUserName').textContent =
    `Reporting: ${userName || 'this user'}`;
  document.getElementById('reportText').value = '';
  document.getElementById('reportFile').value = '';

  reportModal.style.display = 'block';
  requestAnimationFrame(() => reportModal.classList.add('show'));
}

function closeReportModal() {
  if (!reportModal) return;
  reportModal.classList.remove('show');
  setTimeout(() => {
    reportModal.style.display = 'none';
  }, 150);
}

function closeReportModal() {
  reportModal.style.display = 'none';
}

document.getElementById('reportClose')?.addEventListener('click', closeReportModal);
document.getElementById('reportCancel')?.addEventListener('click', closeReportModal);

document.getElementById('reportSend')?.addEventListener('click', async () => {
  const text = document.getElementById('reportText').value.trim();
  const file = document.getElementById('reportFile').files[0];

  if (!text && !file) {
    alert('Please add description or screenshot.');
    return;
  }

  const fd = new FormData();
  fd.append('reportedUserId', currentProfileUserId);
  fd.append('description', text);
  if (file) fd.append('screenshot', file);

  try {
    const res = await authFetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) throw new Error(await res.text());
    alert('Report submitted. Our team will review it.');
    closeReportModal();
  } catch (e) {
    console.error(e);
    alert('Could not submit report.');
  }
});
// Close Q&A drawer
qaClose?.addEventListener('click', () => {
  document.body.classList.remove('qa-open');
  document.getElementById('qaPanel')?.classList.remove('open');
  document.getElementById('qaViewModal')?.setAttribute('hidden','');
  document.getElementById('qaComposer')?.setAttribute('hidden','');
});
  // Ask a question
qaAskBtn?.addEventListener('click', async () => {
  const title = (qaTitleIn.value || '').trim();
  const body  = (qaBodyIn.value  || '').trim();
  const max   = parseInt(qaMaxIn.value || '3', 10) || 3;
  const file  = document.getElementById('qaImage')?.files?.[0] || null;

const viewer = (window.DISPLAY_NAME || '').trim();
if (!viewer) {
  window.changeQaUser?.();
  await showNiceAlert('Set your name first (Edit name).', { title: 'No name', icon: '🪪' });
  return;
}
  if (!title) {
    await showNiceAlert('Please add a short, descriptive title.', {
      title: 'Missing title',
      icon: '📝'
    });
    qaTitleIn.classList.add('al-input-error');
    qaTitleIn.focus();
    setTimeout(() => qaTitleIn.classList.remove('al-input-error'), 800);
    return;
  }

  const fd = new FormData();
  fd.append('title', title);
  fd.append('body', body);
  fd.append('maxClaimers', String(max));
  fd.append('room', currentRoom || 'default');
  if (file) fd.append('image', file);

  try {
    const r = await authFetch(`${API_BASE_QA}/api/questions`, {
      method: 'POST',
     headers: {
  'X-User-Name': window.DISPLAY_NAME || '',
  'X-User-Email': window.USER_EMAIL || '',
  'X-User': window.DISPLAY_NAME || '' 
},
      body: fd
    });

    if (r.ok) {
      const q = await r.json();
  
      // Clear fields
      // Clear fields
      qaTitleIn.value = '';
      qaBodyIn.value  = '';
      qaMaxIn.value   = '3';
      const qaImgEl = document.getElementById('qaImage');
      if (qaImgEl) qaImgEl.value = '';

      // 🔥 PRIVATE ROOM OPEN RIGHT AWAY (asker)
      if (typeof openDoubtRoomForQuestion === 'function') {
        openDoubtRoomForQuestion(q);
      }

      // 🔥 SIDEBAR REFRESH IMMEDIATELY
      if (typeof window.refreshRooms === 'function') {
        window.refreshRooms();
      }

  // Reload Q&A list
  await qaLoadList();

  // 🔔 Asker ko clearly batao ki private room ban chuka hai
  await showNiceAlert(
    'We’ve created a private doubt room for this question and moved you there.\n\n' +
    'Only you and approved solvers can see this room. You can switch back to other ' +
    'study groups anytime using the sidebar on the left.',
    {
      title: 'Private doubt room created',
      icon: '💬'
    }
  );
  } else {
      await showNiceAlert(await r.text(), {
        title: 'Could not post',
        icon: '⚠️'
      });
    }
  } catch (err) {
    console.error(err);
    await showNiceAlert('Network error — please try again later.', {
      title: 'Error',
      icon: '🌐'
    });
  }
});

  function attachPreviewHandlers(){
    document.querySelectorAll('[data-previewable]').forEach(img => {
      img.onclick = () => showImageLightbox(img.src);
    });
  }
  function showImageLightbox(src){
    let overlay = document.getElementById('imgLightbox');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'imgLightbox';
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,.85);
        display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;
      `;
      overlay.innerHTML = `
        <img id="imgLightboxImg" style="max-width:95vw;max-height:90vh;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5)">
        <button id="imgLightboxClose" style="position:absolute;top:16px;right:16px;background:#111827;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;">✕</button>
      `;
      overlay.addEventListener('click', e => {
        if (e.target.id === 'imgLightbox' || e.target.id === 'imgLightboxClose') overlay.remove();
      });
      document.body.appendChild(overlay);
    }
    overlay.querySelector('#imgLightboxImg').src = src;
  }


function slotsOpen(q){
  const statusOpen = (q.status || 'OPEN') === 'OPEN';
  const max = (q.maxClaimers ?? 0);
  const used = (q.claimedCount ?? 0);
  const unlimited = !max || max <= 0;
  return statusOpen && (unlimited || used < max);
}

async function qaClaim(qid){
  // adjust to your API if it expects body instead of query
  const url = `${API_BASE_QA}/api/questions/${qid}/claim?user=${identityParam()}`;
  const r = await authFetch(url, { method: 'POST' });
  if (!r.ok){
    const msg = (await r.text()).trim() || 'Claim failed.';
    alert(msg);
    return false;
  }
  alert('You claimed this question successfully. Now you can answer.');
  // refresh modal and list so composer shows and counts update
  qaOpen(qid);
  qaLoadList();
  return true;
}



async function qaRenderVisibilityAndBar({ q, amAsker, amClaimer }) {
  const qid = q.id || window._currentQid;
  const claimBtn = QE('#qaClaimBtn');
  const claimMsg = QE('#qaClaimMsg');
  if (!claimBtn || !claimMsg) return;

  const claimedCount = Number(q.claimedCount ?? 0);
  const max = Number(q.maxClaimers ?? 3);
  const full = claimedCount >= max;
  const status = String(q.status || 'OPEN').trim().toUpperCase();
  const isResolved = status === 'RESOLVED';
  const allowExplainAi = isResolved && !isAsker(q) && !isClaimerOnList(q);
  const isLockedOrResolved = status === 'LOCKED' || isResolved;

  // Askers don’t need the claim button
  if (amAsker) {
    claimBtn.style.display = 'none';
    claimMsg.textContent = isLockedOrResolved ? 'Question is locked' : '';
  } else {
    claimBtn.style.display = '';
    if (isResolved) {
      claimBtn.style.display = 'none';
      claimMsg.textContent = 'This doubt is resolved';
      setComposerVisible(false);
      return;
    }
    if (isLockedOrResolved) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Locked';
      claimMsg.textContent = 'Question is locked';
    } else if (full && !amClaimer) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Claim full';
      claimMsg.textContent = `Claimed: ${claimedCount} / ${max}`;
    } else if (amClaimer) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'You claimed';
      claimMsg.textContent = `Claimed: ${claimedCount} / ${max}`;
    } else {
      claimBtn.disabled = false;
      claimBtn.textContent = 'Claim';
      claimMsg.textContent = `Claimed: ${claimedCount} / ${max}`;
      claimBtn.onclick = async () => {
        const r = await authFetch(`${API_BASE_QA}/api/questions/${qid}/claim`, { method: 'POST' });
        if (!r.ok) {
          alert(await r.text());
          return;
        }
      
        const updated = await r.json();
      
        // 🔥 Solver ko guided popup
        try {
          if (typeof showConfirmModal === 'function' && typeof openDoubtRoomForQuestion === 'function') {
            const ok = await showConfirmModal({
              title: 'Move to private doubt room?',
              body: (
                'You have been added as a solver for this doubt. ' +
                'Join the private room to coordinate with the asker, clarify the problem, ' +
                'and share your final solution. You can switch back to any other group ' +
                'from the sidebar at any time.'
              ),
              okText: 'Join room',
              cancelText: 'Maybe later',
              variant: 'default'
            });
      
            if (ok) {
              openDoubtRoomForQuestion(updated);
            }
          } else if (typeof openDoubtRoomForQuestion === 'function') {
            // fallback: directly open room
            openDoubtRoomForQuestion(updated);
          }
        } catch (e) {
          console.warn('[qa] error while handling claim popup', e);
        }
      
        // UI state update
        await qaRenderVisibilityAndBar({ q: updated, amAsker, amClaimer: true });
        await qaLoadAnswers(qid, updated);
      
        // 🔄 sidebar refresh
        if (typeof window.refreshRooms === 'function') {
          window.refreshRooms();
        }
      };
    }
  }

  // Composer visibility: only for claimers & not locked
  setComposerVisible(false); // ⛔ answers are posted in private doubt-room, not here
}

// -------- List --------
async function qaLoadList(){
  const list = QE('#qaListNew') || QE('#qaList');
if(!list) return;
  list.innerHTML = '<div style="opacity:.7">Loading…</div>';
const room = currentRoom || 'default'; // ✅ use your active group variable
const r = await authFetch(`${API_BASE_QA}/api/questions?room=${encodeURIComponent(room)}`);
  const items = r.ok ? await r.json() : [];
  list.innerHTML = '';
  if (!items.length){ list.innerHTML = '<div style="opacity:.7">No questions yet.</div>'; return; }
  for (const q of items) list.appendChild(qaCard(q));
}

function isClaimerOnList(q){
  // Best-effort: different DTOs may use different flags
  return !!(
    q._amClaimer || q.amClaimer || q.isClaimer || q.claimer ||
    q.claimedByMe || q.myClaim || q.meClaimer ||
    // if accepted answer author info exists, treat as solver
    (q.acceptedByEmail && (String(q.acceptedByEmail).trim().toLowerCase() === String((window.USER_EMAIL||'')).trim().toLowerCase()))
  );
}

function qaCard(q){

  // Show "Explain with AI" only for RESOLVED posts and only to users who are
  // neither the asker nor the claimer/solver.
  // NOTE: backend/status sometimes arrives with accidental spaces; trim before compare.
  const isResolved = String(q?.status || '').trim().toUpperCase() === 'RESOLVED';
  const allowExplainAi = isResolved && !isAsker(q) && !isClaimerOnList(q);

  const card = document.createElement('div');
  card.className = 'qa-card';
  const img = q.imageUrl ? `<div class="meta" style="opacity:.75">📎 attachment</div>` : '';
  card.innerHTML = `
    <h5>${escapeHtml(q.title || 'Untitled')}</h5>
    <div class="meta">Status: ${q.status || 'OPEN'} · Claimed: ${(q.claimedCount ?? 0)} / ${(q.maxClaimers ?? 0)}</div>
    ${img}
    <div class="row">
      <button class="primary" data-act="open">Open</button>
      ${allowExplainAi ? '<button class="ghost" data-act="ai">Explain with AI</button>' : ''}
      ${isAsker(q) ? '<button class="ghost" data-act="delete">Delete</button>' : ''}
    </div>
  `;
  card.querySelector('[data-act="open"]').onclick = () => qaOpen(q.id);

  const aiBtn = card.querySelector('[data-act="ai"]');
  if (aiBtn) aiBtn.onclick = () => openAiExplainForQuestion(q.id, q.title);

  const del = card.querySelector('[data-act="delete"]');
  if (del) del.onclick = async () => {
   const ok = await showConfirmModal({
  title: 'Delete answer',
  body: 'This will delete your answer for everyone.',
  okText: 'Delete',
  cancelText: 'Cancel',
  variant: 'danger'
});
if (!ok) return;
    const r = await authFetch(`${API_BASE_QA}/api/questions/${q.id}`, { method:'DELETE' });
    if (!r.ok) return alert('Delete failed.');
    qaLoadList();
  };
  return card;
}

// ✅ Explain with AI for RESOLVED doubt-room questions (uses /api/aiqa/explain)
async function openAiExplainForQuestion(questionId, title){
  try {
    // Our AI modal is injected on demand and is shown via style.display.
    // Do NOT rely on a global `aiModal` variable or class-based toggles.
    const modal = ensureAiModal();
    if (modal) modal.style.display = 'flex';

    const chat = document.getElementById('aiChat');
    // This modal template doesn't use aiHint; keep code defensive.
    const hint = document.getElementById('aiHint');
    if (hint) hint.style.display = 'none';
    if (chat) chat.innerHTML = `<div class="ai-msg ai"><div class="bubble">Generating AI explanation…</div></div>`;

    const r = await authFetch(`${API_BASE_QA}/api/aiqa/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId })
    });

    const text = await r.text();
    if (!r.ok) {
      if (chat) chat.innerHTML = `<div class="ai-msg ai"><div class="bubble">Failed to generate AI explanation. ${escapeHtml(text || '')}</div></div>`;
      return;
    }

    let data;
    try { data = JSON.parse(text); } catch { data = { explanation: text }; }

    const exp = (data && data.explanation) ? String(data.explanation) : '';
    const head = title ? `**${String(title)}**\n\n` : '';
    const finalText = head + exp;

    // Render attachments inline (hide raw link). Supports emoji prefix like "🖼 Attachment:".
    if (chat) {
      chat.innerHTML = `<div class="ai-msg ai"><div class="bubble">${renderAiqaTextWithAttachment(finalText)}</div></div>`;
      chat.scrollTop = chat.scrollHeight;
    }

    // Follow-up chat is not supported for AIQA one-shot explain.
    // Show a friendly popup if user tries to type/send.
    const inputEl = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSend');
    if (inputEl) {
      inputEl.placeholder = 'Follow-up chat (coming soon)…';
      inputEl.addEventListener('input', aiqaComingSoonOnce);
      inputEl.addEventListener('focus', aiqaComingSoonOnce);
    }
    if (sendBtn) {
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        aiqaComingSoonOnce();
      });
    }
  } catch (e) {
    console.error('openAiExplainForQuestion error', e);
    const chat = document.getElementById('aiChat');
    if (chat) chat.innerHTML = `<div class="ai-msg ai"><div class="bubble">Failed to generate AI explanation.</div></div>`;
  }
}

// AIQA helper: render "Attachment: <url>" as inline preview and hide the raw link.
function renderAiqaTextWithAttachment(text) {
  const s = String(text || '');
  // Match: optional emoji + spaces + Attachment: URL
  const re = /(?:^|\n)\s*(?:[\u{1F4CE}\u{1F5BC}]\s*)?Attachment:\s*(https?:\/\/\S+)/u;
  const m = s.match(re);
  let body = s;
  let url = null;
  if (m && m[1]) {
    url = m[1].trim();
    body = s.replace(re, '');
  }

  const htmlBody = renderMdSafe(body.trim());
  if (!url) return htmlBody;

  const safeUrl = escapeHtml(url);
  const lower = url.toLowerCase();
  const isSvg = lower.endsWith('.svg');
  const isImg = isSvg || /\.(png|jpg|jpeg|gif|webp)$/i.test(lower);
  if (!isImg) return htmlBody;

  // clickable preview (no raw URL text)
  const preview = isSvg
    ? `<a href="${safeUrl}" target="_blank" rel="noreferrer" style="display:block; margin:10px 0; text-decoration:none">
         <object data="${safeUrl}" type="image/svg+xml" style="width:100%; max-height:320px; border-radius:12px; background:rgba(255,255,255,.04)"></object>
       </a>`
    : `<a href="${safeUrl}" target="_blank" rel="noreferrer" style="display:block; margin:10px 0; text-decoration:none">
         <img src="${safeUrl}" alt="attachment" style="width:100%; max-height:320px; object-fit:contain; border-radius:12px; background:rgba(255,255,255,.04)" />
       </a>`;

  return preview + htmlBody;
}

let __aiqaComingSoonShown = false;
function aiqaComingSoonOnce() {
  if (__aiqaComingSoonShown) return;
  __aiqaComingSoonShown = true;
  alert('Follow-up chat feature is coming soon.\n\nRight now AI gives one-time explanation based on the accepted answer.');
  setTimeout(() => { __aiqaComingSoonShown = false; }, 2000);
}

// very small markdown-ish renderer (keeps it safe)
function renderMdSafe(s){
  const esc = escapeHtml(String(s || ''));
  // basic bold **text** and newlines
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// -------- Detail --------
const vClose = document.getElementById('qaVClose');
if (vClose) vClose.onclick = () => {
  const m = document.getElementById('qaViewModal');
  if (m) m.hidden = true;
};

async function qaGetAcceptedAnswer(qid) {
  // fetch answers list
  const r = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`);
  if (!r.ok) return null;
  const answers = await r.json();
  if (!Array.isArray(answers) || answers.length === 0) return null;

  // look for accepted flag by common shapes
  // supports: {accepted:true} OR {isAccepted:true} OR {status:'ACCEPTED'}
  const accepted = answers.find(a =>
    a.accepted === true || a.isAccepted === true || String(a.status).toUpperCase() === 'ACCEPTED'
  );
  return accepted || null;
}

async function qaShareToChat(qid, q) {
  // Try to attach the accepted solution
  const accepted = await qaGetAcceptedAnswer(qid);

  // Build a simple rich text block
  const title = q.title || 'Question';
  const by = q.askedByName || q.askedByEmail || q.askedBy || 'unknown';
  const img = q.imageUrl ? (q.imageUrl.startsWith('http') ? q.imageUrl : `${API_BASE_QA}${q.imageUrl}`) : null;

  let msg = `**Q:** ${title}\n`;
  if (q.body) msg += `${q.body}\n`;
  msg += `*asked by ${by}*\n`;
  if (accepted) {
    msg += `\n**Accepted Answer:**\n${accepted.body || '(no text)'}\n`;
  }

  // Optional: include attachment link(s)
  if (img) msg += `\n(attachment) ${img}`;

  // Try sending through your existing chat send API; fall back to pasting
  try {
    // If you already have a function that sends chat messages, call it here:
    // await sendChatMessage(msg); // <-- replace with your actual function if present

    // Fallback: insert into the chat input if available and focus it,
    // so user can just press Enter.
    const input = document.querySelector('#message-input, #chatInput, textarea[name="message"], .chat-input');
    if (input) {
      input.value = msg;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      alert('Prepared message in chat box. Review and send.');
    } else {
      await navigator.clipboard.writeText(msg);
      alert('Copied to clipboard. Paste into chat to share.');
    }
  } catch (e) {
    console.warn('share fallback', e);
    await navigator.clipboard.writeText(msg);
    alert('Copied to clipboard. Paste into chat to share.');
  }
}


function setComposerVisible(visible) {
  const c = QE('#qaComposer');
  if (c) c.hidden = !visible;
}





async function qaOpen(qid){
  try { window.__qaOpenQuestionId = id; } catch {}

  const modal = document.getElementById('qaViewModal');
  if (!modal) { console.error('Missing #qaViewModal in chat.html'); alert('Internal error'); return; }

  // 1) Load question
  const r = await authFetch(`${API_BASE_QA}/api/questions/${qid}`);
  if (!r.ok){ alert('Failed to load.'); return; }
  const q = await r.json();
  window._currentQid = qid;
  window._currentQ   = q;

  // 2) Who am I?
  const myEmail = (window.USER_EMAIL || window.QA_EMAIL || '').trim();
  const myName  = (window.DISPLAY_NAME || window.QA_USER  || '').trim();

  // 3) Am I the asker?
  const askedByEmail = (q.askedByEmail || q.userEmail || '').trim().toLowerCase();
  const askedByName  = (q.askedBy || q.askedByRaw || '').trim().toLowerCase();
// ---- Robust Asker Check (handles askedByEmail missing)
const askedByRaw = (q.askedByEmail || q.userEmail || q.askedBy || '').trim().toLowerCase();
const amAsker = !!askedByRaw && (
  askedByRaw === myEmail.trim().toLowerCase() ||
  askedByRaw === myName.trim().toLowerCase()
);

  // 4) Am I a claimer?  (compute ONCE)
  let amClaimer = false;
  try {
    const who = encodeURIComponent((myEmail || myName).trim());
    const r2  = await authFetch(`${API_BASE_QA}/api/questions/${qid}/am-i-claimer?user=${who}`);
    if (r2.ok) {
      const j = await r2.json();
      amClaimer = !!(j && (j.claimer || j.isClaimer));
    }
  } catch {}

  // make flags available to the answers renderer
q._amAsker = !!amAsker;
q._locked  = String(q.status || '').toUpperCase() === 'LOCKED';

function renderAskerActions(qid, q, amAsker) {
  const bar = QE('#qaFooterLeft') || QE('#qaFooter'); // wherever you want the buttons
  if (!bar) return;

  // remove old buttons (avoid duplicates)
  bar.querySelectorAll('.qa-asker-btn').forEach(el => el.remove());

  if (!amAsker) return;

  // Share to chat
// inside renderAskerActions(qid, q, amAsker)
const shareBtn = document.createElement('button');
shareBtn.className = 'qa-asker-btn qa-chip';
shareBtn.textContent = 'Share to chat';

shareBtn.onclick = async () => {
  // If there’s an accepted answer, share that; otherwise share the question
  const acc = await qaGetAcceptedAnswer(qid);
  if (acc) {
    await qaShareAccepted(qid, q);   // sends an HTML card via WS + local echo
  } else {
    qaShareQuestion(q);               // sends a “Question” HTML card
  }
};
bar.appendChild(shareBtn);

  // Delete question
  const delQBtn = document.createElement('button');
  delQBtn.className = 'qa-asker-btn qa-chip qa-chip--danger';
  delQBtn.textContent = 'Delete question';
  delQBtn.onclick = async () => {
    const ok = await showConfirmModal({
      title: 'Delete this question?',
      body:  'All claims and answers will be deleted. This cannot be undone.',
      okText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!ok) return;

    const resp = await authFetch(`${API_BASE_QA}/api/questions/${qid}`, { method: 'DELETE' });
    if (!resp.ok) { alert(await resp.text()); return; }

    // close modal and refresh the list
    const modal = document.getElementById('qaViewModal');
    if (modal) modal.hidden = true;
    qaLoadList && qaLoadList();
  };
  bar.appendChild(delQBtn);
}

// …in qaOpen, AFTER you compute amAsker & amClaimer and set _currentQid/_currentQ:
renderAskerActions(qid, q, amAsker);

//   const status = String(q.status || 'OPEN').toUpperCase();
// setComposerVisible(amClaimer && status !== 'LOCKED');
//   wireAnswerComposerOnce(
//   () => window._currentQid,
//   () => window._currentQ
// );
  await qaRenderVisibilityAndBar({ q, amAsker, amClaimer });

  // 5) Header/meta
  QE('#qaVTitle').textContent = q.title || 'Untitled';
  QE('#qaVBody').textContent  = q.body  || '';
  const askedByShow = (q.askedByName || q.askedBy || q.askedByRaw || q.askedByEmail || '') || 'unknown';
  QE('#qaVMeta').textContent =
    `Status: ${q.status || 'OPEN'} · Claimed: ${(q.claimedCount ?? 0)} / ${(q.maxClaimers ?? 0)} · asked by ${askedByShow}`;

  // image (optional)
  const wrap = QE('#qaVImageWrap'), im = QE('#qaVImage');
  if (q.imageUrl){
    wrap.hidden = false;
    im.src = q.imageUrl.startsWith('http') ? q.imageUrl : `${API_BASE_QA}${q.imageUrl}`;
  } else {
    wrap.hidden = true;
  }

  // 6) Show/Hide composer (only claimers & not locked)
  const locked = String(q.status || '').toUpperCase() === 'LOCKED';
  setComposerVisible(false);

  // 7) Bottom bar (claim/asker). Make sure your helper accepts this shape.
  if (typeof qaRenderVisibilityAndBar === 'function') {
    await qaRenderVisibilityAndBar({ q, amAsker, amClaimer });
  }

  // 8) Load answers (pass amClaimer if your loader needs it)
  
  await qaLoadAnswers(qid, q, amClaimer);

  // 9) Wire composer send ONCE (image or text)
  const composer = QE('#qaComposer');
  const inputEl  = QE('#qaAInput');
  const fileEl   = QE('#qaAImage');
  const sendBtn  = QE('#qaASend');

  if (sendBtn && !sendBtn._wired) {
    sendBtn._wired = true;
const nameEl = QE('#qaAName');

if (fileEl && !fileEl._wiredName) {
  fileEl._wiredName = true;
  fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    nameEl.textContent = f ? f.name : 'No file chosen';
  });
}
    sendBtn.addEventListener('click', async (e) => {
      e.preventDefault();
  e.stopPropagation();
      if (composer?.hidden) return;
      const text = (inputEl?.value || '').trim();
      const file = fileEl?.files && fileEl.files[0];
      if (!text && !file) return;

      let resp;
if (file) {
  const fd = new FormData();
  if (text) fd.append('text', text);
  fd.append('image', file);
  fd.append('room', currentRoom || 'default'); // ✅ Add this line
  resp = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`, { method: 'POST', body: fd });
} else {
  resp = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, room: currentRoom || 'default' }) // ✅ Add room here too
  });
}
      if (!resp.ok) { alert(await resp.text()); return; }
      if (inputEl) inputEl.value = '';
      if (fileEl)  fileEl.value  = '';
      await qaLoadAnswers(qid, q, amClaimer);
    });

    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });
  }

  modal.hidden = false;
}


function customConfirm(message = 'Are you sure?') {
  return new Promise((resolve) => {
    const modal = QE('#confirmModal');
    if (!modal) return resolve(false);
    modal.style.display = 'flex';
    modal.querySelector('h3').textContent = message;

    const yes = QE('#confirmYes');
    const no = QE('#confirmNo');

    const close = (val) => {
      modal.style.display = 'none';
      yes.onclick = no.onclick = null;
      resolve(val);
    };

    yes.onclick = () => close(true);
    no.onclick = () => close(false);
  });
}



function htmlBtn(txt, cls){ const b=document.createElement('button'); b.className=cls; b.textContent=txt; return b; }

function qaShareQuestion(q){
  const msg = 'HTML|' + buildQuestionCard({ q, apiBase: API_BASE_QA });
const ts    = Date.now();
const name  = window.DISPLAY_NAME || 'Anonymous';
const email = window.USER_EMAIL   || '';

addMessageToList({
  id:null, user: name, userName: name, userEmail: email,
  text: msg, ts, mine:true, deleted:false, editedAt:null, reply:null, clientId: CLIENT_ID
});

if (ws && ws.readyState === 1){
  wsSend({
    type:'message',
     room: currentRoom,
      text: msg,
    user: name,
     userName: name,
      userEmail: email,
    ts,
     clientId: CLIENT_ID
  });
}
}

async function qaShareAccepted(qid, q){
  // load answers
  const r = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`);
  if (!r.ok) return;
  const answers = await r.json();

  // find accepted: by id or common flags
  const acc = answers.find(a =>
    (q.acceptedAnswerId && a.id === q.acceptedAnswerId) ||
    a.accepted === true || a.isAccepted === true || String(a.status||'').toUpperCase() === 'ACCEPTED'
  );
  if (!acc) { alert('No accepted answer yet.'); return; }

  // build HTML card payload
  const msg = 'HTML|' + buildAcceptedAnswerCard({ q, a: acc, apiBase: API_BASE_QA });

  // real identity
  const ts    = Date.now();
  const name  = window.DISPLAY_NAME || 'Anonymous';
  const email = window.USER_EMAIL   || '';

  // local echo
  addMessageToList({
    id:null, user:name, userName:name, userEmail:email,
    text:msg, ts, mine:true, deleted:false, editedAt:null, reply:null, clientId:CLIENT_ID
  });

  // send via WS
  if (ws && ws.readyState === 1){
    wsSend({
      type:'message', room: currentRoom, text: msg,
      user:name, userName:name, userEmail:email,
      ts, clientId: CLIENT_ID
    });
  }
}

// -------- Answers (review + delete own) --------
async function qaLoadAnswers(qid, q) {
  const list = QE('#qaAnsList');
  if (!list) return;
const iAmAsker = isAskerOf(q);
  list.innerHTML = '<div style="opacity:.6">Loading…</div>';

  const r = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`);
  if (!r.ok) {
    list.innerHTML = '<div style="opacity:.7">Failed to load answers.</div>';
    return;
  }
  const answers = await r.json();
  list.innerHTML = '';

  const meEmail = (window.USER_EMAIL || '').toLowerCase();
  const meName  = (window.DISPLAY_NAME || '').toLowerCase();

  const status   = String(q.status || 'OPEN').trim().toUpperCase();
  const locked   = status === 'LOCKED';
  const resolved = status === 'RESOLVED';

  // ✅ If viewer is NOT the asker, don't show accepted solution on RESOLVED posts (use Explain with AI instead)
  if (!iAmAsker && resolved) {
    list.innerHTML = '<div style="opacity:.8;padding:12px;border-radius:10px;background:#0f2136;">This doubt is resolved. Use <b>Explain with AI</b> to view explanation.</div>';
    return;
  }
  const amAsker  = (q.askedByEmail || '').toLowerCase()
                    ? (q.askedByEmail || '').toLowerCase() === meEmail
                    : (q.askedBy || '').toLowerCase() === meName;

for (const a of answers) {
  const meEmail = (window.USER_EMAIL || '').toLowerCase();
  const meName  = (window.DISPLAY_NAME || '').toLowerCase();

  const authorEmail = (a.authorEmail || '').toLowerCase();
  const authorLower = (a.author || '').toLowerCase();

  const mine = (authorEmail && authorEmail === meEmail) ||
               authorLower === meEmail ||
               authorLower === meName;

  const accepted = !!q.acceptedAnswerId && q.acceptedAnswerId === a.id;
  const locked   = String(q.status || '').toUpperCase() === 'LOCKED';
  const authorStr = a.author || a.authorEmail || 'anon';

  const card = document.createElement('div');
  card.className = 'qa-ans';
  card.style.cssText = 'padding:10px;border-radius:10px;background:#0f2136;margin-bottom:10px;color:#e6eef9;';

  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="font-weight:600">
        ${escapeHtml(authorStr)}
        ${accepted ? '<span class="qa-badge">Accepted</span>' : ''}
      </div>
      <div class="qa-ans-actions" style="display:flex;gap:8px"></div>
    </div>
    ${a.imageUrl ? `<div style="margin-top:8px"><img src="${a.imageUrl}" style="max-width:100%;border-radius:8px"/></div>` : ''}
    ${a.body ? `<div style="white-space:pre-wrap;margin-top:8px">${escapeHtml(a.body)}</div>` : ''}
  `;

  const actions = card.querySelector('.qa-ans-actions');



//   const locked   = String(q.status || '').toUpperCase() === 'LOCKED';
// const accepted = !!q.acceptedAnswerId && q.acceptedAnswerId === a.id;

// ASKER-only ACCEPT (visible when OPEN and this answer not accepted yet)
if (iAmAsker && !locked && !accepted) {
  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'qa-chip qa-chip--success';
  acceptBtn.textContent = 'Accept';
  acceptBtn.onclick = async () => {
    const resp = await authFetch(`${API_BASE_QA}/api/questions/answers/${a.id}/accept`, {
      method: 'PATCH'
    });
    if (!resp.ok) { alert(await resp.text()); return; }

    // lock UI immediately
    q.status = 'LOCKED';
    q.acceptedAnswerId = a.id;
    setComposerVisible(false);
    const claimBtn = QE('#qaClaimBtn');
    if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'Locked'; }

    await qaLoadAnswers(qid, q);
  };
  actions.appendChild(acceptBtn);
}
  // ACCEPT (asker only, when not locked/accepted)
  if (!locked && !accepted && (
      (q.askedByEmail || '').toLowerCase() === meEmail ||
      (q.askedBy || '').toLowerCase() === meName
  )) {
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'qa-chip qa-chip--success';
    acceptBtn.textContent = 'Accept';
    acceptBtn.onclick = async () => {
      const ok = await showConfirmModal({
        title: 'Accept this solution?',
        body: 'After accepting, the question locks and no more solutions can be posted.',
        okText: 'Accept', cancelText: 'Cancel'
      });
      if (!ok) return;
      const resp = await authFetch(`${API_BASE_QA}/api/questions/answers/${a.id}/accept`, { method: 'PATCH' });
      if (!resp.ok) { alert(await resp.text()); return; }
      q.status = 'LOCKED'; q.acceptedAnswerId = a.id;
      setComposerVisible(false);
      QE('#qaClaimBtn')?.setAttribute('disabled','');
      if (QE('#qaClaimBtn')) QE('#qaClaimBtn').textContent = 'Locked';
      const msg = QE('#qaClaimMsg'); if (msg) msg.textContent = 'Question is locked';
      await qaLoadAnswers(qid, q);
    };
    actions.appendChild(acceptBtn);
  }

  // DELETE (author only, not if accepted)
  if (mine && !accepted) {
    const delBtn = document.createElement('button');
    delBtn.className = 'qa-chip qa-chip--danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      const ok = await showConfirmModal({
        title: 'Delete your answer?',
        body: 'This will permanently remove your solution.',
        okText: 'Delete', cancelText: 'Cancel', variant: 'danger'
      });
      if (!ok) return;
      const resp = await authFetch(`${API_BASE_QA}/api/questions/answers/${a.id}`, { method: 'DELETE' });
      if (!resp.ok) { alert(await resp.text()); return; }
      await qaLoadAnswers(qid, q);
    };
    actions.appendChild(delBtn);
  }

  list.appendChild(card);
}
}


function setComposerVisible(visible) {
  const c = QE('#qaComposer');
  if (c) c.hidden = !visible;
}






// Build the composer card (image + text + submit)
function buildComposerCard(qid) {
  const card = document.createElement('div');
  card.className = 'qa-card qa-card--composer';

  const media = document.createElement('div');
  media.className = 'qa-card__media';
  media.innerHTML = `
    <div style="display:grid;place-items:center;width:100%;height:100%;background:#fff;">
      <input id="qaSolFile" type="file" accept="image/*">
      <div id="qaSolPreview" style="margin-top:6px;max-width:100%;"></div>
    </div>
  `;

  const compose = document.createElement('div');
  compose.className = 'qa-compose';
  compose.innerHTML = `
    <textarea id="qaSolText" placeholder="Write your answer..."></textarea>
    <button id="qaSolSend" class="btn btn-primary">Submit</button>
  `;

  // preview logic
  const fileEl = media.querySelector('#qaSolFile');
  const preview = media.querySelector('#qaSolPreview');
  fileEl.addEventListener('change', () => {
    preview.innerHTML = '';
    const f = fileEl.files?.[0];
    if (!f) return;
    const img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '200px';
    img.src = URL.createObjectURL(f);
    preview.appendChild(img);
  });

  // send logic (multipart if file chosen, else JSON)
  compose.querySelector('#qaSolSend').addEventListener('click', async () => {
    const txt = (compose.querySelector('#qaSolText').value || '').trim();
    const file = fileEl.files?.[0];

    if (!txt && !file) { alert('Add text or an image.'); return; }

    let resp;
if (file) {
  const fd = new FormData();
  fd.append('text', txt);
  fd.append('image', file);
  fd.append('room', currentRoom || 'default'); // ✅ add group info
  resp = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`, {
    method: 'POST',
    body: fd
  });
} else {
  resp = await authFetch(`${API_BASE_QA}/api/questions/${qid}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: txt, room: currentRoom || 'default' }) // ✅ add group info
  });
}

    if (!resp.ok) { alert(await resp.text()); return; }
    // reset fields
    compose.querySelector('#qaSolText').value = '';
    fileEl.value = '';
    preview.innerHTML = '';
    // reload
    const qFull = await (await authFetch(`${API_BASE_QA}/api/questions/${qid}`)).json();
    qaLoadAnswers(qid, qFull);
  });

  card.appendChild(media);
  card.appendChild(compose);
  return card;
}


function enhanceCodeBlocks(container) {
  const textNodes = container.querySelectorAll('div, p');
  textNodes.forEach(node => {
    if (node.innerHTML.includes('```')) {
      node.innerHTML = node.innerHTML.replace(
        /```([\s\S]*?)```/g,
        '<pre><code>$1</code></pre>'
      );
    }
  });
}




  /* ---------- Chat features (pins, messages, etc.) ---------- */
  function renderMessageText(raw){
    if (!raw) return '';
    // ✅ Solution marker: SOL|<answerId>|IMG|<url> or SOL|<answerId>|TXT|<text>
    if (typeof raw === 'string' && raw.startsWith('SOL|')) {
      const parts = raw.split('|');
      const answerId = parts[1] ? parts[1].trim() : '';
      const kind = (parts[2] || '').trim().toUpperCase();
      const rest = parts.slice(3).join('|').trim();
      const safeAid = String(answerId || '').replace(/[^0-9]/g,'');
      if (kind === 'IMG') {
        const safe = encodeURI(rest);
        return `
          <div class="solution-wrap" data-answer-id="${safeAid}">
            <div class="solution-tag">Solution</div>
            <a class="img-bubble" href="${safe}" target="_blank" rel="noopener">
              <img class="chat-img" src="${safe}" alt="solution" style="max-width:260px;max-height:260px;border-radius:12px;display:block;"/>
            </a>
          </div>
        `;
      }
      // TXT or fallback
      return `
        <div class="solution-wrap" data-answer-id="${safeAid}">
          <div class="solution-tag">Solution</div>
          <div class="solution-text">${escapeHTML(rest)}</div>
        </div>
      `;
    }
if (raw.startsWith('AUDIO|')) {
    const url = raw.slice(6).trim();
    const id  = 'ab_' + Math.random().toString(36).slice(2);
    return `
      <div class="audio-bubble" data-audio-id="${id}">
        <button class="ab-btn paused" data-act="toggle">▶</button>
        <div class="ab-track">
          <div class="ab-bar"><div class="ab-fill" style="width:0%"></div></div>
          <div class="ab-time"><span data-role="pos">0:00</span><span data-role="dur">0:00</span></div>
        </div>
        <audio class="ab-hidden-audio" preload="metadata" src="${url}"></audio>
      </div>
    `;
  }
  if (raw.startsWith('IMG|')) {
    const url = raw.slice(4).trim();
    const safe = encodeURI(url);
    return `
      <a class="img-bubble" href="${safe}" target="_blank" rel="noopener">
        <img class="chat-img" src="${safe}" alt="image" style="max-width:260px;max-height:260px;border-radius:12px;display:block;"/>
      </a>
    `;
  }
    if (raw.startsWith('HTML|')) return raw.slice(5);
    if (raw.startsWith('FWD|')) {
      const [, from, body] = raw.split('|');
      return `<div class="fwd-tag">🔁 Forwarded from ${escapeHTML(from || 'Anonymous')}</div>${escapeHTML(body || '')}`;
    }
    return escapeHTML(raw).replace(/\n/g,'<br>');
  }

  function replyInlineHtml(rep){
    if(!rep) return '';
    const short = rep.text?.length>80 ? rep.text.slice(0,80)+'…' : rep.text || '';
    return `<div class="reply-inline" data-reply="${rep.id||''}"><b>${escapeHTML(rep.user||'User')}</b> — <span>${escapeHTML(short)}</span></div>`;
  }


  // card changeeeeeeeeeeeeeieeeeieeeeeieieeieeeeeieeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee


  // iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii

  function messageCard({ id, user, userName, userEmail, text, ts, mine, deleted, editedAt, reply, clientId }) {
    const wrap = document.createElement('div');
    wrap.className = 'message' + (mine ? ' own' : '');
    if (id) wrap.dataset.id = id;
    if (clientId) wrap.dataset.clientId = clientId;
  
    // 🔹 Decide what to show in bubble header
    let display = userName || user || userEmail || 'User';
  
    // Agar yeh mera message hai -> hamesha mera DISPLAY_NAME dikhana
    if (mine && window.DISPLAY_NAME) {
      display = window.DISPLAY_NAME;
    }
  
    const looksLikeEmail = (s) => !!s && s.includes('@');
  
    // 👉 Agar email jaisa dikhta hai:
    if (looksLikeEmail(display)) {
      if (userName && !looksLikeEmail(userName)) {
        // Backend ne proper userName bheja hai, to woh use karo
        display = userName;
      } else {
        // sirf '@' se pehle ka part dikhाओ
        display = display.split('@')[0];
      }
    }
  
    const initialsStr = (display || 'U').trim().slice(0, 2).toUpperCase();
  
    // 🔹 Yahi pe avatarHtml inject
    const avatarHtml = `
      <div class="message-avatar"
           data-user-id="${escapeHTML(userEmail || user || '')}"
           data-user-name="${escapeHTML(display || '')}">
        ${escapeHTML(initialsStr)}
      </div>`;
  
    wrap.innerHTML = `
      ${avatarHtml}
      <div class="message-content">
        ${replyInlineHtml(reply)}
        <div class="message-header">
          <span class="message-author">${escapeHTML(display || 'Anon')}</span>
          <span class="message-time">${timeLabel(ts)}${editedAt ? ' · edited' : ''}</span>
        </div>
        <div class="message-text">${deleted ? '<i>[deleted]</i>' : renderMessageText(text)}</div>
      </div>
    `;
  
    
    // ✅ Private doubt room: show ACCEPT button directly under solution message (asker-only)
    try {
      const sol = wrap.querySelector('.solution-wrap');
      if (sol) {
        const aid = sol.getAttribute('data-answer-id') || '';
        const room = (typeof currentRoom !== 'undefined') ? currentRoom : '';
        if (typeof isPrivateDoubtRoom === 'function' && isPrivateDoubtRoom(room) && aid) {
          const qid = (typeof parseDoubtQuestionId === 'function') ? parseDoubtQuestionId(room) : null;
          const actionsRow = document.createElement('div');
          actionsRow.className = 'solution-actions';
          sol.appendChild(actionsRow);

          // lazy-fetch question to check asker + resolved state
          const baseQA = (window.API_BASE_QA || window.API_BASE || location.origin);
          const meQ = (window.USER_EMAIL || window.DISPLAY_NAME || '').toString().trim().toLowerCase();

          const applyBtn = (q) => {
            const resolved = String(q?.status || '').toUpperCase() === 'RESOLVED' || !!q?.acceptedAnswerId;
            const isAsker = (typeof isAskerOf === 'function') ? isAskerOf(q) : false;
            const accepted = String(q?.acceptedAnswerId || '') === String(aid);

            // show state
            if (accepted) {
              const tag = document.createElement('span');
              tag.className = 'qa-chip qa-chip--success';
              tag.textContent = 'Accepted';
              actionsRow.appendChild(tag);
              return;
            }

            if (!resolved && isAsker) {
              const btn = document.createElement('button');
              btn.className = 'qa-chip qa-chip--success';
              btn.textContent = '✅ Accept';
              btn.onclick = async () => {
                showPremiumConfirm({
                  title: "Accept final solution?",
                  message: "This will lock the question and mark it as resolved.",
                  onConfirm: () => {
                    acceptSolution(answerId);
                  }
                });
                const r = await authFetch(`${baseQA}/api/questions/answers/${aid}/accept`, { method: 'PATCH' });
                if (!r.ok) { alert(await r.text()); return; }
                // disable composer
                try {
                  const inp = document.getElementById('message-input');
                  const sb  = document.getElementById('send-btn');
                  if (inp) { inp.disabled = true; inp.placeholder = 'This doubt is resolved.'; }
                  if (sb) sb.disabled = true;
                } catch {}
                // mark visually
                actionsRow.innerHTML = '';
                const tag = document.createElement('span');
                tag.className = 'qa-chip qa-chip--success';
                tag.textContent = 'Accepted';
                actionsRow.appendChild(tag);
              };
              actionsRow.appendChild(btn);
            }
          };

          if (qid) {
            authFetch(`${baseQA}/api/questions/${qid}`)
              .then(r => r.ok ? r.json() : null)
              .then(q => { if (q) applyBtn(q); })
              .catch(()=>{});
          }
        }
      }
    } catch (e) { /* ignore */ }
const avatarEl = wrap.querySelector('.message-avatar');

    if (avatarEl) {
      avatarEl.style.cursor = "pointer";
      avatarEl.style.pointerEvents = "auto";
    
      avatarEl.addEventListener('dblclick', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    
        const uid   = avatarEl.getAttribute('data-user-id')   || '';
        const uname = avatarEl.getAttribute('data-user-name') || display || 'User';
    
        console.log("Avatar dblclick →", uid, uname);
        if (!uid) return;
    
        // Yeh object tera openMiniProfile ke format ke according
        const userInfo = {
          id: uid,
          email: uid.includes('@') ? uid : '',
          name: uname,
          userName: uname
        };
    
        window.currentProfileUserId   = uid;
        window.currentProfileUserName = uname;
    
        if (window.showChoices) {
          const choice = await window.showChoices({
            title: uname,
            message: '',
            choices: ['View profile', 'Report', 'Cancel']
          });
    
          if (choice === 'View profile') {
            openMiniProfile(userInfo);        // ✅ object
          } else if (choice === 'Report') {
            openReportModal(uid, uname);
          }
        } else {
          openMiniProfile(userInfo);          // ✅ object
        }
      });
    
      // (optional) agar double-click ke bajay single click chahiye:
      // avatarEl.addEventListener('click', ...same handler...);
    }
  
    const contentEl = wrap.querySelector('.message-content');
    const reactRow = document.createElement('div');
    reactRow.className = 'msg-reactions';
    contentEl.appendChild(reactRow);
  
    if (id && reactionStore.has(String(id))) renderReactionsRow(wrap);
  
    wrap.querySelector('.reply-inline')?.addEventListener('click', (e)=>{
      const rid = e.currentTarget.getAttribute('data-reply');
      const tgt = document.querySelector(`.message[data-id="${rid}"]`);
      tgt?.scrollIntoView({ behavior:'smooth', block:'center' });
    });
  
    // Right-click menu (includes React)
    contentEl.addEventListener('contextmenu', (e)=>{
      e.preventDefault();
      const mid    = wrap.dataset.id || null;
      const isMine = wrap.classList.contains('own'); 
      const txt    = wrap.querySelector('.message-text')?.textContent || '';
      const pinned = wrap.classList.contains('is-pinned');
  
      const actions = [
        { icon:'↩︎', label:'Reply', onClick:()=>{ replyingTo = { id: mid, user, text: txt }; showReplyBar(); } },
        { icon:'😊', label:'React', onClick:()=> showReactionPicker(contentEl, String(id||'')) },
        { icon:'📋', label:'Copy',  onClick:()=> copyToClipboard(txt) },
        { icon:'📤', label:'Forward', onClick:()=> forwardMessage(txt, user) },
        { icon:'ℹ️', label:'Info', onClick:()=> showMessageInfo({ id: mid, user, ts, editedAt: !!editedAt, pinned }) },
      ];
  
      if (mid) {
        actions.push({ icon:'📌', label: pinned ? 'Unpin' : 'Pin', onClick:()=> togglePin(mid, !pinned) });
      }
  
      if (isMine) {
        actions.push('divider');
        actions.push({
          icon:'✏️', label:'Edit',
          onClick:()=>{ if (!mid) { showToast('Please wait…'); return; } promptEdit(mid, txt); }
        });
        actions.push({
          icon:'🗑️', label:'Delete…',
          onClick: async ()=>{
            const choice = await showChoices?.({
              title:'Delete message', message:'Choose how you want to delete this message.',
              choices:['Delete for everyone','Delete for me','Cancel']
            }) ?? (confirm('Delete for everyone?') ? 'Delete for everyone' : 'Cancel');
            if (choice === 'Delete for everyone') {
              if (!mid) { showToast('Please wait…'); return; }
              confirmDelete(mid);
            } else if (choice === 'Delete for me') {
              if (mid) hideLocally(currentRoom, String(mid));
              showToast('Hidden on this device');
            }
          }
        });
      } else {
        actions.push('divider');
        actions.push({ icon:'🗑️', label:'Delete for me', onClick:()=>{ if (mid) hideLocally(currentRoom, String(mid)); } });
      }
  
      showAnchoredMenu(contentEl, actions, { side: 'auto' });
    });
  
    // Mobile long-press => picker
    let rxTimer = null;
    const startRxPress = (ev)=>{
      ev.preventDefault();
      rxTimer = setTimeout(()=> showReactionPicker(contentEl, String(id || '')), 420);
    };
    const cancelRxPress = ()=>{ if (rxTimer){ clearTimeout(rxTimer); rxTimer = null; } };
    contentEl.addEventListener('touchstart', startRxPress, { passive:false });
    contentEl.addEventListener('touchend',   cancelRxPress);
    contentEl.addEventListener('touchmove',  cancelRxPress);
    contentEl.addEventListener('touchcancel',cancelRxPress);
  
    return wrap;
  }

  function addMessageToList(opts){
    // 🔥 1) Unique key banaao
    const key = (opts.id ? "id_" + opts.id : "local_" + opts.ts + "_" + opts.clientId);
  
    // 🔥 2) Duplicate check
    if (seenMessages.has(key)) return null;
    seenMessages.add(key);
  
    const list = document.querySelector('#chat-messages');
    if (!list) return null;
  
    const node = messageCard(opts);
  
    // 🔥 3) Yahin pe TS aur clientId store karo
    if (opts.ts) node.dataset.ts = String(opts.ts);
    if (opts.clientId) node.dataset.clientId = opts.clientId;
  
    list.appendChild(node);
    enhanceAudioBubbles(node);
  
    if (opts.mine) {
      scrollToBottom(true);
    } else {
      if (isAtBottom(list)) scrollToBottom(false);
    }
  
    return node;
  }

  function showAnchoredMenu(anchorEl, items, { side = 'auto' } = {}) {
    document.querySelector('.msg-menu')?.remove();
    document.querySelector('.msg-menu-backdrop')?.remove();

    const back = document.createElement('div');
    back.className = 'msg-menu-backdrop';
    back.addEventListener('click', ()=> { menu.remove(); back.remove(); }, { once:true });
    document.body.appendChild(back);

    const menu = document.createElement('div');
    menu.className = 'msg-menu';
    items.forEach(it=>{
      if (it === 'divider') {
        const d = document.createElement('div'); d.className = 'divider'; menu.appendChild(d);
        return;
      }
      const b = document.createElement('button');
      b.className = 'item';
      b.innerHTML = it.icon ? `${it.icon} <span>${it.label}</span>` : it.label;
      b.onclick = ()=>{ menu.remove(); back.remove(); it.onClick?.(); };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);

    const r = anchorEl.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const pad = 10;

    let alignSide = side;
    if (alignSide === 'auto') {
      alignSide = anchorEl.closest('.message')?.classList.contains('own') ? 'right' : 'left';
    }

    let top = r.top + (r.height - m.height)/2;
    top = Math.max(pad, Math.min(top, window.innerHeight - m.height - pad));

    let left;
    if (alignSide === 'right') {
      left = r.right + 8;
      if (left + m.width + pad > window.innerWidth) left = r.right - m.width - 8;
    } else {
      left = r.left - m.width - 8;
      if (left < pad) left = r.left + 8;
    }

    menu.style.position = 'fixed';
    menu.style.top  = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;

    const onEsc = (e)=>{ if (e.key === 'Escape'){ menu.remove(); back.remove(); removeEventListener('keydown', onEsc); } };
    addEventListener('keydown', onEsc);
  }

  /* ---------- Pins ---------- */
  async function togglePin(id, pinned){
    try{
      const r = await authFetch(`${API_BASE}/api/chat/message/${id}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !!pinned })
      });
      if (!r.ok) throw 0;
    }catch{
      alert('Pin failed');
      return;
    }
    document.querySelector(`.message[data-id="${id}"]`)?.classList.toggle('is-pinned', !!pinned);
    wsSend({ type:'pin', id, pinned: !!pinned });
  }

  function pinnedLabelFromMessage(m) {
    const raw = m.text || '';
  
    // Voice note
    if (raw.startsWith('AUDIO|')) {
      return 'Voice note';
    }
  
    // Forwarded message
    if (raw.startsWith('FWD|')) {
      const parts = raw.split('|');
      const body  = parts[2] || '';
      return '↪ ' + body.slice(0, 60);
    }
  
    // Q&A / shared card (HTML payload)
    
  if (raw.startsWith('IMG|')) {
    const url = raw.slice(4).trim();
    if (!url) return '';
    const safe = encodeURI(url);
    return `
      <div class="img-bubble">
        <a href="${safe}" target="_blank" rel="noopener">
          <img src="${safe}" alt="uploaded image" style="max-width:100%;border-radius:10px" data-previewable />
        </a>
      </div>
    `;
  }

if (raw.startsWith('HTML|')) {
      const html = raw.slice(5);
      const tmp  = document.createElement('div');
      tmp.innerHTML = html;
  
      // try to pick nice title from card
      const titleEl =
        tmp.querySelector('.sc-title') ||
        tmp.querySelector('.shared-card h3') ||
        tmp.querySelector('h3');
  
      if (titleEl && titleEl.textContent.trim()) {
        return 'Q: ' + titleEl.textContent.trim().slice(0, 60);
      }
      return 'Shared card';
    }
  
    // Normal text message
    return raw.slice(0, 60) || '[attachment]';
  }

  async function loadPinned(roomId){
    const pinnedBar  = document.getElementById('pinnedBar');
    const pinnedList = document.getElementById('pinnedList');
    if (!pinnedBar || !pinnedList) return;
    pinnedList.innerHTML = '';
    try {
      const [subject, slug] = roomId.split('/');
      const url = `${API_BASE}/api/chat/pinned/${encodeURIComponent(subject)}/${encodeURIComponent(slug)}?limit=5`;
      const res = await authFetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) { pinnedBar.classList.remove('show'); return; }
      const items = await res.json();
      const seen = new Set();

      document.querySelectorAll('.message.is-pinned')
      .forEach(n => n.classList.remove('is-pinned'));


      for (const m of items){
        if (!m || seen.has(m.id)) continue;
        seen.add(m.id);

        const chip = document.createElement('div');
        chip.className = 'pin-chip';

      const raw = m.text || '';
      if (raw.startsWith('HTML|')) {
        chip.textContent = 'Shared card';
      } else if (raw.startsWith('AUDIO|')) {
        chip.textContent = 'Voice note';
      } else {
        chip.textContent = raw.slice(0, 60) || '[attachment]';
      }

      chip.onclick = () => {
        const n = document.querySelector(`.message[data-id="${CSS.escape(String(m.id))}"]`);
        if (!n) return;
        n.classList.add('flash');
        n.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => n.classList.remove('flash'), 1500);
      };
      pinnedList.appendChild(chip);

      // 🔹 corresponding message bubble ko bhi pinned mark karo
      const msgNode = document.querySelector(`.message[data-id="${CSS.escape(String(m.id))}"]`);
      if (msgNode) msgNode.classList.add('is-pinned');
    }

    pinnedBar.classList.toggle('show', seen.size > 0);
  } catch {
    pinnedBar.classList.remove('show');
  }
}

  /* ---------- Chat history / send ---------- */
  const simStore = {};
  const hiddenKey = (room) => `hidden_${room}`;
  function getHidden(room){ try{return JSON.parse(localStorage.getItem(hiddenKey(room))||'[]');}catch{return[];} }
  function setHidden(room, arr){ localStorage.setItem(hiddenKey(room), JSON.stringify(arr)); }
  function hideLocally(room, id){
    const arr = getHidden(room);
    if (!arr.includes(id)) { arr.push(id); setHidden(room, arr); }
    const node = document.querySelector(`.message[data-id="${id}"]`);
    node?.classList.add('hidden-local');
  }
  function isHidden(room, id){ return getHidden(room).includes(id); }
  function isAtBottom(el, pad = 12){ return el.scrollHeight - el.scrollTop - el.clientHeight <= pad; }
  function scrollToBottom(force=false){
    const list = document.getElementById('chat-messages');
    if (!list) return;
    if (force || isAtBottom(list)) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      autoPinToBottom = true; unreadCount = 0; updateNewMsgBtn();
    }
  }
  function updateNewMsgBtn(){
    const btn = document.getElementById('newMsgBtn');
    if (!btn) return;
    if (unreadCount > 0 && !autoPinToBottom) {
      btn.classList.add('show');
      btn.textContent = `New messages · ${unreadCount}`;
    } else {
      btn.classList.remove('show');
    }
  }

// 🔹 Doubt chat room id helper (1 room per question)
function getDoubtRoomId(qOrId) {
  const subject =
    currentChatSubjectKey ||
    (typeof getChatSubjectKey === 'function'
      ? getChatSubjectKey(currentAcademicProfile)
      : 'btech_cse');

  const id =
    typeof qOrId === 'object'
      ? (qOrId.id || qOrId.questionId || qOrId.qid)
      : qOrId;

  return `${subject}/doubt-q-${id}`;
}

  // roomId already declared above
  let currentSubject = 'General';
  let currentChatSubjectKey = 'btech_cse';
  let replyingTo = null;
  let isLoadingHistory = false;
  let autoPinToBottom = true;
  let unreadCount = 0;

  async function loadHistory(roomId){
    $('#chat-messages').innerHTML = '';
    const [subject, slug] = roomId.split('/');

    if (SIMULATION){
      const arr = (simStore[roomId] || []).slice(-50);
      arr.forEach(m => {
        if (isHidden(roomId, String(m.id))) return;
        const reply = m.replyToId ? buildReplyFromDom(m.replyToId) : null;
        addMessageToList({
          id: m.id, user: m.user, text: m.text, ts: m.ts,
          mine: m.clientId === CLIENT_ID, deleted: !!m.deleted, editedAt: m.editedAt,
          reply, clientId: m.clientId || ''
        });
      });
      return;
    }

    try {
const r = await authFetch(`${API_BASE}/api/chat/history/${subject}/${slug}?limit=50`);
      if (!r.ok) throw 0;
      const arr = await r.json();
      const myEmail = (window.USER_EMAIL || '').toLowerCase();
      const myName  = (window.DISPLAY_NAME || '').trim().toLowerCase();

      arr.reverse().forEach(m => {
        if (isHidden(roomId, String(m.id))) return;
        const reply = m.replyToId ? buildReplyFromDom(m.replyToId) : null;
      
        const msgEmail = (m.userEmail || '').trim().toLowerCase();
        const msgName  = (m.userName || m.user || '').trim().toLowerCase();
      
        const mine =
          (msgEmail && myEmail && msgEmail === myEmail) || // email match
          (msgName === myName);                            // name match
      
          addMessageToList({
            id: m.id,
            user: m.userName || m.user || 'User',
            userName: m.userName,
            userEmail: m.userEmail,
            text: m.text,
            ts: new Date(m.ts).getTime(),
            mine,
            deleted: !!m.deleted,
            editedAt: m.editedAt,
            reply,
            clientId: m.clientId || ''
          });
        if (m.reactions){
          const id = String(m.id);
          const map = new Map();
          for (const rr of m.reactions){ map.set(rr.emoji, new Set(rr.users || [])); }
          reactionStore.set(id, map);
          const wrap = document.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
          if (wrap) renderReactionsRow(wrap);
        }
      });
      // append any locally cached (unsynced) messages we created on this device
const pending = lhLoad(roomId);
if (Array.isArray(pending) && pending.length) {
  // avoid duping: if server already sent the same ts, skip
  const seenTs = new Set(arr.map(m => new Date(m.ts).getTime()));
  for (const m of pending) {
    if (seenTs.has(m.ts)) continue;
    const reply = m.replyToId ? buildReplyFromDom(m.replyToId) : null;
    addMessageToList({
      id: null,
      user: m.userName || 'User',
      text: m.text,
      ts: m.ts,
      mine: true,
      deleted: false,
      editedAt: null,
      reply,
      clientId: m.clientId || CLIENT_ID
    });
  }
}
    } catch (err) {
      console.error('History load failed', err);
    }
  }

  function buildReplyFromDom(id){
    const node = document.querySelector(`.message[data-id="${id}"]`);
    return node ? {
      id, user: node.querySelector('.message-author')?.textContent || 'User',
      text: node.querySelector('.message-text')?.textContent || ''
    } : null;
  }

function sendMessage(text){
  const ts         = Date.now();
  const replyToId  = replyingTo?.id || null;
  const preview    = replyToId ? buildReplyFromDom(replyToId) : null;

  // ✅ real identity (never "You" in the payload)
  const name  = window.DISPLAY_NAME || 'Anonymous';
  const email = window.USER_EMAIL   || '';

  // Local optimistic echo (do NOT mutate to "You")
  const node = addMessageToList({
    id: null,
    user: name,            // keep for backward-compat if renderer reads 'user'
    userName: name,        // preferred
    userEmail: email,      // stable id for ownership
    text,
    ts,
    mine: true,
    deleted: false,
    editedAt: null,
    reply: preview,
    clientId: CLIENT_ID
  });
  node.dataset.clientId = CLIENT_ID;
  scrollToBottom(true);


  // keep a local copy so it survives refresh if server save fails
lhPush(currentRoom, {
  ts,
  text,
  userName: name,
  userEmail: email,
  clientId: CLIENT_ID,
  replyToId
});
  // Send (simulation or WebSocket)
  if (SIMULATION) {
    const id = 'sim-' + ts + '-' + Math.random().toString(36).slice(2,6);
    node.dataset.id = id;
    simStore[currentRoom] = simStore[currentRoom] || [];
    simStore[currentRoom].push({
      id, text,
      user: name,
      userName: name,
      userEmail: email,
      ts, clientId: CLIENT_ID, replyToId
    });
  } else if (ws && ws.readyState === 1) {
    wsSend({
      type: 'message',
      room: currentRoom,
      text,
      user: name,             // ✅ same identity as local echo
      userName: name,
      userEmail: email,
      ts,
      clientId: CLIENT_ID
    });
  }

  // Reset reply bar + clear input
  replyingTo = null;
  showReplyBar();

  const input = document.getElementById('message-input');
  if (input) {
    input.value = '';
    document.dispatchEvent(new Event('al:message:sent'));
  }
}
window.sendMessage = sendMessage;

  async function promptEdit(id, oldText){
    const next = await showEditModal?.({
      title: "Edit message", label: "Update your message",
      value: oldText || "", okText: "Save", cancelText: "Cancel"
    });
    const finalText = (next ?? '').trim();
    if (next == null || finalText === (oldText || "").trim()) return;

    if (SIMULATION){
      const arr = simStore[currentRoom]||[];
      const m = arr.find(x=>x.id===id); 
      if(m){ m.text = finalText; m.editedAt = Date.now(); }
      const wrap = document.querySelector(`.message[data-id="${id}"]`);
      if (wrap){
        wrap.querySelector('.message-text').textContent = finalText;
        const t = wrap.querySelector('.message-time');
        if (t && !t.textContent.includes('edited')) t.textContent += ' · edited';
      }
      return;
    }
    try{
      const r = await authFetch(`${API_BASE}/api/chat/message/${id}`,{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text: finalText, clientId: CLIENT_ID })
      });
      if (!r.ok) throw 0;
      wsSend({type:'edit',id,text:finalText,clientId:CLIENT_ID});
    }catch{ alert('Edit failed'); }
  }

  async function confirmDelete(id){
    const ok = await showConfirmModal?.({
      title: "Delete message",
      body:  "This will delete the message for everyone.",
      okText: "Delete", cancelText: "Cancel"
    }) ?? confirm('Delete this message for everyone?');
    if (!ok) return;

    if (SIMULATION){
      const arr = simStore[currentRoom]||[];
      const m = arr.find(x=>x.id===id); if (m) m.deleted = true;
      markMessageDeleted(id);
      loadPinned(currentRoom);
      return;
    }
    try{
      const r = await authFetch(`${API_BASE}/api/chat/message/${id}`,{
        method:'DELETE',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ clientId: CLIENT_ID })
      });
      if (!r.ok && r.status !== 204) throw 0;
      markMessageDeleted(id);
      loadPinned(currentRoom);
      wsSend({type:'delete',id,clientId:CLIENT_ID});
    }catch{ alert('Delete failed'); }
  }

  function markMessageDeleted(id){
    const wrap = document.querySelector(`.message[data-id="${id}"]`);
    if (!wrap) return;
    const textEl = wrap.querySelector('.message-text');
    if (textEl) textEl.innerHTML = '<i>[deleted]</i>';
    wrap.classList.add('is-deleted');
  }

async function forwardMessage(originalText, originalUser){
  const target = await showPromptModal?.({
    title: 'Forward Message',
    label: 'Forward to room (subject/slug, e.g. cs/java-programming)',
    placeholder: 'cs/java-programming',
    okText: 'Forward',
    value: currentRoom
  }) ?? prompt('Forward to room (subject/slug)', currentRoom);
  if (!target) return;

  const ts       = Date.now();
  const name     = window.DISPLAY_NAME || 'Anonymous';
  const email    = window.USER_EMAIL   || '';
  const fromUser = originalUser || 'Anonymous';

  // plain-text wrapper so receivers can render a "forwarded" badge
  const payload = `FWD|${fromUser}|${originalText || ''}`;

  // local echo if same room
  if (target === currentRoom) {
    addMessageToList({
      id:null, user:name, userName:name, userEmail:email,
      text: payload, ts, mine:true, deleted:false, editedAt:null, reply:null, clientId: CLIENT_ID
    });
  }

  // send to target room
  if (ws && ws.readyState === 1) {
    wsSend({
      type:'message', room: target, text: payload,
      user:name, userName:name, userEmail:email,
      ts, clientId: CLIENT_ID
    });
  }
}

window.qaShareAccepted          = qaShareAccepted;
window.forwardMessage           = forwardMessage;
window.openDoubtRoomForQuestion = openDoubtRoomForQuestion;

  function showMessageInfo({id, user, ts, editedAt, pinned}){
    const d = new Date(ts||Date.now());
    const when = d.toLocaleString();
    const html = `
      <div style="font-size:14px;line-height:1.4">
        <div><b>ID:</b> ${id||'(pending)'}</div>
        <div><b>From:</b> ${user||'User'}</div>
        <div><b>When:</b> ${when}</div>
        <div><b>Pinned:</b> ${pinned?'Yes':'No'}</div>
        <div><b>Edited:</b> ${editedAt?'Yes':'No'}</div>
        <div style="opacity:.7;margin-top:6px"><i>Seen-by tracking is not enabled.</i></div>
      </div>`;
    showChoices?.({title:'Message info', message: html, choices:['OK']}) ?? alert('Message info:\n' + html.replace(/<[^>]+>/g,''));
  }

  /* ---------- WS events ---------- */
  function onWsMessage(e){
    let msg; 
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'join-ack') return;

    // 🔥 KICKED (server forces disconnect)
    if (msg.type === 'kicked') {
      const kickedRoom = msg.room || currentRoom;
      setRoomKicked(kickedRoom);
      try { showToast(msg.message || 'You were removed from this room'); } catch {}
      try { if (ws) ws.close(); } catch {}
      // UI cleanup: move user out of the room
      if (kickedRoom === currentRoom) {
        currentRoom = null;
        try { setHeader(''); } catch {}
        try { clearChat?.(); } catch {}
      }
      // refresh room list so it disappears immediately
      try { loadRoomsFromBackend(parseSubject(kickedRoom) || currentSubject || subjectKey || ''); } catch {}
      return;
    }

    console.log('[WS IN]', msg);
    if (msg.type === 'active-count') {
      const roomId = msg.room || currentRoom;
      const count  = Number(msg.count || 0);
      updateActiveCount(roomId, count);
      return; // baaki handlers skip
    }

    if (msg.type === 'message') {
      if (msg.clientId && msg.clientId === CLIENT_ID){
        const pending = Array.from(document.querySelectorAll('.message.own:not([data-id])'));
        const node = pending[pending.length - 1];
        if (node) {
            // old fingerprint remove
            const oldKey = "local_" + node.dataset.ts + "_" + node.dataset.clientId;
            seenMessages.delete(oldKey);
        
            // update DOM
            node.dataset.id = msg.id;
        
            // new fingerprint add
            const newKey = "id_" + msg.id;
            seenMessages.add(newKey);
        }
        return;
      }
      if (msg.id && document.querySelector(`.message[data-id="${msg.id}"]`)) return;
      if (seenOnceForMessage(msg)) return;

      const reply = msg.replyToId ? buildReplyFromDom(msg.replyToId) : null;
      const meEmail = (window.USER_EMAIL || '').trim().toLowerCase();
      const meName  = (window.DISPLAY_NAME || '').trim().toLowerCase();
      const msgEmail = (msg.userEmail || '').trim().toLowerCase();
      const msgName  = (msg.userName || msg.user || '').trim().toLowerCase();
      
      const mine = 
          (msgEmail && meEmail && msgEmail === meEmail) ||
          (msgName === meName);
      
          addMessageToList({
            id: msg.id,
            user: msg.userName || msg.user || 'User',
            userName: msg.userName,
            userEmail: msg.userEmail,
            text: msg.text || '',
            ts: msg.ts,
            mine,
            deleted: !!msg.deleted,
            editedAt: msg.editedAt,
            reply
          });

      if (!autoPinToBottom && !isLoadingHistory) { unreadCount += 1; updateNewMsgBtn(); }
      return;
    }

    if (msg.type === 'edit') {
      const wrap = document.querySelector(`.message[data-id="${msg.id}"]`);
      if (wrap){
        wrap.querySelector('.message-text').textContent = msg.text || '';
        const mt = wrap.querySelector('.message-time');
        if (mt && !mt.textContent.includes('edited')) mt.textContent += ' · edited';
      }
      return;
    }

    if (msg.type === 'reaction'){
      const id    = String(msg.id || '');
      const emoji = msg.emoji;
      const user  = msg.user || 'Someone';
      const added = !!msg.added;

      const { users } = ensureRxBuckets(id, emoji);
      if (added) users.add(user); else users.delete(user);

      const wrap = document.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
      if (wrap) renderReactionsRow(wrap);
      return;
    }

    if (msg.type === 'reaction-sync'){
      const items = msg.items || [];
      for (const it of items){
        const id = String(it.id);
        const emoji = it.emoji;
        const users = new Set(it.users || []);
        const { byEmoji } = ensureRxBuckets(id, emoji);
        byEmoji.set(emoji, users);
        const wrap = document.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
        if (wrap) renderReactionsRow(wrap);
      }
      return;
    }

    if (msg.type === 'delete') {
      markMessageDeleted(msg.id);
      loadPinned(currentRoom);
      return;
    }

    if (msg.type === 'pin') {
      if (msg.from && msg.from === CLIENT_ID) {
        const node = document.querySelector(`.message[data-id="${msg.id}"]`);
        if (node) node.classList.toggle('is-pinned', !!msg.pinned);
        return;
      }
      loadPinned(currentRoom);
      const node = document.querySelector(`.message[data-id="${msg.id}"]`);
      if (node) node.classList.toggle('is-pinned', !!msg.pinned);
      return;
    }
  }

  /* ---------- Rooms / boot ---------- */
  function setHeader(roomId){
    const active = $(`.group-item[data-room="${roomId}"]`);
    const title  = active?.querySelector('.group-name')?.textContent || 'Study Group';
    const subj   = active?.dataset.subject || 'Subject';
const titleEl = $('#roomTitle');
if (titleEl) titleEl.textContent = title;

const subjEl = $('#roomSubtitle');
if (subjEl) subjEl.textContent = subj;

  }

// ====== Doubt Room Moderation UI (Members + Kick) ======
let __moderationBtn = null;
let __moderationModal = null;

async function setupDoubtRoomModerationUI(roomId){
  // only for private doubt rooms
  const qid = parseDoubtQuestionId(roomId);
  if(!qid){ removeModerationBtn(); return; }

  // if kicked, no moderation button needed
  if(isRoomKicked(roomId)){ removeModerationBtn(); return; }

  // Check if I am asker
  const meEmail = (getUserEmail() || '').trim().toLowerCase();
  if(!meEmail){ removeModerationBtn(); return; }

  let q;
  try {
    // Question API lives under API_BASE_QA in this file
    const qRes = await authFetch(`${API_BASE_QA}/api/questions/${qid}`);
    if (!qRes.ok) throw new Error(`question ${qRes.status}`);
    q = await qRes.json();
  } catch (e) {
    // if question endpoint differs in your build, change URL above
    removeModerationBtn();
    return;
  }
  const askedBy = (q?.askedBy || '').trim().toLowerCase();
  if(!askedBy || askedBy !== meEmail){ removeModerationBtn(); return; }

  ensureModerationBtn(roomId, qid);
}

function ensureModerationBtn(roomId, qid){
  const titleEl = document.querySelector('#roomTitle');
  if(!titleEl){ return; }

  if(!__moderationBtn){
    __moderationBtn = document.createElement('button');
    __moderationBtn.type = 'button';
    __moderationBtn.id = 'btnMembers';
    __moderationBtn.textContent = 'Members';
    __moderationBtn.style.marginLeft = '10px';
    __moderationBtn.style.padding = '6px 10px';
    __moderationBtn.style.borderRadius = '10px';
    __moderationBtn.style.border = '1px solid rgba(255,255,255,0.25)';
    __moderationBtn.style.background = 'rgba(255,255,255,0.10)';
    __moderationBtn.style.color = '#fff';
    __moderationBtn.style.cursor = 'pointer';
  }

  // attach next to room title (safe minimal DOM change)
  if(!__moderationBtn.parentElement){
    titleEl.parentElement?.appendChild(__moderationBtn);
  }

  __moderationBtn.onclick = () => openMembersModal(roomId, qid);
}

function removeModerationBtn(){
  try { __moderationBtn?.remove(); } catch {}
  __moderationBtn = null;
}

function ensureModalShell(){
  if(__moderationModal) return __moderationModal;

  const overlay = document.createElement('div');
  overlay.id = 'moderationModal';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '9999';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.65)';

  const card = document.createElement('div');
  card.style.width = 'min(560px, 92vw)';
  card.style.maxHeight = '80vh';
  card.style.overflow = 'auto';
  card.style.background = '#10131a';
  card.style.border = '1px solid rgba(255,255,255,0.12)';
  card.style.borderRadius = '16px';
  card.style.padding = '14px';

  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="font-size:16px;font-weight:700;color:#fff;">Room Members</div>
      <button type="button" id="modCloseBtn"
        style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">Close</button>
    </div>
    <div id="modBody" style="margin-top:12px;color:#cbd5e1;font-size:14px;"></div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) hideModerationModal(); });
  overlay.querySelector('#modCloseBtn').onclick = hideModerationModal;

  __moderationModal = overlay;
  return overlay;
}

function showModerationModal(html){
  const m = ensureModalShell();
  const body = m.querySelector('#modBody');
  body.innerHTML = html || '';
  m.style.display = 'flex';
}

function hideModerationModal(){
  if(__moderationModal) __moderationModal.style.display = 'none';
}

async function openMembersModal(roomId, qid){
  const subject = parseSubject(roomId);

  showModerationModal(`<div>Loading members…</div>`);

  let members = [];
  try {
    const res = await authFetch(`${API_BASE}/api/doubt-rooms/${qid}/members?subject=${encodeURIComponent(subject)}`);
    if (!res.ok) throw new Error(`members ${res.status}`);
    members = await res.json();
  } catch (e) {
    showModerationModal(`<div style="color:#ffb4b4;">Failed to load members.</div>`);
    return;
  }

  const me = (getUserEmail() || '').trim().toLowerCase();
  const list = (Array.isArray(members) ? members : []).map(email => {
    const safe = escapeHtml(String(email||''));
    const isMe = me && String(email||'').trim().toLowerCase() === me;
    const kickBtn = isMe ? '' : `<button data-kick="${safe}"
        style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(239,68,68,0.20);color:#fff;cursor:pointer;">Kick</button>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;margin-bottom:8px;">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px;color:#fff;">${safe}${isMe? ' <span style="color:#94a3b8;">(you)</span>' : ''}</div>
        ${kickBtn}
      </div>`;
  }).join('');

  const empty = `<div style="color:#94a3b8;">No active members.</div>`;
  showModerationModal(list || empty);

  // wire kick buttons
  const modal = ensureModalShell();
  modal.querySelectorAll('[data-kick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const email = btn.getAttribute('data-kick');
      openKickModal(roomId, qid, email);
    });
  });
}

function openKickModal(roomId, qid, userEmail){
  // NOTE: update reasons if your RoomKickReason enum differs.
  const REASONS = ['ABUSE','SPAM','HARASSMENT','OFF_TOPIC','OTHER'];

  const reasonOptions = REASONS.map(r => `<option value="${r}">${r.replaceAll('_',' ')}</option>`).join('');
  showModerationModal(`
    <div style="color:#fff;font-weight:700;margin-bottom:8px;">Kick: <span style="font-weight:600;">${escapeHtml(userEmail)}</span></div>

    <div style="margin-bottom:10px;">
      <label style="display:block;color:#cbd5e1;margin-bottom:6px;">Reason</label>
      <select id="kickReason" style="width:100%;padding:10px;border-radius:12px;background:#0b0f16;color:#fff;border:1px solid rgba(255,255,255,0.12);">
        ${reasonOptions}
      </select>
    </div>

    <div style="margin-bottom:10px;">
      <label style="display:block;color:#cbd5e1;margin-bottom:6px;">Note (min 10 chars)</label>
      <textarea id="kickNote" rows="3" style="width:100%;padding:10px;border-radius:12px;background:#0b0f16;color:#fff;border:1px solid rgba(255,255,255,0.12);" placeholder="Explain what happened..."></textarea>
    </div>

    <div style="margin-bottom:12px;">
      <label style="display:block;color:#cbd5e1;margin-bottom:6px;">Proof URL (optional)</label>
      <input id="kickProof" type="url" style="width:100%;padding:10px;border-radius:12px;background:#0b0f16;color:#fff;border:1px solid rgba(255,255,255,0.12);" placeholder="https://..."/>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button type="button" id="kickCancel"
        style="padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">Cancel</button>
      <button type="button" id="kickConfirm"
        style="padding:8px 12px;border-radius:12px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.25);color:#fff;cursor:pointer;">Kick</button>
    </div>
  `);

  const modal = ensureModalShell();
  modal.querySelector('#kickCancel').onclick = () => openMembersModal(roomId, qid);
  modal.querySelector('#kickConfirm').onclick = async () => {
    const subject = parseSubject(roomId);
    const reason = modal.querySelector('#kickReason').value;
    const note = (modal.querySelector('#kickNote').value || '').trim();
    const proofUrl = (modal.querySelector('#kickProof').value || '').trim();

    if(note.length < 10){
      try { showToast('Note must be at least 10 characters'); } catch { alert('Note must be at least 10 characters'); }
      return;
    }

    try {
      const kickRes = await authFetch(`${API_BASE}/api/doubt-rooms/${qid}/kick`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ userEmail, reason, note, proofUrl, subject })
      });
      if (!kickRes.ok) {
        const t = await kickRes.text().catch(()=> '');
        throw new Error(`Kick failed ${kickRes.status}: ${t}`);
      }
      // ✅ UX: refresh members list + rooms + question panel (claim slot now free)
      try { showToast('Member kicked'); } catch {}
      await openMembersModal(roomId, qid);
      try { loadRoomsFromBackend(subject); } catch {}

      // If QA drawer is open for same question, refresh it so claim count updates
      try { if(window.__qaOpenQuestionId === qid) qaOpen(qid); } catch {}
    } catch (e) {
      // if reason enum mismatch -> backend returns 400
      try { showToast('Kick failed. Check reason enum values.'); } catch { alert('Kick failed. Check reason enum values.'); }
      console.error(e);
    }
  };
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}


  function showReplyBar(){
    if(!replyingTo){ $('#replyBar')?.style && ($('#replyBar').style.display='none'); return; }
    $('#replyBar')?.style && ($('#replyBar').style.display='block');
    $('#replyUser') && ($('#replyUser').textContent = replyingTo.user || 'User');
    $('#replyText') && ($('#replyText').textContent = (replyingTo.text||'').length>90 ? replyingTo.text.slice(0,90)+'…' : (replyingTo.text||''));
  }

  function addRoomDom({room,name,subject,members}){
    const el = document.createElement('div');
    el.className='group-item'; el.dataset.room=room; el.dataset.subject=subject||'Computer Science';
    el.innerHTML = `
      <div class="online-indicator"></div>
      <div class="group-info">
        <div class="group-name">${escapeHTML(name||room)}</div>
        <div class="group-status">${members||0} active members</div>
      </div>
      <div class="member-count">${members||0}</div>`;
    el.addEventListener('click', onRoomClick);
    $('.study-groups')?.appendChild(el);
  }

  // 🔹 Doubt-room group helper (private per question, per user UI)
  function ensureDoubtRoomDom(roomId, title) {
    let el = document.querySelector(`.group-item[data-room="${roomId}"]`);
    if (el) return el;

    addRoomDom({
      room: roomId,
      name: title || 'Doubt Room',
      subject: 'Doubts',
      members: 1
    });

    el = document.querySelector(`.group-item[data-room="${roomId}"]`);
    return el;
  }

  // 🔥 Open / join doubt chat for a given question
  function openDoubtRoomForQuestion(qOrId) {
    if (!qOrId) return;

    const roomId = getDoubtRoomId(qOrId);

    const title =
      typeof qOrId === 'object'
        ? (qOrId.title || qOrId.question || `Doubt #${qOrId.id || qOrId.qid || ''}`)
        : `Doubt #${qOrId}`;

    // sirf is user ke sidebar me yeh group-item dikhega
    ensureDoubtRoomDom(roomId, title);

    // normal room join flow reuse
    joinRoom(roomId);
  }

// QA module se call karne ke liye expose kar do
window.openDoubtRoomForQuestion = openDoubtRoomForQuestion;
  // 👇 NEW: update active members UI for a room
  function updateActiveCount(roomId, count) {
    if (!roomId) return;
  
    const item = document.querySelector(
      `.group-item[data-room="${CSS.escape(roomId)}"]`
    );
    if (!item) return;
  
    const statusEl = item.querySelector('.group-status');
    const badgeEl  = item.querySelector('.member-count');
  
    const safe  = Number(count) || 0;
    const label = safe === 1 ? '1 active member' : `${safe} active members`;
  
    if (statusEl) statusEl.textContent = label;
    if (badgeEl)  badgeEl.textContent  = String(safe);
  
    if (safe > 0) item.classList.add('has-online');
    else item.classList.remove('has-online');
  }

 
  function onRoomClick(e){
    $$('.group-item').forEach(n=>n.classList.remove('active'));
    const item = e.currentTarget; item.classList.add('active');
    joinRoom(item.dataset.room);
  }

  function loadRoom(slug) {
    const subject = currentChatSubjectKey || getChatSubjectKey(currentAcademicProfile) || 'btech_cse';
    const roomId = `${subject}/${slug}`;

    const item = document.querySelector(`.group-item[data-room="${roomId}"]`);
    if (item) {
      document.querySelectorAll('.group-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    }
    joinRoom(roomId);
  }
let lastRoom = null;

// 🔹 Sidebar / mobile bar me active room highlight karne ke liye
function markActiveRoom(roomId) {
  // LEFT SIDEBAR
  document.querySelectorAll('.group-item').forEach(card => {
    const r = card.dataset.room;
    if (r === roomId) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  // MOBILE bottom pills (agar use kar rahe ho)
  document.querySelectorAll('.mobile-group-pill').forEach(pill => {
    const r = pill.dataset.room;
    if (r === roomId) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}


async function joinRoom(roomId) {
  // 🚫 If user was kicked from this room earlier, block client-side join too.
  if (isRoomKicked(roomId)) {
    try { showToast('You were removed from this room'); } catch { alert('You were removed from this room'); }
    // refresh list to ensure it disappears
    try { loadRoomsFromBackend(parseSubject(roomId) || ''); } catch {}
    return;
  }


  const prevRoom = currentRoom;
  const rid = roomId;
  currentRoom = rid;
  roomId = rid; // legacy alias
  updateTopButtonsForRoom(rid);
  markActiveRoom(rid);
  seenMessages.clear();
  if (prevRoom && prevRoom !== roomId) {
    updateActiveCount(prevRoom, 0);  
  }
  if (ws && ws.readyState === 1 && prevRoom && prevRoom !== roomId) {
    wsSend({
      type: 'leave',
      room: prevRoom,
      userName: window.DISPLAY_NAME || 'Anonymous',
      userEmail: window.USER_EMAIL   || ''
    });
  }

  currentSubject =
    $(`.group-item[data-room="${roomId}"]`)?.dataset.subject || 'Subject';
  setHeader(roomId);

  try { await setupDoubtRoomModerationUI(roomId); } catch (e) { console.warn('moderation ui', e); }

  const list = document.getElementById('chat-messages');
  if (list) list.innerHTML = '';

  unreadCount = 0;
  autoPinToBottom = true;
  updateNewMsgBtn();

  // naya room join
  if (ws && ws.readyState === 1) {
    wsSend({
      type: 'join',
      room: roomId,
      userName: window.DISPLAY_NAME || 'Anonymous',
      userEmail: window.USER_EMAIL   || ''
    });
  }

  isLoadingHistory = true;
  try {
    await loadHistory(roomId);
    scrollToBottom(true);
    await loadPinned(roomId);
  } finally {
    isLoadingHistory = false;
  }

  if (document.getElementById('qaPanel')?.classList.contains('open')) {
    await qaLoadList();
  }
  loadMobileGroupsBar();
}

  function bindUI(){
    $$('.group-item').forEach(n => n.addEventListener('click', onRoomClick));
    
    $('#send-btn')?.addEventListener('click', ()=>{
      const inp = $('#message-input');
      const txt = (inp?.value || '').trim();
      if (!txt) return;
      sendMessage(txt);
      if (inp) inp.value = '';
    });
    // also handle the floating fab button
$('#sendFab')?.addEventListener('click', (e)=>{
  e.preventDefault();
  const inp = $('#message-input');
  const txt = (inp?.value || '').trim();
  if (!txt) return;
  sendMessage(txt);     // same path as Enter key
  if (inp) inp.value = '';
});

    $('#message-input')?.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        const v = (e.target.value || '').trim();
        if (v){
          sendMessage(v);
          e.target.value = '';
        }
      }
    });

    $('#replyCancel')?.addEventListener('click', ()=>{
      replyingTo = null;
      showReplyBar();
    });

    $('#newRoomBtn')?.addEventListener('click', async ()=> {
      const title = await showPromptModal?.({
        title:"Create Study Group",
        label:"New study group title (e.g., Java Programming)",
        placeholder:"e.g., Java Programming",
        okText:"Create", cancelText:"Cancel"
      }) ?? prompt('New study group title?');
      if (!title) return;
    
      const subject = currentChatSubjectKey || getChatSubjectKey(currentAcademicProfile);
      const slug = title.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,'');
      const roomId = `${subject}/${slug}`;
    
      if (SIMULATION) {
        addRoomDom({ room: roomId, name: title, subject, members: 0 });
        joinRoom(roomId);
        return;
      }
    
      try {
        const r = await authFetch(`${API_BASE}/api/rooms`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ subject, title, visibility:'PUBLIC' })
        });
        if (!r.ok) throw 0;
    
        addRoomDom({ room: roomId, name: title, subject, members: 0 });
        joinRoom(roomId);
      } catch {
        alert('Create failed');
      }
    });

    // Smart autoscroll tracking
    const list = document.getElementById('chat-messages');
    if (list){
      list.addEventListener('scroll', ()=>{
        autoPinToBottom = isAtBottom(list);
        if (autoPinToBottom){ unreadCount = 0; updateNewMsgBtn(); }
      });
    }
   
    const newBtn = document.getElementById('newMsgBtn');
    newBtn?.addEventListener('click', ()=>{
      scrollToBottom(true);
      unreadCount = 0; autoPinToBottom = true; updateNewMsgBtn();
    });

    document.getElementById("mobileAddGroup")?.addEventListener("click", () => {
      document.getElementById("newRoomBtn").click();
    });
  }

  
  function loadMobileGroupsBar() {
    const wrap = document.getElementById("mobile-groups-scroll");
    const addBtn = document.getElementById("mobileAddGroup");
    wrap.innerHTML = "";
  
    const author = isAuthorUser();
    if (!author) addBtn.style.display = "none";
  
    // sidebar groups list read
    const groups = document.querySelectorAll(".group-item");
  
    groups.forEach(g => {
      const pill = document.createElement("div");
      pill.className = "mobile-group-pill";
      pill.textContent = g.querySelector(".group-name").textContent;
  
      const roomId = g.dataset.room;
      if (roomId === currentRoom) pill.classList.add("active");
  
      pill.addEventListener("click", () => {
        joinRoom(roomId);
        loadMobileGroupsBar();
      });
  
      wrap.appendChild(pill);
    });
  }

(function(){
  function syncHeaderHeight(){
    const header =
      document.querySelector('.nav') ||
      document.querySelector('.AlephLearnHeader') ||
      document.querySelector('header');

    const h = header ? Math.ceil(header.getBoundingClientRect().height) : 56;
    document.documentElement.style.setProperty('--siteHeaderH', h + 'px');
  }
  window.addEventListener('load',   syncHeaderHeight, { once:true });
  window.addEventListener('resize', syncHeaderHeight);
  const hdr = document.querySelector('.nav');
  if (hdr && 'ResizeObserver' in window){
    const ro = new ResizeObserver(syncHeaderHeight);
    ro.observe(hdr);
  }
})();
async function start(){
  bindUI();
  try {
    const res = await authFetch(`${API_BASE}/api/profile/academic/me`);
    if (res.ok) {
      currentAcademicProfile = await res.json();
    } else {
      currentAcademicProfile = null; 
    }
  } catch (e) {
    console.error("Profile load fail", e);
    currentAcademicProfile = null;
  }

  // 🔔 Start realtime notifications (claim updates etc.)
  await initNotifications();
  const subjectKey = getChatSubjectKey(currentAcademicProfile);
  const rooms = await loadRoomsFromBackend(subjectKey);
  const first = document.querySelector('.group-item');
  if (!first) {
    console.warn("No rooms found for subject:", subjectKey);

    const list = document.getElementById('chat-messages');
    if (list) {
      list.innerHTML = `
        <div class="empty-state" style="padding:16px;color:#999;">
          No study groups for your branch yet.<br>
          Click <b>+ New Room</b> to create one.
        </div>`;
    }
    await initBackendOrSim();
    return;
  }

  first.classList.add('active');

  roomId = currentRoom = first.dataset.room;

  await initBackendOrSim();
  await joinRoom(currentRoom);
  setTimeout(() => loadPinned(currentRoom), 1000);
}
start();
async function loadRoomsFromBackend(subjectKey) {
  const subject = subjectKey || "btech_cse";
  const url = `${API_BASE}/api/rooms?subject=${encodeURIComponent(subjectKey)}&q=`;

  try {
    const res = await authFetch(url);
    if (!res.ok) {
      console.error("Room load failed:", res.status, res.statusText);
      return [];
    }

    const rooms = await res.json();
    const container = document.querySelector('.study-groups');
    if (!container) return [];

    container.innerHTML = "";

    rooms.forEach(r => {
      addRoomDom({
        room: `${r.subject}/${r.slug}`,
        name: r.title,
        subject: r.subject,
        members: 0  
      });
    });

    return rooms; // 👈 NEW
  } catch (err) {
    console.error("Room load failed", err);
    return [];
  }
}
})();
  (function(){
    const nav   = document.querySelector('.nav');
    const btn   = document.querySelector('.nav-toggle');
    const links = document.querySelector('.links');
    if(!nav || !btn || !links) return;

    function closeMenu(){
      nav.classList.remove('open');
      document.body.classList.remove('nav-open');
      btn.setAttribute('aria-expanded','false');
    }

    btn.addEventListener('click', ()=>{
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      document.body.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    links.addEventListener('click', e => { if (e.target.tagName === 'A') closeMenu(); });
    window.addEventListener('resize', ()=>{ if (window.innerWidth > 860) closeMenu(); });
  })();
document.addEventListener('DOMContentLoaded', () => {
  const name = window.DISPLAY_NAME || localStorage.getItem('displayName') || 'You';
  document.querySelectorAll('#profileName, .user-name, [data-user-name]')
    .forEach(el => el.textContent = name);
});
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('message-input');
  if (!input) return;

  const update = () => {
    document.body.classList.toggle('typing', input.value.trim().length > 0);
  };

  input.addEventListener('input', update);
  update();
});

// 🔥 Author-only UI control
document.addEventListener("DOMContentLoaded", () => {
  // 🔥 author check
  const author = isAuthorUser();

  const searchWrapper = document.getElementById("chatSearchWrapper"); // upar HTML mein wrap kiya h
  const newGroupBtn   = document.getElementById("newRoomBtn");        // already hai

  if (!author) {
    // normal user -> hide search + New Study Group
    if (searchWrapper) searchWrapper.style.display = "none";
    if (newGroupBtn)   newGroupBtn.style.display   = "none";
  } else {
    // tumhara / author account -> sab visible
    if (searchWrapper) searchWrapper.style.display = "";
    if (newGroupBtn)   newGroupBtn.style.display   = "";
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('#send-btn');  
  if (!btn) return;
  e.preventDefault();
  const inp = document.getElementById('message-input');
  const txt = (inp?.value || '').trim();
  if (!txt) return;
  sendMessage(txt);
  if (inp) inp.value = '';
});
document.getElementById('voice-send')?.setAttribute('type', 'button');
document.addEventListener('DOMContentLoaded', () => {
  const mic = document.getElementById('mic-btn');
  if (!mic) return;
  mic.addEventListener('click', () => mic.classList.toggle('recording'));
});
document.addEventListener('DOMContentLoaded', () => {
  const modal    = document.getElementById('qaViewModal');
  const composer = document.getElementById('qaComposer');
  const body     = document.body;

  if (!modal) return;


  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) modal.hidden = true;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true; 
  });
  const toggleScroll = () => { body.style.overflow = modal.hidden ? '' : 'hidden'; };
  new MutationObserver(toggleScroll).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  toggleScroll();
  if (composer) {
    const aInput = document.getElementById('qaAInput');
    const focusIfVisible = () => {
      if (!composer.hasAttribute('hidden') && !modal.hidden) aInput && aInput.focus();
    };
    new MutationObserver(focusIfVisible).observe(composer, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(focusIfVisible).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
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

// Call automatically on page load
document.addEventListener("DOMContentLoaded", setupNavbarAvatar);









// 53823rt37guyjfgjsdhcvasjhvascasvchjascvskupaopouwyqwiu ewqri crg wv rci89y4r  
// hgfdbhjavbkrjegfhbreiuvyc 4owlbv rey vibkrhvueirgc  





// 78364817216274217468172647182217868126182


// ===== Scroll fix for chat message list =====
document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('chat-messages');
  if (!list) return;

  // In many layouts the message list sits inside a flex column.
  // These styles make sure it can actually scroll.
  list.style.overflowY = 'auto';
  list.style.overflowX = 'hidden';
  list.style.webkitOverflowScrolling = 'touch';
  list.style.overscrollBehavior = 'contain';
  list.style.minHeight = '0';
  list.style.flex = list.style.flex || '1 1 auto';

  // Also help the immediate parent in case it's a flex container.
  const p = list.parentElement;
  if (p) {
    if (!p.style.minHeight) p.style.minHeight = '0';
  }
});

/* ======================= AI EXPLANATION UI (frontend hook) ======================= */

(function(){
  function Q(id){ return document.getElementById(id); }

  const state = {
    explanationId: null,
    doubtId: null,
    doubtTitle: null,
  };

  function show(el){ if(el) el.style.display = ''; }
  function hide(el){ if(el) el.style.display = 'none'; }

  async function aiGet(url){
    const res = await authFetch(url);
    if(!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(`AI GET failed ${res.status}: ${t}`);
    }
    return res.json();
  }
  async function aiPost(url, body){
    const res = await authFetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body || {})
    });
    if(!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(`AI POST failed ${res.status}: ${t}`);
    }
    return res.json();
  }

  function openModal(){
    const m = Q('aiModal');
    if(!m) return;
    m.style.display = 'block';
    // default pane
    switchTab('resolved');
    loadResolved().catch(err=>{
      console.error(err);
      alert(err.message || 'AI load failed');
    });
  }

  function closeModal(){
    const m = Q('aiModal');
    if(m) m.style.display = 'none';
  }

  function switchTab(which){
    const t1 = Q('aiTabResolved');
    const t2 = Q('aiTabChat');
    const p1 = Q('aiResolvedPane');
    const p2 = Q('aiChatPane');

    if(which === 'chat'){
      t1?.classList.remove('al-tab--active');
      t2?.classList.add('al-tab--active');
      hide(p1); show(p2);
    } else {
      t2?.classList.remove('al-tab--active');
      t1?.classList.add('al-tab--active');
      show(p1); hide(p2);
    }
  }

  function renderResolved(list){
    const box = Q('aiResolvedList');
    if(!box) return;
    box.innerHTML = '';

    if(!Array.isArray(list) || list.length === 0){
      box.innerHTML = `
        <div class="al-muted" style="margin-top:10px;">
          No eligible resolved doubts found for this account.<br/>
          ✅ AI works only when: you are the ASKer + status RESOLVED + acceptedAnswer exists.
        </div>`;
      return;
    }

    for(const d of list){
      const item = document.createElement('div');
      item.className = 'al-item';
      const title = d.title || d.doubtTitle || ('Doubt #' + d.doubtId);
      const subject = d.subject || d.doubtSubject || '';
      const did = d.doubtId ?? d.id;

      item.innerHTML = `
        <div class="al-item__meta">
          <div class="al-item__title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="al-item__sub">${escapeHtml(subject)} • id: ${did}</div>
        </div>
        <button class="al-item__btn" type="button">Generate</button>
      `;

      const btn = item.querySelector('button');
      btn.addEventListener('click', async ()=>{
        try{
          btn.disabled = true;
          btn.textContent = 'Generating...';
          const out = await aiPost(`${API_BASE}/api/ai/explanations`, { doubtId: did });
          // expected: { explanationId, status } OR { id, status }
          state.explanationId = out.explanationId ?? out.id;
          state.doubtId = did;
          state.doubtTitle = title;

          Q('aiTabChat')?.removeAttribute('disabled');
          Q('aiChatMeta').textContent = `Doubt: ${title} (id: ${did})`;
          switchTab('chat');

          await loadMessages();
        } catch(e){
          console.error(e);
          alert(e.message || 'Failed to generate AI explanation');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Generate';
        }
      });

      box.appendChild(item);
    }
  }

  async function loadResolved(){
    const data = await aiGet(`${API_BASE}/api/ai/resolved?page=0&size=50`);
    // Spring Page response -> data.content
    const list = Array.isArray(data) ? data : (data?.content || []);
    renderResolved(list);
  }

  function renderMessages(msgs){
    const box = Q('aiChatMsgs');
    if(!box) return;
    box.innerHTML = '';
    for(const m of (msgs || [])){
      const sender = (m.sender || '').toUpperCase();
      const bubble = document.createElement('div');
      bubble.className = 'al-bubble ' + (sender === 'USER' ? 'al-bubble--user' : 'al-bubble--ai');
      bubble.textContent = m.message ?? m.text ?? '';
      box.appendChild(bubble);
    }
    box.scrollTop = box.scrollHeight;
  }

  async function loadMessages(){
    if(!state.explanationId) return;
    const msgs = await aiGet(`${API_BASE}/api/ai/explanations/${state.explanationId}/messages`);
    renderMessages(Array.isArray(msgs) ? msgs : (msgs?.content || msgs?.messages || []));
  }

  async function sendMessage(){
    const inp = Q('aiChatInput');
    const text = (inp?.value || '').trim();
    if(!text) return;
    if(!state.explanationId){
      alert('Generate an explanation first.');
      return;
    }
    inp.value = '';
    try{
      await aiPost(`${API_BASE}/api/ai/explanations/${state.explanationId}/messages`, { text });
      await loadMessages();
    }catch(e){
      console.error(e);
      alert(e.message || 'Send failed');
    }
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------------------------------------------------------------------------
  // ✅ AI for resolved private doubt-rooms (question-based rooms)
  // Your private room slug is: subject + "/doubt-q-" + questionId (Questions module)
  // The /api/ai/* endpoints are Doubts-module based (need doubtId), so calling them
  // with questionId gives "Doubt not found". For room-based AI, we must use:
  // POST /api/aiqa/explain  { questionId }
  // ---------------------------------------------------------------------------
  function extractQuestionIdFromRoom(room){
    if (!room) return null;
    const i = room.indexOf('doubt-q-');
    if (i === -1) return null;
    const part = room.substring(i + 'doubt-q-'.length).replace(/[^0-9].*$/, '');
    const n = Number(part);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function aiqaExplainForQuestion(questionId){
    const data = await authFetch(`${API_BASE}/api/aiqa/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId })
    });
    return data;
  }

  async function openAiForRoom(room){
    // Always open modal UI (so user sees chat pane)
    try { openAiModal(); } catch(e) { /* ignore */ }

    const qid = extractQuestionIdFromRoom(room);
    if (!qid){
      // fallback to old library mode
      try { await loadResolved(); } catch(e) {}
      switchTab('resolved');
      return;
    }

    // Use AIQA (question-based)
    switchTab('chat');
    const box = Q('aiChatBox');
    if (box) box.innerHTML = '<div style="opacity:.75">Generating AI explanation…</div>';

    try{
      const resp = await aiqaExplainForQuestion(qid);
      const text = resp?.explanation || '';
      const safe = escapeHtml(text).replace(/\n/g,'<br>');
      if (box) box.innerHTML = `<div class="ai-msg ai-ai">${safe || '<i>No explanation returned</i>'}</div>`;

      // disable follow-up input in this mode (no endpoint yet)
      const inp = Q('aiChatInput');
      const btn = Q('aiChatSendBtn');
      if (inp) { inp.value=''; inp.disabled = true; inp.placeholder = 'Follow-ups coming soon (AIQA mode)…'; }
      if (btn) btn.disabled = true;
    }catch(e){
      console.error(e);
      if (box) box.innerHTML = `<div class="ai-msg ai-ai">Failed to generate AI explanation. ${escapeHtml(e?.message || '')}</div>`;
    }
  }

  // Wire up once DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    // Ensure button + modal exist (HTML structure differs across pages)
    try { ensureAiModal(); } catch (e) {}
    // ✅ Global AI button removed: only show "Explain with AI" on RESOLVED posts.
    try { removeGlobalAiButtons(); } catch (e) {}
    // (removed) chat header AI button
Q('aiCloseBtn')?.addEventListener('click', closeModal);
    Q('aiModal')?.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.close) closeModal();
    });

    Q('aiTabResolved')?.addEventListener('click', () => switchTab('resolved'));
    Q('aiTabChat')?.addEventListener('click', () => switchTab('chat'));
    Q('aiChatSendBtn')?.addEventListener('click', sendMessage);
    Q('aiChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
    });
  });
})();
window.forceTestAI = async function () {
  const room = window.currentRoom; // eg: professional_design_ui_ux_design/dsa
  if (!room || !room.includes("doubt-q-")) {
    alert("Not a doubt room");
    return;
  }

  const doubtId = Number(room.split("doubt-q-")[1]);
  console.log("Testing AI for doubtId:", doubtId);

  const res = await fetch(`${API_BASE}/api/ai/explanations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + localStorage.getItem("token")
    },
    body: JSON.stringify({ doubtId })
  });

  const data = await res.json();
  console.log("AI TEST RESPONSE:", data);
};
// ===== Premium Confirm Modal =====
function showPremiumConfirm({ title, message, onConfirm }) {
  // remove if already exists
  const old = document.getElementById("premium-confirm-overlay");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "premium-confirm-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
  `;

  overlay.innerHTML = `
    <div style="
      width: 360px;
      max-width: 90%;
      background: linear-gradient(180deg,#1e1e2e,#141421);
      border-radius: 20px;
      padding: 22px;
      box-shadow: 0 30px 80px rgba(0,0,0,.6);
      color: #fff;
      animation: popScale .18s ease-out;
    ">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="
          width:44px;height:44px;border-radius:12px;
          background: linear-gradient(135deg,#f59e0b,#facc15);
          display:flex;align-items:center;justify-content:center;
          font-size:22px;
        ">⚠️</div>
        <div>
          <div style="font-size:16px;font-weight:600;">${title}</div>
          <div style="font-size:13px;opacity:.8;">This action can’t be undone</div>
        </div>
      </div>

      <div style="font-size:14px;opacity:.9;margin:14px 0 22px;">
        ${message}
      </div>

      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="pc-cancel" style="
          padding:10px 18px;
          border-radius:12px;
          border:none;
          background:#2a2a3c;
          color:#ccc;
          cursor:pointer;
        ">Cancel</button>

        <button id="pc-ok" style="
          padding:10px 20px;
          border-radius:12px;
          border:none;
          background: linear-gradient(135deg,#ec4899,#f472b6);
          color:#000;
          font-weight:600;
          cursor:pointer;
        ">Accept</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#pc-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#pc-ok").onclick = () => {
    overlay.remove();
    onConfirm && onConfirm();
  };
}

// animation
const style = document.createElement("style");
style.innerHTML = `
@keyframes popScale {
  from { transform: scale(.92); opacity:0 }
  to { transform: scale(1); opacity:1 }
}`;
document.head.appendChild(style);