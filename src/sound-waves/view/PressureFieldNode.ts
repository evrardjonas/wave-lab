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

// Always-on tier ceiling (per the reviewed design, 0.12-0.15) so it reads as ambient background
// texture, not a competing focal element. This is the ONLY alpha ceiling redrawSubtle() ever uses now -
// see that method's own comment for why the old opt-in "Show pressure field" boost (a second, separate
// PROMINENT_MAX_ALPHA ceiling within this same continuous rendering) was retired in favor of the bolder,
// visually distinct "Color" tier below.
const SUBTLE_MAX_ALPHA = 0.14;

// ---- Color tier (bold, discrete-band rendering for colorEnabledProperty===true) ----
//
// Read ONLY inside redraw() below, never inside rebuild()/the geometry Multilink - toggling
// colorEnabledProperty must never rebuild band geometry, only repaint the SAME bands, so the switch is
// guaranteed jump-free (see colorEnabledProperty's own doc comment in ParticleFieldNode.ts).

// Number of discrete magnitude tiers (design review: "4-5 magnitude tiers"). Chosen at the top of that
// range (5) so successive tiers are still individually distinguishable at a glance without being so fine-
// grained they blur back into looking like a smooth ramp (defeating the point of a discrete/bold tier
// scheme).
const COLOR_TIER_COUNT = 5;

// Alpha ceiling per tier, monotonically increasing - tier 0 is ALSO the legibility floor's alpha (see
// redrawColor()'s magnitude<=0 branch): any point the wavefront has reached, however small its
// magnitude, lands in tier 0 at minimum (the discretization itself IS the floor - there is no separate
// clamp needed, since tier 0's own alpha is already comfortably nonzero, unlike the continuous tier's
// alpha, which ramps linearly all the way down to 0 and can fade into invisibility far from the source).
const COLOR_TIER_ALPHAS = [0.22, 0.38, 0.54, 0.7, 0.88];

// Lightness-toward-white mix per tier (0 = full base saturation, 1 = fully white) - the SECOND, independent
// channel (alongside alpha) encoding magnitude, so tiers stay distinguishable even under a color-vision
// deficiency that makes the alpha/saturation difference hard to see alone (dual-channel, colorblind-safe
// encoding, per the design review). Decreasing alongside alpha's increase: higher-magnitude tiers are both
// MORE opaque AND MORE saturated/darker.
const COLOR_TIER_LIGHTEN = [0.5, 0.35, 0.2, 0.08, 0];

// Fraction of each tier's band width, at its END, over which a smoothstep-eased blend toward the NEXT
// tier's alpha/lightness happens - keeps most of each band a FLAT, discrete color (so it still reads as
// texture/tiers, per the design review, not a smooth ramp) while avoiding a razor-hard seam at every
// internal tier boundary ("a small soft transition between tiers ... not a hard cutoff"). Deliberately NOT
// applied to the wavefront boundary itself (see redrawColor()'s magnitude<=0 branch) - that edge is a
// REAL physical boundary (already present for free in the retarded-time computation) and is kept as sharp
// as possible instead, per the design review's explicit ask.
const COLOR_BAND_BLEND_FRACTION = 0.3;

/** Blends an "r, g, b" string toward white by `amount` (0=unchanged, 1=fully white) - the Color tier's
 * lightness channel, see COLOR_TIER_LIGHTEN's own comment. */
