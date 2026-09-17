import { describe, expect, it } from "vitest";
import { enableAssert } from "scenerystack/assert";
import {
  AIR_DENSITY,
  AMPLITUDE_SAFETY_FRACTION,
  DOMAIN_LENGTH,
  FREQUENCY_RANGE,
  MAX_SUPPORTED_DISTANCE,
  PRESSURE_SAMPLE_COUNT,
  PROBE_POSITION_METERS,
  SPHERICAL_SOURCE_RADIUS,
  SoundWavesModel,
  angularFrequency,
  displacementAtRetardedPhase,
  pressureFromVelocity,
  rampFactor,
  sphericalAmplitudeAtRadius,
  strictAmplitudeBound,
  strictRadialAmplitudeBound,
  velocityAtRetardedPhase,
  wavelength,
} from "./SoundWavesModel.js";
import type { PlaybackSpeed } from "./SoundWavesModel.js";

// Property range violations only throw once assertions are enabled (see
// node_modules/scenerystack/src/axon/js/validate.ts) - enableAssert() does this during the dev
// bootstrap chain in a real sim; here we do it explicitly, once, for this file.
enableAssert();

describe("angularFrequency / wavelength", () => {
  it("omega = 2*pi*f", () => {
    expect(angularFrequency(1)).toBeCloseTo(2 * Math.PI, 10);
    expect(angularFrequency(250)).toBeCloseTo(500 * Math.PI, 10);
  });

  it("lambda = c/f", () => {
    expect(wavelength(343, 343)).toBeCloseTo(1, 10);
    expect(wavelength(343, 250)).toBeCloseTo(343 / 250, 10);
  });
});

describe("rampFactor", () => {
  it("is 0 at or before local elapsed active time 0", () => {
    expect(rampFactor(0, 0.25)).toBe(0);
    expect(rampFactor(-1, 0.25)).toBe(0);
  });

  it("is 1 at or after the ramp time", () => {
    expect(rampFactor(0.25, 0.25)).toBe(1);
    expect(rampFactor(10, 0.25)).toBe(1);
  });

  it("is monotonically increasing and smooth (smoothstep) in between", () => {
    const a = rampFactor(0.05, 0.25);
    const b = rampFactor(0.125, 0.25);
    const c = rampFactor(0.2, 0.25);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(1);
    expect(b).toBeCloseTo(0.5, 10); // smoothstep(0.5) = 0.5 exactly
  });
});

describe("strictAmplitudeBound", () => {
  it("equals lambda / (2*pi)", () => {
    expect(strictAmplitudeBound(2 * Math.PI)).toBeCloseTo(1, 10);
    expect(strictAmplitudeBound(1)).toBeCloseTo(1 / (2 * Math.PI), 10);
  });
});

describe("retarded-phase formulas match hand-computed sin/cos values", () => {
  // With ramp=1 (fully ramped), displacementAtRetardedPhase/velocityAtRetardedPhase/pressureFromVelocity
  // should exactly match the textbook xi = xi_max*sin(kx-wt), u = -w*xi_max*cos(kx-wt), p' = rho*c*u
  // formulas, using the retarded-phase substitution theta_retarded = wt - kx (so kx-wt = -theta_retarded).
  const amplitude = 0.02;
  const omega = 2 * Math.PI * 200; // rad/s
  const speedOfSound = 343;
  const k = omega / speedOfSound;

  it.each([0, Math.PI / 6, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 5.1])("matches sin/cos formulas at theta_retarded=%f", (thetaRetarded) => {
    const kxMinusWt = -thetaRetarded;

    const expectedDisplacement = amplitude * Math.sin(kxMinusWt);
    const actualDisplacement = displacementAtRetardedPhase(amplitude, 1, thetaRetarded);
    expect(actualDisplacement).toBeCloseTo(expectedDisplacement, 10);

    const expectedVelocity = -omega * amplitude * Math.cos(kxMinusWt);
    const actualVelocity = velocityAtRetardedPhase(amplitude, 1, thetaRetarded, omega);
    expect(actualVelocity).toBeCloseTo(expectedVelocity, 10);

    const expectedPressure = -AIR_DENSITY * speedOfSound * speedOfSound * k * amplitude * Math.cos(kxMinusWt);
    const actualPressure = pressureFromVelocity(actualVelocity, AIR_DENSITY, speedOfSound);
    expect(actualPressure).toBeCloseTo(expectedPressure, 6);
  });

  it("ramp scales displacement/velocity/pressure identically (quasi-steady ramp assumption)", () => {
    const thetaRetarded = 1.2;
    const full = displacementAtRetardedPhase(amplitude, 1, thetaRetarded);
    const half = displacementAtRetardedPhase(amplitude, 0.5, thetaRetarded);
    expect(half).toBeCloseTo(full * 0.5, 10);
  });
});

/** Steps a fresh model forward by totalTime using many small dt steps (fine enough that phase
 * accumulation and retarded-time interpolation are effectively exact for constant frequency). */
function stepModel(model: SoundWavesModel, totalTime: number, dt = 1 / 1000): void {
  const steps = Math.round(totalTime / dt);
  for (let i = 0; i < steps; i++) {
    model.step(dt);
  }
}

