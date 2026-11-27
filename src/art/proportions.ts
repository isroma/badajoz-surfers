/**
 * Character proportions (metres, bind pose: standing at the origin, facing -Z, arms slightly out).
 * About 6.4 heads tall: stylised but athletic. Shared by the rig, the body sculpting and the outfits.
 */
export const P = {
  height: 1.8,
  hipY: 0.94,
  hipX: 0.092,
  kneeY: 0.505,
  ankleY: 0.085,
  /** The legs splay out a touch in the bind pose so the thighs do not fuse. */
  ankleX: 0.104,
  toeY: 0.03,
  toeZ: -0.115,
  spineY: 1.07,
  chestY: 1.25,
  neckY: 1.46,
  headY: 1.545,
  clavX: 0.035,
  shoulderX: 0.19,
  shoulderY: 1.425,
  upperArm: 0.29,
  forearm: 0.25,
  /** Bind-pose arm abduction (radians from vertical). */
  armOut: 0.17,
  hand: 0.17,
  /** Head ellipsoid centre and radii (before sculpting). */
  headC: [0, 1.652, -0.008] as const,
  headR: [0.108, 0.136, 0.123] as const,
  /** Pivot height of the forward roll (the centre of the tucked ball). */
  rollPivot: 0.37,
} as const;

/** The stork, real-bird scale (about 2 m span); the carrying stork is scaled up from this. */
export const STORK = {
  bodyY: 1.0,
  span: 2.0,
  /** Scale of the stork that carries the runner (about 3.5 m span). */
  carryScale: 1.75,
} as const;
