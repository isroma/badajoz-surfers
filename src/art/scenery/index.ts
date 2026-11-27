/** Zone scenery factory: atmospheres (a day's journey) and per-zone segment builders. */
import type * as THREE from "three";
import type { Atmosphere, ZoneId, ZoneScenery } from "../../contracts";
import { Builder } from "../geom";
import { hashInts, hashStr, makeRng } from "../rng";
import { buildAlcazabaPalmas } from "./alcazaba-palmas";
import { buildCascoAntiguo } from "./casco-antiguo";
import { JUNCTION, RW, junction, type Seg } from "./common";
import type { SurfaceName } from "../text";
import { buildMargenDerecha } from "./margen-derecha";
import { buildPuenteReal } from "./puente-real";
import { buildSanFrancisco } from "./san-francisco";
import { buildValdepasillas } from "./valdepasillas";

const ATMOSPHERES: Record<ZoneId, Atmosphere> = {
  // bright late morning over the river
  "puente-real": {
    skyTop: 0x2f7fd8, skyBottom: 0xc6e2f6, fogColor: 0xc6e2f6, fogNear: 70, fogFar: 250,
    sunColor: 0xfff3dc, sunIntensity: 2.6, sunPosition: [45, 70, 35],
    ambientColor: 0xc4d8f0, ambientIntensity: 1.15,
  },
  // clear midday
  valdepasillas: {
    skyTop: 0x1f6fd6, skyBottom: 0xd2e8f7, fogColor: 0xd2e8f7, fogNear: 65, fogFar: 240,
    sunColor: 0xffffff, sunIntensity: 2.8, sunPosition: [20, 95, 25],
    ambientColor: 0xd0dcec, ambientIntensity: 1.1,
  },
  // warm afternoon
  "san-francisco": {
    skyTop: 0x3a7fcf, skyBottom: 0xf0e0c0, fogColor: 0xf0e0c0, fogNear: 60, fogFar: 230,
    sunColor: 0xffe2b5, sunIntensity: 2.6, sunPosition: [-55, 55, 15],
    ambientColor: 0xe6d6c0, ambientIntensity: 1.1,
  },
  // golden hour in the old town
  "casco-antiguo": {
    skyTop: 0x4a76b8, skyBottom: 0xf6c486, fogColor: 0xf6c486, fogNear: 50, fogFar: 210,
    sunColor: 0xffc27a, sunIntensity: 2.5, sunPosition: [-70, 32, 10],
    ambientColor: 0xe8c6a6, ambientIntensity: 1.1,
  },
  // sunset by the Alcazaba and the Guadiana
  "alcazaba-palmas": {
    skyTop: 0x5b5aa6, skyBottom: 0xf6a070, fogColor: 0xf6a070, fogNear: 55, fogFar: 230,
    sunColor: 0xff9e5e, sunIntensity: 2.3, sunPosition: [-80, 20, -25],
    ambientColor: 0xe0a8a8, ambientIntensity: 1.15,
  },
  // dusk / blue hour on the right bank
  "margen-derecha": {
    skyTop: 0x1c2858, skyBottom: 0x8d8cc4, fogColor: 0x8d8cc4, fogNear: 55, fogFar: 220,
    sunColor: 0xb8b8ff, sunIntensity: 1.3, sunPosition: [35, 45, 20],
    ambientColor: 0x9aa6d8, ambientIntensity: 1.35,
  },
};

/** Street sign and pavement used by each zone's opening crossroads. */
const JUNCTIONS: Record<ZoneId, { plaque: string; surface: SurfaceName; tint: number }> = {
  "puente-real": { plaque: "c-puente", surface: "paving", tint: 0xe6e0d4 },
  valdepasillas: { plaque: "c-sinforiano", surface: "paving", tint: 0xeee6d6 },
  "san-francisco": { plaque: "c-sanfrancisco", surface: "paving", tint: 0xece4d2 },
  "casco-antiguo": { plaque: "c-casco", surface: "flagstone", tint: 0xe8dfcc },
  "alcazaba-palmas": { plaque: "c-alcazaba", surface: "flagstone", tint: 0xe2d3bb },
  "margen-derecha": { plaque: "c-elvas", surface: "paving", tint: 0xd8d2c6 },
};

const BUILDERS: Record<ZoneId, (s: Seg) => void> = {
  "puente-real": buildPuenteReal,
  valdepasillas: buildValdepasillas,
  "san-francisco": buildSanFrancisco,
  "casco-antiguo": buildCascoAntiguo,
  "alcazaba-palmas": buildAlcazabaPalmas,
  "margen-derecha": buildMargenDerecha,
};

export function createZoneScenery(zone: ZoneId): ZoneScenery {
  const zoneHash = hashStr(zone);
  return {
    atmosphere: { ...ATMOSPHERES[zone] },
    buildSegment(index: number, count: number, lap: number): THREE.Object3D {
      const b = new Builder();
      // the layout is the same every lap; the lap only reshuffles small details
      const s: Seg = {
        b,
        r: makeRng(hashInts(zoneHash, index, lap % 3)),
        index,
        count,
        lap,
        night: zone === "margen-derecha",
      };
      // every zone opens with the same crossroads, so handovers read as crossing a street
      const opening = index === 0;
      if (opening) b.clip = { z: -JUNCTION, ax: RW + 0.3 };
      BUILDERS[zone](s);
      b.clip = null;
      if (opening) {
        const j = JUNCTIONS[zone];
        junction(s, j.plaque, j.surface, j.tint);
      }
      const g = b.build(false);
      g.name = `segment:${zone}:${index}`;
      return g;
    },
  };
}
