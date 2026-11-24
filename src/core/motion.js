// Movement in held bars: where the accompaniment only holds a chord for a whole bar (the
// harmony, the bass and the added tracks start one note at most in it), a figure of the genre
// moves under the melody, so the piece never stands still:
//   strings   cinematic, epic, movie, classical, neoclassical: a string ostinato in eighths
//             (root, fifth, octave, fifth), a violin arpeggio in sixteenths when the tension rises
//   synth     synthwave, electronic, drum and bass, trip-hop, techno, lo-fi: an arpeggiator in
//             sixteenths (up, then up and down when the tension rises)
//   shimmer   ambient, meditation, lo-fi nature, minimal, pop: a slow arpeggio of harp, celesta
//             or piano, in eighths (quarters for meditation)
// The figure plays tones of the chord sounding in that bar only, between the top of the harmony
// and the melody (it never crosses the melody), softly (well under the melody, louder on the
// first note of each group, stronger with the tension), and not in the intro, on the cadence or
// in a bar the melody leaves empty. It is its own track (Movement), with its own lane and level.
import { clamp, clampInt } from "./util.js";

export const MOTION = {
  cinematic: { kind: "strings", preset: "s.strings" }, epic: { kind: "strings", preset: "s.strings" }, movie: { kind: "strings", preset: "s.violin" },
  classical: { kind: "strings", preset: "s.violin" }, neoclassical: { kind: "strings", preset: "s.violin" },
  synthwave: { kind: "synth", preset: "x.nylon" }, electronic: { kind: "synth", preset: "x.nylon" }, dnb: { kind: "synth", preset: "x.glass" },
  triphop: { kind: "synth", preset: "s.vibes" }, techno: { kind: "synth", preset: "x.nylon" }, lofi: { kind: "synth", preset: "s.wurli" },
  ambient: { kind: "shimmer", preset: "s.harp" }, meditation: { kind: "shimmer", preset: "s.celesta" }, lofinature: { kind: "shimmer", preset: "s.harp" },
  minimal: { kind: "shimmer", preset: "s.marimba" }, pop: { kind: "shimmer", preset: "s.piano" },
  cinepop: { kind: "strings", preset: "s.strings" }
};
// without sampled instruments, a synthesizer of the same character
const SYNTH_OF = { "s.strings": "x.brass", "s.violin": "x.softlead", "s.harp": "x.nylon", "s.celesta": "x.glass", "s.marimba": "x.glass", "s.piano": "x.keys", "s.vibes": "x.glass", "s.wurli": "x.keys" };
export const MOTION_ID = "xm";
export const motionPreset = (style, samples) => { const m = MOTION[style]; if (!m) return null; return samples || !/^s\./.test(m.preset) ? m.preset : SYNTH_OF[m.preset] || "x.keys"; };

const pc = m => ((m % 12) + 12) % 12;
/*
 * The figures of a piece. notes: its notes; slots: its chords ({ t0, t1, chord }); points: its places
 * (tension, section); body: where the ending starts; intro: its length. Returns the new notes
 * (layer MOTION_ID), or [] when the style has no figure or nothing holds.
 */
export function motionNotes(style, { notes, slots, points, body, intro = 0, tim, arcOn = true }) {
  const M = MOTION[style]; if (!M || !slots.length) return [];
  const out = [], accLayer = n => n.layer !== "lead" && n.layer !== "perc" && n.layer !== "pad" && n.layer !== MOTION_ID;
  const pointAt = t => points.find(F => t >= F.t0 - 1e-9 && t < F.t1 - 1e-9) || points[points.length - 1];
  for (let b0 = Math.ceil(intro / 4) * 4; b0 + 4 <= body + 1e-9; b0 += 4) {
    const b1 = b0 + 4;
    const acc = notes.filter(n => accLayer(n) && n.t >= b0 - 1e-6 && n.t < b1 - 1e-6);
    if (new Set(acc.map(n => Math.round(n.t * 4))).size > 1) continue;
    const F = pointAt(b0 + 0.01); if (!F || (arcOn && F.section === "intro")) continue;
    const lead = notes.filter(n => n.layer === "lead" && !n.dbl && n.t < b1 && n.t + n.dur > b0);
    if (!lead.length) continue;
    // the register: above the harmony sounding in the bar, below the melody
    const harm = notes.filter(n => (n.layer === "harm" || n.layer === "pad") && n.t < b1 && n.t + n.dur > b0);
    const top = Math.max(55, ...harm.map(n => n.midi)), lmin = Math.min(...lead.map(n => n.midi));
    let lo = Math.max(52, top - 7), hi = Math.min(84, lmin - 2);
    if (hi - lo < 9) { lo = Math.max(52, lmin - 14); hi = lmin - 2; }
    if (hi - lo < 7) continue;
    const D = clamp(F.tension ?? 0.6), base = clampInt(Math.round(34 + 26 * D), 1, 127);
    // the chord of each step (a bar may hold two chords on a fast grid)
    const slotAt = t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || null;
    const tonesIn = ch => { const pcs = new Set(ch.map(pc)), r = []; for (let m = lo; m <= hi; m++) if (pcs.has(pc(m))) r.push(m); return r; };
    const step = M.kind === "shimmer" ? (style === "meditation" ? 1 : 0.5) : M.kind === "strings" && D < 0.7 ? 0.5 : 0.25;
    for (let t = b0, k = 0; t < b1 - 1e-9; t += step, k++) {
      const S = slotAt(t); if (!S) continue;
      const T = tonesIn(S.chord); if (T.length < 2) continue;
      let m;
      if (M.kind === "strings" && step === 0.5) { const pat = [0, 2, T.length - 1, 2]; m = T[Math.min(T.length - 1, pat[k % 4])]; }
      else { const n = T.length, up = M.kind === "synth" && D >= 0.7 ? (k % (2 * n - 2 || 1)) : k % n; m = T[up < n ? up : 2 * n - 2 - up]; }
      // never a melody note's pitch class against it a semitone away
      const sounding = lead.filter(n => n.t <= t + 1e-6 && n.t + n.dur > t + 1e-6);
      if (sounding.some(n => Math.abs(pc(n.midi) - pc(m)) === 1 || Math.abs(pc(n.midi) - pc(m)) === 11)) continue;
      const accent = k % (step === 0.25 ? 4 : 2) === 0;
      // a note never rings into the next chord
      const dur = Math.min(step * (M.kind === "shimmer" ? 1.6 : 0.85), S.t1 - t - 0.02, body - t);
      if (dur < 0.1) continue;
      out.push({ layer: MOTION_ID, t, dur, midi: m, vel: clampInt(Math.round(base * (accent ? 1 : 0.78)), 1, 127), tim, pan: (k % 2 ? 0.25 : -0.25), point: F.idx, motion: M.kind });
    }
  }
  return out;
}

