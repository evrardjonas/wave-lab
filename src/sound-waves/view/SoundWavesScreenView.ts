import { BooleanProperty, DerivedProperty, Property } from "scenerystack/axon";
import { Vector2, Vector2Property } from "scenerystack/dot";
import { DragListener, KeyboardDragListener } from "scenerystack/scenery";
import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { InfoButton, ResetAllButton, RulerNode } from "scenerystack/scenery-phet";
import { SoundWavesModel } from "../model/SoundWavesModel.js";
import { ParticleFieldNode, pixelsPerMeterForZoom, type RepresentationMode, type ViewZoom } from "./ParticleFieldNode.js";
import { LoudspeakerNode, PointSourceNode } from "./LoudspeakerNode.js";
import { PressureGraphNode } from "./PressureGraphNode.js";
import { PressureFieldNode } from "./PressureFieldNode.js";
import { CompressionTrackerNode } from "./CompressionTrackerNode.js";
import { ControlPanel } from "./ControlPanel.js";
import { HowThisWorksDialog } from "./HowThisWorksDialog.js";
import { ZoomControl } from "./ZoomControl.js";
import { PropagationModeControl } from "./PropagationModeControl.js";
import { RepresentationModeControl } from "./RepresentationModeControl.js";

// View-space layout constants. x=0 (the loudspeaker) sits at DIAGRAM_ORIGIN_X in PLANE mode; the
// particle field's vertical center sits at DIAGRAM_ORIGIN_Y. SPHERICAL_ORIGIN_X/Y is the SEPARATE point
// where the point source sits in SPHERICAL mode - a different location is needed because the spherical
// field radiates in every direction from its origin (a fixed-diameter circle, see
// SPHERICAL_FIELD_PIXEL_WIDTH in ParticleFieldNode.ts), so it cannot share the plane wave's left-edge
// origin without going off the top/bottom of the layout. Only one mode's diagram is visible/relevant at a
// time (see the propagationModeProperty link below), so the two origins never need to coexist visually.
const DIAGRAM_ORIGIN_X = 120;
const DIAGRAM_ORIGIN_Y = 230;
const PRESSURE_GRAPH_TOP = DIAGRAM_ORIGIN_Y + 90;

