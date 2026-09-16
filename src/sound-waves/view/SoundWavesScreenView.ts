import { BooleanProperty, EnumerationProperty, Property } from "scenerystack/axon";
import { Vector2, Vector2Property } from "scenerystack/dot";
import { DragListener, KeyboardDragListener } from "scenerystack/scenery";
import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { InfoButton, ResetAllButton, RulerNode, TimeSpeed } from "scenerystack/scenery-phet";
import { SoundWavesModel } from "../model/SoundWavesModel.js";
import { ParticleFieldNode, PIXELS_PER_METER_X } from "./ParticleFieldNode.js";
import { LoudspeakerNode } from "./LoudspeakerNode.js";
import { PressureGraphNode } from "./PressureGraphNode.js";
import { ControlPanel } from "./ControlPanel.js";
import { HowThisWorksDialog } from "./HowThisWorksDialog.js";

// View-space layout constants. x=0 (the loudspeaker) sits at DIAGRAM_ORIGIN_X; the particle field's
// vertical center sits at DIAGRAM_ORIGIN_Y. PIXELS_PER_METER_X (imported from ParticleFieldNode.ts,
// not redefined here) is shared by ParticleFieldNode, LoudspeakerNode, and PressureGraphNode so the
// speaker's motion, the particle field, and the pressure graph's x-axis all agree pixel-for-pixel.
const DIAGRAM_ORIGIN_X = 120;
const DIAGRAM_ORIGIN_Y = 230;
const PRESSURE_GRAPH_TOP = DIAGRAM_ORIGIN_Y + 90;

const RULER_WIDTH = PIXELS_PER_METER_X; // px, represents exactly 1 m at this screen's shared scale
// 20 cm major ticks (not 10 cm, unlike Standing Waves' ruler) - PIXELS_PER_METER_X is smaller here
// (150 vs Standing Waves' 320, since this sim's domain is several meters, not ~1-2m), so 10 cm ticks
// would only be 15px apart - too narrow for RulerNode to fit a tick label plus the "cm" units label
// (it asserts on construction if there isn't room). 20 cm ticks give 30px of spacing, matching the
// ~32px that's already proven to work in Standing Waves' ruler.
const RULER_MAJOR_TICK_SPACING = PIXELS_PER_METER_X / 5; // px, represents 20 cm

const RESET_ALL_BUTTON_MARGIN = 10;

export class SoundWavesScreenView extends ScreenView {
  private readonly particleFieldNode: ParticleFieldNode;
  private readonly loudspeakerNode: LoudspeakerNode;
  private readonly pressureGraphNode: PressureGraphNode;
  private readonly showPressureGraphProperty: BooleanProperty;
  private readonly showRulerProperty: BooleanProperty;
  private readonly timeSpeedProperty: EnumerationProperty<TimeSpeed>;
  private readonly rulerPositionProperty: Vector2Property;

  public constructor(model: SoundWavesModel, options?: ScreenViewOptions) {
    super(options);

    // ---- View-only UI state (display options, not physics - deliberately not model Properties) ----
    this.showPressureGraphProperty = new BooleanProperty(false);
    this.showRulerProperty = new BooleanProperty(false);

    // TimeControlNode needs a scenery-phet EnumerationProperty<TimeSpeed>, which is VIEW-owned here
    // (see the NOTE above isSlowMotionProperty in SoundWavesModel.ts for why the model itself only
    // exposes a plain isSlowMotionProperty). Bridge one into the other, exactly mirroring
    // StandingWavesScreenView's pattern.
    this.timeSpeedProperty = new EnumerationProperty(TimeSpeed.NORMAL);
    this.timeSpeedProperty.link((speed) => {
      model.isSlowMotionProperty.value = speed === TimeSpeed.SLOW;
    });

    this.loudspeakerNode = new LoudspeakerNode(model, { x0: DIAGRAM_ORIGIN_X, y0: DIAGRAM_ORIGIN_Y });
    this.particleFieldNode = new ParticleFieldNode(model, { x0: DIAGRAM_ORIGIN_X, y0: DIAGRAM_ORIGIN_Y });
    this.pressureGraphNode = new PressureGraphNode(model, {
      x0: DIAGRAM_ORIGIN_X,
      top: PRESSURE_GRAPH_TOP,
      visibleProperty: this.showPressureGraphProperty,
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

    // ---- Draggable ruler (opt-in, default hidden) ----
    this.rulerPositionProperty = new Vector2Property(new Vector2(DIAGRAM_ORIGIN_X + 40, DIAGRAM_ORIGIN_Y + 140));
    const rulerDragBoundsProperty = new Property(this.layoutBounds.eroded(10));

    const rulerNode = new RulerNode(RULER_WIDTH, 36, RULER_MAJOR_TICK_SPACING, ["0", "20", "40", "60", "80", "100"], "cm", {
      visibleProperty: this.showRulerProperty,
      tagName: "div",
      focusable: true,
      accessibleName: "Ruler",
      accessibleHelpText: "Drag to measure distances along the domain, such as the spacing between two compressions.",
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

    this.children = [this.loudspeakerNode, this.particleFieldNode, this.pressureGraphNode, controlPanel, infoButton, rulerNode, resetAllButton];
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
    this.timeSpeedProperty.reset();
    this.rulerPositionProperty.reset();
  }
}
