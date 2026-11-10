// The generated intro (Piece › Advanced: composition › Intro): one or two bars before the first
// place, built from the whole picture like the ending is. The key's tonic chord grows out of silence
// on the pad, the harmony and the bass come in on the last bar, a short lead-in steps into the
// melody's first note, and the rhythm prepares the entrance in the style's way: a swell (cymbal,
// riser or timpani) in film and electronic styles, a count-in on the hi-hat or sticks in band
// styles, a soft ride in swung ones, nothing in the calm ones.
const CALM = new Set(["ambient", "classical", "minimal", "movie", "lofinature", "neoclassical", "meditation", "baroque", "eastasian"]);
const COUNT_IN = new Set(["rock", "metal", "pop", "funk", "chiptune", "folk"]);
const SWUNG = new Set(["jazz", "lofi", "bossa", "blues", "reggae", "triphop"]);
const pc = m => ((m % 12) + 12) % 12;

// ctx: { I (beats), style, R (genre rules), tonicChord, bass, padChord, firstLead, scalePcs, tim: { lead, harm, bass, pad }, padVel }
export function introNotes(ctx) {
  const { I, style, R, tim } = ctx, out = [], last = Math.max(0, I - 4), P = -3;
  // the pad: the tonic chord, growing from silence over the whole intro
  for (const m of ctx.padChord) out.push({ layer: "pad", t: 0, dur: I, midi: m, vel: Math.max(1, Math.round((ctx.padVel || 50) * 0.85)), tim: tim.pad, pan: 0, point: P, swell: true, intro: true });
  // the harmony and the bass on the last bar of the intro
  for (const m of ctx.tonicChord) out.push({ layer: "harm", t: last, dur: (I - last) * 0.96, midi: m, vel: 42, tim: tim.harm, pan: 0, point: P, swell: true, intro: true });
  out.push({ layer: "bass", t: last, dur: (I - last) * 0.96, midi: ctx.bass, vel: CALM.has(style) ? 52 : 66, tim: tim.bass, pan: 0, point: P, intro: true });
  // a lead-in: scale steps from below into the melody's first note (one note in the calm styles)
  const L = ctx.firstLead;
  if (L) {
    const steps = [], scale = ctx.scalePcs;
    for (let m = L.midi - 1; m >= L.midi - 7 && steps.length < 2; m--) if (scale.has(pc(m))) steps.push(m);
    const lead = CALM.has(style) ? [{ t: I - 1, dur: 0.9, midi: steps[0] }] : [{ t: I - 1, dur: 0.45, midi: steps[1] ?? steps[0] }, { t: I - 0.5, dur: 0.45, midi: steps[0] }];
    // the lead-in grows into the first note: each step a little louder, the last one about three
    // quarters of that note's loudness (a fixed soft lead-in before a loud first note made a jump)
    const v1 = L.vel || 80, grow = lead.length > 1 ? [0.6, 0.78] : [0.8];
    lead.forEach((x, k) => { if (x.midi !== undefined && x.t >= 0) out.push({ layer: "lead", t: x.t, dur: x.dur, midi: x.midi, vel: Math.max(36, Math.min(100, Math.round(v1 * grow[k]))), tim: tim.lead, pan: 0, point: P, pickup: true, intro: true }); });
  }
  // the rhythm's way in
  if (COUNT_IN.has(style)) for (let b = 0; b < 4; b++) out.push({ layer: "perc", t: last + b, dur: 0.1, midi: style === "metal" || style === "rock" ? 42 : 37, vel: b === 0 ? 74 : 62, point: P, intro: true });
  else if (SWUNG.has(style)) { out.push({ layer: "perc", t: last + 1, dur: 0.2, midi: 51, vel: 46, point: P, intro: true }); out.push({ layer: "perc", t: last + 3, dur: 0.2, midi: 51, vel: 50, point: P, intro: true }); }
  else if (!CALM.has(style) || R.swell) { const len = Math.min(I, 4); out.push({ layer: "perc", t: I - len, dur: len, midi: 49, vel: 64, point: P, swell: R.swell || "cymbal", intro: true }); }
  return out;
}
