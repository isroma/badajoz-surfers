/**
 * The runner's six outfits and the waiter, sculpted on the shared skinned rig. Each look is one
 * skinned geometry (shared by every instance of that look) plus the head/face config, the
 * secondary bones it uses (hood, drawstrings, apron, scarf, plumes) and its roll scale.
 * Designs are generic (no real club crests or trademarks).
 */
import * as THREE from "three";
import type { OutfitId } from "../contracts";
import { P } from "./proportions";
import { B, armPoints, humanBones, legPoints } from "./characters/rig";
import { FX, runnerHead, waiterHead, type HeadCfg } from "./characters/face";
import {
  FITTED_ROWS, HOODIE_ROWS, LEG_PROFILE, SIDES, TORSO_SKIN, arm, cap, ears, garmentLeg, hand, headDir, leg, mix, neck, nose, torsoA,
  pelvis, shade, shell, shoe, shortHair, skull, torso, yRings, fineRows, type HairSpec, type Profile, type Side, type TorsoRow,
} from "./characters/body";
import { SkinBuilder, ellipsoid, loft, tube, v3, type Paint, type SkinSpec, type V } from "./characters/skin";

/** A spring-driven secondary bone. Angles in radians (X pitch, Z roll) relative to the parent. */
export interface SpringDef {
  bone: number;
  /** How much it follows gravity/inertia (0 = rigid, 1 = hangs freely). */
  flex: number;
  stiff: number;
  damp: number;
  minX: number;
  maxX: number;
  maxZ: number;
  /** Keep in front of the thighs (aprons). */
  push?: boolean;
  /** Angle to wrap round the ball while rolling (back drapes curl with the spine). */
  tuck?: number;
}

export interface Look {
  geometry: THREE.BufferGeometry;
  head: HeadCfg;
  springs: readonly SpringDef[];
  rollScale: number;
  /** Resting expression bias (added to every clip). */
  mood?: Partial<Record<keyof typeof FX, number>>;
}

const SKIN = 0xd6956a;
const HAIR = 0x2a1a10;
const WHITE = 0xf3f1ec;

const BONES = humanBones();

const sm = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

function headBase(b: SkinBuilder, h: HeadCfg, hair?: HairSpec, skinPaint?: Paint, noseSize = 1, noseTint = 0.08): void {
  skull(b, h, skinPaint, hair);
  ears(b, h, h.skin);
  nose(b, h, h.skin, noseSize, noseTint);
}

function sideOf(p: V): Side {
  return p.x < 0 ? -1 : 1;
}

const HOODIE_SLEEVE: Profile = [
  [0, 0.064],
  [0.1, 0.064],
  [0.35, 0.061],
  [0.52, 0.056],
  [0.66, 0.058],
  [0.86, 0.053],
  [0.9, 0.049],
  [0.93, 0.046],
  [1, 0.045],
];

const BARE_ARM: Profile = [
  [0, 0.064],
  [0.12, 0.06],
  [0.3, 0.05],
  [0.5, 0.043],
  [0.6, 0.045],
  [0.75, 0.042],
  [0.95, 0.032],
  [1, 0.03],
];

const SHIRT_SLEEVE: Profile = [
  [0, 0.062],
  [0.1, 0.062],
  [0.35, 0.058],
  [0.52, 0.052],
  [0.7, 0.052],
  [0.9, 0.045],
  [1, 0.042],
];

function sleeveAndHand(b: SkinBuilder, side: Side, prof: Profile, paint: Paint, glove?: number, opts: { rough?: number } = {}): void {
  arm(b, side, prof, paint, { rough: opts.rough ?? 0.85, capB: 0 });
  hand(b, side, SKIN, glove !== undefined ? { glove } : {});
}

/** Short sleeve over a bare arm. */
function shortSleeve(b: SkinBuilder, side: Side, colour: Paint, to = 0.4, r = 0.072): void {
  arm(b, side, [[0, r + 0.002], [0.15, r], [to, r - 0.006]], colour, { to, capB: 0, rough: 0.85 });
  arm(b, side, BARE_ARM, SKIN, { from: to - 0.08, capA: 0.5, capB: 0, rough: 0.6 });
  hand(b, side, SKIN);
}

function sockLegs(b: SkinBuilder, from: number, sockY: number, sock: number, band: number | null, legPaint = SKIN): void {
  const tSock = (P.hipY - sockY) / (P.hipY - P.ankleY);
  for (const s of SIDES) {
    leg(b, s, LEG_PROFILE, (p, out) => {
      if (p.y > sockY) out.set(legPaint);
      else if (band !== null && p.y > sockY - 0.028 && p.y < sockY - 0.012) out.set(band);
      else out.set(sock);
    }, { from, rough: 0.62, capB: 0, extra: [tSock - 0.006, tSock + 0.004, tSock + 0.018, tSock + 0.034] });
  }
}

function rollFor(o: OutfitId): number {
  switch (o) {
    case "carnaval": return 0.66;
    case "feria": return 0.86;
    case "cigueno": return 0.76;
    case "romano": return 0.95;
    default: return 0.97;
  }
}

const HOOD_SPRINGS: SpringDef[] = [
  { bone: B.hood, flex: 0.25, stiff: 70, damp: 9, minX: -0.25, maxX: 0.35, maxZ: 0.25 },
  { bone: B.strL, flex: 0.85, stiff: 28, damp: 3.5, minX: 0, maxX: 1.3, maxZ: 0.7 },
  { bone: B.strR, flex: 0.85, stiff: 28, damp: 3.5, minX: 0, maxX: 1.3, maxZ: 0.7 },
];
const BACK_SPRINGS: SpringDef[] = [
  { bone: B.backA, flex: 0.7, stiff: 30, damp: 4.5, minX: -1.2, maxX: 0.6, maxZ: 0.5, tuck: 0.45 },
  { bone: B.backB, flex: 0.85, stiff: 24, damp: 3.5, minX: -1.0, maxX: 0.9, maxZ: 0.6, tuck: 0.7 },
];
const HAT_SPRINGS: SpringDef[] = [
  { bone: B.hat, flex: 0.12, stiff: 90, damp: 7, minX: -0.3, maxX: 0.3, maxZ: 0.3 },
  { bone: B.hat2, flex: 0.35, stiff: 45, damp: 4, minX: -0.6, maxX: 0.6, maxZ: 0.6, tuck: -1.1 },
];