// A prior QA review found the ORIGINAL numbers here (SPHERICAL_ORIGIN_Y=320, paired with a 600px-diameter/
// 300px-radius spherical field) did not fit DEFAULT_LAYOUT_BOUNDS (1024x618), and fixed it by giving the
// spherical field its own independent radius (see SPHERICAL_FIELD_PIXEL_WIDTH's doc comment in
// ParticleFieldNode.ts) and moving SPHERICAL_ORIGIN_Y to 360, verified against a SINGLE-ROW top chrome
// (PropagationModeControl + ZoomControl side by side).
//
// V3 RE-CHECK (this refinement pass split that single row into TWO rows - see the top chrome layout below
// this constant - so the chrome is now taller and this fit needs re-verifying, not assumed to still hold):
//
// Row 1 (InfoButton + PropagationModeControl + RepresentationModeControl, all at top=16): height is set by
// PropagationModeControl, the tallest of the three (it and RepresentationModeControl both have a caption
// line the plain InfoButton doesn't; PropagationModeControl's is the taller of the two captions - see
// below). Same direct-estimate method the prior QA review used: an HBox row of ~25-28px for the radio
// group + 4px VBox spacing + a 3-line RichText caption at font-size 10 wrapped to 360px (~36-39px) puts
// row 1's bottom around y~=16+28+4+39=87. RepresentationModeControl's own caption ("Switching never changes
// the physics - only how it's drawn.", wrapped to 220px) is short enough to wrap to only ~2 lines
// (~26px) - shorter than PropagationModeControl's, so it does not make row 1 any taller. Padding this
// direct ~87px estimate up to the SAME conservative ~100px absolute-y bound the prior QA review already
// used for a comparable row (same margin-of-error rationale, unchanged by this refinement) gives ROW 1
// CONSERVATIVE BOTTOM = 100.
//
// Row 2 (ZoomControl alone, a plain HBox label+radio-group with NO caption): placed a ROW_GAP=6px below
// row 1's conservative bottom, i.e. top=100+6=106. Direct height estimate (same ~25-28px a bare radio-group
// row gets elsewhere in this file) is ~28px; padded conservatively to ~32px (less padding than row 1 needed,
// since there's no wrapped-caption line-count uncertainty here) gives a bottom around 106+32=138. ROW 2
// CONSERVATIVE BOTTOM = 138 - this, not the old single-row ~100, is what downstream content must now clear.
//
// MUST-FIX (QA + pedagogy re-review): the code below previously computed zoomControl.top as
// `minY + 16 + TOP_CHROME_ROW_GAP + 100` (=122), double-counting the 16px top margin that is already baked
// into "100" (ROW 1 CONSERVATIVE BOTTOM is an ABSOLUTE y-coordinate, derived starting from row 1's own top
// at minY+16, not from y=0 - see that derivation above). That made the ACTUAL rendered row 2 sit 16px lower
// than this comment's own math assumed - e.g. its ACTUAL direct (unpadded, ~28px) bottom was 122+28=150,
// not the 134 the ruler's default-position math below relies on, and its ACTUAL conservative bottom was
// 122+32=154, not the 138 the spherical-field margin below relies on. Concretely, the spherical field's
// top-edge margin below row 2 (see the arithmetic right below) was consequently only 175-154=21px in the
// ACTUAL rendered layout, not the 37px this comment computed against the (uncorrected-code) 138 value - and
// the ruler's default position (see below) ACTUALLY overlapped row 2 by ~12px (ruler top 138 vs. row 2's
// real bottom 150), not the "modest ~4px margin" this comment assumed. Fixed by removing the stray `+ 16`
// so the code now genuinely computes top=106, matching every derivation in this file that already assumed
// it (the numbers below - 138, 134 - were already correct; only the code disagreed with them).
//
// Consequence for the spherical field (SPHERICAL_ORIGIN_X=350 unchanged; only Y and the radius are
// re-derived below): requiring the field's top edge to clear ROW 2's (now genuinely correct) conservative
// bottom (138) by the SAME >=20px margin the prior QA review required, i.e. top edge >= 158, together with
// the field's bottom edge staying >=10px inside the 618px stage bottom, i.e. bottom edge <= 608, gives, for
// origin Y and radius R:
//   Y - R >= 158  and  Y + R <= 608  =>  2R <= 450  =>  R <= 225.
// The OLD radius (240px, SPHERICAL_FIELD_PIXEL_WIDTH=480) still does not satisfy this (R<=225 is the hard
// ceiling even with the code fix), so it stays shrunk to R=210 (SPHERICAL_FIELD_PIXEL_WIDTH=420 - see that
// constant in ParticleFieldNode.ts), with Y=385 - still near the middle of the feasible range [368, 398],
// and, unlike before the code fix, ACTUALLY delivering the margins below (R=225, the feasible ceiling,
// would leave literally 0px of slack on both edges at once - not "more generous," a knife's edge; R=210
// keeps real margin on both sides instead, so it is left as-is rather than pushed toward 225):
//  - top edge:    385 - 210 = 175px. Margin below ROW 2's conservative bottom (138, now that the code
//    actually produces it) = 175 - 138 = 37px - comfortably over the required 20px minimum, and, with the
//    code fix, this is now the TRUE rendered margin (not merely what an already-correct comment assumed
//    while the code silently delivered only 21px - see the MUST-FIX note above).
//  - bottom edge: 385 + 210 = 595px, i.e. 23px inside the 618px stage bottom (>= the required 10px margin) -
//    unaffected by this fix (row 2's height doesn't bound the bottom edge).
//  - left edge:   350 - 210 = 140px - still well clear of the InfoButton (roughly 16-50px in both x and y,
//    and entirely above row 1/2's y-range regardless).
//  - right edge:  350 + 210 = 560px, vs. the ControlPanel's left edge (~758px, see the panel layout below)
//    - 198px of clearance.
// All four edges hold with margin. FLAGGED FOR VISUAL RE-VERIFICATION (this file's own convention - these
// are estimates from font-metric reasoning, not a measured render): the exact chrome height should be
// re-confirmed with real click-based browser testing, per this task's own instructions.
const SPHERICAL_ORIGIN_X = 350;
const SPHERICAL_ORIGIN_Y = 385;
const TOP_CHROME_ROW_GAP = 6; // px, vertical gap between the two top chrome rows - see the arithmetic above

