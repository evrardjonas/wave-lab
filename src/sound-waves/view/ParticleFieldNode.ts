import { Multilink } from "scenerystack/axon";
import type { TReadOnlyProperty } from "scenerystack/axon";
import { clamp } from "scenerystack/dot";
import { Circle, Line, Node, Path } from "scenerystack/scenery";
import { Shape } from "scenerystack/kite";
import { AMPLITUDE_SAFETY_FRACTION, DOMAIN_LENGTH, FREQUENCY_RANGE, PROBE_POSITION_METERS, SPHERICAL_SOURCE_RADIUS, SoundWavesModel, strictAmplitudeBound, wavelength } from "../model/SoundWavesModel.js";

// This file is VIEW code (imports scenery freely) - all physics lives in the model; this file only
// reads model.sampleAt(x)/model.sampleAtRadius(r) and repositions Nodes.

// ---- Zoom (view-only state - see SoundWavesScreenView.ts, NOT a model Property) ----

export type ViewZoom = "local" | "field";

// ---- Color mode (view-only state - see SoundWavesScreenView.ts, NOT a model Property) ----
//
// A single boolean, toggled by ControlPanel.ts's "Color" checkbox next to Amplitude: off is the sim's
// original, precise/quantitative rendering (unchanged everywhere); on is a bolder, more legible
// rendering tuned for "is the wave visually obvious" over "is the shading quantitatively precise" - see
// PressureFieldNode.ts's redraw() for where this actually changes anything. Deliberately NOT joined to
// any geometry-rebuild Multilink anywhere it is consumed - every consumer reads it only inside its
// existing per-frame redraw() method, never rebuild(), so toggling it is guaranteed jump-free (no
// re-layout, no discontinuity - physical state/play state is fully preserved automatically since nothing
// model-side changes when this Property changes). Previously exposed as a top-chrome 'real'/'pedagogical'
// mode selector (RepresentationModeControl, since removed) - collapsed to this one boolean once "Color"
// absorbed the only behavior difference the two mode options ever had.

// Fixed on-screen pixel footprint for the visible field, regardless of zoom level - this is what makes
// "zooming" feel like showing more of the domain in the same screen space, rather than resizing the
// whole diagram. Chosen so LOCAL zoom's resulting scale exactly reproduces this sim's ORIGINAL fixed
// PIXELS_PER_METER_X (150 px/m = 600px / 4m) - Local zoom is pixel-for-pixel identical to the sim's
// pre-zoom appearance; only "Field" zoom introduces a new, smaller scale (600/16 = 37.5 px/m).
export const FIELD_PIXEL_WIDTH = 600; // px

// Visible width (m) at each zoom level, per the reviewed interaction design: "local" reuses
// DOMAIN_LENGTH itself (the plane wave's original fixed width), "field" is the wider 16 m view.
export const VIEW_WIDTH_METERS: Record<ViewZoom, number> = { local: DOMAIN_LENGTH, field: 16 };

/** Shared model-to-view horizontal scale for the whole diagram (particle field, loudspeaker/point
 * source, and - fixed at 'local' regardless of the live zoom, see PressureGraphNode.ts - the pressure
 * graph), so a scale mismatch between any two of them can never break the causal "speaker pushes air"
 * read even with fully correct underlying physics. */
export function pixelsPerMeterForZoom(zoom: ViewZoom): number {
  return FIELD_PIXEL_WIDTH / VIEW_WIDTH_METERS[zoom];
}

// ---- Spherical-mode-only pixel footprint (QA review fix: stage-bounds overflow) ----
//
// The spherical field's max radius in METERS is always exactly VIEW_WIDTH_METERS[zoom]/2, so feeding that
// through pixelsPerMeterForZoom above (FIELD_PIXEL_WIDTH/VIEW_WIDTH_METERS[zoom]) cancels the zoom-
// dependent term and yields a CONSTANT on-screen radius of FIELD_PIXEL_WIDTH/2 = 300px at every zoom
// level. QA review found that a fixed 300px radius (600px diameter), positioned at the SPHERICAL_ORIGIN_Y
// SoundWavesScreenView.ts used at the time, overflowed the stage's actual DEFAULT_LAYOUT_BOUNDS height
// (618px) by 2px and very likely sat under the top chrome row too - see SoundWavesScreenView.ts's own
// layout comment for the full corrected arithmetic. Simply shrinking FIELD_PIXEL_WIDTH itself would also
// shrink the PLANE-mode diagram (a much bigger, out-of-scope change - plane mode's scale, RulerNode's
// calibration, and PressureGraphNode's width are all built on FIELD_PIXEL_WIDTH), so spherical mode gets
// its OWN, independent pixel footprint here instead - same "constant on-screen radius regardless of zoom"
// design as before, just a smaller constant that actually fits the stage.
//
// Every spherical-mode consumer (this file's own rebuildSpherical/redrawSpherical, PressureFieldNode.ts,
// CompressionTrackerNode.ts, and PointSourceNode in LoudspeakerNode.ts) reads this SAME function - never
// pixelsPerMeterForZoom above - in spherical mode, so the point-source icon, the particle rings, the
// pressure shading rings, and the compression-tracker rings can never drift out of scale with each other.
export const SPHERICAL_FIELD_PIXEL_WIDTH = 420; // px diameter -> 210px radius, constant across zoom
// levels (see the cancellation above). V3 RE-CHECK: shrunk from 480 (240px radius) because the top chrome
// grew from one row to two (originally to fit a since-removed RepresentationModeControl alongside
// PropagationModeControl in row 1; row 1's height was already set by PropagationModeControl - the taller
// of the two even back when RepresentationModeControl was still present - so removing the latter keeps
// row 1's height, and every margin below, unchanged/still valid, just no longer tied to that control's
// presence) - the old 240px radius no longer left enough clearance under the taller chrome. Verified against
// SoundWavesScreenView.ts's SPHERICAL_ORIGIN_Y=385: top edge 385-210=175, bottom edge 385+210=595 - see
// that file's layout comment for the full corrected arithmetic against the stage bounds, the two-row
// chrome, and the ControlPanel. MUST-FIX RE-VERIFICATION (QA + pedagogy re-review): a zoomControl.top layout
// bug in that file (now fixed) meant the ACTUAL rendered top-chrome bottom was 16px lower than this margin
// was computed against, shrinking the real top-edge margin here to ~21px instead of the intended ~37px -
// still technically over the 20px minimum, but by far less than intended. With that bug fixed, this
// constant's 210px radius / 385 origin now genuinely delivers the intended ~37px margin (see
// SoundWavesScreenView.ts's layout comment) - kept as-is (not pushed toward the feasible ceiling of 225px)
// since 210px already leaves comfortable margin on every edge without any further changes being warranted.

