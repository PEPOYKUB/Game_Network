// Items in real competitive matches: spawn → pickup → inventory → target → effect on server state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tick } from './helpers/socket-harness.js';
import { inspectRoom } from '../server/game/rooms.js';
import { levelForStage } from '../public/js/world.js';

const SEATS = ['P1', 'P2', 'P3', 'P4'];
let reqSeq = 0;
const rid = () => `req-${++reqSeq}`;

async function match(srv, mode, stageId, teams) {
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await srv.client(`${mode}-i${i}`));
  const { code } = await ps[0].send('room:create', { name: 'P1', playerId: ps[0].playerId, mode, sample: true, unlockAll: true });
  for (let i = 1; i < 4; i++) await ps[i].send('room:join', { code, name: `P${i + 1}`, playerId: ps[i].playerId });
  if (teams) for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 4; i++) await ps[i].send('lobby:team', { teamId: teams[i] });
  for (const p of ps) p.fire('lobby:ready', { ready: true });
  await tick(150);
  assert.equal((await ps[0].send('lobby:start')).ok, true);
  assert.equal((await ps[0].send('stage:start', { stageId })).ok, true);
  const room = inspectRoom(code);
  return { ps, code, room, items: room.match.items.state };
}

const give = (items, scopeId, ...list) => items.inventories.set(scopeId, list);
const inv = (items, scopeId) => items.inventories.get(scopeId) || [];

async function setIp(room, client, seat, ip) {
  const st = room.match.level.stations.A[0];
  Object.assign(room.seats[seat], { x: st.x, y: st.y });
  assert.equal((await client.send('player:interact', { open: true, role: 'A' })).ok, true);
  await client.send('term:exec', { line: `set ip ${ip} 255.255.255.0` });
}

test('spawn → walk to the drop → pickup → inventory; far, repeated and taken drops are rejected', async () => {
  const srv = await startServer();
  try {
    const { ps, room, items } = await match(srv, 'ffa', 1);
    const spawned = ps[0].next('item:state', (s) => s.drops.length === 1, 3000);
    items.nextSpawnAt = 0;
    const { drops: [drop] } = await spawned;
    assert.ok(['configErase', 'configGlitch', 'shield', 'reflect'].includes(drop.item));
    const corridor = levelForStage(1);
    assert.ok(drop.x > corridor.split[0] && drop.x < corridor.split[1], 'drops spawn on the shared corridor');

    const far = await ps[0].send('item:pickup', { dropId: drop.id, requestId: rid() });
    assert.equal(far.ok, false);
    assert.match(far.error, /ไกล/);

    Object.assign(room.seats.P1, { x: drop.x + 10, y: drop.y });
    Object.assign(room.seats.P2, { x: drop.x - 10, y: drop.y });
    const id = rid();
    const got = await ps[0].send('item:pickup', { dropId: drop.id, requestId: id });
    assert.deepEqual([got.ok, got.item], [true, drop.item]);
    const replay = await ps[0].send('item:pickup', { dropId: drop.id, requestId: id });
    assert.equal(replay.duplicate, true);
    assert.equal(inv(items, 'P1').length, 1, 'replayed request must not add a second item');
    const late = await ps[1].send('item:pickup', { dropId: drop.id, requestId: rid() });
    assert.equal(late.ok, false, 'a taken drop is gone for everyone');

    give(items, 'P1', 'shield', 'shield', 'shield');
    items.drops.set('x', { id: 'x', item: 'reflect', x: drop.x, y: drop.y, expiresAt: Date.now() + 10_000 });
    const full = await ps[0].send('item:pickup', { dropId: 'x', requestId: rid() });
    assert.match(full.error, /เต็ม/);
  } finally { await srv.close(); }
});

