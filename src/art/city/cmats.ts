/**
 * City materials. All shared (never disposed by chunks). Lambert everywhere for speed, with
 * shader patches for the facade atlas (blinds, lit windows at night), wind sway, LOD masking
 * and the river.
 */
import * as THREE from "three";
import { LOD_VERTEX, LOD_VERTEX_PARS, SWAY_VERTEX, SWAY_VERTEX_PARS, U, tagMat } from "./shared";
import { foliageAtlas } from "./foliage-tex";
import { ATLAS_COLS, ATLAS_ROWS, ROAD_SURFACES, facadeAtlas, groundTex, paintTexture, roadAtlasTex, type GroundName } from "./textures";

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m as T;
}

const FACADE_VERT_PARS = /* glsl */ `
attribute vec4 aTile;
attribute vec2 aSeed;
flat varying vec4 vTile;
flat varying vec2 vSeed;
varying vec2 vFac;
`;
const FACADE_FRAG_PARS = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uNight;
flat varying vec4 vTile;
flat varying vec2 vSeed;
varying vec2 vFac;
float fh21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
const FACADE_FRAG = /* glsl */ `
float fEm = 0.0;
{
  float bay = vFac.x;
  float f = vFac.y;
  float tileId = vTile.z;
  vec2 local = vec2(fract(bay * 0.5), fract(f * 0.5));
  vec2 sc = vec2(0.5, 0.5);
  if (f >= 0.0 && f < 1.0) {
    tileId = vTile.y;
    local = vec2(fract(bay * 0.5), f);
    sc = vec2(0.5, 1.0);
    // vary the ground floor per pair of bays: shops, portals, houses
    float hh = fh21(vec2(floor(bay * 0.5), 7.0) + vSeed.x);
    if (tileId == 4.0 || tileId == 5.0) tileId = hh < 0.62 ? 4.0 : 5.0;
    else if (tileId == 13.0 || tileId == 14.0 || tileId == 28.0) tileId = hh < 0.4 ? 13.0 : hh < 0.75 ? 28.0 : 14.0;
    else if (tileId == 9.0) tileId = hh < 0.7 ? 9.0 : 5.0;
  }
  else if (f >= 1.0 && f < vTile.w) { tileId = vTile.x; local = vec2(fract(bay * 0.5), fract((f - 1.0) * 0.5)); }
  vec2 grid = vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
  vec2 org = vec2(mod(tileId, grid.x), grid.y - 1.0 - floor(tileId / grid.x));
  vec2 auv = (org + 0.004 + local * 0.992) / grid;
  vec2 gx = dFdx(vFac) * sc / grid;
  vec2 gy = dFdy(vFac) * sc / grid;
  vec4 tex = textureGrad(uAtlas, auv, gx, gy);
  vec3 col = tex.rgb;
  float fw = max(max(abs(gx.x), abs(gy.x)) * grid.x, max(abs(gx.y), abs(gy.y)) * grid.y);
  float detail = 1.0 - smoothstep(0.004, 0.012, fw);
  float glassAmt = clamp((0.92 - tex.a) * 4.0, 0.0, 1.0);
  float farEm = uNight * 0.4 * glassAmt * (0.6 + 0.8 * fh21(floor(vec2(bay, f) * 0.5) + vSeed.x));
  float nearEm = 0.0;
  if (tex.a < 0.88 && f >= 0.0 && f < vTile.w && detail > 0.0) {
    vec2 cell = vec2(floor(bay), floor(f));
    float hs = fh21(cell + vSeed.x * 17.31);
    float rel = clamp((tex.a - 0.45) / 0.4, 0.0, 1.0);
    float blind = f < 1.0 ? 0.0 : (hs < 0.28 ? 0.0 : fract(hs * 13.7) * 0.97);
    bool covered = rel > 1.0 - blind;
    float lit = step(fh21(cell * 1.37 + vSeed.x * 3.1 + 5.0), f < 1.0 ? 0.5 : 0.3);
    if (covered) {
      vec3 bc = vSeed.y < 0.5 ? vec3(0.86, 0.80, 0.68) : vSeed.y < 1.5 ? vec3(0.92, 0.91, 0.88) : vSeed.y < 2.5 ? vec3(0.50, 0.38, 0.27) : vec3(0.30, 0.42, 0.29);
      col = mix(col, bc * (0.8 + 0.2 * step(0.3, fract(rel * 26.0))), detail);
    }
    nearEm = uNight * lit * (covered ? 0.22 : 1.0) * (0.75 + 0.5 * fract(hs * 7.1));
  }
  col *= mix(1.0, 0.45, uNight * glassAmt);
  fEm = mix(farEm, nearEm, detail);
  diffuseColor.rgb *= col;
}
`;

