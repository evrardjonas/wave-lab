import { BooleanProperty, DerivedProperty, NumberProperty, Property, StringUnionProperty } from "scenerystack/axon";
import { Range } from "scenerystack/dot";
import type { TReadOnlyProperty } from "scenerystack/axon";

/** View state: a rightward-only 'plane' wave, or a 'spherical' wave radiating from a point source. */
export type PropagationMode = "plane" | "spherical";

/** Physics playback speed, selected via playbackSpeedProperty (see TIME_SCALE_BY_SPEED below). Kept as
 * a plain physics-only StringUnionProperty - same reasoning/idiom as PropagationMode above - rather than
 * importing scenery-phet's TimeSpeed enum (a VIEW module; see the module-responsibility table in the
 * scenerystack skill's architecture.md) into model code. Unlike the OLD isSlowMotionProperty/TimeSpeed
 * bridging this replaces, the view's PlaybackSpeedControl (see view/PlaybackSpeedControl.ts) now binds
 * DIRECTLY to this Property - no bridging Property/link needed - since TimeControlNode's built-in speed
 * radio group is disabled entirely (timeSpeedProperty: null) in favor of this custom 3-way control (its
 * closed TimeSpeed enum has only FAST/NORMAL/SLOW, with no ultra-slow member to repurpose). */
export type PlaybackSpeed = "normal" | "slow" | "ultraSlow";

/**
 * SoundWavesModel — a single rightward-traveling 1D longitudinal acoustic plane wave, radiated
 * continuously from a loudspeaker at x=0. There is no reflection and no superposition in this sim
 * (the visible domain is treated as open/anechoic beyond its right edge), so the wave is evaluated
 * in CLOSED FORM via a retarded-time / phase-accumulator scheme rather than a discretized PDE solver
 * (contrast with Standing Waves' FDTD scheme, which exists specifically to handle reflection and
 * counter-propagating superposition - neither applies here, so an explicit numerical stencil would
 * add CFL/dispersion complexity for zero benefit).
 *
 * Governing formulas (plane wave, SI units except where noted):
 *
 *   xi(x,t) = xi_max * sin(kx - wt)              displacement (m) - EXAGGERATED for visibility,
 *                                                 see AMPLITUDE_SAFETY_FRACTION below; not to real scale.
 *   u(x,t)  = d(xi)/dt = -w * xi_max * cos(kx - wt)     particle velocity (m/s)
 *   p'(x,t) = -rho*c^2*k*xi_max*cos(kx - wt) = rho*c*u(x,t)   acoustic pressure variation (Pa)
 *
 * where k = 2*pi/lambda, w = 2*pi*f, c = w/k = speed of sound, rho = air density.
 *
 * VERIFIED PHASE RELATIONSHIP (critical, easy to get backwards - see SoundWavesModel.test.ts):
 * u and p' are exactly in phase with each other (both proportional to cos(kx-wt)); both LEAD xi by
 * exactly 90 degrees (xi ~ sin, u/p' ~ cos). Consequently, compressions/rarefactions (pressure
 * extrema) occur at the ZERO-CROSSINGS of the displacement pattern, NOT at displacement peaks -
 * pressure is exactly zero where displacement is maximal. This is implemented structurally (both
 * quantities are derived from the same retarded phase via sin/cos of the SAME angle), not by
 * separately re-deriving a "pressure wave" from scratch.
 *
 * NUMERICAL APPROACH - retarded-time phase accumulator (not FDTD):
 * A running source phase theta_source(t) is integrated every step() as theta_source += 2*pi*f(t)*dt
 * (an INTEGRAL over frequency history, not 2*pi*f*t from a fixed start - that would silently assume f
 * was constant since t=0, which is wrong the instant a student drags the frequency slider). A short
 * ring-buffer history of theta_source(t) is kept, spanning at least the maximum propagation delay
 * across the visible domain (DOMAIN_LENGTH / c), so that any sample point x can look up
 * theta_source at its own RETARDED time (t - x/c) by interpolating that history. A point whose
 * retarded time is still negative (the wavefront hasn't reached it yet) is simply at rest - this is
 * the physical wavefront falling naturally out of the retarded-time lookup, not a special case.
 *
 * DOCUMENTED SIMPLIFICATION: the retarded PHASE (theta_source, which is what actually produces the
 * traveling wave pattern/wavelength in space) is looked up at full retarded-time fidelity via the
 * history buffer. The AMPLITUDE-SCALING factors shared by xi, u, AND p' (omega, xi_max - see
 * displacementAtRetardedPhase/velocityAtRetardedPhase below, both take the same two current-value
 * arguments) instead use the model's CURRENT frequency/amplitude Property values directly, not a
 * historical/retarded value of those quantities. This is a deliberate, bounded simplification: the
 * ring buffer only spans tens of milliseconds (see REQUIRED_HISTORY_DURATION below; the resulting
 * discrepancy window is DOMAIN_LENGTH/c, independent of frequency, and under one frame at 60fps), far
 * too short for a frequency/amplitude slider drag to produce a visible discrepancy, and it avoids
 * fragile numerical differentiation of the phase history to recover a local instantaneous frequency.
 * The core physics this sim exists to teach - the traveling wave shape, correct wavelength, and
 * correct xi/u/p' phase relationships - is unaffected; only the (already non-physical)
 * instant-everywhere-on-an-amplitude-or-frequency-change behavior is a simplification, verified bounded
 * by physics review.
 *
 * PLAYBACK SPEED / RAMP-TIME INDEPENDENCE (V3 refinement, added on top of the above): playbackSpeedProperty
 * (normal/slow/ultraSlow, see TIME_SCALE_BY_SPEED) scales sourcePhase's and simulationTime's advancement
 * per step() identically (a single shared "clock" genuinely drives both - see step() below), so oscillation
 * rate and propagation speed always stay locked together at every speed setting, exactly like the wave's
 * own w=2*pi*f and c=w/k relationships already require. The amplitude RAMP (RAMP_TIME, rampFactor() below)
 * is DELIBERATELY EXEMPT from this scaling: it must be fed REAL elapsed-time-since-arrival, not the SCALED
 * model-time-since-arrival directly (which would make its real-world duration RAMP_TIME/timeScale).
 *
 * MUST-FIX (V3 physics re-review): an earlier version of this fix approximated real-elapsed-time-since-
 * arrival as (scaled model-time-since-arrival) / (CURRENT timeScale), clamped to a separate unscaled
 * wall-clock accumulator as a sanity ceiling. That approximation is only exact if timeScale hasn't changed
 * since the point's own wavefront arrival - dividing by the CURRENT scale after a mid-ramp speed change
 * produced a genuine one-frame amplitude discontinuity in BOTH directions (slow->fast: the ramp estimate
 * suddenly drops, since the same elapsed model-time now divides by a much larger timeScale; fast->slow: it
 * suddenly jumps up, dividing by a much smaller timeScale) - and the "ceiling" did not actually guard the
 * fast->slow direction despite its old doc comment's claim.
 *
 * FIX: phaseHistory (see its own doc comment below) now also records unscaledElapsedTime at each push, not
 * just phase - so sampleAtRetardedDistance() can look up the EXACT unscaledElapsedTime that was in effect
 * at the point's own arrival model-time (this.simulationTime - retardedTime, i.e. the absolute model time
 * at which retardedTime itself crossed 0 for this point), via the same interpolated-history-lookup
 * mechanism phaseAtTime() already uses for phase (see interpolateHistoryValue()). Real elapsed time since
 * arrival is then simply (current unscaledElapsedTime) - (unscaledElapsedTime at arrival) - an EXACT
 * reconstruction of the point's own real-time history, independent of any timeScale changes that happened
 * after arrival, not an approximation that needs a separate sanity-ceiling clamp at all (removed entirely,
 * along with the retardedTime/timeScale approximation itself). See REQUIRED_HISTORY_DURATION for why the
 * buffer is sized to always retain a point's arrival entry for as long as it could still be mid-ramp, and
 * sampleAtRetardedDistance() for the lookup itself.
 *
 * The net effect: a student always sees roughly the same ~0.25 REAL second smoothing transition as the
 * wavefront visibly passes a point, regardless of playback speed - including across a speed change that
 * happens mid-ramp, in either direction - see RAMP_TIME's own comment and sampleAtRetardedDistance() (it is
 * a display-smoothing device, not real acoustic physics, unlike everything else in this file).
 *
 * SPHERICAL MODE (added as a substantial refinement on top of the plane-wave model above): an
 * alternative propagation mode, selected via propagationModeProperty, in which the SAME retarded-time
 * phase-accumulator machinery (sourcePhase/simulationTime/phaseHistory/phaseAtTime()/rampFactor(),
 * all unchanged) drives a spherically-spreading wave radiating from a point source, instead of a
 * rightward-only plane wave. DOCUMENTED SIMPLIFICATION: this is a FAR-FIELD spherical-wave
 * approximation with a small but nonzero finite source radius (SPHERICAL_SOURCE_RADIUS) standing in
 * for the real source, NOT exact near-field acoustics (a real point monopole's near field has extra
 * reactive terms this model does not attempt to reproduce) - see sphericalAmplitudeAtRadius below for
 * the amplitude law and its derivation. Both modes share every other piece of physics (the same
 * omega/k, the same u/p' phase relationship, the same ramp-in at the wavefront) - only the amplitude's
 * spatial falloff and the resulting amplitude-overtaking bound differ between them.
 */

