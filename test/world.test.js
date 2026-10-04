import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelForStage, spawnPlayer, canStand, movePlayer, nearbyComputer, PLAYER_RADIUS } from '../public/js/world.js';

const STAGES = [1, 4, 7, 10];

// Flood the walkable floor from a start point in 6-unit steps.
function flood(level, role, start, online = false) {
  const queue = [start], seen = new Set(['0,0']);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
      const x = p.x + dx, y = p.y + dy;
      const key = `${Math.round((x - start.x) / 6)},${Math.round((y - start.y) / 6)}`;
      if (!seen.has(key) && canStand(level, role, x, y, online)) { seen.add(key); queue.push({ x, y }); }
    }
  }
  return queue;
}

function pngSize(file) {
  const buf = readFileSync(new URL(`../public${file}`, import.meta.url));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

for (const stage of STAGES) {
  const level = levelForStage(stage);

  test(`room ${stage}: geometry matches the pastel map image`, () => {
    assert.match(level.file, /map-0\d-pastel\.png$/);
    assert.deepEqual(pngSize(level.file), level.size);
    assert.ok(Math.abs(level.height / level.width - level.size[1] / level.size[0]) < 1e-9);
  });

  for (const role of ['A', 'B']) {
    test(`room ${stage} ${role}: spawn moves and every computer is reachable before the door opens`, () => {
      const spawn = spawnPlayer(stage, role);
      assert.ok(canStand(level, role, spawn.x, spawn.y), 'spawn must be on free floor');
      const moved = movePlayer(level, role, spawn, { x: role === 'A' ? 1 : -1, y: 0 }, .1);
      assert.notEqual(moved.x, spawn.x);
      const reach = flood(level, role, spawn);
      for (const station of level.stations[role]) {
        assert.ok(reach.some((p) => nearbyComputer(level, role, p) === station), `station at ${Math.round(station.x)},${Math.round(station.y)} unreachable`);
      }
      // Stations belong to the role's own room.
      const [a, b] = level.split;
      for (const s of level.stations[role]) assert.ok(role === 'A' ? s.x < a : s.x > b);
    });

    test(`room ${stage} ${role}: locked door keeps the player in their room`, () => {
      const [a, b] = level.split;
      const reach = flood(level, role, spawnPlayer(stage, role));
      const r = PLAYER_RADIUS;
      assert.ok(reach.every((p) => (role === 'A' ? p.x + r <= a : p.x - r >= b)));
      // The other room's computer can never be used from this side.
      const other = role === 'A' ? 'B' : 'A';
      assert.ok(reach.every((p) => !nearbyComputer(level, other, p)));
    });
  }

  test(`room ${stage}: after the door opens A and B can walk to each other`, () => {
    const a = spawnPlayer(stage, 'A'), b = spawnPlayer(stage, 'B');
    const reachA = flood(level, 'A', a, true);
    const reachB = flood(level, 'B', b, true);
    assert.ok(reachA.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 8), 'A reaches B spawn');
    assert.ok(reachB.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 8), 'B reaches A spawn');
    const [left, right] = level.split, [top, bottom] = level.passage;
    assert.ok(reachA.some((p) => p.x > left && p.x < right && p.y > top && p.y < bottom), 'path uses the passage');
  });
}
