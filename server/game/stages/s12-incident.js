import { isIp, inCidr, parseCidr, sameIp } from '../netutil.js';
import { line, ok, err, warn, dim, blank, table, usageError, pingReply, pingTimeout, pingNoAddress, pingUnknownHost, tcpCheck, aclAllows, formatAclRule } from '../terminal.js';

const SERVICES = [
  { name: 'SMB (file share)', port: 445 },
  { name: 'NFS (file share)', port: 2049 },
  { name: 'FTP (file transfer)', port: 21 },
];
const DEVICES = ['PC-Fin01', 'PC-Fin02'];

function deviceOf(s) {
  return s.state.device;
}

export default {
  id: 12,
  title: 'เหตุการณ์เครือข่ายขั้นสุดท้าย (FINAL NETWORK INCIDENT)',
  topic: 'IP/Subnetting, ARP, MAC Table, VLAN, Routing, DHCP, DNS, TCP/UDP, Packet Capture, Firewall/ACL',
  tier: 'Advanced',
  difficulty: 'ด่านสุดท้าย/ผู้เชี่ยวชาญ',
  minutes: 15,
  optimal: 10,
  icon: 'alarm',
  story: 'แผนกการเงินสูญเสียการเข้าถึงทั้งอินเทอร์เน็ตและเซิร์ฟเวอร์ไฟล์พร้อมกัน สาเหตุคือการตั้งค่าผิดพลาดสองจุดที่เกิดขึ้นพร้อมกัน',
  objective: 'สืบสวนเหตุการณ์แบบครบวงจร แก้ไขสองสาเหตุที่เป็นอิสระต่อกันด้วยคำสั่งจริง แล้วยืนยันการคืนสภาพทั้งหมดเพื่อรับ Final Code',
  coop: 'เหตุการณ์นี้มีสาเหตุอิสระสองจุด อาการของ PC-Fin01 และ PC-Fin02 ต่างกัน และต้นเหตุทั้งสองมองไม่เห็นจากห้อง A ห้อง B จะรู้ว่าต้องเช็คทั้งสองจุดได้ก็ต่อเมื่อได้ยินอาการที่แตกต่างกันจากห้อง A',

  generate(rng, sample) {
    const vlan = sample ? 30 : rng.pick([30, 31, 35, 38, 60]);
    const sv = sample ? 40 : rng.pick([40, 45, 50, 70].filter((v) => v !== vlan));
    const service = sample ? SERVICES[0] : rng.pick(SERVICES);
    const finNet = `192.168.${vlan}.0/24`;
    const srvNet = `192.168.${sv}.0/24`;
    const meta = {
      vlan,
      sv,
      finNet,
      srvNet,
      service,
      gw: `192.168.${vlan}.1`,
      fin02: `192.168.${vlan}.99`,
      leased: `192.168.${vlan}.${sample ? 50 : rng.int(50, 80)}`,
      apipa: `169.254.${rng.int(1, 254)}.${rng.int(1, 254)}`,
      file: `192.168.${sv}.20`,
      otherVlans: sample ? [10, 20] : rng.sample([10, 20, 25, 40, 45, 50, 70].filter((v) => v !== vlan && v !== sv), 2),
      macs: { 'PC-Fin01': `00:50:56:${rng.hex()}:${rng.hex()}:01`, 'PC-Fin02': `00:50:56:${rng.hex()}:${rng.hex()}:02` },
    };
    const acl = [
      { id: 10, action: 'permit', proto: 'tcp', src: finNet, dst: 'any', port: 443 },
      { id: 20, action: 'deny', proto: 'tcp', src: finNet, dst: srvNet, port: service.port },
      { id: 30, action: 'permit', proto: 'ip', src: 'any', dst: 'any' },
    ];
    const scopes = Object.fromEntries([...meta.otherVlans, vlan].map((v) => [v, v !== vlan]));
    return {
      truth: { vlan, proto: 'tcp', port: service.port, src: finNet, dst: srvNet },
      state: { device: 'PC-Fin01', acl, scopes, fin01Ip: null, nextId: 5 },
      meta,
      flags: { renewOk: false, portOk: false },
    };
  },

  roles: {
    A: {
      device: (s) => ({ name: deviceOf(s), prompt: `${deviceOf(s)}>`, devices: DEVICES }),
      commands: ['use', 'ipconfig', 'ipconfig /renew', 'ping', 'capture'],
      hosts: (s) => [...DEVICES, s.meta.gw, s.meta.file],
      see: ['เทอร์มินัลของ PC-Fin01 และ PC-Fin02 (สลับเครื่องด้วย use <device>) และเครื่องมือ capture'],
      do: ['ตรวจอาการของ PC-Fin01 และ PC-Fin02 แยกกัน แล้วรายงานให้ห้อง B', 'หลังห้อง B แก้ครบ: ipconfig /renew บน PC-Fin01 และ ping <server> -p <port> บน PC-Fin02'],
      docs: (s) => [
        {
          type: 'kv',
          title: 'รายงานเหตุการณ์ INC-0999',
          rows: [
            ['แผนก', `การเงิน (VLAN ${s.meta.vlan})`],
            ['PC-Fin01', 'รับ IP อัตโนมัติ (DHCP)'],
            ['PC-Fin02', `ตั้ง IP แบบ static ${s.meta.fin02}/24`],
            ['เซิร์ฟเวอร์ไฟล์', `${s.meta.file} — บริการ ${s.meta.service.name}`],
            ['อาการ', 'ผู้ใช้เข้าอินเทอร์เน็ตและไดรฟ์กลางไม่ได้'],
          ],
        },
      ],
    },
    B: {
      device: () => ({ name: 'CORE-RTR / DHCP', prompt: 'CORE-RTR#' }),
      commands: ['show dhcp-scope', 'show vlan', 'route print', 'show mac-address-table', 'show acl', 'enable dhcp-scope', 'allow port'],
      hosts: (s) => [s.meta.finNet, s.meta.srvNet],
      see: ['เทอร์มินัลของเราเตอร์/DHCP server (DHCP scope, VLAN, routing, MAC table, ACL)'],
      do: ['ตรวจทุกชั้นแล้ววิเคราะห์ว่าอาการของแต่ละเครื่องมาจากอะไร', 'แก้ทั้งสองจุดด้วย enable dhcp-scope และ allow port', 'แจ้งห้อง A ให้ทดสอบทั้งสองเครื่อง'],
      docs: () => [{ type: 'note', title: 'บันทึกกะดึก', lines: ['02:10 ปิด DHCP scope บางตัวเพื่อย้ายเซิร์ฟเวอร์', '02:40 เพิ่มกฎ ACL ตามคำขอฝ่ายความปลอดภัย', '(ไม่มีบันทึกว่าเปิดคืนหรือทดสอบหลังเปลี่ยนแปลง)'] }],
    },
  },

  handlers: {
    use(ctx) {
      const want = DEVICES.find((d) => d.toLowerCase() === String(ctx.args[0] || '').toLowerCase());
      if (!want) return [err(`ระบุอุปกรณ์: ${DEVICES.join(' หรือ ')}`)];
      ctx.s.state.device = want;
      return [ok(`เชื่อมต่อคอนโซลของ ${want} แล้ว`)];
    },
    ipconfig(ctx) {
      const { meta, state } = ctx.s;
      if (deviceOf(ctx.s) === 'PC-Fin02') {
        return [
          line('Ethernet adapter Ethernet0 (PC-Fin02):'),
          line('   DHCP Enabled. . . . . . . : No'),
          line(`   IPv4 Address. . . . . . . : ${meta.fin02}`),
          line('   Subnet Mask . . . . . . . : 255.255.255.0'),
          line(`   Default Gateway . . . . . : ${meta.gw}`),
        ];
      }
      if (state.fin01Ip) {
        return [
          line('Ethernet adapter Ethernet0 (PC-Fin01):'),
          line('   DHCP Enabled. . . . . . . : Yes'),
          ok(`   IPv4 Address. . . . . . . : ${state.fin01Ip} (Preferred)`),
          line('   Subnet Mask . . . . . . . : 255.255.255.0'),
          line(`   Default Gateway . . . . . : ${meta.gw}`),
        ];
      }
      return [
        line('Ethernet adapter Ethernet0 (PC-Fin01):'),
        line('   DHCP Enabled. . . . . . . : Yes'),
        warn(`   Autoconfiguration IPv4. . : ${meta.apipa} (Preferred)`),
        line('   Subnet Mask . . . . . . . : 255.255.0.0'),
        line('   Default Gateway . . . . . : (none)'),
      ];
    },
    'ipconfig /renew'(ctx) {
      const { meta, state, truth, flags } = ctx.s;
      if (deviceOf(ctx.s) === 'PC-Fin02') return [warn('PC-Fin02 ตั้ง IP แบบ static — ไม่มี DHCP lease ให้ต่ออายุ')];
      if (!state.scopes[truth.vlan]) {
        return [
          line('Sending DHCPDISCOVER on Ethernet0...', 'out', 300),
          err('An error occurred while renewing interface Ethernet0:', 1200),
          err('unable to contact your DHCP server. Request has timed out.'),
        ];
      }
      state.fin01Ip = meta.leased;
      flags.renewOk = true;
      if (flags.portOk) ctx.pass();
      return [
        line('Sending DHCPDISCOVER on Ethernet0...', 'out', 300),
        ok('DHCPOFFER received from ' + meta.gw, 600),
        ok(`IPv4 Address. . . . . . . : ${meta.leased} / 255.255.255.0 — ได้รับ IP จริงแล้ว`, 300),
      ];
    },
    ping(ctx) {
      const { meta, state, truth, flags } = ctx.s;
      const [target, flag, portArg] = ctx.args;
      if (!target) return usageError('ping');
      if (!isIp(target)) return pingUnknownHost(target);
      const src = deviceOf(ctx.s) === 'PC-Fin02' ? meta.fin02 : state.fin01Ip;
      if (!src) return pingNoAddress();
      if (flag === '-p') {
        const port = Number(portArg);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return [err('ระบุพอร์ต: ping <ip> -p <port>')];
        if (!sameIp(target, meta.file)) return tcpCheck(target, port, false);
        const allowed = aclAllows(state.acl, { proto: 'tcp', src, dst: target, port }, inCidr);
        const open = allowed && port === meta.service.port;
        if (open && deviceOf(ctx.s) === 'PC-Fin02' && port === truth.port) {
          flags.portOk = true;
          if (flags.renewOk) ctx.pass();
        }
        return tcpCheck(target, port, open);
      }
      if (sameIp(target, meta.gw) || sameIp(target, src)) return pingReply(target, target);
      if (sameIp(target, meta.file) && aclAllows(state.acl, { proto: 'icmp', src, dst: target }, inCidr)) return pingReply(target, target, { ttl: 127, base: 2 });
      return pingTimeout(target, target);
    },
    capture(ctx) {
      const { meta, state } = ctx.s;
      if (deviceOf(ctx.s) === 'PC-Fin01') {
        if (state.fin01Ip) return [line('No.  Proto  Info', 'head'), line('1    DHCP   Discover'), line('2    DHCP   Offer'), line('3    DHCP   Request'), ok('4    DHCP   ACK — lease ได้รับแล้ว')];
        return [
          line('No.  Time      Source          Destination        Proto  Info', 'head'),
          line('1    10:14:01  0.0.0.0         255.255.255.255    DHCP   Discover (xid 0x3a1f)', 'out', 200),
          line('2    10:14:05  0.0.0.0         255.255.255.255    DHCP   Discover (xid 0x3a1f)', 'out', 200),
          line('3    10:14:13  0.0.0.0         255.255.255.255    DHCP   Discover (xid 0x3a1f)', 'out', 200),
          warn('(ไม่มี DHCP Offer ตอบกลับ)'),
        ];
      }
      const allowed = aclAllows(state.acl, { proto: 'tcp', src: meta.fin02, dst: meta.file, port: meta.service.port }, inCidr);
      const s = `${meta.fin02}:50122`;
      const d = `${meta.file}:${meta.service.port}`;
      const rows = [
        ['1', meta.fin02, meta.file, 'ICMP', 'Echo request'],
        ['2', meta.file, meta.fin02, 'ICMP', 'Echo reply'],
        ['3', s, d, 'TCP', '[SYN]'],
        ...(allowed ? [['4', d, s, 'TCP', '[SYN, ACK]'], ['5', s, d, 'TCP', '[ACK]']] : [['4', s, d, 'TCP', '[SYN] retransmission'], ['5', s, d, 'TCP', '[SYN] retransmission']]),
      ];
      return [...table(['No.', 'Source', 'Destination', 'Proto', 'Info'], rows, [5, 22, 22, 7, 22]), allowed ? ok('TCP handshake สำเร็จ') : warn('(ไม่มี SYN-ACK ตอบกลับ)')];
    },
    'show dhcp-scope'(ctx) {
      const { state } = ctx.s;
      const rows = Object.entries(state.scopes).map(([v, on]) => [v, `192.168.${v}.0/24`, `192.168.${v}.50-192.168.${v}.200`, on ? 'Enabled' : 'Disabled']);
      return table(['VLAN', 'Scope', 'Range', 'Status'], rows, [6, 18, 30, 10]);
    },
    'show vlan'(ctx) {
      const { meta } = ctx.s;
      return [
        line('VLAN  Name          Status    Ports', 'head'),
        ...meta.otherVlans.map((v, i) => line(`${String(v).padEnd(6)}${['STAFF', 'LAB'][i].padEnd(14)}active    Gi1/0/${i * 4 + 1}-${i * 4 + 4}`)),
        line(`${String(meta.vlan).padEnd(6)}${'FINANCE'.padEnd(14)}active    Gi1/0/9-12`),
        line(`${String(meta.sv).padEnd(6)}${'SERVERS'.padEnd(14)}active    Gi1/0/13-16`),
      ];
    },
    'route print'(ctx) {
      const { meta } = ctx.s;
      return [
        line('Codes: C - connected, S - static'),
        blank(),
        ...[...meta.otherVlans, meta.vlan, meta.sv].map((v) => line(`C    ${`192.168.${v}.0/24`.padEnd(20)} is directly connected, Vlan${v}`)),
        line(`S*   ${'0.0.0.0/0'.padEnd(20)} via 203.0.113.1`),
      ];
    },
    'show mac-address-table'(ctx) {
      const { meta } = ctx.s;
      return table(['Vlan', 'Mac Address', 'Type', 'Ports'], [
        [String(meta.vlan), meta.macs['PC-Fin01'], 'DYNAMIC', 'Gi1/0/9'],
        [String(meta.vlan), meta.macs['PC-Fin02'], 'DYNAMIC', 'Gi1/0/10'],
        [String(meta.sv), '00:25:90:aa:10:20'.toUpperCase(), 'DYNAMIC', 'Gi1/0/13'],
      ], [7, 22, 10, 10]);
    },
    'show acl'(ctx) {
      const { meta, state } = ctx.s;
      return [line(`Extended IP access list FIN-OUT (applied: Vlan${meta.vlan} inbound)`), ...[...state.acl].sort((a, b) => a.id - b.id).map((r) => line(formatAclRule(r))), dim('    (implicit deny ip any any)')];
    },
    'enable dhcp-scope'(ctx) {
      const { state, truth } = ctx.s;
      if (!ctx.args[0]) return usageError('enable dhcp-scope');
      const v = Number(ctx.args[0]);
      if (!(v in state.scopes)) return [err(`% No DHCP scope configured for VLAN ${ctx.args[0]}`)];
      if (state.scopes[v]) return [warn(`Scope ของ VLAN ${v} เปิดใช้งานอยู่แล้ว`)];
      state.scopes[v] = true;
      if (v !== truth.vlan) ctx.wrong(`enable dhcp-scope ${v}`);
      return [ok(`DHCP scope VLAN ${v}: Enabled`), dim('ให้ห้อง A สั่ง ipconfig /renew บนเครื่องที่ใช้ DHCP')];
    },
    'allow port'(ctx) {
      const { state, truth } = ctx.s;
      const [proto, portIn, from, src, to, dst] = ctx.args.map((a) => a.toLowerCase());
      if (!proto || !portIn || from !== 'from' || !src || to !== 'to' || !dst) return usageError('allow port');
      if (!['tcp', 'udp'].includes(proto)) return [err('% โปรโตคอลต้องเป็น tcp หรือ udp')];
      const port = Number(portIn);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return [err(`% Invalid port "${portIn}"`)];
      const okSpec = (x) => x === 'any' || parseCidr(x) || isIp(x);
      if (!okSpec(src) || !okSpec(dst)) return [err('% ใช้ซับเน็ตแบบ CIDR เช่น 192.168.30.0/24 หรือ any')];
      const rule = { id: state.nextId, action: 'permit', proto, src, dst, port };
      state.nextId = Math.max(1, state.nextId - 1);
      state.acl.push(rule);
      if (!(proto === truth.proto && port === truth.port && src === truth.src && dst === truth.dst)) ctx.wrong(ctx.raw);
      return [ok(`Rule added: ${formatAclRule(rule).trim()}`), dim('กฎใหม่อยู่บนสุดของ ACL (ตรวจก่อนกฎอื่น)')];
    },
  },

  hints: (s) => [
    'มีปัญหาแยกกันสองอย่าง ส่งผลต่อพีซีสองเครื่องคนละแบบ — อย่าหยุดหลังแก้แค่จุดเดียว',
    'ปัญหาของ PC-Fin01 คือการได้รับที่อยู่เลย ปัญหาของ PC-Fin02 คือการเข้าถึงบริการเฉพาะพอร์ตเดียว ใช้ enable dhcp-scope และ allow port แยกกัน',
    `enable dhcp-scope ${s.truth.vlan} และ allow port tcp ${s.truth.port} from ${s.truth.src} to ${s.truth.dst}`,
  ],

  finalCode: (s) => `INCIDENT-CLEAR-${s.truth.port}-${s.truth.vlan}`,

  explanation: (s) =>
    `อาการที่ 1 (PC-Fin01 ได้ APIPA) อธิบายได้ด้วย DHCP scope ของ VLAN ${s.truth.vlan} ที่ถูกปิด อาการที่ 2 (PC-Fin02 ส่ง SYN ไปพอร์ต ${s.truth.port} แต่ไม่มี SYN-ACK ทั้งที่ ping ได้) เป็นลายเซ็นของการบล็อกโดย ACL เฉพาะพอร์ต ไม่ใช่ปัญหาเราต์ติ้งหรือ VLAN ต้องแก้ทั้งสองจุดและยืนยันทั้งคู่ ระบบจึงสร้าง Final Code จากค่าที่แก้จริง`,
};
