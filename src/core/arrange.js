// Orchestration: extra layers beyond melody, harmony, bass, pad and rhythm.
//
// Each extra layer has a role, and every role reads something of its own in the image, so each
// note still traces back to an area:
//   counter   a second gaze path through what the first one did not look at (1 − coverage)
//   ornament  small bright details (blobs and corners × brightness), each placed while the
//             gaze is nearest to it
//   ostinato  the texture of the current area, as a repeated figure on the chord
//   sustain   the large calm regions, as a held section chord that swells
//   double    the melody itself, an octave away, in the tense parts
//   drone     the background, as a tonic and fifth
//   pulse     the edges, as low pitched percussion (timpani, taiko) on a euclidean figure
// Arrangement rules keep it harmonious: every role has its own register, notes come from the
// sounding chord (or the melody), the more layers the less each one plays, and layers enter in
// turn as the dramatic arc rises (an orchestral crescendo) and thin out in the resolution.
// "Small" orchestration adds nothing: the piece is exactly the five-layer one.
import { clamp, clampInt, lerp } from "./util.js";
import { degMidi } from "./theory.js";
import { euclid, areaDrive } from "./rhythm.js";
import { gazePath } from "./focus.js";
import { detailsMap } from "./placement.js";
import { pathProfile, passage } from "./passages.js";

// gain: the layer's level in the mix, set from offline renders of the demos so that a counter-
// melody sits about 9 dB under the melody, the doubling 8 dB and the section 11 dB (RMS, Orchestral epic).
export const ROLES = {
  counter: { name: "Counter-melody", gain: 2.2, pan: -0.3, gm: 42, desc: "a second gaze path through what the first one missed" },
  ornament: { name: "Ornaments", gain: 1.0, pan: 0.35, gm: 9, desc: "small bright details, when the gaze is near them" },
  ostinato: { name: "Ostinato", gain: 0.6, pan: 0.2, gm: 45, desc: "the texture of the area, as a repeated figure" },
  sustain: { name: "Section", gain: 0.72, pan: 0, gm: 48, desc: "the large calm regions, as a held chord that swells" },
  double: { name: "Doubling", gain: 0.85, pan: -0.15, gm: 60, desc: "the melody an octave away, in the tense parts" },
  drone: { name: "Drone", gain: 0.45, pan: 0, gm: 89, desc: "the background, as tonic and fifth" },
  pulse: { name: "Pulse", gain: 0.5, pan: 0.1, gm: 47, desc: "the edges, as low pitched percussion" },
  runs: { name: "Runs", gain: 0.8, pan: 0.25, gm: 46, desc: "the path between points, as runs that link them" }
};
export const ROLE_COLOR = { counter: "#C77DDB", ornament: "#E6C84F", ostinato: "#5CC7D6", sustain: "#8FA5E8", double: "#F08A5D", drone: "#9AA8A0", pulse: "#D98A6C", runs: "#7FD18B" };

