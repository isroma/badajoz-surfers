/**
 * The real city of Badajoz round the lap, streamed by route chunks.
 *
 * Permanent layers (built in `preload`, or on the first update): terrain + river, every building
 * extruded with facades, the street network, far trees, landmarks and bridges (the skyline).
 * Route chunks (CHUNK m of s): the road surface and markings, building relief and shop signs,
 * detailed trees, street furniture. Chunks within [s - BEHIND, s + AHEAD] are built nearest first
 * under a per-frame time budget, and disposed when they fall out of range.
 */
import * as THREE from "three";
import type { CityScenery } from "../../contracts";
import type { CityData } from "../../city/data";
import { cityAtmosphere, refreshEnvironment } from "./atmosphere";
import { Bag, TS } from "./bag";
import { buildAllBuildings } from "./buildings";
import { buildContext, CHUNK, type CityCtx } from "./context";
import { buildGround, type GroundLayer } from "./ground";
import { buildRoadChunk, type EdgeSample } from "./road";
import { animateSigns } from "./relief";
import { U, clearChunkMask, setChunkMasked } from "./shared";
import { skylineVariant } from "./cmats";
import type { Track } from "./track";
import { buildNetwork } from "./network";
import { buildChunkDressing, buildPermanentDressing, setNightDressing, type DressingPass } from "./dressing";
import { buildLandmarks } from "./landmarks";

export interface CityStats {
  chunks: number;
  built: number;
  lastBuildMs: number;
  buildMs: Map<number, number>;
  tris: Map<number, number>;
}

const AHEAD = 440;
const BEHIND = 90;
const KEEP_AHEAD = 620;
const KEEP_BEHIND = 160;
/** Chunks this close get the full dressing (trees, relief, furniture); farther ones only the road. */
const NEAR_AHEAD = 230;
const NEAR_BEHIND = 70;
const BUDGET_MS = 4;
/** Permanent meshes farther than this (beyond the fog) are hidden. */
const CULL_FAR = 1050;
/** Landmarks, bridges and terrain: the long view (needs the engine's camera far ≥ 3500 m). */
const SKYLINE_FAR = 3400;

export interface CityInternals extends CityScenery {
  ctx: CityCtx;
  ground: GroundLayer | null;
  stats: CityStats;
  chunkGroup(i: number): THREE.Group | undefined;
  /** Build one chunk synchronously (stats views). */
  buildChunkNow(i: number): number;
  /** Drop every chunk outside the wanted range round s (no hysteresis; leak test). */
  trim(s: number): void;
}

