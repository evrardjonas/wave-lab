import { DerivedProperty, type BooleanProperty, type EnumerationProperty, type TReadOnlyProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";
import { HBox, Node, RichText, Text, VBox } from "scenerystack/scenery";
import { AccordionBox, AquaRadioButtonGroup, Checkbox, OnOffSwitch, Panel } from "scenerystack/sun";
import { NumberControl, NumberDisplay, PhetFont, TimeControlNode, TimeSpeed } from "scenerystack/scenery-phet";
import {
  AMPLITUDE_CAP_FRACTION,
  DAMPING_RANGE,
  DRIVING_FREQUENCY_RANGE,
  LENGTH_RANGE,
  LINEAR_DENSITY_RANGE,
  TENSION_RANGE,
  type StandingWavesModel,
} from "../model/StandingWavesModel.js";

// This file is VIEW code (imports scenery/sun/scenery-phet freely) - all physics lives in the model.

const PROMINENT_LABEL_FONT = new PhetFont({ size: 13, weight: "bold" });
const SECONDARY_TITLE_FONT = new PhetFont({ size: 12, weight: "bold" });
const SECONDARY_LABEL_FONT = new PhetFont(11);
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });

const PROMINENT_PANEL_FILL = "#eaf1fb";
const PROMINENT_PANEL_STROKE = "#a9c0e0";
const SECONDARY_PANEL_FILL = "#f5f5f5";
const SECONDARY_PANEL_STROKE = "#cccccc";

const PANEL_WIDTH = 236;

// Maximum wave speed representable anywhere in this sim's parameter ranges - c = sqrt(T/mu), and
// c is maximized by the largest tension and the smallest linear density. Used only to bound the
// wave-speed NumberDisplay's display range (a purely cosmetic axis bound), not for any physics.
const MAX_DISPLAYABLE_WAVE_SPEED = Math.sqrt(TENSION_RANGE.max / LINEAR_DENSITY_RANGE.min);

// Plain-language harmonic numbering (avoids "n = 3" style notation on the main screen, per the
// pedagogy review - equations/symbolic notation should stay confined to the "How This Works" dialog).
function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"] as const;
  const remainder100 = n % 100;
  const suffix = remainder100 >= 11 && remainder100 <= 13 ? "th" : (suffixes[n % 10] ?? "th");
  return `${n}${suffix}`;
}

export type ControlPanelOptions = {
  timeSpeedProperty: EnumerationProperty<TimeSpeed>;
  showPredictedNodesProperty: BooleanProperty;
  showRulerProperty: BooleanProperty;
  showWaveInfoProperty: BooleanProperty;
};

/**
 * All simulation controls, organized into three tiers per the reviewed interaction design:
 *  1. Prominent: driving frequency/amplitude, far-boundary choice, driving on/off, play/pause+speed.
 *  2. Secondary ("String Properties"): length/tension/density/damping - visually smaller/quieter,
 *     since students explore these less often than the prominent-tier controls.
 *  3. Opt-in overlays: predicted-nodes overlay, ruler, and a wave-info readout - all default OFF.
 */
