/**
 * Gallery views for the real city (gallery.html):
 *   ?view=city&s=<m>&lap=<n>      chase camera at track position s, looking along the route
 *       &cam=chase|eye|aerial|map|back  &debug=1 lane lines  &fly=<m/s> run along the route
 *       &h=<m> camera height override  &look=<deg> turn the camera  &dist=<m> look distance
 *   ?view=citystats               build every chunk, render it from the chase cam: draw calls, triangles, build ms
 *   ?view=cityleak                tour the whole lap twice, compare renderer.info.memory to the baseline
 *   ?view=citycheck               nothing solid in the runnable surface (buildings below 4.6 m)
 */
import * as THREE from "three";
import { art } from "./art";
import { createCity, configureRenderer, type CityInternals } from "./art/city";
import { checkRunnableClear, CHUNK } from "./art/city/context";
import { createTrack, loadCity, type Track } from "./city";
import type { Atmosphere } from "./contracts";

interface Env {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  label: HTMLDivElement;
  params: URLSearchParams;
  updaters: ((dt: number, t: number) => void)[];
  controls: { target: THREE.Vector3; enabled: boolean; enableDamping: boolean; update(): void };
}

export async function showCityView(env: Env, view: string): Promise<void> {
  const { renderer, scene, camera, label, params } = env;
  label.id = "city-label";
  for (const c of [...scene.children]) if (c instanceof THREE.Light) c.visible = false;
  env.controls.enableDamping = false;
  camera.far = 2600;
  camera.fov = 62;
  camera.updateProjectionMatrix();
  configureRenderer(renderer, scene);
  const city = await loadCity("./data/city.json");
  const track = createTrack(city);
  const t0 = performance.now();
  const cs = createCity(city, track);
  const ctxMs = performance.now() - t0;
  scene.add(cs.root);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1);
  scene.add(sun, sun.target, hemi);
  const sky = art.createSkyDome();
  scene.add(sky.mesh);
  const fog = new THREE.Fog(0xffffff, 100, 900);
  scene.fog = fog;
  let sunDir = new THREE.Vector3(0.5, 1, 0.4).normalize();
  const apply = (a: Atmosphere): void => {
    fog.color.setHex(a.fogColor);
    fog.near = a.fogNear;
    fog.far = a.fogFar;
    scene.background = fog.color;
    sun.color.setHex(a.sunColor);
    sun.intensity = a.sunIntensity;
    sunDir = new THREE.Vector3(...a.sunPosition).normalize();
    hemi.color.setHex(a.ambientColor);
    hemi.groundColor.setHex(a.ambientColor).multiplyScalar(0.45);
    hemi.intensity = a.ambientIntensity;
    sky.setColors(new THREE.Color(a.skyTop), new THREE.Color(a.skyBottom));
  };
  const lap = Number(params.get("lap") ?? "1");

  if (view === "citycheck") {
    const bad = checkRunnableClear(cs.ctx);
    label.textContent = `runnable-surface check: ${bad.length} building(s) intrude\n` + bad.map((b) => `${b.id} s=${b.s.toFixed(1)} by ${b.intrusion.toFixed(2)} m`).join("\n");
    return;
  }

  const place = (s: number, mode: string): THREE.Vector3 => {
    const f = track.frameAt(s);
    const look = (Number(params.get("look") ?? "0") * Math.PI) / 180;
    const fx = f.tx * Math.cos(look) - f.nx * Math.sin(look) * -1;
    const fz = f.tz * Math.cos(look) - f.nz * Math.sin(look) * -1;
    const hOver = params.get("h");
    const lat = Number(params.get("lat") ?? "0");
    const px = f.x + f.nx * lat;
    const pz = f.z + f.nz * lat;
    const dist = Number(params.get("dist") ?? "0");
    if (mode === "map") {
      const H = Number(hOver ?? "380");
      camera.position.set(px, f.h + H, pz + 0.01);
      env.controls.target.set(px, f.h, pz);
      camera.up.set(0, 0, -1);
    } else if (mode === "aerial") {
      const H = Number(hOver ?? "45");
      camera.position.set(px - fx * 70, f.h + H, pz - fz * 70);
      env.controls.target.set(px + fx * (dist || 60), f.h, pz + fz * (dist || 60));
    } else if (mode === "eye") {
      const H = Number(hOver ?? "1.7");
      camera.position.set(px, f.h + H, pz);
      env.controls.target.set(px + fx * (dist || 30), f.h + H, pz + fz * (dist || 30));
    } else if (mode === "back") {
      const H = Number(hOver ?? "3");
      camera.position.set(px + fx * 6, f.h + H, pz + fz * 6);
      env.controls.target.set(px - fx * 30, f.h + 1.5, pz - fz * 30);
    } else {
      const H = Number(hOver ?? "3.4");
      camera.position.set(px - fx * 6.5, f.h + H, pz - fz * 6.5);
      env.controls.target.set(px + fx * (dist || 20), f.h + 1.3, pz + fz * (dist || 20));
    }
    camera.lookAt(env.controls.target);
    sky.mesh.position.copy(camera.position);
    const tgt = new THREE.Vector3(f.x, f.h, f.z);
    sun.target.position.copy(tgt);
    sun.position.copy(tgt).addScaledVector(sunDir, 200);
    sun.target.updateMatrixWorld();
    return tgt;
  };

  if (view === "citystats") return stats(env, cs, track, apply, place, ctxMs);
  if (view === "cityleak") return leak(env, cs, track, apply);

  let s = Number(params.get("s") ?? "300");
  const mode = params.get("cam") ?? "chase";
  apply(cs.atmosphereAt(s, lap));
  const pre = performance.now();
  cs.preload(s, lap);
  const preMs = performance.now() - pre;
  place(s, mode);
  const hide = (params.get("hide") ?? "").split(",").filter(Boolean);
  if (hide.length) cs.root.traverse((o) => {
    if (hide.some((h) => o.name.startsWith(h))) o.visible = false;
  });
  if (params.get("debug") === "1") scene.add(laneLines(track, s));
  const fly = Number(params.get("fly") ?? "0");
  let frames = 0;
  let acc = 0;
  let fps = 0;
  env.updaters.push((dt) => {
    if (fly > 0) {
      s = (s + fly * dt) % track.lapLength;
      apply(cs.atmosphereAt(s, lap));
    }
    if (fly > 0 || frames < 3) place(s, mode);
    cs.update(s, lap, camera);
    frames++;
    acc += dt;
    if (acc > 0.5) {
      fps = frames / acc;
      frames = 0;
      acc = 0;
    }
    const info = renderer.info.render;
    const z = track.zoneAt(s);
    let extra = "";
    if (params.get("breakdown") === "1") {
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const sums = new Map<string, number>();
      cs.root.traverseVisible((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const geo = o.geometry as THREE.BufferGeometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const sph = geo.boundingSphere!.clone().applyMatrix4(o.matrixWorld);
        if (!fr.intersectsSphere(sph)) return;
        const n = (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
        const key = (o.parent?.name.startsWith("chunk") ? "chunk:" : (o.parent?.name ?? "") + ":") + (o.name || (o.material as THREE.Material).type);
        sums.set(key, (sums.get(key) ?? 0) + n);
      });
      extra = "\n" + [...sums].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}k`).join("\n");
    }
    label.textContent = `s=${s.toFixed(0)} ${z.id} · ${track.streetNameAt(s) ?? ""}\ncalls ${info.calls} tris ${(info.triangles / 1000).toFixed(0)}k fps ${fps.toFixed(0)}\nctx ${ctxMs.toFixed(0)} ms preload ${preMs.toFixed(0)} ms chunks ${cs.stats.built}` + extra;
  });
}

function laneLines(track: Track, s: number): THREE.LineSegments {
  const pos: number[] = [];
  const col: number[] = [];
  const f = track.frameAt(0);
  for (let t = s - 40; t < s + 200; t += 1) {
    const lay = track.layoutAt(t);
    const lay2 = track.layoutAt(t + 1);
    const f2 = track.frameAt(t + 1);
    track.frameAt(t, f);
    const lines: [number, number, number][] = [];
    lay.offsets.forEach((o, i) => lines.push([o, lay2.offsets[i] ?? o, lay.flow[i] === 1 ? 0x00ff00 : lay.flow[i] === -1 ? 0xff3333 : 0xffff00]));
    lines.push([lay.left, lay2.left, 0xffffff], [lay.right, lay2.right, 0xffffff]);
    for (const [a, b, c] of lines) {
      pos.push(f.x + f.nx * a, f.h + 0.1, f.z + f.nz * a, f2.x + f2.nx * b, f2.h + 0.1, f2.z + f2.nz * b);
      const cc = new THREE.Color(c);
      col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, fog: false }));
}

function stats(env: Env, cs: CityInternals, track: Track, apply: (a: Atmosphere) => void, place: (s: number, m: string) => THREE.Vector3, ctxMs: number): void {
  const { renderer, scene, camera, label } = env;
  const rows: string[] = [];
  let worstCalls = 0, worstTris = 0, worstMs = 0, sumCalls = 0, sumTris = 0, sumMs = 0, n = 0;
  const step = Number(env.params.get("step") ?? String(CHUNK));
  const permStart = performance.now();
  cs.preload(0, 1);
  const permMs = performance.now() - permStart;
  for (let s = 0; s < track.lapLength; s += step) {
    apply(cs.atmosphereAt(s, 1));
    cs.preload(s, 1);
    cs.update(s, 1, camera);
    place(s, "chase");
    const ms = cs.stats.buildMs.get(Math.floor(s / CHUNK)) ?? 0;
    renderer.info.reset();
    renderer.render(scene, camera);
    const calls = renderer.info.render.calls;
    const tris = renderer.info.render.triangles;
    worstCalls = Math.max(worstCalls, calls);
    worstTris = Math.max(worstTris, tris);
    worstMs = Math.max(worstMs, ms);
    sumCalls += calls; sumTris += tris; sumMs += ms; n++;
    rows.push(`${String(s).padStart(5)} ${track.zoneAt(s).id.padEnd(16)} calls ${String(calls).padStart(4)} tris ${String(Math.round(tris / 1000)).padStart(4)}k build ${ms.toFixed(1).padStart(6)} ms`);
  }
  label.style.fontSize = "10px";
  label.textContent = `context ${ctxMs.toFixed(0)} ms, permanent ${permMs.toFixed(0)} ms\nWORST calls ${worstCalls} tris ${(worstTris / 1000).toFixed(0)}k build ${worstMs.toFixed(1)} ms · AVG calls ${(sumCalls / n).toFixed(0)} tris ${(sumTris / n / 1000).toFixed(0)}k build ${(sumMs / n).toFixed(1)} ms\n` + rows.join("\n");
  (globalThis as { __cityStats?: string }).__cityStats = label.textContent;
}

function leak(env: Env, cs: CityInternals, track: Track, apply: (a: Atmosphere) => void): void {
  const { renderer, scene, camera, label } = env;
  apply(cs.atmosphereAt(0, 1));
  cs.preload(0, 1);
  renderer.render(scene, camera);
  const base = { ...renderer.info.memory };
  const peak = { geometries: 0, textures: 0 };
  for (let lapN = 1; lapN <= 2; lapN++) {
    for (let s = 0; s < track.lapLength; s += 25) {
      cs.preload(s, lapN);
      cs.update(s, lapN, camera);
      renderer.render(scene, camera);
      peak.geometries = Math.max(peak.geometries, renderer.info.memory.geometries);
      peak.textures = Math.max(peak.textures, renderer.info.memory.textures);
    }
  }
  // back to the start: everything else must be gone
  cs.trim(0);
  cs.preload(0, 1);
  renderer.render(scene, camera);
  const end = renderer.info.memory;
  const ok = end.geometries <= base.geometries;
  label.textContent = `leak test (2 laps)\nbaseline geometries ${base.geometries} textures ${base.textures}\npeak geometries ${peak.geometries} textures ${peak.textures}\nend geometries ${end.geometries} textures ${end.textures}\n${ok ? "OK: back to baseline" : "LEAK"}`;
}
