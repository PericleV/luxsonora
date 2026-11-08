// Focus points: generation rules, footprint reading, coverage, use in the composition.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, footprint, coverage, backgroundZone, readPoints, MIN_DIST, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";

const P0 = { style: "ambient", duration: 30, count: 16, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1 };
function setup(seed = 1) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  return { A, CL, MOT, SAL };
}

describe("gaze path", () => {
  it("keeps new points at least the minimum distance apart; revisits reuse the exact point", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { A, SAL } = setup(seed), pts = gazePath(A, SAL.map, { ...P0, memory: 0.15, count: 24 });
      const dMin = MIN_DIST * P0.inhibition * Math.hypot(A.W, A.H), fresh = pts.filter(q => q.revisitOf === null);
      for (let i = 0; i < fresh.length; i++) for (let j = i + 1; j < fresh.length; j++) {
        expect(Math.hypot((fresh[i].x - fresh[j].x) * A.W, (fresh[i].y - fresh[j].y) * A.H)).toBeGreaterThanOrEqual(dMin - 1e-9);
      }
      for (const q of pts) if (q.revisitOf !== null) { const t = pts[q.revisitOf]; expect([q.x, q.y, q.r]).toEqual([t.x, t.y, t.r]); }
    }
  });
  it("keeps anchors at their index and avoids them", () => {
    const { A, SAL } = setup(2);
    const anchors = [{ id: "a", index: 0, x: 0.5, y: 0.5, r: 0.1, w: 0.9, s: 0.5 }, { id: "b", index: 5, x: 0.1, y: 0.9, r: 0.05, w: 0.2, s: 0.1 }];
    const pts = gazePath(A, SAL.map, P0, anchors);
    expect(pts[0].id).toBe("a"); expect(pts[5].id).toBe("b"); expect(pts[0].source).toBe("manual");
    for (const q of pts) if (q.source === "auto" && q.revisitOf === null) expect(Math.hypot((q.x - 0.5) * A.W, (q.y - 0.5) * A.H)).toBeGreaterThan(5);
  });
  it("count sets the number of distinct places and returns caps the revisits", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { A, SAL } = setup(seed);
      for (const [count, returns] of [[2, 0], [5, 2], [8, 3], [12, 0], [10, 6]]) {
        const pts = gazePath(A, SAL.map, { ...P0, memory: 0.15, count, returns });
        const places = pts.filter(q => q.revisitOf === null).length, back = pts.length - places;
        expect(places).toBe(count);
        expect(back).toBe(returns); // memory brings areas back, so the cap is reached
        pts.forEach((q, i) => expect(q.index).toBe(i));
      }
    }
  }, 30000);
  it("anchors count as places in mixed mode", () => {
    const { A, SAL } = setup(2);
    const anchors = [{ id: "a", index: 0, x: 0.5, y: 0.5, r: 0.1, w: 0.9, s: 0.5 }, { id: "b", index: 3, x: 0.1, y: 0.9, r: 0.05, w: 0.2, s: 0.1 }];
    const pts = gazePath(A, SAL.map, { ...P0, count: 6, returns: 0 }, anchors);
    expect(pts.length).toBe(6); expect(pts[0].id).toBe("a"); expect(pts[3].id).toBe("b");
  });
  it("is deterministic", () => {
    const { A, SAL } = setup(3), strip = ps => ps.map(({ id, ...q }) => q);
    expect(strip(gazePath(A, SAL.map, P0))).toEqual(strip(gazePath(A, SAL.map, P0)));
  });
});

describe("footprint", () => {
  it("varies continuously with position, unlike a single region", () => {
    const { A } = setup(1);
    let maxJump = 0;
    for (let i = 0; i < 199; i++) {
      const a = footprint(A, i / 200, 0.5, 0.07).zone, b = footprint(A, (i + 1) / 200, 0.5, 0.07).zone;
      maxJump = Math.max(maxJump, Math.abs(a.L - b.L), Math.abs(a.sat - b.sat));
    }
    let regJump = 0;
    for (let i = 0; i < 199; i++) {
      const ra = A.regions[A.labels[66 * A.W + i]], rb = A.regions[A.labels[66 * A.W + i + 1]];
      regJump = Math.max(regJump, Math.abs(ra.L - rb.L), Math.abs(ra.sat - rb.sat));
    }
    expect(maxJump).toBeLessThan(regJump / 3);
  });
  it("is a convex combination of region features", () => {
    const { A } = setup(4), z = footprint(A, 0.3, 0.6, 0.15).zone;
    const Ls = A.regions.map(r => r.L);
    expect(z.L).toBeGreaterThanOrEqual(Math.min(...Ls)); expect(z.L).toBeLessThanOrEqual(Math.max(...Ls));
  });
});

describe("coverage", () => {
  it("stays in [0, 1] and grows with the radius", () => {
    const { A } = setup(1);
    const small = coverage(A, [{ x: 0.5, y: 0.5, r: 0.05 }]), big = coverage(A, [{ x: 0.5, y: 0.5, r: 0.2 }]);
    for (const v of big.map) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(big.background).toBeLessThan(small.background);
    expect(small.map[Math.floor(0.5 * A.H) * A.W + Math.floor(0.5 * A.W)]).toBeGreaterThan(0.95);
  });
});

describe("composition with focus points", () => {
  it("weights set the share of time and the background comes from coverage", () => {
    const { A, CL, MOT, SAL } = setup(1);
    const raw = [0.1, 0.9, 0.1, 0.9].map((w, i) => ({ id: "q" + i, x: 0.2 + 0.2 * i, y: 0.5, r: 0.07, w, s: 0.5, source: "manual", revisitOf: null }));
    const pts = readPoints(A, CL, raw), cv = coverage(A, pts); cv.zone = backgroundZone(A, cv);
    const sc = compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P: P0, sem: null, cov: cv });
    expect(sc.points[1].dur).toBeGreaterThan(sc.points[0].dur * 2);
    expect(sc.bgArea).toBeCloseTo(cv.background, 9);
    expect(sc.total * 60 / sc.bpm).toBeCloseTo(30, 9);
  });
});
