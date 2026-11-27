/**
 * Light, sky and fog for the real city: a sunny Extremadura day's journey round the lap (odd laps)
 * and the same city at night (even laps), tuned for long views (the skyline across the Guadiana)
 * and ACES tone mapping. Plus `configureRenderer` and a sky environment map for reflections.
 */
import * as THREE from "three";
import type { Atmosphere } from "../../contracts";
import type { ZoneId } from "../../city/data";
import { SKY_FRAG, SKY_VERT, skyState, skyUniforms } from "../sky";

const DAY: Record<ZoneId, Atmosphere> = {
  // late morning on Puente Real: high warm sun from the south-east, clear blue
  "puente-real": {
    skyTop: 0x3d7fc9, skyBottom: 0xcfe0ea, fogColor: 0xc8d8e0, fogNear: 180, fogFar: 1100,
    sunColor: 0xfff1dc, sunIntensity: 3.1, sunPosition: [55, 80, 45],
    ambientColor: 0xbfd3ea, ambientIntensity: 1.05,
  },
  // midday on the avenues: almost overhead, hard light
  valdepasillas: {
    skyTop: 0x3577c7, skyBottom: 0xd3e2ea, fogColor: 0xcddbe2, fogNear: 150, fogFar: 950,
    sunColor: 0xfff6e8, sunIntensity: 3.2, sunPosition: [25, 100, 30],
    ambientColor: 0xc6d6e8, ambientIntensity: 1.0,
  },
  // afternoon: sun lowering to the south-west, warmer
  "san-francisco": {
    skyTop: 0x3f7cc2, skyBottom: 0xe3dccb, fogColor: 0xdcd6c6, fogNear: 140, fogFar: 900,
    sunColor: 0xffe6c2, sunIntensity: 3.0, sunPosition: [-60, 60, 30],
    ambientColor: 0xd5d4cf, ambientIntensity: 1.0,
  },
  // golden hour in the old town
  "casco-antiguo": {
    skyTop: 0x4d77b0, skyBottom: 0xefcf9e, fogColor: 0xe6c99c, fogNear: 120, fogFar: 850,
    sunColor: 0xffc98a, sunIntensity: 2.9, sunPosition: [-80, 34, 20],
    ambientColor: 0xd9c4ad, ambientIntensity: 0.95,
  },
  // sunset over the Guadiana, the Alcazaba glowing
  "alcazaba-palmas": {
    skyTop: 0x56689e, skyBottom: 0xf0a878, fogColor: 0xdfa889, fogNear: 140, fogFar: 950,
    sunColor: 0xffa565, sunIntensity: 2.6, sunPosition: [-90, 16, -10],
    ambientColor: 0xc8aab0, ambientIntensity: 0.95,
  },
  // dusk on the right bank
  "margen-derecha": {
    skyTop: 0x283a70, skyBottom: 0xb29ab0, fogColor: 0x9e93a8, fogNear: 130, fogFar: 900,
    sunColor: 0xe0b0c0, sunIntensity: 1.3, sunPosition: [-70, 10, -30],
    ambientColor: 0x9aa4cc, ambientIntensity: 1.15,
  },
};

const night = (top: number, bottom: number, ambient: number): Atmosphere => ({
  skyTop: top, skyBottom: bottom, fogColor: bottom, fogNear: 110, fogFar: 750,
  sunColor: 0xa9bbff, sunIntensity: 0.7, sunPosition: [-35, 70, 25],
  ambientColor: ambient, ambientIntensity: 1.1,
});

const NIGHT: Record<ZoneId, Atmosphere> = {
  "puente-real": night(0x060a22, 0x1f2a4f, 0x7d8cc0),
  valdepasillas: night(0x070a24, 0x232b52, 0x8290c0),
  "san-francisco": night(0x090a26, 0x2a2a50, 0x8a8cc0),
  "casco-antiguo": night(0x0b0a24, 0x302a4c, 0x948cbc),
  "alcazaba-palmas": night(0x0b0a26, 0x332a4e, 0x9890bc),
  "margen-derecha": night(0x05091f, 0x1c254c, 0x7a8ac2),
};

export function cityAtmosphere(zone: ZoneId, lap: number): Atmosphere {
  return lap % 2 === 0 ? NIGHT[zone] : DAY[zone];
}

let envRenderer: THREE.WebGLRenderer | null = null;
let envScene: THREE.Scene | null = null;
let envTex: THREE.Texture | null = null;
let envKey = "";

/**
 * Renderer settings the city art is tuned for. The engine calls this once after creating the
 * renderer and scene: ACES filmic tone mapping, soft shadows, sky environment for reflections
 * (regenerated from the sky of each atmosphere by the city's update).
 */
export function configureRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  envRenderer = renderer;
  envScene = scene;
  refreshEnvironment(DAY["puente-real"]);
}

/** Point the sky at this atmosphere's sun, and (when it changed) re-bake the environment map from it. */
export function refreshEnvironment(a: Atmosphere): void {
  skyState.sun.set(...a.sunPosition).normalize();
  skyState.sunColor.setHex(a.sunColor);
  const key = `${a.skyTop}-${a.skyBottom}-${a.sunColor}`;
  if (!envRenderer || !envScene || key === envKey) return;
  envKey = key;
  const s = new THREE.Scene();
  const u = skyUniforms();
  (u["top"]!.value as THREE.Color).setHex(a.skyTop);
  (u["bottom"]!.value as THREE.Color).setHex(a.skyBottom);
  const lum = new THREE.Color(a.skyTop);
  u["night"]!.value = Math.min(1, Math.max(0, (0.06 - (lum.r * 0.3 + lum.g * 0.59 + lum.b * 0.11)) / 0.045));
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({ uniforms: u, side: THREE.BackSide, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG.replace("#include <tonemapping_fragment>", "") });
  s.add(new THREE.Mesh(geo, mat));
  // warm ground below the horizon
  const g = new THREE.Mesh(new THREE.CircleGeometry(10, 16).rotateX(-Math.PI / 2).translate(0, -1, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7a6a55).multiplyScalar(u["night"]!.value > 0.5 ? 0.15 : 1) }));
  s.add(g);
  const pm = new THREE.PMREMGenerator(envRenderer);
  const next = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  geo.dispose();
  mat.dispose();
  g.geometry.dispose();
  (g.material as THREE.Material).dispose();
  envTex?.dispose();
  envTex = next;
  envScene.environment = next;
}
