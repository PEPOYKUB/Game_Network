// Side-view pixel scene of Room A | partition | Room B, with the System Link cable between them.
import { drawChar, frameSize } from './sprites.js';

const H = 110;
const FLOOR = 76;
const C = {
  ink: '#2a2140', wallA: '#bff3ee', stripeA: '#ade8e2', wallB: '#ffdcee', stripeB: '#ffcce4', base: '#8b7fb0',
  plank1: '#e9c690', plank2: '#ddb57c', seam: '#b78d5b', part: '#a9b0d6', partD: '#7d84b0', wood: '#b97a45',
  woodD: '#8a5a2e', leg: '#6e4526', screen: '#15172a', teal: '#72e6d4', green: '#7cf29a', red: '#ff5d73',
  yellow: '#fff07a', pink: '#e2539b', white: '#ffffff', grey: '#cfcadb', rack: '#3b3552', sky: '#8fe6f3', cork: '#c58d52',
};

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function box(ctx, fill, x, y, w, h) {
  rect(ctx, C.ink, x, y, w, h);
  rect(ctx, fill, x + 1, y + 1, w - 2, h - 2);
}

export class Diorama {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 480;
    this.online = false;
    this.particles = [];
    this.packets = [];
    this.players = { A: null, B: null };
    this.chars = {
      A: { x: 60, target: 60, facing: 1, walk: 0, frame: 0, nextWander: 0, bubble: null, screenUntil: 0 },
      B: { x: 300, target: 300, facing: -1, walk: 0, frame: 0, nextWander: 0, bubble: null, screenUntil: 0 },
    };
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    let last = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      if (t - last < 33) return;
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
      last = t;
      if (this.canvas.offsetParent === null) return;
      this.update(dt, t / 1000);
      this.draw(t / 1000);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.W = Math.max(320, Math.round((H * r.width) / r.height));
    this.canvas.width = this.W;
    this.canvas.height = H;
    const W = this.W;
    const mid = Math.floor(W / 2);
    const L = {
      mid,
      part: 7,
      aMax: mid - 7,
      bMin: mid + 7,
      deskA: { x: mid - 7 - 64, w: 46 },
      winA: { x: 16, w: 42 },
      rackA: mid - 7 - 64 > 150 ? { x: mid - 7 - 118 } : null,
      boardB: { x: mid + 7 + 16, w: 58 },
      deskB: { x: mid + 7 + 92, w: 42 },
      winB: W - (mid + 7) > 250 ? { x: W - 104, w: 42 } : null,
      cabinetB: { x: W - 36 },
    };
    this.L = L;
    const fw = frameSize().w;
    this.spots = {
      A: { term: L.deskA.x - fw + 4, docs: L.winA.x + 50, min: 4, max: L.aMax - fw - 2 },
      B: { term: L.deskB.x - fw + 4, docs: L.boardB.x + L.boardB.w / 2 - fw / 2, min: L.bMin + 2, max: W - fw - 4 },
    };
    for (const role of ['A', 'B']) {
      const c = this.chars[role];
      const s = this.spots[role];
      c.x = Math.min(s.max, Math.max(s.min, role === 'A' ? s.term : s.docs));
      c.target = c.x;
    }
  }

  setPlayers(players) {
    this.players = players;
  }

  setOnline(online) {
    if (online && !this.online) this.celebrate();
    this.online = online;
    if (!online) this.packets = [];
  }

  activity(role, kind) {
    const c = this.chars[role];
    const s = this.spots?.[role];
    if (!c || !s) return;
    if (kind === 'exec' || kind === 'config' || kind === 'form' || kind === 'typing') {
      c.target = s.term;
      c.screenUntil = performance.now() / 1000 + 1.4;
    } else if (kind === 'docs') {
      c.target = s.docs;
    }
    if (kind === 'config') c.bubble = { kind: 'bang', until: performance.now() / 1000 + 1.8 };
    c.nextWander = performance.now() / 1000 + 10;
  }

  say(role) {
    const c = this.chars[role];
    if (c) c.bubble = { kind: 'talk', until: performance.now() / 1000 + 2.6 };
  }

  celebrate() {
    if (!this.L) return;
    const colors = [C.pink, C.yellow, C.teal, C.green, '#8f4bc9', C.white];
    for (let i = 0; i < 90; i += 1) {
      this.particles.push({
        x: this.L.mid + (Math.random() - 0.5) * 20,
        y: 44,
        vx: (Math.random() - 0.5) * 180,
        vy: -60 - Math.random() * 90,
        c: colors[i % colors.length],
        life: 2 + Math.random(),
      });
    }
  }

  update(dt, now) {
    if (!this.L) return;
    for (const role of ['A', 'B']) {
      const c = this.chars[role];
      const s = this.spots[role];
      if (!this.players[role]) continue;
      if (now > c.nextWander && Math.abs(c.x - c.target) < 1) {
        c.target = Math.random() < 0.55 ? (Math.random() < 0.5 ? s.term : s.docs) : s.min + Math.random() * (s.max - s.min);
        c.nextWander = now + 6 + Math.random() * 8;
      }
      c.target = Math.min(s.max, Math.max(s.min, c.target));
      const dx = c.target - c.x;
      if (Math.abs(dx) > 0.6) {
        c.facing = dx > 0 ? 1 : -1;
        c.x += Math.sign(dx) * Math.min(Math.abs(dx), 30 * dt);
        c.walk += dt;
        c.frame = Math.floor(c.walk / 0.16) % 2;
      } else {
        c.frame = 0;
        c.walk = 0;
        if (Math.abs(c.x - s.term) < 2) c.facing = 1;
        if (Math.abs(c.x - s.docs) < 2) c.facing = role === 'A' ? -1 : 1;
      }
    }
    if (this.online && Math.random() < dt * 3) {
      this.packets.push({ t: 0, dir: Math.random() < 0.5 ? 1 : -1, c: Math.random() < 0.5 ? C.yellow : C.white });
    }
    this.packets = this.packets.filter((p) => (p.t += dt * 0.45) < 1);
    this.particles = this.particles.filter((p) => {
      p.vy += 160 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      return p.life > 0 && p.y < H + 4;
    });
  }

  draw(now) {
    const { ctx, W, L } = this;
    if (!L) return;
    // Walls
    rect(ctx, C.wallA, 0, 0, L.aMax, FLOOR);
    rect(ctx, C.wallB, L.bMin, 0, W - L.bMin, FLOOR);
    for (let x = 4; x < L.aMax; x += 10) rect(ctx, C.stripeA, x, 0, 3, FLOOR);
    for (let x = L.bMin + 4; x < W; x += 10) rect(ctx, C.stripeB, x, 0, 3, FLOOR);
    rect(ctx, C.base, 0, FLOOR - 3, W, 3);
    // Floor planks
    for (let row = 0; FLOOR + row * 9 < H; row += 1) {
      const y = FLOOR + row * 9;
      rect(ctx, row % 2 ? C.plank1 : C.plank2, 0, y, W, 9);
      rect(ctx, C.seam, 0, y, W, 1);
      for (let x = (row % 2) * 18; x < W; x += 36) rect(ctx, C.seam, x, y, 1, 9);
    }
    this.drawWindow(L.winA.x, L.winA.w, now);
    if (L.winB) this.drawWindow(L.winB.x, L.winB.w, now + 3);
    if (L.rackA) this.drawRack(L.rackA.x, now);
    this.drawCorkboard(L.boardB.x, L.boardB.w);
    this.drawCabinet(L.cabinetB.x);
    this.drawPlant(L.aMax - 12);
    // Partition with the System Link jack
    rect(ctx, C.partD, L.mid - L.part, 0, L.part * 2, H);
    rect(ctx, C.part, L.mid - L.part + 2, 0, L.part * 2 - 4, H);
    box(ctx, C.screen, L.mid - 5, 44, 10, 14);
    const blink = Math.floor(now * 2) % 2 === 0;
    rect(ctx, this.online ? C.green : blink ? C.red : '#7a2c3a', L.mid - 2, 47, 4, 4);
    rect(ctx, C.grey, L.mid - 3, 53, 6, 3);
    // Cable along the floor: desk A → partition → desk B
    const cableY = H - 7;
    const ax = L.deskA.x + 30;
    const bx = L.deskB.x + 14;
    rect(ctx, C.ink, ax, FLOOR + 6, 2, cableY - FLOOR - 6);
    rect(ctx, C.ink, bx, FLOOR + 6, 2, cableY - FLOOR - 6);
    rect(ctx, this.online ? C.green : C.ink, ax, cableY, bx - ax + 2, 2);
    rect(ctx, C.ink, L.mid - 1, 58, 2, cableY - 58);
    for (const p of this.packets) {
      const x = p.dir > 0 ? ax + (bx - ax) * p.t : bx - (bx - ax) * p.t;
      rect(ctx, p.c, x - 1, cableY - 1, 3, 4);
    }
    this.drawDeskA(L.deskA.x, now);
    this.drawDeskB(L.deskB.x, now);
    // Characters
    const { h: fh } = frameSize();
    for (const role of ['A', 'B']) {
      const p = this.players[role];
      if (!p) continue;
      const c = this.chars[role];
      const bob = c.walk === 0 && Math.floor(now * 1.6 + (role === 'B' ? 0.5 : 0)) % 2 === 0 ? 1 : 0;
      ctx.globalAlpha = p.connected === false ? 0.35 : 1;
      drawChar(ctx, p.charId, c.frame, c.x, H - 5 - fh + bob, c.facing < 0);
      ctx.globalAlpha = 1;
      if (c.bubble && now < c.bubble.until) this.drawBubble(c.x + 14, H - 5 - fh - 4, c.bubble.kind, now);
    }
    for (const p of this.particles) rect(ctx, p.c, p.x, p.y, 2, 2);
  }

  drawWindow(x, w, now) {
    const { ctx } = this;
    box(ctx, C.white, x, 10, w, 32);
    rect(ctx, C.sky, x + 3, 13, w - 6, 26);
    const cx = x + 3 + ((now * 3) % (w + 10)) - 10;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 3, 13, w - 6, 26);
    ctx.clip();
    rect(ctx, C.white, cx, 20, 12, 4);
    rect(ctx, C.white, cx + 3, 17, 6, 3);
    ctx.restore();
    rect(ctx, C.white, x + w / 2 - 1, 13, 2, 26);
    rect(ctx, C.ink, x - 2, 41, w + 4, 3);
  }

  drawRack(x, now) {
    const { ctx } = this;
    box(ctx, C.rack, x, 28, 22, FLOOR + 14 - 28);
    for (let i = 0; i < 6; i += 1) {
      rect(ctx, '#4d4668', x + 3, 32 + i * 8, 16, 5);
      const on = (Math.floor(now * 3 + i * 1.7) % 3) !== 0;
      rect(ctx, on ? (i % 2 ? C.green : C.yellow) : '#2a2140', x + 15, 33 + i * 8, 2, 2);
    }
  }

  drawCorkboard(x, w) {
    const { ctx } = this;
    box(ctx, C.cork, x, 12, w, 34);
    rect(ctx, C.white, x + 5, 16, 14, 16);
    rect(ctx, C.yellow, x + 24, 18, 12, 11);
    rect(ctx, '#ffd6ea', x + 40, 16, 13, 14);
    rect(ctx, C.white, x + 20, 32, 16, 10);
    for (const [px, py] of [[x + 11, 16], [x + 29, 18], [x + 46, 16], [x + 27, 32]]) rect(ctx, C.red, px, py, 2, 2);
    ctx.fillStyle = C.red;
    for (let i = 0; i <= 17; i += 1) ctx.fillRect(Math.round(x + 12 + i), Math.round(17 + i * 0.1), 1, 1);
    for (let i = 0; i <= 16; i += 1) ctx.fillRect(Math.round(x + 30 + i), Math.round(19 - i * 0.18), 1, 1);
    for (const [lx, ly] of [[x + 7, 21], [x + 7, 24], [x + 7, 27], [x + 22, 36], [x + 22, 39]]) rect(ctx, '#b9b3c9', lx, ly, 10, 1);
  }

  drawCabinet(x) {
    const { ctx } = this;
    box(ctx, '#9aa3c7', x, 42, 28, FLOOR + 16 - 42);
    for (let i = 0; i < 3; i += 1) {
      rect(ctx, '#7d84b0', x + 3, 46 + i * 15, 22, 1);
      rect(ctx, C.ink, x + 11, 51 + i * 15, 6, 2);
    }
  }

  drawPlant(x) {
    const { ctx } = this;
    rect(ctx, '#5a9e45', x - 4, 52, 3, 10);
    rect(ctx, '#88e56b', x + 1, 48, 3, 14);
    rect(ctx, '#5a9e45', x + 5, 54, 3, 8);
    box(ctx, C.pink, x - 5, 62, 14, 12);
  }

  drawDeskA(x, now) {
    const { ctx } = this;
    const busy = now < this.chars.A.screenUntil;
    rect(ctx, C.leg, x + 3, FLOOR - 2, 3, 20);
    rect(ctx, C.leg, x + 40, FLOOR - 2, 3, 20);
    box(ctx, C.wood, x, FLOOR - 6, 46, 6);
    box(ctx, '#e8e4f0', x + 8, FLOOR - 26, 26, 20);
    rect(ctx, C.screen, x + 11, FLOOR - 23, 20, 13);
    const lines = busy ? 4 : 2;
    for (let i = 0; i < lines; i += 1) rect(ctx, busy && i === lines - 1 ? C.green : C.teal, x + 13, FLOOR - 21 + i * 3, 6 + ((i * 7 + Math.floor(now * (busy ? 8 : 1))) % 10), 1);
    rect(ctx, '#b9b3c9', x + 18, FLOOR - 7, 6, 1);
    box(ctx, C.grey, x + 30, FLOOR - 9, 14, 3);
  }

  drawDeskB(x, now) {
    const { ctx } = this;
    const busy = now < this.chars.B.screenUntil;
    rect(ctx, C.leg, x + 3, FLOOR - 2, 3, 20);
    rect(ctx, C.leg, x + 36, FLOOR - 2, 3, 20);
    box(ctx, C.wood, x, FLOOR - 6, 42, 6);
    box(ctx, C.grey, x + 6, FLOOR - 9, 22, 3);
    box(ctx, C.screen, x + 8, FLOOR - 22, 18, 13);
    for (let i = 0; i < (busy ? 3 : 1); i += 1) rect(ctx, C.pink, x + 10, FLOOR - 20 + i * 3, 5 + ((i * 5 + Math.floor(now * 6)) % 8), 1);
    rect(ctx, C.white, x + 30, FLOOR - 10, 9, 4);
    rect(ctx, C.yellow, x + 31, FLOOR - 13, 8, 3);
  }

  drawBubble(x, y, kind, now) {
    const { ctx } = this;
    box(ctx, C.white, x - 8, y - 11, 17, 10);
    rect(ctx, C.ink, x - 1, y - 2, 3, 2);
    if (kind === 'bang') {
      rect(ctx, C.pink, x, y - 9, 1, 4);
      rect(ctx, C.pink, x, y - 4, 1, 1);
    } else {
      const n = 1 + (Math.floor(now * 3) % 3);
      for (let i = 0; i < n; i += 1) rect(ctx, C.ink, x - 4 + i * 4, y - 6, 2, 2);
    }
  }
}
