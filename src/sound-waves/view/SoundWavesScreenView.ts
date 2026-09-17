import { BooleanProperty, DerivedProperty, EnumerationProperty, Property } from "scenerystack/axon";
import { Vector2, Vector2Property } from "scenerystack/dot";
import { DragListener, KeyboardDragListener } from "scenerystack/scenery";
import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { InfoButton, ResetAllButton, RulerNode, TimeSpeed } from "scenerystack/scenery-phet";
import { SoundWavesModel } from "../model/SoundWavesModel.js";
import { ParticleFieldNode, pixelsPerMeterForZoom, type ViewZoom } from "./ParticleFieldNode.js";
import { LoudspeakerNode, PointSourceNode } from "./LoudspeakerNode.js";
import { PressureGraphNode } from "./PressureGraphNode.js";
import { PressureFieldNode } from "./PressureFieldNode.js";
import { CompressionTrackerNode } from "./CompressionTrackerNode.js";
import { ControlPanel } from "./ControlPanel.js";
import { HowThisWorksDialog } from "./HowThisWorksDialog.js";
import { ZoomControl } from "./ZoomControl.js";
import { PropagationModeControl } from "./PropagationModeControl.js";

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

// QA review found the ORIGINAL numbers here (SPHERICAL_ORIGIN_Y=320, paired with a 600px-diameter/300px-
// radius spherical field, see ParticleFieldNode.ts's then-shared FIELD_PIXEL_WIDTH) did not actually fit
// DEFAULT_LAYOUT_BOUNDS (1024x618): bottom edge 320+300=620 overflowed the 618px stage bottom by 2px, and
// top edge 320-300=20 sat only ~4px below where the top chrome row (PropagationModeControl + ZoomControl,
// see below) begins - nowhere near enough clearance once that chrome's real rendered height (buttons plus
// a wrapped caption) is accounted for. Fixed two ways together:
//  1. The spherical field now uses its OWN, independent on-screen radius (SPHERICAL_FIELD_PIXEL_WIDTH=480,
//     i.e. a 240px radius - see that constant's doc comment in ParticleFieldNode.ts for why it is no
//     longer tied to the plane-mode diagram's FIELD_PIXEL_WIDTH), instead of the old shared 300px radius.
//  2. SPHERICAL_ORIGIN_Y moved from 320 to 360.
//
// Verified against DEFAULT_LAYOUT_BOUNDS (1024x618) and the top chrome, with SPHERICAL_ORIGIN_X=350,
// origin Y=360, radius=240:
//  - top edge:    360 - 240 = 120px. The top chrome row (PropagationModeControl, the taller of the two
//    chrome controls - it has a caption line ZoomControl doesn't) starts at layoutBounds.minY+16=16 and,
//    by its own VBox spacing (see PropagationModeControl.ts: an HBox row of ~25-28px for the radio group,
//    4px VBox spacing, then a 3-line RichText caption at font-size 10 wrapped to 360px, roughly 36-39px),
//    is estimated to end around y~=86 - comfortably under the conservative ~100px this fix treats chrome
//    as extending to. 120 - 100 = 20px of margin below even that conservative estimate (34px below the
//    ~86px direct estimate).
//  - bottom edge: 360 + 240 = 600px, i.e. 18px inside the 618px stage bottom (>= the required 10px margin).
//  - left edge:   350 - 240 = 110px. The InfoButton (top-left, left=16/top=16, scale 0.75, so roughly
//    16-50px in both x and y) sits entirely ABOVE this field (its y range ends around 50px, well short of
//    the field's own top edge at 120px), so there is no overlap regardless of the 110px/16-50px horizontal
//    gap - checked anyway per the QA finding's explicit ask.
//  - right edge:  350 + 240 = 590px, vs. the ControlPanel's left edge (~758px, see the panel layout below)
//    - 168px of clearance, MORE than the original 108px (650 vs 758), since the radius shrank.
// All four edges hold with margin; SPHERICAL_ORIGIN_X is unchanged (350) since only the vertical fit and
// the shrunken radius needed to change.
const SPHERICAL_ORIGIN_X = 350;
const SPHERICAL_ORIGIN_Y = 360;