// ---------------------------------------------------------------------------
// clasico: orange hoodie, blue cap, navy shorts, white trainers
// ---------------------------------------------------------------------------

function hood(b: SkinBuilder, colour: number, lining: number): void {
  const path: V[] = [];
  for (let i = 0; i <= 14; i++) {
    const th = -2.35 + (4.7 * i) / 14;
    const back = Math.max(0, Math.cos(th));
    path.push(v3(Math.sin(th) * 0.108, 1.488 - 0.05 * back * back, Math.cos(th) * 0.098 + 0.012 + 0.035 * back * back));
  }
  const centre = v3(0, 1.47, 0.01);
  b.add(
    tube(path, [[0, 0.006, 0.01, 0.006], [0.12, 0.018, 0.02, 0.018], [0.3, 0.032, 0.032, 0.036], [0.5, 0.048, 0.05, 0.075], [0.7, 0.032, 0.032, 0.036], [0.88, 0.018, 0.02, 0.018], [1, 0.006, 0.01, 0.006]], 10, 14, { up: v3(0, 1, 0), capA: 0.8, capB: 0.8 }),
    (p, out) => {
      // the lining shows on the side facing the neck
      const d = Math.hypot(p.x - centre.x, (p.z - centre.z) * 1.1);
      out.set(d < 0.1 && p.y > 1.45 ? lining : colour);
    },
    { bones: [B.chest, B.neck, B.hood], power: 3, bias: [1, 1.25, 0.75] },
    { rough: 0.88 },
  );
}

function drawstrings(b: SkinBuilder, colour: number, tip: number): void {
  for (const s of SIDES) {
    const bone = s < 0 ? B.strL : B.strR;
    const x = s * 0.044;
    b.add(tube([v3(x, 1.475, -0.08), v3(x, 1.42, -0.118), v3(x + s * 0.003, 1.33, -0.13)], [[0, 0.0055], [1, 0.005]], 6, 6, { capA: 0.5, capB: 0 }), colour, bone, { rough: 0.8, shade: 0.4 });
    b.add(ellipsoid(v3(x + s * 0.003, 1.32, -0.13), 0.0075, 0.016, 0.0075, 8, 5), tip, bone, { rough: 0.4 });
  }
}

function clasico(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const O = 0xff6a13;
  const OD = shade(O, 0.72);
  const teal = 0x12b5a0;
  const navy = 0x1f2c4e;
  headBase(b, h, { fn: shortHair(0.009, 0.48), color: HAIR, rough: 0.75, flat: true });
  cap(b, h, 0x1d6fd8, 0x1a5ec2, 0x22304d, WHITE);
  neck(b, SKIN);
  torso(b, HOODIE_ROWS, (p, out) => {
    let c = O;
    if (p.y < 0.958) c = OD;
    const back = p.z > 0.03;
    if (back && p.y > 1.255 && p.y < 1.3) c = WHITE;
    if (back && p.y > 1.215 && p.y < 1.24) c = teal;
    if (p.z < -0.06 && p.y > 0.985 && p.y < 1.14) {
      const hw = 0.118 - (p.y - 0.985) * 0.32;
      if (Math.abs(p.x) < hw) c = Math.abs(p.x) > hw - 0.012 || p.y > 1.128 ? shade(O, 0.8) : shade(O, 0.92);
    }
    out.set(c);
  }, { extra: [0.952, 0.962, 1.212, 1.218, 1.237, 1.243, 1.252, 1.258, 1.297, 1.303, 0.982, 0.988, 1.125, 1.132], rough: 0.92 });
  hood(b, O, shade(O, 0.6));
  drawstrings(b, WHITE, teal);
  for (const s of SIDES) {
    const a = armPoints(s);
    sleeveAndHand(b, s, HOODIE_SLEEVE, (p, out) => {
      out.set(p.distanceTo(a.w) < 0.035 ? OD : O);
    }, undefined, { rough: 0.92 });
  }
  pelvis(b, navy, { rough: 0.75, top: 0.99 });
  const hemY = P.hipY - 0.29 * (P.hipY - P.ankleY) + 0.035;
  for (const s of SIDES) garmentLeg(b, s, 0.29, 0.1, 0.098, (p, out) => {
    out.set(p.y < hemY ? teal : navy);
  }, { rough: 0.75, inner: shade(navy, 0.5) });
  sockLegs(b, 0.26, 0.215, WHITE, teal);
  for (const s of SIDES) shoe(b, s, { upper: 0xf4f4f2, sole: 0xeae4d8, accent: O, laces: WHITE });
  return HOOD_SPRINGS;
}

// ---------------------------------------------------------------------------
// futbolera: black and white striped shirt, scarf, black shorts, hooped socks
// ---------------------------------------------------------------------------

