// Regressions for: stage:retry ack/dispatch, who may vote (retry / leave stage) when players
// drop out, and the server-side briefing that starts every competitive match simultaneously.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tick } from './helpers/socket-harness.js';
import { inspectRoom, configureRooms } from '../server/game/rooms.js';
import { configureModes, MODE_CONFIG } from '../server/game/competitive.js';

const DEFAULTS = { ...MODE_CONFIG };
test.afterEach(() => { configureModes(DEFAULTS); configureRooms({ coopStageMs: null }); });

async function coopRoom(srv) {
  const a = await srv.client('rv-a');
  const b = await srv.client('rv-b');
  const { code } = await a.send('room:create', { name: 'A', playerId: 'rv-a', sample: true });
  await b.send('room:join', { code, name: 'B', playerId: 'rv-b' });
  a.fire('lobby:ready', { ready: true });
  b.fire('lobby:ready', { ready: true });
  await tick(150);
  await a.send('lobby:start');
  assert.equal((await a.send('stage:start', { stageId: 1 })).ok, true);
  return { a, b, code };
}

async function competitiveRoom(srv, mode, stageId = 1) {
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await srv.client(`rv-${mode}-${i}`));
  const { code } = await ps[0].send('room:create', { name: 'P1', playerId: ps[0].playerId, mode, sample: true, unlockAll: true });
  for (let i = 1; i < 4; i++) await ps[i].send('room:join', { code, name: `P${i + 1}`, playerId: ps[i].playerId });
  for (const p of ps) p.fire('lobby:ready', { ready: true });
  await tick(150);
  assert.equal((await ps[0].send('lobby:start')).ok, true);
  assert.equal((await ps[0].send('stage:start', { stageId })).ok, true);
  return { ps, code };
}

const waitFor = async (check, ms = 3000) => {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('condition not reached');
    await tick(20);
  }
};

// ---------------------------------------------------------------- 1. stage:retry ack + dispatch

test('co-op retry: the (payload, ack) form the client uses is acknowledged and restarts after both vote', async () => {
  configureRooms({ coopStageMs: 200 });
  const srv = await startServer();
  try {
    const { a, b, code } = await coopRoom(srv);
    await waitFor(() => inspectRoom(code).phase === 'ended');
    const firstRun = inspectRoom(code).run;
    const first = await a.send('stage:retry', {});
    assert.deepEqual([first.ok, first.waiting, first.count, first.total], [true, true, 1, 2]);
    const second = await b.send('stage:retry', {});
    assert.equal(second.ok, true);
    assert.equal(second.waiting, false);
    const room = inspectRoom(code);
    assert.equal(room.phase, 'play');
    assert.notEqual(room.run, firstRun, 'a fresh run starts');
  } finally { await srv.close(); }
});

test('co-op retry: the legacy (ack)-only form is still accepted', async () => {
  configureRooms({ coopStageMs: 200 });
  const srv = await startServer();
  try {
    const { a, code } = await coopRoom(srv);
    await waitFor(() => inspectRoom(code).phase === 'ended');
    const res = await new Promise((resolve) => a.socket.emit('stage:retry', resolve));
    assert.equal(res.ok, true);
    assert.equal(res.count, 1);
  } finally { await srv.close(); }
});

test('co-op retry: a partner who disconnects no longer blocks the vote', async () => {
  configureRooms({ coopStageMs: 200 });
  const srv = await startServer();
  try {
    const { a, b, code } = await coopRoom(srv);
    await waitFor(() => inspectRoom(code).phase === 'ended');
    assert.equal((await a.send('stage:retry', {})).waiting, true);
    b.disconnect();
    await waitFor(() => inspectRoom(code).phase === 'play');
  } finally { await srv.close(); }
});

test('FFA retry: stage:retry reaches competitive.stageRetry and restarts the match once all 4 vote', async () => {
  configureModes({ matchDurationMs: 250 });
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await waitFor(() => inspectRoom(code).phase === 'ended');
    const ended = inspectRoom(code).match;
    assert.equal(ended.endedReason, 'timeout');
    for (let i = 0; i < 3; i++) {
      const res = await ps[i].send('stage:retry', {});
      assert.deepEqual([res.ok, res.waiting, res.count, res.total], [true, true, i + 1, 4]);
    }
    const started = ps[0].next('match:start');
    const last = await ps[3].send('stage:retry', {});
    assert.equal(last.ok, true);
    assert.equal(last.waiting, undefined);
    await started;
    const room = inspectRoom(code);
    assert.equal(room.phase, 'play');
    assert.notEqual(room.match, ended);
    assert.equal(room.match.results, null);
  } finally { await srv.close(); }
});

test('2v2 retry works through the same dispatch', async () => {
  configureModes({ matchDurationMs: 250 });
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'team');
    await waitFor(() => inspectRoom(code).phase === 'ended');
    for (const p of ps) await p.send('stage:retry', {});
    assert.equal(inspectRoom(code).phase, 'play');
    assert.deepEqual(Object.keys(inspectRoom(code).match.scopes).sort(), ['T1', 'T2']);
  } finally { await srv.close(); }
});

