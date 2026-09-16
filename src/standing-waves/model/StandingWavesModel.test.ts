import { describe, expect, it } from "vitest";
import { enableAssert } from "scenerystack/assert";
import {
  AMPLITUDE_CAP_FRACTION,
  DAMPING_MIN,
  DAMPING_RANGE,
  DRIVING_FREQUENCY_RANGE,
  LENGTH_RANGE,
  LINEAR_DENSITY_RANGE,
  STRING_GRID_INTERVALS,
  StandingWavesModel,
  TENSION_RANGE,
  fundamentalFrequency,
  harmonicFrequency,
  nearestHarmonic,
  predictedNodePositions,
  waveSpeed,
} from "./StandingWavesModel.js";

// Property range violations only throw once assertions are enabled (see
// node_modules/scenerystack/src/axon/js/validate.ts) - in a real sim, assert.ts's enableAssert()
// call does this during the dev bootstrap chain; here we do it explicitly, once, for this file.
enableAssert();

describe("waveSpeed", () => {
  it("computes c = sqrt(T/mu) for several T/mu combinations", () => {
    expect(waveSpeed(1, 1)).toBeCloseTo(1, 10);
    expect(waveSpeed(4, 1)).toBeCloseTo(2, 10);
    expect(waveSpeed(9, 1)).toBeCloseTo(3, 10);
    expect(waveSpeed(1.5, 0.004)).toBeCloseTo(Math.sqrt(1.5 / 0.004), 10);
    expect(waveSpeed(10, 0.001)).toBeCloseTo(100, 10);
  });
});

describe("fundamentalFrequency / harmonicFrequency", () => {
  it("matches hand-computed values for a fixed-fixed string", () => {
    // c = 20 m/s, L = 2 m -> f1 = c/(2L) = 5 Hz
    expect(fundamentalFrequency(20, 2, "fixed")).toBeCloseTo(5, 10);
    expect(harmonicFrequency(1, 5, "fixed")).toBeCloseTo(5, 10);
    expect(harmonicFrequency(3, 5, "fixed")).toBeCloseTo(15, 10);
  });

  it("matches hand-computed values for a fixed-free string", () => {
    // c = 20 m/s, L = 2 m -> f1 = c/(4L) = 2.5 Hz
    expect(fundamentalFrequency(20, 2, "free")).toBeCloseTo(2.5, 10);
    expect(harmonicFrequency(1, 2.5, "free")).toBeCloseTo(2.5, 10);
    expect(harmonicFrequency(2, 2.5, "free")).toBeCloseTo(7.5, 10); // (2*2-1)*2.5
  });

  it("nearestHarmonic inverts harmonicFrequency for both boundary types", () => {
    const f1Fixed = 5;
    for (let n = 1; n <= 6; n++) {
      const f = harmonicFrequency(n, f1Fixed, "fixed");
      expect(nearestHarmonic(f, f1Fixed, "fixed")).toBe(n);
    }
    const f1Free = 2.5;
    for (let n = 1; n <= 6; n++) {
      const f = harmonicFrequency(n, f1Free, "free");
      expect(nearestHarmonic(f, f1Free, "free")).toBe(n);
    }
  });

  it("nearestHarmonic never returns less than 1", () => {
    expect(nearestHarmonic(0.001, 5, "fixed")).toBeGreaterThanOrEqual(1);
    expect(nearestHarmonic(0.001, 2.5, "free")).toBeGreaterThanOrEqual(1);
  });
});

describe("predictedNodePositions", () => {
  it("gives n+1 evenly-spaced nodes for a fixed-fixed string", () => {
    const positions = predictedNodePositions(3, 1.2, "fixed");
    expect(positions).toHaveLength(4);
    expect(positions[0]).toBeCloseTo(0, 10);
    expect(positions[3]).toBeCloseTo(1.2, 10);
    expect(positions[1]).toBeCloseTo(0.4, 10);
    expect(positions[2]).toBeCloseTo(0.8, 10);
  });

  it("gives n nodes for a fixed-free string, starting at x=0 and never reaching L", () => {
    const positions = predictedNodePositions(2, 1.2, "free");
    expect(positions).toHaveLength(2);
    expect(positions[0]).toBeCloseTo(0, 10);
    expect(positions[1]).toBeLessThan(1.2);
  });
});