// Roles in order of priority per style (the first ones are added first).
export const STYLE_ROLES = {
  ambient: ["ornament", "drone", "runs", "counter", "sustain", "ostinato", "double"],
  cinematic: ["sustain", "counter", "runs", "ostinato", "ornament", "double", "pulse"],
  minimal: ["ostinato", "counter", "runs", "ornament", "pulse", "sustain", "double"],
  jazz: ["counter", "sustain", "runs", "ornament", "double", "ostinato", "drone"],
  electronic: ["ostinato", "sustain", "runs", "ornament", "counter", "pulse", "double"],
  epic: ["sustain", "double", "runs", "pulse", "counter", "ornament", "ostinato"],
  movie: ["ornament", "counter", "runs", "sustain", "ostinato", "double", "drone"],
  lofi: ["counter", "ornament", "runs", "drone", "ostinato", "sustain", "double"],
  bossa: ["counter", "ornament", "runs", "sustain", "double", "ostinato", "pulse"],
  synthwave: ["ostinato", "sustain", "runs", "counter", "ornament", "double", "pulse"],
  classical: ["counter", "sustain", "runs", "ornament", "double", "drone", "pulse"],
  pop: ["counter", "ornament", "runs", "sustain", "double", "ostinato", "pulse"],
  rock: ["sustain", "counter", "runs", "double", "ostinato", "ornament", "pulse"],
  metal: ["double", "sustain", "runs", "pulse", "counter", "ostinato", "ornament"],
  blues: ["counter", "sustain", "runs", "ornament", "double", "ostinato", "drone"],
  funk: ["ostinato", "counter", "sustain", "runs", "ornament", "double", "pulse"],
  lofinature: ["ornament", "counter", "sustain", "runs", "drone", "ostinato", "double"],
  neoclassical: ["sustain", "counter", "ornament", "runs", "drone", "double", "ostinato"],
  folk: ["counter", "ostinato", "runs", "sustain", "ornament", "double", "drone"],
  meditation: ["drone", "ornament", "sustain", "counter", "runs", "double", "ostinato"],
  postrock: ["sustain", "ostinato", "counter", "runs", "double", "pulse", "ornament"],
  chiptune: ["counter", "ostinato", "runs", "ornament", "double", "pulse", "sustain"],
  triphop: ["sustain", "counter", "ornament", "runs", "drone", "double", "ostinato"],
  reggae: ["ostinato", "counter", "sustain", "ornament", "runs", "double", "pulse"],
  baroque: ["counter", "runs", "sustain", "ornament", "double", "drone", "pulse"],
  eastasian: ["ornament", "counter", "drone", "runs", "sustain", "ostinato", "pulse"],
  dnb: ["sustain", "ostinato", "counter", "runs", "ornament", "pulse", "double"],
  techno: ["ostinato", "sustain", "pulse", "runs", "counter", "ornament", "double"]
};
// Instrument per style and role: sampled (when sampled instruments are on) and synthesized.
const SAMPLED = {
  ambient: { runs: "s.harp", counter: "s.flute", ornament: "s.glock", drone: "s.warmpad", sustain: "s.synthstrings", ostinato: "s.vibes", double: "s.flute", pulse: "s.timpani" },
  cinematic: { runs: "s.harp", counter: "s.cello", ornament: "s.celesta", sustain: "s.strings", ostinato: "s.pizz", double: "s.horn", pulse: "s.timpani", drone: "s.contrabass" },
  minimal: { runs: "s.marimba", ostinato: "s.marimba", counter: "s.clarinet", ornament: "s.glock", pulse: "s.marimba", sustain: "s.strings", double: "s.vibes", drone: "s.organ" },
  jazz: { runs: "s.vibes", counter: "s.tenorsax", sustain: "s.brass", ornament: "s.vibes", double: "s.trumpet", ostinato: "s.jazzgtr", drone: "s.organ", pulse: "s.vibes" },
  electronic: {},
  epic: { runs: "s.strings", sustain: "s.brass", double: "s.horn", pulse: "s.timpani", counter: "s.violin", ornament: "s.celesta", ostinato: "s.tremolo", drone: "s.contrabass" },
  movie: { runs: "s.harp", ornament: "s.celesta", counter: "s.cello", sustain: "s.strings", ostinato: "s.harp", double: "s.violin", drone: "s.contrabass", pulse: "s.timpani" },
  lofi: { runs: "s.vibes", counter: "s.tenorsax", ornament: "s.vibes", drone: "s.warmpad", ostinato: "s.nylon", sustain: "s.organ", double: "s.flute", pulse: "s.vibes" },
  bossa: { runs: "s.flute", counter: "s.tenorsax", ornament: "s.vibes", sustain: "s.strings", double: "s.flute", ostinato: "s.nylon", pulse: "s.marimba", drone: "s.contrabass" },
  synthwave: {},
  classical: { runs: "s.harp", counter: "s.violin", sustain: "s.strings", ornament: "s.flute", double: "s.oboe", drone: "s.contrabass", pulse: "s.timpani", ostinato: "s.pizz" },
  pop: { runs: "s.piano", counter: "s.cleangtr", ornament: "s.glock", sustain: "s.synthstrings", double: "s.flute", ostinato: "s.cleangtr", pulse: "s.fingerbass", drone: "s.warmpad" },
  blues: { runs: "s.piano", counter: "s.harmonica", sustain: "s.organ", ornament: "s.piano", double: "s.harmonica", ostinato: "s.jazzgtr", drone: "s.organ", pulse: "s.acbass" },
  funk: { ostinato: "s.clav", counter: "s.tenorsax", sustain: "s.brass", runs: "s.clav", ornament: "s.trumpet", double: "s.trumpet", pulse: "s.slapbass", drone: "s.organ" },
  rock: { runs: "s.overdrive", counter: "s.overdrive", sustain: "s.organ", double: "s.overdrive", ostinato: "s.cleangtr", ornament: "s.rockorgan", pulse: "s.pickbass", drone: "s.rockorgan" },
  lofinature: { runs: "s.nylon", counter: "s.flute", ornament: "s.glock", sustain: "s.warmpad", drone: "s.warmpad", ostinato: "s.kalimba", double: "s.flute", pulse: "s.marimba" },
  neoclassical: { runs: "s.piano", counter: "s.cello", ornament: "s.celesta", sustain: "s.strings", drone: "s.contrabass", ostinato: "s.pizz", double: "s.violin", pulse: "s.timpani" },
  folk: { runs: "s.banjo", counter: "s.fiddle", ornament: "s.recorder", sustain: "s.accordion", drone: "s.accordion", ostinato: "s.banjo", double: "s.recorder", pulse: "s.acbass" },
  meditation: { runs: "s.harp", counter: "s.panflute", ornament: "s.celesta", sustain: "s.choir", drone: "s.warmpad", ostinato: "s.kalimba", double: "s.panflute", pulse: "s.timpani" },
  postrock: { runs: "s.cleangtr", counter: "s.cleangtr", ornament: "s.glock", sustain: "s.strings", drone: "s.strings", ostinato: "s.tremolo", double: "s.overdrive", pulse: "s.timpani" },
  triphop: { runs: "s.wurli", counter: "s.mutedtpt", ornament: "s.vibes", sustain: "s.strings", drone: "s.strings", ostinato: "s.wurli", double: "s.mutedtpt", pulse: "s.synthbass" },
  reggae: { runs: "s.organ", counter: "s.trumpet", ornament: "s.glock", sustain: "s.organ", drone: "s.organ", ostinato: "s.organ", double: "s.trombone", pulse: "s.fingerbass" },
  baroque: { runs: "s.harpsichord", counter: "s.violin", ornament: "s.recorder", sustain: "s.strings", drone: "s.organ", ostinato: "s.pizz", double: "s.oboe", pulse: "s.timpani" },
  eastasian: { runs: "s.koto", counter: "s.shakuhachi", ornament: "s.kalimba", sustain: "s.strings", drone: "s.strings", ostinato: "s.koto", double: "s.panflute", pulse: "s.timpani" },
  metal: { runs: "s.overdrive", counter: "s.overdrive", sustain: "s.choir", double: "s.overdrive", ostinato: "s.distortion", ornament: "s.celesta", pulse: "s.timpani", drone: "s.choir" }
};
// synthesizer styles take their own sounds for some roles
const STYLE_SYNTH = { chiptune: { counter: "chiptune.lead", ostinato: "chiptune.harm", runs: "chiptune.harm", sustain: "chiptune.pad", pulse: "chiptune.bass", double: "chiptune.lead", ornament: "chiptune.harm" }, techno: { ostinato: "techno.lead", sustain: "techno.harm", pulse: "techno.bass", drone: "techno.pad" }, dnb: { counter: "dnb.lead", sustain: "dnb.harm", pulse: "dnb.bass", drone: "dnb.pad" }, electronic: { ostinato: "electronic.lead", sustain: "electronic.pad", pulse: "electronic.bass" }, synthwave: { ostinato: "synthwave.harm", sustain: "synthwave.pad", pulse: "synthwave.bass", counter: "x.synthlead" } };
const SYNTH = { runs: "x.glass", counter: "x.softlead", ornament: "x.glass", ostinato: "x.keys", sustain: "x.brass", double: "x.warmlead", drone: "x.sine", pulse: "x.keys" };
// Each style's band: the instruments Add layer offers first, each with the role it plays (what it
// reads in the image and how). Synthesizer styles list their own sounds.
export const STYLE_BAND = {
  lofinature: [["s.nylon", "runs"], ["s.flute", "counter"], ["s.kalimba", "ostinato"], ["s.glock", "ornament"], ["s.vibes", "ornament"], ["s.warmpad", "sustain"], ["s.cello", "counter"], ["s.marimba", "pulse"]],
  neoclassical: [["s.strings", "sustain"], ["s.cello", "counter"], ["s.violin", "double"], ["s.piano", "runs"], ["s.celesta", "ornament"], ["s.pizz", "ostinato"], ["s.contrabass", "drone"], ["s.horn", "double"]],
  folk: [["s.fiddle", "counter"], ["s.banjo", "ostinato"], ["s.recorder", "ornament"], ["s.accordion", "sustain"], ["s.harmonica", "counter"], ["s.acgtr", "runs"], ["s.flute", "double"], ["s.acbass", "pulse"]],
  meditation: [["s.panflute", "counter"], ["s.celesta", "ornament"], ["s.kalimba", "ostinato"], ["s.harp", "runs"], ["s.choir", "sustain"], ["s.warmpad", "drone"], ["s.glock", "ornament"], ["x.glass", "ornament"]],
  postrock: [["s.cleangtr", "counter"], ["s.tremolo", "ostinato"], ["s.strings", "sustain"], ["s.overdrive", "double"], ["s.glock", "ornament"], ["s.piano", "runs"], ["s.horn", "double"], ["s.timpani", "pulse"]],
  chiptune: [["chiptune.lead", "counter"], ["chiptune.harm", "ostinato"], ["chiptune.pad", "sustain"], ["x.glass", "ornament"], ["chiptune.bass", "pulse"], ["x.sine", "drone"]],
  triphop: [["s.mutedtpt", "counter"], ["s.wurli", "runs"], ["s.vibes", "ornament"], ["s.strings", "sustain"], ["s.cello", "counter"], ["s.mutedgtr", "ostinato"], ["s.synthbass", "pulse"], ["x.glass", "ornament"]],
  reggae: [["s.organ", "ostinato"], ["s.trumpet", "counter"], ["s.trombone", "double"], ["s.tenorsax", "counter"], ["s.mutedgtr", "ostinato"], ["s.glock", "ornament"], ["s.fingerbass", "pulse"]],
  baroque: [["s.violin", "counter"], ["s.harpsichord", "runs"], ["s.oboe", "double"], ["s.recorder", "ornament"], ["s.cello", "counter"], ["s.strings", "sustain"], ["s.organ", "drone"], ["s.pizz", "ostinato"]],
  eastasian: [["s.shakuhachi", "counter"], ["s.koto", "runs"], ["s.panflute", "double"], ["s.kalimba", "ornament"], ["s.strings", "sustain"], ["s.koto", "ostinato"], ["s.timpani", "pulse"]],
  dnb: [["dnb.lead", "counter"], ["dnb.harm", "sustain"], ["s.synthstrings", "sustain"], ["x.glass", "ornament"], ["dnb.bass", "pulse"], ["x.synthlead", "double"], ["s.vibes", "ornament"]],
  techno: [["techno.lead", "ostinato"], ["techno.harm", "sustain"], ["techno.bass", "pulse"], ["x.synthlead", "counter"], ["x.glass", "ornament"], ["techno.pad", "drone"]],
  ambient: [["s.harp", "runs"], ["s.flute", "counter"], ["s.glock", "ornament"], ["s.celesta", "ornament"], ["s.vibes", "ostinato"], ["s.synthstrings", "sustain"], ["s.choir", "sustain"], ["s.warmpad", "drone"], ["x.wavepad", "sustain"], ["x.glass", "ornament"]],
  cinematic: [["s.strings", "sustain"], ["s.cello", "counter"], ["s.violin", "counter"], ["s.harp", "runs"], ["s.pizz", "ostinato"], ["s.tremolo", "ostinato"], ["s.horn", "double"], ["s.celesta", "ornament"], ["s.choir", "sustain"], ["s.timpani", "pulse"], ["s.contrabass", "drone"]],
  minimal: [["s.marimba", "ostinato"], ["s.vibes", "ostinato"], ["s.clarinet", "counter"], ["s.flute", "counter"], ["s.piano", "runs"], ["s.glock", "ornament"], ["s.celesta", "ornament"], ["s.strings", "sustain"], ["s.organ", "drone"]],
  jazz: [["s.tenorsax", "counter"], ["s.trumpet", "double"], ["s.trombone", "counter"], ["s.clarinet", "counter"], ["s.flute", "double"], ["s.vibes", "ornament"], ["s.piano", "runs"], ["s.jazzgtr", "ostinato"], ["s.brass", "sustain"], ["s.organ", "drone"]],
  electronic: [["electronic.lead", "ostinato"], ["electronic.harm", "ostinato"], ["x.synthlead", "counter"], ["electronic.pad", "sustain"], ["x.wavepad", "sustain"], ["x.glass", "ornament"], ["electronic.bass", "pulse"], ["x.sine", "drone"]],
  epic: [["s.brass", "sustain"], ["s.strings", "runs"], ["s.horn", "double"], ["s.trumpet", "double"], ["s.violin", "counter"], ["s.cello", "counter"], ["s.trombone", "counter"], ["s.tremolo", "ostinato"], ["s.choir", "sustain"], ["s.celesta", "ornament"], ["s.timpani", "pulse"], ["s.contrabass", "drone"]],
  movie: [["s.strings", "sustain"], ["s.cello", "counter"], ["s.violin", "double"], ["s.flute", "counter"], ["s.oboe", "counter"], ["s.horn", "double"], ["s.harp", "runs"], ["s.piano", "runs"], ["s.celesta", "ornament"], ["s.timpani", "pulse"], ["s.contrabass", "drone"]],
  lofi: [["s.tenorsax", "counter"], ["s.flute", "double"], ["s.vibes", "ornament"], ["s.wurli", "runs"], ["s.nylon", "ostinato"], ["s.jazzgtr", "ostinato"], ["s.organ", "sustain"], ["s.warmpad", "drone"]],
  bossa: [["s.flute", "counter"], ["s.tenorsax", "counter"], ["s.trombone", "counter"], ["s.clarinet", "double"], ["s.nylon", "ostinato"], ["s.piano", "runs"], ["s.vibes", "ornament"], ["s.strings", "sustain"], ["s.marimba", "pulse"]],
  synthwave: [["synthwave.harm", "ostinato"], ["x.synthlead", "counter"], ["synthwave.lead", "double"], ["synthwave.pad", "sustain"], ["s.synthstrings", "sustain"], ["x.brass", "sustain"], ["x.glass", "ornament"], ["synthwave.bass", "pulse"]],
  classical: [["s.violin", "counter"], ["s.cello", "counter"], ["s.clarinet", "counter"], ["s.flute", "ornament"], ["s.oboe", "double"], ["s.horn", "double"], ["s.harp", "runs"], ["s.pizz", "ostinato"], ["s.strings", "sustain"], ["s.contrabass", "drone"], ["s.timpani", "pulse"]],
  pop: [["s.cleangtr", "ostinato"], ["s.mutedgtr", "ostinato"], ["s.piano", "runs"], ["x.synthlead", "counter"], ["s.flute", "double"], ["s.glock", "ornament"], ["s.synthstrings", "sustain"], ["s.strings", "sustain"], ["s.fingerbass", "pulse"]],
  rock: [["s.overdrive", "counter"], ["s.distortion", "double"], ["s.cleangtr", "ostinato"], ["s.organ", "sustain"], ["s.rockorgan", "ornament"], ["s.piano", "runs"], ["s.strings", "sustain"], ["s.pickbass", "pulse"]],
  metal: [["s.overdrive", "counter"], ["s.distortion", "ostinato"], ["s.overdrive", "double"], ["s.choir", "sustain"], ["s.strings", "sustain"], ["s.organ", "drone"], ["s.celesta", "ornament"], ["s.timpani", "pulse"]],
  blues: [["s.harmonica", "counter"], ["s.tenorsax", "counter"], ["s.overdrive", "counter"], ["s.trumpet", "double"], ["s.trombone", "counter"], ["s.piano", "runs"], ["s.jazzgtr", "ostinato"], ["s.organ", "sustain"], ["s.acbass", "pulse"]],
  funk: [["s.clav", "ostinato"], ["s.mutedgtr", "ostinato"], ["s.tenorsax", "counter"], ["s.trumpet", "double"], ["s.trombone", "counter"], ["s.brass", "sustain"], ["s.organ", "sustain"], ["s.wurli", "runs"], ["s.slapbass", "pulse"]]
};
// The role an instrument plays when it is not in the style's band: from its name and family.
export function roleFor(key, v = {}) {
  const n = ((v.name || "") + " " + key).toLowerCase(), f = (v.family || v.type || "").toLowerCase();
  if (/timpani|taiko|drum|tom|perc|woodblock|steel|agogo|bass/.test(n) && !/bassoon|clarinet/.test(n)) return "pulse";
  if (/pad|choir|voice|strings|ensemble|organ|brass section|section|swell/.test(n) || f === "pad") return "sustain";
  if (/glock|celesta|bell|chime|music box|tinkle|kalimba|crystal/.test(n)) return "ornament";
  if (/harp|piano|marimba|xylo|vibra|dulcimer/.test(n)) return "runs";
  if (/guitar|clav|koto|sitar|banjo|shamisen|pizz|pluck/.test(n) || f === "pluck") return "ostinato";
  if (/drone|sine|pure|bagpipe|accordion|harmonium/.test(n)) return "drone";
  return "counter";
}
export const roleInstrument = (style, role, samples) => (samples && SAMPLED[style] && SAMPLED[style][role]) || (STYLE_SYNTH[style] && STYLE_SYNTH[style][role]) || SYNTH[role];

