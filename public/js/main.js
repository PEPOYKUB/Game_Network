import { $, $$, el, fill, toast, openModal, closeModal, confirmBox, fmtTime, storage, wait } from './ui.js';
import { socket, send, fire } from './net.js';
import { settings, setSetting, unlockAudio, sfx, resetSettings, testSound } from './audio.js';
import { startSky } from './sky.js';
import { loadSprites, characters, paintChar, charName, iconUrl } from './sprites.js';
import { Diorama } from './diorama.js';
import { levelForStage } from './world.js';
import { Terminal } from './terminal.js';
import { renderDocs, renderMission, renderForm } from './docs.js';
import { renderConfetti } from './confetti.js';
import { makeWindow, front, resetAllWindows, setPinned, setRemember, windowClosed } from './windows.js';
import { initMatchHud, isComp } from './match-hud.js';
import { initVoiceChat } from './voice-chat.js';
import { PLAYER_COLORS, playerColor } from './player-colors.js';

// Team contact shown in Settings (wireframe 1.2.3). Leave url empty to show the label only.
const CONTACT = { label: 'Facebook · KUHU NET', url: '' };
const ROLE_TEXT = {
  A: 'ห้อง A — ส่วนใหญ่คุมเทอร์มินัลของเครื่องที่มีปัญหา เห็นอาการจริงของระบบ',
  B: 'ห้อง B — ส่วนใหญ่ถือเอกสาร ผัง และค่าที่ควรเป็น (บางด่านคุมเราเตอร์/เซิร์ฟเวอร์)',
};
const QUICK = ['รับทราบ', 'รอสักครู่', 'ขอข้อมูลเพิ่ม', 'แก้แล้ว ลองทดสอบดู'];

const session = storage('session');
const local = storage('local');
const newId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const S = {
  screen: 'cover',
  loaded: false,
  playerId: session.get('kuhu.player') || newId(),
  selectedMode: 'coop',
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
  storyTimer: null,
  storyTypeTimer: null,
  storyAdvanceTimer: null,
  storyActive: false,
  typingSent: 0,
  hintOpen: new Set(),
  checks: new Set(),
  unread: 0,
};
session.set('kuhu.player', S.playerId);

// ---------------------------------------------------------------- screens
function show(name) {
  S.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  $('#sky').hidden = name !== 'cover';
  if (name === 'game') setTimeout(() => {
    const terminalOpen = Boolean(S.room?.players?.[S.you]?.terminal);
    if (terminalOpen) $('#term-input')?.focus();
    else $('#diorama')?.focus();
  }, 50);
}

function route() {
  if (!S.loaded || !S.room) return;
  const phase = S.room.phase;
  if (phase === 'lobby') {
    dismissStoryBriefing();
    show('room');
    renderRoom();
  } else if (phase === 'select') {
    dismissStoryBriefing();
    closeModal('modal-clear');
    show('select');
    renderSelect();
  } else if (phase === 'play' || phase === 'ended') {
    show('game');
    renderGame();
  }
}

