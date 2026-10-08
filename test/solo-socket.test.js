// Solo practice over real Socket.IO: one player, both rooms' computers, all 12 stages,
// retry / leave, no time limit, no second player, reload, and nothing secret on the wire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tick } from './helpers/socket-harness.js';
import { inspectRoom, configureRooms } from '../server/game/rooms.js';
import { configureModes, MODE_CONFIG } from '../server/game/competitive.js';
import { levelForStage } from '../public/js/world.js';
import { topTeams } from '../server/game/leaderboard.js';

const DEFAULTS = { ...MODE_CONFIG };
test.afterEach(() => { configureModes(DEFAULTS); configureRooms({ coopStageMs: null }); });

// Same canonical solutions as test/stages.test.js: [role, command] or [role, { form }].
const SOLUTIONS = {
  1: ({ truth }) => [['A', `set ip ${truth.ip} ${truth.mask}`], ['A', 'ipconfig']],
  2: ({ truth }) => [['A', `set ip ${truth.ip} ${truth.mask}`], ['A', 'ipconfig']],
  3: ({ truth }) => [['A', 'ipconfig'], ['A', `set gateway ${truth.gateway}`], ['A', 'ping gateway']],
  4: ({ truth }) => [['A', 'arp -a'], ['A', { form: truth.map }]],
  5: ({ truth }) => [['A', 'show mac-address-table'], ['A', `disconnect port ${truth.rogue}`], ['A', 'show mac-address-table']],
  6: ({ truth, state }) => [
    ['A', 'show vlan'],
    ...Object.entries(truth.vlan).filter(([p, v]) => state.vlan[p] !== v).map(([p, v]) => ['A', `set vlan ${p} ${v}`]),
    ['A', `ping ${truth.swapped[0]}`],
  ],
  7: ({ truth, meta }) => [['A', `traceroute ${meta.topo.server}`], ['B', 'route print'], ['B', { form: Object.fromEntries(truth.path.map((r, i) => [`hop${i + 1}`, r])) }]],
  8: ({ truth, meta }) => [['A', `ping ${meta.server}`], ['B', 'route print'], ['B', `add route ${truth.net} 255.255.255.0 ${truth.via}`], ['A', `ping ${meta.server}`]],
  9: ({ truth }) => [['A', `nslookup ${truth.name}`], ['B', 'show dns-zone'], ['B', `set dns-record ${truth.name} ${truth.ip}`], ['A', `nslookup ${truth.name}`], ['A', `ping ${truth.name}`]],
  10: ({ truth }) => [['A', 'capture'], ['A', { form: { packet: `#${truth.packet}` } }]],
  11: ({ truth, meta }) => [['A', `ping ${meta.file}`], ['B', 'show acl'], ['B', `remove acl-rule ${truth.rule}`], ['A', `ping ${meta.file}`]],
  12: ({ truth, meta }) => [
    ['A', 'ipconfig'],
    ['B', 'show dhcp-scope'],
    ['B', 'show acl'],
    ['B', `enable dhcp-scope ${truth.vlan}`],
    ['B', `allow port tcp ${truth.port} from ${truth.src} to ${truth.dst}`],
    ['A', 'ipconfig /renew'],
    ['A', 'use PC-Fin02'],
    ['A', `ping ${meta.file} -p ${truth.port}`],
  ],
};

async function soloRoom(srv, id = 'solo-1', options = {}) {
  const p = await srv.client(id);
  const created = await p.send('room:create', { name: 'Solo', playerId: id, mode: 'solo', ...options });
  assert.equal(created.ok, true, created.error);
  assert.deepEqual([created.seat, created.mode], ['P1', 'solo']);
  return { p, code: created.code };
}

/** Stand at the computer of `side` (movement itself is covered by world tests) and open it. */
async function useComputer(p, code, side) {
  const room = inspectRoom(code);
  const seat = room.seats.P1;
  if (seat.station === side && seat.terminal) return;
  if (seat.terminal) await p.send('player:interact', { open: false });
  const st = levelForStage(room.run.stage.id).stations[side][0];
  Object.assign(seat, { x: st.x, y: st.y });
  const res = await p.send('player:interact', { open: true, role: side });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.role, side);
}

