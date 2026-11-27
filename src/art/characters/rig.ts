/**
 * The human skeleton shared by the runner (every outfit) and the waiter: 21 animated bones plus
 * 10 secondary bones driven by springs (hood, drawstrings, the apron / front flap chain, a back
 * chain for scarves and drapes, and a hat bone for feathers).
 */
import * as THREE from "three";
import { P } from "../proportions";
import { v3, type BoneDef } from "./skin";

export const B = {
  hips: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  clavL: 5,
  armL: 6,
  foreL: 7,
  handL: 8,
  clavR: 9,
  armR: 10,
  foreR: 11,
  handR: 12,
  thighL: 13,
  shinL: 14,
  footL: 15,
  toeL: 16,
  thighR: 17,
  shinR: 18,
  footR: 19,
  toeR: 20,
  // secondary (spring driven)
  hood: 21,
  strL: 22,
  strR: 23,
  flapA: 24,
  flapB: 25,
  flapC: 26,
  backA: 27,
  backB: 28,
  hat: 29,
  hat2: 30,
} as const;

/** Number of bones animated by the pose system. */
export const ANIMATED = 21;

export function armPoints(side: -1 | 1): { j: THREE.Vector3; e: THREE.Vector3; w: THREE.Vector3; h: THREE.Vector3 } {
  const s = Math.sin(P.armOut);
  const c = Math.cos(P.armOut);
  const j = v3(side * P.shoulderX, P.shoulderY, 0);
  const e = j.clone().add(v3(side * s * P.upperArm, -c * P.upperArm, 0.01));
  const w = e.clone().add(v3(side * s * P.forearm, -c * P.forearm, -0.01));
  const h = w.clone().add(v3(side * s * P.hand, -c * P.hand, 0));
  return { j, e, w, h };
}

export function legPoints(side: -1 | 1): { h: THREE.Vector3; k: THREE.Vector3; a: THREE.Vector3; t: THREE.Vector3; tip: THREE.Vector3 } {
  const h = v3(side * P.hipX, P.hipY, 0);
  const a = v3(side * P.ankleX, P.ankleY, 0.012);
  const k = v3(side * (P.hipX + P.ankleX) / 2, P.kneeY, -0.006);
  const t = v3(side * P.ankleX, P.toeY, P.toeZ);
  const tip = v3(side * P.ankleX, P.toeY, P.toeZ - 0.085);
  return { h, k, a, t, tip };
}

export function humanBones(): BoneDef[] {
  const L = armPoints(-1);
  const R = armPoints(1);
  const lL = legPoints(-1);
  const lR = legPoints(1);
  const headTop = v3(0, P.height, 0);
  const bones: BoneDef[] = [
    { name: "hips", parent: -1, head: v3(0, P.hipY, 0), tail: v3(0, P.spineY, 0), order: "YXZ" },
    { name: "spine", parent: 0, head: v3(0, P.spineY, 0), tail: v3(0, P.chestY, 0), order: "YXZ" },
    { name: "chest", parent: 1, head: v3(0, P.chestY, 0), tail: v3(0, P.neckY, 0), order: "YXZ" },
    { name: "neck", parent: 2, head: v3(0, P.neckY, 0), tail: v3(0, P.headY, 0), order: "YXZ" },
    { name: "head", parent: 3, head: v3(0, P.headY, 0), tail: headTop, order: "YXZ" },
    { name: "clavL", parent: 2, head: v3(-P.clavX, P.shoulderY + 0.01, -0.005), tail: L.j, order: "XYZ" },
    { name: "armL", parent: 5, head: L.j, tail: L.e, order: "XZY" },
    { name: "foreL", parent: 6, head: L.e, tail: L.w, order: "XYZ" },
    { name: "handL", parent: 7, head: L.w, tail: L.h, order: "XYZ" },
    { name: "clavR", parent: 2, head: v3(P.clavX, P.shoulderY + 0.01, -0.005), tail: R.j, order: "XYZ" },
    { name: "armR", parent: 9, head: R.j, tail: R.e, order: "XZY" },
    { name: "foreR", parent: 10, head: R.e, tail: R.w, order: "XYZ" },
    { name: "handR", parent: 11, head: R.w, tail: R.h, order: "XYZ" },
    { name: "thighL", parent: 0, head: lL.h, tail: lL.k, order: "XZY" },
    { name: "shinL", parent: 13, head: lL.k, tail: lL.a, order: "XYZ" },
    { name: "footL", parent: 14, head: lL.a, tail: lL.t, order: "XYZ" },
    { name: "toeL", parent: 15, head: lL.t, tail: lL.tip, order: "XYZ" },
    { name: "thighR", parent: 0, head: lR.h, tail: lR.k, order: "XZY" },
    { name: "shinR", parent: 17, head: lR.k, tail: lR.a, order: "XYZ" },
    { name: "footR", parent: 18, head: lR.a, tail: lR.t, order: "XYZ" },
    { name: "toeR", parent: 19, head: lR.t, tail: lR.tip, order: "XYZ" },
    // secondary
    { name: "hood", parent: 2, head: v3(0, 1.47, 0.07), tail: v3(0, 1.36, 0.16), order: "XYZ" },
    { name: "strL", parent: 2, head: v3(-0.045, 1.445, -0.1), tail: v3(-0.045, 1.3, -0.125), order: "XYZ" },
    { name: "strR", parent: 2, head: v3(0.045, 1.445, -0.1), tail: v3(0.045, 1.3, -0.125), order: "XYZ" },
    { name: "flapA", parent: 0, head: v3(0, 1.0, -0.13), tail: v3(0, 0.8, -0.15), order: "XYZ" },
    { name: "flapB", parent: 24, head: v3(0, 0.8, -0.15), tail: v3(0, 0.6, -0.16), order: "XYZ" },
    { name: "flapC", parent: 25, head: v3(0, 0.6, -0.16), tail: v3(0, 0.4, -0.165), order: "XYZ" },
    { name: "backA", parent: 2, head: v3(0, 1.42, 0.12), tail: v3(0, 1.2, 0.15), order: "XYZ" },
    { name: "backB", parent: 27, head: v3(0, 1.2, 0.15), tail: v3(0, 0.98, 0.16), order: "XYZ" },
    { name: "hat", parent: 4, head: v3(0, 1.76, 0), tail: v3(0, 1.9, 0), order: "XYZ" },
    { name: "hat2", parent: 29, head: v3(0, 1.9, 0), tail: v3(0, 2.0, 0), order: "XYZ" },
  ];
  return bones;
}

export interface SkeletonInstance {
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  root: THREE.Bone;
}

/** Create bones (rest rotations are identity, so animation angles are in body-aligned frames). */
export function instantiate(defs: readonly BoneDef[]): SkeletonInstance {
  const bones: THREE.Bone[] = [];
  const inverses: THREE.Matrix4[] = [];
  for (const d of defs) {
    const b = new THREE.Bone();
    b.name = d.name;
    const parent = d.parent >= 0 ? defs[d.parent] : undefined;
    b.position.copy(d.head);
    if (parent) b.position.sub(parent.head);
    if (d.order) b.rotation.order = d.order;
    const pb = d.parent >= 0 ? bones[d.parent] : undefined;
    if (pb) pb.add(b);
    bones.push(b);
    inverses.push(new THREE.Matrix4().makeTranslation(-d.head.x, -d.head.y, -d.head.z));
  }
  const root = bones[0];
  if (!root) throw new Error("empty skeleton");
  const skeleton = new THREE.Skeleton(bones, inverses);
  return { bones, skeleton, root };
}
