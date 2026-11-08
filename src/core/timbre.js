// Timbre: each layer's instrument, modulated relative to the focus point's area.
//
// For each area we compute a modulation vector m ∈ [−1, 1]^5. Each component is an
// area feature centred and scaled against the image itself:
//   z(x) = clamp((x − μ) / (2·max(σ, floor)), −1, 1)
// where μ and σ are the area-weighted mean and standard deviation over all regions.
// What you hear is the contrast between areas; ±2σ reaches the modulation limits.
//
// Each component drives one perceptual dimension:
//   att = −z(edge sharpness) → attack     (×2^(1.5·k·att))
//   leg = +z(smoothness)     → legato     (decay, release ×2^(1.0·k·leg); sustain +0.25·k·leg)
//   bri = +z(entropy)        → brightness (cutoff ×2^(1.5·k·bri))
//   res = +z(saturation)     → resonance  (Q ×2^(1.0·k·res))
//   col = +z(warmth)         → colour     (instrument col parameter, +0.35·k·col)
// k = layer depth × the "Image timbre" control.
import { clamp } from "./util.js";
import { CAT } from "./theory.js";

export const DIMS = ["att", "leg", "bri", "res", "col"];
export const DIM_NAME = { att: "Attack", leg: "Legato", bri: "Brightness", res: "Resonance", col: "Colour" };
export const DIM_SOURCE = { att: "edge sharpness", leg: "smoothness", bri: "entropy", res: "saturation", col: "warmth" };
export const DEPTH = { att: 1.5, leg: 1.0, bri: 1.5, res: 1.0, col: 0.35 };
// Depth per layer and dimension (the bass only receives brightness).
export const LAYER_DEPTH = {
  lead: { att: 1, leg: 1, bri: 1, res: 1, col: 1 },
  harm: { att: 0.5, leg: 0.5, bri: 0.5, res: 0.5, col: 0.5 },
  bass: { att: 0, leg: 0, bri: 0.5, res: 0, col: 0 },
  pad: { att: 0.6, leg: 0.6, bri: 0.6, res: 0.6, col: 0.6 }
};
const FLOOR = { sharp: 0.05, smooth: 0.05, ent: 0.03, sat: 0.03, warm: 0.02 };

// Timbre features of an area (a region or an average of regions).
export function zoneFeatures(r, maxE) {
  return { sharp: clamp(r.sharp), smooth: 1 - clamp(r.edge / maxE), ent: clamp(r.entropy), sat: clamp(r.sat), warm: r.warmth };
}

// Area-weighted mean and standard deviation over the whole image.
export function imageStats(A) {
  const maxE = Math.max(1e-4, ...A.regions.map(r => r.edge));
  const F = A.regions.map(r => zoneFeatures(r, maxE)), W = A.regions.map(r => r.area);
  const tot = W.reduce((a, b) => a + b, 0) || 1, mu = {}, sd = {};
  for (const k of Object.keys(FLOOR)) {
    let m = 0; F.forEach((f, i) => (m += f[k] * W[i])); m /= tot;
    let v = 0; F.forEach((f, i) => (v += (f[k] - m) ** 2 * W[i])); v /= tot;
    mu[k] = m; sd[k] = Math.sqrt(v);
  }
  return { mu, sd, maxE };
}

export function modulation(f, stats, obj, wSem) {
  const z = k => clamp((f[k] - stats.mu[k]) / (2 * Math.max(stats.sd[k], FLOOR[k])), -1, 1);
  const m = { att: -z("sharp"), leg: z("smooth"), bri: z("ent"), res: z("sat"), col: z("warm") };
  if (obj && CAT[obj.category] && wSem > 0) {
    const b = CAT[obj.category].bias;
    for (const d of DIMS) if (b[d]) m[d] = clamp(m[d] + b[d] * 0.5 * wSem, -1, 1);
  }
  return m;
}

export const ZERO_M = { att: 0, leg: 0, bri: 0, res: 0, col: 0 };

// Applies modulation m to instrument inst, with per-dimension depth × amount.
export function modulate(inst, m, depth, amount) {
  const k = d => depth[d] * amount * m[d];
  const out = { ...inst };
  out.a = inst.a * 2 ** (DEPTH.att * k("att"));
  out.d = inst.d * 2 ** (DEPTH.leg * k("leg"));
  out.r = inst.r * 2 ** (DEPTH.leg * k("leg"));
  out.s = clamp(inst.s + 0.25 * k("leg"));
  out.cut = Math.min(16000, inst.cut * 2 ** (DEPTH.bri * k("bri")));
  out.q = clamp(inst.q * 2 ** (DEPTH.res * k("res")), 0.3, 12);
  out.col = clamp(inst.col + DEPTH.col * k("col"));
  return out;
}

// Full timbre of a focus point: one parameter set per layer.
// inst: the instruments in use per layer (see instruments.js resolveInstruments).
export function pointTimbre(r, inst, stats, obj, wSem, amount) {
  const f = zoneFeatures(r, stats.maxE), m = modulation(f, stats, obj, wSem);
  return {
    m, src: f,
    lead: modulate(inst.lead, m, LAYER_DEPTH.lead, amount),
    harm: modulate(inst.harm, m, LAYER_DEPTH.harm, amount),
    bass: modulate(inst.bass, m, LAYER_DEPTH.bass, amount)
  };
}

export function avgRegion(list) {
  const tot = list.reduce((a, r) => a + r.area, 0) || 1, o = { edge: 0, sharp: 0, varL: 0, entropy: 0, sat: 0, warmth: 0, L: 0 };
  for (const r of list) for (const k in o) o[k] += r[k] * r.area / tot;
  return o;
}
