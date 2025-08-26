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
    socket.join(roomCode);
    console.log(`${playerName} se unió a la sala ${roomCode}`);
    socket.emit('roomJoined', { roomCode, isHost: false, players: room.players });
    io.to(roomCode).emit('playerJoined', { player: { id: socket.id, name: playerName, isHost: false }, players: room.players });
  });


// ===== GAME: iniciar
socket.on('startGame', ({ roomCode, topic, theme }) => {
  const room = rooms.get(roomCode);
  if (!room || room.host !== socket.id) return socket.emit('error', 'No tienes permisos para iniciar el juego');
  if (room.players.length < 3) return socket.emit('error', 'Necesitas al menos 3 jugadores');

  const selection = normalizeTheme(topic, theme);
  room.gameStarted = true;
  room.topic = selection;

  // setupGame como siempre
  room.gameData = setupGame(room.players, selection);
  // preparar “readys” para esta ronda
  room.gameData.ready = new Set();

  /* console.log(`Juego iniciado en sala ${roomCode}:`, {
    word: room.gameData.word,
    impostor: room.players[room.gameData.impostorIndex].name,
    totalPlayers: room.players.length,
    theme: selection,
  }); */

  //  Enviar a CADA jugador su rol (impostor no recibe la palabra)
  // Enviar a CADA jugador su rol (impostor no recibe la palabra)
  room.players.forEach(p => {
    const isImpostor = (p.id === room.gameData.impostorId);
    io.to(p.id).emit('gameStarted', {
     players: room.gameData.players,            // lista de jugadores
      role: isImpostor ? 'impostor' : 'player',  // rol del receptor
      word: isImpostor ? null : room.gameData.word, // palabra sólo para no-impostor
      theme: selection,
      // 👇 MUY IMPORTANTE: enviar quién es el impostor
      impostorId: room.gameData.impostorId,
      impostorIndex: room.gameData.impostorIndex
    });
  });
});


// ===== GAME: “Estoy listo”
socket.on('playerReady', ({ roomCode }) => {
  const room = rooms.get(roomCode);
  if (!room || !room.gameData) return;

  room.gameData.ready ??= new Set();
  room.gameData.ready.add(socket.id);

  const readyCount = room.gameData.ready.size;
  const total = room.players.length;

  // update en vivo (opcional)
  io.to(roomCode).emit('playersReady', { ready: readyCount, total });

  if (readyCount === total) {
    // todos confirmaron
    io.to(roomCode).emit('allReady');
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
    room.gameStarted = false;
    room.gameData = null;
  });

  // ===== GAME: salir
  socket.on('leaveRoom', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const leaving = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);
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
