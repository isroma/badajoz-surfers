/** In-run HUD. `render()` is called every frame and only touches the DOM when a value changed. */
import { POWERUPS, WORD, type HudSnapshot, type PowerupKind } from "../contracts";
import { formatInt, formatMetres } from "../meta/format";
import { POP_SCALE, h, pop, svg } from "./dom";
import { ICON_BELLOTA, ICON_WAITER, POWERUP_COLORS, powerupIcon } from "./icons";

interface PowerupRow {
  el: HTMLElement;
  fill: HTMLElement;
  secs: HTMLElement;
  lastSecs: number;
  ending: boolean;
}

const freshLast = () => ({
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
      h("div", "hud-tl", zoneCard, this.powerupsEl),
      h("div", "hud-tc", this.lettersEl),
      h(
        "div",
        "hud-tr",
        h("div", "score-label", "Puntos"),
        this.scoreEl,
        h("div", "score-row", this.multEl, this.bellotaPill),
      ),
      this.chaserEl,
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
  }

  render(hud: HudSnapshot): void {
    const L = this.last;
    const score = Math.floor(hud.score);
    if (score !== L.score) {
      // Pop on every 1.000 points crossed.
      if (L.score >= 0 && Math.floor(score / 1000) > Math.floor(L.score / 1000)) pop(this.scoreEl, POP_SCALE, 260);
      L.score = score;
      this.scoreEl.textContent = formatInt(score);
    }
    const bellotas = Math.floor(hud.bellotas);
    if (bellotas !== L.bellotas) {
      if (L.bellotas >= 0 && bellotas > L.bellotas) pop(this.bellotaPill, POP_SCALE, 200);
      L.bellotas = bellotas;
      this.bellotasEl.textContent = formatInt(bellotas);
    }
    const dist = Math.floor(hud.distance);
    if (dist !== L.distance) {
      L.distance = dist;
      this.distEl.textContent = formatMetres(dist);
    }
    if (hud.multiplier !== L.multiplier) {
      if (L.multiplier > 0) pop(this.multEl, POP_SCALE, 320);
      L.multiplier = hud.multiplier;
      this.multEl.textContent = `×${formatInt(hud.multiplier)}`;
    }
    if (hud.zone.id !== L.zone) {
      L.zone = hud.zone.id;
      this.zoneName.textContent = hud.zone.name;
    }
    if (hud.lap !== L.lap) {
      L.lap = hud.lap;
      this.lapEl.textContent = `Vuelta ${formatInt(hud.lap)}`;
    }
    const progress = Math.round(Math.min(1, Math.max(0, hud.zoneProgress)) * 200) / 200;
    if (progress !== L.progress) {
      L.progress = progress;
      this.zoneFill.style.transform = `scaleX(${progress})`;
    }
    const letters = hud.letters.map((b) => (b ? "1" : "0")).join("");
    if (letters !== L.letters) {
      this.letterEls.forEach((el, i) => {
        const on = hud.letters[i] === true;
        const was = L.letters[i] === "1";
        el.classList.toggle("on", on);
        if (on && !was && L.letters !== "") pop(el, [{ transform: "scale(1.6) rotate(-8deg)" }, { transform: "scale(1)" }], 380);
      });
      L.letters = letters;
    }
    this.renderPowerups(hud);
    const chaser = Math.round(Math.min(1, Math.max(0, hud.chaser)) * 50) / 50;
    if (chaser !== L.chaser) {
      L.chaser = chaser;
      this.vignette.style.opacity = String(Math.min(1, chaser * 1.1));
      this.vignette.classList.toggle("hot", chaser > 0.6);
      this.chaserEl.classList.toggle("show", chaser > 0.04);
      this.chaserEl.classList.toggle("hot", chaser > 0.6);
      this.chaserFill.style.transform = `scaleX(${chaser})`;
      this.chaserLabel.textContent = chaser > 0.6 ? "¡Que te pilla!" : chaser > 0.3 ? "Te pisa los talones" : "El camarero";
    }
  }

  private renderPowerups(hud: HudSnapshot): void {
    const active = new Set<PowerupKind>();
    for (const p of hud.powerups) {
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
      const ratio = p.duration > 0 ? Math.min(1, Math.max(0, p.remaining / p.duration)) : 0;
      row.fill.style.transform = `scaleX(${ratio.toFixed(3)})`;
      const s = Math.ceil(Math.max(0, p.remaining));
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
