/** In-run HUD. `render()` is called every frame and only touches the DOM when a value changed. */
import { POWERUPS, WORD, ZONES, type HudSnapshot, type PowerupKind } from "../contracts";
import { formatInt, formatMetres } from "../meta/format";
import { POP_SCALE, h, pop, svg } from "./dom";
import { ICON_BELLOTA, ICON_WAITER, POWERUP_COLORS, powerupIcon } from "./icons";
import { Minimap, zoneIndexOf } from "./minimap";

/** Names that are too long for the zone card. */
const HUD_ZONE_NAMES: Record<string, string> = { "alcazaba-palmas": "Alcazaba y Pta. de Palmas" };

/** Danger vignette: off until the waiter is close (chaser > 0.3), then a smooth ramp. */
const vignetteOpacity = (chaser: number): number => {
  const t = Math.min(1, Math.max(0, (chaser - 0.3) / 0.6));
  return t * t * (3 - 2 * t);
};

interface PowerupRow {
  el: HTMLElement;
  fill: HTMLElement;
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
  roof: -1,
});

export class Hud {
  readonly el: HTMLElement;
  private readonly zoneName: HTMLElement;
  private readonly zoneFill: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bellotasEl: HTMLElement;
  private readonly bellotaPill: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly lettersEl: HTMLElement;
  private readonly letterEls: HTMLElement[];
  private readonly powerupsEl: HTMLElement;
  private readonly rows = new Map<PowerupKind, PowerupRow>();
  private readonly vignette: HTMLElement;
  private readonly chaserEl: HTMLElement;
  private readonly chaserFill: HTMLElement;
  private readonly chaserLabel: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly roofEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly comboNum: HTMLElement;
  private readonly goldFlash: HTMLElement;
  private comboShown = false;
  private readonly roofNum: HTMLElement;
  private readonly minimap = new Minimap({ className: "hud-map" });
  /** Roof streak: metres since the runner got onto a roof, and when it last grew. */
  private roofStreakStart = 0;
  private roofLastGrow = -1;
  private roofShown = false;

  private last = freshLast();

