# UI, Layout, and Interaction

## Scenery scene graph basics (official)

- Everything visible is a `Node` (`scenerystack/scenery`) in a DAG-shaped scene
  graph — a `Node` can have multiple children and (unusually) multiple
  parents, but never a cycle.
- Children render back-to-front in array order (`children[0]` is behind
  `children[1]`). Use `addChild`/`removeChild`/`insertChild`, or set
  `.children = [...]` wholesale.
- Shapes: `Rectangle`, `Circle`, `Line` are `Path` subtypes with `fill`/`stroke`.
  Anything custom (waveform outlines, tube cross-sections, arbitrary curves)
  goes through a Kite `Shape` passed to a `Path`.
- Text: `Text` (plain) and `RichText` (subset of HTML-like markup, can embed
  Nodes). Both accept a plain `string` **or** a `TReadOnlyProperty<string>`
  and update automatically when that Property changes — always prefer passing
  a string Property over manually calling `.string = ...` in a listener, for
  future localization.
- `Display` creation, `initializeEvents()`, and the animation-frame loop are
  **already handled internally by `Sim`** for this project — application
  screens never construct their own `Display`.

## Coordinate frames and positioning (official)

- **Local coordinate frame**: a Node's own content/children are positioned
  here; origin at the Node's own `(0,0)`, ignoring the Node's own transform.
- **Parent coordinate frame**: the local frame after the Node's own transform
  (`translation`/`rotation`/`scale`/`matrix`) is applied — this is what a
  parent sees.
- Declarative option application order: matrix → translation → rotation →
  scale, then bounds-based positioning options (`center`, `left`, `top`, ...)
  are applied last, after size-affecting options.
- `Bounds2`-based positioning getters/setters exist for common anchor points:
  `left/right/top/bottom/centerX/centerY/center/leftTop/rightBottom/...`.
  Prefer these over manual `Vector2` math when placing Nodes relative to each
  other's bounds.

## Layout containers (official — see scenerystack.org `/learn/scenery-layout/`)

- **`HBox` / `VBox`** (`FlowBox` shortcuts) — CSS-flexbox-like row/column
  layout. Key options: `spacing`, `align`, `justify`, `stretch`, `grow`, `wrap`,
  `margin`/`xMargin`/`yMargin`.
- **`GridBox`** — CSS-grid-like; `rows`/`columns`/`autoRows`/`autoColumns`,
  per-cell `horizontalSpan`/`verticalSpan`, `xGrow`/`yGrow`.
- **`AlignBox`** — positions/pads a single Node within given bounds or
  preferred size; **`AlignGroup`** makes multiple `AlignBox`es share the same
  width and/or height (e.g. a row of equally-sized control panels).
- **`ManualConstraint`** — imperative-style continuous constraint between
  Nodes that don't share a parent or need custom logic beyond what
  `HBox`/`GridBox` express (e.g. `someNode.left = otherNode.right`, kept in
  sync automatically). Reach for this only when the built-in containers can't
  express the layout.
- **Sizable Nodes** mix in `WidthSizable`/`HeightSizable`/`Sizable` and expose
  `preferredWidth`/`preferredHeight` (and local-frame equivalents). Common
  pitfall documented upstream: setting `preferredWidth`/`preferredHeight`
  directly on a Node that's *inside* a resizable layout container will be
  overwritten by the container — set layout-affecting sizing via the
  container's `layoutOptions` (e.g. `minContentWidth`) instead.

## Responsive layout in this project

- Build sim content relative to `screenView.layoutBounds`
  (`Bounds2(0,0,1024,618)` by default) for the primary composition, and use
  `screenView.visibleBoundsProperty` for anything that must react to the
  actual (possibly wider/narrower) visible viewport — e.g. a full-bleed
  background rectangle, or floating controls pinned to a screen edge on very
  wide displays. See `ManualConstraint`/layout containers above rather than
  hand-rolling resize listeners.
- Confirm actual responsive behavior by resizing the browser during
  `qa-tester` passes — `Display` does not automatically resize when its
  container element resizes unless `resizeOnWindowResize()`/full-window mode
  is in play, and Joist's `Sim` already manages this; don't re-implement it.