export function createCity(city: CityData, track: Track): CityInternals {
  const root = new THREE.Group();
  root.name = "city";
  const ctx = buildContext(city, track);
  const ts = new TS(track);
  const chunks = new Map<number, THREE.Group>();
  const fullChunks = new Set<number>();
  const chunkRoot = new THREE.Group();
  chunkRoot.name = "chunks";
  root.add(chunkRoot);
  let permanent: THREE.Group | null = null;
  const cullList: { o: THREE.Object3D; c: THREE.Vector3; r: number; max: number }[] = [];
  const camPos = new THREE.Vector3();
  let ground: GroundLayer | null = null;
  const stats: CityStats = { chunks: ctx.nChunks, built: 0, lastBuildMs: 0, buildMs: new Map(), tris: new Map() };
  let t0 = performance.now();
  let lastLap = -1;
  clearChunkMask();

  const ensurePermanent = (): void => {
    if (permanent) return;
    permanent = new THREE.Group();
    permanent.name = "permanent";
    ground = buildGround(ctx);
    permanent.add(ground.group);
    const buildings = buildAllBuildings(ctx);
    permanent.add(buildings);
    permanent.add(buildNetwork(ctx, ground));
    permanent.add(buildPermanentDressing(ctx, ground));
    const landmarks = buildLandmarks(ctx, ground);
    permanent.add(landmarks);
    permanent.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    root.add(permanent);
    // the skyline (landmarks, bridges, the terrain) stays visible far beyond the city fog
    for (const grp of [landmarks, ground.group, buildings]) {
      grp.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial && !o.name.startsWith("far-")) {
          o.material = skylineVariant(o.material);
          o.userData["skyline"] = true;
        }
      });
    }
    // distance culling list (bounding spheres in world space)
    permanent.updateMatrixWorld(true);
    permanent.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = o.geometry as THREE.BufferGeometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const sph = geo.boundingSphere!.clone().applyMatrix4(o.matrixWorld);
      if (sph.radius > 2500) return;
      const detail = o.parent?.name.endsWith("-detail") ?? false;
      cullList.push({ o, c: sph.center, r: sph.radius, max: detail ? 420 : o.userData["skyline"] === true ? SKYLINE_FAR : CULL_FAR });
    });
  };

  const edgesOf = new Map<number, EdgeSample[]>();
  /** Build a chunk's road (pass "road") or add its detail (pass "detail"). */
  const DETAIL_PASSES: DressingPass[] = ["trees", "furniture", "relief"];
  const detailDone = new Map<number, number>();
  /** Build a chunk's road (pass "road") or its next detail pass (trees, furniture, relief: one per call, so no frame does too much). */
  const buildChunk = (i: number, pass: "road" | "detail" = "road"): number => {
    const start = performance.now();
    const s0 = i * CHUNK;
    const s1 = Math.min(track.lapLength, s0 + CHUNK);
    const bag = new Bag();
    let g = chunks.get(i);
    if (pass === "road" || !g) {
      g = new THREE.Group();
      g.name = `chunk-${i}`;
      const road = buildRoadChunk(ctx, bag, ts, s0, s1);
      edgesOf.set(i, road.edges);
      if (ground) buildChunkDressing(ctx, bag, ts, i, s0, s1, road.edges, ground, "road");
      bag.build(g);
      // the road pass (surfaces, kerbs, lamps) casts no shadows: half the shadow-pass draw calls
      for (const c of g.children) c.castShadow = false;
      chunkRoot.add(g);
      chunks.set(i, g);
    } else {
      const step = detailDone.get(i) ?? 0;
      const dp = DETAIL_PASSES[step] ?? "relief";
      const d = new THREE.Group();
      d.name = `chunk-${i}-${dp}`;
      if (ground) buildChunkDressing(ctx, bag, ts, i, s0, s1, edgesOf.get(i) ?? [], ground, dp);
      bag.build(d);
      g.add(d);
      detailDone.set(i, step + 1);
      if (dp === "trees") setChunkMasked(i, true);
      if (step + 1 >= DETAIL_PASSES.length) fullChunks.add(i);
    }
    g.updateMatrixWorld(true);
    const ms = performance.now() - start;
    stats.buildMs.set(i, Math.max(ms, pass === "detail" ? stats.buildMs.get(i) ?? 0 : 0));
    stats.tris.set(i, (pass === "detail" ? stats.tris.get(i) ?? 0 : 0) + bag.triangles);
    stats.built++;
    stats.lastBuildMs = ms;
    return ms;
  };

  const dropChunk = (i: number): void => {
    const g = chunks.get(i);
    if (!g) return;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geo = o.geometry as THREE.BufferGeometry;
        if (geo.userData["perInstance"] === true) geo.dispose();
      }
    });
    g.removeFromParent();
    chunks.delete(i);
    edgesOf.delete(i);
    detailDone.delete(i);
    fullChunks.delete(i);
    setChunkMasked(i, false);
  };

  const n = ctx.nChunks;
  const rel = (i: number, s: number): number => {
    // signed distance (in s) from s to the chunk's nearest edge, wrapped
    const L = track.lapLength;
    const a = i * CHUNK;
    let d = a - s;
    d = ((d % L) + L) % L;
    if (d > L / 2) d -= L;
    return d;
  };
  const wanted = (s: number, ahead: number, behind: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = rel(i, s);
      if (d + CHUNK > -behind && d < ahead) out.push(i);
    }
    return out.sort((p, q) => Math.abs(rel(p, s) + CHUNK / 2) * (rel(p, s) < 0 ? 2 : 1) - Math.abs(rel(q, s) + CHUNK / 2) * (rel(q, s) < 0 ? 2 : 1));
  };

  const applyLap = (lap: number): void => {
    if (lap === lastLap) return;
    lastLap = lap;
    const night = lap % 2 === 0;
    U.uNight.value = night ? 1 : 0;
    setNightDressing(night);
  };

  const api: CityInternals = {
    root,
    ctx,
    get ground() {
      return ground;
    },
    stats,
    chunkGroup: (i) => chunks.get(i),
    buildChunkNow: (i) => {
      ensurePermanent();
      dropChunk(i);
      let ms = buildChunk(i, "road");
      while (!fullChunks.has(i)) ms += buildChunk(i, "detail");
      return ms;
    },
    trim(s) {
      const keep = new Set(wanted(s, AHEAD, BEHIND));
      for (const i of [...chunks.keys()]) if (!keep.has(i)) dropChunk(i);
      for (const i of [...detailDone.keys()]) {
        const d = rel(i, s);
        if (!(d + CHUNK > -NEAR_BEHIND && d < NEAR_AHEAD)) dropChunk(i);
      }
    },
    update(s, lap, camera) {
      const now = performance.now();
      camera.getWorldPosition(camPos);
      for (const e of cullList) e.o.visible = e.c.distanceTo(camPos) - e.r < e.max;
      U.uTime.value = (now - t0) / 1000;
      animateSigns(U.uTime.value, lap % 2 === 0);
      applyLap(lap);
      refreshEnvironment(cityAtmosphere(track.zoneAt(s).id, lap));
      if (!permanent) {
        ensurePermanent();
        return;
      }
      // unload
      for (const i of [...chunks.keys()]) {
        const d = rel(i, s);
        if (d + CHUNK < -KEEP_BEHIND || d > KEEP_AHEAD) dropChunk(i);
      }
      // load, nearest first, within the time budget; upgrade chunks coming near to full dressing
      const start = performance.now();
      for (const i of wanted(s, AHEAD, BEHIND)) {
        const d = rel(i, s);
        const full = d + CHUNK > -NEAR_BEHIND && d < NEAR_AHEAD;
        if (!chunks.has(i)) buildChunk(i, "road");
        else if (full && !fullChunks.has(i)) buildChunk(i, "detail");
        else continue;
        if (performance.now() - start > BUDGET_MS) break;
      }
    },
    atmosphereAt(s, lap) {
      return cityAtmosphere(track.zoneAt(s).id, lap);
    },
    preload(s, lap) {
      applyLap(lap);
      ensurePermanent();
      for (const i of wanted(s, AHEAD, BEHIND)) {
        const d = rel(i, s);
        const full = d + CHUNK > -NEAR_BEHIND && d < NEAR_AHEAD;
        if (!chunks.has(i)) buildChunk(i, "road");
        while (full && !fullChunks.has(i)) buildChunk(i, "detail");
      }
    },
    dispose() {
      for (const i of [...chunks.keys()]) dropChunk(i);
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const geo = o.geometry as THREE.BufferGeometry;
          if (geo.userData["perInstance"] === true) geo.dispose();
        }
      });
      root.removeFromParent();
      clearChunkMask();
      t0 = 0;
    },
  };
  return api;
}

export { configureRenderer } from "./atmosphere";
