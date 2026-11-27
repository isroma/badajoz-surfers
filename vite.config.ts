import { defineConfig } from "vitest/config";

// Relative base so the build works under any GitHub Pages path.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: { input: { main: "index.html", gallery: "gallery.html" } },
  },
  // The solver-backed generator tests take seconds on CI runners.
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 300_000 },
});
