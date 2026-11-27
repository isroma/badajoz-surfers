/** Gradient sky dome with a few low-poly clouds. Fog-free; the engine keeps it centred on the camera. */
import * as THREE from "three";
import type { SkyDome } from "../contracts";
import { Builder } from "./geom";
import { makeRng } from "./rng";

const RADIUS = 900;

const CLOUD_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92, depthWrite: false });

let cloudGeo: THREE.BufferGeometry | null = null;

function clouds(): THREE.BufferGeometry {
  if (cloudGeo) return cloudGeo;
  const b = new Builder();
  const r = makeRng(4242);
  for (let i = 0; i < 16; i++) {
    const az = (i / 16) * Math.PI * 2 + r.range(-0.15, 0.15);
    const el = r.range(0.06, 0.22);
    const d = RADIUS * 0.82;
    const cx = Math.sin(az) * Math.cos(el) * d;
    const cz = -Math.cos(az) * Math.cos(el) * d;
    const cy = Math.sin(el) * d;
    const s = r.range(30, 60);
    const puffs = r.int(4, 7);
    b.at(cx, cy, cz, -az);
    for (let k = 0; k < puffs; k++) {
      const px = (k - puffs / 2) * s * 0.55 + r.range(-6, 6);
      const ps = s * r.range(0.45, 0.8);
      b.blob(px, r.range(0, s * 0.25), r.range(-8, 8), ps, ps * 0.62, ps * 0.5, 0xffffff);
      b.blob(px, -ps * 0.15, 0, ps * 0.9, ps * 0.3, ps * 0.45, 0xdde4ee);
    }
    b.pop();
  }
  const g = b.build(true).children[0];
  if (!(g instanceof THREE.Mesh)) throw new Error("cloud build failed");
  cloudGeo = g.geometry as THREE.BufferGeometry;
  return cloudGeo;
}

export function createSkyDome(): SkyDome {
  const uniforms = {
    top: { value: new THREE.Color(0x2f7fd8) },
    bottom: { value: new THREE.Color(0xcfe8ff) },
    night: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 bottom;
      uniform float night;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        float t = pow(h, 0.55);
        vec3 col = mix(bottom, top, smoothstep(0.0, 1.0, t));
        // a little brighter haze right at the horizon
        col += (1.0 - smoothstep(0.0, 0.08, h)) * 0.04;
        if (night > 0.0) {
          // stars: sparse hashed cells, fading out towards the horizon haze
          vec3 cell = floor(vDir * 260.0);
          float st = step(0.9965, hash(cell)) * smoothstep(0.08, 0.35, h);
          col += vec3(0.9, 0.92, 1.0) * st * night * (0.6 + 0.4 * hash(cell + 7.0));
          // the moon, with a soft halo
          vec3 md = normalize(vec3(-0.35, 0.42, -0.84));
          float d = dot(vDir, md);
          col += vec3(1.0, 0.97, 0.88) * smoothstep(0.99935, 0.9996, d) * night;
          col += vec3(0.35, 0.4, 0.6) * pow(max(d, 0.0), 180.0) * 0.6 * night;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const domeGeo = new THREE.SphereGeometry(RADIUS, 32, 16);
  domeGeo.userData["perInstance"] = true;
  mat.userData["perInstance"] = true;
  const dome = new THREE.Mesh(domeGeo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  const cloudMat = CLOUD_MAT.clone();
  cloudMat.userData["perInstance"] = true;
  const cloudMesh = new THREE.Mesh(clouds(), cloudMat);
  cloudMesh.renderOrder = -9;
  cloudMesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = "sky";
  group.add(dome, cloudMesh);
  const white = new THREE.Color(1, 1, 1);
  return {
    mesh: group,
    setColors(top, bottom) {
      uniforms.top.value.copy(top);
      uniforms.bottom.value.copy(bottom);
      const lumTop = top.r * 0.3 + top.g * 0.59 + top.b * 0.11;
      uniforms.night.value = Math.min(1, Math.max(0, (0.06 - lumTop) / 0.045));
      // clouds pick up the horizon tint (pink at sunset, blue-grey at dusk)
      cloudMat.color.copy(white).lerp(bottom, 0.45);
      cloudMat.color.multiplyScalar(1 - 0.55 * uniforms.night.value);
      const lum = bottom.r * 0.3 + bottom.g * 0.59 + bottom.b * 0.11;
      cloudMat.opacity = 0.6 + Math.min(0.32, lum * 0.4);
    },
  };
}
