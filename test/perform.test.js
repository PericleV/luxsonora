// Performance (src/core/perform.js), the MIDI file for a DAW, and each style's band (Add layer).
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { perform, PERFORM_DEFAULTS } from "../src/core/perform.js";
import { midiFile, keySignature } from "../src/export/midi.js";
import { STYLE_BAND, ROLES, roleFor } from "../src/core/arrange.js";
import { LIBRARY } from "../src/core/instruments.js";
import { gmProgram } from "../src/core/gm.js";

const I = (() => { const A = analyze(synthImage(200, 133, 1)), CL = clusterRegions(A, 6); return { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) }; })();
const BASE = { count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, duration: 30, orch: "full", connect: "light" };
const run = P => {
  const pts = readPoints(I.A, I.CL, gazePath(I.A, I.SAL.map, P)), cov = coverage(I.A, pts); cov.zone = backgroundZone(I.A, cov);
  return compose({ A: I.A, sal: I.SAL, points: pts, cl: I.CL, motifs: I.MOT, P, sem: null, cov });
};
const NONE = { dynRange: 0.5, velDetail: 0, accent: 0, phrasing: 0, ccExpr: 0, ccMod: 0, humTime: 0, humLen: 0, humVel: 0 };

describe("performance", () => {
  it("with everything at zero it changes nothing", () => {
    const a = run({ ...BASE, style: "jazz" }), before = JSON.stringify(a.notes.map(n => [n.t, n.dur, n.midi, n.vel]));
    perform(a, { ...BASE, ...NONE }, I.A);
    expect(JSON.stringify(a.notes.map(n => [n.t, n.dur, n.midi, n.vel]))).toBe(before);
  });
  it("is deterministic, keeps every note valid and inside the piece", () => {
    for (const style of Object.keys(STYLES)) {
      const a = perform(run({ ...BASE, style }), { ...BASE, ...PERFORM_DEFAULTS, humTime: 30, humLen: 0.3, humVel: 20 }, I.A);
      const b = perform(run({ ...BASE, style }), { ...BASE, ...PERFORM_DEFAULTS, humTime: 30, humLen: 0.3, humVel: 20 }, I.A);
      expect(JSON.stringify(a.notes.map(n => [n.t, n.dur, n.vel]))).toBe(JSON.stringify(b.notes.map(n => [n.t, n.dur, n.vel])));
      for (const n of a.notes) {
        expect(n.t).toBeGreaterThanOrEqual(0); expect(n.t + n.dur).toBeLessThanOrEqual(a.total + 1e-9); expect(n.dur).toBeGreaterThan(0);
        expect(n.vel).toBeGreaterThanOrEqual(1); expect(n.vel).toBeLessThanOrEqual(127);
      }
    }
  });
  it("humanized timing stays within the set milliseconds, and chord notes move together", () => {
    const a = run({ ...BASE, style: "classical" }), q = new Map(a.notes.map(n => [n, n.t])), spb = 60 / a.bpm;
    perform(a, { ...BASE, ...NONE, humTime: 20 }, I.A);
    for (const n of a.notes) expect(Math.abs(n.t - q.get(n)) * spb * 1000).toBeLessThanOrEqual(20 * 1.2 + 1e-6);
    // the harmony notes struck together still start together, give or take a few milliseconds
    const groups = {};
    for (const n of a.notes.filter(n => n.layer === "harm")) (groups[q.get(n).toFixed(4)] = groups[q.get(n).toFixed(4)] || []).push(n.t);
    for (const ts of Object.values(groups)) expect((Math.max(...ts) - Math.min(...ts)) * spb * 1000).toBeLessThanOrEqual(20 * 0.2 * 2 + 1e-6);
  });
  it("a single-line layer never overlaps itself after humanizing", () => {
    const a = perform(run({ ...BASE, style: "pop" }), { ...BASE, ...PERFORM_DEFAULTS, humTime: 30, humLen: 0.3 }, I.A);
    const lead = a.notes.filter(n => n.layer === "lead" && !n.dbl).sort((x, y) => x.t - y.t);
    let over = 0;
    for (let i = 0; i + 1 < lead.length; i++) if (lead[i].t + lead[i].dur > lead[i + 1].t + 1e-6 && lead[i + 1].t > lead[i].t + 1e-6) over++;
    expect(over).toBe(0);
  });
  it("draws expression and vibrato curves for every pitched layer, between 0 and 1", () => {
    const a = perform(run({ ...BASE, style: "movie" }), { ...BASE, ...PERFORM_DEFAULTS }, I.A);
    for (const l of new Set(a.notes.filter(n => n.layer !== "perc").map(n => n.layer))) {
      expect(a.cc[l].expr.length).toBeGreaterThan(2);
      for (const [, v] of [...a.cc[l].expr, ...a.cc[l].mod]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
  it("the picture's detail spreads the velocities of a place's notes", () => {
    const spread = det => { const a = perform(run({ ...BASE, style: "ambient" }), { ...BASE, ...NONE, velDetail: det }, I.A); const v = a.notes.filter(n => n.layer === "lead").map(n => n.vel); const m = v.reduce((x, y) => x + y, 0) / v.length; return v.reduce((x, y) => x + (y - m) ** 2, 0); };
    expect(spread(1)).not.toBe(spread(0));
  });
});

describe("MIDI for a DAW", () => {
  const parse = u => {
    const rd = (i, n) => { let v = 0; for (let k = 0; k < n; k++) v = (v << 8) | u[i + k]; return v >>> 0; };
    const out = []; let i = 14;
    while (i < u.length) {
      const len = rd(i + 4, 4), end = i + 8 + len; let p = i + 8, tick = 0; const tr = [];
      while (p < end) {
        let dt = 0, b; do { b = u[p++]; dt = (dt << 7) | (b & 0x7f); } while (b & 0x80);
        tick += dt; const st = u[p++];
        if (st === 0xff) { const type = u[p++]; let l = 0; do { b = u[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80); tr.push({ tick, meta: type, data: [...u.slice(p, p + l)] }); p += l; continue; }
        const hi = st & 0xf0; if (hi === 0xc0 || hi === 0xd0) { tr.push({ tick, st, d1: u[p++] }); continue; }
        tr.push({ tick, st, d1: u[p++], d2: u[p++] });
      }
      out.push(tr); i = end;
    }
    return out;
  };
  it("has a key signature, markers, named tracks, programs and the CC curves", () => {
    const sc = perform(run({ ...BASE, style: "classical" }), { ...BASE, ...PERFORM_DEFAULTS }, I.A), T = parse(midiFile(sc, () => true));
    expect(T[0].some(e => e.meta === 0x59)).toBe(true);
    expect(T[0].filter(e => e.meta === 0x06).length).toBeGreaterThanOrEqual(sc.points.length);
    const mel = T.find(tr => tr.some(e => e.meta === 0x03 && String.fromCharCode(...e.data).startsWith("Melody")));
    expect(String.fromCharCode(...mel.find(e => e.meta === 0x03).data)).toContain(":");
    expect(mel.some(e => (e.st & 0xf0) === 0xb0 && e.d1 === 11)).toBe(true);
    expect(mel.some(e => (e.st & 0xf0) === 0xb0 && e.d1 === 1)).toBe(true);
    expect(mel.some(e => (e.st & 0xf0) === 0xc0)).toBe(true);
  });
  it("key signatures are right", () => {
    expect(keySignature(0, true)).toBe(0); expect(keySignature(7, true)).toBe(1); expect(keySignature(5, true)).toBe(-1);
    expect(keySignature(9, false)).toBe(0); expect(keySignature(4, false)).toBe(1); expect(keySignature(2, false)).toBe(-1);
  });
  it("picks a General MIDI program near the instrument", () => {
    expect(gmProgram(LIBRARY["s.piano"])).toBe(0);
    expect(gmProgram(LIBRARY["s.cello"])).toBe(42);
    expect(gmProgram(LIBRARY["s.tenorsax"])).toBe(66);
    expect(gmProgram({ name: "Something unknown" }, 5)).toBe(5);
  });
});

describe("each style's band", () => {
  it("every style has its own instruments, all in the library, each with a known role", () => {
    for (const style of Object.keys(STYLES)) {
      const band = STYLE_BAND[style];
      expect(band.length).toBeGreaterThanOrEqual(6);
      for (const [k, role] of band) { expect(LIBRARY[k], `${style} ${k}`).toBeTruthy(); expect(ROLES[role]).toBeTruthy(); }
    }
    expect(JSON.stringify(STYLE_BAND.rock)).not.toBe(JSON.stringify(STYLE_BAND.jazz));
  });
  it("guesses a sensible role for other instruments", () => {
    expect(roleFor("gm.timpani", { name: "Timpani" })).toBe("pulse");
    expect(roleFor("gm.choir_aahs", { name: "Choir aahs" })).toBe("sustain");
    expect(roleFor("gm.glockenspiel", { name: "Glockenspiel" })).toBe("ornament");
    expect(roleFor("gm.flute", { name: "Flute" })).toBe("counter");
  });
  it("two layers with the same role play different notes", () => {
    const sc = run({ ...BASE, style: "rock", orch: "custom", layers: [{ id: "x1", role: "counter", preset: "s.overdrive" }, { id: "x2", role: "counter", preset: "s.cleangtr" }] });
    const a = sc.notes.filter(n => n.layer === "x1").map(n => n.t + ":" + n.midi).join(), b = sc.notes.filter(n => n.layer === "x2").map(n => n.t + ":" + n.midi).join();
    expect(a.length).toBeGreaterThan(0); expect(a).not.toBe(b);
  });
});
