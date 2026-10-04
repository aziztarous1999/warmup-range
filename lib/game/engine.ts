import * as THREE from 'three';
import {
  BODY_BASE, BODY_BONUS, DIFF, DIST, GAMES, HEAD_MULT, HIT_BASE, MAX_SPEED_BONUS, MODES, PRO_TRACK_MULT, TRACK_RATE,
  angDiff, clamp, rand, type DiffKey, type GameKey, type ModeKey,
} from './config';
import type { RoundStats } from './stats';

const DEG = Math.PI / 180;
const LANE_Z = -14;   // where cover bots walk
const COVER_Z = -9.5; // where obstacles stand
const LANE_X = 10.5;

export interface RoundConfig { mode: ModeKey; diff: DiffKey; game: GameKey; sens: number; duration: number }
export interface HudRefs {
  score: HTMLElement; time: HTMLElement; acc: HTMLElement;
  crosshair: HTMLElement; hit: HTMLElement; arrow: HTMLElement;
}
export interface EngineEvents {
  onStart(): void;
  onEnd(stats: RoundStats): void;
  onPause(paused: boolean): void;
}

type Part = 'orb' | 'head' | 'body';

interface Target {
  kind: 'orb' | 'bot';
  obj: THREE.Object3D;
  parts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  cell: number | null;
  yaw: number; pitch: number; r: number;
  born: number; life: number;
  vy: number; vp: number; turn: number;   // orb tracking motion (deg/s)
  x: number; vx: number;                  // bot strafing motion (units/s)
  y: number; vj: number;                  // bot jump height / vertical speed
  seenAt: number | null;                  // bot: first time it was visible
  // flick measurement
  startYaw: number; startPitch: number; dist: number; angR: number;
  overshot: boolean; firstOn: number | null;
}

