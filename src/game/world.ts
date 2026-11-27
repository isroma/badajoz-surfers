/**
 * The three.js side of the world: lights, fog and sky driven by the atmosphere along the route,
 * the real city (the art streams it round the runner), and the meshes of the obstacles and
 * pickups the run currently needs (pooled), all mapped from track space (distance s, lateral,
 * height) to the world through the city track (see space.ts).
 * Everything the art creates goes back through `art.release()`.
 *
 * Visibility rules are camera based, never runner based: nothing inside the camera frustum
 * disappears. Objects are dropped only once they are behind the runner by more than KEEP_BEHIND
 * metres AND outside the frustum (with margin). Things that get close to the lens, or block the
 * line from the camera to the runner, fade out (per object, alpha) instead of being hidden; new
 * objects fade in at the far end of the view.
 */
import * as THREE from "three";
import {
  OBSTACLE_DEFS,
  type OutfitId,
  WORD,
  type Actor,
  type ArtApi,
  type Atmosphere,
  type CityScenery,
  type PickupKind,
  type PickupMesh,
  type SkyDome,
  type ZoneId,
  type ZoneScenery,
} from "../contracts";
import type { CityData } from "../city/data";
import type { Track } from "../city/track";
import type { Run } from "./run";
import type { TrackSpace } from "./space";
import { obstacleCentre, obstacleRate, pickupD, type ObstacleSpawn, type PickupSpawn } from "./spawns";
import { OBSTACLE_VIEW } from "./traffic";
import { zoneAt } from "./tuning";

const PICKUP_VIEW = 150;
/** Objects closer than this behind the runner are always kept (the end-of-run camera looks back). */
const KEEP_BEHIND = 30;
/** Frustum margin (metres) before something counts as off screen. */
const FRUSTUM_MARGIN = 3;
const POOL_CAP = 8;
const BELLOTA_POOL_CAP = 80;
/** Metres of travel over which the atmosphere blends from one zone's to the next. */
const ATMO_BLEND = 150;
/**
 * Fade objects out between these distances from the lens (metres). The camera is kept 0.35 m
 * clear of solids, so in practice this catches what grazes the lens (banners, pickups, a bus
 * roof the camera skims), not every vehicle passing beside it.
 */
const FADE_NEAR = 0.2;
const FADE_FAR = 1.0;
/** Opacity of something standing between the camera and the runner. */
const OCCLUDER_ALPHA = 0.32;

/**
 * Per-object fade: cloned materials (alpha blended, still writing depth so the object hides its
 * own far side) while faded, the originals restored as soon as it is clear.
 */
interface Fade {
  alpha: number;
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]> | null;
  clones: THREE.Material[];
}

interface ObstacleView {
  obj: THREE.Object3D;
  spawn: ObstacleSpawn;
  knocked: { t: number; dir: number } | null;
  seen: number;
  fade: Fade;
  /** Child meshes named "wheel*" (rotated while driving), and the body that bobs. */
  wheels: THREE.Object3D[];
  body: THREE.Object3D | null;
  wheelAngle: number;
  phase: number;
  /** After the run ends, traffic brakes to a halt from its last speed. */
  drift: { x: number; v: number; a: number } | null;
  /** Flashing headlights (oncoming) or hazard lights (broken down): engine glow sprites. */
  glows: THREE.Sprite[];
  flashT: number;
  triangle: THREE.Object3D | null;
}

interface PickupView {
  mesh: PickupMesh;
  spawn: PickupSpawn;
  key: string;
  seen: number;
  fade: Fade;
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
export function boxDistance(pt: { x: number; y: number; z: number }, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number {
  const dx = Math.max(x0 - pt.x, 0, pt.x - x1);
  const dy = Math.max(y0 - pt.y, 0, pt.y - y1);
  const dz = Math.max(z0 - pt.z, 0, pt.z - z1);
  return Math.hypot(dx, dy, dz);
}

/** Does the segment a→b pass through the box (slab test)? Pure. */
export function segmentHitsBox(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax, ay, az];
  const lo = [x0, y0, z0];
  const hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    const di = d[i] ?? 0;
    const oi = o[i] ?? 0;
    const l = lo[i] ?? 0;
    const h = hi[i] ?? 0;
    if (Math.abs(di) < 1e-9) {
      if (oi < l || oi > h) return false;
      continue;
    }
    let ta = (l - oi) / di;
    let tb = (h - oi) / di;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Opacity target for an object: fades near the lens and while it hides the runner. Pure. */
export function fadeTarget(distanceToLens: number, blocksRunner: boolean): number {
  const t = Math.min(1, Math.max(0, (distanceToLens - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
  const near = t * t * (3 - 2 * t);
  return Math.min(near, blocksRunner ? OCCLUDER_ALPHA : 1);
}

let glowMaterial: THREE.SpriteMaterial | null = null;
function glowSprite(color: number): THREE.Sprite {
  if (!glowMaterial) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.8)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    glowMaterial = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
  }
  const m = glowMaterial.clone();
  m.color.setHex(color);
  const s = new THREE.Sprite(m);
  s.renderOrder = 4;
  return s;
}

let triangleGeometry: THREE.BufferGeometry | null = null;
let triangleMaterial: THREE.MeshLambertMaterial | null = null;
/** A small red warning triangle (engine prop for broken-down cars). */
function warningTriangle(): THREE.Object3D {
  if (!triangleGeometry || !triangleMaterial) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.22, 0);
    shape.lineTo(0.22, 0);
    shape.lineTo(0, 0.38);
    shape.lineTo(-0.22, 0);
    const hole = new THREE.Path();
    hole.moveTo(-0.13, 0.05);
    hole.lineTo(0, 0.28);
    hole.lineTo(0.13, 0.05);
    hole.lineTo(-0.13, 0.05);
    shape.holes.push(hole);
    triangleGeometry = new THREE.ShapeGeometry(shape);
    triangleMaterial = new THREE.MeshLambertMaterial({ color: 0xe8261c, emissive: 0x551010, side: THREE.DoubleSide });
  }
  const g = new THREE.Group();
  const tri = new THREE.Mesh(triangleGeometry, triangleMaterial);
  tri.rotation.x = -0.25;
  g.add(tri);
  return g;
}

/** A plain dark soft disc on the ground (when the art has no blob shadow). */
function fallbackBlob(width: number, length: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1f2328, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  m.scale.set(width * 1.2, 1, length * 1.2);
  m.renderOrder = 1;
  return m;
}

/**
 * Every bellota on screen in one InstancedMesh (the art's acorn geometry and material) plus one
 * Points cloud for their sparkles: 2 draw calls instead of 2 per coin. Spin and bob as the art's
 * own pickup does.
 */
class BellotaBatch {
  private mesh: THREE.InstancedMesh | null = null;
  private points: THREE.Points | null = null;
  private failed = false;
  private readonly local = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly dummy = new THREE.Object3D();
  private readonly ids: number[] = [];
  private readonly ss: number[] = [];
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private n = 0;
  private static readonly CAP = 400;

