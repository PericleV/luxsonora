// What the analysis sees, measure by measure (the stage's Measures view): each measure as a map of
// the picture (0-1 per pixel of the analysis), its value under the pointer, and what the music
// does with it. They are the same readings the composer uses, so the view cannot drift from it:
//   texture     the detail of each region (the entropy of its brightness)
//   lines       the direction of the edges (drawn as a colour per direction, bright where strong)
//   depth       sharp (near) or soft (far): the mean absolute Laplacian against the picture's own
//               10th and 90th percentiles
//   pattern     repetition: the strongest autocorrelation along a row or a column round each place
//   sat         saturation of each region
//   warmth      warm (red, orange) or cool (blue) colour of each region
//   contrast    complementary colours side by side round each place
//   grain       fine grain: the difference between a pixel and its neighbours, against the picture
import { clamp, boxBlur } from "./util.js";
import { enrichAt, enrichBase, linesWord } from "./enrich.js";

export const MEASURES = {
  texture: { name: "Texture", low: "smooth", high: "busy", does: "Busy areas give more notes, faster figures and plucked sounds; with the edges, the picture's detail sets the tempo and the groove." },
  lines: { name: "Lines", low: "none", high: "strong", does: "With Enriched: vertical lines play short notes, horizontal ones legato, diagonals arpeggios. Colour: the direction (horizontal red, vertical cyan)." },
  depth: { name: "Depth", low: "near (sharp)", high: "far (soft)", does: "With Enriched: far, soft-focus places sound further away and darker, sharp ones closer and brighter." },
  pattern: { name: "Repetition", low: "none", high: "repeating", does: "With Enriched: a place that repeats keeps its motif as it is and its accompaniment broken." },
  sat: { name: "Saturation", low: "grey", high: "vivid", does: "Part of the mood (with the brightness and the warmth): it leans the mode and the chords toward the brighter ones." },
  warmth: { name: "Warmth", low: "cool", high: "warm", does: "Part of the mood: warm colours lean toward brighter modes and chords, and warm the timbre of each place." },
  contrast: { name: "Colour contrast", low: "one colour", high: "opposite colours", does: "With Enriched: opposite colours side by side bring a suspension in the harmony that resolves." },
  grain: { name: "Grain", low: "clean", high: "grainy", does: "With Enriched: where the picture is grainy, the hi-hat turns into a soft shaker." }
};
export const MEASURE_KEYS = Object.keys(MEASURES);

