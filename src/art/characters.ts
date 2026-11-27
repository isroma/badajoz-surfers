/**
 * The two characters: the runner (who left without paying) and the angry waiter.
 *
 * Each is one SkinnedMesh (smooth sculpted body and clothes on a 31-bone rig, procedural skin
 * weights) plus a small face mesh on the head bone whose expressions are morph targets. Geometry is
 * shared by every instance of a look; bones, springs and blend state are per instance.
 * Animation: authored procedural clips cross-faded in `update`, feet planted by solving the pelvis
 * height, a landing absorb, blinking/saccades and spring-driven secondary motion (hood, strings,
 * apron, scarf, plumes). The runner also owns the patinete and the carrying stork.
 */
import * as THREE from "three";
import type { Actor, ActorAnim, OutfitId } from "../contracts";
import { runnerLook, waiterLook, type Look, type SpringDef } from "./outfits";
import { CHAR } from "./characters/material";
import { B, instantiate } from "./characters/rig";
import { FACE_CHANNELS, FX, faceGeometry } from "./characters/face";
import {
  FACE, GMASK, GROUND, HX, HY, HZ, LIFT, NCH, ROLLK, SPIN, addLanding, evalClip, smooth, type Clip, type ClipCtx,
} from "./characters/anim";
import { StorkRig, createStork } from "./characters/stork";
import { HUMAN_BONES } from "./outfits";
import { P, STORK } from "./proportions";
import { SkinBuilder, ellipsoid, loft, tube, v3, type Ring } from "./characters/skin";

export { createStork };

type Kind = "runner" | "waiter";

/** Dev-only hooks (gallery contact sheets): reset an actor to a deterministic state. */
export interface ActorDebug {
  reset(time: number, phase: number): void;
  triangles(): number;
}
export const actorDebug = new WeakMap<Actor, ActorDebug>();

// ---------------------------------------------------------------------------
// shared geometry
// ---------------------------------------------------------------------------

const faceCache = new Map<Look, THREE.BufferGeometry>();
function faceFor(look: Look): THREE.BufferGeometry {
  let g = faceCache.get(look);
  if (!g) {
    g = faceGeometry(look.head);
    faceCache.set(look, g);
  }
  return g;
}

