import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES } from '../server/game/stages/index.js';
import { startRun, execute, submitForm, roleView, revealHint } from '../server/game/engine.js';
import { scoreRun } from '../server/game/scoring.js';

// Canonical solutions: [role, command] or [role, { form }]. Built from the server-side truth.
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

function play(run, steps) {
  const outputs = [];
  for (const [role, step] of steps) {
    if (typeof step === 'string') {
      const res = execute(run, role, step);
      outputs.push(...res.lines);
    } else {
      outputs.push({ t: submitForm(run, role, step.form).message, c: 'out' });
    }
  }
  return outputs;
}

function assertCleanLines(lines, label) {
  for (const l of lines) {
    assert.equal(typeof l.t, 'string', `${label}: line text must be a string`);
    assert.ok(!/undefined|NaN|\[object/.test(l.t), `${label}: suspicious output "${l.t}"`);
  }
}

for (const stage of STAGES) {
  test(`stage ${stage.id} (${stage.title}) is solvable with sample data and random seeds`, () => {
    const seeds = [0, ...Array.from({ length: 40 }, (_, i) => 1000 + i * 7919)];
    for (const seed of seeds) {
      const sample = seed === 0;
      const run = startRun(stage.id, { sample, seed: seed || 1 });
      const label = `stage ${stage.id} seed ${seed}`;
      for (const role of ['A', 'B']) {
        const view = JSON.stringify(roleView(run, role));
        assert.ok(!view.includes('"truth"'), `${label}: view must not expose truth`);
        assert.ok(!/undefined|NaN/.test(view), `${label}: view for ${role} has undefined/NaN`);
      }
      const lines = play(run, SOLUTIONS[stage.id](run.s));
      assertCleanLines(lines, label);
      assert.equal(run.passed, true, `${label}: canonical solution should pass`);
      assert.equal(run.wrong, 0, `${label}: canonical solution should not count wrong configs`);
    }
  });

  test(`stage ${stage.id} does not pass on diagnostics alone`, () => {
    const run = startRun(stage.id, { seed: 42 });
    const diag = stage.roles.A.commands.filter((c) => !['set ip', 'set gateway', 'disconnect port', 'set vlan'].includes(c));
    for (const c of diag) execute(run, 'A', c === 'ping' || c === 'traceroute' || c === 'nslookup' ? `${c} 10.0.0.1` : c);
    assert.equal(run.passed, false);
  });

  test(`stage ${stage.id} has three hints and a scored result`, () => {
    const run = startRun(stage.id, { seed: 7 });
    const hints = stage.hints(run.s);
    assert.equal(hints.length, 3);
    hints.forEach((h) => assert.ok(h && !h.includes('undefined')));
    assert.ok(revealHint(run, 2).error, 'hints must be revealed in order');
    assert.ok(revealHint(run, 1).hint);
    play(run, SOLUTIONS[stage.id](run.s));
    run.completedAt = run.startedAt + 30_000;
    const score = scoreRun(run);
    assert.equal(score.hintPenalty, -5);
    assert.ok(score.total >= 10 && score.total <= 170);
    assert.ok(!stage.explanation(run.s).includes('undefined'));
  });
}

test('commands outside the room are refused and not counted', () => {
  const run = startRun(1, { seed: 3 });
  const res = execute(run, 'B', 'set ip 10.0.0.5 255.255.255.0');
  assert.match(res.lines[0].t, /ใช้ไม่ได้/);
  assert.equal(run.commands, 0);
  assert.match(execute(run, 'A', 'foobar').lines[0].t, /ไม่รู้จักคำสั่ง/);
  assert.ok(execute(run, 'A', '/help').lines.length > 3);
  assert.ok(execute(run, 'A', '/help routing').lines.length > 1);
});

test('wrong configuration is counted and verification fails', () => {
  const run = startRun(3, { seed: 11 });
  execute(run, 'A', `set gateway ${run.s.meta.wrongGw === run.s.meta.printer ? run.s.meta.nas : run.s.meta.printer}`);
  execute(run, 'A', 'ping server01');
  assert.equal(run.wrong, 1);
  assert.equal(run.passed, false);
});

test('stage 12 needs both faults fixed and verified', () => {
  const run = startRun(12, { seed: 5 });
  const { truth, meta } = run.s;
  execute(run, 'B', `enable dhcp-scope ${truth.vlan}`);
  execute(run, 'A', 'ipconfig /renew');
  assert.equal(run.passed, false, 'DHCP alone must not pass');
  execute(run, 'A', 'use PC-Fin02');
  execute(run, 'A', `ping ${meta.file} -p ${truth.port}`);
  assert.equal(run.passed, false, 'port still blocked');
  execute(run, 'B', `allow port tcp ${truth.port} from ${truth.src} to ${truth.dst}`);
  execute(run, 'A', `ping ${meta.file} -p ${truth.port}`);
  assert.equal(run.passed, true);
  assert.equal(stageById(12).finalCode(run.s), `INCIDENT-CLEAR-${truth.port}-${truth.vlan}`);
});

function stageById(id) {
  return STAGES.find((s) => s.id === id);
}
