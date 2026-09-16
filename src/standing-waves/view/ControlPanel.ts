import { DerivedProperty, Multilink, type BooleanProperty, type EnumerationProperty, type TReadOnlyProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";
import { DOM, HBox, Node, RichText, Text, VBox } from "scenerystack/scenery";
import { AccordionBox, AquaRadioButtonGroup, Checkbox, OnOffSwitch, Panel, TextPushButton } from "scenerystack/sun";
import { NumberControl, NumberDisplay, PhetFont, TimeControlNode, TimeSpeed } from "scenerystack/scenery-phet";
import {
  AMPLITUDE_CAP_FRACTION,
  DAMPING_RANGE,
  DRIVING_FREQUENCY_RANGE,
  LENGTH_RANGE,
  LINEAR_DENSITY_RANGE,
  TENSION_RANGE,
  predictedHarmonics,
  type StandingWavesModel,
} from "../model/StandingWavesModel.js";
import { ScrollableVBox } from "./ScrollableVBox.js";

// This file is VIEW code (imports scenery/sun/scenery-phet freely) - all physics lives in the model.

const PROMINENT_LABEL_FONT = new PhetFont({ size: 13, weight: "bold" });
const SECONDARY_TITLE_FONT = new PhetFont({ size: 12, weight: "bold" });
const SECONDARY_LABEL_FONT = new PhetFont(11);
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });
const NEAREST_HARMONIC_FONT = new PhetFont({ size: 11, weight: "bold" });

const PROMINENT_PANEL_FILL = "#eaf1fb";
const PROMINENT_PANEL_STROKE = "#a9c0e0";
const SECONDARY_PANEL_FILL = "#f5f5f5";
const SECONDARY_PANEL_STROKE = "#cccccc";

const PANEL_WIDTH = 236;

// Vertical gap between the four stacked sections (prominentPanel, predictedHarmonicsPanel,
// stringPropertiesBox, overlaysPanel) - also used to size the scrollable region's viewport, so the
// two stay consistent (see availableHeight handling in the constructor below).
const CONTROL_PANEL_SPACING = 12;

// Maximum number of rows shown in the "Predicted Harmonics" picker list - a purely cosmetic UI bound
// (see predictedHarmonics() in the model, which is deliberately unrelated to nearestHarmonic()).
const PREDICTED_HARMONICS_LIST_MAX_COUNT = 6;

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

/**
 * A minimal editable numeric text field for the driving frequency, backed by a real HTML <input>
 * wrapped in a Scenery DOM node. No higher-level SceneryStack component supports free-text numeric
 * entry: scenery-phet's NumberDisplay/NumberControl are display+slider only (no typing), and sun's
 * NumberSpinner (checked via node_modules/scenerystack/src/sun/js/NumberSpinner.ts) requires integer
 * values and only supports incrementing/decrementing (by mouse, or arrow/home/end keys) - not typing
 * an arbitrary decimal value. scenery-phet also has a Keypad/KeypadDialog (virtual on-screen keypad in
 * a modal), but that's a click-driven modal, not the inline "type a number in this row" field this
 * spec calls for, and a real <input> gets native text editing, IME, and screen-reader support for free.
 *
 * Two-way bound to drivingFrequencyProperty: typing updates the model only on commit (blur/Enter);
 * any external change to the Property (slider drag, a harmonic-row click, "Go to Nearest Harmonic")
 * updates the displayed text, unless the field currently has focus (so a live external update never
 * fights a student mid-keystroke).
 */
