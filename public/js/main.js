import { $, $$, el, fill, toast, openModal, closeModal, confirmBox, fmtTime, storage, wait } from './ui.js';
import { socket, send, fire } from './net.js';
import { settings, setSetting, unlockAudio, sfx } from './audio.js';
import { startSky } from './sky.js';
import { loadSprites, characters, paintChar, charName, iconUrl } from './sprites.js';
import { Diorama } from './diorama.js';
import { Terminal } from './terminal.js';
import { renderDocs, renderMission, renderForm } from './docs.js';
import { renderConfetti } from './confetti.js';

// Team contact shown in Settings (wireframe 1.2.3). Leave url empty to show the label only.
const CONTACT = { label: 'Facebook · KUHU NET', url: '' };
const ROLE_TEXT = {
  A: 'ห้อง A — ส่วนใหญ่คุมเทอร์มินัลของเครื่องที่มีปัญหา เห็นอาการจริงของระบบ',
  B: 'ห้อง B — ส่วนใหญ่ถือเอกสาร ผัง และค่าที่ควรเป็น (บางด่านคุมเราเตอร์/เซิร์ฟเวอร์)',
};
const QUICK = ['👍 โอเค', '❓ ช่วยอ่านค่าให้หน่อย', '⏳ รอแป๊บ', '✅ แก้แล้ว ลองทดสอบดู'];

const session = storage('session');
const local = storage('local');
const newId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const S = {
  screen: 'cover',
  loaded: false,
  playerId: session.get('kuhu.player') || newId(),
  code: session.get('kuhu.code'),
  you: null,
  room: null,
  view: null,
  catalog: null,
  board: [],
  offset: 0,
  dio: null,
  term: null,
  formJson: '',
  stageKey: '',
  clearShown: '',
  typingSent: 0,
};
session.set('kuhu.player', S.playerId);

// ---------------------------------------------------------------- screens
function show(name) {
  S.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  $('#sky').hidden = name === 'cover';
  if (name === 'game') setTimeout(() => $('#term-input').focus(), 50);
}

function route() {
  if (!S.loaded || !S.room) return;
  const phase = S.room.phase;
  if (phase === 'lobby') {
    show('room');
    renderRoom();
  } else if (phase === 'select') {
    closeModal('modal-clear');
    show('select');
    renderSelect();
  } else if (phase === 'play') {
    show('game');
    renderGame();
  }
}

// ---------------------------------------------------------------- cover
function initCover() {
  $$('.sprite-btn').forEach((b) => b.addEventListener('mouseenter', () => sfx.hover()));
  $('#cover-start').onclick = () => {
    unlockAudio();
    sfx.start();
    boot();
  };
  $('#cover-settings').onclick = () => {
    unlockAudio();
    sfx.click();
    openSettings();
  };
  $('#cover-howto').onclick = () => {
    unlockAudio();
    sfx.click();
    openModal('modal-howto');
  };
}

// ---------------------------------------------------------------- loading (wireframe 2)
async function boot() {
  if (S.loaded) {
    if (S.room) route();
    else show('lobby');
    return;
  }
  show('loading');
  const started = performance.now();
  const fill = $('#loading-fill');
  const runner = $('#loading-runner');
  const setProgress = (p) => {
    fill.style.width = `calc(${Math.round(p * 100)}% - 6px)`;
    runner.style.left = `calc(${Math.round(p * 100)}% - 34px)`;
  };
  const word = 'LOADING...';
  let i = 0;
  const typer = setInterval(() => {
    i = (i + 1) % (word.length + 4);
    $('#loading-type').textContent = word.slice(0, Math.min(i, word.length));
  }, 140);
  let frame = 0;
  const runnerAnim = setInterval(() => {
    if (characters().length) paintChar(runner, 'ping', (frame += 1));
  }, 160);
  const sub = (t) => ($('#loading-sub').textContent = t);
  setProgress(0.05);
  sub('กำลังโหลดตัวละคร...');
  await loadSprites((p) => setProgress(0.05 + p * 0.5));
  sub('กำลังโหลดฟอนต์...');
  await Promise.race([document.fonts?.ready, wait(2500)]);
  setProgress(0.7);
  sub('กำลังเชื่อมต่อเซิร์ฟเวอร์เกม...');
  if (!socket.connected) await Promise.race([new Promise((r) => socket.once('connect', r)), wait(5000)]);
  setProgress(0.9);
  await wait(Math.max(0, 1300 - (performance.now() - started)));
  setProgress(1);
  await wait(250);
  clearInterval(typer);
  clearInterval(runnerAnim);
  S.loaded = true;
  initGameComponents();
  if (!socket.connected) toast('ยังเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบว่าเปิด npm run dev แล้ว', true);
  if (S.code) {
    const res = await send('room:join', { code: S.code, name: local.get('kuhu.name'), playerId: S.playerId });
    if (res.ok) {
      S.you = res.role;
      return;
    }
    session.remove('kuhu.code');
    S.code = null;
  }
  show('lobby');
}

