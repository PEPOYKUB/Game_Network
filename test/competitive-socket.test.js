// FFA (4 players) and Team 2v2 over real Socket.IO: capacity, fairness, state scope,
// station-bound commands, match end (winner / timeout / forfeit), tie-break and reconnect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tick } from './helpers/socket-harness.js';
import { inspectRoom } from '../server/game/rooms.js';
import { configureModes, MODE_CONFIG, rankScopes } from '../server/game/competitive.js';
import { levelForStage } from '../public/js/world.js';

const DEFAULTS = { ...MODE_CONFIG };
test.afterEach(() => configureModes(DEFAULTS));

const SEATS = ['P1', 'P2', 'P3', 'P4'];

async function competitiveRoom(srv, mode, { teams } = {}) {
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await srv.client(`${mode}-p${i + 1}`));
  const created = await ps[0].send('room:create', { name: 'P1', playerId: ps[0].playerId, mode, sample: true, unlockAll: true });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.seat, 'P1');
  for (let i = 1; i < 4; i++) {
    const res = await ps[i].send('room:join', { code: created.code, name: `P${i + 1}`, playerId: ps[i].playerId });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.seat, SEATS[i]);
  }
  if (teams) {
    // Teams cap at 2, so a move may only succeed after another player leaves that team.
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 4; i++) await ps[i].send('lobby:team', { teamId: teams[i] });
    const room = inspectRoom(created.code);
    assert.deepEqual(SEATS.map((s) => room.seats[s].teamId), teams);
  }
  return { ps, code: created.code };
}

async function begin(ps, stageId) {
  for (const p of ps) p.fire('lobby:ready', { ready: true });
  await tick(150);
  const lobby = await ps[0].send('lobby:start');
  assert.equal(lobby.ok, true, lobby.error);
  const res = await ps[0].send('stage:start', { stageId });
  assert.equal(res.ok, true, res.error);
}

async function stateWhen(client, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.socket.off('room:state', onState);
      reject(new Error('timeout waiting for matching room:state'));
    }, timeout);
    const onState = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      client.socket.off('room:state', onState);
      resolve(state);
    };
    client.socket.on('room:state', onState);
    onState(client.last['room:state']);
  });
}

/** Teleport a seat in front of a station (movement itself is covered by world tests). */
function standAt(code, seat, side) {
  const room = inspectRoom(code);
  const station = levelForStage(room.match.stageId).stations[side][0];
  Object.assign(room.seats[seat], { x: station.x, y: station.y });
}

async function openAt(code, client, seat, side) {
  standAt(code, seat, side);
  const res = await client.send('player:interact', { open: true, role: side });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.role, side);
}

/** Stage 7 needs both sides: A traceroutes, B reads the routing table and submits the path form. */
async function solveStage7(code, scopeId, clientA, seatA, clientB, seatB) {
  const run = inspectRoom(code).match.scopes[scopeId].run;
  await openAt(code, clientA, seatA, 'A');
  await clientA.send('term:exec', { line: `traceroute ${run.s.meta.topo.server}` });
  if (clientB === clientA) {
    await clientA.send('player:interact', { open: false });
  }
  await openAt(code, clientB, seatB, 'B');
  await clientB.send('term:exec', { line: 'route print' });
  return clientB.send('form:submit', { data: Object.fromEntries(run.s.truth.path.map((r, i) => [`hop${i + 1}`, r])) });
}

test('FFA: four seats, the fifth player is rejected, co-op rooms keep working alongside', async () => {
  const srv = await startServer();
  try {
    const { code } = await competitiveRoom(srv, 'ffa');
    const fifth = await srv.client('fifth');
    const res = await fifth.send('room:join', { code, name: 'X', playerId: 'fifth' });
    assert.equal(res.ok, false);
    assert.match(res.error, /ครบ 4/);

    const a = await srv.client('coop-a');
    const b = await srv.client('coop-b');
    const coop = await a.send('room:create', { name: 'A', playerId: 'coop-a' });
    assert.equal(coop.role, 'A');
    assert.equal((await b.send('room:join', { code: coop.code, name: 'B', playerId: 'coop-b' })).role, 'B');
    assert.equal(inspectRoom(coop.code).mode, 'coop');
    const third = await fifth.send('room:join', { code: coop.code, name: 'X', playerId: 'fifth' });
    assert.match(third.error, /ครบ 2/);
  } finally { await srv.close(); }
});

