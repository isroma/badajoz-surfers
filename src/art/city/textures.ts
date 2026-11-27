/**
 * Procedural textures for the real city: the facade atlas (one 512 px tile = 2 bays x 2 floors,
 * or 2 bays x the ground floor), road and pavement surfaces, roofs.
 *
 * Facade alpha channel: 1 = wall; glass panes store their relative height (0.55 bottom → 0.95 top)
 * so the facade shader can draw roller blinds at random heights and light windows at night.
 */
import * as THREE from "three";
import { makeRng, type Rng } from "../rng";

type Ctx = CanvasRenderingContext2D;

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
const TILE = 512;

/** Facade tile ids (index = col + row * 8). */
export const FT = {
  brickBalcony: 0,
  brickMirador: 1,
  brickAwning: 2,
  brickPlain: 3,
  shopShutter: 4,
  portalShop: 5,
  renderBalcony: 6,
  renderWindows: 7,
  renderPlain: 8,
  stoneShops: 9,
  cascoBalcony: 10,
  cascoWindows: 11,
  cascoPlain: 12,
  cascoHouse: 13,
  cascoShop: 14,
  modernStrip: 15,
  glassCurtain: 16,
  modernPlain: 17,
  glassShop: 18,
  shed: 19,
  stone: 20,
  stonePlain: 21,
  renderMirador: 22,
  brickTerrace: 23,
  plazaAlta: 24,
  plazaAltaArcade: 25,
  tapial: 26,
  brickOchre: 27,
  cascoGround: 28,
  shedGround: 29,
  roofFlat: 30,
  roofTile: 31,
} as const;

interface GlassRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cell drawing frame: metres → pixels, y measured up from the floor line. */
class Cell {
  constructor(
    readonly ctx: Ctx,
    readonly ox: number,
    readonly oy: number,
    readonly w: number,
    readonly h: number,
    readonly sx: number,
    readonly sy: number,
    readonly glass: GlassRect[],
  ) {}
  X(x: number): number {
    return this.ox + x * this.sx;
  }
  Y(y: number): number {
    return this.oy + this.h - y * this.sy;
  }
  /** Rect from metre coordinates (x0..x1, y0..y1 up). */
  rect(x0: number, y0: number, x1: number, y1: number, fill: string): void {
    this.ctx.fillStyle = fill;
    const a = this.X(x0);
    const b = this.X(x1);
    const c = this.Y(y1);
    const d = this.Y(y0);
    this.ctx.fillRect(a, c, b - a, d - c);
  }
  glassRect(x0: number, y0: number, x1: number, y1: number, rng: Rng, tint = "#34414d"): void {
    this.rect(x0, y0, x1, y1, tint);
    // sky reflection gradient + a diagonal sheen
    const g = this.ctx.createLinearGradient(this.X(x0), this.Y(y1), this.X(x1), this.Y(y0));
    g.addColorStop(0, "rgba(190,210,230,0.45)");
    g.addColorStop(0.45, "rgba(120,140,160,0.12)");
    g.addColorStop(1, "rgba(20,25,30,0.25)");
    this.ctx.fillStyle = g;
    this.ctx.fillRect(this.X(x0), this.Y(y1), this.X(x1) - this.X(x0), this.Y(y0) - this.Y(y1));
    // something inside (curtain)
    if (rng.chance(0.5)) this.rect(x0 + (x1 - x0) * rng.range(0, 0.4), y0, x0 + (x1 - x0) * rng.range(0.5, 1), y1, "rgba(230,220,200,0.16)");
    this.glass.push({ x0: this.X(x0), y0: this.Y(y1), x1: this.X(x1), y1: this.Y(y0) });
  }
}

function speckle(ctx: Ctx, x: number, y: number, w: number, h: number, rng: Rng, n: number, amount: number, size = 2): void {
  for (let i = 0; i < n; i++) {
    const v = rng.chance(0.5) ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rng.next() * amount})`;
    const s = 0.8 + rng.next() * size;
    ctx.fillRect(x + rng.next() * w, y + rng.next() * h, s, s);
  }
}

/** Dirt streaks running down from y (pixels) over a span. */
function streaks(ctx: Ctx, x0: number, x1: number, y: number, len: number, rng: Rng, alpha = 0.08): void {
  for (let i = 0; i < 10; i++) {
    const x = x0 + rng.next() * (x1 - x0);
    const g = ctx.createLinearGradient(0, y, 0, y + len * rng.range(0.4, 1));
    g.addColorStop(0, `rgba(60,50,40,${alpha})`);
    g.addColorStop(1, "rgba(60,50,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 1 + rng.next() * 3, len);
  }
}

function wallFill(c: Cell, base: string, rng: Rng, amount = 0.07): void {
  c.ctx.fillStyle = base;
  c.ctx.fillRect(c.ox, c.oy, c.w, c.h);
  speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 900, amount, 2.5);
  // large soft blotches (render ageing)
  for (let i = 0; i < 6; i++) {
    const g = c.ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const tone = rng.chance(0.5) ? "0,0,0" : "255,255,255";
    g.addColorStop(0, `rgba(${tone},${0.05 * rng.next()})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    c.ctx.save();
    c.ctx.translate(c.ox + rng.next() * c.w, c.oy + rng.next() * c.h);
    c.ctx.scale(30 + rng.next() * 90, 20 + rng.next() * 60);
    c.ctx.fillStyle = g;
    c.ctx.fillRect(-1, -1, 2, 2);
    c.ctx.restore();
  }
}

