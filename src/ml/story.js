// Story melody: the gaze path read as a story with Magenta MusicVAE (mel_chords).
//
// 1. Every distinct place gets a theme: its classic motif, at the register its height
//    gives, repeated over two bars (the seed). The model turns each seed into a latent
//    vector z. A return to a place brings back the same z: the theme comes back.
// 2. Each segment of the path is decoded from a point between its place and the next
//    place, slerp(z_i, z_next, u), with u growing with the length of the saccade: the
//    melody already leans toward where the eye goes next, so the order of the points
//    changes every segment. Segments longer than two bars keep moving toward the next place.
// 3. The decoder is conditioned on the harmony, one triad per sixteenth step: the chord
//    of the harmonic grid sounding at that step (the slots of compose.js), also past the
//    end of the segment. The melody therefore fits the chords that actually play.
// 4. Each segment is moved by whole octaves so its mean pitch sits where the classic
//    melody of that point was (the height of the point still sets the register).
//
// The model is passed in (see magenta.js modelApi), so this module has no dependency on
// TensorFlow and can be tested with a fake model.
import { clamp } from "../core/util.js";
import { degMidi } from "../core/theory.js";
import { doubleClimax, applyContours, fitMelody, melodyRules, cleanVoices } from "../core/compose.js";
import { doubleNotes } from "../core/arrange.js";

export const STEPS = 32, SPQ = 4; // 2 bars of sixteenth notes
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Chord symbol of the triad on scale degree root (the model only reads triads).
export function triadSymbol(root, modeIv, pc) {
  const iv = d => degMidi(d, modeIv, 0);
  const third = iv(root + 2) - iv(root), fifth = iv(root + 4) - iv(root);
  const name = NAMES[(((pc + iv(root)) % 12) + 12) % 12];
  return name + (third === 4 ? (fifth === 8 ? "aug" : "") : fifth === 6 ? "dim" : "m");
}

// The place a segment belongs to: revisits share the place of the point they return to.
export const placeOf = F => (F.revisitOf ?? F.index ?? F.idx);

// Two-bar seed of a place: its classic notes repeated, equal lengths, pitches 21-108.
export function seedSequence(lead) {
  const ps = lead.length ? lead : [60], len = Math.max(1, Math.floor(8 / ps.length)), notes = [];
  for (let s = 0, j = 0; s < STEPS; j++) {
    const e = Math.min(STEPS, s + len);
    notes.push({ pitch: Math.min(108, Math.max(21, ps[j % ps.length])), quantizedStartStep: s, quantizedEndStep: e });
    s = e;
    if (j % ps.length === ps.length - 1) s = Math.ceil(s / 8) * 8; // each repetition starts on a half bar
  }
  return { quantizationInfo: { stepsPerQuarter: SPQ }, totalQuantizedSteps: STEPS, notes };
}

export function slerp(a, b, u) {
  const na = Math.hypot(...a), nb = Math.hypot(...b);
  let dot = 0; for (let i = 0; i < a.length; i++) dot += (a[i] / na) * (b[i] / nb);
  const om = Math.acos(clamp(dot, -1, 1));
  if (om < 1e-4) return a.map((x, i) => x + (b[i] - x) * u);
  const s = Math.sin(om), ka = Math.sin((1 - u) * om) / s, kb = Math.sin(u * om) / s;
  return a.map((x, i) => ka * x + kb * b[i]);
}

// How far a segment leans toward the next place: 0.2 for a short saccade, up to 0.65.
export const leanOf = len => 0.2 + 0.45 * clamp(len / 0.6);

// Key identifying everything the story depends on (score points, harmony, key and mode).
export function storyKey(score) {
  return JSON.stringify([score.pc, score.modeKey, score.points.map(F => [placeOf(F), +F.x.toFixed(4), +F.y.toFixed(4), F.dur, F.root, F.lead])]);
}

/*
 * Generates the story melody. model: { encode(seeds, chord) → z[], decode(z, chords) → NoteSequence }.
 * onProgress(done, total) is called after each decoded window.
 * Returns { key, places, segments: [{ point, notes: [{ t, dur, midi }] }] }, times in beats.
 */
