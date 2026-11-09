// Motif families: k-means over regions and the motif of each family.
// Ported from the original prototype (legacy/prototype-core.js); logic unchanged.
import { clamp, clampInt, lerp, mulberry32, hashBytes, srgbToLin, labF, boxBlur, entropyOf } from "./util.js";

export function regionFeat(r) {
  const h = (r.hue * Math.PI) / 180;
  return [r.L, r.sat, Math.cos(h) * r.sat, Math.sin(h) * r.sat, r.edge * 2, r.entropy, Math.sqrt(r.varL) * 2];
}
export function clusterRegions(A, k) {
  const rs = A.regions, F = rs.map(regionFeat), n = F.length;
  k = Math.min(k, n);
  const d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  let first = 0; for (let i = 1; i < n; i++) if (rs[i].n > rs[first].n) first = i;
  const C = [F[first].slice()];
  while (C.length < k) {
    let bi = 0, bd = -1;
    for (let i = 0; i < n; i++) { const dm = Math.min(...C.map(c => d2(F[i], c))); if (dm > bd) { bd = dm; bi = i; } }
    C.push(F[bi].slice());
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; C.forEach((c, j) => { const dd = d2(F[i], c); if (dd < bd) { bd = dd; b = j; } }); assign[i] = b; }
    for (let j = 0; j < k; j++) {
      const m = new Array(7).fill(0); let cnt = 0;
      for (let i = 0; i < n; i++) if (assign[i] === j) { F[i].forEach((v, q) => (m[q] += v * rs[i].n)); cnt += rs[i].n; }
      if (cnt > 0) C[j] = m.map(v => v / cnt);
    }
  }
  return { assign, centroids: C, k };
}
export const CONTOURS = [[0, 2, 4, 2], [0, 1, 2, 4], [0, 1, 0, -1], [0, -1, -2, 1]];
export function buildMotifs(cl, regions) {
  return cl.centroids.map((c, ci) => {
    const texture = clamp(c[4] * 1.2 + c[5] * 0.6);
    const len = 1 + Math.round(texture * 3);
    const o = [0, 0, 0, 0]; let area = 0;
    regions.forEach((r, i) => { if (cl.assign[i] === ci) { r.ori.forEach((v, q) => (o[q] += v * r.n)); area += r.area; } });
    const dom = o.indexOf(Math.max(...o));
    const w = c[0] > 0.55 ? [2, 1, 1, 2] : c[0] < 0.3 ? [1, 1, 1, 1] : [3, 1, 2, 2];
    return { iv: CONTOURS[dom].slice(0, len), w: w.slice(0, len), letter: String.fromCharCode(65 + ci), dom, area, texture };
  });
}