// the grid the measures read round each place on (cells of about 6% of the picture)
const GRID = 18;
function gridOf(A, f) {
  const cols = GRID, rows = Math.max(4, Math.round((GRID * A.H) / A.W)), v = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = f((i + 0.5) / cols, (j + 0.5) / rows);
  return { cols, rows, v };
}
// a grid read at every pixel, by bilinear interpolation between the cell centres
function fromGrid(A, g) {
  const out = new Float32Array(A.N);
  for (let y = 0; y < A.H; y++) {
    const fy = Math.max(0, Math.min(g.rows - 1, ((y + 0.5) / A.H) * g.rows - 0.5)), j0 = Math.floor(fy), j1 = Math.min(g.rows - 1, j0 + 1), ty = fy - j0;
    for (let x = 0; x < A.W; x++) {
      const fx = Math.max(0, Math.min(g.cols - 1, ((x + 0.5) / A.W) * g.cols - 0.5)), i0 = Math.floor(fx), i1 = Math.min(g.cols - 1, i0 + 1), tx = fx - i0;
      const a = g.v[j0 * g.cols + i0], b = g.v[j0 * g.cols + i1], c = g.v[j1 * g.cols + i0], d = g.v[j1 * g.cols + i1];
      out[y * A.W + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}
const regionMap = (A, f) => { const out = new Float32Array(A.N), byId = A.regions.map(f); for (let p = 0; p < A.N; p++) out[p] = byId[A.labels[p]] ?? 0; return out; };
// warmth of a region, 0 (cool) to 1 (warm), on the scale of the picture's own warmth
const warm01 = g => clamp(0.5 + (g.warmth ?? 0) * 1.5);

/*
 * The map of one measure (0-1 per pixel of the analysis), kept with the analysis. For lines it is
 * the strength; measureAngles gives the direction.
 */
export function measureMap(A, key) {
  const cache = A._measures || Object.defineProperty(A, "_measures", { value: {}, enumerable: false })._measures;
  if (cache[key]) return cache[key];
  const { W, H, N, L } = A;
  let m;
  if (key === "texture") m = regionMap(A, g => clamp((g.entropy ?? 0.5) * 1.1));
  else if (key === "sat") m = regionMap(A, g => clamp(g.sat ?? 0));
  else if (key === "warmth") m = regionMap(A, warm01);
  else if (key === "lines") { m = new Float32Array(N); for (let p = 0; p < N; p++) m[p] = clamp(A.mag[p] / A.p95); }
  else if (key === "depth" || key === "grain") {
    const raw = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, c = L[p], l = L[p - 1], r = L[p + 1], u = L[p - W], d = L[p + W];
      raw[p] = key === "depth" ? Math.abs(4 * c - l - r - u - d) : Math.abs(c - (l + r + u + d + c) / 5);
    }
    const sm = boxBlur(raw, W, H, 3, 2), base = enrichBase(A), [lo, hi] = key === "depth" ? base.sharp : base.grain;
    m = new Float32Array(N);
    for (let p = 0; p < N; p++) { const v = clamp((sm[p] - lo) / Math.max(1e-6, hi - lo)); m[p] = key === "depth" ? 1 - v : v; }
  } else if (key === "pattern" || key === "contrast") {
    m = fromGrid(A, gridOf(A, (x, y) => { const e = enrichAt(A, x, y, 0.05); return key === "pattern" ? e.pattern : e.contrast; }));
  } else throw new Error("unknown measure " + key);
  cache[key] = m;
  return m;
}
// the direction of the lines at each pixel, 0 (horizontal) to 1 (back to horizontal, vertical at 0.5)
export function measureAngles(A) {
  const { W, H, N, L } = A, out = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    const gx = L[p - W + 1] + 2 * L[p + 1] + L[p + W + 1] - L[p - W - 1] - 2 * L[p - 1] - L[p + W - 1];
    const gy = L[p + W - 1] + 2 * L[p + W] + L[p + W + 1] - L[p - W - 1] - 2 * L[p - W] - L[p - W + 1];
    let a = Math.atan2(gy, gx) + Math.PI / 2; a = ((a % Math.PI) + Math.PI) % Math.PI;
    out[p] = a / Math.PI;
  }
  return out;
}

/*
 * Every measure at a point (x, y in 0-1): { texture, lines, linesWord, angle (degrees), depth,
 * pattern, sat, warmth, contrast, grain, light (brightness) }, each 0-1 but the angle.
 */
export function measuresAt(A, x, y) {
  const px = Math.max(0, Math.min(A.W - 1, Math.floor(x * A.W))), py = Math.max(0, Math.min(A.H - 1, Math.floor(y * A.H))), p = py * A.W + px;
  const g = A.regions[A.labels[p]] || {}, e = enrichAt(A, x, y, 0.05);
  // the strength of the lines: the edges' mean round the point (7 × 7 pixels)
  let s = 0, k = 0;
  for (let j = Math.max(0, py - 3); j <= Math.min(A.H - 1, py + 3); j++) for (let i = Math.max(0, px - 3); i <= Math.min(A.W - 1, px + 3); i++) { s += clamp(A.mag[j * A.W + i] / A.p95); k++; }
  return {
    texture: clamp((g.entropy ?? 0.5) * 1.1), lines: clamp((s / k) * 1.6), linesWord: linesWord(e), order: e.order, angle: Math.round((e.angle * 180) / Math.PI),
    depth: e.depth, pattern: e.pattern, sat: clamp(g.sat ?? 0), warmth: warm01(g), contrast: e.contrast, grain: e.grain, light: clamp(g.L ?? A.L[p])
  };
}
