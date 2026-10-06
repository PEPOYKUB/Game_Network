// Shared collision and interaction geometry. A 1000-unit world preserves each
// illustration's aspect ratio on both the client and the authoritative server.
export const WALK_SPEED = 145;
export const PLAYER_RADIUS = 8;
export const INTERACT_RADIUS = 56;

// Geometry is measured in source-image pixels for each pastel map (size), then
// normalised so the client and the server share the same walkable layout.
// stations: [standX, standY, screenX, screenY] — players stand on reachable
// floor in front of the computer; the E marker floats over its screen.
const ROOMS = [
  {
    name: 'THE LOST LAB', subtitle: 'ห้องทดลองที่ถูกตัดการเชื่อมต่อ', file: '/assets/levels/map-01-pastel.png', size: [1504, 1046],
    floor: [48, 312, 1460, 966], split: [660, 848], passage: [402, 564],
    spawn: { A: [405, 425], B: [1060, 470] },
    stations: { A: [[305, 768, 305, 548]], B: [[1142, 718, 1210, 470]] },
    obstacles: [[50, 330, 185, 135], [160, 545, 315, 195], [48, 820, 68, 146], [540, 810, 120, 156],
      [850, 578, 150, 207], [1128, 455, 164, 235], [1170, 712, 62, 78], [1362, 462, 98, 433], [848, 862, 612, 104]],
  },
  {
    name: 'THE GREENHOUSE', subtitle: 'ระบบเครือข่ายของห้องชีวภาพ', file: '/assets/levels/map-02-pastel.png', size: [1504, 1046],
    floor: [42, 312, 1460, 958], split: [648, 852], passage: [664, 848],
    spawn: { A: [260, 385], B: [1150, 455] },
    stations: { A: [[528, 338, 525, 160]], B: [[1338, 572, 1338, 385]] },
    obstacles: [[168, 455, 244, 170], [418, 410, 222, 218], [42, 705, 358, 253], [465, 782, 62, 88], [438, 880, 138, 78],
      [1245, 300, 213, 28], [903, 410, 42, 262], [903, 410, 117, 85], [1085, 625, 158, 90], [1250, 355, 178, 193],
      [1362, 688, 78, 260], [1315, 870, 125, 78], [908, 810, 297, 142]],
  },
  {
    name: 'THE CONTROL ROOM', subtitle: 'ศูนย์ควบคุมเส้นทางและบริการ', file: '/assets/levels/map-03-pastel.png', size: [1587, 991],
    floor: [50, 205, 1535, 916], split: [678, 900], passage: [368, 468],
    spawn: { A: [590, 335], B: [1250, 300] },
    stations: { A: [[322, 476, 315, 320]], B: [[1360, 766, 1380, 628]] },
    obstacles: [[68, 195, 50, 57], [620, 200, 45, 58], [245, 200, 200, 25], [135, 268, 380, 172], [140, 438, 65, 38], [445, 438, 62, 38],
      [165, 513, 320, 55], [300, 568, 65, 350], [143, 585, 134, 140], [143, 750, 134, 155], [390, 582, 195, 128],
      [340, 750, 260, 166], [598, 750, 69, 155],
      [925, 195, 135, 22], [1090, 195, 210, 25], [1435, 195, 43, 13], [982, 293, 151, 112], [900, 495, 62, 130], [1070, 530, 145, 210],
      [922, 660, 123, 190], [1302, 365, 233, 235], [1310, 600, 85, 140], [1440, 605, 80, 115], [900, 878, 635, 38]],
  },
  {
    name: 'THE NETWORK CORE', subtitle: 'กู้คืนแกนกลางเครือข่าย', file: '/assets/levels/map-04-pastel.png', size: [1594, 987],
    floor: [42, 330, 1552, 930], split: [670, 922], passage: [500, 632],
    spawn: { A: [205, 385], B: [1050, 405] },
    stations: { A: [[470, 588, 470, 445], [485, 868, 485, 722]], B: [[1285, 604, 1280, 462]] },
    obstacles: [[97, 443, 213, 197], [97, 710, 213, 198], [390, 418, 162, 147], [405, 695, 160, 150],
      [1155, 425, 265, 155], [1408, 365, 89, 105], [1128, 728, 100, 62], [1190, 775, 210, 155], [1420, 822, 48, 93], [948, 662, 68, 55]],
  },
];

