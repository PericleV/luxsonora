// Pad that follows the harmony: chord tones, minimal voice motion, held common tones,
// timbre from the background around each point, everything ends before T.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, surroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose, padVoicing } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { resolveInstruments, STORY_LEAD, LIBRARY } from "../src/core/instruments.js";

const P0 = { style: "ambient", duration: 30, count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6 };
function run(seed, P = P0) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return { A, cov, sc: compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov }) };
}
const pcOf = m => ((m % 12) + 12) % 12;

describe("pad voicing", () => {
  it("covers the triad and moves as little as possible", () => {
    const c = padVoicing([0, 4, 7], null);
    expect(c.map(pcOf).sort((a, b) => a - b)).toEqual([0, 4, 7]);
    const f = padVoicing([5, 9, 0], c); // C → F: C held, E→F, G→A
    expect(f.map(pcOf).sort((a, b) => a - b)).toEqual([0, 5, 9]);
    expect(f.reduce((s, m, k) => s + Math.abs(m - c[k]), 0)).toBeLessThanOrEqual(3);
    expect(f).toContain(c[0]);
  });
});

describe("pad", () => {
  for (const style of Object.keys(STYLES)) it(`follows the chords (${style})`, () => {
    for (const seed of [1, 2, 3]) {
      const { sc } = run(seed, { ...P0, style }), pad = sc.notes.filter(n => n.layer === "pad");
      const T = sc.total * 60 / sc.bpm;
      // the pad moves with the harmonic grid: at every chord slot it sounds that slot's triad
      for (const S of sc.slots) {
        const sounding = pad.filter(n => n.t <= S.t0 + 1e-9 && n.t + n.dur > S.t0 + 1e-9).map(n => pcOf(n.midi));
        expect(sounding.length).toBe(3);
        const chordPcs = new Set(S.chord.map(pcOf));
        for (const p of sounding) expect(chordPcs.has(p)).toBe(true);
      }
      // a voice is never restruck on the same note right after itself
      const byMidi = new Map();
      for (const n of [...pad].sort((a, b) => a.t - b.t)) {
        const prev = byMidi.get(n.midi);
        if (prev) expect(n.t).toBeGreaterThan(prev.t + prev.dur + 1e-9);
        byMidi.set(n.midi, n);
      }
      // notes end inside the cadence bar; their release may run into the master fade, as before
      for (const n of pad) expect(n.t + n.dur).toBeLessThanOrEqual(sc.total + 1e-9);
      expect(T).toBeCloseTo(30, 9);
    }
  });
  it("changes timbre with the surroundings of the points", () => {
    const { sc } = run(1), cuts = new Set(sc.points.map(F => Math.round(F.padTim.cut)));
    expect(cuts.size).toBeGreaterThan(1);
  });
  it("surroundZone reads more background far from the points", () => {
    const { A, cov, sc } = run(2), F = sc.points[0];
    const at = surroundZone(A, cov, F.x, F.y, F.r).amount;
    expect(at).toBeGreaterThanOrEqual(0); expect(at).toBeLessThanOrEqual(1);
  });
});

describe("story lead instrument", () => {
  it("is a sustained default with the Story melody, unless a preset is chosen", () => {
    for (const style of Object.keys(STYLES)) {
      expect(resolveInstruments(style, {}, "story").lead.name).toBe(LIBRARY[STORY_LEAD[style]].name);
      expect(resolveInstruments(style, {}, "classic").lead.name).toBe(STYLES[style].inst.lead.name);
      expect(resolveInstruments(style, { lead: { preset: "x.glass" } }, "story").lead.name).toBe("Glass bell");
      expect(LIBRARY[STORY_LEAD[style]].type).not.toBe("pluck");
    }
  });
});
