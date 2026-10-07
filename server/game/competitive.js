// Competitive rooms: Free for All (4 seats) and Team 2v2. Co-op rooms never reach this module.
//
// Model
//   room.seats[P1..P4]  player: { id (stable playerId), seat, teamId, name, charId, ready, connected,
//                                 quit, station ('A'|'B'|null), terminal, x, y, ... }
//   teamId              FFA: same as seat ("P1") · 2v2: "T1" | "T2"
//   scope               one independent stage run — FFA: one per seat, 2v2: one per team.
//                       scopeId === teamId, so a player's scope is always `player.teamId`.
//   room.phase          'lobby' → 'select' → 'play' → 'ended' → (stage:start | stage:quit → 'select')
//   room.match          { stageId, seed, startedAt, endsAt, endedAt, endedReason, scopes, results }
import { randomInt } from 'node:crypto';
import { startRun, execute, submitForm, revealHint, roleView, publicRun } from './engine.js';
import { scoreRun } from './scoring.js';
import { levelForStage, spawnPlayer, movePlayer, nearbyComputer, canStand } from '../../public/js/world.js';
import { createMatchItems, rememberInitialConfig, SABOTAGE_KEYS } from './match-items.js';

export const SEATS = ['P1', 'P2', 'P3', 'P4'];
export const TEAMS = ['T1', 'T2'];
export const COMPETITIVE_MODES = ['ffa', 'team'];

/** Server-side defaults for competitive play (tests may override with configureModes). */
export const MODE_CONFIG = {
  /** Whole match length; at expiry the match ends with reason "timeout". */
  matchDurationMs: 10 * 60 * 1000,
  /** A player disconnected this long during play counts as quit; a scope with every member quit forfeits. */
  disconnectGraceMs: 60 * 1000,
  /**
   * Team assignment: joiners are auto-balanced (fewer members, T1 on ties) and may switch with lobby:team.
   * In the lobby a team may briefly hold teamSize + 1 so players can swap; starting requires exactly teamSize each.
   */
  teamSize: 2,
};

export function configureModes(overrides = {}) {
  Object.assign(MODE_CONFIG, overrides);
}

/**
 * Objectives completed by a run. Placeholder until progress (task 2) defines per-stage objectives;
 * ranking already uses it so the tie-break order will not change when it gets richer.
 */
export function objectivesOf(run) {
  return { done: run?.passed ? 1 : 0, total: 1 };
}

/**
 * Ranking shared by FFA and 2v2, one row per scope:
 *   1. not forfeited  2. completed the stage  3. objectives done  4. score  5. less elapsed time
 * Rows equal on every key share a rank (1, 1, 3 ...).
 */
