/**
 * Sky dome: an analytic daylight sky (gradient from the zone colours, horizon haze, Mie glow and
 * the sun disc), a soft moving cloud layer from fbm noise projected on a cloud plane, and at night
 * stars, the moon with its halo and the orange glow of the city's lights on the horizon.
 * Fog-free; the engine keeps it centred on the camera. The sun direction comes from `skyState`
 * (set by the city art from the current atmosphere).
 */
import * as THREE from "three";
import type { SkyDome } from "../contracts";

const RADIUS = 900;

/** Shared sky inputs (the city updates them every frame from the zone's atmosphere). */
export const skyState = {
  sun: new THREE.Vector3(0.45, 0.7, 0.35).normalize(),
  sunColor: new THREE.Color(1, 0.95, 0.86),
};

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
uniform vec3 sunDir;
uniform vec3 sunCol;
uniform float night;
uniform float time;
uniform float clouds;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(bottom, top, smoothstep(0.0, 1.0, pow(h, 0.5)));
  // horizon haze, brighter towards the sun
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  col = mix(col, bottom * 1.08 + sunCol * 0.08 * sd, (1.0 - smoothstep(0.0, 0.12, h)) * 0.6);
  // Mie glow and the sun disc (day only, fades as the sun sets below the horizon)
  float day = 1.0 - night;
  float sunUp = smoothstep(-0.05, 0.08, sunDir.y);
  col += sunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 60.0) * 0.5) * day * sunUp;
  col += sunCol * smoothstep(0.99955, 0.9998, sd) * 6.0 * day * sunUp;
  // clouds: fbm on a plane, drifting
  if (d.y > 0.01) {
    vec2 uv = d.xz / (d.y + 0.08) * 1.6 + vec2(time * 0.006, time * 0.002);
    float n = fbm(uv);
    float cov = smoothstep(0.62 - clouds * 0.25, 0.9, n);
    float edge = smoothstep(0.0, 0.16, d.y);
    float lit = 0.75 + 0.35 * pow(sd, 3.0);
    vec3 cc = mix(bottom * 1.1, vec3(1.0), 0.65) * lit * mix(1.0, 0.28, night) + sunCol * 0.12 * day;
    cc *= 0.82 + 0.25 * fbm(uv * 3.1 + 4.0);
    col = mix(col, cc, cov * edge * 0.85);
  }
  if (night > 0.0) {
    vec3 cell = floor(d * 300.0);
    float st = step(0.9984, hash(cell)) * smoothstep(0.1, 0.4, h);
    col += vec3(0.9, 0.92, 1.0) * st * night * (0.4 + 0.6 * hash(cell + 7.0));
    vec3 md = normalize(vec3(0.55, 0.38, -0.74));
    float m = dot(d, md);
    col += vec3(1.0, 0.97, 0.88) * smoothstep(0.99925, 0.9995, m) * night * 1.6;
    col += vec3(0.35, 0.4, 0.6) * pow(max(m, 0.0), 120.0) * 0.5 * night;
    // light pollution over the city on the horizon
    col += vec3(0.55, 0.32, 0.16) * (1.0 - smoothstep(0.0, 0.18, h)) * 0.22 * night;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function skyUniforms(): Record<string, THREE.IUniform> {
  return {
    top: { value: new THREE.Color(0x2f7fd8) },
    bottom: { value: new THREE.Color(0xcfe8ff) },
    sunDir: { value: skyState.sun },
    sunCol: { value: skyState.sunColor },
    night: { value: 0 },
    time: { value: 0 },
    clouds: { value: 0.5 },
  };
}

export function createSkyDome(): SkyDome {
  const uniforms = skyUniforms();
  const mat = new THREE.ShaderMaterial({ uniforms, side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG });
  const domeGeo = new THREE.SphereGeometry(RADIUS, 48, 24);
  domeGeo.userData["perInstance"] = true;
  mat.userData["perInstance"] = true;
  const dome = new THREE.Mesh(domeGeo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  const t0 = performance.now();
  dome.onBeforeRender = () => {
    uniforms["time"]!.value = (performance.now() - t0) / 1000;
  };
  const group = new THREE.Group();
  group.name = "sky";
  group.add(dome);
  return {
    mesh: group,
    setColors(topC, bottomC) {
      (uniforms["top"]!.value as THREE.Color).copy(topC);
      (uniforms["bottom"]!.value as THREE.Color).copy(bottomC);
      const lumTop = topC.r * 0.3 + topC.g * 0.59 + topC.b * 0.11;
      uniforms["night"]!.value = Math.min(1, Math.max(0, (0.06 - lumTop) / 0.045));
    },
  };
}
