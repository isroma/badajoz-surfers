/**
 * Dev-only harness (shell-dev.html, not part of the build): mounts the shell over a painted
 * fake street with a fake GameApi. Pick a screen with ?screen=menu|hud|pause|gameover|shop|
 * missions|howto|countdown|play  (play = interactive simulation: Space/Enter to start, A/D, W, S,
 * Esc/P). Extra: &cause=caught|crash&obstacle=bus, &fresh=1 for an empty save.
 */
import {
  WORD,
  ZONES,
  type GameApi,
  type GameEvent,
  type GameState,
  type HudSnapshot,
  type ObstacleKind,
  type PowerupKind,
  type RunSummary,
} from "../contracts";
import { SAVE_KEY, defaultSave } from "../meta/save";
import { createShell } from "./index";

const params = new URLSearchParams(location.search);
const screen = params.get("screen") ?? "play";

// ---------------------------------------------------------------- seeded save
function seedSave(): void {
  try {
    if (params.get("fresh") === "1" || screen === "howto") {
      localStorage.removeItem(SAVE_KEY);
      return;
    }
    if (screen === "play" && localStorage.getItem(SAVE_KEY)) return;
    const s = defaultSave();
    s.wallet = 2480;
    s.bestScore = 45678;
    s.bestDistance = 2315;
    s.runsPlayed = 14;
    s.seenHowTo = true;
    s.upgrades = { iman: 2, zapatillas: 0, jamon: 5, patinete: 1 };
    s.missions = {
      setsCompleted: 1,
      active: [
        { id: "jumps", progress: 40, done: true },
        { id: "distance-run", progress: 640, done: false },
        { id: "near-misses", progress: 3, done: false },
      ],
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    // no storage
  }
}
seedSave();

// Headless screenshots don't advance CSS animations reliably: freeze them at their end state.
if (screen !== "play" && params.get("anim") !== "1") {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important}" +
    ".countdown .display{animation:none!important;transform:rotate(-3deg)}.floater{animation:none!important;transform:translate(-50%,0)}";
  document.head.append(style);
}

// ---------------------------------------------------------------- painted background
function paintBackground(): void {
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const draw = (): void => {
    const w = (canvas.width = innerWidth);
    const hgt = (canvas.height = innerHeight);
    const g = canvas.getContext("2d");
    if (!g) return;
    const sky = g.createLinearGradient(0, 0, 0, hgt * 0.6);
    sky.addColorStop(0, "#4aa3e8");
    sky.addColorStop(1, "#ffe2a8");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, hgt);
    g.fillStyle = "#fff3b0";
    g.beginPath();
    g.arc(w * 0.78, hgt * 0.2, hgt * 0.08, 0, Math.PI * 2);
    g.fill();
    const colors = ["#f4d7a1", "#e9a46b", "#f6efe0", "#d86f45", "#f2c14e", "#ffffff", "#c9a27a"];
    for (let i = 0; i < 14; i++) {
      const bw = w * 0.09;
      const bh = hgt * (0.18 + ((i * 37) % 11) / 30);
      const x = i < 7 ? i * bw * 0.6 : w - (i - 6) * bw * 0.6;
      g.fillStyle = colors[i % colors.length] ?? "#fff";
      g.fillRect(x - bw / 2, hgt * 0.58 - bh, bw, bh);
      g.fillStyle = "rgba(40,60,90,0.45)";
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(x - bw / 2 + 8 + c * (bw / 3.2), hgt * 0.58 - bh + 12 + r * (bh / 5), bw / 6, bh / 9);
    }
    g.fillStyle = "#7a7f88";
    g.beginPath();
    g.moveTo(w * 0.44, hgt * 0.58);
    g.lineTo(w * 0.56, hgt * 0.58);
    g.lineTo(w * 1.05, hgt);
    g.lineTo(-w * 0.05, hgt);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 6;
    g.setLineDash([30, 30]);
    for (const k of [-1, 1]) {
      g.beginPath();
      g.moveTo(w * (0.5 + k * 0.02), hgt * 0.58);
      g.lineTo(w * (0.5 + k * 0.18), hgt);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = "#e23d3d";
    g.fillRect(w * 0.47, hgt * 0.7, w * 0.06, hgt * 0.09);
    g.fillStyle = "#1d6fd8";
    g.fillRect(w * 0.6, hgt * 0.64, w * 0.1, hgt * 0.12);
  };
  draw();
  addEventListener("resize", draw);
}
paintBackground();

