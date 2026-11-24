import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { MEASURES, MEASURE_KEYS, measureMap, measureAngles, measuresAt } from "../src/core/measures.js";

const A = analyze(synthImage(120, 80, 3));
// a picture of stripes: horizontal lines, repeating, every 6 px
function stripes(W = 96, H = 64) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.floor(y / 3) % 2 ? 230 : 30, i = 4 * (y * W + x); data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255; }
  return { width: W, height: H, data };
}

describe("the measures shown on the stage", () => {
  it("every measure has a name, the words of its two ends and what the music does with it", () => {
    for (const k of MEASURE_KEYS) { const m = MEASURES[k]; expect(m.name && m.low && m.high && m.does.length > 20).toBeTruthy(); }
  });
  it("every map covers the picture with values from 0 to 1, and is kept with the analysis", () => {
    for (const k of MEASURE_KEYS) {
      const m = measureMap(A, k);
      expect(m.length).toBe(A.N);
      for (let p = 0; p < A.N; p += 37) { expect(m[p]).toBeGreaterThanOrEqual(0); expect(m[p]).toBeLessThanOrEqual(1); }
      expect(measureMap(A, k)).toBe(m);
    }
  });
  it("stripes read as horizontal, repeating lines", () => {
    const S = analyze(stripes()), v = measuresAt(S, 0.5, 0.5);
    expect(v.linesWord).toBe("horizontal");
    expect(v.pattern).toBeGreaterThan(0.5);
    expect(v.lines).toBeGreaterThan(0.3);
    const ang = measureAngles(S); expect(Math.min(ang[20 * 96 + 40], 1 - ang[20 * 96 + 40])).toBeLessThan(0.1);
  });
  it("the values under the pointer are in range and match the maps of the regions", () => {
    const v = measuresAt(A, 0.3, 0.6);
    for (const k of ["texture", "lines", "depth", "pattern", "sat", "warmth", "contrast", "grain", "light"]) { expect(v[k]).toBeGreaterThanOrEqual(0); expect(v[k]).toBeLessThanOrEqual(1); }
    const p = Math.floor(0.6 * A.H) * A.W + Math.floor(0.3 * A.W);
    expect(v.sat).toBeCloseTo(measureMap(A, "sat")[p], 6);
    expect(v.texture).toBeCloseTo(measureMap(A, "texture")[p], 6);
  });
});
