// Lógica del chat movida desde tu chat.html original
// Requiere <script src="/socket.io/socket.io.js"></script> antes

(function () {
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
  const seenIds = new Set();
  const seenKeys = new Set();
  const fp = (m) => `fp:${(m.roomCode || '')}|${(m.name || '')}|${(m.text || '')}|${Math.floor(Number(m.when || 0) / 1000)}`;

  const $ = (q, el = document) => el.querySelector(q);
  const escapeHTML = (s) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c]));
  const ts = () => Date.now();
  const fmtTime = (t) => { const d = new Date(t); const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0'); return `${hh}:${mm}`; };
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1400); };

  const DEFAULT_ROOM = 'GLOBAL';
  const app = {
    playerName: sessionStorage.getItem('playerName') || '',
    roomCode: new URL(location.href).searchParams.get('room')
      || sessionStorage.getItem('gameRoomCode')
      || DEFAULT_ROOM,
    typingTimer: null,
    currentTyping: null,
  };
  if (!app.playerName) {
    const nick = prompt("Tu nombre para el chat", "") || "";
    app.playerName = (nick.trim() || ("Anónimo " + Math.floor(Math.random() * 1000)));
    sessionStorage.setItem('playerName', app.playerName);
  }

  const connDot = $("#connDot");
  const roomLabel = $("#roomLabel");
  const input = $("#messageInput");
  const sendBtn = $("#sendBtn");
  const ul = $("#messages");

  // Si se insertan nodos o cambian alturas, volvemos a bajar
const mo = new MutationObserver(() => scrollToBottomSoon());
mo.observe(ul, { childList: true, subtree: false });
window.addEventListener('load', scrollToBottomSoon);
window.addEventListener('resize', scrollToBottomSoon);
input.addEventListener('focus', scrollToBottomSoon);


  // --- AUTOSCROLL ROBUSTO ---
function scrollToBottomHard() {
  // 1) método clásico
  try { ul.scrollTop = ul.scrollHeight; } catch {}

  // 2) garantizamos con scrollIntoView al último <li>
  try { ul.lastElementChild?.scrollIntoView({ block: 'end', inline: 'nearest' }); } catch {}

  // 3) por si el scroller real fuera un contenedor padre (edge cases)
  try { ul.parentElement && (ul.parentElement.scrollTop = ul.parentElement.scrollHeight); } catch {}
  try { document.scrollingElement && (document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight); } catch {}
}

