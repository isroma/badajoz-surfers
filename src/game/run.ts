/**
 * One run: the fixed-step simulation of the runner, the track, pickups, power-ups, scoring and
 * the chaser. Pure (no three.js) so it can be tested and driven headless. Emits contract events
 * through `emit`, and visual cues (bursts, knocked obstacles, shakes) through `fx`.
 */
import {
  FLIGHT_HEIGHT,
  OBSTACLE_DEFS,
  POWERUPS,
  WORD,
  ZONES,
  type GameEvent,
  type ObstacleKind,
  type PickupKind,
  type PowerupKind,
  type RunSummary,
  type ZoneId,
} from "../contracts";
import { Chaser } from "./chaser";
import { BoxSet, topAt, type Aabb } from "./collision";
import {
  MEDIAN_GAP,
  bounceBack,
  copyPlayer,
  createEvents,
  createPlayer,
  prevRunnerBox,
  runnerBox,
  stepPlayer,
  type PlayerAction,
  type PlayerState,
} from "./player";
import { getCourse } from "./course";
import { laneMergeAhead, laneOpenAt, layoutAt, type LayoutFn } from "./lanes";
import { obstacleCentre, pickupD, type PickupSpawn } from "./spawns";
import { TrackGenerator } from "./track";
import { footprintOf } from "./traffic";
import { createRng, type Rng } from "./rng";
import {
  FLIGHT_DESCENT_TIME,
  FLIGHT_RISE_TIME,
  FLIGHT_SPEED_FACTOR,
  LAP_LENGTH,
  MAGNET_RADIUS,
  difficultyAt,
  reactionWindow,
  PATINETE_SPEED_FACTOR,
  SHIELD_INVULNERABLE_TIME,
  STUMBLE_SLOWDOWN,
  lapAt,
  speedAt,
  zoneAt,
  zoneStartDistance,
} from "./tuning";

export type RunFx =
  | { type: "burst"; kind: PickupKind | "crash" | "shield"; x: number; y: number; d: number }
  | { type: "knock"; id: number; dir: number }
  | { type: "shake"; amount: number }
  /** Everything ahead was regenerated (debug warp): the scene must drop its objects. */
  | { type: "reset" }
  /** An obstacle was cleared away to make room for a stork landing. */
  | { type: "remove"; id: number }
  /** A lane change towards a lane that does not exist: a small bump that way. */
  | { type: "bump"; dir: number }
  /** An oncoming vehicle in the runner's lane flashes its headlights (and honks). */
  | { type: "flash"; id: number };

export type RunPhase = "countdown" | "running" | "ending" | "over";

export interface RunConfig {
  seed: number;
  powerupDuration(kind: PowerupKind): number;
  baseMultiplier(): number;
  emit(event: GameEvent): void;
  fx(fx: RunFx): void;
  /** Open with the scripted tutorial. */
  tutorial?: boolean;
  /** Lane layout by distance (the engine's by default). */
  layout?: LayoutFn;
}

export interface ActivePowerup {
  kind: PowerupKind;
  remaining: number;
  duration: number;
}

interface NearTrack {
  lastX: number;
  inD: boolean;
  minClear: number;
  spoiled: boolean;
}

export const COUNTDOWN_TIME = 1.5;
export const ENDING_TIME = 1.25;
/** Same-direction traffic is on screen for a long time before you overtake it: generate far ahead. */
const GENERATE_AHEAD = 760;
/** Oncoming vehicles in your lane flash and honk this many seconds before they would reach you. */
export const HORN_TIME = 1.7;
/** Turns are announced this far ahead (m); lane endings this far before their taper starts. */
export const TURN_NOTICE = 120;
export const LANE_END_NOTICE = 120;

export const SCORE = {
  perMetre: 1,
  bellota: 10,
  nearMiss: 50,
  word: 1000,
  /** Per lap of the zone just completed. */
  zone: 250,
} as const;

/** Simulation time scale while a tutorial prompt waits for its action (classic slow-mo). */
export const TUTORIAL_SLOWMO = 0.6;

const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number): boolean => aMin < bMax && bMin < aMax;

export class Run {
  readonly player: PlayerState = createPlayer(0);
  readonly gen: TrackGenerator;
  readonly ignore = new Set<number>();
  readonly boxes: BoxSet;
  readonly taken = new Set<number>();
  /** Letters that went past uncollected (still drawn until they leave the screen). */
  readonly missed = new Set<number>();
  /** Oncoming vehicles that already flashed. */
  private readonly flashed = new Set<number>();
  /** Obstacle the run ended on (crash), for the end-of-run visuals. */
  crashedId = -1;
  /** Running speed when the run ended (vehicles brake from their speed relative to it). */
  endSpeed = 0;
  readonly layoutFn: LayoutFn;
  /** Bellotas being pulled by the magnet: current position. */
  readonly magnet = new Map<number, { x: number; y: number; d: number; px: number; py: number; pd: number }>();
  readonly chaser = new Chaser();
  readonly powerups: ActivePowerup[] = [];

