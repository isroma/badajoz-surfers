# Simpa: corre por Badajoz

An endless runner through the streets of Badajoz. You left a bar terrace without paying ("un simpa") and the waiter is after you. The run starts on Puente Real and loops around the city; each loop is faster, and even loops are at night.

Play it: https://isroma.github.io/badajoz-surfers/

Desktop only for now. Repo text is in English; the game itself is in Spanish.

## Controls

| Key | Action |
| --- | --- |
| A / D or ← / → | Change lane |
| W, ↑ or Space | Jump |
| S or ↓ | Roll |
| Esc or P | Pause |

## The loop

Six zones, in the order of a real loop around the city:

1. Puente Real
2. Valdepasillas (Avenida Sinforiano Madroñero)
3. San Francisco (Paseo de San Francisco, Avenida de Europa)
4. Casco Antiguo (Plaza de España, calle San Juan, Plaza Alta)
5. Alcazaba y Puerta de Palmas, out over the Puente de Palmas
6. Margen derecha (Avenida de Elvas), back to Puente Real

Cars, vans, buses and scooters are the obstacles; a tow truck's ramp takes you onto the roofs. You collect bellotas (the currency), power-ups and the letters of BADAJOZ.

## Development

```bash
npm ci
npm run dev
npm run check
```

`npm run check` runs the typecheck, the tests and the build; CI runs it on every pull request and deploys `main` to GitHub Pages.

### Layout

- `src/contracts.ts`: the types and constants the three parts share. Read it first.
- `src/game/`: the engine (fixed-step physics, pattern-based track generator, collisions, chaser, camera).
- `src/art/`: procedural low-poly models and scenery. No downloaded assets.
- `src/ui/`, `src/audio/`, `src/meta/`: Spanish HUD and menus, synthesized audio, save data, missions, shop.

### Dev pages and debug hooks

- `/gallery.html?view=obstacles|actors|pickups|zone&zone=<id>`: look at the art on its own.
- `/shell-dev.html?screen=menu|hud|pause|gameover|…`: the UI over a fake engine (dev server only).
- URL params on the game: `?autostart=1`, `?bot=1` (autopilot), `?invincible=1`, `?zone=<id>`, `?seed=<n>`, `?nopause=1`.
- In the console: `__game.debug` (`setBot`, `setInvincible`, `warp`, `setSpeed`, `stats`) and `__shell` (`resetSave`, `addBellotas`).
