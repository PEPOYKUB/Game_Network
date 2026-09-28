// Renders each room's evidence (tables, sheets, notes, network diagrams), the mission brief and report forms.
import { el } from './ui.js';
import { iconUrl } from './sprites.js';

const SVG = 'http://www.w3.org/2000/svg';
const MONO = /^[\d.:/\-A-F#]+$|^(Gi|Fa)\d|^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function cell(tag, value) {
  const text = String(value ?? '');
  return el(tag, { class: MONO.test(text.trim()) ? 'mono' : null }, text);
}

function diagram(doc) {
  const U = 100;
  const pad = 20;
  const w = doc.w * U;
  const h = doc.h * U + (doc.caption ? 30 : 0);
  const root = svg('svg', { viewBox: `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`, role: 'img', 'aria-label': doc.title });
  root.append(svg('defs'));
  for (const g of doc.groups || []) {
    root.append(svg('rect', { x: g.x * U, y: g.y * U, width: g.w * U, height: g.h * U, fill: '#ffffff', stroke: '#8f4bc9', 'stroke-width': 4, 'stroke-dasharray': '12 8' }));
    const label = svg('text', { x: g.x * U + 10, y: g.y * U + 26, 'font-size': 22, 'font-weight': 700, fill: '#5e2f8c', 'font-family': 'Chakra Petch, sans-serif' }, g.label);
    root.append(label);
  }
  const pos = Object.fromEntries(doc.nodes.map((n) => [n.id, n]));
  for (const [a, b] of doc.edges || []) {
    const p = pos[a];
    const q = pos[b];
    if (!p || !q) continue;
    root.append(svg('line', { x1: p.x * U, y1: p.y * U, x2: q.x * U, y2: q.y * U, stroke: '#2a2140', 'stroke-width': 8, 'stroke-linecap': 'square' }));
    root.append(svg('line', { x1: p.x * U, y1: p.y * U, x2: q.x * U, y2: q.y * U, stroke: '#72e6d4', 'stroke-width': 3, 'stroke-linecap': 'square' }));
  }
  for (const n of doc.nodes) {
    const x = n.x * U;
    const y = n.y * U;
    if (n.hl) root.append(svg('rect', { x: x - 38, y: y - 38, width: 76, height: 76, fill: '#fff07a', stroke: '#2a2140', 'stroke-width': 4 }));
    else root.append(svg('rect', { x: x - 34, y: y - 34, width: 68, height: 68, fill: '#eefbfd', stroke: '#2a2140', 'stroke-width': 3 }));
    root.append(svg('image', { href: iconUrl(n.kind, 4), x: x - 30, y: y - 30, width: 60, height: 60, style: 'image-rendering:pixelated' }));
    const label = svg('text', { x, y: y + 60, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 700, fill: '#2a2140', 'font-family': 'Chakra Petch, sans-serif', stroke: '#ffffff', 'stroke-width': 5, 'paint-order': 'stroke' }, n.label);
    root.append(label);
    if (n.sub) root.append(svg('text', { x, y: y + 84, 'text-anchor': 'middle', 'font-size': 21, fill: '#5e2f8c', 'font-family': 'VT323, monospace', stroke: '#ffffff', 'stroke-width': 5, 'paint-order': 'stroke' }, n.sub));
  }
  if (doc.caption) root.append(svg('text', { x: w / 2, y: h + 4, 'text-anchor': 'middle', 'font-size': 20, fill: '#6f6789', 'font-family': 'Chakra Petch, sans-serif' }, doc.caption));
  return root;
}

export function renderDoc(doc) {
  const box = el('div', { class: 'doc' }, el('div', { class: 'doc-title' }, doc.title));
  if (doc.type === 'table') {
    box.append(
      el('table', {}, el('thead', {}, el('tr', {}, doc.head.map((h) => el('th', {}, h)))), el('tbody', {}, doc.rows.map((r) => el('tr', {}, r.map((c) => cell('td', c)))))),
    );
  } else if (doc.type === 'kv') {
    box.append(el('dl', {}, doc.rows.flatMap(([k, v]) => [el('dt', {}, k), cell('dd', v)])));
  } else if (doc.type === 'note') {
    box.append(el('ul', {}, doc.lines.map((l) => el('li', {}, l))));
  } else if (doc.type === 'diagram') {
    box.append(diagram(doc));
  }
  if (doc.note) box.append(el('div', { class: 'doc-note' }, `* ${doc.note}`));
  return box;
}

