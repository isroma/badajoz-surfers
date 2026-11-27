/**
 * The white stork (Ciconia ciconia): white body and coverts, black flight feathers, long red bill
 * and legs, long neck. One skinned mesh at real-bird scale (about 2 m span) on an 18-bone rig, with
 * procedural poses: a powered flap cycle (downstroke, folded upstroke, counter-bob, trailing legs),
 * a carrying hover with the feet gripping, a braking flare for arrivals, and a standing pose with
 * the bill-clattering display for rooftops and nests.
 */
import * as THREE from "three";
import { CHAR } from "./material";
import { SkinBuilder, ellipsoid, loft, tube, v3, type BoneDef, type Ring, type V } from "./skin";
import { instantiate } from "./rig";

const SIDES = [-1, 1] as const;
const WHITE = 0xf8f7f2;
const BLACK = 0x141416;
const RED = 0xd9361c;

export const S = {
  body: 0,
  neck1: 1,
  neck2: 2,
  head: 3,
  jaw: 4,
  wingL1: 5,
  wingL2: 6,
  wingL3: 7,
  wingR1: 8,
  wingR2: 9,
  wingR3: 10,
  legL1: 11,
  legL2: 12,
  footL: 13,
  legR1: 14,
  legR2: 15,
  footR: 16,
  tail: 17,
} as const;

function bones(): BoneDef[] {
  const d: BoneDef[] = [
    { name: "body", parent: -1, head: v3(0, 0, 0), tail: v3(0, 0, -0.2), order: "YXZ" },
    { name: "neck1", parent: 0, head: v3(0, 0.04, -0.2), tail: v3(0, 0.05, -0.33), order: "XYZ" },
    { name: "neck2", parent: 1, head: v3(0, 0.05, -0.33), tail: v3(0, 0.055, -0.47), order: "XYZ" },
    { name: "head", parent: 2, head: v3(0, 0.058, -0.48), tail: v3(0, 0.06, -0.58), order: "XYZ" },
    { name: "jaw", parent: 3, head: v3(0, 0.05, -0.56), tail: v3(0, 0.034, -0.78), order: "XYZ" },
  ];
  for (const s of SIDES) {
    const base = d.length;
    d.push(
      { name: `wing${s}1`, parent: 0, head: v3(s * 0.07, 0.05, -0.09), tail: v3(s * 0.28, 0.05, -0.07), order: "XYZ" },
      { name: `wing${s}2`, parent: base, head: v3(s * 0.28, 0.05, -0.07), tail: v3(s * 0.5, 0.05, -0.1), order: "XYZ" },
      { name: `wing${s}3`, parent: base + 1, head: v3(s * 0.5, 0.05, -0.1), tail: v3(s * 0.68, 0.05, -0.08), order: "XYZ" },
    );
  }
  for (const s of SIDES) {
    const base = d.length;
    d.push(
      { name: `leg${s}1`, parent: 0, head: v3(s * 0.045, -0.07, 0.03), tail: v3(s * 0.045, -0.27, 0.05), order: "XYZ" },
      { name: `leg${s}2`, parent: base, head: v3(s * 0.045, -0.27, 0.05), tail: v3(s * 0.045, -0.48, 0.04), order: "XYZ" },
      { name: `foot${s}`, parent: base + 1, head: v3(s * 0.045, -0.48, 0.04), tail: v3(s * 0.045, -0.5, -0.05), order: "XYZ" },
    );
  }
  d.push({ name: "tail", parent: 0, head: v3(0, 0.02, 0.22), tail: v3(0, 0.02, 0.4), order: "XYZ" });
  return d;
}

const DEFS = bones();

function zRing(z: number, y: number, w: number, up: number, down: number, e = 2): Ring {
  return { c: v3(0, y, z), x: v3(1, 0, 0), y: v3(0, 1, 0), rx: w, ryP: up, ryN: down, e };
}