function lightenRgb(rgb: string, amount: number): string {
  const [r, g, b] = rgb.split(",").map((component) => Number(component.trim()));
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

/** Maps a continuous magnitude (0..1) and a base "r, g, b" hue-family string to a discrete-tier Color
 * rgba() color string - see COLOR_TIER_COUNT/COLOR_TIER_ALPHAS/COLOR_TIER_LIGHTEN/
 * COLOR_BAND_BLEND_FRACTION above for the full reasoning. Only ever called with magnitude > 0 - the
 * magnitude<=0 (not-yet-arrived) case is handled entirely separately in redrawColor(), never via this
 * function, so the wavefront's own boundary stays a hard edge rather than tier 0's soft internal blend. */
function colorTierColor(magnitude: number, baseRgb: string): string {
  const clamped = Math.min(1, Math.max(0, magnitude));
  const scaled = clamped * COLOR_TIER_COUNT;
  const tierIndex = Math.min(COLOR_TIER_COUNT - 1, Math.floor(scaled));
  const nextTierIndex = Math.min(COLOR_TIER_COUNT - 1, tierIndex + 1);
  const withinTier = scaled - tierIndex; // 0..1 position within this tier's own band

  let ease = 0;
  if (withinTier > 1 - COLOR_BAND_BLEND_FRACTION) {
    const t = (withinTier - (1 - COLOR_BAND_BLEND_FRACTION)) / COLOR_BAND_BLEND_FRACTION;
    ease = t * t * (3 - 2 * t); // smoothstep
  }

  const alpha = COLOR_TIER_ALPHAS[tierIndex] + ease * (COLOR_TIER_ALPHAS[nextTierIndex] - COLOR_TIER_ALPHAS[tierIndex]);
  const lighten = COLOR_TIER_LIGHTEN[tierIndex] + ease * (COLOR_TIER_LIGHTEN[nextTierIndex] - COLOR_TIER_LIGHTEN[tierIndex]);

  return `rgba(${lightenRgb(baseRgb, lighten)}, ${alpha})`;
}

export type PressureFieldNodeOptions = {
  planeOriginX: number;
  planeOriginY: number;
  sphericalOriginX: number;
  sphericalOriginY: number;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  colorEnabledProperty: TReadOnlyProperty<boolean>;
};

type Band = { positionMeters: number; shape: Rectangle | Circle };

/**
 * Background pressure-field shading behind the particle field. Two tiers (see SUBTLE_MAX_ALPHA/
 * the Color tier above), both derived from the SAME model data ParticleFieldNode and PressureGraphNode
 * already use - never a separate pressure computation of its own.
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
 * Color tier: colorEnabledProperty (see ParticleFieldNode.ts's own doc comment) is read ONLY inside
 * redraw() below, never inside rebuild()/the geometry Multilink, so toggling it never rebuilds band
 * geometry - only repaints the SAME bands - guaranteeing a jump-free switch. Color-off's rendering
 * (redrawSubtle()) is a plain, single-ceiling continuous alpha ramp; Color-on (redrawColor()) uses
 * discrete tonal bands instead - see COLOR_TIER_COUNT and friends above. (Previously this file also had
 * a separate, opt-in "Show pressure field" checkbox that boosted redrawSubtle()'s own ceiling to a
 * second, PROMINENT alpha independent of Color - retired once "Color" became the one mechanism for
 * making this shading more prominent, per the reviewed interaction design.)
 */
export class PressureFieldNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly colorEnabledProperty: TReadOnlyProperty<boolean>;
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
    this.colorEnabledProperty = options.colorEnabledProperty;
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
      // User testing found spherical Color-mode shading reading as visibly softer/less saturated than
      // plane mode's, despite both computing the same alpha/color values (colorTierColor()/SUBTLE_MAX_ALPHA
      // are shared code, not mode-specific) - the difference is purely geometric: plane mode fills solid,
      // mutually-adjacent Rectangles, while each spherical "band" is a thin (~2px) stroked Circle outline.
      // At exactly the touching width (ringWidthMeters*pixelsPerMeter with no extra factor), adjacent rings'
      // anti-aliased edges don't fully reach each ring's nominal alpha right at the boundary between them -
      // repeated across FIELD_SAMPLE_COUNT=100 rings, that reads as an overall softer/hazier field than
      // plane mode's crisp, contiguous rectangles. RING_OVERLAP_FACTOR widens each ring's stroke slightly
      // beyond the exact touching width so adjacent rings overlap a bit, covering that seam - a pure
      // rendering/geometry change (same per-radius pressure lookup, same FIELD_SAMPLE_COUNT resolution),
      // not a change to any color/alpha value.
      const RING_OVERLAP_FACTOR = 1.4;
      const ringWidthPx = Math.max(1, ringWidthMeters * pixelsPerMeter * RING_OVERLAP_FACTOR);
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
    // colorEnabledProperty is read HERE ONLY - never inside rebuild()/the geometry Multilink above - see
    // the class doc's Color tier paragraph for why that guarantees a jump-free toggle.
    if (this.colorEnabledProperty.value) {
      this.redrawColor();
    } else {
      this.redrawSubtle();
    }
  }

  /** Color-off rendering - a smooth, continuous alpha ramp at a single, always-subtle ceiling
   * (SUBTLE_MAX_ALPHA), same hue-family (compression/rarefaction) as the Color tier. Used to have a
   * second, opt-in PROMINENT ceiling here (the old "Show pressure field" checkbox) - retired once
   * "Color" (redrawColor() below) became the one mechanism for a more prominent presentation. */
  private redrawSubtle(): void {
    const peakPressure = this.estimatePeakPressure();

    for (const band of this.bands) {
      const sample = this.currentMode === "plane" ? this.model.sampleAt(band.positionMeters) : this.model.sampleAtRadius(band.positionMeters);
      const magnitude = peakPressure > 0 ? Math.min(1, Math.abs(sample.pressure) / peakPressure) : 0;
      const alpha = SUBTLE_MAX_ALPHA * magnitude;
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

  /** Color-on rendering - discrete tonal bands (COLOR_TIER_COUNT tiers), a dual-channel (alpha AND
   * lightness) encoding per tier, a hard-edged wavefront boundary, and a legibility floor - see the
   * constants' own comments above for the full reasoning behind each. Always renders at this bold,
   * discrete presentation regardless of anything else - there is no separate "boost" checkbox any more
   * (see the class doc's Color tier paragraph). */
  private redrawColor(): void {
    const peakPressure = this.estimatePeakPressure();

    for (const band of this.bands) {
      const sample = this.currentMode === "plane" ? this.model.sampleAt(band.positionMeters) : this.model.sampleAtRadius(band.positionMeters);
      const magnitude = peakPressure > 0 ? Math.min(1, Math.abs(sample.pressure) / peakPressure) : 0;

      if (magnitude <= 0) {
        // The wavefront has not yet reached this point (magnitude===0 here means retardedTime<=0 - see
        // sampleAtRetardedDistance()'s own early return in SoundWavesModel.ts) - stays EXACTLY neutral,
        // NEVER floored, so the wavefront's own real physical edge (free, already present in the retarded-
        // time computation) reads as the sharpest possible boundary: "nothing" right next to "at least tier
        // 0", with no soft blend at this one specific edge (contrast COLOR_BAND_BLEND_FRACTION's internal-
        // tier-boundary blending, which is deliberately NOT applied here).
        this.applyBandPaint(band, "rgba(0, 0, 0, 0)");
        continue;
      }

      const rgb = sample.pressure >= 0 ? COMPRESSION_RGB : RAREFACTION_RGB;
      this.applyBandPaint(band, colorTierColor(magnitude, rgb));
    }
  }

  /** Applies `color` as the paint for one band - a Rectangle's FILL in plane mode, a Circle's STROKE in
   * spherical mode (the ring's outline IS how a spherical "band" is drawn - see the class doc's SPHERICAL
   * mode paragraph - so this is not an "outline added on top of a fill"; neither mode ever adds a separate
   * stroke/outline distinct from the band's own paint, in either rendering. Shared by redrawSubtle()/
   * redrawColor() so the two tiers can never accidentally diverge in HOW a band's paint is applied, only
   * in what color they compute. */
  private applyBandPaint(band: Band, color: string): void {
    if (this.currentMode === "plane") {
      (band.shape as Rectangle).fill = color;
    } else {
      (band.shape as Circle).stroke = color;
    }
  }

  /** Upper bound on |pressure| across the domain at the CURRENT frequency, used only to normalize shading
   * intensity to 0..1 - mirrors PressureGraphNode.ts's own axis-scaling estimate (AIR_DENSITY * c * omega
   * * amplitude).
   *
   * BUG FIX: this used to read the LIVE amplitudeProperty/sphericalAmplitudeProperty value here, which
   * makes this bound scale in exact proportion to amplitude - since the sampled pressure fed into
   * `magnitude = |pressure| / peakPressure` in redrawSubtle()/redrawColor() is ALSO exactly proportional
   * to that same amplitude, the amplitude term cancels out of `magnitude` algebraically, so the shading
   * always renders the SAME normalized intensity distribution no matter what amplitude is set to -
   * raising or lowering the Amplitude control produced visually IDENTICAL shading. Anchoring instead to
   * the relevant amplitude control's own current MAX (amplitudeProperty.rangeProperty / sphericalAmpli-
   * tudeProperty.rangeProperty, the safety-bound Range already used to size each slider - see
   * SoundWavesModel.ts's computeAmplitudeRange()/computeSphericalAmplitudeRange()) gives a FIXED
   * reference, so the live amplitude value now visibly changes how much of the tier range - or, in
   * Color-off mode, how dark the continuous tint gets - the shading reaches. Read fresh every frame
   * (redrawSubtle()/redrawColor() call this every step()), so no separate Multilink wiring is needed the
   * way PressureGraphNode.ts's axis range requires.
   *
   * NOTE (physics-reviewed) - the two modes behave differently here, deliberately: in PLANE mode this
   * ceiling is an exact CONSTANT independent of frequency (see PressureGraphNode.ts's matching note - the
   * omega and 1/omega terms cancel exactly), so dragging Frequency alone never shifts the shading. In
   * SPHERICAL mode it does NOT cancel (strictRadialAmplitudeBound has an uncancelled 1/sourceRadius term
   * that only becomes negligible at high frequency, approaching the plane-wave ceiling in that limit) -
   * so in Spherical mode, changing Frequency alone DOES visibly shift the shading's saturation, which is
   * real physics (the maximum achievable pressure at a given frequency genuinely changes), not a bug. */
  private estimatePeakPressure(): number {
    const speedOfSound = this.model.speedOfSoundProperty.value;
    const omega = angularFrequency(this.model.frequencyProperty.value);
    const maxAmplitude = this.currentMode === "plane" ? this.model.amplitudeProperty.rangeProperty.value.max : this.model.sphericalAmplitudeProperty.rangeProperty.value.max;
    return AIR_DENSITY * speedOfSound * omega * maxAmplitude;
  }
}