export function sphericalPixelsPerMeterForZoom(zoom: ViewZoom): number {
  return SPHERICAL_FIELD_PIXEL_WIDTH / VIEW_WIDTH_METERS[zoom];
}

// x where the first particle COLUMN sits (m, plane mode) - kept slightly to the right of x=0 so the
// particle field doesn't visually overlap LoudspeakerNode's housing/diaphragm. Small enough to stay
// negligible relative to either zoom level's visible width.
const FIRST_COLUMN_X = 0.2;

// ---- Density-adaptive particle count (reviewed formula) ----
//
// columnCount (plane) / ringCount (spherical) = ceil(1 + 3*(W/minWavelength)), where W is the current
// visible width (m) and minWavelength = speedOfSound/FREQUENCY_RANGE.max is the SHORTEST wavelength
// this sim can ever produce - read LIVE from the model every time the grid is rebuilt, never hardcoded,
// so a future change to FREQUENCY_RANGE or speed-of-sound stays correct automatically.
//
// Practical caps (performance): the raw formula can ask for a lot of columns at Field zoom (16m) with a
// high frequency - e.g. minWavelength~=0.686m gives ceil(1+3*(16/0.686))=71 raw columns. MAX_COLUMN_COUNT
// caps this at 64: dx = 16/63 ~= 0.254m, dx/minWavelength ~= 0.37 (i.e. ~2.7 particle-columns per
// wavelength even in this worst case) - comfortably above the ~2-columns/wavelength aliasing floor the
// original (pre-zoom) design used (see FREQUENCY_RANGE's own comment in SoundWavesModel.ts). 64 columns
// * ROW_COUNT(6) = 384 particles, a rendering budget deliberately kept the same order of magnitude as
// spherical mode's own MAX_SPHERICAL_PARTICLES cap below, so switching modes doesn't change the
// rendering cost much.
const MAX_COLUMN_COUNT = 64;
const MIN_COLUMN_COUNT = 6; // floor - keeps a recognizable field even for a hypothetically small W

function computeColumnCount(visibleWidthMeters: number, minWavelength: number): number {
  const raw = Math.ceil(1 + 3 * (visibleWidthMeters / minWavelength));
  return clamp(raw, MIN_COLUMN_COUNT, MAX_COLUMN_COUNT);
}

const ROW_COUNT = 6; // Kept FIXED across zoom levels - unlike column count, row count isn't resolving a
// wavelength (that's purely a function of columns along the propagation axis); it's just the gas-like
// visual "thickness" of the field, which doesn't need to change with zoom.
const ROW_SPACING = 20; // px, vertical spacing between particle rows
const Y_JITTER_MAX = 5; // px, fixed per-particle random offset for gas-like texture - assigned ONCE at
// construction, never animated; only position along the wave direction ever moves, so jitter can never
// be mistaken for real motion.

const PARTICLE_RADIUS = 2.2;
const PARTICLE_FILL = "#5b6b7a";

// Extra fixed visual clearance (m) beyond the widest possible amplitude excursion, so the rightmost
// column's tick/label doesn't sit flush against the reserved margin below.
const RIGHT_MARGIN_VISUAL_BUFFER = 0.1; // m

/**
 * How far short of the visible width (m) the rightmost PLANE-mode particle column stops. Found
 * live-browser-testing (pre-zoom): with columns spanning the full visible width, the rightmost column's
 * worst-case excursion could push into the ControlPanel. Reserving a margin equal to the actual widest
 * possible amplitude cap (computed the same way ControlPanel.ts's widestPossibleAmplitudeRange does, so
 * this stays correct if FREQUENCY_RANGE or AMPLITUDE_SAFETY_FRACTION ever change) plus a small fixed
 * buffer guarantees the rightmost particle's excursion can never reach the panel, at EITHER zoom level -
 * this margin is in METERS, so at Field zoom's smaller px/m it naturally shrinks to a proportionally
 * smaller on-screen margin (matching how the excursion itself also shrinks in pixels at that zoom).
 */
function computeRightMargin(model: SoundWavesModel): number {
  const widestWavelength = wavelength(model.speedOfSoundProperty.value, FREQUENCY_RANGE.min);
  const widestAmplitude = AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(widestWavelength);
  return widestAmplitude + RIGHT_MARGIN_VISUAL_BUFFER;
}

// ---- Spherical-mode layout ----

// Performance cap on total spherical-mode particle count, same order of magnitude as the plane mode's
// column*row cap (64*6=384) above, so switching propagationModeProperty doesn't change the rendering
// budget much.
const MAX_SPHERICAL_PARTICLES = 380;
const MIN_RING_COUNT = 3;
const MAX_RING_COUNT = 16;
// Particles in the innermost ring; grows per ring (see buildSphericalLayout) so AREAL particle density
// stays roughly even as each successive ring's circumference grows with its radius - a plain, original
// layout choice (concentric rings, particles spread evenly around each), not modeled on any specific
// existing visualization.
const FIRST_RING_PARTICLE_COUNT = 8;
const MAX_PARTICLES_PER_RING = 56;