function build(): THREE.BufferGeometry {
  const b = new SkinBuilder(DEFS);
  const feather = (p: V, out: THREE.Color): void => {
    // faint grey streaks so the white reads as plumage
    const k = 0.94 + 0.06 * Math.sin(p.z * 90 + Math.sin(p.x * 40) * 2);
    out.set(WHITE).multiplyScalar(k);
  };
  // body: tail (+z) to breast (-z)
  b.add(loft([
    zRing(0.3, 0.015, 0.035, 0.015, 0.015),
    zRing(0.22, 0.012, 0.075, 0.04, 0.05),
    zRing(0.1, 0.0, 0.104, 0.075, 0.098),
    zRing(-0.02, 0.0, 0.11, 0.085, 0.112),
    zRing(-0.12, 0.01, 0.092, 0.078, 0.1),
    zRing(-0.2, 0.03, 0.058, 0.058, 0.07),
    zRing(-0.24, 0.04, 0.038, 0.04, 0.042),
  ], 18, 0.6, 0.4), feather, { bones: [S.body, S.neck1, S.tail], power: 4, bias: [1, 1.4, 1.2] }, { rough: 0.9, mottle: 0.02 });
  // neck, extended forward in flight; curved by the bones when standing
  b.add(tube([v3(0, 0.035, -0.18), v3(0, 0.045, -0.3), v3(0, 0.052, -0.42), v3(0, 0.058, -0.5)], [[0, 0.046, 0.05, 0.055], [0.35, 0.034, 0.036, 0.042], [1, 0.026, 0.028, 0.026]], 12, 10, { up: v3(0, 1, 0), capA: 0.5, capB: 0.5 }), feather, { bones: [S.body, S.neck1, S.neck2, S.head], power: 4 }, { rough: 0.9 });
  // head
  b.add(ellipsoid(v3(0, 0.068, -0.525), 0.03, 0.034, 0.046, 12, 9), WHITE, S.head, { rough: 0.85 });
  // dark skin round the eyes, the eyes themselves
  for (const s of SIDES) {
    b.add(ellipsoid(v3(s * 0.024, 0.074, -0.548), 0.008, 0.011, 0.014, 8, 6), 0x2a2220, S.head, { rough: 0.6, shade: 0 });
    b.add(ellipsoid(v3(s * 0.0285, 0.076, -0.55), 0.0055, 0.0055, 0.0055, 8, 6), 0x050505, S.head, { rough: 0.15, shade: 0 });
    b.add(ellipsoid(v3(s * 0.032, 0.078, -0.552), 0.0015, 0.0015, 0.0015, 4, 3), 0xffffff, S.head, { rough: 0.1, shade: 0 });
  }
  // the bill: upper mandible on the head, lower on the jaw bone
  b.add(tube([v3(0, 0.068, -0.555), v3(0, 0.058, -0.66), v3(0, 0.044, -0.78)], [[0, 0.015, 0.012, 0.006], [0.5, 0.01, 0.007, 0.004], [1, 0.0015, 0.0015, 0.0015]], 10, 8, { up: v3(0, 1, 0), capA: 0.3, capB: 0.5 }), RED, S.head, { rough: 0.35 });
  b.add(tube([v3(0, 0.054, -0.552), v3(0, 0.047, -0.66), v3(0, 0.038, -0.775)], [[0, 0.013, 0.004, 0.009], [0.5, 0.009, 0.003, 0.006], [1, 0.0012, 0.0012, 0.0012]], 10, 8, { up: v3(0, 1, 0), capA: 0.3, capB: 0.5 }), 0xc42e16, S.jaw, { rough: 0.35 });
  // tail fan
  b.add(loft([
    { c: v3(0, 0.02, 0.2), x: v3(1, 0, 0), y: v3(0, 1, 0), rx: 0.05, ryP: 0.012, ryN: 0.01 },
    { c: v3(0, 0.022, 0.32), x: v3(1, 0, 0), y: v3(0, 1, 0), rx: 0.085, ryP: 0.008, ryN: 0.006, mod: (a) => 1 + 0.06 * Math.cos(a * 8) },
    { c: v3(0, 0.02, 0.4), x: v3(1, 0, 0), y: v3(0, 1, 0), rx: 0.075, ryP: 0.004, ryN: 0.003, mod: (a) => 1 + 0.08 * Math.cos(a * 8) },
  ], 16, 0.3, 0.3), feather, { bones: [S.body, S.tail], power: 4 }, { rough: 0.9 });
  // wings
  for (const s of SIDES) {
    const w1 = s < 0 ? S.wingL1 : S.wingR1;
    const w2 = s < 0 ? S.wingL2 : S.wingR2;
    const w3 = s < 0 ? S.wingL3 : S.wingR3;
    // [span x, leading z, trailing z, thickness]
    const st: [number, number, number, number][] = [
      [0.05, -0.12, 0.14, 0.03],
      [0.12, -0.12, 0.2, 0.028],
      [0.28, -0.1, 0.21, 0.024],
      [0.4, -0.12, 0.2, 0.02],
      [0.5, -0.13, 0.17, 0.018],
      [0.6, -0.12, 0.11, 0.014],
      [0.69, -0.1, 0.05, 0.01],
    ];
    const rings: Ring[] = [];
    const fine: [number, number, number, number][] = [];
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i] as [number, number, number, number];
      const c = st[i + 1] as [number, number, number, number];
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        fine.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, a[3] + (c[3] - a[3]) * t]);
      }
    }
    fine.push(st[st.length - 1] as [number, number, number, number]);
    for (const [x, le, te0, th] of fine) {
      // scalloped trailing edge: the tips of the secondaries
      const te = te0 + (x > 0.14 && x < 0.62 ? 0.012 * Math.sin(x * 70) : 0);
      const mid = (le + te) / 2;
      rings.push({ c: v3(s * x, 0.05 - x * 0.02, mid), x: v3(0, 0, 1), y: v3(0, 1, 0), rx: (te - le) / 2, ryP: th * 0.6, ryN: th * 0.4 });
    }
    b.add(loft(rings, 16, 0.3, 0.3), (p, out) => {
      const x = Math.abs(p.x);
      let le = -0.12;
      let te = 0.2;
      for (let i = 0; i < st.length - 1; i++) {
        const a = st[i] as [number, number, number, number];
        const c = st[i + 1] as [number, number, number, number];
        if (x >= a[0] && x <= c[0]) {
          const t = (x - a[0]) / (c[0] - a[0]);
          le = a[1] + (c[1] - a[1]) * t;
          te = a[2] + (c[2] - a[2]) * t;
        }
      }
      // white coverts in front, black remiges behind
      const f = (p.z - le) / (te - le);
      out.set(f > 0.42 || x > 0.56 ? BLACK : WHITE);
    }, { bones: [S.body, w1, w2, w3], power: 3, bias: [1.6, 1, 1, 1] }, { rough: 0.8, mottle: 0.03 });
    // primaries: six long slotted fingers from the hand
    for (let k = 0; k < 6; k++) {
      const root = v3(s * (0.6 + k * 0.012), 0.038, -0.09 + k * 0.03);
      const ang = -0.12 + k * 0.17;
      const len = 0.36 - Math.abs(k - 1.5) * 0.03;
      const dir = v3(s * Math.cos(ang), 0, Math.sin(ang));
      const mid = root.clone().addScaledVector(dir, len * 0.5).add(v3(0, 0.006, 0));
      const tip = root.clone().addScaledVector(dir, len).add(v3(0, 0.03, 0));
      b.add(tube([root, mid, tip], [[0, 0.026, 0.004, 0.003], [0.45, 0.03, 0.004, 0.003], [1, 0.006, 0.002, 0.002]], 8, 6, { up: v3(0, 1, 0), capA: 0.3, capB: 0.8 }), BLACK, w3, { rough: 0.7 });
    }
  }
  // legs: long and red; three forward toes and a hind toe
  for (const s of SIDES) {
    const l1 = s < 0 ? S.legL1 : S.legR1;
    const l2 = s < 0 ? S.legL2 : S.legR2;
    const ft = s < 0 ? S.footL : S.footR;
    const x = s * 0.045;
    // feathered thigh
    b.add(ellipsoid(v3(x, -0.08, 0.035), 0.03, 0.05, 0.035, 10, 6), WHITE, { bones: [S.body, l1], power: 4 }, { rough: 0.9 });
    b.add(tube([v3(x, -0.1, 0.04), v3(x, -0.27, 0.05), v3(x, -0.48, 0.04)], [[0, 0.013], [0.45, 0.011], [0.5, 0.013], [0.55, 0.011], [1, 0.01]], 8, 10, { capA: 0.6, capB: 0.6 }), RED, { bones: [l1, l2, ft], power: 5 }, { rough: 0.45 });
    for (const a of [-0.35, 0, 0.35]) {
      const d = v3(Math.sin(a), 0, -Math.cos(a));
      b.add(tube([v3(x, -0.485, 0.03), v3(x, -0.495, 0.03).addScaledVector(d, 0.05), v3(x, -0.498, 0.03).addScaledVector(d, 0.095)], [[0, 0.008], [1, 0.004]], 6, 4, { capA: 0.5, capB: 0.8 }), RED, ft, { rough: 0.45 });
    }
    b.add(tube([v3(x, -0.485, 0.04), v3(x, -0.497, 0.075)], [[0, 0.006], [1, 0.003]], 6, 2, { capA: 0.5, capB: 0.8 }), RED, ft, { rough: 0.45 });
  }
  const g = b.build(true);
  g.userData["triangles"] = b.triangles;
  return g;
}

