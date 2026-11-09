// Human groove: Magenta GrooVAE (groovae_2bar_humanize) plays our drum part like a drummer.
//
// The drum part is cut into two-bar windows and given to the model as a quantized performance;
// the model answers with micro-timing and velocities for each hit. Our hits stay ours (none is
// added or removed, so every hit still belongs to its focus point); from the model we take the
// timing offset and the velocity of the hit it plays on the same step and drum. Genre rule:
// electronic music stays on the grid (a drum machine), only its accents change. Decoding
// takes the most likely output, so the same drums give the same groove.
const SPQ = 4, WINDOW = 8; // two bars of 4/4, in beats
// our General MIDI drums → GrooVAE's nine drum classes (canonical pitches)
const CLASS = { 36: 36, 38: 38, 39: 38, 37: 38, 42: 42, 44: 42, 70: 42, 46: 46, 45: 45, 48: 48, 50: 50, 49: 49, 51: 51 };
// how much of the model's performance is used, per style: timing (fraction of the offset) and velocity blend
export const GROOVE_AMOUNT = { lofinature: { time: 0.8, vel: 0.6 }, neoclassical: { time: 0.5, vel: 0.6 }, folk: { time: 0.6, vel: 0.6 }, meditation: { time: 0.5, vel: 0.5 }, postrock: { time: 0.45, vel: 0.6 }, chiptune: { time: 0, vel: 0.3 }, triphop: { time: 0.85, vel: 0.7 }, reggae: { time: 0.6, vel: 0.6 }, baroque: { time: 0.4, vel: 0.5 }, eastasian: { time: 0.6, vel: 0.6 }, dnb: { time: 0.15, vel: 0.5 }, techno: { time: 0, vel: 0.4 }, blues: { time: 0.6, vel: 0.6 }, funk: { time: 0.2, vel: 0.65 }, pop: { time: 0.25, vel: 0.5 }, rock: { time: 0.45, vel: 0.6 }, metal: { time: 0.12, vel: 0.45 }, electronic: { time: 0, vel: 0.45 }, minimal: { time: 0.35, vel: 0.5 }, jazz: { time: 0.85, vel: 0.7 }, ambient: { time: 0.6, vel: 0.6 }, cinematic: { time: 0.5, vel: 0.6 }, epic: { time: 0.35, vel: 0.6 }, movie: { time: 0.5, vel: 0.6 }, lofi: { time: 0.9, vel: 0.7 }, bossa: { time: 0.5, vel: 0.6 }, synthwave: { time: 0, vel: 0.4 }, classical: { time: 0.5, vel: 0.6 } };
const MAX_OFFSET = 0.4; // of a sixteenth

export const grooveKey = score => JSON.stringify([score.style, Math.round(score.bpm * 100), score.notes.filter(n => n.layer === "perc" && !n.swell).map(n => [Math.round(n.t * 1000), n.midi, n.vel])]);

// Returns { key, hits: [[index into the perc hits, dt in beats, velocity]] }.
export async function grooveFor(score, model) {
  const spb = 60 / score.bpm, step = spb / SPQ;
  const perc = score.notes.filter(n => n.layer === "perc" && !n.swell && CLASS[n.midi] && n.t < score.body);
  const windows = Math.ceil(score.body / WINDOW), seqs = [];
  for (let w = 0; w < windows; w++) {
    // only hits that fall on one of the window's 32 sixteenth steps (rolls in 32nd notes can round
    // to step 32, which the model refuses); each hit lasts at most a quarter of a step
    const w0 = w * WINDOW, notes = perc.filter(n => n.t >= w0 && Math.round((n.t - w0) * SPQ) < WINDOW * SPQ)
      .map(n => ({ pitch: CLASS[n.midi], startTime: (n.t - w0) * spb, endTime: (n.t - w0) * spb + step / 4, velocity: n.vel, isDrum: true }));
    seqs.push({ notes, tempos: [{ time: 0, qpm: score.bpm }], totalTime: WINDOW * spb });
  }
  const outs = await model.humanize(seqs, score.bpm);
  const hits = [];
  perc.forEach((n, k) => {
    const w = Math.floor(n.t / WINDOW), rel = n.t - w * WINDOW, s = Math.round(rel * SPQ), out = outs[w];
    if (!out || s >= WINDOW * SPQ) return;
    const m = (out.notes || []).find(o => o.pitch === CLASS[n.midi] && Math.round(o.startTime / step) === s);
    if (!m) return;
    const off = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, (m.startTime - s * step) / step));
    hits.push([k, off / SPQ, m.velocity]);
  });
  return { key: grooveKey(score), hits };
}

// Applies a groove to the score's drums (in place), per the style's amounts.
export function applyGroove(score, groove) {
  const amt = GROOVE_AMOUNT[score.style] || { time: 0.5, vel: 0.6 };
  const perc = score.notes.filter(n => n.layer === "perc" && !n.swell && CLASS[n.midi] && n.t < score.body);
  for (const [k, dt, vel] of groove.hits) {
    const n = perc[k]; if (!n) continue;
    n.t = Math.max(0, n.t + dt * amt.time);
    n.vel = Math.max(1, Math.min(127, Math.round(n.vel + (vel - n.vel) * amt.vel)));
    n.groove = true;
  }
  score.notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  score.groove = { hits: groove.hits.length };
  return score;
}