// Small FIXED (assigned once, never animated) per-particle jitter for spherical mode's gas-like texture -
// the direct analogue of Y_JITTER_MAX/jitterFor above. Modest relative to ring spacing so it doesn't
// visually blur the ring structure that carries the tick-suppression cue (see MIN_TICK_PIXEL_SPACING).
const SPHERICAL_RADIAL_JITTER_MAX = 0.02; // m
const SPHERICAL_ANGULAR_JITTER_MAX = 0.05; // rad

function computeRingCount(maxRadiusMeters: number, minWavelength: number): number {
  const raw = Math.ceil(1 + 3 * (maxRadiusMeters / minWavelength));
  return clamp(raw, MIN_RING_COUNT, MAX_RING_COUNT);
}

// ---- Spherical-mode, FIELD-zoom-only layout: a Cartesian grid instead of concentric rings ----
//
// At Field zoom, spherical mode uses a rectangular (row/column) particle grid instead of the polar
// rings rebuildSphericalRings() below builds for Local zoom - requested so Spherical's wide view reads
// consistently with Plane's own Field view (also a rectangular grid), rather than a full circular disk.
// Local zoom keeps the polar-ring layout unchanged. Physically nothing changes: each grid particle's
// equilibrium is still converted to a (radius, angle) pair and driven by the exact same
// model.sampleAtRadius(r) + redrawSpherical() this file already uses for the ring layout - only WHERE
// the equilibrium positions come from differs (a rectangular sweep instead of a polar one).
//
// Particle budget kept the same order of magnitude as MAX_SPHERICAL_PARTICLES above (19*19=361 <= 380)
// so switching zoom doesn't change the rendering cost much, mirroring that constant's own reasoning.
const MAX_FIELD_GRID_SIDE = 19;
const MIN_FIELD_GRID_SIDE = 6; // same floor reasoning as MIN_COLUMN_COUNT/MIN_RING_COUNT above

// Small fixed (assigned once, never animated) per-particle jitter in both x and y - the Cartesian
// analogue of SPHERICAL_RADIAL_JITTER_MAX/SPHERICAL_ANGULAR_JITTER_MAX below, same magnitude/purpose
// (a gas-like texture), just in (x,y) rather than (r,angle) since this layout's equilibria are chosen
// in Cartesian coordinates.
const FIELD_GRID_JITTER_MAX = 0.02; // m

function computeFieldGridSide(spanMeters: number, minWavelength: number): number {
  const raw = Math.ceil(1 + 3 * (spanMeters / minWavelength));
  return clamp(raw, MIN_FIELD_GRID_SIDE, MAX_FIELD_GRID_SIDE);
}

const TRACER_RADIUS = 5;
const TRACER_FILL = "#e0592a";
const TRACER_STROKE = "#8a3013";

// Faint, low-alpha versions of the tracer's own stroke color for its equilibrium ring/tether - meant to
// read as "a ghost of the tracer", not a new/separate object.
const TRACER_RING_STROKE = "rgba(138, 48, 19, 0.35)";
const TRACER_TETHER_STROKE = "rgba(138, 48, 19, 0.55)";

const TICK_HEIGHT = 10; // px (plane mode: half-height of each vertical equilibrium tick)
const TICK_STROKE = "#c7c7c7";

// ---- Fixed pressure probe marker (pairs with PressureGraphNode.ts's "boat" - see PROBE_POSITION_METERS's
// own doc comment in SoundWavesModel.ts). A stationary spatial locator, PLANE MODE ONLY (see rebuild()/
// rebuildPlane() - the probe layer is only ever populated on the plane branch, left empty in spherical mode,
// matching the paired graph's own plane-only visibility - no separate visibleProperty is needed here). ----

// Deliberately a DIFFERENT color family (dark teal) and a DIFFERENT shape (diamond) from both the tracer
// (a FILLED ORANGE circle, TRACER_FILL, with its own ghost ring/tether) and the compression tracker (an
// OUTLINE-ONLY, dashed red triangle/ring, see CompressionTrackerNode.ts's MARKER_STROKE) - so a student can
// never mistake "the fixed measurement point" for either of those two, already visually-distinct, existing
// markers.
const PROBE_FILL = "#1f6f6f";
const PROBE_STROKE = "#0d3a3a";
const PROBE_MARKER_HALF_WIDTH = 6; // px, diamond half-width
const PROBE_MARKER_HALF_HEIGHT = 8; // px, diamond half-height

// Faint, dashed, and a different hue than TICK_STROKE's neutral gray - so this one guide line (there is only
// ever one, at the single fixed probe x) can't be confused with the many per-column equilibrium ticks, while
// still reading as "the same family of reference line". Spans the same vertical extent CompressionTrackerNode
// already treats as the particle rows' own footprint (see that file's TRIANGLE_Y_OFFSET comment:
// "+/-(ROW_COUNT*ROW_SPACING)/2 = +/-60px" - a deliberately generous rounding of the rows' true +/-50px
// span, covering the rows' own Y_JITTER_MAX margin too).
const PROBE_GUIDE_STROKE = "rgba(31, 111, 111, 0.35)";
const PROBE_GUIDE_LINE_DASH = [3, 3];
const PROBE_GUIDE_HALF_HEIGHT = (ROW_COUNT * ROW_SPACING) / 2;

// ---- Color-mode contrast boost - styling ONLY, applied via redraw() below (never rebuild()), so
// toggling "Color" never re-lays-out the field; see applyColorStyling() for where these are used. No
// geometry, count, or position changes anywhere in this file for this mode - only stroke colors/widths
// on the SAME Nodes rebuild() already created. ----

