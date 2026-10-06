import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHARACTERS } from '../server/game/rooms.js';
import { levelForStage, movePlayer, spawnPlayer } from '../public/js/world.js';

test('both supplied characters are selectable and have complete four-direction sheets', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url)));
  for (const id of ['student-one', 'student-two']) {
    const char = manifest.characters.chars.find((entry) => entry.id === id);
    assert.ok(char);
    assert.ok(CHARACTERS.includes(char.id));
    assert.equal(char.frames, 4);
    assert.deepEqual(char.directions, { front: 0, right: 1, back: 2, left: 3 });
    const png = readFileSync(new URL(`../public/assets/chars/${id}.png`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), char.frameW * char.frames);
    assert.equal(png.readUInt32BE(20), char.frameH * Object.keys(char.directions).length);
  }
});

test('movement broadcasts the direction needed for the new character', () => {
  const level = levelForStage(1);
  const spawn = spawnPlayer(1, 'A');
  assert.equal(spawn.direction, 'front');
  for (const [input, direction] of [
    [{ x: 1, y: 0 }, 'right'],
    [{ x: -1, y: 0 }, 'left'],
    [{ x: 0, y: -1 }, 'back'],
    [{ x: 0, y: 1 }, 'front'],
  ]) {
    const moved = movePlayer(level, 'A', spawn, input, 0.05);
    assert.equal(moved.direction, direction);
    assert.equal(moved.moving, true);
    assert.equal(movePlayer(level, 'A', moved, { x: 0, y: 0 }, 0.05).direction, direction);
  }
});
