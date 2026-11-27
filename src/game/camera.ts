/** Chase camera with menu orbit, intro swing, end-of-run framing, FOV with speed and shake. */
import * as THREE from "three";

export type CameraMode = "menu" | "intro" | "chase" | "end";

export interface CameraInput {
  mode: CameraMode;
  /** Runner world position (feet). */
  x: number;
  y: number;
  z: number;
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
}

const BACK = 6.5;
const UP = 3.2;
const LOOK_AHEAD = 12;
const BASE_FOV = 62;

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private trauma = 0;
  private time = 0;
  private camX = 0;
  private camY = 0;
  private fov = BASE_FOV;
  private endAngle = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private lastMode: CameraMode = "menu";

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 900);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Snap the smoothing (after a warp or a new run). */
  snap(): void {
    this.lastMode = "menu";
  }

  private chasePose(i: CameraInput, pos: THREE.Vector3, look: THREE.Vector3): void {
    const f = i.flight;
    if (f > 0) {
      // Flying: higher and further back, tilted down so the traffic and the city show below.
      const flyY = i.y * 0.85;
      pos.set(this.camX, this.camY + (flyY - this.camY) * f + UP + 2.6 * f, i.z + BACK + 3.5 * f);
      look.set(this.camX * 0.9, this.camY + (flyY - this.camY) * f + 1.0 - 3.2 * f, i.z - LOOK_AHEAD - 8 * f);
      return;
    }
    pos.set(this.camX, this.camY + UP, i.z + BACK);
    look.set(this.camX * 0.9, this.camY + 1.0, i.z - LOOK_AHEAD);
  }

  update(dt: number, i: CameraInput): void {
    this.time += dt;
    const modeChanged = i.mode !== this.lastMode;
    // Follow ~60% of the lane offset; rise (a bit less than) the surface height on roofs.
    const targetX = i.x * 0.6;
    const targetY = Math.max(0, i.groundY) * 0.8;
    if (modeChanged && (i.mode === "intro" || i.mode === "menu")) {
      this.camX = targetX;
      this.camY = targetY;
    }
    this.camX = damp(this.camX, targetX, 7, dt);
    this.camY = damp(this.camY, targetY, i.groundY > this.camY ? 4 : 2.5, dt);

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
      case "chase":
        this.chasePose(i, pos, look);
        break;
      case "end": {
        if (modeChanged) this.endAngle = 0;
        this.endAngle = Math.min(1, this.endAngle + dt * 0.6);
        // Swing round to the side with free space, framing the runner and the waiter together.
        const a = smooth(this.endAngle) * 1.15 * (i.endSide < 0 ? -1 : 1);
        const midZ = (i.z + i.waiterZ) / 2;
        const r = 6.8 - smooth(this.endAngle) * 1.2;
        pos.set(i.x + Math.sin(a) * r, i.groundY + 3.0 - smooth(this.endAngle) * 0.9, midZ + Math.cos(a) * r);
        look.set(i.x, i.groundY + 0.9, midZ);
        targetFov = 55;
        break;
      }
    }
    this.lastMode = i.mode;

    // Shake: trauma squared, decays.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const k = this.trauma * this.trauma * 0.35;
    if (k > 0) {
      const t = this.time * 31;
      pos.x += k * (Math.sin(t * 1.3) + Math.sin(t * 2.7) * 0.5);
      pos.y += k * (Math.sin(t * 1.9 + 1) + Math.sin(t * 3.1) * 0.5);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (i.bank !== 0) this.camera.rotateZ(i.bank);
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