test('FFA: start needs all four ready', async () => {
  const srv = await startServer();
  try {
    const { ps } = await competitiveRoom(srv, 'ffa');
    for (const p of ps.slice(0, 3)) p.fire('lobby:ready', { ready: true });
    await tick(150);
    const res = await ps[0].send('lobby:start');
    assert.equal(res.ok, false);
    assert.match(res.error, /ครบ 4/);
  } finally { await srv.close(); }
});

test('FFA: identical starting puzzle, but each player has an independent network state', async () => {
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await begin(ps, 1);
    const { scopes } = inspectRoom(code).match;
    assert.deepEqual(Object.keys(scopes).sort(), SEATS);
    const snapshot = (id) => JSON.stringify({ truth: scopes[id].run.s.truth, state: scopes[id].run.s.state, meta: scopes[id].run.s.meta });
    for (const id of SEATS) assert.equal(snapshot(id), snapshot('P1'), `${id} must start from the same puzzle`);
    assert.notEqual(scopes.P1.run, scopes.P2.run);

    await openAt(code, ps[0], 'P1', 'A');
    await ps[0].send('term:exec', { line: 'set ip 192.168.10.99 255.255.255.0' });
    assert.equal(scopes.P1.run.s.state.ip, '192.168.10.99');
    assert.equal(scopes.P2.run.s.state.ip, null, 'P1 config must not leak into P2');

    const state = ps[1].last['room:state'];
    assert.equal(state.mode, 'ffa');
    assert.deepEqual(state.me, { seat: 'P2', teamId: 'P2', scopeId: 'P2', station: null });
    assert.equal(state.match.stageId, 1);
    assert.ok(state.match.endsAt > state.match.startedAt);
    assert.ok(!JSON.stringify(ps.map((p) => p.log)).includes('"truth"'), 'ground truth must never reach clients');
  } finally { await srv.close(); }
});

test('FFA: commands are bound to the computer the player actually opened', async () => {
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await begin(ps, 7);
    const closed = await ps[0].send('term:exec', { line: 'ipconfig' });
    assert.match(closed.lines[0].t, /กด E/);
    const far = await ps[0].send('player:interact', { open: true, role: 'A' });
    assert.equal(far.ok, false);

    await openAt(code, ps[0], 'P1', 'A');
    const wrongSide = await ps[0].send('term:exec', { line: 'route print', role: 'B' });
    assert.match(wrongSide.lines[0].t, /ฝั่ง A/);
    const asA = await ps[0].send('term:exec', { line: 'route print' });
    assert.match(asA.lines[0].t, /ใช้ไม่ได้ในห้อง A/, 'without a role the station side (A) is used');
    const switchFar = await ps[0].send('stage:role', { role: 'B' });
    assert.equal(switchFar.ok, false);
    assert.match(switchFar.error, /ฝั่ง B/);
    const formAtA = await ps[0].send('form:submit', { data: {}, role: 'B' });
    assert.equal(formAtA.ok, false);

    standAt(code, 'P1', 'B');
    assert.equal((await ps[0].send('stage:role', { role: 'B' })).ok, true);
    const asB = await ps[0].send('term:exec', { line: 'route print' });
    assert.ok(!/ใช้ไม่ได้/.test(asB.lines[0].t));
  } finally { await srv.close(); }
});

