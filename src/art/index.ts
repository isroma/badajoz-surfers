// STUB: placeholder boxes that satisfy the contract. Replaced by the real procedural art.
import * as THREE from "three";
import {
  OBSTACLE_DEFS,
  ROAD_HALF_WIDTH,
  SEGMENT_LENGTH,
  type Actor,
  type ArtApi,
  type ObstacleKind,
  type PickupKind,
  type PickupMesh,
  type ZoneId,
  type ZoneScenery,
} from "../contracts";

const box = (w: number, h: number, l: number, color: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshLambertMaterial({ color }));
  mesh.position.y = h / 2;
  return mesh;
};

function actor(color: number): Actor {
  const root = new THREE.Group();
  const body = box(0.6, 1.8, 0.4, color);
  root.add(body);
  return {
    root,
    update(_dt, anim) {
      body.scale.y = anim === "roll" ? 0.4 : 1;
      body.position.y = anim === "roll" ? 0.36 : 0.9;
    },
  };
}

export const art: ArtApi = {
  createRunner: () => actor(0xe4572e),
  createWaiter: () => actor(0x222222),
  createObstacle(kind: ObstacleKind, seed: number) {
    const def = OBSTACLE_DEFS[kind];
    const group = new THREE.Group();
    const mesh = box(def.width, def.yMax - def.yMin, def.length, new THREE.Color().setHSL((seed * 0.137) % 1, 0.6, 0.5).getHex());
    mesh.position.y += def.yMin;
    group.add(mesh);
    return group;
  },
  createPickup(kind: PickupKind): PickupMesh {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshLambertMaterial({ color: kind === "bellota" ? 0xc8862a : 0x3fa7ff })));
    return { root, update: (dt) => void (root.rotation.y += dt * 3) };
  },
  createZoneScenery(_zone: ZoneId): ZoneScenery {
    return {
      atmosphere: {
        skyTop: 0x4a90d9, skyBottom: 0xcfe8ff, fogColor: 0xcfe8ff, fogNear: 60, fogFar: 220,
        sunColor: 0xfff2d6, sunIntensity: 2.2, sunPosition: [30, 60, 20], ambientColor: 0xbfd4ff, ambientIntensity: 1.1,
      },
      buildSegment(index) {
        const group = new THREE.Group();
        const road = box(ROAD_HALF_WIDTH * 2, 0.1, SEGMENT_LENGTH, index % 2 ? 0x555a60 : 0x4c5157);
        road.position.set(0, -0.05, -SEGMENT_LENGTH / 2);
        group.add(road);
        return group;
      },
    };
  },
  createSkyDome() {
    const material = new THREE.MeshBasicMaterial({ color: 0x9cc9f5, side: THREE.BackSide, fog: false });
    return { mesh: new THREE.Mesh(new THREE.SphereGeometry(400, 16, 8), material), setColors: (top) => void material.color.copy(top) };
  },
  release() {},
};
