// Story melody: seeds, chord symbols, ordering and application to the score, with a fake
// model (the real MusicVAE is checked in the browser; it needs WebGL or a long CPU run).
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { MODES } from "../src/core/theory.js";
import { triadSymbol, seedSequence, slerp, storyMelody, applyStory, placeOf, legato, STEPS } from "../src/ml/story.js";

const P = { style: "ambient", duration: 30, count: 6, returns: 2, inhibition: 0.18, memory: 0.1, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6 };
function score(points) {
  const A = analyze(synthImage(200, 133, 1)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, points || gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return { sc: compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov }), A, SAL, pts };
}

// Fake model: z is the seed's first pitch and a place tag; decode plays z[0] plus the
// chord root's offset on every quarter, so the output shows which z and chords were used.
const fake = () => {
  const calls = [];
  return {
    calls,
    async encode(seeds) { return seeds.map(s => [s.notes[0].pitch, 1, 0]); },
    async decode(z, chords) {
      calls.push({ z, chords });
      const notes = [];
      for (let s = 0; s < STEPS; s += 4) notes.push({ pitch: Math.round(z[0]) + (chords[s].startsWith("C") ? 0 : 2), quantizedStartStep: s, quantizedEndStep: s + 4 });
      return { notes };
    }
  };
};

describe("story melody", () => {
  it("names triads of every mode", () => {
    expect(triadSymbol(0, MODES.ionian.iv, 0)).toBe("C");
    expect(triadSymbol(5, MODES.ionian.iv, 0)).toBe("Am");
    expect(triadSymbol(6, MODES.ionian.iv, 0)).toBe("Bdim");
    expect(triadSymbol(0, MODES.dorian.iv, 2)).toBe("Dm");
  });
  it("builds two-bar monophonic seeds", () => {
    for (const lead of [[60], [60, 62], [64, 62, 60], [60, 62, 64, 67]]) {
      const s = seedSequence(lead);
      expect(s.totalQuantizedSteps).toBe(STEPS);
      s.notes.forEach((n, i) => { expect(n.quantizedEndStep).toBeGreaterThan(n.quantizedStartStep); if (i) expect(n.quantizedStartStep).toBeGreaterThanOrEqual(s.notes[i - 1].quantizedEndStep); });
      expect(s.notes[s.notes.length - 1].quantizedEndStep).toBeLessThanOrEqual(STEPS);
    }
  });
  it("ties repeated notes and fills short rests", () => {
    const ns = [{ t: 0, dur: 0.25, midi: 60 }, { t: 0.25, dur: 0.25, midi: 60 }, { t: 0.5, dur: 0.25, midi: 60 }, { t: 1, dur: 0.5, midi: 62 }, { t: 3, dur: 0.5, midi: 64 }];
    const out = legato(ns, 4); // the last rest is exactly LEGATO_GAP, so it stays
    expect(out.map(n => [n.t, n.dur, n.midi])).toEqual([[0, 1, 60], [1, 0.5, 62], [3, 0.5, 64]]);
  });
  it("slerp keeps the ends", () => {
    const a = [1, 0, 0], b = [0, 2, 0];
    expect(slerp(a, b, 0)).toEqual(a);
    slerp(a, b, 1).forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));
  });
  it("fills every segment inside its time and keeps revisits on the same theme", async () => {
    const { sc } = score(), m = fake(), st = await storyMelody(sc, m);
    expect(st.segments.length).toBe(sc.points.length);
    st.segments.forEach((seg, i) => {
      const F = sc.points[i];
      for (const n of seg.notes) { expect(n.t).toBeGreaterThanOrEqual(F.t0 - 1e-9); expect(n.t + n.dur).toBeLessThanOrEqual(F.t1 + 1e-9); }
    });
    // conditioning: the segment's own chord on its steps, the next chord after them
    const c0 = m.calls[0], steps = Math.round(sc.points[0].dur * 4);
    expect(new Set(c0.chords.slice(0, steps)).size).toBe(1);
    expect(st.places).toBe(new Set(sc.points.map(placeOf)).size);
  });
  it("depends on the order of the points", async () => {
    // same first point, the next two swapped: the first segment leans toward another place
    const { pts } = score(), fresh = pts.filter(q => q.revisitOf === null).map(q => ({ ...q, revisitOf: null }));
    const swapped = [fresh[0], fresh[2], fresh[1], ...fresh.slice(3)].map((q, i) => ({ ...q, index: i }));
    const a = score(fresh.map((q, i) => ({ ...q, index: i }))).sc, b = score(swapped).sc;
    const sa = await storyMelody(a, fake()), sb = await storyMelody(b, fake());
    const first = s => s.segments[0].notes.map(n => n.midi).join();
    expect(first(sa)).not.toBe(first(sb));
  });
  it("replaces the body of the melody and keeps everything else", async () => {
    const { sc } = score(), before = sc.notes.filter(n => n.layer !== "lead").length;
    const st = await storyMelody(sc, fake()); applyStory(sc, st);
    expect(sc.notes.filter(n => n.layer !== "lead").length).toBe(before);
    expect(sc.notes.filter(n => n.layer === "lead" && n.point >= 0).every(n => n.story)).toBe(true);
    expect(sc.notes.filter(n => n.layer === "lead" && n.point === -2).length).toBe(1);
    for (let i = 1; i < sc.notes.length; i++) expect(sc.notes[i].t).toBeGreaterThanOrEqual(sc.notes[i - 1].t);
  });
});
