// Smooth transitions and manual key control.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { MODES, degMidi } from "../src/core/theory.js";

const P0 = { style: "ambient", duration: 30, count: 16, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.9, tempoAdj: 0, timbre: 1, smooth: 0 };
function run(seed, P) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const leaps = sc => sc.points.slice(1).map((F, i) => Math.abs(F.lead[0] - sc.points[i].lead[sc.points[i].lead.length - 1]));
const pcs = ch => new Set(ch.map(m => ((m % 12) + 12) % 12));
const commonTones = sc => sc.points.slice(1).reduce((c, F, i) => { const a = pcs(sc.points[i].chord); return c + [...pcs(F.chord)].filter(p => a.has(p)).length; }, 0);

describe("smooth transitions", () => {
  it("limit melodic leaps into a new point unless the octave move would leave the register", () => {
    let total = 0, small = 0;
    for (const seed of [1, 2, 3, 5, 8]) {
      const on = run(seed, { ...P0, smooth: 1 }), base = 60 + on.pcOff, lo = base - 12, hi = base + 24;
      on.points.slice(1).forEach((F, i) => {
        const last = on.points[i].lead.at(-1), l = Math.abs(F.lead[0] - last);
        // the melody snaps to the chord on the harmonic grid (at most a whole tone), so allow 2 more
        total++; if (l <= 8) { small++; return; }
        // a larger leap is allowed only when moving an octave toward the previous note leaves the register
        const alt = F.lead[0] + (F.lead[0] > last ? -12 : 12);
        expect(alt < lo || alt > hi || Math.abs(alt - last) >= l).toBe(true);
      });
    }
    expect(small / total).toBeGreaterThan(0.85);
  });
  it("reduce the largest leap compared with no smoothing", () => {
    let off = 0, on = 0;
    for (const seed of [1, 2, 3, 5, 8]) { off += Math.max(...leaps(run(seed, P0))); on += Math.max(...leaps(run(seed, { ...P0, smooth: 1 }))); }
    expect(on).toBeLessThan(off);
  });
  it("keep at least as many common tones between chords", () => {
    let off = 0, on = 0;
    for (const seed of [1, 2, 3, 5, 8]) { off += commonTones(run(seed, P0)); on += commonTones(run(seed, { ...P0, smooth: 1 })); }
    expect(on).toBeGreaterThanOrEqual(off);
  });
  it("cap velocity changes and blend the regions: no jump at a boundary", () => {
    for (const seed of [1, 2, 3]) {
      const on = run(seed, { ...P0, smooth: 1 }), off = run(seed, { ...P0, smooth: 0 });
      on.points.slice(1).forEach((F, i) => expect(Math.abs(F.vel - on.points[i].vel)).toBeLessThanOrEqual(12));
      // largest change of melody brightness and pan between consecutive notes across a boundary
      const jumps = sc => {
        const L = sc.notes.filter(n => n.layer === "lead" && n.point >= 0 && !n.dbl && n.t < sc.body).sort((a, b) => a.t - b.t);
        let cut = 0, pan = 0;
        for (let i = 1; i < L.length; i++) if (L[i].point !== L[i - 1].point) { cut = Math.max(cut, Math.abs(Math.log2(L[i].tim.cut / L[i - 1].tim.cut))); pan = Math.max(pan, Math.abs(L[i].pan - L[i - 1].pan)); }
        return { cut, pan };
      };
      const a = jumps(on), b = jumps(off);
      expect(a.cut).toBeLessThan(b.cut); expect(a.pan).toBeLessThanOrEqual(b.pan);
      // the melody is tied across boundaries: no rest shorter than half a beat between points
      const L = on.notes.filter(n => n.layer === "lead" && n.point >= 0 && !n.dbl && n.t < on.body).sort((a, b) => a.t - b.t);
      for (let i = 1; i < L.length; i++) if (L[i].point !== L[i - 1].point) { const gap = L[i].t - (L[i - 1].t + L[i - 1].dur); expect(gap < 1e-9 || gap >= 0.5 - 1e-9).toBe(true); }
    }
  });
  it("are off at 0%: no glides and no leap folding", () => {
    const sc = run(3, P0);
    expect(sc.notes.some(n => n.glide)).toBe(false);
    expect(sc.points.every(F => F.leapShift === 0)).toBe(true);
  });
});

describe("key control", () => {
  it("manual key and scale are respected by melody and chords", () => {
    const sc = run(1, { ...P0, keyMode: "manual", keyPc: 9, scale: "dorian" });
    expect(sc.pc).toBe(9); expect(sc.modeKey).toBe("dorian");
    const scalePcs = new Set(MODES.dorian.iv.map(i => (i + 9) % 12));
    // the chosen key and scale hold everywhere, moved by a modulation where there is one (the
    // Picardy third is a chromatic note on purpose)
    const M = sc.modulation, sh = t => (M && t >= M.t0 - 1e-9 && t < M.t1 - 1e-9 ? M.shift : 0);
    for (const n of sc.notes) if (n.layer !== "perc" && !n.chromatic) expect(scalePcs.has((((n.midi - sh(n.t)) % 12) + 12) % 12)).toBe(true);
  });
  it("pentatonic scales restrict the melody to five pitch classes", () => {
    const sc = run(4, { ...P0, keyMode: "manual", keyPc: 2, scale: "minpent" });
    const M = sc.modulation, sh = t => (M && t >= M.t0 - 1e-9 && t < M.t1 - 1e-9 ? M.shift : 0);
    const mel = new Set(sc.notes.filter(n => n.layer === "lead" && !n.chromatic).map(n => ((((n.midi - sh(n.t)) % 12) + 12) % 12)));
    const allowed = new Set([0, 3, 5, 7, 10].map(i => (i + 2) % 12));
    for (const p of mel) expect(allowed.has(p)).toBe(true);
  });
  it("melody octave shifts every melody note by 12 semitones", () => {
    const a = run(5, P0), b = run(5, { ...P0, octave: 1 });
    const la = a.notes.filter(n => n.layer === "lead" && n.point >= 0).map(n => n.midi), lb = b.notes.filter(n => n.layer === "lead" && n.point >= 0).map(n => n.midi);
    expect(lb).toEqual(la.map(m => m + 12));
  });
  it("the melodic range widens the span of the melody", () => {
    const span = sc => { const m = sc.notes.filter(n => n.layer === "lead").map(n => n.midi); return Math.max(...m) - Math.min(...m); };
    expect(span(run(1, { ...P0, range: 3 }))).toBeGreaterThanOrEqual(span(run(1, { ...P0, range: 1 })));
    expect(degMidi(0, MODES.ionian.iv, 60)).toBe(60);
  });
});
