import { Multilink } from "scenerystack/axon";
import type { TReadOnlyProperty } from "scenerystack/axon";
import { Circle, Line, Node, Path } from "scenerystack/scenery";
import { Shape } from "scenerystack/kite";
import { AIR_DENSITY, SPHERICAL_SOURCE_RADIUS, SoundWavesModel, angularFrequency, sphericalAmplitudeAtRadius } from "../model/SoundWavesModel.js";
import { VIEW_WIDTH_METERS, pixelsPerMeterForZoom, sphericalPixelsPerMeterForZoom, type ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. All physics (the pressure values themselves) lives in the model; this file
// only reads model.sampleAt(x).pressure (plane mode) / model.sampleAtRadius(r).pressure (spherical
// mode) at a fine 1D grid (same technique as PressureFieldNode.ts - never a naive 2D pixel evaluation)
// and does simple local-maximum detection on the resulting array to locate individual compressions.
// This is display-time peak-finding on already-model-computed samples, not a new physics computation -
// exactly the same category of work PressureFieldNode.ts and PressureGraphNode.ts already do.

// Sample resolution for peak detection - fine enough to resolve individual compressions even at the
// shortest visible wavelength (FREQUENCY_RANGE.max), coarser than PressureGraphNode's PRESSURE_SAMPLE_COUNT
// (240, a precise continuous curve needs more points than locating a handful of peaks does) - a
// display-resolution choice, not physics. Matches the same order of magnitude as PressureFieldNode's own
// FIELD_SAMPLE_COUNT (100) for the same reasoning.
const TRACKER_SAMPLE_COUNT = 200;

// Generous upper bound on how many compressions can ever be simultaneously visible: the worst case is
// Field zoom's 16m width at the shortest wavelength this sim produces (500 Hz -> ~0.686m at 343 m/s),
// ceil(16 / 0.686) ~= 24 full wavelengths (each contributing exactly one compression peak). 32 leaves
// comfortable headroom without over-allocating.
const MAX_TRACKED_COMPRESSIONS = 32;

// A candidate local maximum must exceed this fraction of the LOCAL pressure-amplitude envelope AT ITS OWN
// SAMPLE POSITION to be marked as a real compression (see findCompressionPositions' thresholdFn parameter
// and the two threshold builders in redraw() below). Filters out two kinds of spurious "local maxima"
// that are NOT real compressions: (a) floating-point-scale noise, and (b) the partially-ramped region
// just behind the wavefront (see SoundWavesModel.ts's rampFactor), where the pressure curve can have
// small wiggles well below full amplitude. 0.35 is comfortably below a fully-ramped peak (which reads as
// 1.0 of the local envelope) but well above the ramp region's typical fractional values.
//
// MUST-FIX (physics review): this fraction must be applied to the LOCAL envelope at each sample's own
// position, never to a single value computed once at the source. In spherical mode the pressure-amplitude
// envelope decays as r0/r (see sphericalAmplitudeAtRadius in SoundWavesModel.ts - the exact same formula
// the model itself uses for sampleAtRadius()). A threshold computed once from the amplitude AT the source
// radius r0 would be far too large for samples at larger r, so every real compression beyond roughly
// r0/PEAK_THRESHOLD_FRACTION would silently fail to clear it and never get marked - exactly backwards
// from this Node's purpose of tracking compressions as they propagate outward. Concretely, with
// SPHERICAL_SOURCE_RADIUS=0.15m and PEAK_THRESHOLD_FRACTION=0.35, a source-anchored threshold would stop
// detecting compressions past r ~= 0.15/0.35 ~= 0.43m - a small fraction of this sim's visible spherical
// radius (up to 8m at Field zoom) - even though real compressions keep occurring at every radius the wave
// has reached. Evaluating the threshold PER SAMPLE at that sample's own radius (see the spherical branch
// of redraw() below) fixes this: the threshold shrinks at exactly the same 1/r rate the real signal does,
// so compressions stay detectable at any radius the wavefront has reached, arbitrarily far from the
// source. Plane mode does NOT need this treatment - amplitude (and therefore peak pressure) is genuinely
// constant in x there (see SoundWavesModel.ts's sampleAt), so a single global threshold is correct as-is.
const PEAK_THRESHOLD_FRACTION = 0.35;

// Ghosted/faint treatment (alpha baked directly into the stroke color; always UNFILLED/stroke-only) -
// deliberately mirrors ParticleFieldNode.ts's own TRACER_RING_STROKE "ghost" convention (a faint, hollow
// ring around the tracer's equilibrium, meant to read as "a ghost of the tracer", not a new object).
// These compression markers exist purely as a bookkeeping overlay - they mark WHERE a compression
// currently is, not a moving particle or a physical object drifting through the field (see the required
// disclaimer in ControlPanel.ts's compressionTrackerCaption). This matters especially in spherical mode,
// where a solid, opaque, moving ring could otherwise be misread as a literal expanding "ripple from a
// stone" - exactly the sim's own plain-language description of the wave itself (see
// PropagationModeControl.ts's caption) - so a solid-filled shape here would send the wrong message. Same
// UI REVIEW FIX: this used to share the same warm-red hue family as PressureGraphNode's/
// PressureFieldNode's compression color (rgb 196,60,40) - user testing found that made the wavefront
// marker too easy to confuse with the red compression shading right behind it. Switched to orange, a hue
// used nowhere else in this sim's pressure/compression color language, so the marker (now labeled "Show
// wavefront" - see ControlPanel.ts) reads as clearly its own thing at a glance, in both modes.
const MARKER_STROKE = "rgba(230, 140, 20, 0.85)";
const MARKER_LINE_WIDTH = 1.5;

// Plane-mode marker: a small downward-pointing, OUTLINE-ONLY (unfilled - see MARKER_STROKE above)
// triangle "flag" sitting just above the particle field, pointing AT the compression's x position - large
// enough to be legible, small enough not to compete visually with the particles themselves, and never
// solid-filled so it reads as a marker, not a physical object.
const TRIANGLE_HALF_WIDTH = 6; // px
const TRIANGLE_HEIGHT = 10; // px

// px above the diagram's vertical center. ParticleFieldNode's particle rows span
// +/-(ROW_COUNT*ROW_SPACING)/2 = +/-(6*20)/2 = +/-60px around that same center (see ParticleFieldNode.ts),
// so this must clear 60px to sit above the topmost particle row rather than overlapping it; 70px leaves a
// small (10px) gap so the marker reads as clearly separate from the particle field, with its tip pointing
// down toward it.
const TRIANGLE_Y_OFFSET = 70;

// UI REVIEW FIX: plane mode's triangle used to be the only visual element for a marker - unlike spherical
// mode's ring, which passes THROUGH the particle field at its radius, the triangle only ever sat above it,
// with no visual tie to which particles below it corresponds to. Adding a dashed vertical guide line
// (spanning the same +/-70px the removed WavefrontMarkerNode's own line used to, comfortably covering the
// particle field's own +/-60px row span with a little margin) directly under each triangle gives plane
// mode the same "a line marks this position across the field" read that spherical's dashed ring already
// has, using the identical dash pattern (RING_LINE_DASH below) for visual consistency between modes.
const MARKER_LINE_HALF_HEIGHT = 70; // px

// Spherical-mode marker: a thin, DASHED ring at the compression's radius - dashed (rather than a solid
// stroke) specifically so a moving ring can never be mistaken for a literal expanding wavefront/ripple;
// combined with MARKER_STROKE's low alpha above, this keeps the marker clearly a bookkeeping overlay
// rather than a new physical object, while still being visually distinct from PressureFieldNode's soft,
// un-dashed alpha-shaded rings (this Node exists specifically to call out DISCRETE compressions, not
// continuous shading). Plane mode's own guide line (MARKER_LINE_HALF_HEIGHT above) reuses this same dash
// pattern/width for consistency between modes.
const RING_LINE_WIDTH = 2.5;
const RING_LINE_DASH = [4, 3];

export type CompressionTrackerNodeOptions = {
  planeOriginX: number;
  planeOriginY: number;
  sphericalOriginX: number;
  sphericalOriginY: number;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  visibleProperty: TReadOnlyProperty<boolean>;
};

/**
 * Opt-in (default hidden, see ControlPanel.ts's "Show compression tracker" checkbox) overlay that marks
 * the CURRENT position of every individual compression (a local pressure maximum) with a small marker,
 * in both propagation modes. Directly complements the draggable ruler and the "How This Works" dialog's
 * equations: seeing each compression marked explicitly makes "the distance between successive
 * compressions is one wavelength" a directly observable fact, not something a student has to infer from
 * particle clustering or the pressure graph's shape alone.
 *
 * Uses a fixed-size POOL of marker Nodes (see MAX_TRACKED_COMPRESSIONS) - sized once at construction,
 * shown/hidden/repositioned every frame - rather than creating/destroying Nodes per frame, matching the
 * performance-conscious pattern already used elsewhere in this sim (e.g. ParticleFieldNode's rebuild-
 * once/redraw-every-frame split).
 *
 * Markers are deliberately GHOSTED (faint, outline-only, dashed in spherical mode - see MARKER_STROKE)
 * rather than solid/opaque, so they read as a bookkeeping overlay rather than a real moving object - see
 * ControlPanel.ts's compressionTrackerCaption for the matching plain-language disclaimer.
 */
export class CompressionTrackerNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly planeOriginX: number;
  private readonly planeOriginY: number;
  private readonly sphericalOriginX: number;
  private readonly sphericalOriginY: number;

  private readonly planeMarkers: Path[] = [];
  private readonly planeMarkerLines: Line[] = [];
  private readonly sphericalMarkers: Circle[] = [];

  private currentMode: "plane" | "spherical" = "plane";

  public constructor(model: SoundWavesModel, options: CompressionTrackerNodeOptions) {
    super({ pickable: false, visibleProperty: options.visibleProperty }); // purely informational overlay - never intercepts input

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;
    this.planeOriginX = options.planeOriginX;
    this.planeOriginY = options.planeOriginY;
    this.sphericalOriginX = options.sphericalOriginX;
    this.sphericalOriginY = options.sphericalOriginY;

    const triangleShape = new Shape().moveTo(-TRIANGLE_HALF_WIDTH, -TRIANGLE_HEIGHT).lineTo(TRIANGLE_HALF_WIDTH, -TRIANGLE_HEIGHT).lineTo(0, 0).close();
    for (let i = 0; i < MAX_TRACKED_COMPRESSIONS; i++) {
      this.planeMarkers.push(new Path(triangleShape, { fill: null, stroke: MARKER_STROKE, lineWidth: MARKER_LINE_WIDTH, visible: false }));
      this.planeMarkerLines.push(new Line(0, -MARKER_LINE_HALF_HEIGHT, 0, MARKER_LINE_HALF_HEIGHT, { stroke: MARKER_STROKE, lineWidth: MARKER_LINE_WIDTH, lineDash: RING_LINE_DASH, visible: false }));
      this.sphericalMarkers.push(new Circle(1, { stroke: MARKER_STROKE, lineWidth: RING_LINE_WIDTH, lineDash: RING_LINE_DASH, fill: null, visible: false, x: this.sphericalOriginX, y: this.sphericalOriginY }));
    }
    this.children = [...this.planeMarkerLines, ...this.planeMarkers, ...this.sphericalMarkers];

    Multilink.multilink([this.viewZoomProperty, model.propagationModeProperty], () => this.onGeometryChange());
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    if (this.visible) {
      this.redraw();
    }
  }

  private onGeometryChange(): void {
    this.currentMode = this.model.propagationModeProperty.value;
    for (const marker of this.planeMarkers) {
      marker.visible = false;
    }
    for (const line of this.planeMarkerLines) {
      line.visible = false;
    }
    for (const marker of this.sphericalMarkers) {
      marker.visible = false;
    }
    this.redraw();
  }

  private redraw(): void {
    const zoom = this.viewZoomProperty.value;
    const speedOfSound = this.model.speedOfSoundProperty.value;
    const omega = angularFrequency(this.model.frequencyProperty.value);

    if (this.currentMode === "plane") {
      const pixelsPerMeter = pixelsPerMeterForZoom(zoom);
      const visibleWidthMeters = VIEW_WIDTH_METERS[zoom];
      // Plane mode: amplitude - and therefore the peak pressure magnitude - is genuinely constant in x
      // (see SoundWavesModel.ts's sampleAt), so ONE global threshold, computed once, is physically
      // correct here. This is the one branch that intentionally keeps a fixed scalar threshold - see
      // PEAK_THRESHOLD_FRACTION's doc comment above for why the spherical branch below cannot do the same.
      const threshold = PEAK_THRESHOLD_FRACTION * AIR_DENSITY * speedOfSound * omega * this.model.amplitudeProperty.value;
      const positions = this.findCompressionPositions(0, visibleWidthMeters, (x) => this.model.sampleAt(x).pressure, () => threshold);

      for (let i = 0; i < this.planeMarkers.length; i++) {
        const marker = this.planeMarkers[i];
        const line = this.planeMarkerLines[i];
        if (i < positions.length) {
          marker.visible = true;
          marker.x = this.planeOriginX + positions[i] * pixelsPerMeter;
          marker.y = this.planeOriginY - TRIANGLE_Y_OFFSET;
          line.visible = true;
          line.x = marker.x;
          line.y = this.planeOriginY;
        } else {
          marker.visible = false;
          line.visible = false;
        }
      }
      for (const marker of this.sphericalMarkers) {
        marker.visible = false;
      }
    } else {
      const pixelsPerMeter = sphericalPixelsPerMeterForZoom(zoom);
      const maxRadiusMeters = VIEW_WIDTH_METERS[zoom] / 2;
      const sphericalAmplitudeAtSource = this.model.sphericalAmplitudeProperty.value;
      // Spherical mode: the pressure-amplitude envelope decays as r0/r (sphericalAmplitudeAtRadius,
      // SoundWavesModel.ts) - the SAME formula and SAME arguments the model itself uses inside
      // sampleAtRadius() - so the threshold is recomputed PER SAMPLE at that sample's own radius r, never
      // once at r0. See PEAK_THRESHOLD_FRACTION's doc comment above for the concrete before/after.
      const positions = this.findCompressionPositions(
        0,
        maxRadiusMeters,
        (r) => this.model.sampleAtRadius(r).pressure,
        (r) => PEAK_THRESHOLD_FRACTION * AIR_DENSITY * speedOfSound * omega * sphericalAmplitudeAtRadius(sphericalAmplitudeAtSource, SPHERICAL_SOURCE_RADIUS, r),
      );

      for (let i = 0; i < this.sphericalMarkers.length; i++) {
        const marker = this.sphericalMarkers[i];
        if (i < positions.length) {
          marker.visible = true;
          marker.radius = Math.max(0.5, positions[i] * pixelsPerMeter);
        } else {
          marker.visible = false;
        }
      }
      for (const marker of this.planeMarkers) {
        marker.visible = false;
      }
      for (const line of this.planeMarkerLines) {
        line.visible = false;
      }
    }
  }

  /** Finds local maxima of sampleFn(position) exceeding thresholdFn(position) - evaluated FRESH at each
   * candidate's own position (see PEAK_THRESHOLD_FRACTION's doc comment above for why this must be
   * per-sample rather than a single fixed number in spherical mode) - over TRACKER_SAMPLE_COUNT evenly
   * spaced samples on [minPosition, maxPosition]. Interior samples only (a maximum right at an endpoint is
   * not compared against a neighbor outside the sampled range, so it is intentionally never reported -
   * this avoids ever reporting a spurious "compression" from a sampling-window edge effect). */
  private findCompressionPositions(minPosition: number, maxPosition: number, sampleFn: (position: number) => number, thresholdFn: (position: number) => number): number[] {
    const step = (maxPosition - minPosition) / (TRACKER_SAMPLE_COUNT - 1);
    const values = new Array<number>(TRACKER_SAMPLE_COUNT);
    for (let i = 0; i < TRACKER_SAMPLE_COUNT; i++) {
      values[i] = sampleFn(minPosition + i * step);
    }

    const positions: number[] = [];
    for (let i = 1; i < TRACKER_SAMPLE_COUNT - 1 && positions.length < MAX_TRACKED_COMPRESSIONS; i++) {
      const position = minPosition + i * step;
      if (values[i] > thresholdFn(position) && values[i] >= values[i - 1] && values[i] >= values[i + 1]) {
        positions.push(position);
      }
    }
    return positions;
  }
}
