import { line, dim, blank, table } from '../terminal.js';

const BLOCKED = [
  { name: 'RDP', port: 3389 },
  { name: 'Telnet', port: 23 },
  { name: 'SMB', port: 445 },
  { name: 'FTP', port: 21 },
];

function clock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export default {
  id: 10,
  title: 'การวิเคราะห์แพ็กเก็ตแคปเจอร์',
  topic: 'Packet Analysis, TCP/UDP, Port Numbers, Firewall/ACL',
  tier: 'Advanced',
  difficulty: 'ยากมาก+',
  minutes: 12,
  optimal: 7,
  icon: 'packet',
  story: 'ต้องทำเครื่องหมายทราฟฟิกที่ละเมิดนโยบายจากหลายโฟลว์ที่ดูน่าสงสัย ด่านนี้เป็นด่านวิเคราะห์-รายงาน ไม่มีคำสั่งตั้งค่า',
  objective: 'ใช้ capture / netstat วิเคราะห์หลายฟิลด์พร้อมกันเทียบกับนโยบาย',
  coop: 'ห้อง A เห็นทราฟฟิกดิบแต่ไม่รู้นโยบาย ห้อง B มีนโยบายแต่ไม่เห็นทราฟฟิกจริง ต้องเช็คทุกฟิลด์ร่วมกัน',

  generate(rng, sample) {
    let ws;
    let srv;
    let web;
    let ssh;
    let blocked;
    let dnsIp;
    let flows;
    if (sample) {
      ws = '10.5.2';
      srv = '10.5.9';
      web = `${srv}.5`;
      ssh = `${srv}.20`;
      dnsIp = '8.8.8.8';
      blocked = BLOCKED[0];
      flows = [
        { src: '10.5.2.10', sport: 51422, dst: web, dport: 443, proto: 'TCP' },
        { src: '10.5.2.11', sport: 51500, dst: dnsIp, dport: 53, proto: 'UDP' },
        { src: '10.5.2.12', sport: 51600, dst: web, dport: 3389, proto: 'TCP', bad: true },
        { src: '10.5.2.13', sport: 51700, dst: ssh, dport: 22, proto: 'TCP' },
        { src: '10.5.2.10', sport: 51422, dst: web, dport: 8080, proto: 'TCP' },
      ];
    } else {
      const a = rng.int(1, 254);
      const [b, c] = rng.distinct(2, 1, 250);
      ws = `10.${a}.${b}`;
      srv = `10.${a}.${c}`;
      const [webH, sshH, otherH] = rng.distinct(3, 3, 60);
      web = `${srv}.${webH}`;
      ssh = `${srv}.${sshH}`;
      dnsIp = rng.pick(['8.8.8.8', '1.1.1.1']);
      blocked = rng.pick(BLOCKED);
      const hosts = rng.distinct(5, 10, 90).map((h) => `${ws}.${h}`);
      const sport = () => rng.int(49152, 65000);
      flows = [
        { src: hosts[0], sport: sport(), dst: web, dport: 443, proto: 'TCP' },
        { src: hosts[1], sport: sport(), dst: dnsIp, dport: 53, proto: 'UDP' },
        { src: hosts[2], sport: sport(), dst: rng.pick([web, `${srv}.${otherH}`]), dport: blocked.port, proto: 'TCP', bad: true },
        { src: hosts[3], sport: sport(), dst: ssh, dport: 22, proto: 'TCP' },
        { src: hosts[0], sport: sport(), dst: web, dport: 8080, proto: 'TCP' },
        { src: hosts[4], sport: sport(), dst: web, dport: 443, proto: 'TCP' },
      ];
      flows = rng.shuffle(flows);
    }
    let t = sample ? 9 * 3600 + 60 + 3 : rng.int(8 * 3600, 16 * 3600);
    flows = flows.map((f, i) => {
      const at = clock(t);
      t += sample ? [2, 5, 5, 5][i] ?? 5 : rng.int(1, 9);
      return { ...f, no: i + 1, at };
    });
    const bad = flows.find((f) => f.bad).no;
    return {
      truth: { packet: bad },
      state: {},
      meta: { ws, srv, web, ssh, dnsIp, blocked, flows: flows.map(({ bad: _b, ...f }) => f) },
      flags: { captured: false },
    };
  },

  roles: {
    A: {
      device: () => ({ name: 'SENSOR-01', prompt: 'SENSOR-01>' }),
      commands: ['capture', 'netstat'],
      hosts: () => [],
      see: ['เทอร์มินัลของเซนเซอร์ที่ดักทราฟฟิก (capture / netstat)'],
      do: ['รัน capture แล้วบอกค่าทุกฟิลด์ของแต่ละโฟลว์ให้ห้อง B', 'ส่งหมายเลขแพ็กเก็ตที่ละเมิดนโยบายในแท็บ "รายงาน"'],
      docs: () => [{ type: 'note', title: 'งานจาก SOC', lines: ['ตรวจทราฟฟิกช่วงเช้าจาก SPAN port', 'มีทราฟฟิกละเมิดนโยบายเพียงโฟลว์เดียว — นโยบายอยู่ที่ห้อง B'] }],
      form: (s) => ({
        id: 'packet',
        title: 'รายงานแพ็กเก็ตที่ละเมิดนโยบาย',
        desc: 'เลือกหมายเลขแพ็กเก็ต/โฟลว์ที่ผิดนโยบาย',
        enabled: s.flags.captured,
        disabledReason: 'รัน capture ก่อนเพื่อดูทราฟฟิก',
        fields: s.flags.captured ? [{ id: 'packet', label: 'แพ็กเก็ตที่ละเมิด', options: s.meta.flows.map((f) => `#${f.no}`) }] : [],
        submitLabel: 'ส่งรายงาน',
      }),
    },
    B: {
      device: () => null,
      commands: [],
      hosts: () => [],
      see: ['แผ่นอ้างอิงนโยบายเครือข่าย'],
      do: ['เช็คแต่ละโฟลว์ที่ห้อง A อ่านมากับนโยบาย', 'ระบุโฟลว์เดียวที่ละเมิด'],
      docs: (s) => [
        {
          type: 'kv',
          title: 'นโยบายเครือข่าย (Network Policy)',
          rows: [
            ['เวิร์กสเตชัน', `${s.meta.ws}.0/24`],
            ['ซับเน็ตเซิร์ฟเวอร์', `${s.meta.srv}.0/24`],
            ['พอร์ตที่อนุญาต', `443 (HTTPS), 53 (DNS), 22 (SSH — เฉพาะไปยัง ${s.meta.ssh})`],
            ['ข้อห้าม', `${s.meta.blocked.name} (${s.meta.blocked.port}) ถูกบล็อกจาก ${s.meta.ws}.0/24 ไปยัง ${s.meta.srv}.0/24`],
            ['ข้อยกเว้น', `${s.meta.web} = เว็บเซิร์ฟเวอร์ (443 และ 8080 ผู้ดูแลอนุญาต)`],
          ],
        },
      ],
    },
  },

  handlers: {
    capture(ctx) {
      ctx.s.flags.captured = true;
      const rows = ctx.s.meta.flows.map((f) => [`#${f.no}`, f.at, f.src, String(f.sport), f.dst, String(f.dport), f.proto]);
      return [
        dim(`Capturing on SPAN port Gi0/24 ... ${ctx.s.meta.flows.length} flows of interest`),
        ...table(['No.', 'Time', 'Source', 'SrcPort', 'Destination', 'DstPort', 'Proto'], rows, [5, 10, 14, 9, 14, 9, 6]),
        dim('ส่งหมายเลขแพ็กเก็ตที่ผิดนโยบายในแท็บ "รายงาน"'),
      ];
    },
    netstat(ctx) {
      ctx.s.flags.captured = true;
      const rows = ctx.s.meta.flows.map((f) => [f.proto, `${f.src}:${f.sport}`, `${f.dst}:${f.dport}`, f.proto === 'UDP' ? '' : 'ESTABLISHED']);
      return [line('Active Connections (mirrored)'), blank(), ...table(['Proto', 'Local Address', 'Foreign Address', 'State'], rows, [7, 22, 22, 12])];
    },
  },

  form: {
    role: 'A',
    submit(ctx, data) {
      if (!ctx.s.flags.captured) return { ok: false, message: 'ยังไม่ได้รัน capture' };
      if (data?.packet === `#${ctx.s.truth.packet}`) {
        ctx.pass();
        return { ok: true, message: `รายงานถูกต้อง: แพ็กเก็ต #${ctx.s.truth.packet} ละเมิดนโยบาย ✔` };
      }
      ctx.wrong('packet');
      return { ok: false, message: 'โฟลว์นั้นยังสอดคล้องกับนโยบาย — ตรวจพอร์ตและปลายทางกับห้อง B อีกครั้ง' };
    },
  },

  hints: (s) => [
    'ไม่ใช่ทุกพอร์ตแปลกจะผิดนโยบายเสมอไป — เช็คทีละพอร์ตกับแผ่นอ้างอิง',
    'มีโปรโตคอลหนึ่งที่ถูกระบุชัดเจนว่าบล็อกระหว่างสองซับเน็ตนี้ แพ็กเก็ตไหนใช้มัน?',
    `${s.meta.blocked.name} (${s.meta.blocked.port}) จากเวิร์กสเตชันไปเซิร์ฟเวอร์คือรูปแบบต้องห้าม — แพ็กเก็ตหมายเลขไหนตรงกัน?`,
  ],

  explanation: (s) =>
    `ทุกโฟลว์ยกเว้น #${s.truth.packet} สอดคล้องนโยบาย (8080 ไปเว็บเซิร์ฟเวอร์ได้รับอนุญาต, SSH ไปยังโฮสต์ที่กำหนด) มีเพียง #${s.truth.packet} ที่ใช้ ${s.meta.blocked.name} พอร์ต ${s.meta.blocked.port} ไปยังซับเน็ตเซิร์ฟเวอร์ซึ่งถูกห้ามชัดเจน`,
};