describe("SoundWavesModel construction and defaults", () => {
  it("starts at rest (no time has passed yet) and playing", () => {
    const model = new SoundWavesModel();
    expect(model.isPlayingProperty.value).toBe(true);
    expect(model.playbackSpeedProperty.value).toBe("normal");
    for (const xi of model.displacements) {
      expect(xi).toBe(0);
    }
    for (const p of model.pressures) {
      expect(p).toBe(0);
    }
    const sample = model.sampleAt(0);
    expect(sample.displacement).toBe(0);
    expect(sample.velocity).toBe(0);
    expect(sample.pressure).toBe(0);
  });

  it("has PRESSURE_SAMPLE_COUNT evenly-spaced sample positions spanning [0, DOMAIN_LENGTH]", () => {
    const model = new SoundWavesModel();
    expect(model.samplePositions.length).toBe(PRESSURE_SAMPLE_COUNT);
    expect(model.samplePositions[0]).toBe(0);
    expect(model.samplePositions[PRESSURE_SAMPLE_COUNT - 1]).toBeCloseTo(DOMAIN_LENGTH, 10);
  });

  it("PROBE_POSITION_METERS sits strictly inside [0, DOMAIN_LENGTH] and is sampleable", () => {
    expect(PROBE_POSITION_METERS).toBeGreaterThan(0);
    expect(PROBE_POSITION_METERS).toBeLessThan(DOMAIN_LENGTH);
    const model = new SoundWavesModel();
    const sample = model.sampleAt(PROBE_POSITION_METERS);
    expect(Number.isFinite(sample.pressure)).toBe(true);
  });

  it("default frequency is within FREQUENCY_RANGE and default amplitude is within its live cap", () => {
    const model = new SoundWavesModel();
    expect(FREQUENCY_RANGE.contains(model.frequencyProperty.value)).toBe(true);
    expect(model.amplitudeProperty.value).toBeLessThanOrEqual(model.amplitudeProperty.range.max);
  });
});

describe("Property range validation (assertions enabled)", () => {
  it("rejects a frequency outside FREQUENCY_RANGE", () => {
    const model = new SoundWavesModel();
    expect(() => {
      model.frequencyProperty.value = FREQUENCY_RANGE.max + 1000;
    }).toThrow();
  });

  it("rejects an amplitude above the live cap", () => {
    const model = new SoundWavesModel();
    const cap = model.amplitudeProperty.range.max;
    expect(() => {
      model.amplitudeProperty.value = cap + 1;
    }).toThrow();
  });
});

describe("lambda = c/f, and frequency/amplitude/c are independent", () => {
  it("wavelengthProperty tracks c/f and does not change when amplitude changes", () => {
    const model = new SoundWavesModel();
    const before = model.wavelengthProperty.value;
    expect(before).toBeCloseTo(model.speedOfSoundProperty.value / model.frequencyProperty.value, 10);

    model.amplitudeProperty.value = model.amplitudeProperty.range.min;
    expect(model.wavelengthProperty.value).toBeCloseTo(before, 10);
    expect(model.speedOfSoundProperty.value).toBe(343);
  });

  it("changing frequency changes wavelength but not speed of sound", () => {
    const model = new SoundWavesModel();
    const speedBefore = model.speedOfSoundProperty.value;
    model.frequencyProperty.value = FREQUENCY_RANGE.min;
    expect(model.wavelengthProperty.value).toBeCloseTo(model.speedOfSoundProperty.value / FREQUENCY_RANGE.min, 10);
    expect(model.speedOfSoundProperty.value).toBe(speedBefore);
  });
});

describe("amplitude range constraint tracks frequency live", () => {
  it("shrinks the amplitude cap as frequency increases, and clamps an out-of-range value down", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = FREQUENCY_RANGE.min; // widest possible cap
    const capAtMinFrequency = model.amplitudeProperty.range.max;
    const valueValidAtMinFrequency = capAtMinFrequency * 0.9;
    model.amplitudeProperty.value = valueValidAtMinFrequency;
    expect(model.amplitudeProperty.value).toBeCloseTo(valueValidAtMinFrequency, 10);

    model.frequencyProperty.value = FREQUENCY_RANGE.max; // narrowest cap - old value now invalid
    const capAtMaxFrequency = model.amplitudeProperty.range.max;
    expect(capAtMaxFrequency).toBeLessThan(capAtMinFrequency);
    expect(model.amplitudeProperty.value).toBeLessThanOrEqual(capAtMaxFrequency + 1e-12);
  });

  it("cap exactly equals AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(wavelength) at the current frequency", () => {
    const model = new SoundWavesModel();
    const expectedCap = AMPLITUDE_SAFETY_FRACTION * strictAmplitudeBound(model.wavelengthProperty.value);
    expect(model.amplitudeProperty.range.max).toBeCloseTo(expectedCap, 10);
  });
});

describe("closed-form traveling wave matches xi(x,t) = xi_max*sin(kx-wt) once ramped and past the wavefront", () => {
  it("matches at a representative point for xi, u, and p'", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 200; // Hz, within range
    model.amplitudeProperty.value = 0.02; // well within the live cap at 200 Hz

    const x = 1.0; // m
    const totalTime = 0.6; // s - well past both the ramp time and the wavefront travel time to x=1m

    stepModel(model, totalTime);

    const speedOfSound = model.speedOfSoundProperty.value;
    const omega = angularFrequency(model.frequencyProperty.value);
    const k = omega / speedOfSound;
    const t = totalTime;

    const expectedDisplacement = model.amplitudeProperty.value * Math.sin(k * x - omega * t);
    const expectedVelocity = -omega * model.amplitudeProperty.value * Math.cos(k * x - omega * t);
    const expectedPressure = AIR_DENSITY * speedOfSound * expectedVelocity;

    const sample = model.sampleAt(x);
    expect(sample.displacement).toBeCloseTo(expectedDisplacement, 4);
    expect(sample.velocity).toBeCloseTo(expectedVelocity, 2);
    expect(sample.pressure).toBeCloseTo(expectedPressure, 0);
  });
});

