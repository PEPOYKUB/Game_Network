// Command registry, parser, /help topics and output formatting shared by every stage.

export const COMMANDS = {
  // Diagnostic commands (read-only)
  ipconfig: { usage: 'ipconfig', desc: 'ดูค่า IP, subnet mask, gateway และ DNS ของอุปกรณ์', kind: 'diag', topic: 'ip' },
  'ipconfig /renew': { usage: 'ipconfig /renew', desc: 'ขอที่อยู่ IP ใหม่จาก DHCP server', kind: 'diag', topic: 'dhcp' },
  ping: { usage: 'ping <host|ip> [-p <port>]', desc: 'ทดสอบการเชื่อมต่อ (ICMP) หรือทดสอบพอร์ต TCP ด้วย -p', kind: 'diag', topic: 'connectivity' },
  'arp -a': { usage: 'arp -a', desc: 'ดูตาราง ARP (IP ↔ MAC)', kind: 'diag', topic: 'arp' },
  'show mac-address-table': { usage: 'show mac-address-table', desc: 'ดูตาราง MAC ของสวิตช์', kind: 'diag', topic: 'mac' },
  'show vlan': { usage: 'show vlan', desc: 'ดู VLAN ของแต่ละพอร์ตบนสวิตช์', kind: 'diag', topic: 'vlan' },
  traceroute: { usage: 'traceroute <host|ip>', desc: 'ดูเส้นทางแพ็กเก็ตทีละฮอป', kind: 'diag', topic: 'routing' },
  'route print': { usage: 'route print [router]', desc: 'ดูตารางเราต์ติ้ง', kind: 'diag', topic: 'routing' },
  nslookup: { usage: 'nslookup <hostname>', desc: 'ทดสอบการแปลงชื่อโดเมนเป็น IP', kind: 'diag', topic: 'dns' },
  netstat: { usage: 'netstat', desc: 'ดูพอร์ต/คอนเนกชันที่เปิดอยู่', kind: 'diag', topic: 'packet' },
  capture: { usage: 'capture', desc: 'ดูแพ็กเก็ตแคปเจอร์ (ตารางอ่านอย่างเดียว)', kind: 'diag', topic: 'packet' },
  'show dns-zone': { usage: 'show dns-zone', desc: 'ดูระเบียนทั้งหมดในโซน DNS', kind: 'diag', topic: 'dns' },
  'show acl': { usage: 'show acl', desc: 'ดูกฎ ACL ของเราเตอร์', kind: 'diag', topic: 'acl' },
  'show dhcp-scope': { usage: 'show dhcp-scope', desc: 'ดูสถานะ DHCP scope ของแต่ละ VLAN', kind: 'diag', topic: 'dhcp' },
  use: { usage: 'use <device>', desc: 'สลับไปควบคุมอุปกรณ์อื่นในห้อง', kind: 'diag', topic: 'commands' },
  // Configuration commands (change the simulated network state)
  'set ip': { usage: 'set ip <addr> <mask>', desc: 'ตั้งค่าที่อยู่ IP และ subnet mask', kind: 'config', topic: 'ip' },
  'set gateway': { usage: 'set gateway <addr>', desc: 'ตั้งค่า default gateway', kind: 'config', topic: 'gateway' },
  'disconnect port': { usage: 'disconnect port <port>', desc: 'ปิดพอร์ตสวิตช์เพื่อตัดอุปกรณ์ออก', kind: 'config', topic: 'mac' },
  'connect port': { usage: 'connect port <port>', desc: 'เปิดพอร์ตสวิตช์ที่ถูกปิดกลับมา', kind: 'config', topic: 'mac' },
  'set vlan': { usage: 'set vlan <port> <id>', desc: 'เปลี่ยน VLAN ของพอร์ต', kind: 'config', topic: 'vlan' },
  'add route': { usage: 'add route <net> <mask> <next-hop>', desc: 'เพิ่ม static route', kind: 'config', topic: 'routing' },
  'set dns-record': { usage: 'set dns-record <name> <ip>', desc: 'เพิ่ม/แก้ไขระเบียน A ในโซน DNS', kind: 'config', topic: 'dns' },
  'remove acl-rule': { usage: 'remove acl-rule <rule-id>', desc: 'ลบกฎ ACL ตามหมายเลข', kind: 'config', topic: 'acl' },
  'enable dhcp-scope': { usage: 'enable dhcp-scope <vlan>', desc: 'เปิดใช้งาน DHCP scope ของ VLAN', kind: 'config', topic: 'dhcp' },
  'allow port': { usage: 'allow port <proto> <port> from <src> to <dst>', desc: 'เพิ่มกฎ ACL อนุญาตพอร์ตระหว่างซับเน็ต', kind: 'config', topic: 'acl' },
};