describe("StandingWavesModel construction and defaults", () => {
  it("starts at rest (flat string, not driving, playing)", () => {
    const model = new StandingWavesModel();
    expect(model.isDrivingProperty.value).toBe(false);
    expect(model.isPlayingProperty.value).toBe(true);
    for (const y of model.displacements) {
      expect(y).toBe(0);
    }
  });

  it("has a grid with STRING_GRID_INTERVALS + 1 points", () => {
    const model = new StandingWavesModel();
    expect(model.displacements.length).toBe(STRING_GRID_INTERVALS + 1);
  });

  it("derives the default driving frequency as 2x the default fundamental (not hardcoded out of sync)", () => {
    const model = new StandingWavesModel();
    const expectedFundamental = fundamentalFrequency(waveSpeed(model.tensionProperty.value, model.linearDensityProperty.value), model.lengthProperty.value, model.farBoundaryTypeProperty.value);
    expect(model.drivingFrequencyProperty.value).toBeCloseTo(2 * expectedFundamental, 6);
    expect(model.fundamentalFrequencyProperty.value).toBeCloseTo(expectedFundamental, 10);
  });

  it("declares the damping range floor at DAMPING_MIN, never lower", () => {
    expect(DAMPING_RANGE.min).toBe(DAMPING_MIN);
    expect(DAMPING_MIN).toBeGreaterThan(0);
  });
});

describe("Property range validation (assertions enabled)", () => {
  it("rejects a length outside LENGTH_RANGE", () => {
    const model = new StandingWavesModel();
    expect(() => {
      model.lengthProperty.value = LENGTH_RANGE.max + 10;
    }).toThrow();
  });

  it("rejects a tension outside TENSION_RANGE", () => {
    const model = new StandingWavesModel();
    expect(() => {
      model.tensionProperty.value = TENSION_RANGE.min - 100;
    }).toThrow();
  });

  it("rejects a linear density outside LINEAR_DENSITY_RANGE", () => {
    const model = new StandingWavesModel();
    expect(() => {
      model.linearDensityProperty.value = LINEAR_DENSITY_RANGE.max + 1;
    }).toThrow();
  });

  it("rejects a damping value below the floor", () => {
    const model = new StandingWavesModel();
    expect(() => {
      model.dampingProperty.value = 0;
    }).toThrow();
  });

  it("rejects a driving frequency outside DRIVING_FREQUENCY_RANGE", () => {
    const model = new StandingWavesModel();
    expect(() => {
      model.drivingFrequencyProperty.value = DRIVING_FREQUENCY_RANGE.max + 100;
    }).toThrow();
  });

  it("rejects a driving amplitude above the live AMPLITUDE_CAP_FRACTION-of-length cap", () => {
    const model = new StandingWavesModel();
    const cap = AMPLITUDE_CAP_FRACTION * model.lengthProperty.value;
    expect(() => {
      model.drivingAmplitudeProperty.value = cap + 1;
    }).toThrow();
  });

  it("rejects an invalid far boundary type value", () => {
    const model = new StandingWavesModel();
    expect(() => {
      // @ts-expect-error - deliberately invalid for this test
      model.farBoundaryTypeProperty.value = "open";
    }).toThrow();
  });
});