// ---- Visible domain / sampling ----

// Length (m) of the visible domain, x=0 (speaker) to x=DOMAIN_LENGTH. A few meters is large enough to
// show several wavelengths at this sim's default frequency while staying legible at 60fps - see
// FREQUENCY_RANGE below for the reasoning tying domain size, frequency range, and particle spacing together.
export const DOMAIN_LENGTH = 4; // m

// Number of evenly-spaced points across [0, DOMAIN_LENGTH] at which displacement/pressure are cached
// every step() - originally used directly by the pressure graph; PressureGraphNode.ts now instead reads
// model.sampleAt(x) at its OWN zoom-aware cached positions (see that file), reusing this same count as
// its Local-zoom baseline density so the two stay conceptually tied together. This array is otherwise
// retained for SoundWavesModel.test.ts's existing coverage. Purely a display-resolution choice, not a
// physics parameter.
export const PRESSURE_SAMPLE_COUNT = 240;

// Fixed physical x-position (m) of the pressure probe - a single, always-on-in-plane-mode measurement
// point. Rendered as a STATIC marker (fixed x AND y) in ParticleFieldNode.ts's particle field, and as a
// pressure-driven "boat" (fixed x, y follows pressure) in PressureGraphNode.ts's graph - see those files
// for the view-side rendering; this is the one shared physical constant both read so their two markers can
// never drift apart in x. Chosen to sit comfortably inside BOTH zoom levels' visible domain
// (Local: [0, DOMAIN_LENGTH] = [0, 4]; Field: [0, 16], see ParticleFieldNode.ts's VIEW_WIDTH_METERS), and
// clear of both the source (x=0, where the loudspeaker/point-source icon sits) and the right-edge margin
// plane-mode particle columns stay clear of (see ParticleFieldNode.ts's FIRST_COLUMN_X=0.2m and
// computeRightMargin(), which at FREQUENCY_RANGE.min leaves plane-mode columns spanning roughly
// [0.2, 3.5]m even at the tightest, Local, zoom). 1.5 m sits well inside that range at Local zoom (not
// crowded against either edge) and is equally unobtrusive within Field zoom's much wider [0, 16]m range.
export const PROBE_POSITION_METERS = 1.5; // m

// ---- Physical constants, modeled as Properties (not inlined literals) ----

// Speed of sound in dry air at room temperature (~20C), m/s. Modeled as a DerivedProperty (even
// though it is currently a fixed constant) so a future temperature-dependent speed-of-sound feature
// is purely additive - every formula below reads speedOfSoundProperty.value fresh, never a cached
// literal, so adding real temperature dependence later only requires changing this one derivation.
//
// IMPLEMENTATION NOTE: the installed DerivedProperty's typed constructor overloads (see
// node_modules/scenerystack/src/axon/js/DerivedProperty.ts) require at least ONE dependency (RP1..RP15) -
// there is no zero-dependency overload, so `new DerivedProperty([], () => 343)` does not type-check as
// written in early drafts of this spec. `DerivedProperty.deriveAny()` (same file) is typed to accept a
// plain `Array<TReadOnlyProperty<unknown>>` with no minimum length and is exactly the "or equivalent
// derivation" the spec allows for this case - used here instead, with an explicit empty dependency array.
const SPEED_OF_SOUND_ROOM_TEMPERATURE = 343; // m/s

// Density of dry air at room temperature, kg/m^3. Used only in the p' = rho*c*u impedance relation.
// Not modeled as a Property (unlike c) - nothing in this spec calls for a temperature-dependent
// density feature, and adding one preemptively would be exactly the kind of speculative abstraction
// this project's CLAUDE.md warns against; promote it the same way if that ever becomes necessary.
// Exported (read-only use) so tests can verify exact p' = rho*c*u magnitudes, not just proportionality.
export const AIR_DENSITY = 1.2; // kg/m^3

// ---- Property ranges / defaults ----

// Audible-but-visually-legible frequency range. Reasoning tying domain size, frequency, and particle
// spacing together (see ParticleFieldNode.ts for the actual particle grid):
//  - Lower bound (100 Hz): at c=343 m/s this gives lambda=3.43 m, still comfortably less than
//    DOMAIN_LENGTH so at least one full wavelength is visible even at the low end (a lower bound like
//    20 Hz would give lambda=17 m - over 4x the visible domain, showing less than one quarter of a
//    wavelength: "a single wide hump", not a recognizable wave pattern).
//  - Upper bound (500 Hz): at c=343 m/s this gives lambda=0.686 m. With ~16 particle columns spanning
//    the domain (dx ~= 0.26 m, see ParticleFieldNode.ts), that is dx/lambda ~= 0.37, i.e. very
//    comfortably above 2 particle-columns per wavelength (the Nyquist-ish minimum below which the
//    particle field would visually alias into a misleading pattern at 60fps).
export const FREQUENCY_RANGE = new Range(100, 500); // Hz

