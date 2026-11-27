# Data licences for `public/data/`

`city.json` is built offline by `tools/city/` (see `tools/city/README.md`) from the sources below. It is a derivative database of OpenStreetMap and is made available under the **Open Database License (ODbL) 1.0**; the LiDAR-derived values in it (heights of buildings, trees, terrain and bridge decks) are also covered by the CC-BY 4.0 attribution below.

## Sources

| Data | Used for | Source | Licence | Attribution |
| --- | --- | --- | --- | --- |
| OpenStreetMap (Overpass API extract, timestamp in `city.json` `meta.osmTimestamp`) | the route, street names, lanes, widths, roundabouts, bridges, building footprints and tags, streets, landmarks, water/green/squares/parking polygons, OSM trees, street furniture, shops and bars (POIs) | © OpenStreetMap contributors | ODbL 1.0 | `© OpenStreetMap contributors` — <https://www.openstreetmap.org/copyright> |
| PNOA-LiDAR, MDS02 (surface model, 2nd coverage, flown 2018–19, 2 m) | building and landmark heights, tree detection and heights, bridge deck profile, Puente Real pylon | IGN / CNIG, via the sibling project's cache | CC-BY 4.0 (Orden FOM/2807/2015) | `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` |
| PNOA-LiDAR, MDT02 (terrain model, 2nd coverage, 2 m) | ground heights of the route, buildings and the terrain grid | IGN / CNIG | CC-BY 4.0 | `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es` |
| Sentinel-2 L2A NDVI composite (2025) | only to reject LiDAR "tree" peaks that are not vegetation | Copernicus / ESA | Copernicus open licence | `Contiene datos modificados de Copernicus Sentinel-2 (2025)` |

No other sources are used. In particular nothing comes from the sibling project's `terraces.json` (it mixes sources with other licences); every shop or bar name in `city.json` is from OpenStreetMap.

## Lines to show in the game (credits screen)

These are also in `city.json` → `meta.attribution`:

- Datos de calles, edificios, comercios y mobiliario © colaboradores de OpenStreetMap (ODbL), openstreetmap.org/copyright
- Alturas de edificios, árboles y terreno: Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es
- Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es
- Índice de vegetación: contiene datos modificados de Copernicus Sentinel-2 (2025)

## ODbL obligations in short

- Keep the OpenStreetMap attribution visible where the map data is used (the credits screen is fine; a link to <https://www.openstreetmap.org/copyright> is expected).
- `city.json` itself is a derivative database: if it is distributed (it is, as a static file of the site), it stays under ODbL. The game's rendered scenes are a "produced work" and only need the attribution.
