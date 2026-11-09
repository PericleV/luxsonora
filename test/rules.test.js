// Composition rules (src/core/rules.js): each one can be turned off, the modulation stays in the
// new key and comes home, and the rules make the voice leading cleaner, not rougher.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { RULES_INFO, defaultRules, ruleOn } from "../src/core/rules.js";
import { auditScore } from "../scripts/music-audit.mjs";

const IMAGES = [[200, 133, 1], [180, 180, 11], [160, 120, 3]].map(([w, h, s]) => {
  const A = analyze(synthImage(w, h, s)), CL = clusterRegions(A, 6);
  return { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) };
});
const BASE = { count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, duration: 30, orch: "full", connect: "light" };
const OFF = Object.fromEntries(Object.keys(RULES_INFO).map(k => [k, false]));
// the classical-craft rules only (the comparison with and without them)
const CRAFT_OFF = Object.fromEntries(Object.entries(RULES_INFO).filter(([k, r]) => r.group === "craft" || k === "contrast").map(([k]) => [k, false]));
const run = (I, P) => {
  const pts = readPoints(I.A, I.CL, gazePath(I.A, I.SAL.map, P)), cov = coverage(I.A, pts); cov.zone = backgroundZone(I.A, cov);
  return compose({ A: I.A, sal: I.SAL, points: pts, cl: I.CL, motifs: I.MOT, P, sem: null, cov });
};
const pc = m => ((m % 12) + 12) % 12;

describe("composition rules", () => {
  it("are all on by default, and a missing setting counts as on", () => {
    expect(Object.values(defaultRules()).every(Boolean)).toBe(true);
    expect(ruleOn({}, "modulate")).toBe(true);
    expect(ruleOn({ rules: { modulate: false } }, "modulate")).toBe(false);
    expect(ruleOn({ rules: { modulate: false } }, "peak")).toBe(true);
  });
  it("turned off, there is no modulation, no phrase cadence and no Picardy third", () => {
    for (const style of Object.keys(STYLES)) for (const I of IMAGES) {
      const sc = run(I, { ...BASE, style, rules: OFF });
      expect(sc.modulation).toBe(null);
      expect(sc.picardy).toBe(false);
      expect(sc.slots.every(S => !S.cadence && !S.shift)).toBe(true);
    }
  });
  it("the modulation moves one step on the circle of fifths, keeps its chords in the new key and comes home", () => {
    let seen = 0;
    for (const style of Object.keys(STYLES)) for (const I of IMAGES) {
      const sc = run(I, { ...BASE, style }), M = sc.modulation;
      if (!M) continue;
      seen++;
      expect([5, -5]).toContain(M.shift);
      expect(M.keyPc).toBe(pc(sc.pc + (M.dir > 0 ? 7 : 5)));
      expect(M.t1).toBeLessThan(sc.body);
      const newKey = new Set(sc.modeIv.map(iv => pc(iv + sc.pcOff + M.shift)));
      for (const S of sc.slots) {
        const inWin = S.t0 >= M.t0 - 1e-9 && S.t0 < M.t1 - 1e-9;
        expect(S.shift).toBe(inWin ? M.shift : 0);
        if (inWin && !sc.slots.some(x => x.cadence)) for (const p of S.chord.map(pc)) expect(newKey.has(p)).toBe(true);
      }
      // the last chord is home again
      const last = sc.slots[sc.slots.length - 1];
      expect(last.shift).toBe(0);
    }
    expect(seen).toBeGreaterThan(5);
  });
  it("any single rule can be turned off and the piece stays well formed", () => {
    for (const k of Object.keys(RULES_INFO)) for (const style of ["classical", "epic", "electronic", "jazz", "rock"]) {
      const sc = run(IMAGES[0], { ...BASE, style, rules: { [k]: false } });
      expect(sc.notes.length).toBeGreaterThan(10);
      for (const n of sc.notes) {
        expect(n.t).toBeGreaterThanOrEqual(0); expect(n.t + n.dur).toBeLessThanOrEqual(sc.total + 1e-6);
        expect(n.midi).toBeGreaterThanOrEqual(0); expect(n.midi).toBeLessThanOrEqual(127); expect(n.vel).toBeGreaterThanOrEqual(1);
      }
      if (k === "sidechain" && style === "electronic") expect(sc.sidechain).toBe(0);
    }
  });
  it("phrase cadences end every fourth bar on the dominant, then on the tonic", () => {
    const sc = run(IMAGES[0], { ...BASE, style: "classical", duration: 60 });
    const cad = sc.slots.filter(S => S.cadence);
    expect(cad.length).toBeGreaterThan(1);
    expect(cad[0].cadence).toBe("half");
    if (cad[1]) expect(cad[1].cadence).toBe("full");
    for (const S of cad) expect(S.t1 % 16).toBe(0);
  });
  it("with the rules on there are fewer parallel fifths and octaves, and no more clashes", () => {
    const tot = { on: { parallel: 0, clash: 0 }, off: { parallel: 0, clash: 0 } };
    for (const style of Object.keys(STYLES)) for (const I of IMAGES) for (const [k, rules] of [["on", undefined], ["off", CRAFT_OFF]]) {
      const r = auditScore(run(I, { ...BASE, style, rules }));
      tot[k].parallel += r.cnt.parallel || 0; tot[k].clash += r.cnt.clash || 0;
    }
    expect(tot.on.parallel).toBeLessThan(tot.off.parallel);
    expect(tot.on.clash).toBeLessThanOrEqual(tot.off.clash * 1.1);
  }, 180000);
});
