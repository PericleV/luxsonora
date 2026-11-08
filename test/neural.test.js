// Improvise melody (ImprovRNN) and Human groove (GrooVAE) with fake models: shapes, timing,
// genre rules. The real networks are checked in the browser.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { improvMelody } from "../src/ml/improv.js";
import { grooveFor, applyGroove } from "../src/ml/groove.js";
import { applyStory } from "../src/ml/story.js";

const P0 = { style: "jazz", duration: 30, count: 6, returns: 2, inhibition: 0.18, memory: 0.1, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
function score(P = P0) {
  const A = analyze(synthImage(200, 133, 2)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}

// fake ImprovRNN: repeats the seed's last pitch on every beat; records the chords it was given
const fakeRnn = () => {
  const calls = [];
  return { calls, async continue(seed, steps, chords) {
    calls.push({ seed, steps, chords });
    for (const n of seed.notes) { expect(n.pitch).toBeGreaterThanOrEqual(48); expect(n.pitch).toBeLessThanOrEqual(83); }
    const p = seed.notes.length ? seed.notes[seed.notes.length - 1].pitch : 60, notes = [];
    for (let s = 0; s < steps; s += 4) notes.push({ pitch: p, quantizedStartStep: s, quantizedEndStep: Math.min(steps, s + 3) });
    return { notes };
  } };
};

describe("improvise melody", () => {
  it("fills every point inside its time, with chords for seed and continuation", async () => {
    const sc = score(), m = fakeRnn(), res = await improvMelody(sc, m);
    expect(res.segments.length).toBe(sc.points.length);
    res.segments.forEach((seg, i) => {
      const F = sc.points[i];
      expect(m.calls[i].chords.length).toBe(12 + Math.round(F.dur * 4));
      for (const n of seg.notes) { expect(n.t).toBeGreaterThanOrEqual(F.t0 - 1e-9); expect(n.t + n.dur).toBeLessThanOrEqual(F.t1 + 1e-9); }
    });
    applyStory(sc, res);
    expect(sc.notes.filter(n => n.layer === "lead" && n.point >= 0 && !n.dbl).every(n => n.story)).toBe(true);
  });
});

// fake GrooVAE: plays every hit 0.2 of a sixteenth late at velocity 100
const fakeGroove = () => ({ async humanize(seqs, qpm) {
  const step = 60 / qpm / 4;
  // the real model refuses a window with a hit on step 32 or beyond
  for (const sq of seqs) for (const n of sq.notes) { expect(Math.round(n.startTime / step)).toBeLessThan(32); expect(n.endTime).toBeLessThanOrEqual(sq.totalTime + 1e-9); }
  return seqs.map(s => ({ notes: s.notes.map(n => ({ ...n, startTime: n.startTime + 0.2 * step, velocity: 100 })) }));
} });

describe("human groove", () => {
  it("moves hits off the grid except in electronic music, and keeps every hit", async () => {
    for (const style of ["jazz", "electronic", "epic"]) {
      const sc = score({ ...P0, style }), before = sc.notes.filter(n => n.layer === "perc").map(n => [n.t, n.midi]);
      const g = await grooveFor(sc, fakeGroove());
      expect(g.hits.length).toBeGreaterThan(0);
      applyGroove(sc, g);
      const after = sc.notes.filter(n => n.layer === "perc");
      expect(after.length).toBe(before.length);
      const moved = after.filter(n => n.groove && Math.abs(n.t * 4 - Math.round(n.t * 4)) > 1e-6).length;
      if (style === "electronic") expect(moved).toBe(0); else expect(moved).toBeGreaterThan(0);
      expect(after.filter(n => n.groove).every(n => n.vel !== undefined)).toBe(true);
    }
  });
});
