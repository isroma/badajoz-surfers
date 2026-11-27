# Badajoz Surfers design guide

One style for the whole game, 3D world and interface alike. Use it before adding a model, a screen or a colour. If the game and this guide disagree, fix one of them in the same PR.

## The idea

**A sunny low-poly model of the real Badajoz.** The streets, lanes, roundabouts, building footprints, heights and landmarks are real data; the look is clean, flat and friendly, in the palette of Sol y Cerveza (warm cream land, white streets, soft green trees, light blue water, sun yellow as the accent). It should read like a hand-made scale model of the city on a bright day, not like a toy town and not like a failed attempt at realism.

Three rules decide most questions:

1. **Legible first.** At a glance the player must see where they can run, where the route goes next and what will hit them. Scenery never competes with gameplay objects.
2. **Flat and few.** Flat colours, simple shapes, no noisy textures, no decoration without a reason.
3. **Fast.** A steady 60 fps on a laptop is part of the design. Anything that risks it is cut.

## Palette

Day (the default). Hex values are the single source; put them in one module and import from there.

| Role | Hex | Use |
| --- | --- | --- |
| Land | `#F6EEE2` | Ground beside streets, plots, far terrain |
| Pavement | `#EFE4D2` | Sidewalks, plazas, pedestrian streets |
| Street | `#FFFFFF` on `#DAD3C8` casing | Not used for the carriageway (see Road) but for far streets and the minimap |
| Road | `#5B6270` | The runnable carriageway: a calm blue-grey, darker than everything around it |
| Road marking | `#FFFFFF` | Lane lines, arrows, crossings |
| Runnable non-road lane | `#E7D7BC` | Sidewalk, median and pedestrian lanes the runner can use: clearly a path |
| Kerb | `#CFC5B6` | Kerbs, low walls |
| Building | `#F0E4D3`, `#F2E6D6`, `#EAD9C2`, `#F7EFE3` | Default walls, varied per building |
| Building accents | `#D9A066` brick, `#E8C07A` albero, `#C9D6DF` glass, `#B8876B` terracotta roof, `#FCF8F1` flat roof | Typology colour, one accent per building |
| Windows | `#8FA6B8` day, `#FFD98A` lit at night | Simple rectangles in a regular grid |
| Trees | `#A8C98C`, `#BFDDA0`, `#8DB87A` | Crowns; trunks `#9A7B5F`. No purple, no blossom colours |
| Park / grass | `#CDE5AE` | Lawns, medians, roundabout islands |
| Water | `#9ACBEF` | The Guadiana, flat with a slow light shimmer |
| Stone | `#D8C9A8` | Alcazaba walls, Puerta de Palmas, cathedral, Puente de Palmas |
| Sun yellow | `#FFC53D` | Bellotas, the primary button, the guide arrows, highlights. Nothing else in the world is this colour |
| Amber | `#F59E0B` | Secondary accent, power-up halos |
| Danger | `#E5484D` | Oncoming-traffic warnings, crash, barriers' stripes |
| Ink | `#1F2328` | Text and outlines in the interface |
| Night bg | `#141826` | Interface panels at night, deep background |

Night laps use the same shapes with the Sol y Cerveza night values (land `#161A26`, buildings `#2B3144`, road `#2A3043`, trees `#22302A`, water `#16263D`) and warm lit windows and lamps. Gameplay objects keep their day colours and stay bright.

Vehicles and obstacles use saturated but few colours so they pop against the pale city: white, red `#E5484D`, blue `#3E7BD6`, yellow `#F2B632`, dark grey `#3A3F4B`. The city bus is red and white. Taxis are white with a red diagonal band.

## 3D world

