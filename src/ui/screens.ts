/** Builders for the menu, panels (how to play, missions, shop), pause and game-over screens. */
import { OUTFITS, POWERUPS, ZONES, type OutfitId, type PowerupKind, type RunSummary } from "../contracts";
import { outfitPreview } from "./outfits";
import { shareText } from "./feel";

export const APP_VERSION = "0.4";
import { ACHIEVEMENTS, type MetaStore, type MissionView, type RunResult } from "../meta";
import { formatDay, zoneReached } from "../meta/progress";
import { MAX_UPGRADE_LEVEL, powerupDuration, upgradeCost } from "../meta/economy";
import { formatInt, formatMetres, formatSeconds } from "../meta/format";
import { CREDITS, GAME_TITLE, gameOverHeadline, PREMISE, SUBTITLE, zoneInSentence } from "./copy";
import { Minimap, shortZoneName, streetFromMap } from "./minimap";
import { getCity } from "./city";
import { button, h, svg, type Child } from "./dom";
import {
  GLYPH_BACK,
  GLYPH_CALENDAR,
  GLYPH_LIST,
  GLYPH_LOCK,
  GLYPH_MAP,
  GLYPH_MEDAL,
  GLYPH_CHECK,
  GLYPH_COPY,
  GLYPH_FLAG,
  GLYPH_HELP,
  GLYPH_HOME,
  GLYPH_MUSIC,
  GLYPH_PLAY,
  GLYPH_REPLAY,
  GLYPH_SHIRT,
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

export type PanelId = "howto" | "missions" | "shop" | "achievements" | "records" | "credits";

export interface ScreenActions {
  play(): void;
  openPanel(panel: PanelId): void;
  closePanel(): void;
  resume(): void;
  toMenu(): void;
  restart(): void;
  buy(kind: PowerupKind): void;
  buyOutfit(id: OutfitId): void;
  equipOutfit(id: OutfitId): void;
  share(text: string): void;
  toggle(setting: "music" | "sfx"): void;
  setVolume(volume: number): void;
}

export interface ScreenCtx {
  store: MetaStore;
  actions: ScreenActions;
}

// ------------------------------------------------------------------ shared pieces

/**
 * The "BADAJOZ SURFERS" wordmark: two stacked lines of heavy rounded type with a terracotta
 * extrusion, speed lines and the acorn. Type is SVG text with fixed `textLength`, so the block
 * keeps its proportions whatever rounded/black face the platform supplies.
 */
export function logo(): HTMLElement {
  const wrap = h("div", "logo-wrap");
  // Each line: dark extrusion rim, terracotta extrusion, then the face with its ink outline.
  const line = (text: string, attrs: string, fill: string): string => `
      <text ${attrs} fill="#1d1020" stroke="#1d1020" stroke-width="34" transform="translate(5 15)">${text}</text>
      <text ${attrs} fill="#b8361b" stroke="#b8361b" stroke-width="20" transform="translate(4 10)">${text}</text>
      <text ${attrs} fill="${fill}" stroke="#1d1020" stroke-width="20" paint-order="stroke">${text}</text>`;
  const top = 'x="26" y="142" font-size="146" textLength="566" lengthAdjust="spacingAndGlyphs" stroke-linejoin="round"';
  const bottom = 'x="132" y="268" font-size="118" textLength="460" lengthAdjust="spacingAndGlyphs" stroke-linejoin="round"';
  wrap.innerHTML = `
  <svg class="logo" viewBox="0 0 660 300" role="img" aria-label="${GAME_TITLE}">
    <defs>
      <linearGradient id="logo-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF5CC"/>
        <stop offset="0.46" stop-color="#FFE08A"/>
        <stop offset="0.47" stop-color="#FFC53D"/>
        <stop offset="1" stop-color="#F28A0C"/>
      </linearGradient>
      <linearGradient id="logo-cream" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/>
        <stop offset="0.5" stop-color="#FFF4DC"/>
        <stop offset="0.51" stop-color="#FFE6BC"/>
        <stop offset="1" stop-color="#F7CF95"/>
      </linearGradient>
    </defs>
    <g transform="rotate(-4 330 150)">
      ${line("BADAJOZ", top, "url(#logo-gold)")}
      <g stroke-linecap="round" fill="none">
        <path d="M30 188 H98 M14 222 H90 M44 256 H100" stroke="#1d1020" stroke-width="20"/>
        <path d="M30 188 H98 M14 222 H90 M44 256 H100" stroke="#FFF4DC" stroke-width="9"/>
      </g>
      ${line("SURFERS", bottom, "url(#logo-cream)")}
    </g>
    <g transform="translate(566 -18) rotate(20 40 40) scale(1.3)">${ICON_BELLOTA.replace("<svg ", '<svg width="64" height="64" ')}</g>
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
    // Never keep focus: while an input is focused the engine ignores Esc/P and arrows would move
    // the slider. Blur after any pointer or key interaction, changed or not.
    for (const type of ["change", "pointerup", "pointercancel", "keyup", "focus"] as const) {
      input.addEventListener(type, () => {
        if (type === "focus") window.setTimeout(() => input.matches(":active") || input.blur(), 0);
        else input.blur();
      });
    }
    // A <span>, not a <label>: clicking the text must not focus the slider.
    el.append(h("span", "volume", "Volumen", input));
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
  premise.innerHTML = PREMISE.replace(" El camarero no perdona.", " <b>El camarero no perdona.</b>");
  const firstRun = !save.tutorialDone;

  const tile = (label: string, icon: string, panel: PanelId, badge?: string): HTMLButtonElement => {
    const b = button(label, () => actions.openPanel(panel), { icon, className: "tile" });
    if (badge) b.append(h("span", "tile-badge", badge));
    return b;
  };

  // Everything lives in one left column: the right half belongs to the 3D runner.
  const left = h(
    "div",
    "menu-left",
    h("div", "brand", logo(), h("div", "ribbon", SUBTITLE)),
    premise,
    h(
      "div",
      "play-row",
      button("Jugar", actions.play, { variant: "primary", size: "xl", icon: GLYPH_PLAY, className: "btn-play" }),
      h(
        "div",
        "hint",
        h("span", undefined, "Pulsa", ...keys("Espacio"), "o", ...keys("Intro")),
        firstRun ? h("small", undefined, "La primera carrera te enseña los controles") : null,
      ),
    ),
    h(
      "div",
      "menu-actions",
      tile("Misiones", GLYPH_FLAG, "missions", `×${formatInt(store.multiplier)}`),
      tile("Tienda", GLYPH_SHOP, "shop"),
      tile("Logros", GLYPH_MEDAL, "achievements"),
      tile("Récords", GLYPH_LIST, "records"),
      tile("Cómo jugar", GLYPH_HELP, "howto"),
    ),
    dailyCard(store),
    bestLine(store),
  );

  const credits = h("button", "link-btn", "Créditos");
  credits.type = "button";
  credits.tabIndex = -1;
  credits.addEventListener("mousedown", (e) => e.preventDefault());
  credits.addEventListener("click", () => {
    credits.blur();
    actions.openPanel("credits");
  });
  return h(
    "div",
    "screen menu",
    left,
    h("div", "menu-top", walletPill(store), soundToggles(ctx, false)),
    h("div", "credit", `Hecho en Badajoz · v${APP_VERSION} · `, credits),
  );
}

/** One line under the daily card: best score, best distance and how far the best escape got. */
function bestLine(store: MetaStore): HTMLElement {
  const save = store.save;
  if (save.lifetime.totals.runs === 0) {
    return h("div", "best-line", svg(GLYPH_TROPHY), "Aún no has salido corriendo. ¡Estrena el récord!");
  }
  const best = zoneReached(save.lifetime.bestZones);
  return h(
    "div",
    "best-line",
    svg(GLYPH_TROPHY),
    h("b", undefined, formatInt(save.bestScore)),
    h("span", "dot", "·"),
    formatMetres(save.bestDistance),
    h("span", "dot", "·"),
    `Mejor huida: ${best.name}, vuelta ${formatInt(best.lap)}`,
  );
}

function dailyCard(store: MetaStore): HTMLElement {
  const d = store.dailyView();
  const fill = h("i");
  fill.style.transform = `scaleX(${d.ratio})`;
  return h(
    "div",
    `daily panel${d.done ? " done" : ""}`,
    h(
      "div",
      "mini-head",
      h("div", "mini-title", svg(GLYPH_CALENDAR), "Reto del día"),
      h("div", "pill reward", svg(ICON_BELLOTA), `+${formatInt(d.reward)}`),
    ),
    h("div", "mini-text", h("span", undefined, d.text), h("small", undefined, d.label)),
    h("div", "bar", fill),
  );
}

function stat(label: string, value: HTMLElement): HTMLElement {
  return h("div", "stat", h("div", "stat-label", label), value);
}

// ------------------------------------------------------------------ how to play

export function howtoScreen(onDone: () => void): HTMLElement {
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
  return modal(
    "howto",
    modalHead("Cómo se juega", "Lo básico para escapar del camarero."),
    h("div", "howto-grid", controls, tips),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("¡Entendido!", onDone, { variant: "primary", size: "lg", icon: GLYPH_CHECK }),
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
  setTab(tab: "upgrades" | "outfits"): void;
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
  const upgradesBody = h("div", "shop-grid", ...cards.map((c) => c.el));

  // Outfits ("Atuendos"): the 3D runner in the menu behind is the real preview, so this tab
  // moves the panel to the left and leaves the right of the screen clear.
  const outfitRows = OUTFITS.map((o) => {
    const btn = button("", () => {}, { size: "md" });
    const price = h("div", "of-price");
    const el = h(
      "div",
      "of-row",
      h("div", "of-preview", svg(outfitPreview(o.id))),
      h("div", "of-body", h("div", "of-name", o.name), Object.assign(h("div", "of-desc", o.description), { title: o.description })),
      price,
      btn,
    );
    const update = (): void => {
      const owned = store.save.outfits.owned.includes(o.id);
      const equipped = store.save.outfits.equipped === o.id;
      el.classList.toggle("equipped", equipped);
      el.classList.toggle("owned", owned);
      price.replaceChildren(...(owned ? [] : [svg(ICON_BELLOTA), h("span", undefined, formatInt(o.price))]));
      btn.className = `btn btn-md ${equipped ? "btn-ghost" : owned ? "btn-secondary" : "btn-primary"}`;
      btn.disabled = equipped || (!owned && store.save.wallet < o.price);
      btn.replaceChildren(
        ...(equipped ? [svg(GLYPH_CHECK, "btn-icon")] : []),
        h("span", "btn-label", equipped ? "Equipado" : owned ? "Equipar" : "Comprar"),
      );
    };
    btn.onclick = () => {
      if (store.save.outfits.owned.includes(o.id)) actions.equipOutfit(o.id);
      else actions.buyOutfit(o.id);
    };
    return { el, update };
  });
  const outfitsBody = h("div", "of-list", ...outfitRows.map((r) => r.el));
  outfitsBody.hidden = true;

  const tabUpgrades = button("Mejoras", () => setTab("upgrades"), { variant: "ghost", size: "sm", className: "tab on" });
  const tabOutfits = button("Atuendos", () => setTab("outfits"), { variant: "ghost", size: "sm", icon: GLYPH_SHIRT, className: "tab" });
  const sub = h("p", "modal-sub", "Mejora tus potenciadores para que duren más.");
  const el = modal(
    "shop",
    h(
      "div",
      "modal-head",
      h("div", undefined, h("h2", "modal-title display tilt", "Tienda"), sub),
      walletPill(store),
    ),
    h("div", "tabs", tabUpgrades, tabOutfits),
    upgradesBody,
    outfitsBody,
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("Volver", actions.closePanel, { icon: GLYPH_BACK, size: "lg" }),
    ),
  );
  const setTab = (tab: "upgrades" | "outfits"): void => {
    const outfits = tab === "outfits";
    upgradesBody.hidden = outfits;
    outfitsBody.hidden = !outfits;
    tabUpgrades.classList.toggle("on", !outfits);
    tabOutfits.classList.toggle("on", outfits);
    el.classList.toggle("peek", outfits);
    sub.textContent = outfits ? "Ropa nueva para huir con estilo. Mírate a la derecha." : "Mejora tus potenciadores para que duren más.";
  };
  const update = (): void => {
    for (const c of cards) c.update();
    for (const r of outfitRows) r.update();
    syncBindings(el, store);
  };
  update();
  return { el, update, setTab };
}

// ------------------------------------------------------------------ achievements

export function achievementsScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const have = store.achievementsUnlocked();
  const cards = ACHIEVEMENTS.map((a) => {
    const on = have.has(a.id);
    return h(
      "div",
      `ach${on ? " on" : ""}`,
      h("div", "ach-icon", svg(on ? GLYPH_MEDAL : GLYPH_LOCK)),
      h("div", "ach-body", h("div", "ach-name", a.name), h("div", "ach-desc", a.description)),
      h("div", "ach-reward", on ? svg(GLYPH_CHECK) : svg(ICON_BELLOTA), on ? null : formatInt(a.reward)),
    );
  });
  return modal(
    "achievements",
    modalHead("Logros", `${formatInt(have.size)} de ${formatInt(ACHIEVEMENTS.length)} conseguidos · cada uno trae bellotas de premio`, walletPill(store)),
    h("div", "ach-grid", ...cards),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("Volver", actions.closePanel, { icon: GLYPH_BACK, size: "lg" }),
    ),
  );
}

// ------------------------------------------------------------------ records

export function recordsScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const save = store.save;
  const t = save.lifetime.totals;
  const table = h("div", "rec-table");
  table.append(
    h("div", "rec-row rec-head", h("span", undefined, "#"), h("span", undefined, "Puntos"), h("span", undefined, "Distancia"), h("span", undefined, "Hasta"), h("span", undefined, "Fecha")),
  );
  if (save.records.length === 0) {
    table.append(h("div", "rec-empty", "Aún no hay récords. ¡Sal corriendo y estrena la lista!"));
  }
  save.records.forEach((r, i) => {
    const z = zoneReached(r.zones);
    table.append(
      h(
        "div",
        `rec-row${i === 0 ? " first" : ""}`,
        h("span", "rec-rank", formatInt(i + 1)),
        h("span", "rec-score", formatInt(r.score)),
        h("span", undefined, formatMetres(r.distance)),
        h("span", "rec-zone", `${shortZoneName(z.zoneIndex)} · vuelta ${formatInt(z.lap)}`),
        h("span", "rec-date", r.date ? formatDay(r.date) : "—"),
      ),
    );
  });
  const life = h(
    "div",
    "life-grid",
    stat("Carreras", h("div", "stat-value", formatInt(t.runs))),
    stat("Distancia total", h("div", "stat-value", formatMetres(t.distance))),
    stat("Bellotas recogidas", h("div", "stat-value", svg(ICON_BELLOTA), formatInt(t.bellotas))),
    stat("Por los techos", h("div", "stat-value", formatMetres(t.roofMetres))),
  );
  return modal(
    "records",
    modalHead("Récords", "Tus cinco mejores huidas en este ordenador."),
    table,
    h("div", "panel-sub life", life),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("Volver", actions.closePanel, { icon: GLYPH_BACK, size: "lg" }),
    ),
  );
}

// ------------------------------------------------------------------ credits

/** Credit lines: the attribution shipped with the city data when it has loaded, else the static list. */
export function creditLines(): readonly string[] {
  const attribution = getCity()?.meta.attribution;
  if (!Array.isArray(attribution) || attribution.length === 0) return CREDITS;
  const lines = attribution.filter((l): l is string => typeof l === "string" && l.trim() !== "");
  return [...lines, "Hecho en Badajoz"];
}

/** A credit line, with "openstreetmap.org/copyright" (and similar bare domains) as links. */
function creditItem(line: string): HTMLElement {
  const li = h("li");
  const re = /\b((?:www\.)?openstreetmap\.org\/copyright|scne\.es)\b/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    const at = m.index ?? 0;
    li.append(line.slice(last, at));
    const a = h("a", undefined, m[0]);
    a.href = `https://${m[0]}`;
    a.target = "_blank";
    a.rel = "noopener";
    li.append(a);
    last = at + m[0].length;
  }
  li.append(line.slice(last));
  return li;
}

