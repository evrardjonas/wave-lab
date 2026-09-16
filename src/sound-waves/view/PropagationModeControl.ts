import type { StringUnionProperty } from "scenerystack/axon";
import { HBox, RichText, Text, VBox } from "scenerystack/scenery";
import { RectangularRadioButtonGroup } from "scenerystack/sun";
import { PhetFont } from "scenerystack/scenery-phet";
import type { PropagationMode } from "../model/SoundWavesModel.js";

// This file is VIEW code. Binds directly to model.propagationModeProperty (a real model Property,
// unlike ZoomControl's view-only Property) - which propagation mode is active is genuine simulated
// physics, not a display choice.

const LABEL_FONT = new PhetFont({ size: 12, weight: "bold" });
const OPTION_FONT = new PhetFont(12);
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });
const CAPTION_WIDTH = 360;

/**
 * Stage-level chrome (NOT part of ControlPanel, per the reviewed interaction design - this is prominent,
 * central to the sim's purpose, not a secondary option): a 2-option segmented control choosing between
 * 'plane' and 'spherical' propagation, with a short plain-language caption underneath.
 */
export class PropagationModeControl extends VBox {
  public constructor(propagationModeProperty: StringUnionProperty<PropagationMode>) {
    const radioGroup = new RectangularRadioButtonGroup<PropagationMode>(
      propagationModeProperty,
      [
        { value: "plane", createNode: () => new Text("Plane wave", { font: OPTION_FONT }), options: { accessibleName: "Plane wave" } },
        { value: "spherical", createNode: () => new Text("Spherical wave", { font: OPTION_FONT }), options: { accessibleName: "Spherical wave" } },
      ],
      {
        orientation: "horizontal",
        spacing: 6,
        radioButtonOptions: { xMargin: 8, yMargin: 4 },
        accessibleName: "Propagation mode",
        accessibleHelpText: "Choose whether the wave travels in one direction or spreads outward from a point in every direction.",
      },
    );

    const row = new HBox({ spacing: 8, children: [new Text("Propagation:", { font: LABEL_FONT }), radioGroup] });

    const caption = new RichText("A plane wave moves in one direction; a spherical wave spreads outward from a point, like ripples from a stone, but in every direction.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: CAPTION_WIDTH,
    });

    super({ spacing: 4, align: "left", children: [row, caption] });
  }
}
