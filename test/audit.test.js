// Audit: every style × duration × orchestration × extreme settings, on ordinary and edge-case
// images. Checks the invariants the app relies on: exact timing, valid notes, notes in the
// scale, harmony on the grid, finite timbres, determinism and a well-formed MIDI file.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { mulberry32 } from "../src/core/util.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES, RULES } from "../src/core/theory.js";
import { attentionMap, PLACEMENTS, scanPath, regionMeans } from "../src/core/placement.js";
import { midiFile } from "../src/export/midi.js";

// edge-case images
function flat(W, H, v) { const d = new Uint8ClampedArray(W * H * 4).fill(v); for (let i = 3; i < d.length; i += 4) d[i] = 255; return { width: W, height: H, data: d }; }
function noise(W, H, seed) { const r = mulberry32(seed), d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < d.length; i++) d[i] = i % 4 === 3 ? 255 : r() * 255; return { width: W, height: H, data: d }; }
const IMAGES = {
  "photo-like 1": synthImage(200, 133, 1), "photo-like 2": synthImage(133, 200, 7),
  "flat grey": flat(120, 80, 128), "black": flat(100, 100, 0), "white": flat(100, 100, 255),
  "noise": noise(160, 120, 3), "tiny 16×16": synthImage(16, 16, 4), "wide strip 200×24": synthImage(200, 24, 5)
};
const BASE = { duration: 30, count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, orch: "small" };
const LAYER_IDS = new Set(["lead", "harm", "bass", "pad", "perc"]);
const cache = new Map();
function prep(name) {
  if (!cache.has(name)) {
    const A = analyze(IMAGES[name]), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
    const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
    cache.set(name, { A, CL, MOT, SAL });
  }
  return cache.get(name);
}
function run(name, P) {
  const { A, CL, MOT, SAL } = prep(name);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const strip = sc => JSON.stringify(sc.notes.map(n => [n.layer, +n.t.toFixed(6), +n.dur.toFixed(6), n.midi, n.vel]));
const fin = x => typeof x === "number" && Number.isFinite(x);

function checkScore(sc, P, label) {
  const fail = msg => { throw new Error(`${label}: ${msg}`); };
  // timing: exactly T seconds in whole bars, cadence bar, point durations on the grid
  if (Math.abs((sc.total * 60) / sc.bpm - P.duration) > 1e-9) fail(`length ${(sc.total * 60) / sc.bpm} ≠ ${P.duration}`);
  if (sc.total % 4 !== 0 || sc.bars < 3 || sc.body !== sc.total - 4) fail("bars");
  const grid = Math.max(1, RULES[P.style].grid || 1);
  let t = 0;
  for (const F of sc.points) {
    if (Math.abs(F.t0 - t) > 1e-9) fail("points not contiguous");
    if (F.dur < grid - 1e-9 || Math.abs(F.dur / grid - Math.round(F.dur / grid)) > 1e-9) fail(`point duration ${F.dur} off the ${grid}-beat grid`);
    if (!(F.tension >= 0 && F.tension <= 1)) fail("tension out of range");
    t = F.t1;
  }
  if (sc.points.length && Math.abs(t - sc.body) > 1e-9) fail(`points end at ${t}, body ${sc.body}`);
  // chord slots cover the body, on the grid
  let s0 = 0;
  for (const S of sc.slots) { if (Math.abs(S.t0 - s0) > 1e-9) fail("slots not contiguous"); if (Math.abs(S.t0 / Math.min(4, RULES[P.style].unit) - Math.round(S.t0 / Math.min(4, RULES[P.style].unit))) > 1e-9) fail("chord off the grid"); s0 = S.t1; }
  if (sc.slots.length && Math.abs(s0 - sc.body) > 1e-9) fail("slots don't cover the body");
  const ids = new Set([...LAYER_IDS, ...(sc.extra || []).map(L => L.id)]);
  const scale = new Set([...sc.modeIv, ...(sc.melIv || [])].map(v => (((v + sc.pc) % 12) + 12) % 12));
  const chordPcsAt = t => { const S = sc.slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9); return S ? new Set(S.chord.map(m => ((m % 12) + 12) % 12)) : new Set(); };
  const seen = new Set();
  for (const n of sc.notes) {
    if (!ids.has(n.layer)) fail(`unknown layer ${n.layer}`);
    if (!fin(n.t) || !fin(n.dur) || !fin(n.midi) || !fin(n.vel)) fail(`non-finite note ${JSON.stringify([n.layer, n.t, n.dur, n.midi, n.vel])}`);
    if (n.t < -1e-9 || n.t > sc.total + 1e-9) fail(`note at ${n.t} outside 0-${sc.total}`);
    if (n.dur <= 0) fail("non-positive duration");
    if (n.layer !== "perc" && n.t + n.dur > sc.total + 1e-6) fail(`${n.layer} note ends at ${n.t + n.dur} > ${sc.total}`);
    if (!Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127) fail(`midi ${n.midi}`);
    if (!Number.isInteger(n.vel) || n.vel < 1 || n.vel > 127) fail(`velocity ${n.vel} (${n.layer})`);
    if (!(n.point >= -2 && n.point < Math.max(1, sc.points.length))) fail(`point ${n.point}`);
    if (n.layer !== "perc") {
      if (n.midi < 21 || n.midi > 108) fail(`${n.layer} pitch ${n.midi} outside the piano`);
      if (!n.chromatic && !scale.has(((n.midi % 12) + 12) % 12) && !chordPcsAt(n.t).has(((n.midi % 12) + 12) % 12)) fail(`${n.layer} pitch ${n.midi} outside the scale`);
      const T = n.tim;
      if (!T) fail(`${n.layer} note without timbre`);
      for (const k of ["a", "d", "r", "cut", "q", "s", "col"]) if (T[k] !== undefined && !fin(T[k])) fail(`timbre ${k} not finite`);
      if (T.a <= 0 || T.r <= 0 || T.cut < 20 || T.cut > 16000 || T.q < 0.3 - 1e-9 || T.q > 12 + 1e-9 || T.s < 0 || T.s > 1 || T.col < 0 || T.col > 1) fail(`timbre out of bounds ${JSON.stringify({ a: T.a, r: T.r, cut: T.cut, q: T.q, s: T.s, col: T.col })}`);
    }
    // no exact duplicate in one layer (two identical voices would flam and double the level)
    const key = `${n.layer}|${n.t.toFixed(5)}|${n.midi}`;
    if (n.layer !== "perc" && seen.has(key)) fail(`duplicate ${key}`);
    seen.add(key);
  }
  // harmony notes are tones of the sounding chord
  for (const n of sc.notes) if (n.layer === "harm" && n.point >= 0) {
    const S = sc.slots.find(S => n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9);
    if (S && !S.chord.map(m => ((m % 12) + 12) % 12).includes(((n.midi % 12) + 12) % 12)) fail(`harmony ${n.midi} not in chord ${S.chord}`);
  }
}

