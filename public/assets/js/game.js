// Lado cliente: lógica del juego (online + offline), basada en tu HTML original
// Requiere que en el HTML esté cargado primero: <script src="/socket.io/socket.io.js"></script>
import { topics } from "./topics.js";
import { state } from "./state.js";
import {
  $,
  showScreen,
  showError,
  hideError,
  updateConnectionStatus,
  setNewGameVisibility,
} from "./ui.js";
import {
  markInRoom,
  markOutRoom,
  openChat,
  closeChatOverlay,
} from "./overlay.js";
import { getImageForItem } from "./images.js";

// === Helpers para custom-selects (categoría / subtema) ===
const CATEGORY_LABELS = {
  Fútbol: "⚽ Fútbol",
  animales: "🐾 Animales",
  películas: "🎬 Películas",
  cantantes: "🎤 Cantantes",
};

function buildOptions(containerEl, items) {
  containerEl.innerHTML = "";
  items.forEach(({ value, label }) => {
    const opt = document.createElement("div");
    opt.className = "custom-select-option";
    opt.dataset.value = value;
    opt.innerHTML = `<span>${label}</span>`;
    containerEl.appendChild(opt);
  });
}

function initCustomSelect(rootId, items, initialValue, onChange) {
  const root = document.getElementById(rootId);
  if (!root) return null;
  const trigger = root.querySelector(".custom-select-trigger");
  const optsBox = root.querySelector(".custom-select-options");

  buildOptions(
    optsBox,
    items.map((v) => ({ value: v, label: CATEGORY_LABELS[v] || v }))
  );

  const setValue = (val) => {
    root.dataset.value = val;
    trigger.querySelector("span").textContent = CATEGORY_LABELS[val] || val;
    if (typeof onChange === "function") onChange(val);
  };

  setValue(initialValue || items[0]);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    // cerrar otros abiertos
    document
      .querySelectorAll(".custom-select .custom-select-options.show")
      .forEach((box) => {
        if (!root.contains(box)) box.classList.remove("show");
      });
    document
      .querySelectorAll(".custom-select .custom-select-trigger.active")
      .forEach((tg) => {
        if (!root.contains(tg)) tg.classList.remove("active");
      });

    const isOpen = optsBox.classList.toggle("show");
    trigger.classList.toggle("active", isOpen);
  });

  optsBox.addEventListener("click", (e) => {
    const opt = e.target.closest(".custom-select-option");
    if (!opt) return;
    setValue(opt.dataset.value);
    optsBox.classList.remove("show");
    trigger.classList.remove("active");
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) {
      optsBox.classList.remove("show");
      trigger.classList.remove("active");
    }
  });

  return {
    get value() {
      return root.dataset.value;
    },
    setValue,
  };
}

function getFootballSubtopics() {
  const f = topics["Fútbol"];
  if (!f || typeof f !== "object") return [];
  return Object.keys(f); // usa tus etiquetas tal cual
}

function initSubtopicSelect(rootId, subtopics, initialValue, onChange) {
  const root = document.getElementById(rootId);
  if (!root) return null;
  const trigger = root.querySelector(".custom-select-trigger");
  const optsBox = root.querySelector(".custom-select-options");

  buildOptions(
    optsBox,
    subtopics.map((v) => ({ value: v, label: v }))
  );

  const setValue = (val) => {
    root.dataset.value = val;
    trigger.querySelector("span").textContent = val;
    if (typeof onChange === "function") onChange(val); // <<< avisa el cambio
  };

  setValue(initialValue || subtopics[0] || "⭐ Leyendas");

  // abrir/cerrar (alineado con tu CSS .show/.active)
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    document
      .querySelectorAll(".custom-select .custom-select-options.show")
      .forEach((box) => {
        if (!root.contains(box)) box.classList.remove("show");
      });
    document
      .querySelectorAll(".custom-select .custom-select-trigger.active")
      .forEach((tg) => {
        if (!root.contains(tg)) tg.classList.remove("active");
      });

    const isOpen = optsBox.classList.toggle("show");
    trigger.classList.toggle("active", isOpen);
  });

  optsBox.addEventListener("click", (e) => {
    const opt = e.target.closest(".custom-select-option");
    if (!opt) return;
    setValue(opt.dataset.value); // <<< actualiza estado
    optsBox.classList.remove("show");
    trigger.classList.remove("active");
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) {
      optsBox.classList.remove("show");
      trigger.classList.remove("active");
    }
  });

  return {
    get value() {
      return root.dataset.value;
    },
    setValue,
  };
}

function getWordsFromSelection({ category, subtopic, customWord }) {
  if (category === "personalizado") {
    const w = (customWord || "").trim();
    return w ? [w] : [];
  }
  if (category === "Fútbol") {
    const f = topics["Fútbol"] || {};
    return Array.isArray(f[subtopic]) ? f[subtopic] : [];
  }
  const base = topics[category];
  return Array.isArray(base) ? base : [];
}

///////////////////////
// Socket helpers
///////////////////////
function saveRoomCode(code) {
  state.roomCode = code;
  try {
    sessionStorage.setItem("gameRoomCode", code);
  } catch {}
  //console.log('✅ roomCode guardado:', state.roomCode);
}
function getRoomCode() {
  if (state.roomCode) return state.roomCode;
  try {
    const b = sessionStorage.getItem("gameRoomCode");
    if (b) {
      state.roomCode = b;
      return b;
    }
  } catch {}
  return "";
}

