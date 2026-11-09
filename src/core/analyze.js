// Image analysis: luminance, HSV, Lab, Sobel edges, regions, global features.
// Ported from the original prototype (legacy/prototype-core.js); logic unchanged.
import { clamp, clampInt, lerp, mulberry32, hashBytes, srgbToLin, labF, boxBlur, entropyOf } from "./util.js";
import { relabel, slic } from "./slic.js";

export function analyze(img) {
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
