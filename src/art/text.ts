/**
 * Runtime-generated canvas textures: one sign atlas (all shop signs, banners, liveries, plates…)
 * so that every sign in a segment or vehicle shares a single material, plus a few repeating
 * surface textures (asphalt, cobbles, facades, azulejos). All cached for the page lifetime.
 */
import * as THREE from "three";
import { makeRng } from "./rng";

type Ctx = CanvasRenderingContext2D;
type Draw = (ctx: Ctx, w: number, h: number) => void;

interface SignSpec {
  w: number;
  h: number;
  draw: Draw;
}

const FONT = "'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";

function fit(ctx: Ctx, text: string, maxW: number, size: number, weight = "bold", family = FONT): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface PlainOpts {
  border?: string;
  sub?: string;
  subColor?: string;
  italic?: boolean;
  icon?: (ctx: Ctx, x: number, y: number, s: number) => void;
  radius?: number;
}

function plain(text: string, bg: string, fg: string, w = 512, h = 128, o: PlainOpts = {}): SignSpec {
  return {
    w,
    h,
    draw(ctx, cw, ch) {
      ctx.fillStyle = bg;
      roundRect(ctx, 0, 0, cw, ch, o.radius ?? ch * 0.12);
      ctx.fill();
      if (o.border) {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = ch * 0.06;
        roundRect(ctx, ch * 0.06, ch * 0.06, cw - ch * 0.12, ch - ch * 0.12, ch * 0.08);
        ctx.stroke();
      }
      let left = ch * 0.15;
      if (o.icon) {
        o.icon(ctx, ch * 0.55, ch / 2, ch * 0.32);
        left = ch * 1.0;
      }
      const avail = cw - left - ch * 0.15;
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const mainY = o.sub ? ch * 0.4 : ch * 0.53;
      fit(ctx, text, avail, o.sub ? ch * 0.48 : ch * 0.62, o.italic ? "italic bold" : "bold");
      ctx.fillText(text, left + avail / 2, mainY);
      if (o.sub) {
        ctx.fillStyle = o.subColor ?? fg;
        fit(ctx, o.sub, avail, ch * 0.24, "bold");
        ctx.fillText(o.sub, left + avail / 2, ch * 0.78);
      }
    },
  };
}

const cross = (color: string) => (ctx: Ctx, x: number, y: number, s: number): void => {
  ctx.fillStyle = color;
  ctx.fillRect(x - s * 0.33, y - s, s * 0.66, s * 2);
  ctx.fillRect(x - s, y - s * 0.33, s * 2, s * 0.66);
};

function banner(text: string, bg: string, fg: string, flags: string[]): SignSpec {
  return {
    w: 1600,
    h: 205,
    draw(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, bg);
      g.addColorStop(1, shade(bg, -0.18));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // bunting triangles along top and bottom
      const n = 32;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = flags[i % flags.length] ?? "#fff";
        const x = (i / n) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + w / n, 0);
        ctx.lineTo(x + w / n / 2, h * 0.17);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + w / n, h);
        ctx.lineTo(x + w / n / 2, h * 0.83);
        ctx.fill();
      }
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fit(ctx, text, w * 0.9, h * 0.5, "bold");
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 8;
      ctx.strokeText(text, w / 2, h / 2 + 4);
      ctx.fillText(text, w / 2, h / 2 + 4);
    },
  };
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k);
  else c.lerp(new THREE.Color(1, 1, 1), k);
  return `#${c.getHexString()}`;
}

function livery(title: string, sub: string, bg: string, fg: string, accent: string): SignSpec {
  return {
    w: 768,
    h: 224,
    draw(ctx, w, h) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w * 0.35, h * 0.72);
      ctx.lineTo(w, h * 0.78);
      ctx.lineTo(w, h);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fit(ctx, title, w * 0.92, h * 0.34, "italic bold");
      ctx.fillText(title, w / 2, h * 0.32);
      fit(ctx, sub, w * 0.8, h * 0.15, "bold");
      ctx.fillText(sub, w / 2, h * 0.58);
    },
  };
}

function led(text: string): SignSpec {
  return {
    w: 512,
    h: 96,
    draw(ctx, w, h) {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffb21a";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      fit(ctx, text, w * 0.92, h * 0.62, "bold", "'Courier New', monospace");
      ctx.fillText(text, w * 0.04, h * 0.55);
    },
  };
}

