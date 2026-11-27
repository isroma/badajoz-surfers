/**
 * Shared GPU state for the city: global uniforms (time, night, wind), the chunk mask that hides
 * far-LOD geometry where a detailed chunk is built, and the shader patches that use them.
 */
import * as THREE from "three";

/** Max number of route chunks (lap / chunk length, rounded up generously). */
export const MAX_CHUNKS = 512;

const maskData = new Uint8Array(MAX_CHUNKS * 4);
export const chunkMask = new THREE.DataTexture(maskData, MAX_CHUNKS, 1, THREE.RGBAFormat);
chunkMask.magFilter = THREE.NearestFilter;
chunkMask.minFilter = THREE.NearestFilter;
chunkMask.needsUpdate = true;

export function setChunkMasked(i: number, on: boolean): void {
  if (i < 0 || i >= MAX_CHUNKS) return;
  maskData[i * 4] = on ? 255 : 0;
  chunkMask.needsUpdate = true;
}
export function clearChunkMask(): void {
  maskData.fill(0);
  chunkMask.needsUpdate = true;
}

export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uChunkMask: { value: chunkMask as THREE.Texture },
};

type Shader = THREE.WebGLProgramParametersWithUniforms;

/**
 * Far-LOD patch: vertices carry `aChunk` (the route chunk that owns the object, -1 = none). When
 * that chunk's detailed version is built the mask hides the far copy (vertex sent out of clip).
 */
export const LOD_VERTEX_PARS = /* glsl */ `
attribute float aChunk;
uniform sampler2D uChunkMask;
`;
export const LOD_VERTEX = /* glsl */ `
if (aChunk >= 0.0 && texelFetch(uChunkMask, ivec2(int(aChunk), 0), 0).r > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
`;

/** Wind sway for foliage: `aSway` = (weight 0..1, phase). Bends tops in world XZ. */
export const SWAY_VERTEX_PARS = /* glsl */ `
attribute vec2 aSway;
uniform float uTime;
`;
export const SWAY_VERTEX = /* glsl */ `
{
  float w = aSway.x;
  float ph = aSway.y;
  float g = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
  transformed.x += w * w * g * 0.22;
  transformed.z += w * w * cos(uTime * 1.1 + ph * 0.7) * 0.12;
}
`;

export function patchLod(m: THREE.Material, key: string, extra?: (s: Shader) => void): THREE.Material {
  m.onBeforeCompile = (s) => {
    s.uniforms["uChunkMask"] = U.uChunkMask;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${LOD_VERTEX_PARS}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${LOD_VERTEX}`);
    extra?.(s);
  };
  m.customProgramCacheKey = () => `lod-${key}`;
  return m;
}

/** Tag a material for the art's shadow policy (same convention as ../materials.ts). */
export function tagMat<T extends THREE.Material>(m: T, cast: boolean, receive = true): T {
  m.userData["cast"] = cast;
  m.userData["receive"] = receive;
  return m;
}

/** Deterministic hash → [0,1). */
export function hash01(a: number, b = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
