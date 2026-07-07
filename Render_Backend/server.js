import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3001;

const rooms = new Map();

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  ws.room = null;

  ws.on('message', (messageAsString) => {
    try {
      const message = JSON.parse(messageAsString);
      const { type, room, payload } = message;

      if (type === 'join') {
        const roomCode = room || Math.random().toString(36).substring(2, 8).toUpperCase();
        ws.room = roomCode;
        ws.deviceName = payload?.deviceName || 'Guest Device';
        
        if (!rooms.has(roomCode)) {
          rooms.set(roomCode, new Set());
        }
        rooms.get(roomCode).add(ws);

        ws.send(JSON.stringify({
          type: 'joined',
          room: roomCode,
          peerId: ws.id,
          peers: Array.from(rooms.get(roomCode)).filter(c => c.id !== ws.id).map(c => ({
            id: c.id,
            deviceName: c.deviceName
          }))
        }));

        broadcastToRoom(roomCode, ws.id, {
          type: 'peer-joined',
          peerId: ws.id,
          deviceName: ws.deviceName
        });
      } else if (type === 'signal') {
        const targetId = payload.target;
        const targetWs = Array.from(rooms.get(ws.room) || []).find(c => c.id === targetId);
        
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: 'signal',
            payload: {
              ...payload,
              source: ws.id
            }
          }));
        }
      }
    } catch (err) {
      console.error('Invalid message format', err);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      if (rooms.get(ws.room).size === 0) {
        rooms.delete(ws.room);
      } else {
        broadcastToRoom(ws.room, ws.id, {
          type: 'peer-left',
          peerId: ws.id
        });
      }
    }
  });
});

function broadcastToRoom(roomCode, senderId, message) {
  if (rooms.has(roomCode)) {
    for (const client of rooms.get(roomCode)) {
      if (client.id !== senderId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    }
  }
}

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