- **Shapes:** low-poly, flat-shaded or softly shaded simple forms. Real footprints extruded to real heights. No bevel noise, no tiny props.
- **Materials:** flat colours through vertex colours on a handful of shared unlit-ish Lambert materials. No texture atlases with dirt, stains, bricks or grain. The only textures are text (signs, plaques, plates) and the simple window grid.
- **Buildings:** a wall colour, a regular grid of flat windows, one accent (awnings or balconies or a brick band), a simple roof. Typology follows the data: `amenity=school` looks like a school (long, low, big regular windows, a name sign and a yard wall), churches have a tower or bell gable, shops have a ground-floor band with their real name. Named buildings show their name.
- **Landmarks** are the exception to "few": Puente Real (deck, single white pylon, cable fan), the cathedral, Plaza Alta's red and white arcades, the Alcazaba walls and Torre de Espantaperros, Puerta de Palmas, Puente de Palmas and the Siglo XXI tower get careful, recognisable low-poly models in the same flat style.
- **Trees:** two or three low-poly crown shapes (round, tall, palm), green only, instanced.
- **Lighting:** one sun and a sky fill, **no shadow maps**. Characters, vehicles and obstacles get a soft dark blob under them. Buildings get a baked darker band at the base. Fog is light and matches the sky's horizon colour.
- **Sky:** a simple two-colour gradient per time of day with a few flat, soft clouds. No blocky clouds.
- **Time of day** still travels with the lap (morning on Puente Real to dusk on the right bank) but as a gentle tint, never darker than needed to read the road.

## The road and the route (legibility)

- The **runnable surface is always visually distinct**: road lanes are the dark road colour with white lines; runnable sidewalk, median and pedestrian lanes are the "runnable non-road" colour with a subtle edge line. Everything not runnable is a different colour **and** separated by a kerb, a hedge, a railing or a barrier. If it looks like a lane, the runner can use it; if the runner cannot use it, it does not look like a lane.
- **Lanes are stable.** A lane keeps its position across junctions and around roundabouts; the runner is never moved sideways by the game. When a lane really ends, it is closed ahead of time with a tapering line of red and white barriers and painted merge arrows, and the runner has seconds to leave it.
- **Guide arrows:** before every bend sharper than a gentle curve, and at every roundabout entry and exit, sun-yellow chevrons stand on the outside of the turn pointing the way, and yellow arrows are painted on the road. Wrong exits are closed with barriers.
- **Oncoming lanes** are marked: a solid double line and red-tinted edge so the player knows traffic there comes towards them.

## Interface

Flat, minimal, confident. The receipt ("La cuenta") on the game-over screen is the reference for charm: keep it as it is.

- **Surfaces:** flat panels, no gradients, no glows, no bevels, no drop shadows beyond one soft `0 4px 16px rgba(31,35,40,.10)`. Day panels are white `#FFFFFF` with ink text; over the 3D scene the HUD uses compact ink `#1F2328` chips at 92% opacity with cream text.
- **Colour:** ink, white, cream `#FFF8E7`, and sun yellow for exactly one primary action per screen. Danger red only for danger.
- **Type:** the system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", Roboto, system-ui, sans-serif`). Weights 800 for titles and numbers, 600 for labels, 400 for body. Sentence case. No outlined or tilted lettering except the logo.
- **Shape:** radius 12 for cards, 999 for chips and buttons, 44 px minimum control height, 8-point spacing.
- **Logo:** "Badajoz Surfers" as a flat wordmark: ink or white letters with a single sun-yellow element (the acorn), subtitle "Escapa tras hacer un simpa" in a small label. No outlines, no 3D drop.
- **Icons:** one stroke weight, single colour, no emoji.
- **HUD:** score top right, zone and street top left, letters top centre, minimap bottom left. Nothing else is permanent. Toasts are one line, one at a time, and never cover the runner.
- **Motion:** 150 ms for hovers, 200–250 ms slide or fade for panels, no bouncing.
- **Copy:** Spanish from Spain, tú, short. Numbers in Spanish format.

## Checklist for a change

- Does it use only palette colours?
- Can the player still tell runnable from not runnable, and where the route goes next?
- Is sun yellow still reserved for bellotas, the primary action and guide arrows?
- Does it hold 60 fps at the heaviest spot (the end of Sinforiano Madroñero)?