function brickFill(c: Cell, rng: Rng, palette: readonly string[], mortar = "#cbbfae"): void {
  const ctx = c.ctx;
  ctx.fillStyle = mortar;
  ctx.fillRect(c.ox, c.oy, c.w, c.h);
  const course = 0.075 * c.sy;
  const blen = 0.25 * c.sx;
  const rows = Math.ceil(c.h / course);
  for (let r = 0; r < rows; r++) {
    const y = c.oy + r * course;
    const off = (r % 2) * blen * 0.5;
    for (let x = c.ox - off; x < c.ox + c.w; x += blen) {
      ctx.fillStyle = rng.pick(palette);
      ctx.fillRect(Math.max(c.ox, x + 0.8), y + 0.8, Math.min(blen - 1.2, c.ox + c.w - x - 0.8), course - 1.2);
    }
  }
  speckle(ctx, c.ox, c.oy, c.w, c.h, rng, 500, 0.08, 2);
}

const BRICK_RED = ["#a4553c", "#9a4d36", "#ab5d41", "#94503a", "#b0624a", "#a05a43"];
const BRICK_OCHRE = ["#c7955f", "#bf8b58", "#cf9f69", "#b98455", "#c39462", "#d0a873"];

/** A standard window with frame, sill and lintel. Returns nothing; glass recorded. */
function windowUnit(c: Cell, rng: Rng, cx: number, y0: number, w: number, h: number, o: { frame?: string; sill?: string; reja?: boolean; shutters?: string; mullion?: boolean; lintel?: string; surround?: string } = {}): void {
  const frame = o.frame ?? "#e9e7e1";
  if (o.surround) c.rect(cx - w / 2 - 0.16, y0 - 0.12, cx + w / 2 + 0.16, y0 + h + 0.16, o.surround);
  if (o.lintel) c.rect(cx - w / 2 - 0.12, y0 + h, cx + w / 2 + 0.12, y0 + h + 0.14, o.lintel);
  c.rect(cx - w / 2, y0, cx + w / 2, y0 + h, frame);
  const f = 0.06;
  c.glassRect(cx - w / 2 + f, y0 + f, cx + w / 2 - f, y0 + h - f, rng);
  if (o.mullion !== false) c.rect(cx - 0.025, y0 + f, cx + 0.025, y0 + h - f, frame);
  if (o.sill) c.rect(cx - w / 2 - 0.08, y0 - 0.07, cx + w / 2 + 0.08, y0 + 0.02, o.sill);
  if (o.shutters) {
    c.rect(cx - w / 2 - w * 0.48, y0, cx - w / 2 - 0.02, y0 + h, o.shutters);
    c.rect(cx + w / 2 + 0.02, y0, cx + w / 2 + w * 0.48, y0 + h, o.shutters);
    for (let k = 1; k < 10; k++) {
      const y = y0 + (h * k) / 10;
      c.rect(cx - w / 2 - w * 0.48, y, cx - w / 2 - 0.02, y + 0.015, "rgba(0,0,0,0.25)");
      c.rect(cx + w / 2 + 0.02, y, cx + w / 2 + w * 0.48, y + 0.015, "rgba(0,0,0,0.25)");
    }
  }
  if (o.reja) {
    for (let k = 0; k <= 6; k++) {
      const x = cx - w / 2 + 0.05 + ((w - 0.1) * k) / 6;
      c.rect(x - 0.012, y0 - 0.05, x + 0.012, y0 + h + 0.05, "#1d1c1b");
    }
    for (const yy of [y0 + 0.1, y0 + h * 0.5, y0 + h - 0.1]) c.rect(cx - w / 2 - 0.03, yy - 0.012, cx + w / 2 + 0.03, yy + 0.012, "#1d1c1b");
  }
}

/** Iron balcony railing drawn flat (the 3D relief adds the real one near the road). */
function railing(c: Cell, x0: number, x1: number, y: number, h = 1.0, col = "#1f1f1f"): void {
  c.rect(x0, y + h - 0.04, x1, y + h, col);
  c.rect(x0, y + 0.08, x1, y + 0.11, col);
  for (let x = x0 + 0.06; x < x1; x += 0.12) c.rect(x - 0.01, y + 0.08, x + 0.01, y + h, col);
}

function slab(c: Cell, x0: number, x1: number, y: number, col = "#d8d3c8"): void {
  c.rect(x0, y - 0.15, x1, y, col);
  c.rect(x0, y - 0.25, x1, y - 0.15, "rgba(0,0,0,0.18)");
}

function geraniums(c: Cell, rng: Rng, x0: number, x1: number, y: number): void {
  for (let x = x0 + 0.1; x < x1 - 0.1; x += rng.range(0.25, 0.5)) {
    c.rect(x - 0.1, y, x + 0.1, y + 0.18, "#b5653a");
    for (let k = 0; k < 5; k++) {
      const px = x + rng.range(-0.15, 0.15);
      const py = y + 0.18 + rng.range(0, 0.25);
      c.rect(px - 0.05, py - 0.04, px + 0.05, py + 0.05, rng.chance(0.55) ? "#3f6b2f" : rng.pick(["#d1283a", "#e0457b", "#c71c2c"]));
    }
  }
}

function acUnit(c: Cell, x: number, y: number): void {
  c.rect(x - 0.4, y, x + 0.4, y + 0.55, "#d9dad6");
  c.rect(x - 0.33, y + 0.08, x + 0.15, y + 0.47, "#9ea19f");
  for (let k = 0; k < 6; k++) c.rect(x + 0.18, y + 0.1 + k * 0.06, x + 0.34, y + 0.12 + k * 0.06, "#b8bab6");
  c.rect(x - 0.4, y - 0.04, x + 0.4, y, "rgba(0,0,0,0.25)");
}

function awningOver(c: Cell, cx: number, y: number, w: number, colA: string, colB: string): void {
  const n = 8;
  for (let k = 0; k < n; k++) c.rect(cx - w / 2 + (w * k) / n, y - 0.6, cx - w / 2 + (w * (k + 1)) / n, y, k % 2 ? colA : colB);
  c.rect(cx - w / 2, y - 0.72, cx + w / 2, y - 0.6, colA);
  c.rect(cx - w / 2, y - 0.85, cx + w / 2, y - 0.72, "rgba(0,0,0,0.15)");
}

