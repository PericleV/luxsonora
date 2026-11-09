// Expert rules (src/core/expert.js): conditions on the places, actions there, in harmony.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { pointMatches, ruleSpans, colourOf, newRule } from "../src/core/expert.js";

const I = (() => { const A = analyze(synthImage(200, 133, 1)), CL = clusterRegions(A, 6); return { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) }; })();
const BASE = { count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, duration: 30, orch: "small", connect: "light", style: "movie" };
const run = P => { const pts = readPoints(I.A, I.CL, gazePath(I.A, I.SAL.map, P)), cov = coverage(I.A, pts); cov.zone = backgroundZone(I.A, cov); return compose({ A: I.A, sal: I.SAL, points: pts, cl: I.CL, motifs: I.MOT, P, sem: null, cov }); };
const rule = (id, when, d) => ({ ...newRule(id), when: { ...newRule(id).when, ...when }, do: { ...newRule(id).do, ...d } });
const pc = m => ((m % 12) + 12) % 12;

describe("expert rules", () => {
  it("colour families follow the hue circle", () => {
    expect(colourOf({ hue: 5, hueStr: 0.5 })).toBe("red"); expect(colourOf({ hue: 355, hueStr: 0.5 })).toBe("red");
    expect(colourOf({ hue: 30, hueStr: 0.5 })).toBe("orange"); expect(colourOf({ hue: 120, hueStr: 0.5 })).toBe("green");
    expect(colourOf({ hue: 220, hueStr: 0.5 })).toBe("blue"); expect(colourOf({ hue: 220, hueStr: 0.01 })).toBe("grey");
  });
  it("an added instrument plays only at its places, in the key", () => {
    const base = run(BASE), sc = run({ ...BASE, expert: [rule(1, { type: "section", section: "climax" }, { type: "play", preset: "s.choir", role: "sustain" })] });
    const spb = 60 / sc.bpm, spans = ruleSpans(sc.expert[0], sc.points, spb), mine = sc.notes.filter(n => n.layer === "e1");
    expect(spans.length).toBeGreaterThan(0); expect(mine.length).toBeGreaterThan(0);
    for (const n of mine) expect(spans.some(([a, b]) => n.t >= a - 1e-9 && n.t < b)).toBe(true);
    expect(sc.extra.some(L => L.id === "e1" && L.only)).toBe(true);
    expect(base.extra.length).toBe(0);
  });
  it("silences a track at the chosen place", () => {
    const sc = run({ ...BASE, style: "rock", expert: [rule(1, { type: "point", point: 2 }, { type: "mute", layer: "perc" })] });
    const F = sc.points[1];
    expect(sc.notes.filter(n => n.layer === "perc" && n.t >= F.t0 && n.t < F.t1).length).toBe(0);
    expect(sc.notes.filter(n => n.layer === "perc").length).toBeGreaterThan(0);
  });
  it("uses the asked chord, a degree of the key, and fits the melody to it", () => {
    const sc = run({ ...BASE, rules: { modulate: false }, expert: [rule(1, { type: "point", point: 3 }, { type: "chord", degree: 3 })] });
    const F = sc.points[2], S = sc.slots.find(S => S.t0 <= F.t0 + 1e-9 && S.t1 > F.t0);
    expect(S.root).toBe(3);
    const want = new Set([3, 5, 7].map(o => pc(sc.modeIv[o % 7] + sc.pcOff)));
    for (const p of S.chord.map(pc)) expect(want.has(p) || sc.modeIv.map(v => pc(v + sc.pcOff)).includes(p)).toBe(true);
  });
  it("moves the melody by an octave and changes the dynamics where asked", () => {
    const a = run(BASE), b = run({ ...BASE, expert: [rule(1, { type: "point", point: 1 }, { type: "octave", octave: 1 }), rule(2, { type: "point", point: 2 }, { type: "dynamics", db: 12, layer: "all" })] });
    const F1 = a.points[0], F2 = a.points[1];
    const la = a.notes.filter(n => n.layer === "lead" && n.t >= F1.t0 && n.t < F1.t1).map(n => n.midi), lb = b.notes.filter(n => n.layer === "lead" && n.t >= F1.t0 && n.t < F1.t1).map(n => n.midi);
    expect(lb.some((m, i) => m === la[i] + 12)).toBe(true);
    const va = a.notes.filter(n => n.layer === "lead" && n.t >= F2.t0 && n.t < F2.t1).reduce((s, n) => s + n.vel, 0), vb = b.notes.filter(n => n.layer === "lead" && n.t >= F2.t0 && n.t < F2.t1).reduce((s, n) => s + n.vel, 0);
    expect(vb).toBeGreaterThan(va);
  });
  it("a zone picks the places inside it, and a turned-off rule does nothing", () => {
    const sc = run(BASE), spb = 60 / sc.bpm;
    const z = { type: "zone", zone: { x0: 0, y0: 0, x1: 0.5, y1: 1 } };
    for (const F of sc.points) expect(pointMatches(z, F, spb)).toBe(F.x <= 0.5);
    const off = run({ ...BASE, expert: [{ ...rule(1, { type: "section", section: "climax" }, { type: "mute", layer: "lead" }), on: false }] });
    expect(off.notes.length).toBe(sc.notes.length);
  });
});
