// Animated pixel sky (same mood as the cover art): banded gradient, drifting clouds, power poles & wires.
const W = 400;
const H = 240;
const BANDS = ['#80eaf3', '#77e1f1', '#6dd6ef', '#63cbec', '#5ac0e9', '#52b6e7', '#4daee4'];

function cloud(ctx, x, y, w) {
  const h = Math.round(w * 0.32);
  const bumps = [
    [0.1, 0.45, 0.35],
    [0.28, 0.1, 0.4],
    [0.55, 0.25, 0.35],
    [0.72, 0.5, 0.26],
  ];
  ctx.fillStyle = '#ffffff';
  for (const [bx, by, bw] of bumps) {
    const r = Math.round(w * bw * 0.5);
    const cx = x + w * bx + r;
    const cy = y + h * by + r * 0.6;
    for (let dy = -r; dy <= r; dy += 1) {
      const half = Math.round(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(Math.round(cx - half), Math.round(cy + dy * 0.6), half * 2, 1);
    }
  }
  ctx.fillRect(Math.round(x), Math.round(y + h * 0.55), Math.round(w), Math.round(h * 0.45));
  ctx.fillStyle = '#dde5ee';
  ctx.fillRect(Math.round(x + 2), Math.round(y + h - 2), Math.round(w - 4), 2);
}

function poles(ctx) {
  const xs = [30, 170, 310];
  ctx.fillStyle = '#c9b8a6';
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i];
    const b = xs[i + 1] ?? W + 110;
    for (const [off, sag] of [[0, 9], [6, 11], [12, 8]]) {
      for (let x = a; x < b; x += 1) {
        const t = (x - a) / (b - a);
        ctx.fillRect(x, Math.round(186 + off + sag * 4 * t * (1 - t)), 1, 1);
      }
    }
  }
  for (const x of xs) {
    ctx.fillStyle = '#34313d';
    ctx.fillRect(x - 3, 180, 7, 60);
    ctx.fillRect(x - 16, 184, 33, 3);
    ctx.fillRect(x - 12, 196, 25, 3);
    ctx.fillStyle = '#595466';
    for (const dx of [-14, -8, 9, 14]) ctx.fillRect(x + dx, 181, 2, 3);
  }
}

export function startSky(canvas) {
  canvas.width = W;
  canvas.height = H;
  canvas.style.objectFit = 'cover';
  const ctx = canvas.getContext('2d');
  const clouds = [
    { x: 10, y: 22, w: 90, v: 2.2 },
    { x: 210, y: 60, w: 70, v: 3.1 },
    { x: 320, y: 16, w: 110, v: 1.6 },
    { x: 120, y: 118, w: 80, v: 2.6 },
    { x: 290, y: 138, w: 120, v: 1.9 },
    { x: -60, y: 158, w: 95, v: 2.4 },
  ];
  let last = 0;
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (t - last < 80 || canvas.hidden) return;
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    const band = H / BANDS.length;
    BANDS.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, Math.floor(i * band), W, Math.ceil(band) + 1);
    });
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W + 10) c.x = -c.w - 10;
      cloud(ctx, c.x, c.y, c.w);
    }
    poles(ctx);
  };
  requestAnimationFrame(frame);
}
