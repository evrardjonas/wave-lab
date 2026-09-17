import { Multilink } from "scenerystack/axon";
import type { TReadOnlyProperty } from "scenerystack/axon";
import { Circle, Node, Rectangle } from "scenerystack/scenery";
import { AIR_DENSITY, SPHERICAL_SOURCE_RADIUS, SoundWavesModel, angularFrequency } from "../model/SoundWavesModel.js";
import { VIEW_WIDTH_METERS, pixelsPerMeterForZoom, sphericalPixelsPerMeterForZoom, type ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. All physics (the pressure values themselves) lives in the model - this file
// only reads model.sampleAt(x).pressure (plane mode) / model.sampleAtRadius(r).pressure (spherical
// mode) at a finer grid than ParticleFieldNode's particle columns/rings use, and renders it as
// background shading behind the particle field. NOT a separate physics computation - see
// PressureGraphNode.ts, which plots the SAME underlying model data precisely instead of as shading.

const FIELD_SAMPLE_COUNT = 100; // Finer than the particle field's adaptive column/ring count (which
// tops out at MAX_COLUMN_COUNT=64 / a ring-particle budget of similar order), coarser than
// PressureGraphNode's own PRESSURE_SAMPLE_COUNT (240, a continuous line chart needs more resolution
// than a small number of discrete shaded bands does) - a display-resolution choice, not physics.

const BAND_HEIGHT = 160; // px, plane mode - comfortably spans the particle field's own vertical
// footprint (ROW_COUNT*ROW_SPACING = 6*20 = 120px, see ParticleFieldNode.ts) with margin.

// Desaturated/lightened variant of PressureGraphNode's own COMPRESSION_FILL/RAREFACTION_FILL colors
// (rgb 196,60,40 warm red / 50,100,180 cool blue) - same color family, reused per the reviewed design
// rather than inventing an unrelated palette; only the ALPHA differs between the two rendering tiers
// below and, within a tier, by local pressure magnitude.
const COMPRESSION_RGB = "196, 60, 40";
const RAREFACTION_RGB = "50, 100, 180";

// Two-tier alpha ceilings: the ALWAYS-ON tier stays subtle (per the reviewed design, 0.12-0.15) so it
// reads as ambient background texture, not a competing focal element; the opt-in "Show pressure field"
// checkbox (see ControlPanel.ts's showPressureFieldProperty) raises the SAME bands' ceiling to a more
// saturated, clearly-visible presentation - one tier of geometry, two alpha presentations, rather than
// literally duplicating every band for a difference that is otherwise only alpha.
const SUBTLE_MAX_ALPHA = 0.14;
const PROMINENT_MAX_ALPHA = 0.55;

export type PressureFieldNodeOptions = {
  planeOriginX: number;
  planeOriginY: number;
  sphericalOriginX: number;
  sphericalOriginY: number;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  showPressureFieldProperty: TReadOnlyProperty<boolean>;
};

type Band = { positionMeters: number; shape: Rectangle | Circle };

/**
 * Background pressure-field shading behind the particle field. Two tiers (see SUBTLE_MAX_ALPHA/
 * PROMINENT_MAX_ALPHA above), both derived from the SAME model data ParticleFieldNode and
 * PressureGraphNode already use - never a separate pressure computation of its own.
 *
 * PLANE mode: vertical bands across the visible width, colored per model.sampleAt(x).pressure.
 * SPHERICAL mode: per the design review's performance guidance, this does NOT naively evaluate the
 * pressure formula at every 2D pixel (an O(width*height)-per-frame cost). Instead it computes a single
 * 1D RADIAL profile (model.sampleAtRadius(r).pressure at FIELD_SAMPLE_COUNT radii - the same O(sample-
 * count) cost as the plane-mode case) once per frame, and renders it as CONCENTRIC RING bands (a Circle
 * per radius, stroked with a thick line to read as an annulus) - a radial lookup applied uniformly
 * around each ring, not a full 2D pixel evaluation. This keeps spherical mode's per-frame cost in the
 * same order as plane mode's, at any window size.
 *
 * Rebuilds its band geometry (see rebuild()) whenever the view-owned zoom or the model's
 * propagationModeProperty changes, mirroring ParticleFieldNode's own rebuild-on-change pattern.
 */
export class PressureFieldNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly showPressureFieldProperty: TReadOnlyProperty<boolean>;
  private readonly planeOriginX: number;
  private readonly planeOriginY: number;
  private readonly sphericalOriginX: number;
  private readonly sphericalOriginY: number;

  private currentMode: "plane" | "spherical" = "plane";
  private bands: Band[] = [];

  public constructor(model: SoundWavesModel, options: PressureFieldNodeOptions) {
    super({ pickable: false }); // purely decorative background shading - never intercepts input

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;
    this.showPressureFieldProperty = options.showPressureFieldProperty;
    this.planeOriginX = options.planeOriginX;
    this.planeOriginY = options.planeOriginY;
    this.sphericalOriginX = options.sphericalOriginX;
    this.sphericalOriginY = options.sphericalOriginY;

    Multilink.multilink([this.viewZoomProperty, model.propagationModeProperty, model.speedOfSoundProperty], () => this.rebuild());
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    this.redraw();
  }

  private rebuild(): void {
    this.currentMode = this.model.propagationModeProperty.value;
    const zoom = this.viewZoomProperty.value;
    // Plane mode uses the shared pixelsPerMeterForZoom; spherical mode uses the SAME spherical-only
    // sphericalPixelsPerMeterForZoom that ParticleFieldNode.ts's own spherical branch and
    // CompressionTrackerNode.ts use, so these background rings never drift out of scale with the particle
    // rings they shade behind. See sphericalPixelsPerMeterForZoom's doc comment in ParticleFieldNode.ts.
    const pixelsPerMeter = this.currentMode === "plane" ? pixelsPerMeterForZoom(zoom) : sphericalPixelsPerMeterForZoom(zoom);
    this.bands = [];

    if (this.currentMode === "plane") {
      const visibleWidthMeters = VIEW_WIDTH_METERS[zoom];
      const bandWidthMeters = visibleWidthMeters / FIELD_SAMPLE_COUNT;
      const bandWidthPx = bandWidthMeters * pixelsPerMeter;
      for (let i = 0; i < FIELD_SAMPLE_COUNT; i++) {
        const positionMeters = (i + 0.5) * bandWidthMeters;
        const xView = this.planeOriginX + positionMeters * pixelsPerMeter;
        const rect = new Rectangle(xView - bandWidthPx / 2, this.planeOriginY - BAND_HEIGHT / 2, bandWidthPx, BAND_HEIGHT);
        this.bands.push({ positionMeters, shape: rect });
      }
    } else {
      const maxRadiusMeters = VIEW_WIDTH_METERS[zoom] / 2;
      const ringWidthMeters = (maxRadiusMeters - SPHERICAL_SOURCE_RADIUS) / FIELD_SAMPLE_COUNT;
      const ringWidthPx = Math.max(1, ringWidthMeters * pixelsPerMeter);
      for (let i = 0; i < FIELD_SAMPLE_COUNT; i++) {
        const positionMeters = SPHERICAL_SOURCE_RADIUS + (i + 0.5) * ringWidthMeters;
        const radiusPx = positionMeters * pixelsPerMeter;
        const ring = new Circle(radiusPx, {
          lineWidth: ringWidthPx,
          x: this.sphericalOriginX,
          y: this.sphericalOriginY,
        });
        this.bands.push({ positionMeters, shape: ring });
      }
    }

    this.children = this.bands.map((band) => band.shape);
    this.redraw();
  }

  private redraw(): void {
    const maxAlpha = this.showPressureFieldProperty.value ? PROMINENT_MAX_ALPHA : SUBTLE_MAX_ALPHA;
    const peakPressure = this.estimatePeakPressure();

    for (const band of this.bands) {
      const sample = this.currentMode === "plane" ? this.model.sampleAt(band.positionMeters) : this.model.sampleAtRadius(band.positionMeters);
      const magnitude = peakPressure > 0 ? Math.min(1, Math.abs(sample.pressure) / peakPressure) : 0;
      const alpha = maxAlpha * magnitude;
      const rgb = sample.pressure >= 0 ? COMPRESSION_RGB : RAREFACTION_RGB;
      const color = `rgba(${rgb}, ${alpha})`;

      if (this.currentMode === "plane") {
        (band.shape as Rectangle).fill = color;
      } else {
        (band.shape as Circle).stroke = color;
      }
    }
  }

  /** Upper bound on |pressure| across the domain at the CURRENT frequency/amplitude, used only to
   * normalize shading intensity to 0..1 - mirrors PressureGraphNode.ts's own axis-scaling estimate
   * (AIR_DENSITY * c * omega * amplitude), evaluated with whichever amplitude applies to the active
   * mode (the plane wave's constant amplitude, or the spherical wave's amplitude AT the source radius -
   * its largest value anywhere in the field, since amplitude only decreases with r from there). */
  private estimatePeakPressure(): number {
    const speedOfSound = this.model.speedOfSoundProperty.value;
    const omega = angularFrequency(this.model.frequencyProperty.value);
    const amplitude = this.currentMode === "plane" ? this.model.amplitudeProperty.value : this.model.sphericalAmplitudeProperty.value;
    return AIR_DENSITY * speedOfSound * omega * amplitude;
  }
}