/*
 * Colour, after the piece is written (each one a rule that can be turned off):
 *  sweep    the harmony and the held added tracks open their filter with the tension, as the pad
 *           does (up to about ×1.4 at the climax, ×0.75 when calm)
 *  echoes   the last note of the melody at each place comes back twice, a dotted eighth and then
 *           three eighths later, softer (40%, then 22%), left then right, where it is a tone of the
 *           chord sounding then
 *  shimmer  (ambient, meditation, cinematic, movie) an airy octave above the pad, very soft, slow
 *  spread   the notes of the pad struck together fan out across the stereo, low left, high right
 */
export const SHIMMER_STYLES = new Set(["ambient", "meditation", "cinematic", "movie", "cinepop"]);
export function colourPiece(notes, points, slots, style, { sweep = true, echoes = true, shimmer = true, spread = true, body = Infinity } = {}) {
  const pcOf = m => ((m % 12) + 12) % 12, slotAt = t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || null;
  if (sweep) for (const n of notes) {
    if (n.point < 0 || !n.tim || !n.tim.cut || !(n.layer === "harm" || (/^x/.test(n.layer) && n.layer !== "xm"))) continue;
    const F = points[n.point]; if (!F) continue;
    n.tim = { ...n.tim, cut: Math.min(16000, n.tim.cut * 2 ** (0.8 * ((F.tension ?? 0.6) - 0.6))) };
  }
  if (echoes) for (const F of points) {
    const mine = notes.filter(n => n.layer === "lead" && !n.dbl && n.point === F.idx);
    if (!mine.length) continue;
    const last = mine.reduce((a, b) => (b.t > a.t ? b : a));
    // an echo in the low register only clouds the harmony
    if (last.midi < 60) continue;
    [[0.75, 0.4, -0.6], [1.5, 0.22, 0.6]].forEach(([dt, k, pan]) => {
      const t = last.t + dt, S = slotAt(t);
      if (t >= body - 1e-9 || !S || !S.chord.some(m => pcOf(m) === pcOf(last.midi))) return;
      // only once the note has ended, and never over the same pitch still sounding in the melody
      if (last.t + last.dur > t + 1e-6 || notes.some(n => n.layer === "lead" && n.midi === last.midi && n.t < t + 0.5 && n.t + n.dur > t + 1e-6)) return;
      notes.push({ ...last, t, dur: Math.min(0.5, S.t1 - t - 0.02), vel: Math.max(1, Math.round(last.vel * k)), pan, glide: null, echo: true, passage: undefined, pickup: undefined, dev: undefined });
    });
  }
  if (shimmer && SHIMMER_STYLES.has(style)) {
    const pads = notes.filter(n => n.layer === "pad" && !n.shimmer);
    // not where the pad already has that octave
    // airy: only an octave that lands above C4, clear of the harmony
    for (const n of pads.filter(n => n.midi + 12 >= 60 && n.midi + 12 <= 96 && n.dur >= 1 && !pads.some(m => m.midi === n.midi + 12 && m.t < n.t + n.dur && m.t + m.dur > n.t))) notes.push({ ...n, midi: n.midi + 12, vel: Math.max(1, Math.round(n.vel * 0.25)), tim: n.tim ? { ...n.tim, a: Math.max(n.tim.a || 0.1, 0.6), cut: Math.min(16000, (n.tim.cut || 4000) * 1.5) } : n.tim, shimmer: true });
  }
  if (spread) {
    const groups = new Map();
    for (const n of notes) if (n.layer === "pad") { const k = Math.round(n.t * 100); (groups.get(k) || groups.set(k, []).get(k)).push(n); }
    for (const g of groups.values()) { if (g.length < 2) continue; g.sort((a, b) => a.midi - b.midi); g.forEach((n, i) => { n.pan = -0.45 + (0.9 * i) / (g.length - 1); }); }
  }
  return notes;
}