///////////////////////
// Inicializar Socket.IO cliente
///////////////////////
function initializeSocket() {
  if (state.socket) return;
  state.socket = io(); // o io("https://tu-backend.onrender.com")

  state.socket.on("connect", () => updateConnectionStatus("connected"));
  state.socket.on("disconnect", () => {
    updateConnectionStatus("disconnected");
    markOutRoom();
  });

  state.socket.on("roomCreated", (data) => {
    saveRoomCode(data.roomCode);
    state.gameMode = "online";
    state.isHost = true;
    state.playersInRoom = data.players;
    showWaitingRoom();
    markInRoom();
  });

  state.socket.on("roomJoined", (data) => {
    saveRoomCode(data.roomCode);
    state.isHost = data.isHost || false;
    state.playersInRoom = data.players;
    showWaitingRoom();
    markInRoom();
  });

  state.socket.on("playerJoined", (data) => {
    state.playersInRoom = data.players;
    updatePlayersInRoom();
  });

  state.socket.on("playerLeft", (data) => {
    state.playersInRoom = data.players;
    const me = data.players.find((p) => p.id === state.socket.id);
    state.isHost = !!(me && me.isHost);
    showWaitingRoom();
    updatePlayersInRoom();
  });

  state.socket.on("joinError", (m) => showError(m));

  // ✅ SOLO este listener para iniciar en simultáneo
  state.socket.on("gameStarted", (gameData) => {
    handleOnlineGameStartSimul(gameData);
  });

  state.socket.on("playersReady", ({ ready, total }) => {
    const gameCard = $("#gameCard");
    const info = gameCard?.querySelector(".ready-progress");
    if (info) info.textContent = `Listos: ${ready}/${total}`;
  });

  state.socket.on("allReady", () => {
    const readyBtn = document.getElementById("imReadyBtn");
    if (readyBtn) readyBtn.style.display = "none";
    const sp = document.getElementById("startPlayingBtn");
    if (sp) sp.style.display = "none";
    // El server enseguida va a emitir roundStarted
    showAllPlayersReady();
  });

  // cuando arranca una ronda
  // initializeSocket()
  state.socket.on("roundStarted", (data) => {
    const sp = document.getElementById("startPlayingBtn");
    if (sp) sp.style.display = "none";
    const readyBtn = document.getElementById("imReadyBtn");
    if (readyBtn) readyBtn.style.display = "none";

    state.roundInfo.round = data.round;
    state.roundInfo.order = data.order;
    state.roundInfo.currentSpeakerId = data.currentSpeakerId;
    state.roundInfo.activePlayers = data.activePlayers;
    state.roundInfo.submissions = {};
    renderRoundBoard();
  });

  // progreso de envíos (siguiente en turno)
  state.socket.on("submissionProgress", ({ submissions, currentSpeakerId }) => {
    if (submissions) state.roundInfo.submissions = submissions;
    if (currentSpeakerId !== undefined && currentSpeakerId !== null) {
      state.roundInfo.currentSpeakerId = currentSpeakerId;
    }
    renderRoundBoard();
  });

  // arranca votación
  state.socket.on("votingStarted", (payload) => {
    renderVotingBoard(payload);
  });

  // progreso de votos (opcional)
  state.socket.on("voteProgress", ({ votes, total }) => {
    const el = document.getElementById("voteHint");
    if (el) el.textContent = `Votos recibidos: ${votes}/${total}`;
  });

  // resultado de la votación
  state.socket.on(
    "votingResult",
    ({ eliminatedId, eliminatedName, eliminatedWasImpostor }) => {
      // Mostramos el banner en la UI actual (votación) antes de que arranque la próxima ronda
      showScreen("game");
      const gameCard = document.getElementById("gameCard");

      // Banner
      const banner = document.createElement("div");
      banner.className =
        "vote-result-banner" + (eliminatedWasImpostor ? " good" : "");
      banner.textContent = eliminatedWasImpostor
        ? `${eliminatedName} ERA el impostor 🟢`
        : `${eliminatedName} NO era impostor 🔴`;
      // Insertar arriba del todo
      gameCard.insertAdjacentElement("afterbegin", banner);

      // Marcar la tarjeta del eliminado si todavía está renderizada
      const card = gameCard.querySelector(
        `.player-card[data-id="${eliminatedId}"]`
      );
      if (card) {
        card.classList.add(
          "eliminated",
          eliminatedWasImpostor ? "right" : "wrong"
        );
      }

      // Nota: el server arranca la próxima ronda al toque (o tras un pequeño delay que agregamos abajo)
      // No hace falta limpiar; la próxima pantalla reemplaza el contenido de gameCard.
    }
  );

  // sin expulsión (empate doble / sin votos)
  state.socket.on("noElimination", ({ reason, tied }) => {
    // opcional mostrar mensaje; server ya inicia la próxima ronda
  });

  state.socket.on("gameResult", (data) => showOnlineResults(data));

  state.socket.on("error", (m) => {
    showError(m);
    const btn = $("#nextBtn");
    if (btn) btn.disabled = false;
  });

  // Hooks del overlay
  if (!state.socket._chatOverlayPatched) {
    state.socket.on("roomJoined", () => {
      markInRoom();
    });
    state.socket.on("roomCreated", () => {
      markInRoom();
    });
    state.socket.on("disconnect", () => {
      markOutRoom();
    });
    state.socket._chatOverlayPatched = true;
  }
}

