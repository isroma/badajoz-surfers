/**
 * Pedestrians ("peaton" obstacles): eight kinds of people of Badajoz — a man in shirt and jeans,
 * a woman with a handbag, an abuela with her shopping trolley, a tourist with camera and hat, a
 * mother pushing a pram, a teenager on the phone, an old man with cap and walking stick, an
 * office worker with a briefcase — with varied clothes per seed. One merged mesh (one draw call);
 * walking ones swing legs and arms in the vertex shader (attribute `aSwing` = pivot height and
 * direction), timed from the clock and phased by position.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Builder, T, xf } from "./geom";
import { makeRng } from "./rng";

const uWalk = { value: 0 };

function bodyMaterial(walking: boolean): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.userData["cast"] = true;
  if (walking) {
    m.onBeforeCompile = (s) => {
      s.uniforms["uWalk"] = uWalk;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aSwing;\nuniform float uWalk;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          if (aSwing.y != 0.0) {
            float ph = dot(modelMatrix[3].xz, vec2(0.37, 0.71));
            float a = sin(uWalk * 6.5 + ph) * 0.42 * aSwing.y;
            float dy = transformed.y - aSwing.x;
            float c = cos(a), sn = sin(a);
            float nz = transformed.z * c - dy * sn;
            float ny = transformed.z * sn + dy * c;
            transformed.z = nz;
            transformed.y = aSwing.x + ny;
          }`,
        );
    };
    m.customProgramCacheKey = () => "peaton-walk";
  }
  return m;
}

const MATS = { walk: null as THREE.MeshLambertMaterial | null, still: null as THREE.MeshLambertMaterial | null };
function mat(walking: boolean): THREE.MeshLambertMaterial {
  if (walking) return (MATS.walk ??= bodyMaterial(true));
  return (MATS.still ??= bodyMaterial(false));
}

/** Geometry of one Builder (all parts in one material) with a constant aSwing. */
function part(b: Builder, pivot: number, dir: number, m: THREE.Material): THREE.BufferGeometry | null {
  const g = b.build(true);
  const mesh = g.children.find((c) => c instanceof THREE.Mesh);
  if (!(mesh instanceof THREE.Mesh)) return null;
  const geo = (mesh.geometry as THREE.BufferGeometry).clone();
  for (const c of g.children) if (c instanceof THREE.Mesh) (c.geometry as THREE.BufferGeometry).dispose();
  const n = geo.getAttribute("position").count;
  const sw = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    sw[i * 2] = pivot;
    sw[i * 2 + 1] = dir;
  }
  geo.setAttribute("aSwing", new THREE.BufferAttribute(sw, 2));
  void m;
  return geo;
}

const TOPS = [0x7a2e2e, 0x2a5d73, 0xd9c7a1, 0x3f4a3a, 0xf2efe8, 0x5a4a7a, 0xb8642a, 0x8c9aa8, 0x2f2f33, 0xc94f4f];
const BOTTOMS = [0x283044, 0x4a4e69, 0x6b705c, 0x22223b, 0x8a7b6a, 0x3b5675, 0xd9cfbd];
const SKINS = [0xe8b896, 0xd49a74, 0xc68642, 0xf1c9a5, 0xa86b45];
const HAIR = [0x2b2420, 0x5a3a22, 0x9b7a52, 0x1a1a1a, 0xb9b0a6];

