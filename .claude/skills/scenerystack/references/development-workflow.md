# Development Workflow

## Verified npm scripts (this repo, `package.json`)

```json
"scripts": {
  "start": "npx vite",
  "build": "npx tsc && npx vite build"
}
```

- `npm start` — Vite dev server. Confirmed working (serves `HTTP 200`).
- `npm run build` — `tsc` (type-only, `noEmit: true` in `tsconfig.json`) then
  `vite build` to `dist/`. Confirmed passing on the untouched starter.
- **No test script/framework is installed yet, but the choice is settled:**
  Vitest, pinned to `^3.2.7` (not a bare/`latest` install — `latest` requires
  Vite ^6/7/8 and is incompatible with the installed Vite `5.4.21`). See
  `multi-sim-architecture.md`'s "Testing strategy" section for the exact
  `package.json`/`vite.config.js` changes and what to test first (pure
  functions in `src/common/physics/`).
- `npx tsc --noEmit` and `npx eslint .` can be run directly for a fast
  check without a full Vite build.

## Verification commands to run after substantial changes

```bash
npx tsc --noEmit     # type errors
npx eslint .          # lint errors/warnings
npm run build         # full production build (also re-runs tsc)
```

A feature is not complete while any of these fail — see project `CLAUDE.md`.
There is no automated runtime/UI test here; anything claimed to "work" at
runtime should actually be exercised (dev server + browser, or the `run`
skill) rather than inferred from passing typecheck/build alone.

## Project structure conventions

Current (one starter screen):

```
src/
  init.ts, assert.ts, splash.ts, brand.ts, main.ts   # fixed bootstrap chain
  screen-name/
    SimScreen.ts
    model/SimModel.ts
    view/SimScreenView.ts
```

Target, once the three simulations are scaffolded (confirmed architecture,
see `multi-sim-architecture.md` — not yet applied):

```
sound-waves.html, standing-waves.html, kundt-tube.html   # independent entries
src/
  common/{physics/, view/}       # shared only once genuinely shared, see multi-sim-architecture.md
  sound-waves/{init.ts, assert.ts, splash.ts, brand.ts, main.ts, model/, view/}
  standing-waves/{...}            # mirrors sound-waves/
  kundt-tube/{...}                 # mirrors sound-waves/
```

To add a new simulation:

1. Create `src/<sim-name>/{init.ts, assert.ts, splash.ts, brand.ts, main.ts,
   <Sim>Screen.ts, model/<Sim>Model.ts, view/<Sim>ScreenView.ts}` mirroring
   `src/screen-name/` — each simulation is its own single-screen `Sim` with
   its own bootstrap chain and unique `init()` name/title, **not** a `Screen`
   added to one shared `Sim` (see `multi-sim-architecture.md` for why).
2. Add the corresponding HTML entry (`<sim-name>.html`) and register it in
   `vite.config.js`'s `build.rollupOptions.input`.
3. Model class: plain TypeScript, Axon `Property`s for all observable state,
   `reset()` and a `step(dt)` method if the model is time-dependent — Joist
   calls it automatically (see `architecture.md`'s confirmed stepping
   section); no imports from `scenery`/`sun`/`scenery-phet`.
4. View class: extends `ScreenView`, builds the scene graph from Nodes bound
   to the model's Properties, wires a `ResetAllButton`, implements its own
   `step(dt)` only for view-local (non-physics) animation — never call
   `model.step(dt)` from the view, Joist already does.
5. Run the verification commands above.

Only promote code to `src/common/` once at least two of the three simulations
actually share it — don't pre-build a shared abstraction speculatively.

## Recommended agent workflow (project convention)

For substantial work (a new interactive feature, a physics model, a
significant visual change) — not for trivial edits (typo fix, renaming, a CSS
tweak):

1. **Main Claude** plans the requested behavior (what model state, what
   controls, what the physics/visualization should show).
2. **`scenery-developer`** implements it (preloads this `scenerystack` skill).
3. **`physics-reviewer`** audits substantial physics changes independently.
4. **`pedagogy-reviewer`** reviews substantial interaction/visualization
   changes for educational clarity.
5. **`qa-tester`** validates the result (typecheck/lint/build + runtime/reset/
   edge-case checks).
6. Important findings from any reviewer are fixed before the work is
   considered done.

Do not invoke every agent mechanically for a one-line fix — use judgment about
what counts as "substantial." See each agent's own file in `.claude/agents/`
for its exact scope.

## Git

The repository was initialized with a single commit containing the untouched
`scenerystack` starter template, before any project-specific configuration.
Keep configuration changes (skills, agents, `CLAUDE.md`) and simulation
implementation work in separate, reviewable commits going forward.
