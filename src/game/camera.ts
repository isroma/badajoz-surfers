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
  /** Street width between facades at the runner, when known: the camera stays inside it. */
  clearance?: number | null;
}

const BACK = 6.5;
const UP = 3.2;
const LOOK_AHEAD = 12;
const BASE_FOV = 62;
/** Yaw spring rate (rad/s): smooths corners without lagging off the road. */
const YAW_OMEGA = 9;
/** Spring rates (rad/s): lateral, height up, height down. */
const OMEGA_X = 9;
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
    if (f > 0) {
      // Flying: the postcard. Higher and further back over the runner's own carriageway, looking
      // down the route so the bridges, the river and the Alcazaba open up below.
      const flyY = i.y * 0.85;
      pos.set(camX * (1 - 0.4 * f), camY + (flyY - camY) * f + UP + 5.5 * f, i.z + BACK + 7 * f);
      look.set(lookX, camY + (flyY - camY) * f + 1.0 - 4.5 * f, i.z - LOOK_AHEAD - 16 * f);
      return;
    }
    pos.set(camX, camY + UP, i.z + BACK);
    look.set(lookX, camY + 1.0, i.z - LOOK_AHEAD);
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
    if (!this.yawReady || mode === "menu" || mode === "intro" || dt <= 0) {
      this.yaw.x = target;
      this.yaw.v = 0;
      this.yawReady = true;
    } else {
      // Spring towards the nearest equivalent angle (unwrapped).
      springStep(this.yaw, this.yaw.x + wrapAngle(target - this.yaw.x), YAW_OMEGA, dt);
    }
    cam.position.copy(wp);
    wl.set(wp.x + Math.sin(this.yaw.x) * horiz, wl.y, wp.z + Math.cos(this.yaw.x) * horiz);
    cam.lookAt(wl);
  }

  update(dt: number, i: CameraInput): void {
    this.time += dt;
    const modeChanged = i.mode !== this.lastMode;
    // Follow ~60% of the lateral offset, leaning towards the lane being entered; rise (a bit
    // less than) the surface height on roofs, and only part of a jump.
    // Stay within ~2 m of the runner on wide avenues (5 lanes, 30 m kerb to kerb), drifting a
    // little towards the street's centre so both sides stay in view.
    const pull = Math.max(-2, Math.min(2, i.x * 0.4));
    const targetX = i.x - pull + (i.laneX - i.x) * 0.12;
    const lookTarget = i.x - pull * 0.9 + (i.laneX - i.x) * 0.3;
    const air = Math.max(0, i.y - i.groundY);
    const targetY = Math.max(0, i.groundY) * 0.8 + (i.flight > 0 ? 0 : air * JUMP_FOLLOW);
    if (modeChanged && (i.mode === "intro" || i.mode === "menu")) {
      this.sx.x = targetX;
      this.sx.v = 0;
      this.sy.x = targetY;
      this.sy.v = 0;
      this.sLook.x = lookTarget;
      this.sLook.v = 0;
      this.push.set(0, 0, 0);
    }
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
        const sx = 3.4;
        const sz = -5.4;
        const sy = 1.7;
        const cdx = this.tmpA.x - i.x;
        const cdz = this.tmpA.z - i.z;
        const aS = Math.atan2(sx, sz);
        const aC = Math.atan2(cdx, cdz);
        const rS = Math.hypot(sx, sz);
        const rC = Math.hypot(cdx, cdz);
        const a = aS + (aC - aS) * t;
        const r = rS + (rC - rS) * t;
        // Stay over the road: nothing solid stands there below 4 m (lamp posts and trees line the kerbs).
        const ax = Math.max(-3.6, Math.min(3.6, i.x + Math.sin(a) * r));
        pos.set(ax, sy + (this.tmpA.y - sy) * t, i.z + Math.cos(a) * r);
        look.set(i.x, 1.2, i.z + 1.5).lerp(this.tmpB, t);
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
        const a = e * 1.15 * (i.endSide < 0 ? -1 : 1);
        const midZ = i.z + ((i.waiterZ - i.z) / 2) * e;
        const r = BACK + (5.6 - BACK) * e;
        const baseX = this.sx.x + (i.x - this.sx.x) * e;
        const baseY = this.sy.x + UP + (i.groundY + 2.1 - this.sy.x - UP) * e;
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

    // Narrow old-town streets: keep the lens between the facades.
    if (i.clearance && i.mode === "chase") {
      const room = Math.max(0.8, i.clearance / 2 - 0.9);
      pos.x = Math.max(-room, Math.min(room, pos.x));
    }

    // Shake: trauma squared, decays.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const k = this.trauma * this.trauma * 0.35;
    if (k > 0) {
      const t = this.time * 31;
      pos.x += k * (Math.sin(t * 1.3) + Math.sin(t * 2.7) * 0.5);
      pos.y += k * (Math.sin(t * 1.9 + 1) + Math.sin(t * 3.1) * 0.5);
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