  constructor(private readonly scene: THREE.Scene) {}

  ready(art: ArtApi): boolean {
    if (this.mesh) return true;
    if (this.failed) return false;
    try {
      const tpl = art.createPickup("bellota");
      let src: THREE.Mesh | null = null;
      let sprite: THREE.Sprite | null = null;
      tpl.root.traverse((o) => {
        if (!src && o instanceof THREE.Mesh) src = o;
        if (!sprite && o instanceof THREE.Sprite) sprite = o;
      });
      const mesh = src as THREE.Mesh | null;
      if (!mesh) throw new Error("no acorn mesh");
      tpl.root.updateMatrixWorld(true);
      this.local.copy(mesh.matrixWorld);
      this.mesh = new THREE.InstancedMesh(mesh.geometry, mesh.material, BellotaBatch.CAP);
      this.mesh.frustumCulled = false;
      this.mesh.count = 0;
      this.mesh.name = "bellotas";
      this.scene.add(this.mesh);
      const sp = sprite as THREE.Sprite | null;
      const map = sp ? (sp.material as THREE.SpriteMaterial).map : null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BellotaBatch.CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      this.points = new THREE.Points(g, new THREE.PointsMaterial({ map, size: 0.95, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: 0.85, color: 0xffffff }));
      this.points.frustumCulled = false;
      this.points.renderOrder = 1;
      this.scene.add(this.points);
      return true;
    } catch (error) {
      console.error("Badajoz Surfers: instanced bellotas unavailable, drawing them one by one", error);
      this.failed = true;
      return false;
    }
  }

  begin(): void {
    this.n = 0;
  }

  add(id: number, s: number, x: number, y: number): void {
    if (this.n >= BellotaBatch.CAP) return;
    this.ids[this.n] = id;
    this.ss[this.n] = s;
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.n++;
  }