function scrollToBottomSoon() {
  // Llamamos varias veces en distintos ticks para cubrir repaints
  requestAnimationFrame(scrollToBottomHard);
  setTimeout(scrollToBottomHard, 0);      // siguiente macrotarea
  setTimeout(scrollToBottomHard, 16);     // ~1 frame
  setTimeout(scrollToBottomHard, 32);     // ~2 frames (fonts/images tardías)
}


  const typing = $("#typing");
  const typingName = $("#typingName");

  function updateRoomLabel() {
    roomLabel.textContent = (app.roomCode === DEFAULT_ROOM) ? "Sala global" : `Sala #${app.roomCode}`;
  }
  updateRoomLabel();

  function storageKey(room) { return `chat:${room}`; }
  function loadHistory() {
    const raw = localStorage.getItem(storageKey(app.roomCode));
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  }
  function saveMessage(msg) {
    const arr = loadHistory();
    const key = fp(msg);
    const exists = arr.some(m => (m.id && msg.id && m.id === msg.id) || fp(m) === key);
    if (!exists) {
      arr.push(msg);
      while (arr.length > 200) arr.shift();
      localStorage.setItem(storageKey(app.roomCode), JSON.stringify(arr));
    }
  }
  function restoreHistory() {
    const arr = loadHistory();
    seenIds.clear();
    seenKeys.clear();
    arr.forEach(m => { if (m.id) seenIds.add(m.id); seenKeys.add(fp(m)); });

    ul.innerHTML = "";
    if (arr.length) {
      const div = document.createElement('div');
      div.className = 'time-divider';
      div.textContent = 'Historial';
      ul.appendChild(div);
    }
    arr.forEach(renderMessage);
    scrollToBottomSoon();
  }
  function scrollToBottom() { ul.scrollTop = ul.scrollHeight + 9999; }

  function renderSystem(text) {
    const li = document.createElement('li');
    li.className = 'system';
    li.textContent = text;
    ul.appendChild(li);
    scrollToBottom();
  }

  function scrollToBottomSoon() {
  requestAnimationFrame(scrollToBottom);
  setTimeout(scrollToBottom, 0);
}


  let joined = false;
  const outbox = [];
  const liById = new Map();

  function mark(li, clsAdd = [], clsRemove = []) {
    clsRemove.forEach(c => li.classList.remove(c));
    clsAdd.forEach(c => li.classList.add(c));
  }

  function renderMessage(msg, { pending = false } = {}) {
    const isMe = (msg.name === app.playerName);
    const li = document.createElement('li');
    li.className = `item ${isMe ? 'me' : ''} ${pending ? 'pending' : ''}`;
    li.dataset.id = msg.id || '';
    li.innerHTML = `
      <div class="avatar" aria-hidden="true">${escapeHTML(msg.name[0]?.toUpperCase() || '?')}</div>
      <div class="bubble">
        <div class="body">${escapeHTML(msg.text)}</div>
        <div class="meta">
          <span class="name ${isMe ? 'you' : ''}">${isMe ? 'Tú' : escapeHTML(msg.name)}</span>
          <span>•</span>
          <time datetime="${new Date(msg.when).toISOString()}">${fmtTime(msg.when)}</time>
          <span class="status">${pending ? 'Enviando…' : ''}</span>
        </div>
      </div>`;
    ul.appendChild(li);
    if (msg.id) liById.set(msg.id, li);
    scrollToBottomSoon();
    return li;
  }

  const socket = io();

  function joinChat(room) {
    app.roomCode = room || DEFAULT_ROOM;
    updateRoomLabel();
    ul.innerHTML = "";
    restoreHistory();
    socket.emit("joinChatRoom", { roomCode: app.roomCode, playerName: app.playerName });
    history.replaceState(null, "", app.roomCode === DEFAULT_ROOM ? "chat.html" : `chat.html?room=${encodeURIComponent(app.roomCode)}`);
  }

  socket.on("connect", () => {
    connDot.classList.remove("offline"); connDot.classList.add("online");
    toast("Conectado");
    joinChat(app.roomCode);
  });

  socket.on("disconnect", () => {
    connDot.classList.remove("online"); connDot.classList.add("offline");
    joined = false;
    toast("Desconectado");
  });

  socket.on("chatJoined", ({ roomCode, membersCount }) => {
    joined = true;
    // renderSystem(`Te uniste a ${roomCode === 'GLOBAL' ? 'la sala global' : `la sala #${roomCode}`} (${membersCount || '?'} conectados)`);
    while (outbox.length) {
      const m = outbox.shift();
      socket.emit("chatMessage", m);
    }
  });

  //socket.on("chatSystem", ({ text }) => renderSystem(text));

  socket.on("chatMessage", (msg) => {
    if (msg.id) {
      const li = liById.get(msg.id);
      if (li) {
        const st = li.querySelector('.status');
        if (st) st.textContent = '';
        mark(li, [], ['pending', 'failed']);
        return;
      }
    }
    const key = fp(msg);
    if ((msg.id && seenIds.has(msg.id)) || seenKeys.has(key)) return;

    if (msg.id) seenIds.add(msg.id);
    seenKeys.add(key);
    saveMessage(msg);
    renderMessage(msg);
    scrollToBottomSoon();
  });

  socket.on("chatTyping", ({ name, isTyping }) => {
    if (name === app.playerName) return;
    if (isTyping) {
      typingName.textContent = name;
      typing.classList.add("show");
      if (app.currentTyping) clearTimeout(app.currentTyping);
      app.currentTyping = setTimeout(() => typing.classList.remove("show"), 1800);
    } else {
      typing.classList.remove("show");
    }
  });

  socket.on("chatClear", ({ roomCode }) => {
    try { localStorage.removeItem(`chat:${roomCode}`); } catch {}
    ul.innerHTML = "";
    renderSystem("El historial de la sala fue limpiado");
  });

  // Envío
  function typingOn() {
    socket.emit("chatTyping", { roomCode: app.roomCode, name: app.playerName, isTyping: true });
    typingOffSoon();
  }
  function typingOffSoon() {
    if (app.typingTimer) clearTimeout(app.typingTimer);
    app.typingTimer = setTimeout(() => {
      socket.emit("chatTyping", { roomCode: app.roomCode, name: app.playerName, isTyping: false });
    }, 900);
  }
  function send() {
    const text = input.value.trim();
    if (!text) return;
    const msg = { id: uuid(), roomCode: app.roomCode, name: app.playerName, text, when: ts() };

    renderMessage(msg, { pending: true });
    if (msg.id) seenIds.add(msg.id);
    seenKeys.add(fp(msg));
    saveMessage(msg);

    if (!socket.connected || !joined) { outbox.push(msg); return; }
    socket.emit("chatMessage", msg);

    input.value = "";
    typingOffSoon();
    scrollToBottomSoon();
  }

  $("#sendBtn").addEventListener('click', send);
  $("#messageInput").addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); send(); return; }
    typingOn();
  });
  $("#messageInput").addEventListener('input', typingOn);

  // Back/volver
  document.getElementById('backBtn').addEventListener('click', () => {
    if (window.self !== window.top) {
      parent.postMessage({ type: 'closeChatIframe' }, '*');
    } else {
      if (history.length > 1) history.back(); else location.href = '/';
    }
  });

  // Cambiar sala
  $("#switchRoomBtn").addEventListener('click', () => {
    const code = prompt("Ingresá un código de sala para chatear con tu grupo.\nDejalo vacío para sala GLOBAL:", "");
    const next = (code || "").trim().toUpperCase();
    const room = next || DEFAULT_ROOM;
    joinChat(room);
    toast(next ? `Cambiado a sala #${room}` : "Cambiado a sala global");
  });

  // Primera carga
  restoreHistory();
})();
