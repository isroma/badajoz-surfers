/**
 * The three.js side of the world: lights, fog and sky driven by the zone atmosphere, scenery
 * segments, and the meshes of the obstacles and pickups the run currently needs (pooled).
 * Everything the art creates goes back through `art.release()`.
 */
import * as THREE from "three";
import {
  OBSTACLE_DEFS,
  type OutfitId,
  SEGMENT_LENGTH,
  WORD,
  laneX,
  type Actor,
  type ArtApi,
  type Atmosphere,
  type PickupKind,
  type PickupMesh,
  type SkyDome,
  type ZoneId,
  type ZoneScenery,
} from "../contracts";
import { MOVER_VIEW_DISTANCE } from "./patterns";
import type { Run } from "./run";
import { obstacleCentre, type ObstacleSpawn, type PickupSpawn } from "./spawns";
import { zoneAt } from "./tuning";

/** Segments kept ahead of / behind the runner's segment. */
const SEGMENTS_AHEAD = 9;
const SEGMENTS_BEHIND = 1;
/** Parked obstacles appear this far ahead. */
const OBSTACLE_VIEW = 175;
const PICKUP_VIEW = 140;
/** Removed once this far behind the runner (the camera is 6.5 m back). */
const BEHIND = 12;
const POOL_CAP = 8;
/** Lead-in segments before distance 0 (Puente Real indices -1..-4). */
const LEAD_IN_SEGMENTS = 4;
/** Obstacles and pickups this close to the camera are hidden so the view stays readable. */
const CAMERA_CLEARANCE = 2.5;
const PICKUP_CAMERA_CLEARANCE = 4;
const BELLOTA_POOL_CAP = 80;

interface ObstacleView {
  obj: THREE.Object3D;
  spawn: ObstacleSpawn;
  knocked: { t: number; dir: number } | null;
  seen: number;
}

interface PickupView {
  mesh: PickupMesh;
  spawn: PickupSpawn;
  key: string;
  seen: number;
}

interface AtmosphereState {
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunDir: THREE.Vector3;
  ambientColor: THREE.Color;
  ambientIntensity: number;
}

function toState(a: Atmosphere, out?: AtmosphereState): AtmosphereState {
  const s = out ?? {
    skyTop: new THREE.Color(), skyBottom: new THREE.Color(), fogColor: new THREE.Color(), fogNear: 0, fogFar: 0,
    sunColor: new THREE.Color(), sunIntensity: 0, sunDir: new THREE.Vector3(), ambientColor: new THREE.Color(), ambientIntensity: 0,
  };
  s.skyTop.setHex(a.skyTop);
  s.skyBottom.setHex(a.skyBottom);
  s.fogColor.setHex(a.fogColor);
  s.fogNear = a.fogNear;
  s.fogFar = a.fogFar;
  s.sunColor.setHex(a.sunColor);
  s.sunIntensity = a.sunIntensity;
  s.sunDir.set(...a.sunPosition);
  if (s.sunDir.lengthSq() < 1e-6) s.sunDir.set(0.3, 1, 0.2);
  s.sunDir.normalize();
  s.ambientColor.setHex(a.ambientColor);
  s.ambientIntensity = a.ambientIntensity;
  return s;
}

function copyState(into: AtmosphereState, from: AtmosphereState): void {
  into.skyTop.copy(from.skyTop);
  into.skyBottom.copy(from.skyBottom);
  into.fogColor.copy(from.fogColor);
  into.fogNear = from.fogNear;
  into.fogFar = from.fogFar;
  into.sunColor.copy(from.sunColor);
  into.sunIntensity = from.sunIntensity;
  into.sunDir.copy(from.sunDir);
  into.ambientColor.copy(from.ambientColor);
  into.ambientIntensity = from.ambientIntensity;
}