function handleOnlineGameStartSimul(gameData) {
  state.playersInRoom = gameData.players || state.playersInRoom;
  state.players = state.playersInRoom.map((p) => p.name);

  // NO pises con null si sos impostor
  if (gameData.word) state.gameWord = gameData.word;

  // Guardar el tema (para saber la categoría al buscar imagen)
  state.currentTheme = gameData.theme || null;
  if (gameData.theme?.category) {
    state.selectedOnlineCategory = gameData.theme.category;
  }

  // Determinar si soy impostor según el rol per-user
  state.isImpostorMe = gameData.role === "impostor";

  // (Opcional) mantener índice/id si también vienen
  if (typeof gameData.impostorIndex === "number") {
    state.impostorIndex = gameData.impostorIndex;
  } else if (gameData.impostorId) {
    state.impostorIndex = state.playersInRoom.findIndex(
      (p) => p.id === gameData.impostorId
    );
  } else {
    state.impostorIndex = -1;
  }

  state.gameMode = "online";
  state.gameStarted = true;

  state.savedPlayers = state.players.slice();
  state.savedPlayers.forEach((n) => {
    if (state.playerScores[n] === undefined) state.playerScores[n] = 0;
  });

  showScreen("game");
  showOnlineRoleSimul();
  setNewGameVisibility();
}

// ===== Estado cliente para rondas
state.roundInfo = {
  round: 0,
  order: [],
  currentSpeakerId: null,
  submissions: {},
  activePlayers: [],
};

function isAlive(id) {
  return state.roundInfo.activePlayers.some((p) => p.id === id);
}

function renderRoundBoard() {
  showScreen("game");
  const meId = state.socket.id;
  const { round, order, currentSpeakerId, submissions, activePlayers } =
    state.roundInfo;

  const gameCard = $("#gameCard");
  const playersGrid = activePlayers
    .map((p) => {
      const submitted = submissions[p.id];
      const isSpeaker = currentSpeakerId === p.id;
      const me = p.id === meId;
      const badge = isSpeaker ? `<span class="badge">En turno</span>` : "";
      const content = submitted
        ? `<div class="submission">${submitted}</div>`
        : isSpeaker && me
        ? `<div class="submission input">
               <input id="mySubmission" type="text" maxlength="40" placeholder="Tu palabra..." />
               <button id="sendSubmission" class="btn btn-primary">Enviar</button>
             </div>`
        : `<div class="submission waiting">…</div>`;
      return `
      <div class="player-card ${isSpeaker ? "speaker" : ""}">
        <div class="player-name">${p.name} ${badge}</div>
        ${content}
      </div>
    `;
    })
    .join("");

  gameCard.innerHTML = `
    <div class="round-header">
      <h3>Ronda ${round}</h3>
      <p style="opacity:.7">Orden: ${order.map((o) => o.name).join(" → ")}</p>
    </div>
    <div class="players-grid">${playersGrid}</div>
    <p class="ready-progress" style="color: rgba(255,255,255,.75); margin-top:8px;"></p>
  `;

  const btn = document.getElementById("sendSubmission");
  if (btn) {
    btn.onclick = () => {
      const input = document.getElementById("mySubmission");
      const w = (input?.value || "").trim();
      if (!w) return;
      state.socket.emit("submitWord", { roomCode: state.roomCode, word: w });
      btn.disabled = true;
      btn.textContent = "Enviando…";
    };
  }
}

function renderVotingBoard({ eligible, submissions }) {
  showScreen("game");
  const active = state.roundInfo.activePlayers;
  if (submissions) state.roundInfo.submissions = submissions;

  const gameCard = $("#gameCard");
  const cards = active
    .map((p) => {
      const isEligible = eligible.includes(p.id);
      const clue = state.roundInfo.submissions[p.id];
      return `
      <div class="player-card vote ${
        isEligible ? "eligible" : "disabled"
      }" data-id="${p.id}">
        <div class="player-name">${p.name}</div>
        <div class="submission shown">${clue ? clue : "—"}</div>
      </div>
    `;
    })
    .join("");

  gameCard.innerHTML = `
    <div class="vote-banner">
      <strong>VOTACIÓN:</strong> tocá el jugador que querés expulsar.
      ${
        eligible.length !== active.length
          ? "<br>Re-votación entre empatados."
          : ""
      }
    </div>
    <div class="players-grid">${cards}</div>
    <div id="voteHint" style="margin-top:10px;"></div>
  `;

  gameCard.querySelectorAll(".player-card.vote.eligible").forEach((el) => {
    el.onclick = () => {
      const targetId = el.getAttribute("data-id");
      // marcar tu elección visualmente
      gameCard
        .querySelectorAll(".player-card.vote")
        .forEach((n) => n.classList.remove("picked"));
      el.classList.add("picked");

      state.socket.emit("castVote", { roomCode: state.roomCode, targetId });
      $("#voteHint").textContent = "Voto enviado. Esperando al resto…";
      // bloquear nuevas selecciones
      gameCard
        .querySelectorAll(".player-card.vote")
        .forEach((n) => n.classList.add("disabled"));
    };
  });
}

