/**
 * Shared materials. Everything in the world is coloured through vertex colours so that whole
 * segments / vehicles merge into a handful of meshes (one per material).
 * `userData.cast` marks materials whose meshes cast shadows.
 */
import * as THREE from "three";

function tag<T extends THREE.Material>(m: T, cast: boolean, receive = true): T {
  m.userData["cast"] = cast;
  m.userData["receive"] = receive;
  return m;
}

/** Faceted, lit, vertex coloured. Near-road geometry that casts shadows. */
export const SOLID = tag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), true);
/** Same look, no shadow casting (distant scenery, ground, road decals). */
export const FAR = tag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), false);
/** Unlit vertex colour: lamps, lit windows, headlights, LED displays. */
export const GLOW = tag(new THREE.MeshBasicMaterial({ vertexColors: true }), false, false);
/** Shiny glass (vertex colour tints it). */
export const GLASS = tag(
  new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 70, specular: 0x55606a }),
  false,
);
/** Shiny painted vehicle bodies. */
export const PAINT = tag(
  new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 50, specular: 0x444444 }),
  true,
);
/** River water. */
export const WATER = tag(
  new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 120, specular: 0xbbccdd, flatShading: true }),
  false,
);
/** Smooth shaded, for characters. */
export const SKIN = tag(new THREE.MeshLambertMaterial({ vertexColors: true }), true);
/** Thin see-through scaffold netting. */
export const NET = tag(
  new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
  false,
);
/** Double-sided lit material (cloth, fronds, flags). */
export const CLOTH = tag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), true);

/** Night floodlighting: landmarks keep their colours but glow softly (warm stone, cool concrete). */
export const WARMLIT = tag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xc07a3a, emissiveIntensity: 0.55 }), false);
export const COOLLIT = tag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x9fb4ff, emissiveIntensity: 0.6 }), false);
/** Unlit and unfogged, for fireworks frozen in the night sky. */
export const SKYGLOW = tag(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), false, false);
