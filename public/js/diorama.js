import { drawChar, frameSize } from './sprites.js';
import { levelForStage, spawnPlayer, movePlayer, nearbyComputer } from './world.js';

const COLORS = { A: '#3fd6a8', B: '#f27fc4' };
const images = new Map();
const eIcon = new Image();
eIcon.src = '/assets/ui/key-e.png';

export class Diorama {
  constructor(canvas, { onInput, onInteract, onPrompt, canControl, avoid } = {}) {
    Object.assign(this, { canvas, onInput, onInteract, onPrompt, canControl, avoid });
    this.markers = [];
    this.ctx = canvas.getContext('2d');
    this.players = {};
    this.targets = {};
    this.chars = {};
    this.keys = new Set();
    this.online = false;
    this.role = 'A';
    this.active = false;
    this.connected = true;
    this.bubbles = {};
    this.level = levelForStage(1);
    this.loadArt();
    this.setStage(1, 'initial');
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => { if (this.keys.delete(e.code)) this.sendInput(true); });
    window.addEventListener('blur', () => this.stop());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
    document.addEventListener('focusin', (e) => { if (e.target.matches('input, textarea, select, [contenteditable]')) this.stop(); });
    let last = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      const dt = last ? Math.min(.05, (t - last) / 1000) : 0;
      last = t;
      if (!this.active || document.hidden || !this.canvas.offsetParent) return;
      this.update(dt, t);
      this.draw(t / 1000);
    };
    requestAnimationFrame(loop);
  }

  loadArt() {
    for (const id of [1, 4, 7, 10]) {
      const level = levelForStage(id);
      if (images.has(level.file)) continue;
      const image = new Image(); image.src = level.file; images.set(level.file, image);
    }
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(box.width * dpr); this.canvas.height = Math.round(box.height * dpr);
    this.scale = Math.min(this.canvas.width / this.level.width, this.canvas.height / this.level.height);
    this.origin = { x: (this.canvas.width - this.level.width * this.scale) / 2, y: (this.canvas.height - this.level.height * this.scale) / 2 };
  }

  setActive(active) { this.active = active; if (!active) this.stop(); else this.resize(); }
  setPlayers(players) { this.players = players; }
  setRole(role) { this.role = role || 'A'; }
  setOnline(online) { this.online = online; }
  setConnected(connected) { this.connected = connected; if (!connected) this.stop(); }

  setStage(id, key) {
    if (this.key === key) return;
    this.stop(); this.key = key; this.stageId = id; this.level = levelForStage(id);
    this.chars = { A: spawnPlayer(id, 'A'), B: spawnPlayer(id, 'B') }; this.targets = {}; this.received = false; this.bubbles = {};
    this.resize();
  }

  receive(state) {
    if (state.key !== this.key) return;
    this.online = state.online; this.targets = state.players;
    for (const role of ['A', 'B']) {
      const p = state.players[role]; if (!p) continue;
      if (!this.received || !this.chars[role]) this.chars[role] = { ...p };
      const c = this.chars[role]; c.terminal = p.terminal;
      const error = Math.hypot(c.x - p.x, c.y - p.y);
      if (role === this.role && error > 70 || !this.received) { c.x = p.x; c.y = p.y; }
    }
    this.received = true;
  }

  direction() { return { x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), y: Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')) }; }
  stop() { this.keys.clear(); this.sendInput(true); }
  sendInput(force = false) {
    if (!this.active || !this.connected) return;
    const dir = this.direction(), held = Boolean(dir.x || dir.y);
    // Idle players stay silent; a held key repeats every 80 ms, a release sends one stop.
    if (!force && !held) return;
    if (!force && performance.now() - (this.sentAt || 0) <= 80) return;
    if (force && !held && !this.sentHeld) return;
    this.sentAt = performance.now(); this.sentHeld = held;
    this.onInput?.({ ...dir, key: this.key });
  }

  keydown(e) {
    if (!this.active || !this.connected || e.ctrlKey || e.altKey || e.metaKey || !this.canControl?.() || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { e.preventDefault(); this.keys.add(e.code); this.sendInput(true); }
    else if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); this.stop(); this.onInteract?.(Boolean(nearbyComputer(this.level, this.role, this.chars[this.role]))); }
  }

  activity(role, kind) { this.bubbles[role] = { kind, until: performance.now() + 1700 }; }
  say(role) { this.activity(role, 'chat'); }
  update(dt, now) {
    this.sendInput();
    const local = this.chars[this.role];
    if (local && this.received && this.connected && !local.terminal) {
      const input = this.direction();
      if (input.x || input.y) this.chars[this.role] = movePlayer(this.level, this.role, local, input, dt, this.online);
    }
    for (const role of ['A', 'B']) {
      const target = this.targets?.[role]; const c = this.chars[role]; if (!target || !c) continue;
      // Predict the controlled character without pulling it toward an older packet
      // every frame. Remote characters still interpolate network snapshots.
      if (role === this.role && (this.direction().x || this.direction().y)) continue;
      const factor = Math.min(1, dt * 15); c.x += (target.x - c.x) * factor; c.y += (target.y - c.y) * factor; c.facing = target.facing; c.moving = target.moving; c.terminal = target.terminal;
    }
    const near = Boolean(nearbyComputer(this.level, this.role, this.chars[this.role]));
    const prompt = !this.connected ? 'กำลังเชื่อมต่อกลับ…' : local?.terminal ? 'Terminal เปิดอยู่ · Esc กลับไปเดิน' : near ? 'กด E เพื่อเปิด Terminal' : 'เดินไปที่คอมพิวเตอร์ที่มีสัญลักษณ์ E';
    if (prompt !== this.prompt) { this.prompt = prompt; this.onPrompt?.(prompt, near); }
  }

  draw(now) {
    const { ctx, level, scale, origin } = this; if (!origin) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, origin.x, origin.y);
    const image = images.get(level.file);
    // The artwork is usually drawn smaller than its source size; smooth it to avoid
    // nearest-neighbour shimmer, but keep the upscaled sprites crisp.
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (image?.complete && image.naturalWidth) ctx.drawImage(image, 0, 0, level.width, level.height);
    else { ctx.fillStyle = '#e8ddfb'; ctx.fillRect(0, 0, level.width, level.height); this.text('กำลังโหลดห้อง…', level.width / 2, level.height / 2, '#4b3f78', 18); }

    // Door between the rooms: barred while the stage link is offline.
    const [a, b] = level.split, [top, bottom] = level.passage;
    if (!this.online) {
      ctx.fillStyle = 'rgba(255, 120, 150, .16)'; ctx.fillRect(a, top, b - a, bottom - top);
      for (const x of [a + 3, b - 3]) {
        ctx.fillStyle = '#ff7a9a'; ctx.fillRect(x - 2, top, 4, bottom - top);
        for (let y = top + 6; y < bottom - 2; y += 12) { ctx.fillStyle = '#ffd0dc'; ctx.fillRect(x - 6, y, 12, 4); }
      }
      this.lock((a + b) / 2, (top + bottom) / 2);
    } else {
      ctx.fillStyle = 'rgba(110, 235, 190, .18)'; ctx.fillRect(a, top, b - a, bottom - top);
    }

    const me = this.chars[this.role];
    const near = nearbyComputer(level, this.role, me);
    const stations = level.stations[this.role] || [];
    const blocked = this.blockedAreas();
    this.markers = [];
    for (const station of stations) {
      const { x, y } = station.screen; const active = station === near;
      const glow = ctx.createRadialGradient(x, y, 3, x, y, active ? 70 : 50);
      glow.addColorStop(0, `${COLORS[this.role]}${active ? '66' : '33'}`); glow.addColorStop(1, `${COLORS[this.role]}00`); ctx.fillStyle = glow; ctx.fillRect(x - 70, y - 70, 140, 140);
      // Floor spot: where to stand to use this computer.
      const pulse = (Math.sin(now * 3) + 1) / 2;
      ctx.save(); ctx.setLineDash([6, 5]); ctx.lineWidth = 2.5; ctx.strokeStyle = `${COLORS[this.role]}${active ? 'ff' : 'cc'}`;
      ctx.fillStyle = `${COLORS[this.role]}${active ? '40' : '22'}`;
      ctx.beginPath(); ctx.ellipse(station.x, station.y, 24 + pulse * 5, 9 + pulse * 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      const size = active ? 50 : 40, bob = Math.sin(now * (active ? 6 : 2.4)) * 2.5;
      const spot = this.markerSpot(station, size, blocked);
      if (eIcon.complete && eIcon.naturalWidth) ctx.drawImage(eIcon, spot.x - size / 2, spot.y + bob - size / 2, size, size);
      else this.text('E', spot.x, spot.y + bob + 5, '#2d2a4a', 17, true);
      this.markers.push(this.toCss(spot.x - size / 2, spot.y - size / 2, size, size));
    }
    // Direction arrow at the player's feet toward the nearest own computer.
    if (me && !near && !me.terminal && stations.length) {
      const target = stations.reduce((a, b) => (Math.hypot(b.x - me.x, b.y - me.y) < Math.hypot(a.x - me.x, a.y - me.y) ? b : a));
      const ang = Math.atan2(target.y - me.y, target.x - me.x), r = 40 + Math.sin(now * 5) * 3;
      ctx.save(); ctx.translate(me.x + Math.cos(ang) * r, me.y + 1 + Math.sin(ang) * r * .45); ctx.rotate(ang);
      ctx.fillStyle = COLORS[this.role]; ctx.strokeStyle = '#2d2a4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }

    ctx.imageSmoothingEnabled = false;
    for (const role of ['A', 'B'].sort((x, y) => (this.chars[x]?.y || 0) - (this.chars[y]?.y || 0))) {
      if (!this.players[role] || role !== this.role && !this.targets?.[role]) continue;
      const c = this.chars[role], p = this.players[role], { w, h } = frameSize(); ctx.save(); ctx.globalAlpha = p.connected === false ? .45 : 1;
      ctx.fillStyle = 'rgba(60, 40, 110, .22)'; ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
      if (role === this.role) { ctx.strokeStyle = COLORS[role]; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 26, 10, 0, 0, Math.PI * 2); ctx.stroke(); }
      // Sprites follow the mockup scale (about 1/6 of the room height); collision stays at the feet.
      const size = 2; ctx.translate(Math.round(c.x - w * size / 2), Math.round(c.y - h * size + 4)); ctx.scale(size, size); drawChar(ctx, p.charId, c.moving ? Math.floor(now * 7) % 2 : 0, 0, 0, c.facing < 0); ctx.restore();
      this.text(role === this.role ? `คุณ · ${p.name}` : `เพื่อน · ${p.name}`, c.x, c.y + 26, role === 'A' ? '#16806a' : '#b0367d', 12, true);
      if (c.terminal || this.bubbles[role]?.until > performance.now()) this.text(c.terminal ? '>_' : '···', c.x, c.y - h * size - 4, '#4b3f78', 15, true);
    }
  }

  // HUD cards over the canvas, converted to world units, so markers can avoid them.
  blockedAreas() {
    const rects = this.avoid?.() || [];
    if (!rects.length || !this.origin) return [];
    const box = this.canvas.getBoundingClientRect(), d = this.dpr || 1, pad = 6;
    return rects.map((r) => ({
      l: ((r.left - box.left - pad) * d - this.origin.x) / this.scale, t: ((r.top - box.top - pad) * d - this.origin.y) / this.scale,
      r: ((r.right - box.left + pad) * d - this.origin.x) / this.scale, b: ((r.bottom - box.top + pad) * d - this.origin.y) / this.scale,
    }));
  }

  // Above the screen when visible; otherwise beside it, then above the floor spot.
  markerSpot(station, size, blocked) {
    const { x, y } = station.screen, h = size / 2, L = this.level;
    const candidates = [
      { x, y: y - 34 - h }, { x: x + 46 + h, y }, { x: x - 46 - h, y }, { x, y: station.y - 70 - h }, { x, y: y + 30 + h },
    ];
    const free = (c) => c.x - h >= 0 && c.x + h <= L.width && c.y - h >= 0 && c.y + h <= L.height
      && !blocked.some((r) => c.x + h > r.l && c.x - h < r.r && c.y + h > r.t && c.y - h < r.b);
    return candidates.find(free) || candidates[0];
  }

  toCss(x, y, w, h) {
    const box = this.canvas.getBoundingClientRect(), d = this.dpr || 1;
    const px = (v, o) => (o + v * this.scale) / d;
    return { left: box.left + px(x, this.origin.x), top: box.top + px(y, this.origin.y), width: w * this.scale / d, height: h * this.scale / d };
  }

  lock(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#ff6f8e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 15, y - 13, 30, 28, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 13, 8, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#ff6f8e'; ctx.fillRect(x - 2, y - 2, 4, 8);
  }

  text(text, x, y, color, size, background = false) {
    const ctx = this.ctx; ctx.font = `600 ${size}px Prompt, "Chakra Petch", Tahoma, sans-serif`; ctx.textAlign = 'center';
    if (background) { const w = ctx.measureText(text).width + 12; ctx.fillStyle = 'rgba(255, 253, 247, .92)'; ctx.strokeStyle = 'rgba(120, 100, 190, .45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x - w / 2, y - size - 1, w, size + 7, 5); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
}