function rollerShutter(c: Cell, x0: number, x1: number, y0: number, y1: number, rng: Rng): void {
  c.rect(x0, y0, x1, y1, rng.pick(["#b9bcbc", "#a9aeb0", "#c6c4bc"]));
  for (let y = y0; y < y1; y += 0.07) c.rect(x0, y, x1, y + 0.015, "rgba(0,0,0,0.18)");
  // graffiti tag now and then
  if (rng.chance(0.4)) {
    c.ctx.strokeStyle = rng.pick(["#2d2d2d", "#a1271c", "#1f4fa0"]);
    c.ctx.lineWidth = 3;
    c.ctx.beginPath();
    let x = c.X(x0 + 0.3);
    const yb = c.Y(y0 + 0.6);
    c.ctx.moveTo(x, yb);
    for (let k = 0; k < 7; k++) {
      x += rng.range(6, 16);
      c.ctx.lineTo(x, yb - rng.range(-14, 14));
    }
    c.ctx.stroke();
  }
}

function fascia(c: Cell, x0: number, x1: number, y0: number, y1: number, rng: Rng): void {
  const col = rng.pick(["#1f4f8a", "#a32a2a", "#2e6b3f", "#333a40", "#c58b22", "#5a3d7a", "#f2efe8"]);
  c.rect(x0, y0, x1, y1, col);
  c.rect(x0, y0, x1, y0 + 0.05, "rgba(0,0,0,0.3)");
  // abstract lettering blocks
  const light = col === "#f2efe8" ? "#30343a" : "#f4f1e8";
  let x = x0 + 0.25;
  while (x < x1 - 0.4) {
    const w = rng.range(0.08, 0.22);
    c.rect(x, y0 + (y1 - y0) * 0.3, x + w, y0 + (y1 - y0) * 0.72, light);
    x += w + rng.range(0.04, 0.09);
    if (rng.chance(0.15)) x += 0.2;
  }
}

// -----------------------------------------------------------------------------------------------
// Tiles
// -----------------------------------------------------------------------------------------------

type TileDraw = (cells: Cell[], rng: Rng) => void;

const BAY = 3.2;
const FLOOR = 3.0;
const GROUND = 3.8;