export function rankScopes(match, now = Date.now()) {
  const end = match.endedAt ?? now;
  const rows = Object.values(match.scopes).map((scope) => {
    const completed = Boolean(scope.run.passed && !scope.forfeited);
    const objectives = objectivesOf(scope.run);
    return {
      scopeId: scope.id,
      teamId: scope.teamId,
      members: [...scope.members],
      completed,
      forfeited: scope.forfeited,
      objectivesDone: completed ? objectives.total : objectives.done,
      objectivesTotal: objectives.total,
      score: scope.forfeited ? 0 : (scope.run.result?.total ?? scoreRun({ ...scope.run, completedAt: end }).total),
      elapsedMs: Math.max(0, (scope.finishedAt ?? end) - match.startedAt),
    };
  });
  const key = (r) => [r.forfeited ? 0 : 1, r.completed ? 1 : 0, r.objectivesDone, r.score, -r.elapsedMs];
  const cmp = (a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  rows.sort(cmp);
  rows.forEach((row, i) => { row.rank = i && cmp(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}

const SPAWN_OFFSETS = [[0, 0], [0, 36], [0, -36], [36, 0], [-36, 0], [30, 30], [-30, 30], [30, -30], [-30, -30], [0, 60], [60, 0], [-60, 0]];

export const seatSide = (seat) => (SEATS.indexOf(seat) % 2 ? 'B' : 'A');

export function createCompetitive({ io, rooms, clean, characters, system, unlockedUpTo, cleanupLater, bindSocket }) {
  const players = (room) => SEATS.map((s) => room.seats[s]).filter(Boolean);
  const seatOf = (room, playerId) => SEATS.find((s) => room.seats[s]?.id === playerId) || null;
  /** Seat this socket currently speaks for — only the socket bound last for that player counts. */
  const seatOfSocket = (room, socket) => {
    const seat = seatOf(room, socket.data.playerId);
    return seat && room.seats[seat].socketId === socket.id ? seat : null;
  };
  const scopeOf = (room, player) => room.match?.scopes[player.teamId] || null;
  const teamMembers = (room, teamId) => SEATS.filter((s) => room.seats[s]?.teamId === teamId);

  // Each team spawns one member per side so both teams start symmetrically.
  const sideOf = (room, player) => {
    if (room.mode !== 'team') return seatSide(player.seat);
    return teamMembers(room, player.teamId).indexOf(player.seat) === 1 ? 'B' : 'A';
  };

  /**
   * Two players share each side's spawn; nudge later ones to the nearest free standable spot
   * (same spot for every match, so both FFA sides / both teams stay symmetric).
   */
  const placeSpawns = (room, stageId) => {
    const level = levelForStage(stageId);
    const placed = [];
    for (const p of players(room)) {
      const base = spawnPlayer(stageId, p.roomSide);
      const spot = SPAWN_OFFSETS
        .map(([dx, dy]) => ({ x: base.x + dx, y: base.y + dy }))
        .find((c) => canStand(level, p.roomSide, c.x, c.y, false) && placed.every((q) => Math.hypot(q.x - c.x, q.y - c.y) >= 30)) || base;
      Object.assign(p, base, spot);
      placed.push(spot);
    }
  };

  const publicPlayer = (p) => (p ? {
    seat: p.seat, teamId: p.teamId, name: p.name, charId: p.charId, ready: p.ready, connected: p.connected, quit: Boolean(p.quit),
    roomSide: p.roomSide, station: p.station, x: p.x, y: p.y, facing: p.facing, direction: p.direction, moving: p.moving, terminal: p.terminal,
  } : null);
  const publicPlayers = (room) => Object.fromEntries(SEATS.map((s) => [s, publicPlayer(room.seats[s])]));

  const publicMatch = (room) => {
    const m = room.match;
    if (!m) return null;
    return {
      stageId: m.stageId,
      startedAt: m.startedAt,
      endsAt: m.endsAt,
      endedAt: m.endedAt,
      endedReason: m.endedReason,
      scopes: Object.fromEntries(Object.values(m.scopes).map((s) => [s.id, {
        teamId: s.teamId, members: [...s.members], finished: Boolean(s.finishedAt), forfeited: s.forfeited,
        disrupted: Boolean(m.items?.disrupted(s.id)),
      }])),
      attackable: (SABOTAGE_KEYS[m.stageId] || []).length > 0,
      results: m.results,
    };
  };

  // Kept for the current FFA client (room:progress / stageProgress / ffaResults). Task 2 replaces it.
  const compatProgress = (room) => ({
    stageId: room.match?.stageId || null,
    updatedAt: Date.now(),
    players: Object.fromEntries(SEATS.map((seat) => {
      const p = room.seats[seat];
      const run = p && scopeOf(room, p)?.run;
      const rp = run?.roleProgress;
      return [seat, {
        actions: rp ? rp.A.actions + rp.B.actions : 0,
        configurations: rp ? rp.A.configurations + rp.B.configurations : 0,
        verifications: rp ? rp.A.verifications + rp.B.verifications : 0,
        complete: Boolean(run?.passed),
        connected: Boolean(p?.connected),
      }];
    })),
  });
  const compatResults = (room) => {
    const out = {};
    for (const row of room.match?.results || []) {
      for (const seat of row.members) out[seat] = { rank: row.rank, name: room.seats[seat]?.name, score: row.score, time: Math.round(row.elapsedMs / 1000), teamId: row.teamId, completed: row.completed, forfeited: row.forfeited };
    }
    return out;
  };

  const emitState = (room) => {
    const match = publicMatch(room);
    const stageProgress = compatProgress(room);
    const ffaResults = compatResults(room);
    const teams = room.mode === 'team' ? Object.fromEntries(TEAMS.map((t) => [t, teamMembers(room, t)])) : null;
    for (const p of players(room)) {
      if (!p.connected) continue;
      const scope = scopeOf(room, p);
      io.to(p.socketId).emit('room:state', {
        code: room.code,
        phase: room.phase,
        mode: room.mode,
        you: p.seat,
        me: { seat: p.seat, teamId: p.teamId, scopeId: p.teamId, station: p.station },
        now: Date.now(),
        options: room.options,
        players: publicPlayers(room),
        teams,
        progress: { cleared: room.progress.cleared, unlocked: unlockedUpTo(room), finalCode: room.progress.finalCode || null },
        run: scope ? publicRun(scope.run) : null,
        activeRole: p.station || 'A',
        match,
        stageProgress,
        ffaResults,
      });
    }
    io.to(room.code).emit('room:progress', stageProgress);
  };

  const emitPlayers = (room) => io.to(room.code).emit('room:players', { players: publicPlayers(room) });

  /** Send each member of a scope the view of the station they currently use. */
  const emitScopeViews = (room, scope) => {
    for (const seat of scope.members) {
      const p = room.seats[seat];
      if (p?.connected && p.station) io.to(p.socketId).emit('stage:view', roleView(scope.run, p.station));
    }
  };

  const sendTo = (room, seats, event, payload) => {
    for (const seat of seats) {
      const p = room.seats[seat];
      if (p?.connected) io.to(p.socketId).emit(event, payload);
    }
  };

  const teamSystem = (room, teamId, text) => {
    const msg = { from: 'sys', text, at: Date.now(), team: teamId };
    room.chat.push(msg);
    room.chat = room.chat.slice(-60);
    sendTo(room, teamMembers(room, teamId), 'chat:msg', msg);
  };

  const endMatch = (room, reason) => {
    const m = room.match;
    if (!m || room.phase !== 'play') return;
    clearTimeout(room.matchTimer);
    m.items?.stop();
    m.endedAt = Date.now();
    m.endedReason = reason;
    m.results = rankScopes(m, m.endedAt);
    room.phase = 'ended';
    for (const p of players(room)) { p.terminal = false; p.station = null; p.input = null; p.moving = false; }
    for (const row of m.results) {
      const scope = m.scopes[row.scopeId];
      if (row.completed) {
        const prev = room.progress.cleared[m.stageId];
        if (!prev || row.score > prev.score) room.progress.cleared[m.stageId] = { score: row.score, time: Math.round(row.elapsedMs / 1000) };
        if (scope.run.result?.finalCode) room.progress.finalCode = scope.run.result.finalCode;
      }
      const result = scope.run.result || {
        ...scoreRun({ ...scope.run, completedAt: m.endedAt }),
        total: row.score,
        unfinished: true,
        forfeited: row.forfeited,
        explanation: row.forfeited ? 'ถอนตัวจากการแข่งขัน' : 'หมดเวลา — ยังทำด่านไม่สำเร็จ',
      };
      sendTo(room, row.members, 'stage:complete', { stageId: m.stageId, result, rank: row.rank, reason });
    }
    const winner = m.results[0];
    const label = room.mode === 'team' ? `ทีม ${winner.teamId}` : room.seats[winner.members[0]]?.name;
    const why = { winner: 'ทำด่านสำเร็จก่อน', timeout: 'หมดเวลา', forfeit: 'คู่แข่งถอนตัว' }[reason] || reason;
    system(room, `การแข่งขันจบ (${why}) — อันดับ 1: ${label}`);
    io.to(room.code).emit('match:end', { stageId: m.stageId, reason, results: m.results });
    emitState(room);
    emitPlayers(room);
  };

  /** A scope forfeits once every member has quit; the match ends when at most one scope is still playing. */
  const checkForfeits = (room) => {
    const m = room.match;
    if (!m || room.phase !== 'play') return;
    for (const scope of Object.values(m.scopes)) {
      if (!scope.forfeited && !scope.finishedAt && scope.members.every((seat) => room.seats[seat]?.quit)) scope.forfeited = true;
    }
    const active = Object.values(m.scopes).filter((s) => !s.forfeited);
    if (active.length <= 1) endMatch(room, 'forfeit');
  };

  const completeScope = (room, scope) => {
    const run = scope.run;
    scope.finishedAt = Date.now();
    run.completedAt = scope.finishedAt;
    const score = scoreRun(run);
    run.result = { ...score, explanation: run.stage.explanation(run.s), finalCode: run.stage.finalCode ? run.stage.finalCode(run.s) : null };
    run.scoreEvents.push({ type: 'stage_complete', value: score.total, at: run.completedAt });
    endMatch(room, 'winner');
  };

  const join = (socket, room, player) => {
    bindSocket(socket, room, player);
    clearTimeout(player.graceTimer);
    clearTimeout(room.cleanupTimer);
    socket.emit('chat:history', room.chat.filter((m) => !m.team || m.team === player.teamId));
    return { ok: true, code: room.code, role: player.seat, seat: player.seat, teamId: player.teamId, mode: room.mode };
  };

  const balancedTeam = (room) => {
    const count = (t) => teamMembers(room, t).length;
    return count('T1') <= count('T2') ? 'T1' : 'T2';
  };

  const newPlayer = (room, seat, playerId, name, charId) => {
    const p = { id: playerId, seat, name, charId, ready: false, connected: true, quit: false, station: null, terminal: false };
    p.teamId = room.mode === 'team' ? balancedTeam(room) : seat;
    room.seats[seat] = p;
    p.roomSide = sideOf(room, p);
    Object.assign(p, spawnPlayer(room.match?.stageId || 1, p.roomSide));
    return p;
  };

  /** Shared guard for in-match actions: returns { player, scope } or an error string. */
  const inPlay = (room, socket) => {
    const seat = seatOfSocket(room, socket);
    const player = seat && room.seats[seat];
    if (!player) return { error: 'คุณไม่ได้อยู่ในห้องนี้' };
    if (room.phase === 'ended') return { error: 'การแข่งขันจบแล้ว' };
    if (room.phase !== 'play' || !room.match) return { error: 'ยังไม่ได้เริ่มการแข่งขัน' };
    const scope = scopeOf(room, player);
    if (player.quit || scope.forfeited) return { error: 'คุณถอนตัวจากการแข่งขันนี้แล้ว' };
    if (scope.finishedAt) return { error: 'ทำด่านนี้สำเร็จแล้ว' };
    return { player, scope };
  };

  const warn = (t) => ({ lines: [{ t, c: 'warn', d: 0 }] });

  return {
    create(socket, payload, ack, room) {
      room.seats = Object.fromEntries(SEATS.map((s) => [s, null]));
      room.match = null;
      room.matchTimer = null;
      const playerId = clean(payload?.playerId, 64);
      const p = newPlayer(room, 'P1', playerId, clean(payload?.name, 16) || 'PLAYER-P1', 'ping');
      const res = join(socket, room, p);
      system(room, `${p.name} สร้างห้อง ${room.mode === 'team' ? 'ทีม 2v2' : 'FFA'} ${room.code}`);
      ack?.(res);
      emitState(room);
    },

    join(socket, payload, ack, room) {
      const playerId = clean(payload?.playerId, 64);
      const existing = seatOf(room, playerId);
      if (existing) {
        const p = room.seats[existing];
        const res = join(socket, room, p);
        system(room, `${p.name} กลับเข้าห้องแล้ว`);
        ack?.(res);
        emitState(room);
        const scope = scopeOf(room, p);
        if (scope && p.station) socket.emit('stage:view', roleView(scope.run, p.station));
        room.match?.items?.sendStateTo(p.seat);
        return;
      }
      const free = SEATS.find((s) => !room.seats[s]);
      const between = room.phase === 'lobby' || room.phase === 'select';
      if (free && !between) return ack?.({ ok: false, error: 'การแข่งขันกำลังดำเนินอยู่ — เข้าได้เฉพาะผู้เล่นเดิมของห้องนี้' });
      if (free) {
        const taken = players(room).map((p) => p.charId);
        const p = newPlayer(room, free, playerId, clean(payload?.name, 16) || `PLAYER-${free}`,
          characters.find((c) => !taken.includes(c) && c !== 'ping') || characters[SEATS.indexOf(free) % characters.length]);
        const res = join(socket, room, p);
        system(room, room.mode === 'team' ? `${p.name} เข้าร่วมทีม ${p.teamId}` : `${p.name} เข้าร่วมการแข่งขัน FFA`);
        ack?.(res);
        emitState(room);
        return;
      }
      // Between matches only, a new browser session may take over a seat whose player disconnected.
      const stale = SEATS.find((s) => !room.seats[s].connected);
      if (stale && between) {
        const p = room.seats[stale];
        p.id = playerId;
        p.name = clean(payload?.name, 16) || p.name;
        p.quit = false;
        const res = join(socket, room, p);
        system(room, `${p.name} เข้ามาแทนที่ ${stale}`);
        ack?.(res);
        emitState(room);
        return;
      }
      if (stale) ack?.({ ok: false, error: 'การแข่งขันกำลังดำเนินอยู่ — เข้าได้เฉพาะผู้เล่นเดิมของห้องนี้' });
      else ack?.({ ok: false, error: 'ห้องนี้มีผู้เล่นครบ 4 คนแล้ว' });
    },

    leave(socket, room) {
      const seat = seatOfSocket(room, socket);
      socket.leave(room.code);
      socket.data.code = null;
      if (!seat) return;
      const p = room.seats[seat];
      if (room.phase === 'play' || room.phase === 'ended') {
        // Keep the seat so results and reconnect stay consistent; the player just stops competing.
        p.connected = false;
        p.quit = true;
        system(room, `${p.name} ออกจากการแข่งขัน`);
        checkForfeits(room);
        emitState(room);
        return;
      }
      room.seats[seat] = null;
      if (!players(room).length) {
        rooms.delete(room.code);
        return;
      }
      room.phase = 'lobby';
      for (const other of players(room)) other.ready = false;
      system(room, `${p.name} ออกจากห้อง — รอผู้เล่นใหม่`);
      emitState(room);
    },

    character(socket, payload, room) {
      const seat = seatOfSocket(room, socket);
      if (!seat || room.phase !== 'lobby' || !characters.includes(payload?.charId)) return;
      room.seats[seat].charId = payload.charId;
      emitState(room);
    },

    ready(socket, payload, room) {
      const seat = seatOfSocket(room, socket);
      if (!seat || room.phase !== 'lobby') return;
      room.seats[seat].ready = Boolean(payload?.ready);
      emitState(room);
    },

    team(socket, payload, ack, room) {
      const seat = seatOfSocket(room, socket);
      if (!seat || room.mode !== 'team') return ack?.({ ok: false, error: 'ห้องนี้ไม่ใช่โหมดทีม' });
      if (room.phase !== 'lobby') return ack?.({ ok: false, error: 'เปลี่ยนทีมได้เฉพาะใน Lobby' });
      const teamId = payload?.teamId;
      if (!TEAMS.includes(teamId)) return ack?.({ ok: false, error: 'ไม่มีทีมนี้' });
      const p = room.seats[seat];
      // A team may hold one extra member while the lobby reshuffles (otherwise two players could never
      // swap teams); the match itself only starts at exactly teamSize per team.
      if (p.teamId !== teamId && teamMembers(room, teamId).length >= MODE_CONFIG.teamSize + 1) return ack?.({ ok: false, error: `ทีม ${teamId} เต็มแล้ว` });
      p.teamId = teamId;
      for (const other of players(room)) { other.ready = false; other.roomSide = sideOf(room, other); }
      emitState(room);
      return ack?.({ ok: true, teamId });
    },

    lobbyStart(socket, ack, room) {
      if (!seatOfSocket(room, socket)) return ack?.({ ok: false });
      const all = players(room);
      if (all.length < SEATS.length || !all.every((p) => p.connected && p.ready)) return ack?.({ ok: false, error: 'ต้องมีผู้เล่นครบ 4 คนและทุกคนกดพร้อม' });
      if (room.mode === 'team' && !TEAMS.every((t) => teamMembers(room, t).length === MODE_CONFIG.teamSize)) return ack?.({ ok: false, error: 'ต้องแบ่งทีมละ 2 คน' });
      room.phase = 'select';
      emitState(room);
      return ack?.({ ok: true });
    },

    stageStart(socket, payload, ack, room) {
      if (!seatOfSocket(room, socket)) return ack?.({ ok: false });
      if (room.phase !== 'select' && room.phase !== 'ended') return ack?.({ ok: false, error: 'กำลังแข่งขันอยู่' });
      const all = players(room);
      if (all.length < SEATS.length || !all.every((p) => p.connected)) return ack?.({ ok: false, error: 'ต้องมีผู้เล่นออนไลน์ครบ 4 คน' });
      const id = Number(payload?.stageId);
      if (!Number.isInteger(id) || id < 1 || id > unlockedUpTo(room)) return ack?.({ ok: false, error: 'ด่านนี้ยังล็อกอยู่' });
      // One seed for every scope: identical puzzle and starting conditions, independent state.
      const seed = randomInt(1, 2 ** 31);
      const now = Date.now();
      const scopes = {};
      for (const p of all) {
        scopes[p.teamId] ||= { id: p.teamId, teamId: p.teamId, members: [], run: null, finishedAt: null, forfeited: false };
        scopes[p.teamId].members.push(p.seat);
      }
      for (const scope of Object.values(scopes)) {
        scope.run = startRun(id, { sample: room.options.sample, seed });
        scope.run.startedAt = now;
        rememberInitialConfig(scope.run);
      }
      room.match?.items?.stop();
      room.match = { stageId: id, seed, startedAt: now, endsAt: now + MODE_CONFIG.matchDurationMs, endedAt: null, endedReason: null, scopes, results: null, level: levelForStage(id) };
      room.match.items = createMatchItems({
        room,
        sendTo: (seats, event, payload) => sendTo(room, seats, event, payload),
        broadcast: (event, payload) => io.to(room.code).emit(event, payload),
        onScopeChanged: (scope) => { emitState(room); emitScopeViews(room, scope); },
      });
      clearTimeout(room.matchTimer);
      room.matchTimer = setTimeout(() => endMatch(room, 'timeout'), MODE_CONFIG.matchDurationMs);
      room.matchTimer.unref?.();
      for (const p of all) {
        p.quit = false;
        p.station = null;
        p.roomSide = sideOf(room, p);
      }
      placeSpawns(room, id);
      room.phase = 'play';
      const title = Object.values(scopes)[0].run.stage.title;
      system(room, `เริ่ม${room.mode === 'team' ? 'การแข่งขันทีม 2v2' : ' FFA'} ด่าน ${id}: ${title} — โจทย์เดียวกัน ระบบจำลองแยกตาม${room.mode === 'team' ? 'ทีม' : 'ผู้เล่น'}`);
      io.to(room.code).emit('match:start', { stageId: id, startedAt: now, endsAt: room.match.endsAt, scopes: publicMatch(room).scopes });
      emitState(room);
      // Preview of side A so the mission panel can render before the player reaches a computer.
      for (const p of all) io.to(p.socketId).emit('stage:view', roleView(scopes[p.teamId].run, 'A'));
      room.match.items.pushState();
      return ack?.({ ok: true });
    },

    stageQuit(socket, room) {
      const seat = seatOfSocket(room, socket);
      if (!seat) return;
      if (room.phase === 'ended') {
        room.phase = 'select';
        emitState(room);
        return;
      }
      if (room.phase !== 'play') return;
      const p = room.seats[seat];
      p.quit = true;
      p.terminal = false;
      p.station = null;
      if (room.mode === 'team') teamSystem(room, p.teamId, `${p.name} ถอนตัว`);
      checkForfeits(room);
      emitState(room);
    },

    move(socket, payload, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return;
      const { player } = ctx;
      const now = Date.now();
      const dt = Math.min(0.1, Math.max(0, (now - (player.lastMoveAt || now)) / 1000));
      player.lastMoveAt = now;
      Object.assign(player, movePlayer(levelForStage(room.match.stageId), player.roomSide, player, player.input, dt, true));
      player.input = { x: Number(payload?.x) || 0, y: Number(payload?.y) || 0 };
      if (player.input.x || player.input.y) player.moving = true;
      emitPlayers(room);
    },

    interact(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      const { player, scope } = ctx;
      if (!payload?.open) {
        player.terminal = false;
        player.station = null;
        emitPlayers(room);
        emitState(room);
        return ack?.({ ok: true, open: false });
      }
      const level = levelForStage(room.match.stageId);
      const prefer = payload?.role === 'B' ? ['B', 'A'] : ['A', 'B'];
      const side = prefer.find((s) => nearbyComputer(level, s, player));
      if (!side) return ack?.({ ok: false, error: 'เดินเข้าใกล้คอมพิวเตอร์ก่อน' });
      player.station = side;
      player.terminal = true;
      emitPlayers(room);
      socket.emit('stage:view', roleView(scope.run, side));
      emitState(room);
      return ack?.({ ok: true, open: true, role: side });
    },

    role(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      const side = payload?.role;
      if (!['A', 'B'].includes(side)) return ack?.({ ok: false, error: 'เลือกฝั่งไม่ได้' });
      if (!nearbyComputer(levelForStage(room.match.stageId), side, ctx.player)) return ack?.({ ok: false, error: `เดินไปที่คอมพิวเตอร์ฝั่ง ${side} ก่อน` });
      ctx.player.station = side;
      ctx.player.terminal = true;
      socket.emit('stage:view', roleView(ctx.scope.run, side));
      emitPlayers(room);
      emitState(room);
      return ack?.({ ok: true, role: side });
    },

    exec(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.(warn(ctx.error));
      const { player, scope } = ctx;
      if (!player.terminal || !player.station) return ack?.(warn('เดินไปที่คอมพิวเตอร์แล้วกด E เพื่อเปิด Terminal'));
      if (payload?.role && payload.role !== player.station) return ack?.(warn(`คุณกำลังใช้คอมพิวเตอร์ฝั่ง ${player.station} — เดินไปที่ฝั่ง ${payload.role} เพื่อใช้คำสั่งของฝั่งนั้น`));
      const now = Date.now();
      socket.data.execTimes = socket.data.execTimes.filter((t) => now - t < 2000);
      if (socket.data.execTimes.length >= 10) return ack?.(warn('พิมพ์คำสั่งเร็วเกินไป — รอสักครู่'));
      socket.data.execTimes.push(now);
      const res = execute(scope.run, player.station, clean(payload?.line, 200));
      ack?.({ lines: res.lines, prompt: scope.run.stage.roles[player.station].device(scope.run.s)?.prompt });
      if (res.passedNow) return completeScope(room, scope);
      if (res.counted) {
        emitState(room);
        emitScopeViews(room, scope);
      }
      return undefined;
    },

    form(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, message: ctx.error });
      const { player, scope } = ctx;
      if (!player.terminal || !player.station) return ack?.({ ok: false, message: 'เดินไปที่คอมพิวเตอร์แล้วกด E ก่อนส่งแบบฟอร์ม' });
      if (payload?.role && payload.role !== player.station) return ack?.({ ok: false, message: `คุณกำลังใช้คอมพิวเตอร์ฝั่ง ${player.station}` });
      const res = submitForm(scope.run, player.station, payload?.data);
      ack?.({ ok: res.ok, message: res.message });
      if (res.passedNow) return completeScope(room, scope);
      emitState(room);
      emitScopeViews(room, scope);
      return undefined;
    },

    hint(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      const res = revealHint(ctx.scope.run, Number(payload?.level));
      if (res.error) return ack?.({ ok: false, error: res.error });
      sendTo(room, ctx.scope.members, 'hint:private', res.hint);
      emitState(room);
      return ack?.({ ok: true });
    },

    itemPickup(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      return ack?.(room.match.items.pickup(ctx.player, payload));
    },

    itemUse(socket, payload, ack, room) {
      const ctx = inPlay(room, socket);
      if (ctx.error) return ack?.({ ok: false, error: ctx.error });
      return ack?.(room.match.items.use(ctx.player, payload));
    },

    chat(socket, payload, room) {
      const seat = seatOfSocket(room, socket);
      const text = clean(payload?.text, 240);
      if (!seat || !text) return;
      const p = room.seats[seat];
      const msg = { from: seat, name: p.name, text, at: Date.now() };
      if (room.mode === 'team') {
        // Team chat stays inside the team so opponents cannot read strategy.
        msg.team = p.teamId;
        room.chat.push(msg);
        room.chat = room.chat.slice(-60);
        sendTo(room, teamMembers(room, p.teamId), 'chat:msg', msg);
        return;
      }
      room.chat.push(msg);
      room.chat = room.chat.slice(-60);
      io.to(room.code).emit('chat:msg', msg);
    },

    disconnect(socket, room) {
      const seat = seatOfSocket(room, socket);
      const p = seat && room.seats[seat];
      if (!p || p.socketId !== socket.id) return;
      p.connected = false;
      p.input = null;
      p.moving = false;
      if (room.phase === 'lobby') p.ready = false;
      if (room.phase === 'play' && !p.quit) {
        clearTimeout(p.graceTimer);
        p.graceTimer = setTimeout(() => {
          if (p.connected || room.phase !== 'play') return;
          p.quit = true;
          system(room, `${p.name} หลุดนานเกินกำหนด — ถือว่าถอนตัว`);
          checkForfeits(room);
          emitState(room);
        }, MODE_CONFIG.disconnectGraceMs);
        p.graceTimer.unref?.();
      }
      system(room, `${p.name} หลุดการเชื่อมต่อ — เข้าห้อง ${room.code} อีกครั้งเพื่อเล่นต่อ`);
      emitState(room);
      if (!players(room).some((other) => other.connected)) cleanupLater(room);
    },
  };
}
