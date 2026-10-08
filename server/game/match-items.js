// Wires the authoritative item core (items.js) into a competitive match.
//
// Item identities are scopes: in FFA a scope is one player, in 2v2 one team (inventory and
// Shield/Reflect are shared by teammates). Config Erase / Glitch change the target scope's real
// stage state on the server; the client only sees generic "disrupted" status and outcomes.
import { createItemState, tickItems, publicItems, pickUpItem, useItem, ITEMS, ITEM_RULES } from './items.js';
import { canStand } from '../../public/js/world.js';

/** State keys an attack may touch, per stage. Stages 4, 7 and 10 have no attackable config. */
export const SABOTAGE_KEYS = {
  1: ['ip', 'mask'],
  2: ['ip', 'mask'],
  3: ['gateway'],
  5: ['down'],
  6: ['vlan'],
  8: ['routes'],
  9: ['records'],
  11: ['acl'],
  12: ['scopes', 'acl'],
};

export const ITEM_TICK_MS = 250;
export const PICKUP_RADIUS = 40;

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Drop points on the corridor between the two rooms: equally far from both sides. */
export function itemSpots(level) {
  const x = (level.split[0] + level.split[1]) / 2;
  const [top, bottom] = level.passage;
  const spots = [0.3, 0.5, 0.7].map((t) => ({ x, y: top + (bottom - top) * t })).filter((p) => canStand(level, 'A', p.x, p.y, true));
  return spots.length ? spots : [{ x, y: (top + bottom) / 2 }];
}

/** Snapshot of the attackable keys, taken when the run starts — Config Erase restores these. */
export function rememberInitialConfig(run) {
  const keys = SABOTAGE_KEYS[run.stage.id] || [];
  run.initialConfig = Object.fromEntries(keys.map((k) => [k, clone(run.s.state[k])]));
}