let GEO: THREE.BufferGeometry | null = null;
function geometry(): THREE.BufferGeometry {
  if (!GEO) GEO = build();
  return GEO;
}

export type StorkMode = "fly" | "carry" | "flare" | "stand" | "glide";

const frac = (x: number): number => x - Math.floor(x);
function loop(keys: readonly number[], u: number): number {
  const n = keys.length;
  const x = frac(u) * n;
  const i = Math.floor(x);
  const t = x - i;
  const p0 = keys[(i - 1 + n) % n] ?? 0;
  const p1 = keys[i % n] ?? 0;
  const p2 = keys[(i + 1) % n] ?? 0;
  const p3 = keys[(i + 2) % n] ?? 0;
  const t2 = t * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t2 * t);
}

// wing elevation over a beat (0 = top): fast powerful downstroke, folded recovery
const ELEV = [0.85, 0.6, 0.12, -0.35, -0.62, -0.45, 0.05, 0.55];
const FOLD = [0.08, 0.0, 0.0, 0.0, 0.12, 0.5, 0.62, 0.34];
const BOB = [-0.6, -0.2, 0.4, 0.9, 0.7, 0.1, -0.5, -0.8];

/** A posable stork: `pose` writes bone angles for a mode and blend; the root is the body centre. */
export class StorkRig {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  private readonly bones: THREE.Bone[];
  private readonly body: THREE.Bone;
  private clatter = 0;
  private nextClatter = 3 + Math.random() * 4;