describe("phase relationship: pressure extrema occur at displacement ZERO-CROSSINGS, not displacement peaks", () => {
  it("the sample point with max |displacement| has near-zero pressure, and vice versa", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 200;
    stepModel(model, 0.6); // ramped, and the wavefront has swept the whole domain (0.6s >> 4m/343m/s)

    let maxDisplacementIndex = 0;
    let maxPressureIndex = 0;
    for (let i = 1; i < model.displacements.length; i++) {
      if (Math.abs(model.displacements[i]) > Math.abs(model.displacements[maxDisplacementIndex])) {
        maxDisplacementIndex = i;
      }
      if (Math.abs(model.pressures[i]) > Math.abs(model.pressures[maxPressureIndex])) {
        maxPressureIndex = i;
      }
    }

    const maxDisplacementMagnitude = Math.abs(model.displacements[maxDisplacementIndex]);
    const maxPressureMagnitude = Math.abs(model.pressures[maxPressureIndex]);

    // At the point of maximum |displacement|, pressure should be a small fraction of its own peak.
    expect(Math.abs(model.pressures[maxDisplacementIndex])).toBeLessThan(0.1 * maxPressureMagnitude);
    // At the point of maximum |pressure|, displacement should be a small fraction of its own peak.
    expect(Math.abs(model.displacements[maxPressureIndex])).toBeLessThan(0.1 * maxDisplacementMagnitude);
  });
});

describe("phase relationship: u and p' are exactly in phase (same sign, proportional by rho*c)", () => {
  it("holds at multiple sampled points once ramped and past the wavefront", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 300;
    stepModel(model, 0.6);

    const speedOfSound = model.speedOfSoundProperty.value;
    let checkedAtLeastOneNonZeroPoint = false;
    for (let x = 0.2; x < DOMAIN_LENGTH; x += 0.3) {
      const sample = model.sampleAt(x);
      if (Math.abs(sample.velocity) < 1e-9) {
        continue; // skip the rare near-zero-crossing sample where sign comparison is meaningless
      }
      checkedAtLeastOneNonZeroPoint = true;
      expect(Math.sign(sample.pressure)).toBe(Math.sign(sample.velocity));
      expect(sample.pressure).toBeCloseTo(AIR_DENSITY * speedOfSound * sample.velocity, 6);
    }
    expect(checkedAtLeastOneNonZeroPoint).toBe(true);
  });
});

describe("no net drift: displacement stays bounded within [-xi_max, xi_max] over a long run", () => {
  it("never exceeds the current amplitude, sampled at many points over many steps", () => {
    // This bound holds by algebraic construction (|amplitude*ramp*sin(theta)| <= amplitude for ANY
    // theta), so on its own it's a regression guard against NaN/an incrementally-integrated position
    // - it would pass even if the phase accumulator itself had drifted. The second test below
    // (closed-form cross-check) is what actually exercises long-run phase-accumulator correctness.
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 250;

    const x = 0.5;
    let maxObserved = 0;
    for (let i = 0; i < 3000; i++) {
      model.step(1 / 60);
      const sample = model.sampleAt(x);
      maxObserved = Math.max(maxObserved, Math.abs(sample.displacement));
      expect(Math.abs(sample.displacement)).toBeLessThanOrEqual(model.amplitudeProperty.value + 1e-9);
    }
    // Sanity: the particle actually moved substantially (not trivially bounded because it never moved).
    expect(maxObserved).toBeGreaterThan(model.amplitudeProperty.value * 0.5);
  });

  it("phase accumulator matches the closed-form formula after thousands of steps (no accumulated drift)", () => {
    // At constant frequency, integrating theta += omega*dt every step should equal omega*t exactly
    // (up to floating-point rounding) even after thousands of steps. This is the test that would
    // actually catch phase-accumulator drift - unlike the bound check above, it fails if theta drifts
    // away from the true omega*t, even though the bounded-sine algebra would still "pass" a bad theta.
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 250;
    const omega = 2 * Math.PI * model.frequencyProperty.value;
    const c = model.speedOfSoundProperty.value;
    const x = 0.5;
    const dt = 1 / 60;

    let elapsed = 0;
    for (let i = 0; i < 3000; i++) {
      model.step(dt);
      elapsed += dt;
    }

    const retardedTime = elapsed - x / c;
    const rampDuration = 0.25; // matches the model's private RAMP_TIME constant; ramp is long complete by t=50s
    const expectedDisplacement = -model.amplitudeProperty.value * Math.sin(omega * retardedTime);
    expect(retardedTime).toBeGreaterThan(rampDuration * 10); // confirm we're well past the ramp

    const actual = model.sampleAt(x).displacement;
    expect(actual).toBeCloseTo(expectedDisplacement, 3);
  });
});

describe("retarded-time / finite propagation speed", () => {
  it("a point far from the source stays at rest until roughly x/c has elapsed", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 200;
    const x = 3.0; // m, near the far edge of the domain
    const speedOfSound = model.speedOfSoundProperty.value;
    const travelTime = x / speedOfSound; // ~0.00875 s

    const dt = 1 / 2000;
    let elapsed = 0;
    let sawMotionEarly = false;
    // Stop just before the wavefront should arrive.
    while (elapsed < travelTime * 0.5) {
      model.step(dt);
      elapsed += dt;
      if (Math.abs(model.sampleAt(x).displacement) > 1e-12) {
        sawMotionEarly = true;
        break;
      }
    }
    expect(sawMotionEarly).toBe(false);

    // Continue well past the travel time (plus the ramp time, so the motion is clearly non-negligible).
    let sawMotionLate = false;
    const lateStopTime = travelTime + 0.05;
    while (elapsed < lateStopTime) {
      model.step(dt);
      elapsed += dt;
      if (Math.abs(model.sampleAt(x).displacement) > 1e-6) {
        sawMotionLate = true;
        break;
      }
    }
    expect(sawMotionLate).toBe(true);
  });
});

describe("play/pause freezes the whole simulation", () => {
  it("stepping while paused does not change the sampled arrays", () => {
    const model = new SoundWavesModel();
    stepModel(model, 0.3);
    model.isPlayingProperty.value = false;

    const snapshotDisplacements = Array.from(model.displacements);
    const snapshotPressures = Array.from(model.pressures);
    for (let i = 0; i < 200; i++) {
      model.step(1 / 60);
    }
    expect(Array.from(model.displacements)).toEqual(snapshotDisplacements);
    expect(Array.from(model.pressures)).toEqual(snapshotPressures);
  });
});