test('Config Erase resets one real config value of one FFA opponent', async () => {
  const srv = await startServer();
  try {
    const { ps, room, items } = await match(srv, 'ffa', 1);
    await setIp(room, ps[1], 'P2', '192.168.10.77');
    await setIp(room, ps[2], 'P3', '192.168.10.88');
    assert.equal(room.match.scopes.P2.run.s.state.ip, '192.168.10.77');
    give(items, 'P1', 'configErase');
    const hit = ps[1].next('item:notice', (n) => n.kind === 'hit');
    const res = await ps[0].send('item:use', { slot: 1, target: 'P2', requestId: rid() });
    assert.deepEqual([res.ok, res.outcome], [true, 'applied']);
    const p2 = room.match.scopes.P2.run.s.state;
    assert.ok(p2.ip === null || p2.mask === null, 'one configured key is back to its default');
    assert.equal(room.match.scopes.P3.run.s.state.ip, '192.168.10.88', 'only the chosen opponent is affected');
    assert.equal(inv(items, 'P1').length, 0, 'the item is consumed');
    assert.match((await hit).text, /Config Erase/);
  } finally { await srv.close(); }
});

test('invalid targets and stages without attackable config are rejected without losing the item', async () => {
  const srv = await startServer();
  try {
    const { ps, items } = await match(srv, 'ffa', 1);
    give(items, 'P1', 'configErase');
    for (const target of ['P1', 'P9', undefined, 'T2']) {
      const res = await ps[0].send('item:use', { slot: 1, target, requestId: rid() });
      assert.equal(res.ok, false, `target ${target} must be rejected`);
    }
    assert.deepEqual(inv(items, 'P1'), ['configErase']);
    const empty = await ps[0].send('item:use', { slot: 3, target: 'P2', requestId: rid() });
    assert.equal(empty.ok, false);
  } finally { await srv.close(); }

  const srv2 = await startServer();
  try {
    const { ps, items } = await match(srv2, 'ffa', 7);
    give(items, 'P1', 'configGlitch');
    const res = await ps[0].send('item:use', { slot: 1, target: 'P2', requestId: rid() });
    assert.equal(res.ok, false);
    assert.match(res.error, /ไม่มีค่าคอนฟิกที่โจมตีได้/);
    assert.deepEqual(inv(items, 'P1'), ['configGlitch'], 'rejected on a stage without config keys, item kept');
  } finally { await srv2.close(); }
});

test('Shield blocks one attack; Reflect sends it back to the attacker once', async () => {
  const srv = await startServer();
  try {
    const { ps, room, items } = await match(srv, 'ffa', 1);
    await setIp(room, ps[0], 'P1', '192.168.10.11');
    await setIp(room, ps[1], 'P2', '192.168.10.22');
    await setIp(room, ps[2], 'P3', '192.168.10.33');

    give(items, 'P2', 'shield');
    assert.equal((await ps[1].send('item:use', { slot: 1, requestId: rid() })).outcome, 'defense');
    give(items, 'P1', 'configErase', 'configErase');
    const blocked = await ps[0].send('item:use', { slot: 1, target: 'P2', requestId: rid() });
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(room.match.scopes.P2.run.s.state.ip, '192.168.10.22', 'shielded state unchanged');
    const second = await ps[0].send('item:use', { slot: 1, target: 'P2', requestId: rid() });
    assert.equal(second.outcome, 'applied', 'Shield is spent after one block');

    give(items, 'P3', 'reflect');
    await ps[2].send('item:use', { slot: 1, requestId: rid() });
    give(items, 'P1', 'configErase');
    const p1hit = ps[0].next('item:notice', (n) => n.kind === 'hit');
    const reflected = await ps[0].send('item:use', { slot: 1, target: 'P3', requestId: rid() });
    assert.equal(reflected.outcome, 'reflected');
    assert.equal(room.match.scopes.P3.run.s.state.ip, '192.168.10.33', 'reflector unharmed');
    const p1 = room.match.scopes.P1.run.s.state;
    assert.ok(p1.ip === null || p1.mask === null, 'attacker receives its own erase');
    assert.match((await p1hit).text, /สะท้อน/);
  } finally { await srv.close(); }
});

