import type { Metadata } from 'next';
import Link from 'next/link';
import LeaderboardBrowser from '@/components/LeaderboardBrowser';

export const metadata: Metadata = { title: 'Leaderboards — Warmup Range' };

export default function LeaderboardPage() {
  return (
    <main className="page">
      <div className="panel wide">
        <div className="side-head">
          <h1>LEADER<em>BOARDS</em></h1>
          <Link href="/" className="btn">PLAY</Link>
        </div>
        <LeaderboardBrowser />
      </div>
    </main>
  );
}
