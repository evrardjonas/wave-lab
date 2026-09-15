# API Patterns

## Axon: Property family (official behavior, verified against installed source)

Source: `scenerystack.org/learn/emitters-and-properties/` + installed
`node_modules/scenerystack/src/axon/js/*.ts`.

- **`Property<T>`** — general observable value. `.value` / `.get()` / `.set(v)`;
  `.link(listener)` fires immediately with the current value *and* on every
  future change; `.lazyLink(listener)` only fires on future changes;
  `.unlink(listener)` removes a listener (always do this on disposal).
- **Subtypes**: `NumberProperty`, `BooleanProperty`, `StringProperty`, and
  `Vector2Property` (Dot) are thin, validated wrappers. Prefer them over a bare
  `Property<number>` etc. when they fit — they self-document units/range.
- **`ReadOnlyProperty<T>`** — a `Property` **is-a** `ReadOnlyProperty`; expose
  the read-only-typed reference from a model's public API when external code
  should observe but not mutate a value it doesn't own.
- **`DerivedProperty`** — a `Property` whose value is a pure function of other
  `Property` dependencies; cannot be set directly. Use for anything that is
  "always consistent with" other model state (e.g. a computed wavelength from
  frequency + speed) instead of manually re-deriving it in multiple listeners.
- **`Multilink`** — runs a callback when any of several `Property`s change, but
  produces no `Property` of its own. Use for side effects (e.g. updating a
  view) that don't need to be exposed as state.
- **`Emitter`** — for discrete events with no persisted value (`emitter.emit(...)`,
  `.addListener(...)`, `.removeListener(...)`). Use `Property` for anything
  that has an ongoing "current value"; use `Emitter` for one-off happenings
  (e.g. "collision occurred", "reset pressed").
- **`TinyProperty`/`TinyEmitter`** — stripped-down, no PhET-iO instrumentation
  or validation. Only reach for these in a profiled hot path (per-frame,
  thousands of instances); default to the full `Property`/`Emitter`.

### ⚠ Documented discrepancy between the official guide and the installed API

The official `emitters-and-properties` guide shows this pseudocode for a
ranged `NumberProperty`:

```js
const speedProperty = new NumberProperty(0, {
  range: { min: 0, max: 100 },   // <-- guide's example
  units: 'm/s'
});
```

**This is not what the installed API accepts.** Inspecting
`node_modules/scenerystack/src/axon/js/NumberProperty.ts`, `SelfOptions.range`
is typed as `Range | Property<Range>` — a real `Range` *instance* (from
`scenerystack/dot`), not a `{min, max}` object literal:

```ts
import { NumberProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";

const speedProperty = new NumberProperty(0, {
  range: new Range(0, 100),
  units: "m/s",
});
```

**Lesson for this repo**: treat official guide code samples as illustrating
*intent*, not as copy-pasteable ground truth — always cross-check the actual
option types in `node_modules/scenerystack/src` before using an option you
haven't used before, exactly as this case required.

## Dot: math types (official)

- `Vector2` — 2D point/vector; immutable-by-convention (most operations return
  a new `Vector2` unless prefixed `...Mutable` or similar — check the specific
  method before assuming in-place mutation).
- `Bounds2` — axis-aligned bounding box (`minX/minY/maxX/maxY`, `center`,
  `width`/`height`). Scenery's layout system (`selfBounds`, `localBounds`,
  `bounds`) is built on this type — see `ui-and-interaction.md`.
- `Range` — `new Range(min, max)`; used by `NumberProperty`, sliders, etc.
- `Matrix3` — general affine transform; rarely needed directly (`Node.rotation`
  /`.translation`/`.scale` cover the common cases — see `ui-and-interaction.md`).

## Kite: geometry (official)

- `Shape` — path-building API similar to `CanvasRenderingContext2D` (`moveTo`,
  `lineTo`, `arc`, etc.), or parsed from an SVG path string. Used to back a
  Scenery `Path` node for any custom geometry (e.g. a tube cross-section, a
  waveform outline) that isn't a `Rectangle`/`Circle`/`Line`.

## The `optionize` pattern (official convention, used pervasively upstream)

PhET/SceneryStack code defines a `SelfOptions` type for a class's own options,
then merges it with the parent class's options type via `optionize<...>()`
from `scenerystack/phet-core`, supplying defaults for everything optional.
Example shape (see `ScreenView`'s own source for a real instance):

```ts
type SelfOptions = {
  someFlag?: boolean;
};
export type MyNodeOptions = SelfOptions & NodeOptions;

class MyNode extends Node {
  public constructor(providedOptions?: MyNodeOptions) {
    const options = optionize<MyNodeOptions, SelfOptions, NodeOptions>()({
      someFlag: false, // default
    }, providedOptions);
    super(options);
  }
}
```

**When to use this in wave-lab**: reach for `optionize` when building a
genuinely reusable `Node` subtype (e.g. a shared `WaveformNode` used by more
than one sim) that needs to merge its own options with a parent Node's
options. For simple, single-use view code, a plain constructor parameter or
inline options object is fine — don't add `optionize` ceremony to code that
isn't actually being extended/reused (see "avoid premature over-generalization"
in the project `CLAUDE.md`).

## Import styles (official, both valid)

```ts
// Per-module imports (smaller bundles without advanced tree-shaking) — used
// throughout this project's generated starter code:
import { Display } from "scenerystack/scenery";
import { NumberProperty } from "scenerystack/axon";

// Root-package import (fine for Vite, which tree-shakes):
import { Display, NumberProperty } from "scenerystack";
```

**Convention for this repo**: keep the per-module import style already used in
`src/main.ts` etc. (`scenerystack/scenery`, `scenerystack/axon`, ...) for
consistency, unless there's a concrete reason to switch.

## Tandem / PhET-iO plumbing (official requirement, not full instrumentation)

`ScreenOptions` and `ScreenViewOptions` both require a `tandem` (default
`Tandem.REQUIRED`). The generated starter passes
`Tandem.ROOT.createTandem("simScreen")` for the one screen. This project is
**not** attempting full PhET-iO instrumentation (data-studio recording,
state save/restore, etc.) — treat `tandem` as required wiring to satisfy the
type system and Joist's internals, not as a feature to build out, unless
explicitly asked to.