function showOnlineRoleSimul() {
  const me = state.playersInRoom.find((p) => p.id === state.socket.id);
  const myName = me?.name || state.playerName || "Vos";
  const isImpostor = !!state.isImpostorMe;

  const card = $("#gameCard");
  card.innerHTML = `
    <h3 id="playerNameDisplay">${myName}</h3>
    <div class="role-text ${
      isImpostor ? "impostor" : "player"
    }" id="roleDisplay">
      ${isImpostor ? "¡Sos el IMPOSTOR!" : "Sos JUGADOR"}
    </div>
    <div id="wordDisplay" class="word-display">
      ${
        isImpostor
          ? "¿Podés adivinar la palabra?"
          : (state.gameWord || "").toUpperCase()
      }
    </div>
    <p class="ready-progress" style="color: rgba(255,255,255,.75); margin-top:8px;"></p>
  `;

  // Ocultar botones viejos
  $("#showRoleBtn").style.display = "none";
  $("#hideBtn").style.display = "none";
  $("#nextBtn").style.display = "none";
  $("#startPlayingBtn").style.display = "none";

  // Reset del botón "Estoy listo"
  let readyBtn = document.getElementById("imReadyBtn");
  if (!readyBtn) {
    readyBtn = document.createElement("button");
    readyBtn.id = "imReadyBtn";
    readyBtn.className = "btn btn-secondary";
    readyBtn.onclick = playerReady;
    card.parentElement.appendChild(readyBtn);
  }
  readyBtn.disabled = false;
  readyBtn.textContent = "Estoy listo";
  readyBtn.style.display = "inline-block";

  // al final de showOnlineRoleSimul(), ANTES de ocultar/mostrar botones:
  if (!isImpostor) {
    const category = state.selectedOnlineCategory || "Fútbol";
    const subtopic = state.selectedOnlineSubtopic || "";
    getImageForItem(state.gameWord, category, { subtopic }).then((url) => {
      if (!url) return;
      const img = document.createElement("img");
      img.className = "word-image";
      img.alt = state.gameWord;
      img.src = url;
      img.referrerPolicy = "no-referrer";
      document.getElementById("gameCard")?.appendChild(img);
    });
  }
}

function playerReady() {
  const btn = document.getElementById("imReadyBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Listo ✓";
  }
  const roomCode =
    typeof getRoomCode === "function" ? getRoomCode() : state.roomCode;
  if (!roomCode || !state.socket || !state.socket.connected) return;
  state.socket.emit("playerReady", { roomCode });
}

///////////////////////
// Online UI + flujo
///////////////////////
function setPlayerName(mode) {
  const nameInput = $("#playerNameInput");
  const name = (nameInput?.value || "").trim();
  if (mode === "online") {
    if (!name) return showError("Por favor, ingresa tu nombre");
    state.playerName = name;
    try {
      sessionStorage.setItem("playerName", name);
    } catch {}
    state.gameMode = "online";
    showScreen("lobbyScreen");
    return;
  }
  state.gameMode = "offline";
  showScreen("setup");
}

function createRoom() {
  if (!state.socket) {
    initializeSocket();
    setTimeout(() => state.socket.emit("createRoom", state.playerName), 200);
  } else {
    state.socket.emit("createRoom", state.playerName);
  }
}

function joinRoom() {
  const roomCodeInput = $("#roomCodeInput").value.trim().toUpperCase();
  if (!roomCodeInput) return showError("Ingresa un código de sala");
  if (!state.socket) {
    initializeSocket();
    setTimeout(
      () =>
        state.socket.emit("joinRoom", {
          roomCode: roomCodeInput,
          playerName: state.playerName,
        }),
      200
    );
  } else {
    state.socket.emit("joinRoom", {
      roomCode: roomCodeInput,
      playerName: state.playerName,
    });
  }
}

function showWaitingRoom() {
  showScreen("waitingRoom");
  $("#roomCodeDisplay").textContent = getRoomCode() || state.roomCode || "";
  if (state.isHost) $("#hostControls").classList.remove("hidden");
  else $("#hostControls").classList.add("hidden");
  updatePlayersInRoom();
  setNewGameVisibility();
}

function updatePlayersInRoom() {
  const container = $("#playersInRoom");
  if (!state.playersInRoom.length) {
    container.innerHTML =
      '<p style="color: rgba(255,255,255,0.6);">No hay jugadores</p>';
    return;
  }
  container.innerHTML = state.playersInRoom
    .map(
      (p) => `
    <div class="online-player-item ${p.isHost ? "host" : ""}">
      <span>${p.name} ${p.isHost ? "👑" : ""}</span>
      <span class="player-status">${p.isHost ? "Anfitrión" : "Jugador"}</span>
    </div>`
    )
    .join("");
}

function initializeOnlineTopicSelect() {
  const trigger = $("#onlineTopicTrigger");
  const options = $("#onlineTopicOptions");
  if (!trigger || !options) return;

  trigger.addEventListener("click", () => {
    trigger.classList.toggle("active");
    options.classList.toggle("show");
  });

  options.addEventListener("click", (e) => {
    const option = e.target.closest(".custom-select-option");
    if (!option) return;
    document
      .querySelectorAll("#onlineTopicOptions .custom-select-option")
      .forEach((o) => o.classList.remove("selected"));
    option.classList.add("selected");

    const icon = option.querySelector(".option-icon").textContent;
    const text = option.querySelector("span:last-child").textContent;
    trigger.querySelector("span").innerHTML = `${icon} ${text}`;
    state.selectedOnlineTopic = option.getAttribute("data-value");

    trigger.classList.remove("active");
    options.classList.remove("show");
  });

  document.addEventListener("click", (e) => {
    if (
      !e.target.closest("#onlineTopicTrigger") &&
      !e.target.closest("#onlineTopicOptions")
    ) {
      trigger.classList.remove("active");
      options.classList.remove("show");
    }
  });
}

