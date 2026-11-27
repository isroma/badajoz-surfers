/**
 * Types for public/data/city.json, written by tools/city/build.py (see tools/city/README.md).
 *
 * Frame: metres in a local tangent plane (transverse Mercator centred on the origin, scale 1).
 * Origin = the route's start point (OSM node 1142046712, where Puente Real's south-east-bound
 * carriageway leaves the Avenida de Elvas roundabout on the right bank).
 * X = east, Z = SOUTH (north is -Z), Y = up, as in three.js. Heights `h`/`h0` are metres relative
 * to the DTM ground level at the origin (meta.origin.groundElevation metres above sea level).
 * Coordinates are quantised to 0.1 m. "Flat" arrays interleave values: [x0, z0, x1, z1, ...].
 *
 * Sides: "left"/"right" as seen by the runner facing the direction of travel. Signed lateral
 * distances (`lateral`, `opposite.offset`) are + to the right, - to the left.
 * `s` is distance along the lap (0 ≤ s < meta.lapLength), increasing in the running direction.
 */

/** [x0, z0, x1, z1, ...] */
export type FlatXZ = number[];
/** [x0, z0, h0, x1, z1, h1, ...] */
export type FlatXZH = number[];

export interface CityData {
  meta: CityMeta;
  route: CityRoute;
  sections: CitySection[];
  zones: CityZone[];
  junctions: CityJunction[];
  streets: CityStreet[];
  buildings: CityBuilding[];
  landmarks: CityLandmark[];
  water: CityArea[];
  green: CityArea[];
  squares: CityArea[];
  parking: CityArea[];
  /** Flat, 5 numbers per tree: [x, z, height, crownRadius, palm]. palm: 0 = no, 1 = OSM says palm,
   *  2 = palm-likely from the data (> 8 m, crown radius < 0.25 × height, evergreen in the
   *  leaf-off LiDAR, in a park/garden or within 40 m of the river). */
  trees: number[];
  furniture: CityFurniture[];
  pois: CityPoi[];
  terrain: CityTerrain;
}

export interface CityMeta {
  version: 1;
  /** ISO time of the build, and of the OSM data (Overpass timestamp_osm_base). */
  generated: string;
  osmTimestamp: string;
  origin: { lat: number; lon: number; osmNode: number; /** DTM height of the origin, m above sea level. */ groundElevation: number };
  frame: { x: "east"; z: "south"; y: "up"; units: "m"; /** PROJ string of the local frame. */ proj4: string; rasterCrs: string };
  /** Length of the closed lap in metres. */
  lapLength: number;
  /** Nominal spacing of route samples (m). */
  routeStep: number;
  /** Lines to show in the game's credits (Spanish). */
  attribution: string[];
  sources: Record<string, string>;
  counts: Record<string, number>;
  /** Bridge spans on the route and how their deck heights were made. */
  bridges: { name: string; fromS: number; toS: number; length: number; method: "linear" | "dsm-deck"; dtmMinUnder: number; deckMax: number }[];
  buildingHeights: { p10: number; p50: number; p90: number; max: number };
  /** Buildings whose footprint reaches into the carriageway (also flagged on the building). */
  passesThrough: { id: string; name: string | null; building: string; s: [number, number]; height: number; penetration: number; overCentreline: boolean; passage: boolean }[];
  /** Tree stats, incl. palms (OSM-tagged) and palmLikely counts. */
  trees: Record<string, number | string>;
}

export interface CityRoute {
  /** Smoothed closed centreline of the runner's carriageway, every ~2 m: [x, z, h] flat, at 0.01 m
   *  precision (route.s and route.ground too; everything else in the file is 0.1 m). The
   *  last point connects back to the first. Min radius 12 m (14 m off roundabouts), grade ≤ 8 %. */
  points: FlatXZH;
  /** Cumulative distance of each point (m), starting at 0. */
  s: number[];
  /** Unsmoothed ground height (DTM, or bridge deck) under each point, relative to the origin.
   *  Differs from `h` where the grade limit or smoothing moved the road surface. */
  ground: number[];
}

