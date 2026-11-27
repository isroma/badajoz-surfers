/**
 * City materials in the flat style of docs/design.md: a handful of shared Lambert materials
 * coloured through vertex colours. No PBR, no environment maps, no shadow maps. The only
 * textures are the tiny window grid and the text atlas (signs, plaques).
 */
import * as THREE from "three";
import { PAL } from "../palette";
import { LOD_VERTEX, LOD_VERTEX_PARS, SWAY_VERTEX, SWAY_VERTEX_PARS, U, tagMat } from "./shared";
import type { GroundName } from "./textures";

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m as T;
}

/** Every material the city uses (for prewarm / compile). */
export function allCityMaterials(): THREE.Material[] {
  return [...cache.values()];
}

/** The one flat material: Lambert, vertex colours. */
export function flatMaterial(): THREE.MeshLambertMaterial {
  return cached("flat", () => tagMat(new THREE.MeshLambertMaterial({ vertexColors: true }), false));
}

/** Flat, drawn over the ground with a polygon offset (road paint, decals). */
export function paintMaterial(): THREE.MeshLambertMaterial {
  return cached("paint", () => tagMat(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), false));
}

/** Flat vertex-coloured material drawn over the ground with a polygon offset (level 1..3). */
export function decalMaterial(level: number): THREE.MeshLambertMaterial {
  return cached(`decal-${level}`, () => tagMat(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -level, polygonOffsetUnits: -level * 2 }), false));
}

/** Surface colours of the road-side strips (the old textured surfaces map onto the palette). */
export const SURFACE_COLOUR: Record<GroundName, number> = {
  asphalt: PAL.road,
  sett: PAL.runnable,
  paving: PAL.runnable,
  hydraulic: PAL.pavement,
  slabs: PAL.runnable,
  grass: PAL.grass,
  albero: PAL.runnable,
  granite: PAL.kerb,
  roofFlat: PAL.flatRoof,
  roofTile: PAL.terracotta,
  earth: PAL.land,
};

/**
 * Compatibility shim: a "ground material" is the flat material tinted by the surface colour
 * (material colour × vertex colour). Prefer flatMaterial() with colours in the vertices.
 */
export function groundMaterial(name: GroundName, decal = 0): THREE.MeshLambertMaterial {
  return cached(`ground-${name}-${decal}`, () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, color: SURFACE_COLOUR[name] });
    if (decal !== 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -decal;
      m.polygonOffsetUnits = -decal * 2;
    }
    m.userData["surface"] = name;
    return tagMat(m, false);
  });
}
export const solidGroundMaterial = (name: GroundName): THREE.MeshLambertMaterial => groundMaterial(name);

/** Unlit vertex colour (lamp heads, lit signs). Brightened at night through the material colour. */
export function glowMaterial(): THREE.MeshBasicMaterial {
  return cached("glow", () => tagMat(new THREE.MeshBasicMaterial({ vertexColors: true }), false, false));
}

/** Soft warm light pools under lamps at night (additive). */
export function lightPoolMaterial(): THREE.MeshBasicMaterial {
  return cached("pool", () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.MeshBasicMaterial({ map: t, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    m.visible = false;
    return tagMat(m, false, false);
  });
}

// ---------------------------------------------------------------------------------------------
// Windows: a tiny shared texture, 4 x 4 windows (u = bays / 4, v = floors / 4); the emissive map
// lights about 40 % of them at night.
// ---------------------------------------------------------------------------------------------

function windowCanvas(lit: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.fillStyle = lit ? "#000" : "#fff";
  ctx.fillRect(0, 0, 128, 128);
  const on = [1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (lit && !on[y * 4 + x]) continue;
      ctx.fillStyle = lit ? "#fff" : "#" + PAL.window.toString(16).padStart(6, "0");
      ctx.fillRect(x * 32 + 9, y * 32 + 6, 14, 20);
    }
  }
  return c;
}

export function windowsMaterial(): THREE.MeshLambertMaterial {
  return cached("windows", () => {
    const map = new THREE.CanvasTexture(windowCanvas(false));
    const em = new THREE.CanvasTexture(windowCanvas(true));
    for (const t of [map, em]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.magFilter = THREE.NearestFilter;
    }
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, emissiveMap: em, emissive: 0x000000 });
    return tagMat(m, false);
  });
}

/** Night: windows glow warm, lamps brighten, light pools appear. */
export function setNightMaterials(night: boolean): void {
  const w = windowsMaterial();
  w.emissive.setHex(night ? PAL.windowLit : 0x000000);
  w.emissiveIntensity = night ? 0.9 : 0;
  glowMaterial().color.setScalar(night ? 1.6 : 0.85);
  lightPoolMaterial().visible = night;
}

/** Trees: flat crowns with a gentle wind sway; `lod` adds chunk masking (unused in the flat style). */
export function foliageMaterial(lod: boolean): THREE.MeshLambertMaterial {
  return cached(`foliage-${lod}`, () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    m.onBeforeCompile = (s) => {
      s.uniforms["uTime"] = U.uTime;
      s.uniforms["uChunkMask"] = U.uChunkMask;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", `#include <common>\n${SWAY_VERTEX_PARS}${lod ? LOD_VERTEX_PARS : ""}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${SWAY_VERTEX}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${lod ? LOD_VERTEX : ""}`);
    };
    m.customProgramCacheKey = () => `city-flat-foliage-${lod}`;
    return tagMat(m, false);
  });
}

