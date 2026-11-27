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
  stats(): Record<string, unknown>;
}

declare global {
  interface Window {
    __game?: { api: GameApi; debug: GameDebug };
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

    this.hud = {
      score: 0, bellotas: 0, distance: 0, multiplier: 1, speed: 0, zone: ZONES[0] ?? zoneAt(0).zone, zoneProgress: 0, lap: 1,
      powerups: this.hudPowerups, letters: WORD.split("").map(() => false), chaser: 0,
    };

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    new Input(canvas, (c) => this.onCommand(c));

    this.enterMenuScene();
    this.loop = new Loop({ tick: (dt) => this.tick(dt), render: (alpha, dt) => this.render(alpha, dt) });
    this.loop.start();
  }

  // --- GameApi -------------------------------------------------------------------------------

  on(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHud(): HudSnapshot {
    const hud = this.hud;
    const run = this.run;
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
    hud.chaser = run.chaser.value;
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
    this.run.startCountdown(this.run.intro);
  }

  toMenu(): void {
    this.run = null;
    this.enterMenuScene();
    this.setState("menu");
  }

  // --- Internals -----------------------------------------------------------------------------

  private emit(event: GameEvent): void {
    for (const l of this.listeners) l(event);
  }

  private setState(state: GameState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: "state", state });
  }

  private enterMenuScene(): void {
    this.world.clearDynamic();
    this.effects.clear();
    this.world.updateSegments(0, 99, 3);
    this.world.setZone("puente-real", true);
    this.world.runner.setRiding?.(false);
    this.world.runner.root.visible = true;
    this.world.waiter.root.visible = false;
    this.cam.snap();
  }

  private newRun(): void {
    const seed = this.fixedSeed ?? (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const run = new Run({
      seed,
      powerupDuration: (k) => this.options.powerupDuration(k),
      baseMultiplier: () => this.options.baseMultiplier(),
      emit: (e) => this.onRunEvent(e),
      fx: (f) => this.onFx(f),
    });
    run.invincible = this.invincible;
    run.speedOverride = this.speedOverride;
    this.run = run;
    this.world.clearDynamic();
    this.effects.clear();
    this.world.updateSegments(0, 99, 3);
    this.world.setZone("puente-real", true);
    this.world.runner.setRiding?.(false);
    this.world.runner.root.visible = true;
    this.world.waiter.root.visible = true;
    this.waiterX = 0;
    this.groundY = 0;
    this.cam.snap();
    this.bot.reset();
    this.setState("playing");
    run.begin();
    if (this.startZone && this.startZone !== "puente-real") run.warp(this.startZone);
  }

  private onRunEvent(e: GameEvent): void {
    switch (e.type) {
      case "zone":
        this.world.setZone(e.zone.id, e.first);
        break;
      case "powerup-start":
        if (e.kind === "patinete") this.world.runner.setRiding?.(true);
        break;
      case "powerup-end":
        if (e.kind === "patinete") this.world.runner.setRiding?.(false);
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
      case "reset":
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

  private readonly onVisibility = (): void => {
    if (document.hidden && this.state === "playing") this.pause();
  };

  private tick(dt: number): void {
    this.time += dt;
    const run = this.run;
    if (!run || this.state === "paused" || this.state === "menu") return;
    if (this.botOn) this.bot.update(run);
    run.tick(dt);
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
    if (run.phase === "countdown" && run.intro) return "idle";
    if (run.phase === "ending" || run.phase === "over") return run.endTime > 0.5 || run.phase === "over" ? "celebrate" : "run";
    if (this.state === "paused" || run.countdown > 0) return "idle";
    return "run";
  }

  private render(alpha: number, dt: number): void {
    const world = this.world;
    const runner = world.runner;
    const run = this.run;
    const frozen = this.state === "paused";
    const animDt = frozen ? 0 : dt;
    let mode: CameraMode = "menu";
    let px = 0;
    let py = 0;
    let p = 0;
    let speed = 0;

    if (!run) {
      runner.root.position.set(0, 0, 0);
      runner.root.rotation.set(0, 0, 0);
      runner.update(dt, "idle", 0);
    } else {
      const s = run.player;
      const a = frozen || run.countdown > 0 ? 1 : alpha;
      p = s.pp + (s.p - s.pp) * a;
      px = s.px + (s.x - s.px) * a;
      py = s.py + (s.y - s.py) * a;
      speed = s.speed;
      world.updateSegments(p, 2, run.phase === "countdown" || p < 30 ? 3 : 1);
      world.sync(run, p, animDt, this.time);

      // Lean into lane changes.
      const vx = (s.x - s.px) / TICK;
      this.lean += (Math.max(-0.35, Math.min(0.35, -vx * 0.018)) - this.lean) * Math.min(1, dt * 14);
      runner.root.position.set(px, py, -p);
      runner.root.rotation.set(0, 0, this.lean);
      runner.update(animDt, this.runnerAnim(run), speed);
      runner.root.visible = run.invulnerable > 0 ? Math.floor(this.time * 14) % 2 === 0 : true;

      // The waiter.
      const waiter = world.waiter;
      const gap = run.chaser.gap;
      const wp = p - gap;
      this.waiterX += (px - this.waiterX) * Math.min(1, dt * (run.phase === "running" ? 3 : 6));
      const wSurface = run.boxes.surface(this.waiterX, wp, 0.4).height;
      waiter.root.position.set(this.waiterX, wSurface, -wp);
      waiter.root.rotation.set(0, 0, 0);
      waiter.update(animDt, this.waiterAnim(run), Math.max(speed, run.phase === "ending" ? 7 : 0));
      waiter.root.visible = gap < 40;

      if (s.grounded || py < this.groundY) this.groundY = py;
      if (run.phase === "ending" || run.phase === "over") mode = "end";
      else if (run.intro && run.countdown > 0) mode = "intro";
      else mode = "chase";
    }

    const patinete = run?.active("patinete") !== undefined;
    this.fovKick += ((patinete ? 6 : 0) - this.fovKick) * Math.min(1, dt * 3);
    const introT = run && run.intro ? Math.min(1, Math.max(0, (COUNTDOWN_TIME - run.countdown) / COUNTDOWN_TIME) * 1.15) : 1;
    this.cam.update(dt, {
      mode, x: px, y: py, z: -p, groundY: this.groundY, speed, intro: introT, fovKick: this.fovKick,
    });
    this.focus.set(px, py, -p);
    world.updateEnvironment(dt, this.cam.camera, this.focus);
    const lines = run && run.phase === "running" && !frozen ? (patinete ? 1 : Math.max(0, (speed - 22) / 12)) : 0;
    this.effects.update(frozen ? 0 : dt, lines, speed);
    this.renderer.render(world.scene, this.cam.camera);
  }

  // --- Debug ---------------------------------------------------------------------------------

  readonly debug: GameDebug = {
    setInvincible: (on) => {
      this.invincible = on;
      if (this.run) this.run.invincible = on;
    },
    setBot: (on) => {
      this.botOn = on;
      this.bot.reset();
    },
    warp: (zone) => {
      if (!isZoneId(zone)) return;
      if (this.run && (this.run.phase === "running" || this.run.phase === "countdown")) this.run.warp(zone);
      else this.startZone = zone;
    },
    setSpeed: (mps) => {
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
    if (params.get("autostart") === "1") setTimeout(() => this.start(), 60);
  }
}

export function createGame(canvas: HTMLCanvasElement, options: GameOptions): GameApi {
  const game = new Game(canvas, options);
  game.applyParams(new URLSearchParams(window.location.search));
  window.__game = { api: game, debug: game.debug };
  return game;
}

