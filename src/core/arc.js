// Dramatic arc: the gaze path read as introduction, development, climax and resolution.
//
// Each segment (one focus point in time) gets a tension D ∈ [0, 1]:
//   template(c): rises from 0.25 at the start to 1 at the climax position p, then falls
//                to 0.35 at the cadence (c is the segment centre as a fraction of the body);
//   local:       0.5·weight + 0.5·min(1, saccade into the segment / 0.5), −0.15 for a return
//                (recognition is a release);
//   D = lerp(NEUTRAL, 0.7·template + 0.3·local, amount).
// The climax is the segment, with its centre between 50% and 85% of the body, that scores
// highest on weight + saccade + new place: the most striking new place of the second half.
// A long piece (16 bars or more) is shaped in two waves, so its second half is not one long
// release: the climax is sought later (70-90% of the body), and before it the tension rises to a
// first, smaller peak (0.8 at 42% of the way to the climax), eases to 0.5 (a breather, where
// the added instruments thin out) and builds again to the climax.
// With amount = 0 every segment has the neutral tension and the same section (development).
// A point can carry the user's choice (mood: calm, build, climax, release), which overrides both.
import { clamp, lerp } from "./util.js";

export const NEUTRAL = 0.6;
export const SECTIONS = ["intro", "development", "climax", "resolution"];
export const SECTION_NAME = { intro: "Introduction", development: "Development", climax: "Climax", resolution: "Resolution" };
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };

// segs: [{ t0, t1, x, y, w, revisit }], body in beats, amount ∈ [0, 1].
// Returns { climax (index), peak (fraction), tension: [], section: [] }.
export function dramaticArc(segs, body, amount = 0.7) {
  const n = segs.length;
  if (!n) return { climax: -1, peak: 0.7, tension: [], section: [] };
  const centre = segs.map(s => (s.t0 + s.t1) / 2 / body);
  const sacc = segs.map((s, i) => (i ? Math.hypot(s.x - segs[i - 1].x, s.y - segs[i - 1].y) : 0));
  const score = i => (segs[i].w ?? 0.5) + 0.5 * clamp(sacc[i] / 0.5) + (segs[i].revisit ? 0 : 0.2);
  const long = body >= 64 - 1e-9, lo = long ? 0.7 : 0.5, hi = long ? 0.9 : 0.85, mid = long ? 0.8 : 0.7;
  let climax = -1;
  for (let i = 0; i < n; i++) if (centre[i] >= lo && centre[i] <= hi && (climax < 0 || score(i) > score(climax))) climax = i;
  if (climax < 0) { climax = 0; for (let i = 1; i < n; i++) if (Math.abs(centre[i] - mid) < Math.abs(centre[climax] - mid)) climax = i; }
  // a point the user marked as the climax is the climax
  const chosen = segs.findIndex(s => s.mood === "climax");
  if (chosen >= 0) climax = chosen;
  const p = clamp(centre[climax], 0.05, 0.95);
  // before the climax: one rise, or in a long piece a first peak, a breather and the final build
  const rise = c => { const f = c / p; return !long ? 0.25 + 0.75 * smooth(f) : f <= 0.42 ? 0.25 + 0.55 * smooth(f / 0.42) : f <= 0.6 ? 0.8 - 0.3 * smooth((f - 0.42) / 0.18) : 0.5 + 0.5 * smooth((f - 0.6) / 0.4); };
  const template = c => (c <= p ? rise(c) : 1 - 0.65 * smooth((c - p) / (1 - p)));
  const tension = segs.map((s, i) => {
    const local = clamp(0.5 * (s.w ?? 0.5) + 0.5 * clamp(sacc[i] / 0.5) - (s.revisit ? 0.15 : 0));
    const raw = i === climax ? 1 : 0.7 * template(centre[i]) + 0.3 * local;
    return +lerp(NEUTRAL, clamp(raw), clamp(amount)).toFixed(6);
  });
  const section = segs.map((s, i) => {
    if (amount <= 0.25) return "development";
    if (i === climax) return "climax";
    if (i > climax) return "resolution";
    // the introduction: the first 15% of the body (at least the first segment, if there are 4 or more)
    if (n >= 4 && (i === 0 || s.t1 <= 0.15 * body + 1e-9)) return "intro";
    // the segment right before the climax that is already tense joins it
    return "development";
  });
  // the role the user gave a point in the story wins over the computed arc, at any amount:
  // calm (tension at most 0.35), build (at least 0.75), climax (at least 0.95), release (at most
  // 0.45, in the resolution)
  segs.forEach((s, i) => {
    if (s.mood === "calm") tension[i] = Math.min(tension[i], 0.35);
    else if (s.mood === "build") tension[i] = Math.max(tension[i], 0.75);
    else if (s.mood === "climax") { tension[i] = Math.max(tension[i], 0.95); section[i] = "climax"; }
    else if (s.mood === "release") { tension[i] = Math.min(tension[i], 0.45); section[i] = "resolution"; }
  });
  return { climax, peak: p, tension, section };
}

// Dynamics: velocity scaled by tension, 0.82 at D = 0 up to 1.12 at D = 1 (1.0 near neutral).
export const dynamics = D => 0.82 + 0.3 * clamp(D);
