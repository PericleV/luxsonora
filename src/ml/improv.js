// Improvise melody: Magenta ImprovRNN (chord_pitches_improv), an LSTM trained on lead sheets,
// improvising over the chords of the harmonic grid.
//
// For each focus point the network continues a seed made of the end of what it has just played
// (one beat, so the line carries across points) followed by the point's own theme (its classic
// notes, squeezed into two beats): every place keeps its character, and the order of the points
// changes what comes before each theme. The chords are given per sixteenth step from the grid,
// so the improvisation follows the harmony. Decoding takes the most likely note at every step.
// The result has the same form as the story melody and is applied by applyStory (story.js).
import { triadSymbol, placeRegister, legato, storyKey, SPQ } from "./story.js";

const seqOf = (notes, total) => ({ quantizationInfo: { stepsPerQuarter: SPQ }, totalQuantizedSteps: total, notes });
// the model's melody range (MIDI 48-83): seed pitches are folded into it by octaves; the output is
// moved back to the point's register afterwards (placeRegister)
const fold = p => { while (p < 48) p += 12; while (p > 83) p -= 12; return p; };

export async function improvMelody(score, model, onProgress = () => {}) {
  const pts = score.points, slots = score.slots || [], tonic = triadSymbol(0, score.modeIv, score.pc);
  const symAt = t => { const S = slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9); return S ? triadSymbol(S.root, score.modeIv, score.pc) : tonic; };
  let tail = []; // the last beat played, as { pitch, start, end } in steps relative to its own start
  const segments = [];
  for (let i = 0; i < pts.length; i++) {
    const F = pts[i], steps = Math.max(2, Math.round(F.dur * SPQ));
    // seed: one beat of what came before, then the theme in two beats
    const theme = F.lead.length ? F.lead.slice(0, 8) : [60], seedNotes = [];
    tail.forEach(n => seedNotes.push({ pitch: fold(n.pitch), quantizedStartStep: n.start, quantizedEndStep: n.end }));
    const len = Math.max(1, Math.floor(8 / theme.length));
    theme.forEach((p, j) => seedNotes.push({ pitch: fold(p), quantizedStartStep: 4 + j * len, quantizedEndStep: 4 + Math.min(8, (j + 1) * len) }));
    const seedSteps = 12, chords = [];
    // seed chords: the previous chord for the tail, the point's chord for the theme; then the grid
    for (let s = 0; s < seedSteps; s++) chords.push(symAt(Math.max(0, F.t0 - (seedSteps - s) / SPQ * (s < 4 ? 1 : 0))));
    for (let s = 0; s < steps; s++) chords.push(symAt(F.t0 + s / SPQ));
    const out = await model.continue(seqOf(seedNotes, seedSteps), steps, chords);
    const notes = [];
    for (const n of out.notes || []) {
      const s0 = n.quantizedStartStep, s1 = Math.min(n.quantizedEndStep, steps);
      if (s0 >= steps || s1 <= s0) continue;
      notes.push({ t: F.t0 + s0 / SPQ, dur: (s1 - s0) / SPQ, midi: n.pitch });
    }
    const placed = placeRegister(legato(notes, F.t1), F.lead);
    segments.push({ point: F.idx, notes: placed });
    // tail for the next seed: the notes of the last beat, relative to that beat
    const lastBeat = F.t1 - 1;
    tail = placed.filter(n => n.t + n.dur > lastBeat + 1e-9).map(n => ({ pitch: n.midi, start: Math.max(0, Math.round((n.t - lastBeat) * SPQ)), end: Math.min(4, Math.round((n.t + n.dur - lastBeat) * SPQ)) })).filter(n => n.end > n.start);
    onProgress(i + 1, pts.length);
  }
  return { key: "improv|" + storyKey(score), places: new Set(pts.map(F => F.revisitOf ?? F.index)).size, segments };
}
