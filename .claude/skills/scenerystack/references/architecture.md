# Architecture

## Model/view separation (official)

SceneryStack is explicitly designed around a model/view split (source:
scenerystack.org `/learn/overview/`, "SceneryStack Architecture" section):

- **Model modules**: Axon (`Property`/`Emitter` observable state), Phet-Core
  (utility types), Dot (math), Kite (geometry). Models hold simulation state
  and physics/logic, expressed as `Property` instances and plain methods.
- **View modules**: Scenery (scene graph + rendering + input), Sun (generic UI),
  Scenery-PhET (sim-flavored UI), plus specialized view modules (Bamboo charts,
  Tambo sound, Twixt animation, Mobius 3D).

**Convention for this repo**: a model class (e.g. `SimModel`) must be
constructible and testable with no DOM, no `Display`, and no import from
`scenery`/`sun`/`scenery-phet`. All model state that the view needs to render
or that PhET-iO-style tooling would want to observe should be an Axon
`Property` (or a subtype: `NumberProperty`, `BooleanProperty`, `Vector2Property`,
...), not a plain mutable field — see `api-patterns.md`.

## Sim → Screen → ScreenView (official, from installed source)

- `Sim` (`scenerystack/sim`, `joist/js/Sim.ts`) is constructed with a title
  `TReadOnlyProperty<string>` and an array of `Screen` instances, then
  `sim.start()` is called. This is the *only* place a `Display` is created and
  driven for a simulation — application code does not hand-roll
  `updateOnRequestAnimationFrame` or `display.initializeEvents()` itself; `Sim`
  does this internally.
- `Screen<M, V>` (`joist/js/Screen.ts`) takes `createModel: () => M`,
  `createView: (model: M) => V`, and `ScreenOptions` (requires `tandem`).
  It is generic over the model type and a `ScreenView` subtype.
- `ScreenView` (`joist/js/ScreenView.ts`) extends `Node`. Key facts confirmed
  in source:
  - Default `layoutBounds` is `Bounds2(0, 0, 1024, 618)`
    (`ScreenView.DEFAULT_LAYOUT_BOUNDS`) — the historical "safe" iPad-era
    simulation canvas size. Content should be composed relative to
    `this.layoutBounds`, not hardcoded pixel positions.
  - `visibleBoundsProperty` gives the actual visible area (can be larger than
    `layoutBounds` on wide/narrow windows) — use it, not `layoutBounds`, for
    anything that must track the real viewport edges (see `ui-and-interaction.md`
    on responsive layout).
  - `tandem` is required by default (`Tandem.REQUIRED`).

## This project's current file layout and load order

```
src/
  init.ts     → scenerystack/init: sim name/version/brand/locale metadata. Must run first.
  assert.ts   → scenerystack/assert: enableAssert() for dev-time runtime checks.
  splash.ts   → scenerystack/splash: loading splash screen.
  brand.ts    → scenerystack/brand: brand registration (made-with-scenerystack).
  main.ts     → entry point: builds titleStringProperty, Screen[], `new Sim(...).start()`.
  screen-name/
    SimScreen.ts        → Screen<SimModel, SimScreenView> wiring
    model/SimModel.ts   → plain class: reset(), step(dt)
    view/SimScreenView.ts → ScreenView subclass: builds Nodes, wires ResetAllButton
```

The import chain enforced by `main.ts`'s comment (`init.ts => assert.ts =>
splash.ts => brand.ts => everything else`) is a hard SceneryStack requirement,
not a stylistic choice — each file imports the previous one as its first
statement. Do not reorder these imports or move initialization logic earlier.

**Convention for new sims/screens**: mirror `screen-name/` — one directory per
screen with `model/` and `view/` subfolders. Shared code used by more than one
of Sound Waves / Standing Waves / Kundt Tube belongs in a top-level `src/common/`
(or similar) directory once it is genuinely shared — do not create that
abstraction preemptively (see `development-workflow.md`).

## Stepping / time evolution (CONFIRMED against installed source — see exact call chain)

Verified directly in `node_modules/scenerystack/src/joist/js/Sim.ts` (no longer
an inferred assumption). The loop, once per animation frame:

1. `runAnimationLoop()` (`Sim.ts:1060-1082`) re-schedules itself via
   `requestAnimationFrame` and, only while `activeProperty.value` is true and
   not in playback mode, calls `stepOneFrame()` → `stepSimulation(dt)`.
2. `stepSimulation`'s implementation (`Sim.ts:448-506`) operates on the
   **currently selected/active screen only** — inactive screens are not
   stepped at all. `dt` is capped to that screen's `maxDT`
   (`ScreenOptions.maxDT`, default `0.5`, see `Screen.ts:159`).
3. **Model step — automatic, but conditional** (`Sim.ts:477-479`):
   ```
   if ( screen.model.step && dt ) { screen.model.step( dt ); }
   ```
   `TModel.ts:10-13` declares `step?: (dt: number) => void;` as **optional**.
   If a model doesn't define `step`, Joist silently skips it — no error, the
   model just never advances.
4. **View step — automatic and unconditional** (`Sim.ts:495`):
   `screen.view.step( dt );`, always called (default no-op comes from
   `ScreenView.ts:361-363`), right before the display paints.

**The pattern for this project, settled**:

- Any model with time-dependent physics **must** implement `step(dt): void` —
  Joist calls it for you; you never drive your own `requestAnimationFrame`
  loop or call `model.step` manually from application code.
- A `ScreenView`'s own `step(dt)` **must not** call `model.step(dt)` — Joist
  already calls it independently, in the same frame, before `view.step`;
  calling it again would double-step the model. `ScreenView.step` is only for
  view-local, non-physics animation (exactly what the starter's
  `rotatingRectangle` does — that pattern is fine to keep as-is for pure
  visual flourishes, just don't extend it to drive real model state).
- `dt` is in seconds and is passed uniformly through the chain — keep model
  physics in SI units (seconds, meters, Hz) so `dt` composes directly with
  rate constants without hidden unit conversions.
- Since each of the three planned simulations is a single-screen `Sim` (see
  `multi-sim-architecture.md`), "active screen only" stepping is a non-issue
  in practice — there's only ever one screen to be active.

## Reset pattern (official, matches generated code)

`ScreenView` and models each expose a `reset()` method; `ResetAllButton`
(`scenery-phet`) is wired with a `listener` that calls `model.reset()` then
`this.reset()` (the view's own reset, e.g. resetting local UI-only state such
as pan/zoom). Every new model `Property` that represents user-adjustable or
evolving state must be reset here, or the reset-all affordance becomes
misleading — flag this explicitly during `physics-reviewer`/`qa-tester` passes.

## Multi-sim repository architecture

This project's three planned simulations (Sound Waves, Standing Waves, Kundt
Tube) are each an **independent, single-screen `Sim`** — not three `Screen`s
of one combined `Sim` — specifically to keep them independently
launchable/embeddable. The full reasoning, confirmed constraints (a `Sim` is
a hard page-level singleton, `Sim`/`SimDisplay` cannot be embedded in a sized
container, only a full page in an `<iframe>`), repository tree, build
strategy, and shared/not-shared code boundaries are recorded in
`multi-sim-architecture.md` — read that before scaffolding any of the three
sims or touching `vite.config.js`.

## Assumptions in this document

- `src/common/` as a shared-code location is a suggested convention for this
  repo, not an upstream SceneryStack requirement; see `multi-sim-architecture.md`
  for the confirmed boundary of what belongs there.
