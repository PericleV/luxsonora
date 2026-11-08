// Equivalence with the prototype for the stages that did not change since
// legacy/sonificare.html: analysis, SLIC, saliency, gaze path, motifs, WAV.
// Composition and MIDI changed on purpose in Phase 2a (see compose.test.js);
// the semantic JSON moved to English field names in Phase 3a.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { mulberry32 } from "../src/core/util.js";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { scanpath } from "../src/core/scanpath.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { validateSem } from "../src/core/semantic.js";
import { wavFromChannels } from "../src/export/wavzip.js";

// Loads the pure part of the legacy script (utilities up to WAV, plus semantic validation).
function loadLegacy() {
  const lines = fs.readFileSync(new URL("../legacy/sonificare.html", import.meta.url), "utf8").split(/\r?\n/);
  const src = [...lines.slice(245, 812), ...lines.slice(1351, 1368)].join("\n");
  const ctx = vm.createContext({ Math, Float32Array, Float64Array, Int32Array, Uint8Array, Uint32Array, Map, Set, TextEncoder, Blob, DataView, ArrayBuffer, String, Number, Array, Object, isFinite });
  return vm.runInContext(src + "\n;({ analyze, computeSaliency, scanpath, clusterRegions, buildMotifs, compose, midiFile, wavFromChannels, validateSem })", ctx);
}

// Canonical serialization: typed arrays become lists, then JSON (full precision).
const canon = x => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));


// The same semantic answer in the new (English) and the legacy (Romanian) field names.
const SEM = {
  atmosphere: [{ label: "calm", score: 0.8 }], valence: 0.7, energy: 0.3,
  objects: [{ name: "boat", category: "artificial", x: 0.2, y: 0.5, w: 0.3, h: 0.3, importance: 0.9 }, { name: "tree", category: "natural", x: 0.6, y: 0.1, w: 0.3, h: 0.5, importance: 0.4 }]
};
const SEM_LEGACY = {
  atmosfera: [{ eticheta: "calm", scor: 0.8 }], valenta: 0.7, energie: 0.3,
  obiecte: SEM.objects.map(o => ({ nume: o.name, categorie: o.category, x: o.x, y: o.y, w: o.w, h: o.h, importanta: o.importance }))
};

const P0 = { style: "ambient", count: 14, inhibition: 0.18, memory: 0.05, seed: 0, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 0.8, reverb: 0.6, layers: { lead: true, harm: true, bass: true, pad: true, perc: true } };

function pipeline(M, img, P, sem) {
  const A = M.analyze(img), CL = M.clusterRegions(A, 6), MOT = M.buildMotifs(CL, A.regions);
  const semV = sem ? M.validateSem(sem) : null;
  const SAL = M.computeSaliency(A, { color: P.wColor, texture: P.wTex, semantic: semV ? P.wSem : 0 }, semV);
  const FIX = M.scanpath(A, SAL.map, P);
  return { A, CL, MOT, SAL, FIX };
}

const NEW = { analyze, computeSaliency, scanpath, clusterRegions, buildMotifs, wavFromChannels, validateSem };
const OLD = loadLegacy();

const CASES = [
  { name: "200x133, defaults", img: [200, 133, 1], P: {} },
  { name: "133x200, portrait, jazz", img: [133, 200, 2], P: { style: "jazz" } },
  { name: "200x150, electronic, seed 7", img: [200, 150, 3], P: { style: "electronic", seed: 7, count: 24 } },
  { name: "200x112, minimal, low fidelity", img: [200, 112, 4], P: { style: "minimal", fidelity: 0.2, memory: 0.15 } },
  { name: "160x160, cinematic, high fidelity", img: [160, 160, 5], P: { style: "cinematic", fidelity: 0.9, inhibition: 0.32, tempoAdj: 0.2, timbre: 0.3 } },
  { name: "200x133, semantic", img: [200, 133, 6], P: {}, sem: true }
];

describe("equivalence with legacy/sonificare.html", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const img = synthImage(...c.img), P = { ...P0, ...c.P };
      const a = pipeline(NEW, img, P, c.sem ? SEM : null), b = pipeline(OLD, img, P, c.sem ? SEM_LEGACY : null);
      expect(a.FIX.length).toBeGreaterThan(3);
      for (const k of ["A", "CL", "MOT", "SAL", "FIX"]) expect(canon(a[k]), k).toBe(canon(b[k]));
    });
  }
  it("WAV", () => {
    const rnd = mulberry32(3), ch = [new Float32Array(4000), new Float32Array(4000)];
    for (const c of ch) for (let i = 0; i < c.length; i++) c[i] = Math.sin(i * 0.05) * 0.4 + (rnd() - 0.5) * 0.1;
    expect(Buffer.compare(Buffer.from(NEW.wavFromChannels(ch, 44100)), Buffer.from(OLD.wavFromChannels(ch, 44100)))).toBe(0);
  });
});
