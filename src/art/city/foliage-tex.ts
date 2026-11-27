/**
 * Foliage atlas (1024 x 1024, 4 x 4 cells of 256 px): leaf-cluster cards per species, palm
 * fronds, barks and a dry-grass tuft. Built as a DataTexture so the colour under transparent
 * pixels survives (no dark fringes in the mipmaps of alpha-tested cards).
 *
 * Cell coordinates: (col, row) with row 0 at the TOP of the image; `cellUv` returns uv rects
 * with v pointing up as three expects.
 */
import * as THREE from "three";
import { makeRng, type Rng } from "../rng";

const SIZE = 1024;
const CELL = 256;

export const FOL = {
  plane: [0, 0],
  plane2: [1, 0],
  jacaranda: [2, 0],
  jacarandaBloom: [3, 0],
  orange: [0, 1],
  pine: [1, 1],
  cypress: [2, 1],
  poplar: [3, 1],
  frond: [0, 2], // 2 cells wide
  fan: [2, 2], // 2 cells wide
  barkPlane: [0, 3],
  bark: [1, 3],
  palmTrunk: [2, 3],
  tuft: [3, 3],
} as const;
export type FolCell = keyof typeof FOL;

/** uv rect [u0, v0, u1, v1] of a cell (v up). `w` = cells wide. */
export function cellUv(c: FolCell, w = c === "frond" || c === "fan" ? 2 : 1): [number, number, number, number] {
  const [col, row] = FOL[c];
  const u0 = (col * CELL + 2) / SIZE;
  const u1 = ((col + w) * CELL - 2) / SIZE;
  const v1 = 1 - (row * CELL + 2) / SIZE;
  const v0 = 1 - ((row + 1) * CELL - 2) / SIZE;
  return [u0, v0, u1, v1];
}

type Ctx = CanvasRenderingContext2D;

function leaf(ctx: Ctx, x: number, y: number, len: number, wid: number, ang: number, col: string, lobed = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = col;
  ctx.beginPath();
  if (lobed) {
    // palmate (plane tree) leaf: 5 lobes
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + ((k - 2) * Math.PI) / 5;
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a - 0.3) * len * 0.6, Math.sin(a - 0.3) * len * 0.6, Math.cos(a) * len, Math.sin(a) * len);
      ctx.quadraticCurveTo(Math.cos(a + 0.3) * len * 0.6, Math.sin(a + 0.3) * len * 0.6, 0, 0);
    }
    ctx.arc(0, -len * 0.25, len * 0.42, 0, Math.PI * 2);
  } else {
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len);
    ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
  }
  ctx.fill();
  ctx.restore();
}

function shade(r: Rng, base: [number, number, number], v = 0.18): string {
  const k = 1 + (r.next() - 0.5) * 2 * v;
  const [a, b, c] = base;
  return `rgb(${Math.min(255, Math.round(a * k))},${Math.min(255, Math.round(b * k))},${Math.min(255, Math.round(c * k))})`;
}

function cluster(ctx: Ctx, ox: number, oy: number, r: Rng, n: number, base: [number, number, number], len: number, wid: number, lobed: boolean, spread = 0.42): void {
  // twig from the bottom centre, leaves fanning out
  ctx.strokeStyle = "rgb(90,75,55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ox + CELL / 2, oy + CELL - 4);
  ctx.quadraticCurveTo(ox + CELL / 2 + 10, oy + CELL * 0.6, ox + CELL / 2, oy + CELL * 0.35);
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const a = r.next() * Math.PI * 2;
    const d = Math.sqrt(r.next()) * CELL * spread;
    const x = ox + CELL / 2 + Math.cos(a) * d;
    const y = oy + CELL / 2 + Math.sin(a) * d * 0.9;
    // darker inside, lighter at the rim (self-shadowing)
    const rim = d / (CELL * spread);
    const b: [number, number, number] = [base[0] * (0.7 + 0.4 * rim), base[1] * (0.7 + 0.4 * rim), base[2] * (0.7 + 0.4 * rim)];
    leaf(ctx, x, y, len * (0.8 + r.next() * 0.4), wid, a + Math.PI / 2 + (r.next() - 0.5), shade(r, b), lobed);
  }
}

