import s01 from './s01-ip.js';
import s02 from './s02-broadcast.js';
import s03 from './s03-gateway.js';
import s04 from './s04-arp.js';
import s05 from './s05-rogue.js';
import s06 from './s06-vlan.js';
import s07 from './s07-routing.js';
import s08 from './s08-static.js';
import s09 from './s09-dns.js';
import s10 from './s10-capture.js';
import s11 from './s11-acl.js';
import s12 from './s12-incident.js';

export const STAGES = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12];

export function getStage(id) {
  return STAGES.find((s) => s.id === Number(id)) || null;
}

/** Public catalogue for the stage-select screen (no scenario data). */
export function stageCatalog() {
  return STAGES.map(({ id, title, topic, tier, difficulty, minutes, optimal, icon, story }) => ({ id, title, topic, tier, difficulty, minutes, optimal, icon, story }));
}
