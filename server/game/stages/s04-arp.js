import { hostIn } from '../netutil.js';
import { line, dim, table } from '../terminal.js';

const NAMES = ['Printer-Floor2', 'Laptop-HR03', 'Server-Backup', 'Camera-Lobby', 'NAS-Finance', 'PC-Reception', 'AP-Floor1', 'Phone-Meeting'];
const PLACES = {
  'Printer-Floor2': 'ชั้น 2 ห้องถ่ายเอกสาร',
  'Laptop-HR03': 'ฝ่ายบุคคล',
  'Server-Backup': 'ห้องเซิร์ฟเวอร์',
  'Camera-Lobby': 'โถงทางเข้า',
  'NAS-Finance': 'ฝ่ายการเงิน',
  'PC-Reception': 'เคาน์เตอร์ต้อนรับ',
  'AP-Floor1': 'ฝ้าเพดานชั้น 1',
  'Phone-Meeting': 'ห้องประชุมใหญ่',
};

export default {
  id: 4,
  title: 'ที่อยู่ MAC และการจับคู่ ARP',
  topic: 'MAC Address, ARP',
  tier: 'Beginner',
  difficulty: 'ปานกลาง',
  minutes: 6,
  optimal: 4,
  icon: 'arp',
  story: 'ต้องตรวจสอบตาราง ARP กับรายการอุปกรณ์ที่ทราบก่อนการตรวจสอบความปลอดภัย',
  objective: 'เข้าใจกระบวนการ ARP และใช้คำสั่ง arp -a อ่านตารางจริงในเกม',
  coop: 'ห้อง A เห็นผล ARP (IP↔MAC) แต่ไม่รู้ว่า MAC เป็นของอุปกรณ์อะไร ห้อง B รู้ MAC↔อุปกรณ์ แต่ไม่เห็นตาราง ARP ปัจจุบัน',

  generate(rng, sample) {
    let net;
    let devices;
    let decoys = [];
    if (sample) {
      net = '192.168.1.0';
      devices = [
        { ip: '192.168.1.11', mac: 'AA:BB:CC:00:11:22', name: 'Printer-Floor2' },
        { ip: '192.168.1.12', mac: 'AA:BB:CC:00:33:44', name: 'Laptop-HR03' },
        { ip: '192.168.1.13', mac: 'AA:BB:CC:00:55:66', name: 'Server-Backup' },
      ];
    } else {
      net = `192.168.${rng.int(2, 254)}.0`;
      const oui = [rng.hex(), rng.hex(), rng.hex(), rng.hex()].join(':');
      const names = rng.sample(NAMES, 6);
      const hosts = rng.distinct(4, 11, 60).sort((x, y) => x - y);
      const tails = new Set();
      const tail = () => {
        let t;
        do t = `${rng.hex()}:${rng.hex()}`; while (tails.has(t));
        tails.add(t);
        return t;
      };
      devices = hosts.map((h, i) => ({ ip: hostIn(net, h), mac: `${oui}:${tail()}`, name: names[i] }));
      // Decoys: same OUI, last two bytes swapped from a real device (visually near-identical).
      decoys = names.slice(4).map((name, i) => {
        const [x, y] = devices[i].mac.split(':').slice(4);
        const swapped = `${oui}:${y}:${x}`;
        return { mac: tails.has(`${y}:${x}`) || x === y ? `${oui}:${tail()}` : swapped, name };
      });
    }
    const inventory = [...devices.map(({ mac, name }) => ({ mac, name })), ...decoys];
    return {
      truth: { map: Object.fromEntries(devices.map((d) => [d.ip, d.name])) },
      state: {},
      meta: { net, adminIp: hostIn(net, 10), devices: devices.map(({ ip, mac }) => ({ ip, mac })), inventory: sample ? inventory : rng.shuffle(inventory), options: rng.shuffle(inventory.map((d) => d.name)) },
      flags: { arpSeen: false },
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'ADMIN-PC', prompt: 'ADMIN-PC>' }),
      commands: ['arp -a', 'ipconfig'],
      hosts: () => [],
      see: ['เทอร์มินัลของเครื่องผู้ดูแลระบบ (ตาราง ARP)'],
      do: ['รัน arp -a แล้วอ่านคู่ IP–MAC ให้ห้อง B ฟัง', 'กรอกฟอร์มระบุอุปกรณ์เมื่อห้อง B จับคู่ MAC ได้แล้ว (ด่านนี้เป็นด่านระบุ ไม่ใช่ด่านตั้งค่า)'],
      docs: () => [{ type: 'note', title: 'งานตรวจสอบก่อน Security Audit', lines: ['ต้องระบุว่าแต่ละ IP ในตาราง ARP คืออุปกรณ์อะไร', 'ทะเบียนอุปกรณ์อยู่ที่ห้อง B'] }],
      form: (s) => ({
        id: 'arp-map',
        title: 'ฟอร์มระบุอุปกรณ์ (Device Identification)',
        desc: 'เลือกชื่ออุปกรณ์ของแต่ละ IP ตามที่ห้อง B จับคู่ MAC ได้',
        enabled: s.flags.arpSeen,
        disabledReason: 'รัน arp -a ก่อน เพื่อดูว่ามีอุปกรณ์ใดอยู่ในตาราง ARP',
        fields: s.flags.arpSeen ? s.meta.devices.map((d) => ({ id: d.ip, label: d.ip, options: s.meta.options })) : [],
        submitLabel: 'ส่งผลการระบุ',
      }),
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['แผ่นบัญชีรายชื่ออุปกรณ์ (MAC ↔ ชื่อ)'],
      do: ['ฟัง MAC ที่ห้อง A อ่านมา', 'จับคู่กับบัญชีรายชื่อ แล้วบอกชื่ออุปกรณ์กลับไป'],
      docs: (s) => [
        {
          type: 'table',
          title: 'บัญชีรายชื่ออุปกรณ์ที่ลงทะเบียน',
          head: ['อุปกรณ์', 'MAC address', 'ตำแหน่ง'],
          rows: s.meta.inventory.map((d) => [d.name, d.mac, PLACES[d.name] || '-']),
          note: 'บางเครื่องอาจปิดอยู่และไม่ปรากฏในตาราง ARP',
        },
      ],
    },
  },

  handlers: {
    'arp -a'(ctx) {
      ctx.s.flags.arpSeen = true;
      return [
        line(`Interface: ${ctx.s.meta.adminIp} --- 0x4`),
        ...table(['  Internet Address', 'Physical Address', 'Type'], ctx.s.meta.devices.map((d) => [`  ${d.ip}`, d.mac, 'dynamic']), [22, 22, 8]),
        dim('กรอกผลการระบุในแท็บ "รายงาน"'),
      ];
    },
    ipconfig(ctx) {
      return [
        line('Ethernet adapter Ethernet0:'),
        line(`   IPv4 Address. . . . . . . : ${ctx.s.meta.adminIp}`),
        line('   Subnet Mask . . . . . . . : 255.255.255.0'),
      ];
    },
  },

  form: {
    role: 'A',
    submit(ctx, data) {
      const { map } = ctx.s.truth;
      const correct = Object.keys(map).every((ip) => data?.[ip] === map[ip]);
      if (correct) {
        ctx.pass();
        return { ok: true, message: 'การจับคู่ IP → อุปกรณ์ถูกต้องทั้งหมด ✔' };
      }
      ctx.wrong('arp-map');
      return { ok: false, message: 'ข้อมูลยังไม่ตรงกับอุปกรณ์จริง — อ่าน MAC ทีละไบต์กับห้อง B อีกครั้ง' };
    },
  },

  hints: (s) => {
    const [first] = s.meta.devices;
    return [
      'ARP ให้ IP-ไป-MAC มีอีกคนที่มี MAC-ไป-ชื่อ ลองรวมข้อมูลกัน',
      'ใช้ arp -a อ่าน MAC ช้า ๆ — MAC ในวงนี้ต่างกันแค่ไบต์ท้าย ๆ เท่านั้น',
      `${first.ip} ลงท้าย ...${first.mac.slice(-5)} — เช็คบัญชีรายชื่อว่ามี MAC นี้ตรงกันทุกไบต์หรือไม่`,
    ];
  },

  explanation: (s) =>
    `เชื่อมโยง ARP (IP↔MAC) กับบัญชีรายชื่อ (MAC↔อุปกรณ์) จะได้ IP↔อุปกรณ์: ${Object.entries(s.truth.map).map(([ip, n]) => `${ip} → ${n}`).join(', ')} ต้องอ่าน MAC อย่างละเอียดเพราะคล้ายกันมาก`,
};
