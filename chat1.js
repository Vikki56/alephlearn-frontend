// chat.js — single-init guard (prevents double attachment)
if (!window.__ALEPH_CHAT_INIT__) {
  window.__ALEPH_CHAT_INIT__ = true;

  (() => {
    'use strict';

    // ---------- helpers ----------
    const $ = (id) => document.getElementById(id);
    const escapeHtml = (s='') => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const timeLabel  = (ts) => ts ? new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

    // client id
    const CLIENT_ID =
      localStorage.getItem('clientId') ||
      (() => { const id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
               localStorage.setItem('clientId', id); return id; })();

    // ---------- API/WS endpoints (configurable) ----------
    // Set once via devtools if needed: localStorage.backendOrigin = "http://localhost:8080"
    const OVERRIDE = (localStorage.getItem('backendOrigin') || '').trim(); // e.g. "https://api.example.com"
    const SAME_ORIGIN = location.origin;

    const isFile = location.origin === 'null' || location.protocol === 'file:';
    const looksLikeDevPort = /:\d+$/.test(SAME_ORIGIN) && !SAME_ORIGIN.endsWith(':8080');

    const API_BASE = OVERRIDE || (isFile || looksLikeDevPort ? 'http://localhost:8080' : SAME_ORIGIN);

    const WS_URL = API_BASE.replace(/^http:/,'ws:').replace(/^https:/,'wss:') + '/ws/chat';

    // ---------- state ----------
    let ws;
    let currentRoom = 'cs/java-programming'; // default
    let currentUser = localStorage.getItem('displayName') || 'You';

    // reply & optimistic maps
    let replyingTo = null;                  // { id, user, text } or null
    const pendingByTs = new Map();          // ts -> message DOM node

    // ---------- modals ----------
    function showEditModal(initialText = '') {
      return new Promise((resolve) => {
        const modal = $('editModal');
        const input = $('editInput');
        const okBtn = modal.querySelector('[data-ok]');
        const cancelBtn = modal.querySelector('[data-cancel]');
        const closeBtn = modal.querySelector('[data-close]');

        function close(val) {
          modal.classList.remove('show');
          setTimeout(() => { modal.style.display = 'none'; }, 50);
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          closeBtn.removeEventListener('click', onCancel);
          document.removeEventListener('keydown', onKey);
          resolve(val);
        }
        function onOk()     { close(input.value); }
        function onCancel() { close(null); }
        function onKey(e)   { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && !e.shiftKey) onOk(); }

        input.value = initialText;
        modal.style.display = 'block';
        requestAnimationFrame(() => modal.classList.add('show'));
        setTimeout(() => input.focus(), 50);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
      });
    }

    function showConfirmModal({ title = 'Delete message', message = 'Are you sure?', okText = 'Delete' } = {}) {
      return new Promise((resolve) => {
        const modal = $('confirmModal');
        const okBtn = modal.querySelector('[data-ok]');
        const cancelBtn = modal.querySelector('[data-cancel]');
        const closeBtn = modal.querySelector('[data-close]');
        const titleEl = $('confirmTitle');
        const msgEl = $('confirmMessage');

        titleEl.textContent = title;
        msgEl.textContent = message;
        okBtn.textContent = okText;

        function close(val){
          modal.classList.remove('show');
          setTimeout(()=>{ modal.style.display='none'; }, 50);
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          closeBtn.removeEventListener('click', onCancel);
          document.removeEventListener('keydown', onKey);
          resolve(val);
        }
        function onOk(){ close(true); }
        function onCancel(){ close(false); }
        function onKey(e){ if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && !e.shiftKey) onOk(); }

        modal.style.display='block';
        requestAnimationFrame(()=> modal.classList.add('show'));
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
      });
    }

    // ---------- reply helpers ----------
    function renderReplyBar() {
      const holder = $('replyBar');
      if (!holder) return;
      if (!replyingTo) { holder.innerHTML = ''; holder.style.display = 'none'; return; }

      const { user, text } = replyingTo;
      const short = (text || '').length > 90 ? (text || '').slice(0, 90) + '…' : (text || '');
      holder.innerHTML = `
        <div class="reply-chip">
          <div class="reply-mark"></div>
          <div class="reply-meta"><b>${escapeHtml(user || 'Anon')}</b><div class="reply-text">${escapeHtml(short)}</div></div>
          <button class="reply-cancel" title="Cancel">✖</button>
        </div>`;
      holder.querySelector('.reply-cancel')?.addEventListener('click', () => { replyingTo = null; renderReplyBar(); });
      holder.style.display = 'block';
    }

    function renderReplyPiece(reply) {
      if (!reply) return '';
      const short = (reply.text || '').length > 80 ? reply.text.slice(0,80) + '…' : (reply.text || '');
      return `
        <div class="reply-inline" data-reply="${reply.id || ''}">
          <div class="reply-mark sm"></div>
          <div class="reply-inline-text"><b>${escapeHtml(reply.user || 'Anon')}</b> — ${escapeHtml(short)}</div>
        </div>`;
    }

    function buildReplyPreviewFromDOM(id) {
      const parent = document.querySelector(`.msg[data-id="${id}"]`);
      if (!parent) return null;
      return {
        id,
        user: parent.querySelector('.meta b')?.textContent || 'Anon',
        text: parent.querySelector('.msg-text')?.textContent || ''
      };
    }

    // ---------- popup menu + attachHold (WITH Pin/Unpin) ----------
    let _menuEl = null, _menuBackdrop = null;

    function hideMsgMenu() {
      _menuEl?.remove(); _menuEl = null;
      _menuBackdrop?.remove(); _menuBackdrop = null;
    }

    function showMsgMenu(x, y, actions) {
      hideMsgMenu();

      const backdrop = document.createElement('div');
      backdrop.className = 'msg-menu-backdrop';
      backdrop.addEventListener('click', hideMsgMenu, { once: true });
      document.body.appendChild(backdrop);
      _menuBackdrop = backdrop;

      const menu = document.createElement('div');
      menu.className = 'msg-menu';
      menu.tabIndex = -1;

      actions.forEach((a) => {
        if (a === 'divider') {
          const div = document.createElement('div');
          div.className = 'divider';
          menu.appendChild(div);
          return;
        }
        const btn = document.createElement('button');
        btn.className = 'item';
        btn.innerHTML = `${a.icon ?? ''}<span>${a.label}</span>`;
        btn.addEventListener('click', () => { hideMsgMenu(); a.onClick?.(); });
        menu.appendChild(btn);
      });

      document.body.appendChild(menu);
      _menuEl = menu;

      const { innerWidth: W, innerHeight: H } = window;
      const rect = menu.getBoundingClientRect();
      const pad = 8;
      let left = x, top = y;
      if (left + rect.width + pad > W) left = Math.max(pad, W - rect.width - pad);
      if (top + rect.height + pad > H) top = Math.max(pad, H - rect.height - pad);
      menu.style.left = left + 'px';
      menu.style.top  = top + 'px';

      const onEsc = (ev) => { if (ev.key === 'Escape') { hideMsgMenu(); window.removeEventListener('keydown', onEsc); } };
      window.addEventListener('keydown', onEsc);
    }

    function attachHold(messageEl, { id, isMine }) {
      if (!messageEl) return;
      const bubble = messageEl.querySelector('.msg-bubble') || messageEl;

      const actions = () => {
        const base = [
          {
            icon: '↩︎',
            label: 'Reply',
            onClick: () => {
              const user = bubble.querySelector('.meta b')?.textContent || 'Anon';
              const text = bubble.querySelector('.msg-text')?.textContent || '';
              replyingTo = { id, user, text };
              renderReplyBar();
            },
          },
        ];

        // Pin/Unpin for any message
        if (id) {
          const pinnedNow = messageEl.classList.contains('is-pinned');
          base.push({
            icon: '📌',
            label: pinnedNow ? 'Unpin' : 'Pin',
            onClick: () => togglePin(id, !pinnedNow),
          });
        }

        if (isMine) {
          base.push('divider');
          base.push({
            icon: '✏️',
            label: 'Edit',
            onClick: () =>
              id &&
              promptEdit(
                id,
                bubble.querySelector('.msg-text')?.textContent ?? ''
              ),
          });
          base.push({
            icon: '🗑️',
            label: 'Delete',
            onClick: () => id && confirmDelete(id),
          });
        }

        return base;
      };

      // Right-click
      bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMsgMenu(e.clientX, e.clientY, actions());
      });

      // Long-press
      let pressTimer = null;
      const start = (e) => {
        const pt = ('touches' in e) ? e.touches[0] : e;
        pressTimer = setTimeout(() => showMsgMenu(pt.clientX, pt.clientY, actions()), 450);
      };
      const cancel = () => { clearTimeout(pressTimer); pressTimer = null; };

      bubble.addEventListener('mousedown', start);
      bubble.addEventListener('touchstart', start, { passive: true });
      ['mouseup','mouseleave','mousemove','touchend','touchcancel'].forEach(ev => bubble.addEventListener(ev, cancel));
    }

    // ---------- websocket ----------
    function connect() {
      try { ws?.close?.(); } catch {}
      ws = new WebSocket(WS_URL);

      // re-join current room on reconnect without clearing UI
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', room: currentRoom, user: currentUser }));
      };

      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (!msg?.type) return;
        if (msg.type === 'join-ack') return;

        if (msg.type === 'message') {
          // upgrade my optimistic echo
          if (msg.clientId && msg.clientId === CLIENT_ID) {
            const el = pendingByTs.get(msg.ts);
            if (el) {
              el.dataset.id = String(msg.id);
              attachHold(el, { id: msg.id, isMine: true });
              pendingByTs.delete(msg.ts);
            }
            return;
          }

          let reply = null;
          if (msg.replyToId) {
            const parent = document.querySelector(`.msg[data-id="${msg.replyToId}"]`);
            reply = parent
              ? {
                  id: msg.replyToId,
                  user: parent.querySelector('.meta b')?.textContent || 'Anon',
                  text: parent.querySelector('.msg-text')?.textContent || ''
                }
              : { id: msg.replyToId, user: 'Reply', text: '' };
          }

          const el = addIncomingMessage(
            msg.user || 'Anon',
            msg.text || '',
            msg.ts,
            msg.id,
            !!msg.deleted,
            msg.editedAt,
            reply
          );
          if (el) attachHold(el, { id: msg.id, isMine: false });
          return;
        }

        if (msg.type === 'edit') {
          const wrap = document.querySelector(`.msg[data-id="${msg.id}"]`);
          if (!wrap) return;
          const textEl = wrap.querySelector('.msg-text');
          const metaEl = wrap.querySelector('.meta');
          if (textEl) textEl.textContent = msg.text || '';
          if (metaEl && !/edited/.test(metaEl.textContent)) metaEl.textContent += ' · edited';
          return;
        }

        if (msg.type === 'delete') {
          const wrap = document.querySelector(`.msg[data-id="${msg.id}"]`);
          if (!wrap) return;
          const textEl = wrap.querySelector('.msg-text');
          if (textEl) textEl.innerHTML = '<i>[deleted]</i>';
          return;
        }

        if (msg.type === 'pin') {
          // Re-sync the tray from server state (simple & robust)
          loadPinned(currentRoom);

          // Also update the single message immediately for better UX
          const node = document.querySelector(`.msg[data-id="${msg.id}"]`);
          if (node) {
            node.classList.toggle('is-pinned', !!msg.pinned);
            const meta = node.querySelector('.meta');
            const existing = meta?.querySelector('.pin-chip');
            if (msg.pinned) {
              if (meta && !existing) {
                const chip = document.createElement('span');
                chip.className = 'pin-chip';
                chip.textContent = '📌';
                meta.appendChild(chip);
              }
            } else {
              existing?.remove();
            }
          }
          return;
        }
      };

      ws.onclose = () => setTimeout(connect, 2000);
      ws.onerror  = (e) => console.error('[ws] error', e);
    }

    // ---------- rooms / history ----------
    const roomKeyOf = (r) => `${r.subject}/${r.slug}`;
    const roomLabelFromKey = (key) => {
      const [subject, slug=''] = key.split('/');
      return `${(subject||'').toUpperCase()} • ${slug.replace(/-/g,' ')}`;
    };

    async function loadRooms(subject, q='') {
      try {
        const res = await fetch(`${API_BASE}/api/rooms?subject=${encodeURIComponent(subject)}&q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`rooms HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.error('loadRooms failed:', err);
        return [];
      }
    }

    async function renderRooms() {
      const ul = $('groupList'), subjectSel = $('subjectSelect'), search = $('roomSearch');
      if (!ul || !subjectSel) return;

      const subject = subjectSel.value || 'cs';
      const query = (search?.value || '').trim();
      const data = await loadRooms(subject, query);

      ul.innerHTML = '';
      data.forEach(r => {
        const key = roomKeyOf(r);
        const li = document.createElement('li');
        li.className = 'sg-item' + (key === currentRoom ? ' active' : '');
        li.innerHTML = `
          <div class="sg-icon">${r.subject.slice(0,2).toUpperCase()}</div>
          <div>
            <div class="sg-title">${escapeHtml(r.title)}</div>
            <div class="sg-sub">${(r.memberCount ?? 0)} active</div>
          </div>
          <div class="sg-dot"></div>`;
        li.addEventListener('click', () => {
          document.querySelectorAll('.sg-item').forEach(n => n.classList.remove('active'));
          li.classList.add('active');
          joinRoom(key, currentUser, { keepExisting: false });
        });
        ul.appendChild(li);
      });
    }

    async function loadHistory(roomId) {
      try {
        const res = await fetch(`${API_BASE}/api/chat/history/${roomId}?limit=50`);
        if (!res.ok) throw new Error(`history HTTP ${res.status}`);
        const messages = await res.json(); // newest first
        const list = $('messageList'); if (!list) return;
        list.innerHTML = '';
        for (const m of messages.reverse()) {
          const t = new Date(m.ts).getTime();
          const mine = (m.clientId && m.clientId === CLIENT_ID);

          let reply = null;
          if (m.replyToId) {
            const parent = document.querySelector(`.msg[data-id="${m.replyToId}"]`);
            reply = parent ? {
              id: m.replyToId,
              user: parent.querySelector('.meta b')?.textContent || 'Anon',
              text: parent.querySelector('.msg-text')?.textContent || ''
            } : { id: m.replyToId, user: 'Reply', text: '' };
          }

          const fn = mine ? addOutgoingMessage : addIncomingMessage;
          const el = fn(m.userName || 'Anon', m.text || '', t, m.id, !!m.deleted, m.editedAt, reply);
          if (el) attachHold(el, { id: m.id, isMine: mine });
        }
      } catch (e) {
        console.error('Failed to load history:', e);
      }
    }

    // --- PIN helpers ---
    async function loadPinned(roomId) {
      try {
        const res = await fetch(`${API_BASE}/api/chat/pinned/${roomId}?limit=5`);
        if (!res.ok) throw new Error(`pinned HTTP ${res.status}`);
        const pins = await res.json(); // [{id,userName,text,ts,replyToId,...}]
        renderPinned(pins);
      } catch (e) {
        console.error('Failed to load pinned:', e);
        renderPinned([]); // hide tray on error
      }
    }

    function renderPinned(pins) {
      const tray = document.getElementById('pinnedTray');
      if (!tray) return;

      if (!pins || pins.length === 0) {
        tray.hidden = true;
        tray.style.display = 'none';
        tray.innerHTML = '';
        // also clear any pin chips on messages
        document.querySelectorAll('.msg.is-pinned').forEach(n => n.classList.remove('is-pinned'));
        document.querySelectorAll('.pin-chip').forEach(n => n.remove());
        return;
      }

      // Build the tray
      tray.innerHTML = `
        <strong>📌 Pinned</strong>
        ${pins.map(p => `
          <div class="pin-item" data-id="${p.id}">
            <span class="pin-text"><b>${escapeHtml(p.userName || 'Anon')}</b> — ${escapeHtml((p.text||'').length>80 ? p.text.slice(0,80)+'…' : (p.text||''))}</span>
            <span class="pin-meta">${timeLabel(new Date(p.ts).getTime())}</span>
          </div>
        `).join('')}
      `;
      tray.hidden = false;
      tray.style.display = 'block';

      // Clicking a pin scrolls to the message
      tray.querySelectorAll('.pin-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id');
          if (!id) return;
          const target = document.querySelector(`.msg[data-id="${id}"]`);
          target?.scrollIntoView({ behavior:'smooth', block:'center' });
          target?.classList.add('pulse'); setTimeout(()=>target?.classList.remove('pulse'), 800);
        });
      });

      // Visually mark pinned messages in the list + add a tiny chip
      pins.forEach(p => {
        const node = document.querySelector(`.msg[data-id="${p.id}"]`);
        if (!node) return;
        node.classList.add('is-pinned');
        const meta = node.querySelector('.meta');
        if (meta && !meta.querySelector('.pin-chip')) {
          const chip = document.createElement('span');
          chip.className = 'pin-chip';
          chip.textContent = '📌';
          meta.appendChild(chip);
        }
      });
    }

    function togglePin(id, pinned) {
      if (!id || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'pin', id, pinned: !!pinned }));
    }

    async function joinRoom(roomId, user = currentUser, opts = { keepExisting: false }) {
      const switchingRooms = roomId !== currentRoom;
      currentRoom = roomId;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join', room: roomId, user }));
      }

      const titleEl = $('roomTitle');
      if (titleEl) titleEl.textContent = roomLabelFromKey(roomId);

      const subEl = $('roomSub');
      if (subEl) subEl.textContent = 'members online • Sarah is typing…';

      if (switchingRooms && !opts.keepExisting) {
        const listEl = $('messageList');
        if (listEl) listEl.innerHTML = '';
      }

      if (switchingRooms) {
        await loadHistory(roomId);
        await loadPinned(roomId);   // ensure pinned tray syncs on room change
      }
    }

    // ---------- send ----------
    function sendToRoom(text) {
      if (!text || ws?.readyState !== WebSocket.OPEN) return;

      const replyToId = replyingTo?.id ?? null;

      const payload = {
        type: 'message',
        room: currentRoom,
        text,
        user: currentUser,
        ts: Date.now(),
        clientId: CLIENT_ID,
        ...(replyToId ? { replyToId } : {})
      };

      ws.send(JSON.stringify(payload));

      // optimistic render
      const preview = replyToId ? buildReplyPreviewFromDOM(replyToId) : null;
      const el = addOutgoingMessage(currentUser, text, payload.ts, null, false, undefined, preview);
      if (el) {
        pendingByTs.set(payload.ts, el);
        attachHold(el, { id: null, isMine: true }); // will upgrade on echo
      }

      replyingTo = null;
      const holder = $('replyBar');
      if (holder) { holder.innerHTML = ''; holder.style.display = 'none'; }
    }

    // ---------- render messages ----------
    function addIncomingMessage(user, text, ts, id, deleted=false, editedAt, reply=null) {
      const list = $('messageList'); if (!list) return null;
      const wrap = document.createElement('div');
      wrap.className = 'msg';
      wrap.dataset.id = id ?? '';
      wrap.innerHTML = `
        <div class="avatar-sm">${(user||'U').slice(0,2).toUpperCase()}</div>
        <div class="msg-bubble">
          ${renderReplyPiece(reply)}
          <div class="meta"><b>${escapeHtml(user)}</b> · ${timeLabel(ts)} ${editedAt ? '· edited' : ''}</div>
          <div class="msg-text">${deleted ? '<i>[deleted]</i>' : escapeHtml(text)}</div>
        </div>`;
      list.appendChild(wrap);
      list.scrollTop = list.scrollHeight;

      wrap.querySelector('.reply-inline')?.addEventListener('click', (e)=>{
        const id = e.currentTarget.getAttribute('data-reply');
        if (!id) return;
        const target = document.querySelector(`.msg[data-id="${id}"]`);
        target?.scrollIntoView({behavior:'smooth', block:'center'});
        target?.classList.add('pulse'); setTimeout(()=>target?.classList.remove('pulse'), 800);
      });

      return wrap;
    }

    function addOutgoingMessage(user, text, ts, id, deleted=false, editedAt, reply=null) {
      const list = $('messageList'); if (!list) return null;
      const wrap = document.createElement('div');
      wrap.className = 'msg me';
      wrap.dataset.id = id ?? '';
      wrap.innerHTML = `
        <div class="msg-bubble">
          ${renderReplyPiece(reply)}
          <div class="meta"><b>${escapeHtml(user)}</b> · ${timeLabel(ts)} ${editedAt ? '· edited' : ''}</div>
          <div class="msg-text">${deleted ? '<i>[deleted]</i>' : escapeHtml(text)}</div>
        </div>
        <div class="avatar-sm">${(user||'U').slice(0,2).toUpperCase()}</div>`;
      list.appendChild(wrap);
      list.scrollTop = list.scrollHeight;
      return wrap;
    }

    // ---------- edit / delete ----------
    async function promptEdit(id, oldText='') {
      if (!id) return;
      const next = await showEditModal(oldText);
      if (next == null) return;
      const trimmed = next.trim();
      if (trimmed === oldText.trim()) return;

      try {
        const res = await fetch(`${API_BASE}/api/chat/message/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, clientId: CLIENT_ID })
        });
        if (!res.ok) throw new Error('Edit failed');
        const el = document.querySelector(`.msg[data-id="${id}"] .msg-text`);
        const meta = document.querySelector(`.msg[data-id="${id}"] .meta`);
        if (el) el.textContent = trimmed;
        if (meta && !/edited/.test(meta.textContent)) meta.textContent += ' · edited';
        ws?.send(JSON.stringify({ type:'edit', id, text: trimmed, clientId: CLIENT_ID }));
      } catch (err) {
        console.error(err); alert('Edit failed');
      }
    }

    async function confirmDelete(id) {
      if (!id) return;
      const yes = await showConfirmModal({ title: 'Delete message', message: 'This action cannot be undone.', okText: 'Delete' });
      if (!yes) return;
      try {
        const res = await fetch(`${API_BASE}/api/chat/message/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: CLIENT_ID })
        });
        if (!res.ok && res.status !== 204) throw new Error('Delete failed');
        const el = document.querySelector(`.msg[data-id="${id}"] .msg-text`);
        if (el) el.innerHTML = '<i>[deleted]</i>';
        ws?.send(JSON.stringify({ type:'delete', id, clientId: CLIENT_ID }));
      } catch (err) {
        console.error(err); alert('Delete failed');
      }
    }

    // ---------- modal + create room ----------
    function openModal(show) {
      const modal = $('roomModal'); if (!modal) return;
      modal.style.display = show ? 'flex' : 'none';
      if (show) modal.querySelector('#roomTitleInput')?.focus();
    }

    async function createRoom() {
      const modal = $('roomModal'); if (!modal) return;
      const titleEl = modal.querySelector('#roomTitleInput');
      const subjEl  = modal.querySelector('#roomSubject');
      if (!titleEl || !subjEl) { alert('Modal fields not found'); return; }

      const title = titleEl.value.trim();
      const subject = subjEl.value || 'cs';
      if (!title) { alert('Please enter a room title'); return; }

      try {
        const res = await fetch(`${API_BASE}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, title, visibility: 'PUBLIC' })
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> '');
          alert(`Create failed (${res.status}): ${txt}`); return;
        }
        const room = await res.json();
        openModal(false);
        await renderRooms();
        joinRoom(`${room.subject}/${room.slug}`, currentUser, { keepExisting: false });
      } catch (e) {
        console.error(e);
        alert('Network error creating room. Is the backend running? API_BASE=' + API_BASE);
      }
    }

    // ---------- boot ----------
    window.addEventListener('DOMContentLoaded', () => {
      $('roomSearch')?.addEventListener('input', renderRooms);
      $('subjectSelect')?.addEventListener('change', renderRooms);
      $('newRoomBtn')?.addEventListener('click', () => openModal(true));
      $('closeModal')?.addEventListener('click', () => openModal(false));
      $('createRoom')?.addEventListener('click', createRoom);

      renderRooms();
      connect();
      joinRoom(currentRoom, currentUser, { keepExisting: false });

      const nameInput = $('displayName');
      if (nameInput) {
        nameInput.value = currentUser;
        nameInput.addEventListener('change', () => {
          const next = nameInput.value.trim() || 'Student';
          if (next !== currentUser) {
            currentUser = next;
            localStorage.setItem('displayName', currentUser);
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'join', room: currentRoom, user: currentUser }));
            }
          }
        });
      }

      const sendBtn = $('sendBtn');
      const input   = $('messageInput');
      sendBtn?.addEventListener('click', () => {
        const text = (input?.value || '').trim();
        if (text) { sendToRoom(text); input.value = ''; }
      });
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const text = (input?.value || '').trim();
          if (text) { sendToRoom(text); input.value = ''; }
        }
      });
    });

  })();
} else {
  console.warn('chat.js already initialized — skipping duplicate load');
}