/** Upper tiles: 4 cells (2 bays x 2 floors), bottom-left first in reading order: [b0f0, b1f0, b0f1, b1f1]. */
const UPPER: Record<number, TileDraw> = {
  [FT.brickBalcony]: (cells, rng) => {
    for (const c of cells) {
      brickFill(c, rng, BRICK_RED);
      c.rect(0, 0, BAY, 0.25, "#d7d0c2");
      windowUnit(c, rng, BAY / 2, 0.25, 1.1, 2.15, { frame: "#efece6", lintel: "#cfc5b2" });
      slab(c, 0.3, BAY - 0.3, 0.25, "#d4cdbf");
      railing(c, 0.35, BAY - 0.35, 0.25);
      if (rng.chance(0.35)) geraniums(c, rng, 0.5, 1.0, 0.25);
    }
  },
  [FT.brickMirador]: (cells, rng) => {
    for (const c of cells) {
      brickFill(c, rng, BRICK_OCHRE);
      // glazed white aluminium mirador across most of the bay
      c.rect(0.25, 0.0, BAY - 0.25, 0.95, "#ece9e2");
      for (let k = 0; k < 3; k++) {
        const x0 = 0.35 + k * ((BAY - 0.7) / 3);
        c.glassRect(x0 + 0.05, 1.0, x0 + (BAY - 0.7) / 3 - 0.05, 2.55, rng);
      }
      c.rect(0.25, 0.95, BAY - 0.25, 1.0, "#ece9e2");
      c.rect(0.25, 2.55, BAY - 0.25, 2.7, "#ece9e2");
      c.rect(0.25, -0.1, BAY - 0.25, 0.0, "rgba(0,0,0,0.25)");
    }
  },
  [FT.brickAwning]: (cells, rng) => {
    const awn = rng.pick([["#2f6b3a", "#e8e4d6"], ["#2f6b3a", "#2f6b3a"], ["#b5632e", "#e8d9b8"]] as const);
    for (const c of cells) {
      brickFill(c, rng, BRICK_RED);
      windowUnit(c, rng, BAY / 2, 0.9, 1.3, 1.45, { sill: "#d9d2c4", frame: "#e8e6df" });
      if (rng.chance(0.6)) awningOver(c, BAY / 2, 2.75, 1.6, awn[0], awn[1]);
      if (rng.chance(0.3)) acUnit(c, BAY / 2 + 1.0, 0.4);
    }
  },
  [FT.renderBalcony]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#efe7d6", rng);
      c.rect(0, 0, BAY, 0.18, "#e2d8c3");
      windowUnit(c, rng, BAY / 2, 0.18, 1.05, 2.2, { frame: "#5a4a3a", lintel: "#e4dac6", surround: "#f6f1e6" });
      slab(c, 0.6, BAY - 0.6, 0.18, "#e5dccb");
      railing(c, 0.65, BAY - 0.65, 0.18, 1.0, "#24211f");
      if (rng.chance(0.4)) geraniums(c, rng, 0.8, 1.2, 0.18);
      // pilaster strips between bays
      c.rect(0, 0, 0.12, FLOOR, "rgba(0,0,0,0.05)");
    }
    for (const c of cells) streaks(c.ctx, c.X(1), c.X(2.2), c.Y(0.1), 60, rng, 0.05);
  },
  [FT.renderWindows]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#ede1c8", rng);
      windowUnit(c, rng, BAY / 2, 0.95, 1.2, 1.5, { sill: "#e3d6bc", frame: "#f3f0e8", surround: "#f5efe2", lintel: "#e8dcc2" });
      c.rect(0, FLOOR - 0.12, BAY, FLOOR, "rgba(0,0,0,0.05)");
      if (rng.chance(0.25)) acUnit(c, BAY / 2 + 1.05, 1.1);
    }
    for (const c of cells) streaks(c.ctx, c.X(0.9), c.X(2.3), c.Y(0.9), 70, rng, 0.05);
  },
  [FT.renderMirador]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#f0eadc", rng);
      c.rect(0.3, 0, BAY - 0.3, FLOOR, "#f4f2ec");
      c.rect(0.3, 0, BAY - 0.3, 0.9, "#e9e5db");
      for (let k = 0; k < 2; k++) c.glassRect(0.4 + k * 1.25, 0.95, 0.4 + k * 1.25 + 1.15, 2.7, rng);
      c.rect(0.3, 2.75, BAY - 0.3, FLOOR, "#e0dbcf");
    }
  },
  [FT.cascoBalcony]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#f7f4ec", rng, 0.05);
      windowUnit(c, rng, BAY / 2 - 0.2, 0.15, 1.0, 2.25, { frame: "#3b5a3a", surround: "#e3b54e", mullion: true });
      slab(c, 0.6, BAY - 1.0, 0.15, "#ece7da");
      railing(c, 0.65, BAY - 1.05, 0.15, 1.0, "#1b1a19");
      geraniums(c, rng, 0.75, 1.65, 0.15);
    }
  },
  [FT.cascoWindows]: (cells, rng) => {
    const trim = rng.chance(0.5) ? "#9fa3a6" : "#e3b54e";
    for (const c of cells) {
      wallFill(c, "#f7f4ee", rng, 0.05);
      windowUnit(c, rng, BAY / 2, 1.0, 0.9, 1.3, { surround: trim, reja: true, frame: "#3e2b1e", sill: trim });
      if (rng.chance(0.3)) geraniums(c, rng, BAY / 2 - 0.4, BAY / 2 + 0.4, 0.95);
    }
  },
  [FT.modernStrip]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#e6e4df", rng, 0.04);
      c.rect(0, 0, BAY, 0.95, "#d9d7d1");
      c.glassRect(0, 1.0, BAY, 2.5, rng, "#3b4855");
      for (const x of [0, BAY / 2]) c.rect(x - 0.04, 1.0, x + 0.04, 2.5, "#9aa0a6");
      c.rect(0, 0.95, BAY, 1.0, "#a7adb2");
    }
  },
  [FT.glassCurtain]: (cells, rng) => {
    for (const c of cells) {
      c.glassRect(0, 0, BAY, FLOOR, rng, "#41596f");
      for (const x of [0, BAY / 2, BAY]) c.rect(x - 0.05, 0, x + 0.05, FLOOR, "#c9d1d6");
      c.rect(0, FLOOR - 0.35, BAY, FLOOR, "#2d3e4c");
    }
  },
  [FT.brickTerrace]: (cells, rng) => {
    for (const c of cells) {
      brickFill(c, rng, BRICK_RED);
      c.rect(0, 0, BAY, 1.1, "#c7bfb0");
      c.rect(0, 1.0, BAY, 1.1, "#e2dccf");
      c.rect(0, 1.1, BAY, FLOOR, "#59392c");
      windowUnit(c, rng, BAY / 2, 1.15, 2.2, 1.65, { frame: "#e8e5de" });
      railing(c, 0, BAY, 0.05, 1.0, "#2a2725");
    }
  },
  [FT.brickOchre]: (cells, rng) => {
    for (const c of cells) {
      brickFill(c, rng, BRICK_OCHRE, "#d9ccb6");
      windowUnit(c, rng, BAY / 2, 0.9, 1.3, 1.5, { sill: "#e6dfd1", frame: "#7b5c3e" });
      if (rng.chance(0.35)) acUnit(c, BAY / 2 - 1.1, 0.3);
    }
  },
  [FT.plazaAlta]: (cells, rng) => {
    for (const [i, c] of cells.entries()) {
      wallFill(c, "#f3ece0", rng, 0.04);
      // red and white (and blue-grey) geometric bands of the Plaza Alta houses
      const red = i % 2 ? "#a8382d" : "#3f5f7a";
      for (let k = 0; k < 6; k++) {
        const y = 0.2 + k * 0.46;
        for (let x = 0; x < BAY; x += 0.4) {
          if ((Math.floor(x / 0.4) + k) % 2 === 0) c.rect(x, y, x + 0.4, y + 0.46, red);
        }
      }
      c.rect(BAY / 2 - 0.65, 0.4, BAY / 2 + 0.65, 2.5, "#f3ece0");
      windowUnit(c, rng, BAY / 2, 0.55, 1.0, 1.8, { frame: "#3a2b22", reja: false });
      railing(c, BAY / 2 - 0.6, BAY / 2 + 0.6, 0.5, 0.9);
    }
  },
  [FT.tapial]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#c99a63", rng, 0.12);
      for (let y = 0; y < FLOOR; y += 0.85) {
        c.rect(0, y, BAY, y + 0.06, "rgba(80,50,30,0.25)");
        for (let x = rng.range(0, 0.4); x < BAY; x += rng.range(0.35, 0.6)) c.rect(x, y + 0.2, x + 0.05, y + 0.25, "rgba(50,30,20,0.4)");
      }
    }
  },
};

