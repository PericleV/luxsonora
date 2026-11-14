// Orchestration: extra layers by level, harmony, registers, entries over the arc, determinism.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";
import { autoLayers, ROLES } from "../src/core/arrange.js";

const P0 = { style: "cinematic", duration: 30, count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
function run(P, seed = 1) {
  const A = analyze(synthImage(200, 133, seed)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const strip = sc => sc.notes.map(n => [n.layer, Math.round(n.t * 1e4), Math.round(n.dur * 1e4), n.midi, n.vel]);

describe("orchestration levels", () => {
  it("Small adds nothing: the piece is the five-layer one", () => {
    const a = run({ ...P0 }), b = run({ ...P0, orch: "small" });
    expect(b.extra).toEqual([]);
    expect(strip(b)).toEqual(strip(a));
  });
  it("Medium adds 2-3 layers and Full 4-6, in the style's order", () => {
    for (const style of Object.keys(STYLES)) {
      expect(autoLayers(style, "medium", 0, false).length).toBe(2);
      expect(autoLayers(style, "medium", 1, false).length).toBe(3);
      expect(autoLayers(style, "full", 0, false).length).toBe(4);
      expect(autoLayers(style, "full", 1, false).length).toBe(6);
    }
  });
});

describe("extra layers", () => {
  for (const style of Object.keys(STYLES)) it(`play in the scale, in their own register, and enter with the arc (${style})`, () => {
    for (const seed of [1, 2]) {
      const sc = run({ ...P0, style, orch: "full" }, seed), base = 60 + sc.pcOff, scale = new Set([...sc.modeIv, ...(sc.melIv || [])].map(v => (((v + sc.pc) % 12) + 12) % 12));
      const inChord = n => { const S = sc.slots.find(S => n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9); return !!S && S.chord.some(m => ((m - n.midi) % 12 + 12) % 12 === 0); };
      expect(sc.extra.length).toBeGreaterThanOrEqual(4);
      const ids = new Set(sc.extra.map(L => L.id));
      const xs = sc.notes.filter(n => ids.has(n.layer));
      expect(xs.length).toBeGreaterThan(0);
      for (const n of xs) {
        const M = sc.modulation, sh = M && n.t >= M.t0 - 1e-9 && n.t < M.t1 - 1e-9 ? M.shift : 0;
        if (!n.chromatic) expect(scale.has((((n.midi - sh) % 12) + 12) % 12) || inChord(n)).toBe(true);
        expect(n.midi).toBeGreaterThanOrEqual(base - 30); expect(n.midi).toBeLessThanOrEqual(base + 28);
        expect(n.tim).toBeTruthy();
        expect((n.t + n.dur) * 60 / sc.bpm).toBeLessThanOrEqual(sc.seconds + 6);
      }
      // the introduction carries fewer extra notes per beat than the climax
      const per = sec => { const ps = sc.points.filter(F => F.section === sec), beats = ps.reduce((s, F) => s + F.dur, 0); return beats ? xs.filter(n => n.point >= 0 && sc.points[n.point].section === sec).length / beats : null; };
      const intro = per("intro"), climax = per("climax");
      if (intro !== null && climax !== null) expect(climax).toBeGreaterThanOrEqual(intro);
    }
  });
  it("are deterministic and keep the five core layers unchanged", () => {
    const a = run({ ...P0, orch: "full" }), b = run({ ...P0, orch: "full" }), small = run({ ...P0 });
    expect(strip(a)).toEqual(strip(b));
    const core = sc => strip(sc).filter(r => ["lead", "harm", "bass", "pad", "perc"].includes(r[0]));
    expect(core(a)).toEqual(core(small));
  });
  it("take custom layers with their instruments", () => {
    const sc = run({ ...P0, orch: "custom", layers: [{ id: "c1", role: "counter", preset: "x.softlead" }, { id: "c2", role: "ornament", preset: "x.glass" }] });
    expect(sc.extra.map(L => L.id)).toEqual(["c1", "c2"]);
    expect(sc.inst.c1.name).toBe("Soft lead");
    expect(sc.notes.some(n => n.layer === "c1")).toBe(true);
    for (const role of Object.keys(ROLES)) expect(ROLES[role].gain).toBeGreaterThan(0);
  });
});

// Out of the box: no gong on the last chord, no instrument coming back for one note, the last
// melody note on the final chord, and a lead-in that grows into the first note.
describe("endings, stray notes and the way in", () => {
  const STY = ["cinematic", "movie", "ambient", "classical", "pop", "rock", "minimal", "epic", "eastasian", "lofi"];
  const pc = m => ((m % 12) + 12) % 12;
  it("the last drum hits are never much louder than the two bars before, and silent drums stay silent", () => {
    for (const style of STY) for (const seed of [1, 3, 7]) {
      const sc = run({ ...P0, style, orch: "full", samples: true, intro: "auto" }, seed);
      const perc = sc.notes.filter(n => n.layer === "perc"), fin = perc.filter(n => n.point === -2);
      const tail = perc.filter(n => !n.swell && !n.roll && n.point !== -2 && n.t >= sc.body - 8 - 1e-9 && n.t < sc.body - 1e-9);
      if (!tail.length) { expect(fin.length).toBe(0); continue; }
      const ref = Math.max(...tail.map(n => n.vel));
      for (const n of fin) { expect(n.vel).toBeLessThanOrEqual(ref + 6); if (n.midi === 49) expect(ref).toBeGreaterThanOrEqual(84); }
    }
  }, 180000);
  it("an added layer plays the last chord only if it was playing in the last two bars", () => {
    let checked = 0;
    for (const style of STY) for (const seed of [1, 3, 7]) {
      const sc = run({ ...P0, style, orch: "full", samples: true }, seed);
      for (const L of sc.extra) {
        const fin = sc.notes.filter(n => n.layer === L.id && n.point === -2); if (!fin.length) continue;
        checked++;
        expect(sc.notes.some(n => n.layer === L.id && n.point !== -2 && n.t < sc.body - 1e-9 && n.t + n.dur > sc.body - 8 + 1e-9)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 180000);
  it("the melody's last note is a tone of the final chord", () => {
    for (const style of Object.keys(STYLES)) for (const seed of [1, 3, 5, 7, 11]) {
      const sc = run({ ...P0, style, orch: "full", samples: true, intro: "auto", connect: "light" }, seed);
      const tonic = new Set(sc.cadence.chord.map(pc)), last = sc.notes.filter(n => n.layer === "lead" && !n.dbl && n.point === -2);
      for (const n of last) expect(tonic.has(pc(n.midi)), `${style} seed ${seed}`).toBe(true);
    }
  }, 180000);
  it("no moving layer keeps a lone note far from the rest of its part", () => {
    for (const style of STY) for (const seed of [1, 7]) {
      const sc = run({ ...P0, style, orch: "full", samples: true }, seed);
      for (const L of sc.extra) {
        if (["sustain", "drone", "ornament"].includes(L.role)) continue;
        const mine = sc.notes.filter(n => n.layer === L.id && n.point !== -2 && n.t < sc.body - 1e-9).sort((a, b) => a.t - b.t);
        if (!mine.length) continue;
        if (L.role !== "double") expect(mine.length).toBeGreaterThanOrEqual(3);
      }
    }
  }, 180000);
  it("the intro's lead-in grows into the first melody note", () => {
    for (const style of ["cinematic", "pop", "jazz", "classical", "ambient"]) {
      const sc = run({ ...P0, style, intro: "auto" });
      if (!sc.intro) continue;
      const lead = sc.notes.filter(n => n.layer === "lead" && !n.dbl).sort((a, b) => a.t - b.t), ins = lead.filter(n => n.intro), first = lead.find(n => !n.intro);
      if (!ins.length || !first) continue;
      for (let k = 1; k < ins.length; k++) expect(ins[k].vel).toBeGreaterThanOrEqual(ins[k - 1].vel);
      expect(ins[ins.length - 1].vel).toBeLessThanOrEqual(first.vel);
      expect(first.vel - ins[ins.length - 1].vel).toBeLessThanOrEqual(30);
    }
  }, 180000);
});

// Fuller orchestrations stay clean: no instrument with almost nothing to play, the melody has
// right of way, no mud low down, no minor third under a major last chord, no pedal rubbing its chord.
describe("clean harmony in medium and full orchestration", () => {
  const pc = m => ((m % 12) + 12) % 12;
  const ov = (a, b) => Math.min(a.t + a.dur, b.t + b.dur) - Math.max(a.t, b.t);
  const mud = sc => {
    const low = sc.notes.filter(n => n.layer !== "perc" && Number.isFinite(n.midi) && n.midi < 52).sort((a, b) => a.t - b.t); let k = 0;
    for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length && low[j].t < low[i].t + low[i].dur; j++) {
      const a = low[i], b = low[j], iv = Math.abs(a.midi - b.midi);
      if (a.layer !== b.layer && ov(a, b) >= 0.5 && ((iv >= 1 && iv <= 2) || (iv >= 3 && iv <= 4 && Math.max(a.midi, b.midi) < 48))) k++;
    }
    return k;
  };
  it("every instrument of an automatic orchestration has a part", () => {
    let layers = 0, thin = 0;
    for (const style of Object.keys(STYLES)) for (const seed of [1, 7, 3]) {
      const sc = run({ ...P0, style, orch: "full", samples: true }, seed);
      for (const L of sc.extra) {
        if (L.role === "double") continue;
        layers++;
        const mine = sc.notes.filter(n => n.layer === L.id && n.t < sc.body - 1e-9), entries = new Set(mine.map(n => n.t.toFixed(3))).size, cover = mine.reduce((a, n) => a + n.dur, 0);
        if (entries < 3 && !((L.role === "sustain" || L.role === "drone") && cover >= 8)) thin++;
      }
    }
    expect(thin / layers).toBeLessThan(0.03);
  }, 300000);
  it("an added layer is never off the chord a semitone from the melody sounding with it", () => {
    for (const style of ["pop", "synthwave", "movie", "neoclassical", "baroque", "jazz", "rock"]) for (const seed of [1, 3, 7]) {
      const sc = run({ ...P0, style, orch: "full", samples: true, connect: "rich" }, seed);
      const ids = new Set(sc.extra.filter(L => L.role !== "double").map(L => L.id)), lead = sc.notes.filter(n => n.layer === "lead" && !n.dbl);
      const chordAt = t => { const S = sc.slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || sc.slots[sc.slots.length - 1]; return new Set(S.chord.map(pc)); };
      for (const n of sc.notes) {
        if (!ids.has(n.layer) || n.chromatic || n.point === -2 || chordAt(n.t).has(pc(n.midi))) continue;
        for (const m of lead) if (ov(n, m) >= 0.25 - 1e-9) { const d = pc(n.midi - m.midi); expect(d === 1 || d === 11, `${style} ${seed} ${n.layer} t=${n.t}`).toBe(false); }
      }
    }
  }, 300000);
  it("the low register is clearer with the rule than without, and the bass, the pad and the melody stay", () => {
    let on = 0, off = 0;
    for (const style of ["cinematic", "classical", "ambient", "jazz", "pop", "lofi"]) for (const seed of [7, 11]) {
      const a = run({ ...P0, style, orch: "full", samples: true }, seed), b = run({ ...P0, style, orch: "full", samples: true, rules: { lowClear: false } }, seed);
      on += mud(a); off += mud(b);
      for (const l of ["bass", "pad", "lead"]) expect(a.notes.filter(n => n.layer === l).map(n => [n.t, n.midi])).toEqual(b.notes.filter(n => n.layer === l).map(n => [n.t, n.midi]));
    }
    expect(off).toBeGreaterThan(0);
    expect(on).toBeLessThan(off * 0.5);
  }, 300000);
  it("a minor piece ending on the major chord has no minor third still sounding there", () => {
    let seen = 0;
    for (const style of Object.keys(STYLES)) for (const seed of [1, 3, 5, 7, 11]) {
      const sc = run({ ...P0, style, orch: "medium", samples: true }, seed);
      if (!sc.notes.some(n => n.picardy)) continue;
      seen++;
      const m3 = pc(sc.pc + 3);
      for (const n of sc.notes) if (n.layer !== "perc" && pc(n.midi) === m3) expect(n.t + n.dur, `${style} ${seed} ${n.layer}`).toBeLessThanOrEqual(sc.body + 1e-6);
    }
    expect(seen).toBeGreaterThan(0);
  }, 300000);
  it("a tonic pedal in the bass gives way under a chord it rubs against", () => {
    for (const style of ["movie", "neoclassical", "meditation", "eastasian", "ambient"]) for (const seed of [1, 3, 7, 11]) {
      const sc = run({ ...P0, style, duration: 60, orch: "full", samples: true, connect: "rich" }, seed);
      for (const n of sc.notes.filter(n => n.layer === "bass" && n.dur >= 2 && n.point >= 0)) {
        const S = sc.slots.find(S => n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9); if (!S) continue;
        const pcs = new Set(S.chord.map(pc)), p = pc(n.midi);
        expect(!pcs.has(p) && (pcs.has(pc(p + 1)) || pcs.has(pc(p - 1))), `${style} ${seed} bass t=${n.t}`).toBe(false);
      }
    }
  }, 300000);
});
