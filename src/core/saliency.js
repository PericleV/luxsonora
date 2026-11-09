// Saliency map: region contrast, texture, centre prior, semantic objects.
// Ported from the original prototype (legacy/prototype-core.js); logic unchanged.
import { clamp, clampInt, lerp, mulberry32, hashBytes, srgbToLin, labF, boxBlur, entropyOf } from "./util.js";

export function computeSaliency(A, w, sem) {
  const rs = A.regions, n = rs.length;
  const con = new Float32Array(n), ed = new Float32Array(n), obj = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = rs[i].cx - rs[j].cx, dy = rs[i].cy - rs[j].cy;
      const wj = rs[j].area * Math.exp(-(dx * dx + dy * dy) / 0.18);
      const a = rs[i].lab, b = rs[j].lab;
      s += wj * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 100;
    }
    con[i] = s; ed[i] = rs[i].edge;
    if (sem && sem.objects) for (const o of sem.objects) {
      if (rs[i].cx >= o.x && rs[i].cx <= o.x + o.w && rs[i].cy >= o.y && rs[i].cy <= o.y + o.h) obj[i] = Math.max(obj[i], clamp(o.importance ?? 0.5));
    }
  }
  const norm = arr => { let m = 0; for (const v of arr) m = Math.max(m, v); if (m > 0) for (let i = 0; i < arr.length; i++) arr[i] /= m; return arr; };
  norm(con); norm(ed);
  const wsum = w.color + w.texture + 1e-6, region = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.exp(-((rs[i].cx - 0.5) ** 2 + (rs[i].cy - 0.5) ** 2) / (2 * 0.28 * 0.28));
    const base = (w.color * con[i] + w.texture * ed[i]) / wsum;
    region[i] = base * (0.55 + 0.45 * c) + w.semantic * obj[i] * 0.8;
  }
  norm(region);
  const raw = new Float32Array(A.N);
  for (let p = 0; p < A.N; p++) raw[p] = region[A.labels[p]];
  const map = boxBlur(raw, A.W, A.H, Math.max(2, Math.round(Math.min(A.W, A.H) / 40)), 3);
  const bw = Math.max(2, 0.1 * Math.min(A.W, A.H));
  for (let y = 0; y < A.H; y++) for (let x = 0; x < A.W; x++) {
    const d = Math.min(x, A.W - 1 - x, y, A.H - 1 - y), t = clamp(d / bw);
    map[y * A.W + x] *= 0.15 + 0.85 * t * t * (3 - 2 * t);
  }
  let mx = 0; for (const v of map) mx = Math.max(mx, v);
  if (mx > 0) for (let p = 0; p < map.length; p++) map[p] /= mx;
  return { region, map };
}