// ---------------------------------------------------------------- cover
function initCover() {
  $$('.sprite-btn').forEach((b) => b.addEventListener('mouseenter', () => sfx.hover()));
  $('#cover-start').onclick = () => {
    unlockAudio();
    sfx.click();
    show('mode');
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

// One source for mode names so the mode cards, the create/join screen and the lobby match.
const MODE_INFO = {
  coop: { th: 'ร่วมมือ 2 คน', en: 'CO-OP', note: 'ผู้เล่น 2 คน · อยู่คนละห้อง (A และ B)' },
  ffa: { th: 'แข่งขันเดี่ยว 4 คน', en: 'FREE FOR ALL', note: 'ผู้เล่น 4 คน · ต่างคนต่างแก้โจทย์เดียวกัน' },
  team: { th: 'แข่งขันทีม 2v2', en: 'TEAM BATTLE', note: 'ผู้เล่น 4 คน · ทีมละ 2 คน' },
  solo: { th: 'ฝึกเล่นคนเดียว', en: 'SOLO PRACTICE', note: 'ผู้เล่น 1 คน · ใช้ได้ทั้งห้อง A และ B · ไม่จำกัดเวลา' },
};
/** Modes where one player walks to either room's computer (FFA, 2v2 and solo practice). */
const usesBothStations = (mode) => isComp(mode) || mode === 'solo';
const isSolo = (mode) => mode === 'solo';
const modeInfo = (mode) => MODE_INFO[mode] || MODE_INFO.coop;
const modeNote = (mode) => `โหมด${modeInfo(mode).th} (${modeInfo(mode).en}) · ${modeInfo(mode).note}`;

function setModeNote() {
  $('#lobby-mode-note').textContent = modeNote(S.selectedMode);
  // Solo practice: no room code to share and nobody to wait for.
  const solo = isSolo(S.selectedMode);
  $('#screen-lobby').classList.toggle('lobby-solo', solo);
  $('#btn-create').textContent = solo ? 'เริ่มฝึก' : 'สร้างห้อง';
  $('#lobby-create-title').textContent = solo ? 'เริ่มรอบฝึก' : 'สร้างห้องใหม่';
  $('#lobby-create-copy').textContent = solo ? 'เล่นคนเดียว ใช้คอมพิวเตอร์ได้ทั้งห้อง A และ B ไม่จำกัดเวลา และไม่ส่งคะแนนเข้า leaderboard' : 'ระบบจะสุ่มเลขห้อง 4 หลักให้ ส่งเลขนี้ให้เพื่อนเพื่อเข้าร่วม';
}

function initModeSelect() {
  // Each card's own button picks the mode and continues to the normal create/join flow.
  // onclick (not addEventListener) keeps exactly one handler even if this runs again.
  $$('[data-mode-play]').forEach((button) => {
    button.onclick = () => {
      const mode = button.dataset.modePlay;
      if (!MODE_INFO[mode]) return;
      S.selectedMode = mode;
      setModeNote();
      sfx.start();
      boot();
    };
  });
  $('#mode-back').onclick = () => { sfx.click(); show('cover'); };
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
  setModeNote();
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
    const res = await send('room:create', { name: name(), playerId: S.playerId, mode: S.selectedMode, sample: $('#opt-sample').checked, unlockAll: $('#opt-unlock').checked });
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
  const ffa = isComp(room.mode);
  const solo = isSolo(room.mode);
  const roles = solo ? ['P1'] : ffa ? ['P1', 'P2', 'P3', 'P4'] : ['A', 'B'];
  $('#screen-room').classList.toggle('room-ffa', ffa);
  $('#screen-room').classList.toggle('room-solo', solo);
  $('#room-start').textContent = solo ? 'ไปเลือกด่าน' : room.mode === 'coop' || !room.mode ? 'เริ่ม' : `เริ่ม${modeInfo(room.mode).th}`;
  for (const role of ['A', 'B', 'P1', 'P2', 'P3', 'P4']) $(`#slot-${role}`).classList.toggle('hidden', !roles.includes(role));
  for (const role of roles) {
    const p = room.players[role];
    const slot = $(`#slot-${role}`);
    slot.className = `slot ${role} ${p ? '' : 'waiting'}`;
    slot.style.borderColor = ffa && p?.colorHex ? p.colorHex : '';
    const mine = role === S.you;
    const status = !p ? null : solo ? ['on', 'ฝึกคนเดียว'] : !p.connected ? ['away', 'หลุดการเชื่อมต่อ'] : p.ready ? ['on', 'พร้อม'] : ['', 'ไม่พร้อม'];
    const head = el('div', { class: 'slot-head' }, el('span', {}, `${ffa ? 'ผู้เล่น' : 'ห้อง'} ${role}${mine ? ' (คุณ)' : ''}`), status && el('span', { class: 'slot-status' }, el('i', { class: `dot ${status[0]}` }), status[1]));
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
    const color = playerColor(p.colorId);
    const colorTaken = (colorId) => roles.some((otherRole) => otherRole !== role
      && (room.mode !== 'team' || room.players[otherRole]?.teamId !== p.teamId)
      && room.players[otherRole]?.colorId === colorId);
    fill(slot, 
      head,
      charCanvas(p.charId),
      el('div', { class: 'slot-name' }, p.name),
      el('div', { class: 'slot-char' }, ffa ? `ตัวละคร ${color?.nameEn || 'เลือกสี'}` : charName(p.charId)),
      el('div', { class: 'slot-role' }, solo ? 'ฝึกเล่นคนเดียว · ใช้คอมพิวเตอร์ได้ทั้งห้อง A และ B' : room.mode === 'team' ? `ทีม ${p.teamId}` : ffa ? 'แข่งขันเดี่ยว · ควบคุมระบบ A และ B' : ROLE_TEXT[role]),
      mine && ffa && el('div', { class: 'slot-color-picker', 'aria-label': 'เลือกสีและชื่อตัวละคร' },
        el('span', { class: 'slot-color-caption' }, room.mode === 'team' ? 'สีทีม / ชื่อตัวละคร (เพื่อนร่วมทีมใช้สีเดียวกัน)' : 'สี / ชื่อตัวละคร'),
        ...PLAYER_COLORS.map((option) => el('button', {
          class: `slot-color${p.colorId === option.id ? ' selected' : ''}`,
          type: 'button', title: `${option.nameEn} · ${option.name}${colorTaken(option.id) ? ' (ถูกเลือกแล้ว)' : ''}`,
          'aria-label': `${option.nameEn} (${option.name})`, 'aria-pressed': p.colorId === option.id,
          style: `--player-color:${option.hex}`,
          disabled: p.ready || colorTaken(option.id),
          onclick: async () => {
            sfx.click();
            const res = await send('lobby:color', { colorId: option.id });
            if (!res.ok) toast(res.error || 'เลือกสีไม่ได้', true);
          },
        }, p.colorId === option.id ? '✓' : ''))),
      mine && room.mode === 'team' && el('div', { class: 'slot-controls team-pick' },
        ...['T1', 'T2'].map((t) => el('button', { class: `btn tiny ${p.teamId === t ? 'teal' : 'ghost'}`, 'data-team': t, disabled: p.ready || p.teamId === t,
          onclick: async () => { sfx.click(); const res = await send('lobby:team', { teamId: t }); if (!res.ok) toast(res.error || 'เปลี่ยนทีมไม่ได้', true); } }, `เข้าทีม ${t}`))),
      mine &&
        el(
          'div',
          { class: 'slot-controls' },
          el('button', { class: 'btn tiny ghost', onclick: () => pick(idx - 1), disabled: p.ready && !solo, 'aria-label': 'ตัวละครก่อนหน้า' }, '◀'),
          el('button', { class: 'btn tiny ghost', onclick: () => pick(Math.floor(Math.random() * list.length)), disabled: p.ready && !solo, title: 'สุ่มตัวละคร' }, '🎲 สุ่ม'),
          el('button', { class: 'btn tiny ghost', onclick: () => pick(idx + 1), disabled: p.ready && !solo, 'aria-label': 'ตัวละครถัดไป' }, '▶'),
          !solo && el('button', { class: `btn tiny ${p.ready ? 'yellow' : 'green'}`, onclick: () => { sfx.click(); fire('lobby:ready', { ready: !p.ready }); } }, p.ready ? 'ยกเลิกพร้อม' : 'พร้อม!'),
        ),
    );
  }
  const teamsOk = room.mode !== 'team' || ['T1', 'T2'].every((t) => (room.teams?.[t] || []).length === 2);
  const full = solo || (teamsOk && roles.every((r) => room.players[r]?.ready && room.players[r]?.connected));
  $('#room-start').disabled = !full;
  $('#room-swap').classList.toggle('hidden', ffa || solo);
  $('#room-msg').textContent = full ? '' : !teamsOk ? 'แบ่งทีมให้ได้ทีมละ 2 คนก่อน (กดปุ่ม "เข้าทีม")' : `รอผู้เล่นครบ ${roles.length} คน และให้ทุกคนกด "พร้อม!"`;
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
  S.voice?.update(null);
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

function stageArtUrl(id, fallback) {
  return id <= 4 ? `/assets/levels/map-0${id}-pastel.png` : fallback;
}

function dismissStoryBriefing() {
  clearTimeout(S.storyTimer);
  clearTimeout(S.storyAdvanceTimer);
  clearInterval(S.storyTypeTimer);
  S.storyTimer = null;
  S.storyAdvanceTimer = null;
  S.storyTypeTimer = null;
  S.storyActive = false;
  const briefing = $('#story-briefing');
  if (briefing) briefing.classList.add('hidden');
}

function showStoryBriefing(run) {
  const m = run?.meta;
  if (!m) return;
  dismissStoryBriefing();
  const r = S.room;
  const speakers = usesBothStations(r?.mode)
    ? [r.players?.P1, r.players?.P3]
    : [r?.players?.A, r?.players?.B];
  const actors = speakers.map((p, i) => {
    const charId = p?.charId || (i ? 'packet' : 'ping');
    const box = $(`#story-avatar-${i ? 'two' : 'one'}`);
    fill(box, charCanvas(charId, false, 'story-sprite'));
    $(`#story-name-${i ? 'two' : 'one'}`).textContent = p?.name || charName(charId);
    return { name: p?.name || charName(charId), element: $(`#story-actor-${i ? 'two' : 'one'}`) };
  });
  $('#story-kicker').textContent = `INCOMING TRANSMISSION · ${m.topic}`;
  $('#story-title').textContent = `ด่าน ${String(m.id).padStart(2, '0')} — ${m.title}`;
  $('#story-objective-text').textContent = m.objective;
  $('#story-line').textContent = '';
  $('#story-speaker').textContent = '';
  const lines = [
    { speaker: 0, text: m.story },
    { speaker: 1, text: `รับทราบ ภารกิจของเราคือ ${m.objective}` },
  ];
  let lineIndex = 0;
  const typeLine = () => {
    const line = lines[lineIndex];
    if (!line) return;
    actors.forEach((actor, i) => actor.element.classList.toggle('talking', i === line.speaker));
    $('#story-speaker').textContent = actors[line.speaker].name;
    const target = $('#story-line');
    target.textContent = '';
    const parts = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(line.text)].map((part) => part.segment)
      : Array.from(line.text);
    let position = 0;
    S.storyTypeTimer = setInterval(() => {
      target.textContent += parts[position++] || '';
      if (position >= parts.length) {
        clearInterval(S.storyTypeTimer);
        S.storyTypeTimer = null;
        lineIndex += 1;
        if (lineIndex < lines.length) S.storyAdvanceTimer = setTimeout(typeLine, 450);
      }
    }, 32);
  };
  $('#story-briefing').classList.remove('hidden');
  S.storyActive = true;
  typeLine();
  sfx.story();
  // Competitive briefings end exactly when the server starts the match for everyone.
  const startsIn = isComp(r?.mode) && r?.match?.startsAt ? r.match.startsAt - (Date.now() + S.offset) : null;
  S.storyTimer = setTimeout(dismissStoryBriefing, startsIn != null ? Math.max(0, startsIn) : 30_000);
}

async function renderSelect() {
  if (!S.catalog || S.screen === 'select') await loadCatalog();
  if (!S.room || S.room.phase !== 'select') return;
  const room = S.room;
  const cleared = room.progress.cleared;
  $('.team-panel .panel-title').textContent = isComp(room.mode) ? 'ผู้เล่นในการแข่งขัน' : 'ทีมของคุณ';
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
        el('img', { class: 'stage-icon', src: stageArtUrl(st.id, iconUrl(st.icon, 4)), alt: '' }),
        el('button', { class: 'play-btn', disabled: locked, title: locked ? 'ผ่านด่านก่อนหน้าก่อน' : `เล่นด่าน ${st.id}`, 'aria-label': locked ? `ด่าน ${st.id} ล็อก` : `เล่นด่าน ${st.id}`, onclick: () => startStage(st.id) }, locked ? '🔒' : '▶'),
      );
    }),
  );
  const total = Object.values(cleared).reduce((a, c) => a + c.score, 0);
  const time = Object.values(cleared).reduce((a, c) => a + c.time, 0);
  const rosterRoles = isSolo(room.mode) ? ['P1'] : isComp(room.mode) ? ['P1', 'P2', 'P3', 'P4'] : ['A', 'B'];
  fill($('#team-box'), 
    ...rosterRoles.map((r) => {
      const p = room.players[r];
      const result = room.ffaResults?.[r];
      return el('div', { class: 'team-row' }, p && charCanvas(p.charId, false), el('div', {}, el('b', {}, p ? p.name : '(ว่าง)'), el('div', {}, el('i', { class: `dot ${p?.connected ? 'on' : 'away'}` }), ` ${isComp(room.mode) ? 'ผู้เล่น' : 'ห้อง'} ${r}${r === S.you ? ' · คุณ' : ''}`), result && el('small', {}, `อันดับ ${result.rank} · ${result.score} คะแนน`)));
    }),
    el('div', { class: 'team-total' }, el('span', {}, `ผ่าน ${done}/12 ด่าน · ${fmtTime(time)}`), el('span', {}, `${total} คะแนน`)),
    room.progress.finalCode && el('div', { class: 'final-code', style: 'font-size:14px;margin-top:10px' }, room.progress.finalCode),
  );
  // Practice results never go to the leaderboard, so solo hides it.
  $('.board-panel')?.classList.toggle('hidden', isSolo(room.mode));
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
// The map is the main view. Terminal opens only with E next to your own computer
// as a monitor over your room. Mission and hint sheets float over the map (and the
// monitor); chat sits in the side column, or pops out from the rail while typing.
const PANELS = ['panel-mission', 'panel-hints'];
const isOpen = (id) => !$(`#${id}`).hidden;
const terminalOpen = () => $('#screen-game').classList.contains('terminal-open');
const chatPopped = () => $('#screen-game').classList.contains('chat-pop');
const chatVisible = () => S.screen === 'game' && (!terminalOpen() || chatPopped());

