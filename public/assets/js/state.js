export const state = {
  gameMode: "offline",
  socket: null,
  isHost: false,
  roomCode: "",
  playersInRoom: [],
  playerName: "",
  selectedOnlineTopic: "animales",

  selectedCategory: "Fútbol",
  selectedSubtopic: null,
  selectedOnlineCategory: "Fútbol",
  selectedOnlineSubtopic: null,

  // Local game
  players: [],
  savedPlayers: [],
  playerScores: {},
  currentPlayerIndex: 0,
  gameWord: "",
  impostorIndex: -1,
  gameStarted: false,
  playerInfoVisible: false,
  selectedTopic: "animales",

  // Chat overlay flag
  inRoomSession: false,
};