// ---------------------------------------------------------------- lobby (wireframe 3)
function initLobby() {
  const nameInput = $('#player-name');
  nameInput.value = local.get('kuhu.name') || `NODE_${String(Math.floor(Math.random() * 90) + 10)}`;
  const boxes = $$('#code-input input');
  boxes.forEach((box, idx) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(-1);
      if (box.value && boxes[idx + 1]) boxes[idx + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[idx - 1]) boxes[idx - 1].focus();
      if (e.key === 'Enter') $('#btn-join').click();
    });
    box.addEventListener('paste', (e) => {
      const digits = (e.clipboardData.getData('text').match(/\d/g) || []).slice(0, 4);
      if (!digits.length) return;
      e.preventDefault();
      boxes.forEach((b, j) => (b.value = digits[j] || ''));
      boxes[Math.min(3, digits.length)].focus();
    });
  });
  const name = () => {
    const n = nameInput.value.trim().slice(0, 16) || 'PLAYER';
    local.set('kuhu.name', n);
    return n;
  };
  const msg = (t) => ($('#lobby-msg').textContent = t || '');
  $('#btn-create').onclick = async () => {
    sfx.click();
    msg('');
    const res = await send('room:create', { name: name(), playerId: S.playerId, sample: $('#opt-sample').checked, unlockAll: $('#opt-unlock').checked });
    if (!res.ok) return msg(res.error);
    S.code = res.code;
    S.you = res.role;
    session.set('kuhu.code', res.code);
    return undefined;
  };
  $('#btn-join').onclick = async () => {
    sfx.click();
    const code = boxes.map((b) => b.value).join('');
    if (code.length !== 4) return msg('ใส่เลขห้องให้ครบ 4 หลัก');
    const res = await send('room:join', { code, name: name(), playerId: S.playerId });
    if (!res.ok) {
      sfx.err();
      return msg(res.error);
    }
    msg('');
    S.code = res.code;
    S.you = res.role;
    session.set('kuhu.code', res.code);
    return undefined;
  };
  $('#lobby-back').onclick = () => {
    sfx.click();
    show('cover');
  };
}

// ---------------------------------------------------------------- character select (wireframe 4)
let slotFrame = 0;
setInterval(() => {
  slotFrame += 1;
  $$('canvas[data-char]').forEach((c) => paintChar(c, c.dataset.char, c.dataset.walk === '1' ? slotFrame : 0));
}, 420);

function charCanvas(charId, walk = true, cls = '') {
  const c = el('canvas', { class: cls, dataset: { char: charId, walk: walk ? '1' : '0' } });
  paintChar(c, charId, 0);
  return c;
}

