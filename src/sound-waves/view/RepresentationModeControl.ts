import type { Property } from "scenerystack/axon";
import { HBox, RichText, Text, VBox } from "scenerystack/scenery";
import { RectangularRadioButtonGroup } from "scenerystack/sun";
import { PhetFont } from "scenerystack/scenery-phet";
import type { RepresentationMode } from "./ParticleFieldNode.js";

// This file is VIEW code. View-only state (see SoundWavesScreenView.ts) - which representation mode is
// selected is purely a display choice, not simulated physics, so it lives on a plain Property owned by
// the view, not a model Property (mirrors this sim's existing showPressureGraphProperty/ZoomControl
// pattern) - unlike PropagationModeControl.ts, which binds to a genuine model Property. Construction
// pattern otherwise mirrored exactly from PropagationModeControl.ts.

const LABEL_FONT = new PhetFont({ size: 12, weight: "bold" });
const OPTION_FONT = new PhetFont(12);
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });
const CAPTION_WIDTH = 220;

/**
 * Stage-level chrome (NOT part of ControlPanel - a "what am I looking at" concern, grouped with
 * InfoButton and PropagationModeControl in the top chrome row, see SoundWavesScreenView.ts): a 2-option
 * segmented control choosing between 'real' (the sim's original precise rendering) and 'pedagogical' (a
 * bolder, more legible rendering), with a short plain-language caption underneath.
 */
export class RepresentationModeControl extends VBox {
  public constructor(representationModeProperty: Property<RepresentationMode>) {
    const radioGroup = new RectangularRadioButtonGroup<RepresentationMode>(
      representationModeProperty,
      [
        {
          value: "real",
          createNode: () => new Text("Real", { font: OPTION_FONT }),
          options: { accessibleName: "Real", accessibleHelpText: "A precise, quantitative view for measurement." },
        },
        {
          // V3 fix (pedagogy re-review): "Pedagogical model" is somewhat academic wording for a
          // secondary-school audience - "Simplified" says the same thing more plainly. accessibleName is
          // updated to match (not just the visible label) so the announced name still contains the visible
          // text (WCAG "Label in Name") - the caption below and accessibleHelpText, which already explain
          // the purpose clearly, are unchanged.
          value: "pedagogical",
          createNode: () => new Text("Simplified", { font: OPTION_FONT }),
          options: { accessibleName: "Simplified", accessibleHelpText: "A simplified view designed to make wave propagation easy to see." },
        },
      ],
      {
        orientation: "horizontal",
        spacing: 6,
        radioButtonOptions: { xMargin: 8, yMargin: 4 },
        accessibleName: "Representation",
        accessibleHelpText: "Choose between a precise, quantitative view and a simplified view designed to make wave propagation easy to see.",
      },
    );

    const row = new HBox({ spacing: 8, children: [new Text("View:", { font: LABEL_FONT }), radioGroup] });

    const caption = new RichText("Switching never changes the physics - only how it's drawn.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: CAPTION_WIDTH,
    });

    super({ spacing: 4, align: "left", children: [row, caption] });
  }
}
