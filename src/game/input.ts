/** Keyboard (and simple swipe) input mapped to game commands. */
import type { PlayerAction } from "./player";

export type Command = PlayerAction | "pause" | "confirm";

const KEYS: Readonly<Record<string, Command[]>> = {
  KeyA: ["left"],
  ArrowLeft: ["left"],
  KeyD: ["right"],
  ArrowRight: ["right"],
  KeyW: ["jump"],
  ArrowUp: ["jump"],
  Space: ["jump", "confirm"],
  KeyS: ["roll"],
  ArrowDown: ["roll"],
  Escape: ["pause"],
  KeyP: ["pause"],
  Enter: ["confirm"],
  NumpadEnter: ["confirm"],
};

export class Input {
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    const commands = KEYS[e.code];
    if (!commands) return;
    // Let buttons in the shell react to Enter/Space themselves.
    const onButton = target instanceof HTMLElement && target.tagName === "BUTTON";
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    for (const c of commands) {
      if (c === "confirm" && onButton) continue;
      this.handler(c);
    }
  };

  private touchStart: { x: number; y: number; t: number } | null = null;
  private readonly onTouchStart = (e: TouchEvent): void => {
    const t = e.changedTouches[0];
    if (t) this.touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
  };
  private readonly onTouchEnd = (e: TouchEvent): void => {
    const t = e.changedTouches[0];
    const s = this.touchStart;
    this.touchStart = null;
    if (!t || !s) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) {
      this.handler("confirm");
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) this.handler(dx < 0 ? "left" : "right");
    else this.handler(dy < 0 ? "jump" : "roll");
  };

  constructor(
    private readonly target: HTMLElement,
    private readonly handler: (command: Command) => void,
  ) {
    window.addEventListener("keydown", this.onKey);
    target.addEventListener("touchstart", this.onTouchStart, { passive: true });
    target.addEventListener("touchend", this.onTouchEnd, { passive: true });
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.target.removeEventListener("touchstart", this.onTouchStart);
    this.target.removeEventListener("touchend", this.onTouchEnd);
  }
}
