// Harmony guard: the music audit (scripts/music-audit.mjs) on a few pieces per style must stay
// under limits set from the audited values (November 2026), so a change that brings back clashes,
// wrong accompaniment notes or restrikes fails here.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { auditScore } from "../scripts/music-audit.mjs";

const IMAGES = [[200, 133, 1], [180, 180, 11]].map(([w, h, s]) => {
  const A = analyze(synthImage(w, h, s)), CL = clusterRegions(A, 6);
  return { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) };
});
const BASE = { count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
const CONFIGS = [{ duration: 30, orch: "full", connect: "light" }, { duration: 30, orch: "full", connect: "rich", count: 14, smooth: 0.9 }];
// per minute of music, summed over the pieces of a style
const LIMITS = { clash: 10, accNCT: 1, outOfMode: 0, restrike: 1.5, leap: 0.5, range: 0, ending: 0, melNCT: 3 };

describe("harmony audit", () => {
  for (const style of Object.keys(STYLES)) it(`${style}: few clashes, accompaniment in the chord, clean voices`, () => {
    const tot = {}; let minutes = 0;
    for (const I of IMAGES) for (const C of CONFIGS) {
      const P = { ...BASE, ...C, style };
      const pts = readPoints(I.A, I.CL, gazePath(I.A, I.SAL.map, P)), cov = coverage(I.A, pts); cov.zone = backgroundZone(I.A, cov);
      const r = auditScore(compose({ A: I.A, sal: I.SAL, points: pts, cl: I.CL, motifs: I.MOT, P, sem: null, cov }));
      minutes += r.minutes; for (const [k, v] of Object.entries(r.cnt)) tot[k] = (tot[k] || 0) + v;
    }
    for (const [k, lim] of Object.entries(LIMITS)) expect((tot[k] || 0) / minutes, `${style} ${k}`).toBeLessThanOrEqual(lim);
  });
});
