// Connections between points (passages) and the role a user gives a point in the story.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { pathProfile, passage } from "../src/core/passages.js";
import { dramaticArc } from "../src/core/arc.js";

const P0 = { style: "cinematic", duration: 30, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
function setup(seed = 1) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  return { A, CL, MOT, SAL };
}
function run(P, points = null, seed = 1) {
  const { A, CL, MOT, SAL } = setup(seed);
  const pts = readPoints(A, CL, points || gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
// a dark image with one bright vertical bar in the middle
function bar() {
  const W = 160, H = 100, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 4, v = x >= 76 && x < 84 ? 230 : 40; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255; }
  return { width: W, height: H, data: d };
}
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

describe("path profile", () => {
  it("finds the edges a line crosses and follows its brightness", () => {
    const A = analyze(bar()), prof = pathProfile(A, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 });
    expect(prof.crossings.length).toBeGreaterThanOrEqual(1);
    for (const c of prof.crossings) expect(Math.abs(c.f - 0.5)).toBeLessThan(0.12);
    expect(Math.max(...prof.lum)).toBeGreaterThan(prof.lum[0] + 0.3);
    expect(prof.len).toBeCloseTo(0.8, 9);
  });
});

describe("passage", () => {
  const prof = { len: 0.6, lum: Array.from({ length: 64 }, (_, i) => 0.3 + 0.4 * Math.sin(i / 10)), crossings: [{ f: 0.3, s: 1 }, { f: 0.7, s: 1 }], regions: 3 };
  const chord = () => new Set([0, 4, 7]);
  it("stays in its window, leads into the arrival by a step and is empty when off", () => {
    for (const level of ["light", "rich"]) {
      const ps = passage(60, 72, 10, 12, prof, level, "cinematic", C_MAJOR, chord);
      expect(ps.length).toBeGreaterThan(0);
      if (level === "light") expect(ps.length).toBeLessThanOrEqual(2);
      for (const x of ps) { expect(x.t).toBeGreaterThanOrEqual(10); expect(x.t + x.dur).toBeLessThanOrEqual(12 + 1e-9); expect(C_MAJOR.has(x.midi % 12)).toBe(true); }
      const last = ps[ps.length - 1];
      expect(Math.abs(last.midi - 72)).toBeLessThanOrEqual(2); expect(last.midi).not.toBe(72);
    }
    expect(passage(60, 72, 10, 12, prof, "off", "cinematic", C_MAJOR, chord)).toEqual([]);
  });
  it("uses a chromatic approach in jazz", () => {
    const ps = passage(60, 72, 10, 12, prof, "rich", "jazz", C_MAJOR, chord);
    expect(ps[ps.length - 1].midi).toBe(71); expect(ps[ps.length - 1].chromatic).toBe(true);
  });
});

describe("connections in the piece", () => {
  it("add passages with their path, and Off leaves the piece as it was", () => {
    const off = run({ ...P0, connect: "off" }), rich = run({ ...P0, connect: "rich" });
    expect(off.notes.some(n => n.passage)).toBe(false);
    const ps = rich.notes.filter(n => n.passage);
    expect(ps.length).toBeGreaterThan(0);
    for (const n of ps) { const F = rich.points[n.passage.from]; expect(n.t).toBeGreaterThanOrEqual(F.t0); expect(n.t).toBeLessThan(F.t1); expect(n.passage.to).toBe(n.passage.from + 1); }
    expect(run({ ...P0, connect: "rich" }).notes.filter(n => n.passage).length).toBe(ps.length); // deterministic
  });
});

describe("roles in the story", () => {
  it("a point marked climax is the climax; calm and release lower the tension", () => {
    const segs = Array.from({ length: 8 }, (_, i) => ({ t0: i * 4, t1: i * 4 + 4, x: i / 8, y: 0.5, w: 0.5, revisit: false }));
    segs[2].mood = "climax"; segs[5].mood = "calm"; segs[6].mood = "release";
    const a = dramaticArc(segs, 32, 0.7);
    expect(a.climax).toBe(2); expect(a.section[2]).toBe("climax");
    expect(a.tension[5]).toBeLessThanOrEqual(0.35); expect(a.tension[6]).toBeLessThanOrEqual(0.45); expect(a.section[6]).toBe("resolution");
  });
  it("roles and accents reach the composition", () => {
    const { A, SAL } = setup(2), pts = gazePath(A, SAL.map, P0).map((q, i) => ({ ...q, source: "manual", revisitOf: null, mood: i === 1 ? "climax" : undefined, accent: i === 3 }));
    const sc = run(P0, pts, 2);
    expect(sc.arc.climax).toBe(1); expect(sc.points[1].section).toBe("climax");
    expect(sc.notes.some(n => n.layer === "perc" && n.accent && Math.abs(n.t - sc.points[3].t0) < 1e-9)).toBe(true);
  });
});