function gantry(text: string, arrow: string, bg = "#1d4fa0"): SignSpec {
  return {
    w: 640,
    h: 224,
    draw(ctx, w, h) {
      ctx.fillStyle = bg;
      roundRect(ctx, 0, 0, w, h, 18);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 8;
      roundRect(ctx, 10, 10, w - 20, h - 20, 12);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        fit(ctx, line, w * 0.7, h * 0.3, "bold");
        ctx.fillText(line, w * 0.42, h * (lines.length === 1 ? 0.52 : 0.33 + i * 0.36));
      });
      ctx.font = `bold ${h * 0.55}px ${FONT}`;
      ctx.fillText(arrow, w * 0.87, h * 0.52);
    },
  };
}

const SPECS: Record<string, SignSpec> = {
  // shops
  farmacia: plain("FARMACIA", "#1f8a3b", "#ffffff", 512, 128, { icon: cross("#9dff7a") }),
  panaderia: plain("Panadería", "#f3e1b6", "#7a3e12", 512, 128, { border: "#7a3e12" }),
  churreria: plain("Churrería", "#c0392b", "#fff2c8", 512, 128, { sub: "Chocolate con churros" }),
  "bar-bellota": plain("Bar La Bellota", "#2d5a27", "#ffd35a", 512, 128, { sub: "Tapas · Raciones" }),
  estanco: plain("ESTANCO", "#7a1e2a", "#ffd200", 512, 128, { sub: "Tabacos · Sellos" }),
  fruteria: plain("Frutería", "#e67e22", "#ffffff", 512, 128, { sub: "Fruta de la Vega" }),
  peluqueria: plain("Peluquería", "#8e44ad", "#ffffff", 512, 128, { italic: true }),
  cafeteria: plain("Cafetería", "#3b2416", "#f5deb3", 512, 128, { italic: true, border: "#c9a46a" }),
  zapateria: plain("Zapatería", "#1f3a5f", "#ffffff", 512, 128),
  libreria: plain("Librería", "#f6f1e3", "#1f3a5f", 512, 128, { border: "#1f3a5f", sub: "Papelería" }),
  heladeria: plain("Heladería", "#ffb3c6", "#7a1f3d", 512, 128, { italic: true }),
  confiteria: plain("Confitería", "#fff0f5", "#a0522d", 512, 128, { border: "#a0522d", italic: true }),
  meson: plain("Mesón El Pacense", "#5a2e0e", "#f7d08a", 512, 128, { border: "#f7d08a" }),
  tapas: plain("Tapas y Raciones", "#8b1a1a", "#ffe9a8", 512, 128),
  ultramarinos: plain("Ultramarinos", "#234e3a", "#f1e6c8", 512, 128, { border: "#f1e6c8" }),
  optica: plain("Óptica", "#ffffff", "#0b5aa6", 512, 128, { border: "#0b5aa6" }),
  restaurante: plain("Restaurante", "#1b1b1b", "#f2c14e", 512, 128, { italic: true }),
  "cafe-paseo": plain("Café del Paseo", "#1b3b2f", "#e8d9a8", 512, 128, { italic: true, border: "#e8d9a8" }),
  "bar-puente": plain("BAR EL PUENTE", "#b22222", "#ffffff", 640, 128, { sub: "Cañas · Tapas · Desayunos", border: "#ffffff" }),
  kiosco: plain("Prensa · Revistas", "#0f5e9c", "#ffffff", 512, 96),
  helados: plain("Helados", "#ff6fa1", "#ffffff", 384, 96, { italic: true }),
  parada: plain("BUS", "#0b5aa6", "#ffffff", 128, 128),
  "farmacia-cross": { w: 128, h: 128, draw: (ctx) => { ctx.fillStyle = "#0b2"; ctx.fillRect(0, 0, 128, 128); cross("#b6ff6a")(ctx, 64, 64, 50); } },
  // street plaques
  "c-sinforiano": plain("Avda. Sinforiano Madroñero", "#ffffff", "#163d7a", 768, 128, { border: "#163d7a" }),
  "c-sanfrancisco": plain("Paseo de San Francisco", "#ffffff", "#163d7a", 768, 128, { border: "#163d7a" }),
  "c-europa": plain("Avenida de Europa", "#ffffff", "#163d7a", 768, 128, { border: "#163d7a" }),
  "c-espana": plain("Plaza de España", "#ffffff", "#163d7a", 640, 128, { border: "#163d7a" }),
  "c-sanjuan": plain("Calle San Juan", "#ffffff", "#163d7a", 640, 128, { border: "#163d7a" }),
  "c-alta": plain("Plaza Alta", "#ffffff", "#163d7a", 512, 128, { border: "#163d7a" }),
  "c-elvas": plain("Avenida de Elvas", "#ffffff", "#163d7a", 640, 128, { border: "#163d7a" }),
  "c-puente": plain("Puente Real", "#ffffff", "#163d7a", 512, 128, { border: "#163d7a" }),
  "c-palmas": plain("Puente de Palmas", "#ffffff", "#163d7a", 640, 128, { border: "#163d7a" }),
  ayuntamiento: plain("AYUNTAMIENTO", "#f4efe2", "#8a6a1f", 768, 128),
  // banners
  "b-feria": banner("FERIA DE SAN JUAN", "#d62828", "#fff4c2", ["#ffd23f", "#2a9d8f", "#ffffff", "#264653"]),
  "b-carnaval": banner("CARNAVAL DE BADAJOZ", "#6a2c91", "#ffe14d", ["#ff4d6d", "#00c2a8", "#ffe14d", "#ffffff"]),
  "b-almossassa": banner("ALMOSSASSA", "#1e6f5c", "#fbe7b5", ["#e9c46a", "#d62828", "#fbe7b5", "#264653"]),
  "b-noche": banner("NOCHE EN BLANCO", "#14213d", "#ffffff", ["#ffffff", "#fca311", "#e5e5e5", "#8ecae6"]),
  // vehicles
  taxi: plain("TAXI", "#ffffff", "#111111", 256, 96, { border: "#1a8f3c" }),
  plate: {
    w: 320,
    h: 72,
    draw(ctx, w, h) {
      ctx.fillStyle = "#f7f7f7";
      roundRect(ctx, 0, 0, w, h, 8);
      ctx.fill();
      ctx.fillStyle = "#1f4db5";
      ctx.fillRect(0, 0, h * 0.5, h);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${h * 0.4}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("E", h * 0.25, h * 0.68);
      ctx.fillStyle = "#111";
      fit(ctx, "4821 KBZ", w - h * 0.7, h * 0.7, "bold", "'Courier New', monospace");
      ctx.fillText("4821 KBZ", (w + h * 0.5) / 2, h * 0.54);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 3;
      roundRect(ctx, 2, 2, w - 4, h - 4, 8);
      ctx.stroke();
    },
  },
  "l-jamones": livery("Jamones La Dehesa", "Ibéricos de bellota · Badajoz", "#f4ead5", "#6b1d12", "#8a2a1b"),
  "l-frutas": livery("Frutas Guadiana", "Frutas y verduras de la Vega", "#ffffff", "#1d7a2e", "#f28c1b"),
  "l-mensajeria": livery("Mensajería Pacense", "Envíos en 24 horas", "#ffd23f", "#16357a", "#16357a"),
  "bus-urbano": plain("Bus Urbano", "#d62828", "#ffffff", 768, 128, { italic: true, sub: "Badajoz · Línea urbana" }),
  "led-6": led("6  Puerta de Palmas"),
  "led-1": led("1  Valdepasillas"),
  "led-9": led("9  San Roque"),
  "led-18": led("18 Universidad"),
  "led-3": led("3  Casco Antiguo"),
  obras: plain("OBRAS", "#ffcc00", "#111111", 320, 128, { border: "#111111" }),
  "peligro-obras": plain("PELIGRO OBRAS", "#ffcc00", "#c00000", 512, 96, { border: "#c00000" }),
  envases: plain("ENVASES", "#ffffff", "#b07d00", 384, 96, { border: "#b07d00" }),
  papel: plain("PAPEL Y CARTÓN", "#ffffff", "#1565c0", 384, 96, { border: "#1565c0" }),
  vidrio: plain("VIDRIO", "#ffffff", "#2e7d32", 384, 96, { border: "#2e7d32" }),
  chevrons: {
    w: 160,
    h: 512,
    draw(ctx, w, h) {
      ctx.fillStyle = "#ffcf1a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1a1a1a";
      for (let i = 0; i < 5; i++) {
        const y = h * (0.1 + i * 0.19);
        ctx.beginPath();
        ctx.moveTo(w * 0.1, y + h * 0.1);
        ctx.lineTo(w * 0.5, y);
        ctx.lineTo(w * 0.9, y + h * 0.1);
        ctx.lineTo(w * 0.9, y + h * 0.15);
        ctx.lineTo(w * 0.5, y + h * 0.05);
        ctx.lineTo(w * 0.1, y + h * 0.15);
        ctx.fill();
      }
      ctx.fillStyle = "#e83a14";
      ctx.fillRect(0, 0, w * 0.06, h);
      ctx.fillRect(w * 0.94, 0, w * 0.06, h);
    },
  },
  // road signs and institutions
  "g-puente": gantry("Puente Real", "↑"),
  "g-elvas": gantry("Portugal\nElvas", "↗", "#1d4fa0"),
  "g-centro": gantry("Centro ciudad", "↖"),
  "g-badajoz": gantry("Badajoz\nCentro", "↑"),
  uex: plain("Universidad de Extremadura", "#ffffff", "#0d6b3a", 1024, 128, { border: "#0d6b3a" }),
  campus: plain("Campus de Badajoz", "#0d6b3a", "#ffffff", 640, 128),
  gasolinera: plain("GASOLINERA", "#d62828", "#ffffff", 512, 112),
  precios: {
    w: 192,
    h: 384,
    draw(ctx, w, h) {
      ctx.fillStyle = "#f3f3f3";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#d62828";
      ctx.fillRect(0, 0, w, h * 0.2);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fit(ctx, "PRECIOS", w * 0.9, h * 0.1);
      ctx.fillText("PRECIOS", w / 2, h * 0.1);
      const rows: [string, string][] = [["Gasóleo", "1,45"], ["S/Plomo 95", "1,59"], ["S/Plomo 98", "1,71"]];
      rows.forEach(([n, p], i) => {
        const y = h * (0.32 + i * 0.24);
        ctx.fillStyle = "#222";
        fit(ctx, n, w * 0.9, h * 0.06);
        ctx.fillText(n, w / 2, y);
        ctx.fillStyle = "#111";
        ctx.fillRect(w * 0.12, y + h * 0.04, w * 0.76, h * 0.11);
        ctx.fillStyle = "#3cff5a";
        fit(ctx, p, w * 0.7, h * 0.09, "bold", "'Courier New', monospace");
        ctx.fillText(p, w / 2, y + h * 0.095);
      });
    },
  },
  "centro-comercial": plain("Centro Comercial Guadiana", "#ffffff", "#e4572e", 1024, 160, { sub: "Moda · Hogar · Cines" , subColor: "#333" }),
  bricolaje: plain("Bricolaje y Jardín", "#2e7d32", "#ffffff", 768, 160),
  muebles: plain("Muebles Extremadura", "#f2c14e", "#3b2416", 768, 160),
  clock: {
    w: 256,
    h: 256,
    draw(ctx, w) {
      const r = w / 2;
      ctx.fillStyle = "#f4ecd8";
      ctx.beginPath();
      ctx.arc(r, r, r - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2b2b2b";
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.fillStyle = "#2b2b2b";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.fillRect(r + Math.sin(a) * r * 0.78 - 5, r - Math.cos(a) * r * 0.78 - 5, 10, 10);
      }
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.lineTo(r + r * 0.4, r - r * 0.2);
      ctx.moveTo(r, r);
      ctx.lineTo(r - r * 0.05, r - r * 0.68);
      ctx.stroke();
    },
  },
  escudo: {
    w: 256,
    h: 320,
    draw(ctx, w, h) {
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.clearRect(0, 0, w, h);
      // stone cartouche
      ctx.fillStyle = "#cdb890";
      roundRect(ctx, 0, 0, w, h, 24);
      ctx.fill();
      // shield
      ctx.fillStyle = "#b3202a";
      ctx.beginPath();
      ctx.moveTo(w * 0.18, h * 0.2);
      ctx.lineTo(w * 0.82, h * 0.2);
      ctx.lineTo(w * 0.82, h * 0.58);
      ctx.quadraticCurveTo(w * 0.82, h * 0.86, w * 0.5, h * 0.94);
      ctx.quadraticCurveTo(w * 0.18, h * 0.86, w * 0.18, h * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#e7c35a";
      ctx.lineWidth = 8;
      ctx.stroke();
      // golden column + lion-ish silhouette
      ctx.fillStyle = "#e7c35a";
      ctx.fillRect(w * 0.46, h * 0.36, w * 0.08, h * 0.42);
      ctx.fillRect(w * 0.41, h * 0.33, w * 0.18, h * 0.04);
      ctx.fillRect(w * 0.41, h * 0.77, w * 0.18, h * 0.04);
      ctx.beginPath();
      ctx.arc(w * 0.33, h * 0.5, w * 0.07, 0, Math.PI * 2);
      ctx.arc(w * 0.67, h * 0.5, w * 0.07, 0, Math.PI * 2);
      ctx.fill();
      // crown
      ctx.beginPath();
      ctx.moveTo(w * 0.28, h * 0.17);
      ctx.lineTo(w * 0.3, h * 0.04);
      ctx.lineTo(w * 0.4, h * 0.11);
      ctx.lineTo(w * 0.5, h * 0.02);
      ctx.lineTo(w * 0.6, h * 0.11);
      ctx.lineTo(w * 0.7, h * 0.04);
      ctx.lineTo(w * 0.72, h * 0.17);
      ctx.closePath();
      ctx.fill();
    },
  },
};

export type SignName = keyof typeof SPECS;
export type UvRect = readonly [number, number, number, number];

interface Atlas {
  material: THREE.MeshLambertMaterial;
  rects: Map<string, { uv: UvRect; aspect: number }>;
}

let atlas: Atlas | null = null;

function buildAtlas(): Atlas {
  const W = 2048;
  const pad = 6;
  // shelf-pack first, then size the canvas to fit
  const entries = Object.entries(SPECS).sort((a, b) => b[1].h - a[1].h);
  const placed: { name: string; spec: SignSpec; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const [name, spec] of entries) {
    if (x + spec.w + pad > W) {
      x = 0;
      y += rowH + pad;
      rowH = 0;
    }
    placed.push({ name, spec, x, y });
    x += spec.w + pad;
    rowH = Math.max(rowH, spec.h);
  }
  const needed = y + rowH;
  let H = 256;
  while (H < needed) H *= 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const rects = new Map<string, { uv: UvRect; aspect: number }>();
  for (const { name, spec, x: px, y: py } of placed) {
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.rect(0, 0, spec.w, spec.h);
    ctx.clip();
    spec.draw(ctx, spec.w, spec.h);
    ctx.restore();
    // uv with a half-pixel inset to avoid bleeding
    rects.set(name, {
      uv: [(px + 0.5) / W, 1 - (py + spec.h - 0.5) / H, (px + spec.w - 0.5) / W, 1 - (py + 0.5) / H],
      aspect: spec.w / spec.h,
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const material = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.35,
    transparent: false,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
  material.userData["cast"] = false;
  return { material, rects };
}

export function signAtlas(): Atlas {
  if (!atlas) atlas = buildAtlas();
  return atlas;
}

export function signRect(name: string): { uv: UvRect; aspect: number } {
  const r = signAtlas().rects.get(name);
  if (!r) throw new Error(`unknown sign ${name}`);
  return r;
}

// ---------------------------------------------------------------------------
// Repeating surface textures
// ---------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: Draw, repeat = true): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

function noise(ctx: Ctx, w: number, h: number, seed: number, amount: number, count: number, size: number): void {
  const r = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const v = r.next() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${r.next() * amount})`;
    const s = 1 + r.next() * size;
    ctx.fillRect(r.next() * w, r.next() * h, s, s);
  }
}

/** Window grid styles: each tile is 4 bays x 4 floors. */
export type FacadeStyle = "piso" | "viejo" | "oficina" | "noble";

function drawFacade(style: FacadeStyle, lit: boolean, ctx: Ctx, w: number, h: number): void {
  const r = makeRng(style.length * 977 + (lit ? 3 : 0));
  ctx.fillStyle = lit ? "#000" : "#fff";
  ctx.fillRect(0, 0, w, h);
  if (!lit) noise(ctx, w, h, 7, 0.06, 1500, 3);
  const bw = w / 4;
  const fh = h / 4;
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x0 = bx * bw;
      const y0 = fy * fh;
      const on = r.next() < 0.55;
      const glowCol = r.pick(["#ffd27a", "#ffe6a8", "#fff1d0", "#ffc864"]);
      if (style === "oficina") {
        // curtain wall: big panes with mullions
        const g = lit ? (on ? glowCol : "#101828") : "#3f6688";
        ctx.fillStyle = g;
        ctx.fillRect(x0 + bw * 0.04, y0 + fh * 0.1, bw * 0.92, fh * 0.8);
        if (!lit) {
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(x0 + bw * 0.04, y0 + fh * 0.1, bw * 0.3, fh * 0.8);
        }
        ctx.fillStyle = lit ? "#000" : "#d8dde2";
        ctx.fillRect(x0 + bw * 0.48, y0 + fh * 0.1, bw * 0.04, fh * 0.8);
        continue;
      }
      const ww = style === "piso" ? 0.5 : 0.38;
      const wh = style === "piso" ? 0.55 : 0.68;
      const wx = x0 + bw * (0.5 - ww / 2);
      const wy = y0 + fh * (style === "piso" ? 0.22 : 0.16);
      if (lit) {
        ctx.fillStyle = on ? glowCol : "#0a0d18";
        ctx.fillRect(wx, wy, bw * ww, fh * wh);
        continue;
      }
      // frame
      ctx.fillStyle = style === "viejo" ? "#d9d2c3" : "#cfc9bd";
      ctx.fillRect(wx - bw * 0.04, wy - fh * 0.04, bw * (ww + 0.08), fh * (wh + 0.08));
      // glass
      ctx.fillStyle = "#2c3e55";
      ctx.fillRect(wx, wy, bw * ww, fh * wh);
      ctx.fillStyle = "rgba(160,200,255,0.35)";
      ctx.fillRect(wx, wy, bw * ww * 0.35, fh * wh);
      if (style === "piso") {
        // Spanish roller blind (persiana) partly down
        const down = 0.2 + r.next() * 0.6;
        ctx.fillStyle = r.pick(["#e8dcc0", "#d9c7a0", "#c9b48a", "#eee6d6"]);
        ctx.fillRect(wx, wy, bw * ww, fh * wh * down);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        for (let k = 0; k < 8; k++) ctx.fillRect(wx, wy + k * fh * wh * down / 8, bw * ww, 1.5);
        // mullion
        ctx.fillStyle = "#e9e5dc";
        ctx.fillRect(wx + bw * ww * 0.48, wy + fh * wh * down, bw * ww * 0.04, fh * wh * (1 - down));
      } else {
        // wooden / green shutters (contraventanas)
        const sc = style === "viejo" ? r.pick(["#2f6b3a", "#6b3b1f", "#2f4f7a"]) : "#4a3424";
        ctx.fillStyle = sc;
        ctx.fillRect(wx - bw * 0.15, wy, bw * 0.14, fh * wh);
        ctx.fillRect(wx + bw * ww + bw * 0.01, wy, bw * 0.14, fh * wh);
        ctx.fillStyle = "#e9e5dc";
        ctx.fillRect(wx + bw * ww * 0.47, wy, bw * ww * 0.06, fh * wh);
        if (style === "noble") {
          // stucco moulding above
          ctx.fillStyle = "#e9dfc8";
          ctx.fillRect(wx - bw * 0.08, wy - fh * 0.12, bw * (ww + 0.16), fh * 0.06);
        }
      }
    }
    if (!lit && style !== "oficina") {
      // floor slab line
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, fy * fh + fh * 0.96, w, fh * 0.04);
    }
  }
}

const matCache = new Map<string, THREE.Material>();

function cachedMat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/** Facade window texture; one tile = 4 bays x 4 floors. `lit` adds glowing windows (dusk). */
export function facadeMat(style: FacadeStyle, lit: boolean): THREE.Material {
  return cachedMat(`facade-${style}-${lit}`, () => {
    const map = canvasTex(512, 512, (c, w, h) => drawFacade(style, false, c, w, h));
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
    if (lit) {
      m.emissive.set(0xffffff);
      m.emissiveMap = canvasTex(512, 512, (c, w, h) => drawFacade(style, true, c, w, h));
      m.emissiveIntensity = 0.9;
    }
    m.userData["cast"] = false;
    return m;
  });
}

export type SurfaceName = "asphalt" | "cobbles" | "paving" | "flagstone" | "azulejo" | "tapial" | "plaza-alta" | "brick" | "grass";

function drawSurface(name: SurfaceName, ctx: Ctx, w: number, h: number): void {
  const r = makeRng(name.length * 131);
  switch (name) {
    case "asphalt": {
      ctx.fillStyle = "#c8c8c8";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 11, 0.18, 9000, 2.2);
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        let x = r.next() * w;
        let y = r.next() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += r.range(-20, 20);
          y += r.range(-20, 20);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "cobbles": {
      ctx.fillStyle = "#6f6a63";
      ctx.fillRect(0, 0, w, h);
      const n = 8;
      const s = w / n;
      for (let j = 0; j < n * 2; j++) {
        for (let i = -1; i < n + 1; i++) {
          const ox = (j % 2) * s * 0.5;
          const v = 160 + r.int(-30, 30);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
          roundRect(ctx, i * s + ox + 2, j * (s / 2) + 2, s - 4, s / 2 - 4, 6);
          ctx.fill();
        }
      }
      noise(ctx, w, h, 5, 0.12, 3000, 2);
      break;
    }
    case "paving": {
      ctx.fillStyle = "#d9d2c4";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 3, 0.08, 3000, 2);
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      for (let i = 0; i <= 4; i++) {
        ctx.fillRect(i * (w / 4) - 1, 0, 2, h);
        ctx.fillRect(0, i * (h / 4) - 1, w, 2);
      }
      // the typical "pastilla" studs on some tiles
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        if ((i + j) % 2) continue;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
          ctx.beginPath();
          ctx.arc(i * (w / 4) + (a + 0.5) * (w / 12), j * (h / 4) + (b + 0.5) * (h / 12), w / 40, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "flagstone": {
      ctx.fillStyle = "#8f877a";
      ctx.fillRect(0, 0, w, h);
      const rows = 4;
      for (let j = 0; j < rows; j++) {
        let x = -r.range(0, 60);
        while (x < w) {
          const len = r.range(60, 120);
          const v = 190 + r.int(-25, 20);
          ctx.fillStyle = `rgb(${v},${v - 8},${v - 22})`;
          ctx.fillRect(x + 2, j * (h / rows) + 2, len - 4, h / rows - 4);
          x += len;
        }
      }
      noise(ctx, w, h, 9, 0.1, 3000, 2);
      break;
    }
    case "azulejo": {
      const n = 4;
      const s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = i * s;
        const y = j * s;
        ctx.fillStyle = "#f4f1e6";
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = "#1d4fa0";
        ctx.beginPath();
        ctx.moveTo(x + s / 2, y + s * 0.08);
        ctx.lineTo(x + s * 0.92, y + s / 2);
        ctx.lineTo(x + s / 2, y + s * 0.92);
        ctx.lineTo(x + s * 0.08, y + s / 2);
        ctx.fill();
        ctx.fillStyle = "#f2b630";
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1d4fa0";
        for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          ctx.beginPath();
          ctx.arc(x + cx * s, y + cy * s, s * 0.14, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      }
      break;
    }
    case "tapial": {
      // rammed earth: horizontal courses with put-log holes
      ctx.fillStyle = "#c89a62";
      ctx.fillRect(0, 0, w, h);
      for (let j = 0; j < 8; j++) {
        const v = r.int(-14, 14);
        ctx.fillStyle = `rgb(${200 + v},${155 + v},${100 + v})`;
        ctx.fillRect(0, j * (h / 8) + 2, w, h / 8 - 3);
        ctx.fillStyle = "rgba(80,50,20,0.35)";
        ctx.fillRect(0, j * (h / 8), w, 2);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = "rgba(60,35,15,0.45)";
          ctx.fillRect(i * (w / 4) + (j % 2) * (w / 8) + 10, j * (h / 8) + h / 32, 7, 6);
        }
      }
      noise(ctx, w, h, 13, 0.15, 5000, 3);
      break;
    }
    case "brick": {
      ctx.fillStyle = "#d8c7ad";
      ctx.fillRect(0, 0, w, h);
      const rows = 16;
      const bh = h / rows;
      for (let j = 0; j < rows; j++) {
        for (let i = -1; i < 8; i++) {
          const v = r.int(-18, 18);
          ctx.fillStyle = `rgb(${178 + v},${92 + v},${58 + v})`;
          ctx.fillRect(i * (w / 8) + (j % 2) * (w / 16) + 1.5, j * bh + 1.5, w / 8 - 3, bh - 3);
        }
      }
      break;
    }
    case "grass": {
      ctx.fillStyle = "#b9c98a";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 17, 0.2, 7000, 3);
      break;
    }
    case "plaza-alta": {
      // One bay of the Plaza Alta arcades: horseshoe arch at the bottom, red/white
      // geometric (diamond and zig-zag) painted wall above, a balcony window on top.
      const red = "#b8322a";
      const white = "#f6efe2";
      const blue = "#7d8fa6";
      ctx.fillStyle = white;
      ctx.fillRect(0, 0, w, h);
      // diamond lattice band (upper storey)
      const top = h * 0.06;
      const bandH = h * 0.5;
      const dn = 4;
      const dw = w / dn;
      const dh = bandH / 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i <= dn; i++) {
        const cx = i * dw + (j % 2 ? dw / 2 : 0);
        const cy = top + j * dh + dh / 2;
        ctx.fillStyle = (i + j) % 3 === 2 ? blue : red;
        ctx.beginPath();
        ctx.moveTo(cx, cy - dh / 2);
        ctx.lineTo(cx + dw / 2, cy);
        ctx.lineTo(cx, cy + dh / 2);
        ctx.lineTo(cx - dw / 2, cy);
        ctx.fill();
        ctx.fillStyle = white;
        ctx.beginPath();
        ctx.moveTo(cx, cy - dh / 5);
        ctx.lineTo(cx + dw / 5, cy);
        ctx.lineTo(cx, cy + dh / 5);
        ctx.lineTo(cx - dw / 5, cy);
        ctx.fill();
      }
      // window with balcony in the lattice
      ctx.fillStyle = white;
      ctx.fillRect(w * 0.3, top + bandH * 0.18, w * 0.4, bandH * 0.68);
      ctx.fillStyle = "#3b2a20";
      ctx.fillRect(w * 0.36, top + bandH * 0.24, w * 0.28, bandH * 0.56);
      ctx.fillStyle = "#2a2a2a";
      for (let k = 0; k < 7; k++) ctx.fillRect(w * 0.33 + k * w * 0.056, top + bandH * 0.62, 4, bandH * 0.24);
      ctx.fillRect(w * 0.32, top + bandH * 0.62, w * 0.36, 6);
      // zig-zag frieze
      const zy = top + bandH + h * 0.015;
      ctx.fillStyle = red;
      ctx.fillRect(0, zy, w, h * 0.05);
      ctx.fillStyle = white;
      const zn = 8;
      for (let i = 0; i < zn; i++) {
        ctx.beginPath();
        ctx.moveTo(i * (w / zn), zy + h * 0.05);
        ctx.lineTo((i + 0.5) * (w / zn), zy + h * 0.008);
        ctx.lineTo((i + 1) * (w / zn), zy + h * 0.05);
        ctx.fill();
      }
      // arcade: red pilasters + horseshoe arch with a red/white voussoir ring
      const ay = zy + h * 0.06;
      const ah = h - ay;
      ctx.fillStyle = red;
      ctx.fillRect(0, ay, w, ah);
      const cx = w / 2;
      const rad = w * 0.36;
      const spring = ay + ah * 0.42;
      const vn = 15;
      for (let k = 0; k < vn; k++) {
        const a0 = Math.PI * 0.85 + (k / vn) * Math.PI * 1.3;
        const a1 = Math.PI * 0.85 + ((k + 1) / vn) * Math.PI * 1.3;
        ctx.fillStyle = k % 2 ? red : white;
        ctx.beginPath();
        ctx.arc(cx, spring, rad * 1.22, a0, a1);
        ctx.arc(cx, spring, rad, a1, a0, true);
        ctx.fill();
      }
      ctx.fillStyle = "#2b1d17";
      ctx.beginPath();
      ctx.arc(cx, spring, rad, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(cx + rad * Math.cos(Math.PI * 0.15), h);
      ctx.lineTo(cx - rad * Math.cos(Math.PI * 0.15), h);
      ctx.closePath();
      ctx.fill();
      // warm interior glow at the back of the arcade
      ctx.fillStyle = "rgba(255,190,110,0.25)";
      ctx.fillRect(cx - rad * 0.5, spring, rad, h - spring);
      // white plinth
      ctx.fillStyle = white;
      ctx.fillRect(0, h - h * 0.03, w, h * 0.03);
      break;
    }
  }
}

/** Repeating textured, vertex-colour-tinted material. */
export function surfaceMat(name: SurfaceName): THREE.Material {
  return cachedMat(`surface-${name}`, () => {
    const size = name === "plaza-alta" ? 512 : 256;
    const map = canvasTex(size, name === "plaza-alta" ? 1024 : size, (c, w, h) => drawSurface(name, c, w, h));
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
    m.userData["cast"] = false;
    return m;
  });
}

/** Letter tile texture for the "letra" pickup. */
export function letterMat(letter: string): THREE.Material {
  return cachedMat(`letter-${letter}`, () => {
    const map = canvasTex(256, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#ffe259");
      g.addColorStop(1, "#ffa751");
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, 40);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 14;
      roundRect(ctx, 12, 12, w - 24, h - 24, 30);
      ctx.stroke();
      ctx.font = `900 ${h * 0.72}px 'Arial Black', ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#b0172a";
      ctx.fillText(letter, w / 2 + 6, h * 0.56 + 6);
      ctx.fillStyle = "#e8233a";
      ctx.fillText(letter, w / 2, h * 0.56);
    }, false);
    return new THREE.MeshBasicMaterial({ map });
  });
}

/** Soft radial glow sprite texture. */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (!glowTex) {
    glowTex = canvasTex(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, false);
  }
  return glowTex;
}
