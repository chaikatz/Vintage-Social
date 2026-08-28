import { describe, expect, it } from "vitest";
import {
  applyMatrix,
  brightnessMatrix,
  buildColorMatrix,
  concatMatrices,
  contrastMatrix,
  identityMatrix,
  saturationMatrix,
  toShaderUniforms,
  whiteBalanceMatrix,
} from "@/filters/colorMatrix";
import { NEUTRAL_ADJUSTMENTS } from "@/filters/types";

const MID: [number, number, number, number] = [0.4, 0.5, 0.6, 1];

function expectClose(actual: number[], expected: number[], precision = 6) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], precision));
}

describe("color matrix math", () => {
  it("identity leaves colors untouched", () => {
    expectClose(applyMatrix(identityMatrix(), MID), MID);
  });

  it("neutral adjustments compose to identity", () => {
    const m = buildColorMatrix(NEUTRAL_ADJUSTMENTS);
    expectClose(applyMatrix(m, MID), MID);
  });

  it("saturation 0 produces gray with Rec.601 luma", () => {
    const [r, g, b] = applyMatrix(saturationMatrix(0), MID);
    const luma = 0.299 * MID[0] + 0.587 * MID[1] + 0.114 * MID[2];
    expect(r).toBeCloseTo(luma, 6);
    expect(g).toBeCloseTo(luma, 6);
    expect(b).toBeCloseTo(luma, 6);
  });

  it("contrast pivots around mid-gray", () => {
    const gray: [number, number, number, number] = [0.5, 0.5, 0.5, 1];
    expectClose(applyMatrix(contrastMatrix(1.4), gray), gray);
    const [r] = applyMatrix(contrastMatrix(2), [0.6, 0.6, 0.6, 1]);
    expect(r).toBeCloseTo(0.7, 6);
  });

  it("brightness adds a flat offset", () => {
    const [r, g, b, a] = applyMatrix(brightnessMatrix(0.1), MID);
    expectClose([r, g, b, a], [0.5, 0.6, 0.7, 1]);
  });

  it("warm temperature lifts red and sinks blue", () => {
    const [r, , b] = applyMatrix(whiteBalanceMatrix(1, 0), MID);
    expect(r).toBeGreaterThan(MID[0]);
    expect(b).toBeLessThan(MID[2]);
  });

  it("concatenation applies right-hand matrix first", () => {
    // brightness(+0.1) then contrast(2): (c + 0.1) * 2 - 0.5
    const m = concatMatrices(contrastMatrix(2), brightnessMatrix(0.1));
    const [r] = applyMatrix(m, MID);
    expect(r).toBeCloseTo((0.4 + 0.1) * 2 - 0.5, 6);
  });

  it("alpha channel always passes through", () => {
    const m = buildColorMatrix(
      { brightness: 0.2, contrast: 1.4, saturation: 0.5, temperature: 0.6, tint: -0.3 },
      true,
    );
    const [, , , a] = applyMatrix(m, [0.2, 0.3, 0.4, 0.75]);
    expect(a).toBeCloseTo(0.75, 6);
  });

  it("shader uniforms round-trip the matrix (column-major mat4 + offset)", () => {
    const m = buildColorMatrix({ ...NEUTRAL_ADJUSTMENTS, brightness: 0.25 });
    const { matrix, offset } = toShaderUniforms(m);
    expect(matrix).toHaveLength(16);
    expect(offset).toEqual([0.25, 0.25, 0.25, 0]);
    // column-major: matrix[0..3] is the first column (r coefficients).
    expect(matrix[0]).toBeCloseTo(m[0], 6);
    expect(matrix[1]).toBeCloseTo(m[5], 6);
  });
});
