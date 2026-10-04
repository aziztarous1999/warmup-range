import { NextResponse, type NextRequest } from 'next/server';
import { DIFF, PLAY_MODES, type DiffKey, type ModeKey } from '@/lib/game/config';
import { getTop, submitScore } from '@/lib/leaderboard/store';
import { validateSubmission } from '@/lib/leaderboard/validate';

export const dynamic = 'force-dynamic';

// Best-effort per-instance rate limit: one submission per IP every 5 s.
const lastPost = new Map<string, number>();

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get('mode') as ModeKey, diff = p.get('diff') as DiffKey;
  if (!PLAY_MODES.includes(mode) || !(diff in DIFF)) return NextResponse.json({ error: 'Bad mode/diff' }, { status: 400 });
  const limit = Math.min(100, Math.max(1, Number(p.get('limit')) || 20));
  try {
    return NextResponse.json({ entries: await getTop(mode, diff, limit) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Leaderboard unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const now = Date.now();
  if (now - (lastPost.get(ip) ?? 0) < 5000) return NextResponse.json({ error: 'Slow down' }, { status: 429 });
  lastPost.set(ip, now);

  const v = validateSubmission(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json(await submitScore(v.value));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Leaderboard unavailable' }, { status: 503 });
  }
}