export function renderDocs(target, view) {
  const docs = view.docs || [];
  target.replaceChildren(...(docs.length ? docs.map(renderDoc) : [el('div', { class: 'empty-note' }, 'ห้องนี้ไม่มีเอกสาร — ข้อมูลของคุณอยู่ในผลลัพธ์ของเทอร์มินัล')]));
}

export function renderMission(target, run, view, you) {
  const m = run.meta;
  const other = you === 'A' ? 'B' : 'A';
  target.replaceChildren(
    el(
      'div',
      { class: 'mission' },
      el('h3', {}, `ด่าน ${m.id} – ${m.title}`),
      el(
        'div',
        { class: 'chips' },
        el('span', { class: `chip tier-${m.tier}` }, m.tier),
        el('span', { class: 'chip' }, `ความยาก ${m.id}/12 · ${m.difficulty}`),
        el('span', { class: 'chip' }, `⏱ แนะนำ ${m.minutes} นาที`),
        el('span', { class: 'chip' }, `⌨ ~${m.optimal} ขั้นตอน`),
      ),
      el('p', {}, el('b', {}, 'สถานการณ์: '), m.story),
      el('p', {}, el('b', {}, 'หัวข้อเครือข่าย: '), m.topic),
      el('p', {}, el('b', {}, 'เป้าหมายการเรียนรู้: '), m.objective),
      el('div', { class: 'box you' }, el('h4', {}, `ห้องของคุณ (ห้อง ${you}) มีข้อมูล`), el('ul', {}, view.see.map((s) => el('li', {}, s))), el('h4', {}, 'สิ่งที่ต้องทำ'), el('ol', {}, view.do.map((s) => el('li', {}, s)))),
      el('div', { class: 'box' }, el('h4', {}, 'กลไกความร่วมมือ'), el('p', {}, m.coop), el('p', {}, `ห้อง ${other} เห็นข้อมูลอีกครึ่งหนึ่ง — ถามกันให้ครบก่อนลงมือตั้งค่า`)),
      el('div', { class: 'box' }, el('h4', {}, 'ผ่านด่านเมื่อไร?'), el('p', {}, 'ต้องแก้ network state ด้วยคำสั่งจริง แล้วรันคำสั่งตรวจสอบ (ping / ipconfig / traceroute ฯลฯ) ให้พฤติกรรมของระบบถูกต้อง — System Link A ↔ B จะเปลี่ยนเป็น ONLINE')),
    ),
  );
}

export function renderForm(target, view, onSubmit) {
  const form = view.form;
  if (!form) {
    target.replaceChildren(el('div', { class: 'empty-note' }, 'ห้องของคุณไม่มีแบบฟอร์มรายงานในด่านนี้', el('br'), 'ผ่านด่านด้วยคำสั่งตั้งค่า + คำสั่งตรวจสอบในเทอร์มินัล'));
    return;
  }
  const prev = Object.fromEntries([...target.querySelectorAll('select')].map((s) => [s.name, s.value]));
  const result = el('div', { class: 'form-result' });
  const selects = form.fields.map((f) =>
    el('div', { class: 'form-row' }, el('label', { for: `f-${f.id}` }, f.label), el('select', { id: `f-${f.id}`, name: f.id }, el('option', { value: '' }, '— เลือก —'), f.options.map((o) => el('option', { value: o, selected: prev[f.id] === o }, o)))),
  );
  const submit = el('button', { class: 'btn purple', type: 'submit', disabled: !form.enabled }, form.submitLabel);
  const node = el(
    'form',
    {
      class: 'form-card',
      onsubmit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget).entries());
        if (Object.values(data).some((v) => !v)) {
          result.className = 'form-result bad';
          result.textContent = 'กรอกให้ครบทุกช่องก่อนส่ง';
          return;
        }
        submit.disabled = true;
        const res = await onSubmit(data);
        submit.disabled = false;
        result.className = `form-result ${res.ok ? 'ok' : 'bad'}`;
        result.textContent = res.message;
      },
    },
    el('h4', {}, form.title),
    el('p', {}, form.desc),
    form.enabled ? selects : el('div', { class: 'empty-note' }, `🔒 ${form.disabledReason}`),
    submit,
    result,
  );
  target.replaceChildren(node);
}
