# wave-lab

A SceneryStack (PhET-style) simulation project. Long-term goal: three
**original** educational physics simulations — Sound Waves, Standing Waves,
Kundt Tube — plus shared components. See the `scenerystack` skill
(`.claude/skills/scenerystack/`) for framework architecture, API patterns, UI/
input, accessibility, and workflow details; this file states the rules that
govern the whole project.

## Rules

- **Original simulations, not PhET forks.** These sims may take interaction
  ideas, architecture patterns, API usage, accessibility patterns, and visual
  conventions from studying existing PhET simulations, but must never copy
  simulation-specific implementation code. If reusing actual PhET
  implementation code ever seems necessary, stop and ask first. There is also
  a separate, existing HTML resonance game outside this repository — do not
  recreate it here. Full policy: `.claude/skills/scenerystack/references/phet-reference-policy.md`.
- **SceneryStack is the required framework.** Prefer native SceneryStack
  components (Scenery, Sun, Scenery-PhET, Bamboo, ...) over generic DOM/
  Canvas/SVG, even when the generic version looks easier.
- **TypeScript**, `strict: true`. Avoid `any` without a documented reason.
- **Model and view are separated.** Model code (Axon `Property`-based state
  and physics/logic) never imports from `scenery`/`sun`/`scenery-phet`. View
  code renders and reacts to model state; it doesn't own simulation logic.
- **SI units internally.** Convert only at the view/display boundary.
- **Physical equations and assumptions must be documented** where they live
  in the code (what formula, what units, what simplifying assumptions and
  their valid range) — not left implicit.
- **Do not invent SceneryStack APIs.** Before using an unfamiliar class,
  option, or method: inspect the installed source in
  `node_modules/scenerystack/src/`, then check official docs at
  scenerystack.org, then check an official example for pattern/API
  confirmation only. See the `scenerystack` skill for the full policy and a
  concrete example of official docs disagreeing with the installed API.
- **Prefer reusable components only when the abstraction is genuinely
  shared.** Promote code to a shared location once at least two of the three
  simulations actually need it — not preemptively.
- **Avoid premature over-generalization.** Don't design for hypothetical
  future requirements; three similar lines beats a speculative abstraction.
- **No unnecessary gamification.** These are exploratory scientific tools for
  secondary-school physics, not games — no scoring, achievements, or
  win/lose mechanics unless explicitly requested.
- **Accessibility considered from the beginning.** Every interactive control
  needs an accessible name; every mouse/touch-draggable element needs a
  keyboard-operable equivalent. Not a pass to add later. Details:
  `.claude/skills/scenerystack/references/accessibility.md`.
- **No feature is complete while build/type/lint failures remain**
  (`npx tsc --noEmit`, `npx eslint .`, `npm run build` must all pass).

## Workflow for substantial work

1. **Main Claude** plans the requested behavior.
2. **`scenery-developer`** handles significant SceneryStack implementation
   (preloads the `scenerystack` skill).
3. **`physics-reviewer`** audits substantial physics changes independently
   (equations, units, boundary conditions, misleading visualizations).
4. **`pedagogy-reviewer`** reviews substantial interaction/visualization
   changes for educational clarity (secondary-school audience).
5. **`qa-tester`** validates the result (typecheck/lint/build, reset behavior,
   edge cases, responsiveness, model/view sync) — actually tests rather than
   assuming.
6. Important findings from any reviewer are fixed before the work is
   considered complete.

Do not invoke every agent mechanically for trivial edits (typo fixes, renames,
small style tweaks) — use judgment about what counts as "substantial."

## Project status

Currently only the untouched `scenerystack` starter scaffold plus this
project's `.claude/` configuration (skill + agents) exist. Sound Waves,
Standing Waves, and Kundt Tube have not been implemented yet.
