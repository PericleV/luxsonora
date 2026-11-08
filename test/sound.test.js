// Sound: instrument library, texture wavetables, loudness measurement and normalization.
import { describe, it, expect } from "vitest";
import { measure } from "lufs-web";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { LIBRARY, resolveInstruments, textureWave, tiltWave, WAVE_H } from "../src/core/instruments.js";
import { STYLES } from "../src/core/theory.js";
import { driveCurve, defaultFx } from "../src/audio/fx.js";

describe("instrument library", () => {
  it("contains every style instrument plus extras, and resolves choices with edits", () => {
    for (const [sk, st] of Object.entries(STYLES)) for (const l of ["lead", "harm", "bass", "pad"]) expect(LIBRARY[`${sk}.${l}`].name).toBe(st.inst[l].name);
    const r = resolveInstruments("ambient", { lead: { preset: "x.wave", edits: { cut: 1234 } }, bass: { preset: null, edits: { s: 0.5 } } });
    expect(r.lead.type).toBe("wave"); expect(r.lead.cut).toBe(1234);
    expect(r.bass.name).toBe(STYLES.ambient.inst.bass.name); expect(r.bass.s).toBe(0.5);
    expect(r.harm).toEqual(STYLES.ambient.inst.harm);
  });
});

describe("texture wavetable", () => {
  // vertical stripes with a period of 8 px: a horizontal profile of length 64 px holds 8 cycles
  const W = 200, H = 100, data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = Math.sin((2 * Math.PI * x) / 8);
  const lum = { w: W, h: H, data }, r = 32 / Math.hypot(W, H);
  it("turns stripes into a waveform whose strongest harmonic matches the number of cycles", () => {
    // ori: dominant gradient bin 0 (horizontal gradient) → profile taken across it, i.e. horizontally
    const wv = textureWave(lum, 0.5, 0.5, r, [1, 0, 0, 0]);
    let best = 1; for (let k = 2; k <= WAVE_H; k++) if (wv.real[k] ** 2 + wv.imag[k] ** 2 > wv.real[best] ** 2 + wv.imag[best] ** 2) best = k;
    expect(best).toBe(8);
  });
  it("is deterministic and falls back to a soft wave on flat areas", () => {
    const a = textureWave(lum, 0.3, 0.4, r, [1, 0, 0, 0]), b = textureWave(lum, 0.3, 0.4, r, [1, 0, 0, 0]);
    expect(Array.from(a.imag)).toEqual(Array.from(b.imag));
    const flat = textureWave({ w: 50, h: 50, data: new Float32Array(2500).fill(0.5) }, 0.5, 0.5, 0.1, [1, 0, 0, 0]);
    expect(flat.imag[1]).toBeGreaterThan(0);
  });
  it("colour tilts the spectrum toward the fundamental", () => {
    const wv = textureWave(lum, 0.5, 0.5, r, [1, 0, 0, 0]), dark = tiltWave(wv, 0), bright = tiltWave(wv, 1);
    expect(Math.abs(bright.imag[8])).toBeCloseTo(Math.abs(wv.imag[8]), 6);
    expect(Math.abs(dark.imag[8])).toBeLessThan(Math.abs(wv.imag[8]) / 10);
  });
  it("is attached to every layer that uses the wavetable", () => {
    const A = analyze(synthImage(200, 133, 3)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions), SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
    const P = { style: "ambient", duration: 30, count: 10, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, instruments: { lead: { preset: "x.wave" }, pad: { preset: "x.wavepad" } } };
    const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
    const sc = compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
    for (const n of sc.notes) if (n.layer === "lead" || n.layer === "pad") { expect(n.tim.type).toBe("wave"); expect(n.tim.wave.key).toBeTruthy(); }
    expect(new Set(sc.points.map(F => F.tim.lead.wave.key)).size).toBeGreaterThan(1);
  });
});

describe("loudness (lufs-web, ITU-R BS.1770-4)", () => {
  const sine = (amp, sr, sec, f = 997) => Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
  it("reads a full-scale 997 Hz sine in one channel as −3.01 LKFS (calibration of the standard)", () => {
    const sr = 48000, m = measure({ sampleRate: sr, channels: [sine(1, sr, 5), new Float32Array(sr * 5)] });
    expect(m.integratedLUFS).toBeCloseTo(-3.01, 1);
  });
  it("reads a −20 dBFS stereo sine as −20 LUFS at 44.1 kHz, and its true peak as −20 dBTP", () => {
    const sr = 44100, s = sine(0.1, sr, 5), m = measure({ sampleRate: sr, channels: [s, s] });
    expect(m.integratedLUFS).toBeCloseTo(-20, 1);
    expect(m.truePeakDB).toBeCloseTo(-20, 0);
  });
});

describe("effects", () => {
  it("drive curve is odd, monotonic and passes through ±1", () => {
    const c = driveCurve(0.7, 101);
    expect(c[0]).toBeCloseTo(-1, 6); expect(c[100]).toBeCloseTo(1, 6); expect(c[50]).toBeCloseTo(0, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
  });
  it("defaults keep the earlier sound: flat EQ, no drive, no delay, no chorus", () => {
    const fx = defaultFx();
    for (const ch of Object.values(fx.eq)) for (const b of ch) expect(b.g).toBe(0);
    expect(fx.delay.mix).toBe(0); expect(fx.chorus.mix).toBe(0);
    for (const l of Object.values(fx.layer)) expect(l.drive).toBe(0);
    expect(fx.reverb.size).toBe(3.4);
  });
});
