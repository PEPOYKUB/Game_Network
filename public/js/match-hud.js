// Competitive overlay (FFA / 2v2): match timer, item inventory + targeting, pickup prompt,
// item feedback and the final standings. Everything here only *asks* the server; results
// come back through item:state / item:notice / match:end.
import { socket, send } from './net.js';

export const isComp = (mode) => mode === 'ffa' || mode === 'team';
export const PICKUP_RANGE = 40;

const ITEM_ICON = { configErase: '🧽', configGlitch: '⚡', shield: '🛡️', reflect: '🪞' };
const ATTACKS = new Set(['configErase', 'configGlitch']);

const h = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
};

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function initMatchHud({ getRoom, getDio, toast, onBackToSelect }) {
  const wrap = document.getElementById('diorama-wrap');
  const hud = h('div', { class: 'match-hud hidden', id: 'match-hud', 'aria-live': 'polite' });
  const result = h('div', { class: 'match-result hidden', id: 'match-result', role: 'dialog', 'aria-label': 'ผลการแข่งขัน' });
  wrap.append(hud);
  document.body.append(result);

  const st = { items: { drops: [], inventory: [], defense: null, status: { disrupted: false } }, log: [], offset: 0, resultKey: null, target: null };
  let seq = 0;
  const rid = () => `${Date.now().toString(36)}-${++seq}`;

  const room = () => getRoom();
  const active = () => isComp(room()?.mode) && (room()?.phase === 'play' || room()?.phase === 'ended');

  /** Targets the server will accept: FFA = other unfinished players, 2v2 = the other team. */
  const targets = () => {
    const r = room();
    if (!r?.match) return [];
    return Object.entries(r.match.scopes)
      .filter(([id, s]) => id !== r.me.scopeId && !s.finished && !s.forfeited)
      .map(([id, s]) => ({ id, label: r.mode === 'team' ? `ทีม ${id}` : `${r.players[id]?.name || id} (${id})`, disrupted: s.disrupted }));
  };

  const nearestDrop = () => {
    const dio = getDio();
    const me = dio?.chars?.[dio.role];
    if (!me) return null;
    let best = null;
    for (const d of st.items.drops) {
      const dist = Math.hypot(d.x - me.x, d.y - me.y);
      if (dist <= PICKUP_RANGE && (!best || dist < best.dist)) best = { ...d, dist };
    }
    return best;
  };

  const pickup = async () => {
    const drop = nearestDrop();
    if (!drop || room()?.phase !== 'play') return;
    const res = await send('item:pickup', { dropId: drop.id, requestId: rid() });
    if (!res.ok) toast(res.error || 'เก็บไอเทมไม่ได้', true);
  };

  const use = async (slot, item) => {
    const payload = { slot, requestId: rid() };
    if (ATTACKS.has(item)) {
      const list = targets();
      const target = list.find((t) => t.id === st.target) || list[0];
      if (!target) return toast('ไม่มีเป้าหมายที่โจมตีได้', true);
      if (!room()?.match?.attackable) return toast('ด่านนี้ไม่มีค่าคอนฟิกที่โจมตีได้ — เก็บไอเทมไว้ใช้ด่านอื่น', true);
      payload.target = target.id;
    }
    const res = await send('item:use', payload);
    if (!res.ok) toast(res.error || 'ใช้ไอเทมไม่ได้', true);
  };

  const addLog = (text, kind = '') => {
    st.log.unshift({ text, kind, at: Date.now() });
    st.log = st.log.slice(0, 4);
  };

  function render() {
    const r = room();
    hud.classList.toggle('hidden', !active());
    if (!active()) { result.classList.add('hidden'); return; }
    const m = r.match;
    const left = m.endsAt - (Date.now() + st.offset);
    const me = r.players[r.you];
    const list = targets();
    if (!list.some((t) => t.id === st.target)) st.target = list[0]?.id || null;
    const drop = nearestDrop();
    const disrupted = st.items.status?.disrupted;
    hud.replaceChildren(
      h('div', { class: 'mh-row' },
        h('span', { class: `mh-timer${left < 60_000 ? ' urgent' : ''}` }, '⏱ ', h('b', { id: 'mh-time' }, r.phase === 'ended' ? 'จบ' : fmt(left))),
        h('span', { class: 'mh-me' }, r.mode === 'team' ? `ทีม ${me?.teamId} · ${r.you}` : `FFA · ${r.you}`),
        st.items.defense ? h('span', { class: 'mh-chip defense' }, `${ITEM_ICON[st.items.defense.item]} ${st.items.defense.item === 'shield' ? 'Shield' : 'Reflect'} ทำงาน`) : null,
        disrupted ? h('span', { class: 'mh-chip hit' }, '⚠ ถูกรบกวน') : null),
      h('div', { class: 'mh-row mh-inv', id: 'mh-inventory' },
        h('span', { class: 'mh-label' }, 'ไอเทม'),
        ...[1, 2, 3].map((slot) => {
          const it = st.items.inventory[slot - 1];
          return it
            ? h('button', { class: `mh-slot ${ATTACKS.has(it.item) ? 'attack' : 'defense'}`, 'data-item': it.item, title: it.description, disabled: r.phase !== 'play', onclick: () => use(slot, it.item) }, `${ITEM_ICON[it.item]} ${it.name}`)
            : h('span', { class: 'mh-slot empty' }, '—');
        })),
      h('div', { class: 'mh-row' },
        h('label', { class: 'mh-label', for: 'mh-target' }, 'เป้าหมาย'),
        list.length
          ? h('select', { id: 'mh-target', onchange: (e) => { st.target = e.target.value; } },
            ...list.map((t) => h('option', { value: t.id, selected: t.id === st.target }, `${t.label}${t.disrupted ? ' ⚠' : ''}`)))
          : h('span', { class: 'mh-muted' }, 'ไม่มี'),
        drop && r.phase === 'play'
          ? h('button', { class: 'btn tiny green', id: 'mh-pickup', onclick: pickup }, `เก็บ ${ITEM_ICON[drop.item]} (F)`)
          : h('span', { class: 'mh-muted' }, st.items.drops.length ? 'มีไอเทมบนแผนที่ — เดินไปที่ทางเชื่อมกลางห้อง' : '')),
      ...st.log.map((l) => h('div', { class: `mh-log ${l.kind}` }, l.text)),
    );
    renderResult(r);
  }

  function renderResult(r) {
    const m = r.match;
    if (r.phase !== 'ended' || !m?.results) { result.classList.add('hidden'); return; }
    const key = `${m.stageId}:${m.startedAt}`;
    if (st.resultKey === key && !result.classList.contains('hidden')) return;
    st.resultKey = key;
    const mine = m.results.find((row) => row.scopeId === r.me.scopeId);
    const why = { winner: 'มีผู้ทำด่านสำเร็จ', timeout: 'หมดเวลา', forfeit: 'คู่แข่งถอนตัว' }[m.endedReason] || '';
    result.replaceChildren(h('div', { class: 'match-result-card' },
      h('h2', {}, mine?.rank === 1 ? '🏆 ชนะ!' : `อันดับ ${mine?.rank ?? '-'}`),
      h('p', { class: 'mh-muted' }, `การแข่งขันจบ · ${why}`),
      h('ol', { class: 'mh-standings', id: 'mh-standings' }, ...m.results.map((row) => h('li', { class: row.scopeId === r.me.scopeId ? 'mine' : '' },
        h('b', {}, `#${row.rank}`),
        h('span', {}, r.mode === 'team' ? `ทีม ${row.teamId} (${row.members.map((s) => r.players[s]?.name || s).join(', ')})` : r.players[row.members[0]]?.name || row.scopeId),
        h('span', {}, row.forfeited ? 'ถอนตัว' : row.completed ? 'ผ่านด่าน' : 'ยังไม่ผ่าน'),
        h('span', {}, `${row.score} คะแนน · ${fmt(row.elapsedMs)}`)))),
      h('div', { class: 'mh-actions' },
        h('button', { class: 'btn ghost', onclick: () => result.classList.add('hidden') }, 'ดูแผนที่'),
        h('button', { class: 'btn green', onclick: () => onBackToSelect() }, 'เลือกด่านถัดไป'))));
    result.classList.remove('hidden');
  }

  socket.on('item:state', (items) => {
    st.items = items;
    getDio()?.setDrops?.(items.drops);
    render();
  });
  socket.on('item:notice', (n) => {
    addLog(n.text, n.kind);
    if (['hit', 'blocked', 'reflected', 'shielded'].includes(n.kind)) toast(n.text, n.kind === 'hit');
    render();
  });
  socket.on('item:event', (e) => { if (e.type === 'spawn') addLog(`มี ${e.name} เกิดบนแผนที่`, 'spawn'); render(); });
  socket.on('match:start', () => { st.log = []; st.resultKey = null; render(); });
  socket.on('session:replaced', () => toast('ห้องนี้ถูกเปิดจากแท็บ/อุปกรณ์อื่นแล้ว — แท็บนี้หยุดควบคุมเกม', true));

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || !active()) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
    pickup();
  });
  setInterval(() => { if (active()) render(); }, 250);

  return {
    update(r) {
      if (r?.now) st.offset = r.now - Date.now();
      if (!isComp(r?.mode)) { st.items = { drops: [], inventory: [], defense: null, status: {} }; getDio()?.setDrops?.([]); }
      render();
    },
  };
}