function initGameComponents() {
  S.dio = new Diorama($('#diorama'), {
    // Movement stays enabled after a clear: the door is open and the pair can meet.
    canControl: () => S.screen === 'game' && Boolean(S.room?.run)
      && !S.storyActive
      && !document.querySelector('.modal:not(.hidden)')
      && !terminalOpen()
      && !PANELS.some(isOpen),
    onInput: (input) => fire('player:move', input),
    // Floating HUD cards on the map: the E markers move out from under them.
    avoid: () => ['.hud-stage', '.hud-keys', '#dio-prompt', '#dio-banner:not(.hidden)'].map((q) => $(q)).filter((n) => n && n.offsetParent).map((n) => n.getBoundingClientRect()),
    onInteract: async (near, side) => {
      if (!near) return toast('เดินเข้าใกล้คอมพิวเตอร์ที่มีสัญลักษณ์ E แล้วกด E', true);
      const res = await send('player:interact', { open: true, role: side });
      if (!res.ok) toast(res.error || 'เปิด Terminal ไม่ได้', true);
      else setTerminalOpen(res.open);
      return undefined;
    },
    onPrompt: (text, near) => {
      const prompt = $('#dio-prompt');
      if (prompt) { prompt.textContent = text; prompt.classList.toggle('ready', near); }
    },
  });
  S.dio.setRole(usesBothStations(S.room?.mode) ? 'A' : S.you);
  window.__dio = S.dio; // read by the local QA scripts
  S.term = new Terminal({
    root: $('#term'),
    out: $('#term-out'),
    input: $('#term-input'),
    prompt: $('#term-prompt'),
    suggest: $('#term-suggest'),
    chips: $('#term-chips'),
    form: $('#term-form'),
    onExec: (line) => send('term:exec', { line, role: S.view?.role }),
    onTyping: () => {
      if (Date.now() - S.typingSent > 3000) {
        S.typingSent = Date.now();
        fire('activity', { kind: 'typing' });
        S.dio.activity(S.you, 'typing');
      }
    },
  });
}

function focusMap() {
  setTimeout(() => $('#diorama')?.focus({ preventScroll: true }), 20);
}

// Back to whatever the player was doing: typing commands or walking.
function focusPlay() {
  setTimeout(() => (terminalOpen() ? $('#term-input') : $('#diorama'))?.focus({ preventScroll: true }), 20);
}