describe("defensive dt clamp", () => {
  it("tolerates a single very large dt (e.g. a backgrounded tab) without producing NaN", () => {
    const model = new SoundWavesModel();
    model.step(5); // far larger than any reasonable frame delta
    for (const xi of model.displacements) {
      expect(Number.isFinite(xi)).toBe(true);
    }
    for (const p of model.pressures) {
      expect(Number.isFinite(p)).toBe(true);
    }
  });
});

describe("reset", () => {
  it("restores every Property to its default and clears sampled state / phase accumulator", () => {
    const model = new SoundWavesModel();
    const defaults = {
      frequency: model.frequencyProperty.value,
      amplitude: model.amplitudeProperty.value,
      isPlaying: model.isPlayingProperty.value,
      playbackSpeed: model.playbackSpeedProperty.value,
    };

    model.frequencyProperty.value = FREQUENCY_RANGE.max;
    model.amplitudeProperty.value = model.amplitudeProperty.range.max * 0.5; // nonzero, so the model actually moves
    model.playbackSpeedProperty.value = "ultraSlow";
    stepModel(model, 0.3);

    // Sanity: the model actually advanced before reset.
    expect(model.displacements.some((xi) => xi !== 0)).toBe(true);

    model.reset();

    expect(model.frequencyProperty.value).toBe(defaults.frequency);
    expect(model.amplitudeProperty.value).toBeCloseTo(defaults.amplitude, 10);
    expect(model.isPlayingProperty.value).toBe(defaults.isPlaying);
    expect(model.playbackSpeedProperty.value).toBe(defaults.playbackSpeed);

    for (const xi of model.displacements) {
      expect(xi).toBe(0);
    }
    for (const p of model.pressures) {
      expect(p).toBe(0);
    }
    // The phase accumulator/clock must also be back at the start: a point at x=0 should read exactly
    // at-rest immediately after reset (retardedTime = 0 - 0/c = 0, which is the "not yet driving" case).
    const sample = model.sampleAt(0);
    expect(sample.displacement).toBe(0);
    expect(sample.velocity).toBe(0);
    expect(sample.pressure).toBe(0);
  });
});

// ---- Spherical mode (added as a substantial refinement) ----

describe("sphericalAmplitudeAtRadius", () => {
  it("halves when radius doubles, well away from the source radius (1/r scaling, NOT 1/r^2)", () => {
    const sourceAmplitude = 0.02;
    const amplitudeAt2m = sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, 2);
    const amplitudeAt4m = sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, 4);
    expect(amplitudeAt4m).toBeCloseTo(amplitudeAt2m / 2, 10);

    // Also confirm it is NOT the 1/r^2 intensity law masquerading as the amplitude law.
    const wouldBeIfInverseSquare = amplitudeAt2m / 4;
    expect(amplitudeAt4m).not.toBeCloseTo(wouldBeIfInverseSquare, 6);
  });

  it("equals the source-radius amplitude exactly at r = sourceRadius", () => {
    const sourceAmplitude = 0.02;
    expect(sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, SPHERICAL_SOURCE_RADIUS)).toBeCloseTo(sourceAmplitude, 10);
  });

  it("clamps to the source-radius amplitude (does not blow up) for any r <= sourceRadius", () => {
    const sourceAmplitude = 0.02;
    expect(sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, SPHERICAL_SOURCE_RADIUS * 0.5)).toBeCloseTo(sourceAmplitude, 10);
    expect(sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, 0)).toBeCloseTo(sourceAmplitude, 10);
    expect(Number.isFinite(sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, 0))).toBe(true);
  });
});

describe("spherical energy conservation: I(r) ~ amplitude(r)^2, and I(r)*r^2 is constant across radii", () => {
  it("amplitude(r1)^2 * r1^2 equals amplitude(r2)^2 * r2^2 for two very different radii", () => {
    // This is the direct physics check behind sphericalAmplitudeAtRadius's derivation: power radiated
    // through any enclosing sphere is conserved, so intensity (proportional to amplitude^2) times the
    // sphere's area (proportional to r^2) must be constant. This test would fail if the amplitude law
    // were accidentally implemented as 1/r^2 (energy would not be conserved) or any other exponent.
    const sourceAmplitude = 0.02;
    const r1 = 1.0;
    const r2 = 7.0;
    const amplitude1 = sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, r1);
    const amplitude2 = sphericalAmplitudeAtRadius(sourceAmplitude, SPHERICAL_SOURCE_RADIUS, r2);
    const intensityTimesArea1 = amplitude1 * amplitude1 * r1 * r1;
    const intensityTimesArea2 = amplitude2 * amplitude2 * r2 * r2;
    expect(intensityTimesArea1).toBeCloseTo(intensityTimesArea2, 10);
  });
});

describe("strictRadialAmplitudeBound", () => {
  it("equals 1 / (k + 1/sourceRadius)", () => {
    const testWavelength = 2 * Math.PI; // so k = 1
    expect(strictRadialAmplitudeBound(testWavelength, 1)).toBeCloseTo(0.5, 10); // 1/(1+1)
  });

  it("approaches the plane-wave bound (1/k = strictAmplitudeBound) as sourceRadius grows very large", () => {
    const testWavelength = 1.5;
    const planeBound = strictAmplitudeBound(testWavelength);
    const radialBoundAtHugeSourceRadius = strictRadialAmplitudeBound(testWavelength, 1e9);
    expect(radialBoundAtHugeSourceRadius).toBeCloseTo(planeBound, 6);
  });

  it("shrinks toward 0 as sourceRadius shrinks toward 0", () => {
    const testWavelength = 1.5;
    const radialBoundAtTinySourceRadius = strictRadialAmplitudeBound(testWavelength, 1e-6);
    expect(radialBoundAtTinySourceRadius).toBeGreaterThan(0);
    expect(radialBoundAtTinySourceRadius).toBeLessThan(1e-5);
  });

  it("is always strictly less than the plane-wave bound at a realistic finite sourceRadius", () => {
    const testWavelength = 1.372; // ~ the default frequency's wavelength
    expect(strictRadialAmplitudeBound(testWavelength, SPHERICAL_SOURCE_RADIUS)).toBeLessThan(strictAmplitudeBound(testWavelength));
  });
});

