import { Property } from "scenerystack/axon";
import { Bounds2, Vector2, Vector2Property } from "scenerystack/dot";
import { Shape } from "scenerystack/kite";
import { DragListener, KeyboardDragListener, Node, Rectangle, VBox } from "scenerystack/scenery";

// This file is VIEW code (imports scenery freely) - it holds no simulation state, only scroll
// position (a display concern, not physics), matching the rest of this project's model/view split.

// Width of the scrollbar track/thumb, and the horizontal gap between the scrolled content and the
// scrollbar - both purely cosmetic view-layout constants.
const SCROLLBAR_WIDTH = 10;
const SCROLLBAR_GAP = 8;
const SCROLLBAR_CORNER_RADIUS = 4;

// A thumb shorter than this becomes hard to grab with a mouse/finger, even when the content is much
// taller than the viewport (which would otherwise make a purely-proportional thumb tiny).
const MIN_THUMB_HEIGHT = 24;

// Mouse-wheel scroll increment, in the same view-pixel units as the content: one "notch" of a
// standard mouse wheel (deltaY of 100 in most browsers) scrolls the content by this many pixels.
const WHEEL_SCROLL_PIXELS_PER_NOTCH = 60;

// Keyboard scroll increments for the thumb, mirroring the units used by the ruler's
// KeyboardDragListener in StandingWavesScreenView.ts (dragDelta/shiftDragDelta, in view pixels).
const KEYBOARD_SCROLL_DELTA = 16;
const KEYBOARD_SCROLL_SHIFT_DELTA = 4;

export type ScrollableVBoxOptions = {
  // Children are stacked top-to-bottom with `spacing` between them, left-aligned - the same layout
  // a plain VBox would produce, just clipped to `viewportHeight` and made scrollable when the
  // stacked content is taller than that.
  children: Node[];
  spacing: number;
  viewportHeight: number;
};

/**
 * A vertically-scrollable stack of Nodes, clipped to a fixed viewport height. Used by ControlPanel
 * for its secondary/opt-in sections (Predicted Harmonics, String Properties, Overlays), which can
 * together exceed the vertical space available above the navigation bar - see the comment above
 * CONTROL_PANEL_TOP/BOTTOM_CLEARANCE_BUFFER in StandingWavesScreenView.ts for where that space comes
 * from and why it's limited.
 *
 * Kept local to Standing Waves (not promoted to src/common/) per this project's rule against
 * premature abstraction - it can move once a second sim genuinely needs the same thing.
 *
 * Scroll position lives only as local Properties inside this Node; there's no separate "scroll
 * model" exposed, since nothing else in this sim needs to read or drive scroll position yet.
 *
 * ACCESSIBILITY NOTE: this Node only changes what's visually clipped and translated on screen - it
 * does not remove or reparent any wrapped child out of the accessible tree (the PDOM). Keyboard Tab
 * order and screen-reader traversal of the wrapped `children` are therefore unaffected by scrolling;
 * see the equivalent, more detailed note above `input.tabIndex = 1` in ControlPanel.ts for why a
 * visual clip/translate is structurally separate from the PDOM. The scrollbar thumb added here is a
 * new mouse/touch-draggable element, so - per this project's accessibility rule - it also gets a
 * KeyboardDragListener and an accessibleName/accessibleHelpText, using the exact same
 * Vector2Property + DragListener + KeyboardDragListener + dragBoundsProperty idiom already reviewed
 * and in use for the draggable ruler in StandingWavesScreenView.ts.
 */
export class ScrollableVBox extends Node {
  // Scrolls back to the top - view-only UI state, so this is called from ControlPanel's own reset()
  // (see the sibling showPredictedNodesProperty/showRulerProperty/etc. reset pattern in
  // StandingWavesScreenView.ts) rather than exposed as a model Property.
  public readonly resetScroll: () => void;

