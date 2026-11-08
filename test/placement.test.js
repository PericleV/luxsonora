// Placement algorithms: maps are finite, in [0, 1], deterministic, and find what they should.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { attentionMap, scanPath, PLACEMENTS, spectralMap, detailsMap, regionMeans } from "../src/core/placement.js";
import { planTime } from "../src/core/duration.js";

const CLASSIC = Object.keys(PLACEMENTS).filter(k => PLACEMENTS[k].group === "Classic" && k !== "scan");
const setup = seed => { const img = synthImage(200, 133, seed), A = analyze(img); return { img, A, base: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null).map }; };
// a flat grey image with one small bright square at (x, y)
function spot(W, H, sx, sy, size = 6) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, on = Math.abs(x - sx) < size / 2 && Math.abs(y - sy) < size / 2;
    d[p] = d[p + 1] = d[p + 2] = on ? 240 : 90; d[p + 3] = 255;
  }
  return { width: W, height: H, data: d };
}
const argmax = m => { let b = 0; for (let i = 1; i < m.length; i++) if (m[i] > m[b]) b = i; return b; };

describe("placement maps", () => {
  for (const m of CLASSIC) it(`${m}: finite, in [0, 1], deterministic`, () => {
    const { img, A, base } = setup(3), a = attentionMap(m, A, img, base), b = attentionMap(m, A, img, base);
    expect(a.length).toBe(A.W * A.H);
    for (const v of a) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1 + 1e-6); }
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(regionMeans(A, a).length).toBe(A.regions.length);
  });
  it("spectral residual and details find a small bright spot", () => {
    const img = spot(160, 120, 112, 40), A = analyze(img);
    for (const map of [spectralMap(A), detailsMap(A)]) {
      const i = argmax(map), x = i % A.W, y = (i / A.W) | 0;
      expect(Math.hypot(x - 112 * A.W / 160, y - 40 * A.H / 120)).toBeLessThan(12);
    }
  });
  it("scan sweeps left to right, one point per column band", () => {
    const { A, base } = setup(2); let id = 0;
    const pts = scanPath(A, base, 7, 0.07, () => "s" + id++);
    expect(pts.length).toBe(7);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    pts.forEach((q, i) => { expect(q.index).toBe(i); expect(q.revisitOf).toBe(null); });
  });
});

describe("point durations on the style grid", () => {
  it("rounds to whole beats or two beats and keeps the total", () => {
    for (const grid of [1, 2]) for (const n of [3, 8, 14]) {
      const p = planTime(30, 112, Array.from({ length: n }, (_, i) => 1 + (i % 4)), grid);
      expect(p.dur.reduce((a, b) => a + b, 0)).toBeCloseTo(p.body, 9);
      for (const d of p.dur) { expect(d / grid).toBeCloseTo(Math.round(d / grid), 9); expect(d).toBeGreaterThanOrEqual(Math.max(1, grid)); }
    }
  });
});