function startOnlineGame() {
  if (state.playersInRoom.length < 3)
    return showError("Necesitas al menos 3 jugadores para empezar");

  const category = state.selectedOnlineCategory || "Fútbol";
  const subtopic =
    category === "Fútbol"
      ? state.selectedOnlineSubtopic ||
        document.getElementById("onlineSubtopicSelect")?.dataset.value ||
        getFootballSubtopics()[0] ||
        "⭐ Leyendas"
      : null;

  const topic = category === "Fútbol" ? `Fútbol::${subtopic}` : category;

  //console.log('[DEBUG] startOnlineGame =>', { category, subtopic, topic });

  state.socket.emit("startGame", {
    roomCode: state.roomCode,
    topic, // compat (lleva el subtema sí o sí)
    theme: { category, subtopic }, // forma nueva
  });
}

function handleOnlineGameStart(gameData) {
  state.playersInRoom = gameData.players || state.playersInRoom;
  state.players = state.playersInRoom.map((p) => p.name);
  state.gameWord = gameData.word;

  // Usa el índice del server; como backup, recién ahí buscá por id (pero NUNCA caigas a 0)
  if (typeof gameData.impostorIndex === "number") {
    state.impostorIndex = gameData.impostorIndex;
  } else {
    const idx = state.playersInRoom.findIndex(
      (p) => p.id === gameData.impostorId
    );
    if (idx >= 0) state.impostorIndex = idx;
    else {
      // Si llega a pasar, loguealo y mostrales un error en vez de forzar 0 (host)
      //console.warn('[WARN] impostorId no encontrado en players');
      state.impostorIndex = 0; // si querés, pero ya sabés que esto “bias-ea” al host
    }
  }

  state.currentPlayerIndex = gameData.currentPlayerIndex || 0;
  state.gameMode = "online";
  state.gameStarted = true;

  state.savedPlayers = state.players.slice();
  state.savedPlayers.forEach((n) => {
    if (state.playerScores[n] === undefined) state.playerScores[n] = 0;
  });

  showScreen("game");
  showOnlinePlayerTurn();
  setNewGameVisibility();
}

function showAllPlayersReady() {
  const card = $("#gameCard");
  const startBtn = $("#startPlayingBtn");

  card.innerHTML = `
    <div class="info-hidden">
      <h3>¡Todos listos!</h3>
      <p>Todos los jugadores conocen sus roles</p>
      <p style="color:#4ecdc4;font-weight:bold;">
        ${state.gameMode === "online" ? "Esperando…" : "¡Es hora de jugar!"}
      </p>
      <span style="font-size:2rem;">🎭</span>
    </div>`;

  // 👇 ONLINE: que NO se muestre nunca
  if (state.gameMode === "online") {
    startBtn.style.display = "none";
  } else {
    startBtn.style.display = "inline-block";
  }

  $("#showRoleBtn").style.display = "none";
  $("#hideBtn").style.display = "none";
  $("#nextBtn").style.display = "none";
}

function showOnlinePlayerTurn() {
  if (state.currentPlayerIndex >= state.playersInRoom.length) {
    showAllPlayersReady();
    return;
  }
  const current = state.playersInRoom[state.currentPlayerIndex];
  const gameCard = $("#gameCard");

  if (current && state.socket.id === current.id) {
    showPlayerTurn();
    return;
  }

  gameCard.innerHTML = `
    <div class="info-hidden">
      <h3>Esperando...</h3>
      <p>Es el turno de: <strong>${
        current?.name || "Jugador desconocido"
      }</strong></p>
      <p style="font-size:.9rem;color:rgba(255,255,255,0.6);">Jugador ${
        state.currentPlayerIndex + 1
      } de ${state.playersInRoom.length}</p>
      <span style="font-size:2rem;">⏳</span>
    </div>`;

  $("#showRoleBtn").style.display = "none";
  $("#hideBtn").style.display = "none";
  $("#nextBtn").style.display = "none";
  $("#startPlayingBtn").style.display = "none";
}

function nextPlayer() {
  if (state.gameMode === "online") {
    const btn = $("#nextBtn");
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;

    const currentRoomCode = getRoomCode();
    if (!currentRoomCode) {
      showError(
        "Error: No se encontró el código de sala. Salí y volvé a entrar."
      );
      if (btn) btn.disabled = false;
      return;
    }
    if (!state.socket || !state.socket.connected) {
      showError("Error: No hay conexión al servidor");
      if (btn) btn.disabled = false;
      return;
    }

    const expected = state.playersInRoom[state.currentPlayerIndex];
    if (expected && expected.id !== state.socket.id) {
      showError("No es tu turno");
      if (btn) btn.disabled = false;
      return;
    }
    state.socket.emit("nextTurn", { roomCode: currentRoomCode });
    return;
  }

  // Offline
  if (state.currentPlayerIndex < state.players.length - 1) {
    state.currentPlayerIndex++;
    showPlayerTurn();
  } else {
    showAllPlayersReady();
  }
}