const ALIASES = { ifconfig: 'ipconfig', tracert: 'traceroute', 'ipconfig/renew': 'ipconfig /renew' };

export const HELP_TOPICS = {
  connectivity: [
    '"ping <host>" ส่ง ICMP echo ไปยังปลายทาง ถ้าได้ Reply แปลว่าเชื่อมต่อถึงกัน',
    '"Request timed out" = ไม่มีคำตอบกลับ (ไม่มีอุปกรณ์อยู่จริง หรือเส้นทางขากลับมีปัญหา)',
    '"Destination host/net unreachable" = เราเตอร์ส่งต่อไม่ได้ (ไม่มีเส้นทาง หรือถูกกฎปฏิเสธ)',
    '"ping <ip> -p <port>" ทดสอบการเชื่อมต่อ TCP ไปยังพอร์ตของบริการ (service check)',
  ],
  ip: [
    '"ipconfig" แสดงค่า IP, mask, gateway และ DNS ปัจจุบันของอุปกรณ์',
    '"set ip <addr> <mask>" ตั้งค่า IP พร้อม subnet mask แบบ dotted decimal เช่น 255.255.255.0',
    'อุปกรณ์ต้องมีทั้ง IP และ mask ที่ถูกต้องจึงจะสื่อสารกับเครื่องอื่นใน LAN ได้',
  ],
  subnet: [
    'CIDR /n = จำนวนบิต 1 ใน mask: /24 = 255.255.255.0, /25 = .128, /26 = .192, /27 = .224, /28 = .240',
    'ขนาดบล็อก = 2^(32 - n) ที่อยู่ เช่น /26 แบ่งเป็นบล็อกละ 64 ที่อยู่',
    'Network address = ที่อยู่แรกของบล็อก, Broadcast address = ที่อยู่สุดท้ายของบล็อก',
  ],
  gateway: [
    'Default gateway คืออินเทอร์เฟซของเราเตอร์ในซับเน็ตเดียวกับเครื่อง ใช้ส่งแพ็กเก็ตออกนอกซับเน็ต',
    '"set gateway <addr>" ตั้งค่า gateway (ต้องอยู่ในซับเน็ตเดียวกับเครื่อง)',
    'ถ้า ping gateway ไม่ได้ เครื่องจะออกไปนอกซับเน็ตไม่ได้เลย',
  ],
  arp: [
    'ARP ใช้แปลงที่อยู่ IP → MAC ภายใน LAN เดียวกัน',
    '"arp -a" แสดงตาราง ARP ที่เครื่องเรียนรู้ไว้ (IP ↔ MAC)',
    'MAC 3 ไบต์แรกคือ OUI (ผู้ผลิต) ไบต์ท้าย ๆ ระบุตัวอุปกรณ์ — อ่านช้า ๆ ทีละไบต์',
  ],
  mac: [
    '"show mac-address-table" แสดง MAC ที่สวิตช์เรียนรู้ได้ในแต่ละพอร์ต',
    '"disconnect port <port>" ปิดพอร์ต (shutdown) ตัดอุปกรณ์ออก, "connect port <port>" เปิดกลับ',
    'อุปกรณ์ที่ไม่อยู่ในทะเบียนที่ได้รับอนุญาตถือเป็น rogue device',
  ],
  vlan: [
    'VLAN แบ่งสวิตช์เป็นหลายเครือข่ายเสมือน อุปกรณ์ที่อยู่ผิด VLAN จะคุยกับ gateway ของตัวเองไม่ได้',
    '"show vlan" แสดง VLAN ของแต่ละพอร์ต, "set vlan <port> <id>" เปลี่ยน VLAN ของพอร์ต',
    'ยืนยันผลด้วย "ping <device>" หลังแก้ไข',
  ],
  routing: [
    '"route print" แสดงตารางเราต์ติ้ง (C = connected, S = static)',
    '"add route <destination> <mask> <next-hop>" เพิ่ม static route',
    'ถ้าไม่มีเส้นทางไปยังเครือข่ายปลายทาง ทราฟฟิกจะไปต่อไม่ได้ (Destination net unreachable)',
    '"traceroute <host>" แสดง IP ของเราเตอร์ที่แพ็กเก็ตผ่านทีละฮอป (อินเทอร์เฟซขาเข้าของแต่ละตัว)',
  ],
  dns: [
    'DNS แปลงชื่อโฮสต์เป็น IP — "nslookup <hostname>" ถาม DNS server โดยตรง',
    '"Non-existent domain" = DNS server ไม่มีระเบียนของชื่อนั้น',
    '"show dns-zone" ดูระเบียนในโซน, "set dns-record <name> <ip>" เพิ่ม/แก้ระเบียน A',
  ],
  dhcp: [
    'DHCP แจก IP, mask, gateway และ DNS ให้อุปกรณ์อัตโนมัติ',
    'ถ้าเครื่องได้ 169.254.x.x (APIPA) แปลว่าติดต่อ DHCP server ไม่ได้',
    '"ipconfig /renew" ขอ IP ใหม่, "show dhcp-scope" / "enable dhcp-scope <vlan>" จัดการฝั่งเซิร์ฟเวอร์',
  ],
  packet: [
    '"capture" แสดงแพ็กเก็ตที่ดักได้: ต้นทาง → ปลายทาง, พอร์ต และโปรโตคอล',
    'พอร์ตที่พบบ่อย: 21 FTP, 22 SSH, 23 Telnet, 53 DNS, 80 HTTP, 443 HTTPS, 445 SMB, 3389 RDP, 8080 HTTP-alt',
    'TCP เริ่มด้วย SYN → SYN-ACK → ACK ถ้ามีแต่ SYN ซ้ำ ๆ โดยไม่มี SYN-ACK แปลว่าถูกบล็อกหรือบริการไม่ตอบ',
  ],
  acl: [
    'ACL คือรายการกฎ permit/deny ที่เราเตอร์ตรวจทีละข้อจากบนลงล่าง กฎแรกที่ตรงจะถูกใช้',
    'ถ้าไม่มีกฎใดตรงเลย จะโดน implicit deny',
    '"show acl" ดูกฎ, "remove acl-rule <id>" ลบกฎ, "allow port <proto> <port> from <src> to <dst>" เพิ่มกฎอนุญาต',
  ],
};

