/**
 * Chase camera with menu orbit, intro swing, end-of-run framing, FOV with speed and shake.
 *
 * Feel (all frame-rate independent):
 * - lateral follow is a critically damped spring (no lerp jitter, no overshoot), looking a little
 *   ahead towards the lane being entered;
 * - height follows the surface the runner stands on through a spring (roofs and ramps never pop),
 *   rises only part of a jump so the jump reads, dips a little on rolls and hard landings;
 * - FOV eases with speed, plus a short punch on near misses;
 * - a very small running bob;
 * - the camera never sits inside geometry: when the desired spot is inside a vehicle it is moved
 *   up over it or forward along the boom (the world is never hidden to make room).
 */
import * as THREE from "three";
import type { TrackSpace } from "./space";
import { YAW_ACCEL_HARD, YAW_ACCEL_MAX, YAW_AHEAD, YAW_BEHIND, YAW_RATE_HARD, YAW_RATE_MAX, headingTarget } from "./turning";

export { YAW_ACCEL_HARD, YAW_ACCEL_MAX, YAW_AHEAD, YAW_BEHIND, YAW_RATE_HARD, YAW_RATE_MAX, headingTarget };

export type CameraMode = "menu" | "intro" | "chase" | "end";

/** A solid box in world space (for keeping the camera out of geometry). */
export interface SolidBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export interface CameraInput {
  mode: CameraMode;
  /** Runner world position (feet). */
  x: number;
  y: number;
  z: number;
  /** Lateral position of the lane the runner is heading for. */
  laneX: number;
  /** Height of what the runner stands on (road 0, roof...). */
  groundY: number;
  speed: number;
  /** 0..1 progress of the intro swing. */
  intro: number;
  /** Extra FOV (patinete). */
  fovKick: number;
  /** End shot: which side to orbit to (+1 right, -1 left) and the waiter's z. */
  endSide: number;
  waiterZ: number;
  /** 0..1 stork flight blend: pull back and up, look down at the street. */
  flight: number;
  /** Camera roll in radians (banking on lane changes in flight). */
  bank: number;
  /** Rolling (the camera ducks a little). */
  rolling?: boolean;
  /** Running on a surface (drives the bob). */
  grounded?: boolean;
  /** Solids near the camera (track space). */
  solids?: readonly SolidBox[];
  /** Lateral nudge of the look target towards the inside of the bend ahead (m, + right). */
  lookBias?: number;
  /** Street width between facades at the runner, when known: the camera stays inside it. */
  clearance?: number | null;
  /**
   * The building walls around the camera and the runner (track lateral, left ≤ 0 ≤ right; see
   * course.ts `wallsBetween`) and whether the runner is in or near a passage under a building.
   */
  street?: { left: number; right: number; passage: boolean } | null;
}

/** The lens stays at least this far from a building wall. */
export const WALL_GAP = 0.9;
/** Boom in the narrowest streets and passages: shorter, lower, looking a little higher. */
export const NARROW_BACK = 4.2;
export const NARROW_UP = 2.6;
const NARROW_LOOK_UP = 0.5;

/** 0 (open street) .. 1 (narrow street or passage): from a street 9 m wide down to 6 m. Pure. */
export function streetNarrowness(width: number, passage: boolean): number {
  if (passage) return 1;
  return smooth((9 - width) / 3);
}

/**
 * The camera's lateral position kept ≥ WALL_GAP from both walls; in streets under ~6 m wide it
 * is drawn to the middle of the street (fully below 6 m, from 8 m), and when even that is not
 * possible it sits in the middle. Pure.
 */
export function clampToStreet(x: number, left: number, right: number): number {
  const width = right - left;
  const mid = (left + right) / 2;
  const centre = smooth((8 - width) / 2);
  const want = x + (mid - x) * centre;
  const lo = left + WALL_GAP;
  const hi = right - WALL_GAP;
  if (lo > hi) return mid;
  return Math.max(lo, Math.min(hi, want));
}

/** Boom length behind the runner, height and look-at lift for a narrowness. Pure. */
export function boomFor(narrow: number): { back: number; up: number; lookUp: number } {
  const n = Math.min(1, Math.max(0, narrow));
  return { back: BACK + (NARROW_BACK - BACK) * n, up: UP + (NARROW_UP - UP) * n, lookUp: NARROW_LOOK_UP * n };
}

