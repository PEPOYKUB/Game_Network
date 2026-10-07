// Authoritative item lifecycle for competitive modes. This module is deliberately
// independent of rooms.js so the cooperative mode can keep its existing rules.
import { randomUUID } from 'node:crypto';

export const ITEM_RULES = Object.freeze({
  spawnEveryMs: [10_000, 20_000],
  dropLifetimeMs: 15_000,
  inventoryCap: 3,
  timedEffectMs: 2_000,
  switchCooldownMs: [10_000, 20_000],
  requestDedupeMs: 60_000,
});

export const ITEMS = Object.freeze({
  configErase: Object.freeze({ name: 'Config Erase', kind: 'attack', description: 'คืนค่าคอนฟิกของคู่แข่งหนึ่งรายการเป็นค่าเริ่มต้น' }),
  configGlitch: Object.freeze({ name: 'Config Glitch', kind: 'attack', description: 'ทำให้คอนฟิกหนึ่งรายการรวนชั่วคราว 2 วินาที พร้อมแจ้งเตือนผู้ถูกกระทบ' }),
  shield: Object.freeze({ name: 'Shield', kind: 'defense', description: 'บล็อกการโจมตีครั้งถัดไปภายใน 2 วินาที' }),
  reflect: Object.freeze({ name: 'Reflect', kind: 'defense', description: 'สะท้อนการโจมตีครั้งถัดไปภายใน 2 วินาที' }),
  switch: Object.freeze({ name: 'Switch / Lever', kind: 'interaction', description: 'สั่งรบกวนทีมคู่แข่งชั่วคราว 2 วินาทีจากจุดปฏิสัมพันธ์' }),
});
const PICKUP_ITEMS = Object.keys(ITEMS).filter((item) => item !== 'switch');

const randomBetween = (min, max, rng = Math.random) => min + Math.floor(rng() * (max - min + 1));

export function createItemState(now = Date.now(), rng = Math.random) {
  return {
    drops: new Map(),
    inventories: new Map(),
    defenses: new Map(),
    effects: new Map(),
    requests: new Map(),
    switchReadyAt: new Map(),
    nextSpawnAt: now + randomBetween(...ITEM_RULES.spawnEveryMs, rng),
  };
}

function remember(state, requestId, response, now) {
  if (!requestId) return response;
  state.requests.set(requestId, { response, expiresAt: now + ITEM_RULES.requestDedupeMs });
  return response;
}

const requestKey = (playerId, requestId) => requestId ? `${playerId}:${requestId}` : null;

function duplicate(state, requestId, now) {
  if (!requestId) return null;
  const prior = state.requests.get(requestId);
  if (!prior) return null;
  if (prior.expiresAt <= now) { state.requests.delete(requestId); return null; }
  return { ...prior.response, duplicate: true };
}

function cleanRequests(state, now) {
  for (const [id, value] of state.requests) if (value.expiresAt <= now) state.requests.delete(id);
}

/** Expire drops/effects and create a server-selected drop when the timer is due. */
export function tickItems(state, { now = Date.now(), spawnPoints = [], rng = Math.random } = {}) {
  cleanRequests(state, now);
  const events = [];
  for (const [id, drop] of state.drops) {
    if (drop.expiresAt > now) continue;
    state.drops.delete(id);
    events.push({ type: 'item:expired', dropId: id });
  }
  for (const [playerId, defense] of state.defenses) {
    if (defense.expiresAt > now) continue;
    state.defenses.delete(playerId);
    events.push({ type: 'item:defense-ended', playerId, item: defense.item });
  }
  for (const [id, effect] of state.effects) {
    if (effect.endsAt > now) continue;
    state.effects.delete(id);
    events.push({ ...effect, type: 'item:effect-end', effectType: effect.type });
  }
  if (now >= state.nextSpawnAt && spawnPoints.length && state.drops.size === 0) {
    const itemIds = PICKUP_ITEMS;
    const point = spawnPoints[Math.floor(rng() * spawnPoints.length)];
    const item = itemIds[Math.floor(rng() * itemIds.length)];
    const drop = { id: randomUUID(), item, x: point.x, y: point.y, expiresAt: now + ITEM_RULES.dropLifetimeMs };
    state.drops.set(drop.id, drop);
    events.push({ type: 'item:spawn', drop: { ...drop } });
  }
  if (now >= state.nextSpawnAt) state.nextSpawnAt = now + randomBetween(...ITEM_RULES.spawnEveryMs, rng);
  return events;
}