test('solo: one player starts without anyone else and without pressing ready', async () => {
  const srv = await startServer();
  try {
    const { p, code } = await soloRoom(srv);
    await tick(60);
    const lobby = p.last['room:state'];
    assert.equal(lobby.mode, 'solo');
    assert.equal(lobby.phase, 'lobby');
    assert.deepEqual(Object.keys(lobby.players), ['P1']);
    assert.equal(lobby.match, null);
    p.fire('lobby:character', { charId: 'router' });
    await tick(60);
    assert.equal(inspectRoom(code).seats.P1.charId, 'router');
    assert.equal((await p.send('lobby:start')).ok, true);
    assert.equal(inspectRoom(code).phase, 'select');
    assert.equal((await p.send('stage:start', { stageId: 2 })).ok, false, 'stages unlock in order');
    assert.equal((await p.send('stage:start', { stageId: 1 })).ok, true);
    assert.equal(inspectRoom(code).phase, 'play');
  } finally { await srv.close(); }
});

test('solo: commands follow the computer actually opened (A or B), chosen by position', async () => {
  const srv = await startServer();
  try {
    const { p, code } = await soloRoom(srv, 'solo-ab', { unlockAll: true });
    await p.send('lobby:start');
    await p.send('stage:start', { stageId: 7 });
    const closed = await p.send('term:exec', { line: 'route print' });
    assert.match(closed.lines[0].t, /กด E/);
    assert.equal((await p.send('player:interact', { open: true })).ok, false, 'must stand near a computer');

    await useComputer(p, code, 'A');
    const asA = await p.send('term:exec', { line: 'route print' });
    assert.match(asA.lines[0].t, /ใช้ไม่ได้ในห้อง A/);
    const spoofB = await p.send('term:exec', { line: 'route print', role: 'B' });
    assert.match(spoofB.lines[0].t, /ฝั่ง A/, 'a client cannot claim the other side');
    assert.equal((await p.send('stage:role', { role: 'B' })).ok, false, 'switching sides needs the B computer');

    await useComputer(p, code, 'B');
    const asB = await p.send('term:exec', { line: 'route print' });
    assert.ok(!/ใช้ไม่ได้/.test(asB.lines[0].t), JSON.stringify(asB.lines[0]));
    const view = p.last['stage:view'];
    assert.equal(view.role, 'B', 'the B view (docs, hosts, form) is sent when the B computer is open');
  } finally { await srv.close(); }
});

test('solo: one player clears all 12 stages in order, including the two-role stages', async () => {
  const srv = await startServer();
  try {
    const { p, code } = await soloRoom(srv, 'solo-all', { sample: false });
    await p.send('lobby:start');
    for (let id = 1; id <= 12; id++) {
      const started = await p.send('stage:start', { stageId: id });
      assert.equal(started.ok, true, `stage ${id}: ${started.error}`);
      const room = inspectRoom(code);
      const done = p.next('stage:complete', (c) => c.stageId === id, 3000);
      for (const [role, step] of SOLUTIONS[id](room.run.s)) {
        await useComputer(p, code, role);
        if (typeof step === 'string') {
          const out = await p.send('term:exec', { line: step });
          assert.ok(!/เร็วเกินไป/.test(out.lines[0]?.t || ''), 'paced below the server rate limit');
          await tick(220); // stay under the server's 10-commands-per-2s limit
        }
        else {
          const res = await p.send('form:submit', { data: step.form });
          assert.equal(res.ok, true, `stage ${id} form: ${res.message}`);
        }
      }
      const complete = await done.catch((e) => { throw new Error(`stage ${id}: ${e.message} · last output ${JSON.stringify(p.log.filter((x) => x.event === 'room:state').slice(-1)[0]?.payload.run?.link)}`); });
      assert.equal(complete.result.practice, true);
      assert.ok(inspectRoom(code).progress.cleared[id], `stage ${id} is recorded as cleared for this session`);
    }
    const state = p.last['room:state'];
    assert.equal(Object.keys(state.progress.cleared).length, 12);
    assert.ok(!JSON.stringify(p.log).includes('"truth"'), 'ground truth never reaches the client');
    assert.ok(!topTeams(200).some((t) => t.id === inspectRoom(code).id), 'practice results stay off the leaderboard');
  } finally { await srv.close(); }
});

