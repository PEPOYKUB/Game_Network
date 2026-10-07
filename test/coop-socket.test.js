// Regression guard for the original 2-player co-op flow over real Socket.IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tick } from './helpers/socket-harness.js';
import { inspectRoom } from '../server/game/rooms.js';
import { levelForStage } from '../public/js/world.js';

async function coopRoom(srv) {
  const a = await srv.client('player-a');
  const b = await srv.client('player-b');
  const created = await a.send('room:create', { name: 'Alice', playerId: a.playerId, sample: true });
  assert.equal(created.ok, true);
  assert.equal(created.role, 'A');
  assert.match(created.code, /^\d{4}$/);
  const joined = await b.send('room:join', { code: created.code, name: 'Bob', playerId: b.playerId });
  assert.deepEqual([joined.ok, joined.role], [true, 'B']);
  return { a, b, code: created.code };
}

async function startStage(a, b, stageId = 1) {
  a.fire('lobby:ready', { ready: true });
  b.fire('lobby:ready', { ready: true });
  await tick(150);
  assert.equal((await a.send('lobby:start')).ok, true);
  const res = await a.send('stage:start', { stageId });
  assert.equal(res.ok, true, res.error);
}

function standAtTerminal(code, role, stageId = 1) {
  const room = inspectRoom(code);
  const station = levelForStage(stageId).stations[role][0];
  Object.assign(room.slots[role], { x: station.x, y: station.y });
}

test('co-op: create, join, ready, start and each side receives only its own view', async () => {
  const srv = await startServer();
  try {
    const { a, b } = await coopRoom(srv);
    const viewA = a.next('stage:view');
    const viewB = b.next('stage:view');
    await startStage(a, b);
    const [va, vb] = await Promise.all([viewA, viewB]);
    assert.equal(va.role, 'A');
    assert.equal(vb.role, 'B');
    const state = a.last['room:state'];
    assert.equal(state.phase, 'play');
    assert.equal(state.you, 'A');
    assert.deepEqual(Object.keys(state.players).sort(), ['A', 'B']);
    assert.equal(state.run.link, 'OFFLINE');
    const payload = JSON.stringify([a.log, b.log]);
    assert.ok(!payload.includes('"truth"'), 'ground truth must never reach clients');
  } finally { await srv.close(); }
});

test('co-op: a third player is rejected', async () => {
  const srv = await startServer();
  try {
    const { code } = await coopRoom(srv);
    const c = await srv.client('player-c');
    const res = await c.send('room:join', { code, name: 'Carol', playerId: c.playerId });
    assert.equal(res.ok, false);
    assert.match(res.error, /ครบ/);
  } finally { await srv.close(); }
});

test('co-op: lobby start needs both players ready', async () => {
  const srv = await startServer();
  try {
    const { a } = await coopRoom(srv);
    a.fire('lobby:ready', { ready: true });
    await tick(150);
    const res = await a.send('lobby:start');
    assert.equal(res.ok, false);
  } finally { await srv.close(); }
});

test('co-op: terminal requires standing at your own computer', async () => {
  const srv = await startServer();
  try {
    const { a, b } = await coopRoom(srv);
    await startStage(a, b);
    const far = await a.send('player:interact', { open: true });
    assert.equal(far.ok, false);
    const blocked = await a.send('term:exec', { line: 'ipconfig' });
    assert.match(blocked.lines[0].t, /Terminal/);
  } finally { await srv.close(); }
});

test('co-op: solving stage 1 completes it for both players and unlocks stage 2', async () => {
  const srv = await startServer();
  try {
    const { a, b, code } = await coopRoom(srv);
    await startStage(a, b);
    standAtTerminal(code, 'A');
    assert.equal((await a.send('player:interact', { open: true })).ok, true);
    const doneA = a.next('stage:complete');
    const doneB = b.next('stage:complete');
    const set = await a.send('term:exec', { line: 'set ip 192.168.10.15 255.255.255.0' });
    assert.ok(set.lines.some((l) => l.c === 'ok'), JSON.stringify(set.lines));
    await a.send('term:exec', { line: 'ipconfig' });
    const [ra, rb] = await Promise.all([doneA, doneB]);
    assert.equal(ra.stageId, 1);
    assert.equal(rb.result.total, ra.result.total);
    await tick();
    const state = b.last['room:state'];
    assert.equal(state.run.link, 'ONLINE');
    assert.equal(state.progress.unlocked, 2);
    assert.ok(state.progress.cleared[1]);
  } finally { await srv.close(); }
});

test('co-op: a disconnected player reconnects into the same role and gets the current view back', async () => {
  const srv = await startServer();
  try {
    const { a, b, code } = await coopRoom(srv);
    await startStage(a, b);
    b.disconnect();
    await tick(60);
    assert.equal(inspectRoom(code).slots.B.connected, false);
    const b2 = await srv.client('player-b');
    const view = b2.next('stage:view');
    const res = await b2.send('room:join', { code, name: 'Bob', playerId: 'player-b' });
    assert.deepEqual([res.ok, res.role], [true, 'B']);
    assert.equal((await view).role, 'B');
    assert.equal(inspectRoom(code).slots.B.connected, true);
    assert.equal(Object.values(inspectRoom(code).slots).filter(Boolean).length, 2, 'reconnect must not duplicate players');
  } finally { await srv.close(); }
});

test('co-op: chat reaches the partner', async () => {
  const srv = await startServer();
  try {
    const { a, b } = await coopRoom(srv);
    const msg = b.next('chat:msg', (m) => m.from === 'A');
    a.fire('chat:send', { text: 'hello B' });
    assert.equal((await msg).text, 'hello B');
  } finally { await srv.close(); }
});
