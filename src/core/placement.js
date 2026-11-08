// Placement: where the focus points go. Each method returns an attention map over the analysed
// image (values 0-1, the gaze generator picks its maxima, focus.js), except Scan, which places
// the points itself. All classic methods are deterministic and run in a few milliseconds at the
// analysis size (≤ 200 px); the neural ones live in src/ml/vision.js.
import FFT from "fft.js";
import { clamp, boxBlur, srgbToLin, labF } from "./util.js";

export const PLACEMENTS = {
  contrast: { name: "Region contrast", group: "Classic", desc: "Spots where colour and texture stand out from their surroundings. A good place to start." },
  spectral: { name: "Spectral residual", group: "Classic", desc: "Small details that don't quite fit the rest of the picture." },
  frequency: { name: "Frequency-tuned", group: "Classic", desc: "Whole objects whose colour stands out from the rest of the picture." },
  itti: { name: "Itti-Koch", group: "Classic", desc: "The classic model of human attention, built on contrast in brightness, colour and direction." },
  details: { name: "Details", group: "Classic", desc: "Small blobs and corners anywhere in the picture. Good for cells, particles and microscope images." },
  composition: { name: "Composition", group: "Classic", desc: "The rule of thirds and the horizon, the way a photographer frames a shot." },
  scan: { name: "Scan", group: "Classic", desc: "Sweeps from left to right, one spot per column." },
  objects: { name: "Objects", group: "Neural", desc: "An AI model (about 5 MB) finds people, animals and things, and the eye goes to them. With people it looks toward the face." },
  learned: { name: "Learned saliency", group: "Neural", desc: "An AI model trained on real eye-tracking guesses where people would look (about 25 MB)." }
};
export const isNeural = m => PLACEMENTS[m] && PLACEMENTS[m].group === "Neural";

export function normalize(map) {
  let lo = Infinity, hi = -Infinity;
  for (const v of map) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  for (let i = 0; i < map.length; i++) map[i] = span > 1e-12 ? (map[i] - lo) / span : 0;
  return map;
}
// Same border attenuation as the region-contrast map: the gaze doesn't stick to the edges.
export function borderFade(map, W, H, floor = 0.15, frac = 0.1) {
  const bw = Math.max(2, frac * Math.min(W, H));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, W - 1 - x, y, H - 1 - y), t = clamp(d / bw);
    map[y * W + x] *= floor + (1 - floor) * t * t * (3 - 2 * t);
  }
  return map;
}
const blur = (m, W, H, r) => (r >= 1 ? boxBlur(m, W, H, Math.round(r), 3) : Float32Array.from(m));
// Bilinear resampling of a W×H map to w×h.
export function resize(src, W, H, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(W - 1, Math.max(0, ((x + 0.5) * W) / w - 0.5)), fy = Math.min(H - 1, Math.max(0, ((y + 0.5) * H) / h - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    out[y * w + x] = (src[y0 * W + x0] * (1 - ax) + src[y0 * W + x1] * ax) * (1 - ay) + (src[y1 * W + x0] * (1 - ax) + src[y1 * W + x1] * ax) * ay;
  }
  return out;
}
function gradients(L, W, H) {
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1), p = y * W + x;
    gx[p] = (L[y * W + xp] - L[y * W + xm]) / 2; gy[p] = (L[yp * W + x] - L[ym * W + x]) / 2;
  }
  return { gx, gy };
}

