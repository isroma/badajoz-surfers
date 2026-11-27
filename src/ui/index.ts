/**
 * The shell: HUD, menus, toasts, audio and save data around the engine.
 * The UI follows `GameApi.state` and the event stream; it drives the game only through
 * start/pause/resume/toMenu, so UI and engine never disagree.
 */
import "./styles.css";
import { POWERUPS, ZONES, type GameApi, type GameEvent, type GameState, type HudSnapshot, type RunSummary, type Shell } from "../contracts";
import { AudioEngine } from "../audio";
import { MetaStore, emptyRunStats, type MissionView, type RunResult, type RunStats } from "../meta";
import { button, h, setUiSound } from "./dom";
import { Fx } from "./fx";
import { Hud } from "./hud";
import { GLYPH_CHECK, GLYPH_FLAG, GLYPH_PAUSE, GLYPH_SOUND_OFF, GLYPH_SOUND_ON, ICON_PATINETE, ICON_WAITER, POWERUP_COLORS, powerupIcon } from "./icons";
import {
  gameoverScreen,
  howtoScreen,
  menuScreen,
  missionsScreen,
  pauseScreen,
  shopScreen,
  syncBindings,
  type PanelId,
  type ScreenActions,
  type ScreenCtx,
} from "./screens";

declare global {
  interface Window {
    __shell?: { resetSave(): void; addBellotas(n: number): void };
  }
}

interface OpenPanel {
  id: PanelId;
  el: HTMLElement;
  update?: () => void;
  /** How-to only: the primary action (close, and start the run the first time). */
  done?: () => void;
}

/** Keys the engine uses; swallowed while a shell-only panel is open. */
const SWALLOW = new Set(["Space", "Enter", "NumpadEnter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyP", "Escape"]);

