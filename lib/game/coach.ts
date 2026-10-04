import { DIFF, GAMES, MODES, cm360, roundSens, type GameKey } from './config';
import { summarize, type RoundStats } from './stats';

export interface Tip { tone: 'good' | 'warn' | 'info'; title: string; text: string }

interface Ctx { game: GameKey; sens: number; dpi: number; prevBest: number | null }

/** Turns a round's numbers into a few concrete, prioritised suggestions. */
export function coach(stats: RoundStats, ctx: Ctx): Tip[] {
  const m = MODES[stats.mode];
  const s = summarize(stats);
  const tips: Tip[] = [];
  const msTxt = (v: number) => `${Math.round(v * 1000)} ms`;
  const lower = roundSens(ctx.sens * 0.9), higher = roundSens(ctx.sens * 1.1);
  const gameName = GAMES[ctx.game].label;

  if (m.type === 'click' && s.shots >= 5) {
    const acc = s.accuracy ?? 0;
    if (acc < 0.7) {
      tips.push({ tone: 'warn', title: 'Accuracy first',
        text: `You missed ${Math.round((1 - acc) * 100)}% of your shots. Misses cost more than speed earns, so slow down until you hit 85%+, then push the pace again.` });
    } else if (acc >= 0.93 && s.avgTTK != null && s.avgTTK > (m.cover ? 0.7 : 0.6)) {
      tips.push({ tone: 'info', title: 'You can go faster',
        text: `${Math.round(acc * 100)}% accuracy is great but kills take ${msTxt(s.avgTTK)} on average. Trade a little accuracy for speed — aim for ~88%.` });
    }

    if (s.overshootRate != null) {
      if (s.overshootRate > 0.35) {
        tips.push({ tone: 'warn', title: 'Overshooting flicks',
          text: `${Math.round(s.overshootRate * 100)}% of your flicks went past the target. Your sensitivity may be too high: try ~10% lower (${lower} in ${gameName}) or run the Sensitivity Finder.` });
      } else if (s.overshootRate > 0.2) {
        tips.push({ tone: 'info', title: 'Control the stop',
          text: `You overshot ${Math.round(s.overshootRate * 100)}% of flicks. Focus on decelerating into the target instead of slamming the mouse.` });
      } else if (s.overshootRate < 0.08 && s.avgReach != null && s.avgReach > 0.45) {
        tips.push({ tone: 'info', title: 'Undershooting',
          text: `You rarely overshoot but take ${msTxt(s.avgReach)} to reach targets — you're creeping up on them. Try ~10% higher sensitivity (${higher}) or commit to the flick with your arm.` });
      }
    }

    if (s.avgSettle != null && s.avgSettle > 0.18) {
      tips.push({ tone: 'info', title: 'Click when you are there',
        text: `Your crosshair sat on the target for ${msTxt(s.avgSettle)} before you fired. Trust the flick — in ranked that hesitation is the duel.` });
    }

    if (s.expiredRate != null && s.expiredRate > 0.25) {
      tips.push({ tone: 'warn', title: 'Targets timing out',
        text: `${Math.round(s.expiredRate * 100)}% of targets disappeared before you shot them. Move to the next target immediately after each shot.` });
    }
  }

  if (stats.mode === 'reflex' && s.avgTTK != null) {
    if (s.avgTTK < 0.33) tips.push({ tone: 'good', title: 'Sharp reactions', text: `Average ${msTxt(s.avgTTK)} — that's excellent reaction speed.` });
    else if (s.avgTTK > 0.45) tips.push({ tone: 'info', title: 'Reaction time',
      text: `Average ${msTxt(s.avgTTK)}. Keep your crosshair centred and relaxed; reaction improves when you're not tense or tired.` });
  }

  if (stats.mode === 'headline' && stats.headErr != null) {
    if (stats.headErr > 3) tips.push({ tone: 'warn', title: 'Crosshair placement',
      text: `Your crosshair drifted ${stats.headErr.toFixed(1)}° off head level on average. Keep it at head height between targets so you only need horizontal flicks.` });
    else if (stats.headErr < 1.5) tips.push({ tone: 'good', title: 'Solid head level', text: `Only ${stats.headErr.toFixed(1)}° average drift — great crosshair placement.` });
  }

  if (m.bot && m.type === 'click') {
    if (m.cover && s.blockedRate != null && s.blockedRate > 0.15) tips.push({ tone: 'warn', title: 'Shooting cover',
      text: `${Math.round(s.blockedRate * 100)}% of your shots hit cover. Pre-aim the edge where the bot will peek and fire when it's exposed instead of chasing it behind walls.` });
    if (s.headRate != null && stats.hits >= 5) {
      if (s.headRate < 0.3) tips.push({ tone: 'warn', title: 'Aim higher',
        text: `Only ${Math.round(s.headRate * 100)}% headshots. A headshot is worth 3 body shots — keep the crosshair at head height, especially over crates.` });
      else if (s.headRate > 0.6) tips.push({ tone: 'good', title: 'Headhunter', text: `${Math.round(s.headRate * 100)}% headshots. That converts directly to ranked rounds.` });
    }
  }

  if (m.type === 'track') {
    if (s.trackPct < 0.35) tips.push({ tone: 'warn', title: 'Smoother tracking',
      text: `You were on target ${Math.round(s.trackPct * 100)}% of the time. Match the target's speed instead of chasing it, and react to direction changes with small corrections. Slightly lower sensitivity often helps tracking.` });
    else if (s.trackPct > 0.7) tips.push({ tone: 'good', title: 'Locked on',
      text: `${Math.round(s.trackPct * 100)}% time on target.${stats.diff === 'normal' ? ' Try Professional next.' : ''}` });
    if (m.bot && s.headTimePct != null && stats.onTarget > 3) {
      if (s.headTimePct < 0.3) tips.push({ tone: 'warn', title: 'Track the head, not the body',
        text: `Only ${Math.round(s.headTimePct * 100)}% of your on-target time was on the head, which scores 3x. Lift your crosshair a few pixels and follow the head through strafes and jumps.` });
      else if (s.headTimePct > 0.6) tips.push({ tone: 'good', title: 'Head tracking',
        text: `${Math.round(s.headTimePct * 100)}% of your tracking was on the head. That's exactly what wins sprays and duels.` });
    }
  }

  const cm = cm360(ctx.game, ctx.sens, ctx.dpi);
  if (cm != null && cm < 18) tips.push({ tone: 'info', title: 'Very high sensitivity',
    text: `${cm.toFixed(1)} cm/360°. Most tactical-FPS pros sit between 25 and 55 cm/360°; a lower sens usually means steadier micro-adjustments.` });
  else if (cm != null && cm > 85) tips.push({ tone: 'info', title: 'Very low sensitivity',
    text: `${cm.toFixed(1)} cm/360°. Make sure you have room to turn 180° comfortably — most pros play between 25 and 55 cm/360°.` });

  if (ctx.prevBest != null) {
    if (stats.score > ctx.prevBest) tips.push({ tone: 'good', title: 'New personal best', text: `+${stats.score - ctx.prevBest} over your previous best. You're warmed up.` });
    else if (stats.score < ctx.prevBest * 0.8) tips.push({ tone: 'info', title: 'Not warm yet',
      text: `${Math.round((stats.score / Math.max(1, ctx.prevBest)) * 100)}% of your best. Run another round or two before queueing.` });
  }

  if (stats.diff === 'normal' && m.type === 'click' && (s.accuracy ?? 0) > 0.9 && s.shots >= 20) {
    tips.push({ tone: 'info', title: 'Ready for Professional', text: `${DIFF.pro.label} has smaller targets and faster bots — closer to real heads.` });
  }

  if (!tips.length) tips.push({ tone: 'good', title: 'Clean round', text: 'Nothing stands out — keep this consistency and try to beat your best.' });

  const order = { warn: 0, info: 1, good: 2 };
  return tips.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 4);
}
