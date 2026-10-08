// Chiptune SFX and a looping BGM synthesised with WebAudio (no audio files needed).
import { storage } from './ui.js';

const store = storage('local');
// volume = master level; each channel has its own switch and level.
export const DEFAULTS = Object.freeze({ master: true, volume: 60, bgm: true, bgmVolume: 70, sfx: true, sfxVolume: 80 });
export const settings = { ...DEFAULTS, ...store.get('kuhu.settings', {}) };

let ctx = null;
let master = null;
let sfxBus = null;
let bgmBus = null;
let bgmTimer = null;
let nextNoteTime = 0;
let step = 0;
const itemSoundUrls = Object.freeze({
  configErase: '/assets/audio/config-erase.mp3',
  configGlitch: '/assets/audio/config-glitch.mp3',
  shield: '/assets/audio/shield.mp3',
  reflect: '/assets/audio/reflect.mp3',
  gameOver: '/assets/audio/game-over.mp3',
  story: '/assets/audio/text.mp3',
});
const itemSoundBuffers = new Map();
const itemSoundLoads = new Set();

function save() {
  store.set('kuhu.settings', settings);
}

function applyVolume() {
  if (!master) return;
  master.gain.value = settings.master ? (settings.volume / 100) * 0.5 : 0;
  sfxBus.gain.value = settings.sfx ? settings.sfxVolume / 100 : 0;
  bgmBus.gain.value = settings.bgm ? 0.35 * (settings.bgmVolume / 100) : 0;
}

function loadItemSounds() {
  if (!ctx) return;
  for (const [item, url] of Object.entries(itemSoundUrls)) {
    if (itemSoundBuffers.has(item) || itemSoundLoads.has(item)) continue;
    itemSoundLoads.add(item);
    const audioContext = ctx;
    fetch(url)
      .then((response) => { if (!response.ok) throw new Error(`Unable to load ${url}`); return response.arrayBuffer(); })
      .then((bytes) => audioContext.decodeAudioData(bytes))
      .then((buffer) => { if (ctx === audioContext) itemSoundBuffers.set(item, buffer); })
      .catch(() => {})
      .finally(() => itemSoundLoads.delete(item));
  }
}

function playItemSound(item) {
  const buffer = itemSoundBuffers.get(item);
  if (!ctx || !buffer) return false;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(sfxBus);
  source.start();
  return true;
}

/** Must be called from a user gesture (browsers block audio before that). */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      sfxBus = ctx.createGain();
      bgmBus = ctx.createGain();
      sfxBus.connect(master);
      bgmBus.connect(master);
      master.connect(ctx.destination);
      applyVolume();
    }
    if (ctx.state === 'suspended') ctx.resume();
    loadItemSounds();
    if (settings.bgm) startBgm();
  } catch {
    ctx = null;
  }
}

function tone(freq, dur, { type = 'square', vol = 0.18, when = 0, slide = 0, bus = sfxBus } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  click: () => tone(660, 0.06, { vol: 0.12 }),
  hover: () => tone(990, 0.03, { vol: 0.05 }),
  key: () => tone(1400 + Math.random() * 300, 0.015, { vol: 0.025, type: 'triangle' }),
  exec: () => tone(520, 0.07, { vol: 0.1, slide: 180 }),
  ok: () => [784, 1047].forEach((f, i) => tone(f, 0.1, { when: i * 0.08, vol: 0.12 })),
  err: () => tone(160, 0.2, { type: 'sawtooth', vol: 0.1, slide: -60 }),
  chat: () => tone(880, 0.05, { vol: 0.08, type: 'triangle', slide: 220 }),
  hint: () => [880, 660, 440].forEach((f, i) => tone(f, 0.09, { when: i * 0.07, vol: 0.1 })),
  start: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, { when: i * 0.07, vol: 0.12 })),
  clear: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i === 6 ? 0.35 : 0.12, { when: i * 0.1, vol: 0.13 })),
  itemUse: (item) => {
    if (playItemSound(item)) return;
    if (item === 'shield') return [587, 880, 1175].forEach((f, i) => tone(f, 0.14, { when: i * 0.07, type: 'sine', vol: 0.1 }));
    if (item === 'reflect') return [784, 1047, 784, 1319].forEach((f, i) => tone(f, 0.1, { when: i * 0.065, type: 'triangle', vol: 0.09 }));
    if (item === 'configGlitch') return [1800, 620, 1450, 430].forEach((f, i) => tone(f, 0.07, { when: i * 0.045, type: 'sawtooth', vol: 0.055 }));
    if (item === 'configErase') return [900, 680, 420].forEach((f, i) => tone(f, 0.11, { when: i * 0.06, type: 'square', vol: 0.08 }));
    [660, 990].forEach((f, i) => tone(f, 0.08, { when: i * 0.07, vol: 0.1 }));
  },
  itemHit: (item = 'configGlitch') => {
    if (playItemSound(item)) return;
    [440, 330, 220].forEach((f, i) => tone(f, 0.13, { when: i * 0.07, type: 'triangle', vol: 0.09 }));
  },
  gameOver: () => {
    if (playItemSound('gameOver')) return;
    [440, 370, 311, 220].forEach((f, i) => tone(f, 0.28, { when: i * 0.2, type: 'triangle', vol: 0.12, slide: -55 }));
  },
  story: () => {
    if (playItemSound('story')) return;
    [660, 880, 1047].forEach((f, i) => tone(f, 0.1, { when: i * 0.08, type: 'triangle', vol: 0.08 }));
  },
};

// C – Am – F – G, one bar each, eighth notes.
const CHORDS = [
  [262, 330, 392, 523],
  [220, 262, 330, 440],
  [175, 220, 262, 349],
  [196, 247, 294, 392],
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
const BEAT = 60 / 112 / 2;

function scheduleBgm() {
  while (nextNoteTime < ctx.currentTime + 0.25) {
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    const i = step % 8;
    const when = nextNoteTime - ctx.currentTime;
    tone(chord[ARP[i]] * 2, BEAT * 0.9, { type: 'square', vol: 0.05, when, bus: bgmBus });
    if (i % 4 === 0) tone(chord[0] / 2, BEAT * 3.6, { type: 'triangle', vol: 0.16, when, bus: bgmBus });
    if (i % 2 === 1) tone(6000, 0.02, { type: 'square', vol: 0.012, when, bus: bgmBus });
    nextNoteTime += BEAT;
    step += 1;
  }
}

function startBgm() {
  if (!ctx || bgmTimer) return;
  nextNoteTime = ctx.currentTime + 0.1;
  bgmTimer = setInterval(scheduleBgm, 90);
}

function stopBgm() {
  clearInterval(bgmTimer);
  bgmTimer = null;
}

export function setSetting(key, value) {
  settings[key] = value;
  save();
  applyVolume();
  if (key === 'bgm') {
    if (value && ctx) startBgm();
    else stopBgm();
  }
}

export function resetSettings() {
  for (const [key, value] of Object.entries(DEFAULTS)) setSetting(key, value);
}

/** A short phrase through both channels so the player can judge the levels. */
export function testSound() {
  unlockAudio();
  if (!ctx) return;
  [523, 659, 784].forEach((f, i) => tone(f, 0.12, { when: i * 0.1, vol: 0.13 }));
  tone(262, 0.5, { type: 'triangle', vol: 0.18, when: 0.32, bus: bgmBus });
}