  phase: RunPhase = "countdown";
  /** Seconds left in the current countdown (start or resume). */
  countdown = COUNTDOWN_TIME;
  /** True while the start countdown runs (vs. a resume countdown). */
  intro = true;
  time = 0;
  endTime = 0;
  cause: RunSummary["cause"] = "crash";
  crashedOn: ObstacleKind | undefined;

  score = 0;
  bellotas = 0;
  jumps = 0;
  rolls = 0;
  nearMisses = 0;
  roofMetres = 0;
  powerupsTaken = 0;
  wordsCompleted = 0;
  /**
   * Zone boundaries crossed since the start of lap 1's Puente Real, counting zones skipped by a
   * debug warp too, so `ZONES[zonesCompleted % ZONES.length]` is always the runner's current zone.
   */
  zonesCompleted = 0;
  lettersCollected = 0;
  /** Letters picked up in the whole run. */
  lettersTotal = 0;

  /** Simulation time scale (the engine runs fewer ticks per second below 1). */
  timeScale = 1;
  /** Tutorial progress. */
  tutorialStep = 0;
  tutorialActive = false;
  tutorialPerformed = false;
  tutorialOver: boolean;

  zoneSerial = 0;
  invincible = false;
  speedOverride: number | null = null;
  /** Remaining invulnerability after the patinete absorbed a hit. */
  invulnerable = 0;
  /** Speed factor after a stumble (recovers to 1). */
  slow = 1;
  /** Seconds left of the short "stumble" animation. */
  stumbleAnim = 0;
  /** Ticks counter for occasional work. */
  private ticks = 0;
  private lastCount = -1;

  /** Obstacles cleared for a stork landing (not drawn, not collided with). */
  readonly removed = new Set<number>();
  private flightStartY = 0;
  private landingCleared = false;
  /** Brief protection right after touching down from a flight. */
  private landingGrace = 0;
  private readonly flightRng: Rng;
  /** Ids for bellotas placed in the air (far from the generator's ids). */
  private airIds = 1_000_000_000;