test('solo: retry and leave work at any time, and there is no competitive or co-op time limit', async () => {
  configureModes({ matchDurationMs: 100, briefingMs: 0 });
  configureRooms({ coopStageMs: 100 });
  const srv = await startServer();
  try {
    const { p, code } = await soloRoom(srv, 'solo-retry', { sample: true });
    await p.send('lobby:start');
    await p.send('stage:start', { stageId: 1 });
    const first = inspectRoom(code).run;
    await tick(300);
    const room = inspectRoom(code);
    assert.equal(room.phase, 'play', 'still playing well after both short timers would have fired');
    assert.equal(room.run.result, null);
    assert.equal(room.match, undefined);
    assert.equal(p.last['room:state'].match, null);

    await useComputer(p, code, 'A');
    await p.send('term:exec', { line: 'set ip 192.168.10.99 255.255.255.0' });
    const retry = await p.send('stage:retry', {});
    assert.equal(retry.ok, true);
    assert.notEqual(inspectRoom(code).run, first, 'a fresh run');
    assert.equal(inspectRoom(code).run.s.state.ip, null, 'retry resets the network state');
    assert.equal(inspectRoom(code).seats.P1.terminal, false);

    const quit = await p.send('stage:quit', {});
    assert.deepEqual([quit.ok, quit.waiting], [true, false], 'no vote needed with one player');
    assert.equal(inspectRoom(code).phase, 'select');
    assert.equal(inspectRoom(code).run, null);
  } finally { await srv.close(); }
});

test('solo: a second player cannot join, and items, chat and voice are refused', async () => {
  const srv = await startServer();
  try {
    const { p, code } = await soloRoom(srv, 'solo-owner');
    const other = await srv.client('intruder');
    const res = await other.send('room:join', { code, name: 'X', playerId: 'intruder' });
    assert.equal(res.ok, false);
    assert.match(res.error, /ฝึกเล่นคนเดียว/);
    assert.equal(Object.keys(inspectRoom(code).seats).length, 1);

    await p.send('lobby:start');
    await p.send('stage:start', { stageId: 1 });
    assert.equal((await p.send('item:use', { slot: 1, target: 'P2', requestId: 'r1' })).ok, false);
    assert.equal((await p.send('item:pickup', { dropId: 'x', requestId: 'r2' })).ok, false);
    assert.equal((await p.send('voice:settings', { active: true, micEnabled: true })).ok, false);
    p.fire('chat:send', { text: 'hello?' });
    await tick(60);
    assert.ok(!p.log.some((e) => e.event === 'chat:msg' && e.payload.text === 'hello?'));
    assert.ok(!p.log.some((e) => e.event === 'item:state'), 'no item system in practice');
  } finally { await srv.close(); }
});

test('solo: reloading the page returns to the same run; a stale socket loses control', async () => {
  const srv = await startServer();
  try {
    const { p, code } = await soloRoom(srv, 'solo-reload', { sample: true });
    await p.send('lobby:start');
    await p.send('stage:start', { stageId: 1 });
    await useComputer(p, code, 'A');
    await p.send('term:exec', { line: 'set ip 192.168.10.50 255.255.255.0' });
    const run = inspectRoom(code).run;

    const again = await srv.client('solo-reload');
    const view = again.next('stage:view');
    const res = await again.send('room:join', { code, name: 'Solo', playerId: 'solo-reload' });
    assert.deepEqual([res.ok, res.seat, res.mode], [true, 'P1', 'solo']);
    assert.equal((await view).role, 'A');
    assert.equal(inspectRoom(code).run, run, 'same run, nothing restarted');
    assert.equal(inspectRoom(code).run.s.state.ip, '192.168.10.50');

    const stale = await p.send('term:exec', { line: 'ipconfig' });
    assert.ok(!stale.lines.some((l) => l.c === 'ok' || l.c === 'out'), 'the old tab cannot act any more');
    p.disconnect();
    await tick(60);
    assert.equal(inspectRoom(code).seats.P1.connected, true, 'closing the old tab does not drop the session');
  } finally { await srv.close(); }
});