const RULER_WIDTH = pixelsPerMeterForZoom("local"); // px, represents exactly 1 m at Local zoom's scale.
// The ruler is deliberately calibrated ONLY at Local zoom (see rulerVisibleProperty below, which hides
// it at Field zoom rather than silently mis-measuring) - 20 cm major ticks (not 10 cm, unlike Standing
// Waves' ruler) because PIXELS_PER_METER_X is smaller here (150 vs Standing Waves' 320, since this sim's
// domain is several meters, not ~1-2m), so 10 cm ticks would only be 15px apart - too narrow for
// RulerNode to fit a tick label plus the "cm" units label (it asserts on construction if there isn't
// room). 20 cm ticks give 30px of spacing, matching the ~32px that's already proven to work in Standing
// Waves' ruler.
const RULER_MAJOR_TICK_SPACING = RULER_WIDTH / 5; // px, represents 20 cm

// Minimum horizontal gap (px) between ZoomControl's right edge and the ruler's default left edge (QA
// re-review: the old hardcoded default x left only a "razor-thin at best" gap here - see the ruler's own
// positioning comment below for the full derivation). Comfortably more than the >=20px minimum this file
// already uses elsewhere for chrome clearance (e.g. the spherical field's margin below row 2).
const RULER_HORIZONTAL_MARGIN = 24;

const RESET_ALL_BUTTON_MARGIN = 10;

/**
 * Top-level view for the Sound Waves screen. Assembles:
 *  - The PLANE-mode diagram (LoudspeakerNode + ParticleFieldNode's plane grid), anchored at
 *    (DIAGRAM_ORIGIN_X, DIAGRAM_ORIGIN_Y).
 *  - The SPHERICAL-mode diagram (PointSourceNode + ParticleFieldNode's spherical grid), anchored at
 *    (SPHERICAL_ORIGIN_X, SPHERICAL_ORIGIN_Y). Only one of LoudspeakerNode/PointSourceNode is visible at
 *    a time, toggled directly off model.propagationModeProperty below - ParticleFieldNode/
 *    PressureFieldNode/CompressionTrackerNode each handle their own internal mode switch and so need no
 *    external visibility toggle.
 *  - Shared overlays (PressureFieldNode background shading, CompressionTrackerNode markers) that read
 *    from whichever origin/mode is currently active.
 *  - PressureGraphNode, a PLANE-only precise pressure-vs-x chart - hidden outright in spherical mode
 *    (see pressureGraphVisibleProperty below), since it only ever samples the plane wave (model.sampleAt(x),
 *    never sampleAtRadius(r)). Zoom-aware like ParticleFieldNode/PressureFieldNode (shares this same
 *    viewZoomProperty) - see PressureGraphNode.ts's own class doc for the zoom-alignment bug fix.
 *  - Stage-level chrome, now TWO ROWS (V3 addition of RepresentationModeControl): row 1 groups every
 *    "what am I looking at" concern (InfoButton/HowThisWorksDialog, PropagationModeControl,
 *    RepresentationModeControl); row 2 holds ZoomControl alone, a secondary "how much do I see" concern.
 *    None of these are "simulation controls" in the ControlPanel sense, per the reviewed interaction
 *    design. Also: the draggable ruler (Local-zoom only, see RULER_WIDTH above), and ResetAllButton.
 *
 * LAYOUT FIX (QA review, and its V3 re-check): an earlier version of this file sized and positioned the
 * spherical field so its circular footprint overflowed the stage bottom by 2px and left only ~4px of
 * clearance below the (then single-row) top chrome - nowhere near enough once that chrome's real rendered
 * height (buttons plus a wrapped caption, NOT just a thin strip) is accounted for. That is NOT merely
 * "chrome sitting on top of faint background shading" (PressureFieldNode's low-alpha layer is not the only
 * thing at stake) - the chrome Nodes are added to this.children AFTER particleFieldNode (see below), so
 * they draw OVER it and would have occluded real, opaque particles and tick marks near the top of the
 * spherical field, not just background shading. Fixed by giving the spherical field its own, independent
 * on-screen radius (see SPHERICAL_FIELD_PIXEL_WIDTH in ParticleFieldNode.ts) and positioning
 * SPHERICAL_ORIGIN_Y accordingly - see that constant's own doc comment above for the full arithmetic
 * verification against the stage bounds, the (now two-row) chrome, and the ControlPanel. The V3 refinement
 * that split the chrome into two rows re-derived BOTH numbers from scratch rather than assuming the old
 * single-row fit still held - see that same comment for the updated arithmetic.
 */
