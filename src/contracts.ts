/**
 * Shared contracts between the three parts of the game:
 *
 * - `src/game/`  engine: loop, player, track generation, collisions, scoring, camera.
 * - `src/art/`   procedural 3D models and scenery (no downloaded assets).
 * - `src/ui/`, `src/audio/`, `src/meta/`  the shell: Spanish HUD and menus, synthesized audio, save data.
 *
 * World space: X to the right, Y up, the runner moves towards -Z. "Distance" is `-z` in metres.
 * All sizes are metres, all times seconds.
 */
import type * as THREE from "three";

// ---------------------------------------------------------------------------
// Track geometry
// ---------------------------------------------------------------------------

export type Lane = -1 | 0 | 1;
export const LANES: readonly Lane[] = [-1, 0, 1];
export const LANE_WIDTH = 2.6;
export const laneX = (lane: number): number => lane * LANE_WIDTH;
/** Half width of the runnable road (3 lanes plus a small margin). Kerbs and scenery start here. */
export const ROAD_HALF_WIDTH = 4.2;
/** Scenery is built and recycled in segments of this length. */
export const SEGMENT_LENGTH = 40;

// ---------------------------------------------------------------------------
// Zones (levels). The run loops through them in order; each loop is a "vuelta" and gets faster.
// The order follows a real loop around Badajoz, starting on Puente Real.
// ---------------------------------------------------------------------------

export type ZoneId =
  | "puente-real"
  | "valdepasillas"
  | "san-francisco"
  | "casco-antiguo"
  | "alcazaba-palmas"
  | "margen-derecha";

export interface ZoneDef {
  id: ZoneId;
  /** Spanish display name. */
  name: string;
  /** Spanish one-line flavour text shown under the name when the zone starts. */
  subtitle: string;
  /** Length in metres; a multiple of SEGMENT_LENGTH. */
  length: number;
}

export const ZONES: readonly ZoneDef[] = [
  { id: "puente-real", name: "Puente Real", subtitle: "Cruza el Guadiana sin mirar atrás", length: 480 },
  { id: "valdepasillas", name: "Valdepasillas", subtitle: "Avenida Sinforiano Madroñero", length: 640 },
  { id: "san-francisco", name: "San Francisco", subtitle: "Paseo de San Francisco y Avenida de Europa", length: 640 },
  { id: "casco-antiguo", name: "Casco Antiguo", subtitle: "Plaza de España, calle San Juan y Plaza Alta", length: 720 },
  { id: "alcazaba-palmas", name: "Alcazaba y Puerta de Palmas", subtitle: "De la muralla al Puente de Palmas", length: 720 },
  { id: "margen-derecha", name: "Margen derecha", subtitle: "Avenida de Elvas, de vuelta al Puente Real", length: 640 },
];

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------

export type ObstacleKind =
  | "valla" // roadworks barrier: jump
  | "conos" // cones joined by a bar: jump
  | "terraza" // bar table with chairs: jump
  | "valla-larga" // barrier across all three lanes: jump
  | "andamio" // scaffold: roll under
  | "pancarta" // fiesta banner across all three lanes: roll under
  | "contenedor" // rubbish container: jump onto or dodge
  | "coche" // car: jump onto the roof or dodge
  | "moto" // scooter: dodge or jump
  | "furgoneta" // delivery van: too tall for a normal jump
  | "bus" // city bus: too tall for a normal jump, long walkable roof
  | "camion-rampa"; // tow truck with a ramp bed: run up it to reach van and bus roofs

export interface ObstacleDef {
  /** How many lanes it covers. A 3-lane obstacle is always centred on lane 0. */
  lanes: 1 | 3;
  /** Collision box: width (X), bottom and top (Y), length (Z). */
  width: number;
  yMin: number;
  yMax: number;
  length: number;
  /** The runner can land and run on top (at yMax). */
  walkableTop: boolean;
  /**
   * The top is a slope: surface height rises linearly from 0 at the end the runner reaches
   * first (the +Z end) to yMax at the far end (-Z). Entering from the front is safe.
   */
  ramp: boolean;
  /** Vehicles can also be spawned moving towards the runner. */
  vehicle: boolean;
}

/**
 * The art must fit these boxes: model origin on the ground at the centre of the box footprint,
 * length along Z, the "front" a runner sees facing +Z. A normal jump lifts the feet about 1.75 m,
 * a "zapatillas" super jump about 3.6 m; a rolling runner is 0.8 m tall, a standing one 1.8 m.
 */
