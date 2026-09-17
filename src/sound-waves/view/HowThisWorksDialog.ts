import { DerivedProperty } from "scenerystack/axon";
import { RichText, Text, VBox } from "scenerystack/scenery";
import { Dialog } from "scenerystack/sim";
import { PhetFont } from "scenerystack/scenery-phet";
import { AIR_DENSITY, AMPLITUDE_SAFETY_FRACTION, SPHERICAL_SOURCE_RADIUS, angularFrequency, SoundWavesModel, strictAmplitudeBound, strictRadialAmplitudeBound } from "../model/SoundWavesModel.js";

const TITLE_FONT = new PhetFont({ size: 18, weight: "bold" });
const BODY_FONT = new PhetFont(14);
const CONTENT_WIDTH = 440;

/**
 * "How This Works" dialog: shows the governing formulas with the student's CURRENT live values
 * substituted in (updates live while the dialog is open), and plainly discloses the model's
 * simplifying assumptions - no equations appear anywhere else in this sim's UI.
 */
export class HowThisWorksDialog extends Dialog {
  public constructor(model: SoundWavesModel) {
    const valuesLineProperty = new DerivedProperty([model.frequencyProperty, model.amplitudeProperty, model.wavelengthProperty, model.speedOfSoundProperty], (frequency, amplitude, wavelength, speedOfSound) => {
      const omega = angularFrequency(frequency);
      const k = (2 * Math.PI) / wavelength;
      return `f = ${frequency.toFixed(0)} Hz, xi_max = ${amplitude.toFixed(3)} m, c = ${speedOfSound.toFixed(0)} m/s, ` + `omega = 2&pi;f = ${omega.toFixed(1)} rad/s, k = 2&pi;/&lambda; = ${k.toFixed(2)} rad/m`;
    });

    const amplitudeCapLineProperty = new DerivedProperty([model.wavelengthProperty], (wavelength) => {
      const strictBound = strictAmplitudeBound(wavelength);
      const cap = AMPLITUDE_SAFETY_FRACTION * strictBound;
      return `Current strict bound: &lambda;/(2&pi;) = ${strictBound.toFixed(3)} m. Current allowed maximum (${AMPLITUDE_SAFETY_FRACTION * 100}% of that): ${cap.toFixed(3)} m.`;
    });

    const sphericalValuesLineProperty = new DerivedProperty([model.sphericalAmplitudeProperty, model.wavelengthProperty], (amplitudeAtSourceRadius, wavelength) => {
      const k = (2 * Math.PI) / wavelength;
      return `&xi;<sub>max</sub>(r<sub>0</sub>) = ${amplitudeAtSourceRadius.toFixed(3)} m at r<sub>0</sub> = ${SPHERICAL_SOURCE_RADIUS} m, k = ${k.toFixed(2)} rad/m.`;
    });

    const sphericalCapLineProperty = new DerivedProperty([model.wavelengthProperty], (wavelength) => {
      const strictRadialBound = strictRadialAmplitudeBound(wavelength, SPHERICAL_SOURCE_RADIUS);
      const cap = AMPLITUDE_SAFETY_FRACTION * strictRadialBound;
      return `Current strict bound: 1/(k + 1/r<sub>0</sub>) = ${strictRadialBound.toFixed(3)} m. Current allowed maximum: ${cap.toFixed(3)} m ` + `(stricter than the plane-wave bound above, since amplitude here also falls off with r).`;
    });

    const content = new VBox({
      spacing: 14,
      align: "left",
      children: [
        new Text("Governing equations", { font: TITLE_FONT }),
        new RichText("&xi;(x,t) = &xi;<sub>max</sub> sin(kx &minus; &omega;t)", { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText("A rightward-traveling displacement wave: &xi; is how far a bit of air is pushed from its resting position, x is distance from the speaker, t is time.", {
          font: BODY_FONT,
          maxWidth: CONTENT_WIDTH,
        }),

        new RichText("u(x,t) = &part;&xi;/&part;t = &minus;&omega;&xi;<sub>max</sub> cos(kx &minus; &omega;t)", { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText("p&prime;(x,t) = &rho;c &sdot; u(x,t)", { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(
          `Particle velocity (u) and pressure variation (p&prime;) are exactly in phase with each other, and both lead displacement (&xi;) by a quarter cycle - ` +
            "so compressions and rarefactions (pressure extremes) happen where displacement crosses ZERO, not where displacement is largest.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),

        new Text("With your current values", { font: TITLE_FONT }),
        new RichText(valuesLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(`Air density &rho; = ${AIR_DENSITY} kg/m<sup>3</sup> (room temperature, dry air).`, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),

        new Text("Spherical wave mode", { font: TITLE_FONT }),
        new RichText("&xi;<sub>r</sub>(r,t) = &xi;<sub>max</sub>(r<sub>0</sub>) &sdot; (r<sub>0</sub>/r) &sdot; sin(kr &minus; &omega;t)", { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(
          "The same traveling wave, but spreading outward from a point source instead of moving in one direction. Amplitude falls off as 1/r (NOT 1/r<sup>2</sup> - that is " +
            "the INTENSITY law, since intensity &prop; amplitude<sup>2</sup> and power through any enclosing sphere is conserved), anchored at a small finite source radius " +
            "r<sub>0</sub> standing in for the point source. u<sub>r</sub> and p&prime; keep the same phase relationship to &xi;<sub>r</sub> as in the plane-wave case above.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
        new RichText(sphericalValuesLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(
          "Because amplitude also falls off with r, the amplitude-overtaking limit is STRICTER than the plane wave's: &xi;<sub>max</sub>(r<sub>0</sub>) &lt; 1/(k + 1/r<sub>0</sub>), " +
            "not the plane wave's simpler &lambda;/(2&pi;).",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
        new RichText(sphericalCapLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),

        new Text("What this model assumes", { font: TITLE_FONT }),
        new RichText(
          "The particle motion you see is EXAGGERATED for visibility - real sound-wave displacements are far too small " +
            "(fractions of a millimeter, even for a loud sound) to see directly. The amplitude slider's maximum is capped " +
            "well below the point where neighboring particles would mathematically overtake each other " +
            "(&xi;<sub>max</sub> &lt; &lambda;/(2&pi;)), which would make the position-vs-time mapping ambiguous.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
        new RichText(amplitudeCapLineProperty, { font: BODY_FONT, maxWidth: CONTENT_WIDTH }),
        new RichText(
          "Because displacement is exaggerated, the pressure values shown (computed honestly from that exaggerated " +
            "displacement) are also far larger than a real sound wave's pressure variation - they do NOT represent a " +
            "real-world sound-pressure-level (dB) scale.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
        new RichText("This sim shows a single wave traveling outward from the speaker, with no reflections - there is nothing for it to reflect off of in this model.", {
          font: BODY_FONT,
          maxWidth: CONTENT_WIDTH,
        }),
        new RichText(
          `Spherical mode is a FAR-FIELD approximation with a small finite source radius (r<sub>0</sub> = ${SPHERICAL_SOURCE_RADIUS} m) standing in for a true point source - ` +
            "it does not attempt to reproduce a real point monopole's near-field behavior close to the source itself.",
          { font: BODY_FONT, maxWidth: CONTENT_WIDTH },
        ),
      ],
    });

    super(content, {
      title: new Text("How This Works", { font: TITLE_FONT }),
    });
  }
}
