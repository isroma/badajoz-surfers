import { createGame } from "./game";
import { createShell } from "./ui";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const root = document.getElementById("ui") as HTMLElement;

const shell = createShell(root);
const game = createGame(canvas, shell.gameOptions);
shell.attach(game);