  end(space: TrackSpace, t: number): void {
    const mesh = this.mesh;
    const points = this.points;
    if (!mesh || !points) return;
    const pos = points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const d = this.dummy;
    for (let i = 0; i < this.n; i++) {
      const phase = ((this.ids[i] ?? 0) * 2.399) % (Math.PI * 2);
      const bob = Math.sin(t * 3 + phase) * 0.07;
      space.place(d, this.ss[i] ?? 0, this.xs[i] ?? 0, (this.ys[i] ?? 0) + bob, 0, 0);
      d.rotateY(t * 2.6 + phase);
      d.updateMatrix();
      this.m.multiplyMatrices(d.matrix, this.local);
      mesh.setMatrixAt(i, this.m);
      pos.setXYZ(i, d.position.x, d.position.y, d.position.z);
    }
    mesh.count = this.n;
    mesh.instanceMatrix.needsUpdate = true;
    points.geometry.setDrawRange(0, this.n);
    pos.needsUpdate = true;
  }
}

const LANE_COLOURS: Record<string, number> = { road: 0x3a3d42, sidewalk: 0xb9b2a4, median: 0x5f8a4a, pedestrian: 0xc9b99a };

/**
 * Fallback scenery when the art has no city: the lap's lanes as flat coloured strips (road,
 * sidewalk, median, pedestrian), following the real curve and heights.
 */
function buildRibbon(track: Track): THREE.Object3D {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const step = 2;
  const pt = { x: 0, y: 0, z: 0 };
  const corner = (s: number, lat: number): void => {
    track.toWorld(s, lat, 0.02, pt);
    pos.push(pt.x, pt.y, pt.z);
    col.push(c.r, c.g, c.b);
  };
  for (let s = 0; s < track.lapLength; s += step) {
    const s1 = Math.min(track.lapLength, s + step);
    const layout = track.layoutAt(s);
    layout.offsets.forEach((o, i) => {
      const w = (layout.widths[i] ?? 2.6) / 2 - 0.05;
      c.setHex(LANE_COLOURS[layout.kinds[i] ?? "road"] ?? 0x444444);
      corner(s, o - w);
      corner(s1, o - w);
      corner(s, o + w);
      corner(s, o + w);
      corner(s1, o - w);
      corner(s1, o + w);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  mesh.name = "debug-ribbon";
  return mesh;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x5a5048, 1);
  readonly fog = new THREE.Fog(0xcfe8ff, 120, 900);
  readonly sky: SkyDome;
  runner: Actor;
  private outfit: OutfitId | undefined;
  /** Soft light from the camera side, raised at night so gameplay objects stay readable. */
  readonly fill = new THREE.DirectionalLight(0xdfe8ff, 0);
  readonly waiter: Actor;

  /** The real city (art), or a plain road ribbon when the art has none. */
  private readonly cityScenery: CityScenery | null;
  private readonly ribbon: THREE.Object3D | null;
  private readonly zoneScenery = new Map<ZoneId, ZoneScenery>();
  private readonly obstacles = new Map<number, ObstacleView>();
  private readonly pickups = new Map<number, PickupView>();
  /** Lifetime counters (stats). */
  readonly created = { obstacles: 0, released: 0, pickups: 0, pickupsReleased: 0, faded: 0 };
  private readonly pickupPool = new Map<string, PickupMesh[]>();
  private readonly obstaclePool = new Map<string, THREE.Object3D[]>();
  private readonly bellotas = new BellotaBatch(this.scene);
  private readonly runnerBlob: THREE.Object3D;
  private readonly waiterBlob: THREE.Object3D;
  private frame = 0;
  private lastP = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  private readonly atmoFrom: AtmosphereState;
  private readonly atmoTo: AtmosphereState;
  private readonly atmo: AtmosphereState;
  private atmoT = 1;
  private atmoKey: Atmosphere | null = null;
  private atmoS = 0;

  constructor(
    private readonly art: ArtApi,
    readonly space: TrackSpace,
    city: CityData | null,
  ) {
    const scene = this.scene;
    scene.fog = this.fog;
    scene.background = this.fog.color;

    // Flat style: no shadow maps (docs/design.md); soft blob shadows under what moves.
    this.sun.castShadow = false;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = art.createSkyDome();
    this.sky.mesh.frustumCulled = false;
    this.sky.mesh.renderOrder = -10;
    scene.add(this.sky.mesh);

    // The real city, streamed by the art; without it, a plain ribbon of the lap's lanes.
    let cityScenery: CityScenery | null = null;
    if (city && space.track) {
      try {
        cityScenery = art.createCity?.(city, space.track) ?? null;
      } catch (error) {
        console.error("Badajoz Surfers: the city art failed; drawing a plain road instead", error);
        cityScenery = null;
      }
    }
    this.cityScenery = cityScenery;
    if (cityScenery) scene.add(cityScenery.root);
    this.ribbon = !cityScenery && space.track ? buildRibbon(space.track) : null;
    if (this.ribbon) scene.add(this.ribbon);

    this.runner = art.createRunner();
    scene.add(this.fill, this.fill.target);
    this.waiter = art.createWaiter();
    for (const actor of [this.runner, this.waiter]) scene.add(actor.root);
    this.runnerBlob = this.blob(0.9, 0.9);
    this.waiterBlob = this.blob(0.9, 0.9);

    const first = toState(this.atmosphereAt(0, 1));
    this.atmoFrom = toState(this.atmosphereAt(0, 1));
    this.atmoTo = toState(this.atmosphereAt(0, 1));
    this.atmo = first;
    this.applyAtmosphere();
  }

  /** A soft ground blob (the art's, else a plain dark disc). */
  private blob(width: number, length: number): THREE.Object3D {
    let m: THREE.Object3D;
    try {
      m = this.art.createBlobShadow?.(width, length) ?? fallbackBlob(width, length);
    } catch {
      m = fallbackBlob(width, length);
    }
    const holder = new THREE.Group();
    holder.add(m);
    this.scene.add(holder);
    return holder;
  }

  /**
   * Put an actor's blob on the surface under it (`ground`: road 0 or a roof), smaller the higher
   * the actor is above it.
   */
  placeBlob(which: "runner" | "waiter", s: number, lateral: number, ground: number, height: number): void {
    const b = which === "runner" ? this.runnerBlob : this.waiterBlob;
    this.space.place(b, s, lateral, ground + 0.03, 0, 1);
    const k = Math.max(0.35, 1 - Math.max(0, height - ground) / 5);
    b.scale.set(k, 1, k);
    b.visible = height - ground < 7;
  }

  /**
   * Compile every shader the run will need before it starts: the city's (art prewarm, which also
   * builds the area round `s`), and one of each obstacle (parked and moving) and pickup, placed in
   * front of the camera for the compile and then kept in the pools for the first spawns.
   */
  async prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, s: number, lap: number): Promise<void> {
    const lapLength = this.space.lapLength;
    const within = Number.isFinite(lapLength) ? ((s % lapLength) + lapLength) % lapLength : s;
    try {
      await this.cityScenery?.prewarm?.(renderer, camera, within, lap);
    } catch (error) {
      console.error("Badajoz Surfers: city prewarm failed", error);
    }
    const staging = new THREE.Group();
    const ahead = new THREE.Vector3(0, 0, -12).applyQuaternion(camera.quaternion).add(camera.position);
    const made: { obj: THREE.Object3D; key: string }[] = [];
    const kinds = Object.keys(OBSTACLE_DEFS) as (keyof typeof OBSTACLE_DEFS)[];
    for (const kind of kinds) {
      const def = OBSTACLE_DEFS[kind];
      for (const moving of def.vehicle || kind === "peaton" ? [false, true] : [false]) {
        try {
          const obj = this.art.createObstacle(kind, 0, moving, def.lanes === 3 ? 8 : undefined);
          obj.position.copy(ahead);
          staging.add(obj);
          made.push({ obj, key: `${kind}|${moving ? 1 : 0}|${def.lanes === 3 ? "8.0" : ""}|0` });
        } catch {
          // a kind the art cannot build yet
        }
      }
    }
    const pickupKinds: PickupKind[] = ["iman", "zapatillas", "jamon", "patinete", "ciguena", "letra"];
    const pickups: { mesh: PickupMesh; key: string }[] = [];
    for (const kind of pickupKinds) {
      const p = this.takePickup(kind, kind === "letra" ? "B" : undefined);
      p.mesh.root.position.copy(ahead);
      staging.add(p.mesh.root);
      pickups.push(p);
    }
    this.bellotas.ready(this.art);
    this.scene.add(staging);
    staging.updateMatrixWorld(true);
    try {
      await renderer.compileAsync(this.scene, camera);
    } catch {
      renderer.compile(this.scene, camera);
    }
    this.scene.remove(staging);
    for (const { obj, key } of made) {
      obj.removeFromParent();
      obj.userData["poolKey"] = key;
      let pool = this.obstaclePool.get(key);
      if (!pool) this.obstaclePool.set(key, (pool = []));
      pool.push(obj);
    }
    for (const p of pickups) {
      p.mesh.root.removeFromParent();
      let pool = this.pickupPool.get(p.key);
      if (!pool) this.pickupPool.set(p.key, (pool = []));
      pool.push(p.mesh);
    }
  }

  /** Detail level for the city (0 full .. 3 lightest). */
  setQuality(level: 0 | 1 | 2 | 3): void {
    try {
      this.cityScenery?.setQuality?.(level);
    } catch {
      // optional
    }
  }

  hideBlob(which: "runner" | "waiter"): void {
    (which === "runner" ? this.runnerBlob : this.waiterBlob).visible = false;
  }

  /** Does the real city art draw the world (vs the fallback ribbon)? */
  get hasCity(): boolean {
    return this.cityScenery !== null;
  }

  /** Re-create the runner when the equipped outfit changes. Returns true if it was replaced. */
  setOutfit(outfit: OutfitId | undefined): boolean {
    if (outfit === undefined || outfit === this.outfit) return false;
    const old = this.runner;
    this.outfit = outfit;
    const runner = this.art.createRunner(outfit);
    runner.root.position.copy(old.root.position);
    this.scene.remove(old.root);
    this.art.release(old.root);
    this.scene.add(runner.root);
    this.runner = runner;
    return true;
  }

  private zoneSceneryFor(zone: ZoneId): ZoneScenery {
    let s = this.zoneScenery.get(zone);
    if (!s) {
      s = this.art.createZoneScenery(zone);
      this.zoneScenery.set(zone, s);
    }
    return s;
  }

  /** The art's atmosphere at a distance (the city's, else the zone's). */
  private atmosphereAt(s: number, lap: number): Atmosphere {
    const lapLength = this.space.lapLength;
    const within = Number.isFinite(lapLength) ? ((s % lapLength) + lapLength) % lapLength : s;
    if (this.cityScenery) return this.cityScenery.atmosphereAt(within, lap);
    const zone = zoneAt(s).zone.id;
    const sc = this.zoneSceneryFor(zone);
    return sc.atmosphereFor?.(lap) ?? sc.atmosphere;
  }

  // --- Scenery and atmosphere --------------------------------------------------------------

  /** Build everything near distance `s` now (behind a fade: menu, run start, warp). */
  preload(s: number, lap: number): void {
    const lapLength = this.space.lapLength;
    const within = Number.isFinite(lapLength) ? ((s % lapLength) + lapLength) % lapLength : s;
    try {
      this.cityScenery?.preload(within, lap);
    } catch (error) {
      console.error("Badajoz Surfers: city preload failed", error);
    }
    this.snapAtmosphere(s, lap);
  }

  /** Per frame: stream the city round the runner. */
  updateScenery(s: number, lap: number, camera: THREE.Camera): void {
    const lapLength = this.space.lapLength;
    const within = Number.isFinite(lapLength) ? ((s % lapLength) + lapLength) % lapLength : s;
    try {
      this.cityScenery?.update(within, lap, camera);
    } catch (error) {
      console.error("Badajoz Surfers: city update failed", error);
    }
  }

  /** Jump straight to the atmosphere at `s` (no blend). */
  snapAtmosphere(s: number, lap: number): void {
    const target = this.atmosphereAt(s, lap);
    this.atmoKey = target;
    toState(target, this.atmo);
    this.atmoT = 1;
    this.atmoS = s;
    this.applyAtmosphere();
  }

  /**
   * Blend towards the atmosphere at `s` across zone boundaries, over ATMO_BLEND metres of
   * travel (not time: standing still in the menu never drifts).
   */
  updateAtmosphere(s: number, lap: number): void {
    const target = this.atmosphereAt(s, lap);
    if (target !== this.atmoKey) {
      this.atmoKey = target;
      copyState(this.atmoFrom, this.atmo);
      toState(target, this.atmoTo);
      this.atmoT = 0;
    }
    const ds = Math.max(0, Math.abs(s - this.atmoS));
    this.atmoS = s;
    if (this.atmoT < 1) {
      this.atmoT = Math.min(1, this.atmoT + ds / ATMO_BLEND);
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

  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private readonly snapped = new THREE.Vector3();

  /**
   * Per frame: sky on the camera, the sun's shadow following the runner (`focus`, world) a little
   * ahead along `forward`.
   */
  updateEnvironment(camera: THREE.Camera, focus: THREE.Vector3, forward: THREE.Vector3): void {
    this.sky.mesh.position.copy(camera.position);
    // Shadow frustum centred a little ahead of the runner, snapped to whole shadow-map texels in
    // the light's own view plane (snapping in world X/Z does not stop the shimmer for an oblique
    // sun: the map would still slide by sub-texel amounts and every shadow edge would crawl).
    const dir = this.atmo.sunDir;
    const right = this.lightRight.set(0, 1, 0).cross(dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = this.lightUp.copy(dir).cross(right).normalize();
    const cam = this.sun.shadow.camera;
    const texelU = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const texelV = (cam.top - cam.bottom) / this.sun.shadow.mapSize.y;
    const c = this.snapped.copy(focus).addScaledVector(forward, 6);
    const u = Math.round(c.dot(right) / texelU) * texelU;
    const v = Math.round(c.dot(up) / texelV) * texelV;
    const w = c.dot(dir);
    c.copy(right).multiplyScalar(u).addScaledVector(up, v).addScaledVector(dir, w);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, 100);
    this.sun.target.updateMatrixWorld();
    // Fill light comes from behind the camera, towards the runner.
    this.fill.target.position.copy(focus);
    this.fill.position.copy(camera.position).add(this.fillOffset);
    this.fill.target.updateMatrixWorld();
  }

  private readonly fillOffset = new THREE.Vector3(0, 6, 0);

  // --- Frustum -----------------------------------------------------------------------------

  /** Take the camera's frustum for this frame (call after the camera moved). */
  setCamera(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
  }

  /** Is a sphere round track point (s, lateral, y) in the camera frustum (with margin)? */
  private inFrustum(s: number, lateral: number, y: number, radius: number): boolean {
    this.space.point(s, lateral, y, this.sphere.center);
    this.sphere.radius = radius + FRUSTUM_MARGIN;
    return this.frustum.intersectsSphere(this.sphere);
  }

  // --- Fades -------------------------------------------------------------------------------

  private static newFade(): Fade {
    return { alpha: 1, originals: null, clones: [] };
  }

  /** Ease the object's opacity towards `target`; clones its materials lazily, restores them when clear. */
  private applyFade(root: THREE.Object3D, fade: Fade, target: number, dt: number): void {
    // Fast to fade out (something is in the way), a little slower back in.
    const rate = target < fade.alpha ? 14 : 6;
    fade.alpha += (target - fade.alpha) * Math.min(1, dt * rate);
    if (target >= 1 && fade.alpha > 0.985) fade.alpha = 1;
    if (fade.alpha >= 1) {
      if (fade.originals) this.restore(fade);
      return;
    }
    if (!fade.originals) {
      fade.originals = new Map();
      this.created.faded++;
      const cloneOf = new Map<THREE.Material, THREE.Material>();
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats = o.material as THREE.Material | THREE.Material[];
        fade.originals?.set(o, mats);
        const swap = (m: THREE.Material): THREE.Material => {
          let c = cloneOf.get(m);
          if (!c) {
            c = m.clone();
            c.transparent = true;
            c.depthWrite = true;
            cloneOf.set(m, c);
            fade.clones.push(c);
          }
          return c;
        };
        o.material = Array.isArray(mats) ? mats.map(swap) : swap(mats);
      });
    }
    for (const c of fade.clones) c.opacity = fade.alpha;
  }

  private restore(fade: Fade): void {
    if (fade.originals) for (const [mesh, mats] of fade.originals) mesh.material = mats;
    for (const c of fade.clones) c.dispose();
    fade.originals = null;
    fade.clones = [];
  }

  // --- Obstacles and pickups ---------------------------------------------------------------

  knock(id: number, dir: number): void {
    const view = this.obstacles.get(id);
    if (view && !view.knocked) view.knocked = { t: 0, dir };
  }

  /** An oncoming vehicle flashes its headlights. */
  flash(id: number): void {
    const view = this.obstacles.get(id);
    if (view) view.flashT = 1.1;
  }

  /** Obstacles use their full seed (many liveries and colours), so they are not pooled. */
  private takeObstacle(spawn: ObstacleSpawn): ObstacleView {
    // Oncoming vehicles are turned by the art to face the runner (lit); same-direction ones keep
    // the parked orientation (front towards -Z: you see their tail lights).
    // Pedestrians walk when they move (either way); street-wide obstacles span the street here.
    const moving = spawn.kind === "peaton" ? spawn.k !== 0 : spawn.k > 0;
    const key = `${spawn.kind}|${moving ? 1 : 0}|${spawn.span?.toFixed(1) ?? ""}|${spawn.seed % 4}`;
    const pooled = this.obstaclePool.get(key)?.pop();
    const obj = pooled ?? this.art.createObstacle(spawn.kind, spawn.seed, moving, spawn.span);
    obj.userData["poolKey"] = key;
    obj.visible = true;
    obj.scale.set(1, 1, 1);
    obj.userData["role"] = spawn.role ?? (spawn.k !== 0 ? "driving" : undefined);
    obj.userData["moving"] = spawn.k !== 0;
    this.created.obstacles++;
    const wheels: THREE.Object3D[] = [];
    obj.traverse((o) => {
      if (/^wheel/i.test(o.name)) wheels.push(o);
    });
    const def = OBSTACLE_DEFS[spawn.kind];
    const view: ObstacleView = {
      obj, spawn, knocked: null, seen: this.frame, fade: World.newFade(), wheels, body: obj.children[0] ?? null,
      wheelAngle: 0, phase: (spawn.seed % 97) * 0.37, drift: null, glows: [], flashT: 0, triangle: null,
    };
    const half = def.length / 2;
    if (spawn.k > 0 && def.vehicle) {
      // Headlights at the front (+Z for oncoming vehicles).
      for (const sx of [-1, 1]) {
        const g = glowSprite(0xfff2c8);
        g.position.set(sx * (def.width / 2 - 0.3), Math.min(0.85, def.yMax * 0.55), half + 0.15);
        g.visible = false;
        obj.add(g);
        view.glows.push(g);
      }
    } else if (spawn.role === "broken") {
      // Hazard lights at the rear (+Z for a parked car) and a warning triangle behind it.
      for (const sx of [-1, 1]) {
        const g = glowSprite(0xffa020);
        g.position.set(sx * (def.width / 2 - 0.15), 0.95, half + 0.1);
        obj.add(g);
        view.glows.push(g);
      }
      const tri = warningTriangle();
      tri.position.set(0.75, 0, half + 3);
      obj.add(tri);
      view.triangle = tri;
    }
    return view;
  }

  private dropObstacle(view: ObstacleView): void {
    this.restore(view.fade);
    for (const g of view.glows) {
      g.removeFromParent();
      g.material.dispose();
    }
    view.triangle?.removeFromParent();
    this.scene.remove(view.obj);
    // Pool it (same kind, direction, span and variant group) instead of rebuilding next time.
    const key = view.obj.userData["poolKey"] as string | undefined;
    let pool = key ? this.obstaclePool.get(key) : undefined;
    if (key && !pool) this.obstaclePool.set(key, (pool = []));
    if (pool && pool.length < 6) {
      if (view.body) {
        view.body.position.y = 0;
        view.body.rotation.z = 0;
      }
      pool.push(view.obj);
    } else {
      this.art.release(view.obj);
      this.created.released++;
    }
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
    this.restore(view.fade);
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
    this.bellotas.begin();
    this.bellotas.end(this.space, 0);
    for (const view of this.obstacles.values()) this.dropObstacle(view);
    this.obstacles.clear();
    for (const view of this.pickups.values()) this.dropPickup(view);
    this.pickups.clear();
  }

  /**
   * Bring the meshes in line with the run at (interpolated) distance `p`. `alpha` interpolates
   * per-tick state (magnet pulls); `camera` must already be in its final pose for this frame
   * (call `setCamera` first); `chest` is the runner's chest (for occlusion fades).
   */
  /**
   * Bring the meshes in line with the run at (interpolated) distance `p`. `alpha` interpolates
   * per-tick state (magnet pulls). `camera` and `chest` are the camera and the runner's chest in
   * track space (x = lateral, y = height above the road, z = -s) for the fades; call `setCamera`
   * first (frustum).
   */
  sync(run: Run, p: number, alpha: number, dt: number, time: number, camera: THREE.Vector3, chest: THREE.Vector3): void {
    this.frame++;
    this.lastP = p;
    const frame = this.frame;
    const space = this.space;
    const ended = run.phase === "ending" || run.phase === "over";
    const list = run.gen.obstacles;
    // First spawn that could still be on screen (a same-direction vehicle 30 m behind met the
    // runner up to ~70 m back).
    let lo = 0;
    let hi = list.length;
    const from = p - 140;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid];
      if (s && s.d < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length; i++) {
      const spawn = list[i];
      if (!spawn || spawn.d > p + OBSTACLE_VIEW / 0.44) break;
      if (run.removed.has(spawn.id)) continue; // Cleared for a stork landing (with a burst).
      const def = OBSTACLE_DEFS[spawn.kind];
      const half = def.length / 2;
      const c = obstacleCentre(spawn, p);
      let view = this.obstacles.get(spawn.id);
      if (!view) {
        if (c - half > p + OBSTACLE_VIEW) continue; // Not in view yet (beyond the fog).
        if (c + half < p) continue; // Never seen and already behind: do not pop it in.
        if (run.ignore.has(spawn.id) && c < p) continue;
        view = this.takeObstacle(spawn);
        // Far away it fades in rather than popping into the view.
        if (c - p > 40) view.fade.alpha = 0;
        this.obstacles.set(spawn.id, view);
        this.scene.add(view.obj);
      }
      const obj = view.obj;
      const x = spawn.x;
      // Visual-only braking after the run ended.
      let shown = c;
      if (ended && spawn.k !== 0) {
        if (!view.drift) {
          const v = run.crashedId === spawn.id ? 0 : obstacleRate(spawn, run.player.p) * run.endSpeed;
          const inLane = Math.abs(x - run.player.x) < def.width / 2 + 0.5;
          const room = inLane ? 1.5 : 5;
          view.drift = { x: 0, v, a: Math.max(4, (v * v) / (2 * room)) };
        }
        const dr = view.drift;
        const dv = Math.min(Math.abs(dr.v), dr.a * dt) * Math.sign(dr.v);
        dr.x += (dr.v - dv / 2) * dt;
        dr.v -= dv;
        shown = c + dr.x;
      }
      // Off screen and well behind the runner: gone.
      const behind = shown + half < p - KEEP_BEHIND;
      if (behind && !ended && !this.inFrustum(shown, x, def.yMax / 2, Math.max(half, def.width / 2, def.yMax))) continue;
      view.seen = frame;
      if (view.knocked) {
        const k = view.knocked;
        k.t += dt;
        const kx = x + k.dir * 9 * k.t;
        const ky = Math.max(0, 6 * k.t - 9 * k.t * k.t);
        space.place(obj, shown + 2 * k.t, kx, ky);
        obj.rotation.z = -k.dir * k.t * 4;
        obj.rotation.x += k.t * 2;
        obj.visible = k.t < 1.1;
        continue;
      }
      // Along the track, pitched with the slope; people stay upright and face the way they walk.
      const person = spawn.kind === "peaton";
      const yaw = (spawn.k === 0 && spawn.flipped) || (person && spawn.k < 0) ? Math.PI : 0;
      space.place(obj, shown, x, 0, yaw, person ? 0 : 1);
      // Driving: wheels turn, the body bobs and sways a touch.
      const rate = ended ? (view.drift?.v ?? 0) / Math.max(1, run.endSpeed) : obstacleRate(spawn, p);
      const worldSpeed = Math.abs(rate) * (ended ? run.endSpeed : run.player.speed);
      if (spawn.k !== 0 && def.vehicle) {
        view.wheelAngle += (worldSpeed / 0.4) * dt;
        for (const w of view.wheels) w.rotation.x = -view.wheelAngle;
        if (view.body) {
          const amp = Math.min(1, worldSpeed / 8);
          view.phase += dt * (5 + worldSpeed * 0.25);
          view.body.position.y = 0.012 * amp * Math.sin(view.phase);
          view.body.rotation.z = 0.006 * amp * Math.sin(view.phase * 0.53 + 1.3);
        }
      }
      // Lights.
      if (view.glows.length > 0) {
        view.flashT = Math.max(0, view.flashT - dt);
        const on = spawn.role === "broken" ? Math.sin(time * Math.PI * 3) > 0 : view.flashT > 0 && Math.sin(view.flashT * Math.PI * 7) > -0.2;
        for (const g of view.glows) {
          g.visible = on;
          g.scale.setScalar(spawn.role === "broken" ? 0.55 : 1.6);
        }
      }
      // Fade near the lens, or while standing between the camera and the runner (track space).
      const span = spawn.span ?? def.width;
      const x0 = x - span / 2;
      const x1 = x + span / 2;
      const z0 = -shown - half;
      const z1 = -shown + half;
      const dist = boxDistance(camera, x0, x1, def.yMin, def.yMax + 0.3, z0, z1);
      const standingOn = run.player.supportId === spawn.id;
      const blocks = !standingOn && dist < 14 &&
        segmentHitsBox(camera.x, camera.y, camera.z, chest.x, chest.y, chest.z, x0 + 0.15, x1 - 0.15, def.yMin, def.yMax - 0.05, z0 + 0.15, z1 - 0.15);
      this.applyFade(obj, view.fade, fadeTarget(dist, blocks), dt);
      obj.visible = view.fade.alpha > 0.02;
    }
    for (const [id, view] of this.obstacles) {
      if (view.seen !== frame) {
        this.dropObstacle(view);
        this.obstacles.delete(id);
      }
    }

    // Pickups.
    this.bellotas.begin();
    const pickups = run.gen.pickups;
    lo = 0;
    hi = pickups.length;
    const pFrom = p - 60;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = pickups[mid];
      if (s && s.d < pFrom) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < pickups.length; i++) {
      const spawn = pickups[i];
      if (!spawn || spawn.d > p + PICKUP_VIEW + 60) break;
      let view = this.pickups.get(spawn.id);
      const missed = run.missed.has(spawn.id);
      if (run.taken.has(spawn.id) && !missed) continue;
      if (missed && !view) continue;
      const d = pickupD(spawn, p);
      if (!view && (d > p + PICKUP_VIEW || d < p)) continue;
      let key = view?.key ?? spawn.kind;
      let letter: string | undefined;
      if (spawn.kind === "letra" && !missed) {
        const index = run.letterFor(spawn.id);
        if (index < 0) continue;
        letter = WORD[index];
        key = `letra|${letter ?? ""}`;
      }
      if (view && view.key !== key) {
        this.dropPickup(view);
        this.pickups.delete(spawn.id);
        view = undefined;
      }
      const pulled = run.magnet.get(spawn.id);
      let px = spawn.x;
      let py = spawn.y;
      let pd = d;
      if (pulled) {
        px = pulled.px + (pulled.x - pulled.px) * alpha;
        py = pulled.py + (pulled.y - pulled.py) * alpha;
        pd = pulled.pd + (pulled.d - pulled.pd) * alpha;
      }
      if (pd < p - KEEP_BEHIND && !this.inFrustum(pd, px, py, 0.6)) continue;
      // Bellotas: one instanced batch (2 draw calls for all of them), no per-coin objects.
      if (spawn.kind === "bellota" && this.bellotas.ready(this.art)) {
        const dist = Math.hypot(px - camera.x, py - camera.y, -pd - camera.z);
        if (dist > 0.6) this.bellotas.add(spawn.id, pd, px, py);
        continue;
      }
      if (!view) {
        const { mesh } = this.takePickup(spawn.kind, letter);
        view = { mesh, spawn, key, seen: frame, fade: World.newFade() };
        if (pd - p > 40) view.fade.alpha = 0;
        this.pickups.set(spawn.id, view);
        this.scene.add(mesh.root);
      }
      view.seen = frame;
      const root = view.mesh.root;
      space.place(root, pd, px, py, 0, 0);
      const dist = Math.max(0, Math.hypot(px - camera.x, py - camera.y, -pd - camera.z) - 0.35);
      this.applyFade(root, view.fade, fadeTarget(dist, false), dt);
      root.visible = view.fade.alpha > 0.02;
      view.mesh.update(dt, time);
    }
    for (const [id, view] of this.pickups) {
      if (view.seen !== frame) {
        this.dropPickup(view);
        this.pickups.delete(id);
      }
    }
    this.bellotas.end(space, time);
  }

