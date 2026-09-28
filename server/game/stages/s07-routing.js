import { isIp, inSubnet, sameIp } from '../netutil.js';
import { line, ok, err, dim, blank, usageError, pingReply, pingUnreachable, pingUnknownHost } from '../terminal.js';

const iface = (name, net, host) => ({ name, net, prefix: 24, ip: net.replace(/\.0$/, `.${host}`) });

function linearTopology() {
  const n = (k) => `10.1.${k}.0`;
  return {
    lanS: n(1),
    lanD: n(4),
    ws: '10.1.1.20',
    server: '10.1.4.50',
    showSubnets: true,
    routers: {
      R1: { ifs: [iface('Gi0/0', n(1), 1), iface('Gi0/1', n(2), 1)], routes: [{ net: n(3), via: '10.1.2.2' }, { net: n(4), via: '10.1.2.2' }] },
      R2: { ifs: [iface('Gi0/0', n(2), 2), iface('Gi0/1', n(3), 1)], routes: [{ net: n(1), via: '10.1.2.1' }, { net: n(4), via: '10.1.3.2' }] },
      R3: { ifs: [iface('Gi0/0', n(3), 2), iface('Gi0/1', n(4), 1)], routes: [{ net: n(1), via: '10.1.3.1' }, { net: n(2), via: '10.1.3.1' }] },
    },
    links: [['ws', 'R1'], ['R1', 'R2'], ['R2', 'R3'], ['R3', 'srv']],
    path: ['R1', 'R2', 'R3'],
  };
}

/** Diamond: R1 reaches R3 through R2 or R4; the routing tables decide which one carries the server's LAN. */
function diamondTopology(rng) {
  const a = rng.int(1, 254);
  const [s, l12, l14, l23, l43, d, x] = rng.distinct(7, 1, 250);
  const n = (k) => `10.${a}.${k}.0`;
  const ip = (k, h) => `10.${a}.${k}.${h}`;
  const mid = rng.pick(['R2', 'R4']);
  const midIp = mid === 'R2' ? ip(l12, 2) : ip(l14, 2);
  const otherIp = mid === 'R2' ? ip(l14, 2) : ip(l12, 2);
  return {
    lanS: n(s),
    lanD: n(d),
    ws: ip(s, rng.int(20, 90)),
    server: ip(d, 50),
    showSubnets: false,
    routers: {
      R1: {
        ifs: [iface('Gi0/0', n(s), 1), iface('Gi0/1', n(l12), 1), iface('Gi0/2', n(l14), 1)],
        routes: [{ net: n(d), via: midIp }, { net: n(x), via: otherIp }, { net: n(l23), via: ip(l12, 2) }, { net: n(l43), via: ip(l14, 2) }],
      },
      R2: {
        ifs: [iface('Gi0/0', n(l12), 2), iface('Gi0/1', n(l23), 1)],
        routes: [{ net: n(s), via: ip(l12, 1) }, { net: n(d), via: ip(l23, 2) }, { net: n(x), via: ip(l23, 2) }, { net: n(l14), via: ip(l12, 1) }],
      },
      R4: {
        ifs: [iface('Gi0/0', n(l14), 2), iface('Gi0/1', n(l43), 1)],
        routes: [{ net: n(s), via: ip(l14, 1) }, { net: n(d), via: ip(l43, 2) }, { net: n(x), via: ip(l43, 2) }, { net: n(l12), via: ip(l14, 1) }],
      },
      R3: {
        ifs: [iface('Gi0/0', n(l23), 2), iface('Gi0/1', n(l43), 2), iface('Gi0/2', n(d), 1), iface('Gi0/3', n(x), 1)],
        routes: [{ net: n(s), via: mid === 'R2' ? ip(l23, 1) : ip(l43, 1) }, { net: n(l12), via: ip(l23, 1) }, { net: n(l14), via: ip(l43, 1) }],
      },
    },
    links: [['ws', 'R1'], ['R1', 'R2'], ['R1', 'R4'], ['R2', 'R3'], ['R4', 'R3'], ['R3', 'srv']],
    path: ['R1', mid, 'R3'],
  };
}