export function createShell(root: HTMLElement): Shell {
  const store = new MetaStore();
  const audio = new AudioEngine(store.settings);
  setUiSound((k) => audio.play(k));

  const hud = new Hud();
  const fx = new Fx();
  const baseLayer = h("div", "layer-base");
  const panelLayer = h("div", "layer-panel");

  let game: GameApi | null = null;
  let unsubscribe: (() => void) | null = null;
  let state: GameState = "menu";
  let panel: OpenPanel | null = null;
  let howtoAutoShown = false;

  // ---------------------------------------------------------------- run tracking
  const run = {
    active: false,
    ended: false,
    stats: emptyRunStats(),
    lastCheck: 0,
    result: null as { summary: RunSummary; result: RunResult } | null,
    lastNearMiss: 0,
    gameoverTimer: 0,
  };
  let lastHud: HudSnapshot | null = null;

  const beginRun = (): void => {
    if (run.active) return;
    run.active = true;
    run.ended = false;
    run.stats = emptyRunStats();
    run.result = null;
    run.lastCheck = 0;
    lastHud = null;
    store.beginRun();
    hud.reset();
    fx.clear();
  };

  const statsFromSummary = (s: RunSummary): RunStats => ({
    bellotas: s.bellotas,
    distance: s.distance,
    score: s.score,
    jumps: Math.max(s.jumps, run.stats.jumps),
    rolls: Math.max(s.rolls, run.stats.rolls),
    nearMisses: Math.max(s.nearMisses, run.stats.nearMisses),
    roofMetres: s.roofMetres,
    powerups: Math.max(s.powerups, run.stats.powerups),
    words: Math.max(s.wordsCompleted, run.stats.words),
    letters: run.stats.letters,
    zones: Math.max(s.zonesCompleted, run.stats.zones),
    runs: 1,
  });

  /** A summary built from what the shell saw, for runs that end without a `gameover` event. */
  const liveSummary = (): RunSummary => {
    try {
      const snap = game?.getHud();
      if (snap) {
        lastHud = snap;
        run.stats.bellotas = snap.bellotas;
        run.stats.distance = snap.distance;
        run.stats.score = snap.score;
      }
    } catch {
      // keep the last values seen by the frame loop
    }
    return liveSummaryFromStats();
  };
  const liveSummaryFromStats = (): RunSummary => ({
    score: run.stats.score,
    distance: run.stats.distance,
    bellotas: run.stats.bellotas,
    zonesCompleted: run.stats.zones,
    lap: lastHud?.lap ?? 1,
    cause: "caught",
    jumps: run.stats.jumps,
    rolls: run.stats.rolls,
    nearMisses: run.stats.nearMisses,
    roofMetres: 0,
    powerups: run.stats.powerups,
    wordsCompleted: run.stats.words,
  });

  /** Commit the run to the save. Runs exactly once per run whatever the event order. */
  const endRun = (summary: RunSummary): void => {
    if (run.ended) return;
    if (!run.active) beginRun();
    run.active = false;
    run.ended = true;
    window.clearTimeout(run.gameoverTimer);
    const result = store.finishRun(statsFromSummary(summary));
    run.result = { summary, result };
    if (state === "gameover") renderBase();
  };

  const missionToast = (views: MissionView[]): void => {
    for (const v of views) {
      fx.toast({ title: "¡Misión cumplida!", text: v.text, icon: GLYPH_CHECK, glyph: true, color: "#5cc25b", variant: "mission", duration: 3200 });
      audio.play("mission");
    }
  };

  const checkMissions = (): void => {
    if (!run.active) return;
    missionToast(store.updateRun(run.stats));
  };

  // ---------------------------------------------------------------- actions
  const actions: ScreenActions = {
    play: () => {
      if (!store.save.seenHowTo) openPanel("howto");
      else game?.start();
    },
    openPanel: (id) => openPanel(id),
    closePanel: () => closePanel(),
    resume: () => game?.resume(),
    toMenu: () => game?.toMenu(),
    restart: () => game?.start(),
    buy: (kind) => {
      if (store.buyUpgrade(kind)) {
        audio.play("purchase");
        fx.toast({ title: "¡Mejorado!", text: `${POWERUPS[kind].name}: ahora dura más`, icon: powerupIcon(kind), color: POWERUP_COLORS[kind], key: "shop" });
      } else audio.play("denied");
      panel?.update?.();
    },
    toggle: (setting) => {
      store.updateSettings({ [setting]: !store.settings[setting] });
    },
    setVolume: (volume) => store.updateSettings({ volume }),
  };
  const ctx: ScreenCtx = { store, actions };

  // ---------------------------------------------------------------- screens
  const renderBase = (): void => {
    let el: HTMLElement | null = null;
    if (state === "menu") el = menuScreen(ctx);
    else if (state === "paused") el = pauseScreen(ctx);
    else if (state === "gameover" && run.result) el = gameoverScreen(ctx, run.result.summary, run.result.result);
    baseLayer.replaceChildren(...(el ? [el] : []));
  };

  function openPanel(id: PanelId, firstTime = false): void {
    if (state === "playing" || state === "paused") return;
    const first = id === "howto" && (firstTime || !store.save.seenHowTo);
    closePanel(false);
    if (id === "shop") {
      const s = shopScreen(ctx);
      panel = { id, el: s.el, update: s.update };
    } else if (id === "missions") {
      panel = { id, el: missionsScreen(ctx) };
    } else {
      const done = (): void => {
        store.markHowToSeen();
        closePanel();
        if (first && (state === "menu" || state === "gameover")) game?.start();
      };
      panel = { id, el: howtoScreen(first, done), done };
    }
    panelLayer.replaceChildren(panel.el);
  }

  function closePanel(rerender = true): void {
    if (!panel) return;
    if (panel.id === "howto") store.markHowToSeen();
    panel = null;
    panelLayer.replaceChildren();
    // The menu shows the wallet and missions: refresh it after the shop.
    if (rerender && state === "menu") renderBase();
  }

  // ---------------------------------------------------------------- corner buttons
  const muteBtn = button(null, () => {
    const s = store.settings;
    const muted = !s.music && !s.sfx;
    store.updateSettings({ music: muted, sfx: muted });
  }, { variant: "ghost", className: "corner-btn", ariaLabel: "Silenciar" });
  const pauseBtn = button(null, () => game?.pause(), { variant: "ghost", className: "corner-btn", icon: GLYPH_PAUSE, ariaLabel: "Pausa" });
  const corner = h("div", "corner hud-br", pauseBtn, muteBtn);
  const syncMute = (): void => {
    const s = store.settings;
    const muted = !s.music && !s.sfx;
    muteBtn.replaceChildren(h("span", "btn-icon", ""));
    const icon = muteBtn.firstElementChild;
    if (icon) icon.innerHTML = muted ? GLYPH_SOUND_OFF : GLYPH_SOUND_ON;
    muteBtn.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar");
  };
  syncMute();

  root.replaceChildren(hud.el, fx.el, baseLayer, panelLayer, corner);

  store.subscribe(() => {
    audio.applySettings(store.settings);
    syncBindings(root, store);
    syncMute();
  });

  // ---------------------------------------------------------------- state
  const applyState = (next: GameState): void => {
    const prev = state;
    state = next;
    if (next !== "gameover") window.clearTimeout(run.gameoverTimer);
    hud.show(next === "playing" || next === "paused");
    pauseBtn.hidden = next !== "playing";
    if (next === "playing" || next === "paused") closePanel(false);
    switch (next) {
      case "menu":
        if (run.active) endRun(liveSummary());
        fx.clear();
        audio.setMusicMode("menu");
        if (!store.save.seenHowTo && !howtoAutoShown) {
          howtoAutoShown = true;
          openPanel("howto", true);
        }
        break;
      case "playing":
        if (prev !== "paused") beginRun();
        audio.setMusicMode("play");
        break;
      case "paused":
        audio.setMusicMode("paused");
        break;
      case "gameover":
        // Normally the `gameover` event carries the summary; don't hang if it never comes.
        if (!run.ended) {
          window.clearTimeout(run.gameoverTimer);
          run.gameoverTimer = window.setTimeout(() => {
            if (!run.ended && state === "gameover") endRun(liveSummary());
          }, 700);
        }
        break;
    }
    renderBase();
  };

  // ---------------------------------------------------------------- events
  const onEvent = (e: GameEvent): void => {
    switch (e.type) {
      case "state":
        if (e.state !== state) applyState(e.state);
        break;
      case "countdown":
        beginRun();
        fx.countdown(e.value);
        audio.play(e.value > 0 ? "countdown" : "go");
        break;
      case "jump":
        run.stats.jumps++;
        audio.play(e.super ? "superJump" : "jump");
        break;
      case "land":
        audio.play("land");
        break;
      case "roll":
        run.stats.rolls++;
        audio.play("roll");
        break;
      case "lane":
        audio.play("lane");
        break;
      case "pickup":
        if (e.kind === "bellota") audio.bellota();
        else if (e.kind === "letra") {
          run.stats.letters++;
          audio.play("letter", e.letterIndex ?? 0);
          checkMissions();
        }
        break;
      case "powerup-start":
        run.stats.powerups++;
        audio.play("powerupStart");
        audio.setPowerup(true);
        fx.toast({
          title: POWERUPS[e.kind].name,
          text: POWERUPS[e.kind].description,
          icon: powerupIcon(e.kind),
          color: POWERUP_COLORS[e.kind],
          key: `pu-${e.kind}`,
        });
        checkMissions();
        break;
      case "powerup-end":
        audio.play("powerupEnd");
        break;
      case "shield-break":
        audio.play("shieldBreak");
        hud.stumble();
        fx.toast({ title: "¡El patinete te ha salvado!", text: "Por esta vez…", icon: ICON_PATINETE, color: POWERUP_COLORS.patinete, variant: "gold", key: "shield" });
        break;
      case "word-complete":
        run.stats.words++;
        audio.play("word");
        hud.wordComplete();
        fx.toast({ title: "¡BADAJOZ!", text: "Palabra completa: ¡bonus!", icon: GLYPH_FLAG, glyph: true, variant: "gold", duration: 2800, key: "word" });
        checkMissions();
        break;
      case "near-miss": {
        run.stats.nearMisses++;
        audio.play("nearMiss");
        const now = performance.now();
        if (now - run.lastNearMiss > 1200) {
          run.lastNearMiss = now;
          fx.floater("¡Por los pelos!", "+bonus");
        }
        checkMissions();
        break;
      }
      case "stumble":
        audio.play("stumble");
        hud.stumble();
        fx.toast({ title: "¡Cuidado, que te pilla!", text: "Otro tropiezo y pagas la cuenta", icon: ICON_WAITER, color: "#ffd9c4", variant: "danger", key: "stumble", duration: 2000 });
        break;
      case "crash":
        audio.play("crash");
        break;
      case "caught":
        audio.play("caught");
        break;
      case "zone": {
        if (e.first) beginRun();
        else run.stats.zones++;
        audio.play("zone");
        const lapStart = e.lap > 1 && e.zone.id === ZONES[0]?.id;
        fx.zoneBanner(
          e.first ? "Empieza la huida" : lapStart ? "¡Nueva vuelta!" : `Vuelta ${e.lap}`,
          e.zone.name,
          e.zone.subtitle,
          lapStart ? `Vuelta ${e.lap} · ¡más rápido!` : undefined,
        );
        checkMissions();
        break;
      }
      case "gameover":
        endRun(e.summary);
        audio.setPowerup(false);
        if (e.summary.cause === "caught") audio.setMusicMode("off");
        else window.setTimeout(() => audio.sting(), 350);
        if (state !== "gameover") applyState("gameover");
        else renderBase();
        break;
    }
  };

  // ---------------------------------------------------------------- frame loop
  const frame = (t: number): void => {
    raf = requestAnimationFrame(frame);
    if (!game || (state !== "playing" && state !== "paused")) return;
    let snap: HudSnapshot;
    try {
      snap = game.getHud();
    } catch {
      return;
    }
    lastHud = snap;
    hud.render(snap);
    if (state !== "playing") return;
    audio.setSpeed(snap.speed);
    audio.setPowerup(snap.powerups.length > 0);
    if (run.active) {
      run.stats.bellotas = snap.bellotas;
      run.stats.distance = snap.distance;
      run.stats.score = snap.score;
      if (t - run.lastCheck > 300) {
        run.lastCheck = t;
        checkMissions();
      }
    }
  };
  let raf = requestAnimationFrame(frame);

  // ---------------------------------------------------------------- keyboard (panels only)
  const onKey = (e: KeyboardEvent): void => {
    if (!panel || !SWALLOW.has(e.code)) return;
    // The engine must not see keys while a shell-only panel is open.
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type !== "keydown" || e.repeat) return;
    if (e.code === "Escape") closePanel();
    else if (panel.id === "howto" && (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space")) panel.done?.();
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

  const onPageHide = (): void => {
    cancelAnimationFrame(raf);
  };
  const onPageShow = (): void => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  window.__shell = {
    resetSave: () => {
      store.reset();
      howtoAutoShown = false;
      closePanel(false);
      renderBase();
    },
    addBellotas: (n: number) => {
      store.addBellotas(n);
      panel?.update?.();
      if (state === "menu" && !panel) renderBase();
    },
  };

  applyState("menu");

  return {
    gameOptions: store.gameOptions,
    attach(g: GameApi) {
      unsubscribe?.();
      game = g;
      unsubscribe = g.on(onEvent);
      let initial: GameState = "menu";
      try {
        initial = g.state;
      } catch {
        // keep "menu"
      }
      if (initial !== state) applyState(initial);
    },
  };
}
