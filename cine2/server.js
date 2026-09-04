// Cine2 — serveur de signalisation WebRTC minimal
// Ne transporte jamais la vidéo : il sert juste à mettre les deux navigateurs
// en relation (offer/answer/ICE) puis c'est du peer-to-peer direct ensuite.

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// rooms: code -> Set de sockets (max 2 : host + viewer)
const rooms = new Map();

function broadcastToRoom(code, sender, data) {
  const room = rooms.get(code);
  if (!room) return;
  for (const client of room) {
    if (client !== sender && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }
}

wss.on('connection', (ws) => {
  ws.roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      // génère un code de salon court
      const code = Math.random().toString(36).substring(2, 7).toUpperCase();
      rooms.set(code, new Set([ws]));
      ws.roomCode = code;
      ws.send(JSON.stringify({ type: 'created', code }));
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(msg.code);
      if (!room || room.size >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Salon introuvable ou plein.' }));
        return;
      }
      room.add(ws);
      ws.roomCode = msg.code;
      ws.send(JSON.stringify({ type: 'joined', code: msg.code }));
      broadcastToRoom(msg.code, ws, { type: 'peer-joined' });
      return;
    }

    // relais direct des messages WebRTC (offer / answer / ice candidates)
    if (['offer', 'answer', 'ice'].includes(msg.type) && ws.roomCode) {
      broadcastToRoom(ws.roomCode, ws, msg);
    }
  });

  ws.on('close', () => {
    if (ws.roomCode && rooms.has(ws.roomCode)) {
      const room = rooms.get(ws.roomCode);
      room.delete(ws);
      broadcastToRoom(ws.roomCode, ws, { type: 'peer-left' });
      if (room.size === 0) rooms.delete(ws.roomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Cine2 lancé sur le port ${PORT}`));
