const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { generateRoomCode } = require('./lib/utils.js');
const { setupGame } = require('./lib/gameSetup.js');

// --- App/Server/IO ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Estado en memoria
const rooms = new Map();
const chatNeedsClear = new Set();

// --- Helpers de orden por PARTIDA ---
function rotateBy(arr, k = 1) {
  const n = arr.length || 0;
  if (n === 0) return [];
  const s = ((k % n) + n) % n;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

function ensureSeatOrder(room) {
  if (!room.seatOrder) room.seatOrder = room.players.map(p => p.id);
  // asegurar que seatOrder sólo tenga jugadores actuales (y en ese orden de ingreso original)
  const set = new Set(room.players.map(p => p.id));
  room.seatOrder = room.seatOrder.filter(id => set.has(id));
  // agregar al final ids nuevos que no estuvieran
  room.players.forEach(p => { if (!room.seatOrder.includes(p.id)) room.seatOrder.push(p.id); });
  if (typeof room.nextStartIndex !== 'number') room.nextStartIndex = 0;
}

function removeFromSeatOrder(room, id) {
  ensureSeatOrder(room);
  const idx = room.seatOrder.indexOf(id);
  if (idx === -1) return;
  room.seatOrder.splice(idx, 1);
  const n = room.seatOrder.length;
  if (n <= 0) { room.nextStartIndex = 0; return; }
  // si quitaste a alguien antes del puntero, correlo 1 hacia atrás
  if (room.nextStartIndex > idx) room.nextStartIndex--;
  room.nextStartIndex = ((room.nextStartIndex % n) + n) % n;
}

function advanceGameOffset(room) {
  ensureSeatOrder(room);
  const n = room.seatOrder.length;
  if (n <= 0) { room.nextStartIndex = 0; return; }
  room.nextStartIndex = (room.nextStartIndex + 1) % n;
}


// helper: normaliza lo que viene del cliente
function normalizeTheme(topic, theme) {
  // 1) Si topic viene con "Fútbol::<subtema>", usalo SIEMPRE (es la señal más completa)
  if (typeof topic === 'string' && topic.startsWith('Fútbol::')) {
    const sub = topic.split('::')[1] || '';
    return { category: 'Fútbol', subtopic: sub };
  }

  // 2) Sino, usá theme; si es Fútbol y no trae subtema, poné uno por defecto
  if (theme && typeof theme === 'object') {
    const category = String(theme.category || '').trim() || 'animales';
    let subtopic = theme.subtopic ? String(theme.subtopic).trim() : null;

    // Si es Fútbol y faltó el subtema, intentá rescatarlo de `topic` o setear default
    if (category === 'Fútbol') {
      if ((!subtopic || !subtopic.length) && typeof topic === 'string' && topic.startsWith('Fútbol::')) {
        subtopic = topic.split('::')[1] || '';
      }
      if (!subtopic || !subtopic.length) subtopic = '⭐ Leyendas'; // default seguro
      return { category: 'Fútbol', subtopic };
    }
    return { category };
  }

  // 3) Compat: si sólo vino topic simple (animales, películas, etc.)
  if (typeof topic === 'string') return { category: topic };

  return { category: 'animales' };
}



/* NUEVO */
/* NUEVO */

function rotateLeft(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return arr || [];
  const [first, ...rest] = arr;
  return [...rest, first];
}
function getRoomActivePlayers(room) {
  const ids = room.gameData.active || [];
  return room.players.filter(p => ids.includes(p.id));
}
function findById(room, id) {
  return room.players.find(p => p.id === id);
}
function isImpostorAlive(room) {
  return (room.gameData.active || []).includes(room.gameData.impostorId);
}


function startRound(io, room) {
  const gd = room.gameData;
  gd.stage = 'submit';
  gd.roundNumber = (gd.roundNumber || 0) + 1;

  // limpiar envíos/votos
  gd.submissions = {};
  gd.votes = {};
  gd.voteRound = 0;

  // NO rotamos entre rondas. El orden ya viene de la PARTIDA.
  const activeSet = new Set(gd.active);
  gd.turnOrder = gd.turnOrder.filter(id => activeSet.has(id));
  if (gd.turnOrder.length === 0) gd.turnOrder = gd.active.slice();

  // Fin automático si quedan 2
  if (gd.active.length <= 2) {
    const impostorWins = isImpostorAlive(room);
    const impPlayer = findById(room, gd.impostorId);
    io.to(room.code).emit('gameResult', {
      impostorWon: impostorWins,
      impostor: impPlayer,
      word: gd.word
    });
    // 👇 Avanzar offset para la PRÓXIMA PARTIDA
    advanceGameOffset(room);

    room.gameStarted = false;
    room.gameData = null;
    return;
  }

  gd.speakIndex = 0;
  const currentSpeakerId = gd.turnOrder[gd.speakIndex];

  const payload = {
    round: gd.roundNumber,
    order: gd.turnOrder.map(id => findById(room, id)).map(p => ({ id: p.id, name: p.name })),
    currentSpeakerId,
    activePlayers: getRoomActivePlayers(room).map(p => ({ id: p.id, name: p.name })),
  };
  io.to(room.code).emit('roundStarted', payload);
}



function advanceSpeaker(io, room) {
  const gd = room.gameData;
  gd.speakIndex++;
  if (gd.speakIndex >= gd.turnOrder.length) {
    // terminó la fase de envíos → arrancar votación
    startVoting(io, room, gd.active);
    return;
  }
  const currentSpeakerId = gd.turnOrder[gd.speakIndex];
  io.to(room.code).emit('submissionProgress', {
    submissions: gd.submissions,              // { playerId: "palabra", ... }
    currentSpeakerId,
  });
}

function startVoting(io, room, eligibleIds) {
  const gd = room.gameData;
  gd.stage = 'vote';
  gd.votes = {};
  gd.voteRound = (gd.voteRound || 0) + 1;
  gd.eligibleForVote = [...eligibleIds];
  io.to(room.code).emit('votingStarted', {
    round: gd.roundNumber,
    voteRound: gd.voteRound,
    eligible: gd.eligibleForVote,
    activePlayers: getRoomActivePlayers(room).map(p => ({ id: p.id, name: p.name })),
    submissions: gd.submissions,
  });
}

function tallyVotes(io, room) {
  const gd = room.gameData;
  if (!gd) return;

  const DELAY_MS = 1800; // ⬅️ tiempo para leer el banner antes de seguir

  // Conteo de votos
  const counts = {};
  for (const [voterId, target] of Object.entries(gd.votes || {})) {
    if (!gd.eligibleForVote || !gd.eligibleForVote.includes(target)) continue;
    counts[target] = (counts[target] || 0) + 1;
  }

  // Ganador/es
  let max = -1, leaders = [];
  for (const [pid, c] of Object.entries(counts)) {
    if (c > max) { max = c; leaders = [pid]; }
    else if (c === max) leaders.push(pid);
  }

  // Nadie votó
  if (!leaders.length) {
    io.to(room.code).emit('noElimination', { reason: 'no_votes' });
    startRound(io, room);
    return;
  }

  // Empate
  if (leaders.length > 1) {
    if ((gd.voteRound || 1) < 2) {
      // 1 revancha entre empatados
      startVoting(io, room, leaders);
      return;
    }
    // Empate por segunda vez → sin expulsión
    io.to(room.code).emit('noElimination', { reason: 'tie_twice', tied: leaders });
    startRound(io, room);
    return;
  }

  // Expulsión
  const eliminatedId = leaders[0];
  const eliminatedWasImpostor = (eliminatedId === gd.impostorId);

  // Sacar del array de vivos
  gd.active = (gd.active || []).filter(id => id !== eliminatedId);
  const eliminatedPlayer = findById(room, eliminatedId);

  // Mostrar resultado de la votación (el cliente pinta: "X NO era impostor" o revela que sí lo era)
  io.to(room.code).emit('votingResult', {
    eliminatedId,
    eliminatedName: eliminatedPlayer?.name || 'Jugador',
    eliminatedWasImpostor,
    counts,
  });

  // Si era el impostor → fin de partida
  if (eliminatedWasImpostor) {
    const impPlayer = findById(room, gd.impostorId);
    io.to(room.code).emit('gameResult', {
      impostorWon: false,
      impostor: impPlayer,
      word: gd.word
    });

    // (opcional) rotar el orden para la PRÓXIMA partida, si implementaste esta función
    if (typeof advanceGameOffset === 'function') advanceGameOffset(room);

    room.gameStarted = false;
    room.gameData = null;
    return;
  }

  // Si quedan 2 → resolver partida (después de mostrar el banner)
  if ((gd.active || []).length <= 2) {
    const impostorWins = isImpostorAlive(room);
    const impPlayer = findById(room, gd.impostorId);

    setTimeout(() => {
      io.to(room.code).emit('gameResult', {
        impostorWon: impostorWins,
        impostor: impPlayer,
        word: gd.word
      });
      if (typeof advanceGameOffset === 'function') advanceGameOffset(room);
      room.gameStarted = false;
      room.gameData = null;
    }, DELAY_MS);

    return;
  }

  // NO era impostor → nueva ronda después de un toque
  setTimeout(() => {
    startRound(io, room);
  }, DELAY_MS);
}





io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // ===== GAME: crear sala
socket.on('createRoom', (playerName) => {
  const roomCode = generateRoomCode(rooms);
  const room = {
    code: roomCode,
    host: socket.id,
    players: [{ id: socket.id, name: playerName, isHost: true }],
    gameStarted: false,
    topic: 'animales',
    gameData: null,
    lastImpostorId: null,
    lastImpostorStreak: 0,
    // NUEVO: orden estable de “asientos” (ingreso) y offset por PARTIDA
    seatOrder: [socket.id],
    nextStartIndex: 0,
  };
  rooms.set(roomCode, room);
  socket.join(roomCode);
  socket.emit('roomCreated', { roomCode, isHost: true, players: room.players });
});



  // ===== GAME: unirse a sala
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('joinError', 'Sala no encontrada');
    if (room.gameStarted) return socket.emit('joinError', 'El juego ya comenzó');
    if (room.players.some(p => p.name === playerName)) return socket.emit('joinError', 'Ya existe un jugador con ese nombre');

    room.players.push({ id: socket.id, name: playerName, isHost: false });

    if (!room.seatOrder) room.seatOrder = [];
    if (!room.seatOrder.includes(socket.id)) room.seatOrder.push(socket.id);

    socket.join(roomCode);
    console.log(`${playerName} se unió a la sala ${roomCode}`);
    socket.emit('roomJoined', { roomCode, isHost: false, players: room.players });
    io.to(roomCode).emit('playerJoined', { player: { id: socket.id, name: playerName, isHost: false }, players: room.players });
  });


