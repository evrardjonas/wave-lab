# PhET Reference Policy

This project builds **three original educational physics simulations** — Sound
Waves, Standing Waves, Kundt Tube — using the SceneryStack framework. They are
**not forks or ports of any existing PhET simulation**, including PhET's own
"Sound Waves" or "Wave on a String" sims, even where names overlap.

There is also a separate, existing HTML resonance game located elsewhere
(outside this repository). **Do not recreate, port, or reference its
implementation here.** If asked to build something that overlaps with it,
treat these sims as independent, original, exploratory scientific tools, not
as a rebuild of that game.

## What existing PhET simulations MAY be used for

Studying existing PhET simulations (via public source, screenshots, or run
behavior) is permitted for:

- **Interaction ideas** — e.g. how a draggable microphone or tuning control
  feels to use.
- **Architecture patterns** — e.g. how a PhET sim splits model/view, structures
  a multi-screen sim, or organizes shared components.
- **API usage** — e.g. how an existing sim calls `NumberControl`, `DragListener`,
  or `ChartTransform`, to confirm the *correct, current* way to call a
  SceneryStack API (this is explicitly encouraged elsewhere in this skill —
  see `SKILL.md`'s "check an official example" step).
- **Accessibility patterns** — e.g. how an existing sim structures PDOM content
  or keyboard interaction for a similar control.
- **Visual conventions** — e.g. general color/iconography conventions common
  across PhET sims (not copying a specific sim's exact asset).

## What is NOT allowed

- **Do not copy simulation-specific implementation code** — the actual physics
  model code, the specific visual composition, or substantial chunks of a
  particular existing sim's source, even if it would be faster.
- Do not port an existing PhET sim's screen/model/view structure wholesale and
  relabel it.
- Do not reuse existing PhET sim-specific assets (images, specific shape data)
  without a clear original reason and without asking first.

## If reuse of actual PhET implementation code ever seems necessary

**Stop and ask the user first**, explaining specifically what code and why,
before writing it. Do not make this judgment call unilaterally and proceed —
this is the one bright line in this policy.

## Practical guidance for `physics-reviewer` and `pedagogy-reviewer`

When reviewing a new sim feature, it's fine (and expected) to reference "how
does PhET's own sim handle open vs. closed acoustic boundaries" as a
*conceptual/physics sanity check* — the physics itself (e.g. antinode at an
open end of a tube) is not proprietary, it's textbook physics. What must stay
original is the specific implementation: the code, the exact visual design,
and the specific interaction design for *this* project's sims.
