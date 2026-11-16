// Enriched: six more readings of the picture, for a fuller piece. Each is measured round every
// place (and anywhere on the picture, for a raw piece) and set against the picture itself, 0-1:
//   lines     the direction of the edges (a histogram of oriented gradients, 8 bins over 180°):
//             how much of it is vertical, horizontal or diagonal, how ordered it is, its angle
//   pattern   repetition: the strongest autocorrelation of the brightness along a row or a column
//             (lags of 2 px up to the area's size), and its period
//   depth     how far the place seems: the opposite of its sharpness (the mean absolute Laplacian),
//             between the picture's 10th and 90th percentiles
//   contrast  complementary colours side by side: the strongest pair of opposite hues (180° apart,
//             12 bins of the colour circle, weighted by saturation) among the regions of the area
//   grain     fine grain: the mean difference between a pixel and its 3 × 3 neighbourhood
//   light     where the light comes from: the brightness centroid of the whole picture, −1 (left) to
//             1 (right), and −1 (top) to 1 (bottom)
// What a composed piece does with them (always under the genre's rules), compose.js:
//   lines     vertical: shorter notes; horizontal: legato; diagonal: arpeggios (a generic
//             accompaniment only: a skank or a funk guitar stays as the genre plays it)
//   pattern   a place that repeats keeps its motif as it is and its accompaniment broken
//   depth     a far place softer and darker, a near one closer and brighter
//   contrast  a 4-3 suspension in the harmony, resolved halfway through the chord
//   grain     a soft shaker on the drums where the picture is grainy
//   light     the melody and the added tracks lean toward the light in the stereo
// Everything is measured on the analysed picture, so it is the same on every device.
import { clamp, clampInt } from "./util.js";

export const ENRICH = {
  lines: { name: "Lines and directions", does: "vertical lines play short notes, horizontal ones legato, diagonals arpeggios" },
  pattern: { name: "Repetition", does: "a repeating pattern keeps its motif and repeats its accompaniment" },
  depth: { name: "Depth", does: "far, soft-focus places sound further away, sharp ones closer" },
  contrast: { name: "Colour contrast", does: "opposite colours side by side bring a suspension that resolves" },
  grain: { name: "Grain", does: "a grainy picture adds a soft shaker" },
  light: { name: "Light", does: "the sound leans toward where the light comes from" }
};
export const ENRICH_KEYS = Object.keys(ENRICH);
export const enrichOn = (P, k) => !!P && P.enrich === true && (!P.enrichUse || P.enrichUse[k] !== false);