/** The Guadiana: flat water blue with a slow light shimmer. */
export function waterMaterial(): THREE.MeshLambertMaterial {
  return cached("water", () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (s) => {
      s.uniforms["uTime"] = U.uTime;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWXZ;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec2 vWXZ;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          float sh = sin(vWXZ.x * 0.21 + uTime * 0.6) * sin(vWXZ.y * 0.17 - uTime * 0.45) + sin((vWXZ.x + vWXZ.y) * 0.09 + uTime * 0.3);
          totalEmissiveRadiance += vec3(0.06) * smoothstep(0.9, 1.8, sh);`,
        );
    };
    m.customProgramCacheKey = () => "city-flat-water";
    return tagMat(m, false);
  });
}

// ---------------------------------------------------------------------------------------------
// Text atlas: every sign, plaque and name in one 2048 x 2048 texture of 512 x 96 slots, drawn
// once (prewarm draws all the city's names at load). LRU reuse if it ever fills up.
// ---------------------------------------------------------------------------------------------

/** Slots are drawn at 512 x 96 design units, stored at half resolution: 336 slots, the whole lap fits. */
const SLOT_W = 256;
const SLOT_H = 48;
const ATLAS = 2048;
const COLS = ATLAS / SLOT_W;
const ROWS = Math.floor(ATLAS / SLOT_H);
let atlasCanvas: HTMLCanvasElement | null = null;
let atlasTex: THREE.CanvasTexture | null = null;
const slots = new Map<string, { i: number; used: number }>();
let useClock = 0;

function textAtlas(): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  if (!atlasCanvas || !atlasTex) {
    atlasCanvas = document.createElement("canvas");
    atlasCanvas.width = ATLAS;
    atlasCanvas.height = ATLAS;
    atlasTex = new THREE.CanvasTexture(atlasCanvas);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = 4;
  }
  return { canvas: atlasCanvas, tex: atlasTex };
}

/** All text in one unlit material (signs read the same in any light): one draw call per chunk. */
export function signMaterial(_lit = false): THREE.Material {
  return cached("signs", () => {
    const { tex } = textAtlas();
    return tagMat(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }), false);
  });
}

/**
 * The uv rect of a text slot (drawn on first use with `draw(ctx, w, h)` into a 512 x 96 area).
 * Returns [u0, v0, u1, v1].
 */
export function signSlot(key: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): [number, number, number, number] {
  const { canvas, tex } = textAtlas();
  let s = slots.get(key);
  if (!s) {
    let i = slots.size;
    if (i >= COLS * ROWS) {
      // full (should not happen: the atlas holds the whole lap): reuse the least recently used slot
      console.warn("city text atlas full");
      let oldest: [string, { i: number; used: number }] | null = null;
      for (const e of slots) if (!oldest || e[1].used < oldest[1].used) oldest = e;
      if (oldest) {
        slots.delete(oldest[0]);
        i = oldest[1].i;
      }
    }
    s = { i, used: 0 };
    slots.set(key, s);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const x = (i % COLS) * SLOT_W;
      const y = Math.floor(i / COLS) * SLOT_H;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, SLOT_W, SLOT_H);
      ctx.clip();
      ctx.clearRect(0, 0, SLOT_W, SLOT_H);
      ctx.scale(SLOT_W / 512, SLOT_H / 96);
      draw(ctx, 512, 96);
      ctx.restore();
      tex.needsUpdate = true;
    }
  }
  s.used = ++useClock;
  const x = (s.i % COLS) * SLOT_W;
  const y = Math.floor(s.i / COLS) * SLOT_H;
  return [(x + 2) / ATLAS, 1 - (y + SLOT_H - 2) / ATLAS, (x + SLOT_W - 2) / ATLAS, 1 - (y + 2) / ATLAS];
}

/** A flat sign panel: background colour, centred text in a colour (system font, bold). */
export function drawLabel(text: string, bg: string, fg: string, opts: { serif?: boolean; upper?: boolean; border?: string } = {}): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, w - 12, h - 12);
    }
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const face = opts.serif ? "Georgia, serif" : "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
    const t = opts.upper ? text.toUpperCase() : text;
    let size = 56;
    ctx.font = `800 ${size}px ${face}`;
    while (ctx.measureText(t).width > w - 36 && size > 18) {
      size -= 2;
      ctx.font = `800 ${size}px ${face}`;
    }
    ctx.fillText(t, w / 2, h / 2 + 3);
  };
}

// ---------------------------------------------------------------------------------------------
// Compatibility names used across the city modules (all flat now)
// ---------------------------------------------------------------------------------------------
export const propMaterial = (_cast = true): THREE.MeshLambertMaterial => flatMaterial();
export const metalMaterial = (): THREE.MeshLambertMaterial => flatMaterial();
export const glassMaterial = (): THREE.MeshLambertMaterial => flatMaterial();
export const farMaterial = (): THREE.MeshLambertMaterial => flatMaterial();
export const terrainMaterial = (): THREE.MeshLambertMaterial => flatMaterial();
export const roofMaterial = (_k: "flat" | "tile"): THREE.MeshLambertMaterial => flatMaterial();