interface Round {
  cfg: RoundConfig;
  t: number; score: number; running: boolean; paused: boolean;
  targets: Target[]; queue: number[]; lastCell: number | null;
  stats: RoundStats;
  headErrSum: number; headErrN: number;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
  private raycaster = new THREE.Raycaster();
  private losRay = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);
  private sphereGeo = new THREE.SphereGeometry(1, 32, 20);
  private bodyGeo = new THREE.CapsuleGeometry(0.35, 0.9, 6, 14);
  private particleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  private particles: { mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>; v: THREE.Vector3; life: number }[] = [];
  private cover = new THREE.Group();
  private coverMeshes: THREE.Mesh[] = [];
  private yaw = 0;
  private pitch = 0;
  private game: GameKey = 'valorant';
  private pending: RoundConfig | null = null;
  private G: Round | null = null;
  private raf = 0;
  private last = performance.now();
  private ac: AudioContext | null = null;
  private hitTimer: ReturnType<typeof setTimeout> | null = null;
  private tmp = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private hud: HudRefs, private events: EngineEvents) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0e1116);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 1.6, 0);
    this.buildRoom();
    this.cover.visible = false;
    this.scene.add(this.cover);

    window.addEventListener('resize', this.resize);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- Public API ----------
  setGame(game: GameKey) { this.game = game; this.resize(); }

  /** Must be called from a user gesture (click): requests pointer lock, round starts once locked. */
  start(cfg: RoundConfig) { this.pending = cfg; this.lock(); }
  resume() { this.lock(); }

  quit() {
    if (this.G) { this.clearTargets(); this.G = null; }
    this.pending = null;
    this.cover.visible = false;
    this.hud.arrow.style.display = 'none';
    this.hud.crosshair.classList.remove('on', 'head');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  dispose() {
    this.quit();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    this.renderer.dispose();
    this.ac?.close().catch(() => {});
  }

  // ---------- Scene ----------
  private gridTexture(rx: number, ry: number, base: string, line: string) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildRoom() {
    const room = new THREE.Mesh(new THREE.BoxGeometry(60, 20, 60),
      new THREE.MeshStandardMaterial({ map: this.gridTexture(30, 10, '#1a1f27', '#262d38'), side: THREE.BackSide, roughness: 1 }));
    room.position.y = 10; this.scene.add(room);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ map: this.gridTexture(30, 30, '#14181e', '#222934'), roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; this.scene.add(floor);
    // Unlit ceiling: downward-facing surfaces get almost no light and would render pitch black.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ map: this.gridTexture(30, 30, '#151a22', '#1f2631') }));
    ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 19.99; this.scene.add(ceiling);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20242c, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(5, 12, 4); this.scene.add(sun);
  }

  /** Walls (full cover) and crates (half cover: head and shoulders stay visible). */
  private buildCover() {
    for (const m of this.coverMeshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.cover.clear(); this.coverMeshes = [];
    const layout = [
      { x: -8, w: 2.2, h: 3.2 }, { x: -3.6, w: 2.4, h: 1.25 }, { x: 0.8, w: 1.6, h: 3.2 },
      { x: 5, w: 2.6, h: 1.05 }, { x: 9.2, w: 1.6, h: 3.2 },
    ];
    for (const p of layout) {
      const x = p.x + rand(-0.7, 0.7);
      const full = p.h > 2;
      const geo = new THREE.BoxGeometry(p.w, p.h, 1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: full ? 0x2d3542 : 0x4a3d2c, roughness: 0.9 }));
      mesh.position.set(x, p.h / 2, COVER_Z);
      mesh.userData.cover = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: full ? 0x55627a : 0x8a7150 }));
      mesh.add(edges);
      this.cover.add(mesh); this.coverMeshes.push(mesh);
    }
    this.cover.updateMatrixWorld(true); // raycasts must see the walls before the first render
  }

  private resize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    const h = GAMES[this.game].hfov * DEG; // games quote horizontal FOV; three.js wants vertical
    this.camera.fov = (2 * Math.atan(Math.tan(h / 2) / this.camera.aspect)) / DEG;
    this.camera.updateProjectionMatrix();
  };

  // ---------- Audio ----------
  private tone(f: number, dur: number, type: OscillatorType = 'sine', vol = 0.07) {
    try {
      this.ac = this.ac || new AudioContext();
      const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
    } catch { /* audio unavailable */ }
  }
  private sfx = {
    hit: () => this.tone(880, 0.08, 'triangle', 0.09),
    head: () => { this.tone(1320, 0.07, 'triangle', 0.09); this.tone(1760, 0.1, 'sine', 0.05); },
    miss: () => this.tone(160, 0.07, 'square', 0.03),
    cover: () => this.tone(110, 0.09, 'sawtooth', 0.03),
    expire: () => this.tone(220, 0.12, 'sine', 0.05),
    end: () => { this.tone(660, 0.15); setTimeout(() => this.tone(990, 0.25), 140); },
  };

  // ---------- Pointer lock & input ----------
  private lock() {
    try {
      // Raw input (no OS acceleration) where supported, plain lock otherwise.
      const p = (this.canvas.requestPointerLock as (o?: object) => Promise<void> | void)({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } });
    } catch { this.canvas.requestPointerLock(); }
  }

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked) {
      if (this.pending) { const cfg = this.pending; this.pending = null; this.startRound(cfg); this.events.onStart(); }
      else if (this.G?.paused) { this.G.paused = false; this.events.onPause(false); }
    } else if (this.G && this.G.running && !this.G.paused) {
      this.G.paused = true; this.events.onPause(true);
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    const G = this.G;
    if (document.pointerLockElement !== this.canvas || !G || G.paused) return;
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return; // browser spike guard
    const k = G.cfg.sens * GAMES[G.cfg.game].yaw * DEG; // same deg-per-count formula as the games
    this.yaw -= e.movementX * k;
    this.pitch = clamp(this.pitch - e.movementY * k, -89 * DEG, 89 * DEG);
    this.measureOvershoot();
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && document.pointerLockElement === this.canvas) this.shoot();
  };

  // ---------- Round lifecycle ----------
  private startRound(cfg: RoundConfig) {
    if (this.G) this.clearTargets();
    this.yaw = 0; this.pitch = 0;
    const m = MODES[cfg.mode];
    this.G = {
      cfg, t: 0, score: 0, running: true, paused: false, targets: [], queue: [], lastCell: null,
      headErrSum: 0, headErrN: 0,
      stats: {
        mode: cfg.mode, diff: cfg.diff, duration: cfg.duration, score: 0, hits: 0, misses: 0, expired: 0,
        blocked: 0, headshots: 0, reactions: [], reach: [], settle: [], overshoots: 0, measured: 0,
        onTarget: 0, headTime: 0, visible: 0, headErr: null,
      },
    };
    if (m.cover) this.buildCover();
    this.cover.visible = !!m.cover;
    for (let i = 0; i < m.count; i++) this.G.queue.push(m.delay ? 0.8 : 0);
  }

  private endRound() {
    const G = this.G!;
    G.running = false;
    this.clearTargets();
    this.cover.visible = false;
    this.sfx.end();
    const stats = { ...G.stats, score: Math.round(G.score), headErr: G.headErrN ? G.headErrSum / G.headErrN : null };
    this.G = null;
    this.hud.arrow.style.display = 'none';
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.events.onEnd(stats);
  }

  // ---------- Targets ----------
  private dirFrom(yawDeg: number, pitchDeg: number) {
    const y = yawDeg * DEG, p = pitchDeg * DEG;
    return new THREE.Vector3(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  private placeOrb(t: Target) { t.obj.position.copy(this.camera.position).addScaledVector(this.dirFrom(t.yaw, t.pitch), DIST); }

  private material(color: number) {
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.35 });
  }

  private spawnTarget() {
    const G = this.G!, m = MODES[G.cfg.mode], d = DIFF[G.cfg.diff];
    const curYaw = this.yaw / DEG, curPitch = this.pitch / DEG;
    const base: Omit<Target, 'kind' | 'obj' | 'parts' | 'yaw' | 'pitch' | 'r' | 'life'> = {
      cell: null, born: G.t, vy: 0, vp: 0, turn: 0, x: 0, vx: 0, y: 0, vj: 0, seenAt: null,
      startYaw: curYaw, startPitch: curPitch, dist: 0, angR: 0, overshot: false, firstOn: null,
    };

    if (m.bot) {
      const body = new THREE.Mesh(this.bodyGeo, this.material(0xff4655));
      body.position.y = 0.8; body.userData.part = 'body';
      const head = new THREE.Mesh(this.sphereGeo, this.material(0xff6b78));
      head.scale.setScalar(d.head); head.position.y = 1.6 + d.head * 0.85; head.userData.part = 'head';
      const obj = new THREE.Group(); obj.add(body, head);
      const t: Target = { ...base, kind: 'bot', obj, parts: [body, head], yaw: 0, pitch: 0, r: d.head, life: Infinity,
        x: rand(-LANE_X, LANE_X) };
      obj.position.set(t.x, 0, LANE_Z);
      for (const p of t.parts) p.userData.t = t;
      this.scene.add(obj); G.targets.push(t);
      return;
    }

    let yaw = 0, pitch = 3, cell: number | null = null;
    if (G.cfg.mode === 'gridshot') {
      const used = new Set(G.targets.map(t => t.cell));
      do { cell = Math.floor(Math.random() * 20); } while (used.has(cell) || cell === G.lastCell);
      yaw = ((cell % 5) - 2) * 6;
      pitch = Math.floor(cell / 5) * 5 - 1;
    } else if (m.type !== 'track' && m.area) {
      for (let i = 0; i < 25; i++) {
        yaw = rand(-m.area.yaw, m.area.yaw);
        pitch = rand(m.area.pmin, m.area.pmax);
        const dist = Math.hypot(angDiff(yaw, curYaw), pitch - curPitch);
        if (m.omni ? Math.abs(angDiff(yaw, curYaw)) > 50 : dist > (m.minDist || 0)) break;
      }
    }
    const r = d.r * (m.size || 1);
    const mesh = new THREE.Mesh(this.sphereGeo, this.material(0xff4655));
    mesh.scale.setScalar(r); mesh.userData.part = 'orb';
    const t: Target = {
      ...base, kind: 'orb', obj: mesh, parts: [mesh], cell, yaw, pitch, r,
      life: m.life ? d.life * m.life : Infinity,
      dist: Math.hypot(angDiff(yaw, curYaw), pitch - curPitch),
      angR: Math.atan(r / DIST) / DEG,
    };
    mesh.userData.t = t;
    this.placeOrb(t); this.scene.add(mesh); G.targets.push(t);
  }

  private removeTarget(t: Target) {
    const G = this.G!;
    this.scene.remove(t.obj);
    for (const p of t.parts) p.material.dispose();
    G.targets.splice(G.targets.indexOf(t), 1);
  }

  private clearTargets() { if (this.G) this.G.targets.slice().forEach(t => this.removeTarget(t)); }

  private queueSpawn() {
    const G = this.G!;
    G.queue.push(G.t + (MODES[G.cfg.mode].delay ? rand(0.35, 1.2) : 0));
    G.queue.sort((a, b) => a - b);
  }

  /** What the crosshair is on: a target part, cover, or nothing. */
  private aim(): { t: Target; part: Part } | 'cover' | null {
    const G = this.G!;
    this.raycaster.setFromCamera(this.center, this.camera);
    const objs: THREE.Object3D[] = G.targets.flatMap(t => t.parts);
    if (this.cover.visible) objs.push(...this.coverMeshes);
    const hit = this.raycaster.intersectObjects(objs, false)[0];
    if (!hit) return null;
    if (hit.object.userData.cover) return 'cover';
    return { t: hit.object.userData.t as Target, part: hit.object.userData.part as Part };
  }

  /** True when the bot's head or chest can be seen past the obstacles. */
  private botVisible(t: Target) {
    if (!this.cover.visible) return true;
    const headY = t.y + 1.6 + (this.G ? DIFF[this.G.cfg.diff].head : 0.2) * 0.85;
    for (const y of [headY, t.y + 1.25]) {
      this.tmp.set(t.x, y, LANE_Z).sub(this.camera.position);
      const dist = this.tmp.length();
      this.losRay.set(this.camera.position, this.tmp.normalize());
      const hit = this.losRay.intersectObjects(this.coverMeshes, false)[0];
      if (!hit || hit.distance > dist) return true;
    }
    return false;
  }

  private measureOvershoot() {
    const G = this.G;
    if (!G || !MODES[G.cfg.mode].measure) return;
    const t = G.targets[0];
    if (!t || t.overshot || t.dist < 4) return;
    // Progress of the aim along the straight line from where it started to the target.
    const dy = angDiff(this.yaw / DEG, t.startYaw), dp = this.pitch / DEG - t.startPitch;
    const ux = angDiff(t.yaw, t.startYaw) / t.dist, up = (t.pitch - t.startPitch) / t.dist;
    if (dy * ux + dp * up > t.dist + t.angR * 1.5) t.overshot = true;
  }

  private finishMeasure(t: Target, killed: boolean) {
    const G = this.G!;
    if (!MODES[G.cfg.mode].measure || t.dist < 4) return;
    G.stats.measured++;
    if (t.overshot) G.stats.overshoots++;
    if (killed && t.firstOn != null) {
      G.stats.reach.push(t.firstOn - t.born);
      G.stats.settle.push(G.t - t.firstOn);
    }
  }

  private shoot() {
    const G = this.G;
    if (!G || !G.running || G.paused || MODES[G.cfg.mode].type !== 'click') return;
    const d = DIFF[G.cfg.diff];
    const a = this.aim();
    if (a && a !== 'cover') {
      const t = a.t;
      const rt = G.t - (t.kind === 'bot' ? (t.seenAt ?? t.born) : t.born);
      G.stats.hits++; G.stats.reactions.push(rt);
      if (a.part === 'orb') {
        G.score += HIT_BASE + Math.max(0, Math.round(MAX_SPEED_BONUS - rt * 100)); this.sfx.hit();
      } else {
        // Bot: body shot + speed bonus; a headshot is worth HEAD_MULT times that.
        const body = BODY_BASE + Math.max(0, Math.round(BODY_BONUS - rt * 50));
        if (a.part === 'head') { G.stats.headshots++; G.score += body * HEAD_MULT; this.sfx.head(); }
        else { G.score += body; this.sfx.hit(); }
      }
      if (t.cell != null) G.lastCell = t.cell;
      this.finishMeasure(t, true);
      this.burst(t.kind === 'bot' ? t.parts[a.part === 'head' ? 1 : 0].getWorldPosition(new THREE.Vector3()) : t.obj.position);
      this.removeTarget(t); this.queueSpawn(); this.flashHit(a.part === 'head');
    } else {
      G.stats.misses++; G.score -= d.penalty;
      if (a === 'cover') { G.stats.blocked++; this.sfx.cover(); } else this.sfx.miss();
    }
  }

  private burst(pos: THREE.Vector3) {
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, new THREE.MeshBasicMaterial({ color: 0xff8a94, transparent: true }));
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.particles.push({ mesh, life: 0.35,
        v: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 6)) });
    }
  }

  private flashHit(head: boolean) {
    this.hud.hit.classList.toggle('head', head);
    this.hud.hit.classList.add('show');
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => this.hud.hit.classList.remove('show'), 70);
  }

  // ---------- Simulation ----------
  private update(dt: number) {
    const G = this.G!, m = MODES[G.cfg.mode], d = DIFF[G.cfg.diff];
    G.t += dt;
    while (G.queue.length && G.queue[0] <= G.t) { G.queue.shift(); this.spawnTarget(); }

    for (const t of G.targets.slice()) {
      if (t.kind === 'bot') {
        t.turn -= dt;
        if (t.turn <= 0) { // strafe, sometimes stop and hold, sometimes jump
          const hold = Math.random() < 0.2;
          t.vx = hold ? 0 : (Math.random() < 0.5 ? -1 : 1) * rand(0.7, 1) * d.botSpeed * (m.botSpeed ?? 1);
          t.turn = hold ? rand(0.3, 0.8) : rand(0.4, 1.4) / d.speed;
          if (m.jumps && t.y === 0 && Math.random() < d.jump) t.vj = 4.8;
        }
        t.x += t.vx * dt;
        if (Math.abs(t.x) > LANE_X) { t.x = Math.sign(t.x) * LANE_X; t.vx *= -1; }
        if (t.y > 0 || t.vj > 0) { t.vj -= 14 * dt; t.y = Math.max(0, t.y + t.vj * dt); if (t.y === 0) t.vj = 0; }
        t.obj.position.set(t.x, t.y, LANE_Z);
        t.obj.updateMatrixWorld(true);
        const vis = this.botVisible(t);
        if (vis && t.seenAt == null) t.seenAt = G.t;
        if (vis && m.type === 'track') G.stats.visible += dt;
      } else if (t.life !== Infinity) {
        const age = (G.t - t.born) / t.life;
        if (age >= 1) {
          this.finishMeasure(t, false);
          this.removeTarget(t); G.stats.expired++; G.score -= d.penalty / 2; this.sfx.expire(); this.queueSpawn();
          continue;
        }
        t.obj.scale.setScalar(t.r * (1 - 0.45 * age));
      }
    }

    const a = G.targets.length ? this.aim() : null;
    const on = !!a && a !== 'cover';
    const onHead = on && a.part === 'head';
    if (m.type === 'track') {
      if (on) {
        G.stats.onTarget += dt;
        if (onHead) G.stats.headTime += dt;
        G.score += dt * TRACK_RATE * (onHead ? HEAD_MULT : 1) * (G.cfg.diff === 'pro' ? PRO_TRACK_MULT : 1);
      }
      for (const t of G.targets) for (const p of t.parts) {
        const lit = on && (p.userData.part === 'head') === onHead;
        p.material.emissiveIntensity = lit ? 1.1 : 0.3;
      }
    } else if (on && m.measure && a.t.firstOn == null) {
      a.t.firstOn = G.t;
    }
    this.hud.crosshair.classList.toggle('on', on && m.type === 'track' && !onHead);
    this.hud.crosshair.classList.toggle('head', onHead && m.type === 'track');

    if (G.cfg.mode === 'headline') { G.headErrSum += Math.abs(this.pitch / DEG - 1); G.headErrN++; }

    if (G.t >= G.cfg.duration) this.endRound();
  }

  private drawHud() {
    const G = this.G;
    if (!G || !G.running) return;
    const m = MODES[G.cfg.mode], s = G.stats;
    this.hud.score.textContent = String(Math.round(G.score));
    this.hud.time.textContent = Math.max(0, G.cfg.duration - G.t).toFixed(1);
    let acc: number;
    if (m.type === 'track') {
      const denom = m.bot ? s.visible : G.t;
      acc = denom > 0 ? (100 * s.onTarget) / denom : 100;
    } else acc = s.hits + s.misses ? (100 * s.hits) / (s.hits + s.misses) : 100;
    this.hud.acc.textContent = Math.min(100, acc).toFixed(0) + '%';

    // Off-screen indicator (360 mode)
    const arrow = this.hud.arrow, t = G.targets[0];
    if (m.omni && t) {
      const v = this.tmp.copy(t.obj.position).applyMatrix4(this.camera.matrixWorldInverse);
      const ndc = t.obj.position.clone().project(this.camera);
      const visible = v.z < 0 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
      if (!visible) {
        const ang = Math.atan2(v.y, v.x);
        const R = Math.min(window.innerWidth, window.innerHeight) * 0.28;
        arrow.style.display = 'block';
        arrow.style.transform = `translate(${Math.cos(ang) * R}px, ${-Math.sin(ang) * R}px) rotate(${-ang}rad)`;
      } else arrow.style.display = 'none';
    } else arrow.style.display = 'none';
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld();
    if (this.G && this.G.running && !this.G.paused) this.update(dt);
    for (const p of this.particles.slice()) {
      p.life -= dt;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.material.opacity = Math.max(0, p.life / 0.35);
      if (p.life <= 0) {
        this.scene.remove(p.mesh); p.mesh.material.dispose();
        this.particles.splice(this.particles.indexOf(p), 1);
      }
    }
    this.drawHud();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };
}
