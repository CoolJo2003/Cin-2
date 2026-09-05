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

// controlSockets: code -> Set de sockets "pilote" (une instance du script
// compagnon Tampermonkey, connectée depuis l'onglet Netflix/Prime/etc. de
// la personne qui partage). Complètement séparé de `rooms` : ces sockets ne
// comptent jamais dans la limite de 2 participants et ne reçoivent jamais
// les messages offer/answer/ice/sync.
const controlSockets = new Map();

function broadcastToRoom(code, sender, data) {
  const room = rooms.get(code);
  if (!room) return;
  for (const client of room) {
    if (client !== sender && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }
}

function broadcastToControllers(code, data) {
  const set = controlSockets.get(code);
  if (!set) return;
  for (const client of set) {
    if (client.readyState === 1) client.send(JSON.stringify(data));
  }
}

function leaveControlSocket(ws) {
  if (ws.controlCode && controlSockets.has(ws.controlCode)) {
    const set = controlSockets.get(ws.controlCode);
    set.delete(ws);
    if (set.size === 0) controlSockets.delete(ws.controlCode);
  }
  ws.controlCode = null;
}

function leaveCurrentRoom(ws) {
  if (ws.roomCode && rooms.has(ws.roomCode)) {
    const code = ws.roomCode;
    const room = rooms.get(code);
    const wasHost = ws.isHost;
    room.delete(ws);

    if (wasHost) {
      // L'hôte a fermé/quitté : la session s'arrête pour tout le monde.
      // On ne laisse jamais l'invité seul, en attente d'un hôte qui n'existe
      // plus. On ferme le salon et on prévient tous les sockets restants
      // (normalement juste l'invité) avec un message dédié, distinct de
      // 'peer-left', pour que le client sache qu'il doit sortir complètement
      // au lieu de repasser en simple "attente".
      for (const client of room) {
        if (client.readyState === 1) client.send(JSON.stringify({ type: 'host-left' }));
        client.roomCode = null;
      }
      rooms.delete(code);
      controlSockets.delete(code); // ferme aussi le script compagnon (pilotage) lié à ce salon
    } else {
      broadcastToRoom(code, ws, { type: 'peer-left' });
      if (room.size === 0) rooms.delete(code);
    }
  }
  ws.roomCode = null;
  ws.isHost = false;
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.controlCode = null;
  ws.isHost = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      leaveCurrentRoom(ws); // defensive: never let one socket sit in two rooms
      // génère un code de salon court
      const code = Math.random().toString(36).substring(2, 7).toUpperCase();
      rooms.set(code, new Set([ws]));
      ws.roomCode = code;
      ws.isHost = true;
      ws.send(JSON.stringify({ type: 'created', code }));
      return;
    }

    if (msg.type === 'join') {
      leaveCurrentRoom(ws); // defensive: never let one socket sit in two rooms
      const room = rooms.get(msg.code);
      if (!room || room.size >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Salon introuvable ou plein.' }));
        return;
      }
      room.add(ws);
      ws.roomCode = msg.code;
      ws.isHost = false;
      ws.send(JSON.stringify({ type: 'joined', code: msg.code }));
      broadcastToRoom(msg.code, ws, { type: 'peer-joined' });
      return;
    }

    // le script compagnon (Tampermonkey, dans l'onglet Netflix/Prime/etc.)
    // rejoint un salon existant pour recevoir les commandes de pilotage —
    // ne touche jamais à `rooms`, donc n'occupe pas une des 2 places.
    if (msg.type === 'control-join') {
      leaveControlSocket(ws);
      if (!rooms.has(msg.code)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Salon introuvable.' }));
        return;
      }
      if (!controlSockets.has(msg.code)) controlSockets.set(msg.code, new Set());
      controlSockets.get(msg.code).add(ws);
      ws.controlCode = msg.code;
      ws.send(JSON.stringify({ type: 'control-joined', code: msg.code }));
      return;
    }

    // une app cliente (host ou invité) envoie une commande de pilotage
    // (clic / touche) -> relayée uniquement aux scripts compagnons du salon
    if (msg.type === 'remote-input' && ws.roomCode) {
      broadcastToControllers(ws.roomCode, msg);
      return;
    }

    // relais direct des messages WebRTC (offer / answer / ice candidates)
    // + des messages "sync" (lecture/pause/avance de la vidéo partagée par lien)
    if (['offer', 'answer', 'ice', 'sync'].includes(msg.type) && ws.roomCode) {
      broadcastToRoom(ws.roomCode, ws, msg);
    }
  });

  ws.on('close', () => { leaveCurrentRoom(ws); leaveControlSocket(ws); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Cine2 lancé sur le port ${PORT}`));
