import { state } from "./state.js";

export function $(sel, el = document) {
  return el.querySelector(sel);
}
export function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}
export function showError(message) {
  const errorDiv = document.getElementById("error");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
  } else alert(message);
}
export function hideError() {
  const errorDiv = document.getElementById("error");
  if (errorDiv) errorDiv.classList.add("hidden");
}

export function updateConnectionStatus(status) {
  const el = document.getElementById("connectionStatus");
  if (!el) return;
  if (status === "connected") {
    el.textContent = "🟢 Conectado";
    el.className = "connection-status connected";
  } else if (status === "connecting") {
    el.textContent = "🟡 Conectando...";
    el.className = "connection-status connecting";
  } else {
    el.textContent = "🔴 Desconectado";
    el.className = "connection-status disconnected";
  }
}

function isVisible(id) {
  const el = document.getElementById(id);
  return el && !el.classList.contains('hidden');
}

export function setNewGameVisibility() {
  const buttons = document.querySelectorAll('button[onclick="resetGame()"], #resetBtnGame');

  const isOnline = state.gameMode === "online";
  const duringRound = isVisible('game') || isVisible('simpleVoting');

  buttons.forEach(btn => {
    if (isOnline && duringRound) {
      btn.style.display = "none";
    } else if (isOnline && !state.isHost) {
      btn.style.display = "none";
    } else {
      btn.style.display = "inline-block";
    }
  });
}