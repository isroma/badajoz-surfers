/**
 * Pickups: the golden "bellota" (acorn) coin, the four power-ups inside glowing halos, and the
 * letter tiles of BADAJOZ. Geometry and materials are shared; each pickup is 1-4 draw calls.
 */
import * as THREE from "three";
import type { PickupKind, PickupMesh } from "../contracts";
import { Builder, T, xf } from "./geom";
import { glowTexture, letterMat, sparkleTexture } from "./text";

const GOLD = new THREE.MeshPhongMaterial({
  vertexColors: true,
  shininess: 90,
  specular: 0xfff1b0,
  emissive: 0xb07400,
  emissiveIntensity: 1,
  flatShading: true,
});

const ITEM = new THREE.MeshPhongMaterial({
  vertexColors: true,
  shininess: 60,
  specular: 0x666666,
  emissive: 0x222222,
  side: THREE.DoubleSide,
  flatShading: true,
});

const HALO_COLOURS: Record<Exclude<PickupKind, "bellota">, number> = {
  iman: 0xff4d4d,
  zapatillas: 0x3ee0ff,
  jamon: 0xffb347,
  patinete: 0x7dff6a,
  letra: 0xffe14d,
};

const geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, build: (b: Builder) => void): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    const b = new Builder();
    build(b);
    const mesh = b.build(true).children[0];
    if (!(mesh instanceof THREE.Mesh)) throw new Error("empty pickup geometry");
    g = mesh.geometry as THREE.BufferGeometry;
    geoCache.set(key, g);
  }
  return g;
}

function acorn(b: Builder): void {
  // nut
  b.add(T.sphere(12, 9), xf(0, -0.06, 0, 0.17, 0.21, 0.17), 0xffd23a, GOLD);
  b.add(T.cone(10), xf(0, -0.3, 0, 0.05, 0.08, 0.05, Math.PI, 0, 0), 0xe8a312, GOLD);
  // cupule (scaly cap) and stem
  b.add(T.dome(12, 4), xf(0, 0.05, 0, 0.2, 0.15, 0.2), 0xd08a2a, GOLD);
  b.add(T.torus(Math.PI * 2, 0.25, 5, 14), xf(0, 0.05, 0, 0.19, 0.19, 0.19, Math.PI / 2, 0, 0), 0xb87420, GOLD);
  b.cyl(0, 0.18, 0, 0.025, 0.1, 0x7a4a10, 6, GOLD);
}

function magnet(b: Builder): void {
  b.add(T.torus(Math.PI, 0.38, 8, 14), xf(0, 0.02, 0, 0.22, 0.22, 0.22), 0xe0262b, ITEM);
  for (const sx of [-1, 1]) {
    b.add(T.cyl(10), xf(sx * 0.22, -0.08, 0, 0.085, 0.2, 0.085), 0xe0262b, ITEM);
    b.add(T.cyl(10), xf(sx * 0.22, -0.24, 0, 0.087, 0.13, 0.087), 0xdfe4ea, ITEM);
  }
}

function trainer(b: Builder): void {
  // sole, upper, toe cap, laces, heel tab; toe towards -X so it reads in profile
  b.box(0, -0.13, 0, 0.5, 0.06, 0.2, 0xffffff, ITEM);
  b.box(0, -0.165, 0, 0.5, 0.02, 0.2, 0x18c29c, ITEM);
  b.add(T.capsule(1.2, 4, 10), xf(0.03, -0.03, 0, 0.1, 0.18, 0.095, 0, 0, Math.PI / 2), 0xff6a13, ITEM);
  b.box(0.12, 0.06, 0, 0.16, 0.2, 0.17, 0xff6a13, ITEM);
  b.box(-0.17, -0.07, 0, 0.14, 0.08, 0.18, 0xffffff, ITEM);
  for (let i = 0; i < 3; i++) b.box(-0.02 + i * 0.05, 0.035 + i * 0.012, 0, 0.02, 0.02, 0.14, 0xffffff, ITEM);
  b.box(0.2, 0.17, 0, 0.04, 0.08, 0.06, 0x1e88e5, ITEM);
  // wings
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const z = sz * 0.1;
      b.tri([0.12, 0.05, z], [0.18 + k * 0.08, 0.36 - k * 0.07, z + sz * (0.12 + k * 0.03)], [0.28 + k * 0.06, 0.12 - k * 0.02, z + sz * 0.06], 0xffffff, ITEM);
    }
  }
}

