'use client';

import { useEffect, useState } from 'react';
import { GAMES, type DiffKey, type GameKey, type ModeKey } from '@/lib/game/config';
import type { LeaderboardEntry } from '@/lib/leaderboard/types';

interface Props { mode: ModeKey; diff: DiffKey; limit?: number; refreshKey?: number; highlight?: string }

export default function Leaderboard({ mode, diff, limit = 10, refreshKey = 0, highlight }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setEntries(null); setError(false);
    fetch(`/api/scores?mode=${mode}&diff=${diff}&limit=${limit}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((j: { entries: LeaderboardEntry[] }) => { if (alive) setEntries(j.entries); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [mode, diff, limit, refreshKey]);

  if (error) return <p className="lb-empty">Leaderboard unavailable.</p>;
  if (!entries) return <p className="lb-empty">Loading…</p>;
  if (!entries.length) return <p className="lb-empty">No scores yet — be the first.</p>;

  const me = highlight?.trim().toLowerCase();
  return (
    <table className="lb">
      <thead><tr><th>#</th><th>Player</th><th className="num">Score</th><th className="num">Acc</th><th className="hide-sm">Setup</th></tr></thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={e.name + i} className={me && e.name.toLowerCase() === me ? 'me' : ''}>
            <td className="rank">{i + 1}</td>
            <td>{e.name}</td>
            <td className="num">{e.score.toLocaleString()}</td>
            <td className="num">{e.accuracy == null ? '—' : `${Math.round(e.accuracy)}%`}</td>
            <td className="hide-sm muted">
              {GAMES[e.game as GameKey]?.label ?? e.game}{e.cm360 ? ` · ${e.cm360} cm` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