/** Inventory and visible drops only; never exposes target identities or hidden effects. */
export function publicItems(state, playerId, now = Date.now()) {
  const inventory = state.inventories.get(playerId) || [];
  const defense = state.defenses.get(playerId);
  const activeEffects = [...state.effects.values()].filter((effect) => effect.targetId === playerId && effect.endsAt > now);
  const disruptionEndsAt = activeEffects.reduce((end, effect) => Math.max(end, effect.endsAt), 0);
  return {
    drops: [...state.drops.values()].map((drop) => ({ id: drop.id, item: drop.item, x: drop.x, y: drop.y, expiresAt: drop.expiresAt })),
    inventory: inventory.map((item, index) => ({ slot: index + 1, item, ...ITEMS[item] })),
    defense: defense ? { item: defense.item, expiresAt: defense.expiresAt, remainingMs: Math.max(0, defense.expiresAt - now) } : null,
    status: disruptionEndsAt ? { disrupted: true, remainingMs: disruptionEndsAt - now } : { disrupted: false, remainingMs: 0 },
  };
}

/** Caller supplies server-derived membership, phase, player position and distance. */
export function pickUpItem(state, { playerId, dropId, requestId, isMember, inPlay, distance, maxDistance = 40 }, now = Date.now()) {
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) return { ok: false, error: 'คำขอไม่ถูกต้อง' };
  requestId = requestKey(playerId, requestId);
  const prior = duplicate(state, requestId, now);
  if (prior) return prior;
  const fail = (error) => remember(state, requestId, { ok: false, error }, now);
  if (!isMember) return fail('คุณไม่ได้อยู่ในห้องนี้');
  if (!inPlay) return fail('เก็บไอเทมได้เฉพาะระหว่างการแข่งขัน');
  const inventory = state.inventories.get(playerId) || [];
  if (inventory.length >= ITEM_RULES.inventoryCap) return fail('ช่องเก็บไอเทมเต็ม (สูงสุด 3 ชิ้น)');
  const drop = state.drops.get(dropId);
  if (!drop || drop.expiresAt <= now) return fail('ไอเทมนี้หมดอายุหรือถูกเก็บไปแล้ว');
  if (!Number.isFinite(distance) || distance > maxDistance) return fail('อยู่ไกลจากไอเทมเกินไป');
  state.drops.delete(dropId);
  inventory.push(drop.item);
  state.inventories.set(playerId, inventory);
  return remember(state, requestId, { ok: true, item: drop.item, inventory: [...inventory] }, now);
}

function takeItem(state, playerId, itemId) {
  const inventory = state.inventories.get(playerId) || [];
  const index = Number.isInteger(itemId) ? itemId : inventory.indexOf(itemId);
  if (index < 0 || index >= inventory.length) return null;
  const [item] = inventory.splice(index, 1);
  if (inventory.length) state.inventories.set(playerId, inventory);
  else state.inventories.delete(playerId);
  return item;
}

function applyIncoming(state, targetId, attackerId, effect, now) {
  const defense = state.defenses.get(targetId);
  if (!defense || defense.expiresAt <= now) {
    if (defense) state.defenses.delete(targetId);
    return { status: 'applied', effect };
  }
  state.defenses.delete(targetId);
  if (defense.item === 'shield') return { status: 'blocked', defenderId: targetId, attackerId };
  // A reflected attack is returned directly and is never evaluated against a
  // second Reflect charge, preventing ping-pong loops.
  return { status: 'reflected', defenderId: targetId, attackerId, reflectedEffect: effect };
}

/**
 * Use one inventory item. `target` data must be resolved by the server and must
 * include eligible/team/finished checks; client target IDs are never trusted.
 */