// Spectral residual (Hou and Zhang 2007) on a 64×64 luminance: the log amplitude spectrum minus
// its local average, transformed back with the original phase, squared and smoothed.
const N64 = 64, fft64 = new FFT(N64);
function fft2(re, im, inverse) {
  const row = fft64.createComplexArray(), out = fft64.createComplexArray();
  const pass = (get, set) => {
    for (let k = 0; k < N64; k++) {
      for (let i = 0; i < N64; i++) { const [r, m] = get(k, i); row[2 * i] = r; row[2 * i + 1] = m; }
      if (inverse) fft64.inverseTransform(out, row); else fft64.transform(out, row);
      for (let i = 0; i < N64; i++) set(k, i, out[2 * i], out[2 * i + 1]);
    }
  };
  pass((y, x) => [re[y * N64 + x], im[y * N64 + x]], (y, x, r, m) => { re[y * N64 + x] = r; im[y * N64 + x] = m; });
  pass((x, y) => [re[y * N64 + x], im[y * N64 + x]], (x, y, r, m) => { re[y * N64 + x] = r; im[y * N64 + x] = m; });
}
export function spectralMap(A) {
  const L = resize(A.L, A.W, A.H, N64, N64), re = Float32Array.from(L), im = new Float32Array(N64 * N64);
  fft2(re, im, false);
  // a floor of 2% of the strongest non-DC amplitude: the near-zeros of a small object's spectrum
  // would otherwise turn into large residuals and ring across the image
  let peak = 0; for (let i = 1; i < re.length; i++) peak = Math.max(peak, Math.hypot(re[i], im[i]));
  const eps = 0.02 * peak + 1e-9, logA = new Float32Array(N64 * N64), ph = new Float32Array(N64 * N64);
  for (let i = 0; i < logA.length; i++) { logA[i] = Math.log(Math.hypot(re[i], im[i]) + eps); ph[i] = Math.atan2(im[i], re[i]); }
  // 3×3 mean of the log spectrum, wrapping around: the spectrum is periodic (the DC term sits in a corner)
  const avg = new Float32Array(N64 * N64);
  for (let y = 0; y < N64; y++) for (let x = 0; x < N64; x++) {
    let t = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += logA[((y + dy + N64) % N64) * N64 + ((x + dx + N64) % N64)];
    avg[y * N64 + x] = t / 9;
  }
  for (let i = 0; i < logA.length; i++) { const r = Math.exp(logA[i] - avg[i]); re[i] = r * Math.cos(ph[i]); im[i] = r * Math.sin(ph[i]); }
  fft2(re, im, true);
  const s = new Float32Array(N64 * N64);
  for (let i = 0; i < s.length; i++) s[i] = re[i] * re[i] + im[i] * im[i];
  return borderFade(normalize(blur(resize(blur(s, N64, N64, 2), N64, N64, A.W, A.H), A.W, A.H, Math.min(A.W, A.H) / 60)), A.W, A.H);
}

// Per-pixel CIE Lab (D65) of the analysed image.
function labImage(img) {
  const n = img.width * img.height, Ls = new Float32Array(n), as = new Float32Array(n), bs = new Float32Array(n), d = img.data;
  for (let p = 0; p < n; p++) {
    const r = srgbToLin(d[p * 4] / 255), g = srgbToLin(d[p * 4 + 1] / 255), b = srgbToLin(d[p * 4 + 2] / 255);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const fx = labF(X), fy = labF(Y), fz = labF(Z);
    Ls[p] = 116 * fy - 16; as[p] = 500 * (fx - fy); bs[p] = 200 * (fy - fz);
  }
  return { Ls, as, bs };
}
// Frequency-tuned saliency (Achanta et al. 2009): distance of the slightly blurred Lab image
// from the mean Lab colour.
export function frequencyMap(A, img) {
  const { Ls, as, bs } = labImage(img), W = A.W, H = A.H, n = W * H;
  const mean = [0, 0, 0]; for (let p = 0; p < n; p++) { mean[0] += Ls[p]; mean[1] += as[p]; mean[2] += bs[p]; }
  mean.forEach((v, i) => (mean[i] = v / n));
  const bL = blur(Ls, W, H, 1), ba = blur(as, W, H, 1), bb = blur(bs, W, H, 1), map = new Float32Array(n);
  for (let p = 0; p < n; p++) map[p] = Math.hypot(bL[p] - mean[0], ba[p] - mean[1], bb[p] - mean[2]);
  return borderFade(normalize(blur(map, W, H, Math.min(W, H) / 80)), W, H);
}

// Itti-Koch-Niebur: centre-surround differences of intensity, colour opponency (red-green,
// blue-yellow) and four orientations, with the normalization that favours maps with few strong peaks.
export function ittiMap(A, img) {
  const W = A.W, H = A.H, n = W * H, d = img.data, k = Math.min(W, H) / 100;
  const I = new Float32Array(n), RG = new Float32Array(n), BY = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const r = d[p * 4] / 255, g = d[p * 4 + 1] / 255, b = d[p * 4 + 2] / 255, i = (r + g + b) / 3, s = Math.max(i, 0.1);
    I[p] = i; RG[p] = (r - g) / s; BY[p] = (b - (r + g) / 2) / s;
  }
  const { gx, gy } = gradients(A.L, W, H), O = [0, 1, 2, 3].map(() => new Float32Array(n));
  for (let p = 0; p < n; p++) { O[0][p] = Math.abs(gx[p]); O[1][p] = Math.abs(gy[p]); O[2][p] = Math.abs(gx[p] + gy[p]) / Math.SQRT2; O[3][p] = Math.abs(gx[p] - gy[p]) / Math.SQRT2; }
  const N = m => { normalize(m); let mean = 0; for (const v of m) mean += v; mean /= m.length; const f = (1 - mean) ** 2; for (let i = 0; i < m.length; i++) m[i] *= f; return m; };
  const cs = F => {
    const out = new Float32Array(n);
    for (const c of [1, 2]) for (const s of [3, 4]) {
      const a = blur(F, W, H, c * k * 1.5), b = blur(F, W, H, c * s * k * 1.5);
      for (let p = 0; p < n; p++) out[p] += Math.abs(a[p] - b[p]);
    }
    return N(out);
  };
  const sum = (...ms) => { const o = new Float32Array(n); for (const m of ms) for (let p = 0; p < n; p++) o[p] += m[p]; return o; };
  const map = sum(N(cs(I)), N(sum(cs(RG), cs(BY))), N(sum(...O.map(cs))));
  return borderFade(normalize(blur(map, W, H, Math.min(W, H) / 50)), W, H);
}

