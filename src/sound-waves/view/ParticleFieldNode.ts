import { Multilink } from "scenerystack/axon";
import type { TReadOnlyProperty } from "scenerystack/axon";
import { clamp } from "scenerystack/dot";
import { Circle, Line, Node } from "scenerystack/scenery";
import { AMPLITUDE_SAFETY_FRACTION, DOMAIN_LENGTH, FREQUENCY_RANGE, SPHERICAL_SOURCE_RADIUS, SoundWavesModel, strictAmplitudeBound, wavelength } from "../model/SoundWavesModel.js";

// This file is VIEW code (imports scenery freely) - all physics lives in the model; this file only
// reads model.sampleAt(x)/model.sampleAtRadius(r) and repositions Nodes.

// ---- Zoom (view-only state - see SoundWavesScreenView.ts, NOT a model Property) ----

export type ViewZoom = "local" | "field";

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
export const SPHERICAL_FIELD_PIXEL_WIDTH = 480; // px diameter -> 240px radius, constant across zoom
// levels (see the cancellation above). Verified against SoundWavesScreenView.ts's SPHERICAL_ORIGIN_Y=360:
// top edge 360-240=120, bottom edge 360+240=600 - see that file's layout comment for the full check
// against the stage bounds, the chrome, and the ControlPanel.

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

const TRACER_RADIUS = 5;
const TRACER_FILL = "#e0592a";
const TRACER_STROKE = "#8a3013";

// Faint, low-alpha versions of the tracer's own stroke color for its equilibrium ring/tether - meant to
// read as "a ghost of the tracer", not a new/separate object.
const TRACER_RING_STROKE = "rgba(138, 48, 19, 0.35)";
const TRACER_TETHER_STROKE = "rgba(138, 48, 19, 0.55)";

const TICK_HEIGHT = 10; // px (plane mode: half-height of each vertical equilibrium tick)
const TICK_STROKE = "#c7c7c7";

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
 */
export class ParticleFieldNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly planeOriginX: number;
  private readonly planeOriginY: number;
  private readonly sphericalOriginX: number;
  private readonly sphericalOriginY: number;

  private readonly ticksLayer = new Node();
  private readonly tracerAidsLayer = new Node();
  private readonly particlesLayer = new Node();

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

  public constructor(model: SoundWavesModel, options: ParticleFieldNodeOptions) {
    super();

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;
    this.planeOriginX = options.planeOriginX;
    this.planeOriginY = options.planeOriginY;
    this.sphericalOriginX = options.sphericalOriginX;
    this.sphericalOriginY = options.sphericalOriginY;

    this.children = [this.ticksLayer, this.tracerAidsLayer, this.particlesLayer];

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
    this.particles = [];
    this.tracerIndex = -1;
    this.tracerRing = null;
    this.tracerTether = null;

    if (this.currentMode === "plane") {
      this.rebuildPlane(visibleWidthMeters);
    } else {
      this.rebuildSpherical(visibleWidthMeters / 2);
    }

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
  }

  private rebuildSpherical(maxRadiusMeters: number): void {
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

  private redraw(): void {
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