function renderRoom() {
  const room = S.room;
  $('#room-code').textContent = room.code;
  for (const role of ['A', 'B']) {
    const p = room.players[role];
    const slot = $(`#slot-${role}`);
    slot.className = `slot ${role} ${p ? '' : 'waiting'}`;
    const mine = role === S.you;
    const status = !p ? null : !p.connected ? ['away', 'หลุดการเชื่อมต่อ'] : p.ready ? ['on', 'พร้อม'] : ['', 'ไม่พร้อม'];
    const head = el('div', { class: 'slot-head' }, el('span', {}, `ห้อง ${role}${mine ? ' (คุณ)' : ''}`), status && el('span', { class: 'slot-status' }, el('i', { class: `dot ${status[0]}` }), status[1]));
    if (!p) {
      fill(slot, head, el('div', {}, 'รอผู้เล่นเข้าร่วม', el('span', { class: 'wait-dots' })), el('div', { class: 'slot-role' }, `ส่งเลขห้อง ${room.code} ให้เพื่อน`));
      continue;
    }
    const list = characters();
    const idx = Math.max(0, list.findIndex((c) => c.id === p.charId));
    const pick = (i) => {
      sfx.click();
      fire('lobby:character', { charId: list[(i + list.length) % list.length].id });
    };
    fill(slot, 
      head,
      charCanvas(p.charId),
      el('div', { class: 'slot-name' }, p.name),
      el('div', { class: 'slot-char' }, charName(p.charId)),
      el('div', { class: 'slot-role' }, ROLE_TEXT[role]),
      mine &&
        el(
          'div',
          { class: 'slot-controls' },
          el('button', { class: 'btn tiny ghost', onclick: () => pick(idx - 1), disabled: p.ready, 'aria-label': 'ตัวละครก่อนหน้า' }, '◀'),
          el('button', { class: 'btn tiny ghost', onclick: () => pick(Math.floor(Math.random() * list.length)), disabled: p.ready, title: 'สุ่มตัวละคร' }, '🎲 สุ่ม'),
          el('button', { class: 'btn tiny ghost', onclick: () => pick(idx + 1), disabled: p.ready, 'aria-label': 'ตัวละครถัดไป' }, '▶'),
          el('button', { class: `btn tiny ${p.ready ? 'yellow' : 'green'}`, onclick: () => { sfx.click(); fire('lobby:ready', { ready: !p.ready }); } }, p.ready ? 'ยกเลิกพร้อม' : 'พร้อม!'),
        ),
    );
  }
  const both = ['A', 'B'].every((r) => room.players[r]?.ready && room.players[r]?.connected);
  $('#room-start').disabled = !both;
  $('#room-msg').textContent = both ? '' : !room.players.A || !room.players.B ? 'รอผู้เล่นอีกคน...' : 'ทั้งสองคนต้องกด "พร้อม!" ก่อนเริ่ม';
}

function initRoom() {
  $('#copy-code').onclick = async () => {
    try {
      await navigator.clipboard.writeText(S.room?.code || '');
      toast('คัดลอกเลขห้องแล้ว');
    } catch {
      toast(`เลขห้อง: ${S.room?.code}`);
    }
  };
  $('#room-swap').onclick = () => {
    sfx.click();
    fire('lobby:swap');
  };
  $('#room-start').onclick = async () => {
    sfx.start();
    const res = await send('lobby:start');
    if (!res.ok && res.error) toast(res.error, true);
  };
  $('#room-leave').onclick = leaveRoom;
}

async function leaveRoom() {
  if (!(await confirmBox('ออกจากห้อง', 'ออกจากห้องนี้? ความคืบหน้าของทีมจะยังอยู่บน Leaderboard'))) return;
  fire('room:leave');
  session.remove('kuhu.code');
  S.code = null;
  S.room = null;
  show('lobby');
}

// ---------------------------------------------------------------- stage select (wireframe: stage list)
async function loadCatalog() {
  const res = await send('stage:catalog');
  if (res.stages) {
    S.catalog = res.stages;
    S.board = res.leaderboard || [];
  }
}

