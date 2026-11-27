/**
 * Builders for the menu, panels (how to play, missions, shop, achievements, records, credits),
 * pause and game over. Flat style from docs/design.md: white cards with ink text over a dimmed
 * scene, one sun-yellow primary action per screen.
 */
import { OUTFITS, POWERUPS, ZONES, type OutfitId, type PowerupKind, type RunSummary } from "../contracts";
import { outfitPreview } from "./outfits";
import { shareText } from "./feel";
import { ACHIEVEMENTS, type MetaStore, type MissionView, type RunResult } from "../meta";
import { formatDay, zoneReached } from "../meta/progress";
import { MAX_UPGRADE_LEVEL, powerupDuration, upgradeCost } from "../meta/economy";
import { formatInt, formatMetres, formatSeconds } from "../meta/format";
import { CREDITS, GAME_TITLE, gameOverHeadline, PREMISE, SUBTITLE, zoneInSentence } from "./copy";
import { Minimap, shortZoneName, streetFromMap } from "./minimap";
import { getCity } from "./city";
import { button, h, svg, type Child } from "./dom";
import {
  GLYPH_CALENDAR,
  GLYPH_CHECK,
  GLYPH_CLOSE,
  GLYPH_COPY,
  GLYPH_HOME,
  GLYPH_LOCK,
  GLYPH_MEDAL,
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
  powerupIcon,
} from "./icons";

export const APP_VERSION = "0.4";

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

