'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  DIFF, FINDER_DURATION, GAMES, MODES, PLAY_MODES, RANKED_DURATION, cm360, roundSens,
  type DiffKey, type GameKey, type ModeKey,
} from '@/lib/game/config';
import type { Engine, RoundConfig } from '@/lib/game/engine';
import { coach, type Tip } from '@/lib/game/coach';
import { NARROW, WIDE, analyze, planSteps, type FinderAnalysis, type FinderResult } from '@/lib/game/sensFinder';
import { ms, pct, summarize, type RoundStats } from '@/lib/game/stats';
import { NAME_RE } from '@/lib/leaderboard/validate';
import Leaderboard from './Leaderboard';

type View = 'menu' | 'playing' | 'paused' | 'results' | 'finderIntro' | 'finderNext' | 'finderResults';

interface Settings {
  mode: ModeKey; diff: DiffKey; game: GameKey; sens: number; dpi: number; duration: number; name: string; autoFullscreen: boolean;
}
const DEFAULTS: Settings = {
  mode: 'gridshot', diff: 'normal', game: 'valorant', sens: 0.4, dpi: 800, duration: RANKED_DURATION, name: '', autoFullscreen: true,
};

const isFullscreen = () => typeof document !== 'undefined' && !!document.fullscreenElement;
const enterFullscreen = () => document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) ?? Promise.reject();
const toggleFullscreen = () => {
  (isFullscreen() ? document.exitFullscreen() : enterFullscreen()).catch(() => { /* not allowed / unsupported */ });
};