// A minimal MIDI parser: header, chunk lengths, end-of-track, channel events and note balance.
function checkMidi(bytes, sc) {
  const u = bytes, rd = (i, n) => { let v = 0; for (let k = 0; k < n; k++) v = (v << 8) | u[i + k]; return v >>> 0; };
  const str = i => String.fromCharCode(u[i], u[i + 1], u[i + 2], u[i + 3]);
  expect(str(0)).toBe("MThd"); expect(rd(4, 4)).toBe(6); expect(rd(8, 2)).toBe(1);
  const ntrk = rd(10, 2), ppq = rd(12, 2);
  let i = 14, tracks = 0;
  while (i < u.length) {
    expect(str(i)).toBe("MTrk");
    const len = rd(i + 4, 4), end = i + 8 + len; let p = i + 8, tick = 0;
    const open = new Map();
    while (p < end) {
      let dt = 0, b; do { b = u[p++]; dt = (dt << 7) | (b & 0x7f); } while (b & 0x80);
      tick += dt;
      const st = u[p++];
      if (st === 0xff) { const type = u[p++]; let l = 0; do { b = u[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80); if (type === 0x2f) expect(p + l).toBe(end); p += l; continue; }
      const hi = st & 0xf0, ch = st & 0x0f;
      expect(hi >= 0x80 && hi <= 0xe0).toBe(true);
      if (hi === 0xc0 || hi === 0xd0) { p += 1; continue; }
      const d1 = u[p++], d2 = u[p++];
      expect(d1).toBeLessThan(128); expect(d2).toBeLessThan(128);
      const k = ch * 128 + d1;
      if (hi === 0x90 && d2 > 0) open.set(k, (open.get(k) || 0) + 1);
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) open.set(k, (open.get(k) || 0) - 1);
    }
    expect(p).toBe(end);
    expect(tick).toBe(Math.round(sc.total * ppq)); // every track ends exactly at the end of the piece
    for (const v of open.values()) expect(v).toBe(0);
    tracks++; i = end;
  }
  expect(tracks).toBe(ntrk);
}

describe("audit: all styles, durations, orchestration and extreme settings", () => {
  for (const style of Object.keys(STYLES)) it(`${style}: invariants hold on every case`, () => {
    let cases = 0;
    for (const name of Object.keys(IMAGES)) for (const duration of [15, 30, 60]) for (const orch of ["small", "full"]) {
      const P = { ...BASE, style, duration, orch, smooth: cases % 2, arc: (cases >> 1) % 2 ? 1 : 0, tempoAdj: cases % 3 === 0 ? 0.3 : cases % 3 === 1 ? -0.3 : 0, count: [2, 8, 32][cases % 3], returns: [0, 3, 12][cases % 3], connect: ["rich", "light", "off"][(cases >> 2) % 3] };
      const sc = run(name, P);
      checkScore(sc, P, `${style}/${name}/${duration}s/${orch}`);
      cases++;
    }
    expect(cases).toBe(Object.keys(IMAGES).length * 6);
  }, 120000);
  it("is deterministic for every style at Full orchestration", () => {
    for (const style of Object.keys(STYLES)) { const P = { ...BASE, style, orch: "full" }; expect(strip(run("photo-like 1", P))).toBe(strip(run("photo-like 1", P))); }
  });
  it("writes a well-formed MIDI file for every style", () => {
    for (const style of Object.keys(STYLES)) for (const orch of ["small", "full"]) { const sc = run("photo-like 2", { ...BASE, style, orch }); checkMidi(midiFile(sc, () => true), sc); }
  });
  it("every placement method gives a finite map and a full path on every image", () => {
    for (const name of Object.keys(IMAGES)) {
      const { A, SAL } = prep(name), img = IMAGES[name];
      for (const m of Object.keys(PLACEMENTS).filter(k => PLACEMENTS[k].group === "Classic")) {
        const map = m === "scan" ? SAL.map : attentionMap(m, A, img, SAL.map);
        for (const v of map) if (!(v >= 0 && v <= 1 + 1e-6)) throw new Error(`${m} on ${name}: value ${v}`);
        expect(regionMeans(A, map).every(fin)).toBe(true);
        let id = 0;
        const pts = m === "scan" ? scanPath(A, map, 8, 0.07, () => "q" + id++) : gazePath(A, map, { ...BASE, count: 8 });
        expect(pts.length).toBeGreaterThanOrEqual(1);
        for (const q of pts) { expect(fin(q.x) && fin(q.y)).toBe(true); expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(1); }
      }
    }
  }, 60000);
});