socket.on('startGame', ({ roomCode, topic, theme }) => {
  const room = rooms.get(roomCode);
  if (!room || room.host !== socket.id) return socket.emit('error', 'No tienes permisos para iniciar el juego');
  if (room.players.length < 3) return socket.emit('error', 'Necesitas al menos 3 jugadores');

  const selection = normalizeTheme(topic, theme);
  room.gameStarted = true;
  room.topic = selection;

  room.gameData = setupGame(room.players, selection);

  // --- estado inicial del flujo ---
  const gd = room.gameData;
  gd.ready = new Set();
  gd.stage = 'ready';

  // ORDEN POR PARTIDA (rotado entre partidas)
  ensureSeatOrder(room);
  const base = room.seatOrder.filter(id => room.players.some(p => p.id === id));
  const orderThisGame = rotateBy(base, room.nextStartIndex);  // <<< ACA ROTAMOS ENTRE PARTIDAS

  gd.turnOrder = orderThisGame.slice();     // orden de habla de esta partida
  gd.active    = orderThisGame.slice();     // vivos (en el mismo orden)
  gd.submissions = {};
  gd.votes = {};
  gd.voteRound = 0;
  gd.roundNumber = 0;                       // startRound lo sube a 1

  // Enviar rol a cada jugador (impostor sin palabra)
  room.players.forEach(p => {
    const isImpostor = (p.id === gd.impostorId);
    io.to(p.id).emit('gameStarted', {
      players: gd.players,
      role: isImpostor ? 'impostor' : 'player',
      word: isImpostor ? null : gd.word,
      theme: selection,
      impostorId: gd.impostorId,
      impostorIndex: gd.impostorIndex
    });
  });
});