function futbolera(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const BLACK = 0x17171a;
  headBase(b, h, {
    fn: shortHair(0.013, 0.5),
    color: 0x1c120a,
    // a little quiff on top
    puff: (n, p) => {
      p.y += 0.016 * Math.max(0, n.y - 0.5) * Math.max(0, -n.z + 0.3);
    },
  });
  neck(b, SKIN);
  // vertical stripes: 14 around, a white one down the front centre
  const W = (Math.PI * 2) / 14;
  const edges: number[] = [];
  for (let k = 0; k < 14; k++) edges.push(Math.PI / 2 + (k + 0.5) * W);
  torsoA(b, FITTED_ROWS, (p, a, out) => {
    if (p.y > 1.488 || p.y < 0.955 || Number.isNaN(a)) out.set(BLACK);
    else out.set(((Math.round((a - Math.PI / 2) / W) % 2) + 2) % 2 === 0 ? WHITE : BLACK);
  }, edges, { extra: [0.95, 0.96, 1.484, 1.492], segs: 14, rough: 0.8 });
  for (const s of SIDES) shortSleeve(b, s, (p, out) => {
    const a = armPoints(s);
    out.set(a.j.y - p.y > 0.1 ? BLACK : WHITE);
  });
  pelvis(b, BLACK, { rough: 0.72 });
  const hemY = P.hipY - 0.3 * (P.hipY - P.ankleY) + 0.03;
  for (const s of SIDES) garmentLeg(b, s, 0.3, 0.1, 0.098, (p, out) => out.set(p.y < hemY ? WHITE : BLACK), { rough: 0.72 });
  // football socks to below the knee, hooped at the top
  const sockY = 0.43;
  for (const s of SIDES) {
    leg(b, s, LEG_PROFILE, (p, out) => {
      if (p.y > sockY) out.set(SKIN);
      else if (p.y > sockY - 0.07) out.set(Math.floor((sockY - p.y) / 0.0175) % 2 === 0 ? BLACK : WHITE);
      else out.set(WHITE);
    }, { from: 0.27, rough: 0.7, capB: 0, extra: [0.594, 0.6, 0.62, 0.64, 0.66, 0.68] });
  }
  for (const s of SIDES) shoe(b, s, { upper: 0x1c1c1f, sole: 0xf0f0f0, accent: WHITE, laces: WHITE });
  // the scarf: a striped loop round the neck, one end down the chest and one down the back
  const scarfStripe = (k: number): number => (Math.floor(k / 0.045) % 2 === 0 ? BLACK : WHITE);
  const ring: V[] = [];
  for (let i = 0; i <= 20; i++) {
    const th = (i / 20) * Math.PI * 2;
    ring.push(v3(Math.sin(th) * 0.088, 1.487 - 0.012 * Math.cos(th), Math.cos(th) * 0.083 + 0.008));
  }
  b.add(tube(ring, [[0, 0.03, 0.026], [1, 0.03, 0.026]], 10, 24, { up: v3(0, 1, 0), capA: 0.3, capB: 0.3 }), (p, out) => {
    out.set(scarfStripe(Math.atan2(p.x, p.z) + 4));
  }, { bones: [B.chest, B.neck], power: 2 }, { rough: 0.95, mottle: 0.06 });
  const front = [v3(-0.05, 1.47, -0.085), v3(-0.065, 1.38, -0.13), v3(-0.07, 1.2, -0.14)];
  b.add(tube(front, [[0, 0.04, 0.012], [1, 0.042, 0.01]], 10, 10, { up: v3(0, 0, -1), capA: 0.3, capB: 0 }), (p, out) => out.set(p.y < 1.215 ? 0xdedede : scarfStripe(1.5 - p.y)), B.chest, { rough: 0.95 });
  const back = [v3(0.05, 1.47, 0.085), v3(0.06, 1.38, 0.14), v3(0.065, 1.2, 0.155), v3(0.07, 1.04, 0.165)];
  b.add(tube(back, [[0, 0.042, 0.012], [1, 0.044, 0.01]], 10, 16, { up: v3(0, 0, 1), capA: 0.3, capB: 0 }), (p, out) => out.set(p.y < 1.055 ? 0xdedede : scarfStripe(1.5 - p.y)), { bones: [B.chest, B.backA, B.backB], power: 3 }, { rough: 0.95 });
  return BACK_SPRINGS;
}

// ---------------------------------------------------------------------------
// feria: traje de corto (short jacket, red sash, high-waisted trousers, boots) and sombrero
// ---------------------------------------------------------------------------

function feria(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const BLACK = 0x18181c;
  const GREY = 0x55555e;
  const RED = 0xc8102e;
  headBase(b, h, { fn: shortHair(0.009, 0.5), color: 0x141010, rough: 0.45, flat: true });
  neck(b, SKIN);
  // sombrero cordobés: flat crown, wide flat brim, ribbon
  const top = h.c.y + h.r[1] * 0.78;
  const hatRings: TorsoRow[] = [
    [top - 0.012, 0.215, 0.215, 0.215],
    [top - 0.004, 0.215, 0.215, 0.215],
    [top, 0.112, 0.112, 0.112],
    [top + 0.03, 0.11, 0.11, 0.11],
    [top + 0.085, 0.104, 0.104, 0.104],
  ];
  const hat = loft(yRings(fineRows(hatRings, 0.01), 2), 32, 0, 0);
  for (const p of hat.pts) {
    // tilt slightly forward
    const dy = p.y - top;
    p.z += dy * 0.12 - 0.012;
  }
  b.add(hat, (p, out) => out.set(p.y > top + 0.004 && p.y < top + 0.028 ? 0x2c2c32 : BLACK), { bones: [B.head, B.hat], power: 6, bias: [1, 3] }, { rough: 0.6 });
  // short jacket open over the shirt, lapels, the red sash
  const F = Math.PI / 2;
  torsoA(b, FITTED_ROWS, (p, a, out) => {
    const d = Math.abs(a - F);
    let c = BLACK;
    if (p.y < 1.035) c = p.y > 0.955 ? RED : GREY;
    else if (d < 0.2) c = WHITE;
    else if (d < 0.34 && p.y > 1.18) c = 0x34343c;
    out.set(c);
  }, [F - 0.34, F - 0.2, F + 0.2, F + 0.34], { extra: [0.95, 0.96, 1.03, 1.04, 1.175, 1.185], segs: 18, rough: 0.6 });
  for (const y of [1.12, 1.24]) b.add(ellipsoid(v3(0, y, -0.118), 0.008, 0.008, 0.005, 8, 5), 0x111111, TORSO_SKIN, { rough: 0.3 });
  // sash knot on the left hip
  b.add(ellipsoid(v3(-0.15, 0.99, -0.05), 0.03, 0.035, 0.03, 10, 6), RED, B.hips, { rough: 0.7 });
  b.add(tube([v3(-0.15, 0.97, -0.05), v3(-0.16, 0.88, -0.06), v3(-0.165, 0.8, -0.055)], [[0, 0.025, 0.008], [1, 0.03, 0.006]], 8, 6, { up: v3(1, 0, 0), capA: 0.3, capB: 0.3 }), RED, { bones: [B.hips, B.thighL], power: 4, bias: [0.7, 1] }, { rough: 0.7 });
  // clavel
  const cl = v3(-0.085, 1.34, -0.128);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.add(ellipsoid(cl.clone().add(v3(Math.cos(a) * 0.012, Math.sin(a) * 0.012, -0.004)), 0.012, 0.012, 0.008, 8, 5), k % 2 ? 0xe01030 : 0xff2a48, B.chest, { rough: 0.7 });
  }
  b.add(ellipsoid(cl.clone().add(v3(0, 0, -0.01)), 0.01, 0.01, 0.008, 6, 4), 0xff4a60, B.chest, { rough: 0.7 });
  b.add(ellipsoid(cl.clone().add(v3(0.018, -0.022, 0.002)), 0.006, 0.018, 0.004, 6, 4, new THREE.Euler(0, 0, -0.6)), 0x2f7a32, B.chest, { rough: 0.7 });
  for (const s of SIDES) {
    const a = armPoints(s);
    sleeveAndHand(b, s, SHIRT_SLEEVE, (p, out) => out.set(p.distanceTo(a.w) < 0.028 ? WHITE : BLACK), undefined, { rough: 0.6 });
  }
  const trousers: Paint = (p, out) => {
    const k = Math.floor((Math.atan2(p.x - sideOf(p) * P.hipX, -p.z) + 4) / 0.11) % 3 === 0;
    out.set(k ? shade(GREY, 0.75) : GREY);
  };
  pelvis(b, trousers, { rough: 0.7, top: 1.0 });
  for (const s of SIDES) garmentLeg(b, s, 0.9, 0.1, 0.05, trousers, { rough: 0.7 });
  for (const s of SIDES) shoe(b, s, { upper: 0x141416, sole: 0x2a2018, accent: 0x141416, laces: 0x141416, kind: "boot" });
  return [HAT_SPRINGS[0] as SpringDef];
}

