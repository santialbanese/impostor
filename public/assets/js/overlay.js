import { state } from "./state.js";

export function markInRoom() {
  state.inRoomSession = true;
  const btn = document.getElementById("chatFab");
  if (btn) btn.classList.remove("hidden");
}
export function markOutRoom() {
  state.inRoomSession = false;
  closeChatOverlay();
  const btn = document.getElementById("chatFab");
  if (btn) btn.classList.add("hidden");
}

export function openChat() {
  if (!state.inRoomSession) return;
  const room = state.roomCode;
  const url = room ? `chat.html?room=${encodeURIComponent(room)}` : "chat.html";
  const overlay = document.getElementById("chatOverlay");
  const frame = document.getElementById("chatFrame");
  history.pushState({ chatOpen: true }, "", location.href);
  frame.src = url;
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";
}

export function closeChatOverlay() {
  const overlay = document.getElementById("chatOverlay");
  const frame = document.getElementById("chatFrame");
  if (!overlay) return;
  frame.src = "about:blank";
  overlay.classList.add("hidden");
  overlay.style.display = "none";
  if (history.state && history.state.chatOpen) history.back();
}

window.addEventListener("popstate", () => {
  const overlay = document.getElementById("chatOverlay");
  if (overlay && overlay.style.display !== "none") closeChatOverlay();
});

window.addEventListener("message", (e) => {
  if (e && e.data && e.data.type === "closeChatIframe") closeChatOverlay();
});

// Exponer a window para los botones del HTML
window.openChat = openChat;
window.closeChatOverlay = closeChatOverlay;
