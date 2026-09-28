// IPv4 helpers and a seeded RNG used by the stage generators.

export function isIp(value) {
  const parts = String(value ?? '').split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

export function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function prefixToMask(prefix) {
  return intToIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
}

/** Returns the prefix length of a dotted mask, or -1 when the mask is not contiguous. */
export function maskToPrefix(mask) {
  if (!isIp(mask)) return -1;
  const inverted = ~ipToInt(mask) >>> 0;
  if ((inverted & (inverted + 1)) !== 0) return -1;
  return 32 - Math.round(Math.log2(inverted + 1));
}

export function networkOf(ip, prefix) {
  return intToIp((ipToInt(ip) & ipToInt(prefixToMask(prefix))) >>> 0);
}

export function broadcastOf(ip, prefix) {
  return intToIp((ipToInt(networkOf(ip, prefix)) | (~ipToInt(prefixToMask(prefix)) >>> 0)) >>> 0);
}

export function inSubnet(ip, net, prefix) {
  return isIp(ip) && networkOf(ip, prefix) === networkOf(net, prefix);
}

/** `a.b.c.0/24` -> { net, prefix } */
export function parseCidr(text) {
  const [net, p] = String(text).split('/');
  const prefix = Number(p);
  if (!isIp(net) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { net, prefix };
}

export function hostIn(net, host) {
  return intToIp((ipToInt(net) + host) >>> 0);
}

export function sameIp(a, b) {
  return isIp(a) && isIp(b) && ipToInt(a) === ipToInt(b);
}

export function normMac(mac) {
  return String(mac).trim().toUpperCase().replace(/-/g, ':');
}

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    hex: () => Math.floor(next() * 256).toString(16).toUpperCase().padStart(2, '0'),
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    sample: (list, count) => rng.shuffle(list).slice(0, count),
    /** `count` distinct integers in [min, max] */
    distinct(count, min, max) {
      const set = new Set();
      while (set.size < count) set.add(rng.int(min, max));
      return [...set];
    },
  };
  return rng;
}

/** `ip` inside `a.b.c.d/n` */
export function inCidr(ip, cidr) {
  const parsed = parseCidr(cidr);
  return Boolean(parsed) && inSubnet(ip, parsed.net, parsed.prefix);
}