export class ControlPanel extends VBox {
  public constructor(model: StandingWavesModel, options: ControlPanelOptions) {
    const frequencyControl = new NumberControl("Frequency", model.drivingFrequencyProperty, DRIVING_FREQUENCY_RANGE, {
      delta: 0.1,
      numberDisplayOptions: { decimalPlaces: 1, valuePattern: "{{value}} Hz" },
      titleNodeOptions: { font: PROMINENT_LABEL_FONT },
      layoutFunction: NumberControl.createLayoutFunction4({ verticalSpacing: 4 }),
      accessibleName: "Driving Frequency",
    });

    const amplitudeControl = new NumberControl("Amplitude", model.drivingAmplitudeProperty, new Range(0, AMPLITUDE_CAP_FRACTION * LENGTH_RANGE.max), {
      delta: 0.001,
      numberDisplayOptions: { decimalPlaces: 3, valuePattern: "{{value}} m" },
      enabledRangeProperty: model.drivingAmplitudeProperty.rangeProperty,
      titleNodeOptions: { font: PROMINENT_LABEL_FONT },
      layoutFunction: NumberControl.createLayoutFunction4({ verticalSpacing: 4 }),
      accessibleName: "Driving Amplitude",
      accessibleHelpText: "The maximum allowed amplitude shrinks automatically as the string gets shorter.",
    });

    const boundaryRadioGroup = new AquaRadioButtonGroup(
      model.farBoundaryTypeProperty,
      [
        { value: "fixed", createNode: () => new Text("Fixed", { font: SECONDARY_LABEL_FONT }), options: { accessibleName: "Fixed far end" } },
        { value: "free", createNode: () => new Text("Free", { font: SECONDARY_LABEL_FONT }), options: { accessibleName: "Free far end" } },
      ],
      { orientation: "horizontal", spacing: 12 },
    );
    const boundaryRow = new HBox({
      spacing: 8,
      children: [new Text("Far end:", { font: PROMINENT_LABEL_FONT }), boundaryRadioGroup],
    });

    const drivingSwitch = new OnOffSwitch(model.isDrivingProperty, { accessibleName: "Driving on/off" });
    const drivingRow = new HBox({
      spacing: 8,
      children: [new Text("Driving:", { font: PROMINENT_LABEL_FONT }), drivingSwitch],
    });

    const timeControlNode = new TimeControlNode(model.isPlayingProperty, {
      timeSpeedProperty: options.timeSpeedProperty,
      timeSpeeds: [TimeSpeed.NORMAL, TimeSpeed.SLOW],
    });

    const prominentContent = new VBox({
      spacing: 10,
      align: "left",
      children: [frequencyControl, amplitudeControl, boundaryRow, drivingRow, timeControlNode],
    });
    const prominentPanel = new Panel(prominentContent, {
      fill: PROMINENT_PANEL_FILL,
      stroke: PROMINENT_PANEL_STROKE,
      cornerRadius: 8,
      xMargin: 10,
      yMargin: 10,
      minWidth: PANEL_WIDTH,
      align: "left",
    });

    // ---- Secondary tier: "String Properties" - visually smaller/quieter ----

    const secondaryNumberControlOptions = {
      titleNodeOptions: { font: SECONDARY_LABEL_FONT },
      layoutFunction: NumberControl.createLayoutFunction4({ verticalSpacing: 2 }),
    };

    const lengthControl = new NumberControl("Length", model.lengthProperty, LENGTH_RANGE, {
      ...secondaryNumberControlOptions,
      delta: 0.01,
      numberDisplayOptions: { decimalPlaces: 2, valuePattern: "{{value}} m" },
      accessibleName: "String Length",
    });
    const tensionControl = new NumberControl("Tension", model.tensionProperty, TENSION_RANGE, {
      ...secondaryNumberControlOptions,
      delta: 0.1,
      numberDisplayOptions: { decimalPlaces: 1, valuePattern: "{{value}} N" },
      accessibleName: "String Tension",
    });
    const linearDensityControl = new NumberControl("Linear Density", model.linearDensityProperty, LINEAR_DENSITY_RANGE, {
      ...secondaryNumberControlOptions,
      delta: 0.0001,
      // numberFormatter is mutually exclusive with decimalPlaces/valuePattern (NumberDisplay asserts
      // this) - the formatter already rounds to 2 decimal places itself via toFixed(2).
      numberDisplayOptions: { numberFormatter: (mu: number) => `${(mu * 1000).toFixed(2)} g/m` },
      accessibleName: "Linear Density",
    });
    const dampingControl = new NumberControl("Damping", model.dampingProperty, DAMPING_RANGE, {
      ...secondaryNumberControlOptions,
      delta: 0.01,
      numberDisplayOptions: { decimalPlaces: 2, valuePattern: "{{value}} /s" },
      accessibleName: "Damping",
    });

    const waveSpeedDisplay = new NumberDisplay(model.waveSpeedProperty, new Range(0, MAX_DISPLAYABLE_WAVE_SPEED), {
      valuePattern: "Speed: {{value}} m/s",
      decimalPlaces: 2,
      textOptions: { font: SECONDARY_LABEL_FONT },
      backgroundStroke: null,
      backgroundFill: null,
    });

    const secondaryContent = new VBox({
      spacing: 6,
      align: "left",
      children: [lengthControl, tensionControl, linearDensityControl, dampingControl, waveSpeedDisplay],
    });

    const stringPropertiesBox = new AccordionBox(secondaryContent, {
      titleNode: new Text("String Properties", { font: SECONDARY_TITLE_FONT }),
      expandedDefaultValue: true,
      fill: SECONDARY_PANEL_FILL,
      stroke: SECONDARY_PANEL_STROKE,
      cornerRadius: 8,
      contentXMargin: 10,
      contentYMargin: 8,
      buttonXMargin: 8,
      buttonYMargin: 8,
      minWidth: PANEL_WIDTH,
      titleAlignX: "left",
    });

    // ---- Opt-in overlays (all default off) ----

    const predictedNodesCheckbox = new Checkbox(options.showPredictedNodesProperty, new Text("Show predicted nodes (nearest harmonic)", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show predicted nodes for the nearest harmonic",
    });
    const predictedNodesCaption = new RichText(
      "Predicted pattern for the nearest harmonic - the actual wave may differ, especially off-resonance or with damping.",
      { font: CAPTION_FONT, fill: "#707070", lineWrap: PANEL_WIDTH - 20 },
    );

    const rulerCheckbox = new Checkbox(options.showRulerProperty, new Text("Show ruler", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show ruler",
    });

    const waveInfoCheckbox = new Checkbox(options.showWaveInfoProperty, new Text("Show wave info", { font: SECONDARY_LABEL_FONT }), {
      accessibleName: "Show wave info",
    });

    const wavelengthProperty: TReadOnlyProperty<number> = new DerivedProperty([model.waveSpeedProperty, model.drivingFrequencyProperty], (speed, frequency) => speed / frequency);

    const waveSpeedInfoStringProperty = new DerivedProperty([model.waveSpeedProperty], (speed) => `Wave speed: ${speed.toFixed(2)} m/s`);
    const wavelengthInfoStringProperty = new DerivedProperty([wavelengthProperty], (wavelength) => `Wavelength: ${wavelength.toFixed(2)} m`);
    const harmonicInfoStringProperty = new DerivedProperty(
      [model.nearestHarmonicProperty, model.nearestHarmonicFrequencyProperty],
      (n, f) => `Nearest harmonic: ${ordinal(n)} (${f.toFixed(2)} Hz)`,
    );

    // Purely informational - explicitly no checkmarks/stars/success color-coding/sounds, per the
    // pedagogy review: this should read as a neutral observation, not a reward state.
    const RESONANCE_TOLERANCE = 0.03; // fractional closeness to the nearest harmonic frequency
    const resonanceNoteStringProperty = new DerivedProperty(
      [model.drivingFrequencyProperty, model.nearestHarmonicFrequencyProperty, model.nearestHarmonicProperty],
      (drivingFrequency, harmonicFrequencyValue, n) =>
        Math.abs(drivingFrequency - harmonicFrequencyValue) / harmonicFrequencyValue < RESONANCE_TOLERANCE ? `Near the ${ordinal(n)} harmonic` : "",
    );
    const hasResonanceNoteProperty = new DerivedProperty([resonanceNoteStringProperty], (s) => s.length > 0);

    const waveInfoDetails = new VBox({
      spacing: 3,
      align: "left",
      visibleProperty: options.showWaveInfoProperty,
      children: [
        new Text(waveSpeedInfoStringProperty, { font: CAPTION_FONT }),
        new Text(wavelengthInfoStringProperty, { font: CAPTION_FONT }),
        new Text(harmonicInfoStringProperty, { font: CAPTION_FONT }),
        new Text(resonanceNoteStringProperty, { font: CAPTION_FONT, fill: "#555555", visibleProperty: hasResonanceNoteProperty }),
      ],
    });

    const overlaysContent = new VBox({
      spacing: 8,
      align: "left",
      children: [
        new VBox({ spacing: 2, align: "left", children: [predictedNodesCheckbox, predictedNodesCaption] }),
        rulerCheckbox,
        waveInfoCheckbox,
        waveInfoDetails,
      ],
    });
    const overlaysPanel = new Panel(overlaysContent, {
      fill: SECONDARY_PANEL_FILL,
      stroke: SECONDARY_PANEL_STROKE,
      cornerRadius: 8,
      xMargin: 10,
      yMargin: 10,
      minWidth: PANEL_WIDTH,
      align: "left",
    });

    super({
      spacing: 12,
      align: "left",
      children: [prominentPanel, stringPropertiesBox, overlaysPanel] as Node[],
    });
  }
}