  constructor() {
    this.zoneName = h("div", "zone-name");
    this.zoneFill = h("i");
    this.lapEl = h("span", "lap");
    this.distEl = h("span", "dist");
    const zoneCard = h(
      "div",
      "zone-card panel",
      this.zoneName,
      h("div", "bar", this.zoneFill),
      h("div", "zone-meta", this.lapEl, this.distEl),
    );
    this.powerupsEl = h("div", "powerups");

    this.letterEls = [...WORD].map((ch) => h("div", "letter", ch));
    this.lettersEl = h("div", "letters panel", ...this.letterEls);

    this.scoreEl = h("div", "score display", "0");
    this.bellotasEl = h("span", "num", "0");
    this.bellotaPill = h("div", "pill hud-bellotas", svg(ICON_BELLOTA), this.bellotasEl);
    this.multEl = h("div", "mult-badge", "×1");

    this.roofNum = h("b", undefined, "0 m");
    this.roofEl = h("div", "roof-pill", h("span", undefined, "Por los techos"), h("span", "dot", "·"), this.roofNum);
    this.comboNum = h("b", undefined, "x0");
    this.comboEl = h("div", "combo-chip", this.comboNum, h("span", undefined, "bellotas seguidas"));
    this.goldFlash = h("div", "flash gold");
    this.vignette = h("div", "vignette");
    this.flashEl = h("div", "flash");
    this.chaserFill = h("i");
    this.chaserLabel = h("b", undefined, "El camarero");
    this.chaserEl = h(
      "div",
      "chaser panel",
      svg(ICON_WAITER),
      h("div", "chaser-text", this.chaserLabel, h("div", "bar", this.chaserFill)),
    );

    this.el = h(
      "div",
      "hud",
      this.vignette,
      this.flashEl,
      this.goldFlash,
      h("div", "hud-tl", zoneCard, this.powerupsEl),
      h("div", "hud-tc", this.lettersEl),
      h(
        "div",
        "hud-tr",
        h("div", "score-label", "Puntos"),
        this.scoreEl,
        h("div", "score-row", this.multEl, this.bellotaPill),
        this.comboEl,
        this.roofEl,
      ),
      h("div", "hud-bl", h("div", "panel map-card", this.minimap.el), this.chaserEl),
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
    this.roofStreakStart = 0;
    this.roofLastGrow = -1;
    this.roofShown = false;
    this.roofEl.classList.remove("show");
    this.comboShown = false;
    this.comboEl.classList.remove("show");
    // Danger vignette, chaser badge, flashes: back to calm.
    this.vignette.style.opacity = "0";
    this.vignette.classList.remove("hot");
    this.chaserEl.classList.remove("show", "hot");
    for (const el of [this.flashEl, this.goldFlash, this.el]) el.getAnimations?.().forEach((a) => a.cancel());
  }

  render(hud: HudSnapshot): void {
    const L = this.last;
    const score = int(hud.score);
    if (score !== L.score) {
      // Pop on every 1.000 points crossed.
      if (L.score >= 0 && Math.floor(score / 1000) > Math.floor(L.score / 1000)) pop(this.scoreEl, POP_SCALE, 260);
      L.score = score;
      this.scoreEl.textContent = formatInt(score);
    }
    const bellotas = int(hud.bellotas);
    if (bellotas !== L.bellotas) {
      if (L.bellotas >= 0 && bellotas > L.bellotas) pop(this.bellotaPill, POP_SCALE, 200);
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
      if (L.multiplier > 0) pop(this.multEl, POP_SCALE, 320);
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
    const progress = Math.round(unit(hud.zoneProgress) * 200) / 200;
    if (progress !== L.progress || L.zone !== L.mapZone) {
      L.progress = progress;
      L.mapZone = L.zone;
      this.zoneFill.style.transform = `scaleX(${progress})`;
      this.minimap.update(zoneIndexOf(L.zone), progress);
    }
    const flags = Array.isArray(hud.letters) ? hud.letters : [];
    const letters = this.letterEls.map((_, i) => (flags[i] === true ? "1" : "0")).join("");
    if (letters !== L.letters) {
      this.letterEls.forEach((el, i) => {
        const on = flags[i] === true;
        const was = L.letters[i] === "1";
        el.classList.toggle("on", on);
        if (on && !was && L.letters !== "") pop(el, [{ transform: "scale(1.6) rotate(-8deg)" }, { transform: "scale(1)" }], 380);
      });
      L.letters = letters;
    }
    this.renderPowerups(hud);
    this.renderRoof(hud.roofMetres);
    const chaser = Math.round(unit(hud.chaser) * 50) / 50;
    if (chaser !== L.chaser) {
      L.chaser = chaser;
      this.vignette.style.opacity = vignetteOpacity(chaser).toFixed(3);
      this.vignette.classList.toggle("hot", chaser > 0.7);
      this.chaserEl.classList.toggle("show", chaser > 0.04);
      this.chaserEl.classList.toggle("hot", chaser > 0.6);
      this.chaserFill.style.transform = `scaleX(${chaser})`;
      this.chaserLabel.textContent = chaser > 0.6 ? "¡Que te pilla!" : chaser > 0.3 ? "Te pisa los talones" : "El camarero";
    }
  }

  /** "Por los techos · 35 m" while the roof metres keep growing; hides shortly after. */
  private renderRoof(roofMetres: number): void {
    const now = performance.now();
    const roof = Math.floor(Number.isFinite(roofMetres) ? roofMetres : 0);
    const L = this.last;
    if (L.roof < 0 || roof < L.roof) {
      L.roof = roof;
      return;
    }
    if (roof > L.roof) {
      if (!this.roofShown) this.roofStreakStart = L.roof;
      this.roofLastGrow = now;
      L.roof = roof;
      this.roofNum.textContent = formatMetres(roof - this.roofStreakStart);
      if (!this.roofShown) {
        this.roofShown = true;
        this.roofEl.classList.add("show");
      }
    } else if (this.roofShown && now - this.roofLastGrow > 900) {
      this.roofShown = false;
      this.roofEl.classList.remove("show");
    }
  }

  /** Bellota combo chip ("x25 bellotas seguidas"), shown from 5 in a row. */
  setCombo(count: number): void {
    if (count < 5) {
      this.comboAlive(false);
      return;
    }
    this.comboNum.textContent = `x${formatInt(count)}`;
    if (!this.comboShown) {
      this.comboShown = true;
      this.comboEl.classList.add("show");
    }
    if (count % 5 === 0) pop(this.comboEl, POP_SCALE, 220);
  }

  comboAlive(alive: boolean): void {
    if (alive || !this.comboShown) return;
    this.comboShown = false;
    this.comboEl.classList.remove("show");
  }

  /** Brief golden flash for big rewards. */
  rewardFlash(): void {
    pop(this.goldFlash, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], 520, "ease-out");
  }

  private renderPowerups(hud: HudSnapshot): void {
    const active = new Set<PowerupKind>();
    for (const p of Array.isArray(hud.powerups) ? hud.powerups : []) {
      if (!POWERUPS[p.kind]) continue;
      active.add(p.kind);
      let row = this.rows.get(p.kind);
      if (!row) {
        const fill = h("i");
        const secs = h("small");
        const icon = h("div", "pu-icon", svg(powerupIcon(p.kind)));
        const el = h(
          "div",
          "pu panel",
          icon,
          h("div", "pu-name", h("span", undefined, POWERUPS[p.kind].name), secs),
          h("div", "bar", fill),
        );
        el.style.setProperty("--pu-color", POWERUP_COLORS[p.kind]);
        this.powerupsEl.append(el);
        row = { el, fill, secs, lastSecs: -1, ending: false };
        this.rows.set(p.kind, row);
      }
      const ratio = p.duration > 0 ? unit(p.remaining / p.duration) : 0;
      row.fill.style.transform = `scaleX(${ratio.toFixed(3)})`;
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
    this.lettersEl.classList.remove("complete");
    void this.lettersEl.offsetWidth;
    this.lettersEl.classList.add("complete");
    window.setTimeout(() => this.lettersEl.classList.remove("complete"), 1600);
  }

  stumble(): void {
    pop(
      this.el,
      [
        { transform: "translate(0,0)" },
        { transform: "translate(-0.6rem,0.2rem)" },
        { transform: "translate(0.5rem,-0.2rem)" },
        { transform: "translate(-0.35rem,0.1rem)" },
        { transform: "translate(0.2rem,0)" },
        { transform: "translate(0,0)" },
      ],
      420,
      "linear",
    );
    pop(this.flashEl, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], 380, "ease-out");
  }
}
