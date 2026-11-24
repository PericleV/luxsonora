import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { classicalIdiomOf } from "../src/core/gen.js";

const P0 = { style: "classical", duration: 60, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, connect: "light", samples: true };
function run(P, seed = 3) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions), SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const pc = m => ((m % 12) + 12) % 12;
const pic = (edgeN, entropy) => ({ global: { edgeN, entropy, brightness: 0.5, warmth01: 0.5, sat: 0.5 } });

describe("classical: the classical and the baroque idiom", () => {
  it("a detailed picture plays baroque, a calm one classical; a choice by hand wins", () => {
    expect(classicalIdiomOf({ style: "classical" }, pic(0.9, 0.9))).toMatchObject({ side: "baroque", inner: "baroque" });
    expect(classicalIdiomOf({ style: "classical" }, pic(0.1, 0.1))).toBeNull();
    expect(classicalIdiomOf({ style: "classical", classicIdiom: "classical" }, pic(0.9, 0.9))).toBeNull();
    expect(classicalIdiomOf({ style: "classical", classicIdiom: "baroque" }, pic(0.1, 0.1))).toMatchObject({ side: "baroque" });
    expect(classicalIdiomOf({ style: "baroque" }, pic(0.9, 0.9))).toBeNull();
  });
  it("classical periods: a half cadence on V at bar four, a full one on I at bar eight", () => {
    const sc = run({ ...P0, classicIdiom: "classical", scale: "ionian" });
    expect(sc.style).toBe("classical");
    const body = sc.slots.filter(S => !S.intro), off = body[0].t0;
    const at = bar => body.find(S => S.t0 >= off + bar * 4 - 1e-9 && S.t0 < off + (bar + 1) * 4 - 1e-9);
    expect(at(3).root).toBe(4); expect(at(3).cadence).toBe("half");
    expect(at(7).root).toBe(0); expect(at(7).cadence).toBe("full");
  });
  it("in minor the dominant is major: its third is the raised seventh, on every track", () => {
    const sc = run({ ...P0, classicIdiom: "classical", scale: "aeolian" }), lt = pc(sc.pc + 11), b7 = pc(sc.pc + 10);
    const V = sc.slots.filter(S => !S.intro && S.root === 4 && !S.shift);
    expect(V.length).toBeGreaterThan(0);
    for (const S of V) {
      expect(S.chord.map(pc)).toContain(lt); expect(S.chord.map(pc)).not.toContain(b7);
      // nothing starting under it plays the lowered seventh
      expect(sc.notes.filter(n => n.layer !== "perc" && n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9 && pc(n.midi) === b7)).toEqual([]);
    }
    // and the leading tone sounds there
    expect(V.some(S => sc.notes.some(n => n.layer !== "perc" && n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9 && pc(n.midi) === lt))).toBe(true);
  });
  it("baroque: sequences on the circle of fifths over a walking continuo in eighths", () => {
    const sc = run({ ...P0, classicIdiom: "baroque", scale: "ionian" });
    expect(sc.style).toBe("baroque"); expect(sc.side).toBe("baroque"); expect(sc.genre).toBe("classical");
    expect(["circle", "romanesca"]).toContain(sc.family);
    const walk = sc.slots.filter(S => S.bassKind === "continuo");
    expect(walk.length).toBeGreaterThan(0);
    const S = walk[0], bass = sc.notes.filter(n => n.layer === "bass" && n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9).sort((a, b) => a.t - b.t);
    expect(bass.length).toBe(8);
    for (let i = 1; i < bass.length; i++) expect(Math.abs(bass[i].midi - bass[i - 1].midi)).toBeLessThanOrEqual(4);
  });
  it("with the picture choosing the band, the ensemble follows the chords", () => {
    const want = { lament: ["quartet", "organ"], galant: ["piano"], period: ["piano"], circle: ["concerto"], romanesca: ["concerto"] };
    for (const [idiom, scale] of [["classical", "aeolian"], ["classical", "ionian"], ["baroque", "aeolian"], ["baroque", "ionian"]]) {
      const sc = run({ ...P0, pictureBand: true, orch: "medium", classicIdiom: idiom, scale });
      expect(want[sc.family]).toContain(sc.palette);
    }
  });
});
