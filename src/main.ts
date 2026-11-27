import { createGame } from "./game";
import { createShell } from "./ui";
import { setCity } from "./ui/city";
import { createTrack, loadCity } from "./city";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const root = document.getElementById("ui") as HTMLElement;

/** A full-screen Spanish message instead of a blank page. */
function showError(text: string, error: unknown): void {
  console.error("Badajoz Surfers:", text, error);
  document.getElementById("boot")?.remove();
  canvas.style.display = "none";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8em;" +
    "padding:1.5em;text-align:center;background:#141f3f;color:#fff4dc;z-index:100;" +
    'font:600 clamp(15px,2.4vmin,26px) "Avenir Next","Segoe UI",system-ui,sans-serif;';
  const title = document.createElement("strong");
  title.textContent = "Badajoz Surfers";
  title.style.cssText = "color:#ffc53d;font-size:1.5em;";
  const message = document.createElement("span");
  message.textContent = text;
  message.style.maxWidth = "32em";
  box.append(title, message);
  root.replaceChildren(box);
}

const NO_WEBGL = "Tu navegador no puede mostrar gráficos 3D (WebGL). Prueba con otro navegador o actualiza los controladores.";
const NO_CITY = "No se ha podido cargar el mapa de Badajoz. Comprueba tu conexión y recarga la página.";

const shell = createShell(root);

// The real lap comes first: the page keeps showing "Cargando Badajoz…" until it is ready.
/** The loading line under the spinner ("Cargando Badajoz… calles"). */
function progress(step: string): void {
  const boot = document.getElementById("boot");
  if (boot) boot.textContent = `Cargando Badajoz… ${step}`;
}

async function boot(): Promise<void> {
  const t0 = performance.now();
  let world: { city: Awaited<ReturnType<typeof loadCity>>; track: ReturnType<typeof createTrack> };
  try {
    progress("el mapa");
    const city = await loadCity();
    progress("las calles");
    world = { city, track: createTrack(city) };
    setCity(city);
  } catch (error) {
    showError(NO_CITY, error);
    return;
  }
  const cityMs = performance.now() - t0;
  try {
    progress("la ciudad");
    const game = createGame(canvas, shell.gameOptions, world);
    // Keep the loading screen until the menu scene is built and every shader compiled.
    await (game as typeof game & { ready?: Promise<void> }).ready;
    (window as Window & { __simpaLoad?: Record<string, number> }).__simpaLoad = { cityMs: Math.round(cityMs), menuMs: Math.round(performance.now() - t0) };
    shell.attach(game);
  } catch (error) {
    showError(NO_WEBGL, error);
  }
}

void boot();