export const line = (t, c = 'out', d = 0) => ({ t, c, d });
export const ok = (t, d = 0) => line(t, 'ok', d);
export const err = (t, d = 0) => line(t, 'err', d);
export const warn = (t, d = 0) => line(t, 'warn', d);
export const dim = (t, d = 0) => line(t, 'dim', d);
export const head = (t) => line(t, 'head');
export const blank = () => line('');

/** Pads columns so tables line up in the monospace terminal. */
export function table(headers, rows, widths) {
  const w = widths || headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)) + 2);
  const fmt = (r) => r.map((cell, i) => String(cell ?? '').padEnd(w[i])).join('').trimEnd();
  return [head(fmt(headers)), ...rows.map((r) => line(fmt(r)))];
}

export function parse(input) {
  const raw = String(input ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!raw) return { empty: true };
  const tokens = raw.split(' ');
  const first = tokens[0].toLowerCase();
  if (first === '/help' || first === 'help' || first === '?') return { help: tokens.slice(1).join(' ').toLowerCase(), raw };
  for (let k = Math.min(3, tokens.length); k >= 1; k -= 1) {
    let name = tokens.slice(0, k).join(' ').toLowerCase();
    const [head0, ...rest] = name.split(' ');
    if (ALIASES[name]) name = ALIASES[name];
    else if (ALIASES[head0]) name = [ALIASES[head0], ...rest].join(' ');
    if (COMMANDS[name]) return { name, args: tokens.slice(k), raw };
  }
  return { unknown: tokens[0], raw };
}

export function helpLines(topic, allowed) {
  if (!topic) {
    const lines = [head('คำสั่งที่ใช้ได้ในห้องของคุณ (ด่านนี้)')];
    if (!allowed.length) lines.push(dim('  (ไม่มีอุปกรณ์ให้สั่งงานในด่านนี้ — ใช้เอกสารในห้องและคุยกับอีกห้อง)'));
    for (const name of allowed) {
      const c = COMMANDS[name];
      lines.push(line(`  ${c.usage.padEnd(44)}${c.desc}`, c.kind === 'config' ? 'warn' : 'out'));
    }
    lines.push(blank(), head('หัวข้อ /help <topic>'), dim(`  ${Object.keys(HELP_TOPICS).join(', ')}`));
    lines.push(dim('  Tab = เติมคำสั่งอัตโนมัติ · ↑/↓ = ประวัติคำสั่ง · clear = ล้างจอ · /help ไม่หักคะแนน'));
    return lines;
  }
  if (HELP_TOPICS[topic]) return [head(`/help ${topic}`), ...HELP_TOPICS[topic].map((t) => line(`  ${t}`))];
  const cmd = parse(topic);
  if (cmd.name) {
    const c = COMMANDS[cmd.name];
    const usable = allowed.includes(cmd.name) ? ok('  ✔ ใช้ได้ในห้องของคุณตอนนี้') : dim('  ✗ ไม่มีในห้องของคุณสำหรับด่านนี้');
    return [head(c.usage), line(`  ${c.desc}`), usable, dim(`  ดูแนวคิดเพิ่มเติม: /help ${c.topic}`)];
  }
  return [err(`ไม่มีหัวข้อ "${topic}" — หัวข้อที่มี: ${Object.keys(HELP_TOPICS).join(', ')}`)];
}

