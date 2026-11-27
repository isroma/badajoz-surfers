/**
 * Track space → world. All gameplay lives in track space: distance s along the lap (unbounded:
 * later laps keep counting), lateral metres (+ to the runner's right) and height y above the road
 * surface. The renderer maps through the city track model; models face along the track (the
 * runner and everything it meets keep the old convention: running direction = the model's -Z,
 * the side an obstacle shows the runner = its +Z).
 *
 * Without a track (unit tests, the old stand-in course) the mapping is the old straight road:
 * x = lateral, y = y, z = -s.
 */
import * as THREE from "three";
import { createFrame, type Track, type TrackFrame } from "../city/track";

export class TrackSpace {
  private readonly f: TrackFrame = createFrame();

  constructor(readonly track: Track | null) {}

  get lapLength(): number {
    return this.track?.lapLength ?? Infinity;
  }

  /** Frame at s (wraps the lap; heading stays continuous). */
  frame(s: number): TrackFrame {
    const f = this.f;
    if (this.track) return this.track.frameAt(s, f);
    f.s = s;
    f.x = 0;
    f.z = -s;
    f.h = 0;
    f.tx = 0;
    f.tz = -1;
    f.nx = 1;
    f.nz = 0;
    f.heading = Math.PI;
    f.pitch = 0;
    f.curvature = 0;
    return f;
  }

  /** World point of (s, lateral, y). */
  point(s: number, lateral: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    const f = this.frame(s);
    return out.set(f.x + f.nx * lateral, f.h + y, f.z + f.nz * lateral);
  }

  /**
   * Put an object at (s, lateral, y), turned to run along the track (its -Z forward), pitched
   * with the slope. `yaw` turns it further (π: face the other way); `pitch` scales the slope tilt
   * (long vehicles: 1; people stay upright: 0).
   */
  place(obj: THREE.Object3D, s: number, lateral: number, y: number, yaw = 0, pitch = 1): void {
    const f = this.frame(s);
    obj.position.set(f.x + f.nx * lateral, f.h + y, f.z + f.nz * lateral);
    obj.rotation.set(f.pitch * pitch, f.heading + Math.PI + yaw, 0, "YXZ");
  }

  /** World direction of travel at s (unit, horizontal). */
  forward(s: number, out: THREE.Vector3): THREE.Vector3 {
    const f = this.frame(s);
    return out.set(f.tx, 0, f.tz);
  }

  /** World right at s (unit, horizontal). */
  right(s: number, out: THREE.Vector3): THREE.Vector3 {
    const f = this.frame(s);
    return out.set(f.nx, 0, f.nz);
  }

  /** Track coordinates of a world point near distance `nearS`: (s, lateral, height above the road). */
  toTrack(p: THREE.Vector3, nearS: number, out: { s: number; lateral: number; y: number }): { s: number; lateral: number; y: number } {
    if (!this.track) {
      out.s = -p.z;
      out.lateral = p.x;
      out.y = p.y;
      return out;
    }
    const pr = this.track.project(p.x, p.z, nearS);
    out.s = pr.s;
    out.lateral = pr.lateral;
    out.y = p.y - this.frame(pr.s).h;
    return out;
  }
}
