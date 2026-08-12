import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const rooms = new Map();

const puzzles = [
  { id: 0, type: 'subnet', title: '01 / SUBNET MATCH', prompt: 'จับคู่ IP กับ subnet ที่อยู่เครือข่ายเดียวกัน', hint: 'เครือข่าย /24 เดียวกันต้องมี 3 octet แรกเหมือนกัน', answer: 'A-2', left: ['A 192.168.10.42', 'B 10.0.0.7', 'C 172.16.4.9'], right: ['1 192.168.11.8', '2 192.168.10.99', '3 10.0.1.5'] },
  { id: 1, type: 'mac', title: '02 / ROGUE DEVICE', prompt: 'หาอุปกรณ์ที่ไม่อยู่ใน vendor list ของทีม', hint: 'อุปกรณ์ปลอมใช้ OUI แปลกจากกลุ่ม 3 เครื่องแรก', answer: 'C', left: ['A 00:1A:2B:4C:11:90  / Dell', 'B 00:1A:2B:4C:11:91  / Dell', 'C DE:AD:BE:EF:42:00  / UNKNOWN'] },
  { id: 2, type: 'terminal', title: '03 / TERMINAL LINK', prompt: 'ส่งคำสั่งที่ตรวจเส้นทางไปยัง gateway', hint: 'คำสั่งนี้แสดง hop ระหว่างต้นทางและปลายทาง', answer: 'traceroute 10.0.0.1', left: ['ping 10.0.0.1', 'traceroute 10.0.0.1', 'ipconfig /all'] },
  { id: 3, type: 'packet', title: '04 / PACKET SNIFFER', prompt: 'เลือก packet ที่มี port น่าสงสัย', hint: 'บริการที่ไม่เข้ารหัสมักเปิดที่ port 23', answer: 'B', left: ['A 10.0.0.4 → 10.0.0.8  :443  HTTPS', 'B 10.0.0.7 → 10.0.0.4  :23  TELNET', 'C 10.0.0.4 → 8.8.8.8  :53  DNS'] }
];

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('*splat', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

function roomState(code) {
  if (!rooms.has(code)) rooms.set(code, { players: {}, puzzle: 0, solved: [], messages: [], pinged: [], gateReady: [], doorOpen: false, stage: 0 });
  return rooms.get(code);
}
function publicState(room) {
  return { puzzle: room.puzzle, solved: room.solved, pinged: room.pinged, gateReady: room.gateReady, doorOpen: room.doorOpen, stage: room.stage, players: Object.values(room.players).map(({ id, name, side, ready, x, y }) => ({ id, name, side, ready, x, y })), messages: room.messages.slice(-20) };
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomCode, name, side }, reply) => {
    const code = String(roomCode || '').trim().toUpperCase().slice(0, 8) || 'DEMO01';
    const room = roomState(code);
    if (Object.keys(room.players).length >= 2) return reply?.({ error: 'ห้องนี้มีผู้เล่นครบแล้ว' });
    const chosenSide = side === 'right' || Object.values(room.players).some(p => p.side === 'left') ? 'right' : 'left';
    socket.join(code); socket.data.roomCode = code;
    room.players[socket.id] = { id: socket.id, name: String(name || 'PLAYER').slice(0, 16), side: chosenSide, ready: false, x: chosenSide === 'left' ? 260 : 1320, y: 420 };
    reply?.({ ok: true, roomCode: code, side: chosenSide, puzzles });
    io.to(code).emit('state', publicState(room));
    io.to(code).emit('system', `${room.players[socket.id].name} เข้าห้องฝั่ง ${chosenSide.toUpperCase()}`);
  });
  socket.on('ready', (ready) => { const room = rooms.get(socket.data.roomCode); if (!room?.players[socket.id]) return; room.players[socket.id].ready = Boolean(ready); io.to(socket.data.roomCode).emit('state', publicState(room)); });
  socket.on('player-move', ({ x, y }) => { const room = rooms.get(socket.data.roomCode); const player = room?.players[socket.id]; if (!player) return; player.x = Math.max(55, Math.min(1545, Number(x) || player.x)); player.y = Math.max(135, Math.min(755, Number(y) || player.y)); socket.to(socket.data.roomCode).emit('state', publicState(room)); });
  socket.on('ping-quest', ({ command }, reply) => { const room = rooms.get(socket.data.roomCode); const player = room?.players[socket.id]; if (!room || !player) return; const normalized = String(command || '').trim().toLowerCase().replace(/\s+/g, ' '); const expected = ['ping 10.0.0.2', 'traceroute 10.30.0.10', 'nslookup gateway.lab'][room.stage]; const valid = normalized === expected; if (valid && !room.pinged.includes(socket.id)) room.pinged.push(socket.id); if (room.pinged.length >= 2) room.doorOpen = true; reply?.({ valid, doorOpen: room.doorOpen, waiting: valid && !room.doorOpen, stage: room.stage }); io.to(socket.data.roomCode).emit('state', publicState(room)); });
  socket.on('advance-room', (reply) => { const room = rooms.get(socket.data.roomCode); const player = room?.players[socket.id]; if (!room || !player || !room.doorOpen) return reply?.({ ok: false, error: 'ประตูยังไม่เปิด' }); if (Math.abs(player.x - 800) > 150) return reply?.({ ok: false, error: 'ต้องเดินมายืนที่ Gateway ก่อน' }); if (!room.gateReady.includes(socket.id)) room.gateReady.push(socket.id); if (room.gateReady.length >= 2) { room.stage = Math.min(2, room.stage + 1); room.pinged = []; room.gateReady = []; room.doorOpen = false; Object.values(room.players).forEach(p => { p.x = p.side === 'left' ? 220 : 1380; p.y = 470; }); } reply?.({ ok: true, stage: room.stage, waiting: room.gateReady.length < 2 }); io.to(socket.data.roomCode).emit('state', publicState(room)); });
  socket.on('chat', (text) => { const room = rooms.get(socket.data.roomCode); const player = room?.players[socket.id]; if (!player || !String(text).trim()) return; const message = { name: player.name, side: player.side, text: String(text).slice(0, 180), at: Date.now() }; room.messages.push(message); io.to(socket.data.roomCode).emit('chat', message); });
  socket.on('submit-answer', ({ answer, puzzleId }, reply) => { const room = rooms.get(socket.data.roomCode); const player = room?.players[socket.id]; if (!room || !player) return; const puzzle = puzzles[Number.isInteger(puzzleId) ? puzzleId : room.puzzle]; const correct = Boolean(puzzle) && String(answer).trim().toLowerCase() === puzzle.answer.toLowerCase(); if (correct && !room.solved.includes(puzzle.id)) { room.solved.push(puzzle.id); room.puzzle = Math.min(puzzles.length, room.puzzle + 1); } reply?.({ correct, puzzle: room.puzzle, complete: room.solved.length === puzzles.length }); io.to(socket.data.roomCode).emit('state', publicState(room)); });
  socket.on('disconnect', () => { const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return; const name = room.players[socket.id]?.name; delete room.players[socket.id]; room.pinged = room.pinged.filter(id => id !== socket.id); room.gateReady = room.gateReady.filter(id => id !== socket.id); if (name) io.to(code).emit('system', `${name} ออกจากห้อง`); io.to(code).emit('state', publicState(room)); if (!Object.keys(room.players).length) rooms.delete(code); });
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Two Rooms server running at http://localhost:${PORT}`));
