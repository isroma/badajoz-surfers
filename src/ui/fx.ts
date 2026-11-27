/** Transient overlays: toasts, the countdown, the zone banner and floating near-miss text. */
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

export class Fx {
  readonly el: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private banner: HTMLElement | null = null;
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
    this.el.querySelectorAll(".floater").forEach((e) => e.remove());
  }
}
