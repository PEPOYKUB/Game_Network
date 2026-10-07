// Room lifecycle (lobby → stage select → play) and every Socket.IO event the client uses.
// Co-op rooms (mode "coop") are handled here unchanged; FFA / 2v2 rooms are delegated to competitive.js.
import { randomInt, randomUUID } from 'node:crypto';
import { stageCatalog, STAGES } from './stages/index.js';
import { startRun, execute, submitForm, revealHint, roleView, publicRun, publicProgress } from './engine.js';
import { scoreRun } from './scoring.js';
import { recordTeam, topTeams } from './leaderboard.js';
import { levelForStage, spawnPlayer, movePlayer, nearbyComputer } from '../../public/js/world.js';
import { createCompetitive, COMPETITIVE_MODES } from './competitive.js';

export const CHARACTERS = ['ping', 'student-one', 'student-two', 'packet', 'router', 'switch', 'cache', 'byte'];
const ROLES = ['A', 'B'];
const EMPTY_ROOM_TTL = 10 * 60 * 1000;
const rooms = new Map();

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

function newCode() {
  let code;
  do code = String(randomInt(1000, 10000)); while (rooms.has(code));
  return code;
}

function unlockedUpTo(room) {
  if (room.options.unlockAll) return STAGES.length;
  const cleared = Object.keys(room.progress.cleared).map(Number);
  return Math.min(STAGES.length, (cleared.length ? Math.max(...cleared) : 0) + 1);
}

function publicPlayer(p) {
  return p ? { name: p.name, charId: p.charId, ready: p.ready, connected: p.connected, x: p.x, y: p.y, facing: p.facing, direction: p.direction, moving: p.moving, terminal: p.terminal } : null;
}

function roleOf(room, playerId) {
  return ROLES.find((r) => room.slots[r]?.id === playerId) || null;
}