// ---------------------------------------------------------------- fake engine
class FakeGame implements GameApi {
  state: GameState = "menu";
  private listeners = new Set<(e: GameEvent) => void>();
  private timers: number[] = [];
  private sim = 0;
  hud: HudSnapshot = {
    score: 0,
    bellotas: 0,
    distance: 0,
    multiplier: 2,
    speed: 14,
    zone: ZONES[0] ?? { id: "puente-real", name: "Puente Real", subtitle: "", length: 480 },
    zoneProgress: 0,
    lap: 1,
    powerups: [],
    letters: [...WORD].map(() => false),
    chaser: 0,
  };
  summary: RunSummary = {
    score: 0,
    distance: 0,
    bellotas: 0,
    zonesCompleted: 0,
    lap: 1,
    cause: "crash",
    jumps: 0,
    rolls: 0,
    nearMisses: 0,
    roofMetres: 0,
    powerups: 0,
    wordsCompleted: 0,
  };

  on(listener: (e: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }
  getHud(): HudSnapshot {
    return this.hud;
  }
  setState(s: GameState): void {
    this.state = s;
    this.emit({ type: "state", state: s });
  }
  after(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
  start(): void {
    if (this.state !== "menu" && this.state !== "gameover") return;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.hud = { ...this.hud, score: 0, bellotas: 0, distance: 0, zoneProgress: 0, lap: 1, powerups: [], letters: this.hud.letters.map(() => false), chaser: 0, zone: ZONES[0] ?? this.hud.zone };
    this.summary = { ...this.summary, jumps: 0, rolls: 0, nearMisses: 0, powerups: 0, wordsCompleted: 0 };
    this.setState("playing");
    [3, 2, 1, 0].forEach((v, i) => this.after(i * 800, () => this.emit({ type: "countdown", value: v })));
    this.after(2500, () => {
      this.emit({ type: "zone", zone: this.hud.zone, lap: 1, first: true });
      this.runSim();
    });
  }
  pause(): void {
    if (this.state === "playing") this.setState("paused");
  }
  resume(): void {
    if (this.state === "paused") this.setState("playing");
  }
  toMenu(): void {
    cancelAnimationFrame(this.sim);
    this.setState("menu");
  }
  gameOver(cause: "crash" | "caught", obstacle?: ObstacleKind): void {
    cancelAnimationFrame(this.sim);
    if (cause === "crash" && obstacle) this.emit({ type: "crash", obstacle });
    else this.emit({ type: "caught" });
    const s: RunSummary = {
      ...this.summary,
      score: this.hud.score,
      distance: this.hud.distance,
      bellotas: this.hud.bellotas,
      lap: this.hud.lap,
      zonesCompleted: (this.hud.lap - 1) * ZONES.length + ZONES.findIndex((z) => z.id === this.hud.zone.id),
      cause,
      roofMetres: 42,
      ...(obstacle ? { obstacle } : {}),
    };
    this.setState("gameover");
    this.emit({ type: "gameover", summary: s });
  }
  /** Interactive simulation for ?screen=play. */
  runSim(): void {
    let last = performance.now();
    let zoneIndex = 0;
    let zoneStart = 0;
    let nextPickup = 0;
    const tick = (now: number): void => {
      this.sim = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.state !== "playing") return;
      const hud = this.hud;
      const dist = hud.distance + hud.speed * dt;
      const zone = ZONES[zoneIndex] ?? ZONES[0];
      if (!zone) return;
      let zoneProgress = (dist - zoneStart) / zone.length;
      let lap = hud.lap;
      if (zoneProgress >= 1) {
        zoneStart += zone.length;
        zoneIndex = (zoneIndex + 1) % ZONES.length;
        if (zoneIndex === 0) lap++;
        zoneProgress = 0;
        const z = ZONES[zoneIndex];
        if (z) this.emit({ type: "zone", zone: z, lap, first: false });
      }
      const powerups = hud.powerups.map((p) => ({ ...p, remaining: p.remaining - dt })).filter((p) => {
        if (p.remaining > 0) return true;
        this.emit({ type: "powerup-end", kind: p.kind });
        return false;
      });
      this.hud = {
        ...hud,
        distance: dist,
        score: hud.score + hud.speed * dt * 10 * hud.multiplier * (powerups.some((p) => p.kind === "jamon") ? 2 : 1),
        speed: Math.min(30, hud.speed + dt * 0.1),
        zone: ZONES[zoneIndex] ?? zone,
        zoneProgress,
        lap,
        powerups,
        chaser: Math.max(0, hud.chaser - dt * 0.08),
      };
      if (dist > nextPickup) {
        nextPickup = dist + 2 + Math.random() * 4;
        const r = Math.random();
        if (r < 0.85) {
          this.hud.bellotas++;
          this.emit({ type: "pickup", kind: "bellota" });
        } else if (r < 0.93) {
          const missing = this.hud.letters.findIndex((l) => !l);
          if (missing >= 0) {
            this.hud.letters = this.hud.letters.map((l, i) => l || i === missing);
            this.emit({ type: "pickup", kind: "letra", letterIndex: missing });
            if (this.hud.letters.every(Boolean)) {
              this.summary.wordsCompleted++;
              this.emit({ type: "word-complete" });
              this.after(1500, () => (this.hud.letters = this.hud.letters.map(() => false)));
            }
          }
        } else if (r < 0.96) {
          const kinds: PowerupKind[] = ["iman", "zapatillas", "jamon", "patinete"];
          const kind = kinds[Math.floor(Math.random() * 4)] ?? "iman";
          this.hud.powerups = [...this.hud.powerups.filter((p) => p.kind !== kind), { kind, remaining: 10, duration: 10 }];
          this.summary.powerups++;
          this.emit({ type: "powerup-start", kind, duration: 10 });
        } else {
          this.summary.nearMisses++;
          this.emit({ type: "near-miss" });
        }
      }
    };
    this.sim = requestAnimationFrame(tick);
  }
  /** Keyboard like the real engine. */
  bindKeys(): void {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const c = e.code;
      if ((c === "Space" || c === "Enter") && (this.state === "menu" || this.state === "gameover")) {
        this.start();
        return;
      }
      if (c === "Escape" || c === "KeyP") {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
        return;
      }
      if (this.state !== "playing") return;
      if (c === "KeyA" || c === "KeyD" || c === "ArrowLeft" || c === "ArrowRight") this.emit({ type: "lane" });
      else if (c === "KeyW" || c === "ArrowUp" || c === "Space") {
        this.summary.jumps++;
        const sup = this.hud.powerups.some((p) => p.kind === "zapatillas");
        this.emit({ type: "jump", super: sup });
        this.after(sup ? 900 : 550, () => this.emit({ type: "land" }));
      } else if (c === "KeyS" || c === "ArrowDown") {
        this.summary.rolls++;
        this.emit({ type: "roll" });
      } else if (c === "KeyX") {
        if (this.hud.chaser > 0.4) this.gameOver("caught");
        else {
          this.hud.chaser = 0.75;
          this.emit({ type: "stumble" });
        }
      } else if (c === "KeyC") this.gameOver("crash", "bus");
      else if (c === "KeyV") this.emit({ type: "shield-break" });
    });
  }
}