// ---------------------------------------------------------------------------
// carnaval: murga costume (harlequin satin, ruff, pantaloons, striped stockings, plumed top hat)
// ---------------------------------------------------------------------------

function carnaval(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const PURPLE = 0x7b2ff7;
  const YELLOW = 0xffc60a;
  const TEAL = 0x00b894;
  const PINK = 0xff2e88;
  headBase(b, h, { fn: shortHair(0.01, 0.5), color: 0x2b1a10, flat: true }, (p, out) => {
    // face paint: a purple diamond under the left eye, a yellow one under the right
    const n = headDir(h, p);
    const front = n.z < -0.5;
    const dl = Math.abs(n.x + 0.38) * 1.1 + Math.abs(n.y + 0.12);
    const dr = Math.abs(n.x - 0.38) * 1.1 + Math.abs(n.y + 0.12);
    if (front && dl < 0.11) out.set(PURPLE);
    else if (front && dr < 0.11) out.set(YELLOW);
    else out.set(SKIN);
  });
  neck(b, SKIN);
  // mi-parti satin: purple left half, gold right half, a pink sequin hem
  const puffy = HOODIE_ROWS.map(([y, w, f, bk]) => [y, w * 1.04, f * 1.06, bk * 1.05] as const);
  torsoA(b, puffy, (p, a, out) => {
    if (p.y < 0.96) out.set(PINK);
    else if (Number.isNaN(a)) out.set(PURPLE);
    else out.set(a > Math.PI / 2 && a < (3 * Math.PI) / 2 ? PURPLE : YELLOW);
  }, [Math.PI / 2, (3 * Math.PI) / 2], { rough: 0.35, segs: 24, extra: [0.955, 0.965] });
  // ruff collar: a frilled disc
  const ruff: TorsoRow[] = [[1.462, 0.07, 0.07, 0.07], [1.47, 0.2, 0.2, 0.2], [1.5, 0.19, 0.19, 0.19], [1.508, 0.07, 0.07, 0.07]];
  b.add(loft(yRings(ruff, 2, (a) => 1 + 0.09 * Math.sin(a * 14)), 56, 0, 0), (p, out) => {
    const r = Math.hypot(p.x, p.z);
    out.set(r > 0.16 ? YELLOW : WHITE);
  }, { bones: [B.chest, B.neck, B.clavL, B.clavR], power: 3, bias: [1, 1.2, 1.4, 1.4] }, { rough: 0.5 });
  const PUFF: Profile = [[0, 0.08], [0.2, 0.088], [0.42, 0.072], [0.56, 0.06], [0.75, 0.066], [0.92, 0.058], [1, 0.05]];
  for (const s of SIDES) {
    const a = armPoints(s);
    arm(b, s, PUFF, (p, out) => out.set(p.distanceTo(a.w) < 0.03 ? PINK : s < 0 ? YELLOW : PURPLE), { rough: 0.4, capB: 0 });
    hand(b, s, SKIN, { glove: WHITE });
  }
  pelvis(b, PURPLE, { rough: 0.4, scale: 1.06 });
  for (const s of SIDES) garmentLeg(b, s, 0.56, 0.11, 0.08, (p, out) => out.set(p.y < 0.5 ? PINK : s < 0 ? YELLOW : PURPLE), { rough: 0.4, flare: 0.012, extra: [0.9, 0.93, 0.96] });
  for (const s of SIDES) {
    leg(b, s, LEG_PROFILE, (p, out) => out.set(p.y < 0.2 && p.y > 0.17 ? PINK : s < 0 ? PURPLE : YELLOW), { from: 0.5, rough: 0.5, capB: 0, extra: [0.85, 0.86, 0.885, 0.895] });
  }
  for (const s of SIDES) shoe(b, s, { upper: 0xf2c94c, sole: PURPLE, accent: PINK, laces: PINK, kind: "flat" });
  // plumed top hat
  const base = h.c.y + h.r[1] * 0.8;
  const hatRows: TorsoRow[] = [
    [base - 0.01, 0.14, 0.14, 0.14],
    [base, 0.14, 0.14, 0.14],
    [base + 0.004, 0.1, 0.1, 0.1],
    [base + 0.05, 0.096, 0.096, 0.096],
    [base + 0.13, 0.104, 0.104, 0.104],
  ];
  const hat = loft(yRings(fineRows(hatRows, 0.012), 2), 28, 0, 0);
  for (const p of hat.pts) p.z += (p.y - base) * 0.15 + 0.005;
  b.add(hat, (p, out) => out.set(p.y > base + 0.01 && p.y < base + 0.04 ? YELLOW : PURPLE), B.hat, { rough: 0.3 });
  ([[-0.04, PINK], [0, TEAL], [0.04, YELLOW]] as const).forEach(([dx, c], i) => {
    const plume = [v3(dx, base + 0.11, 0.03), v3(dx * 1.6, base + 0.22, 0.07), v3(dx * 2.2, base + 0.31, 0.15 + i * 0.01)];
    b.add(tube(plume, [[0, 0.012, 0.008], [0.4, 0.034, 0.01], [1, 0.006, 0.004]], 8, 8, { up: v3(0, 0, 1), capA: 0.4, capB: 0.6 }), c, { bones: [B.hat, B.hat2], power: 3 }, { rough: 0.6 });
  });
  return HAT_SPRINGS;
}

