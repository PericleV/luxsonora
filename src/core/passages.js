// Connections: the path between two focus points, read like the points themselves.
//
// The line from one point to the next (the saccade) is sampled on the analysed image: its
// brightness profile, the edges it crosses and the regions it passes. That profile becomes a
// passage that links the last note of a point to the first note of the next:
//   - the number of notes grows with the length of the jump and the edges crossed;
//   - the notes fall where the line crosses edges (the image gives the rhythm), else at the end;
//   - the contour follows the brightness along the line around the straight line from note to note;
//   - notes on a beat are tones of the sounding chord, the others scale tones; the last note is a
//     step next to the arrival note (chromatic in jazz), so the passage leads into it.
// Each style keeps its manner: arpeggios of the next chord in electronic and synthwave, slower
// eighths in ambient and the film underscore, a chromatic approach in jazz.
// (A real eye hardly sees during a saccade; this is an artistic reading of the path, optional.)
import { clamp, clampInt } from "./util.js";

export const CONNECT = { off: "Off", light: "Light", rich: "Rich" };

// Profile along the line from point a to point b ({ x, y } fractions of the image).
export function pathProfile(A, a, b, n = 64) {
  const W = A.W, H = A.H, x0 = a.x * W - 0.5, y0 = a.y * H - 0.5, x1 = b.x * W - 0.5, y1 = b.y * H - 0.5;
  const lum = [], edge = [], lab = [], p95 = A.p95 || 1;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1), x = clampInt(Math.round(x0 + (x1 - x0) * f), 0, W - 1), y = clampInt(Math.round(y0 + (y1 - y0) * f), 0, H - 1), p = y * W + x;
    lum.push(A.L[p]); edge.push(A.mag[p] / p95); lab.push(A.labels[p]);
  }
  // edges crossed: local maxima above 0.6 of the 95th percentile, 8% of the line apart, away from the ends
  const crossings = [];
  for (let k = 1; k < n - 1; k++) {
    const f = k / (n - 1);
    if (f < 0.1 || f > 0.9) continue;
    if (edge[k] >= 0.6 && edge[k] >= edge[k - 1] && edge[k] >= edge[k + 1] && crossings.every(c => Math.abs(c.f - f) >= 0.08)) crossings.push({ f, s: edge[k] });
  }
  let regions = 0; for (let k = 1; k < n; k++) if (lab[k] !== lab[k - 1]) regions++;
  return { len: Math.hypot(b.x - a.x, b.y - a.y), lum, crossings, regions };
}

const PC = m => ((m % 12) + 12) % 12;
const nearestIn = (pcs, target) => { let best = null; for (let m = Math.round(target) - 7; m <= Math.round(target) + 7; m++) if (pcs.has(PC(m)) && (best === null || Math.abs(m - target) < Math.abs(best - target))) best = m; return best ?? Math.round(target); };
const stepToward = (n, dir, scale) => { let m = n + dir; while (!scale.has(PC(m))) m += dir; return m; };
// the scale without the tones that rub against a chord (a semitone from one of its tones)
const calm = (scale, chord) => { const out = new Set([...scale].filter(p => chord.has(p) || !(chord.has((p + 1) % 12) || chord.has((p + 11) % 12)))); return out.size >= 3 ? out : scale; };
const onBeat = t => Math.abs(t - Math.round(t)) < 1e-6;

/*
 * Passage from pitch L to pitch N inside the window [t0, t1) (beats).
 * level: "light" (one or two notes, long jumps only) or "rich"; chordAt(t): pitch classes sounding at t.
 * Returns [{ t, dur, midi, f, chromatic? }] with f the position along the line.
 */
export function passage(L, N, t0, t1, prof, level, style, scalePcs, chordAt) {
  const win = t1 - t0;
  if (win < 0.25 || level === "off") return [];
  const step = style === "ambient" || style === "movie" ? 0.5 : 0.25;
  let k;
  if (level === "light") { if (prof.len < 0.25 && Math.abs(N - L) < 3) return []; k = clamp(prof.crossings.length, 1, 2); }
  else k = Math.min(6, 1 + prof.crossings.length + Math.round(prof.len * 4));
  k = Math.min(k, Math.floor(win / step));
  if (k <= 0) return [];
  let times = prof.crossings.length >= k ? prof.crossings.slice(0, k).map(c => t0 + Math.round((c.f * win) / step) * step) : Array.from({ length: k }, (_, j) => t1 - (k - j) * step);
  times = [...new Set(times.map(t => Math.min(t1 - step, Math.max(t0, t))))].sort((a, b) => a - b);
  const n = prof.lum.length, lum0 = prof.lum[0], lum1 = prof.lum[n - 1];
  const arp = style === "electronic" || style === "synthwave";
  const notes = times.map((t, j) => {
    const fpos = clamp((t - t0) / win), f = (j + 1) / (times.length + 1);
    const li = prof.lum[Math.round(fpos * (n - 1))], terrain = (li - (lum0 + (lum1 - lum0) * fpos)) * 7;
    // off the beat: scale tones, but not the ones a semitone from a tone of the chord (the fourth
    // over a major chord, the minor sixth over a minor one): held half a beat they rub against
    // the pad and the section
    const ch = chordAt(t);
    const pcs = arp ? chordAt(t1) : onBeat(t) ? ch : calm(scalePcs, ch);
    return { t, f: fpos, midi: nearestIn(pcs, L + (N - L) * f + terrain) };
  });
  // the last note leads into the arrival note
  const last = notes[notes.length - 1];
  if (style === "jazz") { last.midi = N + (N >= L ? -1 : 1); last.chromatic = true; }
  else if (!arp && (Math.abs(last.midi - N) > 2 || last.midi === N)) {
    // a scale step next to the arrival, from the side that does not rub against the chord
    // sounding there (a semitone from one of its tones)
    const pcs = chordAt(last.t), rub = m => !pcs.has(PC(m)) && (pcs.has(PC(m + 1)) || pcs.has(PC(m - 1)));
    const dir = N >= L ? -1 : 1, a = stepToward(N, dir, scalePcs), b = stepToward(N, -dir, scalePcs);
    // both rub: a tone of that chord within a third of the arrival, on the side the line comes from
    let c = null;
    for (const d of [3, 4, 2, 1].flatMap(x => [-dir * -x, dir * -x].map(v => -v))) { const m = N + d; if (m !== N && pcs.has(PC(m))) { c = m; break; } }
    last.midi = !rub(a) ? a : !rub(b) ? b : c ?? a;
  }
  // no note repeats its neighbour: move it by a scale step toward the arrival
  for (let j = 1; j < notes.length; j++) if (notes[j].midi === notes[j - 1].midi && !notes[j].chromatic) notes[j].midi = stepToward(notes[j].midi, N >= L ? 1 : -1, arp ? chordAt(t1) : calm(scalePcs, chordAt(notes[j].t)));
  notes.forEach((x, j) => { x.dur = ((notes[j + 1] ? notes[j + 1].t : t1) - x.t) * 0.96; });
  return notes;
}
