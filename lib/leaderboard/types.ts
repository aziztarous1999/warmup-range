export interface LeaderboardEntry {
  name: string;
  score: number;
  accuracy: number | null; // 0-100
  game: string;
  cm360: number | null;
  at: number;              // ms timestamp
}

export interface Submission extends Omit<LeaderboardEntry, 'at'> {
  mode: string;
  diff: string;
}
