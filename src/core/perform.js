// Performance: how the composed notes are played. Runs after the composition (and after a neural
// melody or groove), is deterministic (the same piece and settings always play the same way), and
// every change still traces back to the image:
//   dynamics    the velocity range around each point's level (from the image's weight there)
//   detail      each note of a place reads the picture around it (lightness and edges sampled on a
//               small circle round the focus point) and is played a little louder or softer
//   accents     the metre: louder on the downbeat, a little on beat 3, softer off the beat
//   phrasing    four-bar phrases rise to their third bar and relax at the end
//   expression  a CC11 curve per layer, from the arc's tension and the light of each place
//   vibrato     a CC1 curve, from the colour of each place (saturated places sing more)
//   humanize    timing (milliseconds), length and velocity varied a little, chord notes together;
//               drum-machine styles stay tight, swung ones loose
// The CC curves are in score.cc and are written to the MIDI file; in the app, expression drives each
// layer's level and vibrato the synthesizers' vibrato.
import { clamp, clampInt } from "./util.js";

export const PERFORM_DEFAULTS = { dynRange: 0.5, velDetail: 0.5, accent: 0.4, phrasing: 0.4, ccExpr: 0.6, ccMod: 0.4, humTime: 8, humLen: 0.1, humVel: 6 };
// how much of the timing variation a style takes (1 = all of it)
export const LOOSENESS = { acappella: 1.3, chiptune: 0, techno: 0.15, dnb: 0.3, triphop: 1.2, reggae: 1.1, folk: 1.2, baroque: 0.8, neoclassical: 1.3, lofinature: 1.4, meditation: 1.5, eastasian: 1.3, postrock: 1, electronic: 0.15, synthwave: 0.3, metal: 0.5, funk: 0.6, pop: 0.7, rock: 0.8, minimal: 0.6, jazz: 1.3, lofi: 1.4, blues: 1.2, bossa: 1.1 };
// layers that play one note at a time (a varied length must not run into the next note)
const MONO = new Set(["lead", "bass"]), MONO_ROLES = new Set(["counter", "double", "runs", "ostinato", "pulse", "ornament"]);
const SUSTAINED = new Set(["pad"]), SUSTAINED_ROLES = new Set(["sustain", "drone"]);

