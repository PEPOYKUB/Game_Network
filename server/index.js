import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRooms, roomCount } from './game/rooms.js';
import { initLeaderboard } from './game/leaderboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

initLeaderboard(path.join(ROOT, 'data', 'leaderboard.json'));
attachRooms(io);

const PUBLIC = path.join(ROOT, 'public');
app.use(express.static(PUBLIC));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: roomCount() }));
// SPA fallback for page routes; missing files (favicon, source maps...) get a plain 404.
app.get('*splat', (req, res) => (path.extname(req.path) ? res.sendStatus(404) : res.sendFile('index.html', { root: PUBLIC })));

httpServer.listen(PORT, '0.0.0.0', () => console.log(`KUHU NET // Two Rooms, One Network → http://localhost:${PORT}`));
