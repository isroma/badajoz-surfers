/**
 * Per-chunk geometry bag: one accumulator per material (+ a Builder for prop templates), turned
 * into one mesh per material when the chunk is finished. Also a track-space helper.
 */
import * as THREE from "three";
import { Acc } from "./acc";
import { Builder } from "../geom";
import { newFrame, type Track, type TrackFrame } from "./track";

export class Bag {
  private readonly accs = new Map<THREE.Material, Acc>();
  readonly props = new Builder();
  acc(mat: THREE.Material, extras?: Record<string, number>): Acc {
    let a = this.accs.get(mat);
    if (!a) this.accs.set(mat, (a = new Acc(extras)));
    return a;
  }
  get triangles(): number {
    let n = this.props.triangleCount;
    for (const a of this.accs.values()) n += a.vertexCount / 3;
    return n;
  }
  build(target: THREE.Group): THREE.Group {
    for (const [mat, a] of this.accs) {
      const m = a.mesh(mat);
      if (m) target.add(m);
    }
    this.props.build(false, target);
    for (const c of target.children) c.matrixAutoUpdate = false;
    return target;
  }
}

/** Track-space position helper with a frame cache keyed by s (cm). */
export class TS {
  private readonly cache = new Map<number, TrackFrame>();
  constructor(readonly track: Track) {}
  f(s: number): TrackFrame {
    const k = Math.round(s * 100);
    let fr = this.cache.get(k);
    if (!fr) {
      fr = this.track.frameAt(s, newFrame());
      this.cache.set(k, fr);
    }
    return fr;
  }
  p(s: number, lat: number, y = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.f(s);
    return out.set(f.x + f.nx * lat, f.h + y, f.z + f.nz * lat);
  }
}

/** Samples from a to b every `step` metres (always including both ends). */
export function samples(a: number, b: number, step = 2): number[] {
  const out: number[] = [];
  const n = Math.max(1, Math.ceil((b - a) / step - 1e-6));
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}
