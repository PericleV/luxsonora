// SLIC superpixels in Lab + spatial space.
// Ported from legacy/sonificare.html; logic unchanged.
import { clamp, clampInt, lerp, mulberry32, hashBytes, srgbToLin, labF, boxBlur, entropyOf } from "./util.js";

export function relabel(lab, N) {
  const map = new Map(), out = new Int32Array(N); let r = 0;
  for (let i = 0; i < N; i++) {
    let v = map.get(lab[i]);
    if (v === undefined) { v = r++; map.set(lab[i], v); }
    out[i] = v;
  }
  return { labels: out, count: r };
}
export function slic(La, Aa, Bb, W, H, K, m, iters) {
  const N = W * H, S = Math.max(4, Math.round(Math.sqrt(N / K)));
  const cs = [];
  for (let y = S >> 1; y < H; y += S) for (let x = S >> 1; x < W; x += S) {
    const i = y * W + x; cs.push([La[i], Aa[i], Bb[i], x, y]);
  }
  const lab = new Int32Array(N), dist = new Float32Array(N), w = (m / S) ** 2;
  for (let it = 0; it < iters; it++) {
    dist.fill(1e30); lab.fill(-1);
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      const x0 = Math.max(0, Math.floor(c[3] - S)), x1 = Math.min(W - 1, Math.ceil(c[3] + S));
      const y0 = Math.max(0, Math.floor(c[4] - S)), y1 = Math.min(H - 1, Math.ceil(c[4] + S));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const dl = La[i] - c[0], da = Aa[i] - c[1], db = Bb[i] - c[2], dx = x - c[3], dy = y - c[4];
        const D = dl * dl + da * da + db * db + (dx * dx + dy * dy) * w;
        if (D < dist[i]) { dist[i] = D; lab[i] = k; }
      }
    }
    const acc = new Float64Array(cs.length * 6);
    for (let i = 0; i < N; i++) {
      const k = lab[i]; if (k < 0) continue; const o = k * 6;
      acc[o] += La[i]; acc[o + 1] += Aa[i]; acc[o + 2] += Bb[i]; acc[o + 3] += i % W; acc[o + 4] += (i / W) | 0; acc[o + 5]++;
    }
    for (let k = 0; k < cs.length; k++) {
      const o = k * 6, n = acc[o + 5];
      if (n > 0) cs[k] = [acc[o] / n, acc[o + 1] / n, acc[o + 2] / n, acc[o + 3] / n, acc[o + 4] / n];
    }
  }
  for (let i = 0; i < N; i++) if (lab[i] < 0) lab[i] = i > 0 ? lab[i - 1] : 0;
  const first = relabel(lab, N), out = first.labels;
  const cnt = new Int32Array(first.count);
  for (let i = 0; i < N; i++) cnt[out[i]]++;
  const minSize = Math.max(3, Math.floor((N / cs.length) * 0.2));
  for (let i = 0; i < N; i++) {
    const me = out[i];
    if (cnt[me] >= minSize) continue;
    const nb = i % W > 0 ? out[i - 1] : i >= W ? out[i - W] : me;
    if (nb !== me && cnt[nb] >= minSize) { cnt[me]--; out[i] = nb; cnt[nb]++; }
  }
  return relabel(out, N);
}
