// Movement in held bars, and the colour of the piece (filter sweeps, echoes, shimmer, wide pad).
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { MOTION, MOTION_ID, motionPreset } from "../src/core/motion.js";
import { LIBRARY } from "../src/core/instruments.js";

const P0 = { duration: 30, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, samples: true, orch: "small" };
const cache = new Map();
function run(P, seed = 1) {
  let s = cache.get(seed);
  if (!s) { const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6); s = { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) }; cache.set(seed, s); }
  const pts = readPoints(s.A, s.CL, gazePath(s.A, s.SAL.map, P)), cov = coverage(s.A, pts); cov.zone = backgroundZone(s.A, cov);
  return compose({ A: s.A, sal: s.SAL, points: pts, cl: s.CL, motifs: s.MOT, P, sem: null, cov });
}
const pc = m => ((m % 12) + 12) % 12;
const heldBars = sc => { let held = 0, bars = 0; for (let b0 = sc.intro || 0; b0 + 4 <= sc.body; b0 += 4, bars++) { const on = new Set(sc.notes.filter(n => n.layer !== "lead" && n.layer !== "perc" && n.layer !== "pad" && n.t >= b0 && n.t < b0 + 4).map(n => Math.round(n.t * 4))); if (on.size <= 1) held++; } return held / bars; };

describe("movement in held bars", () => {
  it("every style with a figure names a real instrument, sampled or not", () => {
    for (const st of Object.keys(MOTION)) for (const s of [true, false]) expect(LIBRARY[motionPreset(st, s)], `${st} ${s}`).toBeTruthy();
  });
  for (const style of ["meditation", "cinematic", "synthwave", "ambient", "dnb"]) it(`moves where it held (${style})`, () => {
    let less = 0;
    for (const seed of [1, 3]) {
      const on = run({ ...P0, style }, seed), off = run({ ...P0, style, rules: { motion: false } }, seed);
      expect(heldBars(on), `${style} ${seed}`).toBeLessThanOrEqual(heldBars(off));
      if (heldBars(on) < heldBars(off)) less++;
      const xs = on.notes.filter(n => n.layer === MOTION_ID);
      if (xs.length) expect(on.extra.find(L => L.id === MOTION_ID).label).toBe("Movement");
      for (const n of xs) {
        // tones of the chord, inside its chord, below the melody sounding with it
        const S = on.slots.find(S => n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9);
        expect(S.chord.map(pc)).toContain(pc(n.midi));
        expect(n.t + n.dur).toBeLessThanOrEqual(S.t1 + 1e-9);
        for (const m of on.notes.filter(m => m.layer === "lead" && !m.dbl && !m.echo && m.t <= n.t + 1e-6 && m.t + m.dur > n.t + 1e-6)) expect(n.midi).toBeLessThan(m.midi);
        // E3 or above (a modulation may move a passage down by up to a fourth)
        expect(n.midi).toBeGreaterThanOrEqual(52 - 5);
      }
    }
    expect(less).toBeGreaterThan(0);
  });
  it("a style that already moves gets no figure", () => {
    expect(run({ ...P0, style: "rock" }).extra.some(L => L.id === MOTION_ID)).toBe(false);
  });
});

describe("colour", () => {
  it("echoes come back softer, after the note, in the chord, above C4", () => {
    const sc = run({ ...P0, style: "pop" });
    const echoes = sc.notes.filter(n => n.echo);
    for (const e of echoes) {
      const S = sc.slots.find(S => e.t >= S.t0 - 1e-9 && e.t < S.t1 - 1e-9);
      expect(S.chord.map(pc)).toContain(pc(e.midi));
      expect(e.midi).toBeGreaterThanOrEqual(60); expect(e.vel).toBeLessThan(70);
    }
    expect(run({ ...P0, style: "pop", rules: { echoes: false } }).notes.some(n => n.echo)).toBe(false);
  });
  it("the shimmer is an airy octave above the pad, and the pad fans out", () => {
    const sc = run({ ...P0, style: "ambient" }), sh = sc.notes.filter(n => n.shimmer);
    expect(sh.length).toBeGreaterThan(0);
    for (const n of sh) expect(n.midi).toBeGreaterThanOrEqual(60);
    expect(run({ ...P0, style: "rock" }).notes.some(n => n.shimmer)).toBe(false);
    const pans = new Set(sc.notes.filter(n => n.layer === "pad" && !n.shimmer).map(n => Math.round(n.pan * 100)));
    expect(pans.size).toBeGreaterThan(1);
  });
  it("vinyl only in lo-fi and trip-hop, and it can be turned off", () => {
    expect(run({ ...P0, style: "lofi" }).vinyl).toBe(true);
    expect(run({ ...P0, style: "lofi", rules: { vinyl: false } }).vinyl).toBe(false);
    expect(run({ ...P0, style: "pop" }).vinyl).toBe(false);
  });
  it("the sweep opens the harmony's filter at the climax", () => {
    const on = run({ ...P0, style: "pop" }), off = run({ ...P0, style: "pop", rules: { sweep: false } });
    const ci = on.arc.climax, cut = sc => { const h = sc.notes.filter(n => n.layer === "harm" && n.point === ci); return h.reduce((a, n) => a + n.tim.cut, 0) / h.length; };
    if ((on.points[ci].tension ?? 0.6) > 0.65) expect(cut(on)).toBeGreaterThan(cut(off));
  });
});