// Default frequency chosen so lambda_default = c/250 ~= 1.37 m, showing ~2.9 full wavelengths across
// DOMAIN_LENGTH at launch - a moderate, clearly-multi-wavelength pattern (not crowded, not a single hump).
const DEFAULT_FREQUENCY = 250; // Hz

// Real amplitude constraint (enforced live, not just documented): neighboring particles must never
// overtake each other, i.e. the Lagrangian->Eulerian map x_equilibrium -> x_equilibrium + xi(x_equilibrium, t)
// must stay strictly increasing in x_equilibrium. With xi = xi_max*sin(kx-wt),
// d(xi)/dx_equilibrium = xi_max*k*cos(kx-wt), whose magnitude maxes out at xi_max*k. The map stays
// monotonic iff xi_max*k < 1, i.e. xi_max < 1/k = lambda/(2*pi).
export function strictAmplitudeBound(wavelength: number): number {
  return wavelength / (2 * Math.PI);
}

/**
 * The analogous amplitude-overtaking bound for SPHERICAL mode - STRICTER than strictAmplitudeBound
 * above, and NOT interchangeable with it (spherical mode must use this one, plane mode must keep using
 * strictAmplitudeBound - they are different formulas for a reason, not two names for the same thing).
 *
 * The same monotonicity requirement applies (the Lagrangian->Eulerian map
 * r_equilibrium -> r_equilibrium + xi_r(r_equilibrium,t) must stay strictly increasing in
 * r_equilibrium), but here xi_r(r,t) = xi_max(r0)*(r0/r)*sin(kr-wt) (see sphericalAmplitudeAtRadius)
 * varies with r THROUGH TWO channels, not one: the oscillating phase (kr-wt), same as the plane wave,
 * AND the amplitude's own 1/r falloff. Differentiating w.r.t. r_equilibrium therefore picks up a second
 * term (from d/dr[1/r] = -1/r^2) on top of the phase-gradient term k*cos(kr-wt) that alone produces the
 * plane-wave bound. Requiring the combined derivative's magnitude to stay below 1 everywhere - worst
 * case at r=r0, where the amplitude gradient's destabilizing contribution is largest relative to the
 * signal - yields:
 *
 *   xi_max(r0) < 1 / (k + 1/r0)
 *
 * (full worked derivation in the design review notes; the formula itself is settled and reproduced here
 * as-is). Two sanity limits, both verified in SoundWavesModel.test.ts: as sourceRadius -> infinity, the
 * 1/sourceRadius term vanishes and this bound approaches the plane-wave bound 1/k = strictAmplitudeBound
 * (a very large source looks locally planar, as expected); as sourceRadius -> 0, 1/sourceRadius
 * dominates and the bound shrinks toward 0 (right at a true point source, the amplitude gradient is
 * infinitely steep, so no nonzero amplitude at the source keeps the map monotonic there).
 */
export function strictRadialAmplitudeBound(wavelength: number, sourceRadius: number): number {
  return 1 / ((2 * Math.PI) / wavelength + 1 / sourceRadius);
}

// The UI-allowed amplitude max is capped at this fraction of the strict ordering bound above, not the
// strict bound itself. This leaves headroom so (a) floating-point error and the sampled/discrete
// particle grid (finite dx between rendered particles, not the infinitesimal spacing the ordering
// proof assumes) never visually reads as "touching/crossing" right at the edge of the allowed range,
// and (b) there is a clear, comfortable margin rather than a knife's-edge maximum. 0.7 was chosen to
// leave a substantial (30%) safety margin while still allowing a strong, pedagogically-obvious
// compression/rarefaction effect at the top of the amplitude range.
export const AMPLITUDE_SAFETY_FRACTION = 0.7;

// User testing asked for spherical mode to reach amplitudes "just as high" as the plane wave. Raising
// THIS fraction alone can't do that: strictRadialAmplitudeBound's extra 1/SPHERICAL_SOURCE_RADIUS term
// (see that function's own doc comment) is a GENUINE, physically-derived constraint - not an arbitrary
// limit - so the spherical cap stays below the plane cap regardless of the safety fraction used. What IS
// a safe, physics-preserving improvement: this sim's ordering proof requires strictly LESS than 1 at the
// boundary, and AMPLITUDE_SAFETY_FRACTION's own doc comment already explains 0.7 was a deliberately
// conservative choice (30% margin) shared by both modes. Since spherical mode's cap is smaller to begin
// with, it can afford to use a less conservative margin without meaningfully increasing the practical
// risk of a visually-touching edge case (the same discretization/floating-point concerns
// AMPLITUDE_SAFETY_FRACTION's doc comment describes scale with the ABSOLUTE amplitude value, which stays
// smaller here even at this less conservative fraction). Plane mode's own AMPLITUDE_SAFETY_FRACTION above
// is deliberately untouched. The REST of the gap (raising this fraction only recovers so much - e.g. at
// 250Hz even pushed to 0.95 the spherical cap is still only ~55% of the plane cap at the OLD
// SPHERICAL_SOURCE_RADIUS=0.15m) was closed separately by raising SPHERICAL_SOURCE_RADIUS itself (see
// that constant's own doc comment) once the user confirmed the resulting bigger point-source icon was an
// acceptable tradeoff.
export const SPHERICAL_AMPLITUDE_SAFETY_FRACTION = 0.85;

// Default amplitude (m, of the EXAGGERATED visualization - see the class doc and HowThisWorksDialog,
// not a real acoustic displacement). Chosen to stay comfortably under the live amplitude cap across
// the ENTIRE frequency range (the tightest cap, at FREQUENCY_RANGE.max, is
// AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(SPEED_OF_SOUND_ROOM_TEMPERATURE / FREQUENCY_RANGE.max)
// ~= 0.7 * 0.109 ~= 0.076 m) so dragging the frequency slider from the default never needs to
// auto-clamp the amplitude down from its default.
const DEFAULT_AMPLITUDE = 0.03; // m

// ---- Spherical mode ----

// Finite "source radius" (m) standing in for the point source in spherical mode - see the class doc's
// SPHERICAL MODE paragraph, and, more importantly, large enough that sphericalAmplitudeAtRadius/
// strictRadialAmplitudeBound below never have to divide by something close to zero.
//
// USER REQUEST: raised from 0.15m to 0.4m specifically to shrink the gap between spherical mode's
// amplitude cap and plane mode's - see SPHERICAL_AMPLITUDE_SAFETY_FRACTION's own doc comment for why
// raising that fraction alone could only ever close part of the gap (strictRadialAmplitudeBound's extra
// 1/SPHERICAL_SOURCE_RADIUS term dominates its denominator for any SMALL source radius, regardless of
// safety fraction). Increasing this constant instead directly shrinks that term - at the default 250 Hz,
// the spherical cap goes from ~41% of the plane cap (at the old 0.15m) to ~78% (at 0.4m); at
// FREQUENCY_RANGE.min=100Hz (the widest-gap end, since 1/r0 matters relatively more at longer
// wavelengths - see strictRadialAmplitudeBound's own doc comment) it goes from ~30% to ~51%. Tradeoff:
// PointSourceNode's icon radius (LoudspeakerNode.ts) is exactly SPHERICAL_SOURCE_RADIUS*pixelsPerMeter,
// so the "point" source's on-screen icon is correspondingly bigger too (~42px radius at Local zoom, up
// from ~16px) - a deliberate, accepted tradeoff, not an oversight.
export const SPHERICAL_SOURCE_RADIUS = 0.4; // m