/** The flat wordmark: "Badajoz Surfers" in ink with the sun-yellow acorn as its one accent. */
export function logo(): HTMLElement {
  const el = h("div", "logo-wrap", svg(ICON_BELLOTA, "logo-mark"), h("div", "wordmark", "Badajoz", h("br"), "Surfers"));
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", GAME_TITLE);
  return el;
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

export function soundToggles(ctx: ScreenCtx, withVolume: boolean, variant: "ghost" | "secondary" = "ghost"): HTMLElement {
  const s = ctx.store.settings;
  const music = button("Música", () => ctx.actions.toggle("music"), { variant, size: "sm", icon: GLYPH_MUSIC, className: "toggle" });
  music.dataset["toggle"] = "music";
  music.classList.toggle("off", !s.music);
  const sfx = button("Efectos", () => ctx.actions.toggle("sfx"), { variant, size: "sm", icon: GLYPH_SOUND_ON, className: "toggle" });
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

function walletPill(store: MetaStore, dark = false): HTMLElement {
  const num = h("span", undefined, formatInt(store.save.wallet));
  num.dataset["bind"] = "wallet";
  const el = h("div", `pill${dark ? " dark" : ""}`, svg(ICON_BELLOTA), num);
  el.title = "Bellotas";
  return el;
}

function progressBar(ratio: number): HTMLElement {
  const fill = h("i");
  fill.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  return h("div", "bar", fill);
}

function missionRow(v: MissionView, index: number, fresh = false): HTMLElement {
  return h(
    "li",
    `mission${v.done ? " done" : ""}${fresh ? " fresh" : ""}`,
    h("div", "num", v.done ? svg(GLYPH_CHECK) : String(index + 1)),
    h("div", "mission-text", v.text),
    h("div", "mission-label", v.label),
    progressBar(v.ratio),
  );
}

/** A modal panel: white card over the dimmed scene. */
function modal(className: string, ...children: Child[]): HTMLElement {
  return h("div", "screen modal-backdrop", h("div", `modal ${className}`, ...children));
}

/** Title, one-line subtitle, optional right-hand item and the close button. */
function modalHead(title: string, sub: string, onClose: () => void, right?: Child): HTMLElement {
  const close = button(null, onClose, { variant: "text", icon: GLYPH_CLOSE, ariaLabel: "Cerrar", className: "close" });
  return h(
    "div",
    "modal-head",
    h("div", "modal-titles", h("h2", "modal-title", title), sub ? h("p", "modal-sub", sub) : null),
    right ?? null,
    close,
  );
}

/** Footer: the Esc hint and, at most, the screen's one primary action. */
function modalFoot(primary?: HTMLElement): HTMLElement {
  return h("div", "modal-foot", h("div", "hint", ...keys("Esc"), "para cerrar"), primary ?? null);
}

// ------------------------------------------------------------------ main menu

export function menuScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const save = store.save;
  const firstRun = !save.tutorialDone;

  const link = (label: string, panel: PanelId, extra?: string): HTMLButtonElement => {
    const b = button(label, () => actions.openPanel(panel), { variant: "text", className: "menu-link" });
    if (extra) b.append(h("span", "menu-link-extra", extra));
    return b;
  };

  const credits = h("button", "link-btn", "Créditos");
  credits.type = "button";
  credits.tabIndex = -1;
  credits.addEventListener("mousedown", (e) => e.preventDefault());
  for (const type of ["keydown", "keyup"] as const) credits.addEventListener(type, (e) => (e.code === "Space" || e.code === "Enter") && e.preventDefault());
  credits.addEventListener("click", () => {
    credits.blur();
    actions.openPanel("credits");
  });

  // One card on the left; the right of the screen belongs to the 3D runner.
  const card = h(
    "div",
    "menu-card",
    h("div", "brand", logo(), h("div", "tagline", SUBTITLE)),
    h("p", "premise", PREMISE),
    h(
      "div",
      "play-row",
      button("Jugar", actions.play, { variant: "primary", size: "lg", icon: GLYPH_PLAY, className: "btn-play" }),
      h(
        "div",
        "hint",
        h("span", undefined, "o pulsa", ...keys("Espacio")),
        firstRun ? h("small", undefined, "La primera carrera te enseña los controles") : null,
      ),
    ),
    h(
      "nav",
      "menu-links",
      link("Misiones", "missions", `×${formatInt(store.multiplier)}`),
      link("Tienda", "shop"),
      link("Logros", "achievements"),
      link("Récords", "records"),
      link("Cómo jugar", "howto"),
    ),
    dailyCard(store),
    bestLine(store),
    h("div", "credit", `Hecho en Badajoz · v${APP_VERSION} · `, credits),
  );

  return h("div", "screen menu", card, h("div", "menu-top", walletPill(store, true), soundToggles(ctx, false)));
}

/** Best score, distance and how far the best escape got, as a caption. */
function bestLine(store: MetaStore): HTMLElement {
  const save = store.save;
  if (save.lifetime.totals.runs === 0) return h("p", "best-line", "Aún no has salido corriendo.");
  const best = zoneReached(save.lifetime.bestZones);
  return h(
    "p",
    "best-line",
    svg(GLYPH_TROPHY),
    h("b", undefined, formatInt(save.bestScore)),
    ` · ${formatMetres(save.bestDistance)} · hasta ${best.name}, vuelta ${formatInt(best.lap)}`,
  );
}

function dailyCard(store: MetaStore): HTMLElement {
  const d = store.dailyView();
  return h(
    "div",
    `daily${d.done ? " done" : ""}`,
    h(
      "div",
      "daily-row",
      svg(d.done ? GLYPH_CHECK : GLYPH_CALENDAR),
      h("div", "daily-text", h("small", undefined, "Reto del día"), h("span", undefined, d.text)),
      h("div", "daily-reward", d.done ? "Hecho" : d.label, h("span", "reward", svg(ICON_BELLOTA), `+${formatInt(d.reward)}`)),
    ),
    progressBar(d.ratio),
  );
}

function stat(label: string, value: Child): HTMLElement {
  return h("div", "stat", h("div", "stat-label", label), h("div", "stat-value", value));
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
    tip(ICON_WAITER, "<b>Dos tropiezos seguidos</b> y te pilla el camarero."),
    tip(ICON_JAMON, "Recoge las letras de <b>BADAJOZ</b> y gasta tus <b>bellotas</b> en la tienda."),
  );
  return modal(
    "howto",
    modalHead("Cómo se juega", "Lo básico para escapar del camarero.", onDone),
    h("div", "howto-grid", controls, tips),
    modalFoot(button("Entendido", onDone, { variant: "primary", size: "lg" })),
  );
}

function control(keysEl: HTMLElement, label: string): HTMLElement {
  return h("div", "control", h("div", "control-label", label), keysEl);
}

// ------------------------------------------------------------------ missions

