// Orchestration: extra layers by level, harmony, registers, entries over the arc, determinism.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { autoLayers, ROLES } from "../src/core/arrange.js";

const P0 = { style: "cinematic", duration: 30, count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
function run(P, seed = 1) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const strip = sc => sc.notes.map(n => [n.layer, Math.round(n.t * 1e4), Math.round(n.dur * 1e4), n.midi, n.vel]);

describe("orchestration levels", () => {
  it("Small adds nothing: the piece is the five-layer one", () => {
    const a = run({ ...P0 }), b = run({ ...P0, orch: "small" });
    expect(b.extra).toEqual([]);
    expect(strip(b)).toEqual(strip(a));
  });
  it("Medium adds 2-3 layers and Full 4-6, in the style's order", () => {
    for (const style of Object.keys(STYLES)) {
      expect(autoLayers(style, "medium", 0, false).length).toBe(2);
      expect(autoLayers(style, "medium", 1, false).length).toBe(3);
      expect(autoLayers(style, "full", 0, false).length).toBe(4);
      expect(autoLayers(style, "full", 1, false).length).toBe(6);
    }
  });
});

describe("extra layers", () => {
  for (const style of Object.keys(STYLES)) it(`play in the scale, in their own register, and enter with the arc (${style})`, () => {
    for (const seed of [1, 2]) {
      const sc = run({ ...P0, style, orch: "full" }, seed), base = 60 + sc.pcOff, scale = new Set(sc.modeIv.map(v => (((v + sc.pc) % 12) + 12) % 12));
      expect(sc.extra.length).toBeGreaterThanOrEqual(4);
      const ids = new Set(sc.extra.map(L => L.id));
      const xs = sc.notes.filter(n => ids.has(n.layer));
      expect(xs.length).toBeGreaterThan(0);
      for (const n of xs) {
        if (!n.chromatic) expect(scale.has(((n.midi % 12) + 12) % 12)).toBe(true);
        expect(n.midi).toBeGreaterThanOrEqual(base - 30); expect(n.midi).toBeLessThanOrEqual(base + 28);
        expect(n.tim).toBeTruthy();
        expect((n.t + n.dur) * 60 / sc.bpm).toBeLessThanOrEqual(sc.seconds + 6);
      }
      // the introduction carries fewer extra notes per beat than the climax
      const per = sec => { const ps = sc.points.filter(F => F.section === sec), beats = ps.reduce((s, F) => s + F.dur, 0); return beats ? xs.filter(n => n.point >= 0 && sc.points[n.point].section === sec).length / beats : null; };
      const intro = per("intro"), climax = per("climax");
      if (intro !== null && climax !== null) expect(climax).toBeGreaterThanOrEqual(intro);
    }
  });
  it("are deterministic and keep the five core layers unchanged", () => {
    const a = run({ ...P0, orch: "full" }), b = run({ ...P0, orch: "full" }), small = run({ ...P0 });
    expect(strip(a)).toEqual(strip(b));
    const core = sc => strip(sc).filter(r => ["lead", "harm", "bass", "pad", "perc"].includes(r[0]));
    expect(core(a)).toEqual(core(small));
  });
  it("take custom layers with their instruments", () => {
    const sc = run({ ...P0, orch: "custom", layers: [{ id: "c1", role: "counter", preset: "x.softlead" }, { id: "c2", role: "ornament", preset: "x.glass" }] });
    expect(sc.extra.map(L => L.id)).toEqual(["c1", "c2"]);
    expect(sc.inst.c1.name).toBe("Soft lead");
    expect(sc.notes.some(n => n.layer === "c1")).toBe(true);
    for (const role of Object.keys(ROLES)) expect(ROLES[role].gain).toBeGreaterThan(0);
  });
});
