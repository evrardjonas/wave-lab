// Imported from "vitest/config" instead of "vite" - a strict superset that adds a typed `test`
// field for Vitest, and changes nothing else. `vite`/`vite build` behave identically.
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig({
  // So the build can be served from an arbitrary path
  base: "./",

  build: {
    rollupOptions: {
      // Three independent, separately buildable/embeddable entry points - one per simulation.
      // See .claude/skills/scenerystack/references/multi-sim-architecture.md for why this is
      // three Sims rather than one Sim with three Screens.
      input: {
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
});