// ---------------------------------------------------------------------------
// romano: tunic, toga over the left shoulder, laurel wreath, sandals
// ---------------------------------------------------------------------------

function romano(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const TUNIC = 0xf6f2e6;
  const TOGA = 0xeee6d2;
  const PURPLE = 0x6a1b9a;
  const GOLD = 0xd8a93a;
  headBase(b, h, {
    fn: shortHair(0.013, 0.5),
    color: 0x3a2414,
    rough: 0.8,
    // curls
    puff: (n, p) => {
      const k = Math.sin(n.x * 40) * Math.sin(n.y * 40) * Math.sin(n.z * 40);
      p.addScaledVector(n, 0.004 * k);
    },
  });
  neck(b, SKIN);
  // laurel wreath
  const nrm = v3();
  for (let k = 0; k < 16; k++) {
    const yaw = -2.7 + (5.4 * k) / 15;
    const pitch = 0.42 - 0.22 * (1 - Math.cos(yaw)) / 2;
    const p = new THREE.Vector3();
    // place on the head surface
    const d = v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    p.set(h.c.x + d.x * h.r[0] * 1.08, h.c.y + d.y * h.r[1] * 1.06, h.c.z + d.z * h.r[2] * 1.08);
    nrm.copy(d);
    const up = k % 2 ? 0.55 : -0.25;
    b.add(ellipsoid(p, 0.011, 0.006, 0.03, 6, 4, new THREE.Euler(up, -yaw + Math.PI / 2 + (k % 2 ? 0.25 : -0.25), 0, "YXZ")), k % 3 ? 0x5f8f2f : 0x77a83a, B.head, { rough: 0.6 });
  }
  // tunic
  torso(b, FITTED_ROWS.map(([y, w, f, bk]) => [y, w * 1.03, f * 1.04, bk * 1.03] as const), (p, out) => {
    out.set(p.y > 0.99 && p.y < 1.04 ? GOLD : TUNIC);
  }, { rough: 0.85, extra: [0.985, 0.995, 1.035, 1.045] });
  // skirt with pleats; follows the thighs
  const skirtRows: TorsoRow[] = [[1.02, 0.158, 0.112, 0.11], [0.92, 0.18, 0.128, 0.132], [0.76, 0.2, 0.148, 0.152], [0.62, 0.212, 0.158, 0.162]];
  const fine = fineRows(skirtRows.slice().reverse(), 0.02);
  b.add(loft(yRings(fine, 2.2, (a) => 1 + 0.025 * Math.sin(a * 12)), 24, 0, 0), (p, out) => {
    if (p.y < 0.65 && Math.hypot(p.x, p.z) > 0.08) out.set(PURPLE);
    else if (p.y < 0.63) out.set(0x5a4a3a);
    else out.set(TUNIC);
  }, { bones: [B.hips, B.thighL, B.thighR], power: 2.5, bias: [0.55, 1, 1] }, { rough: 0.85 });
  // toga: a broad drape over the left shoulder, across the chest, and down the back
  const drape = (path: V[], spec: SkinSpec | number, up: V): void => {
    b.add(tube(path, [[0, 0.07, 0.016], [0.5, 0.085, 0.018], [1, 0.07, 0.014]], 8, 12, { up, capA: 0.4, capB: 0.4 }), (p, out) => {
      void p;
      out.set(TOGA);
    }, spec, { rough: 0.9, mottle: 0.05 });
  };
  drape([v3(-0.15, 1.5, -0.02), v3(-0.09, 1.4, -0.13), v3(0.03, 1.22, -0.142), v3(0.15, 1.04, -0.11)], { ...TORSO_SKIN, bones: [B.hips, B.spine, B.chest, B.clavL], bias: [1, 1, 1, 1.3] }, v3(0, 0.3, -1));
  drape([v3(-0.15, 1.5, 0.02), v3(-0.1, 1.38, 0.135), v3(-0.04, 1.16, 0.145), v3(0.0, 0.92, 0.16)], { bones: [B.chest, B.clavL, B.backA, B.backB], power: 3, bias: [1, 1.3, 1, 1] }, v3(0, 0.3, 1));
  b.add(ellipsoid(v3(-0.16, 1.455, 0.0), 0.085, 0.055, 0.115, 14, 8), TOGA, { bones: [B.chest, B.clavL, B.armL], power: 3, bias: [1, 1, 1.6] }, { rough: 0.9 });
  // purple border along the drape's edge
  b.add(tube([v3(-0.09, 1.43, -0.105), v3(0.06, 1.2, -0.152), v3(0.17, 1.03, -0.116)], [[0, 0.008, 0.006], [1, 0.008, 0.006]], 6, 10, { up: v3(0, 0.3, -1), capA: 0.3, capB: 0.3 }), PURPLE, TORSO_SKIN, { rough: 0.8 });
  for (const s of SIDES) {
    const a = armPoints(s);
    if (s < 0) {
      arm(b, s, [[0, 0.078], [0.2, 0.072], [0.45, 0.064]], TOGA, { to: 0.45, capB: 0, rough: 0.9 });
      arm(b, s, BARE_ARM, (p, out) => out.set(p.distanceTo(a.w) < 0.035 ? GOLD : SKIN), { from: 0.37, capA: 0.5, capB: 0, rough: 0.55 });
      hand(b, s, SKIN);
    } else {
      shortSleeve(b, s, TUNIC, 0.3, 0.074);
      arm(b, s, [[0.3, 0.054], [0.36, 0.054]], GOLD, { from: 0.3, to: 0.36, capA: 0, capB: 0, rough: 0.3 });
    }
  }
  pelvis(b, TUNIC, { rough: 0.85 });
  for (const s of SIDES) leg(b, s, LEG_PROFILE, SKIN, { from: 0.3, rough: 0.6, capB: 0 });
  for (const s of SIDES) shoe(b, s, { upper: 0x7a4a22, sole: 0x5a3416, accent: 0x7a4a22, laces: 0x7a4a22, kind: "sandal", skin: SKIN });
  return BACK_SPRINGS;
}

