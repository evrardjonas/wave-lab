import { Multilink } from "scenerystack/axon";
import type { TReadOnlyProperty } from "scenerystack/axon";
import { Circle, Node, Rectangle } from "scenerystack/scenery";
import { AIR_DENSITY, SPHERICAL_SOURCE_RADIUS, SoundWavesModel, angularFrequency } from "../model/SoundWavesModel.js";
import { VIEW_WIDTH_METERS, pixelsPerMeterForZoom, sphericalPixelsPerMeterForZoom, type RepresentationMode, type ViewZoom } from "./ParticleFieldNode.js";

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

// ---- Pedagogical tier (V3 addition - bold, discrete-band rendering for representationModeProperty ----
// ==='pedagogical'). Read ONLY inside redraw() below, never inside rebuild()/the geometry Multilink -
// switching representationModeProperty must never rebuild band geometry, only repaint the SAME bands, so
// the mode switch is guaranteed jump-free (see RepresentationMode's own doc comment in
// ParticleFieldNode.ts).

// Number of discrete magnitude tiers (design review: "4-5 magnitude tiers"). Chosen at the top of that
// range (5) so successive tiers are still individually distinguishable at a glance without being so fine-
// grained they blur back into looking like a smooth ramp (defeating the point of a discrete/bold tier
// scheme).
const PEDAGOGICAL_TIER_COUNT = 5;

// Alpha ceiling per tier, monotonically increasing - tier 0 is ALSO the legibility floor's alpha (see
// redrawPedagogical()'s magnitude<=0 branch): any point the wavefront has reached, however small its
// magnitude, lands in tier 0 at minimum (the discretization itself IS the floor - there is no separate
// clamp needed, since tier 0's own alpha is already comfortably nonzero, unlike the Real tier's alpha,
// which ramps linearly all the way down to 0 and can fade into invisibility far from the source).
const PEDAGOGICAL_TIER_ALPHAS = [0.22, 0.38, 0.54, 0.7, 0.88];

// Lightness-toward-white mix per tier (0 = full base saturation, 1 = fully white) - the SECOND, independent
// channel (alongside alpha) encoding magnitude, so tiers stay distinguishable even under a color-vision
// deficiency that makes the alpha/saturation difference hard to see alone (dual-channel, colorblind-safe
// encoding, per the design review). Decreasing alongside alpha's increase: higher-magnitude tiers are both
// MORE opaque AND MORE saturated/darker.
const PEDAGOGICAL_TIER_LIGHTEN = [0.5, 0.35, 0.2, 0.08, 0];

// Fraction of each tier's band width, at its END, over which a smoothstep-eased blend toward the NEXT
// tier's alpha/lightness happens - keeps most of each band a FLAT, discrete color (so it still reads as
// texture/tiers, per the design review, not a smooth ramp) while avoiding a razor-hard seam at every
// internal tier boundary ("a small soft transition between tiers ... not a hard cutoff"). Deliberately NOT
// applied to the wavefront boundary itself (see redrawPedagogical()'s magnitude<=0 branch) - that edge is a
// REAL physical boundary (already present for free in the retarded-time computation) and is kept as sharp
// as possible instead, per the design review's explicit ask.
const PEDAGOGICAL_BAND_BLEND_FRACTION = 0.3;

/** Blends an "r, g, b" string toward white by `amount` (0=unchanged, 1=fully white) - the Pedagogical
 * tier's lightness channel, see PEDAGOGICAL_TIER_LIGHTEN's own comment. */
