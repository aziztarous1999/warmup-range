import { roundSens } from './config';
import { summarize, type RoundStats } from './stats';

// Multipliers applied to the player's base sensitivity, played in a random (blind) order.
export const WIDE = [0.7, 0.85, 1, 1.15, 1.3];
export const NARROW = [0.9, 0.95, 1, 1.05, 1.1];

export interface FinderResult { mult: number; sens: number; stats: RoundStats }
export interface FinderRow {
  mult: number; sens: number; kps: number; accuracy: number; overshoot: number | null; avgTTK: number | null;
  perf: number; smoothed: number;
}
export interface FinderAnalysis { base: number; recommended: number; rows: FinderRow[]; reason: string; edge: boolean }

export function planSteps(spread: number[]) {
  const s = spread.slice();
  for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}

export function analyze(base: number, results: FinderResult[]): FinderAnalysis {
  const rows: FinderRow[] = results
    .map(r => {
      const s = summarize(r.stats);
      const acc = s.accuracy ?? 0;
      const over = s.overshootRate;
      // Kills/sec weighted heavily by accuracy, penalising uncontrolled overshooting.
      const perf = s.kps * acc * acc * (1 - 0.6 * Math.max(0, (over ?? 0) - 0.2));
      return { mult: r.mult, sens: r.sens, kps: s.kps, accuracy: acc, overshoot: over, avgTTK: s.avgTTK, perf, smoothed: 0 };
    })
    .sort((a, b) => a.mult - b.mult);

  // Smooth with neighbours so a single lucky round doesn't decide.
  rows.forEach((r, i) => {
    const prev = rows[i - 1], next = rows[i + 1];
    if (prev && next) r.smoothed = 0.5 * r.perf + 0.25 * prev.perf + 0.25 * next.perf;
    else r.smoothed = 0.67 * r.perf + 0.33 * (prev ?? next ?? r).perf;
  });

  const best = rows.reduce((a, b) => (b.smoothed > a.smoothed ? b : a), rows[0]);
  const lowest = rows[0], highest = rows[rows.length - 1];
  const edge = best === lowest || best === highest;

  let reason = `You performed best around ${best.sens} (${Math.round(best.accuracy * 100)}% accuracy, ${best.kps.toFixed(2)} kills/s).`;
  if (highest.overshoot != null && highest.overshoot > 0.3 && best !== highest)
    reason += ` At ${highest.sens} you overshot ${Math.round(highest.overshoot * 100)}% of flicks.`;
  if (best !== lowest && lowest.avgTTK != null && best.avgTTK != null && lowest.avgTTK > best.avgTTK * 1.1)
    reason += ` At ${lowest.sens} you were ${Math.round((lowest.avgTTK - best.avgTTK) * 1000)} ms slower per kill.`;
  if (edge) reason += ' Your best result was at the edge of the tested range — run a refine pass around it to confirm.';

  return { base, recommended: roundSens(best.sens), rows, reason, edge };
}