export function attachRooms(io) {
  const emitState = (room) => {
    for (const role of ROLES) {
      const p = room.slots[role];
      if (!p?.connected) continue;
      io.to(p.socketId).emit('room:state', {
        code: room.code,
        phase: room.phase,
        you: role,
        now: Date.now(),
        options: room.options,
        players: { A: publicPlayer(room.slots.A), B: publicPlayer(room.slots.B) },
        progress: { cleared: room.progress.cleared, unlocked: unlockedUpTo(room), finalCode: room.progress.finalCode || null },
        run: room.run ? publicRun(room.run) : null,
        mode: 'coop',
        stageProgress: publicProgress(room.run),
      });
    }
  };

  const emitViews = (room) => {
    if (!room.run) return;
    for (const role of ROLES) {
      const p = room.slots[role];
      if (p?.connected) io.to(p.socketId).emit('stage:view', roleView(room.run, role));
    }
  };

  const system = (room, text) => {
    const msg = { from: 'sys', text, at: Date.now() };
    room.chat.push(msg);
    room.chat = room.chat.slice(-60);
    io.to(room.code).emit('chat:msg', msg);
  };

  const complete = (room) => {
    const run = room.run;
    run.completedAt = Date.now();
    const score = scoreRun(run);
    const finalCode = run.stage.finalCode ? run.stage.finalCode(run.s) : null;
    run.result = { ...score, explanation: run.stage.explanation(run.s), finalCode };
    run.scoreEvents.push({ type: 'stage_complete', value: score.total, at: run.completedAt });
    const prev = room.progress.cleared[run.stage.id];
    if (!prev || score.total > prev.score) room.progress.cleared[run.stage.id] = { score: score.total, time: score.elapsed };
    if (finalCode) room.progress.finalCode = finalCode;
    recordTeam({ id: room.id, team: `${room.slots.A?.name ?? '?'} & ${room.slots.B?.name ?? '?'}`, cleared: room.progress.cleared, finalCode: room.progress.finalCode });
    system(room, `SYSTEM LINK A ↔ B: ONLINE — ผ่านด่าน ${run.stage.id} (${score.total} คะแนน)`);
    io.to(room.code).emit('stage:complete', { stageId: run.stage.id, result: run.result });
  };

  const findRoom = (socket) => rooms.get(socket.data.code) || null;
  const cleanupLater = (room) => {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_TTL);
    room.cleanupTimer.unref?.();
  };
  /** The competitive room this socket belongs to, or null for co-op / no room. */
  const competitive = (socket) => {
    const room = findRoom(socket);
    return room && room.mode !== 'coop' ? room : null;
  };

  /**
   * Make `socket` the only connection that speaks for `player`. A previous socket of the same player
   * (old tab, half-open connection) loses its room membership and identity, so it can neither act
   * nor keep receiving room broadcasts. The socket also leaves any other room it was in.
   */
  const bindSocket = (socket, room, player) => {
    const previous = player.socketId && player.socketId !== socket.id ? io.sockets.sockets.get(player.socketId) : null;
    if (previous) {
      previous.leave(room.code);
      previous.data.code = null;
      previous.data.playerId = null;
      previous.emit('session:replaced', { code: room.code });
    }
    if (socket.data.code && socket.data.code !== room.code) socket.leave(socket.data.code);
    player.socketId = socket.id;
    player.connected = true;
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
  };

  const join = (socket, room, player, role) => {
    bindSocket(socket, room, player);
    clearTimeout(room.cleanupTimer);
    socket.emit('chat:history', room.chat);
    return { ok: true, code: room.code, role };
  };

  const comp = createCompetitive({ io, rooms, clean, characters: CHARACTERS, system, unlockedUpTo, cleanupLater, bindSocket });

  io.on('connection', (socket) => {
    socket.data.execTimes = [];

    socket.on('room:create', (payload, ack) => {
      const playerId = clean(payload?.playerId, 64) || randomUUID();
      const mode = COMPETITIVE_MODES.includes(payload?.mode) ? payload.mode : 'coop';
      const room = {
        mode,
        code: newCode(),
        id: randomUUID(),
        createdAt: Date.now(),
        options: { sample: Boolean(payload?.sample), unlockAll: Boolean(payload?.unlockAll) },
        slots: { A: null, B: null },
        phase: 'lobby',
        progress: { cleared: {}, finalCode: null },
        run: null,
        chat: [],
        cleanupTimer: null,
      };
      rooms.set(room.code, room);
      if (mode !== 'coop') return comp.create(socket, { ...payload, playerId }, ack, room);
      room.slots.A = { id: playerId, name: clean(payload?.name, 16) || 'PLAYER-A', charId: 'ping', ready: false, connected: true, socketId: socket.id, ...spawnPlayer(1, 'A') };
      const res = join(socket, room, room.slots.A, 'A');
      system(room, `${room.slots.A.name} สร้างห้อง ${room.code} (ห้อง A)`);
      ack?.(res);
      emitState(room);
    });

    socket.on('room:join', (payload, ack) => {
      const code = clean(payload?.code, 4);
      const room = rooms.get(code);
      if (!room) return ack?.({ ok: false, error: `ไม่พบห้องหมายเลข ${code || '-'}` });
      const playerId = clean(payload?.playerId, 64) || randomUUID();
      if (room.mode !== 'coop') return comp.join(socket, { ...payload, playerId }, ack, room);
      const existing = roleOf(room, playerId);
      if (existing) {
        const res = join(socket, room, room.slots[existing], existing);
        system(room, `${room.slots[existing].name} กลับเข้าห้องแล้ว`);
        ack?.(res);
        emitState(room);
        if (room.run) socket.emit('stage:view', roleView(room.run, existing));
        return undefined;
      }
      // A new browser session may take over a slot whose player disconnected (closed tab, crashed browser).
      const role = ROLES.find((r) => !room.slots[r]) || ROLES.find((r) => !room.slots[r].connected);
      if (!role) return ack?.({ ok: false, error: 'ห้องนี้มีผู้เล่นครบ 2 คนแล้ว' });
      const replaced = room.slots[role];
      if (replaced) {
        replaced.id = playerId;
        replaced.name = clean(payload?.name, 16) || replaced.name;
        const res = join(socket, room, replaced, role);
        system(room, `${replaced.name} เข้ามาแทนที่ในห้อง ${role}`);
        ack?.(res);
        emitState(room);
        if (room.run) socket.emit('stage:view', roleView(room.run, role));
        return undefined;
      }
      const taken = room.slots[role === 'A' ? 'B' : 'A']?.charId;
      room.slots[role] = {
        id: playerId,
        name: clean(payload?.name, 16) || `PLAYER-${role}`,
        charId: CHARACTERS.find((c) => c !== taken && c !== 'ping') || 'packet',
        ready: false,
        connected: true,
        socketId: socket.id,
        ...spawnPlayer(room.run?.stage.id || 1, role),
      };
      const res = join(socket, room, room.slots[role], role);
      system(room, `${room.slots[role].name} เข้าร่วมเป็นห้อง ${role}`);
      ack?.(res);
      emitState(room);
      return undefined;
    });

    socket.on('room:leave', () => {
      const c = competitive(socket);
      if (c) return comp.leave(socket, c);
      const room = findRoom(socket);
      if (!room) return;
      const role = roleOf(room, socket.data.playerId);
      socket.leave(room.code);
      socket.data.code = null;
      if (!role) return;
      const name = room.slots[role].name;
      room.slots[role] = null;
      if (!room.slots.A && !room.slots.B) {
        rooms.delete(room.code);
        return;
      }
      room.phase = 'lobby';
      room.run = null;
      for (const r of ROLES) if (room.slots[r]) room.slots[r].ready = false;
      system(room, `${name} ออกจากห้อง — รอผู้เล่นใหม่`);
      emitState(room);
    });

    socket.on('lobby:character', (payload) => {
      const c = competitive(socket);
      if (c) return comp.character(socket, payload, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'lobby' || !CHARACTERS.includes(payload?.charId)) return;
      room.slots[role].charId = payload.charId;
      emitState(room);
    });

    socket.on('lobby:ready', (payload) => {
      const c = competitive(socket);
      if (c) return comp.ready(socket, payload, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'lobby') return;
      room.slots[role].ready = Boolean(payload?.ready);
      emitState(room);
    });

    socket.on('lobby:swap', () => {
      const c = competitive(socket);
      if (c) return undefined;
      const room = findRoom(socket);
      if (!room || room.phase !== 'lobby' || !roleOf(room, socket.data.playerId)) return;
      [room.slots.A, room.slots.B] = [room.slots.B, room.slots.A];
      for (const r of ROLES) if (room.slots[r]) room.slots[r].ready = false;
      system(room, 'สลับห้อง A ↔ B แล้ว');
      emitState(room);
    });

    socket.on('lobby:start', (_payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.lobbyStart(socket, ack, c);
      const room = findRoom(socket);
      if (!room || !roleOf(room, socket.data.playerId)) return ack?.({ ok: false });
      const both = ROLES.every((r) => room.slots[r]?.connected && room.slots[r].ready);
      if (!both) return ack?.({ ok: false, error: 'ต้องมีผู้เล่นครบ 2 คนและกดพร้อมทั้งคู่' });
      room.phase = 'select';
      emitState(room);
      return ack?.({ ok: true });
    });

    socket.on('lobby:team', (payload, ack) => {
      const room = findRoom(socket);
      if (!room) return ack?.({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
      return comp.team(socket, payload, ack, room);
    });

    socket.on('stage:role', (payload, ack) => {
      const c = competitive(socket);
      if (!c) return ack?.({ ok: false, error: 'ใช้ได้เฉพาะโหมดแข่งขัน' });
      return comp.role(socket, payload, ack, c);
    });

    socket.on('item:pickup', (payload, ack) => {
      const c = competitive(socket);
      if (!c) return ack?.({ ok: false, error: 'ไอเทมใช้ได้เฉพาะโหมดแข่งขัน' });
      return comp.itemPickup(socket, payload, ack, c);
    });

    socket.on('item:use', (payload, ack) => {
      const c = competitive(socket);
      if (!c) return ack?.({ ok: false, error: 'ไอเทมใช้ได้เฉพาะโหมดแข่งขัน' });
      return comp.itemUse(socket, payload, ack, c);
    });

    socket.on('stage:catalog', (_payload, ack) => {
      const room = findRoom(socket);
      ack?.({ stages: stageCatalog(), leaderboard: topTeams(10, room?.id) });
    });

    socket.on('stage:start', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.stageStart(socket, payload, ack, c);
      const room = findRoom(socket);
      if (!room || !roleOf(room, socket.data.playerId)) return ack?.({ ok: false });
      const id = Number(payload?.stageId);
      const canPick = room.phase === 'select' || (room.phase === 'play' && room.run?.result);
      if (!canPick) return ack?.({ ok: false, error: 'กำลังเล่นด่านอยู่' });
      if (!ROLES.every((r) => room.slots[r])) return ack?.({ ok: false, error: 'ต้องมีผู้เล่นครบ 2 คน' });
      if (!Number.isInteger(id) || id < 1 || id > unlockedUpTo(room)) return ack?.({ ok: false, error: 'ด่านนี้ยังล็อกอยู่' });
      room.run = startRun(id, { sample: room.options.sample, seed: randomInt(1, 2 ** 31) });
      for (const role of ROLES) {
        if (room.slots[role]) Object.assign(room.slots[role], spawnPlayer(id, role));
      }
      room.phase = 'play';
      system(room, `เริ่มด่าน ${id}: ${room.run.stage.title} — System Link A ↔ B: OFFLINE`);
      emitState(room);
      emitViews(room);
      return ack?.({ ok: true });
    });

    socket.on('stage:quit', () => {
      const c = competitive(socket);
      if (c) return comp.stageQuit(socket, c);
      const room = findRoom(socket);
      if (!room || !roleOf(room, socket.data.playerId) || room.phase !== 'play') return;
      const unfinished = room.run && !room.run.result;
      room.phase = 'select';
      room.run = null;
      if (unfinished) system(room, 'ออกจากด่านกลับไปหน้าเลือกด่าน');
      emitState(room);
    });

    socket.on('player:move', (payload) => {
      const c = competitive(socket);
      if (c) return comp.move(socket, payload, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'play' || !room.run || !room.slots[role]) return;
      const player = room.slots[role];
      const now = Date.now();
      const dt = Math.min(0.1, Math.max(0, (now - (player.lastMoveAt || now)) / 1000));
      player.lastMoveAt = now;
      const level = levelForStage(room.run.stage.id);
      // Apply the direction that was held since the previous packet, then
      // remember the new one; this matches how long the key was really down.
      const next = movePlayer(level, role, player, player.input, dt, Boolean(room.run.passed));
      Object.assign(player, next);
      player.input = { x: Number(payload?.x) || 0, y: Number(payload?.y) || 0 };
      if (player.input.x || player.input.y) player.moving = true;
      io.to(room.code).emit('room:players', { players: { A: publicPlayer(room.slots.A), B: publicPlayer(room.slots.B) } });
    });

    socket.on('player:interact', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.interact(socket, payload, ack, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'play' || !room.run || !room.slots[role]) return ack?.({ ok: false, error: 'ยังไม่ได้เริ่มด่าน' });
      const player = room.slots[role];
      const station = nearbyComputer(levelForStage(room.run.stage.id), role, player);
      if (!station) return ack?.({ ok: false, error: 'เดินเข้าใกล้คอมพิวเตอร์ก่อน' });
      player.terminal = Boolean(payload?.open);
      io.to(room.code).emit('room:players', { players: { A: publicPlayer(room.slots.A), B: publicPlayer(room.slots.B) } });
      io.to(room.code).emit('activity', { role, kind: player.terminal ? 'terminal-open' : 'terminal-close' });
      ack?.({ ok: true, open: player.terminal });
    });

    socket.on('term:exec', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.exec(socket, payload, ack, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'play' || !room.run) return ack?.({ lines: [] });
      if (!room.slots[role].terminal) return ack?.({ lines: [{ t: 'เดินไปที่คอมพิวเตอร์แล้วกด E เพื่อเปิด Terminal', c: 'warn', d: 0 }] });
      const now = Date.now();
      socket.data.execTimes = socket.data.execTimes.filter((t) => now - t < 2000);
      if (socket.data.execTimes.length >= 10) return ack?.({ lines: [{ t: 'พิมพ์คำสั่งเร็วเกินไป — รอสักครู่', c: 'warn', d: 0 }] });
      socket.data.execTimes.push(now);
      const res = execute(room.run, role, clean(payload?.line, 200));
      const device = room.run.stage.roles[role].device(room.run.s);
      ack?.({ lines: res.lines, prompt: device?.prompt });
      if (res.counted) io.to(room.code).emit('activity', { role, kind: res.kind === 'config' ? 'config' : 'exec' });
      if (res.passedNow) complete(room);
      if (res.counted || res.passedNow) {
        emitState(room);
        emitViews(room);
      }
      return undefined;
    });

    socket.on('form:submit', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.form(socket, payload, ack, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'play' || !room.run) return ack?.({ ok: false, message: 'ไม่ได้อยู่ในด่าน' });
      const res = submitForm(room.run, role, payload?.data);
      ack?.({ ok: res.ok, message: res.message });
      io.to(room.code).emit('activity', { role, kind: 'form' });
      if (res.passedNow) complete(room);
      emitState(room);
      emitViews(room);
      return undefined;
    });

    socket.on('hint:reveal', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.hint(socket, payload, ack, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || !room.run) return ack?.({ ok: false });
      const res = revealHint(room.run, Number(payload?.level));
      if (res.error) return ack?.({ ok: false, error: res.error });
      system(room, `${room.slots[role].name} เปิดคำใบ้ระดับ ${res.hint.level} (−${res.hint.penalty} คะแนน)`);
      emitState(room);
      return ack?.({ ok: true });
    });

    socket.on('chat:send', (payload) => {
      const c = competitive(socket);
      if (c) return comp.chat(socket, payload, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      const text = clean(payload?.text, 240);
      if (!role || !text) return;
      const msg = { from: role, name: room.slots[role].name, text, at: Date.now() };
      room.chat.push(msg);
      room.chat = room.chat.slice(-60);
      io.to(room.code).emit('chat:msg', msg);
    });

    socket.on('activity', (payload) => {
      const c = competitive(socket);
      if (c) return undefined;
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || !['typing', 'docs'].includes(payload?.kind)) return;
      socket.to(room.code).emit('activity', { role, kind: payload.kind });
    });

    socket.on('disconnect', () => {
      const c = competitive(socket);
      if (c) return comp.disconnect(socket, c);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.slots[role].socketId !== socket.id) return;
      room.slots[role].connected = false;
      room.slots[role].input = null;
      room.slots[role].moving = false;
      room.slots[role].ready = room.phase === 'lobby' ? false : room.slots[role].ready;
      system(room, `${room.slots[role].name} หลุดการเชื่อมต่อ — เข้าห้อง ${room.code} อีกครั้งเพื่อเล่นต่อ`);
      emitState(room);
      if (!ROLES.some((r) => room.slots[r]?.connected)) cleanupLater(room);
    });
  });
}

export function roomCount() {
  return rooms.size;
}

/** Test-only access to authoritative room state (no socket path reaches this). */
export function inspectRoom(code) {
  return rooms.get(code) || null;
}