## Sun components (generic UI) — installed inventory

Buttons: `TextPushButton`, `RectangularPushButton`, `RoundPushButton`,
`ArrowButton`, `*ToggleButton` / `*StickyToggleButton` variants, `Checkbox`,
`AquaRadioButton(Group)`, `RectangularRadioButton(Group)`, `OnOffSwitch`,
`ToggleSwitch`. Controls: `Slider` (`HSlider`/`VSlider`), `NumberSpinner`,
`NumberPicker`, `ComboBox`. Containers: `Panel`, `AccordionBox`, `Carousel`,
`PageControl`. Always check `sun.ts` for the current full list before assuming
a component doesn't exist.

## Scenery-PhET components (sim-flavored UI) — most relevant to wave-lab

- **`ResetAllButton`** — already used in the starter.
- **`NumberControl`** / **`NumberDisplay`** — labeled numeric control with
  slider + readout; good fit for frequency/amplitude/wavelength controls
  instead of hand-building a slider + text label combo.
- **`ThermometerNode`**, **`GaugeNode`**, **`ProbeNode`** — dial/gauge-style
  readouts; consider for pressure/intensity displays (Sound Waves, Kundt Tube).
- **`ArrowNode`**, **`LineArrowNode`** — vector/displacement indicators.
- **`RulerNode`**, **`MeasuringTapeNode`** — for letting students measure
  wavelength/node spacing directly, which is pedagogically strong for Standing
  Waves / Kundt Tube.
- **`TimeControlNode`** — standard play/pause/step-forward/speed control; use
  this rather than hand-building transport controls.
- **`SoundToggleButton`** — standard mute/unmute affordance if Tambo sound is added.
- Full inventory is in `node_modules/scenerystack/src/scenery-phet.ts` — check
  it before assuming a needed component doesn't exist upstream.

## Bamboo (charts) — relevant for waveform/amplitude plots

`ChartTransform`, `ChartRectangle`, `LinePlot`/`CanvasLinePlot`, `AreaPlot`,
`ScatterPlot`, `AxisLine`, `TickMarkSet`/`TickLabelSet`, `GridLineSet`. This is
the native way to plot a live waveform (displacement vs. position, or vs.
time) rather than hand-drawing a `Shape` path per frame — prefer it once a
sim needs an actual axis-labeled plot; a simple oscillating `Shape` is fine
for a purely illustrative (non-quantitative) waveform.

## Input handling (official)

- A **pointer** abstracts mouse / a single touch / pen. Mouse pointers persist;
  touch/pen pointers are created on `down` and released on `up`/`cancel`.
- Base event types: `down`, `up`, `cancel`, `move`, `wheel`, `enter`, `exit`,
  `over`, `out`, `keydown`, `keyup`. Listeners can be added to a `Node`, a
  `Pointer`, or the `Display`; dispatch order is pointer → target node →
  bubbling up the trail → display.
- **Prefer the high-level listeners** over hand-rolling `down`/`up`/`move`:
  - `DragListener` — dragging.
  - `FireListener` — button-like press/fire.
  - `PressListener` — general press/release base behavior.
  - `KeyboardDragListener` — arrow-key/WASD-based dragging, with configurable
    step size and axis constraints; essential for keyboard-accessible drag
    interactions (see `accessibility.md`).
- `touchArea`/`mouseArea` can expand a Node's interactive hit region
  independent of its visual bounds — use for small draggable targets.
- `pickable`/`inputEnabled` control whether a Node (and its subtree) responds
  to or blocks input; use `pickable: false` for decorative overlays that
  shouldn't intercept clicks meant for content behind them.

## Declarative vs. imperative

Both styles are supported and can be mixed: declarative (options object at
construction, or reactive bindings via `Property.link`) for state-driven UI;
imperative (direct property assignment / method calls) for
performance-sensitive or highly procedural updates (e.g. per-frame physics
rendering in `step(dt)`). Per-frame wave/phase updates in these sims will
often be imperative (`node.translation = ...`, `path.shape = ...` inside
`step`), which is the documented, expected pattern — not a shortcut to avoid.