const at = (A, x, y) => A.L[clampInt(y, 0, A.H - 1) * A.W + clampInt(x, 0, A.W - 1)];
// the raw measures in a square of half-size rad round (cx, cy) in pixels
function rawStats(A, cx, cy, rad) {
  const W = A.W, H = A.H, x0 = Math.max(1, Math.round(cx - rad)), x1 = Math.min(W - 2, Math.round(cx + rad)), y0 = Math.max(1, Math.round(cy - rad)), y1 = Math.min(H - 2, Math.round(cy + rad));
  const hist = new Float64Array(8); let sx = 0, sy = 0, wt = 0, lap = 0, grain = 0, n = 0;
  const step = Math.max(1, Math.floor((x1 - x0 + 1) * (y1 - y0 + 1) / 900));
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const c = at(A, x, y), l = at(A, x - 1, y), r = at(A, x + 1, y), u = at(A, x, y - 1), d = at(A, x, y + 1);
    const gx = (at(A, x + 1, y - 1) + 2 * r + at(A, x + 1, y + 1)) - (at(A, x - 1, y - 1) + 2 * l + at(A, x - 1, y + 1));
    const gy = (at(A, x - 1, y + 1) + 2 * d + at(A, x + 1, y + 1)) - (at(A, x - 1, y - 1) + 2 * u + at(A, x + 1, y - 1));
    const m = Math.hypot(gx, gy);
    if (m > 1e-4) {
      // the line runs across the gradient
      let a = Math.atan2(gy, gx) + Math.PI / 2; a = ((a % Math.PI) + Math.PI) % Math.PI;
      hist[Math.min(7, Math.floor((a / Math.PI) * 8))] += m; sx += m * Math.cos(2 * a); sy += m * Math.sin(2 * a); wt += m;
    }
    lap += Math.abs(4 * c - l - r - u - d);
    grain += Math.abs(c - (l + r + u + d + c) / 5);
    n++;
  }
  // bins: 0 and 7 horizontal (0° and 180°), 3 and 4 vertical (90°), the other four diagonal; each
  // share is taken per bin, so lines in every direction give a third each
  const tot = hist.reduce((a, b) => a + b, 0) || 1, h0 = (hist[0] + hist[7]) / 2, v0 = (hist[3] + hist[4]) / 2, d0 = (hist[1] + hist[2] + hist[5] + hist[6]) / 4, s3 = h0 + v0 + d0 || 1;
  const horiz = h0 / s3, vert = v0 / s3, diag = d0 / s3;
  const order = (Math.max(...hist) / tot - 1 / 8) / (1 - 1 / 8);
  let angle = Math.atan2(sy, sx) / 2; if (angle < 0) angle += Math.PI;
  // repetition: the profile of the rows and of the columns, and their autocorrelation
  // (on the differences of the profile, so a smooth gradient is not taken for a pattern)
  const prof = (len, get) => { const p = []; for (let i = 0; i < len; i++) p.push(get(i)); const d = p.slice(1).map((v, i) => v - p[i]), mu = d.reduce((a, b) => a + b, 0) / (d.length || 1); return d.map(v => v - mu); };
  const colP = prof(x1 - x0 + 1, i => { let s = 0, k = 0; for (let y = y0; y <= y1; y += 2) { s += at(A, x0 + i, y); k++; } return s / k; });
  const rowP = prof(y1 - y0 + 1, i => { let s = 0, k = 0; for (let x = x0; x <= x1; x += 2) { s += at(A, x, y0 + i); k++; } return s / k; });
  const ac = p => {
    const e = p.reduce((a, v) => a + v * v, 0); if (e < 1e-6 || p.length < 8) return [0, 0];
    // a pattern: a peak of the autocorrelation (higher than at the lags next to it) at 3 px or more,
    // at least two periods inside the area
    const r = []; for (let L = 0; L <= Math.floor(p.length / 2) + 1; L++) { let s = 0; for (let i = 0; i + L < p.length; i++) s += p[i] * p[i + L]; r.push((s / e) * (p.length / (p.length - L))); }
    let best = 0, lag = 0;
    for (let L = 3; L < r.length - 1; L++) if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] > best) { best = r[L]; lag = L; }
    return [clamp(best), lag];
  };
  const [rc, lc] = ac(colP), [rr, lr] = ac(rowP), rep = Math.max(rc, rr), period = rc >= rr ? lc : lr;
  // complementary colours among the regions of the area
  const hue = new Float64Array(12), seen = new Map();
  for (let y = y0; y <= y1; y += step * 2) for (let x = x0; x <= x1; x += step * 2) { const id = A.labels[y * W + x]; seen.set(id, (seen.get(id) || 0) + 1); }
  let hw = 0;
  for (const [id, k] of seen) { const g = A.regions[id]; if (!g) continue; const w = k * clamp(g.sat ?? 0) * clamp((g.hueStr ?? 0) * 3); hue[Math.round((g.hue ?? 0) / 30) % 12] += w; hw += k; }
  let comp = 0; for (let b = 0; b < 6; b++) comp = Math.max(comp, Math.min(hue[b], hue[b + 6]));
  return { vert, horiz, diag, order: clamp(order), angle, rep, period, sharp: lap / Math.max(1, n), grain: grain / Math.max(1, n), comp: clamp((comp / Math.max(1, hw)) * 4) };
}