function showOnlineResults(data) {
  state.gameWord = data.word;
  const impostorName =
    data.impostor?.name || state.playersInRoom[state.impostorIndex]?.name || "";
  if (data.impostorWon) {
    state.playerScores[impostorName] =
      (state.playerScores[impostorName] || 0) + 3;
  } else {
    state.players.forEach((n) => {
      if (n !== impostorName)
        state.playerScores[n] = (state.playerScores[n] || 0) + 1;
    });
  }

  $("#game").classList.add("hidden");
  $("#simpleVoting").classList.add("hidden");
  $("#results").classList.remove("hidden");

  const title = data.impostorWon
    ? "¡Ganó el Impostor!"
    : "¡Ganaron los Jugadores!";
  const msg = data.impostorWon
    ? `${impostorName} engañó a todos con la palabra "${state.gameWord.toUpperCase()}".`
    : `Descubrieron que ${impostorName} era el impostor.`;
  $("#resultTitle").textContent = title;
  $("#resultMessage").textContent = msg;

  const reveal = $("#impostorReveal");
  if (reveal)
    reveal.innerHTML = `El impostor era: <strong>${impostorName}</strong>`;

  updateScoreTable();

  const resultsEl = $("#results");
  const newRoundBtn = resultsEl.querySelector('button[onclick="newRound()"]');
  const newGameBtn = resultsEl.querySelector('button[onclick="resetGame()"]');

  if (state.gameMode === "online") {
    newRoundBtn.style.display = state.isHost ? "inline-block" : "none";
    newGameBtn.style.display = state.isHost ? "inline-block" : "none";
  } else {
    newRoundBtn.style.display = "inline-block";
    newGameBtn.style.display = "inline-block";
  }
}

function backToLogin() {
  $("#lobbyScreen").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
}

function leaveRoom() {
  if (state.socket) {
    state.socket.emit("leaveRoom", { roomCode: state.roomCode });
  }
  state.roomCode = "";
  state.isHost = false;
  state.playersInRoom = [];
  $("#waitingRoom").classList.add("hidden");
  $("#lobbyScreen").classList.remove("hidden");
  markOutRoom();
}

///////////////////////
// Local (offline)
///////////////////////
function addPlayer() {
  const nameInput = $("#playerName");
  const name = nameInput.value.trim();
  if (!name) return;
  if (state.players.includes(name)) return showError("Este jugador ya existe");
  state.players.push(name);
  nameInput.value = "";
  updatePlayersList();
  hideError();
}
function removePlayer(index) {
  const removed = state.players[index];
  state.players.splice(index, 1);
  const savedIndex = state.savedPlayers.indexOf(removed);
  if (savedIndex > -1) {
    state.savedPlayers.splice(savedIndex, 1);
    delete state.playerScores[removed];
  }
  updatePlayersList();
}
function updatePlayersList() {
  const list = $("#playersList");
  if (!state.players.length) {
    list.innerHTML =
      '<p style="color: rgba(255,255,255,0.6); font-style: italic;">No hay jugadores agregados</p>';
    return;
  }
  list.innerHTML = state.players
    .map(
      (p, i) =>
        `<div class="player-item"><span>${p}</span><button class="remove-btn" onclick="removePlayer(${i})">×</button></div>`
    )
    .join("");
}

function startGame() {
  if (state.players.length < 3)
    return showError("Necesitas al menos 3 jugadores para jugar");

  const category = state.selectedCategory || "Fútbol";
  const subtopic =
    state.selectedSubtopic ||
    (category === "Fútbol" ? getFootballSubtopics()[0] || "" : null);
  const customWord = document.getElementById("customWord")?.value || "";

  const pool = getWordsFromSelection({ category, subtopic, customWord });
  if (!pool.length)
    return showError(
      "Elegí una categoría/subtema válido o escribí la palabra personalizada"
    );

  state.gameWord = pool[Math.floor(Math.random() * pool.length)];
  state.impostorIndex = Math.floor(Math.random() * state.players.length);
  state.currentPlayerIndex = 0;
  state.gameStarted = true;
  state.playerInfoVisible = false;

  state.savedPlayers = [...state.players];
  state.savedPlayers.forEach((p) => {
    if (state.playerScores[p] === undefined) state.playerScores[p] = 0;
  });

  $("#setup").classList.add("hidden");
  $("#game").classList.remove("hidden");
  showPlayerTurn();
}

function showPlayerTurn() {
  const isOnline = state.gameMode === "online";
  const name = isOnline
    ? state.playersInRoom[state.currentPlayerIndex]?.name ||
      "Jugador desconocido"
    : state.players[state.currentPlayerIndex];
  const gameCard = $("#gameCard");
  gameCard.innerHTML = `
    <div class="player-waiting">
      <h3>${name}</h3>
      <p>Es tu turno</p>
      <p style="font-size:.9rem;color:rgba(255,255,255,0.6);">Presiona el botón cuando estés listo</p>
      <span style="font-size:2rem;">👋</span>
    </div>`;
  $("#showRoleBtn").style.display = "inline-block";
  $("#hideBtn").style.display = "none";
  $("#nextBtn").style.display = "none";
  $("#startPlayingBtn").style.display = "none";
}