  readonly actions: PlayerAction[] = [];
  private readonly ev = createEvents();
  private readonly near = new Map<number, NearTrack>();
  private readonly letterIndex = new Map<number, number>();
  private readonly a: Aabb = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, dMin: 0, dMax: 0 };
  private readonly b: Aabb = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, dMin: 0, dMax: 0 };

  constructor(private readonly cfg: RunConfig) {
    this.layoutFn = cfg.layout ?? layoutAt;
    this.gen = new TrackGenerator(cfg.seed, 0, {
      tutorial: cfg.tutorial === true,
      flightDuration: Math.max(1, cfg.powerupDuration("ciguena") || POWERUPS.ciguena.baseDuration),
      layout: this.layoutFn,
    });
    copyPlayer(this.player, createPlayer(0, undefined, this.layoutFn(0)));
    this.flightRng = createRng(cfg.seed ^ 0x5f3759df);
    this.tutorialOver = this.gen.tutorial.length === 0;
    this.gen.generateUntil(GENERATE_AHEAD);
    this.boxes = new BoxSet(this.gen.obstacles, this.ignore, 26, this.layoutFn);
    this.boxes.prepare(0, 0);
  }

  /** Emit the run-start events (zone banner, countdown 3). */
  /** Emit the run-start events (zone banner, countdown 3). `startZone`: debug start elsewhere. */
  begin(startZone?: ZoneId, startDistance?: number): void {
    if (startDistance !== undefined && startDistance > 0) this.jumpToDistance(startDistance);
    else if (startZone && startZone !== "puente-real") this.jumpTo(startZone);
    const span = zoneAt(this.player.p);
    this.zoneSerial = span.serial;
    this.zonesCompleted = span.serial;
    this.cfg.emit({ type: "zone", zone: span.zone, lap: span.lap, first: true });
    this.street = null;
    this.updateStreet(false);
    this.startCountdown(true);
  }

  /** Start (intro) or resume countdown, 3-2-1-0. */
  startCountdown(intro: boolean, resume = false): void {
    this.intro = intro;
    this.resuming = resume;
    this.countdown = COUNTDOWN_TIME;
    this.lastCount = 3;
    this.emitCount(3);
  }

  private resuming = false;

  private emitCount(value: number): void {
    if (this.resuming) this.cfg.emit({ type: "countdown", value, resume: true });
    else this.cfg.emit({ type: "countdown", value });
  }

  /** In the scripted tutorial stretch (mistakes are forgiven). */
  get inTutorial(): boolean {
    return !this.tutorialOver;
  }

  get distance(): number {
    return this.player.p;
  }

  get lap(): number {
    return lapAt(this.player.p);
  }

  get multiplier(): number {
    const base = this.cfg.baseMultiplier() + (this.lap - 1);
    return this.active("jamon") ? base * 2 : base;
  }

  active(kind: PowerupKind): ActivePowerup | undefined {
    for (const p of this.powerups) if (p.kind === kind) return p;
    return undefined;
  }

  /** Which letter of WORD this pickup shows (-1 = hide it). Assigned in order when first asked. */
  letterFor(id: number): number {
    const known = this.letterIndex.get(id);
    if (known !== undefined) return known;
    const index = this.lettersCollected + this.letterIndex.size;
    if (index >= WORD.length) return -1;
    this.letterIndex.set(id, index);
    return index;
  }

  push(action: PlayerAction): void {
    if (this.phase === "running" || this.phase === "countdown") this.actions.push(action);
  }

  /** Planned + power-up + stumble speed. */
  targetSpeed(): number {
    const base = this.speedOverride ?? speedAt(this.player.p);
    return base * (this.active("patinete") ? PATINETE_SPEED_FACTOR : 1) * (this.player.carried ? FLIGHT_SPEED_FACTOR : 1) * this.slow;
  }

  /** Carried by the stork. */
  get flying(): boolean {
    return this.player.carried;
  }

  /** Rise, cruise, and glide down over the last FLIGHT_DESCENT_TIME seconds. */
  private updateFlight(): void {
    const s = this.player;
    const f = this.active("ciguena");
    if (!f || !s.carried) return;
    const elapsed = f.duration - f.remaining;
    const smooth = (t: number): number => {
      const c = Math.min(1, Math.max(0, t));
      return c * c * (3 - 2 * c);
    };
    let y = FLIGHT_HEIGHT;
    if (elapsed < FLIGHT_RISE_TIME) y = this.flightStartY + (FLIGHT_HEIGHT - this.flightStartY) * smooth(elapsed / FLIGHT_RISE_TIME);
    if (f.remaining < FLIGHT_DESCENT_TIME) {
      y = Math.min(y, FLIGHT_HEIGHT * smooth(f.remaining / FLIGHT_DESCENT_TIME));
      if (!this.landingCleared) this.clearLanding();
    }
    s.flightY = y;
  }

  private startFlight(duration: number): void {
    const s = this.player;
    s.carried = true;
    s.flightY = s.y;
    s.roll = 0;
    this.flightStartY = s.y;
    this.landingCleared = false;
    this.chaser.lag = 8;
    // Dense bellota lines in the air, weaving between lanes, for the whole cruise.
    const v = this.targetSpeed();
    const from = s.p + v * FLIGHT_RISE_TIME + 2;
    const to = s.p + v * (duration - FLIGHT_DESCENT_TIME) - 2;
    const rng = this.flightRng;
    let lane = s.lane;
    let left = rng.int(7, 11);
    const list = this.gen.pickups;
    for (let d = from; d <= to; d += 3.3) {
      const layout = this.layoutFn(d);
      lane = Math.min(lane, layout.offsets.length - 1);
      // Not over a lane that is tapering away (it would move under the line of bellotas).
      const course = getCourse();
      if (course && this.layoutFn === layoutAt && (!laneOpenAt(course.track, lane, d) || laneMergeAhead(course.track, lane, d, 0) !== null)) continue;
      list.push({ id: this.airIds++, kind: "bellota", lane, x: this.boxes.laneX(lane, d), d, y: FLIGHT_HEIGHT + 0.9 });
      if (--left <= 0) {
        // Neighbouring lanes reachable in flight (not across a median: the bridge cables).
        const options = layout.offsets
          .map((_, i) => i)
          .filter((l) => Math.abs(l - lane) === 1 && Math.abs((layout.offsets[l] ?? 0) - (layout.offsets[lane] ?? 0)) <= MEDIAN_GAP);
        if (options.length === 0) options.push(lane);
        lane = rng.pick(options);
        left = rng.int(7, 12);
        d += 3.3; // A beat to steer.
      }
    }
    list.sort((a, b) => a.d - b.d);
  }

  private endFlight(): void {
    const s = this.player;
    if (!s.carried) return;
    s.carried = false;
    s.vy = 0;
    s.grounded = false;
    this.landingGrace = 0.4;
    this.chaser.lag = 0;
  }

  /**
   * Safety net for the landing: the generator reserves a clear stretch where a nominal flight
   * lands, but the real speed can differ (patinete, stumbles). Anything still in the way is cleared.
   */
  private clearLanding(): void {
    this.landingCleared = true;
    const s = this.player;
    const v = Math.max(1, s.speed);
    const from = s.p;
    const to = s.p + v * (FLIGHT_DESCENT_TIME + reactionWindow(difficultyAt(s.p)) + 0.8) + 4;
    for (const o of this.gen.obstacles) {
      if (o.d > to + 30) break;
      const [a, b] = footprintOf(o);
      if (b < from || a > to) continue;
      if (this.removed.has(o.id)) continue;
      this.removed.add(o.id);
      this.ignore.add(o.id);
      this.cfg.fx({ type: "remove", id: o.id });
    }
  }

  tick(dt: number): void {
    if (this.phase === "over") return;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const shown = Math.ceil(this.countdown / (COUNTDOWN_TIME / 3));
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.emitCount(0);
        if (this.intro) this.chaser.go();
        this.intro = false;
        this.phase = this.phase === "countdown" ? "running" : this.phase;
        this.actions.length = 0;
      } else if (shown !== this.lastCount && shown > 0) {
        this.lastCount = shown;
        this.emitCount(shown);
      }
      if (this.phase === "countdown") this.chaser.update(dt);
      return;
    }
    this.time += dt;
    this.ticks++;
    if (this.phase === "ending") {
      this.tickEnding(dt);
      return;
    }
    this.tickRunning(dt);
  }

  private tickEnding(dt: number): void {
    const s = this.player;
    this.endTime += dt;
    s.speed = this.cause === "crash" ? 0 : Math.max(0, s.speed - 30 * dt);
    stepPlayer(s, [], dt, this.boxes, this.ev);
    this.chaser.update(dt);
    if (this.endTime >= ENDING_TIME) {
      this.phase = "over";
      this.cfg.emit({ type: "gameover", summary: this.summary() });
    }
  }

  private tickRunning(dt: number): void {
    const s = this.player;
    const cfg = this.cfg;
    this.slow = Math.min(1, this.slow + dt * 0.35);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.stumbleAnim = Math.max(0, this.stumbleAnim - dt);
    s.speed = this.targetSpeed();
    s.superJump = this.active("zapatillas") !== undefined;
    this.landingGrace = Math.max(0, this.landingGrace - dt);
    this.updateFlight();

    stepPlayer(s, this.actions, dt, this.boxes, this.ev);
    this.actions.length = 0;
    const ev = this.ev;
    if (ev.jumped) {
      this.jumps++;
      cfg.emit({ type: "jump", super: ev.superJumped });
    }
    if (ev.landed) cfg.emit({ type: "land" });
    if (ev.rolled) {
      this.rolls++;
      cfg.emit({ type: "roll" });
    }
    if (ev.laneChanged) cfg.emit({ type: "lane" });
    if (ev.edgeBump) cfg.fx({ type: "bump", dir: ev.bumpDir });
    if (!this.tutorialOver) this.updateTutorial(dt);

    const dp = s.p - s.pp;
    if (s.grounded && s.supportId >= 0) this.roofMetres += dp;

    // Contacts.
    if (!this.invincible && !s.carried && this.landingGrace <= 0) {
      const contact = this.boxes.contact(prevRunnerBox(s, this.a), runnerBox(s, this.b));
      if (contact) {
        const spawn = contact.spawn;
        const track = this.near.get(spawn.id);
        if (track) track.spoiled = true;
        if (this.invulnerable > 0) this.ignore.add(spawn.id);
        else if (!this.tutorialOver) {
          // Tutorial: stumble straight through, no penalty.
          this.ignore.add(spawn.id);
          this.invulnerable = 0.8;
          this.stumbleAnim = 0.3;
          this.slow = Math.min(this.slow, 0.85);
          cfg.fx({ type: "shake", amount: 0.25 });
        } else if (contact.type === "front") {
          if (this.active("patinete")) this.shieldBreak(spawn.id, spawn.lane);
          else {
            this.crash(spawn.kind, spawn.id);
            return;
          }
        } else {
          if (contact.type === "side") bounceBack(s, this.layoutFn(s.p), this.boxes);
          else this.ignore.add(spawn.id);
          if (this.stumble()) return;
        }
      }
    }

    if (!s.carried) this.trackNearMisses();
    this.telegraph();
    this.collectPickups(dt);

    this.score += dp * SCORE.perMetre * this.multiplier;

    // Power-up timers.
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      if (!p) continue;
      p.remaining -= dt;
      if (p.remaining <= 0) {
        this.powerups.splice(i, 1);
        if (p.kind === "ciguena") this.endFlight();
        cfg.emit({ type: "powerup-end", kind: p.kind });
      }
    }

    // Street names (the real ones: a strong "I'm in Badajoz" cue).
    this.updateStreet(false);
    this.updateGuides();

    // Zones.
    const span = zoneAt(s.p);
    if (span.serial !== this.zoneSerial) {
      this.zoneSerial = span.serial;
      this.zonesCompleted = span.serial;
      this.score += SCORE.zone * lapAt(s.pp) * this.multiplier;
      cfg.emit({ type: "zone", zone: span.zone, lap: span.lap, first: false });
    }

    this.chaser.update(dt);

    this.gen.generateUntil(s.p + GENERATE_AHEAD);
    if (this.ticks % 120 === 0) this.gen.prune(s.p);
  }

  /** Scripted prompts: hint ~1.1 s before each obstacle, slow-mo until the action is done. */
  private updateTutorial(dt: number): void {
    const s = this.player;
    const ev = this.ev;
    const steps = this.gen.tutorial;
    const step = steps[this.tutorialStep];
    if (step) {
      if (!this.tutorialActive && step.front - (s.p + 0.2) <= speedAt(s.p) * 1.1) {
        this.tutorialActive = true;
        this.tutorialPerformed = false;
        this.cfg.emit({ type: "hint", action: step.action });
      }
      if (this.tutorialActive && !this.tutorialPerformed) {
        const done =
          step.action === "jump" ? ev.jumped || !s.grounded
          : step.action === "roll" ? s.roll > 0
          : s.lane !== step.lane;
        if (done) {
          this.tutorialPerformed = true;
          this.cfg.emit({ type: "hint", action: "done" });
        }
      }
      if (this.tutorialActive && s.p - 0.2 > step.end) {
        if (!this.tutorialPerformed) this.cfg.emit({ type: "hint", action: "done" });
        this.tutorialActive = false;
        this.tutorialPerformed = false;
        this.tutorialStep++;
      }
    } else if (s.p >= this.gen.tutorialEnd) {
      this.tutorialOver = true;
      this.cfg.emit({ type: "hint", action: "complete" });
    }
    const target = this.tutorialActive && !this.tutorialPerformed ? TUTORIAL_SLOWMO : 1;
    // Ease in quickly, out a little slower: smooth, not a hard cut.
    const rate = target < this.timeScale ? 5 : 2.5;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * rate);
    if (this.tutorialOver) this.timeScale = 1;
  }

  private stumble(): boolean {
    if (this.chaser.close) {
      this.caught();
      return true;
    }
    this.chaser.stumble();
    this.slow = STUMBLE_SLOWDOWN;
    this.stumbleAnim = 0.4;
    this.cfg.emit({ type: "stumble" });
    this.cfg.fx({ type: "shake", amount: 0.45 });
    return false;
  }

  private shieldBreak(id: number, lane: number): void {
    const i = this.powerups.findIndex((p) => p.kind === "patinete");
    if (i >= 0) this.powerups.splice(i, 1);
    this.cfg.emit({ type: "powerup-end", kind: "patinete" });
    this.cfg.emit({ type: "shield-break" });
    this.ignore.add(id);
    this.invulnerable = SHIELD_INVULNERABLE_TIME;
    const s = this.player;
    this.cfg.fx({ type: "knock", id, dir: lane === 0 ? (s.x >= 0 ? -1 : 1) : Math.sign(lane) });
    this.cfg.fx({ type: "burst", kind: "shield", x: s.x, y: s.y + 1, d: s.p + 0.5 });
    this.cfg.fx({ type: "shake", amount: 0.6 });
  }

  private crash(kind: ObstacleKind, id = -1): void {
    this.cause = "crash";
    this.crashedId = id;
    this.endSpeed = this.player.speed;
    this.crashedOn = kind;
    this.phase = "ending";
    this.endTime = 0;
    this.chaser.arrive();
    const s = this.player;
    s.p = s.pp; // Do not draw the runner inside the obstacle.
    s.speed = 0;
    this.cfg.emit({ type: "crash", obstacle: kind });
    this.cfg.fx({ type: "burst", kind: "crash", x: s.x, y: s.y + 1.1, d: s.p + 0.3 });
    this.cfg.fx({ type: "shake", amount: 1 });
  }

  private caught(): void {
    this.cause = "caught";
    this.endSpeed = this.player.speed;
    this.crashedOn = undefined;
    this.phase = "ending";
    this.endTime = 0;
    this.chaser.grab();
    this.cfg.emit({ type: "caught" });
    this.cfg.fx({ type: "shake", amount: 0.5 });
  }

  private trackNearMisses(): void {
    const s = this.player;
    const rb = this.b;
    for (let i = 0; i < this.boxes.count; i++) {
      const box = this.boxes.box(i);
      if (!box) continue;
      const id = box.spawn.id;
      let t = this.near.get(id);
      if (!t) {
        if (box.dMax < s.p - 1) continue;
        t = { lastX: -1e9, inD: false, minClear: Infinity, spoiled: false };
        this.near.set(id, t);
      }
      const ox = overlaps(rb.xMin, rb.xMax, box.xMin, box.xMax);
      const od = overlaps(rb.dMin, rb.dMax, box.dMin, box.dMax);
      if (s.supportId === id) t.spoiled = true;
      if (ox) t.lastX = this.time;
      if (od && !t.inD) {
        t.inD = true;
        if (!ox && this.time - t.lastX < 0.3 && !t.spoiled) {
          t.spoiled = true;
          this.nearMiss(box.spawn.kind);
        }
      }
      if (od && ox) {
        const top = topAt(box, s.p);
        const clear = rb.yMin >= top ? rb.yMin - top : box.yMin > 0 ? box.yMin - rb.yMax : Infinity;
        if (clear >= 0) t.minClear = Math.min(t.minClear, clear);
      }
      if (!od && t.inD) {
        if (!t.spoiled && t.minClear < 0.25) this.nearMiss(box.spawn.kind);
        t.spoiled = true;
        t.inD = false;
      }
    }
    if (this.near.size > 96) {
      for (const [id] of this.near) {
        this.near.delete(id);
        if (this.near.size <= 48) break;
      }
    }
  }

  /** Real street name at the runner (null on unnamed links and roundabouts). */
  street: string | null = null;
  /** The turn announced last (unbounded start and end), and the lane taper already announced. */
  private announcedTurn: { s: number; end: number } | null = null;
  private announcedEnd = -Infinity;
  /**
   * Metres until the runner's lane starts tapering into its merge target (0 while it tapers,
   * null when it continues), for the HUD.
   */
  laneEnding: number | null = null;

  /**
   * Guidance for the shell: a "turn" event for the next bend or roundabout only (TURN_NOTICE m
   * ahead, or as soon as the previous announced one is finished), and a "lane-ends" event
   * LANE_END_NOTICE m before the runner's lane starts tapering (with the side of its target).
   */
  private updateGuides(): void {
    const course = getCourse();
    if (!course) return;
    const s = this.player;
    const L = course.lapLength;
    const shown = this.announcedTurn;
    if (!shown || s.p >= shown.end) {
      // The nearest turn not finished yet.
      const base = Math.floor(s.p / L) * L;
      let next: { s: number; end: number; t: (typeof course.turns)[number] } | null = null;
      for (const lapBase of [base - L, base, base + L]) {
        for (const t of course.turns) {
          const at = lapBase + t.s;
          const end = lapBase + Math.max(t.endS, t.s);
          if (end <= s.p || (shown && at <= shown.s)) continue;
          if (!next || at < next.s) next = { s: at, end, t };
        }
      }
      if (next && next.s - s.p <= TURN_NOTICE) {
        this.announcedTurn = { s: next.s, end: next.end };
        const t = next.t;
        this.cfg.emit({
          type: "turn", direction: t.direction, roundabout: t.roundabout, street: t.street,
          distance: Math.max(0, Math.round(next.s - s.p)), endDistance: Math.round(next.end - s.p),
        });
      }
    }
    const layout = this.layoutFn(s.p);
    if (s.lane < 0 || s.lane >= layout.offsets.length) {
      this.laneEnding = null;
      return;
    }
    const merge = laneMergeAhead(course.track, s.lane, s.p, 400);
    this.laneEnding = merge ? Math.max(0, merge.s0 - s.p) : null;
    if (merge && merge.s0 - s.p <= LANE_END_NOTICE && Math.abs(merge.s0 - this.announcedEnd) > 5) {
      this.announcedEnd = merge.s0;
      this.cfg.emit({ type: "lane-ends", side: merge.side < 0 ? "left" : "right" });
    }
  }

  /** Emit a "street" event whenever the runner enters a street with a new real name. */
  updateStreet(silent: boolean): void {
    const name = getCourse()?.streetNameAt(this.player.p) ?? null;
    if (name === null || name === this.street) return;
    this.street = name;
    if (!silent) this.cfg.emit({ type: "street", name });
  }

  /**
   * Oncoming vehicles about to reach the runner's lane flash their lights and honk: the closing
   * speed is high, so they are telegraphed HORN_TIME seconds ahead.
   */
  private telegraph(): void {
    const s = this.player;
    const v = Math.max(1, s.speed);
    const list = this.gen.obstacles;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      if (o.d < s.p) continue;
      if (o.d > s.p + v * (HORN_TIME + 0.5) + 10) break;
      if (o.k <= 0 || this.flashed.has(o.id) || this.ignore.has(o.id)) continue;
      const def = OBSTACLE_DEFS[o.kind];
      // Only motor vehicles honk and flash, and only in a lane with traffic (never a pedestrian,
      // never in a pedestrian street or on a pavement).
      if (!isMotor(o.kind) || (this.layoutFn(s.p).flow[s.lane] ?? 0) === 0) continue;
      if (Math.abs(o.x - this.boxes.laneX(s.lane, s.p)) > def.width / 2 + 0.3) continue;
      const [front] = footprintOf(o);
      if ((front - s.p) / v > HORN_TIME) continue;
      this.flashed.add(o.id);
      const c = obstacleCentre(o, s.p);
      this.cfg.fx({ type: "flash", id: o.id });
      this.cfg.emit({ type: "horn", obstacle: o.kind, ahead: c - s.p });
    }
    if (this.flashed.size > 64) {
      for (const id of this.flashed) {
        this.flashed.delete(id);
        if (this.flashed.size <= 32) break;
      }
    }
  }

  private nearMiss(_kind: ObstacleKind): void {
    this.nearMisses++;
    this.score += SCORE.nearMiss * this.multiplier;
    this.cfg.emit({ type: "near-miss" });
  }

  private collectPickups(dt: number): void {
    const s = this.player;
    const list = this.gen.pickups;
    const magnet = this.active("iman") !== undefined;
    const reach = magnet ? MAGNET_RADIUS : 1.2;
    // Binary search for the first pickup with d >= p - reach - 2.
    let lo = 0;
    let hi = list.length;
    const from = s.pp - reach - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const p = list[mid];
      if (p && p.d < from) lo = mid + 1;
      else hi = mid;
    }
    const feet = s.y;
    const head = feet + (s.roll > 0 ? 1.3 : 2.3);
    for (let i = lo; i < list.length; i++) {
      const pk = list[i];
      if (!pk) break;
      if (pk.d > s.p + reach + 1) break;
      if (this.taken.has(pk.id)) continue;
      let x = pk.x;
      let y = pk.y;
      let d = pickupD(pk, s.p);
      if (pk.kind === "letra" && d < s.p - 1.5) {
        this.missLetter(pk.id);
        continue;
      }
      if (magnet && pk.kind === "bellota") {
        const pulled = this.magnet.get(pk.id);
        if (pulled) {
          x = pulled.x;
          y = pulled.y;
          d = pulled.d;
        }
        const dx = s.x - x;
        const dy = feet + 1 - y;
        const dd = s.p - d;
        const dist = Math.hypot(dx, dy, dd);
        if (dist < MAGNET_RADIUS) {
          const step = Math.min(dist, (18 + s.speed) * dt);
          const f = dist > 1e-6 ? step / dist : 0;
          const px = x;
          const py = y;
          const pd = d;
          x += dx * f;
          y += dy * f;
          d += dd * f;
          this.magnet.set(pk.id, { x, y, d, px, py, pd });
        }
      }
      if (pk.kind === "letra" && this.letterFor(pk.id) < 0) continue;
      if (Math.abs(x - s.x) > 1.05) continue;
      if (d < s.pp - 0.8 || d > s.p + 0.8) continue;
      if (y < feet - 0.4 || y > head) continue;
      this.take(pk);
    }
  }

  private missLetter(id: number): void {
    const index = this.letterIndex.get(id);
    this.taken.add(id);
    this.missed.add(id);
    if (index === undefined) return;
    this.letterIndex.delete(id);
    for (const [other, i] of this.letterIndex) if (i > index) this.letterIndex.set(other, i - 1);
  }

  private take(pk: PickupSpawn): void {
    const s = this.player;
    const cfg = this.cfg;
    this.taken.add(pk.id);
    this.magnet.delete(pk.id);
    const mult = this.multiplier;
    cfg.fx({ type: "burst", kind: pk.kind, x: s.x, y: s.y + 1, d: s.p + 0.4 });
    switch (pk.kind) {
      case "bellota":
        this.bellotas++;
        this.score += SCORE.bellota * mult;
        cfg.emit({ type: "pickup", kind: "bellota" });
        break;
      case "letra": {
        // Indices are absolute (collected + pending): taking one in order leaves the others right.
        const index = this.letterFor(pk.id);
        this.letterIndex.delete(pk.id);
        if (index < 0) break;
        this.lettersCollected++;
        this.lettersTotal++;
        cfg.emit({ type: "pickup", kind: "letra", letterIndex: index });
        if (this.lettersCollected >= WORD.length) {
          this.lettersCollected = 0;
          this.letterIndex.clear();
          this.wordsCompleted++;
          this.score += SCORE.word * mult;
          cfg.emit({ type: "word-complete" });
        }
        break;
      }
      default: {
        const kind = pk.kind;
        const duration = Math.max(1, cfg.powerupDuration(kind) || POWERUPS[kind].baseDuration);
        const existing = this.active(kind);
        if (existing) {
          existing.remaining = duration;
          existing.duration = duration;
        } else this.powerups.push({ kind, remaining: duration, duration });
        this.powerupsTaken++;
        if (kind === "ciguena" && !existing) this.startFlight(duration);
        cfg.emit({ type: "pickup", kind });
        cfg.emit({ type: "powerup-start", kind, duration });
        break;
      }
    }
  }

  /** Debug: jump to the start of a zone (the next one with this id). */
  warp(zone: ZoneId): void {
    if (!this.jumpTo(zone)) return;
    const span = zoneAt(this.player.p);
    this.cfg.fx({ type: "reset" });
    this.cfg.emit({ type: "zone", zone: span.zone, lap: span.lap, first: false });
  }

  /** Debug: jump to a distance (metres; laps beyond the first are later laps). */
  warpTo(distance: number): void {
    if (!(distance > this.player.p + 1)) distance += Math.ceil((this.player.p + 1 - distance) / LAP_LENGTH) * LAP_LENGTH;
    this.jumpToDistance(distance);
    const span = zoneAt(this.player.p);
    this.cfg.fx({ type: "reset" });
    this.cfg.emit({ type: "zone", zone: span.zone, lap: span.lap, first: false });
  }

  /** Move to the start of the next zone with this id (no events). */
  private jumpTo(zone: ZoneId): boolean {
    const index = ZONES.findIndex((z) => z.id === zone);
    if (index < 0) return false;
    let start = zoneStartDistance(index, this.lap);
    if (start <= this.player.p + 1) start += LAP_LENGTH;
    this.jumpToDistance(start);
    return true;
  }

  /** Move to a distance and regenerate everything ahead (no events). */
  private jumpToDistance(start: number): void {
    const s = this.player;
    const ciguena = this.powerups.findIndex((p) => p.kind === "ciguena");
    if (ciguena >= 0) {
      this.powerups.splice(ciguena, 1);
      this.endFlight();
      this.cfg.emit({ type: "powerup-end", kind: "ciguena" });
    }
    this.gen.restartAt(start);
    this.ignore.clear();
    this.taken.clear();
    this.missed.clear();
    this.flashed.clear();
    this.magnet.clear();
    this.near.clear();
    this.letterIndex.clear();
    s.p = s.pp = start + 1;
    s.y = s.py = 0;
    s.vy = 0;
    s.grounded = true;
    s.supportId = -1;
    this.gen.generateUntil(s.p + GENERATE_AHEAD);
    this.boxes.prepare(s.p, s.p);
    this.chaser.far();
    // Land on a lane of the street here.
    copyPlayer(s, { ...createPlayer(s.p, undefined, this.layoutFn(s.p)), speed: s.speed });
    this.boxes.prepare(s.p, s.p);
    const span = zoneAt(s.p);
    this.zoneSerial = span.serial;
    this.zonesCompleted = span.serial;
    this.street = null;
  }

  summary(): RunSummary {
    const summary: RunSummary = {
      score: Math.round(this.score),
      distance: Math.round(this.player.p),
      bellotas: this.bellotas,
      zonesCompleted: this.zonesCompleted,
      lap: this.lap,
      cause: this.cause,
      jumps: this.jumps,
      rolls: this.rolls,
      nearMisses: this.nearMisses,
      roofMetres: Math.round(this.roofMetres),
      powerups: this.powerupsTaken,
      wordsCompleted: this.wordsCompleted,
      letters: this.lettersTotal,
    };
    if (this.crashedOn) summary.obstacle = this.crashedOn;
    return summary;
  }
}

/** Motor vehicles (they honk and flash their lights): every vehicle kind but people. */
export function isMotor(kind: ObstacleKind): boolean {
  return OBSTACLE_DEFS[kind].vehicle || kind === "camion-rampa";
}

/** Is a kind a vehicle (for visuals)? */
export function isVehicle(kind: ObstacleKind): boolean {
  return OBSTACLE_DEFS[kind].vehicle;
}