function ham(b: Builder): void {
  // Iberian ham leg: plump rounded body tapering to the shank and the black hoof
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [[0, -0.3], [0.12, -0.28], [0.19, -0.2], [0.21, -0.08], [0.18, 0.04], [0.12, 0.12], [0.06, 0.2], [0.045, 0.3], [0.045, 0.34]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(pts, 10);
  b.add(lathe, xf(0, 0, 0, 1, 1, 0.75, 0, 0, -0.5), 0x8a3320, ITEM);
  // cut face showing the marbled meat
  b.add(T.cyl(10), xf(0.04, -0.06, 0.1, 0.13, 0.02, 0.1, Math.PI / 2, 0, -0.5), 0xd8574a, ITEM);
  b.add(T.cyl(10), xf(0.04, -0.06, 0.111, 0.08, 0.01, 0.06, Math.PI / 2, 0, -0.5), 0xf3c8b8, ITEM);
  // hoof and string
  b.add(T.cone(6), xf(0.2, 0.39, 0, 0.05, 0.1, 0.04, 0, 0, -0.5 + Math.PI), 0x1a1a1a, ITEM);
  b.add(T.torus(Math.PI * 2, 0.2, 4, 10), xf(0.15, 0.3, 0, 0.05, 0.05, 0.05, 0, 0, -0.5), 0xf4e3c0, ITEM);
}

function scooter(b: Builder): void {
  b.box(0, -0.2, 0, 0.12, 0.04, 0.5, 0x1d1f24, ITEM);
  b.box(0, -0.18, 0, 0.1, 0.01, 0.46, 0x18c29c, ITEM);
  b.add(T.cyl(10), xf(0, -0.24, -0.26, 0.07, 0.04, 0.07, 0, 0, Math.PI / 2), 0x111111, ITEM);
  b.add(T.cyl(10), xf(0, -0.24, 0.26, 0.07, 0.04, 0.07, 0, 0, Math.PI / 2), 0x111111, ITEM);
  b.beam([0, -0.2, -0.24], [0, 0.3, -0.3], 0.03, 0x18c29c, ITEM, 6);
  b.beam([-0.15, 0.3, -0.3], [0.15, 0.3, -0.3], 0.025, 0x1d1f24, ITEM, 6);
  b.box(0, 0.2, -0.32, 0.05, 0.04, 0.03, 0xfff6d8, ITEM);
}

const ITEM_BUILD: Record<"iman" | "zapatillas" | "jamon" | "patinete", (b: Builder) => void> = {
  iman: magnet,
  zapatillas: trainer,
  jamon: ham,
  patinete: scooter,
};

const haloMats = new Map<string, { ring: THREE.MeshBasicMaterial; sprite: THREE.SpriteMaterial }>();

function halo(kind: Exclude<PickupKind, "bellota">): { ring: THREE.Mesh; sprite: THREE.Sprite } {
  let m = haloMats.get(kind);
  if (!m) {
    const color = HALO_COLOURS[kind];
    m = {
      ring: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      sprite: new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    haloMats.set(kind, m);
  }
  const ring = new THREE.Mesh(T.torus(Math.PI * 2, 0.06, 6, 32), m.ring);
  ring.scale.setScalar(0.46);
  const sprite = new THREE.Sprite(m.sprite);
  sprite.scale.setScalar(1.35);
  return { ring, sprite };
}

let BELLOTA_SPARK: THREE.SpriteMaterial | null = null;

const LETTER_EDGE = new THREE.MeshLambertMaterial({ color: 0xffb703, emissive: 0x7a4a00 });

export function createPickup(kind: PickupKind, letter?: string): PickupMesh {
  const root = new THREE.Group();
  root.name = `pickup:${kind}`;
  const spinner = new THREE.Group();
  root.add(spinner);
  let ring: THREE.Mesh | null = null;
  let sprite: THREE.Sprite | null = null;

  if (kind === "bellota") {
    const mesh = new THREE.Mesh(cachedGeo("bellota", acorn), GOLD);
    mesh.castShadow = true;
    mesh.rotation.z = 0.25;
    spinner.add(mesh);
    // one shared sparkle billboard behind the acorn: 2 draw calls per coin
    if (!BELLOTA_SPARK) {
      BELLOTA_SPARK = new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false, opacity: 0.85 });
    }
    sprite = new THREE.Sprite(BELLOTA_SPARK);
    sprite.scale.setScalar(0.95);
    sprite.renderOrder = 1;
    root.add(sprite);
  } else {
    if (kind === "letra") {
      const ch = (letter ?? "B").slice(0, 1).toUpperCase();
      const edge = new THREE.Mesh(T.box, LETTER_EDGE);
      edge.scale.set(0.62, 0.62, 0.14);
      const faces = new THREE.Mesh(cachedGeo("letter-faces", (b) => {
        b.quad(xf(0, 0, 0.071, 0.6, 0.6, 1), 0xffffff, ITEM);
        b.quad(xf(0, 0, -0.071, 0.6, 0.6, 1, 0, Math.PI, 0), 0xffffff, ITEM);
      }), letterMat(ch));
      spinner.add(edge, faces);
    } else {
      const mesh = new THREE.Mesh(cachedGeo(kind, ITEM_BUILD[kind]), ITEM);
      mesh.castShadow = true;
      spinner.add(mesh);
    }
    const h = halo(kind);
    ring = h.ring;
    sprite = h.sprite;
    root.add(sprite, ring);
  }

  const phase = Math.random() * Math.PI * 2;
  return {
    root,
    update(dt, t) {
      spinner.rotation.y += dt * (kind === "letra" ? 1.6 : 2.6);
      spinner.position.y = Math.sin(t * 3 + phase) * 0.07;
      if (ring) {
        ring.rotation.y += dt * 1.3;
        ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.7 + phase) * 0.35;
        ring.position.y = spinner.position.y * 0.5;
      }
      if (sprite && kind === "bellota") {
        sprite.scale.setScalar(0.85 + 0.15 * Math.sin(t * 6 + phase));
        sprite.position.y = spinner.position.y;
        sprite.material.rotation = t * 0.8;
      } else if (sprite) sprite.material.opacity = 0.6 + 0.2 * Math.sin(t * 5 + phase);
    },
  };
}