/** Deck top height of the patinete. */
const DECK = 0.15;
let SCOOTER: THREE.BufferGeometry | null = null;
function scooterGeometry(): THREE.BufferGeometry {
  if (SCOOTER) return SCOOTER;
  const b = new SkinBuilder(null);
  const GRAPHITE = 0x262a31;
  const TEAL = 0x18c29c;
  const zr = (z: number, y: number, w: number, up: number, down: number, e = 4): Ring => ({ c: v3(0, y, z), x: v3(1, 0, 0), y: v3(0, 1, 0), rx: w, ryP: up, ryN: down, e });
  b.add(loft([zr(0.42, 0.125, 0.07, 0.018, 0.018), zr(0.36, 0.127, 0.088, 0.022, 0.022), zr(-0.3, 0.127, 0.088, 0.022, 0.022), zr(-0.37, 0.13, 0.07, 0.024, 0.02)], 20, 0.4, 0.5), (p, out) => {
    if (p.y > DECK - 0.006) out.set(0x14161a);
    else if (Math.abs(p.y - 0.127) < 0.006) out.set(TEAL);
    else out.set(GRAPHITE);
  }, null, { rough: 0.45 });
  for (const z of [-0.43, 0.45]) {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      ring.push(v3(0, 0.085 + Math.cos(a) * 0.058, z + Math.sin(a) * 0.058));
    }
    b.add(tube(ring, [[0, 0.03, 0.026], [1, 0.03, 0.026]], 10, 20, { up: v3(1, 0, 0), capA: -1, capB: -1 }), 0x151515, null, { rough: 0.85 });
    b.add(ellipsoid(v3(0, 0.085, z), 0.034, 0.045, 0.045, 12, 8), z < 0 ? TEAL : 0x8a9099, null, { rough: 0.3 });
  }
  // rear mudguard with the tail light
  b.add(tube([v3(0, 0.15, 0.36), v3(0, 0.17, 0.44), v3(0, 0.15, 0.52)], [[0, 0.04, 0.006], [1, 0.035, 0.006]], 8, 8, { up: v3(0, 1, 0), capA: 0.3, capB: 0.3 }), GRAPHITE, null, { rough: 0.5 });
  b.add(ellipsoid(v3(0, 0.155, 0.53), 0.025, 0.012, 0.01, 8, 5), 0xff2a2a, null, { rough: 0.15, shade: 0 });
  // stem, fork, handlebar, grips, lamp
  b.add(tube([v3(0, 0.085, -0.43), v3(0, 0.2, -0.4), v3(0, 0.6, -0.41), v3(0, 1.0, -0.43)], [[0, 0.018], [0.15, 0.024], [1, 0.019]], 10, 10, { capA: 0.5, capB: 0.5 }), GRAPHITE, null, { rough: 0.4 });
  b.add(tube([v3(-0.25, 1.0, -0.43), v3(0, 1.005, -0.43), v3(0.25, 1.0, -0.43)], [[0, 0.013], [1, 0.013]], 8, 8, { capA: 0.5, capB: 0.5 }), GRAPHITE, null, { rough: 0.4 });
  for (const s of [-1, 1]) {
    b.add(tube([v3(s * 0.16, 1.0, -0.43), v3(s * 0.27, 1.0, -0.43)], [[0, 0.02], [1, 0.02]], 10, 3, { capA: 0.6, capB: 0.8 }), 0x111214, null, { rough: 0.8 });
  }
  b.add(ellipsoid(v3(0, 0.93, -0.455), 0.035, 0.028, 0.02, 10, 6), 0xfff6d8, null, { rough: 0.1, shade: 0 });
  b.add(ellipsoid(v3(0, 1.02, -0.42), 0.04, 0.012, 0.03, 10, 5), 0x0c2b2a, null, { rough: 0.15 });
  SCOOTER = b.build(false);
  return SCOOTER;
}

// ---------------------------------------------------------------------------
// actor
// ---------------------------------------------------------------------------

interface Spring {
  def: SpringDef;
  bone: THREE.Bone;
  ax: number;
  az: number;
  vx: number;
  vz: number;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  acc: THREE.Vector3;
  init: boolean;
}

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _g = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const wind = new THREE.Vector3();
let curSpeed = 0;
let tuckK = 0;

const GROUNDED: ReadonlySet<Clip> = new Set<Clip>(["idle", "run", "stumble", "caught", "celebrate", "ride"]);

function fadeTime(from: Clip, to: Clip): number {
  if (to === "jump") return 0.13;
  if (to === "roll") return 0.1;
  if (from === "roll") return 0.15;
  if (to === "carried" || from === "carried") return 0.35;
  return 0.18;
}