export const OBSTACLE_DEFS: Readonly<Record<ObstacleKind, ObstacleDef>> = {
  valla: { lanes: 1, width: 2.2, yMin: 0, yMax: 0.9, length: 0.3, walkableTop: false, ramp: false, vehicle: false },
  conos: { lanes: 1, width: 2.0, yMin: 0, yMax: 0.7, length: 0.6, walkableTop: false, ramp: false, vehicle: false },
  terraza: { lanes: 1, width: 2.2, yMin: 0, yMax: 0.95, length: 1.6, walkableTop: false, ramp: false, vehicle: false },
  "valla-larga": { lanes: 3, width: 7.8, yMin: 0, yMax: 0.9, length: 0.3, walkableTop: false, ramp: false, vehicle: false },
  andamio: { lanes: 1, width: 2.4, yMin: 1.25, yMax: 3.2, length: 2.0, walkableTop: false, ramp: false, vehicle: false },
  pancarta: { lanes: 3, width: 7.8, yMin: 1.25, yMax: 2.3, length: 0.2, walkableTop: false, ramp: false, vehicle: false },
  contenedor: { lanes: 1, width: 2.2, yMin: 0, yMax: 1.5, length: 1.4, walkableTop: true, ramp: false, vehicle: false },
  coche: { lanes: 1, width: 1.9, yMin: 0, yMax: 1.45, length: 4.3, walkableTop: true, ramp: false, vehicle: true },
  moto: { lanes: 1, width: 0.9, yMin: 0, yMax: 1.3, length: 2.0, walkableTop: false, ramp: false, vehicle: true },
  furgoneta: { lanes: 1, width: 2.1, yMin: 0, yMax: 2.6, length: 5.4, walkableTop: true, ramp: false, vehicle: true },
  bus: { lanes: 1, width: 2.5, yMin: 0, yMax: 3.1, length: 11, walkableTop: true, ramp: false, vehicle: true },
  "camion-rampa": { lanes: 1, width: 2.4, yMin: 0, yMax: 3.1, length: 7, walkableTop: true, ramp: true, vehicle: false },
};

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

/** The currency is the "bellota" (acorn). The four power-ups, and the letters of BADAJOZ. */
export type PowerupKind = "iman" | "zapatillas" | "jamon" | "patinete";
export type PickupKind = "bellota" | PowerupKind | "letra";

export const WORD = "BADAJOZ";

export interface PowerupInfo {
  kind: PowerupKind;
  /** Spanish name and description for the HUD and the shop. */
  name: string;
  description: string;
  /** Duration in seconds before upgrades. */
  baseDuration: number;
}

export const POWERUPS: Readonly<Record<PowerupKind, PowerupInfo>> = {
  iman: { kind: "iman", name: "Imán", description: "Atrae las bellotas cercanas", baseDuration: 10 },
  zapatillas: { kind: "zapatillas", name: "Zapatillas", description: "Saltos enormes: súbete a furgonetas y autobuses", baseDuration: 10 },
  jamon: { kind: "jamon", name: "Jamón ibérico", description: "Puntuación doble", baseDuration: 12 },
  patinete: { kind: "patinete", name: "Patinete", description: "Más rápido, y te salva de un golpe", baseDuration: 12 },
};

// ---------------------------------------------------------------------------
// Art API (implemented by src/art/index.ts)
// ---------------------------------------------------------------------------

export type ActorAnim = "idle" | "run" | "jump" | "fall" | "roll" | "stumble" | "caught" | "celebrate";

/** An animated character. `root` has its origin at the feet, facing -Z (the running direction). */
export interface Actor {
  root: THREE.Group;
  /**
   * Advance the animation. `speed` is the running speed in m/s (drives the stride cadence).
   * Switching `anim` should blend or snap cleanly; "roll" must keep the body under 0.8 m tall.
   */
  update(dt: number, anim: ActorAnim, speed: number): void;
  /** Runner only: show or hide the "patinete" (electric scooter) under the runner. */
  setRiding?(riding: boolean): void;
}

export interface PickupMesh {
  root: THREE.Group;
  /** Idle animation (spin, bob). `t` is seconds since the start of the run. */
  update(dt: number, t: number): void;
}

