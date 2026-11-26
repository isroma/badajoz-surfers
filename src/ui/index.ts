// STUB: replaced by the real shell (HUD, menus, audio, save data).
import { POWERUPS, type GameApi, type Shell } from "../contracts";

export function createShell(_root: HTMLElement): Shell {
  return {
    gameOptions: { powerupDuration: (kind) => POWERUPS[kind].baseDuration, baseMultiplier: () => 1 },
    attach(_game: GameApi) {},
  };
}
