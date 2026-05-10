import { Session } from '../types';

export interface ContextRotScore {
  score: number;             // 0–10
  label: 'healthy' | 'warning' | 'stale';
  turnsCount: number;
  sessionAgeMinutes: number;
  inputBloatFactor: number;   // last-third avg input / first-third avg input
  outputDeclineFactor: number; // last-third avg output / first-third avg output
}

/**
 * Derives a context-rot health score from static session data.
 *
 * Signals used (all derivable without live instrumentation):
 *   - Turn count: high turn count → accumulated irrelevant context
 *   - Session age: long sessions accumulate distraction / poisoning
 *   - Input bloat: growing input tokens across turns → context window filling
 *   - Output decline: shrinking output tokens → model generating less
 *   - Total input size: absolute context pressure
 *
 * Score 0–3 → healthy, 4–6 → warning, 7–10 → stale.
 */
export function computeContextRotScore(session: Session): ContextRotScore {
  const interactions = session.interactions;
  const turnsCount = interactions.length;
  const sessionAgeMinutes = (session.endTime.getTime() - session.startTime.getTime()) / 60000;

  let inputBloatFactor = 1;
  let outputDeclineFactor = 1;

  if (turnsCount >= 6) {
    const third = Math.floor(turnsCount / 3);
    const firstThird = interactions.slice(0, third);
    const lastThird = interactions.slice(turnsCount - third);

    const avgInFirst = avg(firstThird.map(i => i.inputTokens));
    const avgInLast = avg(lastThird.map(i => i.inputTokens));
    inputBloatFactor = avgInFirst > 0 ? avgInLast / avgInFirst : 1;

    const avgOutFirst = avg(firstThird.map(i => i.outputTokens));
    const avgOutLast = avg(lastThird.map(i => i.outputTokens));
    outputDeclineFactor = avgOutFirst > 0 ? avgOutLast / avgOutFirst : 1;
  }

  let score = 0;

  if (turnsCount > 80) { score += 2; }
  else if (turnsCount > 40) { score += 1; }

  if (sessionAgeMinutes > 120) { score += 2; }
  else if (sessionAgeMinutes > 60) { score += 1; }

  if (inputBloatFactor > 4) { score += 3; }
  else if (inputBloatFactor > 2) { score += 2; }
  else if (inputBloatFactor > 1.5) { score += 1; }

  if (outputDeclineFactor < 0.4) { score += 2; }
  else if (outputDeclineFactor < 0.65) { score += 1; }

  if (session.totalInputTokens > 200000) { score += 2; }
  else if (session.totalInputTokens > 80000) { score += 1; }

  score = Math.min(10, score);
  const label = score >= 7 ? 'stale' : score >= 4 ? 'warning' : 'healthy';

  return { score, label, turnsCount, sessionAgeMinutes, inputBloatFactor, outputDeclineFactor };
}

function avg(arr: number[]): number {
  if (arr.length === 0) { return 0; }
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