describe("sphericalAmplitudeProperty range constraint tracks frequency live (stricter than the plane cap)", () => {
  it("cap exactly equals AMPLITUDE_SAFETY_FRACTION * strictRadialAmplitudeBound(wavelength, SPHERICAL_SOURCE_RADIUS)", () => {
    const model = new SoundWavesModel();
    const expectedCap = AMPLITUDE_SAFETY_FRACTION * strictRadialAmplitudeBound(model.wavelengthProperty.value, SPHERICAL_SOURCE_RADIUS);
    expect(model.sphericalAmplitudeProperty.range.max).toBeCloseTo(expectedCap, 10);
  });

  it("is strictly tighter than the plane-wave amplitude cap at the same frequency", () => {
    const model = new SoundWavesModel();
    expect(model.sphericalAmplitudeProperty.range.max).toBeLessThan(model.amplitudeProperty.range.max);
  });

  it("default sphericalAmplitudeProperty value stays within its live cap across the whole FREQUENCY_RANGE", () => {
    const model = new SoundWavesModel();
    const defaultValue = model.sphericalAmplitudeProperty.value;
    model.frequencyProperty.value = FREQUENCY_RANGE.max; // tightest cap
    expect(defaultValue).toBeLessThanOrEqual(model.sphericalAmplitudeProperty.range.max + 1e-12);
  });
});

describe("sampleAtRadius: retarded-time / finite propagation speed (radial analogue of the plane-wave test)", () => {
  it("a point far from the source stays at rest until roughly r/c has elapsed", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 200;
    const r = 3.0; // m
    const speedOfSound = model.speedOfSoundProperty.value;
    const travelTime = r / speedOfSound;

    const dt = 1 / 2000;
    let elapsed = 0;
    let sawMotionEarly = false;
    while (elapsed < travelTime * 0.5) {
      model.step(dt);
      elapsed += dt;
      if (Math.abs(model.sampleAtRadius(r).displacement) > 1e-12) {
        sawMotionEarly = true;
        break;
      }
    }
    expect(sawMotionEarly).toBe(false);

    let sawMotionLate = false;
    const lateStopTime = travelTime + 0.05;
    while (elapsed < lateStopTime) {
      model.step(dt);
      elapsed += dt;
      if (Math.abs(model.sampleAtRadius(r).displacement) > 1e-6) {
        sawMotionLate = true;
        break;
      }
    }
    expect(sawMotionLate).toBe(true);
  });
});

describe("spherical mode: no net drift", () => {
  it("radial displacement stays bounded within the LOCAL (radius-scaled) amplitude over a long run", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 250;
    model.sphericalAmplitudeProperty.value = model.sphericalAmplitudeProperty.range.max * 0.5;

    const r = 1.5; // m
    const localAmplitude = sphericalAmplitudeAtRadius(model.sphericalAmplitudeProperty.value, SPHERICAL_SOURCE_RADIUS, r);
    let maxObserved = 0;
    for (let i = 0; i < 3000; i++) {
      model.step(1 / 60);
      const sample = model.sampleAtRadius(r);
      maxObserved = Math.max(maxObserved, Math.abs(sample.displacement));
      expect(Math.abs(sample.displacement)).toBeLessThanOrEqual(localAmplitude + 1e-9);
    }
    // Sanity: the particle actually moved substantially (not trivially bounded because it never moved).
    expect(maxObserved).toBeGreaterThan(localAmplitude * 0.5);
  });
});

describe("retarded-time history buffer sizing: MAX_SUPPORTED_DISTANCE, not DOMAIN_LENGTH, governs it", () => {
  it("MAX_SUPPORTED_DISTANCE covers the 16 m Field zoom width with headroom, well beyond DOMAIN_LENGTH", () => {
    expect(MAX_SUPPORTED_DISTANCE).toBeGreaterThanOrEqual(16);
    expect(MAX_SUPPORTED_DISTANCE).toBeGreaterThan(DOMAIN_LENGTH);
  });

  it("resolves a point far beyond DOMAIN_LENGTH (but within MAX_SUPPORTED_DISTANCE) to the exact closed-form phase, not a stale clamped value", () => {
    // x=18m is far enough beyond DOMAIN_LENGTH (4m) that sizing the history buffer off DOMAIN_LENGTH
    // (the pre-fix behavior) would, by the time the wavefront has traveled this far and fully ramped
    // up, put this point's retarded time OUTSIDE the old buffer's window - phaseAtTime()'s defensive
    // clamp would then silently return a STALE phase (from the oldest retained history entry) rather
    // than the correct one, with no crash and no obvious symptom other than a wrong wave pattern.
    // Concretely: at c=343 m/s, the old DOMAIN_LENGTH-sized buffer covered only ~0.027s of history,
    // i.e. distances up to ~9.2m at this speed - 18m is well beyond that. MAX_SUPPORTED_DISTANCE=20m
    // sizes the buffer to ~0.133s, comfortably covering 18m (~46m at this speed), so this should match
    // the exact closed-form sin(kx-wt) formula to tight tolerance.
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 200;
    const x = 18; // m
    const totalTime = 0.6; // s

    stepModel(model, totalTime);

    const speedOfSound = model.speedOfSoundProperty.value;
    const omega = angularFrequency(model.frequencyProperty.value);
    const k = omega / speedOfSound;
    const expectedDisplacement = model.amplitudeProperty.value * Math.sin(k * x - omega * totalTime);

    const actual = model.sampleAt(x).displacement;
    expect(actual).toBeCloseTo(expectedDisplacement, 3);
  });
});

