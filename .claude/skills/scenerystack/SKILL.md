---
name: scenerystack
description: SceneryStack (PhET-style) simulation development for this repository — model/view architecture, Scenery scene graph, Axon Property state, Sun/scenery-phet UI, layout, input, and accessibility. Use whenever writing, reviewing, or planning TypeScript code that imports from the "scenerystack" package, or when deciding how to structure a Sim/Screen/Model/View in this project.
---

# SceneryStack Development (wave-lab)

This project (`wave-lab`) is a SceneryStack 3.0.0 simulation, scaffolded from
`npm create scenerystack@latest`. It will eventually contain three **original**
educational physics simulations — Sound Waves, Standing Waves, Kundt Tube —
plus shared components. See `references/phet-reference-policy.md` before
touching anything that resembles an existing PhET sim.

## Golden rule: never invent an API

SceneryStack's public surface is large and PhET's documentation is sometimes
thin, stale, or written as pseudocode (see `references/phet-reference-policy.md`
for a concrete example). Before using any class, constructor option, or method
you are not already certain of:

1. **Inspect the installed source/types first** — this is the fastest and most
   reliable source of truth:
   - Barrel files listing everything a module exports:
     `node_modules/scenerystack/src/<module>.ts` (e.g. `axon.ts`, `scenery.ts`,
     `sun.ts`, `scenery-phet.ts`, `dot.ts`, `kite.ts`, `bamboo.ts`, `tambo.ts`).
   - Real implementation + doc comments + option types:
     `node_modules/scenerystack/src/<module>/js/<ClassName>.ts`.
   - TypeScript will also just tell you: hover/autocomplete or `npx tsc --noEmit`
     surface the real constructor/option signatures immediately.
2. **Check official docs** at scenerystack.org (`/learn/*`, `/reference/api/*`)
   if the source alone doesn't explain *intent* or usage pattern.
3. **Check an official example** (PhET sim source, SceneryStack demo) only for
   *pattern/API usage*, never to copy simulation-specific logic — see the PhET
   reference policy doc.
4. Only then write the code.

If after all three steps an API is still unclear, say so explicitly rather than
guessing at a plausible-sounding method name.

## Module responsibilities (do not blur these)

| Module | Responsibility | Notes |
|---|---|---|
| **Scenery** | Scene graph, rendering (SVG/Canvas/WebGL), input dispatch, PDOM/accessibility plumbing | `scenerystack/scenery` |
| **Axon** | Observable state (`Property`) and events (`Emitter`) | `scenerystack/axon` — this is the *only* place model state should live |
| **Sun** | Reusable, generic UI controls (buttons, sliders, checkboxes, panels) | `scenerystack/sun` |
| **Scenery-PhET** | Simulation-flavored UI (`NumberControl`, `ThermometerNode`, `TimeControlNode`, `ResetAllButton`, `ArrowNode`, ...) | `scenerystack/scenery-phet` |
| **Dot** | Math: `Vector2`, `Bounds2`, `Range`, `Matrix3`, etc. | `scenerystack/dot` |
| **Kite** | 2D geometry: `Shape` construction/boolean ops | `scenerystack/kite` |
| **Joist/Sim** | Simulation shell: `Sim`, `Screen`, `ScreenView`, navigation bar, Home screen | `scenerystack/sim` |
| **Tandem** | PhET-iO instrumentation plumbing (required option, not full instrumentation in this project) | `scenerystack/tandem` |
| **Bamboo** | Charts/plots (useful for waveform/amplitude displays) | `scenerystack/bamboo` |
| **Tambo** | Sound/sonification | `scenerystack/tambo` |
| **Twixt** | Animation/easing | `scenerystack/twixt` |

Model code must never import from `scenery`, `sun`, or `scenery-phet`. View
code reads model `Property`s and renders/reacts to them — it does not own
physics or simulation state. See `references/architecture.md`.

## Reference files

- **`references/architecture.md`** — model/view separation, Sim/Screen/ScreenView,
  this project's file layout and load order, stepping/time evolution, reset.
- **`references/api-patterns.md`** — Axon Property family, Dot/Kite math types,
  the `optionize` options pattern, import styles, Tandem basics. Includes a
  documented case where the official guide's example code doesn't match the
  installed API — a template for how to handle that when it happens again.
- **`references/ui-and-interaction.md`** — Scenery nodes, layout containers,
  Sun/scenery-phet/bamboo component inventories, input handling (pointers,
  `DragListener`/`FireListener`/`KeyboardDragListener`), responsive layout.
- **`references/accessibility.md`** — Parallel DOM (PDOM), accessible name/help
  text, keyboard nav and focus order, Voicing, this project's accessibility bar.
- **`references/development-workflow.md`** — npm scripts, typecheck/build/lint,
  project structure conventions, how to add a screen, agent review workflow.
- **`references/phet-reference-policy.md`** — what may and may not be learned
  from existing PhET simulations; when to stop and ask before reusing code.

## Repository conventions (this project, not upstream SceneryStack policy)

- TypeScript, `strict: true` (see `tsconfig.json`). No `any` without a documented reason.
- One screen so far: `src/screen-name/{SimScreen.ts, model/SimModel.ts, view/SimScreenView.ts}`.
  New screens/sims should follow this `model/` + `view/` split per screen.
- Load order is fixed and must not be reordered: `init.ts` → `assert.ts` →
  `splash.ts` → `brand.ts` → everything else in `main.ts`.
- SI units internally in all models; convert only at the view/display boundary.
- Prefer native SceneryStack components (Sun/Scenery-PhET/Bamboo) over hand-rolled
  DOM/Canvas/SVG, even when a generic implementation looks faster to write —
  native components come with accessibility, layout, and input handling built in.
- No feature is "done" while `npx tsc --noEmit`, `npx eslint .`, or `npm run build` fail.