function showPlayerRole() {
  const isOnline = state.gameMode === "online";
  const name = isOnline
    ? state.playersInRoom[state.currentPlayerIndex]?.name || "Jugador"
    : state.players[state.currentPlayerIndex];
  const isImpostor = state.currentPlayerIndex === state.impostorIndex;

  const card = $("#gameCard");
  card.innerHTML = `
    <h3 id="playerNameDisplay">${name}</h3>
    <div class="role-text ${
      isImpostor ? "impostor" : "player"
    }" id="roleDisplay">
      ${isImpostor ? "¡Eres el IMPOSTOR!" : "Eres un JUGADOR"}
    </div>
    <div id="wordDisplay" class="word-display">
      ${
        isImpostor
          ? "¿Puedes adivinar la palabra?"
          : state.gameWord.toUpperCase()
      }
    </div>`;

  state.playerInfoVisible = true;
  $("#showRoleBtn").style.display = "none";
  $("#hideBtn").style.display = "inline-block";

  if (!isImpostor) {
    const category = isOnline
      ? state.selectedOnlineCategory || "Fútbol"
      : state.selectedCategory || "Fútbol";

    const subtopic = isOnline
      ? state.selectedOnlineSubtopic || ""
      : state.selectedSubtopic || "";

    getImageForItem(state.gameWord, category, { subtopic }).then((url) => {
      if (!url) return;
      const img = document.createElement("img");
      img.className = "word-image";
      img.alt = state.gameWord;
      img.src = url;
      img.referrerPolicy = "no-referrer";
      $("#gameCard")?.appendChild(img);
    });
  }
}

function hidePlayerInfo() {
  if (!state.playerInfoVisible) return;
  state.playerInfoVisible = false;

  const gameCard = $("#gameCard");
  const showRoleBtn = $("#showRoleBtn");
  const hideBtn = $("#hideBtn");
  const nextBtn = $("#nextBtn");
  const startBtn = $("#startPlayingBtn");

  showRoleBtn.style.display = "none";

  if (state.gameMode === "online") {
    gameCard.innerHTML = `
      <div class="info-hidden">
        <h3>Información Oculta</h3>
        <p>Has visto tu rol</p>
        <p style="color:#4ecdc4;font-weight:bold;">Presiona "Siguiente" para continuar</p>
        <span style="font-size:2rem;">🔒</span>
      </div>`;
    hideBtn.style.display = "none";
    nextBtn.style.display = "inline-block";
    nextBtn.disabled = false;
    startBtn.style.display = "none";
    return;
  }

  // Offline
  if (state.currentPlayerIndex === state.players.length - 1) {
    gameCard.innerHTML = `
      <div class="info-hidden">
        <h3>¡Todos listos!</h3>
        <p>Todos los jugadores conocen sus roles</p>
        <p style="color:#4ecdc4;font-weight:bold;">¡Es hora de jugar!</p>
        <span style="font-size:2rem;">🎭</span>
      </div>`;
    hideBtn.style.display = "none";
    nextBtn.style.display = "none";
    startBtn.style.display = "inline-block";
  } else {
    const nextName = state.players[state.currentPlayerIndex + 1];
    gameCard.innerHTML = `
      <div class="info-hidden">
        <h3>Información Oculta</h3>
        <p>Pasa el dispositivo al siguiente jugador</p>
        <p style="color:#4ecdc4;font-weight:bold;">Próximo: ${nextName}</p>
        <span style="font-size:2rem;">🔒</span>
      </div>`;
    hideBtn.style.display = "none";
    nextBtn.style.display = "inline-block";
    nextBtn.textContent = `Turno de ${nextName}`;
    nextBtn.disabled = false;
    startBtn.style.display = "none";
  }
}

function showVotingScreen() {
  if (state.gameMode === "online" && !state.isHost) return;
  $("#game").classList.add("hidden");
  $("#simpleVoting").classList.remove("hidden");
  setNewGameVisibility();
}

function impostorWon(won) {
  if (state.gameMode === "online") {
    if (!state.isHost)
      return showError("Solo el anfitrión puede confirmar el resultado");
    state.socket.emit("gameEnded", {
      roomCode: state.roomCode,
      impostorWon: won,
    });
    return;
  }

  // Offline
  if (won) {
    const name = state.players[state.impostorIndex];
    state.playerScores[name] = (state.playerScores[name] || 0) + 3;
    showResults(
      "¡Ganó el Impostor!",
      `${name} engañó a todos con la palabra "${state.gameWord.toUpperCase()}".`
    );
  } else {
    state.players.forEach((p) => {
      if (p !== state.players[state.impostorIndex])
        state.playerScores[p] = (state.playerScores[p] || 0) + 1;
    });
    showResults(
      "¡Ganaron los Jugadores!",
      `Descubrieron que ${state.players[state.impostorIndex]} era el impostor.`
    );
  }
}

function showResults(title, message) {
  $("#simpleVoting").classList.add("hidden");
  $("#results").classList.remove("hidden");
  $("#resultTitle").textContent = title;
  $("#resultMessage").textContent = message;

  const reveal = $("#impostorReveal");
  if (reveal)
    reveal.innerHTML = `El impostor era: <strong>${
      state.players[state.impostorIndex]
    }</strong>`;

  updateScoreTable();
}

function updateScoreTable() {
  const scoreTable = $("#scoreTable");
  if (!state.savedPlayers.length) {
    scoreTable.innerHTML =
      '<p style="color: rgba(255,255,255,0.6); text-align:center;">No hay jugadores</p>';
    return;
  }
  const sorted = [...state.savedPlayers].sort(
    (a, b) => (state.playerScores[b] || 0) - (state.playerScores[a] || 0)
  );
  scoreTable.innerHTML = sorted
    .map((p, i) => {
      const s = state.playerScores[p] || 0;
      const isWinner = i === 0 && s > 0;
      return `<div class="score-item ${
        isWinner ? "winner" : ""
      }" style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid rgba(255,255,255,0.1);">
      <span style="color:#fff;font-weight:bold;">${
        isWinner ? "🏆 " : ""
      }${p}</span>
      <span style="color:#fff;">${s} pts</span>
    </div>`;
    })
    .join("");
}