// The picture's own spread of each measure (on a grid of areas), to set a place against it.
export function enrichBase(A) {
  if (A._enrich) return A._enrich;
  const rad = Math.max(6, 0.08 * Math.min(A.W, A.H)), sharp = [], grain = [];
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) { const s = rawStats(A, ((gx + 0.5) / 6) * A.W, ((gy + 0.5) / 6) * A.H, rad); sharp.push(s.sharp); grain.push(s.grain); }
  const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
  // where the light comes from: the brightness centroid
  let sl = 0, lx = 0, ly = 0;
  for (let y = 0; y < A.H; y += 2) for (let x = 0; x < A.W; x += 2) { const l = A.L[y * A.W + x] ** 2; sl += l; lx += l * (x / A.W - 0.5); ly += l * (y / A.H - 0.5); }
  const base = { sharp: [q(sharp, 0.1), q(sharp, 0.9)], grain: [q(grain, 0.1), q(grain, 0.9)], light: { x: clamp((lx / (sl || 1)) * 6, -1, 1), y: clamp((ly / (sl || 1)) * 6, -1, 1) } };
  Object.defineProperty(A, "_enrich", { value: base, enumerable: false });
  return base;
}
const norm = (v, [lo, hi]) => clamp((v - lo) / Math.max(1e-6, hi - lo));

// The six readings at a point (x, y in 0-1; r its radius, as the places have it)
export function enrichAt(A, x, y, r = 0.07) {
  const base = enrichBase(A), rad = Math.max(6, 1.4 * r * Math.min(A.W, A.H)), s = rawStats(A, x * A.W, y * A.H, rad);
  return {
    vert: s.vert, horiz: s.horiz, diag: s.diag, order: s.order, angle: s.angle,
    pattern: s.rep, period: s.period, depth: 1 - norm(s.sharp, base.sharp), contrast: s.comp, grain: norm(s.grain, base.grain),
    lightX: base.light.x, lightY: base.light.y
  };
}
// what the lines of a place are, in words
export function linesWord(e) {
  if (!e) return "";
  const m = Math.max(e.vert, e.horiz, e.diag);
  return m === e.vert ? "vertical" : m === e.horiz ? "horizontal" : "diagonal";
}

// The accompaniments a reading may choose between; any other (a skank, a funk guitar, a bossa
// comp, power chords) is the genre's own and stays.
export const GENERIC_HARM = new Set(["block", "swell", "pulse", "arp", "ostinato"]);
// The accompaniment a place's readings ask for, or null
export function enrichHarmKind(P, e) {
  if (!e) return null;
  if (enrichOn(P, "pattern") && e.pattern > 0.7) return "ostinato";
  if (enrichOn(P, "lines") && e.order > 0.2) { const w = linesWord(e); return w === "diagonal" ? "arp" : w === "vertical" ? "pulse" : "swell"; }
  return null;
}
const dominance = e => clamp((Math.max(e.vert, e.horiz, e.diag) - 0.34) / 0.4);
/*
 * What the readings change in a composed piece, after it is written (so the genre's rules have
 * already chosen every chord and every note): articulation, distance, suspensions, a shaker, the
 * stereo. notes: the piece's notes; points: its places (with .enrich); slots: its chords.
 */
