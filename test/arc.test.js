// Dramatic arc, rhythm and accompaniment patterns.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES, RULES } from "../src/core/theory.js";
import { dramaticArc, NEUTRAL, SECTIONS } from "../src/core/arc.js";
import { euclid, DRUM } from "../src/core/rhythm.js";

const P0 = { style: "ambient", duration: 30, count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
function run(seed, P = P0) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const segs = n => Array.from({ length: n }, (_, i) => ({ t0: i * 3, t1: i * 3 + 3, x: (i * 0.37) % 1, y: (i * 0.61) % 1, w: (i % 3) / 3, revisit: i === 5 }));

describe("euclidean rhythms", () => {
  it("spread k onsets over n steps", () => {
    for (let k = 0; k <= 16; k++) expect(euclid(k).filter(Boolean).length).toBe(k);
    expect(euclid(4).map(Number).join("")).toBe("1000100010001000");
    expect(euclid(3, 8).map(Number).join("")).toBe("10010010");
  });
});

describe("dramatic arc", () => {
  it("puts the climax in the second half and orders the sections", () => {
    const a = dramaticArc(segs(10), 30, 0.7), order = a.section.map(s => SECTIONS.indexOf(s));
    expect(a.section[a.climax]).toBe("climax");
    expect(a.peak).toBeGreaterThanOrEqual(0.5); expect(a.peak).toBeLessThanOrEqual(0.85);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1] === 2 ? 2 : Math.min(order[i - 1], 1));
    expect(a.section[0]).toBe("intro"); expect(a.section[9]).toBe("resolution");
    expect(Math.max(...a.tension)).toBe(a.tension[a.climax]);
  });
  it("is flat with amount 0", () => {
    const a = dramaticArc(segs(8), 24, 0);
    expect(new Set(a.tension)).toEqual(new Set([NEUTRAL])); expect(new Set(a.section)).toEqual(new Set(["development"]));
  });
});

describe("arrangement over the arc", () => {
  for (const style of Object.keys(STYLES)) it(`drums get denser toward the climax and the bass enters after the introduction (${style})`, () => {
    const sc = run(1, { ...P0, style }), perc = sc.notes.filter(n => n.layer === "perc" && n.point >= 0);
    const rate = sec => { const ps = sc.points.filter(F => F.section === sec); const beats = ps.reduce((s, F) => s + F.dur, 0); return beats ? perc.filter(n => ps.some(F => F.idx === n.point)).length / beats : null; };
    const intro = rate("intro"), climax = rate("climax");
    // (styles without drums have none to get denser)
    if (intro !== null && climax !== null && STYLES[style].perc !== "none") expect(climax).toBeGreaterThan(intro);
    // the bass enters after the introduction, except where the genre keeps a pedal or a pulse
    if (RULES[style].bass[0] !== "pedal" && style !== "epic")
      for (const S of sc.slots.filter(S => sc.points[S.point].section === "intro")) expect(sc.notes.some(n => n.layer === "bass" && n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9)).toBe(false);
    for (const n of perc) { const F = sc.points[n.point]; expect(n.t).toBeGreaterThanOrEqual(F.t0 - 1e-9); expect(n.t).toBeLessThan(F.t1 + 0.2); }
    // every drum is a known kit voice
    for (const n of sc.notes.filter(n => n.layer === "perc")) expect(Object.values(DRUM)).toContain(n.midi);
  });
  it("doubles the melody at the climax", () => {
    const sc = run(2), ci = sc.arc.climax, lead = sc.notes.filter(n => n.layer === "lead" && n.point === ci);
    expect(lead.some(n => n.dbl)).toBe(true);
    expect(sc.notes.filter(n => n.dbl && sc.points[n.point].section !== "climax").length).toBe(0);
  });
  for (const style of Object.keys(STYLES)) it(`plays only chord tones on the harmonic grid (${style})`, () => {
    for (const seed of [1, 2, 3]) {
      const sc = run(seed, { ...P0, style });
      // chords change only on the style's grid
      for (const S of sc.slots) expect(S.t0 % Math.min(4, RULES[style].unit)).toBeCloseTo(0, 9);
      for (const n of sc.notes.filter(n => n.layer === "harm" && n.point >= 0)) {
        const S = sc.slots.find(S => n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9), pcs = S.chord.map(m => ((m % 12) + 12) % 12);
        expect(pcs).toContain(((n.midi % 12) + 12) % 12);
        expect(n.t + n.dur).toBeLessThanOrEqual(S.t1 + 1e-9);
      }
    }
  });
  it("uses more than one articulation over a piece", () => {
    const kinds = new Set();
    for (const seed of [1, 2, 3]) for (const S of run(seed, { ...P0, style: "cinematic" }).slots) kinds.add(S.harmKind);
    expect(kinds.size).toBeGreaterThan(1);
  });
  it("arc 0 keeps one level: same drums per beat in every segment kind", () => {
    const sc = run(1, { ...P0, arc: 0 });
    expect(new Set(sc.points.map(F => F.section))).toEqual(new Set(["development"]));
    expect(sc.notes.some(n => n.dbl)).toBe(false);
  });
});

