import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { autoModeOf } from "../src/core/theory.js";

const P0 = { style: "cinepop", duration: 30, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, connect: "light", samples: true };
function run(P, seed = 3) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions), SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}

describe("cinematic pop", () => {
  it("the mood picks bittersweet, hopeful or lift chords", () => {
    expect(new Set([0.25, 0.5, 0.75].map(v => autoModeOf("cinepop", v).family.key))).toEqual(new Set(["bittersweet", "hopeful", "lift"]));
  });
  it("the beat grows from nothing: no drums in the introduction, the fullest kit at the climax", () => {
    for (const seed of [1, 3, 7]) {
      const sc = run({ ...P0, intro: "auto" }, seed), perc = sc.notes.filter(n => n.layer === "perc" && !n.swell && !n.roll);
      if (sc.intro > 0) expect(perc.filter(n => n.t < sc.intro - 1e-9 && n.midi !== 49)).toEqual([]);
      const perBeat = sec => { const F = sc.points.filter(p => p.section === sec); const ns = perc.filter(n => F.some(p => n.t >= p.t0 - 1e-9 && n.t < p.t1 - 1e-9)); const beats = F.reduce((a, p) => a + p.t1 - p.t0, 0); return beats ? ns.length / beats : null; };
      const climax = perBeat("climax"), intro = sc.points.filter(p => p.section !== "climax");
      if (climax !== null && intro.length) { const rest = perc.filter(n => intro.some(p => n.t >= p.t0 - 1e-9 && n.t < p.t1 - 1e-9)).length / intro.reduce((a, p) => a + p.t1 - p.t0, 0); expect(climax).toBeGreaterThan(rest); }
    }
  });
  it("with the picture choosing the band, the ensemble follows the chords", () => {
    const want = { bittersweet: "indie", hopeful: "anthem", lift: "orchestral" };
    for (const scale of ["aeolian", "ionian", "lydian"]) { const sc = run({ ...P0, pictureBand: true, orch: "medium", scale }); expect(sc.palette).toBe(want[sc.family]); }
  });
});