  constructor() {
    const sk = instantiate(DEFS);
    this.skeleton = sk.skeleton;
    this.bones = sk.bones;
    this.body = sk.root;
    this.mesh = new THREE.SkinnedMesh(geometry(), CHAR);
    this.mesh.castShadow = true;
    this.mesh.add(sk.root);
    this.mesh.bind(sk.skeleton, new THREE.Matrix4());
    this.mesh.boundingSphere = new THREE.Sphere(v3(0, 0, 0), 1.2);
    this.root.add(this.mesh);
  }

  private r(i: number, x: number, y: number, z: number): void {
    this.bones[i]?.rotation.set(x, y, z);
  }

  /**
   * `beat` is the flap phase (cycles), `power` 0..1 scales the stroke, `legs` 0 = trailing,
   * 1 = gripping / hanging down, `lift` pitches the body up (hover).
   */
  fly(beat: number, power: number, legs: number, lift: number, yaw = 0): void {
    const u = frac(beat);
    const elev = loop(ELEV, u) * power + (1 - power) * 0.05;
    const fold = loop(FOLD, u) * (0.4 + 0.6 * power);
    const bob = loop(BOB, u) * 0.03 * power;
    this.body.position.set(0, bob, 0);
    this.body.rotation.set(lift - 0.04 * loop(BOB, u - 0.1) * power, yaw, 0);
    for (const s of SIDES) {
      const w1 = s < 0 ? S.wingL1 : S.wingR1;
      const w2 = s < 0 ? S.wingL2 : S.wingR2;
      const w3 = s < 0 ? S.wingL3 : S.wingR3;
      // shoulder: elevation, a little sweep back on the upstroke
      this.r(w1, -0.1 * fold + 0.15 * lift, s * -0.25 * fold, s * elev);
      // elbow folds back on the upstroke, wrist the other way (Z-fold), feathers twist open
      this.r(w2, 0, s * -0.9 * fold, s * 0.1 * elev);
      this.r(w3, -0.35 * fold, s * 1.15 * fold, s * (0.18 * elev - 0.05));
    }
    // neck stretched forward, head stabilised against the bob
    this.r(S.neck1, -0.06 - lift * 0.5, 0, 0);
    this.r(S.neck2, 0.02 - lift * 0.3, 0, 0);
    this.r(S.head, -0.02 - lift * 0.15 - bob * 1.5, 0, 0);
    this.r(S.jaw, 0, 0, 0);
    this.r(S.tail, -0.05 + 0.1 * lift, 0, 0);
    for (const s of SIDES) {
      const l1 = s < 0 ? S.legL1 : S.legR1;
      const l2 = s < 0 ? S.legL2 : S.legR2;
      const ft = s < 0 ? S.footL : S.footR;
      // trailing behind the tail <-> reaching down and gripping
      this.r(l1, -1.45 * (1 - legs) + (0.15 - lift) * legs, 0, s * 0.08 * legs);
      this.r(l2, -0.15 * (1 - legs) - 0.3 * legs, 0, 0);
      this.r(ft, -0.9 * (1 - legs) + 0.9 * legs, 0, 0);
    }
  }