// Ordinary (non-tracer) particles have NO stroke at all with Color off (see rebuildPlane/rebuildSpherical
// below: `new Circle(PARTICLE_RADIUS, { fill: PARTICLE_FILL })`). PressureFieldNode's Color-on tier is
// deliberately much bolder than Color-off's background shading, so a thin, dark, high-contrast outline
// keeps ordinary particles legible against it.
//
// MUST-FIX (pedagogy re-review): a thin stroke alone was not enough - PARTICLE_FILL ("#5b6b7a", a blue-gray)
// is close in BOTH hue and lightness to PressureFieldNode's boldest ("tier 4", alpha 0.88) rarefaction
// color ("50, 100, 180", a blue), so a particle sitting over a bold rarefaction band nearly disappears into
// it. The compression (warm red) side never had this problem, since red is hue-distant from a blue-gray
// fill - but hue distance alone doesn't help on the rarefaction side, where hue is ALSO similar. Verified
// numerically via approximate WCAG relative luminance contrast (L = 0.2126R+0.7152G+0.0722B in linearized
// sRGB, contrast ratio = (Llighter+0.05)/(Ldarker+0.05)), composited over a white page background:
//   - OLD PARTICLE_FILL "#5b6b7a" (L~=0.142) vs. composited rarefaction tier 4 (L~=0.183 after blending
//     "50,100,180" @ alpha 0.88 over white): contrast ratio ~= 1.21:1 - essentially NO contrast (WCAG's
//     >=3:1 graphical-distinction guideline is nowhere close), confirming the reported washout.
//   - OLD PARTICLE_FILL vs. composited compression tier 4 (L~=0.194 after blending "196,60,40" @ 0.88 over
//     white): contrast ratio ~= 1.27:1 - similarly low by LUMINANCE alone; the compression side only reads
//     fine in practice because of hue distance, which this metric doesn't capture, not because its
//     luminance contrast was actually any better.
// FIX: with Color ON ONLY (Color off keeps PARTICLE_FILL unchanged, via applyColorStyling() below - its
// own background shading never gets this bold, see PressureFieldNode's SUBTLE ceiling vs. the Color tier's
// 0.88), ordinary particles get a pale, near-white, slightly warm-toned fill instead - equidistant from
// both the warm compression and cool rarefaction hues, so it can't collide with either side the way a
// saturated color would, and a lightness-based contrast fix that (unlike hue distance) actually helps
// against BOTH:
//   - COLOR_PARTICLE_FILL "#f7f1e6" (L~=0.884): vs. rarefaction tier 4 (L~=0.183), contrast ratio ~=
//     (0.884+0.05)/(0.183+0.05) ~= 4.0:1. vs. compression tier 4 (L~=0.194), contrast ratio ~=
//     (0.884+0.05)/(0.194+0.05) ~= 3.8:1. Both comfortably clear the >=3:1 guideline, on BOTH sides.
// The dark stroke is kept (and thickened slightly, see COLOR_PARTICLE_STROKE_WIDTH) for shape
// definition against the pale fill, not as the primary contrast mechanism any more.
const COLOR_PARTICLE_FILL = "#f7f1e6";
const COLOR_PARTICLE_STROKE = "#22303d";
const COLOR_PARTICLE_STROKE_WIDTH = 1; // bumped from 0.75 - see COLOR_PARTICLE_FILL's comment above; contrast now comes mainly from the fill swap, this just keeps the small (2.2px-radius) circle's edge crisp against a pale fill

// Darker/higher-contrast than TICK_STROKE's light gray, for the same "stay legible against a bolder
// background" reason.
const COLOR_TICK_STROKE = "#6b6b6b";

// Boosted-opacity variants of TRACER_RING_STROKE/TRACER_TETHER_STROKE above (same hue, higher alpha).
const COLOR_TRACER_RING_STROKE = "rgba(138, 48, 19, 0.7)";
const COLOR_TRACER_TETHER_STROKE = "rgba(138, 48, 19, 0.85)";

// Below this on-screen spacing (px) between adjacent equilibrium reference lines (plane mode's vertical
// ticks, spherical mode's concentric rings), they start to visually blur into a solid line/moire pattern
// rather than reading as individual reference marks - a practical legibility floor, not a derived value.
// When spacing drops below this, only every Nth tick/ring is drawn (see tickStride below), keeping at
// least a sparse set for the general reference-line cue rather than removing them entirely.
const MIN_TICK_PIXEL_SPACING = 14;

function tickStride(spacingPx: number): number {
  if (!(spacingPx > 0)) {
    return 1;
  }
  return Math.max(1, Math.ceil(MIN_TICK_PIXEL_SPACING / spacingPx));
}

// Deterministic pseudo-random jitter (no dependency on Math.random() timing/seeding concerns) - simple
// hash so the same particle index always gets the same jitter across a session, keeping the "field"
// visually stable rather than reshuffling on every rebuild.
function jitterFor(index: number, maxMagnitude: number): number {
  const pseudoRandom = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
  return (pseudoRandom * 2 - 1) * maxMagnitude;
}

export type ParticleFieldNodeOptions = {
  planeOriginX: number; // view x (px) of the plane-mode domain origin, x=0 (the loudspeaker)
  planeOriginY: number; // view y (px) of the plane-mode particle field's vertical center
  sphericalOriginX: number; // view x (px) of the spherical-mode point source
  sphericalOriginY: number; // view y (px) of the spherical-mode point source
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  colorEnabledProperty: TReadOnlyProperty<boolean>;
};

type PlaneParticleSpec = { equilibriumXMeters: number; yView: number; isTracer: boolean };
type SphericalParticleSpec = { equilibriumRadiusMeters: number; angleRadians: number; isTracer: boolean };