test('FFA: one player can play both sides; the first to finish wins and the match ends for everyone', async () => {
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await begin(ps, 7);
    const ends = ps.map((p) => p.next('match:end'));
    const completes = ps.map((p) => p.next('stage:complete'));
    const form = await solveStage7(code, 'P1', ps[0], 'P1', ps[0], 'P1');
    assert.equal(form.ok, true, form.message);
    const [end] = await Promise.all(ends);
    assert.equal(end.reason, 'winner');
    assert.equal(end.results[0].scopeId, 'P1');
    assert.equal(end.results[0].rank, 1);
    assert.equal(end.results[0].completed, true);
    assert.ok(end.results.slice(1).every((r) => r.rank === 2 && !r.completed), 'untouched players tie for 2nd');
    const ranks = (await Promise.all(completes)).map((c) => c.rank);
    assert.deepEqual(ranks, [1, 2, 2, 2]);

    const room = inspectRoom(code);
    assert.equal(room.phase, 'ended');
    const late = await ps[1].send('term:exec', { line: 'ipconfig' });
    assert.match(late.lines[0].t, /จบแล้ว/);
    const again = await ps[1].send('room:join', { code, name: 'P2', playerId: ps[1].playerId });
    assert.equal(again.seat, 'P2');
    assert.equal(Object.values(room.seats).filter(Boolean).length, 4);
    assert.equal(room.match.results.length, 4, 'reconnect must not duplicate results');

    assert.equal((await ps[2].send('stage:start', { stageId: 1 })).ok, true, 'a new match can start from the ended phase');
    assert.equal(inspectRoom(code).phase, 'play');
  } finally { await srv.close(); }
});

test('FFA: timeout ends the match and ranks by objectives, score, then time (ties share a rank)', async () => {
  const srv = await startServer();
  try {
    configureModes({ matchDurationMs: 400 });
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await begin(ps, 1);
    const end = ps[0].next('match:end', () => true, 3000);
    assert.equal((await ps[1].send('hint:reveal', { level: 1 })).ok, true);
    const res = await end;
    assert.equal(res.reason, 'timeout');
    const bySeat = Object.fromEntries(res.results.map((r) => [r.scopeId, r]));
    assert.equal(bySeat.P2.rank, 4, 'the hint penalty lowers P2 below the others');
    for (const seat of ['P1', 'P3', 'P4']) assert.equal(bySeat[seat].rank, 1);
    assert.ok(bySeat.P1.score > bySeat.P2.score);
    assert.equal(inspectRoom(code).phase, 'ended');
  } finally { await srv.close(); }
});

test('ranking tie-break order: forfeit < completion < objectives < score < time', () => {
  const run = (passed, score) => ({ passed, result: score == null ? null : { total: score }, hints: [], wrong: 0, commands: 0, startedAt: 0, stage: { minutes: 1, optimal: 1 } });
  const match = {
    startedAt: 0,
    endedAt: 100_000,
    scopes: {
      fast: { id: 'fast', teamId: 'fast', members: ['P1'], run: run(true, 150), finishedAt: 20_000, forfeited: false },
      slow: { id: 'slow', teamId: 'slow', members: ['P2'], run: run(true, 150), finishedAt: 40_000, forfeited: false },
      rich: { id: 'rich', teamId: 'rich', members: ['P3'], run: run(true, 190), finishedAt: 90_000, forfeited: false },
      quit: { id: 'quit', teamId: 'quit', members: ['P4'], run: run(true, 200), finishedAt: 10_000, forfeited: true },
    },
  };
  const rows = rankScopes(match);
  assert.deepEqual(rows.map((r) => [r.scopeId, r.rank]), [['rich', 1], ['fast', 2], ['slow', 3], ['quit', 4]]);
});

test('FFA: disconnect keeps the seat; strangers cannot take it mid-match; reconnect restores identity', async () => {
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await begin(ps, 1);
    await openAt(code, ps[2], 'P3', 'A');
    await ps[2].send('term:exec', { line: 'set ip 192.168.10.50 255.255.255.0' });
    const scopeBefore = inspectRoom(code).match.scopes.P3;
    ps[2].disconnect();
    await tick(60);
    assert.equal(inspectRoom(code).seats.P3.connected, false);

    const stranger = await srv.client('stranger');
    const steal = await stranger.send('room:join', { code, name: 'Thief', playerId: 'stranger' });
    assert.equal(steal.ok, false);
    assert.match(steal.error, /ผู้เล่นเดิม/);

    const back = await srv.client(ps[2].playerId);
    const view = back.next('stage:view');
    const res = await back.send('room:join', { code, name: 'P3', playerId: ps[2].playerId });
    assert.deepEqual([res.ok, res.seat], [true, 'P3']);
    assert.equal((await view).role, 'A', 'the open station view comes back');
    const room = inspectRoom(code);
    assert.equal(room.match.scopes.P3, scopeBefore);
    assert.equal(room.match.scopes.P3.run.s.state.ip, '192.168.10.50');
    assert.equal(Object.values(room.seats).filter(Boolean).length, 4);
    assert.equal(Object.keys(room.match.scopes).length, 4);
  } finally { await srv.close(); }
});

