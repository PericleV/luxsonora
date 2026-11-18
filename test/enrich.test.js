// Enriched: six more readings of the picture, and what they change, always under the genre's rules.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { enrichAt, enrichOn, linesWord, ENRICH_KEYS, GENERIC_HARM } from "../src/core/enrich.js";
import { RAW_READS, ENRICH_READS } from "../src/core/raw.js";

const P0 = { style: "pop", duration: 30, count: 8, returns: 0, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, samples: true, orch: "small" };
const cache = new Map();
function run(P, seed = 3) {
  let s = cache.get(seed);
  if (!s) { const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6); s = { A, CL, MOT: buildMotifs(CL, A.regions), SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) }; cache.set(seed, s); }
  const pts = readPoints(s.A, s.CL, gazePath(s.A, s.SAL.map, P)), cov = coverage(s.A, pts); cov.zone = backgroundZone(s.A, cov);
  return compose({ A: s.A, sal: s.SAL, points: pts, cl: s.CL, motifs: s.MOT, P, sem: null, cov });
}
const strip = sc => sc.notes.map(n => [n.layer, Math.round(n.t * 1e4), Math.round(n.dur * 1e4), n.midi, n.vel, Math.round((n.pan || 0) * 100)]);
function picture(W, H, fn) { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y), i = 4 * (y * W + x); d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return analyze({ width: W, height: H, data: d }); }

describe("the readings", () => {
  it("see the direction of lines and a repeating pattern", () => {
    const v = enrichAt(picture(120, 80, x => (x % 6 < 3 ? [220, 220, 220] : [40, 40, 40])), 0.5, 0.5, 0.1);
    expect(linesWord(v)).toBe("vertical"); expect(v.vert).toBeGreaterThan(0.9); expect(v.pattern).toBeGreaterThan(0.8); expect(v.period).toBe(6);
    const h = enrichAt(picture(120, 80, (x, y) => (y % 8 < 4 ? [200, 200, 200] : [30, 30, 30])), 0.5, 0.5, 0.1);
    expect(linesWord(h)).toBe("horizontal");
  });
  it("see opposite colours side by side, and where the light comes from", () => {
    const c = enrichAt(picture(120, 80, x => (x < 60 ? [230, 40, 40] : [40, 200, 200])), 0.5, 0.5, 0.15);
    expect(c.contrast).toBeGreaterThan(0.5);
    const l = enrichAt(picture(120, 80, x => [x * 2, x * 2, x * 2]), 0.5, 0.5);
    expect(l.lightX).toBeGreaterThan(0.2);
    expect(enrichAt(picture(120, 80, x => (x < 60 ? [230, 40, 40] : [230, 60, 40])), 0.5, 0.5, 0.15).contrast).toBeLessThan(0.1);
  });
  it("every place keeps its readings, in every mode", () => {
    const sc = run({ ...P0 });
    for (const F of sc.points) for (const k of ["vert", "horiz", "diag", "pattern", "depth", "contrast", "grain"]) { expect(F.enrich[k], k).toBeGreaterThanOrEqual(0); expect(F.enrich[k], k).toBeLessThanOrEqual(1); }
  });
});

describe("Enriched", () => {
  it("off, the piece is as it was; on, it changes, the same way every time", () => {
    expect(strip(run({ ...P0, enrich: false }))).toEqual(strip(run({ ...P0 })));
    const a = run({ ...P0, enrich: true }), b = run({ ...P0, enrich: true });
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(run({ ...P0 })));
    expect(enrichOn({ enrich: true, enrichUse: { grain: false } }, "grain")).toBe(false);
    expect(enrichOn({ enrich: true }, "grain")).toBe(true); expect(enrichOn({}, "grain")).toBe(false);
    expect(ENRICH_KEYS.length).toBe(6);
  });
  it("chooses only among the generic accompaniments: the genre's own patterns stay", () => {
    for (const style of ["reggae", "funk", "bossa", "rock"]) {
      const off = run({ ...P0, style }), on = run({ ...P0, style, enrich: true });
      off.slots.forEach((S, i) => { if (!GENERIC_HARM.has(S.harmKind)) expect(on.slots[i].harmKind, style).toBe(S.harmKind); });
    }
  });
  it("a suspension resolves, a shaker plays only on a piece with drums", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sc = run({ ...P0, enrich: true, enrichUse: { lines: false, pattern: false } }, seed);
      // every chord with a suspension has its third back in its second half
      for (const S of sc.slots) {
        const sus = sc.notes.filter(x => x.sus && x.t >= S.t0 - 1e-9 && x.t < S.t1 - 1e-9); if (!sus.length) continue;
        const mid = S.t0 + (S.t1 - S.t0) / 2, third = ((sus[0].midi - 1) % 12 + 12) % 12, third2 = ((sus[0].midi - 2) % 12 + 12) % 12;
        expect(sc.notes.some(m => m.layer === "harm" && !m.sus && m.t >= mid - 1e-6 && m.t < S.t1 && [third, third2].includes(((m.midi % 12) + 12) % 12)), `seed ${seed}`).toBe(true);
      }
    }
    // the shaker adds nothing to the groove: the hits are as many as without Enriched (the grain
    // turns hi-hats into a shaker; only a grainy place without hi-hats gets a few off-beats)
    for (const seed of [1, 3, 5]) {
      const on = run({ ...P0, enrich: true, enrichUse: { lines: false, pattern: false, depth: false, contrast: false, light: false } }, seed), off = run({ ...P0 }, seed);
      const hits = sc => sc.notes.filter(n => n.layer === "perc").length;
      expect(hits(on) - hits(off), `seed ${seed}`).toBeLessThanOrEqual(0.1 * hits(off));
    }
    const amb = run({ ...P0, style: "meditation", enrich: true });
    if (!run({ ...P0, style: "meditation" }).notes.some(n => n.layer === "perc")) expect(amb.notes.some(n => n.layer === "perc")).toBe(false);
  });
  it("a raw piece can read the new things", () => {
    for (const r of ENRICH_READS) {
      expect(RAW_READS[r]).toBeTruthy();
      const sc = run({ ...P0, gen: "raw", enrich: true, rawTracks: [{ id: "r1", read: r, preset: "s.piano" }] });
      expect(sc.notes.length, r).toBeGreaterThan(0);
    }
  });
});