describe("propagationModeProperty", () => {
  it("defaults to 'plane'", () => {
    const model = new SoundWavesModel();
    expect(model.propagationModeProperty.value).toBe("plane");
  });

  it("resets to 'plane' after being changed", () => {
    const model = new SoundWavesModel();
    model.propagationModeProperty.value = "spherical";
    expect(model.propagationModeProperty.value).toBe("spherical");
    model.reset();
    expect(model.propagationModeProperty.value).toBe("plane");
  });
});

// ---- playbackSpeedProperty / Ultra Slow (V3 refinement) ----

describe("playbackSpeedProperty", () => {
  it("defaults to 'normal'", () => {
    const model = new SoundWavesModel();
    expect(model.playbackSpeedProperty.value).toBe("normal");
  });

  it("resets to 'normal' after being changed", () => {
    const model = new SoundWavesModel();
    model.playbackSpeedProperty.value = "ultraSlow";
    expect(model.playbackSpeedProperty.value).toBe("ultraSlow");
    model.reset();
    expect(model.playbackSpeedProperty.value).toBe("normal");
  });
});

describe("timescale arithmetic at ultraSlow: sourcePhase advances proportionally to frequency*timeScale, not frequency alone", () => {
  it("doubling frequency exactly doubles the accumulated phase (equivalent to halving the oscillation period) for the same elapsed real time", () => {
    // Two independent models, one at exactly double the other's frequency, both run at ultraSlow
    // (timeScale=0.001) for the SAME real elapsed time. If sourcePhase correctly integrates
    // omega*timeScale*dt every step (not just omega*dt), the resulting closed-form displacement at x=0
    // (retarded distance ~0, so no propagation-delay complication) must match sin(omega*timeScale*T) for
    // EACH model's own omega - i.e. accumulated phase is exactly proportional to frequency*timeScale, so
    // doubling frequency exactly doubles it.
    const lowFrequency = 200;
    const highFrequency = 400; // exactly double, both within FREQUENCY_RANGE
    const modelLow = new SoundWavesModel();
    const modelHigh = new SoundWavesModel();
    modelLow.frequencyProperty.value = lowFrequency;
    modelHigh.frequencyProperty.value = highFrequency;
    modelLow.playbackSpeedProperty.value = "ultraSlow";
    modelHigh.playbackSpeedProperty.value = "ultraSlow";

    const dt = 1 / 200;
    const totalRealTime = 0.4; // s of REAL elapsed time - past RAMP_TIME (0.25s), so both are fully ramped
    const steps = Math.round(totalRealTime / dt);
    for (let i = 0; i < steps; i++) {
      modelLow.step(dt);
      modelHigh.step(dt);
    }

    const ultraSlowTimeScale = 0.001; // matches ULTRA_SLOW_TIME_SCALE - re-stated here (not imported) so
    // this test exercises the model's OWN observable behavior against an independently-stated expectation,
    // rather than importing the exact constant the implementation uses internally.
    const modelTime = totalRealTime * ultraSlowTimeScale;

    const expectedLow = -modelLow.amplitudeProperty.value * Math.sin(2 * Math.PI * lowFrequency * modelTime);
    const expectedHigh = -modelHigh.amplitudeProperty.value * Math.sin(2 * Math.PI * highFrequency * modelTime);

    expect(modelLow.sampleAt(0).displacement).toBeCloseTo(expectedLow, 4);
    expect(modelHigh.sampleAt(0).displacement).toBeCloseTo(expectedHigh, 4);
  });
});

describe("propagation speed and oscillation speed stay locked together at every playback speed (same timeScale governs both)", () => {
  const timeScaleBySpeed: Record<PlaybackSpeed, number> = { normal: 1, slow: 0.25, ultraSlow: 0.001 };

  it.each(["normal", "slow", "ultraSlow"] as const)("matches the closed-form xi(x,t), with model time = (real elapsed time) * timeScale, at speed=%s", (speed) => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 250;
    model.playbackSpeedProperty.value = speed;

    const x = 0.5; // m
    const timeScale = timeScaleBySpeed[speed];
    const speedOfSound = model.speedOfSoundProperty.value;
    // Real elapsed time = (real time for the wavefront to travel to x at THIS speed) + a fixed 0.3s real
    // margin (> RAMP_TIME) - so the wavefront has always arrived AND the ramp is always complete, by
    // construction, regardless of speed (this is exactly the point of the RAMP_TIME fix - ramp duration
    // is fixed in REAL seconds).
    const travelTimeReal = x / speedOfSound / timeScale;
    const totalRealTime = travelTimeReal + 0.3;

    const dt = 1 / 200;
    const steps = Math.round(totalRealTime / dt);
    // Use the ACTUAL stepped real time (steps*dt), not the originally-intended totalRealTime, for every
    // downstream calculation below - totalRealTime/dt is not generally an integer (travelTimeReal isn't a
    // clean multiple of dt), so rounding `steps` to the nearest integer means the model actually experiences
    // a slightly different total real time than totalRealTime itself. At this test's frequency (250 Hz),
    // even a sub-dt timing difference is a meaningfully large phase error (omega is large), so this
    // distinction matters here, unlike in tests that pick round numbers of steps.
    const actualRealTime = steps * dt;
    for (let i = 0; i < steps; i++) {
      model.step(dt);
    }

    const modelTime = actualRealTime * timeScale; // if simulationTime and sourcePhase are governed by the
    // SAME timeScale (the property under test), this exactly equals the model's actual simulationTime
    const retardedTime = modelTime - x / speedOfSound;
    const omega = angularFrequency(model.frequencyProperty.value);
    const expectedDisplacement = -model.amplitudeProperty.value * Math.sin(omega * retardedTime); // ramp=1, real time since arrival is >= RAMP_TIME at every speed (actualRealTime - travelTimeReal is within one dt of the intended 0.3s margin)

    expect(model.sampleAt(x).displacement).toBeCloseTo(expectedDisplacement, 4);
  });
});

