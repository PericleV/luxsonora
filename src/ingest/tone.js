// Analysis source: turns a working image (linear light for photos, raw units for
// measurement data) into the 8-bit image that the analysis sees and the stage shows.
//
// Order of operations, per pixel:
//   1. normalize   photo: already linear 0..1; data: (v − lo) / (hi − lo), clamped
//   2. channels    colour (unchanged), greyscale (Rec. 709 luminance), or a custom R/G/B mix
//   3. encode      photo: sRGB transfer curve; data: identity (shown as measured)
//   4. invert      e → 1 − e
//   5. contrast    e → (e − ½)·(1 + contrast) + ½ + brightness/2
//   6. gamma       e → e^(1/γ)
//   7. quantize    8 bits
// Resampling always happens before these steps, on the working values, so averaging is
// done in linear light (photos) or in physical units (data), never on encoded values.

export const DEFAULT_SOURCE = {
  channels: "color", wr: 1, wg: 1, wb: 1, invert: false,
  range: "auto", lo: 0.5, hi: 99.5, brightness: 0, contrast: 0, gamma: 1,
  crop: { l: 0, t: 0, r: 0, b: 0 }
};

export const srgbToLinear = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const linearToSrgb = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export const LIN8 = (() => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255); return t; })();
const ENC_N = 4096;
const ENC = (() => { const t = new Float32Array(ENC_N + 1); for (let i = 0; i <= ENC_N; i++) t[i] = linearToSrgb(i / ENC_N); return t; })();
const encode = v => { const x = v <= 0 ? 0 : v >= 1 ? ENC_N : v * ENC_N, i = x | 0, f = x - i; return i >= ENC_N ? ENC[ENC_N] : ENC[i] + (ENC[i + 1] - ENC[i]) * f; };

// Minimum, maximum and percentiles of all channel values (4096-bin histogram).
export function stats(data, ch, pLo, pHi) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
  if (!isFinite(mn)) { mn = 0; mx = 1; }
  const B = 4096, hist = new Float64Array(B), span = mx - mn || 1;
  let n = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v === v) { hist[Math.min(B - 1, ((v - mn) / span) * B) | 0]++; n++; } }
  const q = p => { const target = (p / 100) * n; let c = 0; for (let k = 0; k < B; k++) { c += hist[k]; if (c >= target) return mn + ((k + 0.5) / B) * span; } return mx; };
  return { min: mn, max: mx, lo: q(pLo), hi: q(pHi) };
}

// Range used to normalize measurement data.
export function dataRange(info, st, src) {
  const mode = src.range === "auto" ? (info.bits <= 8 && info.sampleFormat !== 3 ? "full" : "percentile") : src.range;
  if (mode === "full") return { mode, lo: info.sampleFormat === 2 ? -(2 ** (info.bits - 1)) : 0, hi: info.sampleFormat === 3 ? 1 : info.sampleFormat === 2 ? 2 ** (info.bits - 1) - 1 : 2 ** info.bits - 1 };
  if (mode === "minmax") return { mode, lo: st.min, hi: st.max };
  return { mode: "percentile", lo: st.lo, hi: st.hi };
}

// Processes an interleaved working image into RGBA bytes.
export function processImage(data, w, h, ch, kind, range, src) {
  const out = new Uint8ClampedArray(w * h * 4), photo = kind === "photo";
  const lo = range ? range.lo : 0, inv = range ? 1 / ((range.hi - range.lo) || 1) : 1;
  const k = 1 + src.contrast, bOff = 0.5 + src.brightness * 0.5, g = 1 / src.gamma;
  const ws = src.wr + src.wg + src.wb || 1, mixW = [src.wr / ws, src.wg / ws, src.wb / ws];
  const gray = src.channels !== "color" || ch === 1;
  const tone = e => {
    if (src.invert) e = 1 - e;
    e = (e - 0.5) * k + bOff;
    if (e <= 0) return 0;
    if (e >= 1) return 255;
    return Math.round((g === 1 ? e : Math.pow(e, g)) * 255);
  };
  const norm = v => { const x = photo ? v : (v - lo) * inv; return x < 0 ? 0 : x > 1 ? 1 : x; };
  for (let p = 0; p < w * h; p++) {
    const o = p * 4, i = p * ch;
    if (ch === 1) {
      const e = photo ? encode(norm(data[i])) : norm(data[i]), v = tone(e);
      out[o] = out[o + 1] = out[o + 2] = v;
    } else if (gray) {
      const r = norm(data[i]), gg = norm(data[i + 1]), b = norm(data[i + 2]);
      const y = src.channels === "mix" ? mixW[0] * r + mixW[1] * gg + mixW[2] * b : 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const v = tone(photo ? encode(y) : y);
      out[o] = out[o + 1] = out[o + 2] = v;
    } else {
      for (let c = 0; c < 3; c++) { const x = norm(data[i + c]); out[o + c] = tone(photo ? encode(x) : x); }
    }
    out[o + 3] = 255;
  }
  return out;
}

export const isDefaultTone = src => !src.invert && src.channels === "color" && src.brightness === 0 && src.contrast === 0 && src.gamma === 1;