// Default amplitude AT the source radius (m, exaggerated visualization, same convention as
// DEFAULT_AMPLITUDE) for spherical mode's sphericalAmplitudeProperty. Chosen the same way
// DEFAULT_AMPLITUDE was: comfortably under the tightest live cap (at FREQUENCY_RANGE.max), which for
// the STRICTER strictRadialAmplitudeBound (see below) is smaller than the plane wave's equivalent cap -
// still comfortably above this default (see SoundWavesModel.test.ts for the numeric check).
const DEFAULT_SPHERICAL_AMPLITUDE = 0.03; // m

/**
 * Spherical-wave amplitude at radius r, DERIVED from energy conservation (far-field approximation):
 * acoustic intensity I is proportional to (particle) amplitude squared, I ~ xi_max^2. For a spherically
 * expanding wavefront with no absorption, the total power crossing any enclosing sphere of radius r is
 * conserved: power = I(r) * (area of that sphere) = I(r) * 4*pi*r^2 = constant. So I(r) ~ 1/r^2, and
 * since I ~ xi_max(r)^2, taking the square root gives xi_max(r) ~ 1/r - NOT 1/r^2 (a common mix-up
 * between the INTENSITY law, which does go as 1/r^2, and the AMPLITUDE law, which goes as 1/r since
 * amplitude is intensity's square root). Anchoring the proportionality at the finite source radius r0
 * (see SPHERICAL_SOURCE_RADIUS), where the amplitude is amplitudeAtSourceRadius by definition:
 *
 *   xi_max(r) = amplitudeAtSourceRadius * r0 / r
 *
 * The Math.max(r, sourceRadius) clamp is defensive, not physical: without it, a query at r < r0 (inside
 * the finite source) would blow up toward infinity as r -> 0, which the finite-source-radius
 * approximation was specifically introduced to avoid (see the class doc's SPHERICAL MODE paragraph).
 * Queries at r <= r0 simply read back amplitudeAtSourceRadius unchanged.
 */
export function sphericalAmplitudeAtRadius(amplitudeAtSourceRadius: number, sourceRadius: number, r: number): number {
  return (amplitudeAtSourceRadius * sourceRadius) / Math.max(r, sourceRadius);
}

// How long (REAL, wall-clock seconds - see the class doc's PLAYBACK SPEED / RAMP-TIME INDEPENDENCE
// paragraph and unscaledElapsedTime's own field comment) a point's displayed amplitude takes to ramp
// from 0 to full once the wavefront reaches it, keyed to that point's own LOCAL elapsed active time
// (real time since ITS retarded time became non-negative) - avoids an instantaneous-onset discontinuity
// at the wavefront. Mirrors Standing Waves' DRIVE_RAMP_TIME (0.2-0.3s range).
//
// MUST-FIX (V3 physics review): this must be evaluated against UNSCALED wall-clock time, never scaled
// model time. Evaluating it against scaled model time (the pre-fix behavior) would make its REAL-world
// duration RAMP_TIME/timeScale - at ultraSlow (timeScale=0.001) that is ~250 real seconds (well over a
// hundred oscillation cycles at this sim's default frequency), defeating the entire point of Ultra Slow
// (watching a single clean cycle unfold slowly). See sampleAtRetardedDistance() for the fix itself.
const RAMP_TIME = 0.25; // s

// PhET convention for a "slow motion" TimeControlNode setting: run physics at 1/4 real-time speed.
const SLOW_MOTION_TIME_SCALE = 0.25;

// Ultra Slow (V3 addition): run physics at 1/1000 real-time speed - slow enough that a single oscillation
// cycle (period = 1/frequency of MODEL time; e.g. 4 ms at this sim's default 250 Hz) takes
// period/timeScale = 0.004/0.001 = 4 REAL seconds to unfold, comfortably watchable, rather than being
// imperceptibly fast the way it would be even at SLOW_MOTION_TIME_SCALE's more modest 1/4 speed.
const ULTRA_SLOW_TIME_SCALE = 0.001;

// Single lookup table driving BOTH sourcePhase's and simulationTime's per-step scaling (see step() below) -
// keeping them keyed off the SAME Record/Property means oscillation rate and propagation speed can never
// drift out of lockstep at any speed setting, by construction (there is only one place a speed setting maps
// to a numeric scale factor).
const TIME_SCALE_BY_SPEED: Record<PlaybackSpeed, number> = {
  normal: 1,
  slow: SLOW_MOTION_TIME_SCALE,
  ultraSlow: ULTRA_SLOW_TIME_SCALE,
};

// Defensive cap on a single step(dt)'s incoming dt, guarding against a stalled/backgrounded tab
// producing one huge dt on resume - mirrors Standing Waves' MAX_STEP_DT. A huge, unclamped dt here
// would also make the retarded-time history buffer's lookup window (sized for normal frame deltas)
// miss its coverage target.
const MAX_STEP_DT = 1 / 30;

// Fixed dt used by stepOnce() (the "step forward" button) - one nominal frame at a conventional 60fps,
// regardless of the display's actual refresh rate, so a manual step always advances a small, predictable
// amount.
const MANUAL_STEP_DT = 1 / 60;

// ---- Retarded-time history buffer sizing ----

// Conservative LOWER bound on any plausible speedOfSoundProperty value this sim might ever produce
// (including a future temperature dependence) - used ONLY to size the history buffer generously; it
// is never used in any wave-physics formula (those always read speedOfSoundProperty.value fresh).
const MIN_PLAUSIBLE_SPEED_OF_SOUND = 300; // m/s

// Conservative upper bound (m) on any distance this sim might ever query phaseAtTime() for - covers
// the widest "Field" zoom width (16 m, see ParticleFieldNode.ts's ViewZoom) plus headroom for
// spherical mode's farthest on-screen corner (a ring particle positioned diagonally from the source can
// sit slightly further from the source than the nominal visible radius). MUST-FIX (physics review):
// previously the buffer was sized off DOMAIN_LENGTH (the plane wave's fixed 4 m "Local view" width, see
// below), which silently under-covers once a query point can lie further away than that - zoom or
// spherical mode both do exactly this. Sizing off DOMAIN_LENGTH would not crash; phaseAtTime() has a
// defensive clamp (see its own comment) that returns a stale/incorrect-but-finite phase instead, which
// is worse than a crash because it fails silently. MAX_SUPPORTED_DISTANCE is deliberately independent
// of DOMAIN_LENGTH (which remains just the plane wave's default physical width, unrelated to buffer
// sizing) so the two concerns can never accidentally re-couple.
export const MAX_SUPPORTED_DISTANCE = 20; // m