function lightenRgb(rgb: string, amount: number): string {
  const [r, g, b] = rgb.split(",").map((component) => Number(component.trim()));
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

/** Maps a continuous magnitude (0..1) and a base "r, g, b" hue-family string to a discrete-tier Pedagogical
 * rgba() color string - see PEDAGOGICAL_TIER_COUNT/PEDAGOGICAL_TIER_ALPHAS/PEDAGOGICAL_TIER_LIGHTEN/
 * PEDAGOGICAL_BAND_BLEND_FRACTION above for the full reasoning. Only ever called with magnitude > 0 - the
 * magnitude<=0 (not-yet-arrived) case is handled entirely separately in redrawPedagogical(), never via this
 * function, so the wavefront's own boundary stays a hard edge rather than tier 0's soft internal blend. */
function pedagogicalTierColor(magnitude: number, baseRgb: string): string {
  const clamped = Math.min(1, Math.max(0, magnitude));
  const scaled = clamped * PEDAGOGICAL_TIER_COUNT;
  const tierIndex = Math.min(PEDAGOGICAL_TIER_COUNT - 1, Math.floor(scaled));
  const nextTierIndex = Math.min(PEDAGOGICAL_TIER_COUNT - 1, tierIndex + 1);
  const withinTier = scaled - tierIndex; // 0..1 position within this tier's own band

  let ease = 0;
  if (withinTier > 1 - PEDAGOGICAL_BAND_BLEND_FRACTION) {
    const t = (withinTier - (1 - PEDAGOGICAL_BAND_BLEND_FRACTION)) / PEDAGOGICAL_BAND_BLEND_FRACTION;
    ease = t * t * (3 - 2 * t); // smoothstep
  }

  const alpha = PEDAGOGICAL_TIER_ALPHAS[tierIndex] + ease * (PEDAGOGICAL_TIER_ALPHAS[nextTierIndex] - PEDAGOGICAL_TIER_ALPHAS[tierIndex]);
  const lighten = PEDAGOGICAL_TIER_LIGHTEN[tierIndex] + ease * (PEDAGOGICAL_TIER_LIGHTEN[nextTierIndex] - PEDAGOGICAL_TIER_LIGHTEN[tierIndex]);

  return `rgba(${lightenRgb(baseRgb, lighten)}, ${alpha})`;
}

export type PressureFieldNodeOptions = {
  planeOriginX: number;
  planeOriginY: number;
  sphericalOriginX: number;
  sphericalOriginY: number;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  showPressureFieldProperty: TReadOnlyProperty<boolean>;
  representationModeProperty: TReadOnlyProperty<RepresentationMode>;
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
 *
 * V3 addition - Pedagogical tier: representationModeProperty (see ParticleFieldNode.ts's own doc comment)
 * is read ONLY inside redraw() below, never inside rebuild()/the geometry Multilink, so switching modes
 * never rebuilds band geometry - only repaints the SAME bands - guaranteeing a jump-free switch. 'real'
 * mode's rendering (redrawReal()) is completely unchanged from before this addition; 'pedagogical' mode
 * (redrawPedagogical()) uses discrete tonal bands instead - see PEDAGOGICAL_TIER_COUNT and friends above.
 */
export class PressureFieldNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly showPressureFieldProperty: TReadOnlyProperty<boolean>;
  private readonly representationModeProperty: TReadOnlyProperty<RepresentationMode>;
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
    this.representationModeProperty = options.representationModeProperty;
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
    // representationModeProperty is read HERE ONLY - never inside rebuild()/the geometry Multilink above -
    // see the class doc's V3 addition paragraph for why that guarantees a jump-free mode switch.
    if (this.representationModeProperty.value === "pedagogical") {
      this.redrawPedagogical();
    } else {
      this.redrawReal();
    }
  }

  /** 'real' mode - UNCHANGED behavior from before the Pedagogical tier existed: a smooth, continuous
   * alpha ramp (two ceilings - SUBTLE_MAX_ALPHA always-on, PROMINENT_MAX_ALPHA opt-in, see their own
   * comments), same hue-family (compression/rarefaction) as every tier. */
  private redrawReal(): void {
    const maxAlpha = this.showPressureFieldProperty.value ? PROMINENT_MAX_ALPHA : SUBTLE_MAX_ALPHA;
    const peakPressure = this.estimatePeakPressure();

    for (const band of this.bands) {
      const sample = this.currentMode === "plane" ? this.model.sampleAt(band.positionMeters) : this.model.sampleAtRadius(band.positionMeters);
      const magnitude = peakPressure > 0 ? Math.min(1, Math.abs(sample.pressure) / peakPressure) : 0;
      const alpha = maxAlpha * magnitude;
      const rgb = sample.pressure >= 0 ? COMPRESSION_RGB : RAREFACTION_RGB;
      // toFixed(6), NOT the bare number: `magnitude` passes arbitrarily close to 0 every time pressure
      // crosses zero (twice per cycle), and JS's default Number-to-string switches to exponential
      // notation below 1e-6 (e.g. "8.5e-7") - invalid syntax for CSS rgba()'s alpha channel, which
      // crashed Scenery's Color.checkPaintString assertion (and, in production, would silently drop the
      // paint) the moment a sampled point landed in that range. A fixed-decimal string is always valid
      // regardless of how small the value gets.
      this.applyBandPaint(band, `rgba(${rgb}, ${alpha.toFixed(6)})`);
    }
  }

  /** 'pedagogical' mode (V3 addition) - discrete tonal bands (PEDAGOGICAL_TIER_COUNT tiers), a dual-
   * channel (alpha AND lightness) encoding per tier, a hard-edged wavefront boundary, and a legibility
   * floor - see the constants' own comments above for the full reasoning behind each. Always renders at
   * PROMINENT-style boldness regardless of showPressureFieldProperty - see ControlPanel.ts's disabled
   * "Show pressure field" checkbox in this mode, since that opt-in tier would otherwise be a no-op here. */
  private redrawPedagogical(): void {
    const peakPressure = this.estimatePeakPressure();

    for (const band of this.bands) {
      const sample = this.currentMode === "plane" ? this.model.sampleAt(band.positionMeters) : this.model.sampleAtRadius(band.positionMeters);
      const magnitude = peakPressure > 0 ? Math.min(1, Math.abs(sample.pressure) / peakPressure) : 0;

      if (magnitude <= 0) {
        // The wavefront has not yet reached this point (magnitude===0 here means retardedTime<=0 - see
        // sampleAtRetardedDistance()'s own early return in SoundWavesModel.ts) - stays EXACTLY neutral,
        // NEVER floored, so the wavefront's own real physical edge (free, already present in the retarded-
        // time computation) reads as the sharpest possible boundary: "nothing" right next to "at least tier
        // 0", with no soft blend at this one specific edge (contrast PEDAGOGICAL_BAND_BLEND_FRACTION's
        // internal-tier-boundary blending, which is deliberately NOT applied here).
        this.applyBandPaint(band, "rgba(0, 0, 0, 0)");
        continue;
      }

      const rgb = sample.pressure >= 0 ? COMPRESSION_RGB : RAREFACTION_RGB;
      this.applyBandPaint(band, pedagogicalTierColor(magnitude, rgb));
    }
  }

  /** Applies `color` as the paint for one band - a Rectangle's FILL in plane mode, a Circle's STROKE in
   * spherical mode (the ring's outline IS how a spherical "band" is drawn - see the class doc's SPHERICAL
   * mode paragraph - so this is not an "outline added on top of a fill"; neither mode ever adds a separate
   * stroke/outline distinct from the band's own paint, in either representation mode, per the design
   * review's "fill/alpha only" requirement). Shared by redrawReal()/redrawPedagogical() so the two tiers
   * can never accidentally diverge in HOW a band's paint is applied, only in what color they compute. */
  private applyBandPaint(band: Band, color: string): void {
    if (this.currentMode === "plane") {
      (band.shape as Rectangle).fill = color;
    } else {
      (band.shape as Circle).stroke = color;
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