function clearUnread() {
  S.unread = 0;
  $('#chat-badge').classList.add('hidden');
  $('#peek-chat').classList.add('hidden');
}

function setChatPop(on) {
  const screen = $('#screen-game');
  if (!on && screen.classList.contains('chat-pop')) windowClosed($('#panel-chat'));
  screen.classList.toggle('chat-pop', Boolean(on));
  $('#map-chat').classList.toggle('active', Boolean(on));
  $('#rail-term').classList.toggle('active', !on);
  if (!on) return;
  front($('#panel-chat'));
  clearUnread();
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  setTimeout(() => $('#chat-input')?.focus(), 20);
}

function setTerminalOpen(open) {
  const screen = $('#screen-game');
  const changed = screen.classList.contains('terminal-open') !== Boolean(open);
  screen.classList.toggle('terminal-open', Boolean(open));
  $('#term-window').hidden = !open;
  if (!changed) return;
  if (!open) windowClosed($('#term-window'));
  if (open) {
    closePanels(false);
    front($('#term-window'));
    S.dio?.stop();
    setTimeout(() => $('#term-input')?.focus(), 20);
  } else {
    setChatPop(false);
    clearUnread();
    focusMap();
  }
}

function closeTerminal() {
  if (!S.room?.players?.[S.you]?.terminal) return setTerminalOpen(false);
  return send('player:interact', { open: false }).then((res) => {
    if (res.ok) setTerminalOpen(false);
  });
}

function currentTab() {
  return $('.sheet-tabs .tab.active')?.dataset.tab;
}

function openPanel(id, tab) {
  if (isOpen(id) && (!tab || tab === currentTab())) return closePanels();
  for (const p of PANELS) $(`#${p}`).hidden = p !== id;
  setChatPop(false);
  S.dio?.stop();
  sfx.click();
  if (id === 'panel-mission') setTab(tab || 'mission');
  front($(`#${id}`));
  $(`#${id} .sheet-x`)?.focus({ preventScroll: true });
  return undefined;
}

function closePanels(refocus = true) {
  const wasOpen = PANELS.some(isOpen);
  for (const p of PANELS) {
    if (!$(`#${p}`).hidden) windowClosed($(`#${p}`));
    $(`#${p}`).hidden = true;
  }
  if (wasOpen && refocus) focusPlay();
}

for (const btn of $$('#screen-game [data-panel]')) btn.onclick = () => openPanel(btn.dataset.panel, btn.dataset.tab);
for (const btn of $$('[data-sheet-close]')) btn.onclick = () => closePanels();
$('#term-close').onclick = closeTerminal;
$('#map-chat').onclick = () => { sfx.click(); setChatPop(!chatPopped()); if (!chatPopped()) focusPlay(); };
$('#peek-chat').onclick = () => setChatPop(true);
$('#rail-term').onclick = () => { setChatPop(false); closePanels(false); focusPlay(); };
$('[data-chat-close]').onclick = () => { setChatPop(false); focusPlay(); };
// Every floating window can be dragged by its title bar and resized from its edges.
makeWindow($('#panel-mission'), { handles: [$('#panel-mission .sheet-head')], minW: 420, minH: 320 });
makeWindow($('#panel-hints'), { handles: [$('#panel-hints .sheet-head')], minW: 420, minH: 300 });
makeWindow($('#term-window'), { handles: [$('#term-window .term-head'), $('#term-window .mon-bezel')], minW: 460, minH: 340 });
makeWindow($('#panel-chat'), { handles: [$('#panel-chat .card-title')], minW: 290, minH: 280 });
makeWindow($('#modal-clear .clear-panel'), { handles: [$('#clear-title')], minW: 520, minH: 360 });

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || S.screen !== 'game') return;
  if (document.querySelector('.modal:not(.hidden)')) return;
  if (PANELS.some(isOpen)) closePanels();
  else if (chatPopped()) { setChatPop(false); focusPlay(); }
  else if (terminalOpen()) closeTerminal();
  else if (document.activeElement !== $('#diorama')) focusMap();
});

function stageKey() {
  const run = S.room?.run;
  return run ? `${run.stageId}-${run.startedAt}` : '';
}