interface Result { stats: RoundStats; cfg: RoundConfig; prevBest: number | null; isBest: boolean; tips: Tip[] }
interface Finder { base: number; steps: number[]; idx: number; results: FinderResult[] }

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const bestKey = (m: ModeKey, d: DiffKey) => `aim_best_${m}_${d}`;

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreRef = useRef<HTMLElement>(null), timeRef = useRef<HTMLElement>(null), accRef = useRef<HTMLElement>(null);
  const xhRef = useRef<HTMLDivElement>(null), hitRef = useRef<HTMLDivElement>(null), arrowRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [result, setResult] = useState<Result | null>(null);
  const [finder, setFinder] = useState<Finder | null>(null);
  const [analysis, setAnalysis] = useState<FinderAnalysis | null>(null);
  const [submit, setSubmit] = useState<{ status: 'idle' | 'sending' | 'done' | 'error'; msg?: string }>({ status: 'idle' });
  const [lbKey, setLbKey] = useState(0);
  const [bests, setBests] = useState<Record<string, number | null>>({});
  const [fullscreen, setFullscreen] = useState(false);

  // Latest values for engine callbacks (engine is created once).
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const finderRef = useRef<Finder | null>(null);
  const cfgRef = useRef<RoundConfig | null>(null);
  const onEndRef = useRef<(s: RoundStats) => void>(() => {});

  const set = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));

  useEffect(() => { setSettings({ ...DEFAULTS, ...store.get<Partial<Settings>>('aim_settings', {}) }); setLoaded(true); }, []);
  useEffect(() => { if (loaded) store.set('aim_settings', settings); }, [settings, loaded]);
  useEffect(() => {
    const b: Record<string, number | null> = {};
    for (const m of PLAY_MODES) b[m] = store.get<number | null>(bestKey(m, settings.diff), null);
    setBests(b);
  }, [settings.diff, result]);

  useEffect(() => {
    let disposed = false, eng: Engine | null = null;
    import('@/lib/game/engine').then(({ Engine }) => {
      if (disposed || !canvasRef.current) return;
      eng = new Engine(canvasRef.current, {
        score: scoreRef.current!, time: timeRef.current!, acc: accRef.current!,
        crosshair: xhRef.current!, hit: hitRef.current!, arrow: arrowRef.current!,
      }, {
        onStart: () => setView('playing'),
        onPause: p => setView(p ? 'paused' : 'playing'),
        onEnd: s => onEndRef.current(s),
      });
      eng.setGame(settingsRef.current.game);
      engineRef.current = eng;
      if (process.env.NODE_ENV === 'development') (window as unknown as { __engine: Engine }).__engine = eng; // debugging aid
    });
    return () => { disposed = true; eng?.dispose(); engineRef.current = null; };
  }, []);
  useEffect(() => { engineRef.current?.setGame(settings.game); }, [settings.game]);

  // Fullscreen state + "F" shortcut (ignored while typing in a field).
  useEffect(() => {
    const onChange = () => setFullscreen(isFullscreen());
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      toggleFullscreen();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey); };
  }, []);

  /** Go fullscreen first when enabled, then lock the mouse and start. */
  const launch = (cfg: RoundConfig) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (settingsRef.current.autoFullscreen && !isFullscreen()) {
      enterFullscreen().then(() => eng.start(cfg), () => eng.start(cfg));
    } else eng.start(cfg);
  };

  onEndRef.current = (stats: RoundStats) => {
    const f = finderRef.current;
    if (f) {
      const next: Finder = { ...f, idx: f.idx + 1, results: [...f.results, { mult: f.steps[f.idx], sens: cfgRef.current!.sens, stats }] };
      finderRef.current = next; setFinder(next);
      if (next.idx < next.steps.length) setView('finderNext');
      else { setAnalysis(analyze(next.base, next.results)); finderRef.current = null; setView('finderResults'); }
      return;
    }
    const cfg = cfgRef.current!, s = settingsRef.current;
    const key = bestKey(cfg.mode, cfg.diff);
    const prevBest = store.get<number | null>(key, null);
    const isBest = prevBest == null || stats.score > prevBest;
    if (isBest) store.set(key, stats.score);
    setResult({ stats, cfg, prevBest, isBest, tips: coach(stats, { game: cfg.game, sens: cfg.sens, dpi: s.dpi, prevBest }) });
    setSubmit({ status: 'idle' });
    setView('results');
  };

  const startRound = () => {
    const s = settingsRef.current;
    if (!(s.sens > 0) || !engineRef.current) return;
    finderRef.current = null; setFinder(null);
    cfgRef.current = { mode: s.mode, diff: s.diff, game: s.game, sens: s.sens, duration: s.duration };
    launch(cfgRef.current);
  };

  const openFinder = (base: number, spread: number[]) => {
    if (!(base > 0)) return;
    const f = { base, steps: planSteps(spread), idx: 0, results: [] };
    finderRef.current = f; setFinder(f); setAnalysis(null); setView('finderIntro');
  };
  const runFinderStep = () => {
    const f = finderRef.current, s = settingsRef.current;
    if (!f || !engineRef.current) return;
    cfgRef.current = { mode: 'finder', diff: 'normal', game: s.game, sens: roundSens(f.base * f.steps[f.idx]), duration: FINDER_DURATION };
    launch(cfgRef.current);
  };

  const quit = () => { engineRef.current?.quit(); finderRef.current = null; setFinder(null); setView('menu'); };

  const sendScore = async () => {
    if (!result) return;
    const s = settings, sum = summarize(result.stats);
    if (!NAME_RE.test(s.name.trim())) { setSubmit({ status: 'error', msg: 'Name: 2–16 letters, numbers, spaces, _ - .' }); return; }
    setSubmit({ status: 'sending' });
    const acc = MODES[result.cfg.mode].type === 'track' ? sum.trackPct : sum.accuracy;
    try {
      const res = await fetch('/api/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s.name.trim(), mode: result.cfg.mode, diff: result.cfg.diff, duration: result.cfg.duration,
          score: result.stats.score, hits: result.stats.hits, accuracy: acc == null ? null : acc * 100,
          game: result.cfg.game, cm360: cm360(result.cfg.game, result.cfg.sens, s.dpi),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Submit failed');
      setSubmit({ status: 'done', msg: j.improved ? `Submitted — you're #${j.rank}!` : `Your best (${j.best}) still stands at #${j.rank}.` });
      setLbKey(k => k + 1);
    } catch (e) {
      setSubmit({ status: 'error', msg: (e as Error).message });
    }
  };

  const cm = cm360(settings.game, settings.sens, settings.dpi);
  const playing = view === 'playing' || view === 'paused';

  return (
    <>
      <canvas ref={canvasRef} className="stage" />


      {/* HUD */}
      <div className="hud" style={{ display: playing ? 'block' : 'none' }}>
        <div className="mode-tag">
          {cfgRef.current && (cfgRef.current.mode === 'finder'
            ? `Sensitivity test ${(finder?.idx ?? 0) + 1}/${finder?.steps.length ?? 5}`
            : `${MODES[cfgRef.current.mode].label} · ${DIFF[cfgRef.current.diff].label}`)}
        </div>
        <div className="top">
          <div className="stat"><b ref={scoreRef}>0</b><span>Score</span></div>
          <div className="stat timer"><b ref={timeRef}>0.0</b><span>Time</span></div>
          <div className="stat"><b ref={accRef}>100%</b><span>Accuracy</span></div>
        </div>
      </div>
      <div ref={xhRef} className="crosshair" style={{ display: playing ? 'block' : 'none' }}>
        <i className="d" /><i className="l" /><i className="r" /><i className="u" /><i className="b" />
      </div>
      <div ref={hitRef} className="hitmarker" />
      <div ref={arrowRef} className="arrow"><div>➤</div></div>

      {/* Menu */}
      {view === 'menu' && (
        <div className="overlay">
          <div className="panel wide menu-grid">
            <div>
              <div className="title-row">
                <h1>WARMUP <em>RANGE</em></h1>
                <FullscreenButton on={fullscreen} />
              </div>
              <p className="sub">Warm up before ranked. Use your in-game sensitivity so the muscle memory carries over.</p>

              <h3>Mode</h3>
              <div className="modes">
                {PLAY_MODES.map(k => (
                  <div key={k} className={`mode ${k === settings.mode ? 'sel' : ''}`} onClick={() => set({ mode: k })}>
                    <b>{MODES[k].label}{MODES[k].cover && <span className="badge">COVER</span>}</b>
                    <p>{MODES[k].desc}</p>
                    <small>{bests[k] != null ? `Best: ${bests[k]}` : ' '}</small>
                  </div>
                ))}
              </div>

              <h3>Difficulty</h3>
              <div className="seg">
                {(Object.keys(DIFF) as DiffKey[]).map(d => (
                  <button key={d} className={d === settings.diff ? 'sel' : ''} onClick={() => set({ diff: d })}>{DIFF[d].label}</button>
                ))}
              </div>

              <h3>Player &amp; sensitivity</h3>
              <div className="row">
                <label>Player name
                  <input className={settings.name && !NAME_RE.test(settings.name.trim()) ? 'invalid' : ''} placeholder="Shown on leaderboards"
                    maxLength={16} value={settings.name} onChange={e => set({ name: e.target.value })} />
                </label>
                <label>Game profile
                  <select value={settings.game} onChange={e => { const g = e.target.value as GameKey; set({ game: g, sens: GAMES[g].defSens }); }}>
                    {(Object.keys(GAMES) as GameKey[]).map(g => <option key={g} value={g}>{GAMES[g].label}</option>)}
                  </select>
                </label>
                <label>In-game sens
                  <input type="number" step="0.001" min="0.01" value={settings.sens} onChange={e => set({ sens: parseFloat(e.target.value) || 0 })} />
                </label>
                <label>Mouse DPI
                  <input type="number" step="50" min="100" value={settings.dpi} onChange={e => set({ dpi: parseFloat(e.target.value) || 0 })} />
                </label>
                <label>Duration
                  <select value={settings.duration} onChange={e => set({ duration: +e.target.value })}>
                    <option value={30}>30 s</option><option value={60}>60 s (ranked)</option><option value={90}>90 s</option>
                  </select>
                </label>
                <div className="cm">{cm ? `${cm.toFixed(1)} cm/360° · eDPI ${Math.round(settings.sens * settings.dpi)}` : ''}</div>
              </div>

              <div className="go">
                <button className="btn" onClick={startRound}>START</button>
                <button className="btn ghost" onClick={() => openFinder(settings.sens, WIDE)}>SENSITIVITY FINDER</button>
                <label className="check">
                  <input type="checkbox" checked={settings.autoFullscreen} onChange={e => set({ autoFullscreen: e.target.checked })} />
                  Fullscreen on start
                </label>
                <span className="hint">Click locks the mouse · ESC pauses · F toggles fullscreen</span>
              </div>
            </div>

            <aside className="side">
              <div className="side-head">
                <h3>Leaderboard · {MODES[settings.mode].label} · {DIFF[settings.diff].label}</h3>
                <Link href="/leaderboard" className="link">All boards →</Link>
              </div>
              <Leaderboard mode={settings.mode} diff={settings.diff} refreshKey={lbKey} highlight={settings.name} />
            </aside>
          </div>
        </div>
      )}

      {/* Pause */}
      {view === 'paused' && (
        <div className="overlay">
          <div className="panel narrow center">
            <h1>PAUSED</h1>
            <div className="go center">
              <button className="btn" onClick={() => engineRef.current?.resume()}>RESUME</button>
              <FullscreenButton on={fullscreen} />
              <button className="btn ghost" onClick={quit}>QUIT</button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {view === 'results' && result && (
        <Results result={result} settings={settings} fullscreen={fullscreen} submit={submit} lbKey={lbKey}
          onName={name => set({ name })} onSubmit={sendScore} onAgain={startRound}
          onMenu={() => setView('menu')} onFinder={() => openFinder(result.cfg.sens, WIDE)} />
      )}

      {/* Sensitivity finder */}
      {view === 'finderIntro' && finder && (
        <div className="overlay">
          <div className="panel narrow">
            <h1>SENSITIVITY <em>FINDER</em></h1>
            <p className="sub">
              You&apos;ll play {finder.steps.length} short flick tests of {FINDER_DURATION} s, each at a different sensitivity
              around <b>{finder.base}</b> ({GAMES[settings.game].label}). The order is random and the value is hidden so you
              don&apos;t play differently. Just aim naturally — fast and accurate.
            </p>
            <div className="go">
              <button className="btn" onClick={runFinderStep}>START TEST 1</button>
              <button className="btn ghost" onClick={quit}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
      {view === 'finderNext' && finder && (
        <div className="overlay">
          <div className="panel narrow center">
            <h1>Test {finder.idx} / {finder.steps.length} done</h1>
            <p className="sub">Take a breath. Next one uses a different (hidden) sensitivity.</p>
            <div className="go center">
              <button className="btn" onClick={runFinderStep}>START TEST {finder.idx + 1}</button>
              <button className="btn ghost" onClick={quit}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
      {view === 'finderResults' && analysis && (
        <div className="overlay">
          <div className="panel">
            <h1>Recommended: <em>{analysis.recommended}</em></h1>
            <p className="sub">
              {GAMES[settings.game].label} · {cm360(settings.game, analysis.recommended, settings.dpi)?.toFixed(1)} cm/360° at {settings.dpi} DPI.
              {' '}{analysis.reason}
            </p>
            <table className="lb">
              <thead><tr><th>Sens</th><th className="num">Kills/s</th><th className="num">Accuracy</th><th className="num">Overshoot</th><th className="num">Avg kill</th><th className="num">Rating</th></tr></thead>
              <tbody>
                {analysis.rows.map(r => {
                  const top = Math.max(...analysis.rows.map(x => x.smoothed)) || 1;
                  return (
                    <tr key={r.mult} className={r.sens === analysis.recommended ? 'me' : ''}>
                      <td>{r.sens}{r.mult === 1 ? ' (current)' : ''}</td>
                      <td className="num">{r.kps.toFixed(2)}</td>
                      <td className="num">{pct(r.accuracy)}</td>
                      <td className="num">{pct(r.overshoot)}</td>
                      <td className="num">{ms(r.avgTTK)}</td>
                      <td className="num"><span className="bar"><span style={{ width: `${Math.max(4, (r.smoothed / top) * 100)}%` }} /></span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">One session is a hint, not a verdict. Play a few days on the new value before judging it, and change it in-game too.</p>
            <div className="go">
              <button className="btn" onClick={() => { set({ sens: analysis.recommended }); setView('menu'); }}>USE {analysis.recommended}</button>
              <button className="btn ghost" onClick={() => openFinder(analysis.recommended, NARROW)}>REFINE AROUND {analysis.recommended}</button>
              <button className="btn ghost" onClick={() => setView('menu')}>KEEP {analysis.base}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FullscreenButton({ on }: { on: boolean }) {
  return (
    <button className="fs-btn" onClick={toggleFullscreen} title={on ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
      aria-label={on ? 'Exit fullscreen' : 'Enter fullscreen'}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
      </svg>
      <span>{on ? 'Exit fullscreen' : 'Fullscreen'}</span><kbd>F</kbd>
    </button>
  );
}

function Results({ result, settings, fullscreen, submit, lbKey, onName, onSubmit, onAgain, onMenu, onFinder }: {
  result: Result; settings: Settings; fullscreen: boolean; submit: { status: string; msg?: string }; lbKey: number;
  onName(n: string): void; onSubmit(): void; onAgain(): void; onMenu(): void; onFinder(): void;
}) {
  const { stats, cfg } = result;
  const m = MODES[cfg.mode], s = summarize(stats);
  const cells: [string, string | number][] = [['Score', stats.score]];
  if (m.type === 'track') {
    cells.push([m.cover ? 'On target (visible)' : 'On target', pct(s.trackPct, 1)], ['Time on target', stats.onTarget.toFixed(1) + 's']);
    if (m.bot) cells.push(['On head (x3)', pct(s.headTimePct)], ['Head time', stats.headTime.toFixed(1) + 's']);
  } else {
    cells.push(['Hits', stats.hits], ['Misses', stats.misses], ['Accuracy', pct(s.accuracy, 1)],
      ['Avg time-to-kill', ms(s.avgTTK)], ['Kills / sec', s.kps.toFixed(2)]);
    if (m.bot) cells.push(['Headshots (x3)', `${stats.headshots} · ${pct(s.headRate)}`]);
    if (m.cover) cells.push(['Shots into cover', stats.blocked]);
    if (s.overshootRate != null) cells.push(['Overshoot', pct(s.overshootRate)]);
    if (m.life) cells.push(['Expired', stats.expired]);
  }
  cells.push(['Best', result.isBest ? stats.score : result.prevBest ?? '—']);
  const ranked = cfg.duration === RANKED_DURATION;
  const suggestFinder = result.tips.some(t => /sensitivity/i.test(t.text) && t.tone !== 'good');

  return (
    <div className="overlay">
      <div className="panel wide menu-grid">
        <div>
          <h1>{m.label} <em>{DIFF[cfg.diff].label.toUpperCase()}</em></h1>
          <p className="sub">{result.isBest ? <span className="newbest">New personal best!</span> : `Personal best: ${result.prevBest}`}</p>
          <div className="results">{cells.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div>

          <h3>Coach</h3>
          <ul className="tips">
            {result.tips.map(t => <li key={t.title} className={t.tone}><b>{t.title}</b><span>{t.text}</span></li>)}
          </ul>

          <div className="go">
            <button className="btn" onClick={onAgain}>PLAY AGAIN</button>
            {suggestFinder && <button className="btn ghost" onClick={onFinder}>SENSITIVITY FINDER</button>}
            <button className="btn ghost" onClick={onMenu}>MENU</button>
            <FullscreenButton on={fullscreen} />
          </div>
        </div>

        <aside className="side">
          <h3>Submit to leaderboard</h3>
          {ranked ? (
            <div className="submit">
              <input placeholder="Your name" maxLength={16} value={settings.name} onChange={e => onName(e.target.value)}
                disabled={submit.status === 'sending' || submit.status === 'done'} />
              <button className="btn" onClick={onSubmit} disabled={submit.status === 'sending' || submit.status === 'done' || stats.score <= 0}>
                {submit.status === 'sending' ? '…' : 'SUBMIT'}
              </button>
            </div>
          ) : <p className="hint">Only {RANKED_DURATION}s rounds can be submitted.</p>}
          {submit.msg && <p className={submit.status === 'error' ? 'err' : 'ok'}>{submit.msg}</p>}
          <Leaderboard mode={cfg.mode} diff={cfg.diff} refreshKey={lbKey} highlight={settings.name} />
        </aside>
      </div>
    </div>
  );
}
