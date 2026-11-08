// Properties of the composition: exact duration, time split, rhythmic grid,
// per-layer timbre, determinism, MIDI of exact length, Karplus-Strong tuning.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { scanpath } from "../src/core/scanpath.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { STYLES } from "../src/core/theory.js";
import { compose } from "../src/core/compose.js";
import { planTime } from "../src/core/duration.js";
import { DIMS } from "../src/core/timbre.js";
import { midiFile } from "../src/export/midi.js";
import { ksSamples } from "../src/audio/engine.js";

const P0 = { style: "ambient", duration: 30, count: 14, inhibition: 0.18, memory: 0.05, seed: 0, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, reverb: 0.6 };
const canon = x => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

function run(img, P) {
  const A = analyze(img), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: P.wColor, texture: P.wTex, semantic: 0 }, null);
  const FIX = scanpath(A, SAL.map, P);
  return compose({ A, sal: SAL, points: FIX, cl: CL, motifs: MOT, P, sem: null });
}

const IMGS = [synthImage(200, 133, 1), synthImage(133, 200, 2), synthImage(180, 180, 7)];

describe("planTime", () => {
  it("exact duration, whole bars, bounded tempo correction", () => {
    for (const T of [15, 30, 60]) for (let bpm = 50; bpm <= 140; bpm += 3.7) {
      const p = planTime(T, bpm, [1, 2, 3, 4]);
      expect(Number.isInteger(p.bars)).toBe(true);
      expect((p.total * 60) / p.bpm).toBeCloseTo(T, 9);
      if (p.bars > 3) expect(Math.abs(p.bpm - bpm)).toBeLessThanOrEqual(120 / T + 1e-9);
    }
  });
  it("durations sum to the body, at least one beat, 0.5 grid", () => {
    const W = [1, 4, 2.2, 1.1, 3.9, 1, 2.5, 3.3, 1.7, 2.8, 1.2, 4, 1.05, 2];
    for (const T of [15, 30, 60]) for (const bpm of [56, 72, 96, 126]) {
      const p = planTime(T, bpm, W);
      expect(p.dur.reduce((a, b) => a + b, 0)).toBeCloseTo(p.body, 9);
      for (const d of p.dur) { expect(d).toBeGreaterThanOrEqual(1); expect((d * 2) % 1).toBe(0); }
      expect(p.count).toBeLessThanOrEqual(p.body);
    }
  });
  it("durations follow the weights (within half a beat of the ideal)", () => {
    const W = [1, 4, 2, 3, 1.5, 2.5];
    const p = planTime(30, 72, W), S = W.reduce((a, b) => a + b, 0);
    p.dur.forEach((d, i) => expect(Math.abs(d - (p.body * W[i]) / S)).toBeLessThanOrEqual(0.5 + 1e-9));
  });
  it("too many focus points: at most one beat each is kept", () => {
    const p = planTime(15, 56, new Array(40).fill(1));
    expect(p.count).toBe(p.body);
    expect(p.dur.every(d => d === 1)).toBe(true);
  });
});