// ---- Common output shapes -------------------------------------------------

const ms = (base) => Math.max(1, base + Math.floor(Math.random() * 3));

function pingStats(ip, received) {
  const lost = 4 - received;
  return [
    blank(),
    dim(`Ping statistics for ${ip}:`, 120),
    dim(`    Packets: Sent = 4, Received = ${received}, Lost = ${lost} (${lost * 25}% loss)`),
  ];
}

export function pingHeader(target, ip) {
  const shown = ip && ip !== target ? `${target} [${ip}]` : target;
  return line(`Pinging ${shown} with 32 bytes of data:`);
}

export function pingReply(target, ip, { ttl = 64, base = 1, from } = {}) {
  const who = from || ip;
  return [
    pingHeader(target, ip),
    ...[0, 1, 2, 3].map(() => ok(`Reply from ${who}: bytes=32 time=${ms(base)}ms TTL=${ttl}`, 280)),
    ...pingStats(ip || target, 4),
  ];
}

export function pingTimeout(target, ip) {
  return [pingHeader(target, ip), ...[0, 1, 2, 3].map(() => err('Request timed out.', 450)), ...pingStats(ip || target, 0)];
}

export function pingUnreachable(target, ip, from, kind = 'host') {
  return [
    pingHeader(target, ip),
    ...[0, 1, 2, 3].map(() => err(`Reply from ${from}: Destination ${kind} unreachable.`, 300)),
    ...pingStats(ip || target, 4),
  ];
}

export function pingUnknownHost(name) {
  return [err(`Ping request could not find host ${name}. Please check the name and try again.`)];
}

export function pingNoAddress() {
  return [err('PING: transmit failed. General failure.'), dim('(อุปกรณ์นี้ยังไม่มีที่อยู่ IP ที่ใช้งานได้)')];
}

export function tcpCheck(ip, port, success) {
  if (success) {
    return [
      line(`Connecting to ${ip}:${port} (TCP)...`),
      ok(`SYN → SYN-ACK received from ${ip}:${port}`, 300),
      ok(`Reply success: port ${port} is open (time=${ms(2)}ms)`, 200),
    ];
  }
  return [
    line(`Connecting to ${ip}:${port} (TCP)...`),
    err(`SYN sent — no SYN-ACK (timed out)`, 700),
    err(`SYN sent — no SYN-ACK (timed out)`, 700),
    err(`Connection to ${ip}:${port} failed: request timed out.`, 300),
  ];
}

export function usageError(name) {
  return [err(`รูปแบบคำสั่งไม่ถูกต้อง — ใช้: ${COMMANDS[name].usage}`)];
}

/** First-match ACL evaluation. Rules: { id, action, proto: 'ip'|'tcp'|'udp'|'icmp', src, dst, port } */
export function aclAllows(rules, pkt, inSubnetFn) {
  const matches = (spec, ip) => spec === 'any' || (spec.includes('/') ? inSubnetFn(ip, spec) : spec === ip);
  for (const r of [...rules].sort((a, b) => a.id - b.id)) {
    const protoOk = r.proto === 'ip' || r.proto === pkt.proto;
    const portOk = r.port == null || r.port === pkt.port;
    if (protoOk && portOk && matches(r.src, pkt.src) && matches(r.dst, pkt.dst)) return r.action === 'permit';
  }
  return false;
}

export function formatAclRule(r) {
  const host = (spec) => (spec === 'any' ? 'any' : spec.includes('/') ? spec : `host ${spec}`);
  return `${String(r.id).padStart(4)} ${r.action.padEnd(7)}${r.proto.padEnd(5)}${host(r.src).padEnd(20)}${host(r.dst).padEnd(20)}${r.port != null ? `eq ${r.port}` : ''}`;
}