function createActor(kind: Kind, outfit: OutfitId = "clasico"): Actor {
  const look = kind === "runner" ? runnerLook(outfit) : waiterLook();
  const waiter = kind === "waiter";
  const root = new THREE.Group();
  root.name = kind;
  const bodyGroup = new THREE.Group();
  const spin = new THREE.Group();
  spin.position.y = P.rollPivot;
  const inner = new THREE.Group();
  inner.position.y = -P.rollPivot;
  root.add(bodyGroup);
  bodyGroup.add(spin);
  spin.add(inner);

  const sk = instantiate(HUMAN_BONES);
  const bones = sk.bones;
  const bone = (i: number): THREE.Bone => {
    const b = bones[i];
    if (!b) throw new Error(`missing bone ${i}`);
    return b;
  };
  const mesh = new THREE.SkinnedMesh(look.geometry, CHAR);
  mesh.castShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  inner.add(sk.root);
  inner.add(mesh);
  mesh.bind(sk.skeleton, new THREE.Matrix4());
  const face = new THREE.Mesh(faceFor(look), CHAR);
  face.castShadow = false;
  bone(B.head).add(face);
  const morph = face.morphTargetInfluences ?? [];
  const hips = bone(B.hips);
  const hipsRest = hips.position.clone();
  const legChain = [B.hips, B.thighL, B.shinL, B.footL, B.toeL, B.thighR, B.shinR, B.footR, B.toeR].map(bone);

  // patinete
  let scooter: THREE.Mesh | null = null;
  if (!waiter) {
    scooter = new THREE.Mesh(scooterGeometry(), CHAR);
    scooter.castShadow = true;
    scooter.visible = false;
    // the rider stands over the front half of the deck, hands on the bar
    scooter.position.z = 0.16;
    root.add(scooter);
  }

  // springs
  const springs: Spring[] = look.springs.map((def) => ({
    def, bone: bone(def.bone), ax: 0, az: 0, vx: 0, vz: 0,
    prev: new THREE.Vector3(), vel: new THREE.Vector3(), acc: new THREE.Vector3(), init: false,
  }));

  // blend state
  const pose = new Float32Array(NCH);
  const from = new Float32Array(NCH);
  const tgt = new Float32Array(NCH);
  let clip: Clip = "idle";
  let clipT = 0;
  let fade = 1;
  let fadeDur = 0.18;
  let time = Math.random() * 10;
  let phase = Math.random() * Math.PI * 2;
  let lead: 1 | -1 = 1;
  let fromJump = false;
  let landT = 9;
  let landK = 1;
  let blinkT = 1 + Math.random() * 3;
  let blink = 0;
  let sacT = 0.5;
  const sac = { x: 0, y: 0, tx: 0, ty: 0 };
  let riding = false;
  let carried = false;
  let first = true;
  const ctx: ClipCtx = { t: 0, time: 0, phase: 0, speed: 0, waiter, lead: 1, fromJump: false };
  const mood = new Float32Array(FACE_CHANNELS);
  if (look.mood) for (const [k, v] of Object.entries(look.mood)) mood[FX[k as keyof typeof FX]] = v ?? 0;

  // the carrying stork
  let stork: StorkRig | null = null;
  let storkState: "off" | "arrive" | "carry" | "leave" = "off";
  let storkT = 0;
  let beat = 0;
  const GRIP = new THREE.Vector3(0, 2.18, 0.08);
  if (!waiter) {
    stork = new StorkRig();
    stork.root.scale.setScalar(STORK.carryScale);
    stork.root.visible = false;
    root.add(stork.root);
  }

  const rollChain = [B.hips, B.spine, B.chest, B.neck, B.head, B.thighL, B.shinL, B.footL, B.thighR, B.shinR, B.footR].map(bone);
  /** Mean of a few landmarks of the body (inner-group space). */
  function ballCentre(out: THREE.Vector3): void {
    out.set(0, 0, 0);
    _m1.copy(hips.matrix);
    out.add(_p.set(0, 0, 0).applyMatrix4(_m1));
    _m2.multiplyMatrices(_m1, bone(B.spine).matrix);
    _m3.multiplyMatrices(_m2, bone(B.chest).matrix);
    out.add(_p.set(0, 0.1, 0).applyMatrix4(_m3));
    _m4.multiplyMatrices(_m3, bone(B.neck).matrix);
    _m2.multiplyMatrices(_m4, bone(B.head).matrix);
    out.add(_p.set(0, 0.1, -0.01).applyMatrix4(_m2));
    for (let k = 0; k < 2; k++) {
      _m2.multiplyMatrices(_m1, bone(k === 0 ? B.thighL : B.thighR).matrix);
      _m3.multiplyMatrices(_m2, bone(k === 0 ? B.shinL : B.shinR).matrix);
      out.add(_p.set(0, 0, 0).applyMatrix4(_m3));
      out.add(_p.set(0, -0.42, 0).applyMatrix4(_m3));
    }
    out.multiplyScalar(1 / 7);
  }

  function footMin(side: -1 | 1): number {
    const o = side < 0 ? 1 : 5;
    const th = legChain[o] as THREE.Bone;
    const sh = legChain[o + 1] as THREE.Bone;
    const ft = legChain[o + 2] as THREE.Bone;
    const toe = legChain[o + 3] as THREE.Bone;
    _m1.multiplyMatrices(hips.matrix, th.matrix);
    _m2.multiplyMatrices(_m1, sh.matrix);
    _m3.multiplyMatrices(_m2, ft.matrix);
    _m4.multiplyMatrices(_m3, toe.matrix);
    let y = _p.set(0, -0.083, 0.058).applyMatrix4(_m3).y;
    y = Math.min(y, _p.set(0, -0.028, 0.0).applyMatrix4(_m4).y);
    y = Math.min(y, _p.set(0, -0.02, -0.08).applyMatrix4(_m4).y);
    return y;
  }

  function apply(dt: number): void {
    for (let i = 0; i < 21; i++) {
      bone(i).rotation.set(pose[i * 3] ?? 0, pose[i * 3 + 1] ?? 0, pose[i * 3 + 2] ?? 0);
    }
    hips.position.set(hipsRest.x + (pose[HX] ?? 0), hipsRest.y + (pose[HY] ?? 0), hipsRest.z + (pose[HZ] ?? 0));
    const g = Math.min(1, Math.max(0, pose[GROUND] ?? 0));
    if (g > 1e-3) {
      for (const b of legChain) b.updateMatrix();
      const mask = Math.round(pose[GMASK] ?? 0);
      const yl = mask > 0 ? Infinity : footMin(-1);
      const yr = mask < 0 ? Infinity : footMin(1);
      const minY = Math.min(yl, yr);
      hips.position.y += g * (-minY + (pose[LIFT] ?? 0));
    }
    // roll: centre the tucked ball on the spin pivot so it rolls round its own middle
    const rk = Math.min(1, Math.max(0, pose[ROLLK] ?? 0));
    tuckK = rk;
    if (rk > 1e-3) {
      for (const b of rollChain) b.updateMatrix();
      ballCentre(_c0);
      hips.position.x += (0 - _c0.x) * rk;
      hips.position.y += (P.rollPivot - _c0.y) * rk;
      hips.position.z += (0 - _c0.z) * rk;
    }
    spin.rotation.x = pose[SPIN] ?? 0;
    spin.scale.setScalar(1 + (look.rollScale - 1) * Math.min(1, Math.max(0, pose[ROLLK] ?? 0)));
    // face
    for (let k = 0; k < FACE_CHANNELS; k++) {
      const v = pose[FACE + k] ?? 0;
      morph[k] = k === FX.lookX || k === FX.lookY ? Math.max(-1.1, Math.min(1.1, v)) : Math.max(0, Math.min(1.15, v));
    }
    // springs (secondary motion) need world matrices
    if (springs.length && dt > 1e-5) {
      root.updateMatrixWorld(true);
      // running into still air: a head wind presses cloth back against the body
      root.matrixWorld.decompose(_p, _q, _s);
      wind.set(0, 0, 1).applyQuaternion(_q).multiplyScalar(Math.min(12, curSpeed * 0.55));
      for (const s of springs) step(s, dt);
    }
  }

  function step(s: Spring, dt: number): void {
    const parent = s.bone.parent;
    if (!parent) return;
    _w.copy(s.bone.position).applyMatrix4(parent.matrixWorld);
    if (!s.init) {
      s.prev.copy(_w);
      s.vel.set(0, 0, 0);
      s.acc.set(0, 0, 0);
      s.init = true;
    }
    _v.subVectors(_w, s.prev).divideScalar(dt);
    _a.subVectors(_v, s.vel).divideScalar(dt);
    s.vel.copy(_v);
    s.prev.copy(_w);
    // low-passed body acceleration: cloth lags behind lunges, but stride bounce must not fling it
    s.acc.lerp(_a, Math.min(1, dt * 6));
    if (s.acc.length() > 14) s.acc.setLength(14);
    _g.set(0, -9.81, 0).addScaledVector(s.acc, -0.35).add(wind);
    parent.matrixWorld.decompose(_p, _q, _s);
    _q.invert();
    _g.applyQuaternion(_q).normalize();
    const d = s.def;
    let minX = d.minX;
    if (d.push) {
      const fwd = Math.max(pose[B.thighL * 3] ?? 0, pose[B.thighR * 3] ?? 0);
      minX = Math.max(minX, fwd * 0.8 - 0.32);
    }
    // while tucked in a roll, cloth and plumes are held tight to the ball
    const flex = d.flex * (1 - tuckK);
    const free = Math.max(minX, Math.min(d.maxX, Math.atan2(-_g.z, -_g.y) * flex));
    const tx = free * (1 - tuckK) + (d.tuck ?? 0) * tuckK;
    const tz = Math.max(-d.maxZ, Math.min(d.maxZ, Math.atan2(_g.x, -_g.y) * flex));
    if (tuckK > 0.2) {
      s.ax += (tx - s.ax) * tuckK * 0.5;
      s.az *= 1 - tuckK * 0.5;
      s.vx *= 0.5;
      s.vz *= 0.5;
    }
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      s.vx += (d.stiff * (tx - s.ax) - d.damp * s.vx) * h;
      s.vz += (d.stiff * (tz - s.az) - d.damp * s.vz) * h;
      s.ax += s.vx * h;
      s.az += s.vz * h;
    }
    if (s.ax < minX * (1 - tuckK) && tuckK < 0.05) {
      s.ax = minX * (1 - tuckK);
      s.vx = Math.max(0, s.vx);
    }
    s.ax = Math.min(Math.max(d.maxX, d.tuck ?? 0) + 0.2, s.ax);
    s.az = Math.max(-d.maxZ - 0.2, Math.min(d.maxZ + 0.2, s.az));
    s.bone.rotation.set(s.ax, 0, s.az);
    s.bone.updateMatrixWorld(true);
  }

  function updateStork(dt: number): void {
    if (!stork || storkState === "off") return;
    storkT += dt;
    const r = stork.root;
    if (storkState === "arrive") {
      // swoops in from above and behind, braking hard to grab the shoulders
      const k = smooth(0, 0.65, storkT);
      const e = 1 - (1 - k) ** 3;
      beat += dt * 1.6;
      r.position.set(0, GRIP.y + 4.5 * (1 - e), GRIP.z + 4 * (1 - e) * (1 - e));
      stork.flare(1 - k * 0.5, beat);
      r.rotation.set(-0.25 * (1 - k), 0, 0);
      if (storkT >= 0.65) storkState = "carry";
    } else if (storkState === "carry") {
      beat += dt * 1.25;
      stork.fly(beat, 1, 1, 0.48);
      r.position.set(0, GRIP.y + 0.04 * Math.sin(beat * Math.PI * 2 + 1.4), GRIP.z);
      r.rotation.set(0, 0, 0);
    } else {
      // lets go, a couple of hard beats and climbs away ahead
      const k = storkT / 1.4;
      beat += dt * 1.9;
      stork.fly(beat, 1, Math.max(0, 1 - storkT / 0.35), 0.48 - 0.4 * Math.min(1, k * 2));
      r.position.set(0, GRIP.y + 6 * k * k + 0.6 * k, GRIP.z - 11 * k * k);
      r.rotation.set(-0.3 * Math.min(1, k * 2), 0, 0);
      if (storkT >= 1.4) {
        storkState = "off";
        r.visible = false;
      }
    }
  }

  const actor: Actor = {
    root,
    update(dt, anim: ActorAnim, speed) {
      const stepT = Math.min(Math.max(dt, 0), 0.1);
      time += stepT;
      const freq = waiter ? Math.min(2.6, 1.35 + 0.07 * speed) : Math.min(3.2, 1.5 + 0.072 * Math.max(0, speed));
      phase += stepT * Math.PI * 2 * freq;
      const want: Clip = carried ? "carried" : riding && (anim === "run" || anim === "idle") ? "ride" : anim;
      if (want !== clip || first) {
        if (!first) {
          from.set(pose);
          // finish a roll forwards rather than unwinding it
          const sp = from[SPIN] ?? 0;
          if (sp < -Math.PI) from[SPIN] = sp + Math.PI * 2;
          fade = 0;
          fadeDur = fadeTime(clip, want);
          if ((clip === "jump" || clip === "fall") && GROUNDED.has(want)) {
            landT = 0;
            landK = clip === "fall" ? 1 : 0.75;
          }
          fromJump = clip === "jump";
          if (want === "jump") lead = lead > 0 ? -1 : 1;
          if (want === "stumble") lead = Math.sin(phase) > 0 ? 1 : -1;
        }
        clip = want;
        clipT = 0;
      }
      clipT += stepT;
      fade += stepT;
      landT += stepT;
      ctx.t = clipT;
      ctx.time = time;
      ctx.phase = phase;
      ctx.speed = speed;
      curSpeed = clip === "run" || clip === "ride" || clip === "stumble" || clip === "roll" || clip === "jump" || clip === "fall" ? speed : 0;
      ctx.lead = lead;
      ctx.fromJump = fromJump;
      evalClip(clip, ctx, tgt);
      if (landT < 0.5 && GROUNDED.has(clip)) addLanding(tgt, landT, landK);
      // mood, blinks and small eye darts
      for (let k = 0; k < FACE_CHANNELS; k++) tgt[FACE + k] = (tgt[FACE + k] ?? 0) + (mood[k] ?? 0);
      blinkT -= stepT;
      if (blinkT <= 0) {
        blink = 0.16;
        blinkT = 1.8 + Math.random() * 3.2;
      }
      blink = Math.max(0, blink - stepT);
      const bk = blink > 0 ? Math.sin((blink / 0.16) * Math.PI) : 0;
      sacT -= stepT;
      if (sacT <= 0) {
        sac.tx = (Math.random() - 0.5) * 0.3;
        sac.ty = (Math.random() - 0.5) * 0.18;
        sacT = 0.6 + Math.random() * 1.8;
      }
      const sk2 = 1 - Math.exp(-stepT * 30);
      sac.x += (sac.tx - sac.x) * sk2;
      sac.y += (sac.ty - sac.y) * sk2;
      tgt[FACE + FX.blink] = Math.max(tgt[FACE + FX.blink] ?? 0, bk);
      tgt[FACE + FX.lookX] = (tgt[FACE + FX.lookX] ?? 0) + sac.x;
      tgt[FACE + FX.lookY] = (tgt[FACE + FX.lookY] ?? 0) + sac.y;
      if (first) {
        pose.set(tgt);
        first = false;
      } else {
        const w = smooth(0, 1, fade / fadeDur);
        for (let i = 0; i < NCH; i++) pose[i] = (from[i] ?? 0) + ((tgt[i] ?? 0) - (from[i] ?? 0)) * w;
        // never let the blink lag behind the fade
        pose[FACE + FX.blink] = Math.max(pose[FACE + FX.blink] ?? 0, bk);
      }
      if (fade >= fadeDur && Math.abs(pose[SPIN] ?? 0) > Math.PI * 2 - 1e-3) pose[SPIN] = 0;
      bodyGroup.position.y = riding && !carried ? DECK : 0;
      apply(stepT);
      updateStork(stepT);
    },
  };
  if (scooter) {
    const sc = scooter;
    actor.setRiding = (on: boolean) => {
      riding = on;
      sc.visible = on;
    };
  }
  if (stork) {
    const st = stork;
    actor.setCarried = (on: boolean) => {
      if (on === carried) return;
      carried = on;
      if (on) {
        storkState = "arrive";
        storkT = 0;
        st.root.visible = true;
      } else if (st.root.visible) {
        storkState = "leave";
        storkT = 0;
      }
    };
  }
  actorDebug.set(actor, {
    reset(t0: number, ph: number) {
      time = t0;
      phase = ph;
      blinkT = 1e9;
      sacT = 1e9;
      sac.x = sac.y = sac.tx = sac.ty = 0;
      first = true;
      for (const s of springs) s.init = false;
    },
    triangles: () => (look.geometry.index?.count ?? 0) / 3 + (faceFor(look).index?.count ?? 0) / 3,
  });
  return actor;
}

export const createRunner = (outfit: OutfitId = "clasico"): Actor => createActor("runner", outfit);
export const createWaiter = (): Actor => createActor("waiter");
