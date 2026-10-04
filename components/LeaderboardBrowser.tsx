'use client';

import { useEffect, useState } from 'react';
import { DIFF, MODES, PLAY_MODES, RANKED_DURATION, type DiffKey, type ModeKey } from '@/lib/game/config';
import Leaderboard from './Leaderboard';

export default function LeaderboardBrowser() {
  const [mode, setMode] = useState<ModeKey>('gridshot');
  const [diff, setDiff] = useState<DiffKey>('normal');
  const [me, setMe] = useState<string>();

  useEffect(() => {
    try { setMe((JSON.parse(localStorage.getItem('aim_settings') || '{}') as { name?: string }).name); } catch { /* ignore */ }
  }, []);

  return (
    <>
      <div className="tabs">
        {PLAY_MODES.map(k => (
          <button key={k} className={k === mode ? 'sel' : ''} onClick={() => setMode(k)}>{MODES[k].label}</button>
        ))}
      </div>
      <div className="seg" style={{ margin: '12px 0 16px' }}>
        {(Object.keys(DIFF) as DiffKey[]).map(d => (
          <button key={d} className={d === diff ? 'sel' : ''} onClick={() => setDiff(d)}>{DIFF[d].label}</button>
        ))}
      </div>
      <p className="hint">{MODES[mode].desc} Ranked runs are {RANKED_DURATION} seconds; each player keeps their best score.</p>
      <Leaderboard mode={mode} diff={diff} limit={50} highlight={me} />
    </>
  );
}