export async function storyMelody(score, model, onProgress = () => {}) {
  const pts = score.points, n = pts.length;
  const places = [...new Set(pts.map(placeOf))];
  const first = new Map(); pts.forEach(F => { if (!first.has(placeOf(F))) first.set(placeOf(F), F); });
  const tonic = triadSymbol(0, score.modeIv, score.pc);
  const zs = await model.encode(places.map(p => seedSequence(first.get(p).lead)), tonic);
  const Z = new Map(places.map((p, i) => [p, zs[i]]));
  const chordAt = F => triadSymbol(F.root, score.modeIv, score.pc);
  // the chord sounding at a beat: the harmonic grid's slot when the score has one (§7.4)
  const slots = score.slots || [], tonic0 = triadSymbol(0, score.modeIv, score.pc);
  const symAt = (t, F, G, inSeg) => {
    const S = slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9);
    if (S) return triadSymbol(S.root, score.modeIv, score.pc);
    if (t >= (score.body ?? Infinity) - 1e-9) return tonic0;
    return chordAt(inSeg ? F : G);
  };

  const plan = pts.map((F, i) => {
    const G = pts[i + 1] || F, len = Math.hypot(G.x - F.x, G.y - F.y);
    return { F, G, lean: i + 1 < n ? leanOf(len) : 0, steps: Math.round(F.dur * SPQ), windows: Math.max(1, Math.ceil(Math.round(F.dur * SPQ) / STEPS)) };
  });
  const total = plan.reduce((a, s) => a + s.windows, 0);
  let done = 0;
  const segments = [];
  for (const { F, G, lean, steps, windows } of plan) {
    const za = Z.get(placeOf(F)), zb = Z.get(placeOf(G)), notes = [];
    for (let w = 0; w < windows; w++) {
      const off = w * STEPS, here = Math.min(STEPS, steps - off);
      const z = slerp(za, zb, (lean * (w + 1)) / windows);
      const chords = Array.from({ length: STEPS }, (_, s) => symAt(F.t0 + (off + s) / SPQ, F, G, s < here));
      const seq = await model.decode(z, chords);
      for (const nn of seq.notes || []) {
        const s0 = nn.quantizedStartStep, s1 = Math.min(nn.quantizedEndStep, here);
        if (s0 >= here || s1 <= s0) continue;
        notes.push({ t: F.t0 + (off + s0) / SPQ, dur: (s1 - s0) / SPQ, midi: nn.pitch });
      }
      onProgress(++done, total);
    }
    segments.push({ point: F.idx, notes: placeRegister(legato(notes, F.t1), F.lead) });
  }
  return { key: storyKey(score), places: places.length, segments };
}

/*
 * Phrasing of a decoded segment (times in beats, segment ending at end):
 *  - a note repeated at the same pitch right after itself becomes one held note
 *    (argmax decoding tends to restrike the same pitch, which sounds choppy);
 *  - a rest shorter than LEGATO_GAP is filled by the note before it, also before the
 *    end of the segment, so the line flows; longer rests stay as breaths.
 */
export const LEGATO_GAP = 0.5;
export function legato(notes, end) {
  const out = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const p = out[out.length - 1];
    if (p && p.midi === n.midi && n.t <= p.t + p.dur + LEGATO_GAP + 1e-9) { p.dur = n.t + n.dur - p.t; continue; }
    if (p && n.t - (p.t + p.dur) < LEGATO_GAP - 1e-9) p.dur = n.t - p.t;
    out.push({ ...n });
  }
  const last = out[out.length - 1];
  if (last && end - (last.t + last.dur) < LEGATO_GAP - 1e-9) last.dur = Math.max(last.dur, end - last.t);
  return out;
}

// Moves a segment by whole octaves so its mean pitch is closest to the classic melody's.
export function placeRegister(notes, classic) {
  if (!notes.length || !classic.length) return notes;
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const k = Math.round((mean(classic) - mean(notes.map(x => x.midi))) / 12);
  return notes.map(x => ({ ...x, midi: x.midi + 12 * k }));
}

/*
 * Replaces the body of the melody in a composed score with the story (in place).
 * Segments the model left empty keep their classic notes. The cadence note moves to the
 * tonic closest to the last story note.
 */
export function applyStory(score, story) {
  const bySeg = new Map(story.segments.filter(s => s.notes.length).map(s => [s.point, s.notes]));
  const keep = [], firstOf = new Map();
  for (const nn of score.notes) {
    if (nn.layer === "lead" && nn.point >= 0 && bySeg.has(nn.point)) { if (!nn.dbl && !firstOf.has(nn.point)) firstOf.set(nn.point, nn); continue; }
    keep.push(nn);
  }
  let last = null;
  for (const F of score.points) {
    const ns = bySeg.get(F.idx); if (!ns) { if (F.lead.length) last = F.lead[F.lead.length - 1]; continue; }
    const proto = firstOf.get(F.idx);
    const dyn = F.dyn ?? 1;
    ns.forEach((x, j) => keep.push({ layer: "lead", t: x.t, dur: x.dur * 0.99, midi: x.midi, vel: Math.min(127, Math.round((j === 0 ? F.vel : F.vel * 0.85) * dyn)), tim: proto ? proto.tim : F.tim.lead, pan: F.pan, point: F.idx, glide: j === 0 && proto ? proto.glide : null, story: true }));
    F.classicLead = F.lead; F.lead = ns.map(x => x.midi); F.story = true;
    last = F.lead[F.lead.length - 1];
  }
  const cad = keep.find(nn => nn.layer === "lead" && nn.point === -2);
  if (cad && last !== null) {
    let m = cad.midi; while (m - last > 6) m -= 12; while (last - m > 6) m += 12;
    cad.midi = m; score.cadence = { ...score.cadence, lead: m };
  }
  score.notes = keep;
  applyContours({ notes: keep, points: score.points, body: score.body, smooth: score.smooth, extraIds: new Set((score.extra || []).map(L => L.id)) });
  // the model writes over the chords: the same harmony rules as the classic melody
  fitMelody(score);
  melodyRules(score);
  doubleClimax({ notes: score.notes, points: score.points });
  doubleNotes({ notes: score.notes, points: score.points, extra: score.extra, inst: score.inst, body: score.body, buildUp: score.buildUp });
  cleanVoices(score);
  const keep2 = score.notes;
  keep2.sort((a, b) => a.t - b.t || a.midi - b.midi); score.story = { places: story.places, segments: story.segments.length };
  return score;
}
