/**
 * Transient overlays: one-line toasts (one at a time, queued), the countdown and the tutorial
 * prompt. Zone changes and near-miss/reward callouts are toasts too, so nothing floats over the
 * runner.
 */
import type { TutorialAction } from "../contracts";
import { formatInt } from "../meta/format";
import { h, svg } from "./dom";

export interface ToastOptions {
  title: string;
  text?: string;
  icon?: string;
  /** Monochrome glyph instead of a colour icon. */
  glyph?: boolean;
  /** Kept for callers; the flat style ignores per-toast colours. */
  color?: string;
  variant?: "mission" | "danger" | "gold" | "zone";
  duration?: number;
  /** A toast with the same key replaces the queued or showing one instead of waiting. */
  key?: string;
}

/** Toasts waiting beyond this are dropped (oldest first): stale news is noise. */
const MAX_QUEUE = 4;
const DEFAULT_MS = 1800;
const OUT_MS = 200;

const HINTS: Record<TutorialAction, { keys: string[]; label: string; rotate: number }> = {
  left: { keys: ["←", "A"], label: "Cambia de carril", rotate: 180 },
  right: { keys: ["D", "→"], label: "Cambia de carril", rotate: 0 },
  jump: { keys: ["W", "↑", "Espacio"], label: "Salta", rotate: -90 },
  roll: { keys: ["S", "↓"], label: "Agáchate y rueda", rotate: 90 },
};

/** Flat sun-yellow arrow pointing right; rotated per action. */
const ARROW = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 18 H26 V8 L44 24 L26 40 V30 H6 Z" fill="#FFC53D"/></svg>`;

interface Queued {
  o: ToastOptions;
  el: HTMLElement;
}

export class Fx {
  readonly el: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private hint: HTMLElement | null = null;
  private readonly timers = new Set<number>();
  private queue: Queued[] = [];
  private showing: (Queued & { timer: number }) | null = null;

  constructor() {
    this.toasts = h("div", "toasts");
    this.countdownEl = h("div", "countdown");
    this.el = h("div", "fx", this.toasts, this.countdownEl);
  }

  private later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  private build(o: ToastOptions): HTMLElement {
    const icon = o.icon ? h("div", `t-icon${o.glyph ? " glyph" : ""}`, svg(o.icon)) : null;
    return h(
      "div",
      `toast${o.variant ? ` ${o.variant}` : ""}`,
      icon,
      h("span", "t-title", o.title),
      o.text ? h("span", "t-text", o.text) : null,
    );
  }

  toast(o: ToastOptions): void {
    const item = { o, el: this.build(o) };
    if (o.key) {
      // Same key: replace in place (showing) or in the queue.
      if (this.showing?.o.key === o.key) {
        window.clearTimeout(this.showing.timer);
        this.timers.delete(this.showing.timer);
        this.showing.el.replaceWith(item.el);
        this.showing = { ...item, timer: this.later(() => this.next(), o.duration ?? DEFAULT_MS) };
        return;
      }
      const i = this.queue.findIndex((q) => q.o.key === o.key);
      if (i >= 0) {
        this.queue[i] = item;
        return;
      }
    }
    this.queue.push(item);
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    if (!this.showing) this.next();
  }

  /** Show now, ahead of the queue, replacing whatever toast is up (warnings). */
  urgent(o: ToastOptions): void {
    if (this.showing) {
      window.clearTimeout(this.showing.timer);
      this.timers.delete(this.showing.timer);
    }
    this.queue = this.queue.filter((q) => !o.key || q.o.key !== o.key);
    this.queue.unshift({ o, el: this.build(o) });
    this.next();
  }

  /** Retire the showing toast and bring in the next one. */
  private next(): void {
    const old = this.showing;
    this.showing = null;
    if (old) {
      old.el.classList.add("out");
      this.later(() => old.el.remove(), OUT_MS);
    }
    const item = this.queue.shift();
    if (!item) return;
    this.toasts.append(item.el);
    // A waiting queue speeds things up a little.
    const ms = (item.o.duration ?? DEFAULT_MS) * (this.queue.length > 1 ? 0.7 : 1);
    this.showing = { ...item, timer: this.later(() => this.next(), ms + (old ? OUT_MS : 0)) };
  }

  countdown(value: number): void {
    this.countdownEl.replaceChildren();
    const go = value <= 0;
    const num = h("div", `count${go ? " go" : ""}`, go ? "¡Corre!" : formatInt(value));
    this.countdownEl.append(num);
    this.later(() => {
      if (num.isConnected) num.remove();
    }, go ? 900 : 950);
  }

  /** Zone change: a one-line toast ("Vuelta 2 · Puente Real"). */
  zoneBanner(kicker: string, name: string, _subtitle: string, extra?: string): void {
    this.toast({ title: name, text: extra ?? kicker, variant: "zone", key: "zone", duration: 2600 });
  }

  /** Tutorial prompt: big but flat, low in the centre, until hidden. */
  showHint(action: TutorialAction): void {
    const def = HINTS[action];
    this.hint?.remove();
    const keys = h("div", "hint-keys");
    def.keys.forEach((k, i) => {
      if (i > 0) keys.append(h("span", "hint-or", "o"));
      keys.append(h("kbd", k.length > 1 ? "wide" : undefined, k));
    });
    const arrow = h("div", "tut-arrow", svg(ARROW));
    arrow.style.setProperty("--rot", `${def.rotate}deg`);
    const el = h("div", `tut tut-${action}`, arrow, h("div", "tut-label", def.label), keys);
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
      el.replaceChildren(h("div", "tut-label", "¡Bien!"));
      el.classList.add("good");
      this.later(() => el.remove(), 650);
    } else el.remove();
  }

  /** Short callouts ("¡Por los pelos!", "¡Adiós, Casco Antiguo! +2.500") as one-line toasts. */
  floater(text: string, sub?: string, variant?: "reward"): void {
    this.toast({ title: text, text: sub, variant: variant === "reward" ? "gold" : undefined, key: variant ?? "floater", duration: variant ? 1600 : 1100 });
  }

  /** Remove everything (new screen, new run). */
  clear(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.queue = [];
    this.showing = null;
    this.toasts.replaceChildren();
    this.countdownEl.replaceChildren();
    this.hint?.remove();
    this.hint = null;
    this.el.querySelectorAll(".tut").forEach((e) => e.remove());
  }
}
