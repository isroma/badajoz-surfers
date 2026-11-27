/**
 * In-run HUD, flat: compact ink chips. Score top right, zone and street top left, letters top
 * centre, minimap bottom left; power-up timers, the waiter bar and the turn hint only while
 * they matter. `render()` is called every frame and only touches the DOM when a value changed.
 */
import { POWERUPS, WORD, ZONES, type HudSnapshot, type PowerupKind } from "../contracts";
import { formatInt, formatMetres } from "../meta/format";
import { h, pop, svg } from "./dom";

/** A small, calm pulse (no bounce). */
const POP_SCALE: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }];
import { GLYPH_ROUNDABOUT, GLYPH_TURN, ICON_BELLOTA, ICON_WAITER, powerupIcon } from "./icons";
import { Minimap, zoneIndexOf } from "./minimap";

/** Street types that go on the small top line of a plaque ("AVENIDA" over "Sinforiano Madroñero"). */
const STREET_TYPES = ["Avenida", "Calle", "Plaza", "Paseo", "Travesía", "Ronda", "Glorieta", "Carretera", "Camino", "Callejón", "Plazuela"];

/** "Avenida Sinforiano Madroñero" → ["Avenida", "Sinforiano Madroñero"]; "Puente Real" → [null, "Puente Real"]. */
export function splitStreet(name: string): [string | null, string] {
  const trimmed = name.trim();
  const sp = trimmed.indexOf(" ");
  if (sp > 0) {
    const first = trimmed.slice(0, sp);
    if (STREET_TYPES.includes(first)) return [first, trimmed.slice(sp + 1)];
  }
  return [null, trimmed];
}

/** Names that are too long for the zone chip. */
const HUD_ZONE_NAMES: Record<string, string> = { "alcazaba-palmas": "Alcazaba y Pta. de Palmas" };

/** The next turn, as the HUD shows it. */
export interface TurnHint {
  dir: "left" | "right" | "straight";
  roundabout: boolean;
  /** Street after the turn. */
  name: string | null;
}

interface PowerupRow {
  el: HTMLElement;
  ring: SVGCircleElement;
  secs: HTMLElement;
  lastSecs: number;
  ending: boolean;
}

/** NaN-safe integer and 0..1 coercions: a glitchy snapshot shows zeros instead of "NaN". */
const int = (v: number): number => (Number.isFinite(v) ? Math.floor(v) : 0);
const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const freshLast = () => ({
  mapZone: "",
  score: -1,
  bellotas: -1,
  distance: -1,
  multiplier: -1,
  zone: "",
  lap: -1,
  progress: -1,
  letters: "",
  chaser: -1,
});

const RING = `<svg viewBox="0 0 36 36" class="ring"><circle cx="18" cy="18" r="16" pathLength="100" class="ring-bg"/><circle cx="18" cy="18" r="16" pathLength="100" class="ring-fg"/></svg>`;

export class Hud {
  readonly el: HTMLElement;
  private readonly zoneName: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bellotasEl: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly lettersEl: HTMLElement;
  private readonly letterEls: HTMLElement[];
  private readonly powerupsEl: HTMLElement;
  private readonly rows = new Map<PowerupKind, PowerupRow>();
  private readonly chaserEl: HTMLElement;
  private readonly chaserFill: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly minimap = new Minimap({ className: "hud-map" });
  private readonly plaque: HTMLElement;
  private street: string | null = null;
  private readonly hornEl: HTMLElement;
  private readonly turnEl: HTMLElement;
  private turnKey = "";

  private last = freshLast();

