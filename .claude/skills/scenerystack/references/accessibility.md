# Accessibility

Source: scenerystack.org `/learn/scenery-accessibility/` and `/learn/features/`
(both explicitly marked "Under Construction" upstream as of this writing —
treat as the best available official guidance, but expect gaps; fall back to
`ParallelDOM.js` source comments referenced in the guide for anything unclear).

## The Parallel DOM (PDOM) — official

- Scenery renders visuals with SVG/Canvas/WebGL, which carry little semantic
  information for assistive tech. The **PDOM** is a separate, invisible HTML
  tree that Scenery generates alongside the visual scene graph, giving screen
  readers something meaningful to read.
- A `Node` only appears in the PDOM if it explicitly opts in via `tagName`.
  Purely decorative Nodes (e.g. the rotating rectangle in the starter) should
  have no PDOM content at all — don't add `tagName` to things with nothing
  meaningful to say.
- A Node can have up to four PDOM elements: primary (`tagName`), label
  (`labelTagName`/`labelContent`), description (`descriptionTagName`/
  `descriptionContent`), container (`containerTagName`, groups the others).
- PDOM structure mirrors scene graph structure by default; `Node.pdomOrder`
  can remap the *accessible* tree order independently of visual z-order, but a
  Node must already be connected to the scene graph (as a child somewhere) to
  be eligible for `pdomOrder` — you cannot use `pdomOrder` alone to inject an
  otherwise-detached Node into the PDOM.

## Accessible naming — official priority, use semantic HTML first

- Always favor a real semantic `tagName` (`"button"`, `"input"`, ...) over a
  generic `<div>` with manual ARIA — "the first rule of ARIA is don't use
  ARIA unless necessary."
- Ways to set an accessible name, in the order the guide presents them:
  element content (`innerContent`), a `<label>` (`labelTagName: "label"`,
  auto-linked via `for`), `ariaLabel`, or `addAriaLabelledbyAssociation()` for
  cross-element association.
- For interactive controls, prefer the Sun/Scenery-PhET component's own
  `accessibleName`/`accessibleHelpText` options (available on most UI
  components already) over manually building PDOM plumbing from scratch.

## Keyboard navigation and focus (official)

- Tab order defaults to visual back-to-front scene graph order; override with
  `Node.pdomOrder` when the logical/reading order should differ from visual
  stacking (e.g. controls that are drawn on top but should be reached last).
- `focusable: true` is required for a Node to receive keyboard focus if its
  `tagName` isn't already inherently focusable (like `"button"`).
- `focusHighlight` (a `Node` or `Shape`) customizes the focus ring; otherwise
  a default highlight is auto-rendered for focusable elements.
- `Node.visible = false` removes an element from both rendering and the PDOM
  (and the focus order); `pdomVisible = false` hides only from
  assistive-tech/focus while keeping it visually rendered — these are
  different knobs, don't conflate them.
- `KeyboardDragListener` (see `ui-and-interaction.md`) is the documented way
  to make draggable model elements keyboard-operable (arrow keys / WASD,
  configurable step size, axis constraints) — any mouse-draggable simulation
  element (e.g. a movable microphone, a slider-like control built from
  scratch) should get a keyboard-equivalent via this listener, not be
  mouse/touch-only.

## Voicing (official, optional/advanced feature)

- `Voicing` trait adds spoken feedback via Web Speech, structured as **Name /
  Object / Context / Hint** responses, globally toggleable via
  `responseCollector`. `ReadingBlock` extends `Voicing` for non-interactive
  content that can still be "read aloud" on click/focus.
- **Convention for this repo**: Voicing is a nice-to-have enhancement layer,
  not a baseline requirement for the three sims — do not block a feature on
  implementing Voicing unless explicitly requested. The PDOM/keyboard baseline
  below is the actual bar.

## Accessibility bar for wave-lab (project convention, not upstream policy)

Every screen, before being considered complete, should have:

1. **Every interactive control** (button, slider, checkbox, drag target) has
   a meaningful `accessibleName` (and `accessibleHelpText` where the purpose
   isn't obvious from the name alone — e.g. "Drag to change the tube length").
2. **Every mouse/touch-draggable element** has a keyboard-operable equivalent
   (`KeyboardDragListener` or an equivalent discrete control).
3. **Decorative/non-interactive visuals** (waveform illustrations, background
   art) are *not* stuffed into the PDOM with meaningless labels — silence is
   correct for purely decorative content; but any visual that *carries
   information a sighted student would use* (e.g. a moving node marker, a
   pressure reading) should have PDOM/description content conveying that
   information, not just be visually present.
4. Full keyboard traversal (Tab/Shift+Tab through all interactive elements,
   Enter/Space to activate, arrow keys to adjust) is actually tested, not
   assumed — this is part of `qa-tester`'s job, not something to certify from
   reading the code alone.

## Assumptions in this document

- The specific "accessibility bar" list above is a project-level convention
  proposed for wave-lab's original sims; it is a reasonable extrapolation from
  PhET/SceneryStack's stated accessibility goals ("Robust accessibility
  features" in `/learn/overview/`), not a verbatim requirement copied from
  official docs.