// Registers (MIDI) relative to the melody's base note, so the roles don't cover each other.
const REGISTER = { runs: [0, 19], counter: [-12, 2], ornament: [12, 26], ostinato: [-5, 10], sustain: [-5, 14], drone: [-24, -12], pulse: [-27, -14] };

export const ORCHESTRATION = { small: "Small", medium: "Medium", full: "Full", custom: "Custom" };

/*
 * The extra layers of an orchestration level, deterministic from the style and the image:
 * Medium adds 2-3, Full 4-6, more for richer images (entropy, edges, number of places).
 */
export function autoLayers(style, level, richness, samples) {
  if (level !== "medium" && level !== "full") return [];
  const n = level === "medium" ? 2 + Math.round(clamp(richness)) : 4 + Math.round(2 * clamp(richness));
  // the same instrument twice is replaced by the next one in the style's band with that role
  const used = new Set();
  return (STYLE_ROLES[style] || STYLE_ROLES.ambient).slice(0, n).map((role, i) => {
    let preset = roleInstrument(style, role, samples);
    if (used.has(preset) && samples) { const alt = (STYLE_BAND[style] || []).find(([k, r]) => r === role && !used.has(k)); if (alt) preset = alt[0]; }
    used.add(preset);
    return { id: "x" + (i + 1), role, preset };
  });
}
export const richnessOf = (A, places) => clamp(0.4 * A.global.entropy + 0.3 * A.global.edgeN + 0.3 * Math.min(1, places / 10));

