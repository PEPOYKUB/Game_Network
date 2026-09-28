// Character sprite sheets (built from the designers' art by tools/build_assets.py) and pixel icons.

let manifest = null;
const images = {};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadSprites(onProgress) {
  manifest = await fetch('/assets/manifest.json').then((r) => r.json());
  const chars = manifest.characters.chars;
  let done = 0;
  await Promise.all(
    chars.map((c) =>
      loadImage(c.file).then((img) => {
        images[c.id] = img;
        onProgress?.(++done / chars.length);
      }),
    ),
  );
}

export const characters = () => manifest?.characters.chars ?? [];
export const frameSize = () => (manifest ? { w: manifest.characters.frameW, h: manifest.characters.frameH } : { w: 25, h: 53 });
export const charName = (id) => characters().find((c) => c.id === id)?.name ?? id;

export function drawChar(ctx, id, frame, x, y, flip = false) {
  const img = images[id] || images.ping;
  if (!img) return;
  const { w, h } = frameSize();
  ctx.save();
  if (flip) {
    ctx.translate(Math.round(x) + w, Math.round(y));
    ctx.scale(-1, 1);
    ctx.drawImage(img, (frame % 2) * w, 0, w, h, 0, 0, w, h);
  } else {
    ctx.drawImage(img, (frame % 2) * w, 0, w, h, Math.round(x), Math.round(y), w, h);
  }
  ctx.restore();
}

/** Paints one frame into a small canvas element (CSS scales it up with pixelated rendering). */
export function paintChar(canvas, id, frame = 0) {
  if (!manifest) return;
  const { w, h } = frameSize();
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  drawChar(ctx, id, frame, 0, 0);
}

// ---- Pixel icons (12x12 grids) --------------------------------------------
const PAL = {
  k: '#2a2140', w: '#ffffff', s: '#b9b3c9', d: '#6f6789', p: '#e2539b', y: '#fff07a', t: '#72e6d4',
  g: '#88e56b', b: '#5c9ccc', r: '#ff5d73', u: '#8f4bc9', o: '#f7a452', n: '#c58d52',
};

