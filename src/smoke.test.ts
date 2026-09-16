import { describe, it, expect } from "vitest";

// This is a minimal sanity check that the Vitest + TypeScript test setup works end to end
// (transform, assertion library, type-checking). It deliberately tests nothing project-specific -
// no simulation-specific physics or SceneryStack component exists yet to test.
describe("vitest setup", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("type-checks a typed function", () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(2, 3)).toBe(5);
  });
});