const RULER_WIDTH = pixelsPerMeterForZoom("local"); // px, represents exactly 1 m at Local zoom's scale.
// The ruler is deliberately calibrated ONLY at Local zoom (see rulerVisibleProperty below, which hides
// it at Field zoom rather than silently mis-measuring) - 20 cm major ticks (not 10 cm, unlike Standing
// Waves' ruler) because PIXELS_PER_METER_X is smaller here (150 vs Standing Waves' 320, since this sim's
// domain is several meters, not ~1-2m), so 10 cm ticks would only be 15px apart - too narrow for
// RulerNode to fit a tick label plus the "cm" units label (it asserts on construction if there isn't
// room). 20 cm ticks give 30px of spacing, matching the ~32px that's already proven to work in Standing
// Waves' ruler.
const RULER_MAJOR_TICK_SPACING = RULER_WIDTH / 5; // px, represents 20 cm

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
 *    (see pressureGraphVisibleProperty below), since it only ever reflects the plane wave's own
 *    fixed sample cache (see SoundWavesModel.ts's recomputeSamples doc).
 *  - Stage-level chrome: PropagationModeControl and ZoomControl (view-only/model-only state that isn't a
 *    "simulation control" in the ControlPanel sense, per the reviewed interaction design), the
 *    InfoButton/HowThisWorksDialog, the draggable ruler (Local-zoom only, see RULER_WIDTH above), and
 *    ResetAllButton.
 *
 * LAYOUT FIX (QA review): an earlier version of this file sized and positioned the spherical field so its
 * circular footprint overflowed the stage bottom by 2px and left only ~4px of clearance below the top
 * chrome row (PropagationModeControl + ZoomControl) - nowhere near enough once that chrome's real
 * rendered height (buttons plus a wrapped caption, NOT just a thin strip) is accounted for. That is NOT
 * merely "chrome sitting on top of faint background shading" (PressureFieldNode's low-alpha layer is not
 * the only thing at stake) - the chrome Nodes are added to this.children AFTER particleFieldNode (see
 * below), so they draw OVER it and would have occluded real, opaque particles and tick marks near the top
 * of the spherical field, not just background shading. Fixed by giving the spherical field its own,
 * smaller, independent on-screen radius (see SPHERICAL_FIELD_PIXEL_WIDTH in ParticleFieldNode.ts) and
 * repositioning SPHERICAL_ORIGIN_Y - see that constant's own doc comment above for the full arithmetic
 * verification against the stage bounds, the chrome, and the ControlPanel.
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
  private readonly timeSpeedProperty: EnumerationProperty<TimeSpeed>;
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

    // TimeControlNode needs a scenery-phet EnumerationProperty<TimeSpeed>, which is VIEW-owned here
    // (see the NOTE above isSlowMotionProperty in SoundWavesModel.ts for why the model itself only
    // exposes a plain isSlowMotionProperty). Bridge one into the other, exactly mirroring
    // StandingWavesScreenView's pattern.
    this.timeSpeedProperty = new EnumerationProperty(TimeSpeed.NORMAL);
    this.timeSpeedProperty.link((speed) => {
      model.isSlowMotionProperty.value = speed === TimeSpeed.SLOW;
    });

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
    this.pressureFieldNode = new PressureFieldNode(model, { ...fieldOrigins, showPressureFieldProperty: this.showPressureFieldProperty });

    this.particleFieldNode = new ParticleFieldNode(model, fieldOrigins);

    this.compressionTrackerNode = new CompressionTrackerNode(model, { ...fieldOrigins, visibleProperty: this.showCompressionTrackerProperty });

    // PressureGraphNode always reflects the plane wave's own fixed sample cache (see its own doc comment
    // and SoundWavesModel.ts's recomputeSamples) - shown only when BOTH the checkbox is on AND
    // propagationModeProperty is 'plane', so it never claims to represent spherical mode's field.
    const pressureGraphVisibleProperty = new DerivedProperty([this.showPressureGraphProperty, model.propagationModeProperty], (show, mode) => show && mode === "plane");
    this.pressureGraphNode = new PressureGraphNode(model, {
      x0: DIAGRAM_ORIGIN_X,
      top: PRESSURE_GRAPH_TOP,
      visibleProperty: pressureGraphVisibleProperty,
    });

    const controlPanel = new ControlPanel(model, {
      timeSpeedProperty: this.timeSpeedProperty,
      showPressureGraphProperty: this.showPressureGraphProperty,
      showRulerProperty: this.showRulerProperty,
      showPressureFieldProperty: this.showPressureFieldProperty,
      showCompressionTrackerProperty: this.showCompressionTrackerProperty,
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

    // ---- Stage-level chrome: propagation mode + zoom (NOT simulation controls, see each control's own
    // class doc) - a horizontal row to the right of the info button, comfortably clear of the
    // ControlPanel (which starts around x=758) at every reasonable window width. ----
    const propagationModeControl = new PropagationModeControl(model.propagationModeProperty);
    propagationModeControl.left = infoButton.right + 16;
    propagationModeControl.top = this.layoutBounds.minY + 16;

    const zoomControl = new ZoomControl(this.viewZoomProperty);
    zoomControl.left = propagationModeControl.right + 24;
    zoomControl.top = this.layoutBounds.minY + 16;

    // ---- Draggable ruler (opt-in, default hidden; calibrated for Local zoom only - see RULER_WIDTH) ----
    //
    // QA review found the ORIGINAL default position here, (DIAGRAM_ORIGIN_X+40, DIAGRAM_ORIGIN_Y+140) =
    // (160, 370), rendered the RulerNode (whose local origin is its top-left corner, spanning
    // RULER_WIDTH+2*insetsWidth=178px by 36px - see RulerNode's constructor) at x:[160,338], y:[370,406] -
    // squarely INSIDE PressureGraphNode's chart rectangle (x0=DIAGRAM_ORIGIN_X=120 to
    // x0+VIEW_WIDTH=720, top=PRESSURE_GRAPH_TOP=320 to top+VIEW_HEIGHT=450, see PressureGraphNode.ts) -
    // so enabling both the ruler and the pressure graph (adjacent opt-in checkboxes, a likely first thing
    // a student tries) rendered the ruler on top of the graph. Repositioned here to sit in the gap between
    // the top chrome row and the particle field instead: particle field rows span roughly
    // DIAGRAM_ORIGIN_Y+/-50px (ROW_COUNT=6, ROW_SPACING=20, see ParticleFieldNode.ts) i.e. y:[180,280], and
    // the top chrome row (PropagationModeControl + ZoomControl) is estimated to end around y~=86-100 (see
    // SPHERICAL_ORIGIN_Y's own layout comment above for that same chrome-height estimate) - leaving a
    // y~=[100,180] window. At y=DIAGRAM_ORIGIN_Y-110=120, the ruler's 36px-tall footprint spans y:[120,156]:
    // ~20-34px clear of the chrome above it, ~24px clear of the particle field below it, and nowhere near
    // the pressure graph's y:[320,450] chart range at any x. The ruler remains freely draggable afterward -
    // this only changes its non-colliding DEFAULT position.
    this.rulerPositionProperty = new Vector2Property(new Vector2(DIAGRAM_ORIGIN_X + 40, DIAGRAM_ORIGIN_Y - 110));
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
    this.timeSpeedProperty.reset();
    this.rulerPositionProperty.reset();
  }
}