  public constructor(options: ScrollableVBoxOptions) {
    super();

    const content = new VBox({ spacing: options.spacing, align: "left", children: options.children });

    // Sized from the actual measured content, not a guessed constant, so the clip/scrollbar stay
    // correct even if a child's natural width ever differs from PANEL_WIDTH (e.g. a future caption).
    const viewportWidth = content.localBounds.isFinite() ? content.localBounds.width : 0;
    const viewportHeight = options.viewportHeight;

    const viewportNode = new Node({
      children: [content],
      clipArea: Shape.bounds(new Bounds2(0, 0, viewportWidth, viewportHeight)),
    });

    const track = new Rectangle(0, 0, SCROLLBAR_WIDTH, viewportHeight, {
      fill: "#e2e2e2",
      cornerRadius: SCROLLBAR_CORNER_RADIUS,
    });
    const thumb = new Rectangle(0, 0, SCROLLBAR_WIDTH, MIN_THUMB_HEIGHT, {
      fill: "#8d99a8",
      cornerRadius: SCROLLBAR_CORNER_RADIUS,
      cursor: "pointer",
      tagName: "div",
      focusable: true,
      accessibleName: "Scroll controls below",
      accessibleHelpText: "Use the arrow keys to reveal more controls: Predicted Harmonics, String Properties, and overlay options.",
    });
    const scrollbar = new Node({
      x: viewportWidth + SCROLLBAR_GAP,
      children: [track, thumb],
    });

    // --- Scroll state, following the same Vector2Property + DragListener + KeyboardDragListener
    // idiom already reviewed for the draggable ruler. The x-component is always 0 (a zero-width
    // dragBoundsProperty pins it there) - only y (position along the track) ever changes. Reusing
    // this idiom (rather than a plain NumberProperty + custom pointer-math listener) is what gives
    // the thumb its keyboard-operable equivalent essentially for free. ---
    const thumbPositionProperty = new Vector2Property(new Vector2(0, 0));
    const thumbDragBoundsProperty = new Property(new Bounds2(0, 0, 0, 0));

    let maxScrollOffset = 0; // content pixels beyond the viewport; 0 means nothing to scroll
    let thumbTravel = 0; // pixels the thumb can move along the track

    const applyScroll = (): void => {
      const fraction = thumbTravel > 0 ? thumbPositionProperty.value.y / thumbTravel : 0;
      content.y = -fraction * maxScrollOffset;
      thumb.y = thumbPositionProperty.value.y;
    };
    thumbPositionProperty.link(applyScroll);

    // Recomputes thumb size/travel and clamps the current scroll position whenever the wrapped
    // content's own (unclipped, untranslated) bounds change - e.g. the Predicted Harmonics list
    // rebuilding with a different number of rows (see the Multilink in ControlPanel.ts), or either
    // AccordionBox expanding/collapsing. localBoundsProperty (not boundsProperty) is used because it
    // reflects content's own layout size only, not the y-translation applyScroll applies to it below
    // - using boundsProperty here would create a feedback loop between scrolling and relayout.
    const relayout = (): void => {
      const contentHeight = content.localBounds.isFinite() ? content.localBounds.height : 0;
      maxScrollOffset = Math.max(0, contentHeight - viewportHeight);
      const needsScrollbar = maxScrollOffset > 0;
      scrollbar.visible = needsScrollbar;

      if (needsScrollbar) {
        const thumbHeight = Math.max(MIN_THUMB_HEIGHT, Math.min(viewportHeight, (viewportHeight / contentHeight) * viewportHeight));
        thumb.rectHeight = thumbHeight;
        thumbTravel = viewportHeight - thumbHeight;
        thumbDragBoundsProperty.value = new Bounds2(0, 0, 0, thumbTravel);
        // Clamp the existing scroll offset into the new travel range rather than resetting to the
        // top, so e.g. toggling an unrelated checkbox elsewhere doesn't jump the user's place.
        thumbPositionProperty.value = new Vector2(0, Math.min(thumbPositionProperty.value.y, thumbTravel));
      } else {
        thumbTravel = 0;
        thumbDragBoundsProperty.value = new Bounds2(0, 0, 0, 0);
        thumbPositionProperty.value = new Vector2(0, 0);
      }
      applyScroll();
    };
    content.localBoundsProperty.link(relayout);

    thumb.addInputListener(
      new DragListener({
        positionProperty: thumbPositionProperty,
        dragBoundsProperty: thumbDragBoundsProperty,
      }),
    );
    thumb.addInputListener(
      new KeyboardDragListener({
        positionProperty: thumbPositionProperty,
        dragBoundsProperty: thumbDragBoundsProperty,
        keyboardDragDirection: "upDown",
        dragDelta: KEYBOARD_SCROLL_DELTA,
        shiftDragDelta: KEYBOARD_SCROLL_SHIFT_DELTA,
      }),
    );

    // Mouse-wheel scrolling over the viewport, as a convenience only - NOT a substitute for the
    // keyboard-operable thumb above (per this project's accessibility rule, every mouse/touch-
    // draggable element needs a keyboard equivalent; the thumb is that equivalent, this is extra).
    viewportNode.addInputListener({
      wheel: (event) => {
        if (thumbTravel <= 0) {
          return;
        }
        event.domEvent?.preventDefault();
        const deltaY = (event.domEvent as WheelEvent).deltaY;
        const desired = new Vector2(0, thumbPositionProperty.value.y + (deltaY / 100) * WHEEL_SCROLL_PIXELS_PER_NOTCH);
        thumbPositionProperty.value = thumbDragBoundsProperty.value.closestPointTo(desired);
      },
    });

    this.children = [viewportNode, scrollbar];

    this.resetScroll = (): void => {
      thumbPositionProperty.value = new Vector2(0, 0);
    };
  }
}
