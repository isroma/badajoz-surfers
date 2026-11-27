/**
 * Dev gallery for the procedural art (gallery.html). URL params:
 *   ?view=obstacles                         every obstacle kind x a few seeds, with collision boxes
 *   ?view=actors&anim=run                   runner + waiter animating (keys 1-8 switch the anim, R toggles the scooter)
 *   ?view=pickups                           all pickups
 *   ?view=zone&zone=<id>&from=<i>&n=<count> consecutive segments, chase-cam view; &fly=1 flies forward
 * Extra: &cam=x,y,z,tx,ty,tz overrides the camera; &t=<sec> pre-advances animations.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { art } from "./art";
import {
  OBSTACLE_DEFS,
  SEGMENT_LENGTH,
  ZONES,
  WORD,
  type ActorAnim,
  type Atmosphere,
  type ObstacleKind,
  type PickupKind,
  type ZoneId,
  OUTFITS,
  type OutfitId,
} from "./contracts";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "obstacles";

const canvas = document.getElementById("gallery");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("missing #gallery canvas");
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "#000";

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const hemi = new THREE.AmbientLight(0xffffff, 1.1);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -40;
sc.right = 40;
sc.top = 40;
sc.bottom = -40;
sc.near = 1;
sc.far = 300;
scene.add(hemi, sun, sun.target);

const label = document.createElement("div");
label.style.cssText = "position:fixed;left:8px;top:8px;color:#fff;font:12px monospace;background:rgba(0,0,0,.55);padding:6px 8px;white-space:pre;pointer-events:none";
document.body.appendChild(label);

const updaters: ((dt: number, t: number) => void)[] = [];

function applyAtmosphere(a: Atmosphere): void {
  scene.fog = new THREE.Fog(a.fogColor, a.fogNear, a.fogFar);
  sun.color.set(a.sunColor);
  sun.intensity = a.sunIntensity;
  const d = new THREE.Vector3(...a.sunPosition).normalize();
  sun.userData["dir"] = d;
  hemi.color.set(a.ambientColor);
  hemi.intensity = a.ambientIntensity;
}

function setSunAround(target: THREE.Vector3): void {
  const d = (sun.userData["dir"] as THREE.Vector3 | undefined) ?? new THREE.Vector3(0.5, 1, 0.4).normalize();
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(d, 120);
}

function textSprite(text: string, color = "#fff"): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.font = "bold 34px monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(4, 0.5, 1);
  return s;
}

function countStats(o: THREE.Object3D): { draws: number; tris: number } {
  let draws = 0;
  let tris = 0;
  o.traverse((c) => {
    if (c instanceof THREE.Mesh && c.visible) {
      draws++;
      const g = c.geometry;
      tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    }
  });
  return { draws, tris: Math.round(tris) };
}

function groundPlane(size: number, color: number): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  return g;
}

function showObstacles(): void {
  scene.background = new THREE.Color(0x9cc9f5);
  scene.add(groundPlane(400, 0x8a8f96));
  const kinds = Object.keys(OBSTACLE_DEFS) as ObstacleKind[];
  const seeds = (params.get("seeds") ?? "0,1,2,3,4,5").split(",").map(Number);
  const only = params.get("kind");
  const list = only ? kinds.filter((k) => k === only) : kinds;
  const lines: string[] = [];
  let z = 0;
  for (const kind of list) {
    const def = OBSTACLE_DEFS[kind];
    let x = 0;
    let maxDraw = 0;
    let maxTri = 0;
    const variants: { seed: number; moving: boolean }[] = seeds.map((s) => ({ seed: s, moving: false }));
    if (def.vehicle) variants.push({ seed: 1, moving: true }, { seed: 5, moving: true });
    for (const v of variants) {
      const o = art.createObstacle(kind, v.seed, v.moving);
      o.position.set(x, 0, z);
      scene.add(o);
      const st = countStats(o);
      maxDraw = Math.max(maxDraw, st.draws);
      maxTri = Math.max(maxTri, st.tris);
      const box = new THREE.Box3Helper(
        new THREE.Box3(new THREE.Vector3(x - def.width / 2, def.yMin, z - def.length / 2), new THREE.Vector3(x + def.width / 2, def.yMax, z + def.length / 2)),
        v.moving ? 0xff3300 : 0xffff00,
      );
      scene.add(box);
      x += Math.max(def.width, 2) + 1.6;
    }
    const lab = textSprite(`${kind}  draws<=${maxDraw} tris<=${maxTri}`);
    lab.position.set(-4, 3.5, z);
    scene.add(lab);
    lines.push(`${kind.padEnd(13)} draws ${maxDraw}  tris ${maxTri}`);
    z -= Math.max(def.length, 1.5) + 3;
  }
  label.textContent = lines.join("\n");
  const cam = params.get("cam");
  const onlyDef = only ? OBSTACLE_DEFS[only as ObstacleKind] : undefined;
  if (!cam && onlyDef) {
    const n = seeds.length + (onlyDef.vehicle ? 2 : 0);
    const span = n * (Math.max(onlyDef.width, 2) + 1.6);
    const mid = span / 2 - (Math.max(onlyDef.width, 2) + 1.6) / 2;
    const side = Number(params.get("side") ?? "0");
    camera.position.set(mid + side * span * 0.6, onlyDef.yMax + 2.5 + span * 0.12, onlyDef.length / 2 + span * 0.55);
    controls.target.set(mid, onlyDef.yMax * 0.45, 0);
  } else if (!cam) {
    camera.position.set(20, 22, 14);
    controls.target.set(10, 0, z / 2);
  }
  setSunAround(new THREE.Vector3(10, 0, z / 2));
  sc.left = -60;
  sc.right = 60;
  sc.top = 60;
  sc.bottom = -60;
}

const ANIMS: ActorAnim[] = ["idle", "run", "jump", "fall", "roll", "stumble", "caught", "celebrate"];

function showActors(): void {
  scene.background = new THREE.Color(0x9cc9f5);
  scene.add(groundPlane(60, 0x8a8f96));
  let anim = (params.get("anim") ?? "run") as ActorAnim;
  let riding = params.get("ride") === "1";
  const outfit = (params.get("outfit") ?? "clasico") as OutfitId;
  const runner = art.createRunner(outfit);
  const waiter = art.createWaiter();
  runner.root.position.set(-3, 0, 0);
  waiter.root.position.set(-1, 0, 0);
  const runner2 = art.createRunner(outfit);
  const waiter2 = art.createWaiter();
  runner2.root.position.set(1, 0, 0);
  runner2.root.rotation.y = Math.PI;
  waiter2.root.position.set(3, 0, 0);
  waiter2.root.rotation.y = Math.PI;
  scene.add(runner.root, waiter.root, runner2.root, waiter2.root);
  runner.setRiding?.(riding);
  runner2.setRiding?.(riding);
  const carry = params.get("carry") === "1";
  runner.setCarried?.(carry);
  runner2.setCarried?.(carry);
  // reference heights
  for (const h of [0.8, 1.8]) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4.5, h, -0.6), new THREE.Vector3(4.5, h, -0.6)]),
      new THREE.LineBasicMaterial({ color: h < 1 ? 0xff0000 : 0x00ff00 }),
    );
    scene.add(line);
  }
  const speed = Number(params.get("speed") ?? "14");
  const box = new THREE.Box3();
  let maxH = 0;
  updaters.push((dt) => {
    for (const a of [runner, waiter, runner2, waiter2]) a.update(dt, anim, speed);
    box.makeEmpty();
    runner.root.updateMatrixWorld(true);
    runner.root.traverseVisible((o) => {
      if (o instanceof THREE.Mesh) box.expandByObject(o, true);
    });
    maxH = Math.max(maxH * 0.995, box.max.y);
    label.textContent = `anim: ${anim} (keys 1-8, R = ride)\nrunner height now ${box.max.y.toFixed(2)} m (peak ${maxH.toFixed(2)})\n${ANIMS.map((a, i) => `${i + 1}:${a}`).join(" ")}`;
  });
  window.addEventListener("keydown", (e) => {
    const i = Number(e.key) - 1;
    const next = ANIMS[i];
    if (next) {
      anim = next;
      maxH = 0;
    }
    if (e.key === "r") {
      riding = !riding;
      runner.setRiding?.(riding);
      runner2.setRiding?.(riding);
    }
  });
  if (!params.get("cam")) {
    camera.position.set(0, 1.3, 4.6);
    controls.target.set(0, 0.85, 0);
  }
  setSunAround(new THREE.Vector3(0, 0, 0));
}

function showPickups(): void {
  scene.background = new THREE.Color(0x9cc9f5);
  scene.add(groundPlane(60, 0x8a8f96));
  const kinds: PickupKind[] = ["bellota", "iman", "zapatillas", "jamon", "patinete", "ciguena", "letra"];
  let x = -kinds.length;
  for (const k of kinds) {
    const p = art.createPickup(k, "B");
    p.root.position.set(x, 1, 0);
    scene.add(p.root);
    updaters.push((dt, t) => p.update(dt, t));
    x += 2;
  }
  // a row of acorns going into the distance and the letters of the word
  for (let i = 0; i < 12; i++) {
    const p = art.createPickup("bellota");
    p.root.position.set(0, 1, -4 - i * 3);
    scene.add(p.root);
    updaters.push((dt, t) => p.update(dt, t));
  }
  [...WORD].forEach((ch, i) => {
    const p = art.createPickup("letra", ch);
    p.root.position.set(-6 + i * 2, 2.6, 0);
    scene.add(p.root);
    updaters.push((dt, t) => p.update(dt, t));
  });
  if (!params.get("cam")) {
    camera.position.set(0, 2.2, 7);
    controls.target.set(0, 1.2, 0);
  }
  setSunAround(new THREE.Vector3(0, 0, 0));
}

function showZone(): void {
  const zone = (params.get("zone") ?? "puente-real") as ZoneId;
  const def = ZONES.find((z) => z.id === zone) ?? ZONES[0];
  if (!def) return;
  const count = def.length / SEGMENT_LENGTH;
  const from = Number(params.get("from") ?? "0");
  const n = Number(params.get("n") ?? "8");
  const lap = Number(params.get("lap") ?? "1");
  const scenery = art.createZoneScenery(zone);
  const atm = scenery.atmosphereFor(Number(params.get("lap") ?? "1"));
  applyAtmosphere(atm);
  const sky = art.createSkyDome();
  sky.setColors(new THREE.Color(atm.skyTop), new THREE.Color(atm.skyBottom));
  scene.add(sky.mesh);
  const lines: string[] = [`${zone} segments ${from}..${from + n - 1} of ${count}`];
  const chain: { id: ZoneId; from: number; n: number }[] = [{ id: zone, from, n }];
  const zone2 = params.get("zone2") as ZoneId | null;
  if (zone2) chain.push({ id: zone2, from: Number(params.get("from2") ?? "0"), n: Number(params.get("n2") ?? "4") });
  let slot = 0;
  for (const c of chain) {
    const zd = ZONES.find((z) => z.id === c.id);
    if (!zd) continue;
    const cnt = zd.length / SEGMENT_LENGTH;
    const sc = c.id === zone ? scenery : art.createZoneScenery(c.id);
    for (let i = 0; i < c.n; i++) {
      const raw = c.from + i;
      const idx = raw < 0 ? raw : raw % cnt;
      const t0 = performance.now();
      const seg = sc.buildSegment(idx, cnt, lap);
      const ms = performance.now() - t0;
      seg.position.z = -slot * SEGMENT_LENGTH;
      slot++;
      scene.add(seg);
      const st = countStats(seg);
      lines.push(`${c.id} ${idx}: draws ${st.draws} tris ${st.tris} build ${ms.toFixed(1)}ms`);
    }
  }
  const runner = params.get("runner") !== "0" ? art.createRunner() : null;
  if (runner) {
    runner.root.position.set(0, 0, -6.5);
    scene.add(runner.root);
  }
  const obst = params.get("obst");
  if (obst) {
    const kinds = obst.split(",") as ObstacleKind[];
    kinds.forEach((k, i) => {
      const o = art.createObstacle(k, i, false);
      o.position.set(((i % 3) - 1) * 2.6, 0, -25 - i * 12);
      scene.add(o);
    });
  }
  if (params.get("pickups") === "1") {
    for (let k = 0; k < 14; k++) {
      const p = art.createPickup("bellota");
      p.root.position.set(2.6, 1.0, -12 - k * 2.5);
      scene.add(p.root);
      updaters.push((dt, t) => p.update(dt, t));
    }
    (["iman", "zapatillas", "jamon", "patinete"] as const).forEach((k, i) => {
      const p = art.createPickup(k);
      p.root.position.set(-2.6, 1.2, -16 - i * 8);
      scene.add(p.root);
      updaters.push((dt, t) => p.update(dt, t));
    });
    const letter = art.createPickup("letra", "J");
    letter.root.position.set(0, 1.3, -40);
    scene.add(letter.root);
    updaters.push((dt, t) => letter.update(dt, t));
  }
  if (runner && params.get("ride") === "1") runner.setRiding?.(true);
  label.textContent = lines.join("\n");
  const fly = params.get("fly") === "1";
  const camOverride = params.get("cam");
  if (!camOverride) {
    camera.position.set(0, 3.2, 0);
    controls.target.set(0, 1.6, -12);
  }
  camera.fov = 62;
  camera.updateProjectionMatrix();
  const total = slot * SEGMENT_LENGTH;
  updaters.push((dt) => {
    if (runner) runner.update(dt, "run", 15);
    if (fly) {
      camera.position.z -= dt * 15;
      if (camera.position.z < -total + 200) camera.position.z = 0;
      controls.target.set(camera.position.x, 1.6, camera.position.z - 12);
      camera.lookAt(controls.target);
      if (runner) runner.root.position.z = camera.position.z - 6.5;
    }
    sky.mesh.position.copy(camera.position);
    setSunAround(new THREE.Vector3(0, 0, camera.position.z - 20));
  });
  sc.left = -50;
  sc.right = 50;
  sc.top = 60;
  sc.bottom = -60;
  sc.far = 400;
}

/** Scan every segment of every zone for triangles intruding into the runnable volume. */
function showCheck(): void {
  const lines: string[] = ["road intrusion check (laps 1 and 2): |x| < 4.2, 0.1 < y < 4"];
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const z of ZONES) {
    const scenery = art.createZoneScenery(z.id);
    const count = z.length / SEGMENT_LENGTH;
    for (let n = 0; n < (count + 4) * 2; n++) {
      const lap = n < count + 4 ? 1 : 2;
      const i = (n % (count + 4)) - (z.id === "puente-real" ? 4 : 0);
      if (i >= count) continue;
      const seg = scenery.buildSegment(i, count, lap);
      let bad = 0;
      let example = "";
      seg.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        // additive light-pool decals are not solid
        if (o.material instanceof THREE.Material && o.material.blending === THREE.AdditiveBlending) return;
        const pos = (o.geometry as THREE.BufferGeometry).getAttribute("position");
        for (let t = 0; t < pos.count; t += 3) {
          a.fromBufferAttribute(pos, t);
          b.fromBufferAttribute(pos, t + 1);
          c.fromBufferAttribute(pos, t + 2);
          const minX = Math.min(a.x, b.x, c.x);
          const maxX = Math.max(a.x, b.x, c.x);
          const minY = Math.min(a.y, b.y, c.y);
          const maxY = Math.max(a.y, b.y, c.y);
          if (!(maxX > -4.19 && minX < 4.19 && maxY > 0.1 && minY < 4)) continue;
          // sample the triangle surface (long thin beams have huge bounding boxes)
          let hit = false;
          const N = 24;
          for (let u = 0; u <= N && !hit; u++) {
            for (let v = 0; u + v <= N && !hit; v++) {
              const wa = 1 - (u + v) / N;
              const px = a.x * wa + b.x * (u / N) + c.x * (v / N);
              const py = a.y * wa + b.y * (u / N) + c.y * (v / N);
              if (Math.abs(px) < 4.19 && py > 0.1 && py < 4) hit = true;
            }
          }
          if (hit) {
            bad++;
            if (!example) example = `x ${minX.toFixed(1)}..${maxX.toFixed(1)} y ${minY.toFixed(1)}..${maxY.toFixed(1)} z ${a.z.toFixed(1)}`;
          }
        }
      });
      art.release(seg);
      if (bad > 0) {
        total += bad;
        lines.push(`${z.id} #${i} lap ${lap}: ${bad} tris, e.g. ${example}`);
      }
    }
  }
  lines.push(total === 0 ? "OK: nothing intrudes" : `TOTAL ${total}`);
  lines.push("", "obstacle fit (actual bounds vs OBSTACLE_DEFS box, tolerance 3 cm):");
  const box = new THREE.Box3();
  for (const kind of Object.keys(OBSTACLE_DEFS) as ObstacleKind[]) {
    const d = OBSTACLE_DEFS[kind];
    let worst = "";
    for (let seed = 0; seed < 24; seed++) {
      for (const moving of d.vehicle ? [false, true] : [false]) {
        const o = art.createObstacle(kind, seed, moving);
        o.updateMatrixWorld(true);
        box.setFromObject(o, true);
        const over = [
          box.min.x + d.width / 2, d.width / 2 - box.max.x, box.min.z + d.length / 2, d.length / 2 - box.max.z, d.yMax - box.max.y,
        ].map((v) => Math.min(0, v));
        const m = Math.min(...over);
        if (m < -0.03 && !worst) worst = `seed ${seed}${moving ? " moving" : ""}: x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)} y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`;
      }
    }
    lines.push(`${kind.padEnd(13)} ${worst || "fits"}`);
  }
  label.textContent = lines.join("\n");
  label.style.fontSize = "16px";
}

