import { createGame } from "./game";
import { createShell } from "./ui";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const root = document.getElementById("ui") as HTMLElement;

/** No WebGL (or the renderer failed to start): explain it in Spanish instead of a blank page. */
function showNoWebGL(error: unknown): void {
  console.error("Simpa: could not start the 3D engine", error);
  document.getElementById("boot")?.remove();
  canvas.style.display = "none";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8em;" +
    "padding:1.5em;text-align:center;background:#141f3f;color:#fff4dc;z-index:100;" +
    'font:600 clamp(15px,2.4vmin,26px) "Avenir Next","Segoe UI",system-ui,sans-serif;';
  const title = document.createElement("strong");
  title.textContent = "Simpa: corre por Badajoz";
  title.style.cssText = "color:#ffc53d;font-size:1.5em;";
  const text = document.createElement("span");
  text.textContent =
    "Tu navegador no puede mostrar gráficos 3D (WebGL). Prueba con otro navegador o actualiza los controladores.";
  text.style.maxWidth = "32em";
  box.append(title, text);
  root.replaceChildren(box);
}

const shell = createShell(root);
try {
  const game = createGame(canvas, shell.gameOptions);
  shell.attach(game);
} catch (error) {
  showNoWebGL(error);
}