  counts(): Record<string, number> {
    let pp = 0;
    for (const pool of this.pickupPool.values()) pp += pool.length;
    let fading = 0;
    for (const v of this.obstacles.values()) if (v.fade.originals) fading++;
    return {
      obstacles: this.obstacles.size, pickups: this.pickups.size, pooledPickups: pp, fading,
      createdObstacles: this.created.obstacles, releasedObstacles: this.created.released,
      createdPickups: this.created.pickups, releasedPickups: this.created.pickupsReleased,
    };
  }

  /**
   * Debug: renderable objects that pass the frustum (≈ draw calls; one per material group), by
   * owner: the city, obstacles, pickups (bellotas batch included), characters, other.
   */
  drawBreakdown(): Record<string, number> {
    const out: Record<string, number> = { city: 0, obstacles: 0, pickups: 0, characters: 0, other: 0 };
    const owner = new Map<THREE.Object3D, string>();
    if (this.cityScenery) owner.set(this.cityScenery.root, "city");
    if (this.ribbon) owner.set(this.ribbon, "city");
    for (const v of this.obstacles.values()) owner.set(v.obj, "obstacles");
    for (const v of this.pickups.values()) owner.set(v.mesh.root, "pickups");
    owner.set(this.runner.root, "characters");
    owner.set(this.waiter.root, "characters");
    const visit = (o: THREE.Object3D, tag: string): void => {
      if (!o.visible) return;
      const t = owner.get(o) ?? (o.name === "bellotas" || o instanceof THREE.Points ? "pickups" : tag);
      const r = o as THREE.Mesh;
      if (r.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine) {
        if (!o.frustumCulled || this.frustum.intersectsObject(o)) {
          const mats = Array.isArray(r.material) ? r.material.length : 1;
          const groups = (r.geometry as THREE.BufferGeometry | undefined)?.groups.length ?? 0;
          out[t] = (out[t] ?? 0) + Math.max(1, Math.min(mats, groups || 1));
        }
      }
      for (const c of o.children) visit(c, t);
    };
    for (const c of this.scene.children) visit(c, "other");
    return out;
  }

  /** Debug/verification: where each live obstacle is drawn (id, kind, z, visible, opacity). */
  debugObstacles(): { id: number; kind: string; k: number; x: number; z: number; visible: boolean; alpha: number }[] {
    return [...this.obstacles.values()].map((v) => ({
      id: v.spawn.id, kind: v.spawn.kind, k: Number(v.spawn.k.toFixed(2)), x: v.spawn.x, z: -Number(obstacleCentre(v.spawn, this.lastP).toFixed(2)),
      visible: v.obj.visible, alpha: Number(v.fade.alpha.toFixed(2)),
    }));
  }
}