/** Follows the routing tables hop by hop; each hop reports the ingress interface IP. */
export function trace(topo, dst) {
  let router = 'R1';
  let ingress = topo.routers.R1.ifs[0].ip;
  const hops = [];
  for (let i = 0; i < 8; i += 1) {
    hops.push({ router, ip: ingress });
    const r = topo.routers[router];
    if (r.ifs.some((f) => inSubnet(dst, f.net, f.prefix))) {
      const alive = sameIp(dst, topo.server) || Object.values(topo.routers).some((x) => x.ifs.some((f) => sameIp(f.ip, dst)));
      return { hops, reached: alive };
    }
    const route = r.routes.find((rt) => inSubnet(dst, rt.net, 24));
    if (!route) return { hops, unreachable: true };
    const next = Object.entries(topo.routers).find(([, x]) => x.ifs.some((f) => sameIp(f.ip, route.via)));
    router = next[0];
    ingress = route.via;
  }
  return { hops, unreachable: true };
}

function routerTableLines(name, r) {
  return [
    line(`=== ${name} ===`, 'head'),
    line('  Interfaces:'),
    ...r.ifs.map((f) => line(`    ${f.name.padEnd(7)} ${f.ip}/${f.prefix}`)),
    line('  Routing table:'),
    ...r.ifs.map((f) => line(`    C  ${`${f.net}/24`.padEnd(18)} directly connected, ${f.name}`)),
    ...r.routes.map((rt) => line(`    S  ${`${rt.net}/24`.padEnd(18)} via ${rt.via}`)),
  ];
}

