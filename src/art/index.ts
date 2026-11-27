/**
 * Procedural art for Badajoz Surfers: characters, obstacles, pickups, sky and zone scenery.
 * Everything is generated at runtime (no downloaded assets). Geometries and materials are shared
 * through module-level caches; `release` frees only per-instance geometry (scenery segments).
 */
import * as THREE from "three";
import type { ArtApi } from "../contracts";
import { createRunner, createWaiter } from "./characters";
import { createBlobShadow, createObstacle } from "./obstacles";
import { createPickup } from "./pickups";
import { createZoneScenery } from "./scenery";
import { createSkyDome } from "./sky";
import { configureRenderer, createCity } from "./city";

function release(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      if (g.userData["perInstance"] === true) g.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m.userData["perInstance"] === true) m.dispose();
    }
  });
  object.removeFromParent();
}

export const art: ArtApi = {
  createRunner,
  createWaiter,
  createObstacle,
  createPickup,
  createZoneScenery,
  createSkyDome,
  createCity,
  configureRenderer,
  createBlobShadow,
  release,
};