/** Ground tiles: 2 cells (2 bays x the ground floor). */
const GROUND_T: Record<number, TileDraw> = {
  [FT.shopShutter]: (cells, rng) => {
    for (const c of cells) {
      c.rect(0, 0, BAY, GROUND, rng.pick(["#d8d2c4", "#cfc7b5", "#9b9a95"]));
      speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 300, 0.07);
      fascia(c, 0.15, BAY - 0.15, 2.85, 3.45, rng);
      if (rng.chance(0.5)) rollerShutter(c, 0.3, BAY - 0.3, 0, 2.75, rng);
      else {
        c.rect(0.3, 0, BAY - 0.3, 2.75, "#3a3f44");
        c.glassRect(0.4, 0.4, BAY - 0.4, 2.65, rng, "#2e3a44");
        rollerShutter(c, 0.3, BAY - 0.3, 2.3, 2.75, rng);
      }
      c.rect(0, 0, 0.3, GROUND, "#bdb5a5");
      c.rect(BAY - 0.3, 0, BAY, GROUND, "#bdb5a5");
    }
  },
  [FT.portalShop]: (cells, rng) => {
    const [a, b] = cells;
    if (!a || !b) return;
    c0(a, rng);
    // portal: glazed steel door
    a.rect(0.6, 0, 2.6, 3.0, "#2b2a28");
    a.glassRect(0.75, 0.1, 2.45, 2.85, rng, "#2a3138");
    a.rect(1.58, 0.1, 1.62, 2.85, "#2b2a28");
    a.rect(0.4, 3.0, 2.8, 3.3, "#c9c2b2");
    a.rect(2.75, 1.2, 2.95, 1.6, "#9b9b98");
    c0(b, rng);
    fascia(b, 0.2, BAY - 0.2, 2.9, 3.4, rng);
    b.rect(0.3, 0, BAY - 0.3, 2.8, "#4a4e52");
    b.glassRect(0.4, 0.45, BAY - 0.4, 2.7, rng, "#34414b");
    function c0(c: Cell, r: Rng): void {
      c.rect(0, 0, BAY, GROUND, "#d4cbb8");
      speckle(c.ctx, c.ox, c.oy, c.w, c.h, r, 300, 0.07);
      c.rect(0, 0, BAY, 0.5, "#9d978b");
    }
  },
  [FT.stoneShops]: (cells, rng) => {
    for (const c of cells) {
      c.rect(0, 0, BAY, GROUND, "#d3c6ad");
      for (let y = 0; y < GROUND; y += 0.45) {
        c.rect(0, y, BAY, y + 0.03, "rgba(70,60,50,0.25)");
        for (let x = (y / 0.45) % 2 ? 0 : 0.5; x < BAY; x += 1.0) c.rect(x, y, x + 0.03, y + 0.45, "rgba(70,60,50,0.2)");
      }
      speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 600, 0.08);
      c.rect(0.45, 0, BAY - 0.45, 3.0, "#2f2a25");
      c.glassRect(0.55, 0.5, BAY - 0.55, 2.9, rng, "#323b42");
      c.rect(0.3, 3.0, BAY - 0.3, 3.15, "#bfb194");
      if (rng.chance(0.5)) fascia(c, 0.5, BAY - 0.5, 3.15, 3.6, rng);
      c.rect(0, 3.6, BAY, GROUND, "#c9bb9f");
    }
  },
  [FT.cascoHouse]: (cells, rng) => {
    const zocalo = rng.pick(["#d9a93c", "#e0b453", "#9da1a3", "#c98f3a"]);
    const [a, b] = cells;
    if (!a || !b) return;
    for (const c of cells) {
      wallFill(c, "#f8f5ee", rng, 0.05);
      c.rect(0, 0, BAY, 0.9, zocalo);
      speckle(c.ctx, c.ox, c.Y(0.9), c.w, 0.9 * c.sy, rng, 200, 0.1);
      c.rect(0, 0.9, BAY, 0.95, "rgba(0,0,0,0.12)");
    }
    // wooden door with surround
    a.rect(0.75, 0, 2.45, 2.75, zocalo);
    a.rect(0.9, 0, 2.3, 2.6, "#5b3a22");
    for (const [x0, x1] of [[1.0, 1.55], [1.65, 2.2]] as const) {
      a.rect(x0, 0.2, x1, 1.2, "#6b4429");
      a.rect(x0, 1.35, x1, 2.4, "#6b4429");
    }
    a.rect(1.55, 1.2, 1.65, 1.3, "#c9a23a");
    // window with iron reja and geraniums
    windowUnit(b, rng, BAY / 2, 1.0, 1.0, 1.5, { surround: zocalo, reja: true, frame: "#3e2b1e" });
    geraniums(b, rng, BAY / 2 - 0.4, BAY / 2 + 0.4, 0.95);
  },
  [FT.cascoShop]: (cells, rng) => {
    const zocalo = rng.pick(["#d9a93c", "#9da1a3", "#7c8b5a"]);
    for (const c of cells) {
      wallFill(c, "#f8f5ee", rng, 0.05);
      c.rect(0, 0, BAY, 0.6, zocalo);
      c.rect(0.4, 0, BAY - 0.4, 2.9, "#4b3324");
      c.glassRect(0.55, 0.65, BAY - 0.55, 2.75, rng, "#2f3a40");
      c.rect(BAY / 2 - 0.04, 0.65, BAY / 2 + 0.04, 2.75, "#4b3324");
      c.rect(0.25, 2.9, BAY - 0.25, 3.05, zocalo);
    }
  },
  [FT.cascoGround]: (cells, rng) => {
    const zocalo = rng.pick(["#d9a93c", "#e0b453", "#9da1a3"]);
    for (const c of cells) {
      wallFill(c, "#f8f5ee", rng, 0.05);
      c.rect(0, 0, BAY, 0.9, zocalo);
      c.rect(0, 0.9, BAY, 0.95, "rgba(0,0,0,0.12)");
      windowUnit(c, rng, BAY / 2, 1.1, 0.9, 1.4, { surround: zocalo, reja: true, frame: "#3e2b1e" });
    }
  },
  [FT.glassShop]: (cells, rng) => {
    for (const c of cells) {
      c.rect(0, 0, BAY, GROUND, "#8e959b");
      c.glassRect(0.1, 0.1, BAY - 0.1, 3.2, rng, "#33414d");
      for (const x of [0.1, BAY / 2, BAY - 0.1]) c.rect(x - 0.04, 0.1, x + 0.04, 3.2, "#a9b0b5");
      c.rect(0, 3.2, BAY, GROUND, "#d9dcdc");
    }
  },
  [FT.plazaAltaArcade]: (cells, rng) => {
    for (const c of cells) {
      wallFill(c, "#f3ece0", rng, 0.04);
      // horseshoe-ish arch opening, dark arcade behind
      c.rect(0.35, 0, BAY - 0.35, 2.4, "#4a3a30");
      c.ctx.fillStyle = "#4a3a30";
      c.ctx.beginPath();
      c.ctx.ellipse(c.X(BAY / 2), c.Y(2.4), (BAY / 2 - 0.35) * c.sx, 0.9 * c.sy, 0, Math.PI, 0);
      c.ctx.fill();
      c.rect(0, 0, 0.35, 2.4, "#a8382d");
      c.rect(BAY - 0.35, 0, BAY, 2.4, "#a8382d");
    }
  },
  [FT.shedGround]: (cells, rng) => {
    for (const c of cells) {
      c.rect(0, 0, BAY, GROUND, "#c8c6bf");
      for (let x = 0; x < BAY; x += 0.2) c.rect(x, 0, x + 0.06, GROUND, "rgba(0,0,0,0.07)");
      speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 300, 0.06);
      if (rng.chance(0.5)) rollerShutter(c, 0.4, BAY - 0.4, 0, 3.0, rng);
    }
  },
};