const opt = (P, k) => (P && Number.isFinite(P[k]) ? P[k] : PERFORM_DEFAULTS[k]);
// a stable pseudo-random number in [-1, 1] from a note's identity
function noise(...xs) {
  let h = 2166136261;
  for (const x of xs) { const s = String(x); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
// the picture round a focus point: lightness and edges at an angle, 0-1
function detailAt(A, F, k) {
  if (!A || !A.L || !F) return 0.5;
  const W = A.W, H = A.H, rad = (F.r ?? 0.07) * Math.min(W, H) * 0.7, th = k * 2.39996;
  const x = clampInt(Math.round(F.x * W + Math.cos(th) * rad), 0, W - 1), y = clampInt(Math.round(F.y * H + Math.sin(th) * rad), 0, H - 1), i = y * W + x;
  const e = A.mag && A.p95 ? clamp(A.mag[i] / A.p95) : 0;
  return clamp(0.65 * A.L[i] + 0.35 * e);
}

export function perform(score, P = {}, A = null) {
  const notes = score.notes, pts = score.points || [], spb = 60 / score.bpm, end = score.total;
  const roleOf = l => ((score.extra || []).find(L => L.id === l) || {}).role;
  const isMono = l => MONO.has(l) || MONO_ROLES.has(roleOf(l)), isSus = l => SUSTAINED.has(l) || SUSTAINED_ROLES.has(roleOf(l));
  const dyn = opt(P, "dynRange"), det = opt(P, "velDetail"), acc = opt(P, "accent"), phr = opt(P, "phrasing");
  const eAmt = opt(P, "ccExpr"), mAmt = opt(P, "ccMod");
  const loose = LOOSENESS[score.style] ?? 1, tMs = opt(P, "humTime") * loose, lAmt = opt(P, "humLen"), vAmt = opt(P, "humVel");
  const seed = P.seed || 0;

  // ---- velocity: range, the picture round each place, metre, phrase ----
  const pitched = notes.filter(n => n.layer !== "perc");
  const mean = pitched.length ? pitched.reduce((a, n) => a + n.vel, 0) / pitched.length : 80;
  const kOf = new Map(), count = {};
  for (const n of [...pitched].sort((a, b) => a.t - b.t)) { const key = n.layer + "|" + n.point; kOf.set(n, count[key] = (count[key] ?? -1) + 1); }
  for (const n of notes) {
    let v = n.vel;
    if (n.layer !== "perc") {
      v = mean + (v - mean) * (0.4 + 1.2 * dyn);
      if (n.point >= 0) v += (detailAt(A, pts[n.point], kOf.get(n)) - 0.5) * 2 * 14 * det;
      const beat = ((n.t % 4) + 4) % 4, onBeat = Math.abs(beat - Math.round(beat)) < 1e-6;
      v += acc * (beat < 1e-6 ? 10 : Math.abs(beat - 2) < 1e-6 ? 5 : onBeat ? 0 : -5);
      if (n.t < score.body) { const ph = (n.t % 16) / 16; v += phr * 10 * (ph < 0.7 ? ph / 0.7 * 2 - 1 : 1 - ((ph - 0.7) / 0.3) * 2); }
    }
    n.vel = clampInt(Math.round(v), 1, 127);
  }

  // ---- CC curves: expression (CC11) and vibrato (CC1), per layer, at each place ----
  const cc = {}, layers = [...new Set(notes.map(n => n.layer))].filter(l => l !== "perc");
  for (const l of layers) {
    const expr = [], mod = [];
    for (const F of pts) {
      const r = F.reg || {}, raw = clamp(0.6 + 0.4 * (F.tension ?? 0.6) + ((r.L ?? 0.5) - 0.5) * 0.2);
      const v = 1 - eAmt * (1 - raw);
      expr.push([F.t0, v]);
      if (isSus(l) && F.dur >= 2) expr.push([F.t0 + F.dur / 2, clamp(v + 0.08 * eAmt)]);
      mod.push([F.t0, clamp(mAmt * (0.25 + 0.75 * (r.sat ?? 0.3)))]);
    }
    if (score.body < end) { expr.push([score.body, 1 - eAmt * 0.15]); mod.push([score.body, mAmt * 0.3]); }
    cc[l] = { expr, mod };
  }
  score.cc = cc;
  // vibrato on the synthesizers: the CC1 value at the note's start, in cents, on held notes
  const ccAt = (curve, t) => { let v = curve.length ? curve[0][1] : 0; for (const [tt, x] of curve) { if (tt > t + 1e-9) break; v = x; } return v; };
  if (mAmt > 0) for (const n of notes) if (cc[n.layer] && n.tim && n.tim.type !== "sample" && n.dur * spb >= 0.5) {
    const add = Math.round(16 * ccAt(cc[n.layer].mod, n.t));
    if (add > 0) n.tim = { ...n.tim, vib: (n.tim.vib || 0) + add };
  }

  // ---- humanize: timing (chord notes move together), length, velocity ----
  if (tMs > 0 || lAmt > 0 || vAmt > 0) {
    const orig = new Map(notes.map(n => [n, { t: n.t, end: n.t + n.dur }]));
    for (const n of notes) {
      if (n.groove) continue; // a neural groove already plays the drums like a drummer
      const tk = Math.round(n.t * 960), grp = noise(seed, n.layer, tk), own = noise(seed, n.layer, tk, n.midi, "o");
      if (tMs > 0 && n.t > 1e-9 && n.t < end - 1e-6) {
        let ms = tMs * (0.8 * grp + 0.2 * own);
        if (n.layer === "perc") ms *= score.style === "electronic" || score.style === "synthwave" ? 0 : n.midi === 36 && Math.abs(n.t % 1) < 1e-6 ? 0.3 : 0.7;
        n.t = Math.max(0, n.t + ms / 1000 / spb);
      }
      if (lAmt > 0 && n.layer !== "perc") n.dur = Math.max(0.05, n.dur * (1 + lAmt * 0.6 * noise(seed, n.layer, tk, n.midi, "l")));
      if (vAmt > 0) n.vel = clampInt(Math.round(n.vel + vAmt * noise(seed, n.layer, tk, n.midi, "v")), 1, 127);
      if (n.t + n.dur > end) n.dur = Math.max(0.02, end - n.t);
    }
    // a varied note never runs into the next one where it did not before, and never restrikes itself
    const byLayer = {};
    for (const n of notes) if (n.layer !== "perc") (byLayer[n.layer] = byLayer[n.layer] || []).push(n);
    for (const [l, L] of Object.entries(byLayer)) {
      L.sort((a, b) => a.t - b.t);
      for (let i = 0; i < L.length; i++) {
        const a = L[i], oa = orig.get(a);
        for (let j = i + 1; j < L.length && L[j].t < a.t + a.dur; j++) {
          const b = L[j], ob = orig.get(b);
          if ((isMono(l) || b.midi === a.midi) && oa.end <= ob.t + 1e-6) a.dur = Math.max(0.02, b.t - a.t - 0.01);
        }
      }
    }
    notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  }
  score.perform = { dynRange: dyn, velDetail: det, accent: acc, phrasing: phr, ccExpr: eAmt, ccMod: mAmt, humTime: opt(P, "humTime"), humLen: lAmt, humVel: vAmt };
  return score;
}