// Details: difference-of-Gaussians blobs at three scales plus Harris corners, no centre prior.
export function detailsMap(A) {
  const W = A.W, H = A.H, n = W * H, L = A.L, k = Math.max(1, Math.min(W, H) / 100);
  const dog = new Float32Array(n), g = [1, 2.5, 6, 14].map(r => blur(L, W, H, r * k));
  for (let s = 0; s < 3; s++) for (let p = 0; p < n; p++) dog[p] += Math.abs(g[s][p] - g[s + 1][p]) * (s === 0 ? 0.6 : 1);
  const { gx, gy } = gradients(L, W, H), xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
  for (let p = 0; p < n; p++) { xx[p] = gx[p] * gx[p]; yy[p] = gy[p] * gy[p]; xy[p] = gx[p] * gy[p]; }
  const bxx = blur(xx, W, H, 1.5 * k), byy = blur(yy, W, H, 1.5 * k), bxy = blur(xy, W, H, 1.5 * k), harris = new Float32Array(n);
  for (let p = 0; p < n; p++) harris[p] = Math.max(0, bxx[p] * byy[p] - bxy[p] * bxy[p] - 0.05 * (bxx[p] + byy[p]) ** 2);
  normalize(dog); normalize(harris);
  const map = new Float32Array(n);
  for (let p = 0; p < n; p++) map[p] = 0.6 * dog[p] + 0.4 * Math.sqrt(harris[p]);
  return borderFade(normalize(blur(map, W, H, k)), W, H, 0.4, 0.04);
}

// Composition: rule-of-thirds intersections and the horizon (the row with the strongest
// horizontal edges in the middle 70%), weighted by what is visible there (region contrast).
export function compositionMap(A, base) {
  const W = A.W, H = A.H, n = W * H, diag = Math.hypot(W, H), sig = 0.12 * diag;
  const { gy } = gradients(A.L, W, H);
  let hRow = Math.round(H / 2), best = -1;
  for (let y = Math.round(0.15 * H); y < Math.round(0.85 * H); y++) { let s = 0; for (let x = 0; x < W; x++) s += Math.abs(gy[y * W + x]); if (s > best) { best = s; hRow = y; } }
  const map = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = 0;
    for (const fx of [1 / 3, 2 / 3]) for (const fy of [1 / 3, 2 / 3]) t = Math.max(t, Math.exp(-((x - fx * W) ** 2 + (y - fy * H) ** 2) / (2 * sig * sig)));
    const hz = Math.exp(-((y - hRow) ** 2) / (2 * (0.05 * H) ** 2));
    map[y * W + x] = (0.6 * t + 0.4 * hz) * (0.35 + 0.65 * base[y * W + x]);
  }
  return normalize(map);
}

// Mean of a map per SLIC region (the region saliency used by the inspector and the pad).
export function regionMeans(A, map) {
  const s = new Float32Array(A.regions.length), c = new Float32Array(A.regions.length);
  for (let p = 0; p < map.length; p++) { s[A.labels[p]] += map[p]; c[A.labels[p]]++; }
  for (let i = 0; i < s.length; i++) s[i] = c[i] ? s[i] / c[i] : 0;
  return normalize(s);
}

// Attention map of a classic method; base: the region-contrast map.
export function attentionMap(method, A, img, base) {
  switch (method) {
    case "spectral": return spectralMap(A);
    case "frequency": return frequencyMap(A, img);
    case "itti": return ittiMap(A, img);
    case "details": return detailsMap(A);
    case "composition": return compositionMap(A, base);
    default: return base;
  }
}

// Scan: a left-to-right sweep, one point per column band at the height where the map is
// highest in that band. Returns raw points in the format of gazePath (focus.js).
export function scanPath(A, map, count, radius, newId) {
  const W = A.W, H = A.H, out = [];
  for (let k = 0; k < count; k++) {
    const x0 = Math.floor((k * W) / count), x1 = Math.max(x0 + 1, Math.floor(((k + 1) * W) / count));
    let by = 0, bv = -1;
    for (let y = 0; y < H; y++) { let s = 0; for (let x = x0; x < x1; x++) s += map[y * W + x]; if (s > bv) { bv = s; by = y; } }
    const bx = Math.floor((x0 + x1) / 2), p = by * W + bx;
    out.push({ id: newId(), x: (bx + 0.5) / W, y: (by + 0.5) / H, r: radius, w: map[p], s: map[p], region: A.labels[p], source: "auto", revisitOf: null, index: k });
  }
  return out;
}