async function renderSelect() {
  if (!S.catalog || S.screen === 'select') await loadCatalog();
  if (!S.room || S.room.phase !== 'select') return;
  const room = S.room;
  const cleared = room.progress.cleared;
  const done = Object.keys(cleared).length;
  $('#select-sub').textContent = `ห้อง #${room.code} · ผ่านแล้ว ${done}/12${room.options.sample ? ' · ข้อมูลตัวอย่าง' : ''}`;
  fill($('#stage-list'), 
    ...S.catalog.map((st) => {
      const locked = st.id > room.progress.unlocked;
      const c = cleared[st.id];
      return el(
        'div',
        { class: `stage-row ${locked ? 'locked' : ''} ${c ? 'cleared' : ''}` },
        el('div', { class: 'stage-no' }, st.id),
        el(
          'div',
          { class: 'stage-info' },
          el('b', {}, st.title),
          el('small', {}, st.topic),
          el('div', { class: 'chips' }, el('span', { class: `chip tier-${st.tier}` }, st.tier), el('span', { class: 'chip' }, st.difficulty), el('span', { class: 'chip' }, `⏱ ${st.minutes} นาที`), c && el('span', { class: 'chip' }, `★ ${c.score} คะแนน · ${fmtTime(c.time)}`)),
        ),
        el('img', { class: 'stage-icon', src: iconUrl(st.icon, 4), alt: '' }),
        el('button', { class: 'play-btn', disabled: locked, title: locked ? 'ผ่านด่านก่อนหน้าก่อน' : `เล่นด่าน ${st.id}`, 'aria-label': locked ? `ด่าน ${st.id} ล็อก` : `เล่นด่าน ${st.id}`, onclick: () => startStage(st.id) }, locked ? '🔒' : '▶'),
      );
    }),
  );
  const total = Object.values(cleared).reduce((a, c) => a + c.score, 0);
  const time = Object.values(cleared).reduce((a, c) => a + c.time, 0);
  fill($('#team-box'), 
    ...['A', 'B'].map((r) => {
      const p = room.players[r];
      return el('div', { class: 'team-row' }, p && charCanvas(p.charId, false), el('div', {}, el('b', {}, p ? p.name : '(ว่าง)'), el('div', {}, el('i', { class: `dot ${p?.connected ? 'on' : 'away'}` }), ` ห้อง ${r}${r === S.you ? ' · คุณ' : ''}`)));
    }),
    el('div', { class: 'team-total' }, el('span', {}, `ผ่าน ${done}/12 ด่าน · ${fmtTime(time)}`), el('span', {}, `${total} คะแนน`)),
    room.progress.finalCode && el('div', { class: 'final-code', style: 'font-size:14px;margin-top:10px' }, room.progress.finalCode),
  );
  fill($('#board'), 
    ...(S.board.length
      ? S.board.map((b, i) => el('li', { class: b.mine ? 'mine' : '' }, el('span', { class: 'rank' }, i + 1), el('span', {}, b.team, el('small', {}, `${b.stages}/12 ด่าน · ${fmtTime(b.time)}${b.finalCode ? ' · 🏆' : ''}`)), el('b', {}, b.score)))
      : [el('li', { class: 'empty' }, 'ยังไม่มีทีมบนกระดาน — เป็นทีมแรกเลย!')]),
  );
}

async function startStage(id) {
  sfx.start();
  const res = await send('stage:start', { stageId: id });
  if (!res.ok && res.error) toast(res.error, true);
}

function initSelect() {
  $('#select-settings').onclick = openSettings;
  $('#select-howto').onclick = () => openModal('modal-howto');
  $('#select-leave').onclick = leaveRoom;
}

// ---------------------------------------------------------------- game
function initGameComponents() {
  S.dio = new Diorama($('#diorama'));
  S.term = new Terminal({
    root: $('#term'),
    out: $('#term-out'),
    input: $('#term-input'),
    prompt: $('#term-prompt'),
    suggest: $('#term-suggest'),
    chips: $('#term-chips'),
    form: $('#term-form'),
    onExec: (line) => send('term:exec', { line }),
    onTyping: () => {
      if (Date.now() - S.typingSent > 3000) {
        S.typingSent = Date.now();
        fire('activity', { kind: 'typing' });
        S.dio.activity(S.you, 'typing');
      }
    },
  });
}

function stageKey() {
  const run = S.room?.run;
  return run ? `${run.stageId}-${run.startedAt}` : '';
}

function setTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-mission').classList.toggle('hidden', name !== 'mission');
  $('#tab-docs').classList.toggle('hidden', name !== 'docs');
  $('#tab-report-body').classList.toggle('hidden', name !== 'report');
  if (name === 'docs') {
    fire('activity', { kind: 'docs' });
    S.dio?.activity(S.you, 'docs');
  }
}