/** The building facade material (atlas, per-building tint in vertex colours). */
export function facadeMaterial(): THREE.MeshLambertMaterial {
  return cached("facade", () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (s) => {
      s.uniforms["uAtlas"] = { value: facadeAtlas() };
      s.uniforms["uNight"] = U.uNight;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", `#include <common>\n${FACADE_VERT_PARS}`)
        .replace("#include <uv_vertex>", `#include <uv_vertex>\nvFac = uv; vTile = aTile; vSeed = aSeed;`);
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>\n${FACADE_FRAG_PARS}`)
        .replace("#include <map_fragment>", FACADE_FRAG)
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * fEm * 1.3;");
    };
    m.customProgramCacheKey = () => "city-facade";
    return tagMat(m, true);
  });
}

const surfaceOfMat = new Map<THREE.Material, number>();
/** Index of a ground material's surface in the road atlas (-1 if not packed there). */
export function surfaceIndexOf(m: THREE.Material): number {
  return surfaceOfMat.get(m) ?? -1;
}

/** All road-side surfaces in one material: `aSurf` picks the atlas cell, uv repeats inside it. */
export function roadAtlasMaterial(): THREE.MeshLambertMaterial {
  return cached("road-atlas", () => {
    const m = new THREE.MeshLambertMaterial({ map: roadAtlasTex(), vertexColors: true });
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aSurf;\nflat varying float vSurf;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSurf = aSurf;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nflat varying float vSurf;")
        .replace("#include <map_fragment>", `{
  vec2 grid = vec2(4.0, 2.0);
  vec2 org = vec2(mod(vSurf, 4.0), 1.0 - floor(vSurf / 4.0));
  vec2 auv = (org + 0.003 + fract(vMapUv) * 0.994) / grid;
  diffuseColor *= textureGrad(map, auv, dFdx(vMapUv) / grid, dFdy(vMapUv) / grid);
}`);
    };
    m.customProgramCacheKey = () => "city-road-atlas";
    return tagMat(m, false);
  });
}

/** Ground surface with world-scaled uv (geometry supplies uv in repeats). */
export function groundMaterial(name: GroundName, decal = 0): THREE.MeshLambertMaterial {
  return cached(`ground-${name}-${decal}`, () => {
    const m = new THREE.MeshLambertMaterial({ map: groundTex(name), vertexColors: true });
    if (decal !== 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -decal;
      m.polygonOffsetUnits = -decal * 2;
    } else if (ROAD_SURFACES.includes(name)) surfaceOfMat.set(m, ROAD_SURFACES.indexOf(name));
    return tagMat(m, false);
  });
}

/** Ground surface that casts shadows too (kerbs, raised medians). */
export function solidGroundMaterial(name: GroundName): THREE.MeshLambertMaterial {
  return cached(`groundsolid-${name}`, () => {
    const m = tagMat(new THREE.MeshLambertMaterial({ map: groundTex(name), vertexColors: true }), true);
    if (ROAD_SURFACES.includes(name)) surfaceOfMat.set(m, ROAD_SURFACES.indexOf(name));
    return m;
  });
}

/** Road paint (lines, zebras, arrows): drawn over the asphalt with a polygon offset. */
export function paintMaterial(): THREE.MeshLambertMaterial {
  return cached("paint", () => {
    const m = new THREE.MeshLambertMaterial({ map: paintTexture(), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    return tagMat(m, false);
  });
}

/** Plain vertex-coloured lit material for props (smooth). */
export function propMaterial(cast = true): THREE.MeshLambertMaterial {
  return cached(`prop-${cast}`, () => tagMat(new THREE.MeshLambertMaterial({ vertexColors: true }), cast));
}

/** Far LOD flat material with chunk masking (skyline props, far trees). */
export function farMaterial(): THREE.MeshLambertMaterial {
  return cached("far", () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (s) => {
      s.uniforms["uChunkMask"] = U.uChunkMask;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", `#include <common>\n${LOD_VERTEX_PARS}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${LOD_VERTEX}`);
    };
    m.customProgramCacheKey = () => "city-far";
    return tagMat(m, false);
  });
}

