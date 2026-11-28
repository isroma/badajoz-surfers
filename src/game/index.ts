/**
 * The engine: renderer, game state machine (menu → playing ⇄ paused → gameover), the fixed-step
 * loop, and debug hooks for automated playtesting (`window.__game`).
 */
import * as THREE from "three";
import {
  WORD,
  ZONES,
  type ActorAnim,
  type GameApi,
  type GameEvent,
  type GameOptions,
  type GameState,
  type HudSnapshot,
  type PowerupKind,
  type ZoneId,
} from "../contracts";
import { art } from "../art";
import { Bot } from "./bot";
import { ChaseCamera, type CameraMode, type SolidBox } from "./camera";
import { laneShownAt, layoutAt, mergeOf } from "./lanes";
import { QualityGovernor, type QualityLevel } from "./quality";
import { MEDIAN_GAP } from "./player";
import { buildCourse, getCourse, inPassage, setCourse, wallsBetween } from "./course";
import { TrackSpace } from "./space";
import type { CityData } from "../city/data";
import type { Track } from "../city/track";
import { PathRecorder, type PathSample } from "./chaser";
import { Effects } from "./effects";
import { Input, type Command } from "./input";
import type { PlayerAction } from "./player";
import { Loop } from "./loop";
import { COUNTDOWN_TIME, Run, type RunFx } from "./run";
import { LAP_LENGTH, TICK, zoneAt } from "./tuning";
import { World } from "./world";

export interface GameDebug {
  setInvincible(on: boolean): void;
  setBot(on: boolean): void;
  warp(zone: ZoneId): void;
  /** Jump to a distance along the route (metres; later laps beyond one lap). */
  warpS(metres: number): void;
  setSpeed(mps: number | null): void;
  /** Drop a power-up pickup 8 m ahead in the runner's lane (e.g. "ciguena"). */
  powerup(kind: PowerupKind): void;
  stats(): Record<string, unknown>;
  /** Where every live obstacle mesh is (verification). */
  obstacles(): unknown;
  /** Visible renderables by owner, ≈ draw calls (verification). */
  breakdown(): unknown;
  /** Camera position and look state (verification). */
  camera(): unknown;
  /** Verification: stop the real-time loop (true) and drive frames by hand with `frames`. */
  manual(on: boolean): void;
  /** Verification: render `count` frames of `1/hz` seconds each (manual mode). */
  frames(count: number, hz?: number): void;
  /** Verification: press an input now (also while the autopilot drives). */
  press(action: PlayerAction): void;
  /**
   * Verification: scripted inputs, each pressed on the first tick the runner reaches `at`
   * (metres along the run). Replaces any script still pending; [] clears it.
   */
  inputs(sequence: readonly { at: number; action: PlayerAction }[]): void;
}

declare global {
  interface Window {
    __game?: { api: GameApi; debug: GameDebug };
    /** True when the current run used debug helpers (bot, invincible, speed, warp...): the shell does not save it. */
    __simpaDebugRun?: boolean;
  }
}

const ZONE_IDS = new Set<string>(ZONES.map((z) => z.id));
const isZoneId = (v: string | null): v is ZoneId => v !== null && ZONE_IDS.has(v);

class Game implements GameApi {
  state: GameState = "menu";
  private readonly listeners = new Set<(event: GameEvent) => void>();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world: World;
  private readonly cam: ChaseCamera;
  private readonly effects: Effects;
  private readonly loop: Loop;
  private readonly bot = new Bot();
  private run: Run | null = null;
  /** The GPU context was lost: skip rendering until it is restored. */
  private contextLost = false;
  /** The last run after toMenu(), for getHud() until the next run starts. */
  private lastRun: Run | null = null;

  private botOn = false;
  private invincible = false;
  private speedOverride: number | null = null;
  private fixedSeed: number | null = null;
  private startZone: ZoneId | null = null;
  private lastGameOver = -1e9;

  private time = 0;
  private waiterX = 0;
  private lean = 0;
  private fovKick = 0;
  private groundY = 0;
  private readonly focus = new THREE.Vector3();
  /**
   * Where the idle runner stands in the menu: on the Puente Real deck, the pylon and its cable fan
   * ahead and the Guadiana on both sides (from the course's marks; 180 m without a course).
   */
  private get menuS(): number {
    const m = getCourse()?.track.marks;
    return m ? m.bridgeDeckStart + (m.pylon - m.bridgeDeckStart) * 0.5 : 180;
  }
  private readonly path = new PathRecorder();
  private readonly pathSample: PathSample = { x: 0, y: 0, rolling: false, airborne: false };
  /** 0..1 smoothed stork flight (camera blend). */
  private flight = 0;
  private endSide = 1;
  private wasEnd = false;
  private waiterZ = 0;
  /** Full-screen fade through the fog colour (run start from the menu). */
  private fade = 0;
  private readonly fadeMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly hud: HudSnapshot;
  /** Real seconds left of a hit-stop (time frozen) and of the crash slow-motion. */
  private hitStop = 0;
  private slowmo = 0;
  /** Landing squash (0..1) and stumble knock-back (m), decaying. */
  private squash = 0;
  private knock = 0;
  /** Lateral visual shove (m) when steering into a lane that does not exist; decays. */
  private bump = 0;
  /** 0..1 scooter crouch (fallback when the rig has no crouch pose). */
  private crouch = 0;
  /** Waiter gap on the previous tick (interpolated when drawn). */
  private prevGap = 0;
  private readonly solids: SolidBox[] = [];
  private readonly solidPool: SolidBox[] = [];
  private readonly chest = new THREE.Vector3();
  private readonly hudPowerups: { kind: PowerupKind; remaining: number; duration: number }[] = [];
  private readonly hudKinds: string[] = [];
  private readonly hudLanes: { count: number; index: number; kinds: readonly string[]; ending: number | null } = { count: 0, index: 0, kinds: [], ending: null };

