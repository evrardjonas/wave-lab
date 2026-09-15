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
- **No test script/framework is configured yet.** If real unit tests become
  necessary (e.g. for wave-physics math functions), that decision and the
  framework choice (Vitest is the natural fit for a Vite project) should be
  raised explicitly, not silently added.
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

```
src/
  init.ts, assert.ts, splash.ts, brand.ts, main.ts   # fixed bootstrap chain
  <screen-name>/
    <ScreenName>Screen.ts
    model/<ScreenName>Model.ts
    view/<ScreenName>ScreenView.ts
  common/                # (not yet created) shared code used by 2+ sims
```

To add a new screen for one of the three simulations:

1. Create `src/<sim-name>/{<Sim>Screen.ts, model/<Sim>Model.ts,
   view/<Sim>ScreenView.ts}` mirroring `src/screen-name/`.
2. Model class: plain TypeScript, Axon `Property`s for all observable state,
   `reset()` and `step(dt)` methods, no imports from `scenery`/`sun`/
   `scenery-phet`.
3. View class: extends `ScreenView`, builds the scene graph from Nodes bound
   to the model's Properties, wires a `ResetAllButton`, implements its own
   `step(dt)` and `reset()` for view-local state (see `architecture.md` for
   the model/view step coupling caveat).
4. Register the new `Screen` in `main.ts`'s `screens` array (each simulation
   will likely be its own separate `Sim`/entry point rather than screens of
   one combined app — confirm this decision before scaffolding multiple sims
   into a single `Sim`).
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