socket.on('playerReady', ({ roomCode }) => {
  const room = rooms.get(roomCode);
  if (!room || !room.gameData) return;

  room.gameData.ready ??= new Set();
  room.gameData.ready.add(socket.id);

  const readyCount = room.gameData.ready.size;
  const total = room.players.length;

  io.to(roomCode).emit('playersReady', { ready: readyCount, total });

  if (readyCount === total) {
    io.to(roomCode).emit('allReady');  // (el cliente oculta “Estoy listo”, etc.)
    // 👉 arranca la PRIMERA ronda con orden rotado según round=1
    startRound(io, room);
  }
});


socket.on('submitWord', ({ roomCode, word }) => {
  const room = rooms.get(roomCode);
  if (!room || !room.gameData) return socket.emit('error', 'Sala inválida');
  const gd = room.gameData;
  if (gd.stage !== 'submit') return socket.emit('error', 'No es la fase de envíos');

  const speakerId = gd.turnOrder[gd.speakIndex];
  if (socket.id !== speakerId) return socket.emit('error', 'No es tu turno');

  const clean = String(word || '').trim().slice(0, 40);
  if (!clean) return socket.emit('error', 'La palabra no puede estar vacía');

  gd.submissions[socket.id] = clean;

  // Pasamos directo al siguiente (advanceSpeaker emite el progreso con el currentSpeakerId correcto)
  advanceSpeaker(io, room);
});