test('FFA: players gone past the grace period forfeit; the last one standing wins', async () => {
  const srv = await startServer();
  try {
    configureModes({ disconnectGraceMs: 120 });
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await begin(ps, 1);
    const end = ps[0].next('match:end', () => true, 3000);
    ps[1].disconnect();
    ps[2].disconnect();
    // stage:quit is a unanimous vote to return to stage select; leaving the
    // match is an explicit room:leave and counts as a forfeit immediately.
    ps[3].fire('room:leave');
    const res = await end;
    assert.equal(res.reason, 'forfeit');
    assert.equal(res.results[0].scopeId, 'P1');
    assert.equal(res.results[0].rank, 1);
    assert.ok(res.results.slice(1).every((r) => r.forfeited && r.score === 0));
  } finally { await srv.close(); }
});

test('2v2: team choice, full-team rejection and start validation', async () => {
  const srv = await startServer();
  try {
    const { ps } = await competitiveRoom(srv, 'team');
    const state = await stateWhen(ps[0], (snapshot) => Object.values(snapshot?.teams || {}).flat().length === 4);
    assert.deepEqual(state.teams, { T1: ['P1', 'P3'], T2: ['P2', 'P4'] }, 'joiners are auto-balanced');
    assert.equal((await ps[1].send('lobby:team', { teamId: 'T3' })).ok, false);
    assert.equal((await ps[1].send('lobby:team', { teamId: 'T1' })).ok, true, 'one extra member is allowed while reshuffling');
    const full = await ps[3].send('lobby:team', { teamId: 'T1' });
    assert.equal(full.ok, false, 'a team can never hold all four');
    assert.match(full.error, /เต็ม/);
    for (const p of ps) p.fire('lobby:ready', { ready: true });
    await tick(150);
    const unbalanced = await ps[0].send('lobby:start');
    assert.equal(unbalanced.ok, false);
    assert.match(unbalanced.error, /ทีมละ 2/);
    assert.equal((await ps[2].send('lobby:team', { teamId: 'T2' })).ok, true, 'swap completes');
    await tick(60);
    assert.deepEqual(ps[0].last['room:state'].teams, { T1: ['P1', 'P2'], T2: ['P3', 'P4'] });
    const ffa = await srv.client('ffa-x');
    const other = await ffa.send('room:create', { name: 'F', playerId: 'ffa-x', mode: 'ffa' });
    assert.equal((await ffa.send('lobby:team', { teamId: 'T1' })).ok, false, 'FFA has no teams');
    assert.ok(other.ok);
  } finally { await srv.close(); }
});

test('2v2: teammates share one network state, the other team is separate; a team finishing together wins', async () => {
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'team', { teams: ['T1', 'T1', 'T2', 'T2'] });
    await begin(ps, 7);
    const room = inspectRoom(code);
    assert.deepEqual(Object.keys(room.match.scopes).sort(), ['T1', 'T2']);
    assert.deepEqual(room.match.scopes.T1.members, ['P1', 'P2']);
    assert.equal(JSON.stringify(room.match.scopes.T1.run.s.truth), JSON.stringify(room.match.scopes.T2.run.s.truth));
    assert.deepEqual([room.seats.P1.roomSide, room.seats.P2.roomSide, room.seats.P3.roomSide, room.seats.P4.roomSide], ['A', 'B', 'A', 'B']);

    // P1 (A) traces, P2 (B) completes: one shared run for team T1.
    await openAt(code, ps[0], 'P1', 'A');
    await ps[0].send('term:exec', { line: `traceroute ${room.match.scopes.T1.run.s.meta.topo.server}` });
    assert.equal(room.match.scopes.T1.run.roleProgress.A.actions, 1);
    assert.equal(room.match.scopes.T2.run.roleProgress.A.actions, 0);
    const ends = ps.map((p) => p.next('match:end'));
    await openAt(code, ps[1], 'P2', 'B');
    await ps[1].send('term:exec', { line: 'route print' });
    const form = await ps[1].send('form:submit', { data: Object.fromEntries(room.match.scopes.T1.run.s.truth.path.map((r, i) => [`hop${i + 1}`, r])) });
    assert.equal(form.ok, true, form.message);
    const [end] = await Promise.all(ends);
    assert.equal(end.reason, 'winner');
    assert.deepEqual(end.results.map((r) => [r.scopeId, r.rank, r.members]), [['T1', 1, ['P1', 'P2']], ['T2', 2, ['P3', 'P4']]]);
    const state = ps[0].last['room:state'];
    assert.equal(state.ffaResults.P1.rank, 1);
    assert.equal(state.ffaResults.P2.rank, 1);
    assert.equal(state.ffaResults.P3.rank, 2);
  } finally { await srv.close(); }
});

