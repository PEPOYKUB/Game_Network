// Only the most recently joined socket of a player may act for them; an older socket that is
// still connected loses its identity and stops receiving room broadcasts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tick } from './helpers/socket-harness.js';
import { inspectRoom } from '../server/game/rooms.js';

test('co-op: a stale socket of a reconnected player can no longer act or listen', async () => {
  const srv = await startServer();
  try {
    const a = await srv.client('stale-a');
    const b = await srv.client('stale-b');
    const { code } = await a.send('room:create', { name: 'A', playerId: 'stale-a' });
    await b.send('room:join', { code, name: 'B', playerId: 'stale-b' });
    const replaced = a.next('session:replaced');
    const a2 = await srv.client('stale-a');
    assert.equal((await a2.send('room:join', { code, name: 'A', playerId: 'stale-a' })).role, 'A');
    await replaced;
    assert.equal(inspectRoom(code).slots.A.socketId, a2.socket.id);

    a.fire('lobby:ready', { ready: true });
    a.fire('chat:send', { text: 'from stale tab' });
    await tick(60);
    assert.equal(inspectRoom(code).slots.A.ready, false, 'stale socket must not change state');
    assert.ok(!b.log.some((e) => e.event === 'chat:msg' && e.payload.text === 'from stale tab'));

    const before = a.log.length;
    b.fire('chat:send', { text: 'hello' });
    await tick(60);
    assert.ok(!a.log.slice(before).some((e) => e.event === 'chat:msg'), 'stale socket must not receive room broadcasts');
    assert.ok(a2.log.some((e) => e.event === 'chat:msg' && e.payload.text === 'hello'));

    a.disconnect();
    await tick(60);
    assert.equal(inspectRoom(code).slots.A.connected, true, 'closing the stale socket must not mark the player offline');
  } finally { await srv.close(); }
});

test('FFA: a stale socket cannot play, use the terminal or quit for the player', async () => {
  const srv = await startServer();
  try {
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await srv.client(`s${i}`));
    const { code } = await ps[0].send('room:create', { name: 'P1', playerId: 's0', mode: 'ffa', sample: true });
    for (let i = 1; i < 4; i++) await ps[i].send('room:join', { code, name: `P${i + 1}`, playerId: `s${i}` });
    for (const p of ps) p.fire('lobby:ready', { ready: true });
    await tick(150);
    await ps[0].send('lobby:start');
    await ps[0].send('stage:start', { stageId: 1 });

    const fresh = await srv.client('s1');
    assert.equal((await fresh.send('room:join', { code, name: 'P2', playerId: 's1' })).seat, 'P2');
    const stale = ps[1];
    const run = inspectRoom(code).match.scopes.P2.run;
    const exec = await stale.send('term:exec', { line: 'ipconfig' });
    assert.ok(!exec.lines.some((l) => l.c === 'ok' || l.c === 'out'), JSON.stringify(exec));
    assert.equal(run.commands, 0, 'stale socket must not run commands');
    stale.fire('stage:quit');
    await tick(60);
    assert.equal(inspectRoom(code).seats.P2.quit, false, 'stale socket must not forfeit the player');
    const interact = await stale.send('player:interact', { open: true });
    assert.equal(interact.ok, false);
    stale.disconnect();
    await tick(60);
    assert.equal(inspectRoom(code).seats.P2.connected, true);
  } finally { await srv.close(); }
});
