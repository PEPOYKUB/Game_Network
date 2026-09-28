// Per-stage score: base + speed bonus − overtime − hints − wrong configs + command efficiency.

export const BASE_SCORE = 100;
export const WRONG_CONFIG_PENALTY = 3;

export function scoreRun(run) {
  const { stage } = run;
  const elapsed = Math.max(0, Math.round(((run.completedAt ?? Date.now()) - run.startedAt) / 1000));
  const limit = stage.minutes * 60;
  const timeBonus = elapsed <= limit ? Math.round(50 * (1 - elapsed / limit)) : 0;
  const overtime = elapsed > limit ? -Math.min(40, Math.floor((elapsed - limit) / 15)) : 0;
  const hintPenalty = -run.hints.reduce((sum, h) => sum + h.penalty, 0);
  const wrongPenalty = -Math.min(30, run.wrong * WRONG_CONFIG_PENALTY);
  const efficiency = run.commands <= stage.optimal + 2 ? 20 : run.commands <= stage.optimal * 2 + 2 ? 10 : 0;
  const total = Math.max(10, BASE_SCORE + timeBonus + overtime + hintPenalty + wrongPenalty + efficiency);
  return {
    base: BASE_SCORE,
    elapsed,
    limit,
    downtime: elapsed,
    timeBonus,
    overtime,
    hints: run.hints.length,
    hintPenalty,
    wrong: run.wrong,
    wrongPenalty,
    commands: run.commands,
    optimal: stage.optimal,
    efficiency,
    total,
  };
}