export function levelForStage(stageId) {
  const value = Number(stageId);
  const index = Number.isFinite(value) ? Math.min(3, Math.max(0, Math.floor((value - 1) / 3))) : 0;
  const raw = ROOMS[index];
  const [iw, ih] = raw.size, width = 1000, height = width * ih / iw, k = width / iw;
  const point = ([x, y]) => ({ x: x * k, y: y * k });
  return {
    ...raw, index: index + 1, width, height,
    floor: { left: raw.floor[0] * k, top: raw.floor[1] * k, right: raw.floor[2] * k, bottom: raw.floor[3] * k },
    split: raw.split.map((x) => x * k), passage: raw.passage.map((y) => y * k),
    spawn: Object.fromEntries(Object.entries(raw.spawn).map(([r, p]) => [r, point(p)])),
    stations: Object.fromEntries(Object.entries(raw.stations).map(([r, stations]) => [r, stations.map(([x, y, sx, sy]) => ({ ...point([x, y]), screen: point([sx, sy]) }))])),
    obstacles: raw.obstacles.map(([x, y, w, h]) => ({ x: x * k, y: y * k, w: w * k, h: h * k })),
  };
}

export function spawnPlayer(stageId, role) {
  return { ...levelForStage(stageId).spawn[role], facing: role === 'A' ? 1 : -1, direction: 'front', moving: false, terminal: false, input: null };
}

export function canStand(level, role, x, y, online = false) {
  const r = PLAYER_RADIUS, f = level.floor;
  if (x - r < f.left || x + r > f.right || y - r < f.top || y + r > f.bottom) return false;
  const [a, b] = level.split;
  if (!online && (role === 'A' ? x + r > a : x - r < b)) return false;
  if (x + r > a && x - r < b && (y - r < level.passage[0] || y + r > level.passage[1])) return false;
  return !level.obstacles.some((o) => x + r > o.x && x - r < o.x + o.w && y + r > o.y && y - r < o.y + o.h);
}

export function movePlayer(level, role, player, input, dt, online = false) {
  const dx = Number.isFinite(input?.x) ? Math.max(-1, Math.min(1, input.x)) : 0;
  const dy = Number.isFinite(input?.y) ? Math.max(-1, Math.min(1, input.y)) : 0;
  const length = Math.hypot(dx, dy);
  const next = { ...player, moving: false };
  if (!length || player.terminal) return next;
  const distance = WALK_SPEED * Math.min(Math.max(dt, 0), .1);
  const steps = Math.max(1, Math.ceil(distance / 4));
  const vx = dx / length * distance / steps, vy = dy / length * distance / steps;
  if (dx) next.facing = dx > 0 ? 1 : -1;
  next.direction = Math.abs(dy) >= Math.abs(dx) && dy ? (dy > 0 ? 'front' : 'back') : (dx > 0 ? 'right' : 'left');
  for (let i = 0; i < steps; i++) {
    if (canStand(level, role, next.x + vx, next.y, online)) next.x += vx;
    if (canStand(level, role, next.x, next.y + vy, online)) next.y += vy;
  }
  next.moving = Math.hypot(next.x - player.x, next.y - player.y) > .01;
  return next;
}

export function nearbyComputer(level, role, player) {
  if (!player) return null;
  return level.stations[role]?.find((s) => Math.hypot(s.x - player.x, s.y - player.y) <= INTERACT_RADIUS) || null;
}
