// Shared game configuration. Pure data/helpers: safe to import on the server (API validation) and client.

export const GAMES = {
  valorant: { label: 'Valorant', yaw: 0.07, hfov: 103, defSens: 0.4 },
  cs2: { label: 'CS2 / CS:GO', yaw: 0.022, hfov: 106.26, defSens: 1.27 },
} as const;
export type GameKey = keyof typeof GAMES;

export type ModeKey =
  | 'gridshot' | 'flick' | 'headline' | 'reflex' | 'tracking' | 'omni'
  | 'peek' | 'coverTrack' | 'finder';

export interface ModeDef {
  label: string;
  desc: string;
  type: 'click' | 'track';
  count: number;
  life?: number;          // lifetime multiplier (click modes)
  size?: number;          // radius multiplier
  delay?: boolean;        // random delay before each spawn
  area?: { yaw: number; pmin: number; pmax: number };
  minDist?: number;       // min angular distance from current aim when spawning
  omni?: boolean;         // spawn all around, show off-screen arrow
  bot?: boolean;          // humanoid target with head (x3) and body hitboxes
  botSpeed?: number;      // strafe speed multiplier for bots
  jumps?: boolean;        // bot randomly jumps
  cover?: boolean;        // obstacles between you and the bot
  measure?: boolean;      // measure overshoot / reach / settle (single target flicks)
  hidden?: boolean;       // not selectable in the menu
}

export const MODES: Record<ModeKey, ModeDef> = {
  gridshot: { label: 'Gridshot', desc: '3 targets on a grid. Clear them as fast as you can.', type: 'click', count: 3 },
  flick: { label: 'Flick', desc: 'One target, wide spread, short lifetime. Snap and fire.', type: 'click', count: 1,
    life: 1, area: { yaw: 45, pmin: -8, pmax: 18 }, minDist: 12, measure: true },
  headline: { label: 'Headshot Line', desc: 'Small targets at head height. Train crosshair placement.', type: 'click', count: 1,
    life: 1.2, size: 0.65, area: { yaw: 40, pmin: 0.5, pmax: 1.5 }, minDist: 8, measure: true },
  reflex: { label: 'Reflex', desc: 'Random-delay pops near your crosshair. Pure reaction time.', type: 'click', count: 1,
    life: 0.6, size: 0.8, delay: true, area: { yaw: 14, pmin: -4, pmax: 10 }, measure: true },
  tracking: { label: 'Tracking', desc: 'Strafing, jumping bot (ADAD). Stay on it — head time scores x3.', type: 'track', count: 1,
    bot: true, botSpeed: 1.5, jumps: true },
  omni: { label: '360° Awareness', desc: 'Targets spawn all around you. Follow the arrow.', type: 'click', count: 1,
    life: 2.6, area: { yaw: 180, pmin: -6, pmax: 25 }, omni: true, measure: true },
  peek: { label: 'Peek Shots', desc: 'Bot strafes behind walls and crates. Shoot it when it peeks — headshots x3.', type: 'click', count: 1,
    bot: true, cover: true },
  coverTrack: { label: 'Cover Tracking', desc: 'Track a bot through cover. Only visible time counts, head time x3.', type: 'track', count: 1,
    bot: true, botSpeed: 1.2, cover: true },
  finder: { label: 'Sensitivity test', desc: '', type: 'click', count: 1, life: 1.3,
    area: { yaw: 35, pmin: -6, pmax: 16 }, minDist: 10, measure: true, hidden: true },
};

export const PLAY_MODES = (Object.keys(MODES) as ModeKey[]).filter(k => !MODES[k].hidden);

export const DIFF = {
  normal: { label: 'Normal', r: 0.42, life: 1.6, speed: 1.0, penalty: 25, botSpeed: 3.2, head: 0.24, jump: 0.12 },
  pro: { label: 'Professional', r: 0.26, life: 0.95, speed: 1.8, penalty: 50, botSpeed: 5.6, head: 0.18, jump: 0.25 },
} as const;
export type DiffKey = keyof typeof DIFF;

export const RANKED_DURATION = 60;   // only 60 s rounds go on the leaderboard
export const FINDER_DURATION = 15;
export const DIST = 12;              // orb target distance (world units)

// Points
export const HIT_BASE = 100;          // orb hit
export const MAX_SPEED_BONUS = 100;   // orb speed bonus
export const BODY_BASE = 50;          // bot body shot
export const BODY_BONUS = 50;         // bot body speed bonus
export const HEAD_MULT = 3;           // headshot = 3x a body shot (click and tracking)
export const TRACK_RATE = 100;        // points per second on the body (x HEAD_MULT on the head, x1.5 on pro)
export const PRO_TRACK_MULT = 1.5;

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const angDiff = (a: number, b: number) => ((a - b) % 360 + 540) % 360 - 180;

/** Physical distance the mouse travels for a full 360° turn. */
export function cm360(game: GameKey, sens: number, dpi: number) {
  const deg = sens * GAMES[game].yaw;
  const cm = (360 / (deg * dpi)) * 2.54;
  return isFinite(cm) && cm > 0 ? cm : null;
}

export const roundSens = (s: number) => Math.round(s * 1000) / 1000;