export default {
  id: 7,
  title: 'การเลือกเส้นทางเราต์ติ้ง',
  topic: 'Routing, โมเดล OSI/TCP-IP',
  tier: 'Intermediate',
  difficulty: 'ยาก',
  minutes: 9,
  optimal: 6,
  icon: 'route',
  story: 'แพ็กเก็ตจากเวิร์กสเตชันต้องไปถึงเซิร์ฟเวอร์ระยะไกลผ่านเราเตอร์หลายตัว ด่านนี้เป็นด่านวิเคราะห์ ไม่มีการแก้ config — ให้ผู้เล่นพิสูจน์เส้นทางที่ถูกต้อง',
  objective: 'ใช้ traceroute ติดตามเส้นทางจริง แล้วเทียบกับตารางเราต์ติ้งที่อีกห้องเห็น',
  coop: 'ห้อง A รู้ผังกายภาพและเห็นผล traceroute จริง แต่ไม่รู้ว่า IP แต่ละฮอปเป็นของเราเตอร์ตัวไหน ห้อง B รู้ตรรกะเราต์ติ้งแต่ไม่เห็นผลลัพธ์จริงและไม่รู้ปลายทาง ต้องเทียบกันเพื่อยืนยันเส้นทาง',

  generate(rng, sample) {
    const topo = sample ? linearTopology() : diamondTopology(rng);
    return { truth: { path: topo.path }, state: {}, meta: { topo }, flags: { traced: false } };
  },

  roles: {
    A: {
      device: () => ({ name: 'WORKSTATION', prompt: 'WORKSTATION>' }),
      commands: ['ipconfig', 'ping', 'traceroute'],
      hosts: (s) => [s.meta.topo.server],
      see: ['แผนผังโทโพโลยีเครือข่าย และเทอร์มินัลของเวิร์กสเตชัน'],
      do: ['อธิบายผังโทโพโลยีและบอกปลายทางให้ห้อง B', 'รัน traceroute ไปยังเซิร์ฟเวอร์ แล้วรายงานผลแต่ละฮอป'],
      docs: (s) => {
        const t = s.meta.topo;
        const sub = (net) => (t.showSubnets ? `${net}/24` : undefined);
        const diamond = Boolean(t.routers.R4);
        const nodes = [
          { id: 'ws', kind: 'pc', label: 'Workstation', sub: t.ws, x: 0.7, y: 2 },
          { id: 'R1', kind: 'router', label: 'R1', sub: sub(t.lanS), x: 2.3, y: 2 },
          { id: 'R2', kind: 'router', label: 'R2', sub: t.showSubnets ? `${t.routers.R2.ifs[0].net}/24` : undefined, x: 4, y: diamond ? 0.9 : 2 },
          { id: 'R3', kind: 'router', label: 'R3', sub: t.showSubnets ? `${t.routers.R3.ifs[0].net}/24` : undefined, x: 5.7, y: 2 },
          { id: 'srv', kind: 'server', label: 'Server', sub: t.server, x: 7.3, y: 2, hl: true },
        ];
        if (diamond) nodes.push({ id: 'R4', kind: 'router', label: 'R4', x: 4, y: 3.1 });
        return [
          {
            type: 'diagram',
            title: 'แผนผังโทโพโลยี',
            w: 8,
            h: 4,
            nodes,
            edges: t.links,
            caption: t.showSubnets ? `Subnet ปลายทาง ${t.lanD}/24` : 'ผังกายภาพ: สายเชื่อมจริงระหว่างเราเตอร์ (ไม่ได้บอกว่าแพ็กเก็ตวิ่งเส้นไหน)',
          },
        ];
      },
    },
    B: {
      device: () => ({ name: 'NOC-CONSOLE', prompt: 'NOC>' }),
      commands: ['route print'],
      hosts: (s) => Object.keys(s.meta.topo.routers),
      see: ['ตารางเราต์ติ้งและอินเทอร์เฟซของเราเตอร์ทุกตัว (route print)'],
      do: ['ถามห้อง A ว่าปลายทางคือ IP อะไร และ traceroute เห็นฮอปอะไรบ้าง', 'ไล่ next-hop ทีละเราเตอร์', 'ยืนยันลำดับเราเตอร์ในแท็บ "รายงาน"'],
      docs: (s) =>
        Object.entries(s.meta.topo.routers).map(([name, r]) => ({
          type: 'table',
          title: `${name} — route print`,
          head: ['', 'Destination', 'Next hop / Interface'],
          rows: [
            ...r.ifs.map((f) => ['C', `${f.net}/24`, `${f.name} (${f.ip})`]),
            ...r.routes.map((rt) => ['S', `${rt.net}/24`, `via ${rt.via}`]),
          ],
        })),
      form: (s) => ({
        id: 'path',
        title: 'ยืนยันเส้นทาง (Path Confirmation)',
        desc: 'เรียงเราเตอร์ที่แพ็กเก็ตจากเวิร์กสเตชันวิ่งผ่านไปยังเซิร์ฟเวอร์',
        enabled: s.flags.traced,
        disabledReason: 'รอห้อง A รัน traceroute ไปยังเซิร์ฟเวอร์ก่อน แล้วจึงยืนยันเส้นทางจากตารางเราต์ติ้ง',
        fields: s.meta.topo.path.map((_, i) => ({ id: `hop${i + 1}`, label: `ฮอปที่ ${i + 1}`, options: Object.keys(s.meta.topo.routers).sort() })),
        submitLabel: 'ยืนยันเส้นทาง',
      }),
    },
  },

  handlers: {
    ipconfig(ctx) {
      const t = ctx.s.meta.topo;
      return [
        line('Ethernet adapter Ethernet0:'),
        line(`   IPv4 Address. . . . . . . : ${t.ws}`),
        line('   Subnet Mask . . . . . . . : 255.255.255.0'),
        line(`   Default Gateway . . . . . : ${t.routers.R1.ifs[0].ip}`),
      ];
    },
    ping(ctx) {
      const t = ctx.s.meta.topo;
      const target = ctx.args[0];
      if (!target) return usageError('ping');
      if (!isIp(target)) return pingUnknownHost(target);
      const res = trace(t, target);
      if (res.reached) return pingReply(target, target, { ttl: 64 - res.hops.length, base: 2 * res.hops.length });
      return pingUnreachable(target, target, res.hops.at(-1).ip, res.unreachable ? 'net' : 'host');
    },
    traceroute(ctx) {
      const t = ctx.s.meta.topo;
      const target = ctx.args[0];
      if (!target) return usageError('traceroute');
      if (!isIp(target)) return [err(`Unable to resolve target system name ${target}.`)];
      const res = trace(t, target);
      const lines = [line(`Tracing route to ${target} over a maximum of 30 hops`), blank()];
      res.hops.forEach((h, i) => lines.push(line(`  ${String(i + 1).padStart(2)}    ${i + 1} ms    ${i + 1} ms    ${i + 2} ms  ${h.ip}`, 'out', 420)));
      if (res.reached) {
        lines.push(ok(`  ${String(res.hops.length + 1).padStart(2)}    ${res.hops.length + 2} ms    ${res.hops.length + 1} ms    ${res.hops.length + 2} ms  ${target}`, 420), blank(), line('Trace complete.'));
        if (sameIp(target, t.server)) {
          ctx.s.flags.traced = true;
          lines.push(dim('ห้อง B ยืนยันเส้นทางได้แล้วในแท็บ "รายงาน"'));
        }
      } else {
        lines.push(err(`  ${String(res.hops.length + 1).padStart(2)}  ${res.hops.at(-1).ip}  reports: Destination ${res.unreachable ? 'net' : 'host'} unreachable.`, 420), blank(), line('Trace complete.'));
      }
      return lines;
    },
    'route print'(ctx) {
      const { routers } = ctx.s.meta.topo;
      const want = ctx.args[0]?.toUpperCase();
      if (want && !routers[want]) return [err(`ไม่มีเราเตอร์ชื่อ ${ctx.args[0]} (มี: ${Object.keys(routers).join(', ')})`)];
      const names = want ? [want] : Object.keys(routers);
      return names.flatMap((n) => [...routerTableLines(n, routers[n]), blank()]);
    },
  },

  form: {
    role: 'B',
    submit(ctx, data) {
      const path = ctx.s.truth.path;
      if (!ctx.s.flags.traced) return { ok: false, message: 'ยังไม่มีผล traceroute จากห้อง A ให้ยืนยัน' };
      if (path.every((r, i) => data?.[`hop${i + 1}`] === r)) {
        ctx.pass();
        return { ok: true, message: `เส้นทางถูกต้อง: ${path.join(' → ')} ✔` };
      }
      ctx.wrong('path');
      return { ok: false, message: 'ลำดับเราเตอร์ยังไม่ตรงกับเส้นทางจริง — เทียบ IP แต่ละฮอปกับอินเทอร์เฟซในตารางอีกครั้ง' };
    },
  },

  hints: (s) => {
    const r1Route = s.meta.topo.routers.R1.routes.find((rt) => rt.net === s.meta.topo.lanD);
    return [
      'ห้อง A ลองรัน traceroute ไปยังเซิร์ฟเวอร์แล้วบอกฮอปที่เห็น พร้อม IP ปลายทาง',
      `ห้อง B ไล่ตารางทีละเราเตอร์ — R1 ส่ง ${s.meta.topo.lanD}/24 ไปที่ไหน?`,
      `R1 → ${r1Route.via} (${s.truth.path[1]}) → เช็คตาราง ${s.truth.path[1]} หา next-hop ถัดไป`,
    ];
  },

  explanation: (s) =>
    `ปลายทาง ${s.meta.topo.server} อยู่ใน ${s.meta.topo.lanD}/24 ไล่ next-hop ทีละตาราง: ${s.truth.path.join(' → ')} แล้วถึงเซิร์ฟเวอร์ IP แต่ละฮอปใน traceroute คืออินเทอร์เฟซขาเข้าของเราเตอร์ตัวนั้น ซึ่งห้อง B จับคู่ได้จากตารางอินเทอร์เฟซ`,
};