/**
 * The main "air" visualization: a field of fixed-equilibrium particles whose position along the wave
 * direction alone is driven by the model's displacement field (xi), plus two deliberate, ALWAYS-ON
 * anti-"barber-pole-illusion" affordances (per the reviewed interaction design, not opt-in): faint
 * static equilibrium reference lines, and one visually distinct tracer particle a student can lock onto
 * to see that it never travels net outward, only oscillates in place - now with a fixed equilibrium
 * RING and a tether line back to it, recomputed fresh every frame (never accumulated), making that "it
 * always returns to the same spot" fact directly visible rather than only inferable. A field of
 * identical, evenly-spaced dots can look like it's drifting even though every one is provably fixed -
 * these affordances exist specifically to counter that illusion, in BOTH propagation modes.
 *
 * Rebuilds its entire particle/tick layout (see rebuild()) whenever the view-owned zoom or the model's
 * propagationModeProperty changes - the two modes need fundamentally different geometry (1D columns vs.
 * a 2D field of concentric rings around a point source), so there is no way to reuse one grid for both;
 * a full rebuild keeps that geometry correct and avoids leftover per-mode special-casing in the
 * per-frame redraw() path (redraw() only ever operates on whichever grid rebuild() most recently built,
 * tracked via currentMode).
 *
 * Each particle's EQUILIBRIUM is fixed at rebuild time (plane: (x_i, y_i) with y_i including a small
 * fixed jitter; spherical: (radius_i, angle_i) with both including a small fixed jitter). Every frame,
 * only its DISPLAYED position is recomputed fresh from that fixed equilibrium plus the model's current
 * displacement at that equilibrium - never incrementally updated from a stored previous position, so
 * there is no possible path for numerical drift to accumulate into a false "net motion". In spherical
 * mode specifically, the radial unit vector r-hat = (equilibrium x, equilibrium y)/equilibriumRadius is
 * fixed at rebuild time and never recomputed from anything time-varying, which is what guarantees pure
 * radial oscillation with no possibility of apparent tangential drift.
 *
 * Color-mode contrast boost: colorEnabledProperty (see the "Color mode" section's own doc comment above)
 * is read ONLY inside redraw() (via applyColorStyling()), never inside rebuild()/the geometry Multilink,
 * so toggling Color is guaranteed jump-free - styling only, no geometry/count/position changes.
 *
 * V4 addition - fixed pressure probe: a single stationary marker + thin vertical guide line at the fixed
 * physical position PROBE_POSITION_METERS (see that constant's own doc comment in SoundWavesModel.ts),
 * built ONLY in rebuildPlane() (see buildProbe()) - plane mode only, pairing with PressureGraphNode.ts's own
 * plane-only "boat" marker at the SAME physical x, so a student can trace one straight vertical line from
 * this marker, through both files' guide lines, down to the boat. Unlike the tracer particle (which visibly
 * oscillates every frame, held in place only in the "always returns" sense above) or the compression
 * tracker's moving markers, THIS marker's screen position is fully static between rebuilds: its PIXEL x
 * moves only when a zoom-driven rebuild recomputes pixelsPerMeter (its PHYSICAL x never changes), and its y
 * is fixed at the row's own vertical center (planeOriginY) forever - it is never touched again in redraw(),
 * unlike every particle in particlesLayer. All of the probe's vertical-motion cue instead lives in
 * PressureGraphNode.ts's boat, which is the ONLY Node anywhere in this sim whose y tracks pressure at this
 * one fixed point.
 */
