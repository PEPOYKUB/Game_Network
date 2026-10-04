// Client terminal: renders output, keeps history, autocompletes commands and known hosts.
import { el } from './ui.js';
import { sfx } from './audio.js';

const HOST_COMMANDS = ['ping', 'traceroute', 'nslookup', 'use', 'disconnect port', 'connect port', 'route print', 'set vlan'];

export class Terminal {
  constructor({ root, out, input, prompt, suggest, chips, form, onExec, onTyping }) {
    Object.assign(this, { root, out, input, promptEl: prompt, suggestEl: suggest, chipsEl: chips, onExec, onTyping });
    this.history = [];
    this.hIndex = -1;
    this.view = null;
    this.stageKey = null;
    this.busy = false;
    this.queue = [];
    this.suggestions = [];
    this.active = 0;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    input.addEventListener('keydown', (e) => this.keydown(e));
    input.addEventListener('input', () => {
      sfx.key();
      this.onTyping?.();
      this.refreshSuggest();
    });
    input.addEventListener('blur', () => setTimeout(() => this.hideSuggest(), 150));
    root.addEventListener('click', (e) => {
      if (!window.getSelection()?.toString() && e.target.closest('.term-out')) input.focus();
    });
  }

  setView(view, stageKey) {
    this.view = view;
    this.promptEl.textContent = view.device ? view.device.prompt : `ห้อง-${view.role}>`;
    this.renderChips();
    if (stageKey !== this.stageKey) {
      this.stageKey = stageKey;
      this.queue = [];
      this.out.replaceChildren();
      this.banner();
    }
  }

  banner() {
    const v = this.view;
    const dev = v.device ? `${v.device.name}` : 'ไม่มีอุปกรณ์ควบคุม';
    this.write([
      { t: '----------------------------------------', c: 'banner' },
      { t: ` KUHU NET // ห้อง ${v.role} · ${dev}`, c: 'banner' },
      { t: '----------------------------------------', c: 'banner' },
    ]);
    if (!v.commands.length) {
      this.write([
        { t: 'ในด่านนี้ห้องของคุณถือ "ข้อมูล" ไม่ใช่อุปกรณ์ — เปิดปุ่ม ภารกิจ → ข้อมูลในห้อง', c: 'sys' },
        { t: 'แล้วบอกค่าที่อีกห้องต้องใช้ผ่านแชทหรือพูดคุยกัน (/help ยังใช้ได้)', c: 'sys' },
      ]);
    } else {
      this.write([
        { t: `คำสั่งที่ใช้ได้: ${v.commands.map((c) => c.name).join(', ')}`, c: 'dim' },
        { t: 'พิมพ์ /help เพื่อดูรายละเอียด · Tab เติมคำสั่ง · ↑/↓ ประวัติ', c: 'dim' },
      ]);
    }
  }

  renderChips() {
    const v = this.view;
    const chips = v.commands.map((c) =>
      el('button', { type: 'button', class: `term-chip ${c.kind === 'config' ? 'config' : ''}`, title: `${c.usage} — ${c.desc}`, onclick: () => this.fill(c.usage.includes('<') || c.usage.includes('[') ? `${c.name} ` : c.name) }, c.name),
    );
    chips.push(el('button', { type: 'button', class: 'term-chip', title: 'ดูคำสั่งและหัวข้อช่วยเหลือ (ไม่หักคะแนน)', onclick: () => this.run('/help') }, '/help'));
    this.chipsEl.replaceChildren(...chips);
  }

  fill(text) {
    this.input.value = text;
    this.input.focus();
    this.refreshSuggest();
  }

  write(lines) {
    for (const l of lines) this.out.append(el('div', { class: `l ${l.c || 'out'}` }, l.t || ' '));
    this.out.scrollTop = this.out.scrollHeight;
  }

  async print(lines) {
    for (const l of lines) {
      const delay = Math.min(700, l.d ?? 0) || (lines.length > 3 ? 14 : 0);
      // Hidden tabs throttle timers to ~1s, so skip the typing effect there.
      if (delay && !document.hidden) await new Promise((r) => setTimeout(r, delay));
      this.write([l]);
    }
  }

  echo(text) {
    this.out.append(el('div', { class: 'l cmd' }, el('span', { class: 'p' }, `${this.promptEl.textContent} `), text));
    this.out.scrollTop = this.out.scrollHeight;
  }

