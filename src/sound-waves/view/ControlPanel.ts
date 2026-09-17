import type { BooleanProperty, EnumerationProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";
import { Line, RichText, Text, VBox } from "scenerystack/scenery";
import { Checkbox, Panel } from "scenerystack/sun";
import { NumberControl, NumberDisplay, PhetFont, TimeControlNode, TimeSpeed } from "scenerystack/scenery-phet";
import { AMPLITUDE_SAFETY_FRACTION, DOMAIN_LENGTH, FREQUENCY_RANGE, SoundWavesModel, strictAmplitudeBound, wavelength } from "../model/SoundWavesModel.js";

// This file is VIEW code (imports scenery/sun/scenery-phet freely) - all physics lives in the model.

const PROMINENT_LABEL_FONT = new PhetFont({ size: 13, weight: "bold" });
const READOUT_LABEL_FONT = new PhetFont(12);
const SECONDARY_LABEL_FONT = new PhetFont(12);
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });

const PANEL_FILL = "#eaf1fb";
const PANEL_STROKE = "#a9c0e0";
const PANEL_WIDTH = 250;
const PANEL_SPACING = 12;

// Cosmetic-only display bounds for the always-visible readout NumberDisplays below (NOT physics
// ranges - those live on the model's own Properties/DerivedProperties). Wavelength spans
// c/FREQUENCY_RANGE.max .. c/FREQUENCY_RANGE.min; padded a bit above DOMAIN_LENGTH so the display
// never looks clipped. Speed of sound is currently a fixed constant, but this bound stays reasonable
// if a future temperature feature makes it vary.
const WAVELENGTH_DISPLAY_RANGE = new Range(0, DOMAIN_LENGTH);
const SPEED_OF_SOUND_DISPLAY_RANGE = new Range(0, 400);

// The amplitude cap (AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(lambda)) shrinks as frequency
// INCREASES (shorter wavelength), so it is WIDEST at FREQUENCY_RANGE.min. The NumberControl below
// needs a fixed outer track Range (it cannot itself react to model.amplitudeProperty.range changing),
// so this must be computed from FREQUENCY_RANGE.min - NOT from model.amplitudeProperty.range.max at
// construction time (which reflects only the DEFAULT frequency and would wrongly clip the slider's
// visual track once the student drags frequency below the default, even though the live
// enabledRangeProperty below would correctly widen). Mirrors Standing Waves' ControlPanel.ts, which
// sizes its amplitudeControl's outer Range from LENGTH_RANGE.max (the length that gives the widest cap)
// for the identical reason.
function widestPossibleAmplitudeRange(speedOfSound: number): Range {
  const widestWavelength = wavelength(speedOfSound, FREQUENCY_RANGE.min);
  return new Range(0, AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(widestWavelength));
}

export type ControlPanelOptions = {
  timeSpeedProperty: EnumerationProperty<TimeSpeed>;
  showPressureGraphProperty: BooleanProperty;
  showRulerProperty: BooleanProperty;
};

/**
 * All simulation controls, organized per the reviewed interaction design:
 *  - Prominent tier: Frequency/Amplitude NumberControls (with an amplitude-exaggeration disclosure
 *    caption) and TimeControlNode (play/pause + Normal/Slow speed).
 *  - An ALWAYS-VISIBLE passive readout strip (Frequency, Wavelength, Speed of Sound) - unlike
 *    Standing Waves' opt-in wave-info panel, these are this sim's centerpiece per the pedagogy
 *    review, so they are never hidden behind a checkbox.
 *  - Opt-in checkboxes (default off): "Show pressure graph" and "Show ruler", each with a short
 *    caption. Neither has any color-coding/checkmark/star/sound tied to "correctness" - the ruler is
 *    a bare measurement tool with no feedback on whether a measurement was "right".
 */