/**
 * Foliage: leaf-cluster cards and bark from the foliage atlas, alpha-tested, two-sided with the
 * bent (outward) normals kept on both faces, wind sway; `lod` adds chunk masking (far trees).
 */
export function foliageMaterial(lod: boolean): THREE.MeshLambertMaterial {
  return cached(`foliage-${lod}`, () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: foliageAtlas(), alphaTest: 0.42 });
    m.onBeforeCompile = (s) => {
      s.uniforms["uTime"] = U.uTime;
      s.uniforms["uChunkMask"] = U.uChunkMask;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", `#include <common>\n${SWAY_VERTEX_PARS}${lod ? LOD_VERTEX_PARS : ""}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${SWAY_VERTEX}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${lod ? LOD_VERTEX : ""}`);
      // keep the outward-bent normal on back faces too (soft, volumetric crowns)
      s.fragmentShader = s.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );");
    };
    m.customProgramCacheKey = () => `city-foliage2-${lod}`;
    return tagMat(m, !lod);
  });
}

/** Glass with environment reflections (towers, bus shelters). */
export function glassMaterial(): THREE.MeshStandardMaterial {
  return cached("glass", () => tagMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.2 }), false));
}

/** Painted metal (cars, poles): a bit of sheen. */
export function metalMaterial(): THREE.MeshStandardMaterial {
  return cached("metal", () => tagMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), true));
}

/** Self-lit (lamp heads, lit signs, traffic lights). Brightness follows night via vertex colour. */
export function glowMaterial(): THREE.MeshBasicMaterial {
  return cached("glow", () => tagMat(new THREE.MeshBasicMaterial({ vertexColors: true }), false, false));
}

/** Light pools under street lamps at night (additive, on the ground). */
export function lightPoolMaterial(): THREE.MeshBasicMaterial {
  return cached("pool", () => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.MeshBasicMaterial({
      map: t, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12,
    });
    return tagMat(m, false, false);
  });
}

/** Roof surfaces: flat terrace or Arab clay tiles. */
export function roofMaterial(kind: "flat" | "tile"): THREE.MeshLambertMaterial {
  return cached(`roof-${kind}`, () => tagMat(new THREE.MeshLambertMaterial({ map: groundTex(kind === "flat" ? "roofFlat" : "roofTile"), vertexColors: true }), true));
}

/**
 * Guadiana: non-repeating ripples from scrolling value-noise octaves at different scales and
 * angles (normal detail fading with distance, so no moiré), fresnel reflection of the sky
 * environment, colour from the vertices (shallow margins → dark mid-river).
 */
export function waterMaterial(): THREE.MeshStandardMaterial {
  return cached("water", () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.0, envMapIntensity: 0.8 });
    m.onBeforeCompile = (s) => {
      s.uniforms["uTime"] = U.uTime;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>
uniform float uTime;
varying vec3 vWPos;
float wh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1, 0)), u.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), u.x), u.y); }
float wave(vec2 p) {
  float t = uTime;
  float v = wn(p * 0.35 + vec2(t * 0.05, t * 0.02)) * 0.55;
  v += wn(mat2(0.8, -0.6, 0.6, 0.8) * p * 0.9 + vec2(-t * 0.08, t * 0.05)) * 0.3;
  v += wn(mat2(0.6, 0.8, -0.8, 0.6) * p * 2.3 + vec2(t * 0.12, -t * 0.1)) * 0.15;
  return v;
}`)
        .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
{
  vec2 p = vWPos.xz;
  float e = 0.25;
  float h0 = wave(p);
  vec2 g = vec2(wave(p + vec2(e, 0.0)) - h0, wave(p + vec2(0.0, e)) - h0) / e;
  float dist = length(cameraPosition - vWPos);
  float k = 0.55 / (1.0 + dist / 120.0);
  vec3 wn3 = normalize(vec3(-g.x * k, 1.0, -g.y * k));
  normal = normalize((viewMatrix * vec4(wn3, 0.0)).xyz);
}`);
    };
    m.customProgramCacheKey = () => "city-water2";
    return tagMat(m, false);
  });
}