test('Config Glitch breaks one value for ~2 s and then restores it', async () => {
  const srv = await startServer();
  try {
    const { ps, room, items } = await match(srv, 'ffa', 3);
    const run = room.match.scopes.P2.run;
    const st = room.match.level.stations.A[0];
    Object.assign(room.seats.P2, { x: st.x, y: st.y });
    await ps[1].send('player:interact', { open: true, role: 'A' });
    await ps[1].send('term:exec', { line: `set gateway ${run.s.truth.gateway}` });
    const fixed = run.s.state.gateway;
    assert.notEqual(fixed, run.initialConfig.gateway);
    give(items, 'P1', 'configGlitch');
    assert.equal((await ps[0].send('item:use', { slot: 1, target: 'P2', requestId: rid() })).outcome, 'applied');
    assert.equal(run.s.state.gateway, run.initialConfig.gateway, 'glitched back to the broken default');
    await tick(60);
    assert.equal(ps[1].last['room:state'].match.scopes.P2.disrupted, true, 'HUD shows a generic disrupted flag');
    await ps[1].next('item:notice', (n) => n.kind === 'glitch-end', 4000);
    assert.equal(run.s.state.gateway, fixed, 'value restored after the glitch');
  } finally { await srv.close(); }
});

test('2v2: attacks target the opposing team only and hit the shared team state', async () => {
  const srv = await startServer();
  try {
    const { ps, room, items } = await match(srv, 'team', 1, ['T1', 'T1', 'T2', 'T2']);
    await setIp(room, ps[2], 'P3', '192.168.10.55');
    give(items, 'T1', 'configErase');
    for (const target of ['T1', 'P3', 'P2']) {
      assert.equal((await ps[1].send('item:use', { slot: 1, target, requestId: rid() })).ok, false, `${target} is not a valid 2v2 target`);
    }
    assert.deepEqual(inv(items, 'T1'), ['configErase']);
    const hits = [ps[2], ps[3]].map((p) => p.next('item:notice', (n) => n.kind === 'hit'));
    const res = await ps[1].send('item:use', { slot: 1, target: 'T2', requestId: rid() });
    assert.equal(res.outcome, 'applied');
    const t2 = room.match.scopes.T2.run.s.state;
    assert.ok(t2.ip === null || t2.mask === null);
    await Promise.all(hits);
    assert.equal(inv(items, 'T1').length, 0, 'teammates share one inventory');
  } finally { await srv.close(); }
});

test('reconnect gets the same inventory back without duplicating items or drops', async () => {
  const srv = await startServer();
  try {
    const { ps, code, items } = await match(srv, 'ffa', 1);
    give(items, 'P2', 'shield', 'reflect');
    items.drops.set('d1', { id: 'd1', item: 'configErase', x: 500, y: 400, expiresAt: Date.now() + 10_000 });
    ps[1].disconnect();
    await tick(60);
    const back = await srv.client(ps[1].playerId);
    const state = back.next('item:state');
    await back.send('room:join', { code, name: 'P2', playerId: ps[1].playerId });
    const snap = await state;
    assert.deepEqual(snap.inventory.map((i) => i.item), ['shield', 'reflect']);
    assert.equal(snap.drops.length, 1);
    assert.equal(items.inventories.size, 1);
    assert.equal(items.drops.size, 1);
  } finally { await srv.close(); }
});

test('items are refused outside competitive play', async () => {
  const srv = await startServer();
  try {
    const a = await srv.client('coop-item');
    await a.send('room:create', { name: 'A', playerId: 'coop-item' });
    assert.equal((await a.send('item:use', { slot: 1, target: 'B', requestId: rid() })).ok, false);
  } finally { await srv.close(); }
  for (const s of SEATS) assert.ok(s);
});