// Entry threshold of the k-th extra layer (0-based) out of n: they join one by one as the tension rises.
// buildUp (Advanced: composition, 0-1): 0 brings every layer in at once, 1 only at the climax
const entryOf = (k, n, b = 0.5) => 0.84 * b + (0.76 * b * k) / Math.max(1, n);
const PCS = m => ((m % 12) + 12) % 12;
const nearestIn = (pcs, target, lo, hi) => {
  let best = null;
  for (let m = lo; m <= hi; m++) if (pcs.has(PCS(m)) && (best === null || Math.abs(m - target) < Math.abs(best - target))) best = m;
  return best;
};

/*
 * Notes of the extra layers. ctx: { layers, A, sal, cov, points (composed), slots, body, cadenceT,
 * modeIv, pcOff, baseLead, scalePcs, leadNotes, inst (per layer id), newId, spb }.
 * Returns notes (layer = the layer id, point = the focus point sounding at that time).
 */
export function extraNotes(ctx) {
  const { layers, A, sal, cov, points, slots, body, baseLead, inst, modeIv, pcOff } = ctx, n = layers.length, notes = [];
  if (!n || !points.length || !slots.length) return notes;
  const pointAt = t => points.find(F => t >= F.t0 - 1e-9 && t < F.t1 - 1e-9) || points[points.length - 1];
  const density = 1 / (1 + 0.22 * (n - 1));
  const leadAt = t => ctx.leadNotes.find(x => t >= x.t - 1e-9 && t < x.t + x.dur - 1e-9);
  const seen = {};
  layers.forEach((L, k) => {
    // a second layer with the same role plays it differently: another path, another register, off-beat
    const dup = (seen[L.role] = (seen[L.role] ?? -1) + 1);
    const reg = role => { const [a, b] = REGISTER[role], sh = !dup ? 0 : role === "drone" || role === "pulse" || role === "ornament" ? 12 : -12; return [baseLead + a + sh, baseLead + b + sh]; };
    const role = L.role, R = ROLES[role], tim = inst[L.id], thr = entryOf(k, n, ctx.buildUp ?? 0.5), add = (t, dur, midi, vel, extra = {}) =>
      notes.push({ layer: L.id, t, dur: Math.max(0.1, dur), midi, vel: clampInt(Math.round(vel), 1, 127), tim, pan: R.pan, point: pointAt(t).idx, ...extra });
    // a layer plays a slot when its point's tension has reached its entry (drone and ornaments also stay in the resolution)
    // an instrument added by an Expert rule plays wherever its rule applies (its notes are cut to those places later)
    const active = S => { if (L.only) return true; const F = S.F; return F.tension >= thr - 1e-9 && !(F.section === "resolution" && role !== "drone" && role !== "ornament" && F.tension < thr + 0.1); };
    if (role === "counter") {
      // the second path: the attention map where the first path did not look
      const map2 = new Float32Array(sal.map.length);
      for (let i = 0; i < map2.length; i++) map2[i] = sal.map[i] * (1 - (cov ? cov.map[i] : 0));
      const m = Math.max(3, Math.min(12, slots.length));
      const path = gazePath(A, map2, { count: m, returns: 0, inhibition: 0.2, memory: 0, seed: dup, radius: 0.06 }, []).map(q => ({ ...q, id: undefined }));
      const [lo, hi] = reg("counter");
      let prev = null;
      slots.forEach((S, si) => {
        if (!active(S)) { prev = null; return; }
        const q = path[si % path.length], target = lo + (1 - q.y) * (hi - lo), step = S.F.tension > 0.78 ? 1 : 2;
        for (let t = S.t0; t < S.t1 - 1e-9; t += step) {
          const ln = leadAt(t);
          let m = nearestIn(S.pcs, prev === null ? target : lerp(prev, target, 0.35), lo, hi);
          if (m === null) continue;
          if (ln && PCS(ln.midi) === PCS(m)) m = nearestIn(new Set([...S.pcs].filter(p => p !== PCS(ln.midi))), m, lo, hi) ?? m;
          add(t, Math.min(step, S.t1 - t) * 0.98, m, 80 * density + 22, { src: { x: q.x, y: q.y } });
          prev = m;
        }
      });
    } else if (role === "ornament") {
      // bright small details: blobs and corners weighted by brightness, the strongest peaks
      const det = detailsMap(A), W = A.W, H = A.H, diag = Math.hypot(W, H), peaks = [];
      const score = new Float32Array(det.length); for (let i = 0; i < det.length; i++) score[i] = det[i] * (0.3 + 0.7 * A.L[i]);
      const want = Math.max(2, Math.round((body / 4) * 1.2 * density));
      const order = [...score.keys()].sort((a, b) => score[b] - score[a] || a - b);
      for (const i of order) {
        if (peaks.length >= want) break;
        const x = i % W, y = (i / W) | 0;
        if (peaks.every(p => Math.hypot(p.x - x, p.y - y) > 0.08 * diag)) peaks.push({ x, y, v: score[i] });
      }
      const [lo, hi] = reg("ornament"), used = new Map();
      for (const p of peaks) {
        // the point of the path nearest to the detail, and an off-beat inside it
        let F = points[0], bd = Infinity;
        for (const G of points) { const d = Math.hypot(G.x * W - p.x, G.y * H - p.y); if (d < bd) { bd = d; F = G; } }
        const c = used.get(F.idx) || 0; if (c >= 2) continue;
        const t = F.t0 + 0.5 + c + (dup ? 0.25 : 0); if (t >= F.t1 - 0.25) continue;
        const S = slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1];
        if (!active(S) && F.tension < thr) continue;
        const m = nearestIn(S.pcs, lo + (1 - p.y / H) * (hi - lo), lo, hi); if (m === null) continue;
        used.set(F.idx, c + 1);
        add(t, 0.75, m, 50 + 40 * clamp(p.v) * density, { src: { x: (p.x + 0.5) / W, y: (p.y + 0.5) / H } });
      }
    } else if (role === "ostinato") {
      const [lo, hi] = reg("ostinato");
      slots.forEach(S => {
        if (!active(S) || S.F.section === "intro") return;
        const sorted = [...S.chord].sort((a, b) => a - b), root = nearestIn(new Set([PCS(sorted[0])]), (lo + hi) / 2 - 4, lo, hi) ?? sorted[0];
        const fifth = nearestIn(new Set([PCS(sorted.find(x => PCS(x - sorted[0]) === 7) ?? sorted[sorted.length - 1])]), root + 7, root, root + 12) ?? root + 7;
        // eighths; sixteenths only in a slow piece at a very tense moment with few layers (fast
        // sixteenths on a plucked instrument over a full arrangement only rattle)
        const fig = [root, fifth, root + 12, fifth], rate = S.F.tension > 0.85 && density > 0.75 && (ctx.bpm || 120) <= 100 ? 0.25 : 0.5;
        let j = 0;
        // a second ostinato answers the first: the figure turned around
        const f2 = dup % 2 ? [fig[2], fig[1], fig[0], fig[1]] : fig;
        for (let t = S.t0; t < S.t1 - 1e-9; t += rate, j++) add(t, rate * 0.85, f2[j % 4], (j % 4 === 0 ? 60 : 44) * (0.6 + 0.4 * density));
      });
    } else if (role === "sustain") {
      const [lo, hi] = reg("sustain");
      let prev = null;
      slots.forEach(S => {
        if (!active(S)) { prev = null; return; }
        const voices = [...S.pcs].slice(0, 3).map((pc, i) => nearestIn(new Set([pc]), prev ? prev[i] ?? (lo + hi) / 2 : lo + 4 + 4 * i, lo, hi)).filter(x => x !== null);
        voices.forEach(m => add(S.t0, S.t1 - S.t0, m, 58 * (0.7 + 0.3 * density), { swell: true }));
        prev = voices;
      });
    } else if (role === "drone") {
      // never below C2: lower, a drone only muddies the bass
      const [lo, hi] = reg("drone"), t0n = nearestIn(new Set([PCS(degMidi(0, modeIv, 60 + pcOff))]), lo + 4, lo, hi), tonic = t0n === null ? null : t0n + 12 * Math.max(0, Math.ceil((36 - t0n) / 12)), fifth = tonic + 7;
      // held across the chords, but a drone note a semitone from a tone of the chord over it (the
      // fifth under the sixth degree, the tonic under the leading tone) rests for that chord
      const rubs = (p, S) => S.pcs.has(PCS(p + 1)) || S.pcs.has(PCS(p - 1));
      const open = {};
      const close = m => { const o = open[m]; if (o) { add(o.t, o.end - o.t, m, o.vel); delete open[m]; } };
      for (const S of slots) {
        const on = active(S) || S.F.tension >= thr - 0.1;
        for (const [m, v] of [[tonic, 44], [fifth, 36]]) {
          if (!on || (rubs(m, S) && !S.pcs.has(PCS(m)))) { close(m); continue; }
          if (open[m] && Math.abs(open[m].end - S.t0) < 1e-9) open[m].end = Math.min(body, S.t1);
          else { close(m); open[m] = { t: S.t0, end: Math.min(body, S.t1), vel: v * (0.7 + 0.3 * density) }; }
        }
      }
      close(tonic); close(fifth);
    } else if (role === "runs") {
      // the path between consecutive points, as a run from one chord to the next (passages.js)
      const [lo, hi] = reg("runs"), slotAt = t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1];
      for (let i = 0; i + 1 < points.length; i++) {
        const F = points[i], G = points[i + 1], S = slotAt(F.t1 - 0.01), S2 = slotAt(G.t0 + 0.01);
        if (!active(S)) continue;
        const prof = pathProfile(A, F, G), win = Math.min(2, F.dur - 0.5);
        if (prof.len < 0.18 || win < 0.5) continue;
        const from = nearestIn(S.pcs, (lo + hi) / 2 - 2, lo, hi), to = nearestIn(S2.pcs, from + (G.y < F.y ? 5 : -5), lo, hi);
        if (from === null || to === null) continue;
        const ps = passage(from, to, F.t1 - win, F.t1, prof, density > 0.6 ? "rich" : "light", ctx.style, ctx.modePcs, t => slotAt(t).pcs);
        for (const x of ps) add(x.t, x.dur, x.midi, 52 + 30 * x.f, { passage: { from: i, to: i + 1, f: x.f }, ...(x.chromatic ? { chromatic: true } : {}) });
        // the run lands: its arrival note on the next point's first beat, a chord tone there
        if (ps.length) add(G.t0, Math.min(1, G.dur), to, 70, { passage: { from: i, to: i + 1, f: 1 } });
      }
    } else if (role === "pulse") {
      const [lo, hi] = reg("pulse");
      slots.forEach(S => {
        if (!active(S) || S.F.section === "intro") return;
        // on the eighths only (a low drum on odd sixteenths sounds clumsy), at most four a bar
        const a = areaDrive(S.F), hits8 = euclid(Math.min(4, Math.round(lerp(2, 4, S.F.tension) * (0.6 + 0.4 * density))), 8, Math.round((a.rot + dup * 2) / 2));
        const hits = Array.from({ length: 16 }, (_, q) => q % 2 === 0 && hits8[q / 2]);
        const root = nearestIn(new Set([PCS([...S.chord].sort((x, y) => x - y)[0])]), (lo + hi) / 2, lo, hi);
        if (root === null) return;
        // the other hits take the chord tone nearest a fifth above (a diminished chord has no perfect fifth)
        const up = nearestIn(new Set([...S.pcs].filter(p => p !== PCS(root))), root + 7, root + 1, hi) ?? root;
        for (let j = Math.round(S.t0 * 4); j < Math.round(S.t1 * 4); j++) if (hits[((j % 16) + 16) % 16]) add(j / 4, 0.5, j % 16 === 0 ? root : up, j % 16 === 0 ? 80 : 60);
      });
    }
  });
  return notes;
}