export interface CitySection {
  fromS: number;
  toS: number;
  /** OSM `name`, or null for unnamed links and rings. */
  name: string | null;
  /** OSM highway class: trunk, primary, secondary, tertiary, residential, living_street, pedestrian, footway, cycleway… */
  highway: string;
  /** Single carriageway: total lanes of the road (both directions). Dual carriageway or one-way:
   *  lanes of OUR carriageway. 0 for pedestrian ways. */
  lanes: number;
  /** "tag-per-direction": a two-way road tagged lanes=1, counted as one lane each way (lanes = 2). */
  lanesSource: "tag" | "tag-per-direction" | "default" | "pedestrian";
  oneway: boolean;
  /** True when we run on one carriageway of a dual road; `opposite` describes the other one. */
  dual: boolean;
  opposite: {
    /** Median centre-to-centre lateral offset over the section (negative = to the left). */
    offset: number;
    lanes: number;
    lanesSource: "tag" | "default";
    name: string | null;
    /** The most frequent OSM way of the other carriageway along the section. */
    osmWay: number;
    /** Share of the section's 4 m samples where the anti-parallel (±15°) carriageway was found. */
    coverage: number;
  } | null;
  /** Dual sections only (null otherwise), from OSM features between the two carriageways:
   *  cable-plane = Puente Real's cable-stayed deck (pylon and cables in the middle); barrier =
   *  guard rail/fence/wall; promenade = paved footway/pedestrian area ≥ 4 m wide; planting =
   *  grass/garden/hedge or trees; kerb = < 2 m with nothing mapped; unmapped = wider, nothing mapped. */
  medianKind: "cable-plane" | "barrier" | "promenade" | "planting" | "kerb" | "unmapped" | null;
  /** Kerb-to-kerb width (m): |offset| − width/2 − opposite lanes × lane width / 2. */
  medianWidth: number | null;
  /** A footway / cycleway runs along the median for > 30 % of the section. */
  medianFootway: boolean | null;
  medianCycleway: boolean | null;
  /** Share of the median strip covered by mapped green (0–1). */
  medianGreen: number | null;
  /** Trees of `trees` standing in the median strip. */
  medianTrees: number | null;
  /** Carriageway width (m) of our carriageway (or of the walkable street for pedestrian ways). */
  width: number;
  /** "bridge-deck": the OSM bridge outline's width − 1 m, also carried onto footways named like the bridge they lead onto. */
  widthSource: "tag" | "lanes" | "facades" | "default" | "bridge-deck";
  /** Median facade-to-facade distance across the OSM street axis, when buildings line both sides within 40 m. */
  facadeWidth: number | null;
  /** 2 × distance from the smoothed route to the nearest wall (20th percentile). */
  clearance: number | null;
  /** Bridge name when on a bridge (from the OSM bridge outline or the way's name). */
  bridge: string | null;
  /** Width of the bridge deck from its OSM man_made=bridge outline. */
  deckWidth: number | null;
  /** OSM tunnel, or a covered way (under an arch: Arco del Peso, Puerta de Palmas). */
  tunnel: boolean;
  /** OSM surface: asphalt, paving_stones, sett, paved… (null if untagged on a pedestrian way). */
  surface: string | null;
  /** Pedestrian street, footway, living street, cycleway or steps. */
  pedestrian: boolean;
  /** Set while on a roundabout ring: centre and the ring's real radius (from its OSM outline). */
  roundabout: { cx: number; cz: number; r: number } | null;
  sidewalk: string | null;
  maxspeed: string | null;
  osmWays: number[];
}

export type ZoneIdData = "puente-real" | "valdepasillas" | "san-francisco" | "casco-antiguo" | "alcazaba-palmas" | "margen-derecha";

export interface CityZone {
  id: ZoneIdData;
  fromS: number;
  toS: number;
  length: number;
}

export interface CityJunction {
  s: number;
  /** Which side(s) of the route the other street leaves on. */
  side: "left" | "right" | "both";
  name: string | null;
  highway: string;
  /** Compass bearing of the other street leaving the junction (degrees clockwise from north). */
  bearing: number;
  /** Angle relative to the running direction (degrees, + right). */
  relAngle: number;
  lanes: number | null;
  oneway: boolean;
  /** Junction node position. */
  x: number;
  z: number;
  osmWay: number;
}

export interface CityStreet {
  osmWay: number;
  highway: string;
  name: string | null;
  /** Polyline clipped to 150 m of the route, flat [x, z, ...]. */
  pts: FlatXZ;
  lanes?: number;
  width?: number;
  oneway?: "yes" | "-1";
  bridge?: true;
  tunnel?: true;
  roundabout?: true;
  surface?: string;
  /** The route uses this way (draw it under the track or skip it). */
  onRoute?: true;
}

