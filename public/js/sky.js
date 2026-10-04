// Slow pixel-cloud drift in the side gutters keeps the menu illustration clear.
const PIXEL_SCALE = 3;
const CLOUD_ROWS = [
  '....####....',
  '..########..',
  '.##########.',
  '############',
  '############',
  '.##########.',
];

function drawCloud(ctx, cloud) {
  const cell = Math.max(3, Math.round(cloud.w / 12));
  const row = Math.round(cell * 1.2);
  const y = Math.round(cloud.y);

  ctx.globalAlpha = cloud.alpha * 0.58;
  ctx.fillStyle = '#82bde0';
  CLOUD_ROWS.forEach((mask, r) => {
    for (let c = 0; c < mask.length; c += 1) {
      if (mask[c] === '#') ctx.fillRect(Math.round(cloud.x + c * cell), y + r * row + row * 0.48, cell, row);
    }
  });

  ctx.globalAlpha = cloud.alpha;
  ctx.fillStyle = '#fff';
  CLOUD_ROWS.forEach((mask, r) => {
    for (let c = 0; c < mask.length; c += 1) {
      if (mask[c] === '#') ctx.fillRect(Math.round(cloud.x + c * cell), y + r * row, cell, row);
    }
  });
  ctx.globalAlpha = 1;
}

export function startSky(canvas) {
  const ctx = canvas.getContext('2d');
  let clouds = [];
  let gutters = { left: 0, right: 0 };
  let last = 0;
  let stale = false;

  const resize = () => {
    const width = Math.max(1, Math.ceil(window.innerWidth / PIXEL_SCALE));
    const height = Math.max(1, Math.ceil(window.innerHeight / PIXEL_SCALE));
    canvas.width = width;
    canvas.height = height;

    const stage = canvas.parentElement.querySelector('.cover-stage').getBoundingClientRect();
    // The cover is hidden (0x0): measure again when it shows.
    stale = !stage.width;
    if (stale) return;
    const scale = width / window.innerWidth;
    gutters = {
      left: Math.max(0, stage.left * scale),
      right: Math.min(width, stage.right * scale),
    };
    const leftWidth = gutters.left;
    const rightWidth = width - gutters.right;
    const leftCloudWidth = Math.max(14, Math.min(64, leftWidth * 0.86));
    const rightCloudWidth = Math.max(14, Math.min(64, rightWidth * 0.86));
    const seeds = [
      { side: 'left', x: 0.83, y: 0.09, w: leftCloudWidth, v: 4.2, a: 0.46 },
      { side: 'left', x: 0.18, y: 0.48, w: leftCloudWidth * 0.82, v: 2.7, a: 0.4 },
      { side: 'left', x: 0.83, y: 0.81, w: leftCloudWidth * 0.9, v: 3.4, a: 0.44 },
      { side: 'right', x: -0.16, y: 0.05, w: rightCloudWidth * 0.92, v: -3.1, a: 0.44 },
      { side: 'right', x: -0.16, y: 0.39, w: rightCloudWidth, v: -4.0, a: 0.46 },
      { side: 'right', x: -0.12, y: 0.53, w: rightCloudWidth * 0.74, v: -2.8, a: 0.34 },
      { side: 'right', x: -0.16, y: 0.83, w: rightCloudWidth * 0.9, v: -2.4, a: 0.42 },
    ];

    clouds = seeds.map((seed) => {
      const laneWidth = seed.side === 'left' ? leftWidth : rightWidth;
      const x = seed.side === 'left'
        ? seed.x * laneWidth
        : gutters.right + seed.x * laneWidth;
      return { ...seed, x, alpha: seed.a };
    });
    last = 0;
  };

  const frame = (time) => {
    requestAnimationFrame(frame);
    if (canvas.hidden) {
      last = time;
      return;
    }
    if (stale) resize();
    if (stale) return;

    const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
    last = time;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    const edgeBleed = Math.min(8, canvas.width * 0.012);
    ctx.rect(0, 0, gutters.left + edgeBleed, canvas.height);
    ctx.rect(gutters.right - edgeBleed, 0, canvas.width - gutters.right + edgeBleed, canvas.height);
    ctx.clip();

    for (const cloud of clouds) {
      cloud.x += cloud.v * dt;
      const minX = cloud.side === 'left' ? -cloud.w : gutters.right;
      const maxX = cloud.side === 'left' ? gutters.left : canvas.width;
      if (cloud.v > 0 && cloud.x > maxX) cloud.x = minX - cloud.w;
      if (cloud.v < 0 && cloud.x + cloud.w < minX) cloud.x = maxX;
      drawCloud(ctx, cloud);
    }
    ctx.restore();
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });
  requestAnimationFrame(frame);
}
