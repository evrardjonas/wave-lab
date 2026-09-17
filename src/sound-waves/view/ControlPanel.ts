import type { BooleanProperty, TReadOnlyProperty } from "scenerystack/axon";
import { DerivedProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";
import { Line, RichText, Text, VBox } from "scenerystack/scenery";
import { Checkbox, Panel } from "scenerystack/sun";
import { NumberControl, NumberDisplay, PhetFont, TimeControlNode } from "scenerystack/scenery-phet";
import { AMPLITUDE_SAFETY_FRACTION, DOMAIN_LENGTH, FREQUENCY_RANGE, SoundWavesModel, strictAmplitudeBound, wavelength } from "../model/SoundWavesModel.js";
import type { RepresentationMode } from "./ParticleFieldNode.js";
import { PlaybackSpeedControl } from "./PlaybackSpeedControl.js";

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
  showPressureGraphProperty: BooleanProperty;
  showRulerProperty: BooleanProperty;
  showPressureFieldProperty: BooleanProperty;
  showCompressionTrackerProperty: BooleanProperty;
  representationModeProperty: TReadOnlyProperty<RepresentationMode>;
};

/**
 * All simulation controls, organized per the reviewed interaction design:
 *  - Prominent tier: Frequency/Amplitude NumberControls (with an amplitude-exaggeration disclosure
 *    caption), TimeControlNode (play/pause/step only - see PlaybackSpeedControl below), and this sim's
 *    own PlaybackSpeedControl (Normal/Slow/Ultra Slow - V3 addition, replaces TimeControlNode's built-in,
 *    closed-enum speed radio group).
 *  - An ALWAYS-VISIBLE passive readout strip (Frequency, Wavelength, Speed of Sound) - unlike
 *    Standing Waves' opt-in wave-info panel, these are this sim's centerpiece per the pedagogy
 *    review, so they are never hidden behind a checkbox.
 *  - Opt-in checkboxes (default off): "Show pressure graph", "Show ruler", "Show pressure field", and
 *    "Show compression tracker", each with a short caption. None has any color-coding/checkmark/star/
 *    sound tied to "correctness" - these are exploratory display toggles and a bare measurement tool,
 *    with no feedback on whether a measurement or observation was "right".
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

    // V3: this sim's own 3-way PlaybackSpeedControl (Normal/Slow/Ultra Slow) replaces TimeControlNode's
    // built-in speed radio group entirely - scenery-phet's TimeSpeed enum is closed (FAST/NORMAL/SLOW
    // only, see node_modules/scenerystack/src/scenery-phet/js/TimeSpeed.ts), with no Ultra Slow member to
    // repurpose. `timeSpeedProperty: null` cleanly disables just the built-in speed radio group while
    // keeping play/pause/step (see the installed TimeControlNode source: the play/pause/step button group
    // is always constructed regardless of timeSpeedProperty, which only gates the separate, optional
    // TimeSpeedRadioButtonGroup).
    const timeControlNode = new TimeControlNode(model.isPlayingProperty, {
      timeSpeedProperty: null,
      // StepForwardButton ships with no default listener (the consuming sim must supply one) - without
      // this, the button renders correctly enabled/disabled but silently does nothing when clicked.
      // stepOnce() bypasses model.step()'s isPlayingProperty gate deliberately (see its own doc comment).
      playPauseStepButtonOptions: {
        stepForwardButtonOptions: {
          listener: () => model.stepOnce(),
        },
      },
    });
    const playbackSpeedControl = new PlaybackSpeedControl(model.playbackSpeedProperty);

    const prominentContent = new VBox({
      spacing: 10,
      align: "left",
      children: [
        frequencyControl,
        new VBox({ spacing: 2, align: "left", children: [amplitudeControl, amplitudeCaption] }),
        // Kept visually grouped together (play/pause/step/reset + speed), per the reviewed interaction
        // design - not split across unrelated sections of the panel.
        new VBox({ spacing: 8, align: "left", children: [timeControlNode, playbackSpeedControl] }),
      ],
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
      accessibleHelpText: "Displays a chart of pressure variation versus position, sharing the same axis as the particle field above it. Only available for the plane wave.",
    });

    const rulerCheckbox = new Checkbox(options.showRulerProperty, new Text("Show ruler", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show ruler",
      accessibleHelpText: "Shows a draggable ruler for measuring distances, such as the spacing between two compressions. Pause the simulation first for an accurate reading. Only available at Local zoom.",
    });
    const rulerCaption = new RichText("Pause, then drag the ruler to measure the distance between two compressions.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: PANEL_WIDTH - 20,
    });

    // V3: this checkbox's opt-in "prominent" shading tier becomes a no-op once Pedagogical (labeled
    // "Simplified" on RepresentationModeControl - see that file's V3 label-wording fix) mode is already
    // maximally bold (see PressureFieldNode.ts's Pedagogical-tier redraw) - DISABLED (not hidden, which
    // would shift layout) while representationModeProperty is 'pedagogical', with caption/help text
    // updated so it reads as intentional rather than broken. Re-enabled normally in Real mode. User-facing
    // strings below say "Simplified mode" (matching the button's visible label), not "Pedagogical mode".
    const pressureFieldEnabledProperty = new DerivedProperty([options.representationModeProperty], (mode) => mode !== "pedagogical");
    const pressureFieldCheckbox = new Checkbox(options.showPressureFieldProperty, new Text("Show pressure field", { font: SECONDARY_LABEL_FONT }), {
      enabledProperty: pressureFieldEnabledProperty,
      accessibleName: "Show pressure field",
      accessibleHelpText: new DerivedProperty([options.representationModeProperty], (mode) =>
        mode === "pedagogical"
          ? "Shades the particle field itself red where compressed and blue where rarefied. Already shown in Simplified mode."
          : "Shades the particle field itself red where compressed and blue where rarefied, in addition to the always-on faint background shading.",
      ),
    });
    const pressureFieldCaption = new RichText(
      new DerivedProperty([options.representationModeProperty], (mode) =>
        mode === "pedagogical" ? "Shades the field itself by compression (red) and rarefaction (blue). (Already shown in Simplified mode.)" : "Shades the field itself by compression (red) and rarefaction (blue).",
      ),
      {
        font: CAPTION_FONT,
        fill: "#707070",
        lineWrap: PANEL_WIDTH - 20,
      },
    );

    const compressionTrackerCheckbox = new Checkbox(options.showCompressionTrackerProperty, new Text("Show compression tracker", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show compression tracker",
      accessibleHelpText:
        "Marks the current position of each compression; the spacing between marks is one wavelength. This marker is a bookkeeping tool, not a moving particle or a gust of wind.",
    });
    const compressionTrackerCaption = new RichText(
      "Marks each compression's position — the spacing between marks is one wavelength. This marker is a bookkeeping tool, not a moving particle or a gust of wind.",
      {
        font: CAPTION_FONT,
        fill: "#707070",
        lineWrap: PANEL_WIDTH - 20,
      },
    );

    const overlaysContent = new VBox({
      spacing: 8,
      align: "left",
      children: [
        pressureGraphCheckbox,
        new VBox({ spacing: 2, align: "left", children: [rulerCheckbox, rulerCaption] }),
        new VBox({ spacing: 2, align: "left", children: [pressureFieldCheckbox, pressureFieldCaption] }),
        new VBox({ spacing: 2, align: "left", children: [compressionTrackerCheckbox, compressionTrackerCaption] }),
      ],
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
