import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { lofiSideOf, LOFI_CALM } from "../src/core/gen.js";

const P0 = { style: "lofi", duration: 30, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, connect: "light" };
function run(P, seed = 3) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions), SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const pic = (edgeN, entropy, brightness = 0.5) => ({ global: { edgeN, entropy, brightness, warmth01: 0.5, sat: 0.5 } });

describe("lo-fi: the beat and the ambient side", () => {
  it("a calm picture plays the ambient side, a busy one the beat; a choice by hand wins", () => {
    expect(lofiSideOf({ style: "lofi" }, pic(0.1, 0.1))).toMatchObject({ side: "ambient" });
    expect(lofiSideOf({ style: "lofi" }, pic(0.8, 0.8))).toBeNull();
    expect(lofiSideOf({ style: "lofi", lofiSide: "beat" }, pic(0.1, 0.1))).toBeNull();
    expect(lofiSideOf({ style: "lofi", lofiSide: "ambient" }, pic(0.9, 0.9))).toMatchObject({ side: "ambient" });
    expect(lofiSideOf({ style: "pop" }, pic(0.1, 0.1))).toBeNull();
    expect(LOFI_CALM).toBeGreaterThan(0);
  });
  it("a dark calm picture is played as meditation, a light warm one as nature", () => {
    expect(lofiSideOf({ style: "lofi" }, pic(0.1, 0.1, 0.1)).inner).toBe("meditation");
    expect(lofiSideOf({ style: "lofi" }, { global: { edgeN: 0.1, entropy: 0.1, brightness: 0.95, warmth01: 0.9, sat: 0.8 } }).inner).toBe("lofinature");
  });
  it("the ambient side has no beat and keeps the vinyl; the beat plays a seventh-chord loop", () => {
    const amb = run({ ...P0, lofiSide: "ambient" });
    expect(amb.side).toBe("ambient"); expect(amb.genre).toBe("lofi"); expect(amb.vinyl).toBe(true);
    expect(["meditation", "lofinature"]).toContain(amb.style);
    const beat = run({ ...P0, lofiSide: "beat" });
    expect(beat.style).toBe("lofi"); expect(beat.side).toBeUndefined();
    expect(["rainy", "study", "cafe"]).toContain(beat.family);
    expect(beat.notes.some(n => n.layer === "perc")).toBe(true);
    // the chords change every bar, never the same twice in a row
    const body = beat.slots.filter(S => S.t1 - S.t0 >= 4 - 1e-9);
    for (let i = 1; i < body.length; i++) if (!body[i].cadence && !body[i - 1].cadence) expect(body[i].root === body[i - 1].root && body[i].shift === body[i - 1].shift).toBe(false);
  });
  it("the beat side has no drone under its loops", () => {
    for (const seed of [1, 3, 7]) { const sc = run({ ...P0, lofiSide: "beat", orch: "full" }, seed); expect(sc.extra.some(L => L.role === "drone")).toBe(false); }
  });
});