describe("compose", () => {
  for (const style of Object.keys(STYLES)) for (const T of [15, 30, 60]) {
    it(`${style}, ${T} s`, () => {
      for (const img of IMGS) {
        const P = { ...P0, style, duration: T }, sc = run(img, P), spb = 60 / sc.bpm;
        expect(sc.total * spb).toBeCloseTo(T, 9);
        expect(sc.points.reduce((a, F) => a + F.dur, 0)).toBeCloseTo(sc.body, 9);
        for (const nn of sc.notes) {
          expect(nn.t).toBeGreaterThanOrEqual(0);
          expect(nn.t + nn.dur).toBeLessThanOrEqual(sc.total + 1e-9);
          if (nn.layer !== "perc") expect(nn.tim.type).toBe(STYLES[style].inst[nn.layer].type);
        }
        // sixteenth-note grid for the melody (without swing)
        if (!STYLES[style].swing) for (const nn of sc.notes) if (nn.layer === "lead") expect(Math.abs(nn.t * 4 - Math.round(nn.t * 4))).toBeLessThan(1e-9);
        // cadence: everything dies out before T when the note could be shortened
        for (const nn of sc.notes) if (nn.point === -2 && nn.layer !== "perc" && nn.dur > 1) expect((nn.t + nn.dur) * spb + nn.tim.r * 1.6).toBeLessThanOrEqual(T + 1e-6);
        // modulation stays in [−1, 1]
        for (const F of sc.points) for (const d of DIMS) expect(Math.abs(F.tim.m[d])).toBeLessThanOrEqual(1);
      }
    });
  }
  it("image timbre = 0 leaves the instruments unchanged", () => {
    const sc = run(IMGS[0], { ...P0, timbre: 0 }), inst = STYLES.ambient.inst;
    for (const F of sc.points) for (const l of ["lead", "harm", "bass"]) for (const k of ["a", "d", "r", "cut", "q", "col"]) expect(F.tim[l][k]).toBeCloseTo(inst[l][k], 12);
  });
  it("modulation differs between areas and is halved on harmony", () => {
    const sc = run(IMGS[0], P0), inst = STYLES.ambient.inst;
    const cuts = new Set(sc.points.map(F => Math.round(F.tim.lead.cut)));
    expect(cuts.size).toBeGreaterThan(2);
    for (const F of sc.points) {
      const dl = Math.abs(Math.log2(F.tim.lead.cut / inst.lead.cut)), dh = Math.abs(Math.log2(F.tim.harm.cut / inst.harm.cut));
      expect(dh).toBeCloseTo(dl / 2, 9);
      expect(F.tim.bass.a).toBeCloseTo(inst.bass.a, 12);
    }
  });
  it("determinism: same input gives the same score and MIDI", () => {
    const a = run(IMGS[1], P0), b = run(IMGS[1], P0);
    expect(canon(a)).toBe(canon(b));
    const on = () => true;
    expect(Buffer.compare(Buffer.from(midiFile(a, on)), Buffer.from(midiFile(b, on)))).toBe(0);
  });
});

describe("MIDI", () => {
  it("every track ends exactly at the end of the piece", () => {
    const sc = run(IMGS[0], P0), m = midiFile(sc, () => true);
    let i = 14, tracks = 0;
    const rd = () => { let v = 0, b; do { b = m[i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (i < m.length) {
      const len = (m[i + 4] << 24) | (m[i + 5] << 16) | (m[i + 6] << 8) | m[i + 7]; i += 8;
      const end = i + len; let tick = 0, status = 0;
      while (i < end) {
        tick += rd();
        let b = m[i];
        if (b === 0xff) { i += 2; const l = rd(); i += l; continue; }
        if (b & 0x80) { status = b; i++; }
        i += (status & 0xf0) === 0xc0 ? 1 : 2;
      }
      expect(tick).toBe(sc.total * 480); tracks++;
    }
    expect(tracks).toBe(6);
  });
});

describe("Karplus-Strong", () => {
  it("correct pitch (under 1 cent) with fractional delay", () => {
    const sr = 44100;
    for (const f of [110, 261.63, 440, 987.77]) {
      const x = ksSamples(sr, f, 3, 0.5, 1, 7), P = sr / f, lo = Math.floor(P) - 3, hi = Math.ceil(P) + 3;
      const ac = lag => { let s = 0; for (let i = 2000; i < 30000; i++) s += x[i] * x[i + lag]; return s; };
      let best = lo; for (let L = lo; L <= hi; L++) if (ac(L) > ac(best)) best = L;
      const y0 = ac(best - 1), y1 = ac(best), y2 = ac(best + 1), est = best + (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
      expect(Math.abs(1200 * Math.log2(P / est))).toBeLessThan(1);
    }
  });
  it("decays: energy drops over time", () => {
    const x = ksSamples(44100, 220, 1, 0.5, 2, 3), e = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s; };
    expect(e(44100, 48510)).toBeLessThan(e(0, 4410) * 0.01);
  });
});