/** Build, render and release many segments (plus obstacles/pickups/skies) and compare GPU memory. */
function showLeak(): void {
  camera.position.set(0, 3.2, 0);
  camera.lookAt(0, 1.6, -12);
  const zones = ZONES.map((z) => ({ id: z.id, count: z.length / SEGMENT_LENGTH, scenery: art.createZoneScenery(z.id) }));
  const kinds = Object.keys(OBSTACLE_DEFS) as ObstacleKind[];
  const show = (objs: THREE.Object3D[]): void => {
    for (const o of objs) scene.add(o);
    renderer.render(scene, camera);
    for (const o of objs) {
      scene.remove(o);
      art.release(o);
    }
  };
  /** Every segment of every zone (lead-in included) for laps 1-4. */
  const allSegments = (): number => {
    let n = 0;
    for (let lap = 1; lap <= 4; lap++) {
      for (const z of zones) {
        for (let i = z.id === "puente-real" ? -4 : 0; i < z.count; i++) {
          const seg = z.scenery.buildSegment(i, z.count, lap);
          seg.position.z = -20;
          const sky = art.createSkyDome();
          show([seg, sky.mesh]);
          n++;
        }
      }
    }
    return n;
  };
  const obstacles = (n: number, seedOf: (k: number) => number): void => {
    for (let k = 0; k < n; k += 20) {
      const batch: THREE.Object3D[] = [];
      for (let j = 0; j < 20; j++) {
        const kind = kinds[(k + j) % kinds.length] ?? "valla";
        const o = art.createObstacle(kind, seedOf(k + j), (k + j) % 3 === 0);
        o.position.set(((j % 5) - 2) * 3, 0, -10 - Math.floor(j / 5) * 6);
        batch.push(o);
        const pk: PickupKind[] = ["bellota", "letra", "ciguena", "iman"];
        const p = art.createPickup(pk[j % 4] ?? "bellota", "BADAJOZ"[j % 7]);
        p.root.position.set(0, 1, -8);
        batch.push(p.root);
      }
      show(batch);
    }
  };
  // warm every shared cache: all variants of all kinds, all segments of laps 1-4
  obstacles(kinds.length * 60, (k) => Math.floor(k / kinds.length));
  const segs = allSegments();
  renderer.render(scene, camera);
  const before = { ...renderer.info.memory };
  // churn: 2,000 obstacles with random 32-bit seeds, then every segment of laps 1-4 again
  obstacles(2000, () => Math.floor(Math.random() * 4294967296));
  allSegments();
  renderer.render(scene, camera);
  const after = { ...renderer.info.memory };
  const ok = after.geometries === before.geometries && after.textures === before.textures;
  label.textContent = [
    `leak test: 2,000 obstacles (random 32-bit seeds) + pickups, ${segs} segments x laps 1-4 + skies`,
    `after warm-up  geometries ${before.geometries}  textures ${before.textures}`,
    `after churn    geometries ${after.geometries}  textures ${after.textures}`,
    ok ? "OK: plateau, nothing leaks" : "LEAK",
  ].join("\n");
  label.style.fontSize = "16px";
}

