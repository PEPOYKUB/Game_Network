// Pixel confetti burst for "System Link ONLINE".
const COLORS = ['#e2539b', '#fff07a', '#72e6d4', '#88e56b', '#8f4bc9', '#ffffff'];

export function renderConfetti(canvas) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const scale = 4;
  canvas.width = Math.ceil(window.innerWidth / scale);
  canvas.height = Math.ceil(window.innerHeight / scale);
  const ctx = canvas.getContext('2d');
  const bits = Array.from({ length: 140 }, (_, i) => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.3,
    y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 170,
    vy: -60 - Math.random() * 120,
    c: COLORS[i % COLORS.length],
    s: Math.random() < 0.3 ? 2 : 1,
  }));
  let last = performance.now();
  const end = last + 3200;
  const frame = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      b.vy += 140 * dt;
      b.vx *= 0.99;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      ctx.fillStyle = b.c;
      ctx.fillRect(Math.round(b.x), Math.round(b.y), b.s, b.s);
    }
    if (t < end) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  requestAnimationFrame(frame);
}