export function useItem(state, { playerId, itemSlot, targetId, requestId, isMember, inPlay, target, configKey }, now = Date.now()) {
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) return { ok: false, error: 'คำขอไม่ถูกต้อง' };
  requestId = requestKey(playerId, requestId);
  const prior = duplicate(state, requestId, now);
  if (prior) return prior;
  const fail = (error) => remember(state, requestId, { ok: false, error }, now);
  if (!isMember) return fail('คุณไม่ได้อยู่ในห้องนี้');
  if (!inPlay) return fail('ใช้ไอเทมได้เฉพาะระหว่างการแข่งขัน');
  const inventory = state.inventories.get(playerId) || [];
  if (!Number.isInteger(itemSlot) || itemSlot < 1 || itemSlot > inventory.length) return fail('ไม่มีไอเทมในช่องนี้');
  const inventoryIndex = itemSlot - 1;
  const item = inventory[inventoryIndex];
  if (!item) return fail('ไม่มีไอเทมในช่องนี้');
  if (['configErase', 'configGlitch'].includes(item)) {
    if (!target || !target.eligible || target.finished || target.sameTeam || target.id !== targetId || target.id === playerId)
      return fail('เลือกเป้าหมายที่เป็นคู่แข่งและยังแข่งขันอยู่');
    if (typeof configKey !== 'string' || !target.configKeys?.includes(configKey)) return fail('เลือกค่าคอนฟิกที่โจมตีได้');
  }
  if (item === 'switch' && (!target || !target.eligible || target.finished || target.sameTeam || target.id === playerId))
    return fail('ไม่มีเป้าหมายฝ่ายตรงข้ามที่ถูกต้อง');

  takeItem(state, playerId, inventoryIndex);
  if (item === 'shield' || item === 'reflect') {
    state.defenses.set(playerId, { item, expiresAt: now + ITEM_RULES.timedEffectMs });
    return remember(state, requestId, { ok: true, item, event: 'item:defense-start', expiresAt: now + ITEM_RULES.timedEffectMs }, now);
  }

  const effect = item === 'configErase'
    ? { type: 'config-erase', configKey, durationMs: 0 }
    : { type: item === 'switch' ? 'switch-disruption' : 'config-glitch', configKey: configKey || null, durationMs: ITEM_RULES.timedEffectMs };
  const resolution = applyIncoming(state, target.id, playerId, effect, now);
  if (resolution.status === 'applied') {
    const effectId = randomUUID();
    const active = { id: effectId, targetId: target.id, attackerId: playerId, ...effect, startedAt: now, endsAt: now + effect.durationMs };
    if (effect.durationMs) state.effects.set(effectId, active);
    return remember(state, requestId, { ok: true, item, event: effect.durationMs ? 'item:effect-start' : 'item:effect-apply', effect: active, resolution }, now);
  }
  if (resolution.status === 'blocked') return remember(state, requestId, { ok: true, item, event: 'item:blocked', resolution }, now);

  const reflected = { ...resolution.reflectedEffect, reflected: true };
  const reflectedEffect = { id: randomUUID(), targetId: playerId, attackerId: target.id, ...reflected, startedAt: now, endsAt: now + reflected.durationMs };
  if (reflectedEffect.durationMs) state.effects.set(reflectedEffect.id, reflectedEffect);
  return remember(state, requestId, { ok: true, item, event: 'item:reflected', resolution: { ...resolution, returnedTo: playerId, reflectedEffect } }, now);
}

/** Switch/Lever uses server-resolved location and targets; cooldown is per switch. */
export function activateSwitch(state, { playerId, switchId, requestId, isMember, inPlay, canReach, targets }, now = Date.now()) {
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) return { ok: false, error: 'คำขอไม่ถูกต้อง' };
  requestId = requestKey(playerId, requestId);
  const prior = duplicate(state, requestId, now);
  if (prior) return prior;
  const fail = (error) => remember(state, requestId, { ok: false, error }, now);
  if (!isMember) return fail('คุณไม่ได้อยู่ในห้องนี้');
  if (!inPlay) return fail('ใช้สวิตช์ได้เฉพาะระหว่างการแข่งขัน');
  if (!canReach) return fail('เดินเข้าใกล้สวิตช์ก่อน');
  const readyAt = state.switchReadyAt.get(switchId) || 0;
  if (now < readyAt) return fail(`สวิตช์กำลังพัก ใช้ได้อีกครั้งใน ${Math.ceil((readyAt - now) / 1000)} วินาที`);
  const eligible = (targets || []).filter((target) => target?.eligible && !target.finished && !target.sameTeam && target.id !== playerId);
  if (!eligible.length) return fail('ไม่มีเป้าหมายฝ่ายตรงข้ามที่ถูกต้อง');
  state.switchReadyAt.set(switchId, now + randomBetween(...ITEM_RULES.switchCooldownMs));
  const results = eligible.map((target) => {
    const effect = { type: 'switch-disruption', durationMs: ITEM_RULES.timedEffectMs };
    const resolution = applyIncoming(state, target.id, playerId, effect, now);
    if (resolution.status !== 'applied') return { targetId: target.id, ...resolution };
    const id = randomUUID();
    state.effects.set(id, { id, targetId: target.id, attackerId: playerId, ...effect, startedAt: now, endsAt: now + ITEM_RULES.timedEffectMs });
    return { targetId: target.id, ...resolution };
  });
  return remember(state, requestId, { ok: true, event: 'item:switch-activated', switchId, results }, now);
}
