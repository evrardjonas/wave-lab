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

## Stepping / time evolution

- `Sim`/`Display` drives a `requestAnimationFrame` loop and calls each active
  `Screen`'s model and view `step(dt)` methods once initialized (this is Joist
  internal behavior, not something application code wires up manually).
- **Assumption to verify per-screen, not a documented guarantee**: the
  generated starter's `SimScreenView.step(dt)` currently animates its own
  `rotatingRectangle` directly and does not call `model.step(dt)`. Once models
  carry real time-dependent physics state (e.g. wave phase), the view's
  `step(dt)` must not silently diverge from the model's own `step(dt)` — either
  call `model.step(dt)` explicitly from the view's `step`, or rely on
  Screen/Sim to call both independently (confirm behavior in
  `joist/js/Sim.ts` / `Screen.ts` before assuming either).
- `dt` is in seconds and is passed uniformly through the chain — keep model
  physics in SI units (seconds, meters, Hz) so `dt` composes directly with
  rate constants without hidden unit conversions.

## Reset pattern (official, matches generated code)

`ScreenView` and models each expose a `reset()` method; `ResetAllButton`
(`scenery-phet`) is wired with a `listener` that calls `model.reset()` then
`this.reset()` (the view's own reset, e.g. resetting local UI-only state such
as pan/zoom). Every new model `Property` that represents user-adjustable or
evolving state must be reset here, or the reset-all affordance becomes
misleading — flag this explicitly during `physics-reviewer`/`qa-tester` passes.

## Assumptions in this document

- The "Sim calls Screen model/view step" behavior is inferred from PhET/Joist
  conventions and the `Screen`/`ScreenView` source structure, not from a single
  explicit doc paragraph — re-verify against `joist/js/Sim.ts` if step-related
  bugs appear.
- `src/common/` as a shared-code location is a suggested convention for this
  repo, not an upstream SceneryStack requirement.