  constructor() {
    this.zoneName = h("div", "zone-name");
    this.lapEl = h("span", "lap");
    this.distEl = h("span", "dist");
    this.plaque = h("div", "plaque");
    this.plaque.hidden = true;
    const zoneCard = h("div", "chip zone-card", this.zoneName, h("div", "zone-meta", this.lapEl, h("span", "dot", "·"), this.distEl), this.plaque);
    this.powerupsEl = h("div", "powerups");

    this.letterEls = [...WORD].map((ch) => h("div", "letter", ch));
    this.lettersEl = h("div", "chip letters", ...this.letterEls);
    this.turnEl = h("div", "chip turn");
    this.hornEl = h("div", "horn-warn");

    this.scoreEl = h("div", "score", "0");
    this.bellotasEl = h("span", "num", "0");
    this.multEl = h("span", "mult", "×1");

    this.flashEl = h("div", "flash");
    this.chaserFill = h("i");
    this.chaserEl = h("div", "chip chaser", svg(ICON_WAITER), h("div", "bar", this.chaserFill));
    this.chaserEl.title = "El camarero";

    this.el = h(
      "div",
      "hud",
      this.flashEl,
      this.hornEl,
      h("div", "hud-tl", zoneCard, this.powerupsEl),
      h("div", "hud-tc", this.lettersEl, this.turnEl),
      h("div", "hud-tr", h("div", "chip score-card", this.scoreEl, h("div", "score-row", this.multEl, h("span", "bell", svg(ICON_BELLOTA), this.bellotasEl)))),
      h("div", "hud-bl", h("div", "map-card", this.minimap.el)),
      h("div", "hud-bc", this.chaserEl),
    );
    this.el.hidden = true;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  /** Forget cached values so the next render repaints everything (new run). */
  reset(): void {
    this.last = freshLast();
    for (const row of this.rows.values()) row.el.remove();
    this.rows.clear();
    this.lettersEl.classList.remove("complete");
    this.street = null;
    this.plaque.replaceChildren();
    this.plaque.hidden = true;
    this.setTurn(null);
    this.chaserEl.classList.remove("show", "hot");
    for (const el of [this.flashEl, this.hornEl, this.el]) el.getAnimations?.().forEach((a) => a.cancel());
  }

  render(hud: HudSnapshot): void {
    const L = this.last;
    const score = int(hud.score);
    if (score !== L.score) {
      L.score = score;
      this.scoreEl.textContent = formatInt(score);
    }
    const bellotas = int(hud.bellotas);
    if (bellotas !== L.bellotas) {
      L.bellotas = bellotas;
      this.bellotasEl.textContent = formatInt(bellotas);
    }
    const dist = int(hud.distance);
    if (dist !== L.distance) {
      L.distance = dist;
      this.distEl.textContent = formatMetres(dist);
    }
    const mult = Math.max(1, int(hud.multiplier));
    if (mult !== L.multiplier) {
      if (L.multiplier > 0) pop(this.multEl, POP_SCALE, 220, "ease-out");
      L.multiplier = mult;
      this.multEl.textContent = `×${formatInt(mult)}`;
    }
    const zone = hud.zone ?? ZONES[0];
    if (zone && zone.id !== L.zone) {
      L.zone = zone.id;
      this.zoneName.textContent = HUD_ZONE_NAMES[zone.id] ?? zone.name;
    }
    const lap = Math.max(1, int(hud.lap));
    if (lap !== L.lap) {
      L.lap = lap;
      this.lapEl.textContent = `Vuelta ${formatInt(lap)}`;
    }
    const progress = Math.round(unit(hud.zoneProgress) * 400) / 400;
    if (progress !== L.progress || L.zone !== L.mapZone) {
      L.progress = progress;
      L.mapZone = L.zone;
      this.minimap.update(zoneIndexOf(L.zone), progress);
    }
    const flags = Array.isArray(hud.letters) ? hud.letters : [];
    const letters = this.letterEls.map((_, i) => (flags[i] === true ? "1" : "0")).join("");
    if (letters !== L.letters) {
      this.letterEls.forEach((el, i) => el.classList.toggle("on", flags[i] === true));
      L.letters = letters;
    }
    this.renderPowerups(hud);
    const chaser = Math.round(unit(hud.chaser) * 50) / 50;
    if (chaser !== L.chaser) {
      L.chaser = chaser;
      // Only when the waiter is close.
      this.chaserEl.classList.toggle("show", chaser > 0.3);
      this.chaserEl.classList.toggle("hot", chaser > 0.6);
      this.chaserFill.style.transform = `scaleX(${chaser})`;
    }
  }

  /**
   * The street the runner is on, as an enamel street plaque under the zone. A new name slides
   * in over the old one; null hides the plaque (unnamed links and roundabouts).
   */
  setStreet(name: string | null): void {
    const next = name && name.trim() ? name.trim() : null;
    if (next === this.street) return;
    const first = this.street === null;
    this.street = next;
    for (const old of [...this.plaque.children]) {
      if (old.classList.contains("out")) continue;
      old.classList.add("out");
      window.setTimeout(() => old.remove(), 260);
    }
    if (!next) {
      this.plaque.classList.add("empty");
      return;
    }
    const [type, rest] = splitStreet(next);
    const inner = h("div", `plaque-in${first ? "" : " in"}${rest.length > 22 ? " long" : ""}`, type ? h("small", undefined, type) : null, h("b", undefined, rest));
    inner.title = next;
    this.plaque.classList.remove("empty");
    this.plaque.hidden = false;
    this.plaque.append(inner);
  }

  /** The next turn (null hides the hint). */
  setTurn(turn: TurnHint | null): void {
    const key = turn ? `${turn.dir}|${turn.roundabout}|${turn.name ?? ""}` : "";
    if (key === this.turnKey) return;
    this.turnKey = key;
    if (!turn) {
      this.turnEl.classList.remove("show");
      return;
    }
    const glyph = svg(turn.roundabout ? GLYPH_ROUNDABOUT : GLYPH_TURN, "turn-icon");
    const deg = turn.roundabout ? (turn.dir === "left" ? 180 : turn.dir === "straight" ? -90 : 0) : 0;
    glyph.style.transform = `${turn.dir === "left" && !turn.roundabout ? "scaleX(-1)" : ""} rotate(${deg}deg)`;
    if (turn.dir === "straight" && !turn.roundabout) glyph.style.transform = "rotate(-90deg)";
    this.turnEl.replaceChildren(glyph, h("span", undefined, turn.name ?? (turn.roundabout ? "Rotonda" : turn.dir === "left" ? "Gira a la izquierda" : "Gira a la derecha")));
    this.turnEl.classList.add("show");
  }

  /** Redraw the route map (the real map data arrived). */
  refreshMap(): void {
    this.minimap.update(zoneIndexOf(this.last.zone), Math.max(0, this.last.progress));
  }

  /** An oncoming vehicle honked: a red line on the top edge (the shell adds a one-line warning). */
  horn(): void {
    pop(this.hornEl, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], 1100, "linear");
  }

