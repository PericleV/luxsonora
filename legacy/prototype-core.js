// The pure part of the original prototype (sonificare.html, in the git history before November 2026):
// the analysis, saliency, gaze path, motifs, the first composer, MIDI and WAV, and the validation of
// the old semantic answer. Kept only as the reference for test/equivalence.test.js; the app does not use it.
/* eslint-disable */
/* ============ utilitare ============ */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const clampInt = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashBytes(u8) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < u8.length; i += 3) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const labF = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function boxBlur(src, W, H, r, passes) {
  let a = Float32Array.from(src);
  const b = new Float32Array(W * H), k = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const row = y * W; let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + clampInt(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        b[row + x] = acc / k;
        acc += a[row + clampInt(x + r + 1, 0, W - 1)] - a[row + clampInt(x - r, 0, W - 1)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clampInt(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / k;
        acc += b[clampInt(y + r + 1, 0, H - 1) * W + x] - b[clampInt(y - r, 0, H - 1) * W + x];
      }
    }
  }
  return a;
}
function entropyOf(hist, total) {
  let e = 0;
  for (const c of hist) if (c > 0) { const p = c / total; e -= p * Math.log2(p); }
  return e;
}

/* ============ superpixeli SLIC ============ */
function relabel(lab, N) {
  const map = new Map(), out = new Int32Array(N); let r = 0;
  for (let i = 0; i < N; i++) {
    let v = map.get(lab[i]);
    if (v === undefined) { v = r++; map.set(lab[i], v); }
    out[i] = v;
  }
  return { labels: out, count: r };
}
function slic(La, Aa, Bb, W, H, K, m, iters) {
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

/* ============ analiza imaginii ============ */
function analyze(img) {
  const W = img.width, H = img.height, N = W * H, d = img.data;
  const L = new Float32Array(N), La = new Float32Array(N), Aa = new Float32Array(N), Bb = new Float32Array(N);
  const Hue = new Float32Array(N), Sat = new Float32Array(N), Rr = new Float32Array(N), Bl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = d[4 * i] / 255, g = d[4 * i + 1] / 255, b = d[4 * i + 2] / 255;
    Rr[i] = r; Bl[i] = b;
    L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn; let h = 0;
    if (dd > 1e-6) {
      if (mx === r) h = ((g - b) / dd) % 6; else if (mx === g) h = (b - r) / dd + 2; else h = (r - g) / dd + 4;
      h *= 60; if (h < 0) h += 360;
    }
    Hue[i] = h; Sat[i] = mx > 0 ? dd / mx : 0;
    const rl = srgbToLin(r), gl = srgbToLin(g), bl = srgbToLin(b);
    const fx = labF((rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047);
    const fy = labF(rl * 0.2126 + gl * 0.7152 + bl * 0.0722);
    const fz = labF((rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883);
    La[i] = 116 * fy - 16; Aa[i] = 500 * (fx - fy); Bb[i] = 200 * (fy - fz);
  }
  // muchii (Sobel)
  const mag = new Float32Array(N), ori = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = -L[i - W - 1] - 2 * L[i - 1] - L[i + W - 1] + L[i - W + 1] + 2 * L[i + 1] + L[i + W + 1];
    const gy = -L[i - W - 1] - 2 * L[i - W] - L[i - W + 1] + L[i + W - 1] + 2 * L[i + W] + L[i + W + 1];
    mag[i] = Math.hypot(gx, gy); ori[i] = Math.atan2(gy, gx);
  }
  const sorted = Float32Array.from(mag).sort();
  const p95 = Math.max(1e-3, sorted[Math.floor(N * 0.95)]);
  let mean = 0; for (let i = 0; i < N; i++) mean += mag[i]; mean /= N;
  let vv = 0; for (let i = 0; i < N; i++) vv += (mag[i] - mean) ** 2;
  const thr = Math.max(0.06, mean + 0.8 * Math.sqrt(vv / N));
  const edge = new Uint8Array(N); let eCount = 0;
  for (let i = 0; i < N; i++) if (mag[i] > thr) { edge[i] = 1; eCount++; }

  // regiuni
  const { labels, count } = slic(La, Aa, Bb, W, H, 64, 12, 8);
  const n = new Float64Array(count), sx = new Float64Array(count), sy = new Float64Array(count);
  const sL = new Float64Array(count), sL2 = new Float64Array(count), sLa = new Float64Array(count), sAa = new Float64Array(count), sBb = new Float64Array(count);
  const sR = new Float64Array(count), sBl = new Float64Array(count), sS = new Float64Array(count), hx = new Float64Array(count), hy = new Float64Array(count);
  const sE = new Float64Array(count), sEM = new Float64Array(count), oh = new Float64Array(count * 4), hist = new Float64Array(count * 16);
  const gHist = new Float64Array(32); let gx = 0, gy = 0, gS = 0, gL = 0, gW = 0;
  for (let i = 0; i < N; i++) {
    const k = labels[i], x = i % W, y = (i / W) | 0;
    n[k]++; sx[k] += x; sy[k] += y; sL[k] += L[i]; sL2[k] += L[i] * L[i];
    sLa[k] += La[i]; sAa[k] += Aa[i]; sBb[k] += Bb[i]; sR[k] += Rr[i]; sBl[k] += Bl[i]; sS[k] += Sat[i];
    const hr = (Hue[i] * Math.PI) / 180, c = Math.cos(hr) * Sat[i], s = Math.sin(hr) * Sat[i];
    hx[k] += c; hy[k] += s; gx += c; gy += s;
    if (edge[i]) { sE[k]++; sEM[k] += mag[i]; }
    if (mag[i] > 0) { let a = ori[i]; if (a < 0) a += Math.PI; oh[k * 4 + Math.min(3, Math.floor(a / (Math.PI / 4)))] += mag[i]; }
    hist[k * 16 + Math.min(15, Math.floor(L[i] * 16))]++;
    gHist[Math.min(31, Math.floor(L[i] * 32))]++;
    gS += Sat[i]; gL += L[i]; gW += Rr[i] - Bl[i];
  }
  const regions = [];
  for (let k = 0; k < count; k++) {
    const nn = Math.max(1, n[k]), mL = sL[k] / nn;
    const o = [oh[k * 4], oh[k * 4 + 1], oh[k * 4 + 2], oh[k * 4 + 3]], os = o.reduce((a, b) => a + b, 0) || 1;
    let hue = (Math.atan2(hy[k], hx[k]) * 180) / Math.PI; if (hue < 0) hue += 360;
    regions.push({
      id: k, n: nn, area: nn / N, cx: (sx[k] / nn + 0.5) / W, cy: (sy[k] / nn + 0.5) / H,
      L: mL, varL: Math.max(0, sL2[k] / nn - mL * mL), lab: [sLa[k] / nn, sAa[k] / nn, sBb[k] / nn],
      sat: sS[k] / nn, hue, hueStr: Math.hypot(hx[k], hy[k]) / nn, warmth: (sR[k] - sBl[k]) / nn,
      edge: sE[k] / nn, sharp: sE[k] > 0 ? clamp(sEM[k] / sE[k] / p95 / 1.5) : 0,
      entropy: entropyOf(hist.subarray(k * 16, k * 16 + 16), nn) / 4, ori: o.map(v => v / os)
    });
  }
  let gHue = (Math.atan2(gy, gx) * 180) / Math.PI; if (gHue < 0) gHue += 360;
  const global = {
    brightness: gL / N, warmth01: clamp(0.5 + (gW / N) * 1.5), sat: gS / N, hue: gHue,
    hueStr: Math.hypot(gx, gy) / N, entropy: entropyOf(gHist, N) / 5, edge: eCount / N,
    edgeN: clamp(eCount / N / 0.25)
  };
  return { W, H, N, L, mag, p95, labels, regions, global, hash: hashBytes(d) };
}

/* ============ saliency ============ */
function computeSaliency(A, w, sem) {
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
    if (sem && sem.obiecte) for (const o of sem.obiecte) {
      if (rs[i].cx >= o.x && rs[i].cx <= o.x + o.w && rs[i].cy >= o.y && rs[i].cy <= o.y + o.h) obj[i] = Math.max(obj[i], clamp(o.importanta ?? 0.5));
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

/* ============ traseul privirii (Itti-Koch) ============ */
function scanpath(A, S0, p) {
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

/* ============ familii de motive (k-means pe regiuni) ============ */
function regionFeat(r) {
  const h = (r.hue * Math.PI) / 180;
  return [r.L, r.sat, Math.cos(h) * r.sat, Math.sin(h) * r.sat, r.edge * 2, r.entropy, Math.sqrt(r.varL) * 2];
}
function clusterRegions(A, k) {
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
const CONTOURS = [[0, 2, 4, 2], [0, 1, 2, 4], [0, 1, 0, -1], [0, -1, -2, 1]];
function buildMotifs(cl, regions) {
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

/* ============ teorie & stiluri ============ */
const NOTE_SH = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const NOTE_FL = ["Do", "Re♭", "Re", "Mi♭", "Mi", "Fa", "Sol♭", "Sol", "La♭", "La", "Si♭", "Si"];
let SPELL = NOTE_SH;
const setSpelling = tonicPc => { SPELL = [1, 3, 5, 8, 10].includes(tonicPc) ? NOTE_FL : NOTE_SH; };
const pcName = pc => SPELL[((pc % 12) + 12) % 12];
const midiName = m => pcName(m) + (Math.floor(m / 12) - 1);
const MODES = {
  frigic: { iv: [0, 1, 3, 5, 7, 8, 10], b: 1, name: "frigic" },
  eolian: { iv: [0, 2, 3, 5, 7, 8, 10], b: 2, name: "eolian (minor natural)" },
  doric: { iv: [0, 2, 3, 5, 7, 9, 10], b: 3, name: "doric" },
  mixolidic: { iv: [0, 2, 4, 5, 7, 9, 10], b: 4, name: "mixolidic" },
  ionian: { iv: [0, 2, 4, 5, 7, 9, 11], b: 5, name: "ionian (major)" },
  lidic: { iv: [0, 2, 4, 6, 7, 9, 11], b: 6, name: "lidic" }
};
const STYLES = {
  ambient: { name: "Ambient", modes: ["frigic", "eolian", "doric", "mixolidic", "ionian", "lidic"], tempo: [56, 82], pent: false, ext: 7, swing: 0, perc: "soft", bass: "hold", reverb: 0.6,
    tim: { a: 0.22, d: 0.6, s: 0.7, r: 1.4, cut: 1800, q: 1, saw: 0.25, det: 8 }, gm: { lead: 11, harm: 89, bass: 32, pad: 94 } },
  cinematic: { name: "Cinematic", modes: ["eolian", "doric", "ionian", "lidic"], tempo: [62, 96], pent: false, ext: 5, swing: 0, perc: "pulse", bass: "hold", reverb: 0.5,
    tim: { a: 0.12, d: 0.5, s: 0.8, r: 1.0, cut: 2400, q: 1.2, saw: 0.7, det: 12 }, gm: { lead: 40, harm: 48, bass: 43, pad: 52 } },
  minimal: { name: "Minimal", modes: ["eolian", "doric", "mixolidic", "ionian"], tempo: [84, 118], pent: true, ext: 5, swing: 0, perc: "soft", bass: "pulse", reverb: 0.35,
    tim: { a: 0.005, d: 0.25, s: 0.2, r: 0.35, cut: 3500, q: 2, saw: 0.3, det: 4 }, gm: { lead: 46, harm: 0, bass: 33, pad: 89 } },
  jazz: { name: "Jazz", modes: ["doric", "mixolidic", "ionian", "lidic"], tempo: [92, 138], pent: false, ext: 9, swing: 0.6, perc: "swing", bass: "walk", reverb: 0.3,
    tim: { a: 0.01, d: 0.4, s: 0.45, r: 0.4, cut: 2800, q: 0.8, saw: 0.2, det: 3 }, gm: { lead: 26, harm: 4, bass: 32, pad: 16 } },
  electronic: { name: "Electronic", modes: ["frigic", "eolian", "doric", "mixolidic"], tempo: [104, 126], pent: false, ext: 7, swing: 0, perc: "four", bass: "pulse", reverb: 0.3,
    tim: { a: 0.004, d: 0.2, s: 0.6, r: 0.2, cut: 2200, q: 6, saw: 0.9, det: 14 }, gm: { lead: 81, harm: 90, bass: 38, pad: 88 } }
};
const CAT = {
  viu: { a: 0.06, d: 0.3, s: 0.75, r: 0.5, saw: 0.15, det: 10 },
  natural: { a: 0.2, d: 0.6, s: 0.7, r: 1.2, saw: 0.25, det: 6 },
  artificial: { a: 0.005, d: 0.2, s: 0.4, r: 0.25, saw: 0.85, det: 3 }
};
function degMidi(deg, iv, base) {
  const n = iv.length, o = Math.floor(deg / n), k = ((deg % n) + n) % n;
  return base + 12 * o + iv[k];
}
function objectAt(sem, x, y) {
  if (!sem || !sem.obiecte) return null;
  let best = null;
  for (const o of sem.obiecte) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h && (!best || (o.importanta ?? 0) > (best.importanta ?? 0))) best = o;
  return best;
}
function timbreFor(r, st, k, maxE, obj, ws) {
  const b = st.tim, eN = clamp(r.edge / maxE), smooth = 1 - eN, sh = clamp(r.sharp), sd = Math.sqrt(r.varL);
  const im = {
    a: lerp(0.003, 0.35, clamp((1 - sh) * 0.7 + smooth * 0.3)), d: lerp(0.08, 0.8, clamp(sd * 3)),
    s: lerp(0.25, 0.9, smooth), r: lerp(0.06, 1.6, smooth), cut: 300 * Math.pow(2, clamp(r.entropy) * 5),
    q: 0.7 + clamp(r.sat) * 10, saw: clamp(0.5 + r.warmth * 1.5), det: clamp(r.sat) * 18
  };
  const t = {
    a: lerp(b.a, im.a, k), d: lerp(b.d, im.d, k), s: lerp(b.s, im.s, k), r: lerp(b.r, im.r, k),
    cut: Math.exp(lerp(Math.log(b.cut), Math.log(im.cut), k)), q: lerp(b.q, im.q, k), saw: lerp(b.saw, im.saw, k), det: lerp(b.det, im.det, k)
  };
  if (obj && CAT[obj.categorie] && ws > 0) { const c = CAT[obj.categorie], m = 0.5 * ws; for (const key of ["a", "d", "s", "r", "saw", "det"]) t[key] = lerp(t[key], c[key], m); }
  t.src = { eN, sh, smooth, ent: r.entropy, sat: r.sat, warm: r.warmth, sd };
  return t;
}
function avgRegion(list) {
  const tot = list.reduce((a, r) => a + r.area, 0) || 1, o = { edge: 0, sharp: 0, varL: 0, entropy: 0, sat: 0, warmth: 0, L: 0 };
  for (const r of list) for (const k in o) o[k] += r[k] * r.area / tot;
  return o;
}

/* ============ compoziția ============ */
function compose({ A, sal, fix, cl, motifs, P, sem }) {
  const st = STYLES[P.style], g = A.global, ws = sem ? P.wSem : 0;
  let val = 0.5 * g.brightness + 0.3 * g.warmth01 + 0.2 * g.sat;
  let energy = 0.6 * g.edgeN + 0.4 * g.entropy;
  if (sem) { val = lerp(val, clamp(sem.valenta), 0.6 * ws); energy = lerp(energy, clamp(sem.energie), 0.6 * ws); }
  const allowed = [...st.modes].sort((a, b) => MODES[a].b - MODES[b].b);
  const modeKey = allowed[Math.round(clamp(val) * (allowed.length - 1))], modeIv = MODES[modeKey].iv;
  const pc = g.hueStr > 0.06 ? ((Math.round(g.hue / 30) % 12) * 7) % 12 : (Math.round(g.brightness * 11) * 7) % 12;
  const pcOff = pc > 5 ? pc - 12 : pc;
  const bpm = Math.round(lerp(st.tempo[0], st.tempo[1], clamp(energy)) * (1 + P.tempoAdj));
  const major = modeIv[2] === 4;
  const melIv = st.pent ? (major ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10]) : modeIv, n = melIv.length;
  const baseLead = 60 + pcOff, maxE = Math.max(1e-4, ...A.regions.map(r => r.edge));
  const notes = [], fixOut = [], visits = new Map();
  let t = 0, prevDeg = null, prevChord = null;

  fix.forEach((f, idx) => {
    const r = A.regions[f.region], ci = cl.assign[f.region];
    let dur = 1 + 3 * f.s;
    const q = P.fidelity > 0.66 ? 0.5 : 1;
    dur = Math.max(q, Math.round(dur / q) * q);
    if (P.fidelity < 0.33) dur = Math.max(2, Math.round(dur / 2) * 2);
    const target = Math.round((1 - f.y) * 2 * n) - Math.round(n * 0.4);
    let deg, step = 0;
    if (prevDeg === null) deg = target;
    else {
      const pf = fix[idx - 1], dx = f.x - pf.x, dy = f.y - pf.y, len = Math.hypot(dx, dy);
      const dir = Math.abs(dy) > 0.02 ? -Math.sign(dy) : dx >= 0 ? 1 : -1;
      step = dir * Math.max(1, Math.round(len * n * 1.4));
      deg = Math.round(lerp(prevDeg + step, target, P.fidelity));
    }
    deg = clampInt(deg, -n, 2 * n + 1);

    const v = (visits.get(ci) ?? -1) + 1; visits.set(ci, v);
    const mo = motifs[ci]; let iv = mo.iv.slice(), w = mo.w.slice(), variant = "original";
    if (v > 0) {
      const vv = (v - 1) % 3;
      if (vv === 0) variant = "repetat";
      else if (vv === 1) { variant = "inversat"; iv = iv.map(x => -x); }
      else { variant = "retrograd"; const rv = iv.slice().reverse(); iv = rv.map(x => x - rv[0]); w = w.slice().reverse(); }
    }
    const maxNotes = Math.max(1, Math.floor(dur / 0.25));
    if (iv.length > maxNotes) { iv = iv.slice(0, maxNotes); w = w.slice(0, maxNotes); }
    const obj = sem ? objectAt(sem, f.x, f.y) : null;
    const tim = timbreFor(r, st, P.timbre, maxE, obj, ws);
    const vel = Math.round(52 + 68 * f.s), pan = clamp((f.x - 0.5) * 1.3, -0.8, 0.8);
    const tot = w.reduce((a, b) => a + b, 0); let tt = t; const lead = [];
    iv.forEach((o, j) => {
      const nd = (dur * w[j]) / tot, m = degMidi(deg + o, melIv, baseLead);
      notes.push({ layer: "lead", t: tt, dur: nd * 0.92, midi: m, vel: j === 0 ? vel : Math.round(vel * 0.85), tim, pan, fix: idx });
      lead.push(m); tt += nd;
    });

    // armonia
    const firstPc = (((lead[0] - baseLead) % 12) + 12) % 12, mdeg = modeIv.indexOf(firstPc);
    const cands = r.L > 0.5 ? [0, 3, 4] : [5, 1, 2];
    let root = cands.find(rt => mdeg >= 0 && [0, 2, 4].includes((((mdeg - rt) % 7) + 7) % 7));
    if (root === undefined) root = cands[ci % 3];
    const tones = [0, 2, 4];
    if (st.ext >= 7 || r.entropy > 0.78) tones.push(6);
    if (st.ext >= 9 || r.entropy > 0.9) tones.push(8);
    const center = prevChord ? prevChord.reduce((a, b) => a + b, 0) / prevChord.length : 60;
    let chord = tones.map(o => { let m = degMidi(root + o, modeIv, 48 + pcOff); while (m < center - 7) m += 12; while (m > center + 7) m -= 12; return m; });
    chord = [...new Set(chord)].sort((a, b) => a - b); prevChord = chord;
    const htim = { ...tim, a: Math.max(tim.a, 0.03), s: Math.max(tim.s, 0.5) };
    chord.forEach(m => notes.push({ layer: "harm", t, dur: dur * 0.98, midi: m, vel: Math.round(40 + 30 * r.entropy), tim: htim, pan: pan * 0.4, fix: idx }));

    // basul
    let bm = degMidi(root, modeIv, 36 + pcOff); while (bm < 33) bm += 12; while (bm > 47) bm -= 12;
    const eN = clamp(r.edge / maxE);
    const btim = { a: 0.008, d: 0.3, s: 0.7, r: 0.15, cut: 600 + 900 * eN, q: 1.5, saw: 0.6, det: 2 };
    if (st.bass === "hold") notes.push({ layer: "bass", t, dur: dur * 0.97, midi: bm, vel: 80, tim: btim, pan: 0, fix: idx });
    else if (st.bass === "pulse") {
      const sub = eN > 0.6 ? 0.5 : eN > 0.3 ? 1 : 2;
      for (let b = 0; b < dur - 1e-6; b += sub) notes.push({ layer: "bass", t: t + b, dur: Math.min(sub, dur - b) * 0.8, midi: bm, vel: b === 0 ? 88 : 70, tim: btim, pan: 0, fix: idx });
    } else {
      const walk = [0, 2, 4, 5];
      for (let b = 0, j = 0; b < dur - 1e-6; b += 1, j++) {
        let m = degMidi(root + walk[j % 4], modeIv, 36 + pcOff); while (m < bm - 2) m += 12; while (m > bm + 10) m -= 12;
        notes.push({ layer: "bass", t: t + b, dur: Math.min(1, dur - b) * 0.85, midi: m, vel: j % 2 ? 68 : 82, tim: btim, pan: 0, fix: idx });
      }
    }

    // ritmul din textură
    const sub = eN > 0.75 ? 0.25 : eN > 0.45 ? 0.5 : eN > 0.2 ? 1 : 0;
    const pv = Math.round(36 + 50 * clamp(Math.sqrt(r.varL) * 3));
    if ((st.perc === "soft" || st.perc === "pulse") && sub > 0)
      for (let b = 0; b < dur - 1e-6; b += sub) notes.push({ layer: "perc", t: t + b, dur: 0.05, midi: 42, vel: Math.round((st.perc === "soft" ? 0.6 : 1) * pv * (b % 1 === 0 ? 1 : 0.75)), fix: idx });
    if (st.perc === "pulse") notes.push({ layer: "perc", t, dur: 0.1, midi: 36, vel: Math.round(60 + 50 * f.s), fix: idx });

    fixOut.push({ ...f, idx, t0: t, t1: t + dur, dur, deg, step, cluster: ci, letter: mo.letter, visit: v, variant, root, chord, bass: bm, lead, tim, pan, obj, regionSal: sal.region[f.region], reg: r, vel, sub });
    prevDeg = deg; t += dur;
  });
  const total = Math.max(1, t);

  if (fixOut.length && (st.perc === "four" || st.perc === "swing")) {
    for (let b = 0; b < total - 1e-6; b += 1) {
      const fo = fixOut.find(F => b >= F.t0 && b < F.t1) || fixOut[fixOut.length - 1];
      const eN = clamp(fo.reg.edge / maxE);
      if (st.perc === "four") {
        notes.push({ layer: "perc", t: b, dur: 0.1, midi: 36, vel: 96, fix: fo.idx });
        if (eN > 0.2) notes.push({ layer: "perc", t: b + 0.5, dur: 0.05, midi: 42, vel: Math.round(50 + 40 * eN), fix: fo.idx });
        if (eN > 0.6) { notes.push({ layer: "perc", t: b + 0.25, dur: 0.05, midi: 42, vel: 44, fix: fo.idx }); notes.push({ layer: "perc", t: b + 0.75, dur: 0.05, midi: 42, vel: 44, fix: fo.idx }); }
      } else {
        notes.push({ layer: "perc", t: b, dur: 0.2, midi: 51, vel: 62, fix: fo.idx });
        if (b % 2 === 1) { notes.push({ layer: "perc", t: b + 0.5, dur: 0.15, midi: 51, vel: 48, fix: fo.idx }); notes.push({ layer: "perc", t: b, dur: 0.05, midi: 44, vel: 55, fix: fo.idx }); }
      }
    }
  }
  if (st.swing > 0) for (const nn of notes) if ((nn.layer === "lead" || nn.layer === "perc") && Math.abs((nn.t % 1) - 0.5) < 1e-6) nn.t += st.swing * 0.17;

  // pad-ul din fundal
  const bgList = A.regions.filter((r, i) => sal.region[i] < 0.35), bgArea = bgList.reduce((a, r) => a + r.area, 0);
  const ptim = timbreFor(avgRegion(bgList.length ? bgList : A.regions), st, P.timbre, maxE, null, 0);
  ptim.a = Math.max(ptim.a, 0.8); ptim.r = Math.max(ptim.r, 1.5); ptim.s = Math.max(ptim.s, 0.7);
  const padDegs = g.brightness > 0.5 ? [0, 4, 8] : [0, 4], pv = Math.round(30 + 50 * clamp(bgArea * 1.4));
  for (let b = 0; b < total - 1e-6; b += 8) {
    const dd = Math.min(8, total - b);
    padDegs.forEach(o => notes.push({ layer: "pad", t: b, dur: dd, midi: degMidi(o, modeIv, 48 + pcOff), vel: pv, tim: ptim, pan: 0, fix: -1 }));
  }
  notes.sort((a, b) => a.t - b.t);
  return { bpm, total, pc, pcOff, modeKey, modeIv, melIv, major, val, energy, notes, fix: fixOut, bgArea, ptim, style: P.style, motifCount: motifs.length };
}
function romanOf(root, modeIv) {
  const R = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const iv = d => degMidi(d, modeIv, 0);
  const third = iv(root + 2) - iv(root), fifth = iv(root + 4) - iv(root);
  const s = R[root % 7];
  if (third === 4) return s;
  if (fifth === 6) return s.toLowerCase() + "°";
  return s.toLowerCase();
}

/* ============ MIDI ============ */
function vlq(n) { const out = [n & 0x7f]; n >>= 7; while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; } return out; }
const LAYER_DEF = [
  { key: "lead", ch: 0, name: "Melodie" }, { key: "harm", ch: 1, name: "Armonie" }, { key: "bass", ch: 2, name: "Bas" },
  { key: "pad", ch: 3, name: "Pad" }, { key: "perc", ch: 9, name: "Ritm" }
];
function midiFile(sc, layersOn) {
  const PPQ = 480, st = STYLES[sc.style], tick = b => Math.max(0, Math.round(b * PPQ));
  const str = s => [...s].map(c => c.charCodeAt(0) & 0x7f);
  const meta = (type, bytes) => [0xff, type, ...vlq(bytes.length), ...bytes];
  const ser = evts => {
    evts.sort((a, b) => a.t - b.t || a.o - b.o);
    const out = []; let last = 0;
    for (const e of evts) { out.push(...vlq(e.t - last), ...e.b); last = e.t; }
    out.push(0, 0xff, 0x2f, 0); return out;
  };
  const us = Math.round(60000000 / sc.bpm);
  const tracks = [ser([
    { t: 0, o: 0, b: meta(0x03, str("Sonificare")) },
    { t: 0, o: 0, b: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { t: 0, o: 0, b: meta(0x58, [4, 2, 24, 8]) }
  ])];
  const c7 = v => clampInt(Math.round(v * 127), 0, 127);
  for (const L of LAYER_DEF) {
    if (!layersOn[L.key]) continue;
    const ch = L.ch, ev = [{ t: 0, o: 0, b: meta(0x03, str(L.name)) }];
    if (ch !== 9) ev.push({ t: 0, o: 1, b: [0xc0 | ch, st.gm[L.key]] });
    ev.push({ t: 0, o: 1, b: [0xb0 | ch, 7, 100] });
    if (L.key === "lead" || L.key === "harm") for (const F of sc.fix) {
      const T = F.tim, tt = tick(F.t0);
      ev.push({ t: tt, o: 1, b: [0xb0 | ch, 73, c7(Math.sqrt(clamp(T.a)))] });
      ev.push({ t: tt, o: 1, b: [0xb0 | ch, 75, c7(Math.sqrt(clamp(T.d / 1.5)))] });
      ev.push({ t: tt, o: 1, b: [0xb0 | ch, 72, c7(Math.sqrt(clamp(T.r / 2)))] });
      ev.push({ t: tt, o: 1, b: [0xb0 | ch, 74, c7(clamp(Math.log2(T.cut / 300) / 5.5))] });
      ev.push({ t: tt, o: 1, b: [0xb0 | ch, 71, c7(clamp(T.q / 12))] });
      ev.push({ t: tt, o: 1, b: [0xb0 | ch, 10, c7(0.5 + F.pan / 2 * (L.key === "lead" ? 1 : 0.4))] });
    }
    for (const nn of sc.notes) if (nn.layer === L.key) {
      const on = tick(nn.t), off = Math.max(on + 1, tick(nn.t + nn.dur));
      ev.push({ t: on, o: 2, b: [0x90 | ch, nn.midi & 127, clampInt(nn.vel, 1, 127)] });
      ev.push({ t: off, o: 0, b: [0x80 | ch, nn.midi & 127, 0] });
    }
    tracks.push(ser(ev));
  }
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, PPQ >> 8, PPQ & 255];
  for (const tr of tracks) { const l = tr.length; out.push(0x4d, 0x54, 0x72, 0x6b, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255, ...tr); }
  return new Uint8Array(out);
}

/* ============ ZIP (stocare) & WAV ============ */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const DT = 0, DD = ((2026 - 1980) << 9) | (11 << 5) | 6;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, DT, true); lh.setUint16(12, DD, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, DT, true); ch.setUint16(14, DD, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + sz;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
function wavFromChannels(chs, sr) {
  const nc = chs.length, len = chs[0].length;
  let peak = 0; for (const c of chs) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(c[i]));
  const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1;
  const dv = new DataView(new ArrayBuffer(44 + len * nc * 2));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + len * nc * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, len * nc * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) { dv.setInt16(o, Math.round(clamp(chs[c][i] * gain, -1, 1) * 32767), true); o += 2; }
  return new Uint8Array(dv.buffer);
}
function validateSem(o) {
  if (!o || typeof o !== "object") return null;
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? clamp(v) : d);
  const atm = Array.isArray(o.atmosfera) ? o.atmosfera.filter(a => a && typeof a.eticheta === "string").slice(0, 4).map(a => ({ eticheta: a.eticheta.slice(0, 30), scor: num(a.scor, 0.5) })) : [];
  const obj = Array.isArray(o.obiecte) ? o.obiecte.filter(b => b && typeof b.nume === "string" && [b.x, b.y, b.w, b.h].every(v => typeof v === "number" && isFinite(v))).slice(0, 8)
    .map(b => ({ nume: b.nume.slice(0, 30), categorie: CAT[b.categorie] ? b.categorie : "natural", x: clamp(b.x), y: clamp(b.y), w: clamp(b.w, 0.01, 1), h: clamp(b.h, 0.01, 1), importanta: num(b.importanta, 0.5) })) : [];
  return { atmosfera: atm, valenta: num(o.valenta, 0.5), energie: num(o.energie, 0.5), obiecte: obj };
}