function createFrequencyEntryField(model: StandingWavesModel): Node {
  const helpText = `Type an exact frequency in Hertz. Values outside ${DRIVING_FREQUENCY_RANGE.min}–${DRIVING_FREQUENCY_RANGE.max} Hz are adjusted to fit.`;

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.size = 5;
  input.style.font = SECONDARY_LABEL_FONT.getFont();
  input.style.textAlign = "right";
  input.setAttribute("aria-label", "Driving Frequency (Hz)");
  input.title = helpText; // mouse-hover hint, in addition to the aria-describedby below

  // --- Known accessibility limitation: keyboard tab order, not screen-reader reading order ---
  //
  // Confirmed by inspecting the installed source (node_modules/scenerystack/src/scenery/js/nodes/DOM.ts,
  // .../display/Display.ts, .../accessibility/pdom/PDOMSiblingStyle.js) and live DOM inspection: a Scenery
  // `DOM` node renders its wrapped element through the DOM-block rendering pipeline
  // (DOM.createDOMDrawable -> DOMBlock), which is a sibling of, but structurally and permanently SEPARATE
  // from, the accessible tree Scenery calls the PDOM ("a11y-pdom-root", appended once to the Display's root
  // element in Display.ts around `this._domElement.appendChild(this._rootPDOMInstance.peer!.primarySibling!)`).
  // `Node.pdomOrder` only reorders elements that are already inside that PDOM subtree - it cannot pull in an
  // element that was never part of it, so it cannot fix this.
  //
  // The only way for a *visible* native <input> to genuinely live inside the PDOM tree (and thus get a
  // correct, position-aware tab/reading order for free) is a `tagName: 'input'` PDOM-only Node - but
  // PDOMSiblingStyle.js shows every PDOM sibling is force-hidden (`font-size: 1px`, `clip: rect(1px,1px,1px,1px)`,
  // plus `opacity: 0.0001` on the PDOM root) by design, since the PDOM is meant to be an invisible shadow of the
  // real SVG/Canvas visuals. Making that usable as a *visible, typeable* field would mean hand-building an
  // entire custom text box (a synced visible Text node mirroring an invisible input's value on every
  // keystroke, a hand-drawn caret/selection, IME passthrough) with no existing precedent anywhere in the
  // installed sun/scenery-phet/scenery source - the only comparable pattern (sun's AccessibleValueHandler,
  // used by sliders) pairs an invisible native input with a fully custom-drawn SVG control for numeric
  // *dragging*, not free-text entry, and isn't reusable here. That rebuild was judged to exceed reasonable
  // effort and to risk a worse, more fragile interaction than the one being fixed here.
  //
  // Fallback taken instead: an explicit positive `tabIndex`. This does NOT fix a screen reader's
  // linear/structural reading order (this field is still, structurally, the last node under #sim, so a
  // screen reader user linearly reading the page still hits it last) - it only affects the browser's
  // Tab-key traversal order, since elements with a positive tabIndex are visited (in ascending order) before
  // any element with the default tabIndex 0. Because every *other* focusable control in this sim keeps its
  // default tabIndex (0), there is no tabIndex value that places this field precisely "between the slider and
  // the String Properties panel" without also assigning explicit tabIndex values to every other control - out
  // of scope for this fix and risky to retrofit sim-wide. tabIndex 1 is the least-disruptive available option:
  // it makes this field deterministically the FIRST Tab stop on the whole page (rather than the buried LAST
  // one, after Reset All and the PhET Menu), which was judged the bigger practical win for keyboard users even
  // though it doesn't preserve exact visual adjacency to the frequency slider.
  input.tabIndex = 1;

  // Visually-hidden description element, referenced via aria-describedby - the standard way to give
  // a native <input> an accessible help text distinct from its accessible name (the aria-label above).
  const description = document.createElement("span");
  description.id = "standing-waves-driving-frequency-help-text";
  description.textContent = helpText;
  description.style.position = "absolute";
  description.style.width = "1px";
  description.style.height = "1px";
  description.style.overflow = "hidden";
  description.style.clip = "rect(0, 0, 0, 0)";
  description.style.whiteSpace = "nowrap";
  input.setAttribute("aria-describedby", description.id);

  const container = document.createElement("span");
  container.style.display = "inline-block";
  container.appendChild(input);
  container.appendChild(description);

  const formatValue = (value: number): string => value.toFixed(2);
  input.value = formatValue(model.drivingFrequencyProperty.value);

  // Keep the displayed text in sync with the model from any source EXCEPT this field's own typing.
  model.drivingFrequencyProperty.link((value) => {
    if (document.activeElement !== input) {
      input.value = formatValue(value);
    }
  });

  // Clamp on commit (blur/Enter) only - never mid-keystroke, so typing "12.5" is never fought.
  const commit = (): void => {
    const parsed = parseFloat(input.value);
    const committed = Number.isFinite(parsed) ? DRIVING_FREQUENCY_RANGE.constrainValue(parsed) : model.drivingFrequencyProperty.value;
    model.drivingFrequencyProperty.value = committed;
    input.value = formatValue(committed);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commit();
      input.blur();
    }
  });

  return new DOM(container, { allowInput: true });
}

