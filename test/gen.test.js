// How a song is made: Classic, By genre (the picture chooses the tracks) and Raw (read from the picture).
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { LIBRARY } from "../src/core/instruments.js";
import { genreCore, genreLayers, pictureOf, characterOf, GEN_MODES, genOf, pictureBandOf } from "../src/core/gen.js";
import { rawNotes, rawPath, snap, RAW_READS, rawTrackList, nextTrackId, DRUMS_KEY, ccFromPicture } from "../src/core/raw.js";

const P0 = { style: "rock", duration: 30, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, samples: true, orch: "small" };
const cache = new Map();
function setup(seed) {
  if (cache.has(seed)) return cache.get(seed);
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const s = { A, CL, MOT, SAL }; cache.set(seed, s); return s;
}
function run(P, seed = 1) {
  const { A, CL, MOT, SAL } = setup(seed);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const strip = sc => sc.notes.map(n => [n.layer, Math.round(n.t * 1e4), Math.round(n.dur * 1e4), n.midi, n.vel]);
const names = sc => ["lead", "harm", "bass", "pad"].map(l => sc.inst[l].name).concat((sc.extra || []).map(L => L.name));

describe("song generation modes", () => {
  it("two modes, and the picture may choose the band of a composed piece; old projects keep their meaning", () => {
    expect(Object.keys(GEN_MODES)).toEqual(["composed", "raw"]);
    expect([genOf({ gen: "classic" }), genOf({ gen: "genre" }), genOf({ gen: "raw" }), genOf({})]).toEqual(["composed", "composed", "raw", "composed"]);
    expect([pictureBandOf({ gen: "genre" }), pictureBandOf({ gen: "composed", pictureBand: true }), pictureBandOf({ gen: "composed" }), pictureBandOf({ gen: "raw", pictureBand: true })]).toEqual([true, true, false, false]);
    expect(strip(run({ ...P0, gen: "composed", pictureBand: true, orch: "full" }))).toEqual(strip(run({ ...P0, gen: "genre", orch: "full" })));
  });
  it("Classic is the piece as it was", () => {
    expect(strip(run({ ...P0, gen: "composed" }))).toEqual(strip(run({ ...P0 })));
  });
  it("By genre: the picture chooses instruments from the genre, the same picture the same ones, none twice", () => {
    const seen = new Set();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = run({ ...P0, gen: "composed", pictureBand: true, orch: "full" }, seed), b = run({ ...P0, gen: "composed", pictureBand: true, orch: "full" }, seed);
      expect(names(a)).toEqual(names(b));
      seen.add(names(a).join("|"));
      expect(a.extra.length).toBeGreaterThanOrEqual(3);
      const main = new Set(names(a).slice(0, 4)), added = names(a).slice(4);
      expect(added.some(n => main.has(n))).toBe(false); expect(new Set(added).size).toBe(added.length);
    }
    console.log([...seen]);
    expect(seen.size).toBeGreaterThan(1);
  });
  it("what the genre is built on comes first: no piano in rock or metal, an orchestral lead in classical", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { A } = setup(seed), r = genreCore("rock", A), m = genreCore("metal", A), c = genreCore("classical", A);
      for (const x of [r, m]) expect(Object.values(x)).not.toContain("s.piano");
      expect(genreLayers("metal", "full", A).pick.map(L => L.preset)).not.toContain("s.piano");
      expect([undefined, null, "s.overdrive", "s.distortion"]).toContain(r.lead ?? undefined);
      expect([null, "s.piano", "s.violin", "s.cello", "s.flute", "s.clarinet", "s.oboe"]).toContain(c.lead);
    }
  });
  it("By genre keeps your own instrument", () => {
    const sc = run({ ...P0, gen: "composed", pictureBand: true, instruments: { lead: { preset: "s.flute" } } });
    expect(sc.inst.lead.name).toBe(LIBRARY["s.flute"].name);
  });
  it("every style's pools name real instruments", () => {
    for (const st of Object.keys(STYLES)) {
      const { A } = setup(1), c = genreCore(st, A), g = genreLayers(st, "full", A);
      for (const k of Object.values(c)) if (k) expect(LIBRARY[k], `${st} ${k}`).toBeTruthy();
      for (const L of [...g.pick, ...g.rest]) expect(LIBRARY[L.preset], `${st} ${L.preset}`).toBeTruthy();
    }
  });
});

describe("by genre leaves out what the genre does not have", () => {
  it("a jazz combo has no pad", () => {
    const sc = run({ ...P0, style: "jazz", gen: "composed", pictureBand: true });
    expect(sc.omit).toEqual(["pad"]); expect(sc.notes.some(n => n.layer === "pad")).toBe(false);
    expect(run({ ...P0, style: "jazz", gen: "composed" }).notes.some(n => n.layer === "pad")).toBe(true);
  });
});