// ---------------------------------------------------------------------------
// cigueno: plush stork costume (hood with beak, black wing feathers, red tights, bird feet)
// ---------------------------------------------------------------------------

function cigueno(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const PLUSH = 0xf7f6f1;
  const BLACK = 0x18181b;
  const RED = 0xe0402a;
  headBase(b, h);
  // hood: covers everything but an oval face opening
  shell(b, h, (n) => {
    const face = (n.x / 0.62) ** 2 + ((n.y + 0.08) / 0.62) ** 2 < 1 && n.z < -0.2;
    return face ? -0.01 : 0.028 + 0.01 * Math.max(0, n.y);
  }, PLUSH, { rough: 0.95, mottle: 0.04 });
  // the hood's eyes and the long red beak (on the springy hat bone)
  const top = h.c.y + h.r[1] * 0.92;
  for (const s of SIDES) b.add(ellipsoid(v3(s * 0.05, top - 0.005, -0.085), 0.016, 0.018, 0.01, 8, 6), BLACK, B.hat, { rough: 0.3 });
  b.add(tube([v3(0, top - 0.025, -0.08), v3(0, top - 0.035, -0.22), v3(0, top - 0.05, -0.36)], [[0, 0.03, 0.022], [0.5, 0.02, 0.016], [1, 0.006, 0.006]], 10, 8, { capA: 0.3, capB: 0.6, up: v3(0, 1, 0) }), RED, B.hat, { rough: 0.45 });
  neck(b, PLUSH, 0.06);
  const plush = HOODIE_ROWS.map(([y, w, f, bk]) => [y, w * 1.05, f * 1.12, bk * 1.06] as const);
  torso(b, plush, (p, out) => {
    // a black lower back like folded wingtips
    out.set(p.z > 0.06 && p.y < 1.08 && Math.abs(p.x) > 0.06 ? BLACK : PLUSH);
  }, { rough: 0.95, mottle: 0.05, segs: 28 });
  for (const s of SIDES) {
    const a = armPoints(s);
    arm(b, s, [[0, 0.074], [0.3, 0.066], [0.5, 0.058], [1, 0.05]], (p, out) => out.set(a.j.y - p.y > 0.24 ? BLACK : PLUSH), { rough: 0.95, capB: 0 });
    hand(b, s, SKIN, { glove: BLACK });
    // flight feathers along the back of the arm
    for (let k = 0; k < 5; k++) {
      const t = 0.15 + k * 0.19;
      const root = a.j.clone().lerp(a.w, t).add(v3(0, 0, 0.045));
      const len = 0.2 + k * 0.025;
      const tip = root.clone().add(v3(s * 0.03, -len * 0.55, 0.06 + len * 0.6));
      b.add(tube([root, root.clone().lerp(tip, 0.5).add(v3(0, -0.01, 0)), tip], [[0, 0.016, 0.006], [0.5, 0.034, 0.006], [1, 0.006, 0.003]], 6, 5, { up: v3(-s, 0, 0), capA: 0.3, capB: 0.6 }), (p, out) => out.set(p.distanceTo(root) < 0.05 && k < 2 ? PLUSH : BLACK), { bones: s < 0 ? [B.armL, B.foreL] : [B.armR, B.foreR], power: 4 }, { rough: 0.7 });
    }
  }
  pelvis(b, PLUSH, { rough: 0.95, scale: 1.08 });
  for (const s of SIDES) garmentLeg(b, s, 0.2, 0.11, 0.1, PLUSH, { rough: 0.95 });
  // tail feathers
  for (const dx of [-0.06, 0, 0.06]) {
    const r0 = v3(dx, 0.98, 0.14);
    b.add(tube([r0, r0.clone().add(v3(dx * 0.6, -0.06, 0.08)), r0.clone().add(v3(dx * 1.2, -0.1, 0.15))], [[0, 0.025, 0.007], [1, 0.012, 0.004]], 8, 5, { up: v3(0, 1, 0.3), capA: 0.3, capB: 0.6 }), BLACK, B.hips, { rough: 0.7 });
  }
  for (const s of SIDES) leg(b, s, LEG_PROFILE.map(([t, r, f, bk]) => [t, r * 0.92, (f ?? r) * 0.92, (bk ?? r) * 0.92] as const), RED, { from: 0.2, rough: 0.55, capB: 0 });
  for (const s of SIDES) shoe(b, s, { upper: 0xff7a2a, sole: 0xff7a2a, accent: 0xff8a3a, laces: 0xff7a2a, kind: "bird" });
  return HAT_SPRINGS.slice(0, 1);
}

// ---------------------------------------------------------------------------
// the waiter
// ---------------------------------------------------------------------------

const WAITER_SKIN = 0xe2a684;

