/** Builders for the menu, panels (how to play, missions, shop), pause and game-over screens. */
import { POWERUPS, type PowerupKind, type RunSummary } from "../contracts";
import type { MetaStore, MissionView, RunResult } from "../meta";
import { MAX_UPGRADE_LEVEL, powerupDuration, upgradeCost } from "../meta/economy";
import { formatInt, formatMetres, formatSeconds } from "../meta/format";
import { gameOverHeadline, PREMISE } from "./copy";
import { button, h, svg, type Child } from "./dom";
import {
  GLYPH_BACK,
  GLYPH_CHECK,
  GLYPH_FLAG,
  GLYPH_HELP,
  GLYPH_HOME,
  GLYPH_MUSIC,
  GLYPH_PLAY,
  GLYPH_REPLAY,
  GLYPH_SHOP,
  GLYPH_SOUND_ON,
  GLYPH_TROPHY,
  ICON_BELLOTA,
  ICON_JAMON,
  ICON_PATINETE,
  ICON_WAITER,
  ICON_ZAPATILLAS,
  POWERUP_COLORS,
  powerupIcon,
} from "./icons";

export type PanelId = "howto" | "missions" | "shop";

export interface ScreenActions {
  play(): void;
  openPanel(panel: PanelId): void;
  closePanel(): void;
  resume(): void;
  toMenu(): void;
  restart(): void;
  buy(kind: PowerupKind): void;
  toggle(setting: "music" | "sfx"): void;
  setVolume(volume: number): void;
}

export interface ScreenCtx {
  store: MetaStore;
  actions: ScreenActions;
}

// ------------------------------------------------------------------ shared pieces

export function logo(): HTMLElement {
  const wrap = h("div", "logo-wrap");
  wrap.innerHTML = `
  <svg class="logo" viewBox="0 0 620 230" role="img" aria-label="Simpa">
    <defs>
      <linearGradient id="logo-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFE9A3"/>
        <stop offset="0.45" stop-color="#FFC53D"/>
        <stop offset="1" stop-color="#F08A0B"/>
      </linearGradient>
    </defs>
    <g transform="rotate(-5 310 120)">
      <text x="300" y="186" text-anchor="middle" font-size="184" textLength="540" lengthAdjust="spacingAndGlyphs"
        fill="#1d1020" stroke="#1d1020" stroke-width="30" stroke-linejoin="round" transform="translate(0 12)">SIMPA</text>
      <text x="300" y="186" text-anchor="middle" font-size="184" textLength="540" lengthAdjust="spacingAndGlyphs"
        fill="url(#logo-fill)" stroke="#1d1020" stroke-width="26" stroke-linejoin="round" paint-order="stroke">SIMPA</text>
      <path d="M62 82 Q 160 52 250 64" fill="none" stroke="#fff6d8" stroke-width="9" stroke-linecap="round" opacity="0.75"/>
    </g>
    <g transform="translate(528 6) rotate(18 40 40) scale(1.25)">${ICON_BELLOTA.replace("<svg ", '<svg width="64" height="64" ')}</g>
  </svg>`;
  return wrap;
}

const keys = (...labels: string[]): HTMLElement[] => labels.map((l) => h("kbd", undefined, l));

function joinKeys(groups: string[][]): HTMLElement {
  const el = h("div", "control-keys");
  groups.forEach((g, i) => {
    if (i > 0) el.append(h("span", "sep", "o"));
    el.append(...keys(...g));
  });
  return el;
}