export function applyEnrich(notes, points, slots, P, { modeIv, pcOff, degMidi }) {
  const use = k => enrichOn(P, k), eOf = i => (points[i] && points[i].enrich) || null, pc = m => ((m % 12) + 12) % 12;
  // lines: vertical places play short, horizontal ones legato (the melody and the harmony); a
  // legato note never runs past its chord, so it cannot ring into the next one
  const slotEnd = t => { const S = slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9); return S ? S.t1 : Infinity; };
  if (use("lines")) for (const layer of ["lead", "harm"]) {
    const ns = notes.filter(n => n.layer === layer && n.point >= 0 && !n.dbl).sort((a, b) => a.t - b.t);
    ns.forEach((n, i) => {
      const e = eOf(n.point); if (!e) return;
      const s = dominance(e) * clamp(e.order * 2), w = linesWord(e); if (s <= 0.02) return;
      if (w === "vertical") n.dur = Math.max(0.15, n.dur * (1 - 0.5 * s));
      else if (w === "horizontal") { const nx = ns.slice(i + 1).find(m => m.t > n.t + 1e-6); if (nx) n.dur = Math.max(n.dur, Math.min(nx.t - n.t - 0.02, slotEnd(n.t) - n.t - 0.02, n.dur * (1 + 0.6 * s))); }
      n.enrich = (n.enrich || []).concat("lines");
    });
  }
  // depth: a far place softer and darker, a near one a little louder and brighter
  if (use("depth")) for (const n of notes) {
    if (n.layer === "perc" || n.point < 0) continue;
    const e = eOf(n.point); if (!e) continue;
    const f = e.depth - 0.5;
    n.vel = Math.max(1, Math.min(127, Math.round(n.vel * (1 - 0.3 * f))));
    if (n.tim && n.tim.cut) n.tim = { ...n.tim, cut: Math.min(16000, n.tim.cut * 2 ** (-1.2 * f)) };
  }
  // colour contrast: a 4-3 suspension in the harmony, resolved halfway through the chord (not
  // where the melody holds the third, not on the cadence)
  if (use("contrast")) for (const S of slots) {
    const e = S.F && eOf(S.F.idx); if (!e || e.contrast < 0.45 || S.cadence || S.intro) continue;
    const third = pc(degMidi(S.root + 2, modeIv, pcOff)), fourth = pc(degMidi(S.root + 3, modeIv, pcOff)), up = pc(fourth - third), mid = S.t0 + (S.t1 - S.t0) / 2;
    if (up < 1 || up > 2) continue;
    // not where another track (the melody, the pad, an added one) holds the third: the fourth would
    // rub a semitone or a tone against it
    if (notes.some(n => n.layer !== "harm" && n.layer !== "perc" && n.t < mid && n.t + n.dur > S.t0 && pc(n.midi) === third)) continue;
    let last = null;
    for (const n of [...notes]) {
      if (n.layer !== "harm" || n.t < S.t0 - 1e-9 || n.t >= mid - 1e-9 || pc(n.midi) !== third) continue;
      // a note held past the middle resolves there
      if (n.t + n.dur > mid + 0.05) { notes.push({ ...n, t: mid, dur: n.t + n.dur - mid, glide: null, resolve: true }); n.dur = mid - n.t; }
      n.midi += up; n.sus = true; if (!last || n.t > last.t) last = n;
    }
    // no third after the middle (short notes in the first half only): the resolution is added there
    if (last && !notes.some(n => n.layer === "harm" && n.t >= mid - 1e-9 && n.t < S.t1 - 1e-9 && pc(n.midi) === third)) notes.push({ ...last, midi: last.midi - up, t: mid, dur: Math.max(0.25, Math.min(last.dur, S.t1 - mid)), glide: null, sus: false, resolve: true });
  }
  // grain: a soft shaker where the picture is grainy, if the piece has drums
  if (use("grain") && notes.some(n => n.layer === "perc" && n.point >= 0)) {
    const has = new Set(notes.filter(n => n.layer === "perc" && n.midi === 70).map(n => Math.round(n.t * 4)));
    for (const F of points) {
      const e = F.enrich; if (!e || e.grain < 0.55) continue;
      const step = e.grain > 0.8 ? 0.25 : 0.5;
      for (let t = Math.ceil(F.t0 / step) * step; t < F.t1 - 1e-9; t += step) {
        if (has.has(Math.round(t * 4))) continue;
        notes.push({ layer: "perc", t, dur: 0.05, midi: 70, vel: Math.round(22 + 40 * e.grain * (Math.abs(t % 1) < 1e-6 ? 1 : 0.75)), point: F.idx, enrich: ["grain"] });
      }
    }
  }
  // light: the melody and the added tracks lean toward the light
  if (use("light")) {
    const lx = (points[0] && points[0].enrich && points[0].enrich.lightX) || 0;
    if (Math.abs(lx) > 0.05) for (const n of notes) if (!["harm", "bass", "pad", "perc"].includes(n.layer) && n.point >= 0) n.pan = clamp((n.pan || 0) + 0.35 * lx, -0.8, 0.8);
  }
}