function waiter(b: SkinBuilder, h: HeadCfg): SpringDef[] {
  const VEST = 0x121216;
  const VEST_BACK = 0x34343c;
  const TROUSER = 0x1c1c22;
  const SHIRT = 0xfbfbf8;
  const APRON = 0xf9f7f0;
  // slicked back hair, grey at the temples, a side parting
  const waiterHair: HairSpec = {
    fn: (n) => {
      const front = sm(-0.45, -0.62, n.z) * sm(0.62, 0.45, n.y);
      const ear = sm(0.72, 0.85, Math.abs(n.x)) * sm(0.15, -0.05, n.y) * sm(0.35, 0.1, n.z);
      const nape = sm(-0.38, -0.5, n.y);
      const k = 1 - Math.max(front, ear, nape);
      return -0.008 + (0.018 + 0.006 * Math.max(0, n.y)) * k;
    },
    color: (n, out) => {
      if (Math.abs(n.x) > 0.72 && n.y < 0.3) out.set(0x8a857c);
      else if (Math.abs(n.x + 0.3) < 0.02 && n.z < 0.2 && n.y > 0.3) out.set(0x4a403a);
      else out.set(0x141110);
    },
    rough: 0.3,
    // combed back: a little lift at the front
    puff: (n, p) => {
      p.y += 0.008 * Math.max(0, -n.z) * Math.max(0, n.y);
    },
  };
  headBase(b, h, waiterHair, (p, out) => {
    // rosy cheeks
    const n = headDir(h, p);
    const k = Math.max(0, 1 - (Math.hypot(Math.abs(n.x) - 0.5, n.y + 0.28) / 0.22)) * (n.z < -0.3 ? 1 : 0);
    out.set(mix(WAITER_SKIN, 0xd85a48, 0.45 * k));
  }, 1.4, 0.35);
  neck(b, WAITER_SKIN, 0.054);
  // shirt collar and bow tie
  const collar: V[] = [];
  for (let i = 0; i <= 16; i++) {
    const th = -2.7 + (5.4 * i) / 16;
    collar.push(v3(Math.sin(th) * 0.064, 1.495 + 0.008 * Math.cos(th), Math.cos(th) * 0.064 + 0.006));
  }
  b.add(tube(collar, [[0, 0.006, 0.022], [1, 0.006, 0.022]], 8, 18, { up: v3(0, 1, 0), capA: 0.3, capB: 0.3 }), SHIRT, { bones: [B.chest, B.neck], power: 2 }, { rough: 0.5 });
  for (const s of SIDES) {
    b.add(ellipsoid(v3(s * 0.028, 1.475, -0.072), 0.03, 0.019, 0.011, 10, 6, new THREE.Euler(0, 0, s * 0.12)), 0x0e0e10, B.chest, { rough: 0.4 });
  }
  b.add(ellipsoid(v3(0, 1.475, -0.077), 0.012, 0.012, 0.01, 8, 6), 0x1c1c1f, B.chest, { rough: 0.4 });
  // waistcoat over a white shirt, with a comfortable belly
  const rows: TorsoRow[] = [
    [0.93, 0.164, 0.13, 0.114],
    [1.0, 0.166, 0.15, 0.11],
    [1.08, 0.168, 0.163, 0.108],
    [1.17, 0.172, 0.155, 0.11],
    [1.27, 0.178, 0.13, 0.114],
    [1.35, 0.182, 0.116, 0.116],
    [1.405, 0.172, 0.1, 0.108],
    [1.45, 0.14, 0.082, 0.09],
    [1.485, 0.09, 0.066, 0.07],
    [1.51, 0.062, 0.056, 0.058],
  ];
  torso(b, rows, (p, out) => {
    const front = p.z < -0.02;
    let c = p.z > 0.04 && p.y > 1.02 ? VEST_BACK : VEST;
    if (front && p.y > 1.2 && Math.abs(p.x) < 0.012 + (p.y - 1.2) * 0.33) c = SHIRT;
    if (p.y < 1.0 - Math.max(0, 0.1 - Math.abs(p.x)) * 0.35) c = TROUSER;
    if (p.z > 0.04 && Math.abs(p.y - 1.1) < 0.012 && Math.abs(p.x) < 0.07) c = 0x55555e; // back strap
    out.set(c);
  }, { rough: 0.5, segs: 28, extra: [0.995, 1.005, 1.088, 1.112] });
  for (let k = 0; k < 4; k++) {
    const y = 1.17 - k * 0.05;
    const f = 0.155 + (y > 1.1 ? -0.005 : 0.008);
    b.add(ellipsoid(v3(0.012, y, -f - 0.006), 0.007, 0.007, 0.004, 8, 5), 0xc9a24a, TORSO_SKIN, { rough: 0.25, shade: 0 });
  }
  // rolled shirt sleeves, bare forearms
  for (const s of SIDES) {
    arm(b, s, SHIRT_SLEEVE, SHIRT, { to: 0.6, capB: 0, rough: 0.55 });
    arm(b, s, [[0.52, 0.064], [0.56, 0.066], [0.6, 0.064]], 0xeeeeea, { from: 0.52, to: 0.6, capA: 0, capB: 0, rough: 0.55 });
    arm(b, s, [[0.5, 0.05], [0.6, 0.048], [0.75, 0.046], [0.95, 0.034], [1, 0.032]], WAITER_SKIN, { from: 0.5, capA: 0.4, capB: 0, rough: 0.6 });
    hand(b, s, WAITER_SKIN, { size: 1.05 });
  }
  pelvis(b, TROUSER, { rough: 0.6, scale: 1.03 });
  for (const s of SIDES) garmentLeg(b, s, 0.95, 0.102, 0.06, TROUSER, { rough: 0.6 });
  for (const s of SIDES) shoe(b, s, { upper: 0x0d0d0f, sole: 0x1a1a1a, accent: 0x0d0d0f, laces: 0x0d0d0f, kind: "flat" });
  // the long white apron on the flap chain, and its waist string
  const apronRows: TorsoRow[] = [];
  for (let y = 1.01; y >= 0.4 - 1e-6; y -= 0.045) {
    const t = (1.01 - y) / 0.61;
    apronRows.push([y, 0.19 + 0.04 * t, 0.007, 0.004, -0.158 - 0.02 * Math.sin(t * Math.PI * 0.8) + 0.01 * t]);
  }
  const ap = loft(yRings(apronRows, 2), 12, 0.3, 0.3);
  for (const p of ap.pts) p.z += 0.75 * p.x * p.x; // wrap round the legs
  b.add(ap, (p, out) => {
    const hem = p.y < 0.425;
    const pocket = p.y > 0.75 && p.y < 0.86 && Math.abs(p.x - 0.07) < 0.07 && (Math.abs(p.x - 0.07) > 0.064 || p.y > 0.855);
    out.set(hem || pocket ? 0xe6e1d3 : APRON);
  }, { bones: [B.hips, B.flapA, B.flapB, B.flapC], power: 4, bias: [2.2, 1, 1, 1] }, { rough: 0.85, mottle: 0.03 });
  const band: V[] = [];
  for (let i = 0; i <= 18; i++) {
    const th = (i / 18) * Math.PI * 2;
    band.push(v3(Math.sin(th) * 0.172, 1.005, -Math.cos(th) * (th < Math.PI / 2 || th > 1.5 * Math.PI ? 0.158 : 0.118)));
  }
  b.add(tube(band, [[0, 0.006, 0.012], [1, 0.006, 0.012]], 6, 24, { up: v3(0, 1, 0), capA: 0, capB: 0 }), APRON, B.hips, { rough: 0.8 });
  for (const s of SIDES) b.add(ellipsoid(v3(s * 0.03, 1.0, 0.125), 0.03, 0.016, 0.008, 8, 5, new THREE.Euler(0, 0, s * 0.4)), APRON, B.hips, { rough: 0.8 });
  // tea towel over the left forearm (hangs down when the forearm is held forward)
  {
    const a = armPoints(-1);
    const m = a.e.clone().lerp(a.w, 0.5);
    const rot = new THREE.Matrix4().makeRotationZ(-P.armOut).setPosition(m);
    const u: V[] = [v3(-0.05, 0, 0.17), v3(-0.05, 0, 0.02), v3(-0.036, 0, -0.04), v3(0, 0, -0.06), v3(0.036, 0, -0.04), v3(0.05, 0, 0.02), v3(0.05, 0, 0.15)].map((p) => p.applyMatrix4(rot));
    b.add(tube(u, [[0, 0.004, 0.075], [1, 0.004, 0.075]], 6, 14, { up: v3(-Math.sin(P.armOut), Math.cos(P.armOut), 0), capA: 0.2, capB: 0.2 }), (p, out) => {
      const z = p.z - m.z;
      out.set(z > 0.11 && z < 0.135 ? 0xc62828 : 0xf4efe2);
    }, B.foreL, { rough: 0.9, mottle: 0.05 });
  }
  // the unpaid bill in the right hand
  {
    const a = armPoints(1);
    const d = a.h.clone().sub(a.w).normalize();
    const p0 = a.w.clone().addScaledVector(d, 0.07).add(v3(0, 0, -0.03));
    const p1 = a.w.clone().addScaledVector(d, 0.33).add(v3(0, 0, -0.045));
    const rings = [];
    for (let k = 0; k <= 12; k++) {
      const c = p0.clone().lerp(p1, k / 12);
      c.z += 0.01 * Math.sin((k / 12) * Math.PI);
      rings.push({ c, x: v3(1, 0, 0).applyAxisAngle(v3(0, 0, 1), P.armOut), y: v3(0, 0, -1), rx: 0.038, ryP: 0.0018, ryN: 0.0018, e: 4 });
    }
    b.add(loft(rings, 12, 0, 0), (p, out) => {
      const t = p.clone().sub(p0).dot(d) / 0.26;
      const across = Math.abs(p.clone().sub(p0).dot(v3(1, 0, 0).applyAxisAngle(v3(0, 0, 1), P.armOut)));
      if (t > 0.85 && across < 0.025) out.set(0xc62828);
      else if (t > 0.12 && t < 0.8 && Math.floor(t * 14) % 2 === 0 && across < 0.028) out.set(0x9a968a);
      else out.set(0xfffcf0);
    }, B.handR, { rough: 0.9, shade: 0.3, mottle: 0 });
  }
  return [
    { bone: B.flapA, flex: 0.75, stiff: 40, damp: 6, minX: -0.12, maxX: 1.35, maxZ: 0.35, push: true, tuck: 2.0 },
    { bone: B.flapB, flex: 0.85, stiff: 32, damp: 5, minX: -0.5, maxX: 0.9, maxZ: 0.4, push: true, tuck: 0.9 },
    { bone: B.flapC, flex: 0.9, stiff: 26, damp: 4, minX: -0.6, maxX: 0.8, maxZ: 0.4, tuck: 0.5 },
  ];
}

