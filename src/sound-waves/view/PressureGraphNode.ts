import type { TReadOnlyProperty } from "scenerystack/axon";
import { Multilink } from "scenerystack/axon";
import { Range, Vector2 } from "scenerystack/dot";
import { Orientation } from "scenerystack/phet-core";
import { Line, Node, Path, RichText, Text } from "scenerystack/scenery";
import { Shape } from "scenerystack/kite";
import { PhetFont } from "scenerystack/scenery-phet";
import { AreaPlot, AxisLine, ChartRectangle, ChartTransform, type AreaChartDataSet } from "scenerystack/bamboo";
import { AIR_DENSITY, DOMAIN_LENGTH, PRESSURE_SAMPLE_COUNT, PROBE_POSITION_METERS, SoundWavesModel, angularFrequency } from "../model/SoundWavesModel.js";
import { FIELD_PIXEL_WIDTH, VIEW_WIDTH_METERS, type ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. All physics (the pressure values themselves) lives in the model; this file
// samples model.sampleAt(x).pressure at a cached grid of x positions (see rebuildForZoom()) and maps it
// into a bamboo chart.
//
// ZOOM-AWARE (fixed bug - see the class doc below): this graph now shares ParticleFieldNode's SAME fixed
// on-screen pixel width (FIELD_PIXEL_WIDTH) and the SAME per-zoom visible width in meters
// (VIEW_WIDTH_METERS), and rebuilds its chart's modelXRange and sample grid whenever viewZoomProperty
// changes - see rebuildForZoom(). The view only shows this graph while propagationModeProperty is 'plane'
// (see SoundWavesScreenView.ts), so it never claims to represent spherical mode's field.

const VIEW_HEIGHT = 130; // px
const VIEW_WIDTH = FIELD_PIXEL_WIDTH; // SAME fixed on-screen pixel width as ParticleFieldNode's field,
// at every zoom level - correct BY CONSTRUCTION (pixelsPerMeterForZoom(zoom) * VIEW_WIDTH_METERS[zoom] ===
// FIELD_PIXEL_WIDTH for every zoom, see ParticleFieldNode.ts), not merely numerically coincidental with the
// OLD DOMAIN_LENGTH*pixelsPerMeterForZoom("local") expression this replaces (which was only ever correct
// for "local" and would have been wrong the instant this graph needed to represent any other zoom).

const COMPRESSION_FILL = "rgba(196, 60, 40, 0.55)"; // soft red - positive pressure (compression)
const RAREFACTION_FILL = "rgba(50, 100, 180, 0.5)"; // soft blue - negative pressure (rarefaction)

const AXIS_LABEL_FONT = new PhetFont(11);
const ZERO_LABEL_FONT = new PhetFont({ size: 9, style: "italic" });
const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" });

// Padding factor applied to the analytic peak pressure magnitude when sizing the y-axis, so the curve
// never clips against the top/bottom of the chart even at the exact current frequency/amplitude.
const AXIS_PADDING_FACTOR = 1.15;

// ---- Fixed pressure probe "boat" (pairs with ParticleFieldNode.ts's probe marker - see
// PROBE_POSITION_METERS's own doc comment in SoundWavesModel.ts). The ONLY Node anywhere in this sim whose
// vertical position tracks pressure at a single fixed point - ParticleFieldNode's own probe marker is
// deliberately static in y (see that file's V4 doc-comment paragraph); all of that pairing's vertical-motion
// cue lives here instead. ----

// Small schematic hull silhouette (Shape+Path, matching this sim's established schematic-primitives
// convention, e.g. LoudspeakerNode.ts's simple rectangle+circle) plus a short mast line - not an
// illustration. Local coordinates: the hull's BOTTOM edge (its keel) sits at local y=0, so Node.bottom
// aligns exactly with "the point that represents the pressure value" (see redraw()'s boat.bottom = ...
// below) - the mast extends upward (negative y) from the hull and never affects that anchor.
const BOAT_HULL_HALF_WIDTH = 8; // px
const BOAT_HULL_HEIGHT = 6; // px
const BOAT_MAST_HEIGHT = 9; // px
const BOAT_HULL_FILL = "#8a5a2b"; // warm brown - a hue used nowhere else in this sim (distinct from the
// compression/rarefaction reds/blues and from ParticleFieldNode's teal probe marker)
const BOAT_HULL_STROKE = "#4a3018";

// Faint, dashed, matching (by intentional color choice, not by import - see ParticleFieldNode.ts's own
// PROBE_GUIDE_STROKE, which this duplicates the exact value of) teal, so a student can visually trace one
// straight vertical line from ParticleFieldNode's probe marker, through both files' guide lines, down to
// this boat - the two guide lines share the SAME physical x (PROBE_POSITION_METERS) and, since both diagrams
// share x0/DIAGRAM_ORIGIN_X and the same zoom-driven pixels-per-meter, the SAME screen x too.
const BOAT_GUIDE_STROKE = "rgba(31, 111, 111, 0.35)";
const BOAT_GUIDE_LINE_DASH = [3, 3];

export type PressureGraphNodeOptions = {
  x0: number; // view x (px) of the domain origin, x=0 - MUST match ParticleFieldNode's x0
  top: number; // view y (px) of the chart's top edge
  visibleProperty: TReadOnlyProperty<boolean>;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
};

/**
 * Opt-in (default hidden) pressure-vs-position graph, sharing the SAME horizontal x-axis/scale as
 * ParticleFieldNode and positioned directly below it, so a student can visually drop a line from a
 * compressed particle cluster straight down to the corresponding graph peak.
 *
 * PHASE CORRECTNESS (the highest-risk item in this feature, see SoundWavesModel.ts's class doc and
 * test suite): graph peaks must align with the particle view's densest/sparsest clusters - i.e. with
 * DISPLACEMENT ZERO-CROSSINGS, not displacement peaks. This Node does no phase math of its own; it plots
 * model.sampleAt(x).pressure directly, so correctness here is inherited entirely from the model's
 * retarded-phase formulas (independently unit-tested in SoundWavesModel.test.ts). Flagged for visual
 * re-verification since this Node's rendering itself cannot be checked without a browser.
 *
 * BUG FIX (this revision): this graph used to be hardcoded to the "Local" domain regardless of the live
 * zoom control - VIEW_WIDTH was a constant computed only from DOMAIN_LENGTH, modelXRange was fixed at
 * construction to [0, DOMAIN_LENGTH], and redraw() plotted the model's own FIXED plane-wave sample cache
 * (samplePositions/pressures, always [0, DOMAIN_LENGTH] regardless of zoom - see recomputeSamples()'s doc
 * comment in SoundWavesModel.ts). In Field zoom that left the particle field above showing 16 m of domain
 * while this graph kept showing only the fixed 4 m Local domain - visually misaligned with what the
 * particles/compressions above were actually doing.
 *
 * FIX: this Node now takes a required viewZoomProperty (wired from SoundWavesScreenView.ts's shared
 * viewZoomProperty, the same one ParticleFieldNode/PressureFieldNode/LoudspeakerNode/PointSourceNode already
 * use). rebuildForZoom() - a Multilink-driven rebuild/redraw split mirroring ParticleFieldNode.ts's own
 * rebuild()/redraw() convention - runs on every zoom change and: (a) calls
 * chartTransform.setModelXRange(new Range(0, VIEW_WIDTH_METERS[zoom])) (a real bamboo ChartTransform API,
 * see node_modules/scenerystack/src/bamboo/js/ChartTransform.ts) so the chart's horizontal scale matches the
 * CURRENT zoom, and (b) recomputes a cached array of sample x-positions spanning [0, VIEW_WIDTH_METERS[zoom]]
 * (see SAMPLE_DENSITY_PER_METER's derivation below) - NOT recomputed every frame, only on zoom change.
 * redraw() (still called every frame from step(), unchanged trigger) then samples model.sampleAt(x).pressure
 * FRESH at each cached position every frame - a genuine continuous re-sample of the model's general
 * sampleAt(x) API, not a stretch/rescale of the old fixed-Local curve data.
 *
 * V4 addition - fixed pressure probe "boat": see the BOAT_* constants' own comments above and redraw()'s
 * boat-positioning code below.
 */
export class PressureGraphNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly chartTransform: ChartTransform;
  private readonly compressionPlot: AreaPlot;
  private readonly rarefactionPlot: AreaPlot;
  private readonly zeroLabel: Text;
  private readonly boat: Node;
  private readonly boatGuideLine: Line;

  // Cached sample x-positions (m), spanning [0, VIEW_WIDTH_METERS[current zoom]] - rebuilt only on zoom
  // change (see rebuildForZoom()), re-sampled fresh via model.sampleAt(x) every frame in redraw().
  private cachedSamplePositions: Float64Array = new Float64Array(0);

  public constructor(model: SoundWavesModel, options: PressureGraphNodeOptions) {
    super({ visibleProperty: options.visibleProperty, x: options.x0, y: options.top });

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;

    this.chartTransform = new ChartTransform({
      viewWidth: VIEW_WIDTH,
      viewHeight: VIEW_HEIGHT,
      modelXRange: new Range(0, VIEW_WIDTH_METERS[this.viewZoomProperty.value]),
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

    this.zeroLabel = new Text("0 (atmospheric pressure)", {
      font: ZERO_LABEL_FONT,
      fill: "#707070",
      left: 6,
      centerY: this.chartTransform.modelToViewY(0) - 8,
    });

    const caption = new RichText(
      "This graph shows PRESSURE varying with position along the same axis as the particles above - it is NOT a picture of vertical air motion. " +
        "It is the same pressure data as the background shading on the particle field above, shown precisely. " +
        "The small boat marks a fixed measurement point; its height shows the pressure there.",
      {
        font: CAPTION_FONT,
        fill: "#707070",
        lineWrap: VIEW_WIDTH,
        top: VIEW_HEIGHT + 6,
      },
    );

    // ---- Fixed pressure probe "boat" - see the BOAT_* constants' own comments above ----
    this.boatGuideLine = new Line(0, 0, 0, VIEW_HEIGHT, {
      stroke: BOAT_GUIDE_STROKE,
      lineWidth: 1,
      lineDash: BOAT_GUIDE_LINE_DASH,
    });

    const hullShape = new Shape()
      .moveTo(-BOAT_HULL_HALF_WIDTH, 0)
      .lineTo(BOAT_HULL_HALF_WIDTH, 0)
      .lineTo(BOAT_HULL_HALF_WIDTH - 2, -BOAT_HULL_HEIGHT)
      .lineTo(-BOAT_HULL_HALF_WIDTH + 2, -BOAT_HULL_HEIGHT)
      .close();
    const hull = new Path(hullShape, { fill: BOAT_HULL_FILL, stroke: BOAT_HULL_STROKE, lineWidth: 1 });
    const mast = new Line(0, -BOAT_HULL_HEIGHT, 0, -BOAT_HULL_HEIGHT - BOAT_MAST_HEIGHT, { stroke: BOAT_HULL_STROKE, lineWidth: 1.5 });
    // Wrapper so hull+mast move as one unit; the wrapper's local bounds.maxY is the hull's own y=0 keel
    // (the mast only extends upward, never below the hull), so `this.boat.bottom = ...` in redraw() below
    // anchors exactly at the hull's keel - the "point that represents the pressure value" this file's
    // caption refers to.
    this.boat = new Node({ children: [mast, hull] });

    this.children = [chartRectangle, this.compressionPlot, this.rarefactionPlot, zeroLine, this.boatGuideLine, this.boat, yAxisLabel, this.zeroLabel, caption];

    // BUG FIX: this used to scale the axis to the CURRENT amplitudeProperty.value, which makes the axis
    // grow/shrink in exact proportion to amplitude - the plotted curve (itself proportional to amplitude)
    // then always fills the SAME fraction of the chart no matter what amplitude is set to, so raising or
    // lowering the Amplitude control produced a visually IDENTICAL graph (the amplitude term cancels
    // out of peakPressure/axisBound algebraically). Anchoring instead to the amplitude control's own
    // current MAX (amplitudeProperty.rangeProperty, the safety-bound Range already used to size the
    // slider itself - see SoundWavesModel.ts's computeAmplitudeRange()) gives a FIXED reference scale, so
    // the live amplitude value now visibly grows/shrinks the curve toward/away from that fixed ceiling,
    // the same way PressureFieldNode.ts's estimatePeakPressure() is fixed alongside this one.
    //
    // NOTE (physics-reviewed): in PLANE mode this ceiling is, by construction, an exact CONSTANT
    // independent of frequency - computeAmplitudeRange()'s max is AMPLITUDE_SAFETY_FRACTION*c/omega, so
    // the omega factor here cancels it exactly, leaving AMPLITUDE_SAFETY_FRACTION*AIR_DENSITY*c^2. The
    // Range object itself is frequency-dependent (it's what makes the Amplitude slider's max shrink as
    // frequency rises), but the resulting PEAK PRESSURE is not - don't mistake that for a bug if you
    // notice dragging Frequency alone never moves this axis. (Spherical mode's equivalent in
    // PressureFieldNode.ts does NOT have this cancellation - its ceiling genuinely varies with frequency,
    // per strictRadialAmplitudeBound's own doc comment.)
    const updateAxisRange = (): void => {
      const speedOfSound = model.speedOfSoundProperty.value;
      const maxAmplitude = model.amplitudeProperty.rangeProperty.value.max;
      const peakPressure = AIR_DENSITY * speedOfSound * angularFrequency(model.frequencyProperty.value) * maxAmplitude;
      const bound = Math.max(1e-6, peakPressure * AXIS_PADDING_FACTOR);
      this.chartTransform.setModelYRange(new Range(-bound, bound));
      this.zeroLabel.centerY = this.chartTransform.modelToViewY(0) - 8;
    };
    Multilink.multilink([model.frequencyProperty, model.amplitudeProperty.rangeProperty, model.speedOfSoundProperty], updateAxisRange);

    // Zoom-driven rebuild (modelXRange + cached sample grid + the boat/guide line's fixed x) - separate from
    // updateAxisRange above (the Y range is about pressure amplitude, not zoom) and from the per-frame
    // redraw() below, mirroring ParticleFieldNode.ts's own rebuild-on-change/redraw-every-frame split. Fires
    // immediately on construction (standard Multilink behavior, same as every other rebuild-Multilink in
    // this codebase), which populates cachedSamplePositions and calls redraw() - no separate initial
    // redraw() call is needed here.
    Multilink.multilink([this.viewZoomProperty], () => this.rebuildForZoom());
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    if (this.visible) {
      this.redraw();
    }
  }

  /**
   * Rebuilds everything that depends on the CURRENT zoom - the chart's modelXRange, the cached sample-
   * position grid, and the boat/guide-line's fixed screen x - whenever viewZoomProperty changes. NOT called
   * every frame; see redraw() for the per-frame work.
   *
   * SAMPLE COUNT: preserves the SAME samples-per-meter density at every zoom as the original Local-only
   * implementation (PRESSURE_SAMPLE_COUNT=240 samples over DOMAIN_LENGTH=4m, i.e. 60 samples/m) by scaling
   * linearly with the visible width: sampleCount = round(240 * (VIEW_WIDTH_METERS[zoom] / DOMAIN_LENGTH)) -
   * 240 at Local (ratio 1), 960 at Field (ratio 4). At 60 samples/m, this sim's shortest wavelength
   * (c/FREQUENCY_RANGE.max) gets ~60*(c/FREQUENCY_RANGE.max) samples regardless of zoom - comfortably over
   * the >=30-samples-per-wavelength continuous-sampling floor already established by PressureFieldNode.ts's
   * own sampling-density reasoning (see that file's FIELD_SAMPLE_COUNT comment).
   */
  private rebuildForZoom(): void {
    const zoom = this.viewZoomProperty.value;
    const widthMeters = VIEW_WIDTH_METERS[zoom];
    this.chartTransform.setModelXRange(new Range(0, widthMeters));

    const sampleCount = Math.round(PRESSURE_SAMPLE_COUNT * (widthMeters / DOMAIN_LENGTH));
    this.cachedSamplePositions = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      this.cachedSamplePositions[i] = (i / (sampleCount - 1)) * widthMeters;
    }

    // Boat/guide-line x: fixed at the probe's PHYSICAL position, re-projected through the NEW chart
    // transform - its PIXEL x moves on a zoom change, its PHYSICAL x (PROBE_POSITION_METERS) never does.
    // Never touched again until the next zoom change (redraw() below only ever updates the boat's Y).
    const probeViewX = this.chartTransform.modelToViewX(PROBE_POSITION_METERS);
    this.boat.x = probeViewX;
    this.boatGuideLine.setLine(probeViewX, 0, probeViewX, VIEW_HEIGHT);

    this.redraw();
  }

  private redraw(): void {
    const positions = this.cachedSamplePositions;
    const compressionData: AreaChartDataSet = new Array(positions.length);
    const rarefactionData: AreaChartDataSet = new Array(positions.length);

    for (let i = 0; i < positions.length; i++) {
      const pressure = this.model.sampleAt(positions[i]).pressure;
      const point = new Vector2(positions[i], pressure);
      compressionData[i] = pressure >= 0 ? point : null;
      rarefactionData[i] = pressure <= 0 ? point : null;
    }

    this.compressionPlot.setDataSet(compressionData);
    this.rarefactionPlot.setDataSet(rarefactionData);

    // Boat Y: the ONLY vertical motion associated with the probe anywhere in this sim (see the class doc's
    // V4 paragraph) - the hull's bottom/keel (local y=0, see the constructor's hull-shape comment) is
    // positioned exactly at the pressure value, so it reads as "floating at this height".
    const probePressure = this.model.sampleAt(PROBE_POSITION_METERS).pressure;
    this.boat.bottom = this.chartTransform.modelToViewY(probePressure);
  }
}
