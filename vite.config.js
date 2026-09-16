// Imported from "vitest/config" instead of "vite" - a strict superset that adds a typed `test`
// field for Vitest, and changes nothing else. `vite`/`vite build` behave identically.
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Published as a GitHub Pages PROJECT site at https://evrardjonas.github.io/wave-lab/, so the
  // production build's base must be "/wave-lab/" for its asset/module URLs to resolve correctly
  // once served from that subpath. Only the production build (`vite build`) uses this - the dev
  // server (`vite`/`npm start`) keeps the relative "./" base it always had, so local development is
  // unaffected and still runs at the site root (http://localhost:5173/, etc.).
  base: command === "build" ? "/wave-lab/" : "./",

  build: {
    rollupOptions: {
      // Three independent, separately buildable/embeddable entry points - one per simulation -
      // plus the root landing page, which must be built too so GitHub Pages' site root
      // (https://evrardjonas.github.io/wave-lab/) actually resolves to something instead of 404ing.
      // See .claude/skills/scenerystack/references/multi-sim-architecture.md for why this is three
      // Sims rather than one Sim with three Screens.
      input: {
        index: "index.html",
        soundWaves: "sound-waves.html",
        standingWaves: "standing-waves.html",
        kundtTube: "kundt-tube.html",
      },
    },
  },

  test: {
    // No DOM/SceneryStack rendering is tested yet - model-level physics/Property tests only.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Polyfills the `self` global that scenerystack's dev build expects at import time (Node has
    // no `self` global). See src/vitest-setup.ts for why this is needed and why it's not a full
    // DOM shim.
    setupFiles: ["src/vitest-setup.ts"],
  },
}));