describe("RAMP_TIME fix: ramp duration is fixed in REAL (wall-clock) seconds, independent of playback speed", () => {
  it("at ultraSlow, the amplitude ramp reaches ~1.0 after ~0.25s of WALL-CLOCK time, even though only a tiny fraction of a second of MODEL time has elapsed", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 250;
    model.playbackSpeedProperty.value = "ultraSlow";

    const dt = 1 / 200;
    const totalRealTime = 0.3; // s of REAL elapsed time - past RAMP_TIME (0.25s)
    const steps = Math.round(totalRealTime / dt);
    for (let i = 0; i < steps; i++) {
      model.step(dt);
    }

    const ultraSlowTimeScale = 0.001;
    const modelTime = totalRealTime * ultraSlowTimeScale; // ~0.0003s of MODEL time - tiny
    const omega = angularFrequency(model.frequencyProperty.value);
    const fullyRampedExpected = -model.amplitudeProperty.value * Math.sin(omega * modelTime); // assumes ramp=1

    const actual = model.sampleAt(0).displacement;
    expect(actual).toBeCloseTo(fullyRampedExpected, 4);

    // Regression guard: this is NOT what the PRE-FIX behavior would have produced. The old code evaluated
    // the ramp against the SCALED model-time value directly (here, modelTime itself, ~0.0003s) rather than
    // real elapsed time - rampFactor at that tiny an input is many orders of magnitude below 1 (practically
    // 0), which would have suppressed the displacement to near-zero instead of the near-full value above.
    const oldPreFixRamp = rampFactor(modelTime, 0.25);
    expect(oldPreFixRamp).toBeLessThan(0.001);
    expect(Math.abs(actual)).toBeGreaterThan(Math.abs(fullyRampedExpected) * 0.9); // confirms the ACTUAL ramp is near-full, unlike oldPreFixRamp
  });
});

describe("phaseHistory fix: large buffers at slow playback speeds do not cause an O(n) linear-scan performance cliff", () => {
  it("many steps at ultraSlow (growing the history buffer to its large steady-state size) complete quickly", () => {
    // At ultraSlow (timeScale=0.001), REQUIRED_HISTORY_DURATION (~0.133s of MODEL time) is not covered
    // until roughly REQUIRED_HISTORY_DURATION/(dt*timeScale) ~= 0.133/(1/60*0.001) ~= 8000 real frames have
    // elapsed - well within this test's step count, so a meaningful portion of this loop runs with the
    // history buffer at its large ultraSlow steady-state size, exercising phaseAtTime()'s lookup (called
    // PRESSURE_SAMPLE_COUNT=240 times per step, via recomputeSamples()) at that size.
    const model = new SoundWavesModel();
    model.playbackSpeedProperty.value = "ultraSlow";

    const dt = 1 / 60;
    const steps = 20000; // ~333s of real elapsed time - comfortably past the ~8000-frame threshold above

    const start = Date.now();
    for (let i = 0; i < steps; i++) {
      model.step(dt);
    }
    const elapsedMs = Date.now() - start;

    // A linear-scan-per-lookup implementation over an ~8000-entry buffer (240 lookups/step * 20000 steps)
    // would be roughly 8000 * 240 * 20000 ~= a very large number of comparisons in the worst case, taking
    // far longer than this. A generous threshold comfortably distinguishes "fixed" from "the old perf
    // cliff" without being a flaky, tightly-tuned timing assertion.
    expect(elapsedMs).toBeLessThan(5000);

    for (const xi of model.displacements) {
      expect(Number.isFinite(xi)).toBe(true);
    }
  });
});

describe("phase continuity across a speed change: switching playbackSpeedProperty mid-run never causes a discontinuous jump", () => {
  it("displacement changes only by a tiny, speed-consistent amount immediately after switching from normal to ultraSlow", () => {
    const model = new SoundWavesModel();
    model.frequencyProperty.value = 250;
    stepModel(model, 0.5); // run at normal speed - past ramp and wavefront arrival at x=0

    const beforeSwitch = model.sampleAt(0).displacement;
    model.playbackSpeedProperty.value = "ultraSlow";
    const stepDt = 1 / 60;
    model.step(stepDt); // a single step at the NEW speed
    const afterSwitch = model.sampleAt(0).displacement;

    // At ultraSlow (timeScale=0.001), one frame's dt only advances MODEL time by dt*0.001 - the resulting
    // phase advance (and therefore the change in displacement, whose rate of change is bounded by
    // amplitude*omega) can only be correspondingly tiny. A discontinuity (e.g. the phase/time accumulators
    // resetting or jumping on a speed change) would instead produce a change on the order of the full
    // amplitude, far exceeding this bound.
    const ultraSlowTimeScale = 0.001;
    const omega = angularFrequency(model.frequencyProperty.value);
    const maxPossibleChange = model.amplitudeProperty.value * omega * stepDt * ultraSlowTimeScale * 2; // 2x margin
    expect(Math.abs(afterSwitch - beforeSwitch)).toBeLessThan(maxPossibleChange);
  });
});