/** Build a pedestrian template. Origin at the feet, facing +Z (towards the runner). */
export function buildPedestrian(seed: number, walking: boolean): THREE.Group {
  const r = makeRng(seed * 2654435761 + 7);
  const kind = seed % 8;
  const m = mat(walking);
  const top = kind === 2 ? 0x4a3f46 : kind === 7 ? 0x2b2f3a : r.pick(TOPS);
  const bottom = r.pick(BOTTOMS);
  const skin = r.pick(SKINS);
  const old = kind === 2 || kind === 6;
  const hair = old ? 0xc9c4bd : r.pick(HAIR);
  const skirt = kind === 1 || (kind === 4 && r.chance(0.5));
  const scale = kind === 5 ? 0.94 : old ? 0.95 : 1;
  const body = new Builder();
  const legL = new Builder();
  const legR = new Builder();
  const armL = new Builder();
  const armR = new Builder();
  const shoe = old ? 0x2a2522 : r.pick([0xf2f2f2, 0x2a2522, 0x6b4a2e, 0x3c5a8a]);
  // legs (pivot at the hip, 0.88)
  for (const [lb, sx] of [[legL, -1], [legR, 1]] as const) {
    lb.add(T.capsule(6.5, 3, 8), xf(sx * 0.095, 0.48, 0, 0.075, 0.1, 0.08), skirt ? skin : bottom, m);
    lb.add(T.box, xf(sx * 0.095, 0.045, 0.04, 0.11, 0.09, 0.26), shoe, m);
  }
  if (skirt) body.add(T.frustum(0.62, 10), xf(0, 0.72, 0, 0.24, 0.42, 0.2), bottom, m);
  // torso, hips, neck, head, hair
  body.add(T.capsule(0.9, 4, 10), xf(0, 1.18, 0, 0.19, 0.25, 0.13), top, m);
  if (!skirt) body.add(T.box, xf(0, 0.88, 0, 0.32, 0.18, 0.2), bottom, m);
  body.add(T.cyl(8), xf(0, 1.5, 0, 0.055, 0.1, 0.055), skin, m);
  body.add(T.sphere(10, 8), xf(0, 1.63, 0.005, 0.105, 0.125, 0.115), skin, m);
  body.add(T.dome(10, 4), xf(0, 1.66, -0.005, 0.115, 0.1, 0.122), hair, m);
  if (kind === 1 && !old) body.add(T.capsule(1.5, 3, 6), xf(0, 1.5, -0.08, 0.07, 0.1, 0.05), hair, m); // long hair
  if (kind === 2) body.add(T.sphere(8, 6), xf(0, 1.71, -0.09, 0.055, 0.05, 0.05), hair, m); // bun
  // arms (pivot at the shoulder, 1.4)
  for (const [ab, sx] of [[armL, -1], [armR, 1]] as const) {
    ab.add(T.capsule(5.5, 3, 8), xf(sx * 0.235, 1.1, 0, 0.055, 0.065, 0.055), kind === 3 ? skin : top, m);
    ab.add(T.sphere(6, 4), xf(sx * 0.24, 0.84, 0.01, 0.05, 0.06, 0.05), skin, m);
  }
  // props by kind
  switch (kind) {
    case 1: // handbag on the shoulder
      body.add(T.box, xf(0.27, 1.02, 0.02, 0.07, 0.22, 0.28), r.pick([0x6b3a2a, 0x1d1d1d, 0xb5833f]), m);
      break;
    case 2: // abuela: cardigan and the tartan shopping trolley beside her
      body.add(T.box, xf(0.32, 0.55, 0.18, 0.2, 0.55, 0.26), r.pick([0x7a2433, 0x2f4a6b, 0x3a5a3a]), m);
      body.add(T.box, xf(0.32, 0.58, 0.18, 0.205, 0.08, 0.265), 0xd8c27a, m);
      body.add(T.cyl(8), xf(0.32, 0.08, 0.06, 0.08, 0.04, 0.08, 0, 0, Math.PI / 2), 0x1a1a1a, m);
      body.add(T.box, xf(0.32, 1.0, 0.06, 0.02, 0.55, 0.02), 0x8a8d91, m);
      break;
    case 3: // tourist: sun hat, camera, backpack, shorts
      body.add(T.cyl(12), xf(0, 1.74, 0, 0.2, 0.02, 0.2), 0xe8dcb5, m);
      body.add(T.cyl(10), xf(0, 1.79, 0, 0.12, 0.09, 0.12), 0xe8dcb5, m);
      body.add(T.box, xf(0, 1.15, -0.2, 0.28, 0.38, 0.16), r.pick([0x2a6f97, 0xd35400, 0x27ae60]), m);
      body.add(T.box, xf(0, 1.27, 0.15, 0.13, 0.08, 0.07), 0x1d1d1d, m);
      body.add(T.cyl(8), xf(0, 1.27, 0.2, 0.03, 0.05, 0.03, Math.PI / 2, 0, 0), 0x333333, m);
      break;
    case 4: { // pram in front
      const pc = r.pick([0x2f3e4e, 0x6b4a6b, 0x3a5a40, 0xb9b2a5]);
      body.add(T.box, xf(0, 0.62, 0.42, 0.42, 0.3, 0.46), pc, m);
      body.add(T.dome(10, 4), xf(0, 0.76, 0.28, 0.21, 0.3, 0.2, -0.3, 0, 0), pc, m);
      for (const [dx, dz] of [[-0.18, 0.25], [0.18, 0.25], [-0.18, 0.6], [0.18, 0.6]] as const) body.add(T.cyl(10), xf(dx, 0.11, dz, 0.11, 0.03, 0.11, 0, 0, Math.PI / 2), 0x1a1a1a, m);
      body.add(T.box, xf(0, 0.98, 0.2, 0.4, 0.03, 0.03), 0x1a1a1a, m);
      break;
    }
    case 5: // teenager: phone to the face, headphones
      body.add(T.box, xf(0.13, 1.62, 0.1, 0.03, 0.14, 0.07), 0x111111, m);
      body.add(T.torus(Math.PI, 0.15, 4, 10), xf(0, 1.66, 0, 0.13, 0.13, 0.13), 0xd62828, m);
      break;
    case 6: // old man: flat cap, cardigan, walking stick
      body.add(T.dome(10, 3), xf(0, 1.7, 0.01, 0.125, 0.06, 0.13), 0x5a5048, m);
      body.add(T.box, xf(0, 1.71, 0.11, 0.18, 0.02, 0.08), 0x5a5048, m);
      body.add(T.cyl(6), xf(0.3, 0.45, 0.12, 0.012, 0.9, 0.012), 0x5a3a22, m);
      break;
    case 7: // office worker: jacket and briefcase
      body.add(T.box, xf(0, 1.3, 0.135, 0.05, 0.2, 0.02), 0xa82a2a, m);
      body.add(T.box, xf(0, 1.36, 0.128, 0.12, 0.12, 0.02), 0xf2f2f2, m);
      armR.add(T.box, xf(0.27, 0.65, 0, 0.08, 0.3, 0.4), 0x3a2416, m);
      break;
    default: // man: a newspaper or a bag now and then
      if (r.chance(0.5)) body.add(T.box, xf(-0.3, 0.7, 0, 0.08, 0.3, 0.32), 0xe9e2d0, m);
  }
  const geos = [
    part(body, 0, 0, m),
    part(legL, 0.88, walking ? 1 : 0, m),
    part(legR, 0.88, walking ? -1 : 0, m),
    part(armL, 1.4, walking ? -0.7 : 0, m),
    part(armR, 1.4, walking ? (kind === 7 ? 0.25 : 0.7) : 0, m),
  ].filter((g): g is THREE.BufferGeometry => g !== null);
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const out = new THREE.Group();
  if (!merged) return out;
  merged.scale(scale, scale, scale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (walking) mesh.onBeforeRender = () => {
    uWalk.value = performance.now() / 1000;
  };
  out.add(mesh);
  return out;
}