// The buffer must cover at least MAX_SUPPORTED_DISTANCE / c_min seconds of MODEL time so phaseAtTime()'s
// retarded-distance lookup for the farthest point this sim can ever query never misses its window (doubled
// as a safety margin against dropped frames / a momentarily large dt) - AND (V3 mid-ramp-speed-switch fix)
// at least RAMP_TIME seconds of MODEL time so sampleAtRetardedDistance()'s exact real-time-since-arrival
// lookup never misses ITS window either: a point can still be mid-ramp for up to RAMP_TIME REAL seconds
// after arrival, and at normal speed (timeScale=1) that consumes up to RAMP_TIME seconds of MODEL time too
// (model time = real time there, the worst case across every speed since timeScale<=1 always) - if the
// buffer trimmed a point's arrival entry before its ramp could finish, the lookup would silently fall back
// to a stale (too-late) unscaledElapsedTime entry, UNDER-estimating real elapsed time and re-introducing a
// discontinuity right at the trim boundary - exactly the bug this fix exists to remove. Taking the max of
// the two independent requirements (not their sum - each only needs to be satisfied on its own), then
// doubling again for safety margin, comfortably covers both.
const REQUIRED_HISTORY_DURATION = Math.max((MAX_SUPPORTED_DISTANCE / MIN_PLAUSIBLE_SPEED_OF_SOUND) * 2, RAMP_TIME * 2); // ~0.5 s (RAMP_TIME*2 dominates over the ~0.133s distance-based term)

// ---- Pure physics helpers (exported for unit testing) ----

/** omega = 2*pi*f. */
export function angularFrequency(frequency: number): number {
  return 2 * Math.PI * frequency;
}

/** lambda = c/f. */
export function wavelength(speedOfSound: number, frequency: number): number {
  return speedOfSound / frequency;
}

/**
 * Smoothstep amplitude ramp, 0 at localElapsedActiveTime<=0, 1 at localElapsedActiveTime>=rampTime.
 * "Local elapsed active time" = time since THIS point's own retarded time became non-negative (i.e.
 * time since the wavefront reached it) - every point ramps up independently as the wavefront passes it.
 */
export function rampFactor(localElapsedActiveTime: number, rampTime: number): number {
  if (localElapsedActiveTime <= 0) {
    return 0;
  }
  if (localElapsedActiveTime >= rampTime) {
    return 1;
  }
  const s = localElapsedActiveTime / rampTime;
  return s * s * (3 - 2 * s); // smoothstep
}

/**
 * xi(x,t) via the retarded-phase substitution: with theta_source(t) integrated as
 * theta_source += omega*dt, and kx - wt = -theta_source(t - x/c) at the retarded time, so
 * xi = xi_max*sin(kx-wt) = -xi_max*sin(theta_retarded). See the class doc for the full derivation.
 */
export function displacementAtRetardedPhase(amplitude: number, ramp: number, retardedPhase: number): number {
  return -amplitude * ramp * Math.sin(retardedPhase);
}

/** u(x,t) = -w*xi_max*cos(kx-wt) = -w*xi_max*cos(theta_retarded) (cos is even, so cos(-a)=cos(a)). */
export function velocityAtRetardedPhase(amplitude: number, ramp: number, retardedPhase: number, omega: number): number {
  return -amplitude * ramp * omega * Math.cos(retardedPhase);
}

/** p' = rho*c*u - the specific acoustic impedance relation; kept as a single shared implementation so
 * p' and u can never accidentally drift out of their required exact-phase relationship. */
export function pressureFromVelocity(velocity: number, density: number, speedOfSound: number): number {
  return density * speedOfSound * velocity;
}

export type WaveSample = {
  displacement: number; // xi, m (exaggerated visualization amplitude)
  velocity: number; // u, m/s
  pressure: number; // p', Pa
};

// V3 fix: now a TRIPLE, not a pair - unscaledElapsedTime is recorded alongside phase at every push() so
// sampleAtRetardedDistance()'s amplitude ramp can look up the EXACT real (unscaled) time that was in effect
// at any past model time, not just an after-the-fact approximation - see the class doc's PLAYBACK SPEED /
// RAMP-TIME INDEPENDENCE paragraph and interpolateHistoryValue() below.
type PhaseSample = { time: number; phase: number; unscaledElapsedTime: number };

export class SoundWavesModel {
  // ---- User-settable Properties ----
  public readonly frequencyProperty: NumberProperty;
  public readonly amplitudeProperty: NumberProperty;
  // Amplitude AT the source radius (see SPHERICAL_SOURCE_RADIUS) for spherical mode - a SEPARATE
  // Property from amplitudeProperty (not reused) since the two modes have different amplitude-cap
  // formulas (strictAmplitudeBound vs. strictRadialAmplitudeBound) and are meant to be independently
  // adjustable/rememberable as a student switches propagationModeProperty back and forth.
  public readonly sphericalAmplitudeProperty: NumberProperty;
  public readonly propagationModeProperty: StringUnionProperty<PropagationMode>;
  public readonly isPlayingProperty: BooleanProperty;

  // 3-way physics playback speed - see PlaybackSpeed's own doc comment above for why this is a plain,
  // physics-only StringUnionProperty (same idiom as propagationModeProperty) rather than importing
  // scenery-phet's TimeSpeed into model code, and why (unlike the OLD isSlowMotionProperty this replaces)
  // the view now binds to it DIRECTLY with no bridging Property needed.
  public readonly playbackSpeedProperty: StringUnionProperty<PlaybackSpeed>;

  // Backing range Property for amplitudeProperty, kept in sync with frequencyProperty AND
  // speedOfSoundProperty (see NumberProperty's `range?: Range | Property<Range>` option) so the
  // amplitude slider's live max always tracks AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(lambda).
  private readonly amplitudeRangeProperty: Property<Range>;

  // Same pattern as amplitudeRangeProperty above, but for sphericalAmplitudeProperty, tracking
  // SPHERICAL_AMPLITUDE_SAFETY_FRACTION * strictRadialAmplitudeBound(lambda, SPHERICAL_SOURCE_RADIUS)
  // instead - see that constant's own doc comment for why spherical mode uses a DIFFERENT (less
  // conservative) safety fraction than plane mode's AMPLITUDE_SAFETY_FRACTION.
  private readonly sphericalAmplitudeRangeProperty: Property<Range>;

  // ---- Derived (read-only) Properties ----
  public readonly speedOfSoundProperty: TReadOnlyProperty<number>;
  public readonly wavelengthProperty: TReadOnlyProperty<number>;

  // ---- Non-Property sampled state (plain fields, mutated in place - matches Standing Waves'
  // Float64Array convention; a per-sample-point Property would be needlessly heavyweight). ----

  /** Evenly-spaced x positions (m) at which displacements/pressures below are cached, [0, DOMAIN_LENGTH]. */
  public readonly samplePositions: Float64Array;

  /** Current displacement xi (m) at each of samplePositions - recomputed every step(). */
  public readonly displacements: Float64Array;

  /** Current pressure variation p' (Pa) at each of samplePositions - recomputed every step(). */
  public readonly pressures: Float64Array;

  // ---- Retarded-time phase-accumulator state (plain fields, not Properties - see class doc) ----

  /** theta_source(t): integral of 2*pi*f(t')dt' from t'=0 to the current model time. */
  private sourcePhase = 0;

  /** Model's own clock (s), advanced only while playing - doubles as "time since driving started"
   * since (unlike Standing Waves) there is no separate driving on/off toggle here; the speaker is
   * always on, so driving started at model-time 0 by construction. SCALED by playbackSpeedProperty's
   * timeScale every step() (see step() below) - this is real simulated/model time, NOT wall-clock time. */
  private simulationTime = 0;