function showOutfits(): void {
  scene.background = new THREE.Color(0x9cc9f5);
  scene.add(groundPlane(60, 0x8a8f96));
  const anim = (params.get("anim") ?? "idle") as ActorAnim;
  const actors = OUTFITS.flatMap((o, i) => {
    const front = art.createRunner(o.id);
    const back = art.createRunner(o.id);
    const x = (i - (OUTFITS.length - 1) / 2) * 1.3;
    front.root.position.set(x, 0, 1.6);
    front.root.rotation.y = Math.PI;
    back.root.position.set(x, 0, -0.6);
    scene.add(front.root, back.root);
    const lab = textSprite(o.name);
    lab.position.set(x, 2.25, 1.6);
    lab.scale.set(2, 0.25, 1);
    scene.add(lab);
    return [front, back];
  });
  const box = new THREE.Box3();
  updaters.push((dt) => {
    let worst = 0;
    for (const a of actors) {
      a.update(dt, anim, 14);
      box.makeEmpty();
      a.root.updateMatrixWorld(true);
      a.root.traverseVisible((o) => {
        if (o instanceof THREE.Mesh) box.expandByObject(o, true);
      });
      worst = Math.max(worst, box.max.y);
    }
    label.textContent = `outfits, anim ${anim}: tallest now ${worst.toFixed(2)} m`;
  });
  if (!params.get("cam")) {
    camera.position.set(0, 1.6, 7.5);
    controls.target.set(0, 0.9, 0.5);
  }
  setSunAround(new THREE.Vector3(0, 0, 0));
}

switch (view) {
  case "outfits":
    showOutfits();
    break;
  case "leak":
    showLeak();
    break;
  case "check":
    showCheck();
    break;
  case "actors":
    showActors();
    break;
  case "pickups":
    showPickups();
    break;
  case "zone":
    showZone();
    break;
  default:
    showObstacles();
}

const camParam = params.get("cam");
if (camParam) {
  const v = camParam.split(",").map(Number);
  camera.position.set(v[0] ?? 0, v[1] ?? 3, v[2] ?? 10);
  controls.target.set(v[3] ?? 0, v[4] ?? 1, v[5] ?? 0);
}
controls.update();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Optional pre-advance so headless screenshots capture a mid-animation frame.
const preT = Number(params.get("t") ?? "0");
let time = 0;
for (let s = 0; s < preT; s += 1 / 30) {
  time += 1 / 30;
  for (const u of updaters) u(1 / 30, time);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  for (const u of updaters) u(dt, time);
  if (!params.get("fly")) controls.update();
  renderer.render(scene, camera);
  const info = renderer.info.render;
  label.dataset["calls"] = String(info.calls);
});
