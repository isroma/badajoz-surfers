/**
 * Light, sky and fog in the flat style (docs/design.md): one sun and a sky fill, no shadow maps,
 * a gentle time-of-day tint travelling with the lap (late morning on Puente Real → dusk on the
 * right bank), never darker than needed to read the road; night laps in the Sol y Cerveza night
 * values. Fog is light and matches the sky's horizon colour.
 */
import * as THREE from "three";
import type { Atmosphere } from "../../contracts";
import type { ZoneId } from "../../city/data";
import { skyState } from "../sky";

const day = (top: number, horizon: number, sun: number, sunI: number, pos: [number, number, number], amb: number): Atmosphere => ({
  skyTop: top, skyBottom: horizon, fogColor: horizon, fogNear: 200, fogFar: 880,
  sunColor: sun, sunIntensity: sunI, sunPosition: pos,
  ambientColor: amb, ambientIntensity: 2.9,
});

const DAY: Record<ZoneId, Atmosphere> = {
  "puente-real": day(0x8cc4ee, 0xeaf2f4, 0xfff6e8, 0.9, [55, 80, 45], 0xf2f4f6),
  valdepasillas: day(0x86c0ec, 0xedf3f3, 0xfffaf0, 0.95, [25, 100, 30], 0xf4f5f6),
  "san-francisco": day(0x8fc2ea, 0xf3efe4, 0xfff2de, 0.9, [-60, 60, 30], 0xf6f2ec),
  "casco-antiguo": day(0x95bfe3, 0xf7e9d4, 0xffe8c8, 0.88, [-80, 34, 20], 0xf8eee2),
  "alcazaba-palmas": day(0x9db8dc, 0xf6dfc8, 0xffdcb4, 0.85, [-90, 22, -10], 0xf6e8e0),
  "margen-derecha": day(0x8e9fcc, 0xe8d8d8, 0xf4d0c8, 0.8, [-70, 18, -30], 0xe8e4ee),
};

const night = (top: number, horizon: number): Atmosphere => ({
  skyTop: top, skyBottom: horizon, fogColor: horizon, fogNear: 200, fogFar: 1100,
  sunColor: 0xb8c4ff, sunIntensity: 0.4, sunPosition: [-35, 70, 25],
  ambientColor: 0xa8b4e0, ambientIntensity: 1.4,
});

const NIGHT: Record<ZoneId, Atmosphere> = {
  "puente-real": night(0x141826, 0x2b3144),
  valdepasillas: night(0x141826, 0x2b3144),
  "san-francisco": night(0x151826, 0x2e3146),
  "casco-antiguo": night(0x161826, 0x323046),
  "alcazaba-palmas": night(0x161826, 0x333046),
  "margen-derecha": night(0x131826, 0x2a3044),
};

export function cityAtmosphere(zone: ZoneId, lap: number): Atmosphere {
  return lap % 2 === 0 ? NIGHT[zone] : DAY[zone];
}

/**
 * Renderer settings for the flat style, called once by the engine: no shadow maps, no tone
 * mapping (the palette is shown as designed), sRGB output, no environment map.
 */
export function configureRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  scene.environment = null;
}

/** Point the sky's soft sun glow at this atmosphere's sun (cheap; no environment re-bake). */
export function refreshEnvironment(a: Atmosphere): void {
  skyState.sun.set(...a.sunPosition).normalize();
  skyState.sunColor.setHex(a.sunColor);
}