  /** Braking flare (arrivals and landings): wings high and forward, legs out. */
  flare(k: number, beat: number): void {
    this.fly(beat, 0.7, 1, 0.55 * k);
    for (const s of SIDES) {
      const w1 = s < 0 ? S.wingL1 : S.wingR1;
      const b1 = this.bones[w1];
      if (b1) {
        b1.rotation.z += s * 0.35 * k;
        b1.rotation.x += 0.35 * k;
      }
    }
  }

  /** Standing on one spot: wings folded, neck in an S; the bill-clattering display now and then. */
  stand(dt: number, t: number): void {
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0.12, 0, 0);
    for (const s of SIDES) {
      const w1 = s < 0 ? S.wingL1 : S.wingR1;
      const w2 = s < 0 ? S.wingL2 : S.wingR2;
      const w3 = s < 0 ? S.wingL3 : S.wingR3;
      this.r(w1, 0.12, s * -1.3, s * 0.12);
      this.r(w2, -0.05, s * 2.75, s * 0.05);
      this.r(w3, 0.05, s * -2.8, s * 0.05);
      const l1 = s < 0 ? S.legL1 : S.legR1;
      const l2 = s < 0 ? S.legL2 : S.legR2;
      const ft = s < 0 ? S.footL : S.footR;
      this.r(l1, -0.12, 0, 0);
      this.r(l2, 0.12, 0, 0);
      this.r(ft, 0, 0, 0);
    }
    this.r(S.tail, 0.25, 0, 0);
    // clattering: the head thrown back, the bill opening and shutting very fast
    this.nextClatter -= dt;
    if (this.nextClatter <= 0 && this.clatter <= 0) {
      this.clatter = 2.2;
      this.nextClatter = 5 + Math.random() * 6;
    }
    let back = 0;
    let jaw = 0;
    if (this.clatter > 0) {
      this.clatter = Math.max(0, this.clatter - dt);
      const k = Math.min(1, (2.2 - this.clatter) / 0.35) * Math.min(1, this.clatter / 0.4);
      back = k;
      jaw = k * (0.15 + 0.15 * Math.sin(t * 70));
    }
    const look = Math.sin(t * 0.7) * 0.4;
    this.r(S.neck1, 1.2 + 0.35 * back, look * 0.3, 0);
    this.r(S.neck2, -0.55 + 0.6 * back, look * 0.4, 0);
    this.r(S.head, -0.6 + 0.9 * back, look * 0.3, 0);
    this.r(S.jaw, jaw, 0, 0);
  }

  /** Gliding (no flap), wings level: used by the pickup between beats. */
  glide(): void {
    this.fly(0.1, 0.15, 0, 0);
  }
}

/**
 * Small flapping storks for the "ciguena" pickups. They all share one puppet skeleton that lives
 * outside the scene (detached binding), so pickups cost no per-instance bones or bone textures and
 * nothing leaks when the engine releases them; they flap in unison, which nobody can tell.
 */
let PUPPET: StorkRig | null = null;
let puppetT = Number.NaN;
export function storkIcon(): { mesh: THREE.SkinnedMesh; update(t: number): void } {
  if (!PUPPET) PUPPET = new StorkRig();
  const puppet = PUPPET;
  const mesh = new THREE.SkinnedMesh(geometry(), CHAR);
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bind(puppet.skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.boundingSphere = new THREE.Sphere(v3(0, 0, 0), 1.2);
  return {
    mesh,
    update(t: number) {
      if (t === puppetT) return;
      puppetT = t;
      puppet.fly(t * 1.5, 0.85, 0, 0.12);
      puppet.root.updateMatrixWorld(true);
    },
  };
}

/** Standing height of the stork model (feet to crown) at scale 1. */
export const STORK_STAND_OFFSET = 0.5;

/**
 * A stork for scenery (rooftops, church towers, nests): origin at its feet, facing -Z, about 1 m
 * tall. Call `update(dt)` each frame for the idle and the occasional bill-clattering display.
 */
export function createStork(): { root: THREE.Group; update(dt: number): void } {
  const rig = new StorkRig();
  const root = new THREE.Group();
  root.name = "stork";
  rig.root.position.y = STORK_STAND_OFFSET;
  root.add(rig.root);
  let t = Math.random() * 10;
  rig.stand(0, t);
  return {
    root,
    update(dt: number) {
      t += dt;
      rig.stand(dt, t);
    },
  };
}

