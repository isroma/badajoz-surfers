/**
 * The three.js side of the world: lights, fog and sky driven by the zone atmosphere, scenery
 * segments, and the meshes of the obstacles and pickups the run currently needs (pooled).
 * Everything the art creates goes back through `art.release()`.
 */
import * as THREE from "three";
import {
  OBSTACLE_DEFS,
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
const BELLOTA_POOL_CAP = 80;

interface ObstacleView {
  obj: THREE.Object3D;
  spawn: ObstacleSpawn;
  key: string;
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

export class World {
  readonly scene = new THREE.Scene();
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x5a5048, 1);
  readonly fog = new THREE.Fog(0xcfe8ff, 60, 220);
  readonly sky: SkyDome;
  readonly runner: Actor;
  readonly waiter: Actor;

  private readonly scenery = new Map<ZoneId, ZoneScenery>();
  private readonly segments = new Map<number, THREE.Object3D>();
  private readonly obstacles = new Map<number, ObstacleView>();
  private readonly pickups = new Map<number, PickupView>();
  private readonly obstaclePool = new Map<string, THREE.Object3D[]>();
  private readonly pickupPool = new Map<string, PickupMesh[]>();
  private frame = 0;

  private readonly atmoFrom: AtmosphereState;
  private readonly atmoTo: AtmosphereState;
  private readonly atmo: AtmosphereState;
  private atmoT = 1;
  private atmoZone: ZoneId | null = null;

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

  sceneryFor(zone: ZoneId): ZoneScenery {
    let s = this.scenery.get(zone);
    if (!s) {
      s = this.art.createZoneScenery(zone);
      this.scenery.set(zone, s);
    }
    return s;
  }

  // --- Atmosphere --------------------------------------------------------------------------

  /** Blend towards a zone's atmosphere over ~2 s (or instantly). */
  setZone(zone: ZoneId, instant = false): void {
    if (zone === this.atmoZone && !instant) return;
    this.atmoZone = zone;
    const target = this.sceneryFor(zone).atmosphere;
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
  }

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
        this.segments.delete(index);
      }
    }
    let built = 0;
    for (let index = from; index <= to && built < maxBuilds; index++) {
      if (this.segments.has(index)) continue;
      const start = index * SEGMENT_LENGTH;
      const span = zoneAt(start);
      const count = Math.max(1, Math.round(span.zone.length / SEGMENT_LENGTH));
      const local = Math.round((start - span.start) / SEGMENT_LENGTH);
      const obj = this.sceneryFor(span.zone.id).buildSegment(local, count, span.lap);
      obj.position.z = -start;
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) o.receiveShadow = true;
      });
      this.scene.add(obj);
      this.segments.set(index, obj);
      built++;
    }
  }

  clearSegments(): void {
    for (const obj of this.segments.values()) {
      this.scene.remove(obj);
      this.art.release(obj);
    }
    this.segments.clear();
  }

  // --- Obstacles and pickups ---------------------------------------------------------------

  knock(id: number, dir: number): void {
    const view = this.obstacles.get(id);
    if (view && !view.knocked) view.knocked = { t: 0, dir };
  }

  private takeObstacle(spawn: ObstacleSpawn): { obj: THREE.Object3D; key: string } {
    const moving = spawn.k > 0;
    const variant = spawn.seed % 4;
    const key = `${spawn.kind}|${variant}|${moving ? 1 : 0}`;
    const pooled = this.obstaclePool.get(key)?.pop();
    if (pooled) return { obj: pooled, key };
    const obj = this.art.createObstacle(spawn.kind, variant, moving);
    obj.traverse((o) => {
      o.castShadow = true;
    });
    return { obj, key };
  }

  private dropObstacle(view: ObstacleView): void {
    this.scene.remove(view.obj);
    view.obj.rotation.set(0, 0, 0);
    let pool = this.obstaclePool.get(view.key);
    if (!pool) {
      pool = [];
      this.obstaclePool.set(view.key, pool);
    }
    if (pool.length < POOL_CAP) pool.push(view.obj);
    else this.art.release(view.obj);
  }

  private takePickup(kind: PickupKind, letter: string | undefined): { mesh: PickupMesh; key: string } {
    const key = kind === "letra" ? `letra|${letter ?? ""}` : kind;
    const pooled = this.pickupPool.get(key)?.pop();
    if (pooled) return { mesh: pooled, key };
    return { mesh: this.art.createPickup(kind, letter), key };
  }

  private dropPickup(view: PickupView): void {
    this.scene.remove(view.mesh.root);
    let pool = this.pickupPool.get(view.key);
    if (!pool) {
      pool = [];
      this.pickupPool.set(view.key, pool);
    }
    if (pool.length < (view.key === "bellota" ? BELLOTA_POOL_CAP : POOL_CAP)) pool.push(view.mesh);
    else this.art.release(view.mesh.root);
  }

  /** Remove every obstacle and pickup mesh (new run, warp, menu). */
  clearDynamic(): void {
    for (const view of this.obstacles.values()) this.dropObstacle(view);
    this.obstacles.clear();
    for (const view of this.pickups.values()) this.dropPickup(view);
    this.pickups.clear();
  }

  /** Bring the meshes in line with the run at (interpolated) distance `p`. */
  sync(run: Run, p: number, dt: number, time: number): void {
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
      if (!view) {
        if (run.ignore.has(spawn.id) && c < p) continue;
        const { obj, key } = this.takeObstacle(spawn);
        view = { obj, spawn, key, knocked: null, seen: frame };
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
        obj.visible = true;
        obj.position.set(def.lanes === 3 ? 0 : laneX(spawn.lane), 0, -c);
        obj.rotation.set(0, spawn.flipped ? Math.PI : 0, 0);
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
      if (pulled) view.mesh.root.position.set(pulled.x, pulled.y, -pulled.d);
      else view.mesh.root.position.set(laneX(spawn.lane), spawn.y, -spawn.d);
      view.mesh.update(dt, time);
    }
    for (const [id, view] of this.pickups) {
      if (view.seen !== frame) {
        this.dropPickup(view);
        this.pickups.delete(id);
      }
    }
  }

  counts(): { segments: number; obstacles: number; pickups: number; pooledObstacles: number; pooledPickups: number } {
    let po = 0;
    for (const pool of this.obstaclePool.values()) po += pool.length;
    let pp = 0;
    for (const pool of this.pickupPool.values()) pp += pool.length;
    return { segments: this.segments.size, obstacles: this.obstacles.size, pickups: this.pickups.size, pooledObstacles: po, pooledPickups: pp };
  }
}