  /** WALL-CLOCK (real, UNSCALED) elapsed time since the sim started or was last reset - incremented by
   * the raw (clamped) dt passed to step(), NEVER by scaledDt/timeScale, so it advances at real-time speed
   * regardless of playbackSpeedProperty. Used by sampleAtRetardedDistance()'s amplitude-ramp calculation as
   * the CURRENT ("now") side of an EXACT real-elapsed-time-since-arrival lookup - the "at arrival" side
   * comes from phaseHistory's own recorded unscaledElapsedTime values (see that field's doc comment) - a
   * deliberate display-smoothing detail, not real acoustic physics, so it is correct for this one piece of
   * state to ignore timeScale entirely (see the class doc's PLAYBACK SPEED / RAMP-TIME INDEPENDENCE
   * paragraph). Never read by any of the actual wave-physics formulas (sourcePhase/simulationTime/
   * phaseHistory's phase field only). */
  private unscaledElapsedTime = 0;

  /** Short ring-buffer history of (time, phase, unscaledElapsedTime) triples, spanning at least
   * REQUIRED_HISTORY_DURATION of MODEL time, used to interpolate theta_source (phaseAtTime) at an arbitrary
   * point's retarded time, AND (V3 fix) to interpolate the EXACT unscaledElapsedTime that was in effect at
   * an arbitrary past model time (sampleAtRetardedDistance()'s amplitude-ramp calculation) - both via the
   * SAME interpolateHistoryValue() mechanism (and the same lowerBoundIndex() binary search), differing only
   * in which PhaseSample field they read. See REQUIRED_HISTORY_DURATION's own comment for why the buffer
   * must be sized to satisfy BOTH lookups' windows, not just the phase lookup's.
   *
   * SIZE, at extreme slow-down (V3 fix): REQUIRED_HISTORY_DURATION is a fixed amount of MODEL time, but
   * push() happens once per REAL frame regardless of playbackSpeedProperty - at ultraSlow (timeScale=
   * 0.001), covering that much model time takes ~1000x more real frames/entries than at Normal speed
   * (thousands of entries in steady state, since trimHistory() only evicts entries once the buffer's
   * OLDEST entry's MODEL time falls behind the required window, which itself takes ~1000x longer to happen
   * in frame-count terms at ultraSlow). This is NOT "unbounded" growth (trimHistory's model-time-window
   * eviction still caps it at a large-but-finite size), but a NAIVE per-lookup linear scan over an array
   * that size, repeated once per sample point per frame (hundreds of sample points across
   * ParticleFieldNode/PressureFieldNode/PressureGraphNode/CompressionTrackerNode), would be a genuine
   * per-frame perf cliff. FIX CHOSEN: keep the buffer's existing time-windowed sizing (still fully correct
   * at every speed, unlike capping entry COUNT independent of timeScale would be - see below), and instead
   * replace the linear scan with an O(log n) BINARY SEARCH (lowerBoundIndex() below) - the array is already
   * strictly time-ordered by construction (each push() appends a strictly increasing simulationTime), so
   * this is a minimal, localized change with no correctness tradeoff. This was chosen over capping the
   * array's raw entry COUNT (the spec's alternative option) because a count-based cap would, at ultraSlow,
   * cover LESS than REQUIRED_HISTORY_DURATION of model time - undercutting exactly the far-field queries
   * (up to MAX_SUPPORTED_DISTANCE) this buffer exists to serve correctly, the first time a student leaves
   * Ultra Slow running long enough for the wavefront to actually reach one. Binary search avoids that
   * tradeoff entirely: correctness never degrades at any speed, only the (now O(log n), not O(n)) lookup
   * cost is paid for a larger buffer. */
  private readonly phaseHistory: PhaseSample[] = [];

  public constructor() {
    this.frequencyProperty = new NumberProperty(DEFAULT_FREQUENCY, { range: FREQUENCY_RANGE });

    this.speedOfSoundProperty = DerivedProperty.deriveAny<number>([], () => SPEED_OF_SOUND_ROOM_TEMPERATURE);

    this.wavelengthProperty = new DerivedProperty([this.speedOfSoundProperty, this.frequencyProperty], (speedOfSound, frequency) => wavelength(speedOfSound, frequency));

    this.amplitudeRangeProperty = new Property(SoundWavesModel.computeAmplitudeRange(this.speedOfSoundProperty.value, DEFAULT_FREQUENCY));
    this.amplitudeProperty = new NumberProperty(DEFAULT_AMPLITUDE, {
      range: this.amplitudeRangeProperty,
    });

    this.sphericalAmplitudeRangeProperty = new Property(SoundWavesModel.computeSphericalAmplitudeRange(this.speedOfSoundProperty.value, DEFAULT_FREQUENCY));
    this.sphericalAmplitudeProperty = new NumberProperty(DEFAULT_SPHERICAL_AMPLITUDE, {
      range: this.sphericalAmplitudeRangeProperty,
    });

    this.propagationModeProperty = new StringUnionProperty<PropagationMode>("plane", {
      validValues: ["plane", "spherical"],
    });

    this.isPlayingProperty = new BooleanProperty(true);
    this.playbackSpeedProperty = new StringUnionProperty<PlaybackSpeed>("normal", {
      validValues: ["normal", "slow", "ultraSlow"],
    });

    // Keep the amplitude range tracking frequency and speed of sound live. When the bound shrinks,
    // clamp the current value into the (still-valid, about-to-shrink) old range FIRST - by setting it
    // to exactly the new (smaller) max while amplitudeRangeProperty still holds the OLD (wider) range
    // - so NumberProperty's own value/range validation never observes an inconsistent intermediate
    // state. Mirrors StandingWavesModel's drivingAmplitudeProperty/lengthProperty pattern exactly.
    const updateAmplitudeRange = (): void => {
      const newRange = SoundWavesModel.computeAmplitudeRange(this.speedOfSoundProperty.value, this.frequencyProperty.value);
      if (this.amplitudeProperty.value > newRange.max) {
        this.amplitudeProperty.value = newRange.max;
      }
      this.amplitudeRangeProperty.value = newRange;
    };
    this.frequencyProperty.lazyLink(updateAmplitudeRange);
    // speedOfSoundProperty never changes today (see its DerivedProperty comment above), but this link
    // is required now so a future temperature-dependent c automatically keeps the amplitude bound
    // correct with no other code changes.
    this.speedOfSoundProperty.lazyLink(updateAmplitudeRange);

    // Identical clamp-old-range-first-then-install-new-range pattern for the spherical amplitude cap.
    const updateSphericalAmplitudeRange = (): void => {
      const newRange = SoundWavesModel.computeSphericalAmplitudeRange(this.speedOfSoundProperty.value, this.frequencyProperty.value);
      if (this.sphericalAmplitudeProperty.value > newRange.max) {
        this.sphericalAmplitudeProperty.value = newRange.max;
      }
      this.sphericalAmplitudeRangeProperty.value = newRange;
    };
    this.frequencyProperty.lazyLink(updateSphericalAmplitudeRange);
    this.speedOfSoundProperty.lazyLink(updateSphericalAmplitudeRange);

    const pointCount = PRESSURE_SAMPLE_COUNT;
    this.samplePositions = new Float64Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      this.samplePositions[i] = (i / (pointCount - 1)) * DOMAIN_LENGTH;
    }
    this.displacements = new Float64Array(pointCount);
    this.pressures = new Float64Array(pointCount);

