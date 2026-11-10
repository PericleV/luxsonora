// Focus points: generation (with anchors, minimum distance and explicit revisits),
// Gaussian footprint reading, and the coverage map.
//
// Positions and radii are fractions: x, y of the image width and height, r of the
// image diagonal. The footprint of a point is a Gaussian with σ = r/2, so the circle
// drawn at radius r holds about 86% of its weight.
import { mulberry32 } from "./util.js";

export const DEFAULT_RADIUS = 0.07;
export const MIN_DIST = 0.6; // fraction of the inhibition radius

let nextId = 1;
export const newId = () => "p" + nextId++;

/*
 * Winner-take-all gaze path with inhibition of return (Itti-Koch mechanism), plus:
 *  - anchors: manual points kept at their index; inhibition is applied around them first,
 *    with radius max(inhibition, anchor radius)
 *  - minimum distance: a winner closer than MIN_DIST × inhibition radius to an existing
 *    point is a revisit and reuses that point exactly (same position and area)
 *  - count is the number of distinct places (anchors included); returns caps the number
 *    of revisits. A revisit beyond the cap is not recorded: the area is inhibited again
 *    and the search goes on. The path ends when count places are found or the map runs out.
 * p: { count, returns = ∞, inhibition, memory, seed, radius, sizing ("same" | "area") }
 */
// The size of the spot that draws the eye at pixel i: the pixels around it, joined to it, that
// keep at least 80% of its attention (a flood fill bounded at three times the radius), as the
// radius of a disc with the same area; between 40% and 220% of the base radius. A small sharp
// detail gets a small circle, a wide even area a large one.
export function spotRadius(A, S0, i, base) {
  const W = A.W, H = A.H, diag = Math.hypot(W, H), x0 = i % W, y0 = (i / W) | 0, thr = S0[i] * 0.8, reach = 3 * base * diag;
  const seen = new Uint8Array(W * H), stack = [i]; seen[i] = 1;
  let n = 0;
  while (stack.length) {
    const j = stack.pop(), x = j % W, y = (j / W) | 0; n++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx; if (seen[k]) continue; seen[k] = 1;
      if (S0[k] >= thr && Math.hypot(nx - x0, ny - y0) <= reach) stack.push(k);
    }
  }
  const r = Math.sqrt(n / Math.PI) / diag;
  return Math.min(base * 2.2, Math.max(base * 0.4, r));
}
export function gazePath(A, S0, p, anchors = []) {
  const W = A.W, H = A.H, N = W * H, S = new Float32Array(S0), diag = Math.hypot(W, H);
  if (p.seed > 0) { const rnd = mulberry32(p.seed * 7919 + 13); for (let i = 0; i < N; i++) S[i] *= 0.88 + 0.24 * rnd(); }
  const rInh = p.inhibition * diag, dMin = MIN_DIST * rInh;
  const inhibit = (px, py, r) => {
    const inv = 1 / (2 * r * r), reach = Math.ceil(r * 4);
    const x0 = Math.max(0, Math.floor(px - reach)), x1 = Math.min(W - 1, Math.ceil(px + reach));
    const y0 = Math.max(0, Math.floor(py - reach)), y1 = Math.min(H - 1, Math.ceil(py + reach));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) S[y * W + x] *= 1 - Math.exp(-((x - px) ** 2 + (y - py) ** 2) * inv);
  };
  for (const a of anchors) inhibit(a.x * W - 0.5, a.y * H - 0.5, Math.max(rInh, a.r * diag));
  let max0 = 0; for (let i = 0; i < N; i++) max0 = Math.max(max0, S0[i]);
  const out = [], pending = [...anchors].sort((a, b) => a.index - b.index);
  const autoWant = Math.max(0, p.count - anchors.length), maxReturns = p.returns ?? Infinity;
  let autoNew = 0, returns = 0, exhausted = false, forced = false;
  const placesIn = () => out.filter(q => q.revisitOf === null).map(q => [q.x * W - 0.5, q.y * H - 0.5]);
  // When the inhibited map runs out (or keeps offering refused returns) before count places
  // are found, the next place is the most salient pixel of the original map that keeps the
  // minimum distance to every place so far. -1 when no such pixel is left.
  const fallback = () => {
    const pl = placesIn(), d2 = dMin * dMin;
    let bi = -1, bv = -1;
    for (let i = 0; i < N; i++) {
      if (S0[i] <= bv) continue;
      const x = i % W, y = (i / W) | 0;
      if (pl.every(([px, py]) => (x - px) ** 2 + (y - py) ** 2 >= d2)) { bv = S0[i]; bi = i; }
    }
    return bi;
  };
  for (let guard = 0, limit = 8 * (p.count + 8); ; guard++) {
    const k = out.length;
    const placesDone = autoNew >= autoWant;
    if (pending.length && (pending[0].index <= k || exhausted || placesDone)) { out.push({ ...pending.shift(), source: "manual", revisitOf: null }); continue; }
    // once every place is found the gaze keeps moving only to make the remaining returns
    // (new places are skipped), so Returns is reached whenever the memory brings areas back
    const tail = placesDone && isFinite(maxReturns) && returns < maxReturns && guard < limit;
    if (exhausted || (placesDone && !tail)) break;
    if (guard >= limit) forced = true;
    let bi = 0, bv = -1;
    if (!forced) for (let i = 0; i < N; i++) if (S[i] > bv) { bv = S[i]; bi = i; }
    if (tail && bv < max0 * 0.07) break;
    if (forced || bv < max0 * 0.07) {
      bi = fallback();
      if (bi < 0) { exhausted = true; continue; }
    }
    const x = bi % W, y = (bi / W) | 0;
    let near = -1, nd = Infinity;
    out.forEach((q, j) => { if (q.revisitOf !== null) return; const d = Math.hypot(q.x * W - 0.5 - x, q.y * H - 0.5 - y); if (d < nd) { nd = d; near = j; } });
    if (near >= 0 && nd < dMin) {
      const q = out[near];
      if (returns < maxReturns) { out.push({ ...q, id: newId(), source: "auto", revisitOf: near, index: k }); returns++; }
      else inhibit(x, y, rInh); // refused return: also lower the map where the winner was
      inhibit(q.x * W - 0.5, q.y * H - 0.5, rInh);
    } else {
      if (!tail) { out.push({ id: newId(), x: (x + 0.5) / W, y: (y + 0.5) / H, r: p.sizing === "area" ? spotRadius(A, S0, bi, p.radius) : p.radius, w: S0[bi], s: S0[bi], region: A.labels[bi], source: "auto", revisitOf: null, index: k }); autoNew++; }
      inhibit(x, y, rInh);
    }
    if (p.memory > 0) for (let i = 0; i < N; i++) S[i] += p.memory * (S0[i] - S[i]);
  }
  return out.map((q, i) => ({ ...q, index: i }));
}

