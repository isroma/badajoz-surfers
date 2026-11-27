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
import { ChaseCamera, type CameraMode } from "./camera";
import { PathRecorder, type PathSample } from "./chaser";
import { Effects } from "./effects";
import { Input, type Command } from "./input";
import { Loop } from "./loop";
import { COUNTDOWN_TIME, Run, type RunFx } from "./run";
import { TICK, zoneAt } from "./tuning";
import { World } from "./world";

export interface GameDebug {
  setInvincible(on: boolean): void;
  setBot(on: boolean): void;
  warp(zone: ZoneId): void;
  setSpeed(mps: number | null): void;
  /** Drop a power-up pickup 8 m ahead in the runner's lane (e.g. "ciguena"). */
  powerup(kind: PowerupKind): void;
  stats(): Record<string, unknown>;
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
  /** Where the idle runner stands in the menu (on the bridge deck, before the pylon). */
  private static readonly MENU_DISTANCE = 150;
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
  private readonly hudPowerups: { kind: PowerupKind; remaining: number; duration: number }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly options: GameOptions,
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
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.world = new World(art);
    this.cam = new ChaseCamera(window.innerWidth / Math.max(1, window.innerHeight));
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
      powerups: this.hudPowerups, letters: WORD.split("").map(() => false), chaser: 0, roofMetres: 0,
    };

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("simpa:outfit", this.onOutfit);
    new Input(canvas, (c) => this.onCommand(c));

    this.enterMenuScene();
    this.loop = new Loop({
      tick: (dt) => this.tick(dt),
      render: (alpha, dt) => this.render(alpha, dt),
      timeScale: () => this.timeScale(),
    });
    this.loop.start();
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
    return hud;
  }

  start(): void {
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
    this.world.updateSegments(Game.MENU_DISTANCE, 99, 4);
    this.world.setZone("puente-real", true);
    this.world.waiter.root.visible = false;
  }

  private newRun(): void {
    this.world.setOutfit(this.options.outfit?.());
    this.lastRun = null;
    window.__simpaDebugRun = this.botOn || this.invincible || this.speedOverride !== null || this.startZone !== null;
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
    this.world.updateSegments(0, 99, 4);
    this.world.setZone("puente-real", true);
    this.world.waiter.root.visible = true;
    // Cut back to the start of the bridge through the fog colour.
    this.fade = 1;
    this.bot.reset();
    this.setState("playing");
    run.begin(this.startZone ?? undefined);
    if (run.player.p > 1) {
      // Debug start in another zone: build the scenery there straight away, including the end
      // of the previous zone behind the intro camera.
      this.world.clearSegments();
      this.world.updateSegments(run.player.p, 99, 4);
    }
  }

  private onRunEvent(e: GameEvent): void {
    switch (e.type) {
      case "zone":
        this.world.setZone(e.zone.id, e.first, e.lap);
        break;
      case "powerup-start":
        if (e.kind === "patinete") this.world.runner.setRiding?.(true);
        if (e.kind === "ciguena") {
          this.world.runner.setCarried?.(true);
          this.cam.shake(0.15);
        }
        break;
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
      case "burst":
        this.effects.burst(f.kind, f.x, f.y, -f.d, f.kind === "crash" ? 0 : -(this.run?.player.speed ?? 0) * 0.9);
        break;
      case "knock":
        this.world.knock(f.id, f.dir);
        break;
      case "shake":
        this.cam.shake(f.amount);
        break;
      case "remove": {
        const o = this.run?.gen.obstacles.find((x) => x.id === f.id);
        if (o) this.effects.burst("crash", 0, 1, -o.d);
        break;
      }
      case "reset":
        this.path.clear();
        this.world.clearDynamic();
        this.world.clearSegments();
        if (this.run) this.world.updateSegments(this.run.player.p, 99);
        this.cam.snap();
        break;
    }
  }

  private onCommand(c: Command): void {
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
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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
    if (this.autoPause && this.state === "playing") this.pause();
  };

  /** The shell's shop can ask for the menu runner to be re-dressed: `window` event "simpa:outfit". */
  private readonly onOutfit = (): void => {
    if (this.state === "menu") this.world.setOutfit(this.options.outfit?.());
  };

  private tick(dt: number): void {
    this.time += dt;
    const run = this.run;
    if (!run || this.state === "paused" || this.state === "menu") return;
    if (this.botOn) this.bot.update(run);
    run.tick(dt);
    const s = run.player;
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
    return run.timeScale;
  }

  private runnerAnim(run: Run): ActorAnim {
    const s = run.player;
    if (run.phase === "countdown" && run.intro) return "idle";
    if (run.phase === "ending" || run.phase === "over") return run.cause === "caught" ? "caught" : "stumble";
    if (this.state === "paused" || run.countdown > 0) return s.grounded ? "idle" : "fall";
    if (run.stumbleAnim > 0) return "stumble";
    if (s.roll > 0) return "roll";
    if (!s.grounded) return s.vy > 0 ? "jump" : "fall";
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
    const animDt = frozen ? 0 : dt * this.timeScale();
    let mode: CameraMode = "menu";
    let px = 0;
    let py = 0;
    let p = 0;
    let speed = 0;

    if (!run) {
      p = Game.MENU_DISTANCE;
      runner.root.position.set(0, 0, -p);
      runner.root.rotation.set(0, 0.35, 0);
      runner.update(dt, "idle", 0);
    } else {
      const s = run.player;
      const a = frozen || run.countdown > 0 ? 1 : alpha;
      p = s.pp + (s.p - s.pp) * a;
      px = s.px + (s.x - s.px) * a;
      py = s.py + (s.y - s.py) * a;
      speed = s.speed;
      world.updateSegments(p, 2, run.phase === "countdown" || p < 30 ? 4 : 1);
      world.sync(run, p, animDt, this.time, this.cam.camera.position, run.phase === "ending" || run.phase === "over");

      // Lean into lane changes.
      const vx = (s.x - s.px) / TICK;
      const leanGain = s.carried ? 0.04 : 0.018;
      this.lean += (Math.max(-0.5, Math.min(0.5, -vx * leanGain)) - this.lean) * Math.min(1, dt * (s.carried ? 6 : 14));
      this.flight += ((s.carried ? 1 : 0) - this.flight) * Math.min(1, dt * (s.carried ? 1.8 : 1.4));
      runner.root.position.set(px, py, -p);
      runner.root.rotation.set(0, 0, this.lean);
      runner.update(animDt, this.runnerAnim(run), speed);
      runner.root.visible = run.invulnerable > 0 ? Math.floor(this.time * 14) % 2 === 0 : true;

      // The waiter follows the runner's own path a few metres behind (lane changes, jumps, roofs).
      const waiter = world.waiter;
      const gap = run.chaser.distance;
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
      waiter.root.position.set(this.waiterX, wy, -wp);
      waiter.root.rotation.set(0, 0, 0);
      this.waiterZ = -wp;
      waiter.update(animDt, this.waiterAnim(run), Math.max(speed, run.phase === "ending" ? 7 : 0));
      waiter.root.visible = gap < 40;

      if (s.grounded || py < this.groundY) this.groundY = py;
      if (run.phase === "ending" || run.phase === "over") {
        mode = "end";
        if (!this.wasEnd) this.endSide = this.freeSide(run);
        this.wasEnd = true;
      } else if (run.intro && run.countdown > 0) mode = "intro";
      else mode = "chase";
    }

    const patinete = run?.active("patinete") !== undefined;
    this.fovKick += ((patinete ? 6 : 0) - this.fovKick) * Math.min(1, dt * 3);
    const introT = run && run.intro ? Math.min(1, Math.max(0, (COUNTDOWN_TIME - run.countdown) / COUNTDOWN_TIME) * 1.15) : 1;
    this.cam.update(dt, {
      mode, x: px, y: py, z: -p, groundY: run ? this.groundY : 0, speed, intro: introT, fovKick: this.fovKick,
      endSide: this.endSide, waiterZ: this.waiterZ, flight: run ? this.flight : 0, bank: run && this.flight > 0.05 ? this.lean * 0.35 * this.flight : 0,
    });
    if (this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt * 2.2);
      this.fadeMesh.material.color.copy(world.fog.color);
      this.fadeMesh.material.opacity = Math.min(1, this.fade * 1.4);
    }
    this.fadeMesh.visible = this.fade > 0;
    this.focus.set(px, py, -p);
    world.updateEnvironment(dt, this.cam.camera, this.focus);
    const lines = run && run.phase === "running" && !frozen ? (patinete ? 1 : Math.max(0, (speed - 22) / 12)) : 0;
    this.effects.update(frozen ? 0 : dt, lines, speed);
    if (!this.contextLost) this.renderer.render(world.scene, this.cam.camera);
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
    powerup: (kind) => {
      this.markDebugRun();
      const run = this.run;
      if (!run || run.phase !== "running") return;
      const s = run.player;
      run.gen.pickups.push({ id: 900_000_000 + Math.floor(this.time * 1000), kind, lane: s.lane, d: s.p + 8, y: 1 });
      run.gen.pickups.sort((a, b) => a.d - b.d);
    },
    setSpeed: (mps) => {
      this.markDebugRun();
      this.speedOverride = mps;
      if (this.run) this.run.speedOverride = mps;
    },
    stats: () => {
      const info = this.renderer.info;
      const run = this.run;
      const s = run?.player;
      return {
        state: this.state,
        fps: Math.round(this.loop.fps),
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
              x: Number(s.x.toFixed(2)), y: Number(s.y.toFixed(2)), grounded: s.grounded, rolling: s.roll > 0,
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
    const speed = params.get("speed");
    if (speed !== null && Number(speed) > 0) this.debug.setSpeed(Number(speed));
    // Defer so the shell can subscribe first.
    if (params.get("nopause") === "1") this.autoPause = false;
    if (params.get("autostart") === "1") setTimeout(() => this.start(), 60);
  }
}

export function createGame(canvas: HTMLCanvasElement, options: GameOptions): GameApi {
  const game = new Game(canvas, options);
  game.applyParams(new URLSearchParams(window.location.search));
  window.__game = { api: game, debug: game.debug };
  window.__simpaDebugRun ??= false;
  return game;
}