// Doubling: the melody an octave below (above if that leaves the register) in the slots where
// the doubling layer is active. Run after the melody is final (also after a neural melody).
export function doubleNotes(score) {
  const layers = score.extra || [], DL = layers.filter(x => x.role === "double"), notes = score.notes, ids = new Set(DL.map(L => L.id));
  for (let i = notes.length - 1; i >= 0; i--) if (ids.has(notes[i].layer)) notes.splice(i, 1);
  if (!DL.length) return score;
  const lead = notes.filter(nn => nn.layer === "lead" && nn.point >= 0 && !nn.dbl && nn.t < score.body);
  // the first doubling an octave below (above if that leaves the register), the next on the other side
  DL.forEach((L, d) => {
  const k = layers.indexOf(L), thr = entryOf(k, layers.length, score.buildUp ?? 0.5);
  for (const nn of lead) {
    const F = score.points[nn.point];
    if (!F || (!L.only && F.tension < thr)) continue;
    const below = nn.midi - 12 >= 48, m = (d % 2 === 0) === below ? nn.midi - 12 : nn.midi + 12;
    notes.push({ layer: L.id, t: nn.t, dur: nn.dur, midi: m, vel: Math.max(1, Math.round(nn.vel * 0.7)), tim: (F.timX && F.timX[L.id]) || score.inst[L.id], pan: ROLES.double.pan, point: nn.point, ...(nn.chromatic ? { chromatic: true } : {}) });
  }
  });
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return score;
}

// Cadence notes of the extra layers (the tonic chord, in each role's register).
export function cadenceExtra(layers, cadChord, baseLead, tc, holdFor, inst) {
  const out = [], pcs = new Set(cadChord.map(PCS));
  for (const L of layers) {
    const role = L.role, R = REGISTER[role]; if (!R || role === "pulse" || role === "ostinato") continue;
    const lo = baseLead + R[0], hi = baseLead + R[1], tim = inst[L.id];
    const ms = role === "sustain" ? [...pcs].slice(0, 3).map((pc, i) => nearestIn(new Set([pc]), lo + 4 + 4 * i, lo, hi)) : role === "drone" ? [(m => (m === null ? m : m + 12 * Math.max(0, Math.ceil((36 - m) / 12))))(nearestIn(new Set([PCS(cadChord[0])]), lo + 4, lo, hi))] : [nearestIn(pcs, (lo + hi) / 2, lo, hi)];
    for (const m of ms) if (m !== null) out.push({ layer: L.id, t: tc, dur: holdFor(tim), midi: m, vel: role === "ornament" ? 50 : 54, tim, pan: ROLES[role].pan, point: -2 });
  }
  return out;
}