// ---------------------------------------------------------------- mount
const root = document.getElementById("ui");
if (root) {
  const shell = createShell(root);
  const game = new FakeGame();
  shell.attach(game);
  game.bindKeys();
  const clickButton = (label: string): void => {
    const btn = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
    btn?.click();
  };
  const playingHud = (): void => {
    game.hud = {
      ...game.hud,
      score: 128450,
      bellotas: 347,
      distance: 1847,
      multiplier: 3,
      speed: 22,
      zone: ZONES[3] ?? game.hud.zone,
      zoneProgress: 0.62,
      lap: 2,
      powerups: [
        { kind: "iman", remaining: 7.2, duration: 14 },
        { kind: "jamon", remaining: 2.1, duration: 22 },
      ],
      letters: [true, true, true, false, true, false, false],
      chaser: Number(params.get("chaser") ?? 0.55),
    };
  };
  switch (screen) {
    case "shop":
      clickButton("Tienda");
      break;
    case "missions":
      clickButton("Misiones");
      break;
    case "hud":
      playingHud();
      game.setState("playing");
      // Fire the transient overlays late so they are on screen when a headless screenshot is taken.
      setTimeout(() => {
        game.emit({ type: "zone", zone: ZONES[0] ?? game.hud.zone, lap: 2, first: false });
        game.emit({ type: "powerup-start", kind: "iman", duration: 14 });
        game.emit({ type: "word-complete" });
        game.emit({ type: "near-miss" });
      }, Number(params.get("delay") ?? 3000));
      break;
    case "countdown":
      playingHud();
      game.hud.chaser = 0;
      game.setState("playing");
      setTimeout(() => game.emit({ type: "countdown", value: Number(params.get("value") ?? 3) }), 3300);
      break;
    case "pause":
      playingHud();
      game.setState("playing");
      game.setState("paused");
      break;
    case "gameover": {
      playingHud();
      game.setState("playing");
      game.emit({ type: "countdown", value: 0 });
      game.summary = { ...game.summary, jumps: 23, rolls: 9, nearMisses: 8, powerups: 3, wordsCompleted: 1 };
      const cause = params.get("cause") === "caught" ? "caught" : "crash";
      const obstacle = (params.get("obstacle") ?? "bus") as ObstacleKind;
      game.gameOver(cause, cause === "crash" ? obstacle : undefined);
      break;
    }
    case "auto": {
      // Smoke test of the full flow: start, play, pause, resume, crash, restart, quit to menu.
      const log: string[] = [];
      addEventListener("error", (e) => log.push(`error: ${e.message}`));
      const step = (ms: number, label: string, fn: () => void): void => {
        setTimeout(() => {
          try {
            fn();
            log.push(`${label}: state=${game.state} screen=${root.querySelector(".screen")?.className ?? "none"}`);
          } catch (err) {
            log.push(`${label}: THREW ${String(err)}`);
          }
          document.title = log.join(" | ");
        }, ms);
      };
      step(100, "start", () => clickButton("Jugar"));
      step(300, "howto", () => clickButton("¡A correr!"));
      step(2000, "pause", () => game.pause());
      step(2300, "resume", () => clickButton("Continuar"));
      step(5000, "crash", () => {
        game.hud = { ...game.hud, bellotas: 50 };
        game.gameOver("crash", "coche");
      });
      step(5600, "shop", () => clickButton("Tienda"));
      step(5800, "close", () => clickButton("Volver"));
      step(6000, "restart", () => clickButton("Otra vez"));
      step(9000, "pause2", () => game.pause());
      step(9200, "menu", () => {
        game.hud = { ...game.hud, bellotas: 7 };
        clickButton("Salir al menú");
      });
      step(9400, "wallet", () => log.push(`wallet=${localStorage.getItem("simpa.save.v1")?.match(/"wallet":(\d+)/)?.[1]}`));
      break;
    }
    default:
      break;
  }
}