export type ControlPanelOptions = {
  timeSpeedProperty: EnumerationProperty<TimeSpeed>;
  showPredictedNodesProperty: BooleanProperty;
  showRulerProperty: BooleanProperty;
  showWaveInfoProperty: BooleanProperty;
  // Total vertical space, in view pixels, that ControlPanel may occupy from its own top (see
  // controlPanel.top in StandingWavesScreenView.ts) down to a safe clearance above the reset button
  // - i.e. the ScreenView's measured, documented "you may use this much height" budget. ControlPanel
  // uses this to size the scrollable region below prominentPanel; it does NOT hardcode a guessed
  // pixel height, since prominentPanel's real height (subtracted below) can change with content.
  availableHeight: number;
};

/**
 * All simulation controls, organized into three tiers per the reviewed interaction design:
 *  1. Prominent: driving frequency/amplitude, far-boundary choice, driving on/off, play/pause+speed.
 *     Always fully visible, unscrolled, pinned at the top of the panel.
 *  2. Secondary ("String Properties"): length/tension/density/damping - visually smaller/quieter,
 *     since students explore these less often than the prominent-tier controls.
 *  3. Opt-in overlays: predicted-nodes overlay, ruler, and a wave-info readout - all default OFF.
 *
 * Tiers 2 and 3, plus the "Predicted Harmonics" panel, are wrapped in a ScrollableVBox rather than
 * stacked directly, because their combined height can exceed the space available above the
 * navigation bar (see availableHeight above, and the layout-bounds/navigation-bar explanation above
 * CONTROL_PANEL_TOP in StandingWavesScreenView.ts) - without scrolling, controls at the bottom of
 * that stack (e.g. Damping, the wave-speed readout) could become unreachable by mouse/touch.
 */
export class ControlPanel extends VBox {
  // Scrolls the secondary/opt-in section back to the top - called from StandingWavesScreenView's
  // reset(), alongside its other view-only UI Properties (showPredictedNodesProperty etc.), so
  // "Reset All" also undoes any scrolling the student did, not just the model/toggle state.
  public readonly resetScroll: () => void;