// Saliency at a position (used as the default weight of a new point).
export function saliencyAt(A, S0, x, y) {
  const px = Math.min(A.W - 1, Math.max(0, Math.floor(x * A.W))), py = Math.min(A.H - 1, Math.max(0, Math.floor(y * A.H)));
  return S0[py * A.W + px];
}

const REG_KEYS = ["L", "varL", "sat", "warmth", "edge", "sharp", "entropy"];

// Weighted average of region features; weights is a Float64Array indexed by region.
export function blendRegions(A, weights) {
  let tot = 0; for (const w of weights) tot += w;
  if (!(tot > 0)) return { ...A.regions[0] };
  const z = { L: 0, varL: 0, sat: 0, warmth: 0, edge: 0, sharp: 0, entropy: 0, lab: [0, 0, 0], ori: [0, 0, 0, 0], cx: 0, cy: 0, area: 0 };
  let hx = 0, hy = 0, best = 0, bw = -1;
  A.regions.forEach((r, i) => {
    const w = weights[i] / tot; if (!w) return;
    for (const k of REG_KEYS) z[k] += w * r[k];
    for (let c = 0; c < 3; c++) z.lab[c] += w * r.lab[c];
    for (let c = 0; c < 4; c++) z.ori[c] += w * r.ori[c];
    z.cx += w * r.cx; z.cy += w * r.cy; z.area += w * r.area;
    const h = (r.hue * Math.PI) / 180; hx += w * Math.cos(h) * r.hueStr; hy += w * Math.sin(h) * r.hueStr;
    if (weights[i] > bw) { bw = weights[i]; best = i; }
  });
  let hue = (Math.atan2(hy, hx) * 180) / Math.PI; if (hue < 0) hue += 360;
  return { ...z, hue, hueStr: Math.hypot(hx, hy), id: best, n: 0 };
}

