import type { TReadOnlyProperty } from "scenerystack/axon";
import { Multilink } from "scenerystack/axon";
import { Range, Vector2 } from "scenerystack/dot";
import { Orientation } from "scenerystack/phet-core";
import { Node, RichText, Text } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { AreaPlot, AxisLine, ChartRectangle, ChartTransform, type AreaChartDataSet } from "scenerystack/bamboo";
import { AIR_DENSITY, DOMAIN_LENGTH, SoundWavesModel, angularFrequency } from "../model/SoundWavesModel.js";
import { pixelsPerMeterForZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. All physics (the pressure values themselves) lives in the model; this file
// only maps model.samplePositions/model.pressures into a bamboo chart.
//
// UNCHANGED IN CORE BEHAVIOR (per design review) even though ParticleFieldNode.ts now supports zoom and
// spherical mode: this graph always reads the model's PLANE-wave sample cache (samplePositions/
// displacements/pressures, which recomputeSamples() in SoundWavesModel.ts always keeps as the plane
// wave over [0, DOMAIN_LENGTH]) at a FIXED "Local" scale, regardless of the live zoom control. The view
// only shows this graph while propagationModeProperty is 'plane' (see SoundWavesScreenView.ts) so it
// never claims to represent spherical mode's field.

const VIEW_HEIGHT = 130; // px
const VIEW_WIDTH = DOMAIN_LENGTH * pixelsPerMeterForZoom("local"); // SAME horizontal scale/origin as the particle field above it, at Local zoom's scale (150 px/m, unchanged from before zoom existed)

const COMPRESSION_FILL = "rgba(196, 60, 40, 0.55)"; // soft red - positive pressure (compression)
const RAREFACTION_FILL = "rgba(50, 100, 180, 0.5)"; // soft blue - negative pressure (rarefaction)

const AXIS_LABEL_FONT = new PhetFont(11);
const ZERO_LABEL_FONT = new PhetFont({ size: 9, style: "italic" });
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });

// Padding factor applied to the analytic peak pressure magnitude when sizing the y-axis, so the curve
// never clips against the top/bottom of the chart even at the exact current frequency/amplitude.
const AXIS_PADDING_FACTOR = 1.15;

export type PressureGraphNodeOptions = {
  x0: number; // view x (px) of the domain origin, x=0 - MUST match ParticleFieldNode's x0
  top: number; // view y (px) of the chart's top edge
  visibleProperty: TReadOnlyProperty<boolean>;
};

/**
 * Opt-in (default hidden) pressure-vs-position graph, sharing the SAME horizontal x-axis/scale as
 * ParticleFieldNode and positioned directly below it, so a student can visually drop a line from a
 * compressed particle cluster straight down to the corresponding graph peak.
 *
 * PHASE CORRECTNESS (the highest-risk item in this feature, see SoundWavesModel.ts's class doc and
 * test suite): graph peaks must align with the particle view's densest/sparsest clusters - i.e. with
 * DISPLACEMENT ZERO-CROSSINGS, not displacement peaks. This Node does no phase math of its own; it
 * plots model.pressures directly, so correctness here is inherited entirely from the model's
 * retarded-phase formulas (independently unit-tested in SoundWavesModel.test.ts). Flagged for visual
 * re-verification since this Node's rendering itself cannot be checked without a browser.
 */
export class PressureGraphNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly chartTransform: ChartTransform;
  private readonly compressionPlot: AreaPlot;
  private readonly rarefactionPlot: AreaPlot;

  public constructor(model: SoundWavesModel, options: PressureGraphNodeOptions) {
    super({ visibleProperty: options.visibleProperty, x: options.x0, y: options.top });

    this.model = model;

    this.chartTransform = new ChartTransform({
      viewWidth: VIEW_WIDTH,
      viewHeight: VIEW_HEIGHT,
      modelXRange: new Range(0, DOMAIN_LENGTH),
      modelYRange: new Range(-1, 1), // placeholder - set for real by updateAxisRange() below
    });

    const chartRectangle = new ChartRectangle(this.chartTransform, {
      fill: "white",
      stroke: "#999999",
      lineWidth: 1,
    });

    const zeroLine = new AxisLine(this.chartTransform, Orientation.HORIZONTAL, {
      value: 0,
      stroke: "#777777",
      lineWidth: 1,
      lineDash: [4, 3],
    });

    this.compressionPlot = new AreaPlot(this.chartTransform, [], { fill: COMPRESSION_FILL });
    this.rarefactionPlot = new AreaPlot(this.chartTransform, [], { fill: RAREFACTION_FILL });

    const yAxisLabel = new Text("Pressure variation (Pa)", {
      font: AXIS_LABEL_FONT,
      rotation: -Math.PI / 2,
      right: -8,
      centerY: VIEW_HEIGHT / 2,
    });

    const zeroLabel = new Text("0 (atmospheric pressure)", {
      font: ZERO_LABEL_FONT,
      fill: "#707070",
      left: 6,
      centerY: this.chartTransform.modelToViewY(0) - 8,
    });

    const caption = new RichText(
      "This graph shows PRESSURE varying with position along the same axis as the particles above - it is NOT a picture of vertical air motion. " +
        "It is the same pressure data as the background shading on the particle field above, shown precisely.",
      {
        font: CAPTION_FONT,
        fill: "#707070",
        lineWrap: VIEW_WIDTH,
        top: VIEW_HEIGHT + 6,
      },
    );

    this.children = [chartRectangle, this.compressionPlot, this.rarefactionPlot, zeroLine, yAxisLabel, zeroLabel, caption];

    const updateAxisRange = (): void => {
      const speedOfSound = model.speedOfSoundProperty.value;
      const peakPressure = AIR_DENSITY * speedOfSound * angularFrequency(model.frequencyProperty.value) * model.amplitudeProperty.value;
      const bound = Math.max(1e-6, peakPressure * AXIS_PADDING_FACTOR);
      this.chartTransform.setModelYRange(new Range(-bound, bound));
      zeroLabel.centerY = this.chartTransform.modelToViewY(0) - 8;
    };
    Multilink.multilink([model.frequencyProperty, model.amplitudeProperty, model.speedOfSoundProperty], updateAxisRange);

    this.redraw();
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    if (this.visible) {
      this.redraw();
    }
  }

  private redraw(): void {
    const positions = this.model.samplePositions;
    const pressures = this.model.pressures;
    const compressionData: AreaChartDataSet = new Array(positions.length);
    const rarefactionData: AreaChartDataSet = new Array(positions.length);

    for (let i = 0; i < positions.length; i++) {
      const point = new Vector2(positions[i], pressures[i]);
      compressionData[i] = pressures[i] >= 0 ? point : null;
      rarefactionData[i] = pressures[i] <= 0 ? point : null;
    }

    this.compressionPlot.setDataSet(compressionData);
    this.rarefactionPlot.setDataSet(rarefactionData);
  }
}