  async run(line) {
    // Commands typed while output is still animating wait their turn instead of being dropped.
    if (this.busy) {
      this.queue.push(line);
      return;
    }
    const text = line.trim();
    this.echo(text);
    if (!text) return;
    if (this.history[0] !== text) this.history.unshift(text);
    this.history = this.history.slice(0, 50);
    this.hIndex = -1;
    if (text.toLowerCase() === 'clear' || text.toLowerCase() === 'cls') {
      this.out.replaceChildren();
      return;
    }
    this.busy = true;
    this.root.classList.add('busy');
    sfx.exec();
    try {
      const res = await this.onExec(text);
      if (res?.prompt) this.promptEl.textContent = res.prompt;
      await this.print(res?.lines || []);
      if ((res?.lines || []).some((l) => l.c === 'err')) sfx.err();
    } finally {
      this.busy = false;
      this.root.classList.remove('busy');
      this.input.focus();
    }
    if (this.queue.length) this.run(this.queue.shift());
  }

  submit() {
    const suggestion = this.suggestEl.classList.contains('show') && this.suggestions[this.active];
    if (suggestion && suggestion.fill !== this.input.value && suggestion.enterFills) {
      this.fill(suggestion.fill);
      return;
    }
    const value = this.input.value;
    this.input.value = '';
    this.hideSuggest();
    this.run(value);
  }

  keydown(e) {
    const open = this.suggestEl.classList.contains('show');
    if (e.key === 'Tab') {
      e.preventDefault();
      this.complete();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) return this.move(-1);
      if (this.hIndex < this.history.length - 1) this.hIndex += 1;
      this.input.value = this.history[this.hIndex] ?? this.input.value;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) return this.move(1);
      this.hIndex = Math.max(-1, this.hIndex - 1);
      this.input.value = this.hIndex < 0 ? '' : this.history[this.hIndex];
    } else if (e.key === 'Escape' && this.suggestEl.classList.contains('show')) {
      e.stopPropagation(); // first Esc closes suggestions; the next one leaves the terminal
      this.hideSuggest();
    }
    return undefined;
  }

  move(delta) {
    this.active = (this.active + delta + this.suggestions.length) % this.suggestions.length;
    this.renderSuggest();
  }

  /** Suggestions: command names while typing the command, known hosts while typing an argument. */
  compute() {
    const v = this.view;
    if (!v) return [];
    const raw = this.input.value;
    const lower = raw.toLowerCase().replace(/\s+/g, ' ');
    if (!lower.trim()) return [];
    const cmds = [...v.commands.map((c) => ({ name: c.name, usage: c.usage, desc: c.desc })), { name: '/help', usage: '/help [topic]', desc: 'ช่วยเหลือ (ไม่หักคะแนน)' }];
    const full = cmds.filter((c) => lower.startsWith(`${c.name} `)).sort((a, b) => b.name.length - a.name.length)[0];
    if (full) {
      if (!HOST_COMMANDS.includes(full.name)) return [];
      const rest = raw.slice(full.name.length + 1);
      if (rest.includes(' ')) return [];
      return (v.hosts || [])
        .filter((h) => h.toLowerCase().startsWith(rest.toLowerCase()) && h.toLowerCase() !== rest.toLowerCase())
        .slice(0, 8)
        .map((h) => ({ label: h, hint: 'โฮสต์ที่รู้จัก', fill: `${raw.slice(0, full.name.length + 1)}${h}`, enterFills: true }));
    }
    return cmds
      .filter((c) => c.name.startsWith(lower.trim()) && c.name !== lower.trim())
      .slice(0, 7)
      .map((c) => ({ label: c.usage, hint: c.desc, fill: c.usage.includes('<') || c.usage.includes('[') ? `${c.name} ` : c.name, enterFills: false }));
  }

  refreshSuggest() {
    this.suggestions = this.compute();
    this.active = 0;
    this.renderSuggest();
  }

  renderSuggest() {
    if (!this.suggestions.length) return this.hideSuggest();
    this.suggestEl.replaceChildren(
      ...this.suggestions.map((s, i) =>
        el('div', { class: `sug ${i === this.active ? 'active' : ''}`, onmousedown: (e) => { e.preventDefault(); this.fill(s.fill); } }, el('span', {}, s.label), el('small', {}, s.hint)),
      ),
    );
    this.suggestEl.classList.add('show');
    return undefined;
  }

  hideSuggest() {
    this.suggestEl.classList.remove('show');
  }

  complete() {
    const list = this.compute();
    if (!list.length) return;
    if (list.length === 1) return this.fill(list[0].fill);
    const fills = list.map((s) => s.fill);
    let prefix = fills[0];
    for (const f of fills) while (!f.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (prefix.length > this.input.value.length) this.fill(prefix);
    else this.fill(list[this.active]?.fill ?? list[0].fill);
  }
}