/** Distance from a point to an axis-aligned box. */
function boxDistance(pt: THREE.Vector3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number {
  const dx = Math.max(x0 - pt.x, 0, pt.x - x1);
  const dy = Math.max(y0 - pt.y, 0, pt.y - y1);
  const dz = Math.max(z0 - pt.z, 0, pt.z - z1);
  return Math.hypot(dx, dy, dz);
}

export class World {
  readonly scene = new THREE.Scene();
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x5a5048, 1);
  readonly fog = new THREE.Fog(0xcfe8ff, 60, 220);
  readonly sky: SkyDome;
  runner: Actor;
  private outfit: OutfitId | undefined;
  /** Soft light from the camera side, raised at night so gameplay objects stay readable. */
  readonly fill = new THREE.DirectionalLight(0xdfe8ff, 0);
  readonly waiter: Actor;

  private readonly scenery = new Map<ZoneId, ZoneScenery>();
  private readonly segments = new Map<number, THREE.Object3D>();
  private readonly failedSegments = new Set<number>();
  private readonly obstacles = new Map<number, ObstacleView>();
  private readonly pickups = new Map<number, PickupView>();
  /** Lifetime counters (stats). */
  readonly created = { obstacles: 0, released: 0, segments: 0, segmentsReleased: 0, pickups: 0, pickupsReleased: 0 };
  private readonly pickupPool = new Map<string, PickupMesh[]>();
  private frame = 0;

  private readonly atmoFrom: AtmosphereState;
  private readonly atmoTo: AtmosphereState;
  private readonly atmo: AtmosphereState;
  private atmoT = 1;
  private atmoZone: string | null = null;

  constructor(private readonly art: ArtApi) {
    const scene = this.scene;
    scene.fog = this.fog;
    scene.background = this.fog.color;

    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -14;
    cam.right = 14;
    cam.top = 26;
    cam.bottom = -14;
    cam.near = 1;
    cam.far = 120;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = art.createSkyDome();
    this.sky.mesh.frustumCulled = false;
    this.sky.mesh.renderOrder = -10;
    scene.add(this.sky.mesh);

    this.runner = art.createRunner();
    scene.add(this.fill, this.fill.target);
    this.waiter = art.createWaiter();
    for (const actor of [this.runner, this.waiter]) {
      actor.root.traverse((o) => {
        o.castShadow = true;
      });
      scene.add(actor.root);
    }

    const first = toState(this.sceneryFor("puente-real").atmosphere);
    this.atmoFrom = toState(this.sceneryFor("puente-real").atmosphere);
    this.atmoTo = toState(this.sceneryFor("puente-real").atmosphere);
    this.atmo = first;
    this.applyAtmosphere();
  }

  /** Re-create the runner when the equipped outfit changes. Returns true if it was replaced. */
  setOutfit(outfit: OutfitId | undefined): boolean {
    if (outfit === undefined || outfit === this.outfit) return false;
    const old = this.runner;
    this.outfit = outfit;
    const runner = this.art.createRunner(outfit);
    runner.root.traverse((o) => {
      o.castShadow = true;
    });
    runner.root.position.copy(old.root.position);
    this.scene.remove(old.root);
    this.art.release(old.root);
    this.scene.add(runner.root);
    this.runner = runner;
    return true;
  }

  sceneryFor(zone: ZoneId): ZoneScenery {
    let s = this.scenery.get(zone);
    if (!s) {
      s = this.art.createZoneScenery(zone);
      this.scenery.set(zone, s);
    }
    return s;
  }

  // --- Atmosphere --------------------------------------------------------------------------

  /** Blend towards a zone's atmosphere (day on odd laps, night on even ones) over ~2 s, or instantly. */
  setZone(zone: ZoneId, instant = false, lap = 1): void {
    const key = `${zone}|${lap % 2}`;
    if (key === this.atmoZone && !instant) return;
    this.atmoZone = key;
    const scenery = this.sceneryFor(zone);
    const target = scenery.atmosphereFor?.(lap) ?? scenery.atmosphere;
    if (instant) {
      toState(target, this.atmo);
      this.atmoT = 1;
      this.applyAtmosphere();
      return;
    }
    copyState(this.atmoFrom, this.atmo);
    toState(target, this.atmoTo);
    this.atmoT = 0;
  }

  private applyAtmosphere(): void {
    const a = this.atmo;
    this.fog.color.copy(a.fogColor);
    this.fog.near = a.fogNear;
    this.fog.far = a.fogFar;
    this.sky.setColors(a.skyTop, a.skyBottom);
    this.sun.color.copy(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.hemi.color.copy(a.ambientColor);
    this.hemi.groundColor.copy(a.ambientColor).multiplyScalar(0.45);
    this.hemi.intensity = a.ambientIntensity;
    // Night (dim sun and ambient): a soft camera-side fill so the runner and obstacles pop.
    const light = a.sunIntensity * 0.35 + a.ambientIntensity;
    this.fill.intensity = Math.max(0, Math.min(1.2, (1.6 - light) * 1.1));
  }

  /** Per frame: atmosphere blend, sky on the camera, sun shadow following the runner. */
  updateEnvironment(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    if (this.atmoT < 1) {
      this.atmoT = Math.min(1, this.atmoT + dt / 2);
      const t = this.atmoT * this.atmoT * (3 - 2 * this.atmoT);
      const a = this.atmo;
      const f = this.atmoFrom;
      const b = this.atmoTo;
      a.skyTop.lerpColors(f.skyTop, b.skyTop, t);
      a.skyBottom.lerpColors(f.skyBottom, b.skyBottom, t);
      a.fogColor.lerpColors(f.fogColor, b.fogColor, t);
      a.fogNear = f.fogNear + (b.fogNear - f.fogNear) * t;
      a.fogFar = f.fogFar + (b.fogFar - f.fogFar) * t;
      a.sunColor.lerpColors(f.sunColor, b.sunColor, t);
      a.sunIntensity = f.sunIntensity + (b.sunIntensity - f.sunIntensity) * t;
      a.sunDir.lerpVectors(f.sunDir, b.sunDir, t).normalize();
      a.ambientColor.lerpColors(f.ambientColor, b.ambientColor, t);
      a.ambientIntensity = f.ambientIntensity + (b.ambientIntensity - f.ambientIntensity) * t;
      this.applyAtmosphere();
    }
    this.sky.mesh.position.copy(camera.position);
    // Shadow frustum centred a little ahead of the runner; snap to texels to avoid shimmering.
    const texel = 28 / 1024;
    const tx = Math.round(focus.x / texel) * texel;
    const tz = Math.round((focus.z - 4) / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx, 0, tz).addScaledVector(this.atmo.sunDir, 60);
    this.sun.target.updateMatrixWorld();
    // Fill light comes from behind the camera, towards the runner.
    this.fill.target.position.copy(focus);
    this.fill.position.copy(camera.position).add(this.fillOffset);
    this.fill.target.updateMatrixWorld();
  }

  private readonly fillOffset = new THREE.Vector3(0, 6, 4);

  // --- Scenery segments --------------------------------------------------------------------

  /**
   * Keep the segments around distance `p`; builds at most `maxBuilds` per call (hitch control).
   * `behind` is larger in the menu and the intro, where the camera looks back.
   */
  updateSegments(p: number, maxBuilds = 2, behind = SEGMENTS_BEHIND): void {
    const current = Math.floor(p / SEGMENT_LENGTH);
    const from = current - behind;
    const to = current + SEGMENTS_AHEAD;
    for (const [index, obj] of this.segments) {
      if (index < from || index > to) {
        this.scene.remove(obj);
        this.art.release(obj);
        this.created.segmentsReleased++;
        this.segments.delete(index);
      }
    }
    let built = 0;
    for (let index = from; index <= to && built < maxBuilds; index++) {
      if (this.segments.has(index)) continue;
      // Before the start of the run: the street leading to Puente Real (indices -1..-4).
      if (index < -LEAD_IN_SEGMENTS || this.failedSegments.has(index)) continue;
      const start = index * SEGMENT_LENGTH;
      let obj: THREE.Object3D;
      try {
        if (index < 0) {
          const zone = zoneAt(0).zone;
          obj = this.sceneryFor(zone.id).buildSegment(index, Math.round(zone.length / SEGMENT_LENGTH), 1);
        } else {
          const span = zoneAt(start);
          const count = Math.max(1, Math.round(span.zone.length / SEGMENT_LENGTH));
          const local = Math.round((start - span.start) / SEGMENT_LENGTH);
          obj = this.sceneryFor(span.zone.id).buildSegment(local, count, span.lap);
        }
      } catch {
        // Defensive: a scenery builder that cannot build this index is skipped (once).
        this.failedSegments.add(index);
        continue;
      }
      obj.position.z = -start;
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) o.receiveShadow = true;
      });
      this.scene.add(obj);
      this.segments.set(index, obj);
      this.created.segments++;
      built++;
    }
  }

  clearSegments(): void {
    for (const obj of this.segments.values()) {
      this.scene.remove(obj);
      this.art.release(obj);
      this.created.segmentsReleased++;
    }
    this.segments.clear();
  }

  // --- Obstacles and pickups ---------------------------------------------------------------

  knock(id: number, dir: number): void {
    const view = this.obstacles.get(id);
    if (view && !view.knocked) view.knocked = { t: 0, dir };
  }

  /** Obstacles use their full seed (many liveries and colours), so they are not pooled. */
  private takeObstacle(spawn: ObstacleSpawn): THREE.Object3D {
    const obj = this.art.createObstacle(spawn.kind, spawn.seed, spawn.k > 0);
    obj.traverse((o) => {
      o.castShadow = true;
    });
    this.created.obstacles++;
    return obj;
  }

  private dropObstacle(view: ObstacleView): void {
    this.scene.remove(view.obj);
    this.art.release(view.obj);
    this.created.released++;
  }

  private takePickup(kind: PickupKind, letter: string | undefined): { mesh: PickupMesh; key: string } {
    const key = kind === "letra" ? `letra|${letter ?? ""}` : kind;
    const pooled = this.pickupPool.get(key)?.pop();
    if (pooled) return { mesh: pooled, key };
    this.created.pickups++;
    try {
      return { mesh: this.art.createPickup(kind, letter), key };
    } catch {
      // Art without this kind yet (e.g. a new power-up): show a generic power-up instead.
      return { mesh: this.art.createPickup("iman"), key };
    }
  }

  private dropPickup(view: PickupView): void {
    this.scene.remove(view.mesh.root);
    let pool = this.pickupPool.get(view.key);
    if (!pool) {
      pool = [];
      this.pickupPool.set(view.key, pool);
    }
    if (pool.length < (view.key === "bellota" ? BELLOTA_POOL_CAP : POOL_CAP)) pool.push(view.mesh);
    else {
      this.art.release(view.mesh.root);
      this.created.pickupsReleased++;
    }
  }

  /** Remove every obstacle and pickup mesh (new run, warp, menu). */
  clearDynamic(): void {
    for (const view of this.obstacles.values()) this.dropObstacle(view);
    this.obstacles.clear();
    for (const view of this.pickups.values()) this.dropPickup(view);
    this.pickups.clear();
  }

  /** Bring the meshes in line with the run at (interpolated) distance `p`. */
  sync(run: Run, p: number, dt: number, time: number, camera: THREE.Vector3, endShot = false): void {
    const pickupClearance = endShot ? PICKUP_CAMERA_CLEARANCE * 1.5 : PICKUP_CAMERA_CLEARANCE;
    this.frame++;
    const frame = this.frame;
    const list = run.gen.obstacles;
    // First spawn that could still be visible.
    let lo = 0;
    let hi = list.length;
    const from = p - BEHIND - 30;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid];
      if (s && s.d < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length; i++) {
      const spawn = list[i];
      if (!spawn || spawn.d > p + OBSTACLE_VIEW) break;
      const def = OBSTACLE_DEFS[spawn.kind];
      const c = obstacleCentre(spawn, p);
      if (c + def.length / 2 < p - BEHIND) continue;
      if (spawn.k > 0 && c - p > MOVER_VIEW_DISTANCE) continue;
      let view = this.obstacles.get(spawn.id);
      if (run.removed.has(spawn.id)) continue; // Dropped below (not seen this frame).
      if (!view) {
        if (run.ignore.has(spawn.id) && c < p) continue;
        const obj = this.takeObstacle(spawn);
        view = { obj, spawn, knocked: null, seen: frame };
        this.obstacles.set(spawn.id, view);
        this.scene.add(obj);
      }
      view.seen = frame;
      const obj = view.obj;
      if (view.knocked) {
        const k = view.knocked;
        k.t += dt;
        obj.position.x += k.dir * 9 * dt;
        obj.position.y = Math.max(0, 6 * k.t - 9 * k.t * k.t);
        obj.position.z = -c - 2 * k.t;
        obj.rotation.z = -k.dir * k.t * 4;
        obj.rotation.x = k.t * 2;
        obj.visible = k.t < 1.1;
      } else {
        const x = def.lanes === 3 ? 0 : laneX(spawn.lane);
        obj.position.set(x, 0, -c);
        obj.rotation.set(0, spawn.flipped ? Math.PI : 0, 0);
        // Keep the view readable: hide what is right at the lens, tall things behind the runner,
        // and a scaffold once the runner is under it (the camera is about to pass through it).
        const dMin = c - def.length / 2;
        const dMax = c + def.length / 2;
        const near = boxDistance(camera, x - def.width / 2, x + def.width / 2, def.yMin, def.yMax + 0.6, -dMax, -dMin) < CAMERA_CLEARANCE;
        const behindTall = dMax < p - 1 && def.yMax > 1.2;
        const overhead = spawn.kind === "andamio" && p > dMin + 0.8;
        obj.visible = !(near || behindTall || overhead);
      }
    }
    for (const [id, view] of this.obstacles) {
      if (view.seen !== frame) {
        this.dropObstacle(view);
        this.obstacles.delete(id);
      }
    }

    // Pickups.
    const pickups = run.gen.pickups;
    lo = 0;
    hi = pickups.length;
    const pFrom = p - 6;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = pickups[mid];
      if (s && s.d < pFrom) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < pickups.length; i++) {
      const spawn = pickups[i];
      if (!spawn || spawn.d > p + PICKUP_VIEW) break;
      if (run.taken.has(spawn.id)) continue;
      // Gone behind the runner: never draw it next to the lens.
      if (spawn.d < p - 0.5 && !run.magnet.has(spawn.id)) continue;
      let letter: string | undefined;
      if (spawn.kind === "letra") {
        const index = run.letterFor(spawn.id);
        if (index < 0) continue;
        letter = WORD[index];
      }
      const key = spawn.kind === "letra" ? `letra|${letter ?? ""}` : spawn.kind;
      let view = this.pickups.get(spawn.id);
      if (view && view.key !== key) {
        this.dropPickup(view);
        this.pickups.delete(spawn.id);
        view = undefined;
      }
      if (!view) {
        const { mesh } = this.takePickup(spawn.kind, letter);
        view = { mesh, spawn, key, seen: frame };
        this.pickups.set(spawn.id, view);
        this.scene.add(mesh.root);
      }
      view.seen = frame;
      const pulled = run.magnet.get(spawn.id);
      const root = view.mesh.root;
      if (pulled) root.position.set(pulled.x, pulled.y, -pulled.d);
      else root.position.set(laneX(spawn.lane), spawn.y, -spawn.d);
      root.visible = root.position.distanceTo(camera) > pickupClearance;
      view.mesh.update(dt, time);
    }
    for (const [id, view] of this.pickups) {
      if (view.seen !== frame) {
        this.dropPickup(view);
        this.pickups.delete(id);
      }
    }
  }

  counts(): Record<string, number> {
    let pp = 0;
    for (const pool of this.pickupPool.values()) pp += pool.length;
    return {
      segments: this.segments.size, obstacles: this.obstacles.size, pickups: this.pickups.size, pooledPickups: pp,
      createdSegments: this.created.segments, releasedSegments: this.created.segmentsReleased,
      createdObstacles: this.created.obstacles, releasedObstacles: this.created.released,
      createdPickups: this.created.pickups, releasedPickups: this.created.pickupsReleased,
    };
  }
}
