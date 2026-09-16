// Builds ONE simulation entry point in isolation (not the 3-entry wave-lab GH Pages bundle
// vite.config.js produces) under a caller-supplied base path, for embedding into another site
// (e.g. science-site). Kept separate from vite.config.js so wave-lab's own /wave-lab/ GH Pages
// build is never affected by this.
//
// Usage: node scripts/build-for-publish.mjs <sim-name> [base-path]
//   <sim-name>   matches an existing "<sim-name>.html" entry at the repo root, e.g. "standing-waves"
//   [base-path]  defaults to "/science-site/simulations/<sim-name>/"
//
// Output: dist-publish/<sim-name>/index.html + assets/*.js (asset filenames are content-hashed by
// Vite, so they naturally change whenever the built code changes).

import { build } from "vite";
import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const [simName, basePathArg] = process.argv.slice(2);
if (!simName) {
  console.error("Usage: node scripts/build-for-publish.mjs <sim-name> [base-path]");
  process.exit(1);
}

const entryHtml = path.join(repoRoot, `${simName}.html`);
if (!existsSync(entryHtml)) {
  console.error(`No such entry point: ${entryHtml}`);
  process.exit(1);
}

const basePath = basePathArg ?? `/science-site/simulations/${simName}/`;
const outDir = path.join(repoRoot, "dist-publish", simName);

await build({
  root: repoRoot,
  base: basePath,
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: entryHtml,
    },
  },
});

// Vite names the output HTML after the input file (<sim-name>.html) - rename to index.html so the
// built folder serves correctly at a trailing-slash URL like base-path itself.
renameSync(path.join(outDir, `${simName}.html`), path.join(outDir, "index.html"));

console.log(`Built ${simName} for base "${basePath}" -> ${path.relative(repoRoot, outDir)}/`);