  private renderPowerups(hud: HudSnapshot): void {
    const active = new Set<PowerupKind>();
    for (const p of Array.isArray(hud.powerups) ? hud.powerups : []) {
      if (!POWERUPS[p.kind]) continue;
      active.add(p.kind);
      let row = this.rows.get(p.kind);
      if (!row) {
        const secs = h("small");
        const icon = h("div", "pu-icon", svg(powerupIcon(p.kind)));
        icon.insertAdjacentHTML("afterbegin", RING);
        const el = h("div", "chip pu", icon, h("span", "pu-name", POWERUPS[p.kind].name), secs);
        this.powerupsEl.append(el);
        row = { el, ring: icon.querySelector(".ring-fg") as SVGCircleElement, secs, lastSecs: -1, ending: false };
        this.rows.set(p.kind, row);
      }
      const ratio = p.duration > 0 ? unit(p.remaining / p.duration) : 0;
      row.ring.style.strokeDashoffset = (100 - ratio * 100).toFixed(1);
      const s = Math.ceil(Math.max(0, Number.isFinite(p.remaining) ? p.remaining : 0));
      if (s !== row.lastSecs) {
        row.lastSecs = s;
        row.secs.textContent = `${s} s`;
      }
      const ending = p.remaining < 2.5;
      if (ending !== row.ending) {
        row.ending = ending;
        row.el.classList.toggle("ending", ending);
      }
    }
    for (const [kind, row] of this.rows) {
      if (!active.has(kind)) {
        row.el.remove();
        this.rows.delete(kind);
      }
    }
  }

  wordComplete(): void {
    pop(this.lettersEl, POP_SCALE, 360, "ease-out");
  }

  stumble(): void {
    pop(
      this.el,
      [{ transform: "translate(0,0)" }, { transform: "translate(-0.4rem,0)" }, { transform: "translate(0.3rem,0)" }, { transform: "translate(0,0)" }],
      260,
      "linear",
    );
    pop(this.flashEl, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], 300, "ease-out");
  }
}
