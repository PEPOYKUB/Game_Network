// Solo practice: one player, the same 12 stages, both rooms' computers.
//
// Model (shaped like a one-seat competitive room so the client can reuse its A/B station UI)
//   room.mode   'solo'
//   room.seats  { P1: player }   player: { id (stable playerId), seat: 'P1', teamId: 'P1', name, charId,
//                                        connected, station ('A'|'B'|null), terminal, roomSide, x, y, ... }
//   room.run    the current stage run (engine.js) — server-only ground truth stays inside it
//   room.phase  'lobby' (pick character) → 'select' → 'play' (a passed run keeps phase 'play' with run.result)
//
// Differences from the other modes: no second player, no ready check, no time limit or briefing,
// no items, no chat/voice, and results are never written to the competitive/team leaderboard.
// `room.progress.cleared` only lives as long as the room (this practice session).
import { startFreshRun, scenarioFingerprint, execute, submitForm, revealHint, roleView, publicRun } from './engine.js';
import { scoreRun } from './scoring.js';
import { levelForStage, spawnPlayer, movePlayer, nearbyComputer } from '../../public/js/world.js';

export const SOLO_SEAT = 'P1';

export function createSolo({ io, clean, characters, unlockedUpTo, cleanupLater, bindSocket }) {
  const playerOf = (room) => room.seats?.[SOLO_SEAT] || null;
  /** The solo player, only when `socket` is the connection currently bound to them. */
  const ownerOf = (room, socket) => {
    const p = playerOf(room);
    return p && p.id === socket.data.playerId && p.socketId === socket.id ? p : null;
  };

  const publicPlayer = (p) => (p ? {
    seat: p.seat, teamId: p.teamId, name: p.name, charId: p.charId, ready: true, connected: p.connected, quit: false,
    roomSide: p.roomSide, station: p.station, x: p.x, y: p.y, facing: p.facing, direction: p.direction, moving: p.moving, terminal: p.terminal,
  } : null);

  const emitState = (room) => {
    const p = playerOf(room);
    if (!p?.connected) return;
    io.to(p.socketId).emit('room:state', {
      code: room.code,
      phase: room.phase,
      mode: 'solo',
      you: SOLO_SEAT,
      me: { seat: SOLO_SEAT, teamId: SOLO_SEAT, scopeId: SOLO_SEAT, station: p.station },
      now: Date.now(),
      options: room.options,
      players: { [SOLO_SEAT]: publicPlayer(p) },
      teams: null,
      progress: { cleared: room.progress.cleared, unlocked: unlockedUpTo(room), finalCode: room.progress.finalCode || null },
      run: room.run ? publicRun(room.run) : null,
      activeRole: p.station || 'A',
      match: null,
      stageProgress: null,
      ffaResults: null,
    });
  };

  const emitPlayers = (room) => {
    const p = playerOf(room);
    if (p?.connected) io.to(p.socketId).emit('room:players', { players: { [SOLO_SEAT]: publicPlayer(p) } });
  };

  const emitView = (room) => {
    const p = playerOf(room);
    if (p?.connected && room.run && p.station) io.to(p.socketId).emit('stage:view', roleView(room.run, p.station));
  };

  const resetPosition = (p, stageId) => {
    Object.assign(p, spawnPlayer(stageId, 'A'), { roomSide: 'A', station: null, terminal: false, input: null, moving: false });
  };

  const startStage = (room, id) => {
    const previousFingerprint = room.lastScenarioFingerprints?.get(id) || null;
    room.run = startFreshRun(id, { sample: room.options.sample, previousFingerprint });
    room.lastScenarioFingerprints ||= new Map();
    room.lastScenarioFingerprints.set(id, scenarioFingerprint(room.run));
    room.phase = 'play';
    const p = playerOf(room);
    resetPosition(p, id);
    emitState(room);
    emitPlayers(room);
    // Preview of side A so the mission panel renders before the player reaches a computer.
    io.to(p.socketId).emit('stage:view', roleView(room.run, 'A'));
    return { ok: true };
  };

  const complete = (room) => {
    const run = room.run;
    run.completedAt = Date.now();
    const score = scoreRun(run);
    const finalCode = run.stage.finalCode ? run.stage.finalCode(run.s) : null;
    run.result = { ...score, explanation: run.stage.explanation(run.s), finalCode, practice: true };
    run.scoreEvents.push({ type: 'stage_complete', value: score.total, at: run.completedAt });
    const prev = room.progress.cleared[run.stage.id];
    if (!prev || score.total > prev.score) room.progress.cleared[run.stage.id] = { score: score.total, time: score.elapsed };
    if (finalCode) room.progress.finalCode = finalCode;
    // Practice results are deliberately not sent to the leaderboard.
    io.to(playerOf(room).socketId).emit('stage:complete', { stageId: run.stage.id, result: run.result });
  };

  /** Shared guard for in-stage actions. */
  const inPlay = (room, socket) => {
    const player = ownerOf(room, socket);
    if (!player) return { error: 'คุณไม่ได้อยู่ในห้องฝึกนี้' };
    if (room.phase !== 'play' || !room.run) return { error: 'ยังไม่ได้เริ่มด่าน' };
    return { player, run: room.run };
  };

  const warn = (t) => ({ lines: [{ t, c: 'warn', d: 0 }] });

  return {
    create(socket, payload, ack, room) {
      room.seats = { [SOLO_SEAT]: null };
      const p = {
        id: clean(payload?.playerId, 64),
        seat: SOLO_SEAT,
        teamId: SOLO_SEAT,
        name: clean(payload?.name, 16) || 'PLAYER',
        charId: 'ping',
        ready: true,
        connected: true,
        quit: false,
      };
      resetPosition(p, 1);
      room.seats[SOLO_SEAT] = p;
      bindSocket(socket, room, p);
      ack?.({ ok: true, code: room.code, role: SOLO_SEAT, seat: SOLO_SEAT, teamId: SOLO_SEAT, mode: 'solo' });
      emitState(room);
    },

    join(socket, payload, ack, room) {
      const p = playerOf(room);
      if (!p || p.id !== clean(payload?.playerId, 64)) {
        return ack?.({ ok: false, error: 'ห้องนี้เป็นห้องฝึกเล่นคนเดียว — ผู้เล่นอื่นเข้าร่วมไม่ได้' });
      }
      // Reload / reconnect of the same browser identity: take the session back.
      bindSocket(socket, room, p);
      clearTimeout(room.cleanupTimer);
      ack?.({ ok: true, code: room.code, role: SOLO_SEAT, seat: SOLO_SEAT, teamId: SOLO_SEAT, mode: 'solo' });
      emitState(room);
      if (room.run) io.to(socket.id).emit('stage:view', roleView(room.run, p.station || 'A'));
      return undefined;
    },

    leave(socket, room, rooms) {
      if (!ownerOf(room, socket)) return;
      socket.leave(room.code);
      socket.data.code = null;
      rooms.delete(room.code);
    },

    character(socket, payload, room) {
      const p = ownerOf(room, socket);
      if (!p || room.phase !== 'lobby' || !characters.includes(payload?.charId)) return;
      p.charId = payload.charId;
      emitState(room);
    },

    lobbyStart(socket, ack, room) {
      if (!ownerOf(room, socket)) return ack?.({ ok: false, error: 'คุณไม่ได้อยู่ในห้องฝึกนี้' });
      if (room.phase === 'lobby') room.phase = 'select';
      emitState(room);
      return ack?.({ ok: true });
    },

    stageStart(socket, payload, ack, room) {
      if (!ownerOf(room, socket)) return ack?.({ ok: false, error: 'คุณไม่ได้อยู่ในห้องฝึกนี้' });
      if (room.phase === 'lobby') return ack?.({ ok: false, error: 'เลือกตัวละครก่อน' });
      const id = Number(payload?.stageId);
      if (!Number.isInteger(id) || id < 1 || id > unlockedUpTo(room)) return ack?.({ ok: false, error: 'ด่านนี้ยังล็อกอยู่' });
      return ack?.(startStage(room, id));
    },

    /** Practice retry: restart the current stage at any time, with a fresh scenario. */
    stageRetry(socket, ack, room) {
      if (!ownerOf(room, socket)) return ack?.({ ok: false, error: 'คุณไม่ได้อยู่ในห้องฝึกนี้' });
      if (room.phase !== 'play' || !room.run) return ack?.({ ok: false, error: 'ยังไม่ได้เริ่มด่าน' });
      return ack?.(startStage(room, room.run.stage.id));
    },

    stageQuit(socket, room, ack) {
      if (!ownerOf(room, socket)) return ack?.({ ok: false, error: 'คุณไม่ได้อยู่ในห้องฝึกนี้' });
      if (room.phase !== 'play') return ack?.({ ok: false, error: 'ตอนนี้ไม่ได้อยู่ในด่าน' });
      room.phase = 'select';
      room.run = null;
      const p = playerOf(room);
      p.station = null;
      p.terminal = false;
      emitState(room);
      return ack?.({ ok: true, waiting: false });
    },

    move(socket, payload, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return;
      const { player } = ctx;
      const now = Date.now();
      const dt = Math.min(0.1, Math.max(0, (now - (player.lastMoveAt || now)) / 1000));
      player.lastMoveAt = now;
      // One player walks both rooms, so the door between them is always open (like FFA).
      Object.assign(player, movePlayer(levelForStage(room.run.stage.id), player.roomSide, player, player.input, dt, true));
      player.input = { x: Number(payload?.x) || 0, y: Number(payload?.y) || 0 };
      if (player.input.x || player.input.y) player.moving = true;
      emitPlayers(room);
    },

    interact(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      const { player } = ctx;
      if (!payload?.open) {
        player.terminal = false;
        player.station = null;
        emitPlayers(room);
        emitState(room);
        return ack?.({ ok: true, open: false });
      }
      const level = levelForStage(room.run.stage.id);
      const prefer = payload?.role === 'B' ? ['B', 'A'] : ['A', 'B'];
      const side = prefer.find((s) => nearbyComputer(level, s, player));
      if (!side) return ack?.({ ok: false, error: 'เดินเข้าใกล้คอมพิวเตอร์ก่อน' });
      player.station = side;
      player.terminal = true;
      emitPlayers(room);
      emitView(room);
      emitState(room);
      return ack?.({ ok: true, open: true, role: side });
    },

    role(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      const side = payload?.role;
      if (!['A', 'B'].includes(side)) return ack?.({ ok: false, error: 'เลือกฝั่งไม่ได้' });
      if (!nearbyComputer(levelForStage(room.run.stage.id), side, ctx.player)) return ack?.({ ok: false, error: `เดินไปที่คอมพิวเตอร์ฝั่ง ${side} ก่อน` });
      ctx.player.station = side;
      ctx.player.terminal = true;
      emitView(room);
      emitPlayers(room);
      emitState(room);
      return ack?.({ ok: true, role: side });
    },

    exec(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.(warn(ctx.error));
      const { player, run } = ctx;
      if (!player.terminal || !player.station) return ack?.(warn('เดินไปที่คอมพิวเตอร์แล้วกด E เพื่อเปิด Terminal'));
      if (payload?.role && payload.role !== player.station) return ack?.(warn(`คุณกำลังใช้คอมพิวเตอร์ฝั่ง ${player.station} — เดินไปที่ฝั่ง ${payload.role} เพื่อใช้คำสั่งของฝั่งนั้น`));
      const now = Date.now();
      socket.data.execTimes = socket.data.execTimes.filter((t) => now - t < 2000);
      if (socket.data.execTimes.length >= 10) return ack?.(warn('พิมพ์คำสั่งเร็วเกินไป — รอสักครู่'));
      socket.data.execTimes.push(now);
      const res = execute(run, player.station, clean(payload?.line, 200));
      ack?.({ lines: res.lines, prompt: run.stage.roles[player.station].device(run.s)?.prompt });
      if (res.passedNow) complete(room);
      if (res.counted || res.passedNow) {
        emitState(room);
        emitView(room);
      }
      return undefined;
    },

    form(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, message: ctx.error });
      const { player, run } = ctx;
      if (!player.terminal || !player.station) return ack?.({ ok: false, message: 'เดินไปที่คอมพิวเตอร์แล้วกด E ก่อนส่งแบบฟอร์ม' });
      if (payload?.role && payload.role !== player.station) return ack?.({ ok: false, message: `คุณกำลังใช้คอมพิวเตอร์ฝั่ง ${player.station}` });
      const res = submitForm(run, player.station, payload?.data);
      ack?.({ ok: res.ok, message: res.message });
      if (res.passedNow) complete(room);
      emitState(room);
      emitView(room);
      return undefined;
    },

    hint(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      const res = revealHint(ctx.run, Number(payload?.level));
      if (res.error) return ack?.({ ok: false, error: res.error });
      emitState(room);
      return ack?.({ ok: true });
    },

    disconnect(socket, room) {
      const p = playerOf(room);
      if (!p || p.socketId !== socket.id) return;
      p.connected = false;
      p.input = null;
      p.moving = false;
      cleanupLater(room);
    },
  };
}
