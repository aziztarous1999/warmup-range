import type { DiffKey, ModeKey } from './config';

/** Raw numbers recorded by the engine during one round. */
export interface RoundStats {
  mode: ModeKey;
  diff: DiffKey;
  duration: number;
  score: number;
  hits: number;
  misses: number;
  expired: number;
  blocked: number;        // shots that hit cover
  headshots: number;
  reactions: number[];    // spawn -> kill (s)
  reach: number[];        // spawn -> crosshair first on target (s)
  settle: number[];       // crosshair on target -> click (s)
  overshoots: number;     // flicks that went past the target
  measured: number;       // flicks eligible for overshoot measurement
  onTarget: number;       // tracking: seconds on target
  headTime: number;       // tracking: seconds of that on the head
  visible: number;        // cover tracking: seconds the bot was visible
  headErr: number | null; // headline: avg |pitch - head height| in degrees
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function summarize(s: RoundStats) {
  const shots = s.hits + s.misses;
  return {
    shots,
    accuracy: shots ? s.hits / shots : null,
    avgTTK: avg(s.reactions),
    avgReach: avg(s.reach),
    avgSettle: avg(s.settle),
    kps: s.hits / s.duration,
    overshootRate: s.measured >= 5 ? s.overshoots / s.measured : null,
    trackPct: s.visible > 0 ? s.onTarget / s.visible : s.onTarget / s.duration,
    headRate: s.hits ? s.headshots / s.hits : null,
    headTimePct: s.onTarget > 0 ? s.headTime / s.onTarget : null,
    blockedRate: shots ? s.blocked / shots : null,
    expiredRate: s.hits + s.expired ? s.expired / (s.hits + s.expired) : null,
  };
}
export type Summary = ReturnType<typeof summarize>;

export const pct = (v: number | null, digits = 0) => (v == null ? '—' : (v * 100).toFixed(digits) + '%');
export const ms = (v: number | null) => (v == null ? '—' : Math.round(v * 1000) + ' ms');
