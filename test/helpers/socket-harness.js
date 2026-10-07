// Spins up the real Express-free Socket.IO room server on a random port for integration tests.
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { attachRooms } from '../../server/game/rooms.js';
import { initLeaderboard } from '../../server/game/leaderboard.js';

export async function startServer() {
  initLeaderboard(path.join(os.tmpdir(), `kuhu-test-leaderboard-${process.pid}.json`));
  const http = createServer();
  const io = new Server(http);
  attachRooms(io);
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${http.address().port}`;
  const clients = [];
  return {
    url,
    async client(playerId) {
      const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      clients.push(socket);
      return wrap(socket, playerId);
    },
    async close() {
      for (const c of clients) c.disconnect();
      io.close();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}

function wrap(socket, playerId) {
  const last = {};
  const log = [];
  socket.onAny((event, payload) => { last[event] = payload; log.push({ event, payload }); });
  return {
    socket,
    playerId,
    last,
    log,
    send(event, payload = {}) {
      return new Promise((resolve, reject) => {
        socket.timeout(3000).emit(event, payload, (error, reply) => (error ? reject(error) : resolve(reply)));
      });
    },
    fire(event, payload = {}) { socket.emit(event, payload); },
    /** Resolves with the next `event` payload matching `predicate` (or immediately if already seen and `since` allows). */
    next(event, predicate = () => true, timeout = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for ${event}`)); }, timeout);
        function handler(payload) {
          if (!predicate(payload)) return;
          clearTimeout(timer);
          socket.off(event, handler);
          resolve(payload);
        }
        socket.on(event, handler);
      });
    },
    disconnect() { socket.disconnect(); },
  };
}

export const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