const BACK = 6.5;
const UP = 3.2;
const LOOK_AHEAD = 12;
const BASE_FOV = 62;
/** Yaw spring rate (rad/s): smooths corners without lagging off the road. */
const YAW_OMEGA = 9;
/** Spring rates (rad/s): lateral, height up, height down. */
const OMEGA_X = 11;
const OMEGA_Y_UP = 7;
const OMEGA_Y_DOWN = 5.5;
/** Share of a jump the camera follows (it trails, so the jump reads on screen). */
export const JUMP_FOLLOW = 0.3;
/** How far the camera ducks during a roll (m). */
export const ROLL_DIP = 0.32;
/** Clearance kept between the lens and solids (m). */
const LENS_CLEARANCE = 0.35;

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

export interface Spring {
  x: number;
  v: number;
}

/**
 * Critically damped spring step (implicit, stable for any dt). Pure: same result whether a
 * second is split into 60, 120 or 144 steps (up to integration error).
 */
export function springStep(s: Spring, target: number, omega: number, dt: number): void {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const x = (f * s.x + dt * s.v + hhoo * target) * detInv;
  const v = (s.v + hoo * (target - s.x)) * detInv;
  s.x = x;
  s.v = v;
}

/**
 * Keep a camera position out of solid boxes: if `pos` is inside one (with clearance), lift it
 * over the box when that is a small move, else slide it forward along the boom towards `pivot`
 * until it is out. Returns how far it moved. Pure (mutates `pos`).
 */
export function clearOfSolids(pos: { x: number; y: number; z: number }, pivot: { x: number; y: number; z: number }, solids: readonly SolidBox[]): number {
  let moved = 0;
  for (let pass = 0; pass < 3; pass++) {
    let hit: SolidBox | null = null;
    for (const b of solids) {
      if (pos.x > b.xMin - LENS_CLEARANCE && pos.x < b.xMax + LENS_CLEARANCE &&
        pos.y > b.yMin - LENS_CLEARANCE && pos.y < b.yMax + LENS_CLEARANCE &&
        pos.z > b.zMin - LENS_CLEARANCE && pos.z < b.zMax + LENS_CLEARANCE) {
        hit = b;
        break;
      }
    }
    if (!hit) break;
    const lift = hit.yMax + LENS_CLEARANCE - pos.y;
    if (lift < 1.6) {
      pos.y += lift;
      moved += lift;
      continue;
    }
    // Forward along the boom: find where the segment pivot→pos enters the expanded box.
    const dx = pos.x - pivot.x;
    const dy = pos.y - pivot.y;
    const dz = pos.z - pivot.z;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const t = (lo + hi) / 2;
      const px = pivot.x + dx * t;
      const py = pivot.y + dy * t;
      const pz = pivot.z + dz * t;
      const inside = px > hit.xMin - LENS_CLEARANCE && px < hit.xMax + LENS_CLEARANCE && py > hit.yMin - LENS_CLEARANCE &&
        py < hit.yMax + LENS_CLEARANCE && pz > hit.zMin - LENS_CLEARANCE && pz < hit.zMax + LENS_CLEARANCE;
      if (inside) hi = t;
      else lo = t;
    }
    const nx = pivot.x + dx * lo;
    const ny = pivot.y + dy * lo;
    const nz = pivot.z + dz * lo;
    moved += Math.hypot(nx - pos.x, ny - pos.y, nz - pos.z);
    pos.x = nx;
    pos.y = ny;
    pos.z = nz;
  }
  return moved;
}

// --- Smooth turning ------------------------------------------------------------------------

/** Stiffness of the yaw follower (rad/s): the caps above bound it. */
const YAW_FOLLOW = 4.5;
/** Roll into the turn at the yaw rate cap (rad, ≈ 2.5°). */
export const TURN_BANK = 0.045;

/** The runner stays within this share of the half-screen (from the centre) through bends. */
export const SCREEN_BAND = 0.4;

/**
 * The chase camera's yaw target at runner distance p: the smoothed heading (`headingTarget`),
 * kept within SCREEN_BAND of the half-screen of the bearing from the lens (`back` m behind, on
 * the curve) to the runner, for a horizontal half-FOV whose tangent is `tanHalf`. Pure.
 */
