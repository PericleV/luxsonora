// Numeric utilities, seeded PRNG, hash, box blur, entropy, colour conversions.
// Ported from the original prototype (legacy/prototype-core.js); logic unchanged.
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const clampInt = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashBytes(u8) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < u8.length; i += 3) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
export const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const labF = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function boxBlur(src, W, H, r, passes) {
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
export function entropyOf(hist, total) {
  let e = 0;
  for (const c of hist) if (c > 0) { const p = c / total; e -= p * Math.log2(p); }
  return e;
}