// Footprint of a point: Gaussian weights (σ = r/2 of the diagonal) summed per region.
export function footprint(A, x, y, r) {
  const W = A.W, H = A.H, sig = Math.max(0.5, (r * Math.hypot(W, H)) / 2), inv = 1 / (2 * sig * sig), reach = Math.ceil(3 * sig);
  const px = x * W - 0.5, py = y * H - 0.5, weights = new Float64Array(A.regions.length);
  const x0 = Math.max(0, Math.floor(px - reach)), x1 = Math.min(W - 1, Math.ceil(px + reach));
  const y0 = Math.max(0, Math.floor(py - reach)), y1 = Math.min(H - 1, Math.ceil(py + reach));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) weights[A.labels[yy * W + xx]] += Math.exp(-((xx - px) ** 2 + (yy - py) ** 2) * inv);
  const zone = blendRegions(A, weights);
  return { weights, zone, region: zone.id };
}

// Coverage map C = 1 − Π(1 − g_i), with g_i the (peak-normalized) footprint of point i.
export function coverage(A, points) {
  const W = A.W, H = A.H, keep = new Float32Array(W * H).fill(1), diag = Math.hypot(W, H);
  const seen = new Set();
  for (const q of points) {
    const key = q.x.toFixed(5) + "," + q.y.toFixed(5) + "," + q.r; if (seen.has(key)) continue; seen.add(key);
    const sig = Math.max(0.5, (q.r * diag) / 2), inv = 1 / (2 * sig * sig), reach = Math.ceil(3 * sig), px = q.x * W - 0.5, py = q.y * H - 0.5;
    const x0 = Math.max(0, Math.floor(px - reach)), x1 = Math.min(W - 1, Math.ceil(px + reach));
    const y0 = Math.max(0, Math.floor(py - reach)), y1 = Math.min(H - 1, Math.ceil(py + reach));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keep[y * W + x] *= 1 - Math.exp(-((x - px) ** 2 + (y - py) ** 2) * inv);
  }
  const cov = new Float32Array(W * H); let bg = 0;
  for (let i = 0; i < cov.length; i++) { cov[i] = 1 - keep[i]; bg += keep[i]; }
  return { map: cov, background: bg / cov.length };
}

// Region weights of the background (what was not looked at): Σ (1 − C) per region.
export function backgroundZone(A, cov) {
  const w = new Float64Array(A.regions.length);
  for (let i = 0; i < cov.map.length; i++) w[A.labels[i]] += 1 - cov.map[i];
  return blendRegions(A, w);
}

/*
 * Background around a point: what the eye sees from the corner of its eye there. Each pixel
 * counts with a wide Gaussian around the point (σ = SURROUND · r of the diagonal, at least
 * 10% of it) times what was not looked at (1 − C). Returns the region-weighted zone and
 * amount ∈ [0, 1], the share of that neighbourhood left unseen.
 */
export const SURROUND = 2.5;
export function surroundZone(A, cov, x, y, r) {
  const W = A.W, H = A.H, diag = Math.hypot(W, H), sig = Math.max(0.1 * diag, (SURROUND * r * diag) / 2), inv = 1 / (2 * sig * sig);
  const px = x * W - 0.5, py = y * H - 0.5, w = new Float64Array(A.regions.length);
  let tot = 0, bg = 0;
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = yy * W + xx, g = Math.exp(-((xx - px) ** 2 + (yy - py) ** 2) * inv), b = 1 - cov.map[i];
    w[A.labels[i]] += g * b; tot += g; bg += g * b;
  }
  return { zone: blendRegions(A, w), amount: tot > 0 ? bg / tot : 0 };
}

// Attaches footprints to points and picks each point's motif family by footprint weight.
export function readPoints(A, cl, points) {
  return points.map(q => {
    const fp = footprint(A, q.x, q.y, q.r);
    const fam = new Float64Array(cl.k);
    fp.weights.forEach((w, i) => { fam[cl.assign[i]] += w; });
    let family = 0; for (let f = 1; f < cl.k; f++) if (fam[f] > fam[family]) family = f;
    return { ...q, zone: fp.zone, region: fp.region, family };
  });
}
