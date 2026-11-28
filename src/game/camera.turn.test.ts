/** Smooth turning: the chase camera's yaw through every bend and roundabout of the real lap. */
import { describe, expect, it } from "vitest";
import { YAW_ACCEL_HARD, YAW_ACCEL_MAX, YAW_RATE_HARD, YAW_RATE_MAX, YawFollower, chaseYawTarget, offBand, runnerBearing } from "./camera";
import { createFrame } from "../city/track";
import { useRealCourse } from "./test-course";

const course = useRealCourse();
const track = course.track;

/** Drive a lap at a constant speed; returns the worst yaw rate, acceleration and screen offset. */
export function lapYaw(speed: number, dt = 1 / 60): { rate: number; accel: number; screen: number; at: number; hard: number; soft: number; softAccel: number } {
  const f = createFrame();
  const heading = (s: number): number => track.frameAt(s, f).heading;
  const follower = new YawFollower();
  const back = 6.5;
  const up = 3.2;
  const vfov = ((62 + 10 * Math.min(1, Math.max(0, (speed - 11) / 20))) * Math.PI) / 180;
  const tanH = Math.tan(vfov / 2) * (16 / 9);
  let p = 20;
  const point = (s: number, l: number, y: number, out: { x: number; y: number; z: number }): void => track.toWorld(s, l, y, out);
  follower.reset(chaseYawTarget(heading, point, p, back, tanH));
  let rate = 0;
  let accel = 0;
  let soft = 0;
  let softAccel = 0;
  let hard = 0;
  let frames = 0;
  let screen = 0;
  let at = 0;
  const cam = { x: 0, y: 0, z: 0 };
  const run = { x: 0, y: 0, z: 0 };
  const L = track.lapLength;
  for (let t = 0; p < L + 20; t += dt) {
    p += speed * dt;
    const urgent = offBand(follower.yaw, runnerBearing(point, p, back), tanH);
    follower.step(chaseYawTarget(heading, point, p, back, tanH), dt, urgent);
    rate = Math.max(rate, Math.abs(follower.rate));
    accel = Math.max(accel, Math.abs(follower.accel));
    frames++;
    if (Math.abs(follower.rate) > YAW_RATE_MAX + 1e-9 || Math.abs(follower.accel) > YAW_ACCEL_MAX + 1e-6) hard++;
    if (!urgent) {
      soft = Math.max(soft, Math.abs(follower.rate));
      softAccel = Math.max(softAccel, Math.abs(follower.accel));
    }
    track.toWorld(p - back, 0, up, cam);
    track.toWorld(p, 0, 1, run);
    const bearing = Math.atan2(run.x - cam.x, run.z - cam.z);
    let d = bearing - follower.yaw;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    const ndc = Math.abs(Math.tan(d) / tanH);
    if (ndc > screen) {
      screen = ndc;
      at = p;
    }
  }
  return { rate, accel, screen, at, hard: hard / frames, soft, softAccel };
}

describe("smooth turning", () => {
  it("over the whole lap at 11, 18 and 25 m/s: yaw rate and acceleration under the caps, the runner in the middle half of the screen", () => {
    for (const v of [11, 18, 25]) {
      const r = lapYaw(v);
      // The soft caps hold everywhere except the few tight corners where the path itself turns
      // faster (then the hard caps, to keep the runner on screen), and those are rare.
      expect(r.rate, `${v} m/s`).toBeLessThanOrEqual(YAW_RATE_HARD + 1e-9);
      expect(r.accel, `${v} m/s`).toBeLessThanOrEqual(YAW_ACCEL_HARD + 1e-6);
      expect(r.hard, `${v} m/s: share of the lap over the soft caps (rate ${r.rate.toFixed(2)}, accel ${r.accel.toFixed(2)})`).toBeLessThan(0.01);
      expect(r.screen, `${v} m/s: runner at ${r.screen.toFixed(2)} of the half-screen at s ${r.at.toFixed(0)}`).toBeLessThanOrEqual(0.5);
    }
  }, 60_000);
});
