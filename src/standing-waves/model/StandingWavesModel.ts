import { BooleanProperty, DerivedProperty, NumberProperty, Property, StringUnionProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";
import type { TReadOnlyProperty } from "scenerystack/axon";

/**
 * StandingWavesModel — a damped, driven transverse wave on a string, integrated with an explicit
 * finite-difference time-domain (FDTD) scheme.
 *
 * Governing equation (linearized, small-slope wave equation):
 *
 *   d^2y/dt^2 = c^2 d^2y/dx^2 - gamma dy/dt,      c = sqrt(T / mu)
 *
 * where y(x,t) is transverse displacement (m), T is string tension (N), mu is linear mass density
 * (kg/m), c is wave speed (m/s), and gamma is a velocity-proportional damping rate (s^-1).
 *
 * Validity/assumptions (disclosed to the student in the "How This Works" dialog, not hidden here):
 *  - This is the SMALL-SLOPE approximation (|dy/dx| << 1). Driving amplitude is capped at
 *    AMPLITUDE_CAP_FRACTION of the current string length (recomputed live) to keep that assumption
 *    reasonably honest - it is a soft pedagogical guardrail, not a hard proof of validity at the cap.
 *  - Damping is floored at DAMPING_MIN (never exactly 0), so "no damping" is not a selectable state;
 *    the UI must not claim a lower value is available than the model allows.
 *  - The driven end (x=0) is a prescribed-motion boundary, not a physically-modeled actuator - it is
 *    only an approximate node when driven off-resonance; it does not enforce y=0 there.
 */

// ---- Grid / numerical-scheme constants ----

// Number of grid INTERVALS (so the string has STRING_GRID_INTERVALS + 1 sample points, i = 0..N).
// Fixed regardless of string length - dx = L / N changes as L changes, N itself never does.
export const STRING_GRID_INTERVALS = 200;

// Target Courant number for the adaptive CFL substep count, recomputed every step() call from the
// CURRENT c and dx (never cached), since T, mu, and L can all be dragged live by the student.
const TARGET_COURANT_NUMBER = 0.9;

// Defensive cap on a single step(dt)'s incoming dt, guarding against a stalled/backgrounded tab
// producing one huge dt on resume.
const MAX_STEP_DT = 1 / 30;

// Defensive cap on substeps per step(dt) call. Should not be hit in normal operation given this
// sim's parameter ranges - it exists purely as a guardrail against pathological inputs.
const MAX_SUBSTEPS = 2000;

// How long (seconds) the driven end takes to ramp from 0 to full amplitude after driving turns on.
const DRIVE_RAMP_TIME = 0.3;

// PhET convention for a "slow motion" TimeControlNode setting: run physics at 1/4 real-time speed.
const SLOW_MOTION_TIME_SCALE = 0.25;

// NOTE on timeSpeedProperty / TimeControlNode: this model deliberately does NOT hold a
// scenery-phet `EnumerationProperty<TimeSpeed>` itself, even though TimeControlNode (used in the
// view) expects one. `scenery-phet` is a VIEW module (see the scenerystack skill's architecture.md
// module-responsibility table) - importing `TimeSpeed` from it here would violate this project's
// model/view separation rule, and in practice also breaks under Vitest's Node environment (the
// scenery-phet barrel eagerly constructs `new Image()` for asset preloading, which doesn't exist
// outside a browser). Instead, the model exposes a plain, physics-only `isSlowMotionProperty`
// below; the view owns the actual `EnumerationProperty<TimeSpeed>` for TimeControlNode and syncs it
// into this Property.

// ---- Property ranges / defaults ----

// Damping floor (s^-1). Exported so the damping slider's minimum is never allowed to claim a lower
// value than the model actually permits - "no damping" is not physically representable here.
//
// This floor is deliberately much higher than a "just keep the numerics finite" value would need to
// be. Because both string ends are effectively reflective (the driven end is only an approximate
// node - see the class doc - and the far end is exactly fixed or free), this is a near-ideal
// resonant cavity: driving exactly at a harmonic with very light damping produces genuine, physically
// correct but pedagogically unusable resonant amplification (empirically verified against this exact
// model: at the previous floor of 0.05 s^-1, driving at resonance with maximum driving amplitude grew
// to tens of meters of displacement - dozens of string lengths, and far outside the small-slope
// approximation this model relies on). DAMPING_MIN=2 combined with AMPLITUDE_CAP_FRACTION=0.01 below
// was chosen empirically (see git history / PR discussion for the sweep) so that even the worst case
// (maximum string length, maximum driving amplitude, driving frequency exactly at a harmonic, damping
// at this floor) stays under ~0.2m of displacement - safely within the string diagram's visible area -
// while still reaching that peak over several seconds, not instantly, and while still producing a
// clearly visible resonant amplification effect (roughly 10-20x the off-resonance amplitude) rather
// than eliminating the "resonance makes it bigger" lesson entirely.
export const DAMPING_MIN = 2;

// Driving amplitude is capped at this fraction of the CURRENT string length, to keep the linearized
// small-slope wave-equation assumption reasonably valid across the whole string-length range, AND
// (see the DAMPING_MIN comment above) to keep worst-case resonant amplification bounded to a
// physically-displayable range - resonant steady-state amplitude scales with driving amplitude just
// as directly as it scales inversely with damping, so this constant and DAMPING_MIN were tuned
// together, empirically, against the actual model - not chosen independently.
export const AMPLITUDE_CAP_FRACTION = 0.01;

export const LENGTH_RANGE = new Range(0.5, 2.0);
export const TENSION_RANGE = new Range(1, 10);
export const LINEAR_DENSITY_RANGE = new Range(0.001, 0.005);
export const DAMPING_RANGE = new Range(DAMPING_MIN, 10);
export const DRIVING_FREQUENCY_RANGE = new Range(0.5, 40);

const DEFAULT_LENGTH = 1.2; // m
const DEFAULT_TENSION = 1.5; // N
const DEFAULT_LINEAR_DENSITY = 0.004; // kg/m

// Defaults at the damping floor: this gives the most visible possible buildup/decay (the whole point
// of DAMPING_MIN being tuned to stay safe even here - see its comment above), and the sim's default
// driving frequency (below) is deliberately exactly a harmonic, which is now a safe, illustrative
// "watch resonance amplify the pattern" demonstration rather than a runaway blow-up.
const DEFAULT_DAMPING = DAMPING_MIN; // s^-1
const DEFAULT_DRIVING_AMPLITUDE = 0.01; // m

// The default driving frequency is DERIVED - twice the fundamental frequency implied by the other
// defaults above, with the default 'fixed' far boundary - rather than hardcoded, so it can never
// silently drift out of sync if any of the other defaults above are changed later.
const DEFAULT_WAVE_SPEED = Math.sqrt(DEFAULT_TENSION / DEFAULT_LINEAR_DENSITY);
const DEFAULT_FUNDAMENTAL_FREQUENCY = DEFAULT_WAVE_SPEED / (2 * DEFAULT_LENGTH); // 'fixed' formula, see fundamentalFrequency()
const DEFAULT_DRIVING_FREQUENCY = 2 * DEFAULT_FUNDAMENTAL_FREQUENCY;

export type FarBoundaryType = "fixed" | "free";

// ---- Pure physics helpers (exported for unit testing and reuse by the view) ----

/** c = sqrt(T / mu). */
export function waveSpeed(tension: number, linearDensity: number): number {
  return Math.sqrt(tension / linearDensity);
}

/** Fundamental frequency: c/(2L) for a fixed far end, c/(4L) for a free far end. */
export function fundamentalFrequency(speed: number, length: number, boundary: FarBoundaryType): number {
  return boundary === "fixed" ? speed / (2 * length) : speed / (4 * length);
}

/**
 * Frequency of the n-th harmonic: n*f1 (fixed-fixed) or (2n-1)*f1 (fixed-free), n = 1,2,3,...
 */
export function harmonicFrequency(n: number, fundamental: number, boundary: FarBoundaryType): number {
  return boundary === "fixed" ? n * fundamental : (2 * n - 1) * fundamental;
}

/** Nearest harmonic number (n >= 1) to a given driving frequency, inverting harmonicFrequency(). */
export function nearestHarmonic(drivingFrequency: number, fundamental: number, boundary: FarBoundaryType): number {
  if (!(fundamental > 0)) {
    return 1;
  }
  const n = boundary === "fixed" ? Math.round(drivingFrequency / fundamental) : Math.round((drivingFrequency / fundamental + 1) / 2);
  return Math.max(1, n);
}

/**
 * Predicted node positions (m, measured from x=0) for the n-th harmonic standing-wave PATTERN of a
 * string of length L - purely geometric, used only for the optional "predicted nodes" overlay.
 * fixed-fixed: n+1 nodes at x = m*L/n, m=0..n (both ends are nodes).
 * fixed-free: n nodes at x = 2m*L/(2n-1), m=0..n-1 (x=0 is a node, x=L is an antinode).
 */
export function predictedNodePositions(n: number, length: number, boundary: FarBoundaryType): number[] {
  const positions: number[] = [];
  if (boundary === "fixed") {
    for (let m = 0; m <= n; m++) {
      positions.push((m * length) / n);
    }
  } else {
    for (let m = 0; m < n; m++) {
      positions.push((2 * m * length) / (2 * n - 1));
    }
  }
  return positions;
}

export class StandingWavesModel {
  // ---- User-settable Properties ----
  public readonly lengthProperty: NumberProperty;
  public readonly tensionProperty: NumberProperty;
  public readonly linearDensityProperty: NumberProperty;
  public readonly dampingProperty: NumberProperty;
  public readonly drivingFrequencyProperty: NumberProperty;
  public readonly drivingAmplitudeProperty: NumberProperty;
  public readonly farBoundaryTypeProperty: StringUnionProperty<FarBoundaryType>;
  public readonly isDrivingProperty: BooleanProperty;
  public readonly isPlayingProperty: BooleanProperty;

  // Physics-only stand-in for scenery-phet's TimeSpeed - see the NOTE above SLOW_MOTION_TIME_SCALE.
  public readonly isSlowMotionProperty: BooleanProperty;

  // Backing range Property for drivingAmplitudeProperty, kept in sync with lengthProperty so the
  // amplitude slider's live max always tracks AMPLITUDE_CAP_FRACTION * current length (see
  // NumberProperty's `range?: Range | Property<Range>` option).
  private readonly drivingAmplitudeRangeProperty: Property<Range>;

  // ---- Derived (read-only) Properties ----
  public readonly waveSpeedProperty: TReadOnlyProperty<number>;
  public readonly fundamentalFrequencyProperty: TReadOnlyProperty<number>;
  public readonly nearestHarmonicProperty: TReadOnlyProperty<number>;
  public readonly nearestHarmonicFrequencyProperty: TReadOnlyProperty<number>;

  // ---- Non-Property grid state (plain, mutated-in-place fields - a 201-element Property/Emitter
  // per substep would be needlessly heavyweight; the view reads these directly every frame). ----

  /** Current transverse displacement (m) at each of the STRING_GRID_INTERVALS + 1 grid points. */
  public readonly displacements: Float64Array;

  /** Displacement one timestep back - needed by the central-difference recurrence. */
  private readonly previousDisplacements: Float64Array;

  /** Scratch buffer reused every substep so stepping never allocates. */
  private readonly nextDisplacements: Float64Array;

  /** Internal clock (s) driving the y0(t) = A*ramp(t)*sin(2*pi*f*t) prescribed motion. */
  private drivingClock = 0;

  public constructor() {
    this.lengthProperty = new NumberProperty(DEFAULT_LENGTH, { range: LENGTH_RANGE });
    this.tensionProperty = new NumberProperty(DEFAULT_TENSION, { range: TENSION_RANGE });
    this.linearDensityProperty = new NumberProperty(DEFAULT_LINEAR_DENSITY, { range: LINEAR_DENSITY_RANGE });
    this.dampingProperty = new NumberProperty(DEFAULT_DAMPING, { range: DAMPING_RANGE });
    this.drivingFrequencyProperty = new NumberProperty(DEFAULT_DRIVING_FREQUENCY, { range: DRIVING_FREQUENCY_RANGE });

    this.drivingAmplitudeRangeProperty = new Property(new Range(0, AMPLITUDE_CAP_FRACTION * DEFAULT_LENGTH));
    this.drivingAmplitudeProperty = new NumberProperty(DEFAULT_DRIVING_AMPLITUDE, {
      range: this.drivingAmplitudeRangeProperty,
    });

    this.farBoundaryTypeProperty = new StringUnionProperty<FarBoundaryType>("fixed", {
      validValues: ["fixed", "free"],
    });
    this.isDrivingProperty = new BooleanProperty(false); // deliberate: sim launches at rest
    this.isPlayingProperty = new BooleanProperty(true);
    this.isSlowMotionProperty = new BooleanProperty(false);

    // Keep the amplitude range tracking the current length live. When shrinking, clamp the current
    // value into the (still-valid, about-to-shrink) old range FIRST, so NumberProperty's own
    // value/range validation - which re-validates the value every time rangeProperty changes - never
    // observes an inconsistent intermediate state.
    this.lengthProperty.lazyLink((length) => {
      const newRange = new Range(0, AMPLITUDE_CAP_FRACTION * length);
      if (this.drivingAmplitudeProperty.value > newRange.max) {
        this.drivingAmplitudeProperty.value = newRange.max;
      }
      this.drivingAmplitudeRangeProperty.value = newRange;
    });

    this.waveSpeedProperty = new DerivedProperty([this.tensionProperty, this.linearDensityProperty], (tension, linearDensity) =>
      waveSpeed(tension, linearDensity),
    );

    this.fundamentalFrequencyProperty = new DerivedProperty(
      [this.waveSpeedProperty, this.lengthProperty, this.farBoundaryTypeProperty],
      (speed, length, boundary) => fundamentalFrequency(speed, length, boundary),
    );

    this.nearestHarmonicProperty = new DerivedProperty(
      [this.drivingFrequencyProperty, this.fundamentalFrequencyProperty, this.farBoundaryTypeProperty],
      (drivingFrequency, fundamental, boundary) => nearestHarmonic(drivingFrequency, fundamental, boundary),
    );

    this.nearestHarmonicFrequencyProperty = new DerivedProperty(
      [this.nearestHarmonicProperty, this.fundamentalFrequencyProperty, this.farBoundaryTypeProperty],
      (n, fundamental, boundary) => harmonicFrequency(n, fundamental, boundary),
    );

    const pointCount = STRING_GRID_INTERVALS + 1;
    this.displacements = new Float64Array(pointCount);
    this.previousDisplacements = new Float64Array(pointCount);
    this.nextDisplacements = new Float64Array(pointCount);

    // Deliberate pedagogy requirement: every time driving is (re-)engaged, restart the buildup from a
    // flat, at-rest string so students can replay the emergence of the pattern on demand, without
    // needing a full Reset All.
    this.isDrivingProperty.lazyLink((isDriving) => {
      if (isDriving) {
        this.displacements.fill(0);
        this.previousDisplacements.fill(0);
        this.drivingClock = 0;
      }
    });
  }

  /**
   * Advances the simulation by dt seconds using an adaptive number of CFL-stable FDTD substeps.
   * Does nothing while paused. Joist calls this automatically once per frame - see the confirmed
   * stepping architecture in the scenerystack skill's architecture.md; never call this from a view.
   */
  public step(dt: number): void {
    if (!this.isPlayingProperty.value) {
      return;
    }

    const timeScale = this.isSlowMotionProperty.value ? SLOW_MOTION_TIME_SCALE : 1;
    const scaledDt = Math.min(dt, MAX_STEP_DT) * timeScale;
    if (!(scaledDt > 0)) {
      return;
    }

    const tension = this.tensionProperty.value;
    const linearDensity = this.linearDensityProperty.value;
    const length = this.lengthProperty.value;
    const gamma = this.dampingProperty.value;
    const boundary = this.farBoundaryTypeProperty.value;
    const isDriving = this.isDrivingProperty.value;
    const amplitude = this.drivingAmplitudeProperty.value;
    const frequency = this.drivingFrequencyProperty.value;

    // Recomputed from CURRENT Property values every call - never cached - since T, mu, and L can all
    // be dragged live by the student while the sim is running.
    const speed = waveSpeed(tension, linearDensity);
    const dx = length / STRING_GRID_INTERVALS;
    const dtCFL = (TARGET_COURANT_NUMBER * dx) / speed;

    const rawSubstepCount = Math.ceil(scaledDt / dtCFL);
    const substepCount = Math.max(1, Math.min(MAX_SUBSTEPS, rawSubstepCount));
    const dtSub = scaledDt / substepCount;

    for (let i = 0; i < substepCount; i++) {
      this.stepOnce(dtSub, speed, dx, gamma, boundary, isDriving, amplitude, frequency);
    }
  }

  /** One CFL-stable FDTD substep: interior update, then boundary update, then advance the drive clock. */
  private stepOnce(
    dtSub: number,
    speed: number,
    dx: number,
    gamma: number,
    boundary: FarBoundaryType,
    isDriving: boolean,
    amplitude: number,
    frequency: number,
  ): void {
    const r = (speed * dtSub) / dx;
    const rSquared = r * r;
    const dampNumerator = 1 - (gamma * dtSub) / 2;
    const dampDenominator = 1 + (gamma * dtSub) / 2;

    const curr = this.displacements;
    const prev = this.previousDisplacements;
    const next = this.nextDisplacements;
    const N = STRING_GRID_INTERVALS;

    // Interior points, i = 1..N-1 (central-difference FDTD update).
    for (let i = 1; i < N; i++) {
      next[i] = (2 * curr[i] - dampNumerator * prev[i] + rSquared * (curr[i + 1] - 2 * curr[i] + curr[i - 1])) / dampDenominator;
    }

    // Far-end boundary, i = N.
    if (boundary === "fixed") {
      next[N] = 0;
    } else {
      // Free end: ghost-point mirror y_{N+1} := y_{N-1} folds into a doubled interior term.
      next[N] = (2 * curr[N] - dampNumerator * prev[N] + rSquared * 2 * (curr[N - 1] - curr[N])) / dampDenominator;
    }

    // Driven end, i = 0: prescribed motion, NOT part of the interior recurrence.
    if (isDriving) {
      const ramp = Math.min(1, this.drivingClock / DRIVE_RAMP_TIME);
      next[0] = amplitude * ramp * Math.sin(2 * Math.PI * frequency * this.drivingClock);
    } else {
      // Oscillator holds still; whatever wave energy already exists keeps propagating/reflecting/
      // decaying on its own - this is how a student observes pure free decay.
      next[0] = 0;
    }

    // Rotate time levels IN PLACE (no per-substep allocation): previous <- current, current <- next.
    prev.set(curr);
    curr.set(next);

    if (isDriving) {
      this.drivingClock += dtSub;
    }
  }

  public reset(): void {
    this.lengthProperty.reset(); // also restores drivingAmplitudeRangeProperty via its lazyLink, above
    this.tensionProperty.reset();
    this.linearDensityProperty.reset();
    this.dampingProperty.reset();
    this.drivingFrequencyProperty.reset();
    this.drivingAmplitudeProperty.reset();
    this.farBoundaryTypeProperty.reset();
    this.isDrivingProperty.reset();
    this.isPlayingProperty.reset();
    this.isSlowMotionProperty.reset();

    this.displacements.fill(0);
    this.previousDisplacements.fill(0);
    this.drivingClock = 0;
  }
}
