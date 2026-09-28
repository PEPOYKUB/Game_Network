import { hostIn, isIp, maskToPrefix, networkOf, broadcastOf, sameIp } from '../netutil.js';
import { line, ok, err, warn, dim, usageError } from '../terminal.js';

/** Shared `set ip` validation for stages 1 and 2. Returns output lines; applies state on success. */
export function applySetIp(ctx, onApplied) {
  const [addr, mask] = ctx.args;
  if (!addr || !mask) return usageError('set ip');
  if (!isIp(addr)) return [err(`ที่อยู่ IP "${addr}" ไม่ถูกต้อง (ต้องเป็นตัวเลข 4 ชุด 0–255 เช่น 192.168.1.20)`)];
  if (mask.startsWith('/') || /^\d{1,2}$/.test(mask)) {
    return [err('ใช้ subnet mask แบบ dotted decimal เช่น 255.255.255.0 (แปลง CIDR ได้ด้วย /help subnet)')];
  }
  const prefix = maskToPrefix(mask);
  if (prefix < 8 || prefix > 30) return [err(`Subnet mask "${mask}" ไม่ถูกต้อง (บิต 1 ต้องเรียงติดกันจากซ้าย)`)];
  if (addr === networkOf(addr, prefix) || addr === broadcastOf(addr, prefix)) {
    return [err(`${addr} เป็น network/broadcast address ของซับเน็ตนี้ ใช้เป็นที่อยู่โฮสต์ไม่ได้`)];
  }
  ctx.s.state.ip = addr;
  ctx.s.state.mask = mask;
  onApplied?.(addr, mask);
  return [ok(`IPv4 address configured: ${addr}  mask ${mask}`), dim('ตรวจสอบผลด้วย ipconfig')];
}

