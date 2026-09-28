import { isIp, inSubnet, maskToPrefix, networkOf, prefixToMask, sameIp } from '../netutil.js';
import { line, ok, err, dim, blank, usageError, pingReply, pingTimeout, pingUnreachable, pingUnknownHost } from '../terminal.js';

/** Longest-prefix match on R-Branch. */
function lookup(s, dst) {
  const { meta, state } = s;
  const connected = [
    { net: meta.branch, prefix: 24, connected: 'Gi0/0' },
    { net: meta.wanNet, prefix: 30, connected: 'Se0/0/0' },
  ];
  const all = [...connected, ...state.routes];
  return all.filter((r) => inSubnet(dst, r.net, r.prefix)).sort((a, b) => b.prefix - a.prefix)[0] || null;
}

/** Result of sending a packet from the branch PC. */
function reach(s, dst) {
  const { meta } = s;
  if (inSubnet(dst, meta.branch, 24)) return { ok: [meta.pc, meta.branchGw].includes(dst), hops: [] };
  const route = lookup(s, dst);
  if (!route) return { unreachable: true, hops: [meta.branchGw] };
  if (route.connected) return { ok: [meta.wanBranch, meta.wanDc].includes(dst), hops: [meta.branchGw] };
  if (!sameIp(route.via, meta.wanDc)) return { timeout: true, hops: [meta.branchGw] };
  const alive = [meta.server, meta.dcGw].includes(dst);
  return { ok: alive, timeout: !alive, hops: [meta.branchGw, meta.wanDc] };
}