// ---------------------------------------------------------------- 2. vote eligibility

test('FFA retry: a disconnect completes a vote the remaining players already agreed on', async () => {
  configureModes({ matchDurationMs: 250 });
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await waitFor(() => inspectRoom(code).phase === 'ended');
    for (let i = 0; i < 3; i++) await ps[i].send('stage:retry', {});
    assert.equal(inspectRoom(code).phase, 'ended', 'still waiting for P4');
    ps[3].disconnect();
    await waitFor(() => inspectRoom(code).phase === 'play');
    const p4 = inspectRoom(code).seats.P4;
    assert.equal(p4.connected, false);
    assert.equal(p4.quit, false, 'the offline player is still in the new match during the grace period');
  } finally { await srv.close(); }
});

test('FFA retry: a player who reconnects before completion must vote again', async () => {
  configureModes({ matchDurationMs: 250 });
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    await waitFor(() => inspectRoom(code).phase === 'ended');
    await ps[0].send('stage:retry', {});
    ps[3].disconnect();
    await tick(80);
    const back = await srv.client(ps[3].playerId);
    await back.send('room:join', { code, name: 'P4', playerId: ps[3].playerId });
    await ps[1].send('stage:retry', {});
    const res = await ps[2].send('stage:retry', {});
    assert.deepEqual([res.waiting, res.count, res.total], [true, 3, 4]);
    assert.equal((await back.send('stage:retry', {})).ok, true);
    assert.equal(inspectRoom(code).phase, 'play');
  } finally { await srv.close(); }
});

test('FFA leave-stage vote: only active players count; a forfeited player cannot vote or block', async () => {
  configureModes({ disconnectGraceMs: 100 });
  const srv = await startServer();
  try {
    const { ps, code } = await competitiveRoom(srv, 'ffa');
    ps[3].disconnect();
    await waitFor(() => inspectRoom(code).seats.P4.quit);
    const back = await srv.client(ps[3].playerId);
    await back.send('room:join', { code, name: 'P4', playerId: ps[3].playerId });
    const refused = await back.send('stage:quit', {});
    assert.equal(refused.ok, false, 'a player who already forfeited this match cannot vote');
    assert.equal((await ps[0].send('stage:quit', {})).total, 3);
    await ps[1].send('stage:quit', {});
    const last = await ps[2].send('stage:quit', {});
    assert.equal(last.waiting, false);
    assert.equal(inspectRoom(code).phase, 'select');
  } finally { await srv.close(); }
});

// ---------------------------------------------------------------- 3. shared briefing / countdown

test('competitive start: nobody can act or pick up items until the server start signal, then everyone starts together', async () => {
  configureModes({ matchDurationMs: 400 });
  const srv = await startServer({ briefingMs: 600 });
  try {
    const go = [];
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await srv.client(`br-${i}`));
    const { code } = await ps[0].send('room:create', { name: 'P1', playerId: 'br-0', mode: 'ffa', sample: true });
    for (let i = 1; i < 4; i++) await ps[i].send('room:join', { code, name: `P${i + 1}`, playerId: `br-${i}` });
    for (const p of ps) p.fire('lobby:ready', { ready: true });
    await tick(150);
    await ps[0].send('lobby:start');
    for (const p of ps) go.push(p.next('match:go', () => true, 3000));
    const startMsg = ps[1].next('match:start');
    await ps[0].send('stage:start', { stageId: 1 });
    const start = await startMsg;
    const room = inspectRoom(code);
    const m = room.match;
    assert.ok(start.startsAt - start.now >= 550, 'clients learn when the match starts');
    assert.equal(m.endsAt, m.startsAt + 400, 'the clock starts after the briefing');
    assert.ok(m.items.state.nextSpawnAt >= m.startsAt, 'no item can spawn during the briefing');

    const st = m.level.stations.A[0];
    Object.assign(room.seats.P1, { x: st.x, y: st.y });
    const early = await ps[0].send('player:interact', { open: true, role: 'A' });
    assert.equal(early.ok, false);
    assert.match(early.error, /รอสัญญาณเริ่ม/);
    const before = { x: room.seats.P2.x, y: room.seats.P2.y };
    for (let i = 0; i < 3; i++) { ps[1].fire('player:move', { x: 1, y: 0 }); await tick(50); }
    assert.deepEqual({ x: room.seats.P2.x, y: room.seats.P2.y }, before, 'movement is frozen during the briefing');
    m.items.state.drops.set('d', { id: 'd', item: 'shield', x: room.seats.P3.x, y: room.seats.P3.y, expiresAt: Date.now() + 5000 });
    const pick = await ps[2].send('item:pickup', { dropId: 'd', requestId: 'x1' });
    assert.equal(pick.ok, false);

    await Promise.all(go);
    assert.ok(Date.now() >= m.startsAt);
    const late = await ps[0].send('player:interact', { open: true, role: 'A' });
    assert.equal(late.ok, true);
    assert.equal(room.phase, 'play', 'the match is not timed out by the briefing');
    await waitFor(() => room.phase === 'ended', 2000);
    assert.equal(m.endedReason, 'timeout');
  } finally { await srv.close(); }
});
