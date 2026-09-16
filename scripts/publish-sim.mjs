// Builds one simulation (via build-for-publish.mjs) and copies its built output into a sibling
// science-site checkout, under public/simulations/<sim-name>/ - the folder science-site's Astro
// pages embed via InteractiveFrame (see ARCHITECTURE.md there: "Utiliser InteractiveFrame.astro").
//
// This does NOT touch science-site's git history or push anything - it only writes files into the
// working tree at ../science-site, exactly like editing any other file there by hand. Committing
// and pushing science-site remains a separate, explicit step in that repo.
//
// Usage: node scripts/publish-sim.mjs <sim-name> [science-site-path]
//   [science-site-path] defaults to "../science-site" (a sibling checkout of this repo)

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const [simName, scienceSitePathArg] = process.argv.slice(2);
if (!simName) {
  console.error("Usage: node scripts/publish-sim.mjs <sim-name> [science-site-path]");
  process.exit(1);
}

const scienceSiteRoot = path.resolve(repoRoot, scienceSitePathArg ?? "../science-site");
if (!existsSync(path.join(scienceSiteRoot, "package.json"))) {
  console.error(`Not a science-site checkout (no package.json found): ${scienceSiteRoot}`);
  process.exit(1);
}

execFileSync("node", [path.join(repoRoot, "scripts", "build-for-publish.mjs"), simName], {
  cwd: repoRoot,
  stdio: "inherit",
});

const builtDir = path.join(repoRoot, "dist-publish", simName);
const targetDir = path.join(scienceSiteRoot, "public", "simulations", simName);

// Only this sim's own subfolder is cleared/replaced - sibling sims already published under
// public/simulations/ (sound-waves, kundt-tube, later) are left untouched.
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(builtDir, targetDir, { recursive: true });

console.log(`Copied ${path.relative(repoRoot, builtDir)}/ -> ${path.relative(scienceSiteRoot, targetDir)}/ (in ${scienceSiteRoot})`);
