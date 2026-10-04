import { promises as fs } from 'fs';
import path from 'path';
import type { LeaderboardEntry, Submission } from './types';

/**
 * Leaderboard storage.
 *  - Production: Upstash Redis over REST (set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN,
 *    or the KV_REST_API_URL / KV_REST_API_TOKEN pair Vercel's Upstash integration creates).
 *  - Local dev without those vars: a JSON file in .data/ (falls back to memory if the disk is read-only).
 * Each board keeps one entry per player name: their best score.
 */
interface Store {
  top(board: string, limit: number): Promise<LeaderboardEntry[]>;
  submit(board: string, entry: LeaderboardEntry): Promise<{ improved: boolean; best: number; rank: number | null }>;
}

const boardKey = (mode: string, diff: string) => `${mode}:${diff}`;
const memberOf = (name: string) => name.trim().toLowerCase();

// ---------- Upstash Redis (REST) ----------
function redisStore(url: string, token: string): Store {
  async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Redis error ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    return out.map(r => { if (r.error) throw new Error(r.error); return r.result; });
  }
  const z = (b: string) => `lb:${b}`;
  const h = (b: string) => `lb:meta:${b}`;

  return {
    async top(board, limit) {
      const [flat] = (await pipeline([['ZRANGE', z(board), 0, limit - 1, 'REV', 'WITHSCORES']])) as string[][];
      if (!flat?.length) return [];
      const members = flat.filter((_, i) => i % 2 === 0);
      const [metas] = (await pipeline([['HMGET', h(board), ...members]])) as (string | null)[][];
      return members.map((m, i) => {
        const meta = metas[i] ? (JSON.parse(metas[i] as string) as LeaderboardEntry) : null;
        return { ...(meta ?? { name: m, accuracy: null, game: '', cm360: null, at: 0 }), score: Number(flat[i * 2 + 1]) };
      });
    },
    async submit(board, entry) {
      const member = memberOf(entry.name);
      const [prev] = (await pipeline([['ZSCORE', z(board), member]])) as (string | null)[];
      const improved = prev == null || entry.score > Number(prev);
      if (improved) {
        await pipeline([
          ['ZADD', z(board), entry.score, member],
          ['HSET', h(board), member, JSON.stringify(entry)],
        ]);
      }
      const [rank] = (await pipeline([['ZREVRANK', z(board), member]])) as (number | null)[];
      return { improved, best: improved ? entry.score : Number(prev), rank: rank == null ? null : rank + 1 };
    },
  };
}

// ---------- Local JSON file ----------
type FileData = Record<string, Record<string, LeaderboardEntry>>;
function fileStore(): Store {
  const file = path.join(process.cwd(), '.data', 'leaderboard.json');
  let memory: FileData | null = null;

  async function read(): Promise<FileData> {
    if (memory) return memory;
    try { memory = JSON.parse(await fs.readFile(file, 'utf8')) as FileData; } catch { memory = {}; }
    return memory;
  }
  async function write(data: FileData) {
    memory = data;
    try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2)); }
    catch { /* read-only filesystem: keep in memory only */ }
  }
  const sorted = (b: Record<string, LeaderboardEntry>) => Object.values(b).sort((a, c) => c.score - a.score);

  return {
    async top(board, limit) { return sorted((await read())[board] ?? {}).slice(0, limit); },
    async submit(board, entry) {
      const data = await read();
      const b = (data[board] ??= {});
      const member = memberOf(entry.name);
      const prev = b[member];
      const improved = !prev || entry.score > prev.score;
      if (improved) { b[member] = entry; await write(data); }
      const rank = sorted(b).findIndex(e => memberOf(e.name) === member);
      return { improved, best: improved ? entry.score : prev.score, rank: rank < 0 ? null : rank + 1 };
    },
  };
}

let store: Store | null = null;
function getStore(): Store {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  store = url && token ? redisStore(url, token) : fileStore();
  return store;
}

export const getTop = (mode: string, diff: string, limit: number) => getStore().top(boardKey(mode, diff), limit);
export const submitScore = (s: Submission) => {
  const { mode, diff, ...entry } = s;
  return getStore().submit(boardKey(mode, diff), { ...entry, at: Date.now() });
};