// ---------------------------------------------------------------------------

const cache = new Map<string, Look>();

function finish(b: SkinBuilder, head: HeadCfg, springs: SpringDef[], rollScale: number, mood?: Look["mood"]): Look {
  const geometry = b.build(true);
  geometry.userData["triangles"] = b.triangles;
  return { geometry, head, springs, rollScale, mood };
}

export function runnerLook(outfit: OutfitId): Look {
  const key = `runner:${outfit}`;
  let look = cache.get(key);
  if (!look) {
    const b = new SkinBuilder(BONES);
    const h = runnerHead(SKIN);
    let springs: SpringDef[];
    switch (outfit) {
      case "futbolera": springs = futbolera(b, h); break;
      case "feria": springs = feria(b, h); break;
      case "carnaval": springs = carnaval(b, h); break;
      case "romano": springs = romano(b, h); break;
      case "cigueno": springs = cigueno(b, h); break;
      default: springs = clasico(b, h);
    }
    look = finish(b, h, springs, rollFor(outfit));
    cache.set(key, look);
  }
  return look;
}

export function waiterLook(): Look {
  let look = cache.get("waiter");
  if (!look) {
    const b = new SkinBuilder(BONES);
    const h = waiterHead(WAITER_SKIN);
    const springs = waiter(b, h);
    look = finish(b, h, springs, 0.9, { browAngry: 0.4 });
    cache.set("waiter", look);
  }
  return look;
}

export { BONES as HUMAN_BONES };
export const LEG_POINTS = legPoints;