describe("raw", () => {
  it("starts with one track: the height, on the style's melody instrument", () => {
    const sc = run({ ...P0, gen: "raw" });
    expect(sc.raw.tracks).toEqual([{ id: "r1", read: "height", preset: sc.extra[0].preset }]);
    expect(sc.extra.length).toBe(1); expect(sc.extra[0].read).toBe("height");
    expect(sc.omit).toEqual(["lead", "harm", "bass", "pad", "perc"]);
    expect(new Set(sc.notes.map(n => n.layer))).toEqual(new Set(["r1"]));
    expect(sc.notes.every(n => n.t >= 0 && n.t + n.dur <= sc.total + 1e-6 && n.tim)).toBe(true);
  });
  it("as many tracks as you add, one of them the drum kit", () => {
    const tracks = [{ id: "r1", read: "height", preset: "s.piano" }, { id: "r2", read: "colour", preset: "s.vibes" }, { id: "r3", read: "light", preset: "s.contrabass" }, { id: "r4", read: "edges", preset: DRUMS_KEY }, { id: "r5", read: "texture", preset: DRUMS_KEY }];
    const sc = run({ ...P0, gen: "raw", rawTracks: tracks });
    expect(sc.raw.tracks.map(t => t.id)).toEqual(["r1", "r2", "r3", "perc"]);
    expect(sc.omit).toEqual(["lead", "harm", "bass", "pad"]);
    for (const l of ["r1", "r2", "r3", "perc"]) expect(sc.notes.filter(n => n.layer === l).length, l).toBeGreaterThan(0);
    const bass = sc.notes.filter(n => n.layer === "r3"); expect(Math.max(...bass.map(n => n.midi))).toBeLessThanOrEqual(52);
    expect(nextTrackId(tracks)).toBe("r6"); expect(rawTrackList({ rawTracks: [] }, "s.piano")).toEqual([{ id: "r1", read: "height", preset: "s.piano" }]);
    expect(rawTrackList({ rawTracks: [{ id: "r1", read: "height", preset: "x.wave" }] }, "s.piano")[0].preset).toBe("s.piano");
  });
  it("keeps to the scale, or every semitone with it off", () => {
    const T = [{ id: "r1", read: "height", preset: "s.piano" }, { id: "r2", read: "colour", preset: "s.vibes" }];
    const sc = run({ ...P0, gen: "raw", rawTracks: T }), pcs = new Set(sc.melIv.map(v => (v + sc.pc) % 12));
    expect(sc.notes.every(n => pcs.has(n.midi % 12))).toBe(true);
    const ch = run({ ...P0, gen: "raw", rawTracks: T, rawScale: false });
    expect(new Set(ch.notes.map(n => n.midi % 12)).size).toBeGreaterThan(pcs.size - 1);
  });
  it("notes you delete stay deleted; controllers from the picture, or yours", () => {
    const T = [{ id: "r1", read: "height", preset: "s.piano" }, { id: "r2", read: "edges", preset: DRUMS_KEY }];
    const a = run({ ...P0, gen: "raw", rawTracks: T });
    expect(a.notes.every(n => n.rawKey && n.cc)).toBe(true);
    const gone = a.notes.filter(n => n.layer === "r1").slice(0, 3).map(n => n.rawKey);
    const b = run({ ...P0, gen: "raw", rawTracks: T, rawCut: gone });
    expect(b.notes.length).toBe(a.notes.length - 3); expect(b.raw.cut).toBe(3);
    expect(b.notes.some(n => gone.includes(n.rawKey))).toBe(false);
    const n0 = a.notes.find(n => n.layer === "r1");
    expect(n0.cc).toEqual(ccFromPicture(n0.pic));
    expect(a.cc.r1.expr.length).toBeGreaterThan(0); expect(a.cc.r1.bright.length).toBeGreaterThan(0); expect(a.cc.perc).toBeUndefined();
    const c = run({ ...P0, gen: "raw", rawTracks: T, rawCC: { [n0.rawKey]: { expr: 0.2, bright: 1 } } }), m = c.notes.find(n => n.rawKey === n0.rawKey);
    expect(m.cc.expr).toBe(0.2); expect(m.cc.bright).toBe(1); expect(m.cc.mod).toBe(n0.cc.mod); expect(m.ccOwn).toBe(true);
    expect(m.tim.cut).toBeGreaterThan(n0.tim.cut);
    // each track's effects from what its notes saw
    expect(Object.keys(a.rawFx)).toEqual(["r1"]);
    for (const v of Object.values(a.rawFx.r1)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it("a tempo set by hand", () => {
    const sc = run({ ...P0, gen: "raw", rawBpm: 90 });
    expect(Math.abs(sc.bpm - 90)).toBeLessThan(5);
  });
  it("each track reads what it is told, the same picture the same notes", () => {
    for (const r of Object.keys(RAW_READS)) {
      const sc = run({ ...P0, gen: "raw", rawTracks: [{ id: "r1", read: r, preset: "s.piano" }] });
      expect(sc.notes.length, r).toBeGreaterThan(0);
      expect(sc.notes.every(n => n.raw === r)).toBe(true);
    }
    expect(strip(run({ ...P0, gen: "raw" }))).toEqual(strip(run({ ...P0, gen: "raw" })));
    expect(snap(61, new Set([0, 2, 4, 5, 7, 9, 11]))).toBe(62);
  });
});
