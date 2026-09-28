import { isIp, sameIp } from '../netutil.js';
import { line, ok, err, dim, blank, usageError, pingReply, pingTimeout, pingUnknownHost } from '../terminal.js';

const ZONES = ['company.local', 'corp.local', 'office.lan'];
const TARGETS = ['intranet', 'portal', 'wiki', 'hr'];

function fqdn(s, name) {
  const n = String(name).toLowerCase().replace(/\.$/, '');
  return n.includes('.') ? n : `${n}.${s.meta.zone}`;
}

function nslookupLines(s, name) {
  const q = fqdn(s, name);
  const ip = s.state.records[q];
  const header = [line(`Server:  dns01.${s.meta.zone}`), line(`Address:  ${s.meta.dns}`), blank()];
  if (!ip) return { ok: false, lines: [...header, err(`*** dns01.${s.meta.zone} can't find ${q}: Non-existent domain`, 300)] };
  return { ok: true, ip, lines: [...header, ok(`Name:    ${q}`, 300), ok(`Address:  ${ip}`)] };
}

export default {
  id: 9,
  title: 'สาเหตุหลักของปัญหา DHCP และ DNS',
  topic: 'DHCP, DNS, การแก้ปัญหาเครือข่าย',
  tier: 'Advanced',
  difficulty: 'ยากมาก',
  minutes: 11,
  optimal: 7,
  icon: 'dns',
  story: 'พนักงานเปิดเว็บภายในของบริษัทไม่ได้',
  objective: 'วินิจฉัยแยกสาเหตุด้วย ping + nslookup แล้วแก้ด้วย set dns-record',
  coop: 'ห้อง A พิสูจน์ได้ว่า DHCP, gateway และ DNS server ปกติ (ตัดออกได้ด้วยคำสั่งจริง) แต่มองไม่เห็นตัวโซน DNS ห้อง B เห็นโซน DNS แต่ไม่รู้ว่าชื่อไหนที่ผู้ใช้เปิดไม่ได้จนกว่าจะฟังรายงานจากห้อง A',

  generate(rng, sample) {
    const zone = sample ? 'company.local' : rng.pick(ZONES);
    const target = sample ? 'intranet' : rng.pick(TARGETS);
    const base = sample ? '10.20.1' : `10.${rng.int(1, 254)}.${rng.int(0, 254)}`;
    const [client, file, mail, web] = sample ? [45, 80, 85, 99] : rng.distinct(4, 54, 240);
    const meta = {
      zone,
      target: `${target}.${zone}`,
      client: `${base}.${client}`,
      gw: `${base}.1`,
      dns: `${base}.53`,
      file: `${base}.${file}`,
      mail: `${base}.${mail}`,
      web: `${base}.${web}`,
    };
    return {
      truth: { name: meta.target, ip: meta.web },
      state: { records: { [`dns01.${zone}`]: meta.dns, [`fileserver.${zone}`]: meta.file, [`mail.${zone}`]: meta.mail } },
      meta,
      flags: { nsOk: false, pingOk: false },
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'STAFF-PC', prompt: 'STAFF-PC>' }),
      commands: ['ipconfig', 'ping', 'nslookup'],
      hosts: (s) => [s.meta.target, s.meta.gw, s.meta.dns, `fileserver.${s.meta.zone}`],
      see: ['เทอร์มินัลของไคลเอนต์ และตั๋วแจ้งปัญหาจากพนักงาน'],
      do: ['ตัดสาเหตุทีละอย่าง: ipconfig → ping gateway → ping DNS → nslookup', 'รายงานผลให้ห้อง B ตามลำดับ', 'หลังห้อง B แก้ ให้รัน nslookup และ ping ชื่อนั้นซ้ำเพื่อยืนยัน'],
      docs: (s) => [{ type: 'note', title: 'ตั๋วแจ้งปัญหา #8812', lines: [`ผู้ใช้: "เปิด http://${s.meta.target} ไม่ได้ ขึ้นว่าหาเซิร์ฟเวอร์ไม่เจอ"`, 'เว็บอื่นในบริษัทยังใช้ได้ปกติ'] }],
    },
    B: {
      device: (s) => ({ name: 'DNS01', prompt: 'DNS01#', zone: s.meta.zone }),
      commands: ['show dns-zone', 'set dns-record', 'nslookup'],
      hosts: (s) => [s.meta.zone],
      see: ['เทอร์มินัลของ DNS Server และรายการเซิร์ฟเวอร์ในซับเน็ต'],
      do: ['ดูระเบียนในโซนด้วย show dns-zone', 'ตรวจว่าชื่อที่ห้อง A รายงานมีระเบียนหรือไม่', 'เพิ่มด้วย set dns-record <name> <ip> แล้วแจ้งห้อง A ทดสอบซ้ำ'],
      docs: (s) => [
        {
          type: 'table',
          title: 'เซิร์ฟเวอร์ที่ออนไลน์ในซับเน็ต (จากระบบมอนิเตอร์)',
          head: ['IP address', 'บทบาท', 'สถานะ'],
          rows: [
            [s.meta.dns, 'DNS server (dns01)', 'UP'],
            [s.meta.file, 'File server', 'UP'],
            [s.meta.mail, 'Mail server', 'UP'],
            [s.meta.web, 'เว็บเซิร์ฟเวอร์ภายในเครื่องใหม่ (ติดตั้งเมื่อวาน)', 'UP — ping ด้วย IP ได้'],
          ].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })),
        },
      ],
    },
  },

  handlers: {
    ipconfig(ctx) {
      const { meta } = ctx.s;
      return [
        line('Ethernet adapter Ethernet0:'),
        line(`   DHCP Enabled. . . . . . . : Yes`),
        line(`   IPv4 Address. . . . . . . : ${meta.client} (Preferred)`),
        line('   Subnet Mask . . . . . . . : 255.255.255.0'),
        line(`   Lease Obtained. . . . . . : Today 08:02:11`),
        line(`   Default Gateway . . . . . : ${meta.gw}`),
        line(`   DHCP Server . . . . . . . : ${meta.gw}`),
        line(`   DNS Servers . . . . . . . : ${meta.dns}`),
      ];
    },
    ping(ctx) {
      const { meta, state, truth, flags } = ctx.s;
      const target = ctx.args[0];
      if (!target) return usageError('ping');
      let ip = target;
      if (!isIp(target)) {
        const res = nslookupLines(ctx.s, target);
        if (!res.ok) return pingUnknownHost(fqdn(ctx.s, target));
        ip = res.ip;
      }
      const alive = [meta.gw, meta.dns, meta.file, meta.mail, meta.web, meta.client].some((h) => sameIp(h, ip));
      if (!alive) return pingTimeout(target, ip);
      if (!isIp(target) && fqdn(ctx.s, target) === truth.name && sameIp(state.records[truth.name], truth.ip)) {
        flags.pingOk = true;
        if (flags.nsOk) ctx.pass();
      }
      return pingReply(target, ip);
    },
    nslookup(ctx) {
      const { truth, flags, state } = ctx.s;
      if (!ctx.args[0]) return usageError('nslookup');
      if (isIp(ctx.args[0])) return [line(`Server:  dns01.${ctx.s.meta.zone}`), err(`*** can't find ${ctx.args[0]}: Non-existent domain (ไม่มี reverse zone)`)];
      const res = nslookupLines(ctx.s, ctx.args[0]);
      if (ctx.role === 'A' && res.ok && fqdn(ctx.s, ctx.args[0]) === truth.name && sameIp(state.records[truth.name], truth.ip)) {
        flags.nsOk = true;
        if (flags.pingOk) ctx.pass();
      }
      return res.lines;
    },
    'show dns-zone'(ctx) {
      const { meta, state } = ctx.s;
      const rows = Object.entries(state.records).sort(([a], [b]) => a.localeCompare(b));
      return [
        line(`Zone: ${meta.zone} (Primary)`),
        line(`  ${'Name'.padEnd(30)}Type  Data`, 'head'),
        line(`  ${'@'.padEnd(30)}SOA   dns01.${meta.zone}`),
        ...rows.map(([n, ip]) => line(`  ${n.padEnd(30)}A     ${ip}`)),
      ];
    },
    'set dns-record'(ctx) {
      const { meta, state, truth, flags } = ctx.s;
      const [nameIn, ip] = ctx.args;
      if (!nameIn || !ip) return usageError('set dns-record');
      const name = fqdn(ctx.s, nameIn);
      if (!name.endsWith(`.${meta.zone}`)) return [err(`% ${name} ไม่ได้อยู่ในโซน ${meta.zone}`)];
      if (!isIp(ip)) return [err(`% Invalid address "${ip}"`)];
      const existed = Boolean(state.records[name]);
      state.records[name] = ip;
      flags.nsOk = false;
      flags.pingOk = false;
      if (!(name === truth.name && sameIp(ip, truth.ip))) ctx.wrong(`set dns-record ${name} ${ip}`);
      return [ok(`${existed ? 'Record updated' : 'Record added'}: ${name}  A  ${ip}`), dim('แจ้งห้อง A ให้ทดสอบด้วย nslookup และ ping')];
    },
  },

  hints: (s) => [
    'ตัดทีละอย่างด้วยคำสั่งจริง — DHCP, gateway, DNS server ดูปกติหมด เหลืออะไร?',
    'ห้อง B เช็คโซน DNS หาชื่อโฮสต์ที่ nslookup ล้มเหลว แล้วใช้ set dns-record',
    `set dns-record ${s.truth.name} ${s.truth.ip}`,
  ],

  explanation: (s) =>
    `ตัดตัวเลือกทีละอย่างด้วยคำสั่งจริง: DHCP ได้ lease ✓, gateway ✓, DNS server เข้าถึงได้ ✓ — เหลือแค่ระเบียน ${s.truth.name} ที่ขาดหายจากโซน เพิ่ม A record ชี้ไป ${s.truth.ip} แล้วยืนยันด้วย nslookup + ping`,
};