function renderGame() {
  const room = S.room;
  const run = room.run;
  if (!run) return;
  const key = stageKey();
  const newStage = key !== S.stageKey;
  if (newStage) {
    S.stageKey = key;
    S.formJson = '';
    setTab('mission');
    closeModal('modal-clear');
    $('#dio-banner').classList.add('hidden');
  }
  const m = run.meta;
  $('#tb-num').textContent = `ด่าน ${m.id}/12`;
  $('#tb-title').textContent = m.title;
  $('#tb-tier').textContent = m.tier;
  $('#tb-tier').className = `chip tier-${m.tier}`;
  $('#tb-role').textContent = `คุณ = ห้อง ${S.you}`;
  $('#tb-role').className = `chip role ${S.you}`;
  $('#tb-code').textContent = `#${room.code}`;
  $('#tb-limit').textContent = `/ ${fmtTime(m.minutes * 60)}`;
  $('#tb-cmds').textContent = run.commands;
  $('#tb-opt').textContent = `/ ~${m.optimal}`;
  $('#tb-hints').textContent = run.hints.length ? `−${run.hints.reduce((a, h) => a + h.penalty, 0)}` : '0';
  const online = run.link === 'ONLINE';
  $('#dio-link').textContent = `SYSTEM LINK A ↔ B · ${run.link}`;
  $('#dio-link').classList.toggle('online', online);
  for (const r of ['A', 'B']) {
    const p = room.players[r];
    const label = $(`#dio-${r}`);
    fill(label, el('i', { class: `dot ${p?.connected ? 'on' : 'away'}` }), `ห้อง ${r} · ${p?.name ?? '-'}`, r === S.you && el('span', { class: 'you' }, 'คุณ'));
  }
  S.dio.setPlayers(room.players);
  S.dio.setOnline(online);
  const partner = room.players[S.you === 'A' ? 'B' : 'A'];
  const banner = $('#dio-banner');
  if (partner && !partner.connected) {
    banner.textContent = `${partner.name} หลุดการเชื่อมต่อ — รอกลับเข้าห้อง #${room.code}`;
    banner.classList.remove('hidden');
    banner.onclick = null;
  } else if (run.result) {
    banner.textContent = 'ผ่านด่านแล้ว! คลิกเพื่อดูคะแนน';
    banner.classList.remove('hidden');
    banner.onclick = () => showClear(run);
  } else {
    banner.classList.add('hidden');
  }
  renderHints(run);
  if (S.view && S.view.stageId === run.stageId) renderMission($('#tab-mission'), run, S.view, S.you);
  if (run.result && S.clearShown !== key) {
    S.clearShown = key;
    showClear(run);
  }
}

function renderHints(run) {
  const next = run.hints.length + 1;
  fill($('#hint-buttons'), 
    ...[1, 2, 3].map((level) => {
      const used = level < next;
      const penalty = { 1: 5, 2: 10, 3: 15 }[level];
      return el(
        'button',
        {
          class: `btn tiny ${used ? 'ghost' : level === next ? 'yellow' : 'ghost'}`,
          disabled: used || level !== next || Boolean(run.result),
          onclick: () => revealHint(level, penalty),
        },
        used ? `✓ ระดับ ${level}` : `ระดับ ${level} (−${penalty})`,
      );
    }),
  );
  fill($('#hint-list'), 
    ...(run.hints.length ? run.hints.map((h) => el('div', { class: 'hint' }, el('b', {}, `ระดับ ${h.level} (−${h.penalty}): `), h.text)) : [el('div', { class: 'empty-note', style: 'padding:6px' }, 'ลองคุยกันก่อน! /help ในเทอร์มินัลไม่หักคะแนน')]),
  );
}

async function revealHint(level, penalty) {
  const ok = await confirmBox(`เปิดคำใบ้ระดับ ${level}`, `คำใบ้นี้จะหัก ${penalty} คะแนนของทั้งทีม และทั้งสองห้องจะเห็นคำใบ้เดียวกัน`, `เปิดคำใบ้ (−${penalty})`);
  if (!ok) return;
  const res = await send('hint:reveal', { level });
  if (!res.ok) toast(res.error || 'เปิดคำใบ้ไม่ได้', true);
  else sfx.hint();
}

