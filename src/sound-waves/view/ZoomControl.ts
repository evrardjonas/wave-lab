import type { Property } from "scenerystack/axon";
import { HBox, Text } from "scenerystack/scenery";
import { RectangularRadioButtonGroup } from "scenerystack/sun";
import { PhetFont } from "scenerystack/scenery-phet";
import type { ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. View-only state (see SoundWavesScreenView.ts) - which zoom level is selected
// is purely a display choice, not simulated physics, so it lives on a plain Property owned by the view,
// not a model Property (mirrors this sim's existing showPressureGraphProperty/showRulerProperty pattern).

const LABEL_FONT = new PhetFont({ size: 12, weight: "bold" });
const OPTION_FONT = new PhetFont(12);

/**
 * Stage-level chrome (NOT part of ControlPanel, per the reviewed interaction design - it's about how
 * much of the field is visible, not a simulation parameter): a 2-option segmented control choosing
 * between a close-up "Local" view (the sim's original 4m width) and a wider "Field" view (16m).
 */
export class ZoomControl extends HBox {
  public constructor(viewZoomProperty: Property<ViewZoom>) {
    const radioGroup = new RectangularRadioButtonGroup<ViewZoom>(
      viewZoomProperty,
      [
        { value: "local", createNode: () => new Text("Local", { font: OPTION_FONT }), options: { accessibleName: "Local view" } },
        { value: "field", createNode: () => new Text("Field", { font: OPTION_FONT }), options: { accessibleName: "Field view" } },
      ],
      {
        orientation: "horizontal",
        spacing: 4,
        radioButtonOptions: { xMargin: 8, yMargin: 4 },
        accessibleName: "View zoom",
        accessibleHelpText: "Choose how much of the field is visible: a close-up Local view, or a wider Field view.",
      },
    );

    super({
      spacing: 8,
      children: [new Text("View:", { font: LABEL_FONT }), radioGroup],
    });
  }
}