export function creditsScreen(ctx: ScreenCtx): HTMLElement {
  return modal(
    "credits",
    modalHead("Créditos", `${GAME_TITLE} · v${APP_VERSION}`),
    h("ul", "credit-list", ...creditLines().map(creditItem)),
    h(
      "div",
      "modal-foot",
      h("div", "hint", ...keys("Esc"), "para volver"),
      button("Volver", ctx.actions.closePanel, { icon: GLYPH_BACK, size: "lg" }),
    ),
  );
}

// ------------------------------------------------------------------ pause

/** Where the runner is, for the maps. */
export interface MapPosition {
  zoneIndex: number;
  progress: number;
  lap: number;
}

function routeCard(pos: MapPosition | null, title: string): HTMLElement {
  const map = new Minimap({ labels: true, className: "big-map" });
  map.update(pos?.zoneIndex ?? 0, pos?.progress ?? 0);
  const zone = ZONES[pos?.zoneIndex ?? 0];
  return h(
    "div",
    "route-card",
    h("div", "mini-head", h("div", "mini-title", svg(GLYPH_MAP), title), pos ? h("div", "pill lap-pill", `Vuelta ${formatInt(pos.lap)}`) : null),
    map.el,
    zone ? h("div", "route-where", "Estás en ", h("b", undefined, zoneInSentence(zone.id, zone.name))) : null,
    pos ? streetLine(streetFromMap(pos.zoneIndex, pos.progress)) : null,
  );
}