function onView(view) {
  S.view = view;
  const run = S.room?.run;
  S.term?.setView(view, `${view.stageId}-${run?.startedAt ?? ''}`);
  $('#term-device').textContent = view.device ? view.device.name : 'ไม่มีอุปกรณ์ (ถือเอกสาร)';
  renderDocs($('#tab-docs'), view);
  if (run) renderMission($('#tab-mission'), run, view, S.you);
  $('#tab-report').classList.toggle('hidden', !view.form);
  const formJson = JSON.stringify(view.form);
  if (formJson !== S.formJson) {
    const wasLocked = S.formJson && !JSON.parse(S.formJson)?.enabled;
    S.formJson = formJson;
    renderForm($('#tab-report-body'), view, async (data) => {
      const res = await send('form:submit', { data });
      if (res.ok) sfx.ok();
      else sfx.err();
      return res;
    });
    if (view.form?.enabled && wasLocked) {
      $('#tab-report').classList.add('flash');
      setTimeout(() => $('#tab-report').classList.remove('flash'), 2000);
      toast('แบบฟอร์มรายงานพร้อมแล้ว — ดูแท็บ 📝 รายงาน');
    }
  }
}

function showClear(run) {
  const r = run.result;
  if (!r) return;
  const stars = r.total >= 140 ? 3 : r.total >= 110 ? 2 : 1;
  fill($('#clear-stars'), ...[1, 2, 3].map((i) => el('span', { class: i <= stars ? 'on' : '' }, '★')));
  const row = (label, value, cls = '') => el('tr', { class: cls }, el('td', {}, label), el('td', { class: value > 0 ? 'pos' : value < 0 ? 'neg' : '' }, value > 0 ? `+${value}` : String(value)));
  fill($('#clear-score'), 
    row('คะแนนพื้นฐาน', r.base),
    row(`โบนัสความเร็ว (${fmtTime(r.elapsed)} / ${fmtTime(r.limit)})`, r.timeBonus),
    r.overtime ? row('เกินเวลาแนะนำ', r.overtime) : null,
    row(`คำใบ้ (${r.hints} ครั้ง)`, r.hintPenalty),
    row(`ตั้งค่าผิด (${r.wrong} ครั้ง)`, r.wrongPenalty),
    row(`ประสิทธิภาพคำสั่ง (${r.commands} / ~${r.optimal})`, r.efficiency),
    el('tr', {}, el('td', {}, 'Service downtime'), el('td', {}, fmtTime(r.downtime))),
    el('tr', { class: 'total' }, el('td', {}, 'รวม'), el('td', {}, String(r.total))),
  );
  $('#clear-explain').textContent = r.explanation;
  const final = $('#clear-final');
  final.classList.toggle('hidden', !r.finalCode);
  final.textContent = r.finalCode ? `FINAL CODE: ${r.finalCode}` : '';
  const id = run.stageId;
  const nextOk = id < 12 && id + 1 <= S.room.progress.unlocked;
  $('#clear-next').classList.toggle('hidden', !nextOk);
  $('#clear-next').onclick = () => startStage(id + 1);
  $('#clear-title').textContent = id === 12 ? '🏆 INCIDENT CLEARED — SYSTEM LINK ONLINE' : 'SYSTEM LINK A ↔ B: ONLINE';
  openModal('modal-clear');
}

function initGame() {
  $$('.tab').forEach((t) => (t.onclick = () => { sfx.click(); setTab(t.dataset.tab); }));
  $('#term-help').onclick = () => S.term.run('/help');
  $('#term-clear').onclick = () => fill($('#term-out'), );
  $('#tb-settings').onclick = openSettings;
  $('#tb-sound').onclick = () => {
    const on = !(settings.sfx || settings.bgm);
    setSetting('sfx', on);
    setSetting('bgm', on);
    unlockAudio();
    updateSoundIcon();
  };
  $('#tb-quit').onclick = async () => {
    const run = S.room?.run;
    if (run && !run.result && !(await confirmBox('กลับไปเลือกด่าน', 'ออกจากด่านนี้? ความคืบหน้าของด่านนี้จะหาย (ทั้งสองห้องจะกลับไปหน้าเลือกด่าน)', 'ออกจากด่าน'))) return;
    fire('stage:quit');
  };
  $('#clear-stay').onclick = () => closeModal('modal-clear');
  $('#clear-select').onclick = () => {
    closeModal('modal-clear');
    fire('stage:quit');
  };
  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    fire('chat:send', { text });
    input.value = '';
  };
  fill($('#chat-quick'), ...QUICK.map((q) => el('button', { type: 'button', onclick: () => fire('chat:send', { text: q }) }, q)));
  setInterval(() => {
    const run = S.room?.run;
    if (S.screen !== 'game' || !run) return;
    const elapsed = run.result ? run.result.elapsed : (Date.now() + S.offset - run.startedAt) / 1000;
    $('#tb-timer').textContent = fmtTime(elapsed);
    $('#tb-timer').parentElement.classList.toggle('over', elapsed > run.meta.minutes * 60);
  }, 500);
}