  public constructor(model: StandingWavesModel, options: ControlPanelOptions) {
    const frequencyControl = new NumberControl("Frequency", model.drivingFrequencyProperty, DRIVING_FREQUENCY_RANGE, {
      delta: 0.1,
      numberDisplayOptions: { decimalPlaces: 1, valuePattern: "{{value}} Hz" },
      titleNodeOptions: { font: PROMINENT_LABEL_FONT },
      layoutFunction: NumberControl.createLayoutFunction4({ verticalSpacing: 4 }),
      accessibleName: "Driving Frequency",
    });

    // Manual Hz entry: the SAME quantity as the slider above (drivingFrequencyProperty), not a
    // separate control - grouped into one row/section with frequencyControl rather than its own
    // panel section, per the reviewed spec.
    const frequencyEntryField = createFrequencyEntryField(model);
    const frequencyRangeCaption = new Text(`${DRIVING_FREQUENCY_RANGE.min}–${DRIVING_FREQUENCY_RANGE.max} Hz`, {
      font: CAPTION_FONT,
      fill: "#707070",
    });
    const frequencyEntryRow = new HBox({
      spacing: 6,
      align: "center",
      children: [new Text("Set exact:", { font: SECONDARY_LABEL_FONT }), frequencyEntryField, new Text("Hz", { font: SECONDARY_LABEL_FONT }), frequencyRangeCaption],
    });
    const frequencyRow = new VBox({
      spacing: 2,
      align: "left",
      children: [frequencyControl, frequencyEntryRow],
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
      children: [frequencyRow, amplitudeControl, boundaryRow, drivingRow, timeControlNode],
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

    // ---- "Predicted Harmonics" panel: classical resonance frequencies for the CURRENT string,
    // clickable to jump the driving frequency there, plus an always-visible nearest-harmonic readout
    // fed by the existing (unbounded) nearestHarmonicProperty/nearestHarmonicFrequencyProperty -
    // never recomputed against the bounded predictedHarmonics() list below, per the physics review
    // finding documented on predictedHarmonics() in the model. Prominent-tier styling, since this is
    // a primary teaching tool for this sim, not a secondary/opt-in readout. ----

    const predictedHarmonicsCaption = new RichText("Classical resonance frequencies for this string. Click one to set the driving frequency there.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: PANEL_WIDTH - 20,
    });

    const noHarmonicsInRangeText = new RichText("No predicted harmonics fit in the current frequency range at these string settings.", {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: PANEL_WIDTH - 20,
    });

    const harmonicRowsBox = new VBox({ spacing: 4, align: "left" });

    const rebuildHarmonicRows = (): void => {
      // Dispose the previous rebuild's row buttons (but not the shared, reused noHarmonicsInRangeText
      // node) before replacing them - this can fire on every Tension/Density drag frame via the
      // Multilink below, so leaving discarded TextPushButtons undisposed would be sloppy even though
      // it isn't a Property-retention leak (each button's own listeners are on its own short-lived
      // Properties, not on anything long-lived - see the qa-tester finding this addresses).
      for (const oldChild of harmonicRowsBox.children) {
        if (oldChild !== noHarmonicsInRangeText) {
          oldChild.dispose();
        }
      }

      const fundamental = model.fundamentalFrequencyProperty.value;
      const boundary = model.farBoundaryTypeProperty.value;
      const harmonics = predictedHarmonics(fundamental, boundary, DRIVING_FREQUENCY_RANGE.max, PREDICTED_HARMONICS_LIST_MAX_COUNT);

      if (harmonics.length === 0) {
        harmonicRowsBox.children = [noHarmonicsInRangeText];
        return;
      }

      harmonicRowsBox.children = harmonics.map(
        ({ n, frequency }) =>
          new TextPushButton(`${ordinal(n)} harmonic: ${frequency.toFixed(2)} Hz`, {
            font: SECONDARY_LABEL_FONT,
            baseColor: "white",
            xMargin: 6,
            yMargin: 3,
            accessibleName: `Set driving frequency to the ${ordinal(n)} harmonic, ${frequency.toFixed(2)} hertz`,
            listener: () => {
              // Defensive only - predictedHarmonics() already only returns in-range frequencies.
              model.drivingFrequencyProperty.value = DRIVING_FREQUENCY_RANGE.constrainValue(frequency);
            },
          }),
      );
    };
    // DerivedProperty dependencies, not user-settable state - a Multilink is the documented pattern
    // for a side effect (rebuilding this Node's children) that doesn't need to be exposed as state.
    Multilink.multilink([model.fundamentalFrequencyProperty, model.farBoundaryTypeProperty], rebuildHarmonicRows);

    const goToNearestHarmonicButton = new TextPushButton("Go to Nearest Harmonic", {
      font: SECONDARY_LABEL_FONT,
      accessibleName: "Go to Nearest Harmonic",
      listener: () => {
        // NOT defensive-only here: nearestHarmonicFrequencyProperty is unbounded and CAN legitimately
        // exceed DRIVING_FREQUENCY_RANGE (e.g. whenever predictedHarmonics() above returns an empty
        // list), and drivingFrequencyProperty asserts its own range - this clamp is required.
        model.drivingFrequencyProperty.value = DRIVING_FREQUENCY_RANGE.constrainValue(model.nearestHarmonicFrequencyProperty.value);
      },
    });

    const NEAREST_HARMONIC_EPSILON = 1e-9;
    const nearestHarmonicIndicatorStringProperty = new DerivedProperty(
      [model.drivingFrequencyProperty, model.nearestHarmonicProperty, model.nearestHarmonicFrequencyProperty],
      (drivingFrequency, n, nearestFrequency) => {
        const offset = drivingFrequency - nearestFrequency;
        if (Math.abs(offset) < NEAREST_HARMONIC_EPSILON) {
          return `Nearest harmonic: ${ordinal(n)} (${nearestFrequency.toFixed(2)} Hz) — you're there`;
        }
        const direction = offset > 0 ? "above" : "below";
        return `Nearest harmonic: ${ordinal(n)} (${nearestFrequency.toFixed(2)} Hz), ${Math.abs(offset).toFixed(2)} Hz ${direction}`;
      },
    );
    // Neutral gray/bold, matching the styling used for the (now-removed) resonance note elsewhere in
    // this file - explicitly NOT a "correct answer" color; this is a plain observation, not a reward.
    // RichText (not Text) so long strings wrap within the panel instead of overflowing it - e.g. at a
    // high harmonic number/offset combination ("Nearest harmonic: 23rd (39.83 Hz), 3.17 Hz above" is
    // wider than PANEL_WIDTH at this font size), matching the lineWrap pattern already used by the
    // other captions in this file (predictedHarmonicsCaption, noHarmonicsInRangeText, below).
    const nearestHarmonicIndicatorText = new RichText(nearestHarmonicIndicatorStringProperty, {
      font: NEAREST_HARMONIC_FONT,
      fill: "#555555",
      lineWrap: PANEL_WIDTH - 20,
    });

    const predictedHarmonicsContent = new VBox({
      spacing: 8,
      align: "left",
      children: [predictedHarmonicsCaption, harmonicRowsBox, goToNearestHarmonicButton, nearestHarmonicIndicatorText],
    });
    const predictedHarmonicsPanel = new AccordionBox(predictedHarmonicsContent, {
      titleNode: new Text("Predicted Harmonics", { font: SECONDARY_TITLE_FONT }),
      expandedDefaultValue: true,
      fill: PROMINENT_PANEL_FILL,
      stroke: PROMINENT_PANEL_STROKE,
      cornerRadius: 8,
      contentXMargin: 10,
      contentYMargin: 8,
      buttonXMargin: 8,
      buttonYMargin: 8,
      minWidth: PANEL_WIDTH,
      titleAlignX: "left",
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
    // Nearest-harmonic info and the old resonance note were removed from here - both are now
    // superseded by the always-visible indicator in the new "Predicted Harmonics" panel below.

    const waveInfoDetails = new VBox({
      spacing: 3,
      align: "left",
      visibleProperty: options.showWaveInfoProperty,
      children: [new Text(waveSpeedInfoStringProperty, { font: CAPTION_FONT }), new Text(wavelengthInfoStringProperty, { font: CAPTION_FONT })],
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

    // The scrollable region gets whatever height remains after prominentPanel (measured from its
    // real, just-built bounds - not a guessed constant) and the gap above it. Clamped at 0 so a
    // pathologically small availableHeight (e.g. a future much taller prominentPanel) degrades to
    // "no visible scroll room" rather than a negative viewportHeight.
    const scrollViewportHeight = Math.max(0, options.availableHeight - prominentPanel.height - CONTROL_PANEL_SPACING);

    const scrollableSection = new ScrollableVBox({
      children: [predictedHarmonicsPanel, stringPropertiesBox, overlaysPanel],
      spacing: CONTROL_PANEL_SPACING,
      viewportHeight: scrollViewportHeight,
    });

    super({
      spacing: CONTROL_PANEL_SPACING,
      align: "left",
      children: [prominentPanel, scrollableSection] as Node[],
    });

    this.resetScroll = () => scrollableSection.resetScroll();
  }
}
