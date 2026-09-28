// Team leaderboard (team = one A+B pair), persisted to data/leaderboard.json.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 200;
let file = null;
let entries = [];
let saveTimer = null;

export function initLeaderboard(filePath) {
  file = filePath;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
}

function persist() {
  if (!file) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.promises
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.promises.writeFile(file, JSON.stringify(entries, null, 2)))
      .catch((error) => console.error('[leaderboard] save failed', error.message));
  }, 300);
}

function rank(a, b) {
  return b.stages - a.stages || b.score - a.score || a.time - b.time;
}

/** Upserts the team entry for one room session. */
export function recordTeam({ id, team, cleared, finalCode }) {
  const values = Object.values(cleared);
  const entry = {
    id,
    team,
    stages: values.length,
    score: values.reduce((sum, c) => sum + c.score, 0),
    time: values.reduce((sum, c) => sum + c.time, 0),
    finalCode: finalCode || entries.find((e) => e.id === id)?.finalCode || null,
    updatedAt: Date.now(),
  };
  entries = [entry, ...entries.filter((e) => e.id !== id)].sort(rank).slice(0, MAX_ENTRIES);
  persist();
  return entry;
}

export function topTeams(limit = 10, mineId = null) {
  return entries.slice(0, limit).map(({ id, ...rest }) => ({ ...rest, mine: id === mineId }));
}
