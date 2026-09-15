# Multi-Sim Architecture (confirmed, not a proposal)

This records a settled architecture decision for wave-lab, reached by
inspecting installed SceneryStack source (`node_modules/scenerystack/src/`)
plus independent physics and pedagogy analysis. Treat the facts below as
confirmed, not "assumptions to verify" — citations are into `Sim.ts`,
`SimDisplay.ts`, `Screen.ts`, `TModel.ts`, `HomeScreen.ts` unless noted.

## Decision: three independent `Sim` entry points, not one `Sim` with three `Screen`s

**Rejected — one `Sim`, three `Screen`s**: `Sim.ts` constructs a `HomeScreen`
(screen-selector UI) whenever `screens.length > 1`, plus a shared
`NavigationBar` with per-screen icon buttons. This structurally welds all
three simulations into one single-launch application with one shared chrome —
incompatible with "each sim independently embeddable on a different page."

**Chosen — three separate `Sim`s sharing code via a common directory**:

- Each sim gets its own full bootstrap chain (`init.ts → assert.ts →
  splash.ts → brand.ts → main.ts`), its own HTML entry point, and its own
  single `Screen`. This is the only structure that produces three separately
  launchable artifacts.
- **Why per-page duplication of the bootstrap chain is unavoidable and fine**:
  `scenerystack/init`'s `init()` writes sim identity (`name`, `version`,
  `brand`, `locale`, ...) onto `self.phet.chipper.*` — genuine global/window
  state. `Sim.ts` even asserts `!self.phet.joist.sim` ("Only supports one sim
  at a time") when constructing. **This means two `Sim`s can never coexist in
  one JS global scope/page** — but each Vite HTML entry (and each `<iframe>`
  embedding one) has its own `window`, so this never conflicts across our
  three separate builds. It would only matter if someone tried to mount two of
  these sims in one page, which is explicitly not the plan.
- **Shared code has no SceneryStack-level obstacle**: `src/common/` can be
  freely imported by all three entries' module graphs. Nothing about Axon,
  Tandem, or Joist prevents importing the same TypeScript module from multiple
  independent entry points.
- **No alternative supported multi-sim tooling exists**: the installed
  `scenerystack` package's own CLI (`bin/scenerystack.js`) only has
  `checkout`/`build` commands for building the SceneryStack *framework itself*
  from a full source checkout — not a consumer-facing multi-sim scaffold.
  There is no third option to consider here.
- **Divergence from PhET's own practice, noted deliberately**: PhET's actual
  model is one sim per repo, sharing libraries as separate published packages
  (axon, scenery, sun, ...), not a shared in-repo folder. We're intentionally
  using one repo with a shared folder instead — nothing in the framework
  blocks this, it's a repo-organization choice.

## Embeddability constraint: `Sim` cannot be sized into a container — plan around `<iframe>`s

`SimDisplay.ts` hard-sets `assumeFullWindow: true` when constructing its
`Display`, appends its root DOM element to `document.body` unconditionally,
and sizes off `window.innerWidth`/`innerHeight` (with resize listeners on
`self`/`window`, not any container element). **There is no `container` option
exposed at the `Sim`/`SimDisplay` level** (the underlying `Display` class
itself supports a `container` option, but `Sim` never surfaces it) — this
cannot be worked around without patching framework internals, which is out of
scope (never fork/patch the framework — see `phet-reference-policy.md`'s
spirit, and `SKILL.md`'s "never invent an API" rule extends to "never bypass
a documented framework constraint").

**Consequence for embedding**: each sim's built page must be embedded as a
whole page inside a sized `<iframe>` on the host website, not mounted into a
`<div>` alongside other page content directly. Inside an iframe, "full
window" is the iframe's own allotted rectangle, so `Sim`'s assumption is
satisfied for free. This is standard PhET embedding practice.

## Repository tree

```
wave-lab/
├── sound-waves.html
├── standing-waves.html
├── kundt-tube.html
├── index.html                 # optional dev-only landing page, not required
├── vite.config.js             # + build.rollupOptions.input, see below
├── package.json                # + vitest devDependency, "test" script
├── tsconfig.json               # unchanged
├── src/
│   ├── common/
│   │   ├── physics/
│   │   │   ├── waveMath.ts         # evaluateSinusoid(), superposeCounterPropagating()
│   │   │   ├── harmonics.ts        # {NODE,ANTINODE} boundary pair -> f_n(L, v, pair, n)
│   │   │   ├── units.ts            # v=fλ, period<->frequency, display-boundary conversions
│   │   │   └── *.test.ts           # Vitest, colocated
│   │   └── view/                   # populate only once >=2 sims need a given item — see below
│   ├── sound-waves/
│   │   ├── init.ts, assert.ts, splash.ts, brand.ts, main.ts
│   │   ├── model/SoundWavesModel.ts
│   │   └── view/{SoundWavesScreenView.ts, SoundWavesScreen.ts}
│   ├── standing-waves/             # mirrors sound-waves/
│   └── kundt-tube/                 # mirrors sound-waves/
```

## Build strategy

`vite.config.js` needs a `build.rollupOptions.input` map (Vite 5.4.21,
installed, supports multi-page builds natively — no plugin required):

```js
build: {
  rollupOptions: {
    input: {
      soundWaves: "sound-waves.html",
      standingWaves: "standing-waves.html",
      kundtTube: "kundt-tube.html",
    },
  },
}
```

`npm run build` (`tsc && vite build`) is otherwise unchanged — `tsc` still
type-checks the whole `src/` tree (all three sims + `common/`) in one pass;
`vite build` now emits three independent bundles instead of one. Not yet
applied to this repo — this is the recorded plan for when sim implementation
begins, per project instruction to resolve architecture before implementing.

## Stepping architecture

See the "Stepping / time evolution" section in `architecture.md` — fully
confirmed against `Sim.ts`/`Screen.ts`/`TModel.ts` source, including exact
line references. Summary: Joist calls `model.step(dt)` automatically if (and
only if) the model defines it, and `view.step(dt)` unconditionally, once per
frame, for the active screen, with `dt` capped by `Screen.maxDT`. Views must
never call `model.step` themselves.

## Shared code boundary

**Governing test** (from independent physics and pedagogy analysis, and
matching `CLAUDE.md`'s existing "avoid premature over-generalization" and
"promote to shared code only once ≥2 sims need it" rules): share anything
that carries **no physical or pedagogical meaning**; keep anything that
**assigns physical meaning to a number** local to its own simulation.

### Belongs in `src/common/physics/`

- A pure sinusoid/traveling-wave evaluator and standing-wave
  superposition-of-two-counter-propagating-waves function — takes
  `(k, ω, A, φ, x, t)`, returns a bare, physically-unlabeled `number`. Must
  not be named/documented as returning a specific physical quantity (no
  `getDisplacement()`).
- A generic numeric superposition/summation utility — with type-level
  guarding so a pressure contribution can never be summed with a displacement
  contribution (they're different physical types, see below).
- A `{NODE, ANTINODE}` boundary-condition-pair → harmonic-series function,
  operating purely on `(L, v, pair, n)`. Both "fixed string end / closed pipe
  end" (both = displacement nodes) and "free string end / open pipe end"
  (both = displacement antinodes = pressure nodes) reduce to the same
  `{NODE, ANTINODE}` pair once phrased consistently in terms of the
  displacement-type field — the resulting math (`f_n = (2n−1)v/(4L)` for
  mixed ends, `f_n = nv/(2L)` for matched ends) is legitimately shared.
- `v = fλ` and general unit-conversion helpers at the display boundary
  (Hz↔period, m↔cm for display, Pa↔display units).
- Only if ≥2 sims concretely need it: a decay/damping envelope helper; a
  generic ODE (e.g. RK4) or FDTD stencil update operating on abstract numeric
  state with zero baked-in physical semantics. Likely unnecessary — these
  three sims have known closed-form sinusoidal/standing-wave solutions, so
  most interactions can be evaluated analytically per frame with no numerical
  integration at all.

### Belongs in `src/common/view/` (populate only once genuinely shared, not preemptively)

- `Panel`/`AccordionBox` control-panel chrome (fills, stroke, corner radius,
  padding) — no physics meaning.
- `TimeControlNode` usage — play/pause semantics are identical across all
  three. **Caveat**: share the component, but let each sim configure its own
  step granularity/timescale — don't let sharing the widget pressure Kundt
  Tube's (likely slower, dust-needs-time-to-visibly-redistribute) model
  timescale to match the other two "for consistency."
- `ResetAllButton` placement/behavior convention.
- `PhetFont` / typography scale.
- A non-physics UI chrome color palette, deliberately kept out of the
  physics-quantity color space (see below).
- The slider + numeric readout **interaction pattern** (drag → live labeled
  value with units) as a reusable component — but the quantity, its Property,
  its unit, and its range are never shared data; each sim wires its own.
- Shared unit/label formatting rules (decimal precision, unit placement) —
  not the units themselves, which are physics-dictated per quantity.
- A lightweight quantity→color **constants file** (e.g. `DISPLACEMENT_COLOR`,
  `PRESSURE_COLOR`) — cheap, and useful even within a single sim if it shows
  both displacement and pressure. This is a constants file, not a runtime
  theming service.
- Authoring rule (not code, applies to every sim): launch in a state where
  the phenomenon is immediately visible (not amplitude=0 or an off-resonance
  default); Reset returns to that same sensible default.

### Must NOT be shared, with the specific reason

- **No generic `WaveModel`/`WaveEngine` class with a `waveType` discriminant.**
  Flagged independently by both physics and pedagogy analysis as the
  highest-risk anti-pattern — it smuggles physically-different logic behind
  one interface, recreating the coupling this architecture is meant to avoid.
- **No generic `Medium` abstraction** spanning string and gas — string wave
  speed (`v = √(T/μ)`, tension/linear-density) and sound speed
  (thermodynamic/composition-dependent, or user-set) have unrelated
  derivations; forcing both through one interface either trivializes it or
  invites false-equivalence bugs.
- **No shared wave *renderer*.** Transverse (Standing Waves: literal
  perpendicular offset of a string) and longitudinal (Sound Waves/Kundt Tube:
  particle-spacing/density or pressure shading) are different rendering
  *techniques*, not parameterizations of one component. Drawing a longitudinal
  wave as a transverse "wiggle" is the single most common student
  misconception about sound — a shared renderer would risk actively
  reinforcing it. A longitudinal particle/density renderer *may* reasonably
  be shared between Sound Waves and Kundt Tube specifically (both are
  longitudinal-in-a-tube) — confirm this once both are actually being built,
  don't assume it now.
- **No shared encoding for acoustic pressure vs. particle/string
  displacement.** Different units, 90°-phase-shifted for a traveling wave.
  Conflating them is not just confusing — for Kundt Tube specifically it
  would compute the dust-accumulation pattern at the wrong (inverted)
  location, since dust piles at displacement nodes = pressure antinodes.
- **No shared amplitude-relationship constant** like
  `ΔP_max = ρ·v·ω·s_max` (relates pressure amplitude to displacement
  amplitude) — acoustic-impedance-specific, no string analog.
- **No shared boundary-condition *mechanism/justification* code.** Only the
  resulting node/antinode → harmonic-series math (above) may be shared; the
  physical cause (mechanical tension/restoring force at a fixed string point
  vs. acoustic impedance mismatch at a pipe opening) must stay local to each
  sim — sharing it would imply an equivalence beyond the resulting pattern.
- **No shared dust-pile/node-marker rendering component.** Kundt Tube dust
  accumulation is a real, physically accumulating phenomenon (particles
  settle where time-averaged particle velocity is ~0); a string node is
  geometric stillness with nothing accumulating. Only the abstract "model
  exposes a computed array of node/antinode positions" concept may
  generalize — never the visual marker/renderer built on top of it, since
  making them look similar would itself misrepresent the Kundt Tube
  mechanism as "just a marker."
- **No full runtime color-theming service** — a plain constants file (above)
  is proportionate; more infrastructure is premature for three
  independently-launched sims. Never force Kundt Tube's dust into an
  abstract quantity-color scheme — physical/representational fidelity
  (dust-colored dust) wins over palette consistency in that one case.
- **No shared default parameter ranges or starting states** — each sim's
  "immediately legible" launch state is an independent, phenomenon-specific
  pedagogical judgment call (e.g. Standing Waves should probably launch
  already at a harmonic; Kundt Tube near a resonance so dust visibly piles).

## Testing strategy

- **Add Vitest, pinned explicitly to `^3.2.7`** — do not `npm install -D
  vitest` with no version pin. `latest` (currently 5.0.1) requires Vite
  `^6||^7||^8`; this project has Vite `5.4.21` installed. Vitest `3.2.7`
  requires `vite ^5.0.0` and Node `^18||^20||>=22` (local Node: 22.14.0) —
  confirmed clean.
- No separate `vitest.config.ts` needed: change `vite.config.js`'s
  `defineConfig` import from `"vite"` to `"vitest/config"` (a strict
  superset) and add a `test: { environment: "node", include:
  ["src/**/*.test.ts"] }` block. This has zero interaction with the
  multi-page `build.rollupOptions.input` above — Vitest's transform pipeline
  never touches Rollup's bundling step.
- No `tsconfig.json` changes needed — import `describe`/`it`/`expect`
  explicitly from `"vitest"` in test files rather than adding
  `"types": ["vitest/globals"]` (which would inject ambient globals into
  every file under `strict: true`).
- `package.json`: add `"vitest": "^3.2.7"` devDependency and
  `"test": "vitest run"` script (optionally `"test:watch": "vitest"`).
- **Test now**: pure functions in `src/common/physics/` — deterministic,
  side-effect-free, no DOM. Exactly Vitest's sweet spot.
- **Don't add jsdom/happy-dom yet.** No Screen/View code exists yet to test,
  and jsdom has no real Canvas/SVG rendering or layout engine — it can only
  confirm code doesn't throw, not that it renders correctly; easy to
  overstate that value. Keep pushing logic into pure `common/` functions
  Vitest can test directly; verify actual rendering manually via the dev
  server/browser.
- **Multi-entry build-integrity smoke check** (do all three bundles get
  produced): defer until the multi-page structure actually lands, then add a
  small Node/shell postbuild script asserting the expected `dist/` outputs
  exist, run as a build/CI step — not a Vitest test (would be slow and
  duplicate what a build step already needs to verify).
- **No Playwright/e2e yet** — nothing interactive exists to validate that way;
  revisit once a screen has real, non-trivial interaction.

None of the above (`vite.config.js`, `package.json`, `src/` restructuring,
`vitest` install) has been applied yet — this document records the resolved
plan for when simulation implementation begins.