/** Keys worth attacking right now: prefer ones the target has already changed. */
function pickConfigKey(run) {
  const keys = SABOTAGE_KEYS[run.stage.id] || [];
  const changed = keys.filter((k) => !same(run.s.state[k], run.initialConfig?.[k]));
  const pool = changed.length ? changed : keys;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export function createMatchItems({ room, sendTo, broadcast, onScopeChanged }) {
  const match = room.match;
  // The spawn clock starts when the match does (after the shared briefing), not at creation.
  const state = createItemState(Math.max(Date.now(), match.startsAt || 0));
  const glitches = new Map(); // effectId → { scopeId, key, glitched, saved }
  const spots = itemSpots(match.level);

  const playersOf = () => Object.values(room.seats).filter(Boolean);
  const scopeOfSeat = (seat) => match.scopes[room.seats[seat]?.teamId];
  const scopeIdOfSeat = (seat) => scopeOfSeat(seat)?.id;
  const scopedItems = (seat) => {
    const scopeId = scopeIdOfSeat(seat);
    return { ...publicItems(state, scopeId), scopeId };
  };

  const pushState = () => {
    for (const p of playersOf()) if (p.connected) sendTo([p.seat], 'item:state', scopedItems(p.seat));
  };

  /** Apply an effect that items.js resolved; returns nothing — state lives on the scope run. */
  const applyEffect = (effect) => {
    const scope = match.scopes[effect.targetId];
    if (!scope || scope.finishedAt) return;
    const run = scope.run;
    const key = effect.configKey;
    if (!key || !(key in (run.initialConfig || {}))) return;
    if (effect.type === 'config-erase') {
      run.s.state[key] = clone(run.initialConfig[key]);
    } else if (effect.type === 'config-glitch') {
      const saved = clone(run.s.state[key]);
      run.s.state[key] = clone(run.initialConfig[key]);
      glitches.set(effect.id, { scopeId: scope.id, key, saved, glitched: clone(run.s.state[key]) });
    }
    run.scoreEvents.push({ type: 'item_hit', detail: effect.type, at: Date.now() });
    onScopeChanged(scope);
  };

  /** Glitch over: put the player's value back unless they already reconfigured that key. */
  const endGlitch = (effectId) => {
    const g = glitches.get(effectId);
    if (!g) return;
    glitches.delete(effectId);
    const scope = match.scopes[g.scopeId];
    if (!scope || scope.finishedAt) return;
    if (same(scope.run.s.state[g.key], g.glitched)) scope.run.s.state[g.key] = g.saved;
    sendTo(scope.members, 'item:notice', { kind: 'glitch-end', text: 'Config Glitch หมดฤทธิ์แล้ว ค่าเดิมกลับมา' });
    onScopeChanged(scope);
  };

  const tick = () => {
    if (room.phase !== 'play' || Date.now() < (match.startsAt || 0)) return;
    const events = tickItems(state, { spawnPoints: spots });
    if (!events.length) return;
    for (const e of events) {
      if (e.type === 'item:effect-end') endGlitch(e.id);
      if (e.type === 'item:spawn') broadcast('item:event', { type: 'spawn', item: e.drop.item, name: ITEMS[e.drop.item].name });
    }
    pushState();
  };
  const timer = setInterval(tick, ITEM_TICK_MS);
  timer.unref?.();

  const notify = (seats, kind, text, extra = {}) => sendTo(seats, 'item:notice', { kind, text, ...extra });

  return {
    state,
    stop() { clearInterval(timer); },
    pushState,
    sendStateTo(seat) { const p = room.seats[seat]; if (p) sendTo([seat], 'item:state', scopedItems(seat)); },

    pickup(player, payload) {
      const drop = state.drops.get(payload?.dropId);
      const distance = drop ? Math.hypot(drop.x - player.x, drop.y - player.y) : Infinity;
      const res = pickUpItem(state, {
        playerId: scopeIdOfSeat(player.seat),
        dropId: payload?.dropId,
        requestId: typeof payload?.requestId === 'string' ? `${player.seat}:${payload.requestId}` : undefined,
        isMember: true,
        inPlay: room.phase === 'play',
        distance,
        maxDistance: PICKUP_RADIUS,
      });
      if (res.ok && !res.duplicate) {
        notify(scopeOfSeat(player.seat).members, 'pickup', `${player.name} เก็บ ${ITEMS[res.item].name}`);
        pushState();
      }
      return res.ok ? { ok: true, item: res.item, duplicate: Boolean(res.duplicate) } : { ok: false, error: res.error };
    },

    use(player, payload) {
      const own = scopeOfSeat(player.seat);
      const inventory = state.inventories.get(own?.id) || [];
      const slot = Number(payload?.slot);
      const item = inventory[slot - 1];
      let target = null;
      let configKey = null;
      if (item === 'configErase' || item === 'configGlitch') {
        const scope = match.scopes[payload?.target];
        if (!scope || scope === own) return { ok: false, error: room.mode === 'team' ? 'เลือกทีมตรงข้ามเป็นเป้าหมาย' : 'เลือกคู่แข่ง 1 คนเป็นเป้าหมาย' };
        if (scope.finishedAt || scope.forfeited) return { ok: false, error: 'เป้าหมายนี้จบการแข่งขันแล้ว' };
        const keys = SABOTAGE_KEYS[match.stageId] || [];
        if (!keys.length) return { ok: false, error: 'ด่านนี้ไม่มีค่าคอนฟิกที่โจมตีได้ — เก็บไอเทมไว้ใช้ด่านอื่น' };
        configKey = pickConfigKey(scope.run);
        target = { id: scope.id, eligible: true, finished: false, sameTeam: false, configKeys: keys };
      }
      const res = useItem(state, {
        playerId: own?.id,
        itemSlot: slot,
        targetId: target?.id,
        requestId: typeof payload?.requestId === 'string' ? `${player.seat}:${payload.requestId}` : undefined,
        isMember: true,
        inPlay: room.phase === 'play',
        target,
        configKey,
      });
      if (!res.ok) return { ok: false, error: res.error };
      if (res.duplicate) return { ok: true, outcome: res.outcome || 'duplicate', duplicate: true };
      const name = ITEMS[res.item].name;
      let outcome;
      if (res.event === 'item:defense-start') {
        outcome = 'defense';
        notify(own.members, 'defense', `${player.name} เปิด ${name} (${ITEM_RULES.timedEffectMs / 1000} วินาที)`);
      } else if (res.event === 'item:blocked') {
        outcome = 'blocked';
        notify(own.members, 'blocked', `${name} ถูก Shield ของเป้าหมายบล็อก`);
        notify(match.scopes[target.id].members, 'shielded', `Shield บล็อก ${name} ได้สำเร็จ`);
      } else if (res.event === 'item:reflected') {
        outcome = 'reflected';
        applyEffect(res.resolution.reflectedEffect);
        notify(own.members, 'hit', `${name} ถูก Reflect สะท้อนกลับมาที่คุณ!`, { item: res.item });
        notify(match.scopes[target.id].members, 'reflected', `Reflect สะท้อน ${name} กลับไปหาผู้โจมตี`);
      } else {
        outcome = 'applied';
        applyEffect(res.effect);
        notify(own.members, 'attack', `ใช้ ${name} กับ ${room.mode === 'team' ? `ทีม ${target.id}` : room.seats[target.id]?.name} สำเร็จ`);
        notify(match.scopes[target.id].members, 'hit', res.item === 'configErase'
          ? 'คุณถูก Config Erase — ค่าคอนฟิกหนึ่งรายการถูกรีเซ็ต ตรวจสอบและตั้งค่าใหม่'
          : `คุณถูก Config Glitch — ค่าคอนฟิกหนึ่งรายการรวน ${ITEM_RULES.timedEffectMs / 1000} วินาที`, { item: res.item });
      }
      pushState();
      return { ok: true, item: res.item, outcome };
    },

    /** Generic, answer-free status for the progress HUD. */
    disrupted(scopeId) {
      return publicItems(state, scopeId).status.disrupted;
    },
  };
}