// A long piece keeps its substance: two waves and a late climax, and long places that develop
// their motif instead of holding a few notes for bars.
import { developMotif } from "../src/core/compose.js";
describe("long pieces", () => {
  const segs = n => Array.from({ length: n }, (_, i) => ({ t0: 0, t1: 0, x: (i * 0.37) % 1, y: (i * 0.61) % 1, w: 0.5 + 0.3 * Math.sin(i), revisit: false }));
  const timed = (n, body) => segs(n).map((s, i) => ({ ...s, t0: (i * body) / n, t1: ((i + 1) * body) / n }));
  it("a long piece has its climax late and a breather before the final build; a short one is as before", () => {
    const L = dramaticArc(timed(12, 96), 96, 1), cl = L.climax, centre = (cl + 0.5) / 12;
    expect(centre).toBeGreaterThanOrEqual(0.7); expect(centre).toBeLessThanOrEqual(0.9);
    // the release takes at most 30% of the piece
    expect(L.section.filter(s => s === "resolution").length / 12).toBeLessThanOrEqual(0.3);
    // before the climax the template is not one slope: it rises, eases, and rises again
    const tpl = timed(40, 160).map((s, i) => ({ ...s, w: 0.5, x: 0.5, y: 0.5 })), T = dramaticArc(tpl, 160, 1).tension, k = dramaticArc(tpl, 160, 1).climax;
    let peak1 = 0; for (let i = 1; i < k; i++) if (T[i] > T[i - 1] && T[i] >= T[i + 1] && !peak1) peak1 = i;
    expect(peak1).toBeGreaterThan(2); expect(peak1).toBeLessThan(k - 3);
    const dip = Math.min(...T.slice(peak1, k));
    expect(T[peak1] - dip).toBeGreaterThan(0.12);
    expect(T[k]).toBeGreaterThan(T[peak1]);
    // a short piece: the climax window of before
    const S = dramaticArc(timed(8, 40), 40, 1), cs = (S.climax + 0.5) / 8;
    expect(cs).toBeGreaterThanOrEqual(0.5); expect(cs).toBeLessThanOrEqual(0.85);
  });
  it("a place under two bars plays its motif once, a longer one a statement a bar that comes home", () => {
    expect(developMotif([0, 2, 4], [1, 1, 2], 6)).toBe(null);
    expect(developMotif([0, 2, 4], [1, 1, 2], 4)).toBe(null);
    for (const dur of [8, 10, 12, 16]) {
      const ph = developMotif([0, 2, 4], [1, 1, 2], dur, 1), bars = Math.floor(dur / 4);
      expect(ph.length).toBeGreaterThanOrEqual(bars * 2);
      // in order, on the sixteenth grid, filling the place exactly
      let t = 0; for (const x of ph) { expect(x.t).toBeCloseTo(t, 9); expect(Math.abs(x.t * 4 - Math.round(x.t * 4))).toBeLessThan(1e-9); expect(x.dur).toBeGreaterThan(0); t += x.dur; }
      expect(t).toBeCloseTo(dur, 9);
      // the first bar is the motif itself, the last note is home
      expect(ph.filter(x => x.kind === "motif").map(x => x.o)).toEqual([0, 2, 4]);
      expect(ph[ph.length - 1].o).toBe(0); expect(ph[ph.length - 1].kind).toBe("close");
      // every bar has a note starting in it
      for (let b = 0; b < bars; b++) expect(ph.some(x => x.t >= b * 4 - 1e-9 && x.t < b * 4 + 4 - 1e-9)).toBe(true);
    }
    // the sequence moves toward the next place: up when it is higher, down when lower
    expect(developMotif([0, 2], [1, 1], 12, 1).find(x => x.kind === "sequence").o).toBe(1);
    expect(developMotif([0, 2], [1, 1], 12, -1).find(x => x.kind === "sequence").o).toBe(-1);
  });
  it("in a minute of music no bar of the melody is empty for long, and the second half repeats little of the first", () => {
    let emptyRuns = 0, rep = 0, n = 0;
    for (const style of ["epic", "cinematic", "pop", "jazz", "ambient", "rock"]) for (const seed of [1, 7]) {
      const sc = run(seed, { ...P0, style, duration: 60, orch: "medium", samples: true, intro: "auto" });
      const I = sc.intro || 0, nb = Math.round((sc.body - I) / 4), lead = sc.notes.filter(x => x.layer === "lead" && !x.dbl && x.point >= 0);
      const sig = b => lead.filter(x => x.t >= I + b * 4 - 1e-6 && x.t < I + b * 4 + 4 - 1e-6).sort((a, c) => a.t - c.t).map(x => Math.round((x.t - I - b * 4) * 4) + ":" + x.midi).join(",");
      // sounding, not only starting: a held note fills a bar too
      const sounding = b => lead.some(x => x.t < I + b * 4 + 4 - 1e-6 && x.t + x.dur > I + b * 4 + 1e-6);
      for (let b = 0; b + 1 < nb; b++) if (!sounding(b) && !sounding(b + 1)) emptyRuns++;
      for (let b = nb >> 1; b < nb; b++) { const s = sig(b); if (!s) continue; n++; if (Array.from({ length: b }, (_, k) => sig(k)).includes(s)) rep++; }
    }
    expect(emptyRuns).toBe(0);
    expect(rep / n).toBeLessThan(0.15);
  }, 300000);
});
