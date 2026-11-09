// Time planning for a piece of fixed duration T (seconds), in 4/4.
//
// 1. bars = max(3, round(T · bpm_style / 240)), bpm = bars · 240 / T.
//    The piece lasts exactly T seconds; the tempo correction is at most 120/T BPM (±4 at 30 s).
// 2. A generated intro (0, 1 or 2 bars) comes first and a generated ending (0, 1 or 2 bars; one by
//    default) last. The places share what is left: B = 4·bars − intro − end beats.
// 3. Each focus point gets at least one beat, so at most B focus points are used.
// 4. The ideal duration is proportional to the weight: d_i = B · W_i / ΣW, with W_i = 1 + 3·I_i.
//    Points that would get less than one beat are pinned to one beat and the rest is
//    redistributed (water-filling); durations are then rounded to half beats with the
//    largest-remainder (Hamilton) method so that the sum is exactly B.
export const BEATS_PER_BAR = 4;
export const CADENCE_BEATS = 4;
export const GRID = 0.5;

// grid: rounding unit in beats (half beats by default; whole beats or two beats for the styles
// whose phrasing needs it, RULES.grid); every point gets at least max(1, grid) beats.
// Beats of the intro or the ending: "off", 1 or 2 bars, or "auto" (an intro of one bar from eight bars
// up; an ending of one bar, two from twenty bars up).
export function sectionBeats(choice, bars, kind) {
  if (choice === "off" || choice === 0) return 0;
  if (choice === 1 || choice === 2 || choice === "1" || choice === "2") return Number(choice) * BEATS_PER_BAR;
  return kind === "intro" ? (bars >= 8 ? BEATS_PER_BAR : 0) : bars >= 20 ? 2 * BEATS_PER_BAR : BEATS_PER_BAR;
}
// The returned times are the places' own: total and body leave the intro out (the composer works
// from 0 and moves everything later by `intro` at the end); fullTotal is the whole piece.
export function planTime(T, bpmStyle, weights, grid = GRID, introChoice = "off", endChoice = 1) {
  const minB = Math.max(1, grid);
  const bars = Math.max(3, Math.round((T * bpmStyle) / 240));
  const bpm = (bars * 240) / T;
  const fullTotal = bars * BEATS_PER_BAR;
  let intro = sectionBeats(introChoice, bars, "intro"), end = sectionBeats(endChoice, bars, "end");
  // the places keep at least two bars: the intro gives way first, then the ending
  while (fullTotal - intro - end < 2 * BEATS_PER_BAR && (intro > 0 || end > 0)) { if (intro > 0) intro -= BEATS_PER_BAR; else end -= BEATS_PER_BAR; }
  const total = fullTotal - intro, body = total - end;
  const count = Math.min(weights.length, Math.floor(body / minB));
  const W = weights.slice(0, count), dur = new Array(count).fill(0);
  if (count > 0) {
    // water-filling with a minimum of minB beats
    const fixed = new Array(count).fill(false);
    let ideal = new Array(count).fill(0);
    for (let guard = 0; guard <= count; guard++) {
      const nFixed = fixed.filter(Boolean).length, rem = body - nFixed * minB;
      const S = W.reduce((a, w, i) => a + (fixed[i] ? 0 : w), 0);
      let changed = false;
      for (let i = 0; i < count; i++) {
        if (fixed[i]) { ideal[i] = minB; continue; }
        ideal[i] = S > 0 ? (rem * W[i]) / S : rem / (count - nFixed);
        if (ideal[i] < minB) { fixed[i] = true; changed = true; }
      }
      if (!changed) break;
    }
    // Hamilton rounding on the grid
    const units = Math.round(body / grid), u = ideal.map(d => d / grid);
    const base = u.map(x => Math.max(Math.round(minB / grid), Math.floor(x + 1e-9)));
    let left = units - base.reduce((a, b) => a + b, 0);
    const order = u.map((x, i) => [x - Math.floor(x + 1e-9), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let j = 0; left > 0; j = (j + 1) % count, left--) base[order[j][1]]++;
    for (let i = 0; left < 0 && i < count * 4; i++) {
      const k = order[count - 1 - (i % count)][1];
      if (base[k] > minB / grid) { base[k]--; left++; }
    }
    for (let i = 0; i < count; i++) dur[i] = base[i] * grid;
  }
  return { T, bars, bpm, bpmStyle, total, body, count, dur, weights: W, grid, intro, end, fullTotal };
}
