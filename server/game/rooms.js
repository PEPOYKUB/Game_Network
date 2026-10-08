// Room lifecycle (lobby → stage select → play) and every Socket.IO event the client uses.
// Co-op rooms (mode "coop") are handled here unchanged; FFA / 2v2 rooms are delegated to competitive.js
// and solo practice rooms (mode "solo") to solo.js.
import { randomInt, randomUUID } from 'node:crypto';
import { stageCatalog, STAGES } from './stages/index.js';
import { startFreshRun, scenarioFingerprint, execute, submitForm, revealHint, roleView, publicRun, publicProgress } from './engine.js';
import { scoreRun } from './scoring.js';
import { recordTeam, topTeams } from './leaderboard.js';
import { levelForStage, spawnPlayer, movePlayer, nearbyComputer } from '../../public/js/world.js';
import { createCompetitive, COMPETITIVE_MODES } from './competitive.js';
import { createSolo } from './solo.js';

export const CHARACTERS = ['ping', 'student-one', 'student-two', 'packet', 'router', 'switch', 'cache', 'byte'];
const ROLES = ['A', 'B'];
/** Test hook: override the co-op stage time limit (production uses each stage's minutes). */
export const ROOM_CONFIG = { coopStageMs: null };
export function configureRooms(overrides = {}) {
  Object.assign(ROOM_CONFIG, overrides);
}

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
    clearTimeout(room.stageTimer);
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

  // Co-op retry vote: only connected players are eligible, so one player is not stuck waiting
  // for a partner who closed the tab. A partner who reconnects before it completes must vote too.
  const coopVoters = (room) => ROLES.filter((r) => room.slots[r]?.connected);
  const coopRetryStatus = (room) => {
    const eligible = coopVoters(room);
    return { ok: true, waiting: true, count: eligible.filter((r) => room.retryVotes?.has(r)).length, total: eligible.length };
  };
  const settleCoopRetry = (room) => {
    const votes = room.retryVotes;
    if (!votes || room.phase !== 'ended' || !room.run?.result?.gameOver) return null;
    const eligible = coopVoters(room);
    for (const r of [...votes]) if (!eligible.includes(r)) votes.delete(r);
    if (!eligible.length || !eligible.every((r) => votes.has(r))) {
      if (votes.size) io.to(room.code).emit('stage:retry:vote', { count: votes.size, total: eligible.length });
      return null;
    }
    io.to(room.code).emit('stage:retry:vote', { count: eligible.length, total: eligible.length, complete: true });
    startCoopStage(room, room.run.stage.id);
    return { ok: true, waiting: false, count: eligible.length, total: eligible.length };
  };

  const startCoopStage = (room, id) => {
    const previousFingerprint = room.lastScenarioFingerprints?.get(id) || null;
    room.run = startFreshRun(id, { sample: room.options.sample, previousFingerprint });
    room.lastScenarioFingerprints ||= new Map();
    room.lastScenarioFingerprints.set(id, scenarioFingerprint(room.run));
    room.retryVotes = new Set();
    clearTimeout(room.stageTimer);
    room.stageTimer = setTimeout(() => {
      if (room.phase !== 'play' || !room.run || room.run.result) return;
      const now = Date.now();
      room.run.completedAt = now;
      const score = scoreRun(room.run);
      room.run.result = { ...score, explanation: 'หมดเวลา — ความคืบหน้าของทีมถูกบันทึกไว้ แต่ยังทำด่านไม่สำเร็จ', timedOut: true, gameOver: true };
      room.phase = 'ended';
      room.retryVotes = new Set();
      for (const role of ROLES) {
        const p = room.slots[role];
        if (p) { p.terminal = false; p.input = null; p.moving = false; }
      }
      system(room, `หมดเวลาด่าน ${room.run.stage.id} — Game Over · ทีมได้ ${score.total} คะแนนจากความคืบหน้า`);
      io.to(room.code).emit('game:over', { stageId: room.run.stage.id, mode: 'coop' });
      emitState(room);
    }, Number(ROOM_CONFIG.coopStageMs) > 0 ? Number(ROOM_CONFIG.coopStageMs) : room.run.stage.minutes * 60_000);
    room.stageTimer.unref?.();
    for (const role of ROLES) if (room.slots[role]) Object.assign(room.slots[role], spawnPlayer(id, role));
    room.phase = 'play';
    system(room, `เริ่มด่าน ${id}: ${room.run.stage.title} — System Link A ↔ B: OFFLINE`);
    emitState(room);
    emitViews(room);
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
    return room && COMPETITIVE_MODES.includes(room.mode) ? room : null;
  };
  /** The solo practice room this socket belongs to, or null. */
  const soloRoom = (socket) => {
    const room = findRoom(socket);
    return room && room.mode === 'solo' ? room : null;
  };

  const voiceEntries = (room) => (room.mode === 'coop'
    ? ROLES.map((seat) => ({ seat, player: room.slots[seat] }))
    : Object.keys(room.seats || {}).map((seat) => ({ seat, player: room.seats[seat] })));
  const voiceSeatOf = (room, socket) => voiceEntries(room).find(({ player }) => player?.id === socket.data.playerId && player.socketId === socket.id)?.seat || null;
  const voicePlayer = (room, seat) => room.mode === 'coop' ? room.slots[seat] : room.seats[seat];
  const voicePairAllowed = (room, a, b) => {
    if (!a?.voice?.active || !b?.voice?.active || !a.connected || !b.connected) return false;
    if (room.mode !== 'team') return true;
    const allows = (from, to) => from.voice.channel !== 'team' || from.teamId === to.teamId;
    return allows(a, b) && allows(b, a);
  };
  const emitVoiceRoster = (room) => {
    const members = voiceEntries(room).filter(({ player }) => player).map(({ seat, player }) => ({
      seat, name: player.name, teamId: player.teamId || null, connected: Boolean(player.connected),
      active: Boolean(player.voice?.active), channel: player.voice?.channel || 'room',
      micEnabled: Boolean(player.voice?.micEnabled), speaking: Boolean(player.voice?.speaking),
    }));
    for (const { player } of voiceEntries(room)) {
      if (player?.connected) io.to(player.socketId).emit('voice:roster', members);
    }
  };
  const resetVoice = (player) => { if (player) player.voice = { active: false, micEnabled: false, channel: 'room', speaking: false }; };

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
  const solo = createSolo({ io, clean, characters: CHARACTERS, unlockedUpTo, cleanupLater, bindSocket });

  io.on('connection', (socket) => {
    socket.data.execTimes = [];

    socket.on('room:create', (payload, ack) => {
      const playerId = clean(payload?.playerId, 64) || randomUUID();
      const mode = COMPETITIVE_MODES.includes(payload?.mode) || payload?.mode === 'solo' ? payload.mode : 'coop';
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
      if (mode === 'solo') return solo.create(socket, { ...payload, playerId }, ack, room);
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
      if (room.mode === 'solo') return solo.join(socket, { ...payload, playerId }, ack, room);
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
      if (c) {
        const p = voicePlayer(c, voiceSeatOf(c, socket));
        resetVoice(p);
        comp.leave(socket, c);
        emitVoiceRoster(c);
        return;
      }
      const so = soloRoom(socket);
      if (so) return solo.leave(socket, so, rooms);
      const room = findRoom(socket);
      if (!room) return;
      const role = roleOf(room, socket.data.playerId);
      resetVoice(role && room.slots[role]);
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
      emitVoiceRoster(room);
    });

    socket.on('lobby:character', (payload) => {
      const c = competitive(socket);
      if (c) return comp.character(socket, payload, c);
      const so = soloRoom(socket);
      if (so) return solo.character(socket, payload, so);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'lobby' || !CHARACTERS.includes(payload?.charId)) return;
      room.slots[role].charId = payload.charId;
      emitState(room);
    });

    socket.on('lobby:color', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.color(socket, payload, c, ack);
      return ack?.({ ok: false, error: 'เลือกสีได้เฉพาะในโหมด FFA' });
    });

    socket.on('lobby:ready', (payload) => {
      const c = competitive(socket);
      if (c) return comp.ready(socket, payload, c);
      const so = soloRoom(socket);
      if (so) return undefined;
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'lobby') return;
      room.slots[role].ready = Boolean(payload?.ready);
      emitState(room);
    });

    socket.on('lobby:swap', () => {
      const c = competitive(socket);
      if (c) return undefined;
      const so = soloRoom(socket);
      if (so) return undefined;
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
      const so = soloRoom(socket);
      if (so) return solo.lobbyStart(socket, ack, so);
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
      const result = comp.team(socket, payload, ack, room);
      emitVoiceRoster(room);
      return result;
    });

    socket.on('voice:settings', (payload, ack) => {
      if (soloRoom(socket)) return ack?.({ ok: false, error: 'โหมดฝึกเล่นคนเดียวไม่มีแชทเสียง' });
      const room = findRoom(socket);
      const seat = room && voiceSeatOf(room, socket);
      const player = seat && voicePlayer(room, seat);
      if (!room || !player) return ack?.({ ok: false, error: 'ไม่ได้อยู่ในห้องเสียงนี้' });
      const active = payload?.active !== false;
      const channel = room.mode === 'team' && payload?.channel === 'team' ? 'team' : 'room';
      player.voice = {
        active,
        channel,
        micEnabled: active && Boolean(payload?.micEnabled),
        speaking: active && Boolean(payload?.micEnabled) && Boolean(payload?.speaking),
      };
      emitVoiceRoster(room);
      ack?.({ ok: true, active, channel, micEnabled: player.voice.micEnabled });
    });

    socket.on('voice:signal', (payload, ack) => {
      if (soloRoom(socket)) return ack?.({ ok: false, error: 'โหมดฝึกเล่นคนเดียวไม่มีแชทเสียง' });
      const room = findRoom(socket);
      const fromSeat = room && voiceSeatOf(room, socket);
      const from = fromSeat && voicePlayer(room, fromSeat);
      const toSeat = clean(payload?.to, 4);
      const validTarget = room && voiceEntries(room).some(({ seat }) => seat === toSeat);
      const to = room && voicePlayer(room, toSeat);
      const signal = payload?.signal;
      const validSignal = signal && ((signal.description && ['offer', 'answer'].includes(signal.description.type))
        || (signal.candidate && typeof signal.candidate.candidate === 'string'));
      if (!room || !from || !validTarget || !to || !validSignal || !voicePairAllowed(room, from, to)) {
        return ack?.({ ok: false, error: 'ส่งสัญญาณเสียงไปยังผู้เล่นนี้ไม่ได้' });
      }
      if (JSON.stringify(signal).length > 16_000) return ack?.({ ok: false, error: 'ข้อมูลสัญญาณเสียงใหญ่เกินไป' });
      io.to(to.socketId).emit('voice:signal', { from: fromSeat, signal });
      ack?.({ ok: true });
    });

    socket.on('voice:activity', (payload) => {
      if (soloRoom(socket)) return;
      const room = findRoom(socket);
      const seat = room && voiceSeatOf(room, socket);
      const player = seat && voicePlayer(room, seat);
      if (!room || !player?.voice?.active || !player.voice.micEnabled) return;
      const speaking = Boolean(payload?.speaking);
      if (player.voice.speaking === speaking) return;
      player.voice.speaking = speaking;
      for (const { seat: targetSeat, player: target } of voiceEntries(room)) {
        if (targetSeat !== seat && voicePairAllowed(room, player, target)) {
          io.to(target.socketId).emit('voice:activity', { seat, speaking });
        }
      }
      io.to(player.socketId).emit('voice:activity', { seat, speaking });
    });

    socket.on('stage:role', (payload, ack) => {
      const so = soloRoom(socket);
      if (so) return solo.role(socket, payload, ack, so);
      const c = competitive(socket);
      if (!c) return ack?.({ ok: false, error: 'ใช้ได้เฉพาะโหมดแข่งขันหรือฝึกเล่นคนเดียว' });
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
      const so = soloRoom(socket);
      if (so) return solo.stageStart(socket, payload, ack, so);
      const room = findRoom(socket);
      if (!room || !roleOf(room, socket.data.playerId)) return ack?.({ ok: false });
      const id = Number(payload?.stageId);
      const canPick = room.phase === 'select' || (room.phase === 'play' && room.run?.result);
      if (!canPick) return ack?.({ ok: false, error: 'กำลังเล่นด่านอยู่' });
      if (!ROLES.every((r) => room.slots[r])) return ack?.({ ok: false, error: 'ต้องมีผู้เล่นครบ 2 คน' });
      if (!Number.isInteger(id) || id < 1 || id > unlockedUpTo(room)) return ack?.({ ok: false, error: 'ด่านนี้ยังล็อกอยู่' });
      startCoopStage(room, id);
      return ack?.({ ok: true });
    });

    // Clients send (payload, ack) like every other event; the bare (ack) form is still accepted.
    socket.on('stage:retry', (payload, maybeAck) => {
      const ack = typeof maybeAck === 'function' ? maybeAck : typeof payload === 'function' ? payload : null;
      const c = competitive(socket);
      if (c) return comp.stageRetry(socket, ack, c);
      const so = soloRoom(socket);
      if (so) return solo.stageRetry(socket, ack, so);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!room || !role || room.slots[role].socketId !== socket.id || room.phase !== 'ended' || !room.run?.result?.gameOver) return ack?.({ ok: false, error: 'ไม่มีด่าน Game Over ที่รอเริ่มใหม่' });
      (room.retryVotes ||= new Set()).add(role);
      return ack?.(settleCoopRetry(room) || coopRetryStatus(room));
    });

    socket.on('stage:quit', (payload, ack) => {
      const c = competitive(socket);
      if (c) return comp.stageQuit(socket, c, ack);
      const so = soloRoom(socket);
      if (so) return solo.stageQuit(socket, so, ack);
      const room = findRoom(socket);
      if (!room || !roleOf(room, socket.data.playerId) || !['play', 'ended'].includes(room.phase)) return ack?.({ ok: false, error: 'ยังไม่ได้อยู่ในด่าน' });
      clearTimeout(room.stageTimer);
      const unfinished = room.run && !room.run.result;
      room.phase = 'select';
      room.run = null;
      if (unfinished) system(room, 'ออกจากด่านกลับไปหน้าเลือกด่าน');
      emitState(room);
      ack?.({ ok: true });
    });

    socket.on('player:move', (payload) => {
      const c = competitive(socket);
      if (c) return comp.move(socket, payload, c);
      const so = soloRoom(socket);
      if (so) return solo.move(socket, payload, so);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.phase !== 'play' || !room.run || !room.slots[role] || room.slots[role].socketId !== socket.id) return;
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
      const so = soloRoom(socket);
      if (so) return solo.interact(socket, payload, ack, so);
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
      const so = soloRoom(socket);
      if (so) return solo.exec(socket, payload, ack, so);
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
      const so = soloRoom(socket);
      if (so) return solo.form(socket, payload, ack, so);
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
      const so = soloRoom(socket);
      if (so) return solo.hint(socket, payload, ack, so);
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
      const so = soloRoom(socket);
      if (so) return undefined;
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
      const so = soloRoom(socket);
      if (so) return undefined;
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || !['typing', 'docs'].includes(payload?.kind)) return;
      socket.to(room.code).emit('activity', { role, kind: payload.kind });
    });

    socket.on('disconnect', () => {
      const c = competitive(socket);
      if (c) {
        const p = voicePlayer(c, voiceSeatOf(c, socket));
        comp.disconnect(socket, c);
        resetVoice(p);
        emitVoiceRoster(c);
        return;
      }
      const so = soloRoom(socket);
      if (so) return solo.disconnect(socket, so);
      const room = findRoom(socket);
      const role = room && roleOf(room, socket.data.playerId);
      if (!role || room.slots[role].socketId !== socket.id) return;
      room.slots[role].connected = false;
      resetVoice(room.slots[role]);
      room.slots[role].input = null;
      room.slots[role].moving = false;
      room.slots[role].ready = room.phase === 'lobby' ? false : room.slots[role].ready;
      system(room, `${room.slots[role].name} หลุดการเชื่อมต่อ — เข้าห้อง ${room.code} อีกครั้งเพื่อเล่นต่อ`);
      if (!settleCoopRetry(room)) emitState(room);
      emitVoiceRoster(room);
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