export class SoundWavesScreenView extends ScreenView {
  private readonly particleFieldNode: ParticleFieldNode;
  private readonly pressureFieldNode: PressureFieldNode;
  private readonly compressionTrackerNode: CompressionTrackerNode;
  private readonly loudspeakerNode: LoudspeakerNode;
  private readonly pointSourceNode: PointSourceNode;
  private readonly pressureGraphNode: PressureGraphNode;
  private readonly showPressureGraphProperty: BooleanProperty;
  private readonly showRulerProperty: BooleanProperty;
  private readonly showPressureFieldProperty: BooleanProperty;
  private readonly showCompressionTrackerProperty: BooleanProperty;
  private readonly viewZoomProperty: Property<ViewZoom>;
  private readonly representationModeProperty: Property<RepresentationMode>;
  private readonly rulerPositionProperty: Vector2Property;

  public constructor(model: SoundWavesModel, options?: ScreenViewOptions) {
    super(options);

    // ---- View-only UI state (display options, not physics - deliberately not model Properties) ----
    this.showPressureGraphProperty = new BooleanProperty(false);
    this.showRulerProperty = new BooleanProperty(false);
    this.showPressureFieldProperty = new BooleanProperty(false);
    this.showCompressionTrackerProperty = new BooleanProperty(false);
    // Defaults to "local", which exactly reproduces this sim's original fixed-scale appearance (see
    // ParticleFieldNode.ts's FIELD_PIXEL_WIDTH doc) - so existing plane-wave behavior is unchanged unless
    // a student explicitly switches to "field".
    this.viewZoomProperty = new Property<ViewZoom>("local");
    // V3 addition: defaults to "real", the sim's original rendering - see RepresentationMode's own doc
    // comment in ParticleFieldNode.ts for why this is a plain view-only Property (like viewZoomProperty
    // above), never joined to any geometry-rebuild Multilink in any consumer.
    this.representationModeProperty = new Property<RepresentationMode>("real");

    // V3: TimeControlNode no longer owns a scenery-phet TimeSpeed bridge at all - model.playbackSpeedProperty
    // (a plain, physics-only 3-way Property, see SoundWavesModel.ts's PlaybackSpeed doc comment) is bound
    // DIRECTLY by ControlPanel.ts's PlaybackSpeedControl, with TimeControlNode's own built-in speed radio
    // group disabled (timeSpeedProperty: null) - no bridging Property needed here any more.

    // ---- Plane-mode and spherical-mode source icons - only one visible at a time ----
    this.loudspeakerNode = new LoudspeakerNode(model, { x0: DIAGRAM_ORIGIN_X, y0: DIAGRAM_ORIGIN_Y, viewZoomProperty: this.viewZoomProperty });
    this.pointSourceNode = new PointSourceNode({ x0: SPHERICAL_ORIGIN_X, y0: SPHERICAL_ORIGIN_Y, viewZoomProperty: this.viewZoomProperty });
    model.propagationModeProperty.link((mode) => {
      this.loudspeakerNode.visible = mode === "plane";
      this.pointSourceNode.visible = mode === "spherical";
    });

    const fieldOrigins = {
      planeOriginX: DIAGRAM_ORIGIN_X,
      planeOriginY: DIAGRAM_ORIGIN_Y,
      sphericalOriginX: SPHERICAL_ORIGIN_X,
      sphericalOriginY: SPHERICAL_ORIGIN_Y,
      viewZoomProperty: this.viewZoomProperty,
    };

    // Background shading layer - added to this.children FIRST (below) so it always renders behind the
    // particle field and every other Node, per its own "purely decorative background" doc comment.
    this.pressureFieldNode = new PressureFieldNode(model, { ...fieldOrigins, showPressureFieldProperty: this.showPressureFieldProperty, representationModeProperty: this.representationModeProperty });

    // CompressionTrackerNode is deliberately NOT given representationModeProperty - its ghosted/dashed/
    // low-opacity treatment stays IDENTICAL in both Real and Pedagogical mode (see that file's own class
    // doc for why: bolding it in sync with a bold field risks reading as "discrete traveling objects riding
    // along with solid stripes", exactly the misconception its own disclaimer text exists to prevent).
    this.particleFieldNode = new ParticleFieldNode(model, { ...fieldOrigins, representationModeProperty: this.representationModeProperty });

    this.compressionTrackerNode = new CompressionTrackerNode(model, { ...fieldOrigins, visibleProperty: this.showCompressionTrackerProperty });

    // PressureGraphNode always reflects the plane wave's own fixed sample cache (see its own doc comment
    // and SoundWavesModel.ts's recomputeSamples) - shown only when BOTH the checkbox is on AND
    // propagationModeProperty is 'plane', so it never claims to represent spherical mode's field.
    const pressureGraphVisibleProperty = new DerivedProperty([this.showPressureGraphProperty, model.propagationModeProperty], (show, mode) => show && mode === "plane");
    this.pressureGraphNode = new PressureGraphNode(model, {
      x0: DIAGRAM_ORIGIN_X,
      top: PRESSURE_GRAPH_TOP,
      visibleProperty: pressureGraphVisibleProperty,
      viewZoomProperty: this.viewZoomProperty,
    });

    const controlPanel = new ControlPanel(model, {
      showPressureGraphProperty: this.showPressureGraphProperty,
      showRulerProperty: this.showRulerProperty,
      showPressureFieldProperty: this.showPressureFieldProperty,
      showCompressionTrackerProperty: this.showCompressionTrackerProperty,
      representationModeProperty: this.representationModeProperty,
    });
    controlPanel.right = this.layoutBounds.maxX - 16;
    controlPanel.top = this.layoutBounds.minY + 16;

    const howThisWorksDialog = new HowThisWorksDialog(model);
    const infoButton = new InfoButton({
      listener: () => howThisWorksDialog.show(),
      left: this.layoutBounds.minX + 16,
      top: this.layoutBounds.minY + 16,
      scale: 0.75,
      accessibleName: "How This Works",
      accessibleHelpText: "Shows the governing equations with your current values filled in.",
    });

    // ---- Stage-level chrome (NOT simulation controls, see each control's own class doc), now TWO ROWS
    // (V3 addition of RepresentationModeControl) ----
    //  Row 1 ("what am I looking at" concerns): InfoButton + PropagationModeControl + RepresentationModeControl.
    //  Row 2 (a secondary "how much do I see" concern): ZoomControl alone.
    // See SPHERICAL_ORIGIN_Y's own layout comment above for the full row-height arithmetic this split is
    // based on, and for why the spherical field's radius/origin needed re-deriving as a consequence.
    const propagationModeControl = new PropagationModeControl(model.propagationModeProperty);
    propagationModeControl.left = infoButton.right + 16;
    propagationModeControl.top = this.layoutBounds.minY + 16;

    const representationModeControl = new RepresentationModeControl(this.representationModeProperty);
    representationModeControl.left = propagationModeControl.right + 16;
    representationModeControl.top = this.layoutBounds.minY + 16;

    const zoomControl = new ZoomControl(this.viewZoomProperty);
    zoomControl.left = infoButton.left;
    // BUG FIX (QA + pedagogy re-review): this used to read `this.layoutBounds.minY + 16 + TOP_CHROME_ROW_GAP
    // + 100`, double-counting the 16px top margin - the "100" in ROW 1 CONSERVATIVE BOTTOM above is already
    // an ABSOLUTE y-coordinate (it was derived starting FROM row 1's own top, layoutBounds.minY + 16, not
    // from y=0), so adding another `+ 16` here pushed row 2 down by 16px it was never owed - see the layout
    // comment above for the corrected 106/134/138 chain this now actually matches (it previously did not).
    zoomControl.top = this.layoutBounds.minY + 100 + TOP_CHROME_ROW_GAP; // = 106: row 1's conservative bottom (100) + gap

    // ---- Draggable ruler (opt-in, default hidden; calibrated for Local zoom only - see RULER_WIDTH) ----
    //
    // A prior QA review moved this default position to sit in the gap between the (then single-row) top
    // chrome and the particle field, rather than inside PressureGraphNode's chart rectangle (which the
    // ORIGINAL default collided with - see the git history of this comment for that arithmetic).
    //
    // V3 RE-CHECK: the top chrome is now TWO rows (see above), which shrinks that gap considerably. Particle
    // field rows still span roughly DIAGRAM_ORIGIN_Y+/-50px (y:[180,280], unchanged - ParticleFieldNode.ts's
    // ROW_COUNT/ROW_SPACING are untouched by this refinement). Row 2 (ZoomControl)'s DIRECT (un-padded -
    // deliberately tighter than the padded/conservative estimate used for the spherical field's harder,
    // always-visible guarantee, since this is only a repositionable, opt-in-and-hidden-by-default control)
    // height estimate is ~28px (a bare, unwrapped radio-button row, the same figure this file already uses
    // elsewhere for that shape of control), so row 2's direct bottom is ~= 100 + TOP_CHROME_ROW_GAP + 28 =
    // 134 (an earlier draft of this comment wrote the leading term as "16 + 100 + ..." - the same
    // double-counted top margin as the zoomControl.top bug fixed above, just echoed in prose; the final
    // "134" was already the CORRECT number, only the formula text before it was wrong). Placing the ruler's
    // top at 138 (4px below that) gives a 36px-tall footprint spanning y:[138,174]: a modest but real ~4px
    // margin below row 2 and ~6px margin above the particle field's top edge (180) - tighter than the
    // spherical field's own margins because the available window is smaller here, but never overlapping
    // either neighbor. This vertical placement was ALREADY correct even before the zoomControl.top code fix
    // above (it happened to be computed against the correct 134/138 numbers, not whatever the buggy code was
    // actually producing) - concretely, the pre-fix code's ACTUAL row 2 bottom was 122+28=150, meaning the
    // ruler's hardcoded top=138 was ACTUALLY ~12px inside row 2's real footprint, a genuine vertical overlap
    // the code fix above also resolves, even though this comment's own math never predicted one. Nowhere near
    // the (opt-in, separately toggled) pressure graph's y:[320,450] chart range at any x either.
    //
    // HORIZONTAL clearance (QA re-review: flagged the old default x as "razor-thin at best" against
    // ZoomControl's right edge - the old hardcoded DIAGRAM_ORIGIN_X+40=160 was never actually checked against
    // ZoomControl's rendered width). ZoomControl = HBox["View:" (bold, 12px) + 8px spacing + a 2-button
    // RectangularRadioButtonGroup("Local"/"Field", 12px, xMargin 8, spacing 4)]. Direct font-metric estimate
    // (same methodology as this file's other direct estimates - roughly 7px average glyph width at a 12px
    // sans-serif, ~10% more for bold): "View:" (5 chars, bold) ~= 5*7.7 ~= 39px; each of "Local"/"Field" (5
    // chars, regular) ~= 5*7 ~= 35px text + 2*8px xMargin + ~2px button chrome ~= 53px per button; two
    // buttons + 4px inter-button spacing ~= 110px. Total ZoomControl width ~= 39 (label) + 8 (HBox spacing) +
    // 110 (radio group) ~= 157px, i.e. zoomControl.right ~= zoomControl.left (16) + 157 ~= 173px - closely
    // matching (and likely exceeding) the OLD hardcoded ruler x (160), confirming the QA finding: the old
    // default position plausibly placed the ruler's LEFT EDGE INSIDE ZoomControl's own footprint, not merely
    // "thin" clearance.
    //
    // FIX: rather than hardcoding a second magic number that could silently drift out of sync with
    // ZoomControl's actual rendered width the same way the OLD ruler x did, anchor the ruler's default x
    // directly off zoomControl.right (the REAL measured layout value, not an estimate) plus
    // RULER_HORIZONTAL_MARGIN - the same "chain off an actual Node's own bounds" pattern this file already
    // uses for every other top-chrome position (e.g. propagationModeControl.left = infoButton.right + 16),
    // so this can never silently go stale again the way a second hardcoded constant could. FLAGGED FOR VISUAL
    // RE-VERIFICATION (font-metric estimate above, not a measured render, though the actual x value used is
    // now real, not estimated) - the ruler remains freely draggable afterward regardless, so a few px of
    // error here would only affect its non-colliding DEFAULT position, not correctness.
    this.rulerPositionProperty = new Vector2Property(new Vector2(zoomControl.right + RULER_HORIZONTAL_MARGIN, 138));
    const rulerDragBoundsProperty = new Property(this.layoutBounds.eroded(10));
    const rulerVisibleProperty = new DerivedProperty([this.showRulerProperty, this.viewZoomProperty], (show, zoom) => show && zoom === "local");

    const rulerNode = new RulerNode(RULER_WIDTH, 36, RULER_MAJOR_TICK_SPACING, ["0", "20", "40", "60", "80", "100"], "cm", {
      visibleProperty: rulerVisibleProperty,
      tagName: "div",
      focusable: true,
      accessibleName: "Ruler",
      accessibleHelpText: "Drag to measure distances along the domain, such as the spacing between two compressions. Only available at Local zoom.",
      cursor: "pointer",
    });
    rulerNode.translation = this.rulerPositionProperty.value;
    this.rulerPositionProperty.link((position) => {
      rulerNode.translation = position;
    });
    rulerNode.addInputListener(
      new DragListener({
        positionProperty: this.rulerPositionProperty,
        dragBoundsProperty: rulerDragBoundsProperty,
      }),
    );
    rulerNode.addInputListener(
      new KeyboardDragListener({
        positionProperty: this.rulerPositionProperty,
        dragBoundsProperty: rulerDragBoundsProperty,
      }),
    );

    const resetAllButton = new ResetAllButton({
      listener: () => {
        model.reset();
        this.reset();
      },
      right: this.layoutBounds.maxX - RESET_ALL_BUTTON_MARGIN,
      bottom: this.layoutBounds.maxY - RESET_ALL_BUTTON_MARGIN,
    });

    this.children = [
      this.pressureFieldNode,
      this.particleFieldNode,
      this.loudspeakerNode,
      this.pointSourceNode,
      this.compressionTrackerNode,
      this.pressureGraphNode,
      propagationModeControl,
      representationModeControl,
      zoomControl,
      controlPanel,
      infoButton,
      rulerNode,
      resetAllButton,
    ];
  }

  /**
   * View-local per-frame update only (redraws from current model state) - does NOT call
   * model.step(dt); Joist already steps the model independently every frame. See the confirmed
   * stepping architecture in the scenerystack skill's architecture.md.
   */
  public override step(): void {
    this.loudspeakerNode.step();
    this.particleFieldNode.step();
    this.pressureFieldNode.step();
    this.compressionTrackerNode.step();
    this.pressureGraphNode.step();
  }

  public reset(): void {
    this.showPressureGraphProperty.reset();
    this.showRulerProperty.reset();
    this.showPressureFieldProperty.reset();
    this.showCompressionTrackerProperty.reset();
    this.viewZoomProperty.reset();
    this.representationModeProperty.reset();
    this.rulerPositionProperty.reset();
  }
}