const ICONS = {
  ip: ['............', '.kkkkkkkkkk.', '.kbbbbbbbbk.', '.kbwbwwbbbk.', '.kbwbwbwbbk.', '.kbwbwwbbbk.', '.kbwbwbbbbk.', '.kbbbbbbbbk.', '.kkkkkkkkkk.', '....kkkk....', '..kkkkkkkk..', '............'],
  calc: ['..kkkkkkkk..', '..kddddddk..', '..kdttttdk..', '..kdttttdk..', '..kddddddk..', '..kdwdwdwk..', '..kddddddk..', '..kdwdwdwk..', '..kddddddk..', '..kdwdwdpk..', '..kddddddk..', '..kkkkkkkk..'],
  gateway: ['....kkkk....', '..kkuuuukk..', '.kuuuuuuuuk.', '.kuukkkkuuk.', '.kukyyyykuk.', '.kukyyyykuk.', '.kukyyykkuk.', '.kukyyyykuk.', '.kukyyyykuk.', '.kukyyyykuk.', 'kkkkkkkkkkkk', '............'],
  arp: ['kkkkkkkkkkkk', 'ktttttkppppk', 'kkkkkkkkkkkk', 'kwwwwwkwwwwk', 'kkkkkkkkkkkk', 'kwwwwwkwwwwk', 'kkkkkkkkkkkk', 'kwwwwwkwwwwk', 'kkkkkkkkkkkk', '............', '............', '............'],
  rogue: ['...kkkkkk...', '..kwwwwwwk..', '.kwwwwwwwwk.', '.kwkkwwkkwk.', '.kwkrwwkrwk.', '.kwwwwwwwwk.', '..kwwkkwwk..', '..kwwwwwwk..', '...kwkwkk...', '...kkkkkk...', '............', '............'],
  vlan: ['.tt..yy..pp.', '.tt..yy..pp.', '.tt..yy..pp.', '.tt..yy..pp.', '.tt..yy..pp.', 'kkkkkkkkkkkk', 'kddddddddddk', 'kdkkdkkdkkdk', 'kddddddddddk', 'kkkkkkkkkkkk', '............', '............'],
  route: ['kkk.........', 'kgkkkkkkk...', 'kkk.....k...', '........k...', '...kkkkkk...', '...k........', '...k........', '...kkkkkkkkk', '.........krk', '.........kkk', '............', '............'],
  static: ['............', '.kkkkkkkk...', '.kggggggkk..', '.kgwwwwggkk.', '.kggggggwggk', '.kgwwwwggkk.', '.kggggggkk..', '.kkkkkkkk...', '....kk......', '....kk......', '....kk......', '..kkkkkk....'],
  dns: ['....kkkk....', '..kkbttbkk..', '.kbbtttbbbk.', '.ktttbbbttk.', 'kttbbbbbtttk', 'kkkkkkkkkkkk', 'kbbtttbbbbtk', '.kbbbtttbbk.', '.kbbbbttbbk.', '..kkbbbbkk..', '....kkkk....', '............'],
  packet: ['............', '............', 'kkkkkkkkkkkk', 'kwkwwwwwwkwk', 'kwwkwwwwkwwk', 'kwwwkwwkwwwk', 'kwwwwkkwwwwk', 'kwwwwwwwwwwk', 'kwwwwwwwwwwk', 'kkkkkkkkkkkk', '............', '............'],
  wrench: ['.........kk.', '........ksk.', '.......ksk..', '......ksk...', '.....ksk....', '....ksk.....', '...ksk......', '..kssk......', '.ksssk......', 'ksskk.......', 'ksk.........', '.k..........'],
  alarm: ['.....kk.....', '...k.kk.k...', '....k..k....', '...kkkkkk...', '..krrrrrrk..', '..krwrrrrk..', '..krwrrrrk..', '..krrrrrrk..', '.kkkkkkkkkk.', '.kddddddddk.', '.kkkkkkkkkk.', '............'],
  router: ['............', '....kkkk....', '..kkbbbbkk..', '.kbbbwwbbbk.', '.kbwbbbbwbk.', '.kwwwbbwwwk.', '.kbwbbbbwbk.', '.kbbbwwbbbk.', '..kkbbbbkk..', '....kkkk....', '............', '............'],
  switch: ['............', '............', '............', 'kkkkkkkkkkkk', 'kttttttttttk', 'ktkktkktkktk', 'kttttttttttk', 'kkkkkkkkkkkk', '.k........k.', '............', '............', '............'],
  server: ['...kkkkkk...', '...kssssk...', '...kddddk...', '...kssssk...', '...kgsssk...', '...kddddk...', '...kssssk...', '...kgsssk...', '...kddddk...', '...kssssk...', '...kkkkkk...', '............'],
  printer: ['............', '....kkkk....', '....kwwk....', '..kkkkkkkk..', '.kssssssssk.', '.kssssssgsk.', '.kssssssssk.', '.kkkwwwwkkk.', '...kwkkwk...', '...kwwwwk...', '...kkkkkk...', '............'],
  laptop: ['............', '............', '..kkkkkkkk..', '..kttttttk..', '..kttttttk..', '..kttttttk..', '..kkkkkkkk..', '.kssssssssk.', 'kkkkkkkkkkkk', '............', '............', '............'],
  cloud: ['............', '............', '....kkk.....', '...kwwwk....', '..kwwwwwkk..', '.kkwwwwwwwk.', 'kwwwwwwwwwwk', 'kwwwwwwwwwwk', '.kkkkkkkkkk.', '............', '............', '............'],
  pc: ['............', '.kkkkkkkkkk.', '.kttttttttk.', '.ktwwtttttk.', '.kttttttttk.', '.kttttttttk.', '.kkkkkkkkkk.', '.....kk.....', '...kkkkkk...', '............', '............', '............'],
};

const iconCache = {};

export function iconUrl(name, scale = 4) {
  const key = `${name}@${scale}`;
  if (iconCache[key]) return iconCache[key];
  const grid = ICONS[name] || ICONS.pc;
  const c = document.createElement('canvas');
  c.width = 12 * scale;
  c.height = 12 * scale;
  const ctx = c.getContext('2d');
  grid.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (PAL[ch]) {
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }),
  );
  iconCache[key] = c.toDataURL();
  return iconCache[key];
}