    this.phaseHistory.push({ time: 0, phase: 0, unscaledElapsedTime: 0 });
  }

  private static computeAmplitudeRange(speedOfSound: number, frequency: number): Range {
    const lambda = wavelength(speedOfSound, frequency);
    return new Range(0, AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(lambda));
  }

  private static computeSphericalAmplitudeRange(speedOfSound: number, frequency: number): Range {
    const lambda = wavelength(speedOfSound, frequency);
    return new Range(0, SPHERICAL_AMPLITUDE_SAFETY_FRACTION * strictRadialAmplitudeBound(lambda, SPHERICAL_SOURCE_RADIUS));
  }

  /**
   * Samples xi/u/p' at equilibrium position x (m) along the PLANE wave, at the model's CURRENT time -
   * the public read API the view uses for arbitrary x (e.g. the loudspeaker at x=0, each particle's own
   * equilibrium x). Routes through the shared sampleAtRetardedDistance() helper below (see also
   * sampleAtRadius(), spherical mode's equivalent) so all three physical quantities - and every
   * consumer of them, in either mode - can never drift out of sync with each other.
   */
  public sampleAt(x: number): WaveSample {
    const retardedTime = this.simulationTime - x / this.speedOfSoundProperty.value;
    return this.sampleAtRetardedDistance(retardedTime, this.amplitudeProperty.value);
  }

  /**
   * Samples xi_r/u_r/p' at radius r (m) from the point source in SPHERICAL mode, at the model's CURRENT
   * time - spherical mode's counterpart to sampleAt(x) above. The only physics difference from the
   * plane wave is the amplitude fed into the shared helper: here it is sphericalAmplitudeAtRadius(...)
   * (the 1/r far-field falloff, anchored at SPHERICAL_SOURCE_RADIUS), computed fresh for THIS r, rather
   * than the plane wave's constant amplitudeProperty.value. The retarded-time/phase/ramp machinery
   * (sampleAtRetardedDistance, phaseAtTime, rampFactor) is IDENTICAL between the two modes.
   */
  public sampleAtRadius(r: number): WaveSample {
    const retardedTime = this.simulationTime - r / this.speedOfSoundProperty.value;
    const amplitudeAtThisRadius = sphericalAmplitudeAtRadius(this.sphericalAmplitudeProperty.value, SPHERICAL_SOURCE_RADIUS, r);
    return this.sampleAtRetardedDistance(retardedTime, amplitudeAtThisRadius);
  }

  /**
   * Shared low-level sample: given a retarded time (t - distance/c, already computed by the caller for
   * either a plane x or a spherical r) and the amplitude that applies AT that distance (constant for the
   * plane wave, r-dependent for the spherical wave - see sampleAt()/sampleAtRadius() above), runs the
   * SAME ramp/phase/displacement/velocity/pressure computation either mode uses. This is the one place
   * that machinery lives; sampleAt() and sampleAtRadius() differ only in what retarded distance and
   * amplitude they hand in.
   */
  private sampleAtRetardedDistance(retardedTime: number, amplitudeAtThisDistance: number): WaveSample {
    if (retardedTime <= 0) {
      // The wavefront hasn't reached this distance yet - simply at rest. This is the physical wavefront
      // falling naturally out of the retarded-time lookup, not a special case. NOTE: this gating check
      // stays on the real (scaled) retardedTime/simulationTime - only the RAMP below (once we're past this
      // check) uses the separate unscaled clock. A point never appears active before the wavefront has
      // physically reached it, at any playback speed.
      return { displacement: 0, velocity: 0, pressure: 0 };
    }

    const speedOfSound = this.speedOfSoundProperty.value;
    const retardedPhase = this.phaseAtTime(retardedTime);
    const omega = angularFrequency(this.frequencyProperty.value);

    // RAMP (V3 fix, re-fixed for mid-ramp speed switches - see the class doc's PLAYBACK SPEED / RAMP-TIME
    // INDEPENDENCE paragraph for the full history of this fix): rampFactor() must be fed REAL (unscaled)
    // elapsed time since THIS point's own wavefront arrival, not the scaled model-time retardedTime itself.
    //
    // retardedTime is elapsed MODEL time since arrival (by definition: the wavefront arrives at absolute
    // model-time distance/c, i.e. when retardedTime crosses 0, so retardedTime = simulationTime - distance/c
    // = (now) - (arrival) IS elapsed model-time-since-arrival, and it is used exactly this way as an
    // absolute model-time coordinate into phaseHistory by phaseAtTime() above). this.simulationTime -
    // retardedTime is therefore the ABSOLUTE model time at which THIS point's retardedTime itself crossed 0
    // - i.e. the model time of its wavefront's arrival. Looking up phaseHistory's recorded
    // unscaledElapsedTime AT that model time (via the same interpolateHistoryValue() lookup phaseAtTime()
    // uses for phase, just reading a different field) gives the EXACT wall-clock time at which this point's
    // ramp began; subtracting that from the CURRENT unscaledElapsedTime gives the point's EXACT real-time-
    // since-arrival, regardless of any playbackSpeedProperty changes that happened after arrival - unlike
    // the old retardedTime/(CURRENT timeScale) approximation this replaces, which was only exact if the
    // speed never changed since arrival, and otherwise produced a one-frame amplitude discontinuity in BOTH
    // directions right at a mid-ramp speed switch (the "sanity ceiling" that used to clamp this did not
    // actually guard the fast->slow direction, despite its old doc comment's claim). No clamp/ceiling is
    // needed any more: this lookup is exact, not an approximation, by construction (arrival's
    // unscaledElapsedTime can never exceed the current one, since both are read from the same monotonically
    // non-decreasing accumulator).
    const arrivalModelTime = this.simulationTime - retardedTime;
    const unscaledElapsedTimeAtArrival = this.interpolateHistoryValue(arrivalModelTime, (sample) => sample.unscaledElapsedTime);
    const realTimeSinceArrival = this.unscaledElapsedTime - unscaledElapsedTimeAtArrival;
    const ramp = rampFactor(realTimeSinceArrival, RAMP_TIME);

    const displacement = displacementAtRetardedPhase(amplitudeAtThisDistance, ramp, retardedPhase);
    const velocity = velocityAtRetardedPhase(amplitudeAtThisDistance, ramp, retardedPhase, omega);
    const pressure = pressureFromVelocity(velocity, AIR_DENSITY, speedOfSound);

    return { displacement, velocity, pressure };
  }

  /** Interpolates an arbitrary recorded PhaseSample field at (absolute, model-time) t from the phase
   * history buffer. Uses an O(log n) BINARY SEARCH (lowerBoundIndex(), below) rather than a linear scan -
   * see phaseHistory's own doc comment for why this matters once the buffer grows large at slow playback
   * speeds: this is what keeps the per-frame cost from scaling with buffer size, however large ultraSlow's
   * steady-state buffer gets. Shared by phaseAtTime() (interpolates .phase) and
   * sampleAtRetardedDistance()'s exact ramp lookup (interpolates .unscaledElapsedTime, V3 fix) - both go
   * through the exact same bracket-and-interpolate logic, so they can never drift out of sync in HOW a
   * historical time is resolved, only in WHICH field they read. */
  private interpolateHistoryValue(t: number, valueOf: (sample: PhaseSample) => number): number {
    const history = this.phaseHistory;
    const first = history[0];
    if (t <= first.time) {
      return valueOf(first); // defensive clamp - shouldn't normally be reached, see REQUIRED_HISTORY_DURATION
    }

    const index = this.lowerBoundIndex(t); // first entry with entry.time >= t
    if (index >= history.length) {
      // t is beyond the most recent recorded sample. Callers only ever query times <= simulationTime, and
      // the most recent history entry's time IS simulationTime, so this is unreachable in normal operation -
      // kept only as a defensive fallback.
      return valueOf(history[history.length - 1]);
    }

    const sample = history[index];
    if (index === 0) {
      // t <= first.time would already have returned above, so index===0 here only if t exactly equals
      // first.time due to floating-point edge cases - either way, no earlier bracket exists to interpolate
      // from.
      return valueOf(sample);
    }
    const previous = history[index - 1];
    const span = sample.time - previous.time;
    const fraction = span > 0 ? (t - previous.time) / span : 0;
    return valueOf(previous) + fraction * (valueOf(sample) - valueOf(previous));
  }

  /** Interpolates theta_source at (absolute, model-time) t from the phase history buffer - see
   * interpolateHistoryValue() above, which this delegates to. */
  private phaseAtTime(t: number): number {
    return this.interpolateHistoryValue(t, (sample) => sample.phase);
  }

  /** Binary search for the index of the first phaseHistory entry with entry.time >= t (the standard
   * "lower bound" search). Valid because phaseHistory is strictly time-ordered by construction - each
   * step() appends a single new entry with a strictly larger simulationTime than the previous one, and
   * trimHistory() only ever removes entries from the front. Returns history.length if every entry's time
   * is < t. O(log n), replacing the OLD O(n) linear scan - see phaseHistory's own doc comment for why this
   * is required once the buffer grows large at slow playback speeds. */
  private lowerBoundIndex(t: number): number {
    const history = this.phaseHistory;
    let low = 0;
    let high = history.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (history[mid].time < t) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  /** Drops history entries older than needed to cover REQUIRED_HISTORY_DURATION, keeping at least 2
   * entries (a floor and a ceiling) so phaseAtTime() always has a bracket to interpolate within. */
  private trimHistory(): void {
    const cutoff = this.simulationTime - REQUIRED_HISTORY_DURATION;
    while (this.phaseHistory.length > 2 && this.phaseHistory[1].time <= cutoff) {
      this.phaseHistory.shift();
    }
  }

  /** A PLANE-wave-only cache over the fixed [0, DOMAIN_LENGTH] range, unaffected by propagationModeProperty
   * or view-owned zoom. NO LONGER read by PressureGraphNode.ts (which now samples model.sampleAt(x) directly
   * at its own zoom-aware positions - see that file's own doc comment for why the fixed-Local-scale version
   * of this cache stopped being correct once zoom was added to the pressure graph) - retained only for
   * SoundWavesModel.test.ts's existing coverage of samplePositions/displacements/pressures. */
  private recomputeSamples(): void {
    for (let i = 0; i < this.samplePositions.length; i++) {
      const sample = this.sampleAt(this.samplePositions[i]);
      this.displacements[i] = sample.displacement;
      this.pressures[i] = sample.pressure;
    }
  }

  /**
   * Advances the source phase accumulator and re-samples xi/p' across the domain. Does nothing while
   * paused. Joist calls this automatically once per frame - see the confirmed stepping architecture in
   * the scenerystack skill's architecture.md; never call this from a view.
   */
  public step(dt: number): void {
    if (!this.isPlayingProperty.value) {
      return;
    }

    this.advance(dt);
  }

  /**
   * Advances by exactly one nominal frame (MANUAL_STEP_DT), bypassing the isPlayingProperty gate -
   * for the "step forward" button, which is only enabled while paused (see PlayPauseStepButtonGroup's
   * default stepButtonEnabledProperty) and needs to advance a single frame on demand regardless.
   */
  public stepOnce(): void {
    this.advance(MANUAL_STEP_DT);
  }

  /** Shared advancement logic between the gated per-frame step() and the ungated manual stepOnce(). */
  private advance(dt: number): void {
    // Clamp FIRST (defensive against a stalled/backgrounded tab, see MAX_STEP_DT), then derive both the
    // scaled (physics) dt and the unscaled (wall-clock) dt from the SAME clamped value - so a single
    // shared clock genuinely drives sourcePhase, simulationTime, AND unscaledElapsedTime; timeScale is the
    // ONLY thing that ever distinguishes "scaled" from "unscaled" time, never a second, independently
    // clamped/derived dt.
    const clampedDt = Math.min(dt, MAX_STEP_DT);
    if (!(clampedDt > 0)) {
      return;
    }

    const timeScale = TIME_SCALE_BY_SPEED[this.playbackSpeedProperty.value];
    const scaledDt = clampedDt * timeScale;

    // UNSCALED - see unscaledElapsedTime's own field comment. Deliberately uses clampedDt directly, never
    // scaledDt, so this always advances at real wall-clock speed regardless of playbackSpeedProperty.
    this.unscaledElapsedTime += clampedDt;

    // Integrated over the frame using the CURRENT frequency value - an integral, not theta = omega*t
    // from a fixed start, so a mid-simulation frequency change is handled correctly (see class doc). Both
    // sourcePhase and simulationTime use the SAME scaledDt, so oscillation rate and propagation speed stay
    // locked together at every playback speed (see the class doc's PLAYBACK SPEED / RAMP-TIME
    // INDEPENDENCE paragraph).
    this.sourcePhase += angularFrequency(this.frequencyProperty.value) * scaledDt;
    this.simulationTime += scaledDt;

    this.phaseHistory.push({ time: this.simulationTime, phase: this.sourcePhase, unscaledElapsedTime: this.unscaledElapsedTime });
    this.trimHistory();

    this.recomputeSamples();
  }

  public reset(): void {
    this.frequencyProperty.reset(); // also restores amplitudeRangeProperty/sphericalAmplitudeRangeProperty via their lazyLinks, above
    this.amplitudeProperty.reset();
    this.sphericalAmplitudeProperty.reset();
    this.propagationModeProperty.reset();
    this.isPlayingProperty.reset();
    this.playbackSpeedProperty.reset();

    // Shared accumulator/history/clock state - resetting it once here correctly restores BOTH modes
    // (sampleAt and sampleAtRadius both read the same sourcePhase/simulationTime/phaseHistory), not just
    // whichever mode happens to be active.
    this.sourcePhase = 0;
    this.simulationTime = 0;
    this.unscaledElapsedTime = 0;
    this.phaseHistory.length = 0;
    this.phaseHistory.push({ time: 0, phase: 0, unscaledElapsedTime: 0 });

    this.displacements.fill(0);
    this.pressures.fill(0);
  }
}