export function chaseYawTarget(
  heading: (s: number) => number,
  point: (s: number, lateral: number, y: number, out: { x: number; y: number; z: number }) => unknown,
  p: number,
  back: number,
  tanHalf: number,
): number {
  const want = headingTarget(heading, p);
  const b = want + wrapAngle(runnerBearing(point, p, back) - want);
  const max = Math.atan(SCREEN_BAND * tanHalf);
  return Math.max(b - max, Math.min(b + max, want));
}

/** Bearing (world yaw) from the lens `back` m behind on the curve to the runner at p. Pure. */
export function runnerBearing(point: (s: number, lateral: number, y: number, out: { x: number; y: number; z: number }) => unknown, p: number, back: number): number {
  point(p - back, 0, 3, lens);
  point(p, 0, 1, body);
  return Math.atan2(body.x - lens.x, body.z - lens.z);
}

/** Is the runner (at `bearing`) beyond `share` of the half-screen for a camera at `yaw`? Pure. */
export function offBand(yaw: number, bearing: number, tanHalf: number, share = SCREEN_BAND * 0.8): boolean {
  return Math.abs(Math.tan(wrapAngle(bearing - yaw))) > share * tanHalf;
}
const lens = { x: 0, y: 0, z: 0 };
const body = { x: 0, y: 0, z: 0 };

/**
 * The camera's yaw: a critically damped follower of `headingTarget` whose rate and acceleration
 * are capped (YAW_RATE_MAX, YAW_ACCEL_MAX): the world never swings round sharply; the runner
 * drifts a little towards the inside of a tight bend instead. Pure (no three.js).
 */
export class YawFollower {
  yaw = 0;
  rate = 0;
  accel = 0;

  reset(yaw: number): void {
    this.yaw = yaw;
    this.rate = 0;
    this.accel = 0;
  }

  /** `urgent`: the runner is near the edge of the screen band (the hard caps apply). */
  step(target: number, dt: number, urgent = false): number {
    if (dt <= 0) return this.yaw;
    const w = urgent ? YAW_FOLLOW * 1.6 : YAW_FOLLOW;
    const want = w * w * (target - this.yaw) - 2 * w * this.rate;
    const amax = urgent ? YAW_ACCEL_HARD : YAW_ACCEL_MAX;
    const rmax = urgent ? YAW_RATE_HARD : YAW_RATE_MAX;
    const a = Math.max(-amax, Math.min(amax, want));
    // Out of an urgent swing the rate comes back under the soft cap at the soft acceleration.
    let rate = this.rate + a * dt;
    if (Math.abs(rate) > rmax) rate = Math.sign(rate) * Math.max(rmax, Math.abs(this.rate) - YAW_ACCEL_MAX * dt);
    this.accel = (rate - this.rate) / dt;
    this.rate = rate;
    this.yaw += rate * dt;
    return this.yaw;
  }
}