export class ControlPanel extends Panel {
  public constructor(model: SoundWavesModel, options: ControlPanelOptions) {
    const frequencyControl = new NumberControl("Frequency", model.frequencyProperty, FREQUENCY_RANGE, {
      delta: 1,
      numberDisplayOptions: { decimalPlaces: 0, valuePattern: "{{value}} Hz" },
      titleNodeOptions: { font: PROMINENT_LABEL_FONT },
      layoutFunction: NumberControl.createLayoutFunction4({ verticalSpacing: 4 }),
      accessibleName: "Frequency",
    });

    const amplitudeControl = new NumberControl("Amplitude", model.amplitudeProperty, widestPossibleAmplitudeRange(model.speedOfSoundProperty.value), {
      delta: 0.001,
      numberDisplayOptions: { decimalPlaces: 3, valuePattern: "{{value}} m" },
      enabledRangeProperty: model.amplitudeProperty.rangeProperty,
      titleNodeOptions: { font: PROMINENT_LABEL_FONT },
      layoutFunction: NumberControl.createLayoutFunction4({ verticalSpacing: 4 }),
      accessibleName: "Amplitude",
      accessibleHelpText: "The maximum allowed amplitude shrinks automatically as frequency increases.",
    });
    const amplitudeCaption = new RichText("Particle motion is shown much larger than real sound waves, so it's visible.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: PANEL_WIDTH - 20,
    });

    const timeControlNode = new TimeControlNode(model.isPlayingProperty, {
      timeSpeedProperty: options.timeSpeedProperty,
      timeSpeeds: [TimeSpeed.NORMAL, TimeSpeed.SLOW],
    });

    const prominentContent = new VBox({
      spacing: 10,
      align: "left",
      children: [frequencyControl, new VBox({ spacing: 2, align: "left", children: [amplitudeControl, amplitudeCaption] }), timeControlNode],
    });

    // ---- Always-visible readout strip (this sim's centerpiece - never opt-in) ----

    const frequencyDisplay = new NumberDisplay(model.frequencyProperty, FREQUENCY_RANGE, {
      valuePattern: "Frequency: {{value}} Hz",
      decimalPlaces: 0,
      textOptions: { font: READOUT_LABEL_FONT },
      backgroundStroke: null,
      backgroundFill: null,
    });
    const wavelengthDisplay = new NumberDisplay(model.wavelengthProperty, WAVELENGTH_DISPLAY_RANGE, {
      valuePattern: "Wavelength: {{value}} m",
      decimalPlaces: 2,
      textOptions: { font: READOUT_LABEL_FONT },
      backgroundStroke: null,
      backgroundFill: null,
    });
    const speedOfSoundDisplay = new NumberDisplay(model.speedOfSoundProperty, SPEED_OF_SOUND_DISPLAY_RANGE, {
      valuePattern: "Speed of sound: {{value}} m/s",
      decimalPlaces: 0,
      textOptions: { font: READOUT_LABEL_FONT },
      backgroundStroke: null,
      backgroundFill: null,
    });

    const readoutContent = new VBox({
      spacing: 4,
      align: "left",
      children: [frequencyDisplay, wavelengthDisplay, speedOfSoundDisplay],
    });

    // ---- Opt-in overlays (default off) ----

    const pressureGraphCheckbox = new Checkbox(options.showPressureGraphProperty, new Text("Show pressure graph", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show pressure graph",
    });

    const rulerCheckbox = new Checkbox(options.showRulerProperty, new Text("Show ruler", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show ruler",
    });
    const rulerCaption = new RichText("Pause, then drag the ruler to measure the distance between two compressions.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: PANEL_WIDTH - 20,
    });

    const overlaysContent = new VBox({
      spacing: 8,
      align: "left",
      children: [pressureGraphCheckbox, new VBox({ spacing: 2, align: "left", children: [rulerCheckbox, rulerCaption] })],
    });

    const content = new VBox({
      spacing: PANEL_SPACING,
      align: "left",
      children: [prominentContent, new Line(0, 0, PANEL_WIDTH - 20, 0, { stroke: PANEL_STROKE }), readoutContent, new Line(0, 0, PANEL_WIDTH - 20, 0, { stroke: PANEL_STROKE }), overlaysContent],
    });

    super(content, {
      fill: PANEL_FILL,
      stroke: PANEL_STROKE,
      cornerRadius: 8,
      xMargin: 10,
      yMargin: 10,
      minWidth: PANEL_WIDTH,
      align: "left",
    });
  }
}