let tex: THREE.DataTexture | null = null;

export function foliageAtlas(): THREE.DataTexture {
  if (tex) return tex;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas unavailable");
  const r = makeRng(9091);
  const at = (c: FolCell): [number, number] => [FOL[c][0] * CELL, FOL[c][1] * CELL];
  // leaf clusters
  {
    const [x, y] = at("plane");
    cluster(ctx, x, y, r, 70, [96, 128, 62], 34, 16, true);
  }
  {
    const [x, y] = at("plane2");
    cluster(ctx, x, y, r, 70, [112, 134, 66], 30, 16, true);
  }
  {
    const [x, y] = at("jacaranda");
    for (let k = 0; k < 9; k++) {
      // bipinnate fronds of tiny leaflets
      const a = r.next() * Math.PI * 2;
      const L = 60 + r.next() * 50;
      for (let t = 0; t < 1; t += 0.06) {
        const px = x + CELL / 2 + Math.cos(a) * L * t;
        const py = y + CELL / 2 + Math.sin(a) * L * t;
        leaf(ctx, px, py, 12, 4, a + 1.3, shade(r, [92, 126, 64]));
        leaf(ctx, px, py, 12, 4, a - 1.8, shade(r, [92, 126, 64]));
      }
    }
  }
  {
    const [x, y] = at("jacarandaBloom");
    for (let k = 0; k < 140; k++) {
      const a = r.next() * Math.PI * 2;
      const d = Math.sqrt(r.next()) * CELL * 0.42;
      ctx.fillStyle = shade(r, [150, 120, 205], 0.15);
      ctx.beginPath();
      ctx.arc(x + CELL / 2 + Math.cos(a) * d, y + CELL / 2 + Math.sin(a) * d, 5 + r.next() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  {
    const [x, y] = at("orange");
    cluster(ctx, x, y, r, 110, [52, 88, 44], 26, 11, false, 0.44);
    for (let k = 0; k < 7; k++) {
      const a = r.next() * Math.PI * 2;
      const d = Math.sqrt(r.next()) * CELL * 0.35;
      ctx.fillStyle = shade(r, [235, 140, 40], 0.1);
      ctx.beginPath();
      ctx.arc(x + CELL / 2 + Math.cos(a) * d, y + CELL / 2 + Math.sin(a) * d, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  {
    const [x, y] = at("pine");
    for (let k = 0; k < 26; k++) {
      const cx = x + CELL / 2 + (r.next() - 0.5) * CELL * 0.7;
      const cy = y + CELL / 2 + (r.next() - 0.5) * CELL * 0.5;
      for (let j = 0; j < 22; j++) {
        const a = r.next() * Math.PI * 2;
        const L = 14 + r.next() * 18;
        ctx.strokeStyle = shade(r, [70, 102, 52]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
        ctx.stroke();
      }
    }
  }
  {
    const [x, y] = at("cypress");
    for (let k = 0; k < 900; k++) {
      const a = r.next() * Math.PI * 2;
      const d = Math.sqrt(r.next());
      const px = x + CELL / 2 + Math.cos(a) * d * CELL * 0.45;
      const py = y + CELL / 2 + Math.sin(a) * d * CELL * 0.47;
      ctx.fillStyle = shade(r, [48 + 30 * d, 72 + 30 * d, 44 + 10 * d], 0.12);
      ctx.fillRect(px, py, 5, 5);
    }
  }
  {
    const [x, y] = at("poplar");
    cluster(ctx, x, y, r, 120, [118, 146, 70], 18, 10, false, 0.44);
  }
  // Canary palm frond: arching rachis with pinnae (two cells wide, base on the left)
  {
    const [x, y] = at("frond");
    const W = CELL * 2;
    ctx.strokeStyle = "rgb(150,140,80)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + CELL / 2);
    ctx.lineTo(x + W - 6, y + CELL / 2);
    ctx.stroke();
    for (let t = 0.08; t < 0.98; t += 0.012) {
      const px = x + 4 + (W - 10) * t;
      const L = CELL * 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 6;
      for (const sgn of [-1, 1]) {
        ctx.strokeStyle = shade(r, [88, 118, 56], 0.15);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, y + CELL / 2);
        ctx.lineTo(px + L * 0.35, y + CELL / 2 + sgn * L);
        ctx.stroke();
      }
    }
  }
  // Washingtonia fan leaf (two cells wide): radiating segments over a semicircle
  {
    const [x, y] = at("fan");
    const cx = x + CELL;
    const cy = y + CELL - 6;
    for (let k = 0; k < 60; k++) {
      const a = Math.PI + (k / 59) * Math.PI;
      const L = CELL * (0.82 + r.next() * 0.12);
      ctx.strokeStyle = shade(r, [94, 124, 70], 0.12);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      ctx.stroke();
    }
  }
  // barks (opaque)
  {
    const [x, y] = at("barkPlane");
    ctx.fillStyle = "rgb(196,188,160)";
    ctx.fillRect(x, y, CELL, CELL);
    for (let k = 0; k < 90; k++) {
      ctx.fillStyle = r.pick(["rgb(150,152,120)", "rgb(214,206,176)", "rgb(132,140,110)", "rgb(176,170,140)"]);
      ctx.beginPath();
      ctx.ellipse(x + r.next() * CELL, y + r.next() * CELL, 8 + r.next() * 22, 6 + r.next() * 16, r.next() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  {
    const [x, y] = at("bark");
    ctx.fillStyle = "rgb(98,80,62)";
    ctx.fillRect(x, y, CELL, CELL);
    for (let k = 0; k < 60; k++) {
      ctx.fillStyle = r.pick(["rgb(70,58,46)", "rgb(120,100,78)"]);
      ctx.fillRect(x + r.next() * CELL, y, 3 + r.next() * 5, CELL);
    }
  }
  {
    const [x, y] = at("palmTrunk");
    ctx.fillStyle = "rgb(128,110,84)";
    ctx.fillRect(x, y, CELL, CELL);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 6; col++) {
        const cx = x + (col + (row % 2) * 0.5) * (CELL / 6);
        const cy = y + row * (CELL / 8);
        ctx.fillStyle = r.pick(["rgb(150,130,98)", "rgb(112,96,72)", "rgb(140,122,92)"]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + CELL / 12, cy + CELL / 16);
        ctx.lineTo(cx, cy + CELL / 8);
        ctx.lineTo(cx - CELL / 12, cy + CELL / 16);
        ctx.fill();
      }
    }
  }
  {
    const [x, y] = at("tuft");
    for (let k = 0; k < 70; k++) {
      const bx = x + CELL / 2 + (r.next() - 0.5) * CELL * 0.7;
      ctx.strokeStyle = shade(r, r.chance(0.5) ? [180, 160, 90] : [130, 138, 70], 0.15);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, y + CELL - 2);
      ctx.quadraticCurveTo(bx + (r.next() - 0.5) * 30, y + CELL * 0.6, bx + (r.next() - 0.5) * 70, y + CELL * (0.1 + r.next() * 0.4));
      ctx.stroke();
    }
  }
  // build the DataTexture: alpha from the drawing, colour of empty pixels from the cell's average
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y += 2) for (let x = cx * CELL; x < (cx + 1) * CELL; x += 2) {
        const i = (y * SIZE + x) * 4;
        if (d[i + 3]! > 128) { sr += d[i]!; sg += d[i + 1]!; sb += d[i + 2]!; n++; }
      }
      if (n === 0) continue;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++) for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
        const i = (y * SIZE + x) * 4;
        const a = d[i + 3]!;
        if (a < 255) {
          const k = a / 255;
          d[i] = Math.round(d[i]! * k + (sr / n) * (1 - k));
          d[i + 1] = Math.round(d[i + 1]! * k + (sg / n) * (1 - k));
          d[i + 2] = Math.round(d[i + 2]! * k + (sb / n) * (1 - k));
        }
      }
    }
  }
  // flip rows so v = 1 is the top of the image (as for canvas textures)
  const flipped = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) flipped.set(d.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
  tex = new THREE.DataTexture(flipped, SIZE, SIZE, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
