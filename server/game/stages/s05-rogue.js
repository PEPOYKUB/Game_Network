import { line, ok, err, warn, dim, table, usageError } from '../terminal.js';

const DEPTS = ['Sales', 'HR', 'Acct', 'Ops', 'Mkt'];

function findPort(ports, input) {
  const want = String(input || '').toLowerCase().replace(/^fastethernet/, 'fa');
  return ports.find((p) => p.port.toLowerCase() === want);
}

export default {
  id: 5,
  title: 'การตรวจจับอุปกรณ์แปลกปลอม (Rogue Device)',
  topic: 'ตาราง MAC ของสวิตช์, ความปลอดภัยเครือข่ายพื้นฐาน',
  tier: 'Intermediate',
  difficulty: 'ปานกลาง',
  minutes: 7,
  optimal: 5,
  icon: 'rogue',
  story: 'ผู้ดูแลระบบสงสัยว่ามีอุปกรณ์ไม่ได้รับอนุญาตเสียบเข้ากับสวิตช์',
  objective: 'เปรียบเทียบผลจาก show mac-address-table กับทะเบียนอุปกรณ์ที่ได้รับอนุญาต แล้วใช้คำสั่งตั้งค่าเพื่อตัดการเชื่อมต่อจริง',
  coop: 'ตารางของห้อง A แสดงสิ่งที่เสียบอยู่จริง ทะเบียนของห้อง B แสดงสิ่งที่ควรจะเสียบอยู่ มีเพียงความแตกต่างเท่านั้นที่เปิดเผยผู้บุกรุก',

  generate(rng, sample) {
    let ports;
    let registry;
    let rogue;
    if (sample) {
      const prefix = '00:1A:2B:3C:4D';
      const tails = ['01', '02', '03', '9F', '05', '06', '07'];
      ports = tails.map((t, i) => ({ port: `Fa0/${i + 1}`, mac: `${prefix}:${t}` }));
      registry = [
        ['PC-Sales01', '01'], ['PC-Sales02', '02'], ['PC-Sales03', '03'], ['Printer-Sales', '04'],
        ['PC-Sales05', '05'], ['PC-Sales06', '06'], ['PC-Sales07', '07'],
      ].map(([name, t]) => ({ name, mac: `${prefix}:${t}` }));
      rogue = 'Fa0/4';
    } else {
      const prefix = [rng.hex(), rng.hex(), rng.hex(), rng.hex(), rng.hex()].join(':');
      const dept = rng.pick(DEPTS);
      const rogueIdx = rng.int(0, 6);
      const tails = rng.distinct(8, 1, 250).map((n) => n.toString(16).toUpperCase().padStart(2, '0'));
      const absentTail = tails[7];
      // The rogue MAC is a near-miss of the authorised-but-unplugged printer (nibbles swapped).
      let rogueTail = absentTail.split('').reverse().join('');
      if (rogueTail === absentTail || tails.includes(rogueTail)) rogueTail = rng.pick(['9F', 'F9', 'E1', '1E', 'C3', '3C'].filter((t) => !tails.includes(t)));
      ports = tails.slice(0, 7).map((t, i) => ({ port: `Fa0/${i + 1}`, mac: `${prefix}:${i === rogueIdx ? rogueTail : t}` }));
      registry = tails.slice(0, 7).map((t, i) => (i === rogueIdx ? { name: `Printer-${dept}`, mac: `${prefix}:${absentTail}` } : { name: `PC-${dept}${String(i + 1).padStart(2, '0')}`, mac: `${prefix}:${t}` }));
      registry = rng.shuffle(registry);
      rogue = `Fa0/${rogueIdx + 1}`;
    }
    return {
      truth: { rogue },
      state: { down: [] },
      meta: { ports, registry },
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'SW-ACCESS', prompt: 'SW-ACCESS#' }),
      commands: ['show mac-address-table', 'disconnect port', 'connect port'],
      hosts: (s) => s.meta.ports.map((p) => p.port),
      see: ['เทอร์มินัลของสวิตช์ (ตาราง MAC)'],
      do: ['อ่านทุกพอร์ต/MAC ให้ห้อง B', 'เมื่อระบุพอร์ตแปลกปลอมได้ ใช้ disconnect port <port>', 'รัน show mac-address-table ซ้ำเพื่อยืนยัน'],
      docs: () => [{ type: 'note', title: 'แจ้งเตือนจากระบบ', lines: ['พบ MAC ใหม่บนสวิตช์ชั้น 3 เมื่อ 09:12', 'ห้ามตัดเครื่องที่ได้รับอนุญาต — ทำให้ผู้ใช้งานหลุด'] }],
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['ทะเบียนอุปกรณ์ที่ได้รับอนุญาต'],
      do: ['ตรวจ MAC แต่ละตัวที่ห้อง A อ่านมากับทะเบียน', 'รายงานว่า MAC ใดไม่มีรายการตรงกัน'],
      docs: (s) => [
        {
          type: 'table',
          title: 'ทะเบียนอุปกรณ์ที่ได้รับอนุญาต (Authorized Devices)',
          head: ['อุปกรณ์', 'MAC address'],
          rows: s.meta.registry.map((d) => [d.name, d.mac]),
          note: 'อุปกรณ์ในทะเบียนอาจไม่ได้เสียบอยู่ทุกเครื่อง',
        },
      ],
    },
  },

  handlers: {
    'show mac-address-table'(ctx) {
      const { meta, state, truth } = ctx.s;
      const rows = meta.ports.map((p) => (state.down.includes(p.port) ? ['  1', '(no device connected)', '-', p.port] : ['  1', p.mac, 'DYNAMIC', p.port]));
      const lines = [line('          Mac Address Table'), line('-------------------------------------------'), ...table(['Vlan', 'Mac Address', 'Type', 'Ports'], rows, [7, 22, 10, 6])];
      const legitDown = state.down.filter((p) => p !== truth.rogue);
      if (state.down.includes(truth.rogue) && legitDown.length === 0) {
        ctx.pass();
        lines.push(ok('✔ ทุก MAC ที่เชื่อมต่ออยู่ตรงกับทะเบียนแล้ว', 200));
      } else if (legitDown.length) {
        lines.push(warn(`⚠ พอร์ตที่ถูกปิดอยู่: ${legitDown.join(', ')} — ถ้าเป็นเครื่องที่ได้รับอนุญาตให้เปิดกลับด้วย connect port`, 200));
      }
      return lines;
    },
    'disconnect port'(ctx) {
      const { meta, state, truth } = ctx.s;
      if (!ctx.args[0]) return usageError('disconnect port');
      const p = findPort(meta.ports, ctx.args[0]);
      if (!p) return [err(`% Invalid interface "${ctx.args[0]}" (พอร์ตที่มี: Fa0/1 – Fa0/${meta.ports.length})`)];
      if (state.down.includes(p.port)) return [warn(`% ${p.port} ถูกปิดอยู่แล้ว`)];
      state.down.push(p.port);
      if (p.port !== truth.rogue) ctx.wrong(`disconnect port ${p.port}`);
      return [
        ok(`%LINK-5-CHANGED: Interface ${p.port}, changed state to administratively down`),
        line(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${p.port}, changed state to down`),
        dim('ยืนยันด้วย show mac-address-table'),
      ];
    },
    'connect port'(ctx) {
      const { meta, state } = ctx.s;
      if (!ctx.args[0]) return usageError('connect port');
      const p = findPort(meta.ports, ctx.args[0]);
      if (!p) return [err(`% Invalid interface "${ctx.args[0]}"`)];
      if (!state.down.includes(p.port)) return [warn(`% ${p.port} เปิดใช้งานอยู่แล้ว`)];
      state.down = state.down.filter((x) => x !== p.port);
      return [ok(`%LINK-3-UPDOWN: Interface ${p.port}, changed state to up`)];
    },
  },

  hints: (s) => [
    'ไล่ดูรายการทีละพอร์ตร่วมกับห้อง B — จะมีพอร์ตหนึ่งที่ไม่มีรายการตรงกัน',
    'ใช้ disconnect port <พอร์ต> เมื่อพบพอร์ตที่ MAC ไม่ตรงกับทะเบียนเลย (ระวัง MAC ที่ต่างกันแค่สลับตัวอักษร)',
    `ตรวจพอร์ต ${s.truth.rogue} กับทุกรายการในทะเบียนโดยเฉพาะ`,
  ],

  explanation: (s) => {
    const rogue = s.meta.ports.find((p) => p.port === s.truth.rogue);
    return `MAC ทุกพอร์ตมีรายการตรงกันในทะเบียน ยกเว้น ${rogue.port} ซึ่ง ${rogue.mac} ไม่ปรากฏในทะเบียนเลย (MAC ที่คล้ายกันในทะเบียนเป็นเครื่องพิมพ์ที่ไม่ได้เสียบอยู่ ไม่ใช่ตัวเดียวกัน)`;
  },
};