export default {
  id: 8,
  title: 'เส้นทาง Static Route ที่ขาดหาย',
  topic: 'Static Routing',
  tier: 'Intermediate',
  difficulty: 'ยาก',
  minutes: 10,
  optimal: 6,
  icon: 'static',
  story: 'สาขาย่อยไม่สามารถติดต่อศูนย์ข้อมูลได้ สงสัยว่ามี static route ขาดหาย',
  objective: 'ตรวจจับเส้นทางที่ขาดหายด้วย route print แล้วเพิ่มด้วย add route และยืนยันด้วย ping',
  coop: 'ห้อง B เห็นว่าเส้นทางขาดหายแต่ไม่รู้ซับเน็ตศูนย์ข้อมูลหรือ WAN IP ที่ใช้เป็น next hop — มีเฉพาะในผังของห้อง A ส่วนห้อง A ไม่มีตารางเราต์ติ้งจึงไม่รู้ด้วยซ้ำว่าเส้นทางขาดหาย',

  generate(rng, sample) {
    let dc;
    let branch;
    let wanNet;
    let dcSide;
    let serverHost;
    if (sample) {
      dc = '192.168.100.0';
      branch = '192.168.200.0';
      wanNet = '10.10.10.0';
      dcSide = 1;
      serverHost = 10;
    } else {
      const [x, y] = rng.distinct(2, 10, 250);
      dc = `192.168.${x}.0`;
      branch = `192.168.${y}.0`;
      wanNet = `10.${rng.int(1, 254)}.${rng.int(0, 254)}.${rng.int(0, 63) * 4}`;
      dcSide = rng.pick([1, 2]);
      serverHost = rng.int(10, 60);
    }
    const base = wanNet.split('.').map(Number);
    const wanIp = (h) => `${base[0]}.${base[1]}.${base[2]}.${base[3] + h}`;
    const meta = {
      dc,
      branch,
      wanNet,
      wanDc: wanIp(dcSide),
      wanBranch: wanIp(3 - dcSide),
      server: dc.replace(/\.0$/, `.${serverHost}`),
      dcGw: dc.replace(/\.0$/, '.1'),
      branchGw: branch.replace(/\.0$/, '.1'),
      pc: branch.replace(/\.0$/, '.25'),
    };
    return {
      truth: { net: dc, prefix: 24, via: meta.wanDc },
      state: { routes: [] },
      meta,
      flags: {},
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'BRANCH-PC', prompt: 'BRANCH-PC>' }),
      commands: ['ipconfig', 'ping', 'traceroute'],
      hosts: (s) => [s.meta.server, s.meta.wanDc],
      see: ['แผนผังโทโพโลยีระหว่างสาขากับศูนย์ข้อมูล และเทอร์มินัลของพีซีสาขา'],
      do: ['อธิบายโทโพโลยี (ซับเน็ต, WAN IP) ให้ห้อง B', 'หลังห้อง B เพิ่มเส้นทาง ให้ ping เซิร์ฟเวอร์ศูนย์ข้อมูลเพื่อยืนยัน'],
      docs: (s) => [
        {
          type: 'diagram',
          title: 'โทโพโลยี สาขา ↔ ศูนย์ข้อมูล',
          w: 8,
          h: 4,
          groups: [
            { label: `ศูนย์ข้อมูล ${s.meta.dc}/24`, x: 0.1, y: 0.3, w: 2.9, h: 3.4 },
            { label: `WAN ${s.meta.wanNet}/30`, x: 3.1, y: 0.3, w: 1.8, h: 3.4 },
            { label: `สาขา ${s.meta.branch}/24`, x: 5.0, y: 0.3, w: 2.9, h: 3.4 },
          ],
          nodes: [
            { id: 'srv', kind: 'server', label: 'DC-Server', sub: s.meta.server, x: 0.75, y: 2.2, hl: true },
            { id: 'rdc', kind: 'router', label: 'R-DC', sub: `WAN ${s.meta.wanDc}`, x: 2.45, y: 2.2 },
            { id: 'rbr', kind: 'router', label: 'R-Branch', sub: `WAN ${s.meta.wanBranch}`, x: 5.55, y: 2.2 },
            { id: 'pc', kind: 'pc', label: 'BRANCH-PC', sub: s.meta.pc, x: 7.25, y: 2.2 },
          ],
          edges: [['srv', 'rdc'], ['rdc', 'rbr'], ['rbr', 'pc']],
          caption: 'R-DC มีเส้นทางกลับมายังสาขาครบแล้ว (ตรวจสอบโดยทีมศูนย์ข้อมูล)',
        },
      ],
    },
    B: {
      device: () => ({ name: 'R-Branch', prompt: 'R-Branch#' }),
      commands: ['route print', 'add route'],
      hosts: () => [],
      see: ['เทอร์มินัลของเราเตอร์ R-Branch (ตารางเราต์ติ้ง)'],
      do: ['ดูตารางด้วย route print แล้วสังเกตเส้นทางที่ขาดหาย', 'เพิ่มด้วย add route <net> <mask> <next-hop>', 'แจ้งห้อง A ให้ทดสอบ ping'],
      docs: () => [{ type: 'note', title: 'ตั๋วแจ้งปัญหา #4471', lines: ['ผู้ใช้สาขา: "เข้าระบบในศูนย์ข้อมูลไม่ได้"', 'คุณดูแลเราเตอร์ R-Branch — ตรวจตารางเราต์ติ้งด้วย route print', 'ผังเครือข่ายของสาขา/ศูนย์ข้อมูลอยู่ที่ห้อง A'] }],
    },
  },

  handlers: {
    ipconfig(ctx) {
      const { meta } = ctx.s;
      return [
        line('Ethernet adapter Ethernet0:'),
        line(`   IPv4 Address. . . . . . . : ${meta.pc}`),
        line('   Subnet Mask . . . . . . . : 255.255.255.0'),
        line(`   Default Gateway . . . . . : ${meta.branchGw}`),
      ];
    },
    ping(ctx) {
      const { meta, truth, state } = ctx.s;
      const target = ctx.args[0];
      if (!target) return usageError('ping');
      if (!isIp(target)) return pingUnknownHost(target);
      const res = reach(ctx.s, target);
      if (res.unreachable) return pingUnreachable(target, target, meta.branchGw, 'net');
      if (!res.ok) return pingTimeout(target, target);
      const exact = state.routes.some((r) => r.net === truth.net && r.prefix === truth.prefix && sameIp(r.via, truth.via));
      if (exact && inSubnet(target, meta.dc, 24)) ctx.pass();
      return pingReply(target, target, { ttl: 64 - res.hops.length, base: 12 });
    },
    traceroute(ctx) {
      const target = ctx.args[0];
      if (!target) return usageError('traceroute');
      if (!isIp(target)) return [err(`Unable to resolve target system name ${target}.`)];
      const res = reach(ctx.s, target);
      const lines = [line(`Tracing route to ${target} over a maximum of 30 hops`), blank()];
      res.hops.forEach((h, i) => lines.push(line(`  ${i + 1}    ${i * 10 + 1} ms    ${i * 10 + 2} ms    ${i * 10 + 1} ms  ${h}`, 'out', 420)));
      if (res.ok) lines.push(ok(`  ${res.hops.length + 1}    22 ms    21 ms    22 ms  ${target}`, 420));
      else if (res.unreachable) lines.push(err(`  ${res.hops.length + 1}  ${ctx.s.meta.branchGw}  reports: Destination net unreachable.`, 420));
      else lines.push(err(`  ${res.hops.length + 1}     *        *        *     Request timed out.`, 900));
      return [...lines, blank(), line('Trace complete.')];
    },
    'route print'(ctx) {
      const { meta, state } = ctx.s;
      return [
        line('Codes: C - connected, S - static'),
        blank(),
        line('Gateway of last resort is not set'),
        blank(),
        line(`C    ${`${meta.wanNet}/30`.padEnd(20)} is directly connected, Serial0/0/0 (${meta.wanBranch})`),
        line(`C    ${`${meta.branch}/24`.padEnd(20)} is directly connected, GigabitEthernet0/0 (${meta.branchGw})`),
        ...state.routes.map((r) => ok(`S    ${`${r.net}/${r.prefix}`.padEnd(20)} [1/0] via ${r.via}`)),
      ];
    },
    'add route'(ctx) {
      const { meta, state, truth } = ctx.s;
      const [net, mask, via] = ctx.args;
      if (!net || !mask || !via) return usageError('add route');
      if (!isIp(net) || !isIp(via)) return [err('% Invalid address — ใช้รูปแบบ add route 192.168.1.0 255.255.255.0 10.0.0.1')];
      const prefix = maskToPrefix(mask);
      if (prefix < 0) return [err(`% Invalid mask "${mask}" (ใช้แบบ dotted decimal เช่น 255.255.255.0)`)];
      if (networkOf(net, prefix) !== net) return [err(`% Inconsistent address and mask (network ของ ${net}/${prefix} คือ ${networkOf(net, prefix)})`)];
      if ([meta.wanBranch, meta.branchGw].includes(via)) return [err('% Invalid next-hop: นั่นคืออินเทอร์เฟซของ R-Branch เอง')];
      if (!inSubnet(via, meta.wanNet, 30) && !inSubnet(via, meta.branch, 24)) return [err(`% Next-hop ${via} is not directly reachable (ต้องอยู่ในซับเน็ตที่เชื่อมต่อโดยตรง)`)];
      state.routes = state.routes.filter((r) => !(r.net === net && r.prefix === prefix));
      state.routes.push({ net, prefix, via });
      if (!(net === truth.net && prefix === truth.prefix && sameIp(via, truth.via))) ctx.wrong(`add route ${net} ${mask} ${via}`);
      return [ok(`ip route ${net} ${prefixToMask(prefix)} ${via}  — added`), dim('ให้ห้อง A ทดสอบด้วย ping')];
    },
  },

  hints: (s) => [
    'ห้อง B มีเส้นทางไปยังซับเน็ตศูนย์ข้อมูลในตารางหรือไม่?',
    'ใช้ add route <destination> <mask> <next-hop> — คุณต้องการซับเน็ตศูนย์ข้อมูลและ WAN IP ฝั่งตรงข้าม',
    `add route ${s.truth.net} 255.255.255.0 ${s.truth.via}`,
  ],

  explanation: (s) =>
    `R-Branch ไม่มีเส้นทางไปยัง ${s.truth.net}/24 จึงตอบ Destination net unreachable ต้องเพิ่ม static route โดยใช้ next hop ${s.truth.via} (อินเทอร์เฟซ WAN ของ R-DC) แล้ว ping ข้ามสาขาจึงสำเร็จ`,
};