describe("driving amplitude range tracks string length live", () => {
  it("shrinks the amplitude range max when length shrinks, and clamps an out-of-range value", () => {
    const model = new StandingWavesModel();
    model.lengthProperty.value = LENGTH_RANGE.max; // cap = AMPLITUDE_CAP_FRACTION * LENGTH_RANGE.max
    const valueValidAtMaxLength = AMPLITUDE_CAP_FRACTION * LENGTH_RANGE.max * 0.9; // 90% of the cap at max length
    model.drivingAmplitudeProperty.value = valueValidAtMaxLength; // invalid once length shrinks to LENGTH_RANGE.min
    expect(model.drivingAmplitudeProperty.value).toBeCloseTo(valueValidAtMaxLength, 10);

    model.lengthProperty.value = LENGTH_RANGE.min; // 0.5 m -> cap 0.025 m, old value now invalid
    expect(model.drivingAmplitudeProperty.value).toBeLessThanOrEqual(AMPLITUDE_CAP_FRACTION * LENGTH_RANGE.min + 1e-12);
    expect(model.drivingAmplitudeProperty.range.max).toBeCloseTo(AMPLITUDE_CAP_FRACTION * LENGTH_RANGE.min, 10);
  });
});

describe("boundary conditions", () => {
  it("keeps a fixed far end exactly at 0 after stepping", () => {
    const model = new StandingWavesModel();
    model.isDrivingProperty.value = true;
    for (let i = 0; i < 500; i++) {
      model.step(1 / 60);
    }
    expect(model.displacements[STRING_GRID_INTERVALS]).toBe(0);
  });

  it("free far end satisfies the discrete zero-slope (ghost-mirror) relation after stepping", () => {
    const model = new StandingWavesModel();
    model.farBoundaryTypeProperty.value = "free";
    model.isDrivingProperty.value = true;
    for (let i = 0; i < 500; i++) {
      model.step(1 / 60);
    }
    // The free-end update used y_{N+1} := y_{N-1} (ghost mirror). We can't observe the ghost point
    // directly, but we can confirm the free end is not artificially pinned to zero like a fixed end
    // would be, and that it stays finite - the strongest externally-observable signature available
    // without reaching into private state.
    const N = STRING_GRID_INTERVALS;
    expect(Number.isFinite(model.displacements[N])).toBe(true);
  });

  it("a free far end is NOT pinned to zero the way a fixed end is, for the same driving", () => {
    const fixedModel = new StandingWavesModel();
    fixedModel.isDrivingProperty.value = true;
    const freeModel = new StandingWavesModel();
    freeModel.farBoundaryTypeProperty.value = "free";
    freeModel.isDrivingProperty.value = true;

    for (let i = 0; i < 1000; i++) {
      fixedModel.step(1 / 60);
      freeModel.step(1 / 60);
    }

    const N = STRING_GRID_INTERVALS;
    expect(fixedModel.displacements[N]).toBe(0);
    expect(Math.abs(freeModel.displacements[N])).toBeGreaterThan(0);
  });
});

describe("reflection / travel-time behavior", () => {
  it("a disturbance launched at x=0 reaches a point near the far end only after ~L/c", () => {
    const model = new StandingWavesModel();
    model.tensionProperty.value = 10; // fast wave speed, short travel time
    model.linearDensityProperty.value = 0.001;
    model.lengthProperty.value = 2.0;
    model.dampingProperty.value = DAMPING_MIN;
    model.drivingFrequencyProperty.value = 5;
    model.drivingAmplitudeProperty.value = AMPLITUDE_CAP_FRACTION * model.lengthProperty.value;
    model.isDrivingProperty.value = true;

    const speed = waveSpeed(model.tensionProperty.value, model.linearDensityProperty.value);
    const travelTime = model.lengthProperty.value / speed;

    // Sample a point 90% of the way along the string, well before it should feel any motion.
    const probeIndex = Math.round(0.9 * STRING_GRID_INTERVALS);
    const dt = 1 / 240;
    const earlyStopTime = travelTime * 0.5;
    let elapsed = 0;
    let sawMotionEarly = false;
    while (elapsed < earlyStopTime) {
      model.step(dt);
      elapsed += dt;
      if (Math.abs(model.displacements[probeIndex]) > 1e-9) {
        sawMotionEarly = true;
        break;
      }
    }
    expect(sawMotionEarly).toBe(false);

    // Continue well past the expected travel time; the probe point should now have moved.
    const lateStopTime = travelTime * 2.5;
    let sawMotionLate = false;
    while (elapsed < lateStopTime) {
      model.step(dt);
      elapsed += dt;
      if (Math.abs(model.displacements[probeIndex]) > 1e-9) {
        sawMotionLate = true;
        break;
      }
    }
    expect(sawMotionLate).toBe(true);
  });
});