/** Lighting, sky and fog for a zone. The engine blends between zones. */
export interface Atmosphere {
  skyTop: number;
  skyBottom: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  sunColor: number;
  sunIntensity: number;
  /** Direction the sunlight travels from (normalised by the engine). */
  sunPosition: [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
}

export interface ZoneScenery {
  atmosphere: Atmosphere;
  /**
   * Build one segment of this zone: road surface, lane markings, kerbs, pavements, and everything
   * beside the road (buildings, trees, the river, landmarks). Local space: X centred on the road,
   * the segment runs from z = 0 to z = -SEGMENT_LENGTH. Nothing solid may enter the road
   * (|x| < ROAD_HALF_WIDTH) below 4 m of height; arches and cables may span above it.
   * `index` is the segment's 0-based position in the zone and `count` the number of segments in
   * the zone, so landmarks sit at fixed places. The same (index, lap) must build the same segment.
   * "puente-real" also accepts indices -1 to -4: the street that leads to the bridge, shown
   * behind the runner at the start of a run and in the menu (same atmosphere as the zone).
   */
  buildSegment(index: number, count: number, lap: number): THREE.Object3D;
}

export interface SkyDome {
  mesh: THREE.Object3D;
  /** Set the gradient colours. The engine keeps the dome centred on the camera. */
  setColors(top: THREE.Color, bottom: THREE.Color): void;
}

export interface ArtApi {
  createRunner(): Actor;
  createWaiter(): Actor;
  /** `seed` picks the variant (colour, livery, taxi or not). `moving` vehicles show lit headlights. */
  createObstacle(kind: ObstacleKind, seed: number, moving?: boolean): THREE.Object3D;
  /** For "letra", `letter` is the character to show. Origin at the centre; about 0.7 m across. */
  createPickup(kind: PickupKind, letter?: string): PickupMesh;
  createZoneScenery(zone: ZoneId): ZoneScenery;
  createSkyDome(): SkyDome;
  /**
   * Called by the engine when it removes an object the art created. The art module shares
   * geometries and materials between objects, so the engine never disposes them itself.
   */
  release(object: THREE.Object3D): void;
}

// ---------------------------------------------------------------------------
// Game API (implemented by src/game/index.ts, consumed by the shell)
// ---------------------------------------------------------------------------

export type GameState = "menu" | "playing" | "paused" | "gameover";

export interface RunSummary {
  score: number;
  distance: number;
  bellotas: number;
  /** Zones completed in this run, and the lap ("vuelta", 1-based) reached. */
  zonesCompleted: number;
  lap: number;
  /** How the run ended. */
  cause: "crash" | "caught";
  /** Obstacle that ended the run, when there was one. */
  obstacle?: ObstacleKind;
  /** Counters for missions. */
  jumps: number;
  rolls: number;
  nearMisses: number;
  roofMetres: number;
  powerups: number;
  wordsCompleted: number;
  /** Letters of WORD picked up in this run (all of them, across completed words). */
  letters: number;
}

export type TutorialAction = "left" | "right" | "jump" | "roll";

export type GameEvent =
  | { type: "state"; state: GameState }
  | { type: "countdown"; value: number; resume?: boolean } // 3, 2, 1 then 0 = go; `resume` after a pause
  /**
   * Tutorial prompt (only in runs where `GameOptions.tutorial()` is true): the next scripted
   * obstacle needs this action now. "done" hides the prompt; "complete" ends the tutorial.
   */
  | { type: "hint"; action: TutorialAction | "done" | "complete" }
  | { type: "jump"; super: boolean }
  | { type: "land" }
  | { type: "roll" }
  | { type: "lane" }
  | { type: "pickup"; kind: PickupKind; letterIndex?: number }
  | { type: "powerup-start"; kind: PowerupKind; duration: number }
  | { type: "powerup-end"; kind: PowerupKind }
  | { type: "shield-break" } // the patinete absorbed a crash
  | { type: "word-complete" }
  | { type: "near-miss" }
  | { type: "stumble" } // clipped something: the waiter closes in
  | { type: "crash"; obstacle: ObstacleKind }
  | { type: "caught" }
  | { type: "zone"; zone: ZoneDef; lap: number; first: boolean } // entered a zone; `first` at run start
  | { type: "gameover"; summary: RunSummary };

export interface HudSnapshot {
  score: number;
  bellotas: number;
  distance: number;
  multiplier: number;
  speed: number;
  zone: ZoneDef;
  /** 0..1 progress through the current zone. */
  zoneProgress: number;
  lap: number;
  powerups: { kind: PowerupKind; remaining: number; duration: number }[];
  /** Which letters of WORD are collected. */
  letters: boolean[];
  /** 0 = the waiter is far behind, 1 = right on your heels. 0 during the intro and countdown. */
  chaser: number;
  /** Metres run on roofs so far in this run. */
  roofMetres: number;
}

/** Supplied by the shell (from save data) when the game is created; read at the start of each run. */
export interface GameOptions {
  /** Power-up duration in seconds, including shop upgrades. */
  powerupDuration(kind: PowerupKind): number;
  /** Base score multiplier (grows with completed missions). */
  baseMultiplier(): number;
  /** True until the player has finished the tutorial once: the run then opens with scripted, prompted obstacles. */
  tutorial(): boolean;
}

export interface GameApi {
  readonly state: GameState;
  on(listener: (event: GameEvent) => void): () => void;
  /** Cheap to call every frame. */
  getHud(): HudSnapshot;
  /** From "menu" or "gameover": start a new run (with a short countdown). */
  start(): void;
  pause(): void;
  resume(): void;
  /** Back to the idle menu scene on Puente Real. */
  toMenu(): void;
}

/** The shell (src/ui/index.ts): `createShell(root)` then `attach(game)`. */
export interface Shell {
  gameOptions: GameOptions;
  attach(game: GameApi): void;
}