/** Plain tiles: walls with no openings (party walls, parapets, plinths). 4 cells like UPPER. */
const PLAIN: Record<number, TileDraw> = {
  [FT.brickPlain]: (cells, rng) => cells.forEach((c) => brickFill(c, rng, BRICK_RED)),
  [FT.renderPlain]: (cells, rng) => cells.forEach((c) => wallFill(c, "#ece3d0", rng)),
  [FT.cascoPlain]: (cells, rng) => cells.forEach((c) => wallFill(c, "#f7f4ee", rng, 0.05)),
  [FT.modernPlain]: (cells, rng) => cells.forEach((c) => {
    wallFill(c, "#e4e2dd", rng, 0.04);
    c.rect(0, 0, BAY, 0.03, "rgba(0,0,0,0.12)");
    c.rect(0, 0, 0.03, FLOOR, "rgba(0,0,0,0.12)");
  }),
  [FT.shed]: (cells, rng) => cells.forEach((c) => {
    c.rect(0, 0, BAY, FLOOR, "#cfccc4");
    for (let x = 0; x < BAY; x += 0.2) c.rect(x, 0, x + 0.06, FLOOR, "rgba(0,0,0,0.07)");
    speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 300, 0.06);
  }),
  [FT.stone]: (cells, rng) => cells.forEach((c, i) => {
    c.rect(0, 0, BAY, FLOOR, "#d2c09c");
    for (let y = 0; y < FLOOR; y += 0.5) {
      c.rect(0, y, BAY, y + 0.03, "rgba(70,55,40,0.25)");
      for (let x = (y / 0.5) % 2 ? 0 : 0.6; x < BAY; x += 1.2) c.rect(x, y, x + 0.03, y + 0.5, "rgba(70,55,40,0.2)");
    }
    speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 700, 0.1);
    if (i === 3) {
      // narrow round-headed window
      c.rect(BAY / 2 - 0.35, 0.5, BAY / 2 + 0.35, 2.2, "#2d2620");
    }
  }),
  [FT.stonePlain]: (cells, rng) => cells.forEach((c) => {
    c.rect(0, 0, BAY, FLOOR, "#d6c5a3");
    for (let y = 0; y < FLOOR; y += 0.5) c.rect(0, y, BAY, y + 0.025, "rgba(70,55,40,0.2)");
    speckle(c.ctx, c.ox, c.oy, c.w, c.h, rng, 700, 0.1);
  }),
};

let atlasTex: THREE.CanvasTexture | null = null;