// ---------------------------------------------------------------- chat
function addChat(msg) {
  const log = $('#chat-log');
  const mine = msg.from === S.you;
  const node =
    msg.from === 'sys'
      ? el('div', { class: 'msg sys' }, msg.text)
      : el('div', { class: `msg ${msg.from} ${mine ? 'me' : ''}` }, el('b', {}, `ห้อง ${msg.from} · ${msg.name}`), msg.text);
  log.append(node);
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------- settings & how to play
function updateSoundIcon() {
  $('#tb-sound').textContent = settings.sfx || settings.bgm ? '🔊' : '🔇';
}

function openSettings() {
  sfx.click();
  const paint = () => {
    $('#set-sfx').classList.toggle('on', settings.sfx);
    $('#set-sfx').setAttribute('aria-checked', String(settings.sfx));
    $('#set-bgm').classList.toggle('on', settings.bgm);
    $('#set-bgm').setAttribute('aria-checked', String(settings.bgm));
    $('#set-volume').value = settings.volume;
    updateSoundIcon();
  };
  $('#set-sfx').onclick = () => {
    setSetting('sfx', !settings.sfx);
    sfx.click();
    paint();
  };
  $('#set-bgm').onclick = () => {
    setSetting('bgm', !settings.bgm);
    unlockAudio();
    paint();
  };
  $('#set-volume').oninput = (e) => setSetting('volume', Number(e.target.value));
  const contact = $('#set-contact');
  contact.textContent = CONTACT.label;
  if (CONTACT.url) contact.href = CONTACT.url;
  else contact.removeAttribute('href');
  paint();
  openModal('modal-settings');
}

function buildHowTo() {
  const sec = (title, ...body) => el('section', {}, el('h4', {}, title), ...body);
  fill($('#howto-body'), 
    sec('1. สองคน สองห้อง หนึ่งเครือข่าย', el('p', {}, 'ผู้เล่น 2 คนอยู่คนละห้อง (ห้อง A / ห้อง B) แต่ละห้องเห็นข้อมูลแค่ครึ่งเดียว — ผัง ตาราง ค่าคอนฟิก หรือผลคำสั่ง ไม่มีห้องไหนแก้ด่านได้คนเดียว ต้องคุยกัน (แชทในเกมเปิดตลอด หรือคุยกันจริง ๆ ก็ได้)')),
    sec('2. วงจรการเล่น', el('div', { class: 'loop' }, ...['Observe', 'Communicate', 'Diagnose', 'Configure', 'Verify', 'Restore Service', 'Unlock Next'].flatMap((s, i) => [i ? el('i', {}, '→') : null, el('span', {}, s)]))),
    sec(
      '3. เทอร์มินัลของแต่ละห้อง',
      el('ul', {},
        el('li', {}, 'พิมพ์คำสั่งเครือข่าย เช่น ', el('code', {}, 'ipconfig'), ' ', el('code', {}, 'ping 10.0.0.1'), ' ', el('code', {}, 'set ip <addr> <mask>')),
        el('li', {}, el('kbd', {}, 'Tab'), ' เติมคำสั่ง/ชื่อโฮสต์ · ', el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' ประวัติคำสั่ง · คลิกปุ่มคำสั่งด้านล่างจอเพื่อใส่ให้อัตโนมัติ'),
        el('li', {}, el('code', {}, '/help'), ' และ ', el('code', {}, '/help routing'), ' อธิบายแนวคิดและรูปแบบคำสั่ง — ไม่หักคะแนน'),
        el('li', {}, 'แต่ละห้องใช้ได้เฉพาะคำสั่งของอุปกรณ์ที่ตัวเองควบคุม'),
      ),
    ),
    sec('4. ผ่านด่านด้วยการพิสูจน์ (Verify Before Success)', el('p', {}, 'ไม่ได้ผ่านเพราะพิมพ์คำตอบถูก แต่ต้องแก้ network state ด้วยคำสั่งตั้งค่า แล้วรันคำสั่งตรวจสอบให้ระบบทำงานจริง (ping สำเร็จ, nslookup แปลงชื่อได้, traceroute ถึงปลายทาง ฯลฯ) — ไฟ System Link A ↔ B จะเปลี่ยนจาก OFFLINE เป็น ONLINE')),
    sec('5. คำใบ้ 3 ระดับ', el('p', {}, 'ระดับ 1 (−5) ชี้ทิศทาง · ระดับ 2 (−10) บอกแนวคิดและคำสั่ง · ระดับ 3 (−15) ให้คำสั่งเต็ม ต้องเปิดตามลำดับ และหักคะแนนทั้งทีม')),
    sec('6. คะแนน', el('p', {}, 'เริ่ม 100 คะแนน + โบนัสความเร็ว (ภายในเวลาแนะนำ) + โบนัสใช้คำสั่งน้อย − คำใบ้ − การตั้งค่าผิด (−3/ครั้ง) − เวลาที่เกิน · ทีม = คู่ A+B หนึ่งคู่ อันดับอยู่บน Leaderboard')),
    sec('7. 12 ด่าน', el('p', {}, 'Beginner → Intermediate → Advanced ตั้งแต่ IP/Subnet, Gateway, ARP, Rogue device, VLAN, Routing, Static route, DHCP/DNS, Packet capture, ACL จนถึงด่าน 12 FINAL NETWORK INCIDENT ที่ต้องแก้ 2 จุดเพื่อรับ Final Code')),
    sec('8. เล่นผ่าน LAN', el('p', {}, 'เครื่องหนึ่งรัน ', el('code', {}, 'npm run dev'), ' แล้วเพื่อนเปิด ', el('code', {}, 'http://<IP ของเครื่องนั้น>:3000'), ' คนหนึ่งกด "สร้างห้อง" อีกคนใส่เลขห้อง 4 หลัก')),
  );
}

// ---------------------------------------------------------------- sockets
socket.on('room:state', (st) => {
  const prevPhase = S.room?.phase;
  S.room = st;
  S.you = st.you;
  S.code = st.code;
  S.offset = st.now - Date.now();
  if (prevPhase === 'play' && st.phase !== 'play') {
    S.stageKey = '';
    S.view = null;
  }
  if (st.phase === 'select' && prevPhase !== 'select') S.catalog = null;
  route();
});
socket.on('stage:view', onView);
socket.on('chat:history', (list) => {
  fill($('#chat-log'), );
  list.forEach(addChat);
});
socket.on('chat:msg', (msg) => {
  addChat(msg);
  if (msg.from !== 'sys' && msg.from !== S.you) {
    sfx.chat();
    S.dio?.say(msg.from);
  } else if (msg.from === S.you) {
    S.dio?.say(msg.from);
  }
});
socket.on('activity', ({ role, kind }) => S.dio?.activity(role, kind));
socket.on('stage:complete', () => {
  sfx.clear();
  renderConfetti($('#confetti'));
});
let everConnected = false;
socket.on('connect', async () => {
  if (everConnected && S.code && S.loaded) {
    const res = await send('room:join', { code: S.code, name: local.get('kuhu.name'), playerId: S.playerId });
    if (res.ok) toast('เชื่อมต่อกลับเข้าห้องแล้ว');
    else {
      toast(res.error || 'ห้องนี้ไม่มีแล้ว', true);
      session.remove('kuhu.code');
      S.code = null;
      S.room = null;
      show('lobby');
    }
  }
  everConnected = true;
});
socket.on('disconnect', () => {
  if (S.loaded) toast('ขาดการเชื่อมต่อกับเซิร์ฟเวอร์ — กำลังเชื่อมต่อใหม่...', true);
});

// ---------------------------------------------------------------- init
$$('[data-close]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.add('hidden')));
$$('.modal').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m && m.id !== 'modal-clear' && m.id !== 'modal-confirm') m.classList.add('hidden');
  }),
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') ['modal-settings', 'modal-howto'].forEach(closeModal);
});
startSky($('#sky'));
initCover();
initLobby();
initRoom();
initSelect();
initGame();
buildHowTo();
updateSoundIcon();
show('cover');