// ===== VOTING: voto de cada jugador
socket.on('castVote', ({ roomCode, targetId }) => {
  const room = rooms.get(roomCode);
  if (!room || !room.gameData) return socket.emit('error', 'Sala inválida');
  const gd = room.gameData;
  if (gd.stage !== 'vote') return socket.emit('error', 'No es la fase de votación');

  if (!gd.active.includes(socket.id)) return socket.emit('error', 'Estás eliminado');
  if (!gd.eligibleForVote.includes(targetId)) return socket.emit('error', 'Objetivo inválido');

  gd.votes[socket.id] = targetId;

  // cuando votaron todos los vivos -> cerrar votación
  const aliveCount = gd.active.length;
  const votesCount = Object.keys(gd.votes).length;
  if (votesCount >= aliveCount) {
    tallyVotes(io, room);
  } else {
    // opcional: enviar progreso de votos (sin revelar detalle)
    io.to(room.code).emit('voteProgress', { votes: votesCount, total: aliveCount });
  }
});



  // ===== GAME: siguiente turno
  socket.on('nextTurn', ({ roomCode }) => {
    if (!roomCode) return socket.emit('error', 'Código de sala no válido');
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', `Sala ${roomCode} no encontrada`);
    if (!room.gameData) return socket.emit('error', 'El juego no ha comenzado');

    const idx = room.gameData.currentPlayerIndex;
    const total = room.players.length;
    const current = room.players[idx];
    if (!current || current.id !== socket.id) return socket.emit('error', 'No es tu turno');

    room.gameData.currentPlayerIndex++;
    const nextIdx = room.gameData.currentPlayerIndex;

    if (nextIdx >= total) {
      io.to(roomCode).emit('turnChanged', { currentPlayerIndex: nextIdx, isGameReady: true, message: '¡Todos listos!' });
    } else {
      const next = room.players[nextIdx];
      io.to(roomCode).emit('turnChanged', { currentPlayerIndex: nextIdx, currentPlayerName: next.name, isGameReady: false });
    }
  });

  // ===== GAME: fin
  socket.on('gameEnded', ({ roomCode, impostorWon }) => {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.host !== socket.id) return socket.emit('error', 'Solo el anfitrión puede finalizar el juego');

  const impostorPlayer = room.players.find(p => p.id === room.gameData.impostorId);
  io.to(roomCode).emit('gameResult', { impostorWon, impostor: impostorPlayer, word: room.gameData.word });

  // NUEVO: próxima partida empieza con el siguiente
  advanceGameOffset(room);

  room.gameStarted = false;
  room.gameData = null;
});


  // ===== GAME: salir
  socket.on('leaveRoom', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const leaving = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);

    removeFromSeatOrder(room, socket.id); 

    socket.leave(roomCode);
    console.log(`${leaving?.name || 'Jugador'} salió de la sala ${roomCode}`);

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      chatNeedsClear.add(roomCode);
      io.to(`CHAT_${roomCode}`).emit('chatClear', { roomCode });
    } else {
      if (room.host === socket.id) {
        room.host = room.players[0].id;
        room.players[0].isHost = true;
      }
      io.to(roomCode).emit('playerLeft', { players: room.players });
    }
  });

  // ===== CHAT: estado por socket
  socket.data.currentChatRoom = null;
  socket.data.displayName = null;

  socket.on('joinChatRoom', ({ roomCode, playerName }) => {
    const code = (roomCode && String(roomCode).trim()) || 'GLOBAL';
    const chatRoom = `CHAT_${code}`;
    if (socket.data.currentChatRoom) socket.leave(socket.data.currentChatRoom);
    socket.data.currentChatRoom = chatRoom;
    socket.data.displayName = (playerName && String(playerName).trim()) || 'Anónimo';
    socket.join(chatRoom);

    const members = io.sockets.adapter.rooms.get(chatRoom)?.size || 1;

    if (chatNeedsClear.has(code)) {
      socket.emit('chatClear', { roomCode: code });
      chatNeedsClear.delete(code);
    }
    socket.emit('chatJoined', { roomCode: code, membersCount: members });
    socket.to(chatRoom).emit('chatSystem', { text: `${socket.data.displayName} se unió`, when: Date.now() });
  });

  socket.on('chatMessage', (msg, ack) => {
    try {
      const code = (msg?.roomCode && String(msg.roomCode).trim()) || 'GLOBAL';
      const chatRoom = `CHAT_${code}`;
      const stableId = String(msg?.id || `${socket.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
      const safe = {
        roomCode: code,
        name: String(msg?.name || socket.data.displayName || 'Anónimo').slice(0, 40),
        text: String(msg?.text || '').slice(0, 2000),
        when: Number(msg?.when) || Date.now(),
        id: stableId,
      };
      io.to(chatRoom).emit('chatMessage', safe);
      if (typeof ack === 'function') ack(true);
    } catch (e) {
      console.error('chatMessage error', e);
      if (typeof ack === 'function') ack(false);
    }
  });

  socket.on('chatTyping', ({ roomCode, name, isTyping }) => {
    const code = (roomCode && String(roomCode).trim()) || 'GLOBAL';
    const chatRoom = `CHAT_${code}`;
    socket.to(chatRoom).emit('chatTyping', {
      name: String(name || socket.data.displayName || 'Alguien').slice(0, 40),
      isTyping: !!isTyping,
    });
  });

  // ===== desconexión
  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    rooms.forEach((room, roomCode) => {
      const i = room.players.findIndex(p => p.id === socket.id);
      if (i !== -1) {
        room.players.splice(i, 1);
        removeFromSeatOrder(room, socket.id);
        if (room.players.length === 0) {
          rooms.delete(roomCode);
          chatNeedsClear.add(roomCode);
          io.to(`CHAT_${roomCode}`).emit('chatClear', { roomCode });
        } else {
          if (room.host === socket.id) {
            room.host = room.players[0].id;
            room.players[0].isHost = true;
          }
          io.to(roomCode).emit('playerLeft', { players: room.players });
        }
      }
    });

    const chatRoom = socket.data?.currentChatRoom;
    if (chatRoom) io.to(chatRoom).emit('chatSystem', { text: `${socket.data?.displayName || 'Alguien'} se desconectó`, when: Date.now() });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
