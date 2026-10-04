import {
  BODY_BASE, BODY_BONUS, DIFF, GAMES, HEAD_MULT, HIT_BASE, MAX_SPEED_BONUS, MODES, PLAY_MODES, PRO_TRACK_MULT, RANKED_DURATION, TRACK_RATE,
  type DiffKey, type ModeKey,
} from '../game/config';
import type { Submission } from './types';

export const NAME_RE = /^[A-Za-z0-9_\-. ]{2,16}$/;

type Result = { ok: true; value: Submission } | { ok: false; error: string };

/**
 * Sanity checks on a submitted run. Scores are computed client-side, so this can't stop a determined
 * cheater — it rejects malformed and physically impossible runs.
 */
export function validateSubmission(body: unknown): Result {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!NAME_RE.test(name)) return { ok: false, error: 'Name must be 2–16 letters, numbers, spaces, _ - .' };

  const mode = b.mode as ModeKey, diff = b.diff as DiffKey;
  if (!PLAY_MODES.includes(mode)) return { ok: false, error: 'Unknown mode' };
  if (!(diff in DIFF)) return { ok: false, error: 'Unknown difficulty' };
  if (b.duration !== RANKED_DURATION) return { ok: false, error: `Only ${RANKED_DURATION}s runs are ranked` };

  const score = b.score, hits = b.hits;
  if (typeof score !== 'number' || !Number.isInteger(score)) return { ok: false, error: 'Invalid score' };
  if (typeof hits !== 'number' || !Number.isInteger(hits) || hits < 0) return { ok: false, error: 'Invalid hits' };
  if (score <= 0) return { ok: false, error: 'Score must be positive' };

  const m = MODES[mode];
  let max: number;
  if (m.type === 'track') max = RANKED_DURATION * TRACK_RATE * HEAD_MULT * PRO_TRACK_MULT;
  else {
    if (hits > RANKED_DURATION * 8) return { ok: false, error: 'Implausible run' };
    const perHit = m.bot ? (BODY_BASE + BODY_BONUS) * HEAD_MULT : HIT_BASE + MAX_SPEED_BONUS;
    max = hits * perHit;
  }
  if (score > max + 1) return { ok: false, error: 'Implausible run' };

  const accuracy = typeof b.accuracy === 'number' && b.accuracy >= 0 && b.accuracy <= 100 ? Math.round(b.accuracy * 10) / 10 : null;
  const game = typeof b.game === 'string' && b.game in GAMES ? b.game : 'valorant';
  const cm360 = typeof b.cm360 === 'number' && b.cm360 > 0 && b.cm360 < 1000 ? Math.round(b.cm360 * 10) / 10 : null;

  return { ok: true, value: { name, mode, diff, score, accuracy, game, cm360 } };
}