export function soundToggles(ctx: ScreenCtx, withVolume: boolean): HTMLElement {
  const s = ctx.store.settings;
  const music = button("Música", () => ctx.actions.toggle("music"), { variant: "ghost", size: "sm", icon: GLYPH_MUSIC, className: "toggle" });
  music.dataset["toggle"] = "music";
  music.classList.toggle("off", !s.music);
  const sfx = button("Efectos", () => ctx.actions.toggle("sfx"), { variant: "ghost", size: "sm", icon: GLYPH_SOUND_ON, className: "toggle" });
  sfx.dataset["toggle"] = "sfx";
  sfx.classList.toggle("off", !s.sfx);
  const el = h("div", "toggles", music, sfx);
  if (withVolume) {
    const input = h("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(Math.round(s.volume * 100));
    input.tabIndex = -1;
    input.dataset["bind"] = "volume";
    input.setAttribute("aria-label", "Volumen");
    input.addEventListener("input", () => ctx.actions.setVolume(Number(input.value) / 100));
    input.addEventListener("change", () => input.blur());
    el.append(h("label", "volume", "Volumen", input));
  }
  return el;
}

/** Refresh toggles, wallet and other bound values after the save changed. */
export function syncBindings(root: HTMLElement, store: MetaStore): void {
  const s = store.settings;
  root.querySelectorAll<HTMLElement>("[data-toggle]").forEach((el) => {
    const key = el.dataset["toggle"];
    if (key === "music" || key === "sfx") el.classList.toggle("off", !s[key]);
  });
  root.querySelectorAll<HTMLElement>('[data-bind="wallet"]').forEach((el) => {
    el.textContent = formatInt(store.save.wallet);
  });
}

function walletPill(store: MetaStore): HTMLElement {
  const num = h("span", undefined, formatInt(store.save.wallet));
  num.dataset["bind"] = "wallet";
  return h("div", "pill", svg(ICON_BELLOTA), num);
}

function missionRow(v: MissionView, index: number, fresh = false): HTMLElement {
  const fill = h("i");
  fill.style.transform = `scaleX(${v.ratio})`;
  return h(
    "div",
    `mission${v.done ? " done" : ""}${fresh ? " fresh" : ""}`,
    h("div", "num", v.done ? svg(GLYPH_CHECK) : String(index + 1)),
    h("div", "mission-text", v.text),
    h("div", "mission-label", v.label),
    h("div", "bar", fill),
  );
}

function miniMission(v: MissionView): HTMLElement {
  const fill = h("i");
  fill.style.transform = `scaleX(${v.ratio})`;
  return h(
    "div",
    `mini-mission${v.done ? " done" : ""}`,
    h("div", "check", v.done ? svg(GLYPH_CHECK) : null),
    h("div", "mini-text", h("span", undefined, v.text), h("small", undefined, v.label)),
    h("div", "bar", fill),
  );
}

function modal(className: string, ...children: Child[]): HTMLElement {
  return h("div", "screen modal-backdrop", h("div", `modal panel ${className}`, ...children));
}

function modalHead(title: string, sub: string, right?: Child): HTMLElement {
  return h(
    "div",
    "modal-head",
    h("div", undefined, h("h2", "modal-title display tilt", title), h("p", "modal-sub", sub)),
    right ?? null,
  );
}

// ------------------------------------------------------------------ main menu

export function menuScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const save = store.save;
  const premise = h("p", "premise");
  premise.innerHTML = PREMISE.replace(" El camarero no perdona.", "<br><b>El camarero no perdona.</b>");

  const left = h(
    "div",
    "menu-left",
    logo(),
    h("div", "ribbon", "Corre por Badajoz"),
    premise,
    h(
      "div",
      "play-row",
      button("Jugar", actions.play, { variant: "primary", size: "xl", icon: GLYPH_PLAY, className: "btn-play" }),
      h("div", "hint", "Pulsa", ...keys("Espacio"), "o", ...keys("Intro")),
    ),
    h(
      "div",
      "menu-actions",
      button("Misiones", () => actions.openPanel("missions"), { icon: GLYPH_FLAG }),
      button("Tienda", () => actions.openPanel("shop"), { icon: GLYPH_SHOP }),
      button("Cómo se juega", () => actions.openPanel("howto"), { icon: GLYPH_HELP }),
    ),
  );

  const walletValue = h("span", undefined, formatInt(save.wallet));
  walletValue.dataset["bind"] = "wallet";
  const stats = h(
    "div",
    "stat-card panel",
    stat("Récord", h("div", "stat-value sun", svg(GLYPH_TROPHY), formatInt(save.bestScore))),
    stat("Mejor distancia", h("div", "stat-value", formatMetres(save.bestDistance))),
    stat("Bellotas", h("div", "stat-value", svg(ICON_BELLOTA), walletValue)),
    stat("Multiplicador", h("div", "stat-value", h("span", "mult-badge", `×${formatInt(store.multiplier)}`))),
  );
  const views = store.missionViews();
  const missions = h(
    "div",
    "missions-mini panel",
    h(
      "div",
      "mini-head",
      h("div", "mini-title", "Misiones"),
      button("Ver", () => actions.openPanel("missions"), { size: "sm", variant: "ghost" }),
    ),
    ...views.map(miniMission),
  );
  const right = h("div", "menu-right", stats, missions);
  return h("div", "screen menu", left, right, h("div", "menu-top", soundToggles(ctx, false)));
}

