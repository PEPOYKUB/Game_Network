import { hostIn, isIp, inSubnet, sameIp } from '../netutil.js';
import { line, ok, err, dim, usageError, pingReply, pingTimeout, pingUnknownHost } from '../terminal.js';

export default {
  id: 3,
  title: 'การแก้ปัญหา Default Gateway',
  topic: 'Default Gateway',
  tier: 'Beginner',
  difficulty: 'ง่าย+',
  minutes: 5,
  optimal: 3,
  icon: 'gateway',
  story: 'พีซีไคลเอนต์ไม่สามารถเข้าถึงสิ่งใดนอกซับเน็ตได้ มีคนพิมพ์ที่อยู่ gateway ผิด',
  objective: 'เข้าใจหน้าที่ของ default gateway และใช้ ping เป็นเครื่องมือวินิจฉัยครั้งแรก',
  coop: 'ห้อง A เห็นการตั้งค่าที่เสียและผลปิงที่ล้มเหลว แต่ไม่รู้ว่าเครือข่ายคาดหวังอะไร ห้อง B รู้ว่าเครือข่ายคาดหวังอะไรแต่ไม่เห็นการตั้งค่าปัจจุบันหรือผลปิง',

  generate(rng, sample) {
    const net = sample ? '172.16.5.0' : `172.16.${rng.int(1, 254)}.0`;
    const hosts = sample ? { client: 20, right: 1, wrong: 254, printer: 30, nas: 40 } : (() => {
      const right = rng.pick([1, 126, 254]);
      const wrong = rng.pick([1, 126, 254, 253, 100].filter((h) => h !== right));
      const [client, printer, nas] = rng.distinct(3, 10, 99);
      return { client, right, wrong, printer, nas };
    })();
    const meta = {
      net,
      client: hostIn(net, hosts.client),
      rightGw: hostIn(net, hosts.right),
      wrongGw: hostIn(net, hosts.wrong),
      printer: hostIn(net, hosts.printer),
      nas: hostIn(net, hosts.nas),
      server01: sample ? '10.200.1.10' : `10.200.${rng.int(1, 254)}.10`,
      wan: '203.0.113.2',
    };
    return {
      truth: { gateway: meta.rightGw },
      state: { gateway: meta.wrongGw },
      meta,
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'CLIENT-PC', prompt: 'CLIENT-PC>' }),
      commands: ['ipconfig', 'ping', 'set gateway'],
      hosts: () => ['gateway', 'server01'],
      see: ['เทอร์มินัลของไคลเอนต์ (ค่าที่ตั้งอยู่ตอนนี้ และผลปิง)'],
      do: ['ดูค่าปัจจุบันด้วย ipconfig และลอง ping gateway', 'รายงานค่าและผลปิงให้ห้อง B', 'แก้ด้วย set gateway <IP> แล้วยืนยันด้วย ping'],
      docs: () => [
        { type: 'note', title: 'แจ้งปัญหาจากผู้ใช้', lines: ['"เข้าเว็บภายนอกไม่ได้เลย แต่ปริ้นเตอร์ในห้องยังใช้ได้"', 'ทดสอบเซิร์ฟเวอร์นอกซับเน็ตได้ด้วย: ping server01'] },
      ],
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['แผนผังโทโพโลยีเครือข่าย และรายการอินเทอร์เฟซเราเตอร์'],
      do: ['ฟังค่าที่ห้อง A รายงาน', 'เทียบกับโทโพโลยี แล้วบอก gateway ที่ถูกต้อง'],
      docs: (s) => [
        {
          type: 'diagram',
          title: 'โทโพโลยีเครือข่าย',
          w: 8,
          h: 4,
          groups: [{ label: `LAN ${s.meta.net}/24`, x: 2.6, y: 0.2, w: 5.2, h: 3.6 }],
          nodes: [
            { id: 'i', kind: 'cloud', label: 'Internet', x: 0.8, y: 1 },
            { id: 'r', kind: 'router', label: 'R1', sub: 'Gi0/1 = LAN', x: 3.4, y: 1 },
            { id: 's', kind: 'switch', label: 'Switch', x: 5.2, y: 1 },
            { id: 'p', kind: 'printer', label: 'Printer-2F', x: 4.2, y: 3 },
            { id: 'n', kind: 'server', label: 'NAS-01', x: 5.6, y: 3 },
            { id: 'c', kind: 'pc', label: 'CLIENT-PC', sub: '(ห้อง A)', x: 7, y: 3 },
          ],
          edges: [['i', 'r'], ['r', 's'], ['s', 'p'], ['s', 'n'], ['s', 'c']],
        },
        {
          type: 'table',
          title: 'อินเทอร์เฟซของเราเตอร์ R1',
          head: ['Interface', 'หน้าที่', 'IP address'],
          rows: [
            ['Gi0/0', 'WAN (ไป ISP)', `${s.meta.wan}/30`],
            ['Gi0/1', 'LAN สำนักงาน', `${s.meta.rightGw}/24`],
          ],
        },
        {
          type: 'table',
          title: `อุปกรณ์ที่ใช้งานในซับเน็ต ${s.meta.net}/24`,
          head: ['อุปกรณ์', 'IP address'],
          rows: [
            ['R1 (Gi0/1)', s.meta.rightGw],
            ['Printer-2F', s.meta.printer],
            ['NAS-01', s.meta.nas],
            ['CLIENT-PC', s.meta.client],
          ],
          note: 'ที่อยู่อื่นที่ไม่อยู่ในรายการนี้ไม่มีอุปกรณ์ใช้งาน',
        },
      ],
    },
  },

  handlers: {
    ipconfig(ctx) {
      const { state, meta } = ctx.s;
      return [
        line('Ethernet adapter Ethernet0:'),
        line(`   IPv4 Address. . . . . . . : ${meta.client}`),
        line('   Subnet Mask . . . . . . . : 255.255.255.0'),
        line(`   Default Gateway . . . . . : ${state.gateway}`),
      ];
    },
    ping(ctx) {
      const { state, meta, truth } = ctx.s;
      const target = ctx.args[0];
      if (!target) return usageError('ping');
      const name = target.toLowerCase();
      const ip = name === 'gateway' ? state.gateway : name === 'server01' ? meta.server01 : isIp(target) ? target : null;
      if (!ip) return pingUnknownHost(target);
      const gwOk = sameIp(state.gateway, truth.gateway);
      if (inSubnet(ip, meta.net, 24)) {
        const alive = [meta.rightGw, meta.printer, meta.nas, meta.client].some((h) => sameIp(h, ip));
        if (!alive) return pingTimeout(target, ip);
        if (gwOk && sameIp(ip, truth.gateway)) ctx.pass();
        return pingReply(target, ip);
      }
      if (!gwOk) return pingTimeout(target, ip);
      ctx.pass();
      return pingReply(target, ip, { ttl: 62, base: 8 });
    },
    'set gateway'(ctx) {
      const { state, meta, truth } = ctx.s;
      const [addr] = ctx.args;
      if (!addr) return usageError('set gateway');
      if (!isIp(addr)) return [err(`ที่อยู่ "${addr}" ไม่ถูกต้อง`)];
      if (!inSubnet(addr, meta.net, 24)) return [err(`Gateway ต้องอยู่ในซับเน็ตเดียวกับเครื่อง (${meta.net}/24)`)];
      if (sameIp(addr, meta.client)) return [err('Gateway ต้องเป็นอุปกรณ์อื่น ไม่ใช่ที่อยู่ของเครื่องนี้เอง')];
      state.gateway = addr;
      if (!sameIp(addr, truth.gateway)) ctx.wrong(`set gateway ${addr}`);
      return [ok(`Default gateway set to ${addr}`), dim('ยืนยันด้วย ping gateway หรือ ping server01')];
    },
  },

  hints: () => [
    'ลองถามห้อง B ว่าอุปกรณ์ใดทำหน้าที่เป็นเราเตอร์บนซับเน็ตนี้จริง ๆ',
    'ใช้ set gateway <IP ที่ถูกต้อง> แล้วตรวจด้วย ping',
    'อินเทอร์เฟซ LAN ของเราเตอร์คือ gateway — ห้อง B ดูตารางอินเทอร์เฟซของ R1 ว่า Gi0/1 มี IP อะไร?',
  ],

  explanation: (s) =>
    `ซับเน็ตของไคลเอนต์คือ ${s.meta.net}/24 เราเตอร์จริงอยู่ที่ ${s.truth.gateway} ส่วน gateway เดิม ${s.meta.wrongGw} ไม่มีอุปกรณ์อยู่จึง ping ไม่ได้ หลังแก้ไข ping ไปยัง gateway และเซิร์ฟเวอร์นอกซับเน็ตสำเร็จ`,
};
