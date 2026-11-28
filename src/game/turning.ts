/**
 * Smooth turning, pure: the heading the chase camera aims at through bends and roundabouts and
 * its yaw limits (camera.ts follows it; course.ts paces the run so it never has to exceed them).
 */
/** Camera yaw limits through bends and roundabouts (rad/s, rad/s²). */
export const YAW_RATE_MAX = (40 * Math.PI) / 180;
export const YAW_ACCEL_MAX = (150 * Math.PI) / 180;
/**
 * Only to keep the runner on screen in the tightest corners (where the path itself turns faster
 * than YAW_RATE_MAX) the follower may go up to these; the run's pace keeps the demand under them.
 */
export const YAW_RATE_HARD = (95 * Math.PI) / 180;
export const YAW_ACCEL_HARD = (300 * Math.PI) / 180;
/** Look-ahead heading window: [p − YAW_BEHIND, p + YAW_AHEAD] m, weighted towards YAW_PEAK m ahead. */
export const YAW_BEHIND = 10;
export const YAW_AHEAD = 34;
export const YAW_PEAK = 9;
/**
 * The heading the chase camera aims at, from the track's (unwrapped) heading profile: a
 * triangular-weighted average over [p − YAW_BEHIND, p + YAW_AHEAD], so the yaw starts before a
 * bend and finishes after it, and a roundabout's in-around-out is one fluid swing. Pure.
 */
export function headingTarget(heading: (s: number) => number, p: number): number {
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k <= 22; k++) {
    const s = p - YAW_BEHIND + ((YAW_BEHIND + YAW_AHEAD) * k) / 22;
    const off = s - (p + YAW_PEAK);
    const w = off < 0 ? 1 + off / (YAW_PEAK + YAW_BEHIND) : 1 - off / (YAW_AHEAD - YAW_PEAK);
    sum += heading(s) * Math.max(0.05, w);
    wsum += Math.max(0.05, w);
  }
  return sum / wsum;
}

