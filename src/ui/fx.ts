/** Transient overlays: toasts, the countdown, the zone banner and floating near-miss text. */
import type { TutorialAction } from "../contracts";
import { formatInt } from "../meta/format";
import { h, svg } from "./dom";

export interface ToastOptions {
  title: string;
  text?: string;
  icon?: string;
  /** Monochrome glyph instead of a colour icon. */
  glyph?: boolean;
  color?: string;
  variant?: "mission" | "danger" | "gold";
  duration?: number;
  /** Toasts with the same key replace each other instead of stacking. */
  key?: string;
}

const MAX_TOASTS = 3;

const HINTS: Record<TutorialAction, { keys: string[]; label: string; rotate: number }> = {
  left: { keys: ["←", "A"], label: "Cambia de carril", rotate: 180 },
  right: { keys: ["D", "→"], label: "Cambia de carril", rotate: 0 },
  jump: { keys: ["W", "↑", "Espacio"], label: "¡Salta!", rotate: -90 },
  roll: { keys: ["S", "↓"], label: "¡Agáchate y rueda!", rotate: 90 },
};

/** Chunky arrow pointing right; rotated per action. */
const ARROW = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 18 H26 V8 L44 24 L26 40 V30 H6 Z" fill="#ffc53d" stroke="#1d1020" stroke-width="4" stroke-linejoin="round"/></svg>`;

export class Fx {
  readonly el: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private banner: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private readonly timers = new Set<number>();
  private readonly keyed = new Map<string, HTMLElement>();

  constructor() {
    this.toasts = h("div", "toasts");
    this.countdownEl = h("div", "countdown");
    this.el = h("div", "fx", this.toasts, this.countdownEl);
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  toast(o: ToastOptions): void {
    if (o.key) this.dismiss(this.keyed.get(o.key));
    const icon = o.icon ? h("div", `t-icon${o.glyph ? " glyph" : ""}`, svg(o.icon)) : null;
    if (icon && o.color) icon.style.setProperty("--t-color", o.color);
    const el = h(
      "div",
      `toast${o.variant ? ` ${o.variant}` : ""}`,
      icon,
      h("div", "t-body", h("div", "t-title", o.title), o.text ? h("div", "t-text", o.text) : null),
    );
    this.toasts.append(el);
    if (o.key) this.keyed.set(o.key, el);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.firstElementChild?.remove();
    this.later(() => this.dismiss(el), o.duration ?? 2400);
  }

  private dismiss(el: HTMLElement | undefined): void {
    if (!el || !el.isConnected || el.classList.contains("out")) return;
    el.classList.add("out");
    for (const [k, v] of this.keyed) if (v === el) this.keyed.delete(k);
    this.later(() => el.remove(), 300);
  }

  countdown(value: number): void {
    this.countdownEl.replaceChildren();
    const go = value <= 0;
    const num = h("div", `display${go ? " go" : ""}`, go ? "¡Corre!" : formatInt(value));
    this.countdownEl.append(num);
    this.later(() => {
      if (num.isConnected) num.remove();
    }, go ? 900 : 950);
  }

  zoneBanner(kicker: string, name: string, subtitle: string, extra?: string): void {
    this.banner?.remove();
    const el = h(
      "div",
      "banner",
      h("div", "banner-kicker", kicker),
      h("div", "banner-name display", name),
      h("div", "banner-sub", subtitle),
      extra ? h("div", "banner-lap", extra) : null,
    );
    this.banner = el;
    this.el.append(el);
    this.later(() => el.classList.add("out"), 3000);
    this.later(() => {
      el.remove();
      if (this.banner === el) this.banner = null;
    }, 3400);
  }

  /** Tutorial prompt: big keycaps, centre-bottom, until hidden. */
  showHint(action: TutorialAction): void {
    const def = HINTS[action];
    this.hint?.remove();
    const keys = h("div", "hint-keys");
    def.keys.forEach((k, i) => {
      if (i > 0) keys.append(h("span", "hint-or", "/"));
      const cap = h("kbd", k.length > 1 ? "wide" : undefined, k);
      cap.style.animationDelay = `${i * 0.12}s`;
      keys.append(cap);
    });
    const arrow = h("div", "tut-arrow", svg(ARROW));
    arrow.style.setProperty("--rot", `${def.rotate}deg`);
    const el = h("div", `tut tut-${action}`, arrow, keys, h("div", "tut-label display", def.label));
    this.hint = el;
    this.el.append(el);
  }

  /** Hide the prompt; `good` shows a quick "¡Bien!". */
  hideHint(good: boolean): void {
    const el = this.hint;
    this.hint = null;
    if (!el) {
      if (good) this.floater("¡Bien!");
      return;
    }
    if (good) {
      el.replaceChildren(h("div", "tut-label display", "¡Bien!"));
      el.classList.add("good");
      this.later(() => el.remove(), 650);
    } else el.remove();
  }

  floater(text: string, sub?: string): void {
    const el = h("div", "floater display", text, sub ? h("small", undefined, sub) : null);
    this.el.append(el);
    this.later(() => el.remove(), 950);
  }

  /** Remove everything (new screen, new run). */
  clear(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.keyed.clear();
    this.toasts.replaceChildren();
    this.countdownEl.replaceChildren();
    this.banner?.remove();
    this.banner = null;
    this.hint?.remove();
    this.hint = null;
    this.el.querySelectorAll(".tut").forEach((e) => e.remove());
    this.el.querySelectorAll(".floater").forEach((e) => e.remove());
  }
}