export class ParticleFieldNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly colorEnabledProperty: TReadOnlyProperty<boolean>;
  private readonly planeOriginX: number;
  private readonly planeOriginY: number;
  private readonly sphericalOriginX: number;
  private readonly sphericalOriginY: number;

  private readonly ticksLayer = new Node();
  private readonly tracerAidsLayer = new Node();
  private readonly particlesLayer = new Node();
  // Probe marker + guide line (V4 addition, plane mode only) - drawn LAST/on top so the static marker stays
  // legible even where a moving particle briefly passes behind it.
  private readonly probeLayer = new Node();

  private currentMode: "plane" | "spherical" = "plane";
  private currentPixelsPerMeter = 1;

  private planeSpecs: PlaneParticleSpec[] = [];
  private sphericalSpecs: SphericalParticleSpec[] = [];
  private particles: Circle[] = [];
  private tracerIndex = -1;

  private tracerRing: Circle | null = null;
  private tracerTether: Line | null = null;
  private tracerEquilibriumViewX = 0;
  private tracerEquilibriumViewY = 0;

  // Tracks which colorEnabled styling (see applyColorStyling() below) is CURRENTLY applied to the live
  // Nodes, so redraw() only needs to touch stroke colors when the setting actually changes (or right
  // after a rebuild() - see rebuild()'s own reset of this field - not on every single frame). null forces
  // a (re)application on the very next redraw(), which rebuild() relies on since it creates brand new,
  // unstyled Nodes every time it runs.
  private lastStyledColorEnabled: boolean | null = null;

  public constructor(model: SoundWavesModel, options: ParticleFieldNodeOptions) {
    super();

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;
    this.colorEnabledProperty = options.colorEnabledProperty;
    this.planeOriginX = options.planeOriginX;
    this.planeOriginY = options.planeOriginY;
    this.sphericalOriginX = options.sphericalOriginX;
    this.sphericalOriginY = options.sphericalOriginY;

    this.children = [this.ticksLayer, this.tracerAidsLayer, this.particlesLayer, this.probeLayer];

    Multilink.multilink([this.viewZoomProperty, model.propagationModeProperty, model.speedOfSoundProperty], () => this.rebuild());
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    this.redraw();
  }

  private minWavelength(): number {
    return this.model.speedOfSoundProperty.value / FREQUENCY_RANGE.max;
  }

  /** Reconstructs the entire particle/tick/tracer-aid layout for the current zoom + propagation mode.
   * Called at construction and whenever either changes - see the Multilink above. */
  private rebuild(): void {
    this.currentMode = this.model.propagationModeProperty.value;
    const zoom = this.viewZoomProperty.value;
    // Plane mode uses the shared pixelsPerMeterForZoom; spherical mode uses its OWN, independent
    // sphericalPixelsPerMeterForZoom - see that function's doc comment above for why the two must not
    // share a scale.
    this.currentPixelsPerMeter = this.currentMode === "plane" ? pixelsPerMeterForZoom(zoom) : sphericalPixelsPerMeterForZoom(zoom);
    const visibleWidthMeters = VIEW_WIDTH_METERS[zoom];

    this.ticksLayer.children = [];
    this.tracerAidsLayer.children = [];
    this.particlesLayer.children = [];
    this.probeLayer.children = []; // probe is plane-mode-only (see buildProbe()) - cleared unconditionally
    // here so switching INTO spherical mode leaves it empty, matching the paired graph's own plane-only visibility.
    this.particles = [];
    this.tracerIndex = -1;
    this.tracerRing = null;
    this.tracerTether = null;

    if (this.currentMode === "plane") {
      this.rebuildPlane(visibleWidthMeters);
    } else {
      this.rebuildSpherical(visibleWidthMeters / 2, zoom);
    }

    // Every Node just (re)created above starts out with Color-off's default (unstyled) look, regardless
    // of colorEnabledProperty's actual current value - forcing a (re)application on the very next
    // redraw() below, rather than relying on lastStyledColorEnabled having genuinely "changed" (it may
    // well still equal the current value from before this rebuild), is what keeps a rebuild (e.g. a zoom
    // change while Color is already on) from silently reverting styling until Color is next toggled.
    this.lastStyledColorEnabled = null;

    this.redraw();
  }

  private rebuildPlane(visibleWidthMeters: number): void {
    const columnCount = computeColumnCount(visibleWidthMeters, this.minWavelength());
    const lastColumnX = visibleWidthMeters - computeRightMargin(this.model);
    const pixelsPerMeter = this.currentPixelsPerMeter;

    this.planeSpecs = [];
    const tracerColumn = Math.floor(columnCount / 2);
    const tracerRow = Math.floor(ROW_COUNT / 2);

    const columnSpacingPx = columnCount > 1 ? ((lastColumnX - FIRST_COLUMN_X) / (columnCount - 1)) * pixelsPerMeter : 0;
    const stride = tickStride(columnSpacingPx);

    for (let column = 0; column < columnCount; column++) {
      const xMeters = columnCount > 1 ? FIRST_COLUMN_X + (column / (columnCount - 1)) * (lastColumnX - FIRST_COLUMN_X) : FIRST_COLUMN_X;
      const xView = this.planeOriginX + xMeters * pixelsPerMeter;

      if (column % stride === 0 || column === columnCount - 1) {
        this.ticksLayer.addChild(
          new Line(xView, this.planeOriginY - TICK_HEIGHT / 2, xView, this.planeOriginY + TICK_HEIGHT / 2, {
            stroke: TICK_STROKE,
            lineWidth: 1,
          }),
        );
      }

      for (let row = 0; row < ROW_COUNT; row++) {
        const isTracer = column === tracerColumn && row === tracerRow;
        const particleIndex = column * ROW_COUNT + row;
        const yView = this.planeOriginY + (row - (ROW_COUNT - 1) / 2) * ROW_SPACING + jitterFor(particleIndex, Y_JITTER_MAX);

        const particle = isTracer
          ? new Circle(TRACER_RADIUS, { fill: TRACER_FILL, stroke: TRACER_STROKE, lineWidth: 1.5 })
          : new Circle(PARTICLE_RADIUS, { fill: PARTICLE_FILL });

        this.planeSpecs.push({ equilibriumXMeters: xMeters, yView, isTracer });
        this.particles.push(particle);
        this.particlesLayer.addChild(particle);
        if (isTracer) {
          this.tracerIndex = this.particles.length - 1;
          this.tracerEquilibriumViewX = this.planeOriginX + xMeters * pixelsPerMeter;
          this.tracerEquilibriumViewY = yView;
        }
      }
    }

    this.buildTracerAids();
    this.buildProbe(pixelsPerMeter);
  }

  /** Dispatches to whichever spherical-mode layout the current zoom uses - see the "FIELD-zoom-only
   * layout" section's own comment above for why Field zoom gets a rectangular grid instead of Local
   * zoom's polar rings. */
  private rebuildSpherical(maxRadiusMeters: number, zoom: ViewZoom): void {
    if (zoom === "field") {
      this.rebuildSphericalGrid(maxRadiusMeters);
    } else {
      this.rebuildSphericalRings(maxRadiusMeters);
    }
  }

  private rebuildSphericalRings(maxRadiusMeters: number): void {
    const ringCount = computeRingCount(maxRadiusMeters, this.minWavelength());
    const pixelsPerMeter = this.currentPixelsPerMeter;

    this.sphericalSpecs = [];
    const tracerRingIndex = Math.floor(ringCount / 2);
    let tracerAssigned = false;

    const ringSpacingMeters = ringCount > 0 ? (maxRadiusMeters - SPHERICAL_SOURCE_RADIUS) / ringCount : 0;
    const ringSpacingPx = ringSpacingMeters * pixelsPerMeter;
    const stride = tickStride(ringSpacingPx);

    let particleIndex = 0;
    for (let ring = 0; ring < ringCount; ring++) {
      const baseRadius = SPHERICAL_SOURCE_RADIUS + ((ring + 1) / ringCount) * (maxRadiusMeters - SPHERICAL_SOURCE_RADIUS);

      if (ring % stride === 0 || ring === ringCount - 1) {
        const radiusView = baseRadius * pixelsPerMeter;
        this.ticksLayer.addChild(
          new Circle(radiusView, {
            stroke: TICK_STROKE,
            lineWidth: 1,
            x: this.sphericalOriginX,
            y: this.sphericalOriginY,
          }),
        );
      }

      const particlesInRing = Math.min(FIRST_RING_PARTICLE_COUNT * (ring + 1), MAX_PARTICLES_PER_RING);
      for (let p = 0; p < particlesInRing; p++) {
        if (this.particles.length >= MAX_SPHERICAL_PARTICLES) {
          break;
        }

        const radiusMeters = baseRadius + jitterFor(particleIndex * 2, SPHERICAL_RADIAL_JITTER_MAX);
        const angleRadians = (p / particlesInRing) * 2 * Math.PI + jitterFor(particleIndex * 2 + 1, SPHERICAL_ANGULAR_JITTER_MAX);
        const isTracer = ring === tracerRingIndex && !tracerAssigned && p === 0;
        if (isTracer) {
          tracerAssigned = true;
        }

        const particle = isTracer
          ? new Circle(TRACER_RADIUS, { fill: TRACER_FILL, stroke: TRACER_STROKE, lineWidth: 1.5 })
          : new Circle(PARTICLE_RADIUS, { fill: PARTICLE_FILL });

        this.sphericalSpecs.push({ equilibriumRadiusMeters: radiusMeters, angleRadians, isTracer });
        this.particles.push(particle);
        this.particlesLayer.addChild(particle);
        if (isTracer) {
          this.tracerIndex = this.particles.length - 1;
          this.tracerEquilibriumViewX = this.sphericalOriginX + radiusMeters * pixelsPerMeter * Math.cos(angleRadians);
          this.tracerEquilibriumViewY = this.sphericalOriginY + radiusMeters * pixelsPerMeter * Math.sin(angleRadians);
        }

        particleIndex++;
      }
    }

    this.buildTracerAids();
  }

  /** Field-zoom-only spherical layout: a rectangular grid of particles (rows/columns in x/y, centered on
   * the source) instead of rebuildSphericalRings()'s concentric rings - see the "FIELD-zoom-only layout"
   * section's own comment above. Each grid particle's fixed (x,y) equilibrium is converted to the SAME
   * (radius, angle) SphericalParticleSpec shape rebuildSphericalRings() produces, so redrawSpherical()
   * (which only ever reads radius+angle, never how they were chosen) drives both layouts identically -
   * no per-frame changes needed for this to animate correctly. */
  private rebuildSphericalGrid(halfExtentMeters: number): void {
    const pixelsPerMeter = this.currentPixelsPerMeter;
    const gridSide = computeFieldGridSide(2 * halfExtentMeters, this.minWavelength());

    this.sphericalSpecs = [];
    // Off-center on purpose (not the exact middle row/column, which would sit on top of the point-source
    // icon at the grid's own center) - see this method's own tracer-placement reasoning, the Cartesian
    // analogue of rebuildSphericalRings()'s tracerRingIndex choice.
    const tracerRow = Math.floor(gridSide / 2);
    const tracerColumn = Math.floor(gridSide / 2) + Math.floor(gridSide / 4);

    let particleIndex = 0;
    for (let row = 0; row < gridSide; row++) {
      for (let column = 0; column < gridSide; column++) {
        if (this.particles.length >= MAX_SPHERICAL_PARTICLES) {
          break;
        }

        // Evenly spaced across [-halfExtentMeters, halfExtentMeters] in both axes, centered on the source.
        const baseX = gridSide > 1 ? -halfExtentMeters + (column / (gridSide - 1)) * 2 * halfExtentMeters : 0;
        const baseY = gridSide > 1 ? -halfExtentMeters + (row / (gridSide - 1)) * 2 * halfExtentMeters : 0;
        const equilibriumX = baseX + jitterFor(particleIndex * 2, FIELD_GRID_JITTER_MAX);
        const equilibriumY = baseY + jitterFor(particleIndex * 2 + 1, FIELD_GRID_JITTER_MAX);

        // Skip positions inside the source's own footprint - matches rebuildSphericalRings() starting
        // its innermost ring at SPHERICAL_SOURCE_RADIUS, not r=0.
        const radiusMeters = Math.hypot(equilibriumX, equilibriumY);
        if (radiusMeters < SPHERICAL_SOURCE_RADIUS) {
          particleIndex++;
          continue;
        }
        const angleRadians = Math.atan2(equilibriumY, equilibriumX);

        const isTracer = row === tracerRow && column === tracerColumn;

        const particle = isTracer
          ? new Circle(TRACER_RADIUS, { fill: TRACER_FILL, stroke: TRACER_STROKE, lineWidth: 1.5 })
          : new Circle(PARTICLE_RADIUS, { fill: PARTICLE_FILL });

        this.sphericalSpecs.push({ equilibriumRadiusMeters: radiusMeters, angleRadians, isTracer });
        this.particles.push(particle);
        this.particlesLayer.addChild(particle);
        if (isTracer) {
          this.tracerIndex = this.particles.length - 1;
          this.tracerEquilibriumViewX = this.sphericalOriginX + radiusMeters * pixelsPerMeter * Math.cos(angleRadians);
          this.tracerEquilibriumViewY = this.sphericalOriginY + radiusMeters * pixelsPerMeter * Math.sin(angleRadians);
        }

        particleIndex++;
      }
    }

    this.buildTracerAids();
  }

  /** Ring (a faint, hollow "ghost" of the tracer, fixed at its equilibrium) plus a tether line back to
   * the tracer's current position, recomputed fresh every frame in redraw() below - never accumulated. */
  private buildTracerAids(): void {
    if (this.tracerIndex < 0) {
      return; // defensive - should always be assigned given MIN_COLUMN_COUNT/MIN_RING_COUNT are >= 1
    }

    this.tracerRing = new Circle(TRACER_RADIUS, {
      stroke: TRACER_RING_STROKE,
      lineWidth: 1.5,
      x: this.tracerEquilibriumViewX,
      y: this.tracerEquilibriumViewY,
    });
    this.tracerTether = new Line(this.tracerEquilibriumViewX, this.tracerEquilibriumViewY, this.tracerEquilibriumViewX, this.tracerEquilibriumViewY, {
      stroke: TRACER_TETHER_STROKE,
      lineWidth: 1,
    });
    this.tracerAidsLayer.children = [this.tracerTether, this.tracerRing];
  }

  /** Builds the plane-mode-only probe marker (diamond) + guide line at the fixed physical position
   * PROBE_POSITION_METERS, converted to screen x via the CURRENT pixelsPerMeter - called once per
   * rebuildPlane() (i.e. on construction and on every zoom/propagation-mode change), never per-frame. Both
   * Nodes are positioned here and ONLY here; redraw() never touches probeLayer, which is what keeps this
   * marker's y fixed at planeOriginY (the row's own vertical center) and its x fixed between rebuilds - see
   * this class's own V4 doc-comment paragraph above for why. */
  private buildProbe(pixelsPerMeter: number): void {
    const xView = this.planeOriginX + PROBE_POSITION_METERS * pixelsPerMeter;

    const guideLine = new Line(xView, this.planeOriginY - PROBE_GUIDE_HALF_HEIGHT, xView, this.planeOriginY + PROBE_GUIDE_HALF_HEIGHT, {
      stroke: PROBE_GUIDE_STROKE,
      lineWidth: 1,
      lineDash: PROBE_GUIDE_LINE_DASH,
    });

    // Diamond outline (Shape+Path, matching this sim's schematic-primitives convention, e.g.
    // CompressionTrackerNode.ts's own triangle) - a shape used nowhere else in this file, so it can't be
    // confused with the tracer's circle or the compression tracker's triangle/ring even in silhouette alone.
    const diamondShape = new Shape()
      .moveTo(0, -PROBE_MARKER_HALF_HEIGHT)
      .lineTo(PROBE_MARKER_HALF_WIDTH, 0)
      .lineTo(0, PROBE_MARKER_HALF_HEIGHT)
      .lineTo(-PROBE_MARKER_HALF_WIDTH, 0)
      .close();
    const marker = new Path(diamondShape, {
      fill: PROBE_FILL,
      stroke: PROBE_STROKE,
      lineWidth: 1,
      x: xView,
      y: this.planeOriginY,
    });

    this.probeLayer.children = [guideLine, marker];
  }

  private redraw(): void {
    // colorEnabledProperty is read HERE ONLY - never inside rebuild()/the geometry Multilink above - so
    // toggling Color never re-lays-out the field (see the "Color mode" section's own doc comment above
    // and this class's own doc comment). Only actually restyles when the value has changed since the last
    // redraw() (or right after a rebuild() reset this to null) - see lastStyledColorEnabled's own comment
    // - so ordinary frames (no change) pay no extra per-frame cost beyond the usual position updates below.
    const colorEnabled = this.colorEnabledProperty.value;
    if (colorEnabled !== this.lastStyledColorEnabled) {
      this.applyColorStyling(colorEnabled);
      this.lastStyledColorEnabled = colorEnabled;
    }

    if (this.currentMode === "plane") {
      this.redrawPlane();
    } else {
      this.redrawSpherical();
    }

    if (this.tracerTether !== null && this.tracerIndex >= 0) {
      const tracerParticle = this.particles[this.tracerIndex];
      this.tracerTether.setLine(this.tracerEquilibriumViewX, this.tracerEquilibriumViewY, tracerParticle.x, tracerParticle.y);
    }
  }

  /** Styling-only Color-mode contrast boost (see the constants' own comments above) - NO geometry,
   * count, or position changes: every Node touched here already exists (created by rebuild()), only
   * fill/stroke colors/widths change. With Color off, restores each Node's ORIGINAL look exactly
   * (ordinary particles: original PARTICLE_FILL, no stroke at all; ticks/tracer ring/tether: their
   * original, lower-contrast colors) - so switching Color off never leaves any of its styling behind.
   * MUST-FIX (pedagogy re-review): ordinary particles also swap FILL (not just stroke) when Color is on
   * - see COLOR_PARTICLE_FILL's own comment for why a thin stroke alone wasn't enough contrast against
   * bold rarefaction bands. */
  private applyColorStyling(colorEnabled: boolean): void {
    for (let i = 0; i < this.particles.length; i++) {
      if (i === this.tracerIndex) {
        continue; // the tracer particle keeps its own always-on TRACER_FILL/TRACER_STROKE either way - untouched here.
      }
      const particle = this.particles[i];
      particle.fill = colorEnabled ? COLOR_PARTICLE_FILL : PARTICLE_FILL;
      particle.stroke = colorEnabled ? COLOR_PARTICLE_STROKE : null;
      particle.lineWidth = COLOR_PARTICLE_STROKE_WIDTH;
    }

    for (const tick of this.ticksLayer.children) {
      (tick as Line | Circle).stroke = colorEnabled ? COLOR_TICK_STROKE : TICK_STROKE;
    }

    if (this.tracerRing !== null) {
      this.tracerRing.stroke = colorEnabled ? COLOR_TRACER_RING_STROKE : TRACER_RING_STROKE;
    }
    if (this.tracerTether !== null) {
      this.tracerTether.stroke = colorEnabled ? COLOR_TRACER_TETHER_STROKE : TRACER_TETHER_STROKE;
    }
  }

  private redrawPlane(): void {
    const pixelsPerMeter = this.currentPixelsPerMeter;
    for (let i = 0; i < this.particles.length; i++) {
      const spec = this.planeSpecs[i];
      const displacement = this.model.sampleAt(spec.equilibriumXMeters).displacement;
      const particle = this.particles[i];
      particle.x = this.planeOriginX + (spec.equilibriumXMeters + displacement) * pixelsPerMeter;
      particle.y = spec.yView;
    }
  }

  private redrawSpherical(): void {
    const pixelsPerMeter = this.currentPixelsPerMeter;
    for (let i = 0; i < this.particles.length; i++) {
      const spec = this.sphericalSpecs[i];
      const displacement = this.model.sampleAtRadius(spec.equilibriumRadiusMeters).displacement;
      // r-hat = (cos(angle), sin(angle)) is a FIXED unit vector, computed only from the particle's own
      // fixed equilibrium angle - never from anything time-varying - so displacement can only ever move
      // this particle radially, never tangentially (no possible path to apparent angular drift).
      const rView = (spec.equilibriumRadiusMeters + displacement) * pixelsPerMeter;
      const particle = this.particles[i];
      particle.x = this.sphericalOriginX + rView * Math.cos(spec.angleRadians);
      particle.y = this.sphericalOriginY + rView * Math.sin(spec.angleRadians);
    }
  }
}