export default {
  id: 1,
  title: 'ที่อยู่ IP และซับเน็ต',
  topic: 'IP Address, Subnet Mask / CIDR',
  tier: 'Beginner',
  difficulty: 'ง่ายมาก',
  minutes: 3,
  optimal: 2,
  icon: 'ip',
  story: 'มีการเชื่อมต่อคอมพิวเตอร์เครื่องใหม่เข้ากับ LAN ของสำนักงาน ต้องตั้งค่าก่อนจึงจะเข้าถึงสิ่งใด ๆ ได้ ห้อง A นั่งอยู่หน้าเทอร์มินัล ส่วนห้อง B ถือเอกสารเครือข่ายอยู่',
  objective: 'เข้าใจว่าที่อยู่ IP และซับเน็ตมาสก์เป็นค่าตั้งค่าคู่กัน และฝึกใช้คำสั่งตั้งค่าพื้นฐานครั้งแรก',
  coop: 'ห้อง A มีเทอร์มินัลแต่ไม่มีข้อมูล ห้อง B มีข้อมูลแต่ไม่มีทางตั้งค่าได้ ทั้งสองฝ่ายต้องแลกเปลี่ยนที่อยู่ IP และซับเน็ตมาสก์กัน',

  generate(rng, sample) {
    let net;
    let host;
    const used = new Set([0, 1, 255]);
    if (sample) {
      net = '192.168.10.0';
      host = 15;
    } else {
      const kind = rng.int(0, 2);
      net = kind === 0 ? `192.168.${rng.int(2, 254)}.0` : kind === 1 ? `10.${rng.int(0, 254)}.${rng.int(0, 254)}.0` : `172.${rng.int(16, 31)}.${rng.int(0, 254)}.0`;
      host = rng.int(11, 240);
    }
    used.add(host);
    const next = (preferred) => {
      let h = sample ? preferred : rng.int(2, 250);
      while (used.has(h)) h = rng.int(2, 250);
      used.add(h);
      return h;
    };
    const printer = next(20);
    const server = next(30);
    const laptop = next(42);
    return {
      truth: { ip: hostIn(net, host), mask: '255.255.255.0' },
      state: { ip: null, mask: null },
      meta: { net, router: hostIn(net, 1), printer: hostIn(net, printer), server: hostIn(net, server), laptop: hostIn(net, laptop), host: hostIn(net, host) },
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'PC-NEW', prompt: 'PC-NEW>' }),
      commands: ['ipconfig', 'set ip'],
      hosts: () => [],
      see: ['เทอร์มินัลของพีซีเครื่องใหม่ (ยังไม่ได้ตั้งค่า)'],
      do: ['ถามห้อง B หาค่าที่ขาดหายไป', 'ตั้งค่าด้วย set ip <IP> <mask>', 'ยืนยันผลด้วย ipconfig'],
      docs: () => [
        { type: 'note', title: 'ใบงานติดตั้งเครื่อง', lines: ['เครื่อง: PC-NEW (เพิ่งเสียบสาย LAN)', 'สถานะ: ยังไม่ได้ตั้งค่า IP', 'ผังเครือข่ายอยู่ที่ห้อง B — ขอข้อมูลจากเพื่อน'] },
      ],
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['แผนผังเครือข่ายสำนักงาน (โปสเตอร์)'],
      do: ['อ่านแผนผังให้ละเอียด', 'บอกที่อยู่ IP ของอุปกรณ์ใหม่และ CIDR/มาสก์ให้ห้อง A'],
      docs: (s) => [
        {
          type: 'diagram',
          title: 'แผนผังเครือข่ายสำนักงาน',
          w: 8,
          h: 6,
          groups: [{ label: `LAN ${s.meta.net}/24`, x: 0.1, y: 1.3, w: 7.8, h: 4.6 }],
          nodes: [
            { id: 'net', kind: 'cloud', label: 'Internet', x: 4, y: 0.4 },
            { id: 'r', kind: 'router', label: 'Router', sub: s.meta.router, x: 4, y: 2.0 },
            { id: 'sw', kind: 'switch', label: 'Switch', x: 4, y: 3.5 },
            { id: 'p', kind: 'printer', label: 'Printer', sub: s.meta.printer, x: 1.0, y: 4.9 },
            { id: 'sv', kind: 'server', label: 'File server', sub: s.meta.server, x: 3.0, y: 4.9 },
            { id: 'lp', kind: 'laptop', label: 'Laptop-HR', sub: s.meta.laptop, x: 5.0, y: 4.9 },
            { id: 'pc', kind: 'pc', label: 'PC-NEW ★', sub: s.meta.host, x: 7.0, y: 4.9, hl: true },
          ],
          edges: [['net', 'r'], ['r', 'sw'], ['sw', 'p'], ['sw', 'sv'], ['sw', 'lp'], ['sw', 'pc']],
          caption: '★ = อุปกรณ์ใหม่ที่เพิ่งเชื่อมต่อ (ที่อยู่โฮสต์ที่กำหนดให้)',
        },
      ],
    },
  },

  handlers: {
    ipconfig(ctx) {
      const { state, truth } = ctx.s;
      const lines = [
        line('Ethernet adapter Ethernet0:'),
        line(`   IPv4 Address. . . . . . . : ${state.ip ?? '(none)'}`),
        line(`   Subnet Mask . . . . . . . : ${state.mask ?? '(none)'}`),
        line('   Default Gateway . . . . . : (none)'),
      ];
      if (!state.ip) return [...lines, warn('สถานะ: ยังไม่ได้ตั้งค่า IP — ใช้ set ip <addr> <mask>')];
      if (sameIp(state.ip, truth.ip) && state.mask === truth.mask) {
        ctx.pass();
        return [...lines, ok('Network status: CONNECTED — LAN ยอมรับที่อยู่นี้แล้ว ✔', 200)];
      }
      if (state.mask !== truth.mask) return [...lines, err('Network status: UNIDENTIFIED — มาสก์ไม่ตรงกับเครือข่ายของสำนักงาน', 200)];
      if (networkOf(state.ip, 24) !== ctx.s.meta.net) return [...lines, err('Network status: UNIDENTIFIED — ที่อยู่นี้ไม่ได้อยู่ในซับเน็ตของ LAN', 200)];
      return [...lines, err('Network status: CONFLICT — ที่อยู่นี้ไม่ใช่ที่อยู่ที่จัดสรรให้เครื่องนี้ในผังเครือข่าย', 200)];
    },
    'set ip'(ctx) {
      return applySetIp(ctx, (addr, mask) => {
        if (!(sameIp(addr, ctx.s.truth.ip) && mask === ctx.s.truth.mask)) ctx.wrong(`set ip ${addr} ${mask}`);
      });
    },
  },

  hints: () => [
    'ห้อง B ลองดูแผนผังให้ละเอียด — มีค่าหนึ่งที่ห้อง A ต้องการ',
    'คุณต้องการ IP และมาสก์ ใช้คำสั่ง set ip <IP> <mask> เพื่อตั้งค่า',
    'ซับเน็ตนี้คือ /24 (255.255.255.0) — ที่อยู่โฮสต์คือป้ายกำกับของอุปกรณ์ที่มีดาว ★ บนแผนผัง',
  ],

  explanation: (s) =>
    `ห้อง B อ่านแผนผังแล้วบอกที่อยู่โฮสต์ ${s.truth.ip} กับ CIDR /24 ห้อง A แปลง /24 เป็น 255.255.255.0 แล้วตั้งค่าด้วย set ip เซิร์ฟเวอร์ตรวจผลจาก ipconfig เทียบกับ ground truth`,
};
