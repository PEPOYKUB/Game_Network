// A "run" is one attempt at one stage: scenario (with server-only ground truth), counters and logs.
import { getStage } from './stages/index.js';
import { makeRng } from './netutil.js';
import { COMMANDS, parse, helpLines, err, dim } from './terminal.js';

export const HINT_PENALTY = { 1: 5, 2: 10, 3: 15 };

export function startRun(stageId, { sample = false, seed = Date.now() } = {}) {
  const stage = getStage(stageId);
  if (!stage) throw new Error(`unknown stage ${stageId}`);
  const s = stage.generate(makeRng(seed), sample);
  return {
    stage,
    s,
    startedAt: Date.now(),
    completedAt: null,
    commands: 0,
    wrong: 0,
    hints: [],
    commandLog: [],
    scoreEvents: [],
    passed: false,
    result: null,
  };
}

function context(run, role, parsed) {
  return {
    s: run.s,
    role,
    args: parsed?.args || [],
    raw: parsed?.raw || '',
    wrong(detail) {
      run.wrong += 1;
      run.scoreEvents.push({ type: 'wrong_config', role, detail, at: Date.now() });
    },
    pass() {
      run.passed = true;
    },
  };
}

function summarize(lines) {
  const last = [...lines].reverse().find((l) => l.t && l.c !== 'dim');
  return last ? `${last.c}: ${last.t}`.slice(0, 120) : '';
}

/** Runs one terminal line for `role`. Returns { lines, counted, passedNow }. */
export function execute(run, role, input) {
  const def = run.stage.roles[role];
  const parsed = parse(input);
  if (parsed.empty) return { lines: [] };
  if (parsed.help !== undefined) return { lines: helpLines(parsed.help, def.commands) };
  if (parsed.unknown) return { lines: [err(`ไม่รู้จักคำสั่ง "${parsed.unknown}" — พิมพ์ /help เพื่อดูคำสั่งที่ใช้ได้`)] };
  if (!def.commands.includes(parsed.name)) {
    return { lines: [err(`คำสั่ง "${parsed.name}" ใช้ไม่ได้ในห้อง ${role} ด่านนี้ — อุปกรณ์ในห้องคุณไม่รองรับ (ดู /help)`)] };
  }
  const wasPassed = run.passed;
  const counted = !run.result;
  if (counted) {
    run.commands += 1;
    run.scoreEvents.push({ type: 'command_used', role, detail: parsed.name, at: Date.now() });
  }
  let lines;
  try {
    lines = run.stage.handlers[parsed.name](context(run, role, parsed));
  } catch (error) {
    console.error('[engine] handler failed', run.stage.id, parsed.raw, error);
    lines = [err('ระบบจำลองเกิดข้อผิดพลาดภายใน ลองใหม่อีกครั้ง')];
  }
  if (run.result) lines.push(dim('(ด่านนี้ผ่านแล้ว — คำสั่งหลังจากนี้ไม่นับคะแนน)'));
  run.commandLog.push({ role, command: parsed.raw, at: Date.now(), result: summarize(lines) });
  return { lines, counted, kind: COMMANDS[parsed.name].kind, passedNow: !wasPassed && run.passed };
}

export function submitForm(run, role, data) {
  const form = run.stage.form;
  if (!form || form.role !== role) return { ok: false, message: 'ห้องของคุณไม่มีแบบฟอร์มในด่านนี้' };
  if (run.result) return { ok: true, message: 'ด่านนี้ผ่านแล้ว' };
  const wasPassed = run.passed;
  const res = form.submit(context(run, role, null), data && typeof data === 'object' ? data : {});
  run.commandLog.push({ role, command: `[form] ${JSON.stringify(data).slice(0, 100)}`, at: Date.now(), result: res.message });
  return { ...res, passedNow: !wasPassed && run.passed };
}

export function revealHint(run, level) {
  if (level !== run.hints.length + 1 || !HINT_PENALTY[level]) return { error: 'ต้องเปิดคำใบ้ตามลำดับ 1 → 2 → 3' };
  if (run.result) return { error: 'ด่านนี้ผ่านแล้ว' };
  const text = run.stage.hints(run.s)[level - 1];
  const hint = { level, text, penalty: HINT_PENALTY[level] };
  run.hints.push(hint);
  run.scoreEvents.push({ type: 'hint_used', detail: String(level), value: -hint.penalty, at: Date.now() });
  return { hint };
}

/** What one room is allowed to see. Ground truth never leaves the server. */
export function roleView(run, role) {
  const def = run.stage.roles[role];
  const s = run.s;
  return {
    stageId: run.stage.id,
    role,
    device: def.device(s),
    commands: def.commands.map((name) => ({ name, usage: COMMANDS[name].usage, desc: COMMANDS[name].desc, kind: COMMANDS[name].kind })),
    hosts: def.hosts(s),
    see: def.see,
    do: def.do,
    docs: def.docs(s),
    form: def.form ? def.form(s) : null,
  };
}

export function publicRun(run) {
  const { stage } = run;
  return {
    stageId: stage.id,
    meta: {
      id: stage.id,
      title: stage.title,
      topic: stage.topic,
      tier: stage.tier,
      difficulty: stage.difficulty,
      minutes: stage.minutes,
      optimal: stage.optimal,
      story: stage.story,
      objective: stage.objective,
      coop: stage.coop,
    },
    startedAt: run.startedAt,
    commands: run.commands,
    hints: run.hints,
    link: run.passed ? 'ONLINE' : 'OFFLINE',
    result: run.result,
  };
}