function stat(label: string, value: HTMLElement): HTMLElement {
  return h("div", "stat", h("div", "stat-label", label), value);
}

// ------------------------------------------------------------------ how to play

export function howtoScreen(firstTime: boolean, onDone: () => void): HTMLElement {
  const controls = h(
    "div",
    "controls",
    control(joinKeys([["A", "D"], ["←", "→"]]), "Cambiar de carril"),
    control(joinKeys([["W"], ["↑"], ["Espacio"]]), "Saltar"),
    control(joinKeys([["S"], ["↓"]]), "Rodar por debajo"),
    control(joinKeys([["Esc"], ["P"]]), "Pausa"),
  );
  const tip = (icon: string, html: string): HTMLElement => {
    const text = h("span");
    text.innerHTML = html;
    return h("li", "tip", svg(icon), text);
  };
  const tips = h(
    "ul",
    "tips",
    tip(ICON_PATINETE, "<b>Súbete a los coches</b> y contenedores: por arriba también se corre."),
    tip(ICON_ZAPATILLAS, "Usa las <b>rampas de la grúa</b> para correr por los techos de furgonetas y autobuses."),
    tip(ICON_WAITER, "<b>Dos tropiezos seguidos</b> y te pilla el camarero. ¡Ni se te ocurra!"),
    tip(ICON_JAMON, "Recoge las letras de <b>BADAJOZ</b> y gasta tus <b>bellotas</b> en la Tienda."),
  );
  const cta = button(firstTime ? "¡A correr!" : "¡Entendido!", onDone, {
    variant: "primary",
    size: "lg",
    icon: firstTime ? GLYPH_PLAY : GLYPH_CHECK,
  });
  return modal(
    "howto",
    modalHead("Cómo se juega", firstTime ? "Antes de salir corriendo, un par de cosas." : "Lo básico para escapar del camarero."),
    h("div", "howto-grid", controls, tips),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys(firstTime ? "Intro" : "Esc"), firstTime ? "para empezar" : "para volver"),
      cta,
    ),
  );
}

function control(keysEl: HTMLElement, label: string): HTMLElement {
  return h("div", "control", keysEl, h("div", "control-label", label));
}

// ------------------------------------------------------------------ missions

export function missionsScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const m = store.multiplier;
  const sets = store.save.missions.setsCompleted;
  const hero = h("div", "mult-hero", h("div", "big display", `×${formatInt(m)}`));
  const p = h("p");
  p.innerHTML =
    m >= 10
      ? "¡Multiplicador al máximo! Sigue completando misiones para presumir."
      : `Completa las tres misiones para subir tu multiplicador a <b>×${formatInt(m + 1)}</b>. Cada serie es un poco más difícil.`;
  hero.append(p);
  return modal(
    "missions",
    modalHead("Misiones", `Serie ${formatInt(sets + 1)}`, walletPill(store)),
    hero,
    h("div", "mission-list", ...store.missionViews().map((v, i) => missionRow(v, i))),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("Volver", actions.closePanel, { icon: GLYPH_BACK, size: "lg" }),
    ),
  );
}