function newRound() {
  if (state.gameMode === "online") {
    $("#results").classList.add("hidden");
    $("#waitingRoom").classList.remove("hidden");
    return;
  }

  state.players = [...state.savedPlayers];
  state.currentPlayerIndex = 0;
  state.gameWord = "";
  state.impostorIndex = -1;
  state.gameStarted = false;
  state.playerInfoVisible = false;

  $("#results").classList.add("hidden");
  $("#simpleVoting").classList.add("hidden");
  $("#scoreView").classList.add("hidden");

  hideError();
  showScreen("setup");
}

function resetGame() {
  const isOnline = state.gameMode === "online";
  const inRound =
    !document.getElementById("game").classList.contains("hidden") ||
    !document.getElementById("simpleVoting").classList.contains("hidden");

  // Nunca permitas resetear en medio de una ronda online
  if (isOnline && inRound) {
    showError(
      "No podés iniciar un nuevo juego durante una partida. Terminá la ronda o volvé a la sala."
    );
    return;
  }
  if (state.socket && state.roomCode) {
    state.socket.emit("leaveRoom", { roomCode: state.roomCode });
  }
  // Si estás online, pedí confirmación explícita
  if (isOnline) {
    const ok = window.confirm(
      "Esto te desconecta de la sala actual. ¿Seguro que querés empezar un juego nuevo?"
    );
    if (!ok) return;
  }
  if (state.gameMode === "online") {
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    state.roomCode = "";
    state.isHost = false;
    state.playersInRoom = [];
    state.gameMode = "offline";
  }

  state.players = [];
  state.savedPlayers = [];
  state.playerScores = {};
  state.playerName = "";

  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  $("#loginScreen").classList.remove("hidden");

  const pni = $("#playerNameInput");
  if (pni) pni.value = "";
  const rci = $("#roomCodeInput");
  if (rci) rci.value = "";

  updatePlayersList();
  hideError();
  markOutRoom();
  //console.log('🔄 Juego reseteado completamente');
}

function init() {
  // === LOCAL: categoría / subtema ===
  const localCat = initCustomSelect(
    "categorySelect",
    Object.keys(topics), // "Fútbol", "animales", etc.
    "Fútbol",
    (val) => {
      const sg = document.getElementById("subtopicGroup");
      const cg = document.getElementById("customWordGroup");
      if (val === "Fútbol") {
        sg.style.display = "";
        cg.style.display = "none";
      } else if (val === "personalizado") {
        sg.style.display = "none";
        cg.style.display = "";
      } else {
        sg.style.display = "none";
        cg.style.display = "none";
      }
      state.selectedCategory = val;
      if (val !== "Fútbol") state.selectedSubtopic = null;
    }
  );

  let subSel = null;
  if (topics["Fútbol"]) {
    const st = getFootballSubtopics();
    subSel = initSubtopicSelect(
      "subtopicSelect",
      st,
      st[0],
      (val) => {
        state.selectedSubtopic = val;
      } // <-- guarda el subtema local
    );
    state.selectedSubtopic = subSel?.value || null;
  }
  state.selectedCategory = localCat?.value || "Fútbol";

  // === ONLINE (host): categoría / subtema ===
  const onlineCat = initCustomSelect(
    "onlineCategorySelect",
    Object.keys(topics),
    "Fútbol",
    (val) => {
      const sg = document.getElementById("onlineSubtopicGroup");
      sg.style.display = val === "Fútbol" ? "" : "none";
      state.selectedOnlineCategory = val;
      if (val !== "Fútbol") state.selectedOnlineSubtopic = null;
    }
  );

  let onlineSub = null;
  if (topics["Fútbol"]) {
    const ost = getFootballSubtopics();
    onlineSub = initSubtopicSelect(
      "onlineSubtopicSelect",
      ost,
      ost[0],
      (val) => {
        state.selectedOnlineSubtopic = val;
      } // <-- guarda el subtema online
    );
    state.selectedOnlineSubtopic = onlineSub?.value || null;
  }
  state.selectedOnlineCategory = onlineCat?.value || "Fútbol";

  // Pantallas + atajos
  document.getElementById("loginScreen")?.classList.remove("hidden");
  updatePlayersList();

  document.getElementById("playerName")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") addPlayer();
  });
  document
    .getElementById("playerNameInput")
    ?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.querySelector(".mode-selection .btn:first-child")?.click();
      }
    });
  document
    .getElementById("roomCodeInput")
    ?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") joinRoom();
    });

  markOutRoom();
}

// Exponer funciones globales (para los `onclick` del HTML original)
Object.assign(window, {
  // flujo online
  setPlayerName,
  createRoom,
  joinRoom,
  startOnlineGame,
  backToLogin,
  leaveRoom,
  // juego
  showPlayerRole,
  hidePlayerInfo,
  nextPlayer,
  showVotingScreen,
  impostorWon,
  newRound,
  resetGame,
  // offline players
  addPlayer,
  removePlayer,
  // init/socket
  initializeSocket,
  startGame,
});

export { init };