/** Angle difference wrapped to (-π, π]. */
const wrapAngle = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private trauma = 0;
  private time = 0;
  private readonly sx: Spring = { x: 0, v: 0 };
  private readonly sy: Spring = { x: 0, v: 0 };
  private readonly sLook: Spring = { x: 0, v: 0 };
  private readonly sDip: Spring = { x: 0, v: 0 };
  /** Narrowness of the street (0..1, see streetNarrowness), through a spring. */
  private readonly sNarrow: Spring = { x: 0, v: 0 };
  private fov = BASE_FOV;
  private punch = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private endAngle = 0;
  /** Smoothed extra offset pushing the lens out of geometry. */
  private readonly push = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();
  private lastMode: CameraMode = "menu";

  /** The pose in track space (x = lateral, y = height above the road, z = -s), for the fades. */
  readonly local = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private readonly worldLook = new THREE.Vector3();
  private yaw: Spring = { x: 0, v: 0 };
  private yawReady = false;
  /** Chase mode: the yaw follows the track's heading profile (see YawFollower). */
  private readonly follower = new YawFollower();
  private runnerS = 0;
  private readonly headingOf = (s: number): number => this.space?.frame(s).heading ?? 0;
  private readonly pointV = new THREE.Vector3();
  private readonly pointOf = (s: number, lateral: number, y: number, out: { x: number; y: number; z: number }): void => {
    const v = this.space ? this.space.point(s, lateral, y, this.pointV) : this.pointV.set(lateral, y, -s);
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
  };

  constructor(
    aspect: number,
    private readonly space: TrackSpace | null = null,
  ) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 2600);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A short FOV punch (near miss): a feel of time dilating without slowing anything. */
  fovPunch(degrees: number): void {
    this.punch = Math.min(10, this.punch + degrees);
  }

  /** A downward kick of the height spring (hard landing). */
  dip(amount: number): void {
    this.sDip.v -= amount;
  }

  /** Snap the smoothing (after a warp or a new run). */
  snap(): void {
    this.lastMode = "menu";
    this.yawReady = false;
  }

  private chasePose(i: CameraInput, pos: THREE.Vector3, look: THREE.Vector3): void {
    const f = i.flight;
    const camX = this.sx.x;
    const camY = this.sy.x + this.sDip.x;
    const lookX = this.sLook.x;
    const boom = boomFor(this.sNarrow.x);
    const BACK = boom.back;
    const UP = boom.up;
    if (f > 0) {
      // Flying: the postcard. Higher and further back over the runner's own carriageway, looking
      // down the route so the bridges, the river and the Alcazaba open up below.
      const flyY = i.y * 0.85;
      pos.set(camX * (1 - 0.4 * f), camY + (flyY - camY) * f + UP + 5.5 * f, i.z + BACK + 7 * f);
      look.set(lookX, camY + (flyY - camY) * f + 1.0 - 4.5 * f, i.z - LOOK_AHEAD - 16 * f);
      return;
    }
    pos.set(camX, camY + UP, i.z + BACK);
    look.set(lookX, camY + 1.0 + boom.lookUp, i.z - LOOK_AHEAD);
  }

  /**
   * Map the track-space pose to the world through the route: the lens sits behind the runner
   * along the (curved, sloping) street and looks at a point ahead along it. The yaw goes through
   * a critically damped spring so roundabouts and 10 m corners swing smoothly; the horizon stays
   * level (lookAt with Y up), the pitch follows the slope.
   */
  private toWorld(pos: THREE.Vector3, look: THREE.Vector3, mode: CameraMode, dt: number): void {
    const cam = this.camera;
    if (!this.space) {
      cam.position.copy(pos);
      cam.lookAt(look);
      return;
    }
    const wp = this.space.point(-pos.z, pos.x, pos.y, this.world);
    const wl = this.space.point(-look.z, look.x, look.y, this.worldLook);
    const dx = wl.x - wp.x;
    const dz = wl.z - wp.z;
    const horiz = Math.hypot(dx, dz);
    const target = Math.atan2(dx, dz);
    let bank = 0;
    if (!this.yawReady || mode === "menu" || mode === "intro" || dt <= 0) {
      this.yaw.x = target;
      this.yaw.v = 0;
      this.yawReady = true;
      this.follower.reset(target);
    } else if (mode === "chase") {
      // The street's heading, smoothed ahead (the same angle family as `target`: unwrapped).
      const tanHalf = Math.tan(((this.camera.fov * Math.PI) / 180) / 2) * this.camera.aspect;
      const back = this.runnerS + pos.z;
      const want = chaseYawTarget(this.headingOf, this.pointOf, this.runnerS, back, tanHalf);
      const y = this.follower.yaw;
      const urgent = offBand(y, runnerBearing(this.pointOf, this.runnerS, back), tanHalf);
      this.follower.step(y + wrapAngle(want - y), dt, urgent);
      this.yaw.x = this.follower.yaw;
      this.yaw.v = this.follower.rate;
      bank = TURN_BANK * Math.max(-1, Math.min(1, this.follower.rate / YAW_RATE_MAX));
    } else {
      // Spring towards the nearest equivalent angle (unwrapped).
      springStep(this.yaw, this.yaw.x + wrapAngle(target - this.yaw.x), YAW_OMEGA, dt);
      this.follower.reset(this.yaw.x);
      this.follower.rate = this.yaw.v;
    }
    cam.position.copy(wp);
    wl.set(wp.x + Math.sin(this.yaw.x) * horiz, wl.y, wp.z + Math.cos(this.yaw.x) * horiz);
    cam.lookAt(wl);
    if (bank !== 0) cam.rotateZ(bank);
  }

  update(dt: number, i: CameraInput): void {
    this.time += dt;
    this.runnerS = -i.z;
    const modeChanged = i.mode !== this.lastMode;
    // Follow ~60% of the lateral offset, leaning towards the lane being entered; rise (a bit
    // less than) the surface height on roofs, and only part of a jump.
    // Stay within ~2 m of the runner on wide avenues (5 lanes, 30 m kerb to kerb), drifting a
    // little towards the street's centre so both sides stay in view.
    const pull = Math.max(-2, Math.min(2, i.x * 0.4));
    const street = i.street ?? null;
    const narrowTarget = street ? streetNarrowness(street.right - street.left, street.passage) : 0;
    let targetX = i.x - pull + (i.laneX - i.x) * 0.12;
    if (street) targetX = clampToStreet(targetX, street.left, street.right);
    const lookTarget = i.x - pull * 0.9 + (i.laneX - i.x) * 0.3 + (i.lookBias ?? 0);
    const air = Math.max(0, i.y - i.groundY);
    const targetY = Math.max(0, i.groundY) * 0.8 + (i.flight > 0 ? 0 : air * JUMP_FOLLOW);
    if (modeChanged && (i.mode === "intro" || i.mode === "menu")) {
      this.sx.x = targetX;
      this.sx.v = 0;
      this.sy.x = targetY;
      this.sy.v = 0;
      this.sLook.x = lookTarget;
      this.sLook.v = 0;
      this.sNarrow.x = narrowTarget;
      this.sNarrow.v = 0;
      this.push.set(0, 0, 0);
    }
    springStep(this.sNarrow, narrowTarget, 4, dt);
    springStep(this.sx, targetX, OMEGA_X, dt);
    springStep(this.sLook, lookTarget, OMEGA_X * 1.2, dt);
    springStep(this.sy, targetY, targetY > this.sy.x ? OMEGA_Y_UP : OMEGA_Y_DOWN, dt);
    springStep(this.sDip, i.rolling ? -ROLL_DIP : 0, 10, dt);

    this.punch = Math.max(0, this.punch - dt * 24);
    let targetFov = BASE_FOV + 10 * smooth((i.speed - 11) / 20) + i.fovKick + 4 * i.flight;
    const pos = this.pos;
    const look = this.look;
    switch (i.mode) {
      case "menu": {
        // Hero shot on the bridge deck: behind-left of the runner, looking up the road at the
        // pylon and its cable fans; the runner sits right of centre (the menu UI is on the left).
        const sway = Math.sin(this.time * 0.16);
        const bob = Math.sin(this.time * 0.23);
        pos.set(i.x - 1.6 + sway * 0.5, 1.45 + bob * 0.18, i.z + 7 + Math.sin(this.time * 0.11) * 0.5);
        look.set(i.x - 3.4 + sway * 0.7, 5.2 + bob * 0.3, i.z - 40);
        targetFov = 58;
        break;
      }
      case "intro": {
        // From the front/side (waiter visible behind) swinging round the runner to the chase view.
        const t = smooth(i.intro);
        this.chasePose(i, this.tmpA, this.tmpB);
        // The bridge head: from behind and to the left, wide enough to take in the waiter storming
        // out of the bar behind on the right, the runner, and the pylon ahead; then it swings in
        // to the chase view. Closer in a narrow street, on the side with more room.
        const roomy = street ? (street.right - i.x >= i.x - street.left ? -1 : 1) : -1;
        const shrink = 1 - 0.35 * this.sNarrow.x;
        const sx = 3.2 * roomy * shrink;
        const sz = 10.5 * shrink;
        const sy = 2.4;
        const cdx = this.tmpA.x - i.x;
        const cdz = this.tmpA.z - i.z;
        const aS = Math.atan2(sx, sz);
        const aC = Math.atan2(cdx, cdz);
        const rS = Math.hypot(sx, sz);
        const rC = Math.hypot(cdx, cdz);
        const a = aS + (aC - aS) * t;
        const r = rS + (rC - rS) * t;
        // Stay over the road: nothing solid stands there below 4 m (lamp posts and trees line the kerbs).
        const ax = street ? i.x + Math.sin(a) * r : Math.max(-3.6, Math.min(3.6, i.x + Math.sin(a) * r));
        pos.set(ax, sy + (this.tmpA.y - sy) * t, i.z + Math.cos(a) * r);
        look.set(i.x + 0.5, 2.2, i.z - 24).lerp(this.tmpB, t);
        targetFov = 55 + (targetFov - 55) * t;
        break;
      }
      case "chase": {
        this.chasePose(i, pos, look);
        // A very small running bob (fades in with speed, out in the air).
        this.bobAmp = damp(this.bobAmp, i.grounded && i.flight < 0.05 ? Math.min(1, i.speed / 20) : 0, 8, dt);
        this.bobPhase += dt * (i.speed / 2.4) * Math.PI;
        pos.y += Math.sin(this.bobPhase * 2) * 0.022 * this.bobAmp;
        pos.x += Math.sin(this.bobPhase) * 0.012 * this.bobAmp;
        targetFov += this.punch;
        break;
      }
      case "end": {
        if (modeChanged) this.endAngle = 0;
        this.endAngle = Math.min(1, this.endAngle + dt * 0.6);
        // Swing round to the side with free space, framing the runner and the waiter together.
        // Starts exactly where the chase camera was (no cut), then frames runner and waiter.
        const e = smooth(this.endAngle);
        // The side with free space (obstacles), unless the street is too tight on that side.
        let side = i.endSide < 0 ? -1 : 1;
        if (street) {
          const room = side > 0 ? street.right - i.x : i.x - street.left;
          const other = side > 0 ? i.x - street.left : street.right - i.x;
          if (room < 2.5 && other > room) side = -side;
        }
        const a = e * 1.15 * side;
        const midZ = i.z + ((i.waiterZ - i.z) / 2) * e;
        const back = boomFor(this.sNarrow.x).back;
        const r = back + (5.6 * (1 - 0.3 * this.sNarrow.x) - back) * e;
        const baseX = this.sx.x + (i.x - this.sx.x) * e;
        const up = boomFor(this.sNarrow.x).up;
        const baseY = this.sy.x + up + (i.groundY + 2.1 - this.sy.x - up) * e;
        pos.set(baseX + Math.sin(a) * r, baseY, midZ + Math.cos(a) * r);
        look.set(this.sLook.x + (i.x - this.sLook.x) * e, this.sy.x + 1.0 + (i.groundY - this.sy.x - 0.1) * e, midZ - LOOK_AHEAD * (1 - e));
        targetFov = 55;
        break;
      }
    }
    this.lastMode = i.mode;

    // Keep the lens out of geometry: lift over / slide forward along the boom, smoothed so the
    // correction itself never pops (fast in, gentle out).
    if (i.solids && i.solids.length > 0 && i.mode !== "menu") {
      const pivot = this.pivot.set(i.x, i.y + 1.2, i.z);
      const fixed = this.tmpA.copy(pos);
      clearOfSolids(fixed, pivot, i.solids);
      const need = fixed.sub(pos);
      // Never pull the correction back into a solid: only relax towards what is still needed.
      const k = need.lengthSq() > this.push.lengthSq() ? 1 : 1 - Math.exp(-4 * dt);
      this.push.lerp(need, k);
    } else this.push.multiplyScalar(Math.exp(-4 * dt));
    pos.add(this.push);

    // Shake: trauma squared, decays.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const k = this.trauma * this.trauma * 0.35;
    if (k > 0) {
      const t = this.time * 31;
      pos.x += k * (Math.sin(t * 1.3) + Math.sin(t * 2.7) * 0.5);
      pos.y += k * (Math.sin(t * 1.9 + 1) + Math.sin(t * 3.1) * 0.5);
    }
    // Keep the lens between the facades (WALL_GAP from the walls), whatever the mode.
    if (street && i.mode !== "menu") {
      const lo = street.left + WALL_GAP;
      const hi = street.right - WALL_GAP;
      pos.x = lo > hi ? (street.left + street.right) / 2 : Math.max(lo, Math.min(hi, pos.x));
    } else if (i.clearance && i.mode === "chase") {
      const room = Math.max(0.8, i.clearance / 2 - 0.9);
      pos.x = Math.max(-room, Math.min(room, pos.x));
    }

    this.local.copy(pos);
    this.toWorld(pos, look, i.mode, dt);
    if (i.bank !== 0) this.camera.rotateZ(i.bank);
    this.fov = damp(this.fov, targetFov, i.mode === "chase" && this.punch > 0 ? 14 : 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
