import { BooleanProperty, DerivedProperty, EnumerationProperty, Property } from "scenerystack/axon";
import { Vector2, Vector2Property } from "scenerystack/dot";
import { DragListener, KeyboardDragListener } from "scenerystack/scenery";
import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { InfoButton, ResetAllButton, RulerNode, TimeSpeed } from "scenerystack/scenery-phet";
import { SoundWavesModel } from "../model/SoundWavesModel.js";
import { ParticleFieldNode, pixelsPerMeterForZoom, type ViewZoom } from "./ParticleFieldNode.js";
import { LoudspeakerNode, PointSourceNode } from "./LoudspeakerNode.js";
import { PressureGraphNode } from "./PressureGraphNode.js";
import { ControlPanel } from "./ControlPanel.js";
import { HowThisWorksDialog } from "./HowThisWorksDialog.js";
import { ZoomControl } from "./ZoomControl.js";
import { PropagationModeControl } from "./PropagationModeControl.js";

// View-space layout constants. x=0 (the loudspeaker) sits at DIAGRAM_ORIGIN_X in PLANE mode; the
// particle field's vertical center sits at DIAGRAM_ORIGIN_Y. SPHERICAL_ORIGIN_X/Y is the separate point
// where the point source sits in SPHERICAL mode, since the spherical field radiates in every direction
// from its origin and cannot share the plane wave's left-edge origin. Only one mode's diagram is
// visible/relevant at a time (see the propagationModeProperty link below), so the two origins never need
// to coexist visually.
const DIAGRAM_ORIGIN_X = 120;
const DIAGRAM_ORIGIN_Y = 230;
const PRESSURE_GRAPH_TOP = DIAGRAM_ORIGIN_Y + 90;

const SPHERICAL_ORIGIN_X = 350;
const SPHERICAL_ORIGIN_Y = 320;

const RULER_WIDTH = pixelsPerMeterForZoom("local"); // px, represents exactly 1 m at Local zoom's scale -
// numerically identical to this sim's original fixed scale (150 px/m), since "local" reproduces it exactly.
// 20 cm major ticks (not 10 cm, unlike Standing Waves' ruler) because that scale is smaller than Standing
// Waves' (150 vs 320 px/m), so 10 cm ticks would only be 15px apart - too narrow for RulerNode to fit a
// tick label plus the "cm" units label (it asserts on construction if there isn't room).
const RULER_MAJOR_TICK_SPACING = RULER_WIDTH / 5; // px, represents 20 cm

const RESET_ALL_BUTTON_MARGIN = 10;

export class SoundWavesScreenView extends ScreenView {
  private readonly particleFieldNode: ParticleFieldNode;
  private readonly loudspeakerNode: LoudspeakerNode;
  private readonly pointSourceNode: PointSourceNode;
  private readonly pressureGraphNode: PressureGraphNode;
  private readonly showPressureGraphProperty: BooleanProperty;
  private readonly showRulerProperty: BooleanProperty;
  private readonly viewZoomProperty: Property<ViewZoom>;
  private readonly timeSpeedProperty: EnumerationProperty<TimeSpeed>;
  private readonly rulerPositionProperty: Vector2Property;

  public constructor(model: SoundWavesModel, options?: ScreenViewOptions) {
    super(options);

    // ---- View-only UI state (display options, not physics - deliberately not model Properties) ----
    this.showPressureGraphProperty = new BooleanProperty(false);
    this.showRulerProperty = new BooleanProperty(false);
    // Defaults to "local", which exactly reproduces this sim's original fixed-scale appearance (see
    // ParticleFieldNode.ts's FIELD_PIXEL_WIDTH doc).
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

    this.particleFieldNode = new ParticleFieldNode(model, {
      planeOriginX: DIAGRAM_ORIGIN_X,
      planeOriginY: DIAGRAM_ORIGIN_Y,
      sphericalOriginX: SPHERICAL_ORIGIN_X,
      sphericalOriginY: SPHERICAL_ORIGIN_Y,
      viewZoomProperty: this.viewZoomProperty,
    });

    // PressureGraphNode plots the plane wave's own fixed sample cache (see its own doc comment) - shown
    // only when BOTH the checkbox is on AND propagationModeProperty is 'plane', so it never claims to
    // represent spherical mode's field.
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
    // class doc) - a horizontal row to the right of the info button, clear of the ControlPanel. ----
    const propagationModeControl = new PropagationModeControl(model.propagationModeProperty);
    propagationModeControl.left = infoButton.right + 16;
    propagationModeControl.top = this.layoutBounds.minY + 16;

    const zoomControl = new ZoomControl(this.viewZoomProperty);
    zoomControl.left = propagationModeControl.right + 24;
    zoomControl.top = this.layoutBounds.minY + 16;

    // ---- Draggable ruler (opt-in, default hidden; calibrated for Local zoom only - see RULER_WIDTH) ----
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
      this.particleFieldNode,
      this.loudspeakerNode,
      this.pointSourceNode,
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
    this.pressureGraphNode.step();
  }

  public reset(): void {
    this.showPressureGraphProperty.reset();
    this.showRulerProperty.reset();
    this.viewZoomProperty.reset();
    this.timeSpeedProperty.reset();
    this.rulerPositionProperty.reset();
  }
}
