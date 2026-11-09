// Gaze path: winner-take-all with inhibition of return and memory. Each entry is a focus point.
// Ported from the original prototype (legacy/prototype-core.js); logic unchanged.
import { clamp, clampInt, lerp, mulberry32, hashBytes, srgbToLin, labF, boxBlur, entropyOf } from "./util.js";

export function scanpath(A, S0, p) {
  const W = A.W, H = A.H, N = W * H, S = new Float32Array(S0);
  if (p.seed > 0) { const rnd = mulberry32(p.seed * 7919 + 13); for (let i = 0; i < N; i++) S[i] *= 0.88 + 0.24 * rnd(); }
  const r = p.inhibition * Math.hypot(W, H), inv = 1 / (2 * r * r);
  let max0 = 0; for (let i = 0; i < N; i++) max0 = Math.max(max0, S[i]);
  const out = [];
  for (let k = 0; k < p.count; k++) {
    let bi = 0, bv = -1;
    for (let i = 0; i < N; i++) if (S[i] > bv) { bv = S[i]; bi = i; }
    if (bv < max0 * 0.07) break;
    const x = bi % W, y = (bi / W) | 0;
    out.push({ x: (x + 0.5) / W, y: (y + 0.5) / H, s: S0[bi], region: A.labels[bi] });
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const d2 = (xx - x) ** 2 + (yy - y) ** 2;
      S[yy * W + xx] *= 1 - Math.exp(-d2 * inv);
    }
    if (p.memory > 0) for (let i = 0; i < N; i++) S[i] += p.memory * (S0[i] - S[i]);
  }
  return out;
}
