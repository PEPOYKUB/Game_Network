import { isIp, inCidr, sameIp } from '../netutil.js';
import { line, ok, err, warn, dim, blank, usageError, pingReply, pingTimeout, pingUnreachable, pingUnknownHost, aclAllows, formatAclRule } from '../terminal.js';

const ZONES = ['company.local', 'corp.local', 'office.lan'];

function resolve(s, name) {
  const n = String(name).toLowerCase();
  const fq = n.includes('.') ? n : `${n}.${s.meta.zone}`;
  return s.meta.records[fq] || null;
}

function toFileServer(s) {
  return aclAllows(s.state.acl, { proto: 'icmp', src: s.meta.client, dst: s.meta.file }, inCidr);
}

export default {
  id: 11,
  title: 'การแก้ปัญหาเครือข่ายแบบเต็มรูปแบบ',
  topic: 'IP/Subnet, Gateway, DNS, VLAN, Routing, ACL',
  tier: 'Advanced',
  difficulty: 'ระดับผู้เชี่ยวชาญ',
  minutes: 13,
  optimal: 8,
  icon: 'wrench',
  story: 'แผนกการเงินเข้าเซิร์ฟเวอร์ไฟล์ไม่ได้เลย',
  objective: 'ใช้ระเบียบวิธีอย่างเป็นระบบ ไล่คำสั่งวินิจฉัยทีละชั้นจนพบ ACL ที่บล็อกอยู่ แล้วแก้ด้วย remove acl-rule',
  coop: 'ห้อง A พิสูจน์ได้ว่าทุกอย่างจนถึง gateway และ DNS ปกติ แต่มองไม่เห็น ACL ห้อง B เห็นการตั้งค่าเราเตอร์ทั้งหมด แต่ไม่รู้ว่าผู้ใช้ได้รับผลกระทบแบบไหนโดยไม่มีรายงานจากห้อง A',

  generate(rng, sample) {
    const [cv, sv] = sample ? [30, 40] : rng.distinct(2, 20, 90);
    const clientNet = `192.168.${cv}.0/24`;
    const serverNet = `192.168.${sv}.0/24`;
    const zone = sample ? 'company.local' : rng.pick(ZONES);
    const meta = {
      zone,
      cv,
      sv,
      clientNet,
      serverNet,
      client: `192.168.${cv}.${sample ? 42 : rng.int(20, 90)}`,
      gw: `192.168.${cv}.1`,
      dns: `192.168.${cv}.53`,
      file: `192.168.${sv}.${sample ? 20 : rng.int(10, 40)}`,
    };
    meta.records = { [`fileserver.${zone}`]: meta.file, [`dns01.${zone}`]: meta.dns, [`gateway.${zone}`]: meta.gw };
    const ids = sample ? [10, 11, 12, 20] : (() => {
      const base = rng.int(1, 4) * 10;
      return [base, base + 5, base + 10, base + 20];
    })();
    const culpritAt = sample ? 2 : rng.int(0, 2);
    const benign = [
      { action: 'permit', proto: 'tcp', src: clientNet, dst: 'any', port: 443 },
      { action: 'permit', proto: 'udp', src: clientNet, dst: 'any', port: 53 },
      { action: 'deny', proto: 'tcp', src: 'any', dst: 'any', port: 23 },
    ];
    const culprit = { action: 'deny', proto: 'ip', src: clientNet, dst: serverNet };
    const pick = sample ? benign.slice(0, 2) : rng.sample(benign, 2);
    const ordered = [...pick];
    ordered.splice(culpritAt, 0, culprit);
    const acl = [...ordered, { action: 'permit', proto: 'ip', src: 'any', dst: 'any' }].map((r, i) => ({ ...r, id: ids[i] }));
    return {
      truth: { rule: acl[culpritAt].id },
      state: { acl },
      meta,
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'FIN-PC', prompt: 'FIN-PC>' }),
      commands: ['ipconfig', 'ping', 'nslookup', 'traceroute'],
      hosts: (s) => [s.meta.gw, s.meta.dns, s.meta.file, `fileserver.${s.meta.zone}`],
      see: ['เทอร์มินัลของไคลเอนต์ฝ่ายการเงิน'],
      do: ['รายงานผลทุกคำสั่งตามลำดับให้ห้อง B (IP → gateway → DNS → เซิร์ฟเวอร์ไฟล์)', 'หลังห้อง B แก้ไข ให้ ping เซิร์ฟเวอร์ไฟล์ซ้ำเพื่อยืนยัน'],
      docs: (s) => [{ type: 'note', title: 'แจ้งปัญหาด่วน', lines: [`ฝ่ายการเงินเปิดไดรฟ์ \\\\fileserver.${s.meta.zone} ไม่ได้ทั้งแผนก`, `เซิร์ฟเวอร์ไฟล์: ${s.meta.file}`] }],
    },
    B: {
      device: () => ({ name: 'CORE-RTR', prompt: 'CORE-RTR#' }),
      commands: ['show vlan', 'route print', 'show dns-zone', 'show acl', 'remove acl-rule'],
      hosts: () => [],
      see: ['เทอร์มินัลของเราเตอร์หลัก (VLAN, routing, DNS, ACL)'],
      do: ['ไล่ตรวจทีละชั้นร่วมกับห้อง A: VLAN → IP → gateway → routing → ACL → DNS', 'เมื่อพบกฎที่บล็อก ใช้ remove acl-rule <id>', 'แจ้งห้อง A ทดสอบซ้ำ'],
      docs: () => [{ type: 'note', title: 'บันทึกการเปลี่ยนแปลงล่าสุด', lines: ['เมื่อคืนมีการแก้ไข ACL และ VLAN ตามคำขอฝ่ายความปลอดภัย', 'ยังไม่มีใครตรวจสอบหลังเปลี่ยนแปลง'] }],
    },
  },

  handlers: {
    ipconfig(ctx) {
      const { meta } = ctx.s;
      return [
        line('Ethernet adapter Ethernet0:'),
        line(`   IPv4 Address. . . . . . . : ${meta.client}`),
        line('   Subnet Mask . . . . . . . : 255.255.255.0'),
        line(`   Default Gateway . . . . . : ${meta.gw}`),
        line(`   DNS Servers . . . . . . . : ${meta.dns}`),
      ];
    },
    ping(ctx) {
      const { meta, state, truth } = ctx.s;
      const target = ctx.args[0];
      if (!target) return usageError('ping');
      const ip = isIp(target) ? target : resolve(ctx.s, target);
      if (!ip) return pingUnknownHost(target);
      if ([meta.gw, meta.dns, meta.client].some((h) => sameIp(h, ip))) return pingReply(target, ip);
      if (!sameIp(ip, meta.file)) return pingTimeout(target, ip);
      if (!toFileServer(ctx.s)) return pingUnreachable(target, ip, meta.gw, 'host');
      if (!state.acl.some((r) => r.id === truth.rule)) ctx.pass();
      return pingReply(target, ip, { ttl: 127, base: 2 });
    },
    nslookup(ctx) {
      const { meta } = ctx.s;
      if (!ctx.args[0]) return usageError('nslookup');
      const ip = resolve(ctx.s, ctx.args[0]);
      const head = [line(`Server:  dns01.${meta.zone}`), line(`Address:  ${meta.dns}`), blank()];
      if (!ip) return [...head, err(`*** dns01.${meta.zone} can't find ${ctx.args[0]}: Non-existent domain`)];
      const name = ctx.args[0].includes('.') ? ctx.args[0] : `${ctx.args[0]}.${meta.zone}`;
      return [...head, ok(`Name:    ${name.toLowerCase()}`, 250), ok(`Address:  ${ip}`)];
    },
    traceroute(ctx) {
      const { meta } = ctx.s;
      const target = ctx.args[0];
      if (!target) return usageError('traceroute');
      const ip = isIp(target) ? target : resolve(ctx.s, target);
      if (!ip) return [err(`Unable to resolve target system name ${target}.`)];
      const lines = [line(`Tracing route to ${target} [${ip}] over a maximum of 30 hops`), blank(), line(`  1    <1 ms    <1 ms    <1 ms  ${meta.gw}`, 'out', 420)];
      if (sameIp(ip, meta.file) && !toFileServer(ctx.s)) lines.push(err(`  2  ${meta.gw}  reports: Destination host unreachable.`, 420));
      else if (sameIp(ip, meta.file)) lines.push(ok(`  2     1 ms     1 ms     2 ms  ${ip}`, 420));
      else lines.push(err('  2     *        *        *     Request timed out.', 900));
      return [...lines, blank(), line('Trace complete.')];
    },
    'show vlan'(ctx) {
      const { meta } = ctx.s;
      return [
        line('VLAN  Name          Status    Ports', 'head'),
        line(`${String(meta.cv).padEnd(6)}FINANCE       active    Gi1/0/1-12`),
        line(`${String(meta.sv).padEnd(6)}SERVERS       active    Gi1/0/13-20`),
        line(`${'99'.padEnd(6)}MGMT          active    Gi1/0/24`),
        dim('SVI: ' + `Vlan${meta.cv} ${meta.gw}/24 up/up, Vlan${meta.sv} ${meta.file.replace(/\.\d+$/, '.1')}/24 up/up`),
      ];
    },
    'route print'(ctx) {
      const { meta } = ctx.s;
      return [
        line('Codes: C - connected, S - static'),
        blank(),
        line(`C    ${meta.clientNet.padEnd(20)} is directly connected, Vlan${meta.cv}`),
        line(`C    ${meta.serverNet.padEnd(20)} is directly connected, Vlan${meta.sv}`),
        line(`S*   ${'0.0.0.0/0'.padEnd(20)} via 203.0.113.1`),
      ];
    },
    'show dns-zone'(ctx) {
      const { meta } = ctx.s;
      return [
        line(`Zone: ${meta.zone} (Primary on dns01)`),
        line(`  ${'Name'.padEnd(28)}Type  Data`, 'head'),
        ...Object.entries(meta.records).map(([n, ip]) => line(`  ${n.padEnd(28)}A     ${ip}`)),
      ];
    },
    'show acl'(ctx) {
      const { meta, state } = ctx.s;
      return [
        line(`Extended IP access list FIN-POLICY (applied: Vlan${meta.cv} inbound)`),
        ...state.acl.map((r) => line(formatAclRule(r))),
        dim('    (implicit deny ip any any)'),
      ];
    },
    'remove acl-rule'(ctx) {
      const { state, truth } = ctx.s;
      const id = Number(ctx.args[0]);
      if (!ctx.args[0]) return usageError('remove acl-rule');
      const rule = state.acl.find((r) => r.id === id);
      if (!rule) return [err(`% Rule ${ctx.args[0]} not found — ดูหมายเลขกฎด้วย show acl`)];
      const isLastPermit = rule.action === 'permit' && rule.proto === 'ip' && rule.src === 'any' && rule.dst === 'any';
      if (isLastPermit) {
        ctx.wrong(`remove acl-rule ${id}`);
        return [warn(`% ปฏิเสธการลบกฎ ${id}: ถ้าลบ "permit ip any any" ทราฟฟิกที่เหลือทั้งหมดจะโดน implicit deny`)];
      }
      state.acl = state.acl.filter((r) => r.id !== id);
      if (id !== truth.rule) ctx.wrong(`remove acl-rule ${id}`);
      return [ok(`Removed: ${formatAclRule(rule).trim()}`), dim('แจ้งห้อง A ให้ ping ทดสอบซ้ำ')];
    },
  },

  hints: (s) => [
    'ไล่ตรวจทีละชั้นร่วมกับห้อง A — ชั้นไหนพิสูจน์แล้วว่าปกติบ้าง?',
    'IP, gateway, DNS และ routing ปกติ แต่ ping เซิร์ฟเวอร์ไฟล์ยังล้มเหลว — มีบางอย่างกำลังบล็อกอยู่จริง ใช้ remove acl-rule',
    `remove acl-rule ${s.truth.rule} — deny ip ${s.meta.clientNet} ${s.meta.serverNet}`,
  ],

  explanation: (s) =>
    `ตัดตัวเลือกทีละชั้นด้วยคำสั่งจริง: IP ✓ gateway ✓ DNS ✓ VLAN ✓ routing ✓ — เหลือ ACL กฎ ${s.truth.rule} (deny ip ${s.meta.clientNet} → ${s.meta.serverNet}) ที่อธิบายได้ว่าทำไม ping ล้มเหลวทั้งที่เราต์ติ้งปกติ ลบกฎนี้แล้ว ping สำเร็จ`,
};