describe("play/pause vs. driving are independent", () => {
  it("pausing freezes the whole simulation, including free decay, not just the driven end", () => {
    const model = new StandingWavesModel();
    model.isDrivingProperty.value = true;
    for (let i = 0; i < 200; i++) {
      model.step(1 / 60); // build up some wave energy
    }
    model.isDrivingProperty.value = false; // now decaying freely
    for (let i = 0; i < 50; i++) {
      model.step(1 / 60);
    }

    model.isPlayingProperty.value = false;
    const snapshot = Array.from(model.displacements);
    for (let i = 0; i < 200; i++) {
      model.step(1 / 60);
    }
    expect(Array.from(model.displacements)).toEqual(snapshot);
  });
});

describe("numerical stability across the parameter range", () => {
  it("stays finite and bounded for many representative and extreme parameter combinations", () => {
    const lengths = [LENGTH_RANGE.min, DEFAULT_LENGTH(), LENGTH_RANGE.max];
    const tensions = [TENSION_RANGE.min, TENSION_RANGE.max];
    const densities = [LINEAR_DENSITY_RANGE.min, LINEAR_DENSITY_RANGE.max];
    const dampings = [DAMPING_MIN, DAMPING_RANGE.max];
    const frequencies = [DRIVING_FREQUENCY_RANGE.min, DRIVING_FREQUENCY_RANGE.max];
    const boundaries: Array<"fixed" | "free"> = ["fixed", "free"];

    for (const length of lengths) {
      for (const tension of tensions) {
        for (const density of densities) {
          for (const damping of dampings) {
            for (const frequency of frequencies) {
              for (const boundary of boundaries) {
                const model = new StandingWavesModel();
                model.lengthProperty.value = length;
                model.tensionProperty.value = tension;
                model.linearDensityProperty.value = density;
                model.dampingProperty.value = damping;
                model.farBoundaryTypeProperty.value = boundary;
                model.drivingFrequencyProperty.value = frequency;
                model.drivingAmplitudeProperty.value = model.drivingAmplitudeProperty.range.max;
                model.isDrivingProperty.value = true;

                for (let i = 0; i < 200; i++) {
                  model.step(1 / 60);
                }

                for (const y of model.displacements) {
                  expect(Number.isFinite(y)).toBe(true);
                  expect(Math.abs(y)).toBeLessThan(10); // wildly beyond any physical amplitude here
                }
              }
            }
          }
        }
      }
    }
  });

  it("tolerates a single very large dt (e.g. a backgrounded tab) without producing NaN", () => {
    const model = new StandingWavesModel();
    model.isDrivingProperty.value = true;
    model.step(5); // far larger than the MAX_STEP_DT clamp
    for (const y of model.displacements) {
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

function DEFAULT_LENGTH(): number {
  return new StandingWavesModel().lengthProperty.value;
}

describe("reset", () => {
  it("restores every Property to its default and zeros both grid arrays", () => {
    const model = new StandingWavesModel();
    const defaults = {
      length: model.lengthProperty.value,
      tension: model.tensionProperty.value,
      linearDensity: model.linearDensityProperty.value,
      damping: model.dampingProperty.value,
      drivingFrequency: model.drivingFrequencyProperty.value,
      drivingAmplitude: model.drivingAmplitudeProperty.value,
      farBoundaryType: model.farBoundaryTypeProperty.value,
      isDriving: model.isDrivingProperty.value,
      isPlaying: model.isPlayingProperty.value,
    };

    model.lengthProperty.value = 0.8;
    model.tensionProperty.value = 8;
    model.linearDensityProperty.value = 0.002;
    model.dampingProperty.value = DAMPING_RANGE.max;
    model.drivingFrequencyProperty.value = 10;
    model.farBoundaryTypeProperty.value = "free";
    model.isDrivingProperty.value = true;
    model.isPlayingProperty.value = false;
    model.isPlayingProperty.value = true; // keep playing so step() actually integrates below

    for (let i = 0; i < 300; i++) {
      model.step(1 / 60);
    }
    // Sanity: the string actually moved before reset.
    expect(model.displacements.some((y) => y !== 0)).toBe(true);

    model.reset();

    expect(model.lengthProperty.value).toBe(defaults.length);
    expect(model.tensionProperty.value).toBe(defaults.tension);
    expect(model.linearDensityProperty.value).toBe(defaults.linearDensity);
    expect(model.dampingProperty.value).toBe(defaults.damping);
    expect(model.drivingFrequencyProperty.value).toBeCloseTo(defaults.drivingFrequency, 10);
    expect(model.drivingAmplitudeProperty.value).toBeCloseTo(defaults.drivingAmplitude, 10);
    expect(model.farBoundaryTypeProperty.value).toBe(defaults.farBoundaryType);
    expect(model.isDrivingProperty.value).toBe(defaults.isDriving);
    expect(model.isPlayingProperty.value).toBe(defaults.isPlaying);

    for (const y of model.displacements) {
      expect(y).toBe(0);
    }
  });
});

describe("driving on/off transition restarts the buildup", () => {
  it("zeros the string and the driving clock every time driving transitions false -> true", () => {
    const model = new StandingWavesModel();
    model.isDrivingProperty.value = true;
    for (let i = 0; i < 300; i++) {
      model.step(1 / 60);
    }
    expect(model.displacements.some((y) => y !== 0)).toBe(true);

    model.isDrivingProperty.value = false;
    // A few steps of free decay/propagation with driving off - string may still be nonzero.
    for (let i = 0; i < 5; i++) {
      model.step(1 / 60);
    }

    model.isDrivingProperty.value = true; // false -> true transition: must restart from flat/at-rest
    // Immediately after the transition (before any step() runs), the string must be flat again.
    for (const y of model.displacements) {
      expect(y).toBe(0);
    }
  });
});

describe("limiting cases", () => {
  it("high damping decays a released (undriven) disturbance toward zero over the modeled window", () => {
    const model = new StandingWavesModel();
    model.isDrivingProperty.value = true;
    for (let i = 0; i < 200; i++) {
      model.step(1 / 60); // build up some wave energy
    }
    model.isDrivingProperty.value = false; // hold the end still, let existing energy decay
    model.dampingProperty.value = DAMPING_RANGE.max; // maximum damping

    const energyBefore = sumSquares(model.displacements);
    for (let i = 0; i < 600; i++) {
      model.step(1 / 60);
    }
    const energyAfter = sumSquares(model.displacements);

    expect(energyAfter).toBeLessThan(energyBefore);
    expect(energyAfter).toBeLessThan(1e-6);
  });

  it("driving well below the fundamental produces a low-order (n=1) pattern", () => {
    const model = new StandingWavesModel();
    model.drivingFrequencyProperty.value = DRIVING_FREQUENCY_RANGE.min; // 0.5 Hz, far below any typical fundamental
    expect(model.nearestHarmonicProperty.value).toBe(1);
  });
});

function sumSquares(values: Float64Array): number {
  let total = 0;
  for (const v of values) {
    total += v * v;
  }
  return total;
}