// ------------------------------------------------------------------ shop

export interface ShopScreen {
  el: HTMLElement;
  update(): void;
}

export function shopScreen(ctx: ScreenCtx): ShopScreen {
  const { store, actions } = ctx;
  const kinds = Object.keys(POWERUPS) as PowerupKind[];
  const cards = kinds.map((kind) => {
    const info = POWERUPS[kind];
    const pips = h("div", "pips", ...Array.from({ length: MAX_UPGRADE_LEVEL }, () => h("i", "pip")));
    const dur = h("div", "shop-dur");
    const cant = h("div", "cant");
    const btn = button("", () => actions.buy(kind), { variant: "primary", size: "md" });
    const iconWrap = h("div", "icon-wrap", svg(powerupIcon(kind)));
    iconWrap.style.background = `radial-gradient(circle at 50% 40%, ${POWERUP_COLORS[kind]}55, rgba(255,255,255,0.04) 70%)`;
    const el = h(
      "div",
      "shop-card",
      iconWrap,
      h("div", "shop-name", info.name),
      h("div", "shop-desc", info.description),
      pips,
      dur,
      btn,
      cant,
    );
    const update = (): void => {
      const level = store.save.upgrades[kind];
      const cost = upgradeCost(level);
      [...pips.children].forEach((p, i) => p.classList.toggle("on", i < level));
      const now = formatSeconds(powerupDuration(kind, level));
      dur.replaceChildren();
      if (cost === null) {
        dur.append(h("span", "next", now));
        btn.replaceChildren(svg(GLYPH_CHECK, "btn-icon"), h("span", "btn-label", "Nivel máximo"));
        btn.disabled = true;
        el.classList.add("maxed");
        cant.textContent = "";
      } else {
        dur.append(h("span", undefined, now), h("span", "arrow", "→"), h("span", "next", formatSeconds(powerupDuration(kind, level + 1))));
        btn.replaceChildren(h("span", "btn-label", "Mejorar"), svg(ICON_BELLOTA), h("span", undefined, formatInt(cost)));
        const short = store.save.wallet < cost;
        btn.disabled = short;
        cant.textContent = short ? `Te faltan ${formatInt(cost - store.save.wallet)} bellotas` : "";
      }
    };
    return { el, update };
  });
  const el = modal(
    "shop",
    modalHead("Tienda", "Mejora tus potenciadores para que duren más.", walletPill(store)),
    h("div", "shop-grid", ...cards.map((c) => c.el)),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("Volver", actions.closePanel, { icon: GLYPH_BACK, size: "lg" }),
    ),
  );
  const update = (): void => {
    for (const c of cards) c.update();
    syncBindings(el, store);
  };
  update();
  return { el, update };
}

// ------------------------------------------------------------------ pause