function setTab(name) {
  $$('.sheet-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-mission').classList.toggle('hidden', name !== 'mission');
  $('#tab-docs').classList.toggle('hidden', name !== 'docs');
  $('#tab-report-body').classList.toggle('hidden', name !== 'report');
  if (name === 'docs') {
    fire('activity', { kind: 'docs' });
    S.dio?.activity(S.you, 'docs');
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

// Team card: portrait, name and what each player is doing. Rebuilt only when
// something visible changes, since player packets arrive many times a second.
function renderTeam() {
  const teamCard = $('.team-card');
  if (usesBothStations(S.room?.mode)) {
    teamCard.classList.add('hidden');
    return;
  }
  teamCard.classList.remove('hidden');
  const players = S.room?.players || {};
  const sig = JSON.stringify(['A', 'B'].map((r) => players[r] && [players[r].name, players[r].charId, players[r].connected, players[r].terminal]).concat(S.you));
  if (sig === S.teamSig) return;
  S.teamSig = sig;
  for (const role of ['A', 'B']) {
    const p = players[role];
    const box = $(`#dio-${role}`);
    box.classList.toggle('away', p?.connected === false);
    fill(box,
      el('div', { class: 'face' }, p ? charCanvas(p.charId, false) : null),
      el('div', {},
        el('b', {}, `ห้อง ${role} · ${role === S.you ? 'คุณ' : 'เพื่อน'}`),
        p?.terminal ? el('span', { class: 'busy' }, '>_ Terminal')
          : el('small', {}, !p ? 'รอผู้เล่น' : p.connected === false ? `${p.name} · หลุด` : p.name)));
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
    S.ffaRank = null;
    S.hintOpen = new Set();
    setTab('mission');
    closePanels(false);
    setChatPop(false);
    clearUnread();
    closeModal('modal-clear');
    $('#dio-banner').classList.add('hidden');
    showStoryBriefing(run);
  }
  S.dio.setStage(run.stageId, key);
  const visualRole = usesBothStations(room.mode) ? 'A' : S.you;
  S.dio.setRole(visualRole);
  const level = levelForStage(run.stageId);
  const screen = $('#screen-game');
  $('#term-close').classList.remove('hidden');
  screen.style.setProperty('--level-art', `url("${level.file}")`);
  screen.style.setProperty('--map-ar', String(level.width / level.height));
  screen.classList.toggle('mode-solo', isSolo(room.mode));
  screen.classList.toggle('role-A', visualRole === 'A');
  screen.classList.toggle('role-B', visualRole === 'B');
  S.dio.setActive(true);
  const m = run.meta;
  $('#tb-num').textContent = `${pad2(m.id)}/12`;
  $('#tb-title').textContent = m.title;
  $('#tb-code').textContent = `#${room.code}`;
  $('#tb-limit').textContent = isSolo(room.mode) ? '· ไม่จำกัดเวลา' : `/ ${fmtTime(m.minutes * 60)}`;
  $('#mission-limit').textContent = fmtTime(m.minutes * 60);
  $('#tb-cmds').textContent = run.commands;
  $('#tb-opt').textContent = ` / ~${m.optimal}`;
  const penalty = run.hints.reduce((a, h) => a + h.penalty, 0);
  $('#tb-hints').textContent = penalty ? `−${penalty} คะแนน` : '0 คะแนน';
  const online = run.link === 'ONLINE';
  $('.hud-keys')?.classList.remove('hidden');
  $('#dio-prompt').textContent = isSolo(room.mode)
    ? 'ฝึกเล่นคนเดียว · เดินไปใช้คอมพิวเตอร์ห้อง A หรือ B ได้ทั้งสองฝั่ง'
    : isComp(room.mode)
    ? 'FFA · เดินไปใช้คอมพิวเตอร์ A หรือ B · ตำแหน่งผู้เล่นอัปเดตผ่านเครือข่าย'
    : 'เดินไปยังคอมพิวเตอร์ที่มีสัญลักษณ์ E';
  const door = $('#dio-link');
  door.classList.toggle('online', online);
  door.lastElementChild.textContent = online ? 'ประตูเปิดแล้ว' : 'ประตูล็อก';
  door.title = online ? 'เดินหากันได้แล้ว' : 'ประตูจะเปิดเมื่อผ่านเงื่อนไขของด่าน';
  renderTeam();
  renderStageProgress(room.stageProgress);
  const scenePlayers = room.players;
  const ownPlayer = room.players[S.you];
  S.dio.setMode(room.mode, S.you, ownPlayer?.roomSide || 'A');
  S.dio.setPlayers(scenePlayers);
  S.dio.setOnline(online);
  S.dio.receive({ key, online, players: scenePlayers });
  setTerminalOpen(Boolean(room.players[S.you]?.terminal));
  const partner = usesBothStations(room.mode) ? null : room.players[S.you === 'A' ? 'B' : 'A'];
  const chatOnline = $('#chat-online');
  chatOnline.classList.toggle('away', !usesBothStations(room.mode) && !partner?.connected);
  chatOnline.lastChild.textContent = isComp(room.mode) ? ' FFA' : partner?.connected ? ' ออนไลน์' : ' ออฟไลน์';
  const banner = $('#dio-banner');
  if (partner && !partner.connected) {
    banner.textContent = `${partner.name} หลุดการเชื่อมต่อ — รอกลับเข้าห้อง #${room.code}`;
    banner.classList.remove('hidden');
    banner.onclick = null;
  } else if (run.result && !isComp(room.mode)) {
    banner.textContent = 'ผ่านด่านแล้ว! คลิกเพื่อดูคะแนน';
    banner.classList.remove('hidden');
    banner.onclick = () => showClear(run);
  } else {
    banner.classList.add('hidden');
  }
  renderHints(run);
  if (S.view && S.view.stageId === run.stageId) renderMissionTab(run, S.view);
  // Competitive matches show their own standings overlay (match-hud.js) instead of the co-op clear sheet.
  if (run.result && S.clearShown !== key && !isComp(room.mode)) {
    S.clearShown = key;
    showClear(run);
  }
}

function renderStageProgress(progress) {
  const host = $('#stage-progress');
  if (!host) return;
  if (!progress || progress.stageId !== S.room?.run?.stageId) {
    fill(host, el('p', { class: 'progress-empty' }, 'เริ่มด่านเพื่อดูความคืบหน้า'));
    return;
  }
  const roles = isSolo(S.room?.mode) ? ['P1'] : isComp(S.room?.mode) ? ['P1', 'P2', 'P3', 'P4'] : ['A', 'B'];
  fill(host, ...roles.map((role) => {
    const player = S.room?.players?.[role];
    const p = progress.players?.[role];
    if (!p) return el('div', { class: 'progress-player' }, `ห้อง ${role} · รอข้อมูล`);
    const displayName = player?.colorName
      ? `${player.colorName} · ${player.name || role}`
      : (player?.name || `ห้อง ${role}`);
    const title = `${displayName}${role === S.you ? ' · คุณ' : ''}`;
    const rank = S.room?.ffaResults?.[role]?.rank;
    const status = player?.connected === false ? 'ออฟไลน์' : p.complete ? `ผ่านด่านแล้ว${rank ? ` · อันดับ ${rank}` : ''}` : 'กำลังทำภารกิจ';
    return el('div', { class: `progress-player${role === S.you ? ' self' : ''}`, style: player?.colorHex ? `border-left:4px solid ${player.colorHex}` : '' },
      el('div', { class: 'progress-heading' }, el('b', { style: player?.colorHex ? `color:${player.colorHex}` : '' }, title), el('span', { class: player?.connected === false ? 'progress-away' : '' }, status)),
      el('div', { class: 'progress-metrics' },
        el('span', {}, `การกระทำ ${p.actions}`),
        el('span', {}, `ตั้งค่า ${p.configurations}`),
        el('span', {}, `ตรวจผ่าน ${p.verifications}`)),
    );
  }));
}

function renderMissionTab(run, view) {
  const me = S.room?.players?.[S.you];
  renderMission($('#tab-mission'), run, view, usesBothStations(S.room?.mode) ? view.role : S.you, {
    portrait: me && charCanvas(me.charId, false, 'portrait'),
    checks: S.checks,
    checkKey: S.stageKey,
    onToggle: () => renderMissionTab(run, view),
  });
  renderSideMission(view);
}

// Side-column checklist and the "current step" popup share the mission tab's checks.
function renderSideMission(view) {
  const items = view?.do || [];
  const keys = items.map((_, i) => `${S.stageKey}:${i}`);
  const now = keys.findIndex((k) => !S.checks.has(k));
  const done = keys.filter((k) => S.checks.has(k)).length;
  const toggle = (k) => {
    if (S.checks.has(k)) S.checks.delete(k); else S.checks.add(k);
    if (S.room?.run && S.view) renderMissionTab(S.room.run, S.view);
  };
  $('#side-count').textContent = items.length ? `${done} / ${items.length}` : '';
  fill($('#side-todo'), ...items.map((text, i) => {
    const isDone = S.checks.has(keys[i]);
    return el('li', {}, el('button', { type: 'button', class: isDone ? 'done' : i === now ? 'now' : '', 'aria-pressed': String(isDone), onclick: () => toggle(keys[i]) },
      el('span', { class: 'box', 'aria-hidden': 'true' }), el('span', {}, text), i === now && el('em', {}, 'NOW')));
  }));
  $('#peek-step-text').textContent = now >= 0 ? items[now] : 'ทำครบแล้ว — รันคำสั่งตรวจสอบให้ผ่าน';
  $('#peek-step-count').textContent = items.length ? `${Math.min(done + 1, items.length)} / ${items.length}` : '';
  $('#term-step').textContent = now >= 0 ? `· ${items[now]}` : '';
}

// Level names follow the mockup; penalties stay the server's 5 / 10 / 15.
const HINT_LEVELS = [
  { level: 1, name: 'ทิศทาง', penalty: 5 },
  { level: 2, name: 'แนวคิด', penalty: 10 },
  { level: 3, name: 'วิธีแก้ไข', penalty: 15 },
];

function hintMiniMap(stageId) {
  const level = levelForStage(stageId);
  const canvas = el('canvas', { class: 'hint-map', width: 480, height: Math.round(480 * level.height / level.width), 'aria-label': 'แผนผังตำแหน่งคอมพิวเตอร์ของห้องคุณ' });
  const image = new Image();
  image.onload = () => {
    const ctx = canvas.getContext('2d');
    const k = canvas.width / level.width;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    for (const s of level.stations[usesBothStations(S.room?.mode) ? (S.view?.role || 'A') : S.you] || []) {
      ctx.strokeStyle = '#ff4f9a';
      ctx.beginPath(); ctx.arc(s.screen.x * k, s.screen.y * k, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffffffdd'; ctx.fillRect(s.x * k - 9, s.y * k - 9, 18, 18);
      ctx.fillStyle = '#2d2a4a'; ctx.font = '700 13px Prompt, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('E', s.x * k, s.y * k + 5);
    }
  };
  image.src = level.file;
  return canvas;
}

function renderHints(run) {
  const next = run.hints.length + 1;
  const upcoming = HINT_LEVELS.find((h) => h.level === next);
  $('#side-hint').textContent = run.result ? 'ด่านผ่านแล้ว' : upcoming ? `ระดับ ${next} · −${upcoming.penalty}` : 'เปิดครบ 3 ระดับแล้ว';
  const latest = run.hints.length;
  if (latest && !S.hintOpen.has(`seen-${latest}`)) {
    S.hintOpen.add(`seen-${latest}`);
    S.hintOpen.add(latest);
  }
  fill($('#hint-rows'), ...HINT_LEVELS.map(({ level, name, penalty }) => {
    const hint = run.hints.find((h) => h.level === level);
    const title = el('b', {}, `ระดับ ${level} · ${name}`);
    if (hint) {
      const open = S.hintOpen.has(level);
      const toggle = () => {
        if (S.hintOpen.has(level)) S.hintOpen.delete(level); else S.hintOpen.add(level);
        renderHints(S.room.run);
      };
      return el('div', { class: `hint-row revealed ${open ? 'open' : ''}` },
        el('button', { class: 'hint-row-head', type: 'button', 'aria-expanded': String(open), onclick: toggle },
          title, el('span', { class: 'badge-open' }, 'เปิดแล้ว'), el('span', { class: 'chev' }, '⌄')),
        open && el('div', { class: 'hint-text' }, el('p', {}, hint.text), level === 1 && hintMiniMap(run.stageId)));
    }
    const isNext = level === next && !run.result;
    return el('div', { class: `hint-row ${isNext ? 'next' : 'locked'}` },
      el('div', { class: 'hint-row-head' },
        title,
        el('span', { class: 'cost' }, `-${penalty} คะแนน`),
        isNext
          ? el('button', { class: 'pill-btn mint small', type: 'button', onclick: () => revealHint(level, penalty) }, 'เปิดคำใบ้')
          : el('button', { class: 'pill-btn lock small', type: 'button', disabled: true, 'aria-label': run.result ? 'ด่านผ่านแล้ว' : `เปิดระดับ ${level - 1} ก่อน` }, el('span', { class: 'lock-ico', 'aria-hidden': 'true' })),
        el('span', { class: 'chev side' }, '›')));
  }));
}

async function revealHint(level, penalty) {
  const detail = usesBothStations(S.room?.mode)
    ? `คำใบ้นี้เป็นของคุณคนเดียวและจะหัก ${penalty} คะแนน`
    : `คำใบ้นี้จะหัก ${penalty} คะแนนของทั้งทีม และทั้งสองห้องจะเห็นคำใบ้เดียวกัน`;
  const ok = await confirmBox(`เปิดคำใบ้ระดับ ${level}`, detail, `เปิดคำใบ้ (−${penalty})`);
  if (!ok) return;
  const res = await send('hint:reveal', { level });
  if (!res.ok) toast(res.error || 'เปิดคำใบ้ไม่ได้', true);
  else sfx.hint();
}

function onView(view) {
  S.view = view;
  const run = S.room?.run;
  S.term?.setView(view, `${view.stageId}-${run?.startedAt ?? ''}`);
  $('#ffa-role-switch').classList.toggle('hidden', !usesBothStations(S.room?.mode));
  $$('[data-ffa-role]').forEach((button) => button.classList.toggle('active', button.dataset.ffaRole === view.role));
  $('#term-device').textContent = view.device ? view.device.name : 'ไม่มีอุปกรณ์ (ถือเอกสาร)';
  $('#mon-device').textContent = view.device ? view.device.name : 'DOCS';
  renderDocs($('#tab-docs'), view);
  if (run) renderMissionTab(run, view);
  $('#tab-report').classList.toggle('hidden', !view.form);
  const formJson = JSON.stringify(view.form);
  if (formJson !== S.formJson) {
    const wasLocked = S.formJson && !JSON.parse(S.formJson)?.enabled;
    S.formJson = formJson;
    renderForm($('#tab-report-body'), view, async (data) => {
      const res = await send('form:submit', { data, role: view.role });
      if (res.ok) sfx.ok();
      else sfx.err();
      return res;
    });
    if (view.form?.enabled && wasLocked) {
      $('#tab-report').classList.add('flash');
      setTimeout(() => $('#tab-report').classList.remove('flash'), 2000);
      toast('แบบฟอร์มรายงานพร้อมแล้ว — เปิดปุ่ม ภารกิจ → รายงาน');
    }
  }
}

function showClear(run) {
  const r = run.result;
  if (!r) return;
  const gameOver = Boolean(r.gameOver);
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
  const nextOk = id < 12 && id + 1 <= S.room.progress.unlocked && (!isComp(S.room.mode) || S.room.phase === 'select');
  $('#clear-next').classList.toggle('hidden', !nextOk);
  $('#clear-next').onclick = () => startStage(id + 1);
  $('#clear-title').textContent = gameOver ? '⏱ GAME OVER — หมดเวลา' : isComp(S.room.mode)
    ? r.forfeited ? 'ออกจากการแข่งขัน FFA' : `🏁 ${S.room.mode === 'team' ? 'TEAM 2v2' : 'FFA'} FINISHED${S.ffaRank ? ` · อันดับ ${S.ffaRank}` : ''}`
    : id === 12 ? '🏆 INCIDENT CLEARED — SYSTEM LINK ONLINE' : 'SYSTEM LINK A ↔ B: ONLINE';
  $('#clear-select').textContent = gameOver ? 'ยืนยันเล่นด่านนี้ใหม่' : 'เลือกด่าน';
  $('#clear-stay').textContent = gameOver ? 'กลับไปเลือกด่าน' : isSolo(S.room.mode) ? 'เล่นด่านนี้อีกครั้ง' : 'เดินหาเพื่อนในห้อง';
  $('#clear-next').classList.toggle('hidden', gameOver || !nextOk);
  openModal('modal-clear');
}

function initGame() {
  $('#story-dismiss').onclick = dismissStoryBriefing;
  document.addEventListener('keydown', (event) => {
    if (!S.storyActive || !['Enter', 'Escape', 'Space'].includes(event.code)) return;
    event.preventDefault();
    event.stopPropagation();
    dismissStoryBriefing();
  }, true);
  $$('[data-ffa-role]').forEach((button) => {
    button.onclick = async () => {
      if (!usesBothStations(S.room?.mode) || button.dataset.ffaRole === S.view?.role) return;
      const res = await send('stage:role', { role: button.dataset.ffaRole });
      if (!res.ok) toast(res.error || 'สลับระบบไม่ได้', true);
    };
  });
  $$('.sheet-tabs .tab').forEach((t) => (t.onclick = () => { sfx.click(); setTab(t.dataset.tab); }));
  $('#term-help').onclick = () => S.term.run('/help');
  $('#term-clear').onclick = () => fill($('#term-out'), );
  $('#tb-settings').onclick = openSettings;
  $('#tb-sound').onclick = () => {
    // Audible -> mute everything; silent for any reason -> master on, and both channels if both were off.
    const audible = settings.master && (settings.sfx || settings.bgm);
    setSetting('master', !audible);
    if (!audible && !settings.sfx && !settings.bgm) { setSetting('sfx', true); setSetting('bgm', true); }
    unlockAudio();
    updateSoundIcon();
  };
  $('#tb-quit').onclick = async () => {
    const run = S.room?.run;
    if (run && !run.result && !(await confirmBox('กลับไปเลือกด่าน', 'ออกจากด่านนี้? ความคืบหน้าของด่านนี้จะหาย (ทั้งสองห้องจะกลับไปหน้าเลือกด่าน)', 'ออกจากด่าน'))) return;
    const res = await send('stage:quit');
    if (!res.ok) toast(res.error || 'ออกจากด่านไม่ได้', true);
    else if (res.waiting) toast(`รอผู้เล่นอื่นกดออกจากด่าน (${res.count}/${res.total})`);
  };
  $('#clear-stay').onclick = () => {
    if (isSolo(S.room?.mode)) {
      // Practice: replay the same stage with a fresh scenario.
      closeModal('modal-clear');
      send('stage:retry', {}).then((res) => { if (!res.ok) toast(res.error || 'เริ่มด่านใหม่ไม่ได้', true); });
      return;
    }
    if (S.room?.run?.result?.gameOver) {
      closeModal('modal-clear');
      fire('stage:quit');
    } else closeModal('modal-clear');
  };
  $('#clear-select').onclick = () => {
    if (S.room?.run?.result?.gameOver) {
      send('stage:retry').then((res) => {
        if (!res.ok) toast(res.error || 'ยืนยันเริ่มด่านใหม่ไม่ได้', true);
        else if (res.waiting) toast(`ยืนยันแล้ว รอผู้เล่นอื่นเริ่มใหม่ (${res.count}/${res.total})`);
      });
      return;
    }
    closeModal('modal-clear');
    fire('stage:quit');
  };
  const sendChat = (text) => {
    if (text) fire('chat:send', { text });
  };
  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    sendChat(input.value.trim());
    input.value = '';
  };
  fill($('#chat-quick'), ...QUICK.map((q, i) => el('button', { type: 'button', class: i === 0 ? 'primary' : '', onclick: () => sendChat(q) }, q)));
  setInterval(() => {
    const run = S.room?.run;
    if (S.screen !== 'game' || !run) return;
    const elapsed = run.result ? run.result.elapsed : Math.max(0, (Date.now() + S.offset - run.startedAt) / 1000);
    $('#tb-timer').textContent = fmtTime(elapsed);
    $('#tb-timer').parentElement.classList.toggle('over', !isSolo(S.room?.mode) && elapsed > run.meta.minutes * 60);
  }, 500);
}

socket.on('stage:quit:vote', (vote) => {
  if (vote?.complete) toast('ผู้เล่นครบแล้ว กำลังกลับไปหน้าเลือกด่าน');
  else if (vote) toast(`มีผู้กดออกจากด่านแล้ว ${vote.count}/${vote.total} คน — รอผู้เล่นอื่น`);
});
socket.on('stage:retry:vote', (vote) => {
  if (vote?.complete) toast('ทุกคนยืนยันแล้ว กำลังเริ่มด่านเดิมใหม่');
  else if (vote) toast(`ยืนยันเริ่มใหม่แล้ว ${vote.count}/${vote.total} คน — รอผู้เล่นอื่น`);
});
socket.on('game:over', () => sfx.gameOver());

// ---------------------------------------------------------------- chat
function chatTime(at) {
  const d = new Date(at || Date.now());
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addChat(msg) {
  const log = $('#chat-log');
  const mine = msg.from === S.you;
  let node;
  if (msg.from === 'sys') node = el('div', { class: 'msg sys' }, msg.text);
  else {
    const p = S.room?.players?.[msg.from];
    node = el('div', { class: `msg ${msg.from} ${mine ? 'me' : 'them'}` },
      el('div', { class: 'avatar' }, p ? charCanvas(p.charId, false) : null),
      el('div', { class: 'msg-main' },
        el('div', { class: 'msg-who' }, `${mine ? 'คุณ' : 'เพื่อน'} · ห้อง ${msg.from}`),
        el('div', { class: 'msg-row' }, el('div', { class: 'bubble' }, msg.text), el('time', {}, chatTime(msg.at)))));
  }
  log.append(node);
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------- settings & how to play
const SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>';
function updateSoundIcon() {
  $('#tb-sound').innerHTML = settings.master && (settings.sfx || settings.bgm) ? SOUND_ON : SOUND_OFF;
}

// Window preferences live beside the audio settings but in their own key.
const WIN_DEFAULTS = { remember: true, termOnTop: false };
const winPrefs = { ...WIN_DEFAULTS, ...local.get('kuhu.windows', {}) };
function applyWinPrefs() {
  local.set('kuhu.windows', winPrefs);
  setRemember(winPrefs.remember);
  setPinned(winPrefs.termOnTop ? $('#term-window') : null);
}

const SWITCH_ART = { true: '/assets/settings/parts/yes.png', false: '/assets/settings/parts/no.png' };
const SOUND_ROWS = [
  { row: 'master', on: 'master', level: 'volume', input: '#set-volume' },
  { row: 'bgm', on: 'bgm', level: 'bgmVolume', input: '#set-bgm-volume' },
  { row: 'sfx', on: 'sfx', level: 'sfxVolume', input: '#set-sfx-volume' },
];

function paintSwitch(btn, on) {
  btn.setAttribute('aria-checked', String(on));
  const img = btn.querySelector('img');
  img.src = SWITCH_ART[on];
  img.alt = on ? 'YES' : 'NO';
}

function paintSettings() {
  for (const { row, on, level, input } of SOUND_ROWS) {
    const box = $(`.set-row[data-channel="${row}"]`);
    const muted = !settings[on] || (row !== 'master' && !settings.master);
    box.classList.toggle('off', muted);
    $(input).value = settings[level];
    box.querySelector('.px-slider').style.setProperty('--v', `${settings[level]}%`);
    $(`${input}-pct`).textContent = `${settings[level]}%`;
    paintSwitch($(`#set-${on}`), settings[on]);
  }
  paintSwitch($('#set-remember'), winPrefs.remember);
  paintSwitch($('#set-term-top'), winPrefs.termOnTop);
  updateSoundIcon();
}

function setSettingsTab(name) {
  $$('.set-tab').forEach((t) => { t.classList.toggle('active', t.dataset.setTab === name); t.setAttribute('aria-selected', String(t.dataset.setTab === name)); });
  $$('.set-page').forEach((p) => (p.hidden = p.dataset.setPage !== name));
}

function initSettings() {
  $$('.set-tab').forEach((t) => (t.onclick = () => { sfx.click(); setSettingsTab(t.dataset.setTab); }));
  for (const { on, level, input } of SOUND_ROWS) {
    $(input).oninput = (e) => { setSetting(level, Number(e.target.value)); paintSettings(); };
    $(input).onchange = () => sfx.click();
    $(`#set-${on}`).onclick = () => {
      setSetting(on, !settings[on]);
      unlockAudio();
      sfx.click();
      paintSettings();
    };
  }
  $('#set-test').onclick = () => testSound();
  $('#set-remember').onclick = () => { winPrefs.remember = !winPrefs.remember; applyWinPrefs(); sfx.click(); paintSettings(); };
  $('#set-term-top').onclick = () => { winPrefs.termOnTop = !winPrefs.termOnTop; applyWinPrefs(); sfx.click(); paintSettings(); };
  $('#set-reset-windows').onclick = () => {
    resetAllWindows();
    if (chatPopped()) setChatPop(true);
    sfx.click();
    toast('จัดทุกหน้าต่างกลับที่เดิมแล้ว');
  };
  $('#set-reset').onclick = async () => {
    if (!(await confirmBox('คืนค่าเริ่มต้น', 'คืนค่าเสียงและการตั้งค่าหน้าต่างทั้งหมดเป็นค่าเริ่มต้น?', 'คืนค่า'))) return;
    resetSettings();
    Object.assign(winPrefs, WIN_DEFAULTS);
    applyWinPrefs();
    paintSettings();
  };
  const contact = $('#set-contact');
  contact.textContent = CONTACT.url ? `${CONTACT.label} ↗` : CONTACT.label;
  if (CONTACT.url) contact.href = CONTACT.url;
  else contact.removeAttribute('href');
  makeWindow($('#set-win'), { handles: [$('#set-win .set-title')], minW: 640, minH: 480 });
  applyWinPrefs();
}

function openSettings() {
  S.dio?.stop();
  sfx.click();
  $('#set-room').textContent = S.room?.code ? ` · ห้องเกม #${S.room.code}` : '';
  paintSettings();
  openModal('modal-settings');
  front($('#set-win'));
  setTimeout(() => $('.set-tab.active')?.focus({ preventScroll: true }), 20);
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
  S.matchHud?.update(st);
  S.room = st;
  S.voice?.update(isSolo(st.mode) ? null : st);
  S.you = st.you;
  S.selectedMode = st.mode || 'coop';
  if ($('#lobby-mode-note')) $('#lobby-mode-note').textContent = modeNote(st.mode);
  S.code = st.code;
  S.offset = st.now - Date.now();
  if (prevPhase === 'play' && st.phase !== 'play') {
    S.stageKey = '';
    S.view = null;
  }
  if (st.phase === 'select' && prevPhase !== 'select') S.catalog = null;
  route();
});
socket.on('room:progress', (progress) => {
  if (!S.room || !isComp(S.room.mode) || !progress) return;
  S.room.stageProgress = progress;
  if (S.screen === 'game') renderStageProgress(progress);
});
socket.on('room:players', ({ players }) => {
  if (!S.room || !players) return;
  S.room.players = players;
  if (usesBothStations(S.room.mode)) S.dio?.setMode(S.room.mode, S.you, players[S.you]?.roomSide || 'A');
  S.dio?.setPlayers(players);
  S.dio?.receive({ key: stageKey(), online: S.room.run?.link === 'ONLINE', players });
  if (S.screen === 'game') renderTeam();
  setTerminalOpen(Boolean(players[S.you]?.terminal));
});
socket.on('stage:view', onView);
socket.on('chat:history', (list) => {
  fill($('#chat-log'), );
  list.forEach(addChat);
});
socket.on('chat:msg', (msg) => {
  addChat(msg);
  if (msg.from !== 'sys' && msg.from !== S.you && !chatVisible()) {
    S.unread += 1;
    $('#chat-badge').textContent = String(Math.min(S.unread, 9));
    $('#chat-badge').classList.remove('hidden');
    $('#peek-chat-who').textContent = `เพื่อน · ห้อง ${msg.from}`;
    $('#peek-chat-text').textContent = msg.text;
    $('#peek-chat').classList.remove('hidden');
  }
  if (msg.from !== 'sys' && msg.from !== S.you) {
    sfx.chat();
    S.dio?.say(msg.from);
  } else if (msg.from === S.you) {
    S.dio?.say(msg.from);
  }
});
socket.on('activity', ({ role, kind }) => S.dio?.activity(role, kind));
socket.on('stage:complete', ({ rank, reason } = {}) => {
  if (rank) S.ffaRank = rank;
  if (!reason || reason === 'winner') {
    sfx.clear();
    renderConfetti($('#confetti'));
  }
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
initModeSelect();
S.matchHud = initMatchHud({ getRoom: () => S.room, getDio: () => S.dio, toast, onBackToSelect: () => fire('stage:quit') });
S.voice = initVoiceChat({ getRoom: () => S.room, toast });
initLobby();
initRoom();
initSelect();
initGame();
buildHowTo();
initSettings();
updateSoundIcon();
show('cover');