export interface CityBuilding {
  /** "w<id>" or "r<id>" (OSM way / relation). */
  id: string;
  /** Outer footprint ring, flat [x, z, ...], not closed, simplified to 0.5 m. Holes are omitted. */
  ring: FlatXZ;
  /** Ground height at the footprint (median DTM), relative to the origin. */
  h0: number;
  /** Roof height above h0 (m). */
  height: number;
  /** lidar: 85th percentile of DSM−DTM inside the footprint (1 m in from the edge); tag/levels/default otherwise. */
  src: "lidar" | "tag" | "levels" | "default";
  levels: number;
  /** 99th percentile when a tower/spire rises > 4 m above `height` (e.g. a church tower). */
  peak?: number;
  /** Useful OSM tags: building, name, amenity, shop, tourism, historic, roof:shape, colours, materials, addr… */
  tags?: Record<string, string>;
  s: number;
  side: "left" | "right";
  /** Distance from footprint to the route centreline. */
  dist: number;
  /** The footprint reaches into the carriageway (data error, tight corner or a real arch). */
  passesThrough?: true;
  /** …and the route runs through it on an OSM tunnel / covered passage (an arch: Arco del Peso at Plaza Alta, Puerta de Palmas). */
  passage?: true;
}

export interface CityLandmark {
  /** Fixed ids for the named set (puente-real, torre-siglo-xxi, catedral, ayuntamiento, plaza-espana,
   *  plaza-alta, alcazaba, torre-espantaperros, puerta-palmas, puente-palmas, puente-universidad,
   *  puente-autonomia, templete-san-francisco, meiac, palacio-congresos, museo-arqueologico,
   *  puerta-pilar, puerta-capitel, fuerte-san-cristobal, plaza-de-toros, murallas), "osm-<w|r|n><id>" for the rest. */
  id: string;
  name?: string | null;
  /** Present and true when the named landmark was not found in OSM near the route. */
  missing?: true;
  osm?: string;
  x?: number;
  z?: number;
  s?: number;
  lateral?: number;
  historic?: string;
  tourism?: string;
  amenity?: string;
  building?: string;
  man_made?: string;
  religion?: string;
  leisure?: string;
  "bridge:structure"?: string;
  wikidata?: string;
  /** Footprint rings (flat) when the feature is an area. */
  footprint?: FlatXZ[];
  /** Polyline when the feature is a line. */
  line?: FlatXZ;
  /** LiDAR stats over the footprint (or a 4 m disc round a point): heights above ground, and the
   *  highest surface and median ground relative to the origin. */
  heightP90?: number;
  heightMax?: number;
  topMax?: number;
  ground?: number;
  /** puente-real only: both carriageway decks and the pylon. */
  decks?: { osmWay: number; lanes: number | null; oneway: string; line: FlatXZ; length: number }[];
  pylon?: { x: number; z: number; s: number; lateral: number; topAboveOrigin: number; aboveDeck: number; topElevation: number; source: string; osmSupports: unknown[] };
  /** murallas only: OSM city walls within 600 m, with ground and wall height (DSM) per vertex. */
  walls?: { osm: string; name: string | null; line: FlatXZ; ground: number[]; height: number[]; length: number; dist: number }[];
}

export interface CityArea {
  osm: string;
  /** water: natural/water…; green: park, garden, grass, wood…; squares: square/pedestrian; parking: parking type. */
  kind: string | null;
  ring: FlatXZ;
  holes?: FlatXZ[];
  name?: string;
}

export interface CityFurniture {
  type:
    | "bus_stop" | "traffic_signals" | "crossing" | "street_lamp" | "bench" | "fountain" | "drinking_water"
    | "bicycle_parking" | "waste_basket" | "recycling" | "waste_disposal" | "post_box" | "telephone" | "clock"
    | "toilets" | "vending_machine" | "parking_entrance" | "bicycle_rental" | "atm" | "bollard" | "planter"
    | "statue" | "memorial" | "playground" | "fitness_station" | "flagpole";
  x: number;
  z: number;
  s: number;
  lateral: number;
  osm: string;
  name?: string;
  crossing?: string;
  shelter?: string;
  bench?: string;
  route_ref?: string;
  inscription?: string;
  artwork_type?: string;
  subject?: string;
  operator?: string;
  recycling_type?: string;
}

export interface CityPoi {
  name: string;
  /** "<key>:<value>", e.g. "amenity:bar", "shop:clothes", "tourism:hotel", "office:…". */
  category: string;
  x: number;
  z: number;
  s: number;
  side: "left" | "right";
  /** Distance from the POI (or its footprint) to the route centreline. */
  dist: number;
  osm: string;
  brand?: string;
  cuisine?: string;
  opening_hours?: string;
  "addr:street"?: string;
  "addr:housenumber"?: string;
  outdoor_seating?: string;
}

export interface CityTerrain {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** Row-major DTM heights relative to the origin: h[iz * nx + ix] at (x0 + ix*cell, z0 + iz*cell);
   *  null outside the ±250 m corridor. Under bridges this is the river bed / water surface. */
  h: (number | null)[];
  /** Estimated Guadiana water level relative to the origin (DTM inside the river polygons). */
  waterLevel: number | null;
  note: string;
}