export function pauseScreen(ctx: ScreenCtx): HTMLElement {
  const { actions } = ctx;
  return h(
    "div",
    "screen modal-backdrop",
    h(
      "div",
      "modal panel pause",
      h("h2", "modal-title display tilt", "Pausa"),
      h("p", "pause-sub", "El camarero también se ha parado a respirar."),
      h(
        "div",
        "pause-buttons",
        button("Continuar", actions.resume, { variant: "primary", size: "lg", icon: GLYPH_PLAY }),
        button("Salir al menú", actions.toMenu, { size: "md", icon: GLYPH_HOME }),
      ),
      h("div", "hint", ...keys("Esc"), "para continuar"),
      h(
        "div",
        "pause-settings",
        soundToggles(ctx, true),
        h(
          "div",
          "mini-controls",
          h("span", undefined, ...keys("A", "D"), "carril"),
          h("span", undefined, ...keys("W"), "saltar"),
          h("span", undefined, ...keys("S"), "rodar"),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------ game over

export function gameoverScreen(ctx: ScreenCtx, summary: RunSummary, result: RunResult): HTMLElement {
  const { store, actions } = ctx;
  const head = gameOverHeadline(summary);
  const line = (label: string, value: string): HTMLElement =>
    h("div", "r-line", h("span", undefined, label), h("span", "dots"), h("span", undefined, value));
  const table = 1 + (Math.floor(summary.distance) % 12);
  const receipt = h(
    "div",
    "receipt",
    h("div", "r-bar", h("strong", undefined, "BAR EL GUADIANA"), `Terraza · Mesa ${table}`, h("br"), "Badajoz"),
    h("div", "r-title", "LA CUENTA"),
    h("div", "r-sep"),
    line("Distancia", formatMetres(summary.distance)),
    line("Bellotas", formatInt(summary.bellotas)),
    line("Zonas", formatInt(summary.zonesCompleted)),
    line("Vuelta", formatInt(summary.lap)),
    line("Saltos", formatInt(summary.jumps)),
    h("div", "r-sep"),
    h("div", "r-line r-total", h("span", undefined, "TOTAL"), h("span", "dots"), h("span", undefined, `${formatInt(summary.score)} pts`)),
    h("div", "r-sep"),
    h("div", "r-foot", "IVA incluido. Propina, no.", h("br"), "¡Menudo simpa!"),
  );
  const receiptWrap = h("div", "receipt-wrap", receipt, result.newBestScore ? h("div", "stamp", "¡Nuevo récord!") : null);

  const completedIds = new Set(result.completed.map((c) => c.id));
  const missionsCard = h(
    "div",
    "go-missions panel",
    h("div", "mini-head", h("div", "mini-title", "Misiones"), h("div", "mult-badge", `×${formatInt(result.multiplier)}`)),
  );
  if (result.setCompleted) {
    missionsCard.append(h("div", "set-done", `¡Serie completada! Multiplicador ×${formatInt(result.multiplier)}`));
    for (const c of result.completed) missionsCard.append(miniMission(c));
    missionsCard.append(h("div", "hint", "Nuevas misiones en el menú."));
  } else {
    for (const v of store.missionViews()) {
      const row = miniMission(v);
      if (completedIds.has(v.id)) row.classList.add("fresh");
      missionsCard.append(row);
    }
  }

  const walletNum = h("span", undefined, formatInt(result.wallet));
  walletNum.dataset["bind"] = "wallet";
  const earned = h(
    "div",
    "earned panel",
    h("div", "stat", h("div", "stat-label", "Has ganado"), h("div", "stat-value sun", svg(ICON_BELLOTA), `+${formatInt(result.bellotasEarned)}`)),
    h("div", "stat", h("div", "stat-label", "En tu bolsillo"), h("div", "stat-value", svg(ICON_BELLOTA), walletNum)),
  );

  const side = h(
    "div",
    "go-side",
    earned,
    missionsCard,
    h(
      "div",
      "go-buttons",
      button("Otra vez", actions.restart, { variant: "primary", size: "lg", icon: GLYPH_REPLAY }),
      h(
        "div",
        "row",
        button("Tienda", () => actions.openPanel("shop"), { icon: GLYPH_SHOP }),
        button("Menú", actions.toMenu, { icon: GLYPH_HOME }),
      ),
      h("div", "hint", "Pulsa", ...keys("Espacio"), "o", ...keys("Intro"), "para volver a correr"),
    ),
  );

  return h(
    "div",
    "screen gameover",
    h(
      "div",
      "go-head",
      h("h1", `go-title display${summary.cause === "caught" ? " caught" : ""}${head.title.length > 26 ? " long" : ""}`, head.title),
      h("p", "go-sub", head.sub),
    ),
    h("div", "go-body", receiptWrap, side),
  );
}
