// Shared test helpers.
import { mulberry32 } from "../src/core/util.js";

// Deterministic synthetic images: gradient, rectangles, bright disc, noise.
export function synthImage(W, H, seed) {
  const rnd = mulberry32(seed), data = new Uint8ClampedArray(W * H * 4);
  const rects = Array.from({ length: 5 }, () => [rnd() * W, rnd() * H, 10 + rnd() * W * 0.3, 10 + rnd() * H * 0.3, [rnd() * 255, rnd() * 255, rnd() * 255]]);
  const cx = W * (0.3 + 0.4 * rnd()), cy = H * (0.3 + 0.4 * rnd()), cr = Math.min(W, H) * 0.12;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 40 + 150 * (y / H), g = 60 + 80 * (x / W), b = 160 - 100 * (y / H);
    for (const [rx, ry, rw, rh, c] of rects) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) [r, g, b] = c;
    if ((x - cx) ** 2 + (y - cy) ** 2 < cr * cr) [r, g, b] = [255, 240, 200];
    const n = (rnd() - 0.5) * 30, i = 4 * (y * W + x);
    data[i] = r + n; data[i + 1] = g + n; data[i + 2] = b + n; data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}
