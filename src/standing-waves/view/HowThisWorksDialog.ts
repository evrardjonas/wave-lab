import { DerivedProperty } from "scenerystack/axon";
import { RichText, Text, VBox } from "scenerystack/scenery";
import { Dialog } from "scenerystack/sim";
import { PhetFont } from "scenerystack/scenery-phet";
import { AMPLITUDE_CAP_FRACTION, DAMPING_MIN, type StandingWavesModel } from "../model/StandingWavesModel.js";

const TITLE_FONT = new PhetFont({ size: 18, weight: "bold" });
const BODY_FONT = new PhetFont(14);
const CONTENT_WIDTH = 420;

/**
 * "How This Works" dialog: shows the governing formulas with the student's CURRENT live values
 * substituted in (updates live while the dialog is open), and plainly discloses the model's
 * simplifying assumptions - no equations appear anywhere else in this sim's UI.
 */
export class HowThisWorksDialog extends Dialog {
  public constructor(model: StandingWavesModel) {
    const waveSpeedLineProperty = new DerivedProperty([model.tensionProperty, model.linearDensityProperty, model.waveSpeedProperty], (tension, linearDensity, speed) =>
      `c = sqrt(T / mu) = sqrt(${tension.toFixed(2)} N / ${linearDensity.toFixed(4)} kg/m) = ${speed.toFixed(2)} m/s`,
    );

    const fundamentalLineProperty = new DerivedProperty(
      [model.waveSpeedProperty, model.lengthProperty, model.farBoundaryTypeProperty, model.fundamentalFrequencyProperty],
      (speed, length, boundary, fundamental) => {
        const formula = boundary === "fixed" ? `c / (2L) = ${speed.toFixed(2)} / (2 x ${length.toFixed(2)})` : `c / (4L) = ${speed.toFixed(2)} / (4 x ${length.toFixed(2)})`;
        return `f1 = ${formula} = ${fundamental.toFixed(2)} Hz`;
      },
    );

    const amplitudeCapLineProperty = new DerivedProperty([model.lengthProperty], (length) => `Current amplitude cap: ${AMPLITUDE_CAP_FRACTION * 100}% x L = ${(AMPLITUDE_CAP_FRACTION * length).toFixed(3)} m`);

    const content = new VBox({
      spacing: 14,
      align: "left",
      children: [
        new Text("Governing equation", { font: TITLE_FONT }),
        new RichText("d<sup>2</sup>y/dt<sup>2</sup> = c<sup>2</sup> d<sup>2</sup>y/dx<sup>2</sup> - &gamma; dy/dt", {
          font: BODY_FONT,
          maxWidth: CONTENT_WIDTH,
        }),
        new RichText("A damped transverse wave equation: y(x,t) is the string's sideways displacement, c is wave speed, and &gamma; is a damping rate.", {
          font: BODY_FONT,
          maxWidth: CONTENT_WIDTH,
        }),

        new Text("With your current values", { font: TITLE_FONT }),
        new RichText(waveSpeedLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(fundamentalLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),

        new Text("What this model assumes", { font: TITLE_FONT }),
        new RichText(
          "This is a SMALL-SLOPE model: it is only accurate when the string's sideways displacement stays small " +
            "compared to its length. To keep that reasonable, the driving amplitude is capped well below the " +
            "string's length, and that cap shrinks automatically as the string gets shorter.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
        new RichText(amplitudeCapLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(`Damping is never exactly zero in this model - it is floored at &gamma; = ${DAMPING_MIN} /s, so the string always eventually settles.`, {
          font: BODY_FONT,
          maxWidth: CONTENT_WIDTH,
        }),
        new RichText(
          "The driven (shaking) end is only an APPROXIMATE node - it is held to a small prescribed motion, not " +
            "forced exactly to zero, so it will not look perfectly still, especially off-resonance.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
      ],
    });

    super(content, {
      title: new Text("How This Works", { font: TITLE_FONT }),
    });
  }
}
