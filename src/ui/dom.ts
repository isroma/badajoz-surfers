/** Minimal DOM helpers for the shell (no framework). */

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

/** An element whose content is trusted inline SVG markup from icons.ts. */
export function svg(markup: string, className = "icon"): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = markup;
  return el;
}

export interface ButtonOptions {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "xl" | "lg" | "md" | "sm";
  icon?: string;
  className?: string;
  disabled?: boolean;
  /** Accessible label when the button only has an icon. */
  ariaLabel?: string;
}

export type UiSound = (kind: "click" | "hover") => void;
let uiSound: UiSound = () => undefined;
export const setUiSound = (fn: UiSound): void => {
  uiSound = fn;
};

/**
 * A button that never keeps keyboard focus: the engine owns Space/Enter, so a focused button
 * would trigger twice. Mouse down doesn't focus it, and it blurs itself after a click.
 */
export function button(label: Child, onClick: () => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const b = h("button", `btn btn-${opts.variant ?? "secondary"} btn-${opts.size ?? "md"} ${opts.className ?? ""}`.trim());
  b.type = "button";
  b.tabIndex = -1;
  if (opts.icon) b.append(svg(opts.icon, "btn-icon"));
  if (label !== null && label !== undefined && label !== false) b.append(h("span", "btn-label", label));
  if (opts.ariaLabel) b.setAttribute("aria-label", opts.ariaLabel);
  b.disabled = opts.disabled ?? false;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("pointerenter", () => {
    if (!b.disabled) uiSound("hover");
  });
  b.addEventListener("click", (e) => {
    e.preventDefault();
    b.blur();
    if (b.disabled) return;
    uiSound("click");
    onClick();
  });
  return b;
}

/** Restart a short Web Animation on an element (cheap: no forced reflow). */
export function pop(el: Element, keyframes: Keyframe[], duration: number, easing = "cubic-bezier(.2,.9,.3,1.4)"): void {
  if (typeof el.animate !== "function") return;
  el.getAnimations?.().forEach((a) => {
    if (a.id === "pop") a.cancel();
  });
  const a = el.animate(keyframes, { duration, easing });
  a.id = "pop";
}

export const POP_SCALE: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1)" }];