test('2v2: team chat and hints stay inside the team', async () => {
  const srv = await startServer();
  try {
    const { ps } = await competitiveRoom(srv, 'team', { teams: ['T1', 'T1', 'T2', 'T2'] });
    await begin(ps, 1);
    const mate = ps[1].next('chat:msg', (m) => m.from === 'P1');
    ps[0].fire('chat:send', { text: 'plan: I take A' });
    assert.equal((await mate).text, 'plan: I take A');
    const mateHint = ps[1].next('hint:private');
    assert.equal((await ps[0].send('hint:reveal', { level: 1 })).ok, true);
    assert.equal((await mateHint).level, 1);
    await tick(80);
    for (const enemy of [ps[2], ps[3]]) {
      assert.ok(!enemy.log.some((e) => e.event === 'chat:msg' && e.payload.from === 'P1'), 'opponents must not read team chat');
      assert.ok(!enemy.log.some((e) => e.event === 'hint:private'), 'opponents must not see team hints');
    }
  } finally { await srv.close(); }
});

test('voice signaling follows the selected 2v2 channel and never crosses incompatible teams', async () => {
  const srv = await startServer();
  try {
    const { ps } = await competitiveRoom(srv, 'team', { teams: ['T1', 'T1', 'T2', 'T2'] });
    for (const p of ps) {
      const res = await p.send('voice:settings', { active: true, micEnabled: true, channel: 'team' });
      assert.equal(res.ok, true);
    }

    const teammateSignal = ps[1].next('voice:signal');
    const allowed = await ps[0].send('voice:signal', {
      to: 'P2', signal: { description: { type: 'offer', sdp: 'v=0' } },
    });
    assert.equal(allowed.ok, true);
    assert.equal((await teammateSignal).from, 'P1');

    const blocked = await ps[0].send('voice:signal', {
      to: 'P3', signal: { description: { type: 'offer', sdp: 'v=0' } },
    });
    assert.equal(blocked.ok, false, 'team-only signal cannot reach an opponent');

    await ps[0].send('voice:settings', { active: true, micEnabled: true, channel: 'room' });
    await ps[2].send('voice:settings', { active: true, micEnabled: true, channel: 'room' });
    const roomSignal = ps[2].next('voice:signal');
    const roomAllowed = await ps[0].send('voice:signal', {
      to: 'P3', signal: { description: { type: 'offer', sdp: 'v=0' } },
    });
    assert.equal(roomAllowed.ok, true);
    assert.equal((await roomSignal).from, 'P1');
  } finally { await srv.close(); }
});

test('2v2: one teammate quitting does not forfeit the team; both quitting does', async () => {
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'team', { teams: ['T1', 'T1', 'T2', 'T2'] });
    await begin(ps, 1);
    ps[2].fire('room:leave');
    await tick(60);
    assert.equal(inspectRoom(code).phase, 'play');
    assert.equal(inspectRoom(code).match.scopes.T2.forfeited, false);
    const end = ps[0].next('match:end');
    ps[3].fire('room:leave');
    const res = await end;
    assert.equal(res.reason, 'forfeit');
    assert.deepEqual(res.results.map((r) => [r.scopeId, r.rank, r.forfeited]), [['T1', 1, false], ['T2', 2, true]]);
  } finally { await srv.close(); }
});