  private readonly space: TrackSpace;
  /** Lap to start runs on (?lap=2: a night lap for testing). */
  private startLap = 1;
  /** Debug start at a distance (?s=<m>). */
  private startS: number | null = null;
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly vC = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly options: GameOptions,
    world: { city: CityData; track: Track } | null = null,
  ) {
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.display = "block";
    canvas.style.zIndex = "0";
    canvas.style.touchAction = "none";
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.pause();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
    });
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Flat style: no shadow maps at all (blob shadows instead).
    this.renderer.shadowMap.enabled = false;

    // The real lap: the course drives zones, lanes and the generator; the space maps to the world.
    if (world) setCourse(buildCourse(world.city, world.track));
    this.space = new TrackSpace(world?.track ?? null);
    this.world = new World(art, this.space, world?.city ?? null);
    try {
      art.configureRenderer?.(this.renderer, this.world.scene);
      this.renderer.shadowMap.enabled = false;
    } catch (error) {
      console.error("Badajoz Surfers: configureRenderer failed", error);
    }
    this.cam = new ChaseCamera(window.innerWidth / Math.max(1, window.innerHeight), this.space);
    this.world.scene.add(this.cam.camera);
    this.effects = new Effects(this.world.scene, this.cam.camera);
    this.fadeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
    );
    this.fadeMesh.position.z = -0.2;
    this.fadeMesh.renderOrder = 1000;
    this.fadeMesh.frustumCulled = false;
    this.fadeMesh.visible = false;
    this.cam.camera.add(this.fadeMesh);

    this.hud = {
      score: 0, bellotas: 0, distance: 0, multiplier: 1, speed: 0, zone: ZONES[0] ?? zoneAt(0).zone, zoneProgress: 0, lap: 1,
      powerups: this.hudPowerups, letters: WORD.split("").map(() => false), chaser: 0, roofMetres: 0, street: null,
    };

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("simpa:outfit", this.onOutfit);
    new Input(canvas, (c) => this.onCommand(c));

    this.enterMenuScene();
    this.loop = new Loop({
      tick: (dt) => this.tick(dt),
      render: (alpha, dt) => this.render(alpha, dt),
      timeScale: () => this.timeScale(),
      measured: (interval, work) => this.governQuality(interval, work),
    });
    this.loop.start();
    // Compile and build everything the menu and the first seconds of a run need before the page
    // shows the menu (src/main.ts waits for this).
    const t0 = performance.now();
    const gameWorld = this.world;
    const renderer = this.renderer;
    const camera = this.cam.camera;
    this.ready = (async () => {
      this.render(0, 0);
      await gameWorld.prewarm(renderer, camera, this.menuS, 1);
      this.render(0, 0);
      this.loadMs = performance.now() - t0;
      this.isReady = true;
      this.readyAt = performance.now();
      this.programsAtReady = renderer.info.programs?.length ?? 0;
    })();
  }

  /** Inputs (start, confirm, lanes) are ignored until `ready` resolved: nothing starts under the loading screen. */
  private isReady = false;
  private readyAt = Infinity;
  /** Shader programs right after the prewarm (stats: nothing should compile after this). */
  private programsAtReady = 0;

  /** Resolves when the menu scene is built and every shader compiled. */
  readonly ready: Promise<void>;
  /** Milliseconds the prewarm took (stats). */
  private loadMs = 0;

  // --- Adaptive quality ----------------------------------------------------------------------
  /** 0 = best .. 3 = lightest; `?quality=` pins it (see quality.ts). */
  private quality: QualityLevel = 0;
  private qualityPinned = false;
  private governor = new QualityGovernor();
  private focused = typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : true;

  private pixelRatioFor(level: number): number {
    const dpr = window.devicePixelRatio || 1;
    return [Math.min(dpr, 1.5), Math.min(dpr, 1.25), 1, 0.85][level] ?? 1;
  }

  private applyQuality(level: QualityLevel): void {
    this.quality = level;
    this.renderer.setPixelRatio(this.pixelRatioFor(level));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.world.setQuality(level);
  }

  /** One real frame for the governor: decisions only while playing, from 2 s after `ready`. */
  private governQuality(intervalMs: number, workMs: number): void {
    if (this.qualityPinned) return;
    const active = this.isReady && performance.now() - this.readyAt > 2000 && this.state === "playing" && this.run !== null && this.run.countdown <= 0;
    const level = this.governor.frame({ intervalMs, workMs, hidden: document.hidden, focused: this.focused, active });
    if (level !== this.quality) this.applyQuality(level);
  }

  // --- GameApi -------------------------------------------------------------------------------

  on(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHud(): HudSnapshot {
    const hud = this.hud;
    const run = this.run ?? this.lastRun;
    if (!run) {
      hud.score = 0;
      hud.bellotas = 0;
      hud.distance = 0;
      hud.multiplier = this.options.baseMultiplier();
      hud.speed = 0;
      hud.zone = zoneAt(0).zone;
      hud.zoneProgress = 0;
      hud.lap = 1;
      this.hudPowerups.length = 0;
      hud.letters.fill(false);
      hud.chaser = 0;
      hud.roofMetres = 0;
      hud.street = null;
      return hud;
    }
    const p = run.player.p;
    const span = zoneAt(p);
    hud.score = Math.round(run.score);
    hud.bellotas = run.bellotas;
    hud.distance = Math.round(p);
    hud.multiplier = run.multiplier;
    hud.speed = run.player.speed;
    hud.zone = span.zone;
    hud.zoneProgress = Math.min(1, Math.max(0, (p - span.start) / span.zone.length));
    hud.lap = span.lap;
    let n = 0;
    for (const active of run.powerups) {
      let slot = this.hudPowerups[n];
      if (!slot) {
        slot = { kind: active.kind, remaining: 0, duration: 0 };
        this.hudPowerups[n] = slot;
      }
      slot.kind = active.kind;
      slot.remaining = Math.max(0, active.remaining);
      slot.duration = active.duration;
      n++;
    }
    this.hudPowerups.length = n;
    for (let i = 0; i < hud.letters.length; i++) hud.letters[i] = i < run.lettersCollected;
    hud.chaser = run.countdown > 0 ? 0 : run.chaser.hudValue;
    hud.roofMetres = Math.round(run.roofMetres);
    hud.street = getCourse()?.streetNameAt(p) ?? null;
    // The effective lanes: a lane past the midpoint of its taper is no longer shown.
    const layout = layoutAt(p);
    const nl = layout.offsets.length;
    const track = getCourse()?.track ?? null;
    let lane = Math.max(0, Math.min(nl - 1, run.player.lane));
    for (let g = 0; track && g < 8 && !laneShownAt(track, lane, p); g++) {
      const m = mergeOf(track, lane, p);
      if (!m) break;
      lane = m.into;
    }
    const kinds = this.hudKinds;
    kinds.length = 0;
    let index = 0;
    for (let i = 0; i < nl; i++) {
      if (track && !laneShownAt(track, i, p)) continue;
      if (i < lane) index++;
      kinds.push(layout.kinds?.[i] ?? "road");
    }
    this.hudLanes.count = kinds.length;
    this.hudLanes.index = Math.min(index, Math.max(0, kinds.length - 1));
    this.hudLanes.kinds = kinds;
    this.hudLanes.ending = run.laneEnding;
    hud.lanes = this.hudLanes;
    return hud;
  }

  start(): void {
    if (!this.isReady) return;
    if (this.state !== "menu" && this.state !== "gameover") return;
    this.newRun();
  }

  pause(): void {
    if (this.state !== "playing" || !this.run || this.run.phase === "ending" || this.run.phase === "over") return;
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused" || !this.run) return;
    this.setState("playing");
    this.run.startCountdown(this.run.intro, true);
  }

  toMenu(): void {
    // The abandoned run stays readable through getHud() until the next run starts, so the shell
    // can record it from its "menu" state listener.
    if (this.run) this.lastRun = this.run;
    this.run = null;
    this.enterMenuScene();
    this.setState("menu");
  }

  // --- Internals -----------------------------------------------------------------------------

  private emit(event: GameEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (error) {
        // A failing listener must not leave the game stuck half-way through a state change.
        console.error("Simpa: game event listener failed", event.type, error);
      }
    }
  }

  private setState(state: GameState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: "state", state });
  }

  /** Clear every per-run visual: stork, scooter, blink, lean, camera flight/FOV blends, effects, meshes. */
  private resetVisuals(): void {
    const runner = this.world.runner;
    runner.setRiding?.(false);
    runner.setCarried?.(false);
    runner.root.visible = true;
    runner.root.rotation.set(0, 0, 0);
    this.lean = 0;
    this.flight = 0;
    this.fovKick = 0;
    this.groundY = 0;
    this.wasEnd = false;
    this.waiterX = 0;
    this.path.clear();
    this.world.clearDynamic();
    this.effects.clear();
    this.cam.snap();
  }

  private enterMenuScene(): void {
    this.world.setOutfit(this.options.outfit?.());
    this.resetVisuals();
    this.fade = 0;
    this.world.preload(this.menuS, 1);
    this.world.waiter.root.visible = false;
  }

  private newRun(): void {
    this.world.setOutfit(this.options.outfit?.());
    this.lastRun = null;
    window.__simpaDebugRun = this.botOn || this.invincible || this.speedOverride !== null || this.startZone !== null || this.startS !== null || this.startLap > 1;
    const seed = this.fixedSeed ?? (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const run = new Run({
      seed,
      powerupDuration: (k) => this.options.powerupDuration(k),
      baseMultiplier: () => this.options.baseMultiplier(),
      emit: (e) => this.onRunEvent(e),
      fx: (f) => this.onFx(f),
      tutorial: this.options.tutorial(),
    });
    run.invincible = this.invincible;
    run.speedOverride = this.speedOverride;
    this.run = run;
    this.resetVisuals();
    this.world.waiter.root.visible = true;
    // Cut back to the start of the bridge through the fog colour (the city builds behind it).
    this.fade = 1;
    this.bot.reset();
    this.setState("playing");
    const lapStart = (this.startLap - 1) * LAP_LENGTH;
    const startS = this.startS !== null ? this.startS + lapStart : lapStart > 0 ? lapStart : undefined;
    run.begin(this.startZone ?? undefined, startS);
    this.world.preload(run.player.p, run.lap);
  }

  private onRunEvent(e: GameEvent): void {
    switch (e.type) {
      case "zone":
        break;
      case "powerup-start":
        if (e.kind === "patinete") this.world.runner.setRiding?.(true);
        if (e.kind === "ciguena") {
          this.world.runner.setCarried?.(true);
          this.cam.shake(0.15);
        }
        break;
      case "stumble":
        // Hit-stop: a short freeze sells the impact, then the knock-back.
        this.hitStop = Math.max(this.hitStop, 0.075);
        this.knock = 0.55;
        break;
      case "crash":
        this.hitStop = 0.12;
        this.slowmo = 0.4;
        break;
      case "near-miss":
        this.cam.fovPunch(5);
        break;
      case "lane": {
        const s = this.run?.player;
        // Foot-plant puff when pushing off at speed.
        if (s && s.grounded && s.speed > 14) {
          const w = this.space.point(s.p, s.x, s.y, this.vA);
          this.effects.dust(w.x, w.y, w.z, Math.round(3 + (s.speed - 14) / 4), 0.7);
        }
        break;
      }
      case "powerup-end":
        if (e.kind === "patinete") this.world.runner.setRiding?.(false);
        if (e.kind === "ciguena") this.world.runner.setCarried?.(false);
        break;
      default:
        break;
    }
    this.emit(e);
    if (e.type === "gameover") {
      this.lastGameOver = this.time;
      this.setState("gameover");
    }
  }

  private onFx(f: RunFx): void {
    switch (f.type) {
      case "burst": {
        const w = this.space.point(f.d, f.x, f.y, this.vA);
        const v = f.kind === "crash" ? 0 : (this.run?.player.speed ?? 0) * 0.9;
        const fw = this.space.forward(f.d, this.vB);
        this.effects.burst(f.kind, w.x, w.y, w.z, fw.x * v, fw.z * v);
        break;
      }
      case "knock":
        this.world.knock(f.id, f.dir);
        break;
      case "shake":
        this.cam.shake(f.amount);
        break;
      case "flash":
        this.world.flash(f.id);
        break;
      case "bump":
        // No lane there: a tiny shove against the kerb and back.
        this.bump = 0.22 * Math.sign(f.dir);
        break;
      case "remove": {
        const o = this.run?.gen.obstacles.find((x) => x.id === f.id);
        if (o) {
          const w = this.space.point(o.d, o.x, 1, this.vA);
          this.effects.burst("crash", w.x, w.y, w.z);
        }
        break;
      }
      case "reset":
        this.path.clear();
        this.world.clearDynamic();
        if (this.run) this.world.preload(this.run.player.p, this.run.lap);
        this.fade = Math.max(this.fade, 0.8);
        this.cam.snap();
        break;
    }
  }

  private onCommand(c: Command): void {
    if (!this.isReady) return;
    switch (c) {
      case "pause":
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
        return;
      case "confirm":
        if (this.state === "menu" || (this.state === "gameover" && this.time - this.lastGameOver > 0.8)) this.start();
        return;
      default:
        if (this.state === "playing" && this.run && !this.botOn) this.run.push(c);
    }
  }

  private readonly onResize = (): void => {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatioFor(this.quality));
    this.renderer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  };

  /** Automated testing (?nopause=1) disables the auto-pause. */
  private autoPause = true;

  private readonly onVisibility = (): void => {
    if (this.autoPause && document.hidden && this.state === "playing") this.pause();
  };

  private readonly onBlur = (): void => {
    this.focused = false;
    if (this.autoPause && this.state === "playing") this.pause();
  };

  private readonly onFocus = (): void => {
    this.focused = true;
  };

  /** The shell's shop can ask for the menu runner to be re-dressed: `window` event "simpa:outfit". */
  private readonly onOutfit = (): void => {
    if (this.state === "menu") this.world.setOutfit(this.options.outfit?.());
  };

  private script: { at: number; action: PlayerAction }[] = [];

  private tick(dt: number): void {
    this.time += dt;
    const run = this.run;
    if (!run || this.state === "paused" || this.state === "menu") return;
    if (this.botOn) this.bot.update(run);
    const s = run.player;
    // Scripted inputs (debug.inputs): pressed on the first tick the runner reaches their distance.
    while (this.script.length > 0 && run.phase === "running" && run.countdown <= 0 && s.p >= (this.script[0]?.at ?? Infinity)) {
      const next = this.script.shift();
      if (next) run.push(next.action);
    }
    const wasGrounded = s.grounded;
    const vy = s.vy;
    this.prevGap = run.chaser.distance;
    run.tick(dt);
    if (!wasGrounded && s.grounded && run.phase === "running") {
      // Landing: squash, dust, and a camera dip that grows with the impact.
      const impact = Math.min(1, Math.max(0, -vy - 4) / 16);
      this.squash = Math.max(this.squash, 0.35 + 0.65 * impact);
      const w = this.space.point(s.p, s.x, s.y, this.vA);
      this.effects.dust(w.x, w.y, w.z, Math.round(5 + 12 * impact), 0.8 + impact);
      this.cam.dip(0.6 + 2.2 * impact);
    }
    // While the runner flies, the waiter stays on the street below.
    if (run.phase === "running") {
      if (s.carried) this.path.record(s.p, s.x, 0, false, false);
      else this.path.record(s.p, s.x, s.y, s.roll > 0, !s.grounded);
    }
  }

  /** Simulation speed for the loop: tutorial slow-mo, but never during a countdown. */
  private timeScale(): number {
    const run = this.run;
    if (!run || this.state !== "playing" || run.countdown > 0) return 1;
    if (this.hitStop > 0) return 0;
    // Crash: slow motion easing back to normal into the end shot.
    const slow = this.slowmo > 0 ? 0.3 + 0.7 * (1 - this.slowmo / 0.4) ** 2 : 1;
    return run.timeScale * slow;
  }

  private runnerAnim(run: Run): ActorAnim {
    const s = run.player;
    if (run.phase === "countdown" && run.intro) return "idle";
    if (run.phase === "ending" || run.phase === "over") return run.cause === "caught" ? "caught" : "stumble";
    // Paused, or counting down to resume: keep the run cycle going (no standstill pose), so the
    // run picks up exactly where it stopped.
    if (this.state === "paused" || run.countdown > 0) return s.grounded ? (s.speed > 0 ? "run" : "idle") : "fall";
    if (run.stumbleAnim > 0) return "stumble";
    // On the patinete a "roll" is a crouch on the deck (see render), never a somersault.
    if (s.roll > 0) return run.active("patinete") ? "run" : "roll";
    if (!s.grounded && !s.carried) {
      // No single-frame flickers at roof seams: a short drop off an edge keeps running.
      if (s.vy > 0.5) return "jump";
      if (s.air > 0.08 || s.vy < -3) return "fall";
    }
    return "run";
  }

  private waiterAnim(run: Run): ActorAnim {
    if (run.phase === "countdown" && run.intro) return "celebrate";
    if (run.phase === "ending" || run.phase === "over") return run.endTime > 0.5 || run.phase === "over" ? "celebrate" : "run";
    if (this.state === "paused" || run.countdown > 0) return "idle";
    if (this.pathSample.rolling) return "roll";
    if (this.pathSample.airborne) return "jump";
    return "run";
  }

  private render(alpha: number, dt: number): void {
    const world = this.world;
    const runner = world.runner;
    const run = this.run;
    const frozen = this.state === "paused";
    // Real-time timers (hit-stop, slow-motion, squash) run on the frame clock.
    if (!frozen) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      if (this.hitStop <= 0) this.slowmo = Math.max(0, this.slowmo - dt);
    }
    const animDt = frozen ? 0 : dt * this.timeScale();
    let mode: CameraMode = "menu";
    let px = 0;
    let py = 0;
    let p = 0;
    let speed = 0;
    let laneX = 0;

    let lap = 1;
    if (!run) {
      // The menu: on the Puente Real deck, the pylon ahead, in the right-hand lane.
      p = this.menuS;
      const layout = layoutAt(p);
      px = layout.offsets[layout.offsets.length - 1] ?? 0;
      this.space.place(runner.root, p, px, 0, 0.35, 0);
      world.placeBlob("runner", p, px, 0, 0);
      world.hideBlob("waiter");
      runner.root.scale.set(1, 1, 1);
      runner.update(dt, "idle", 0);
    } else {
      lap = run.lap;
      const s = run.player;
      const a = frozen || run.countdown > 0 ? 1 : alpha;
      p = s.pp + (s.p - s.pp) * a;
      px = s.px + (s.x - s.px) * a;
      py = s.py + (s.y - s.py) * a;
      speed = s.speed;
      laneX = run.boxes.laneX(s.lane, s.p);

      // Lean into lane changes (the lane ease's overshoot shows as a little settle).
      const vx = (s.x - s.px) / TICK;
      const leanGain = s.carried ? 0.04 : 0.02;
      // ...and into bends like a runner on a track (centripetal lean from the smoothed curvature).
      const bend = s.carried ? 0 : Math.max(-0.22, Math.min(0.22, (s.speed * s.speed * this.bendCurvature(p)) / 9.81 * 0.5));
      this.lean += (Math.max(-0.5, Math.min(0.5, -vx * leanGain - bend)) - this.lean) * Math.min(1, dt * (s.carried ? 6 : 10));
      this.flight += ((s.carried ? 1 : 0) - this.flight) * Math.min(1, dt * (s.carried ? 1.8 : 1.4));
      // Landing squash and stumble knock-back decay in real time.
      this.squash *= Math.exp(-dt * 13);
      this.knock *= Math.exp(-dt * 7);
      const q = this.squash;
      // Crossing a non-runnable median (the cable plane, a kerb island): a little vault.
      const across = Math.abs(s.targetX - s.fromX);
      const hop = s.laneT < 1 && across > MEDIAN_GAP ? Math.sin(Math.PI * s.laneT) * 0.45 * Math.min(1, (across - 3.5) / 2) : 0;
      this.bump *= Math.exp(-dt * 14);
      // A visible diagonal run: the body yaws towards the lane being entered.
      const yaw = Math.max(-0.38, Math.min(0.38, -vx * 0.045));
      this.space.place(runner.root, p - this.knock, px + this.bump, py + hop, yaw, 0);
      world.placeBlob("runner", p, px, s.carried ? 0 : this.groundY, py);
      runner.root.rotation.x = -this.knock * 0.25;
      runner.root.rotation.z = this.lean;
      // Rolling on the patinete: crouch low on the deck (the rig's own pose if it has one).
      const crouch = s.roll > 0 && run.active("patinete") !== undefined;
      if (runner.setCrouch) runner.setCrouch(crouch);
      // ~80 ms ease in and out (no pop).
      this.crouch += ((crouch && !runner.setCrouch ? 1 : 0) - this.crouch) * (1 - Math.exp(-dt / 0.027));
      const cy = 1 - 0.38 * this.crouch;
      runner.root.scale.set((1 + 0.08 * q) * (1 + 0.1 * this.crouch), (1 - 0.14 * q) * cy, (1 + 0.08 * q) * (1 + 0.1 * this.crouch));
      runner.update(animDt, this.runnerAnim(run), speed);
      runner.root.visible = run.invulnerable > 0 ? Math.floor(this.time * 14) % 2 === 0 : true;

      // The waiter follows the runner's own path a few metres behind (lane changes, jumps, roofs).
      const waiter = world.waiter;
      const gap = this.prevGap + (run.chaser.distance - this.prevGap) * a;
      const wp = p - gap;
      const sample = this.pathSample;
      let wy = 0;
      if (this.path.sample(wp, sample)) {
        this.waiterX = sample.x;
        wy = sample.y;
      } else {
        sample.rolling = false;
        sample.airborne = false;
        this.waiterX += (px - this.waiterX) * Math.min(1, dt * 3);
      }
      // Intro: he storms out of the bar (the real bar site, behind the start on the right) and
      // into the runner's lane.
      let wx = this.waiterX;
      let wz = wp;
      if (run.intro && run.countdown > 0) {
        const t = Math.min(1, Math.max(0, (COUNTDOWN_TIME - run.countdown) / COUNTDOWN_TIME));
        const e = t * t * (3 - 2 * t);
        const bar = getCourse()?.track.marks.barSite;
        const layout = layoutAt(p);
        const kerb = bar ? bar.lateral : (layout.right ?? px + 2) + 1.5;
        const behind = bar && run.player.p < 1 ? Math.max(gap, -bar.s) : gap;
        wx = kerb + (px - kerb) * e;
        wz = p - (behind + (gap - behind) * e);
        this.waiterX = wx;
      }
      this.space.place(waiter.root, wz, wx, wy, 0, 0);
      world.placeBlob("waiter", wz, wx, 0, wy);
      this.waiterZ = -wz;
      waiter.update(animDt, this.waiterAnim(run), Math.max(speed, run.phase === "ending" ? 7 : 0));
      waiter.root.visible = gap < 40;

      if (s.grounded || py < this.groundY) this.groundY = py;
      if (run.phase === "ending" || run.phase === "over") {
        mode = "end";
        if (!this.wasEnd) this.endSide = this.freeSide(run);
        this.wasEnd = true;
      } else if (run.intro && run.countdown > 0) mode = "intro";
      else mode = "chase";

      // Solids the lens must stay out of (vehicles, containers, scaffolds near the camera).
      // (pooled boxes: no allocation per frame)
      let n = 0;
      for (let i = 0; i < run.boxes.count; i++) {
        const b = run.boxes.box(i);
        if (!b || b.yMax < 1 || run.ignore.has(b.spawn.id)) continue;
        let box = this.solidPool[n];
        if (!box) this.solidPool.push((box = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 }));
        box.xMin = b.xMin;
        box.xMax = b.xMax;
        box.yMin = b.yMin;
        box.yMax = b.yMax;
        box.zMin = -b.dMax;
        box.zMax = -b.dMin;
        this.solids[n++] = box;
      }
      this.solids.length = n;
    }

    const patinete = run?.active("patinete") !== undefined;
    this.fovKick += ((patinete ? 6 : 0) - this.fovKick) * Math.min(1, dt * 3);
    const introT = run && run.intro ? Math.min(1, Math.max(0, (COUNTDOWN_TIME - run.countdown) / COUNTDOWN_TIME) * 1.15) : 1;
    const s = run?.player;
    this.cam.update(frozen ? 0 : dt, {
      mode, x: px, y: py, z: -p, laneX, groundY: run ? this.groundY : 0, speed, intro: introT, fovKick: this.fovKick,
      endSide: this.endSide, waiterZ: this.waiterZ, flight: run ? this.flight : 0, bank: run && this.flight > 0.05 ? this.lean * 0.35 * this.flight : 0,
      rolling: s ? s.roll > 0 : false, grounded: s ? s.grounded : false, solids: this.solids,
      clearance: getCourse()?.clearanceAt(p) ?? null,
      street: this.streetAt(p),
      lookBias: run ? this.bendBias(p) : 0,
    });
    world.setCamera(this.cam.camera);
    // On the menu, keep the run's start built too (when the art can), so "Jugar" is instant.
    world.updateScenery(p, lap, this.cam.camera, run ? undefined : 0);
    world.updateAtmosphere(p, lap);
    if (run) {
      this.chest.set(px, py + 1.1, -p);
      world.sync(run, p, frozen || run.countdown > 0 ? 1 : alpha, animDt, this.time, this.cam.local, this.chest);
    }
    if (this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt * 2.2);
      this.fadeMesh.material.color.copy(world.fog.color);
      this.fadeMesh.material.opacity = Math.min(1, this.fade * 1.4);
    }
    this.fadeMesh.visible = this.fade > 0;
    this.space.point(p, px, py, this.focus);
    world.updateEnvironment(this.cam.camera, this.focus, this.space.forward(p, this.vC));
    const lines = run && run.phase === "running" && !frozen ? (patinete ? 1 : Math.max(0, Math.min(1, (speed - 17) / 12))) : 0;
    this.effects.update(frozen ? 0 : animDt, lines, speed);
    if (!this.contextLost) this.renderer.render(world.scene, this.cam.camera);
  }

  private readonly street = { left: 0, right: 0, passage: false };

  /** Signed curvature (1/m, + turning right) averaged over a few metres round p. */
  private bendCurvature(p: number): number {
    let k = 0;
    for (const d of [-3, 0, 3, 6]) k += this.space.frame(p + d).curvature;
    return k / 4;
  }

  /** Walls round the camera and the runner at distance p (from the boom's far end to a little ahead). */
  private streetAt(p: number): { left: number; right: number; passage: boolean } | null {
    const course = getCourse();
    if (!course) return null;
    wallsBetween(course.walls(), course.lapLength, p - 7.5, p + 6, this.street);
    this.street.passage = inPassage(course, p - 8, p + 4);
    return this.street;
  }

  /**
   * Look a little into the inside of the bend ahead (heading change over the next 35 m), so the
   * road the runner is about to take is on screen before the turn.
   */
  private bendBias(p: number): number {
    const h0 = this.space.frame(p + 5).heading;
    const h1 = this.space.frame(p + 40).heading;
    // heading grows when the route turns left (towards -lateral)
    return Math.max(-3, Math.min(3, -(h1 - h0) * 4));
  }

  /** A debug helper was used: if a run is under way, it must not count for the save. */
  private markDebugRun(): void {
    if (this.run) window.__simpaDebugRun = true;
  }

  /** Side (+1 right, -1 left) of the runner with fewer obstacles, for the end shot. */
  private freeSide(run: Run): number {
    const s = run.player;
    let left = 0;
    let right = 0;
    for (let i = 0; i < run.boxes.count; i++) {
      const b = run.boxes.box(i);
      if (!b || b.dMax < s.p - 9 || b.dMin > s.p + 3) continue;
      if (b.xMax > s.x + 0.6) right++;
      if (b.xMin < s.x - 0.6) left++;
    }
    if (left === right) return s.x > 0.5 ? -1 : 1; // Towards the middle of the road.
    return right < left ? 1 : -1;
  }

  // --- Debug ---------------------------------------------------------------------------------

  readonly debug: GameDebug = {
    setInvincible: (on) => {
      this.markDebugRun();
      this.invincible = on;
      if (this.run) this.run.invincible = on;
    },
    setBot: (on) => {
      this.markDebugRun();
      this.botOn = on;
      this.bot.reset();
    },
    warp: (zone) => {
      this.markDebugRun();
      if (!isZoneId(zone)) return;
      if (this.run && (this.run.phase === "running" || this.run.phase === "countdown")) this.run.warp(zone);
      else this.startZone = zone;
    },
    warpS: (metres) => {
      this.markDebugRun();
      if (!Number.isFinite(metres)) return;
      if (this.run && (this.run.phase === "running" || this.run.phase === "countdown")) this.run.warpTo(metres);
      else this.startS = metres;
    },
    powerup: (kind) => {
      this.markDebugRun();
      const run = this.run;
      if (!run || run.phase !== "running") return;
      const s = run.player;
      run.gen.pickups.push({ id: 900_000_000 + Math.floor(this.time * 1000), kind, lane: s.lane, x: run.boxes.laneX(s.lane, s.p + 8), d: s.p + 8, y: 1 });
      run.gen.pickups.sort((a, b) => a.d - b.d);
    },
    setSpeed: (mps) => {
      this.markDebugRun();
      this.speedOverride = mps;
      if (this.run) this.run.speedOverride = mps;
    },
    obstacles: () => this.world.debugObstacles(),
    breakdown: () => this.world.drawBreakdown(),
    manual: (on) => {
      if (on) this.loop.stop();
      else this.loop.start();
    },
    frames: (count, hz = 60) => {
      for (let i = 0; i < count; i++) this.loop.step(1 / hz);
    },
    press: (action) => {
      this.markDebugRun();
      this.run?.push(action);
    },
    inputs: (sequence) => {
      this.markDebugRun();
      this.script = [...sequence].filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
    },
    camera: () => {
      const c = this.cam.camera;
      return { x: c.position.x, y: c.position.y, z: c.position.z, fov: c.fov, p: this.run?.player.p ?? 0 };
    },
    stats: () => {
      const info = this.renderer.info;
      const run = this.run;
      const s = run?.player;
      return {
        state: this.state,
        fps: Math.round(this.loop.fps),
        quality: this.quality,
        qualityPinned: this.qualityPinned,
        frameMs: Number(this.governor.frameMs.toFixed(1)),
        refreshMs: this.governor.refreshMs === null ? null : Number(this.governor.refreshMs.toFixed(2)),
        pixelRatio: this.renderer.getPixelRatio(),
        programs: info.programs?.length ?? 0,
        programsAtReady: this.programsAtReady,
        /** Programs compiled since the prewarm (should stay 0). */
        programsSinceReady: (info.programs?.length ?? 0) - this.programsAtReady,
        loadMs: Math.round(this.loadMs),
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        sceneChildren: this.world.scene.children.length,
        ...this.world.counts(),
        spawnsObstacles: run?.gen.obstacles.length ?? 0,
        spawnsPickups: run?.gen.pickups.length ?? 0,
        botPlanMs: Number(this.bot.lastPlanMs.toFixed(2)),
        bot: this.botOn,
        invincible: this.invincible,
        player: s
          ? {
              phase: run?.phase, distance: Number(s.p.toFixed(1)), speed: Number(s.speed.toFixed(2)), lane: s.lane,
              x: Number(s.x.toFixed(2)), y: Number(s.y.toFixed(2)), laneT: Number(s.laneT.toFixed(2)), grounded: s.grounded, rolling: s.roll > 0,
              onRoof: s.supportId >= 0, zone: zoneAt(s.p).zone.id, lap: zoneAt(s.p).lap, chaser: Number(run?.chaser.value.toFixed(2)),
              powerups: run?.powerups.map((x) => x.kind), score: Math.round(run?.score ?? 0),
            }
          : null,
      };
    },
  };

  /** Apply URL parameters (?autostart=1&bot=1&invincible=1&zone=<id>&seed=<n>). */
  applyParams(params: URLSearchParams): void {
    if (params.get("bot") === "1") this.debug.setBot(true);
    if (params.get("invincible") === "1") this.debug.setInvincible(true);
    const seed = params.get("seed");
    if (seed !== null && Number.isFinite(Number(seed))) this.fixedSeed = Number(seed) >>> 0;
    const zone = params.get("zone");
    if (isZoneId(zone)) this.startZone = zone;
    const at = params.get("s");
    if (at !== null && Number.isFinite(Number(at)) && Number(at) >= 0) this.startS = Number(at);
    const lap = params.get("lap");
    if (lap !== null && Number(lap) >= 1) this.startLap = Math.floor(Number(lap));
    const quality = params.get("quality");
    if (quality !== null && /^[0-3]$/.test(quality)) {
      this.qualityPinned = true;
      this.governor = new QualityGovernor(Number(quality) as QualityLevel, true);
      this.applyQuality(Number(quality) as QualityLevel);
    }
    const speed = params.get("speed");
    if (speed !== null && Number(speed) > 0) this.debug.setSpeed(Number(speed));
    // Defer so the shell can subscribe first.
    if (params.get("nopause") === "1") this.autoPause = false;
    if (params.get("autostart") === "1") void this.ready.then(() => setTimeout(() => this.start(), 60));
  }
}

/**
 * Create the engine. `world` is the real city (src/main.ts loads it first); without it the old
 * straight stand-in course is used (dev pages, tests).
 */
export function createGame(canvas: HTMLCanvasElement, options: GameOptions, world: { city: CityData; track: Track } | null = null): GameApi {
  const game = new Game(canvas, options, world);
  game.applyParams(new URLSearchParams(window.location.search));
  window.__game = { api: game, debug: game.debug };
  window.__simpaDebugRun ??= false;
  return game;
}