export function missionsScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const m = store.multiplier;
  const sets = store.save.missions.setsCompleted;
  const hero = h(
    "div",
    "mult-hero",
    h("div", "big", `×${formatInt(m)}`),
    h(
      "p",
      undefined,
      m >= 10
        ? "Multiplicador al máximo. Sigue completando misiones para presumir."
        : `Completa las tres misiones para subir tu multiplicador a ×${formatInt(m + 1)}. Cada serie es un poco más difícil.`,
    ),
  );
  return modal(
    "missions",
    modalHead("Misiones", `Serie ${formatInt(sets + 1)}`, actions.closePanel, walletPill(store)),
    hero,
    h("ul", "mission-list", ...store.missionViews().map((v, i) => missionRow(v, i))),
    modalFoot(),
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
    const btn = button("", () => actions.buy(kind), { variant: "dark", size: "sm" });
    const el = h(
      "li",
      "shop-row",
      h("div", "icon-wrap", svg(powerupIcon(kind))),
      h("div", "shop-body", h("div", "shop-name", info.name), h("div", "shop-desc", info.description)),
      h("div", "shop-level", pips, dur),
      h("div", "shop-buy", btn, cant),
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
        btn.replaceChildren(h("span", "btn-label", "Mejorar"), svg(ICON_BELLOTA, "btn-icon"), h("span", undefined, formatInt(cost)));
        const short = store.save.wallet < cost;
        btn.disabled = short;
        cant.textContent = short ? `Te faltan ${formatInt(cost - store.save.wallet)}` : "";
      }
    };
    return { el, update };
  });
  const upgradesBody = h("ul", "shop-list", ...cards.map((c) => c.el));

  // Outfits ("Atuendos"): the 3D runner in the menu behind is the real preview, so this tab
  // moves the panel to the left and leaves the right of the screen clear.
  const outfitRows = OUTFITS.map((o) => {
    const btn = button("", () => {}, { size: "sm" });
    const price = h("div", "of-price");
    const el = h(
      "li",
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
      btn.className = `btn btn-sm ${equipped ? "btn-text" : owned ? "btn-secondary" : "btn-dark"}`;
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
  const outfitsBody = h("ul", "of-list", ...outfitRows.map((r) => r.el));
  outfitsBody.hidden = true;

  const tabUpgrades = button("Mejoras", () => setTab("upgrades"), { variant: "text", size: "sm", className: "tab on" });
  const tabOutfits = button("Atuendos", () => setTab("outfits"), { variant: "text", size: "sm", icon: GLYPH_SHIRT, className: "tab" });
  const head = modalHead("Tienda", "Mejora tus potenciadores para que duren más.", actions.closePanel, walletPill(store));
  const sub = head.querySelector(".modal-sub");
  const el = modal("shop", head, h("div", "tabs", tabUpgrades, tabOutfits), upgradesBody, outfitsBody, modalFoot());
  const setTab = (tab: "upgrades" | "outfits"): void => {
    const outfits = tab === "outfits";
    upgradesBody.hidden = outfits;
    outfitsBody.hidden = !outfits;
    tabUpgrades.classList.toggle("on", !outfits);
    tabOutfits.classList.toggle("on", outfits);
    el.classList.toggle("peek", outfits);
    if (sub) sub.textContent = outfits ? "Ropa nueva para huir con estilo. Mírate a la derecha." : "Mejora tus potenciadores para que duren más.";
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

/** The full-lap achievement shows the real lap length when the city data is loaded. */
function achievementText(id: string, description: string): string {
  const lap = getCity()?.meta.lapLength;
  return id === "vuelta-al-ruedo" && typeof lap === "number" && lap > 0 ? `${description} (${formatMetres(lap)})` : description;
}

export function achievementsScreen(ctx: ScreenCtx): HTMLElement {
  const { store, actions } = ctx;
  const have = store.achievementsUnlocked();
  const rows = ACHIEVEMENTS.map((a) => {
    const on = have.has(a.id);
    return h(
      "li",
      `ach${on ? " on" : ""}`,
      h("div", "ach-icon", svg(on ? GLYPH_MEDAL : GLYPH_LOCK)),
      h("div", "ach-body", h("div", "ach-name", a.name), h("div", "ach-desc", achievementText(a.id, a.description))),
      h("div", "ach-reward", on ? svg(GLYPH_CHECK) : svg(ICON_BELLOTA), on ? null : formatInt(a.reward)),
    );
  });
  return modal(
    "achievements",
    modalHead("Logros", `${formatInt(have.size)} de ${formatInt(ACHIEVEMENTS.length)} conseguidos. Cada uno trae bellotas de premio.`, actions.closePanel, walletPill(store)),
    h("ul", "ach-grid", ...rows),
    modalFoot(),
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
  if (save.records.length === 0) table.append(h("div", "rec-empty", "Aún no hay récords. Sal corriendo y estrena la lista."));
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
    stat("Carreras", formatInt(t.runs)),
    stat("Distancia total", formatMetres(t.distance)),
    stat("Bellotas recogidas", formatInt(t.bellotas)),
    stat("Por los techos", formatMetres(t.roofMetres)),
  );
  return modal("records", modalHead("Récords", "Tus cinco mejores huidas en este ordenador.", actions.closePanel), table, life, modalFoot());
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
    modalHead("Créditos", `${GAME_TITLE} · v${APP_VERSION}`, ctx.actions.closePanel),
    h("ul", "credit-list", ...creditLines().map(creditItem)),
    modalFoot(),
  );
}

// ------------------------------------------------------------------ pause

/** Where the runner is, for the maps. */
export interface MapPosition {
  zoneIndex: number;
  progress: number;
  lap: number;
}

function routeCard(pos: MapPosition | null): HTMLElement {
  const map = new Minimap({ labels: true, className: "big-map" });
  map.update(pos?.zoneIndex ?? 0, pos?.progress ?? 0);
  const zone = ZONES[pos?.zoneIndex ?? 0];
  const street = pos ? streetFromMap(pos.zoneIndex, pos.progress) : null;
  return h(
    "div",
    "route-card",
    map.el,
    h(
      "div",
      "route-where",
      zone ? h("span", undefined, "Estás en ", h("b", undefined, zoneInSentence(zone.id, zone.name))) : null,
      pos ? h("span", "lap-pill", `Vuelta ${formatInt(pos.lap)}`) : null,
    ),
    street ? h("div", "route-street", street) : null,
  );
}

export function pauseScreen(ctx: ScreenCtx, pos: MapPosition | null): HTMLElement {
  const { actions } = ctx;
  return h(
    "div",
    "screen modal-backdrop",
    h(
      "div",
      "modal pause",
      h(
        "div",
        "pause-main",
        h("h2", "modal-title", "Pausa"),
        h("p", "modal-sub", "El camarero también se ha parado a respirar."),
        h(
          "div",
          "pause-buttons",
          button("Continuar", actions.resume, { variant: "primary", size: "lg", icon: GLYPH_PLAY }),
          button("Salir al menú", actions.toMenu, { variant: "secondary", size: "lg", icon: GLYPH_HOME }),
        ),
        h(
          "div",
          "pause-settings",
          soundToggles(ctx, true, "secondary"),
          h(
            "div",
            "mini-controls",
            h("span", undefined, ...keys("A", "D"), "carril"),
            h("span", undefined, ...keys("W"), "saltar"),
            h("span", undefined, ...keys("S"), "rodar"),
          ),
        ),
        h("div", "hint", ...keys("Esc"), "para continuar"),
      ),
      routeCard(pos),
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
    "go-card go-missions",
    h("div", "card-head", h("div", "card-title", "Misiones"), h("div", "mult-badge", `×${formatInt(result.multiplier)}`)),
  );
  const list = h("ul", "mission-list compact");
  if (result.setCompleted) {
    missionsCard.append(h("div", "set-done", `Serie completada: multiplicador ×${formatInt(result.multiplier)}`));
    result.completed.forEach((c, i) => list.append(missionRow(c, i)));
    missionsCard.append(list, h("div", "card-note", "Nuevas misiones en el menú."));
  } else {
    store.missionViews().forEach((v, i) => list.append(missionRow(v, i, completedIds.has(v.id))));
    missionsCard.append(list);
  }

  const walletNum = h("span", undefined, formatInt(result.wallet));
  walletNum.dataset["bind"] = "wallet";
  const bonusText = [result.daily ? "Reto del día" : null, result.achievements.length ? `${formatInt(result.achievements.length)} ${result.achievements.length === 1 ? "logro" : "logros"}` : null]
    .filter(Boolean)
    .join(" y ");
  const earned = h(
    "div",
    "go-card earned",
    h(
      "div",
      "stat",
      h("div", "stat-label", result.debug ? "De prueba, no cuenta" : "Has ganado"),
      h("div", `stat-value big${result.debug ? " muted" : ""}`, svg(ICON_BELLOTA), `+${formatInt(result.bellotasEarned)}`),
    ),
    h("div", "stat", h("div", "stat-label", "En tu bolsillo"), h("div", "stat-value big", svg(ICON_BELLOTA), walletNum)),
    result.bonus > 0 ? h("div", "bonus-line", svg(GLYPH_MEDAL), bonusText, h("b", undefined, `+${formatInt(result.bonus)}`)) : null,
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
        button("Tienda", () => actions.openPanel("shop"), { variant: "secondary", icon: GLYPH_SHOP }),
        button("Menú", actions.toMenu, { variant: "secondary", icon: GLYPH_HOME }),
      ),
      h(
        "div",
        "go-foot",
        h("div", "hint", ...keys("Espacio"), "otra vez"),
        button("Copiar resultado", () => actions.share(shareText(summary.distance, zoneInSentence(ZONES[pos.zoneIndex]?.id ?? "", ZONES[pos.zoneIndex]?.name ?? ""), pos.lap)), {
          variant: "text",
          size: "sm",
          icon: GLYPH_COPY,
          className: "share-btn",
        }),
      ),
    ),
  );

  return h(
    "div",
    "screen gameover",
    h("div", "go-head", h("h1", `go-title${summary.cause === "caught" ? " caught" : ""}`, head.title), h("p", "go-sub", head.sub)),
    h("div", "go-body", receiptWrap, side),
  );
}