function streetLine(name: string | null): HTMLElement | null {
  return name ? h("div", "route-street", name) : null;
}

export function pauseScreen(ctx: ScreenCtx, pos: MapPosition | null): HTMLElement {
  const { actions } = ctx;
  return h(
    "div",
    "screen modal-backdrop",
    h(
      "div",
      "modal panel pause",
      h(
        "div",
        "pause-main",
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
      routeCard(pos, "Tu huida"),
    ),
  );
}

// ------------------------------------------------------------------ game over

function receiptMap(pos: MapPosition): HTMLElement {
  const map = new Minimap({ ink: true, className: "receipt-map" });
  map.update(pos.zoneIndex, pos.progress);
  return map.el;
}

export function gameoverScreen(ctx: ScreenCtx, summary: RunSummary, result: RunResult, pos: MapPosition): HTMLElement {
  const { store, actions } = ctx;
  const head = gameOverHeadline(summary);
  const line = (label: string, value: string): HTMLElement =>
    h("div", "r-line", h("span", undefined, label), h("span", "dots"), h("span", undefined, value));
  const table = 1 + (Math.floor(summary.distance) % 12);
  const receipt = h(
    "div",
    "receipt",
    h("div", "r-bar", h("strong", undefined, "BAR EL PUENTE"), `Terraza · Mesa ${table}`, h("br"), "Badajoz"),
    h("div", "r-title", "LA CUENTA"),
    h("div", "r-sep"),
    line("Distancia", formatMetres(summary.distance)),
    line("Bellotas", formatInt(summary.bellotas)),
    line("Zonas", formatInt(summary.zonesCompleted)),
    line("Vuelta", formatInt(summary.lap)),
    h("div", "r-sep"),
    h("div", "r-line r-total", h("span", undefined, "TOTAL"), h("span", "dots"), h("span", undefined, `${formatInt(summary.score)} pts`)),
    result.newBestScore ? h("div", "stamp-row", h("div", "stamp", "¡Nuevo récord!")) : null,
    h("div", "r-sep"),
    h(
      "div",
      "r-where",
      h("div", "r-where-text", "Has llegado hasta:", h("b", undefined, ZONES[pos.zoneIndex]?.name ?? ""), `Vuelta ${formatInt(pos.lap)}`),
      receiptMap(pos),
    ),
    result.debug ? h("div", "r-debug", "Carrera de prueba: no se guarda") : null,
    h("div", "r-foot", "IVA incluido. Propina, no.", h("br"), "¡Menudo simpa!"),
  );
  const receiptWrap = h("div", "receipt-wrap", receipt);

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
    h(
      "div",
      "stat",
      h("div", "stat-label", result.debug ? "De prueba, no cuenta" : "Has ganado"),
      h("div", `stat-value ${result.debug ? "muted" : "sun"}`, svg(ICON_BELLOTA), `+${formatInt(result.bellotasEarned)}`),
    ),
    h("div", "stat", h("div", "stat-label", "En tu bolsillo"), h("div", "stat-value", svg(ICON_BELLOTA), walletNum)),
    result.bonus > 0
      ? h(
          "div",
          "bonus-line",
          svg(GLYPH_MEDAL),
          [result.daily ? "Reto del día" : null, result.achievements.length ? `${formatInt(result.achievements.length)} ${result.achievements.length === 1 ? "logro" : "logros"}` : null]
            .filter(Boolean)
            .join(" y "),
          h("b", undefined, `+${formatInt(result.bonus)}`),
        )
      : null,
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
      button("Copiar resultado", () => actions.share(shareText(summary.distance, zoneInSentence(ZONES[pos.zoneIndex]?.id ?? "", ZONES[pos.zoneIndex]?.name ?? ""), pos.lap)), {
        variant: "ghost",
        size: "sm",
        icon: GLYPH_COPY,
        className: "share-btn",
      }),
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