describe("MUST-FIX (V3 physics re-review): mid-ramp speed switches never cause a ramp discontinuity, in EITHER direction", () => {
  // Both tests sample at x=0, where retardedTime always exactly equals simulationTime (distance/c = 0), so
  // the wavefront "arrives" at real (wall-clock) time exactly 0 - the very start of the run. That makes the
  // CORRECT expected ramp trivial to state independently of the implementation: it is simply
  // rampFactor(totalRealElapsedTime, RAMP_TIME), where totalRealElapsedTime is just the plain sum of every
  // raw dt passed to step() so far, regardless of what playbackSpeedProperty was set to at each step. This
  // lets each test compute an independent expected closed-form displacement (not just an approximate bound)
  // and compare the model's actual output to it after a mid-ramp speed switch.
  const RAMP_TIME = 0.25; // s - restated (not imported) to match the model's own private RAMP_TIME constant
  const NORMAL_TIME_SCALE = 1;
  const ULTRA_SLOW_TIME_SCALE = 0.001;

  it("slow -> fast (Ultra Slow -> Normal) mid-ramp: the ramp does not drop discontinuously, and reaches full amplitude in ~RAMP_TIME real seconds total, not ~40% longer", () => {
    const model = new SoundWavesModel();
    const frequency = 250;
    model.frequencyProperty.value = frequency;
    model.playbackSpeedProperty.value = "ultraSlow";

    const dt = 1 / 200;
    let totalRealTime = 0;
    let expectedSimulationTime = 0; // tracked independently, mirroring step()'s own scaledDt accumulation

    // Run partway through the ramp at Ultra Slow - well under RAMP_TIME (0.25s) of REAL elapsed time, so the
    // point is genuinely still mid-ramp when the speed switch below happens.
    const ultraSlowRealTime = 0.1;
    const ultraSlowSteps = Math.round(ultraSlowRealTime / dt);
    for (let i = 0; i < ultraSlowSteps; i++) {
      model.step(dt);
      totalRealTime += dt;
      expectedSimulationTime += dt * ULTRA_SLOW_TIME_SCALE;
    }

    // The switch happens WHILE mid-ramp (totalRealTime so far, 0.1s, is well under RAMP_TIME).
    model.playbackSpeedProperty.value = "normal";
    model.step(dt); // a single step at the NEW speed, immediately after the switch
    totalRealTime += dt;
    expectedSimulationTime += dt * NORMAL_TIME_SCALE;

    const omega = angularFrequency(frequency);
    const expectedRamp = rampFactor(totalRealTime, RAMP_TIME);
    const expectedDisplacement = -model.amplitudeProperty.value * expectedRamp * Math.sin(omega * expectedSimulationTime);

    const actual = model.sampleAt(0).displacement;
    expect(actual).toBeCloseTo(expectedDisplacement, 4);

    // Regression guard: the OLD buggy retardedTime/(CURRENT timeScale) approximation would, right after this
    // switch, divide the (still tiny, since Ultra Slow barely advanced model time) accumulated retardedTime
    // by the NEW timeScale (1) - producing a ramp estimate close to the pre-switch value's raw MODEL time,
    // not the correct real-time-based one - a huge drop from the correct, well-progressed ramp above.
    const oldBuggyRealTimeSinceArrival = expectedSimulationTime / NORMAL_TIME_SCALE; // retardedTime / new timeScale
    const oldBuggyRamp = rampFactor(oldBuggyRealTimeSinceArrival, RAMP_TIME);
    expect(oldBuggyRamp).toBeLessThan(expectedRamp * 0.1); // confirms the old formula really would have dropped hard here
  });

  it("fast -> slow (Normal -> Ultra Slow) mid-ramp does not SNAP the ramp up to ~1.0", () => {
    const model = new SoundWavesModel();
    const frequency = 250;
    model.frequencyProperty.value = frequency;
    model.playbackSpeedProperty.value = "ultraSlow";

    const dt = 1 / 200;
    let totalRealTime = 0;
    let expectedSimulationTime = 0;

    // A stretch of real time at Ultra Slow (the "long Ultra Slow session") - still well under RAMP_TIME.
    const ultraSlowRealTime = 0.05;
    const ultraSlowSteps = Math.round(ultraSlowRealTime / dt);
    for (let i = 0; i < ultraSlowSteps; i++) {
      model.step(dt);
      totalRealTime += dt;
      expectedSimulationTime += dt * ULTRA_SLOW_TIME_SCALE;
    }

    // "Switch to Normal to skip ahead" - briefly, only ONE frame, so the point is still clearly mid-ramp
    // afterward (nowhere close to RAMP_TIME of real elapsed time).
    model.playbackSpeedProperty.value = "normal";
    model.step(dt);
    totalRealTime += dt;
    expectedSimulationTime += dt * NORMAL_TIME_SCALE;

    // "Switch back to Ultra Slow" - the fast -> slow direction under test. Step one more (tiny) frame.
    model.playbackSpeedProperty.value = "ultraSlow";
    model.step(dt);
    totalRealTime += dt;
    expectedSimulationTime += dt * ULTRA_SLOW_TIME_SCALE;

    // True total real elapsed time is still tiny (a few multiples of dt, ~0.06s) - nowhere near RAMP_TIME
    // (0.25s) - so the CORRECT ramp must still be small, not anywhere near fully ramped.
    expect(totalRealTime).toBeLessThan(RAMP_TIME * 0.5);

    const omega = angularFrequency(frequency);
    const expectedRamp = rampFactor(totalRealTime, RAMP_TIME);
    const expectedDisplacement = -model.amplitudeProperty.value * expectedRamp * Math.sin(omega * expectedSimulationTime);

    const actual = model.sampleAt(0).displacement;
    expect(actual).toBeCloseTo(expectedDisplacement, 4);
    // Confirms the correct ramp genuinely is still small (not a vacuous check that would pass even if the
    // fix silently produced a full ramp for some other reason).
    expect(expectedRamp).toBeLessThan(0.5);

    // Regression guard: the OLD buggy retardedTime/(CURRENT timeScale) approximation would, right after this
    // last switch back to Ultra Slow, divide the accumulated retardedTime (dominated by the ONE normal-speed
    // step, since that step alone advanced model time ~1000x more than either Ultra Slow stretch) by the NEW,
    // tiny timeScale (0.001) - producing a hugely inflated real-time-since-arrival estimate that blows well
    // past RAMP_TIME, snapping the ramp to ~1.0 in one frame even though the point is genuinely still early
    // in its ramp.
    const oldBuggyRealTimeSinceArrival = expectedSimulationTime / ULTRA_SLOW_TIME_SCALE; // retardedTime / new timeScale
    const oldBuggyRamp = rampFactor(oldBuggyRealTimeSinceArrival, RAMP_TIME);
    expect(oldBuggyRamp).toBeGreaterThan(0.99); // confirms the old formula really would have snapped to ~full ramp here
    expect(oldBuggyRamp).toBeGreaterThan(expectedRamp * 5); // a large, clearly-discontinuous jump vs. the correct value
  });
});
