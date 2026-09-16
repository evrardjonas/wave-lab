import { BooleanProperty, EnumerationProperty, Property } from "scenerystack/axon";
import { Vector2, Vector2Property } from "scenerystack/dot";
import { DragListener, KeyboardDragListener } from "scenerystack/scenery";
import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { InfoButton, ResetAllButton, RulerNode, TimeSpeed } from "scenerystack/scenery-phet";
import { StandingWavesModel } from "../model/StandingWavesModel.js";
import { StringNode } from "./StringNode.js";
import { ControlPanel } from "./ControlPanel.js";
import { HowThisWorksDialog } from "./HowThisWorksDialog.js";

// View-space layout constants for the string diagram's origin (x=0, equilibrium height).
const DIAGRAM_ORIGIN_X = 90;
const DIAGRAM_ORIGIN_Y = 260;

const RULER_WIDTH = 320; // px, represents 1 m at StringNode's PIXELS_PER_METER_X (kept in sync by eye - both are view-layout constants)
const RULER_MAJOR_TICK_SPACING = 32; // px, represents 10 cm

export class StandingWavesScreenView extends ScreenView {
  private readonly stringNode: StringNode;
  private readonly showPredictedNodesProperty: BooleanProperty;
  private readonly showRulerProperty: BooleanProperty;
  private readonly showWaveInfoProperty: BooleanProperty;
  private readonly timeSpeedProperty: EnumerationProperty<TimeSpeed>;
  private readonly rulerPositionProperty: Vector2Property;

  public constructor(model: StandingWavesModel, options?: ScreenViewOptions) {
    super(options);

    // ---- View-only UI state (display options, not physics - deliberately not model Properties) ----
    this.showPredictedNodesProperty = new BooleanProperty(false);
    this.showRulerProperty = new BooleanProperty(false);
    this.showWaveInfoProperty = new BooleanProperty(false);

    // TimeControlNode needs a scenery-phet EnumerationProperty<TimeSpeed>, which is VIEW-owned here
    // (see the NOTE above SLOW_MOTION_TIME_SCALE in StandingWavesModel.ts for why the model itself
    // only exposes a plain isSlowMotionProperty). Bridge one into the other.
    this.timeSpeedProperty = new EnumerationProperty(TimeSpeed.NORMAL);
    this.timeSpeedProperty.link((speed) => {
      model.isSlowMotionProperty.value = speed === TimeSpeed.SLOW;
    });

    this.stringNode = new StringNode(model, this.showPredictedNodesProperty, {
      x0: DIAGRAM_ORIGIN_X,
      y0: DIAGRAM_ORIGIN_Y,
    });

    const controlPanel = new ControlPanel(model, {
      timeSpeedProperty: this.timeSpeedProperty,
      showPredictedNodesProperty: this.showPredictedNodesProperty,
      showRulerProperty: this.showRulerProperty,
      showWaveInfoProperty: this.showWaveInfoProperty,
    });
    controlPanel.right = this.layoutBounds.maxX - 16;
    controlPanel.top = this.layoutBounds.minY + 56;

    const howThisWorksDialog = new HowThisWorksDialog(model);
    const infoButton = new InfoButton({
      listener: () => howThisWorksDialog.show(),
      left: this.layoutBounds.minX + 16,
      top: this.layoutBounds.minY + 16,
      scale: 0.75,
      accessibleName: "How This Works",
      accessibleHelpText: "Shows the governing equations with your current values filled in.",
    });

    // ---- Draggable ruler (opt-in, default hidden) ----
    this.rulerPositionProperty = new Vector2Property(new Vector2(DIAGRAM_ORIGIN_X + 60, DIAGRAM_ORIGIN_Y + 170));
    const rulerDragBoundsProperty = new Property(this.layoutBounds.eroded(10));

    const rulerNode = new RulerNode(
      RULER_WIDTH,
      40,
      RULER_MAJOR_TICK_SPACING,
      ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"],
      "cm",
      {
        visibleProperty: this.showRulerProperty,
        tagName: "div",
        focusable: true,
        accessibleName: "Ruler",
        accessibleHelpText: "Drag to measure distances along the string, such as the spacing between nodes.",
        cursor: "pointer",
      },
    );
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
      right: this.layoutBounds.maxX - 10,
      bottom: this.layoutBounds.maxY - 10,
    });

    this.children = [this.stringNode, controlPanel, infoButton, rulerNode, resetAllButton];
  }

  /**
   * View-local per-frame update only (redraws the string from current model state) - does NOT call
   * model.step(dt); Joist already steps the model independently every frame. See the confirmed
   * stepping architecture in the scenerystack skill's architecture.md.
   */
  public override step(): void {
    this.stringNode.step();
  }

  public reset(): void {
    this.showPredictedNodesProperty.reset();
    this.showRulerProperty.reset();
    this.showWaveInfoProperty.reset();
    this.timeSpeedProperty.reset();
    this.rulerPositionProperty.reset();
  }
}
