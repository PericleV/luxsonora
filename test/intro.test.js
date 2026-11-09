// The generated intro and ending (src/core/intro.js, duration.js): lengths, timing, the notes.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { sectionBeats, planTime } from "../src/core/duration.js";
import { auditScore } from "../scripts/music-audit.mjs";

const I = (() => { const A = analyze(synthImage(200, 133, 1)), CL = clusterRegions(A, 6); return { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) }; })();
const BASE = { count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, duration: 30, orch: "full", connect: "light" };
const run = P => { const pts = readPoints(I.A, I.CL, gazePath(I.A, I.SAL.map, P)), cov = coverage(I.A, pts); cov.zone = backgroundZone(I.A, cov); return compose({ A: I.A, sal: I.SAL, points: pts, cl: I.CL, motifs: I.MOT, P, sem: null, cov }); };

describe("intro and ending", () => {
  it("lengths: off, one or two bars, or auto, and the places keep at least two bars", () => {
    expect(sectionBeats("off", 12, "intro")).toBe(0); expect(sectionBeats(1, 12, "intro")).toBe(4); expect(sectionBeats(2, 12, "end")).toBe(8);
    expect(sectionBeats("auto", 12, "intro")).toBe(4); expect(sectionBeats("auto", 6, "intro")).toBe(0);
    expect(sectionBeats("auto", 12, "end")).toBe(4); expect(sectionBeats("auto", 24, "end")).toBe(8);
    const p = planTime(8, 90, [1, 1, 1], 1, 2, 2); // 3 bars: the intro and then the ending give way
    expect(p.fullTotal - p.intro - p.end).toBeGreaterThanOrEqual(8);
  });
  for (const intro of ["off", 1, 2, "auto"]) for (const end of ["off", 1, 2, "auto"]) it(`intro ${intro}, ending ${end}: exact length, places after the intro, nothing past the end`, () => {
    for (const style of ["ambient", "rock", "jazz", "electronic", "classical"]) for (const duration of [15, 30, 60]) {
      const sc = run({ ...BASE, style, duration, intro, end });
      expect(Math.abs((sc.total * 60) / sc.bpm - duration)).toBeLessThan(1e-9);
      expect(sc.body).toBe(sc.total - sc.endBeats);
      expect(sc.points[0].t0).toBeCloseTo(sc.intro, 9);
      expect(sc.points[sc.points.length - 1].t1).toBeCloseTo(sc.body, 9);
      expect(sc.slots[0].t0).toBe(0); expect(sc.slots[sc.slots.length - 1].t1).toBeCloseTo(sc.body, 9);
      for (const n of sc.notes) { expect(n.t).toBeGreaterThanOrEqual(0); expect(n.t + n.dur).toBeLessThanOrEqual(sc.total + 1e-9); }
      if (sc.intro > 0) {
        const intro = sc.notes.filter(n => n.intro);
        expect(intro.some(n => n.layer === "pad")).toBe(true);
        for (const n of intro) expect(n.t).toBeLessThan(sc.intro);
        // nothing of the places sounds before the intro ends
        for (const n of sc.notes.filter(n => n.point >= 0)) expect(n.t).toBeGreaterThanOrEqual(sc.intro - 0.5);
      } else expect(sc.notes.some(n => n.intro)).toBe(false);
      if (sc.endBeats === 0) { expect(sc.notes.some(n => n.point === -2)).toBe(false); expect(sc.cadence).toBe(null); }
      else expect(sc.cadence.t).toBeCloseTo(sc.total - sc.endBeats, 9);
    }
  });
  it("the intro's lead-in steps into the first melody note, in the scale", () => {
    for (const style of Object.keys(STYLES)) {
      const sc = run({ ...BASE, style, intro: 1 }), first = sc.notes.filter(n => n.layer === "lead" && n.point >= 0 && !n.dbl).sort((a, b) => a.t - b.t)[0];
      const lead = sc.notes.filter(n => n.layer === "lead" && n.intro);
      expect(lead.length).toBeGreaterThan(0);
      for (const n of lead) { expect(n.midi).toBeLessThan(first.midi + 1); expect(first.midi - n.midi).toBeLessThanOrEqual(7); }
    }
  });
  it("the intro is in the key: the tonic chord under it, the lead-in in the scale", () => {
    const pc = m => ((m % 12) + 12) % 12;
    for (const style of Object.keys(STYLES)) {
      const sc = run({ ...BASE, style, intro: 2 }), tonic = new Set([0, 2, 4].map(o => pc(sc.modeIv[o] + sc.pcOff))), scale = new Set(sc.melIv.map(v => pc(v + sc.pcOff)));
      for (const n of sc.notes.filter(n => n.intro && n.layer !== "perc")) {
        if (n.layer === "lead") expect(scale.has(pc(n.midi)), `${style} lead-in`).toBe(true);
        else expect(tonic.has(pc(n.midi)), `${style} ${n.layer}`).toBe(true);
      }
      const a = auditScore(sc);
      for (const k of ["outOfMode", "range", "ending"]) expect(a.cnt[k] || 0, `${style} ${k}`).toBe(0);
    }
  });
});
