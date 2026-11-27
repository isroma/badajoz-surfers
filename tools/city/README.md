# tools/city — the real-Badajoz dataset

Offline pipeline that builds `public/data/city.json`: the game's lap through the real streets of Badajoz (curves, roundabouts, lanes, bridges, heights) and everything around it (buildings with LiDAR heights, trees, street names, shops and bars, landmarks, water, parks, terrain). The game only reads the JSON; nothing here runs in the browser.

TypeScript types for the file: [`city-types.ts`](city-types.ts). Licences and the credit lines: [`public/data/LICENSES.md`](../../public/data/LICENSES.md).

## Running it

Needs [`uv`](https://docs.astral.sh/uv/) (Python 3.12+ is installed by uv) and the PNOA-LiDAR rasters from the sibling project (read-only) at `/Users/81031694/Claude/sol-y-cerveza/pipeline/.cache/` (`badajoz_dsm.tif`, `badajoz_dtm.tif`, `sentinel2_ndvi_2025_*.tif`; path in `rasters.py`).

```bash
cd tools/city
uv sync                       # once
uv run python build.py        # ~20 s; downloads OSM on first run, then uses .cache/
uv run python check.py        # validation (exit code 1 on failure)
uv run python render.py       # debug PNGs in .cache/: route.png, profile.png, zone-<id>.png
uv run python route_debug.py  # only the raw routed node path: .cache/route_raw.png
```

On machines whose environment sets `UV_ENV_FILE=.env`, prefix the commands with `UV_ENV_FILE=`.

- **OSM download** (`fetch_osm.py`): the whole box 38.858–38.893 N, 7.008–6.955 W as four Overpass tiles (`nwr(bbox); out body; >; out skel qt;`), cached raw in `.cache/overpass_<hash>.json` and merged into `.cache/osm_merged.json`. `uv run python fetch_osm.py --force` refreshes it. Only bounding boxes are sent, with the User-Agent `badajoz-surfers-data/0.1`. overpass-api.de refuses scripted clients, so the maps.mail.ru mirror is tried first, then private.coffee, overpass-api.de and kumi.systems. TLS verification uses the OS trust store (`truststore`), so corporate proxies work without disabling verification.
- `.cache/` is git-ignored (raw OSM ~85 MB, debug PNGs).

## Files

| File | What it does |
| --- | --- |
| `fetch_osm.py` | Overpass download and cache |
| `osm.py` | OSM element store; the local frame (`Frame`); way/relation polygons (`Geo`) |
| `rasters.py` | DSM/DTM/NDVI windows, bilinear sampling |
| `route.py` | routable way graph (costs, one-way handling, roundabout islands) and the waypoint router |
| `lap.py` | the waypoints of the lap; resampling and smoothing helpers |
| `build.py` | everything else: smoothing, heights, sections, zones, junctions, buildings; writes the JSON |
| `features.py` | landmarks, area layers, streets, trees, furniture, POIs, terrain grid |
| `check.py` | validation |
| `render.py`, `route_debug.py` | debug maps |
| `city-types.ts` | TypeScript interfaces for `city.json` (to move into `src/contracts.ts`) |

## The lap (8.16 km)

Route arrays (`points`, `s`, `ground`) are written at 0.01 m precision; everything else at 0.1 m.

Routed on the OSM way graph through ordered waypoints (`lap.py` `WAYPOINTS`, snapped to nodes on named streets, or on a given way with `way:<id>`). `route.py` `EXTRA_EDGES` adds connectors OSM lacks: the 16 m from the end of the Puerta de Palmas archway footway across the Ronda to the Puente de Palmas path, on the bridge axis. Costs prefer named streets (service roads ×3, footways ×1.8, unnamed ×1.35, steps ×12). One-way tags are ignored for ordinary streets (the runner is on foot; going against them costs ×1.25), but **roundabout rings and one-way carriageways of trunk/primary/secondary/tertiary roads are strict**, so the lap goes round every roundabout anticlockwise and, on dual carriageways, uses the carriageway that traffic in our direction uses (the right-hand one). Footway rings round plazas and footways across roundabout islands are excluded. Edges already used cost ×8 so the lap never doubles back.

Start (s = 0): OSM node 1142046712, where Puente Real's south-east-bound carriageway leaves the Avenida de Elvas roundabout on the right bank. The run goes south-east over the bridge towards the city.

| Zone | s (m) | Length | Streets, in order |
| --- | --- | --- | --- |
| `puente-real` | 0–1010 | 1010 m | Puente Real (approach on the right bank, then the 454 m cable-stayed deck, s 512–966), to the roundabout at its south-east end |
| `valdepasillas` | 1010–3090 | 2080 m | Puente Real roundabout (r 28.6 m) → Puente Real → Plaza Caldas da Rainha roundabout → Avenida Sinforiano Madroñero (with Plaza José Luis Herrera Pombo and one unnamed roundabout) to its end → roundabout (r 32.5 m, half way round) → Avenida María Auxiliadora |
| `san-francisco` | 3090–4308 | 1218 m | ring-road roundabout (r 20.4 m) → Avenida Villanueva → Avenida Miguel Ángel Celdrán Matute → Plaza Conquistadores → Avenida Enrique Segura Otaño → Plaza de la Constitución (three-quarters round) → Avenida de Europa → Calle Alonso de Celada → along the south-east side of Paseo de San Francisco (pedestrian) → garden footway → Calle Pedro de Valdivia → Plaza Minayo |
| `casco-antiguo` | 4308–4865 | 558 m | Calle Obispo San Juan de Ribera → Plaza de España (west side, Cathedral on the right) → Calle Vicente Barrantes → Calle San Juan → Calle Moreno Zancudo up to Plaza Alta |
| `alcazaba-palmas` | 4865–6285 | 1420 m | along the west side of Plaza Alta, through the Arco del Peso passage (s 4899–4905) → Plaza San José (Puerta del Capitel, the Alcazaba gate) → down Calle San Atón → Avenida Joaquín Costa (under the walls) → Plaza de los Reyes Católicos → through the archway of Puerta de Palmas (covered footway, s 5721–5725; the gate building is flagged `passesThrough` + `passage`) and straight on along the bridge axis → Puente de Palmas (510 m, pedestrian) |
| `margen-derecha` | 6285–8157 | 1872 m | right-bank end of Puente de Palmas → roundabout → Avenida Adolfo Díaz Ambrona (west, two roundabouts) → roundabout → Avenida de Elvas → Avenida de Elvas roundabout (r 35.5 m, ~235° round) → back onto Puente Real at s = 0 |

### Geometry and heights

1. The routed node path is resampled at 1 m. Points on roundabout rings are put on a true circle of the ring's equivalent radius (OSM rings are coarse polygons; radius = √(area/π) of the island the ring encloses). Rings under 12 m (Plaza de la Constitución 11.2 m, Plaza Minayo 10.9 m) are eased out to 14.5 m.
2. A light Gaussian smoothing (σ 2 m), then repeated local smoothing (σ 2.5–4 m, then σ 1.5 m) wherever the radius measured over ±2, ±3, ±6 and ±10 m chords is under 14 m (12 m on rings) + 3 %. Ring cores (6 m inside a ring run of ≥ 30 m; tight rings only when driven ≥ 200° round) are pushed back after each step to max(0.8 R, 12.5 m) from the centre (eased tight rings: to their full 14.5 m); after 600 steps that limit relaxes to 85 % to iron out kinks at the ends of the cores. This keeps a three-quarter turn round a small roundabout from collapsing into a cut across its island. Pinned stretches (`PINNED_WAYS`: the footway out of the Puerta de Palmas archway and its connector to the bridge path) keep their exact OSM geometry.
   `check.py` measures curvature as the consumer does: the circle through three consecutive 2 m samples (and through samples 2 apart), and fails below 12 m on ring sections and 14 m elsewhere.
3. Resampled to 2 m along the smoothed curve; each sample keeps the OSM way it came from (→ sections).
4. Heights: DTM (2 m) bilinear under each sample. Bridge spans: PNOA's MDT02 keeps the Puente Real deck (the DTM under it is ~172 m, the river ~160 m), so its deck is interpolated linearly between the abutments; Puente de Palmas's DTM shows the river bed, so its deck is the DSM along the centreline (running minimum over 14 m to drop people and lamps, smoothed, pinned to the abutments). Then Gaussian smoothing (σ 12 m) and a grade limit: a forward and a backward clamp pass at 8 % (each Lipschitz, so their mean is) and a last σ 6 m smoothing. `route.ground` keeps the unclamped ground for comparison: they differ by up to 3.4 m on Calle San Atón, which really drops 20 m in 220 m (9 % on average, 17 % at its steepest).
5. Heights are relative to the DTM at the start point (`meta.origin.groundElevation` = 170.75 m a.s.l.).

### Sections

Consecutive stretches with identical attributes (runs shorter than 8 m are merged into the previous one, except rings, bridges and tunnels):

- `lanes`: OSM `lanes` (or `lanes:forward` + `lanes:backward`) if tagged — a two-way road tagged `lanes=1` is counted as one lane each way (`lanesSource: "tag-per-direction"`, e.g. Avenida Miguel Ángel Celdrán Matute); else 2 for one-way trunk/primary/secondary, 1 for other one-ways, 2 for two-way, 0 for pedestrian ways. On a one-way carriageway it is the lanes of that carriageway.
- `dual` / `opposite`: recomputed per final section. Every 4 m, the nearest one-way road 4–30 m to our **left** that runs the other way within 15° of anti-parallel (same name, or same class when unnamed) is found; the section is dual when that succeeds on ≥ 50 % of the samples (≥ 80 % for sections under 20 m); a section under 30 m only stays dual when a neighbouring dual section ≥ 30 m has an offset within 2 m. `offset` = median lateral offset (negative = left), `coverage` = share of samples, `lanes` = the opposite way's tag or the class default.
- `medianKind`, `medianWidth`, `medianFootway`, `medianCycleway`, `medianGreen`, `medianTrees` (dual sections): a strip along the midline between the two carriageways, as wide as the median (|offset| − both carriageway half-widths), is intersected with OSM green (grass, park, garden, hedge, scrub, verge), paved pedestrian areas, footway/cycleway lines and barrier lines, and with the trees. Order of classification: `cable-plane` (on the cable-stayed Puente Real deck), `barrier` (> 30 % of the length), `promenade` (footway or pedestrian area > 30 % and ≥ 4 m wide), `planting` (> 25 % green or a tree per 25 m), `kerb` (< 2 m), else `unmapped`.
- `width`: OSM `width` if tagged; else lanes × lane width (3.5 m trunk, 3.25 m primary/secondary, 3.0 m others, +0.5 m on two-way roads); on pedestrian/living streets the clearance between walls (2 × the distance from the smoothed route to the nearest wall, 20th percentile, minus 1 m, 3–14 m); on pedestrian bridges the deck width from the OSM `man_made=bridge` outline minus 1 m, also carried onto the approach footways named like the bridge. `facadeWidth` is the median facade-to-facade distance across the OSM axis.
- `roundabout`: ring centre and real radius (before easing).

### Other layers

- **junctions**: every route node where another street (not our way, not our other carriageway, not a ring, not sidewalks/crossings/unnamed paths or service roads) leaves; side, compass bearing and angle relative to the running direction of the branch 15 m out.
- **streets**: all other highways within 150 m of the route, clipped, simplified to 0.5 m (sidewalks, crossings, unnamed paths and parking aisles left out).
- **buildings**: OSM `building=*` ways and multipolygons (not `building:part`) within 130 m of the route, plus those within 600 m that are ≥ 25 m tall or named/historic/tourism/church/town hall/university. Height = 85th percentile of DSM − DTM inside the footprint shrunk by 1 m (the whole footprint when too small); `peak` = 99th percentile when > 4 m higher (towers, spires). Fallbacks: `height` tag, `building:levels` × 3 + 1 m, else 6 m (2.6 m garages/sheds). Clamped to 2.5–120 m (90 m except the Siglo XXI). `h0` = median DTM inside. Footprints simplified to 0.5 m, holes dropped. `passesThrough` = the footprint reaches > 0.3 m into the carriageway (centreline ± width/2); `passage` = the route goes through it on an OSM tunnel (the Arco del Peso at Plaza Alta).
- **landmarks**: a fixed list by name (see `features.py` `NAMED_LANDMARKS`), each with footprint and LiDAR stats; Puente Real also gets both decks and its pylon (DSM maximum within 25 m of the decks); `murallas` holds every OSM `barrier=city_wall` within 600 m with the wall height (max DSM within 2 m − DTM) per vertex; then every other named church, museum, monument, historic feature, university building etc. within 300 m (600 m for big ones) as `osm-<id>`.
- **water / green / squares / parking**: OSM polygons (ways and multipolygons) clipped to 600 / 300 / 200 / 150 m of the route, simplified to 1 m (0.5 m for squares).
- **trees**: OSM `natural=tree` and `tree_row` (a tree every 7 m) within 60 m, plus LiDAR crowns: local maxima (10 m window) of DSM − DTM between 3 and 30 m, outside buildings (+2 m) and bridges, off the carriageway, not in mapped water, and not where Sentinel-2 summer NDVI < 0.12. An OSM tree takes the height and crown of a LiDAR peak within 3.5 m (that peak is then dropped). LiDAR trees are thinned to one per 4 m (tallest first); total capped at 6000. Crown radius = mean distance in 8 directions to where the canopy falls below half the tree's height. `palm` = 1 when OSM tags say so (genus/species/taxon/name), 2 = palm-likely: taller than 8 m, crown radius < 0.25 × height, evergreen (leaf-off DSM within 1 m of the leaf-on DSM at the crown) and in an OSM park/garden or within 40 m of the river.
- **furniture**: OSM nodes within 25 m: bus stops (with names), traffic signals, crossings, street lamps, benches, fountains, drinking water, bins, recycling, bicycle parking/rental, bollards, statues/memorials/artwork, playgrounds…
- **pois**: named OSM shops, bars, cafés, restaurants, pharmacies, banks, hotels, offices, crafts… (nodes and areas) within 35 m of the centreline, with the nearest `s` and side.
- **terrain**: DTM averaged over 8 × 8 m, every 10 m, over the route's bounding box + 260 m, null outside ±250 m of the route; `waterLevel` = median of the 20th percentile of the DTM inside the river polygons.

## Known gaps and doubts

- **LiDAR is from 2018–19**: buildings built since then fall back to tags/defaults (27 of 2002 got the 6 m default); trees planted or felled since are wrong.
- **Palms**: OSM has no palm species/genus/taxon tags in the area (only 6 trees named "Palmera", none near the route), so `palm` = 1 never occurs. 33 trees are `palm` = 2 (palm-likely) by the shape/evergreen/context rule; it is a heuristic (a young evergreen broadleaf can pass it) and it misses palms the 2 m LiDAR merged into wider crowns.
- **Medians**: OSM maps the Avenida Sinforiano Madroñero median as `landuse=grass` with only crossing footways, so it comes out `planting` (7–9 m wide, 10–19 trees per stretch), not a promenade. If there is a paved central walk it is not mapped as a footway along it.
- **Old-town widths are narrow** (Calle San Juan, Calle Moreno Zancudo: 4.4–5.8 m between OSM facades, `width` 3–3.6 m). That is what the OSM footprints say; the game's 3 × 2.6 m lanes do not fit there.
- **Buildings over the carriageway** (`meta.passesThrough`, 7): two real arches the lap runs through, the Arco del Peso and Puerta de Palmas (`passage: true`), one building at the corner by the paseo (2.2 m) and four small overlaps (≤ 2.4 m) round Plaza Alta where narrow streets meet at sharp corners and the 14 m minimum radius cuts the corner.
- **Plaza Minayo** (r 10.9 m): eased, the route cuts up to 2.5 m inside the ring's centreline.
- **Lanes not tagged** in OSM: Paseo / old-town streets (pedestrian), Avenida de Europa (tagged 2), several residential streets (defaults).
- **Puente Real pylon**: no OSM node; position and height come from the DSM maximum. The 2 m DSM may miss the very top of a slender mast.
- Every named landmark was found; the Plaza de Toros (r5448848) and Fuerte de San Cristóbal are ~600 m off the route (skyline only).