/** The facade atlas (4096 x 2048), built once. */
export function facadeAtlas(): THREE.CanvasTexture {
  if (atlasTex) return atlasTex;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.fillStyle = "#ddd";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glass: GlassRect[] = [];
  const tileOrigin = (id: number): [number, number] => [(id % ATLAS_COLS) * TILE, Math.floor(id / ATLAS_COLS) * TILE];
  const sxU = TILE / 2 / BAY;
  const syU = TILE / 2 / FLOOR;
  for (const [idS, draw] of [...Object.entries(UPPER), ...Object.entries(PLAIN)]) {
    const id = Number(idS);
    const [ox, oy] = tileOrigin(id);
    const cells: Cell[] = [];
    // bottom row first (floor 0), then the floor above
    for (const fy of [1, 0]) for (const bx of [0, 1]) cells.push(new Cell(ctx, ox + bx * (TILE / 2), oy + fy * (TILE / 2), TILE / 2, TILE / 2, sxU, syU, glass));
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, TILE, TILE);
    ctx.clip();
    draw(cells, makeRng(id * 7919 + 13));
    ctx.restore();
  }
  for (const [idS, draw] of Object.entries(GROUND_T)) {
    const id = Number(idS);
    const [ox, oy] = tileOrigin(id);
    const cells = [0, 1].map((bx) => new Cell(ctx, ox + bx * (TILE / 2), oy, TILE / 2, TILE, sxU, TILE / GROUND, glass));
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, TILE, TILE);
    ctx.clip();
    draw(cells, makeRng(id * 104729 + 7));
    ctx.restore();
  }
  // roofs: flat terrace tiles and Arab clay tiles (repeat over 6 m / 3 m per cell)
  for (const [id, name] of [[FT.roofFlat, "roofFlat"], [FT.roofTile, "roofTile"]] as const) {
    const [ox, oy] = tileOrigin(id);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.beginPath();
    ctx.rect(0, 0, TILE, TILE);
    ctx.clip();
    drawGround(name, ctx, TILE, TILE);
    ctx.restore();
  }
  // encode glass in alpha: relative height inside the pane
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (const g of glass) {
    const x0 = Math.max(0, Math.round(g.x0));
    const x1 = Math.min(canvas.width, Math.round(g.x1));
    const y0 = Math.max(0, Math.round(g.y0));
    const y1 = Math.min(canvas.height, Math.round(g.y1));
    const hh = Math.max(1, y1 - y0);
    for (let y = y0; y < y1; y++) {
      const a = Math.round((0.45 + 0.4 * (1 - (y - y0) / hh)) * 255);
      for (let x = x0; x < x1; x++) d[(y * canvas.width + x) * 4 + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.premultiplyAlpha = false;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex = t;
  return t;
}

// -----------------------------------------------------------------------------------------------
// Ground surfaces (world-space tiling)
// -----------------------------------------------------------------------------------------------

export type GroundName = "asphalt" | "sett" | "paving" | "hydraulic" | "slabs" | "grass" | "albero" | "roofFlat" | "roofTile" | "granite" | "earth";

/** Metres covered by one repeat of each surface texture. */
export const GROUND_SCALE: Record<GroundName, number> = {
  asphalt: 8, sett: 2.4, paving: 3.2, hydraulic: 1.6, slabs: 4, grass: 6, albero: 6, roofFlat: 6, roofTile: 3, granite: 2, earth: 8,
};

function drawGround(name: GroundName, ctx: Ctx, w: number, h: number): void {
  const r = makeRng(name.length * 4099 + name.charCodeAt(0));
  const px = w / GROUND_SCALE[name];
  switch (name) {
    case "asphalt": {
      ctx.fillStyle = "#6a6a68";
      ctx.fillRect(0, 0, w, h);
      // aggregate
      for (let i = 0; i < 60000; i++) {
        const v = 70 + Math.floor(r.next() * 80);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 5},${0.35 + r.next() * 0.4})`;
        const s = 0.6 + r.next() * 1.8;
        ctx.fillRect(r.next() * w, r.next() * h, s, s);
      }
      // patches and repairs
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = `rgba(${r.chance(0.5) ? "40,40,42" : "120,118,112"},${0.04 + r.next() * 0.05})`;
        const pw = r.range(0.8, 2.6) * px;
        const ph = r.range(0.6, 2.2) * px;
        ctx.fillRect(r.next() * (w - pw), r.next() * (h - ph), pw, ph);
      }
      // cracks
      ctx.strokeStyle = "rgba(30,30,30,0.35)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        let x = r.next() * w;
        let y = r.next() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += r.range(-14, 14);
          y += r.range(-14, 14);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // soft oil/wear blotches
      for (let i = 0; i < 18; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(25,25,25,${0.08 * r.next()})`);
        g.addColorStop(1, "rgba(25,25,25,0)");
        ctx.save();
        ctx.translate(r.next() * w, r.next() * h);
        ctx.scale(20 + r.next() * 80, 20 + r.next() * 80);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
      break;
    }
    case "sett": {
      // granite setts (adoquines), running bond rows 0.2 m
      ctx.fillStyle = "#5d5a55";
      ctx.fillRect(0, 0, w, h);
      const rowH = 0.2 * px;
      const rows = Math.round(h / rowH);
      for (let y = 0; y < rows; y++) {
        let x = (y % 2) * 0.1 * px - 0.1 * px;
        while (x < w) {
          const sw = r.range(0.16, 0.24) * px;
          const v = 125 + Math.floor(r.next() * 45);
          ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
          ctx.beginPath();
          ctx.roundRect?.(x + 1.5, y * rowH + 1.5, sw - 3, rowH - 3, 4);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(x + 3, y * rowH + 3, sw - 8, 3);
          x += sw;
        }
      }
      speckle(ctx, 0, 0, w, h, r, 9000, 0.12, 1.5);
      break;
    }
    case "paving": {
      // grey/ochre rectangular concrete pavers
      ctx.fillStyle = "#8b857a";
      ctx.fillRect(0, 0, w, h);
      const bw = 0.4 * px;
      const bh = 0.2 * px;
      for (let y = 0; y < h; y += bh) {
        for (let x = ((y / bh) % 2) * bw * 0.5 - bw; x < w; x += bw) {
          const v = 175 + Math.floor(r.next() * 25);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
          ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        }
      }
      speckle(ctx, 0, 0, w, h, r, 6000, 0.1, 1.5);
      break;
    }
    case "hydraulic": {
      // grey hydraulic pavement tiles (20 cm) with the 4x4 "pastillas"
      ctx.fillStyle = "#8f8c85";
      ctx.fillRect(0, 0, w, h);
      const t = 0.2 * px;
      for (let y = 0; y < h; y += t) {
        for (let x = 0; x < w; x += t) {
          const v = 168 + Math.floor(r.next() * 14);
          ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
          ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
          ctx.fillStyle = `rgba(0,0,0,0.12)`;
          for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
            ctx.fillRect(x + t * (0.12 + a * 0.21), y + t * (0.12 + b * 0.21) + 2, t * 0.14, t * 0.14);
          }
          ctx.fillStyle = `rgba(255,255,255,0.14)`;
          for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
            ctx.fillRect(x + t * (0.12 + a * 0.21), y + t * (0.12 + b * 0.21), t * 0.14, t * 0.12);
          }
        }
      }
      speckle(ctx, 0, 0, w, h, r, 4000, 0.12, 1.5);
      // stains
      for (let i = 0; i < 6; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(40,35,30,${0.12 * r.next()})`);
        g.addColorStop(1, "rgba(40,35,30,0)");
        ctx.save();
        ctx.translate(r.next() * w, r.next() * h);
        ctx.scale(10 + r.next() * 40, 10 + r.next() * 40);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
      break;
    }
    case "slabs": {
      // big light granite slabs (plazas, the Paseo)
      ctx.fillStyle = "#9c968a";
      ctx.fillRect(0, 0, w, h);
      const sw = 0.8 * px;
      const sh = 0.6 * px;
      for (let y = 0; y < h; y += sh) {
        for (let x = 0; x < w; x += sw) {
          const v = 190 + Math.floor(r.next() * 22);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
          ctx.fillRect(x + 1.5, y + 1.5, sw - 3, sh - 3);
        }
      }
      speckle(ctx, 0, 0, w, h, r, 9000, 0.1, 1.5);
      break;
    }
    case "granite": {
      ctx.fillStyle = "#b9b4aa";
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, 0, 0, w, h, r, 14000, 0.2, 1.5);
      break;
    }
    case "grass": {
      ctx.fillStyle = "#6f8445";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30000; i++) {
        const g = 90 + Math.floor(r.next() * 70);
        ctx.fillStyle = `rgba(${g - 30 + Math.floor(r.next() * 40)},${g + 20},${40 + Math.floor(r.next() * 30)},0.5)`;
        ctx.fillRect(r.next() * w, r.next() * h, 1.2, 2 + r.next() * 3);
      }
      for (let i = 0; i < 12; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(170,150,90,${0.25 * r.next()})`);
        g.addColorStop(1, "rgba(170,150,90,0)");
        ctx.save();
        ctx.translate(r.next() * w, r.next() * h);
        ctx.scale(20 + r.next() * 60, 20 + r.next() * 60);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
      break;
    }
    case "albero": {
      ctx.fillStyle = "#c9a96e";
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, 0, 0, w, h, r, 20000, 0.18, 1.6);
      break;
    }
    case "earth": {
      ctx.fillStyle = "#a69472";
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, 0, 0, w, h, r, 16000, 0.15, 2);
      for (let i = 0; i < 40; i++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(95,110,60,${0.3 * r.next()})`);
        g.addColorStop(1, "rgba(95,110,60,0)");
        ctx.save();
        ctx.translate(r.next() * w, r.next() * h);
        ctx.scale(10 + r.next() * 50, 10 + r.next() * 50);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
      break;
    }
    case "roofFlat": {
      ctx.fillStyle = "#a9a49a";
      ctx.fillRect(0, 0, w, h);
      const t = 0.5 * px;
      for (let y = 0; y < h; y += t) for (let x = 0; x < w; x += t) {
        const v = 160 + Math.floor(r.next() * 30);
        ctx.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
        ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
      }
      speckle(ctx, 0, 0, w, h, r, 5000, 0.15, 2);
      break;
    }
    case "roofTile": {
      // Arab clay tiles (teja árabe): channels running down the slope (v)
      ctx.fillStyle = "#8a4a30";
      ctx.fillRect(0, 0, w, h);
      const cw = 0.22 * px;
      const tl = 0.4 * px;
      for (let x = 0; x < w; x += cw) {
        for (let y = ((x / cw) % 2) * tl * 0.5 - tl; y < h; y += tl) {
          const v = r.range(0.85, 1.12);
          const g = ctx.createLinearGradient(x, 0, x + cw, 0);
          g.addColorStop(0, `rgb(${Math.round(120 * v)},${Math.round(62 * v)},${Math.round(40 * v)})`);
          g.addColorStop(0.5, `rgb(${Math.round(185 * v)},${Math.round(100 * v)},${Math.round(62 * v)})`);
          g.addColorStop(1, `rgb(${Math.round(110 * v)},${Math.round(58 * v)},${Math.round(38 * v)})`);
          ctx.fillStyle = g;
          ctx.fillRect(x + 1, y, cw - 2, tl - 2);
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(x + 1, y + tl - 4, cw - 2, 3);
        }
      }
      // lichen
      speckle(ctx, 0, 0, w, h, r, 3000, 0.2, 2);
      break;
    }
  }
}

const groundCache = new Map<GroundName, THREE.CanvasTexture>();

export function groundTex(name: GroundName): THREE.CanvasTexture {
  let t = groundCache.get(name);
  if (t) return t;
  const size = name === "asphalt" ? 1024 : 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  drawGround(name, ctx, size, size);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  groundCache.set(name, t);
  return t;
}

/** Road paint texture: worn white (alpha = paint coverage). */
let paintTex: THREE.CanvasTexture | null = null;
export function paintTexture(): THREE.CanvasTexture {
  if (paintTex) return paintTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  const r = makeRng(77);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(150,150,150,${r.next() * 0.6})`;
    const s = 1 + r.next() * 4;
    ctx.fillRect(r.next() * size, r.next() * size, s, s);
  }
  paintTex = new THREE.CanvasTexture(canvas);
  paintTex.colorSpace = THREE.SRGBColorSpace;
  paintTex.wrapS = THREE.RepeatWrapping;
  paintTex.wrapT = THREE.RepeatWrapping;
  paintTex.anisotropy = 8;
  return paintTex;
}

/** Surfaces packed in the road atlas (4 x 2 cells of 512 px), in cell order. */
export const ROAD_SURFACES: readonly GroundName[] = ["asphalt", "sett", "paving", "hydraulic", "slabs", "grass", "albero", "granite"];
let roadAtlas: THREE.CanvasTexture | null = null;
/** One texture for every road-side surface, so a chunk's ground is one draw call. */
export function roadAtlasTex(): THREE.CanvasTexture {
  if (roadAtlas) return roadAtlas;
  const C = 512;
  const canvas = document.createElement("canvas");
  canvas.width = C * 4;
  canvas.height = C * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ROAD_SURFACES.forEach((name, i) => {
    ctx.save();
    ctx.translate((i % 4) * C, Math.floor(i / 4) * C);
    ctx.beginPath();
    ctx.rect(0, 0, C, C);
    ctx.clip();
    drawGround(name, ctx, C, C);
    ctx.restore();
  });
  roadAtlas = new THREE.CanvasTexture(canvas);
  roadAtlas.colorSpace = THREE.SRGBColorSpace;
  roadAtlas.anisotropy = 8;
  return roadAtlas;
}
