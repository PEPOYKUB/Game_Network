import { line, ok, err, dim, table, usageError, pingReply, pingTimeout, pingUnknownHost } from '../terminal.js';

const VLANS = { 10: 'นักเรียน (Student)', 20: 'พนักงาน (Staff)', 30: 'เซิร์ฟเวอร์ (Server)' };
const ROLE_VLAN = { Student: 10, Staff: 20, Server: 30 };

export default {
  id: 6,
  title: 'การตั้งค่า VLAN ผิดพลาด',
  topic: 'VLAN',
  tier: 'Intermediate',
  difficulty: 'ปานกลาง+',
  minutes: 8,
  optimal: 5,
  icon: 'vlan',
  story: 'สำนักงานมี VLAN 10 (นักเรียน), 20 (พนักงาน), 30 (เซิร์ฟเวอร์) มีอุปกรณ์สองเครื่องถูกกำหนด VLAN สลับกัน',
  objective: 'ระบุพอร์ตที่ถูกกำหนด VLAN ผิด แล้วแก้ด้วย set vlan และยืนยันด้วย ping ข้าม VLAN',
  coop: 'ห้อง A เห็นสิ่งที่สวิตช์ทำอยู่ปัจจุบัน ห้อง B เห็นสิ่งที่ควรจะเป็น มีความไม่ตรงกันมากกว่าหนึ่งจุด ต้องตรวจทุกแถวร่วมกัน',

  generate(rng, sample) {
    let devices;
    if (sample) {
      devices = [
        ['Student-Laptop-A', 'Student'], ['Staff-PC-B', 'Staff'], ['Student-Laptop-C', 'Student'], ['Server-DB', 'Server'], ['Staff-PC-D', 'Staff'],
      ].map(([label, role], i) => ({ id: `Device-${i + 1}`, port: `Gi0/${i + 1}`, label, expected: ROLE_VLAN[role] }));
    } else {
      const roles = rng.shuffle(['Student', 'Student', 'Staff', 'Staff', 'Server', rng.pick(['Student', 'Staff'])]);
      const letters = rng.sample(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], roles.length);
      const kinds = { Student: 'Student-Laptop', Staff: 'Staff-PC', Server: 'Server' };
      devices = roles.map((role, i) => ({ id: `Device-${i + 1}`, port: `Gi0/${i + 1}`, label: `${kinds[role]}-${letters[i]}`, expected: ROLE_VLAN[role] }));
    }
    // Swap the VLANs of one student port and one staff port.
    const students = devices.filter((d) => d.expected === 10);
    const staff = devices.filter((d) => d.expected === 20);
    const a = sample ? devices[1] : rng.pick(staff);
    const b = sample ? devices[2] : rng.pick(students);
    const vlan = Object.fromEntries(devices.map((d) => [d.port, d.expected]));
    vlan[a.port] = b.expected;
    vlan[b.port] = a.expected;
    return {
      truth: { vlan: Object.fromEntries(devices.map((d) => [d.port, d.expected])), swapped: [a.id, b.id] },
      state: { vlan },
      meta: { devices },
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'SW-CORE', prompt: 'SW-CORE#' }),
      commands: ['show vlan', 'set vlan', 'ping'],
      hosts: (s) => [...s.meta.devices.map((d) => d.id), ...s.meta.devices.map((d) => d.port)],
      see: ['เทอร์มินัลของสวิตช์ (VLAN ของแต่ละพอร์ต)'],
      do: ['รายงาน VLAN ทุกพอร์ตให้ห้อง B', 'แก้พอร์ตที่ผิดด้วย set vlan <port> <id>', 'ยืนยันด้วย ping <Device-n> ไปยังอุปกรณ์ที่แก้แล้ว'],
      docs: () => [{ type: 'note', title: 'แจ้งปัญหา', lines: ['ผู้ใช้สองคนบอกว่า "ต่อ Wi-Fi/สาย LAN ได้ แต่เข้าอะไรไม่ได้เลย"', 'ping <Device-n> จากสวิตช์ได้เพื่อทดสอบ gateway ของ VLAN'] }],
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['บัญชีรายชื่ออุปกรณ์พร้อม VLAN ที่คาดหวัง'],
      do: ['เทียบ VLAN ที่คาดหวังกับที่ห้อง A รายงานทีละแถว', 'บอกพอร์ตที่ผิดและ VLAN ที่ควรเป็น'],
      docs: (s) => [
        {
          type: 'table',
          title: 'บัญชีอุปกรณ์และ VLAN ที่คาดหวัง',
          head: ['อุปกรณ์', 'ชื่อเครื่อง', 'พอร์ต', 'VLAN ที่ควรเป็น'],
          rows: s.meta.devices.map((d) => [d.id, d.label, d.port, String(d.expected)]),
        },
        { type: 'kv', title: 'VLAN ของสำนักงาน', rows: Object.entries(VLANS).map(([id, name]) => [`VLAN ${id}`, name]) },
      ],
    },
  },

  handlers: {
    'show vlan'(ctx) {
      const { meta, state } = ctx.s;
      return table(['Port', 'Device', 'VLAN', 'Status'], meta.devices.map((d) => [d.port, d.id, String(state.vlan[d.port]), 'connected']), [8, 12, 7, 10]);
    },
    'set vlan'(ctx) {
      const { meta, state, truth } = ctx.s;
      const [portIn, idIn] = ctx.args;
      if (!portIn || !idIn) return usageError('set vlan');
      const dev = meta.devices.find((d) => d.port.toLowerCase() === portIn.toLowerCase());
      if (!dev) return [err(`% Invalid interface "${portIn}"`)];
      const id = Number(idIn);
      if (!VLANS[id]) return [err(`% VLAN ${idIn} does not exist (มี VLAN 10, 20, 30)`)];
      state.vlan[dev.port] = id;
      if (id !== truth.vlan[dev.port]) ctx.wrong(`set vlan ${dev.port} ${id}`);
      return [ok(`${dev.port}: switchport access vlan ${id}`), dim('ยืนยันด้วย ping <Device-n>')];
    },
    ping(ctx) {
      const { meta, state, truth } = ctx.s;
      const target = ctx.args[0];
      if (!target) return usageError('ping');
      const dev = meta.devices.find((d) => d.id.toLowerCase() === target.toLowerCase() || d.port.toLowerCase() === target.toLowerCase());
      if (!dev) return pingUnknownHost(target);
      if (state.vlan[dev.port] !== dev.expected) return pingTimeout(dev.id);
      const allFixed = meta.devices.every((d) => state.vlan[d.port] === truth.vlan[d.port]);
      if (allFixed && truth.swapped.includes(dev.id)) ctx.pass();
      return pingReply(dev.id, null, { from: dev.id, ttl: 63, base: 2 });
    },
  },

  hints: (s) => {
    const [x, y] = s.truth.swapped.map((id) => s.meta.devices.find((d) => d.id === id));
    return [
      'ตรวจสอบทุกพอร์ต ไม่ใช่แค่พอร์ตแรก — อาจมีความไม่ตรงกันมากกว่าหนึ่งจุด',
      'ใช้ set vlan <port> <id> กับพอร์ตที่ดูเหมือนสลับกัน แล้ว ping เครื่องนั้นเพื่อยืนยัน',
      `${x.port} และ ${y.port} ต้องสลับ VLAN กัน: ${x.port}→${x.expected}, ${y.port}→${y.expected}`,
    ];
  },

  explanation: (s) => {
    const [x, y] = s.truth.swapped.map((id) => s.meta.devices.find((d) => d.id === id));
    return `เปรียบเทียบทีละแถวพบว่า ${x.port} (${x.label}) กับ ${y.port} (${y.label}) ถูกสลับ VLAN กัน แก้โดยตั้ง ${x.port}→VLAN ${x.expected} และ ${y.port}→VLAN ${y.expected} แล้วยืนยันด้วย ping`;
  },
};
