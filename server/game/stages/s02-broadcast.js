import { intToIp, ipToInt, prefixToMask, maskToPrefix, networkOf, broadcastOf, sameIp } from '../netutil.js';
import { line, ok, err, warn } from '../terminal.js';
import { applySetIp } from './s01-ip.js';

const SEGMENTS = ['IT-DOCS', 'LAB-NET', 'ADMIN-OPS', 'MEDIA-LAB', 'DEV-TEAM'];

export default {
  id: 2,
  title: 'ที่อยู่เครือข่ายและที่อยู่บรอดคาสต์',
  topic: 'Network Address, Broadcast Address',
  tier: 'Beginner',
  difficulty: 'ง่าย',
  minutes: 4,
  optimal: 3,
  icon: 'calc',
  story: 'ฝ่าย IT กำลังจัดทำเอกสารเซกเมนต์เครือข่ายใหม่ ต้องตั้งค่า IP ให้ถูกต้องก่อน ระบบจะคำนวณ Network/Broadcast Address ให้อัตโนมัติจากค่าที่ตั้ง',
  objective: 'เรียนรู้การคำนวณที่อยู่เครือข่ายและบรอดคาสต์จากคู่ IP + มาสก์ และอ่านผลจาก ipconfig ที่ละเอียดขึ้น',
  coop: 'ห้อง A มี IP แต่ไม่มีมาสก์ ห้อง B มีมาสก์แต่ไม่รู้ว่าอุปกรณ์อยู่เซกเมนต์ไหน ต้องมีทั้งสองค่าก่อนจึงจะตั้งค่าและคำนวณได้',

  generate(rng, sample) {
    let ip;
    let prefix;
    let segment;
    let a;
    let b;
    if (sample) {
      ip = '10.0.4.60';
      prefix = 26;
      segment = 'IT-DOCS';
    } else {
      prefix = rng.pick([25, 26, 27, 28]);
      a = rng.int(0, 254);
      b = rng.int(0, 254);
      const block = 2 ** (32 - prefix);
      const start = rng.int(0, 256 / block - 1) * block;
      ip = `10.${a}.${b}.${start + rng.int(1, block - 2)}`;
      segment = rng.pick(SEGMENTS);
    }
    // Other segments on the planning sheet use different masks so B has to pick the right row.
    const others = SEGMENTS.filter((x) => x !== segment);
    const otherPrefixes = [24, 25, 26, 27, 28, 29].filter((p) => p !== prefix);
    const rows = [
      { name: segment, prefix },
      { name: others[0], prefix: sample ? 24 : rng.pick(otherPrefixes) },
      { name: others[1], prefix: sample ? 28 : rng.pick(otherPrefixes) },
    ];
    const vlans = [40, 50, 60];
    const sheet = (sample ? rows : rng.shuffle(rows)).map((r, i) => ({ ...r, vlan: vlans[i] }));
    return {
      truth: { ip, mask: prefixToMask(prefix), network: networkOf(ip, prefix), broadcast: broadcastOf(ip, prefix) },
      state: { ip: null, mask: null },
      meta: { ip, segment, sheet },
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'PC-DOCS', prompt: 'PC-DOCS>' }),
      commands: ['ipconfig', 'set ip'],
      hosts: () => [],
      see: ['เทอร์มินัลของพีซี และบันทึกที่อยู่ IP ของอุปกรณ์'],
      do: ['ถามห้อง B หา subnet mask ของเซกเมนต์', 'ตั้งค่าด้วย set ip <IP> <mask>', 'รัน ipconfig ดู Network/Broadcast Address ที่ระบบคำนวณ'],
      docs: (s) => [
        {
          type: 'kv',
          title: 'บันทึกฝ่าย IT',
          rows: [
            ['อุปกรณ์', 'PC-DOCS'],
            ['เซกเมนต์', s.meta.segment],
            ['ที่อยู่ IP ที่จัดสรร', s.meta.ip],
            ['Subnet mask', '(ต้องตั้งเอง — ดูแผนซับเน็ตที่ห้อง B)'],
          ],
        },
      ],
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['แผ่นวางแผนซับเน็ตของทุกเซกเมนต์'],
      do: ['ถามห้อง A ว่าอุปกรณ์อยู่เซกเมนต์ไหน', 'บอก subnet mask ให้ห้อง A', 'ช่วยคำนวณ/ตรวจ Network และ Broadcast Address'],
      docs: (s) => [
        {
          type: 'table',
          title: 'แผ่นวางแผนซับเน็ต (Subnet Plan)',
          head: ['เซกเมนต์', 'VLAN', 'Subnet mask', 'CIDR'],
          rows: s.meta.sheet.map((r) => [r.name, String(r.vlan), prefixToMask(r.prefix), `/${r.prefix}`]),
        },
        {
          type: 'table',
          title: 'ตารางอ้างอิงขนาดบล็อก',
          head: ['CIDR', 'Mask', 'ที่อยู่ต่อบล็อก'],
          rows: [24, 25, 26, 27, 28, 29].map((p) => [`/${p}`, prefixToMask(p), String(2 ** (32 - p))]),
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
      ];
      if (!state.ip) return [...lines, warn('สถานะ: ยังไม่ได้ตั้งค่า — ใช้ set ip <addr> <mask>')];
      const prefix = maskToPrefix(state.mask);
      const net = networkOf(state.ip, prefix);
      const bc = broadcastOf(state.ip, prefix);
      lines.push(
        line(`   Network Address . . . . . : ${net}`),
        line(`   Broadcast Address . . . . : ${bc}`),
        line(`   Usable hosts. . . . . . . : ${intToIp(ipToInt(net) + 1)} - ${intToIp(ipToInt(bc) - 1)}`),
      );
      if (sameIp(state.ip, truth.ip) && state.mask === truth.mask) {
        ctx.pass();
        return [...lines, ok('Segment registration: OK — ค่าตรงกับแผนซับเน็ต ✔', 200)];
      }
      if (!sameIp(state.ip, truth.ip)) return [...lines, err('Segment registration: FAILED — ที่อยู่ IP ไม่ตรงกับที่จัดสรรให้อุปกรณ์', 200)];
      return [...lines, err('Segment registration: FAILED — ขอบเขตซับเน็ตไม่ตรงกับแผนของเซกเมนต์นี้', 200)];
    },
    'set ip'(ctx) {
      return applySetIp(ctx, (addr, mask) => {
        if (!(sameIp(addr, ctx.s.truth.ip) && mask === ctx.s.truth.mask)) ctx.wrong(`set ip ${addr} ${mask}`);
      });
    },
  },

  hints: (s) => {
    const prefix = maskToPrefix(s.truth.mask);
    return [
      'คุณต้องการทั้ง IP และมาสก์ถึงจะตั้งค่าได้ — มีครบหรือยัง? ห้อง B ต้องรู้ชื่อเซกเมนต์จากห้อง A',
      `มาสก์ /${prefix} แบ่ง /24 เป็นบล็อกละ ${2 ** (32 - prefix)} ที่อยู่ ใช้ set ip แล้วดูผลจาก ipconfig`,
      `${s.truth.ip} กับ /${prefix} อยู่ในช่วง ${s.truth.network}–${s.truth.broadcast}`,
    ];
  },

  explanation: (s) => {
    const prefix = maskToPrefix(s.truth.mask);
    return `/${prefix} แบ่งเป็นบล็อกละ ${2 ** (32 - prefix)} ที่อยู่ ${s.truth.ip} อยู่ในบล็อก ${s.truth.network}–${s.truth.broadcast} เมื่อห้อง A ตั้งมาสก์ ${s.truth.mask} ถูกต้อง ระบบจึงคำนวณ Network/Broadcast ให้ผ่าน ipconfig`;
  },
};