/** Sign atlas-like canvas texture material, cached by key. */
export function canvasMaterial(key: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, lit = false): THREE.Material {
  return cached(`canvas-${key}-${lit}`, () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (ctx) draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const m = lit ? new THREE.MeshBasicMaterial({ map: t, vertexColors: true }) : new THREE.MeshLambertMaterial({ map: t, vertexColors: true });
    return tagMat(m, false);
  });
}

const skyCache = new Map<THREE.Material, THREE.Material>();
/**
 * Skyline variant of a material: the same look with a much longer fog (×3 the far distance, capped
 * at 88 % haze) so the landmarks and the hills of Badajoz read as hazy silhouettes across the
 * Guadiana, kilometres away. The engine's camera far plane must reach them (≥ 3500 m).
 */
export function skylineVariant(m: THREE.Material): THREE.Material {
  let v = skyCache.get(m);
  if (v) return v;
  v = m.clone();
  const base = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  v.onBeforeCompile = (s, r) => {
    base(s, r);
    s.fragmentShader = s.fragmentShader.replace(
      "#include <fog_fragment>",
      `#ifdef USE_FOG
        float fogFactor = 0.7 * smoothstep( fogNear, fogFar * 4.0, vFogDepth ) + 0.2 * smoothstep( fogFar * 2.5, fogFar * 4.5, vFogDepth );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      #endif`,
    );
  };
  v.customProgramCacheKey = () => `${key()}-skyline`;
  v.userData = { ...m.userData };
  skyCache.set(m, v);
  if (floodSet.has(m)) floodSet.add(v);
  return v;
}

const floodCache = new Map<THREE.Material, THREE.Material>();
/** Materials of floodlit monuments: they glow warmly at night (see setFloodlights). */
export const floodSet = new Set<THREE.Material>();
export function floodVariant(m: THREE.Material): THREE.Material {
  let v = floodCache.get(m);
  if (v) return v;
  v = m.clone();
  v.onBeforeCompile = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  v.customProgramCacheKey = () => `${key()}-flood`;
  v.userData = { ...m.userData };
  floodCache.set(m, v);
  floodSet.add(v);
  return v;
}
export function setFloodlights(night: boolean): void {
  for (const m of floodSet) {
    if (m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshStandardMaterial) {
      m.emissive.setHex(night ? 0x8a5a2a : 0x000000);
      m.emissiveIntensity = night ? 0.55 : 0;
    }
  }
}

/**
 * Terrain: earth and dry-grass textures blended per vertex (`aMix` = vegetation share) with
 * world-space noise so land-use borders are ragged, not cut out; the textures only add detail,
 * the albedo comes from the vertex colours (land use).
 */
export function terrainMaterial(): THREE.MeshLambertMaterial {
  return cached("terrain", () => {
    const m = new THREE.MeshLambertMaterial({ map: groundTex("earth"), vertexColors: true });
    m.onBeforeCompile = (s) => {
      s.uniforms["uGrass"] = { value: groundTex("grass") };
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aMix;\nvarying float vMix;\nvarying vec2 vWXZ;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMix = aMix; vWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>
uniform sampler2D uGrass;
varying float vMix;
varying vec2 vWXZ;
float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5); float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5); float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }`)
        .replace("#include <map_fragment>", `{
  vec3 e = texture2D(map, vMapUv).rgb / vec3(0.52, 0.44, 0.3);
  vec3 g = texture2D(uGrass, vMapUv * 1.3).rgb / vec3(0.3, 0.38, 0.14);
  float n = tn(vWXZ * 0.045) * 0.6 + tn(vWXZ * 0.17) * 0.4;
  float w = clamp(vMix + (n - 0.5) * 0.9, 0.0, 1.0);
  diffuseColor.rgb *= mix(e, g, w) * (0.86 + 0.28 * tn(vWXZ * 0.011));
}`);
    };
    m.customProgramCacheKey = () => "city-terrain";
    return tagMat(m, false);
  });
}
