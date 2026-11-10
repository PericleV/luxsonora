// Circle size from the area (focus.js spotRadius): sizes follow the spots, within bounds.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { gazePath, spotRadius, DEFAULT_RADIUS } from "../src/core/focus.js";

describe("circle size", () => {
  const A = analyze(synthImage(200, 133, 1)), SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const P = { count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS };
  it("same for all keeps the base radius", () => {
    for (const q of gazePath(A, SAL.map, { ...P, sizing: "same" })) expect(q.r).toBe(DEFAULT_RADIUS);
  });
  it("from the area gives sizes between 40% and 220% of the base, not all equal", () => {
    const qs = gazePath(A, SAL.map, { ...P, sizing: "area" });
    for (const q of qs) { expect(q.r).toBeGreaterThanOrEqual(DEFAULT_RADIUS * 0.4 - 1e-12); expect(q.r).toBeLessThanOrEqual(DEFAULT_RADIUS * 2.2 + 1e-12); }
    expect(new Set(qs.map(q => q.r.toFixed(4))).size).toBeGreaterThan(1);
  });
  it("a wide flat spot is larger than a single bright pixel", () => {
    const W = 60, H = 40, S = new Float32Array(W * H);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) S[y * W + x] = 0.8;
    S[20 * W + 50] = 1;
    const fake = { W, H };
    expect(spotRadius(fake, S, 20 * W + 20, 0.07)).toBeGreaterThan(spotRadius(fake, S, 20 * W + 50, 0.07));
  });
});
