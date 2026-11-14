// Instrument library and the texture wavetable.
//
// Every style instrument is a preset; a few more are added. Any preset can be used on
// any pitched layer, and its parameters can be edited. The texture wavetable ("wave")
// takes its waveform from the image: the luminance profile through each focus point.
import FFT from "fft.js";
import { STYLES, LAYERS } from "./theory.js";

const extra = {
  "x.glass": { type: "fm", name: "Glass bell", a: 0.003, d: 1.8, s: 0.25, r: 1.6, cut: 9000, q: 0.7, col: 0.45, ratio: 4 },
  "x.keys": { type: "fm", name: "Warm keys", a: 0.008, d: 1.2, s: 0.4, r: 0.8, cut: 3000, q: 0.7, col: 0.2, ratio: 1 },
  "x.sine": { type: "pad", name: "Pure tone", a: 0.02, d: 0.5, s: 0.9, r: 0.4, cut: 12000, q: 0.5, col: 0, det: 0 },
  "x.brass": { type: "pad", name: "Soft brass", a: 0.08, d: 0.6, s: 0.8, r: 0.4, cut: 1800, q: 1.4, col: 0.85, det: 5 },
  "x.nylon": { type: "pluck", name: "Nylon string", a: 0.004, d: 2.0, s: 0.7, r: 0.4, cut: 2200, q: 0.7, col: 0.3 },
  "x.wave": { type: "wave", name: "Texture wavetable", a: 0.01, d: 0.6, s: 0.75, r: 0.6, cut: 6000, q: 0.8, col: 0.5 },
  "x.wavepad": { type: "wave", name: "Texture pad", a: 0.9, d: 1.0, s: 0.85, r: 1.8, cut: 2500, q: 0.7, col: 0.35 },
  // sustained leads: the default melody instrument of the Story melody (long, tied notes).
  // vib: delayed vibrato depth in cents. lvl scales their amplitude: measured on offline renders of the demos, a sustained lead
  // at full level is 2-11 dB above the plucked default in RMS and would cover the mix.
  "x.softlead": { type: "pad", name: "Soft lead", a: 0.06, d: 0.8, s: 0.8, r: 0.6, cut: 2200, q: 0.8, col: 0.12, det: 3, lvl: 0.55, vib: 10 },
  "x.warmlead": { type: "fm", name: "Warm lead", a: 0.03, d: 2.5, s: 0.7, r: 0.5, cut: 3000, q: 0.7, col: 0.15, ratio: 1, lvl: 0.4, vib: 8 },
  "x.synthlead": { type: "pad", name: "Synth lead", a: 0.015, d: 0.5, s: 0.75, r: 0.25, cut: 3200, q: 2.5, col: 0.75, det: 7, lvl: 0.6, vib: 6 }
};

// Sampled instruments (smplr, src/audio/samples.js). src names the samples; fb is the synthesized
// type used until they load (or if they can't), with the same envelope and filter values, which
// the image modulates as usual (cutoff, release and velocity reach the samples).
const SF = (name, instrument, fb, p = {}) => ({ type: "sample", name, src: { kind: "sf", instrument }, fb, a: 0.01, d: 0.8, s: 0.8, r: 0.6, cut: 9000, q: 0.7, col: 0.35, det: 6, ratio: 1, ...p });
const VOX = (name, instrument, range, p = {}) => ({ type: "sample", name, family: "Voices", src: { kind: "mellotron", instrument }, fb: "pad", range, a: 0.2, d: 0.8, s: 0.85, r: 1.0, cut: 7000, q: 0.7, col: 0.15, det: 6, ratio: 1, vib: 0, ...p });
const SAMPLED = {
  "s.piano": { type: "sample", name: "Grand piano (Steinway)", src: { kind: "piano" }, fb: "fm", a: 0.004, d: 2.6, s: 0.15, r: 0.9, cut: 12000, q: 0.6, col: 0.12, ratio: 1 },
  "s.wurli": { type: "sample", name: "Wurlitzer EP200", src: { kind: "epiano", instrument: "WurlitzerEP200" }, fb: "fm", a: 0.004, d: 1.2, s: 0.3, r: 0.5, cut: 9000, q: 0.7, col: 0.4, ratio: 1 },
  "s.cp80": { type: "sample", name: "Yamaha CP80", src: { kind: "epiano", instrument: "CP80" }, fb: "fm", a: 0.004, d: 1.6, s: 0.25, r: 0.6, cut: 10000, q: 0.7, col: 0.3, ratio: 1 },
  "s.strings": SF("String ensemble", "string_ensemble_1", "pad", { a: 0.2, r: 0.9, col: 0.6, det: 10 }),
  "s.synthstrings": SF("Synth strings", "synth_strings_1", "pad", { a: 0.4, r: 1.4, col: 0.5, det: 12 }),
  "s.tremolo": SF("Tremolo strings", "tremolo_strings", "pad", { a: 0.1, r: 0.8, col: 0.65 }),
  "s.pizz": SF("Pizzicato strings", "pizzicato_strings", "pluck", { d: 0.6, r: 0.25, col: 0.4 }),
  "s.violin": SF("Violin", "violin", "pad", { a: 0.08, r: 0.6, col: 0.55, vib: 8 }),
  "s.cello": SF("Cello", "cello", "bass", { a: 0.08, r: 0.6, cut: 5000, col: 0.4 }),
  "s.contrabass": SF("Contrabass", "contrabass", "bass", { a: 0.05, r: 0.5, cut: 3000, col: 0.4 }),
  "s.horn": SF("French horns", "french_horn", "pad", { a: 0.08, r: 0.6, cut: 5000, col: 0.6 }),
  "s.brass": SF("Brass section", "brass_section", "pad", { a: 0.03, r: 0.4, cut: 7000, col: 0.75 }),
  "s.trumpet": SF("Trumpet", "trumpet", "pad", { a: 0.03, r: 0.4, col: 0.7 }),
  "s.trombone": SF("Trombone", "trombone", "pad", { a: 0.05, r: 0.5, cut: 5000, col: 0.7 }),
  "s.choir": SF("Choir", "choir_aahs", "pad", { a: 0.5, r: 1.4, cut: 6000, col: 0.15 }),
  // Voices: a mixed choir, men, women and boys (Mellotron and Chamberlin tapes, vowels only) and
  // the General MIDI "ooh" (levels trimmed to sit with the strings on offline renders). range keeps each within the notes it can sing: a note outside moves
  // by octaves into it when played (the score keeps its own pitch).
  "v.mixed": VOX("Mixed choir", "8VOICE CHOIR", [43, 77]),
  "v.male": VOX("Male voices", "CHMB MALE VC", [41, 67], { cut: 6000, lvl: 0.85 }),
  "v.female": VOX("Female voices", "CHMB FEMALE", [55, 79], { lvl: 0.85 }),
  "v.boys": VOX("Boys choir", "BOYS CHOIR", [55, 79], { lvl: 0.85 }),
  "v.oohs": { ...SF("Voices (ooh)", "voice_oohs", "pad", { a: 0.3, r: 1.2, cut: 6000, col: 0.12 }), family: "Voices", range: [43, 79] },
  "s.flute": SF("Flute", "flute", "pad", { a: 0.05, r: 0.4, col: 0.1, vib: 6 }),
  "s.oboe": SF("Oboe", "oboe", "pad", { a: 0.04, r: 0.4, col: 0.3 }),
  "s.clarinet": SF("Clarinet", "clarinet", "pad", { a: 0.04, r: 0.4, col: 0.2 }),
  "s.tenorsax": SF("Tenor sax", "tenor_sax", "pad", { a: 0.03, r: 0.35, col: 0.5, vib: 6 }),
  "s.harp": SF("Orchestral harp", "orchestral_harp", "pluck", { d: 3.0, r: 1.0, col: 0.5 }),
  "s.celesta": SF("Celesta", "celesta", "fm", { d: 1.4, s: 0.2, r: 0.8, ratio: 2 }),
  "s.glock": SF("Glockenspiel", "glockenspiel", "fm", { d: 1.6, s: 0.1, r: 1.0, ratio: 4 }),
  "s.marimba": SF("Marimba", "marimba", "fm", { d: 0.5, s: 0.15, r: 0.4, ratio: 4 }),
  "s.vibes": SF("Vibraphone", "vibraphone", "fm", { d: 1.8, s: 0.3, r: 1.0, ratio: 4 }),
  "s.nylon": SF("Nylon guitar", "acoustic_guitar_nylon", "pluck", { d: 2.0, r: 0.4 }),
  "s.jazzgtr": SF("Jazz guitar", "electric_guitar_jazz", "pluck", { d: 1.6, r: 0.3 }),
  "s.acbass": SF("Acoustic bass", "acoustic_bass", "bass", { a: 0.008, d: 0.35, s: 0.4, r: 0.15, cut: 3000 }),
  "s.fingerbass": SF("Electric bass", "electric_bass_finger", "bass", { a: 0.006, r: 0.15, cut: 3000 }),
  "s.synthbass": SF("Synth bass (GM)", "synth_bass_1", "bass", { a: 0.004, r: 0.12, cut: 3000, col: 0.7 }),
  "s.organ": SF("Drawbar organ", "drawbar_organ", "pad", { a: 0.02, r: 0.3, col: 0.3 }),
  "s.warmpad": SF("Warm pad (GM)", "pad_2_warm", "pad", { a: 0.6, r: 1.6, col: 0.35 }),
  "s.timpani": SF("Timpani", "timpani", "bass", { a: 0.005, d: 1.2, s: 0.2, r: 1.0, cut: 4000 }),
  "s.cleangtr": SF("Clean electric guitar", "electric_guitar_clean", "pluck", { d: 1.6, r: 0.3 }),
  "s.overdrive": SF("Overdriven guitar", "overdriven_guitar", "pad", { a: 0.01, r: 0.3, cut: 7000, col: 0.9 }),
  "s.harmonica": SF("Harmonica", "harmonica", "pad", { a: 0.03, r: 0.3, col: 0.45, vib: 8 }),
  "s.clav": SF("Clavinet", "clavinet", "pluck", { d: 0.6, r: 0.1, col: 0.6 }),
  "s.slapbass": SF("Slap bass", "slap_bass_1", "bass", { a: 0.003, r: 0.08, cut: 4000, col: 0.6 }),
  "s.mutedgtr": SF("Muted guitar", "electric_guitar_muted", "pluck", { d: 0.4, r: 0.06, col: 0.5 }),
  "s.acgtr": SF("Acoustic guitar", "acoustic_guitar_steel", "pluck", { d: 1.8, r: 0.4, col: 0.45 }),
  "s.banjo": SF("Banjo", "banjo", "pluck", { d: 0.9, r: 0.2, col: 0.6 }),
  "s.fiddle": SF("Fiddle", "fiddle", "pad", { a: 0.04, r: 0.3, col: 0.6, vib: 14 }),
  "s.accordion": SF("Accordion", "accordion", "pad", { a: 0.05, r: 0.3, col: 0.5 }),
  "s.koto": SF("Koto", "koto", "pluck", { d: 1.8, r: 0.5, col: 0.55 }),
  "s.shakuhachi": SF("Shakuhachi", "shakuhachi", "pad", { a: 0.06, r: 0.5, col: 0.15, vib: 16 }),
  "s.kalimba": SF("Kalimba", "kalimba", "fm", { d: 1.2, s: 0.1, r: 0.6, ratio: 4 }),
  "s.harpsichord": SF("Harpsichord", "harpsichord", "pluck", { d: 1.4, r: 0.3, col: 0.75 }),
  "s.mutedtpt": SF("Muted trumpet", "muted_trumpet", "pad", { a: 0.03, r: 0.3, col: 0.6, vib: 10 }),
  "s.panflute": SF("Pan flute", "pan_flute", "pad", { a: 0.05, r: 0.4, col: 0.15, vib: 12 }),
  "s.recorder": SF("Recorder", "recorder", "pad", { a: 0.04, r: 0.3, col: 0.2, vib: 8 }),
  "s.distortion": SF("Distortion guitar", "distortion_guitar", "pad", { a: 0.006, r: 0.15, cut: 6000, col: 0.95 }),
  "s.pickbass": SF("Picked bass", "electric_bass_pick", "bass", { a: 0.004, r: 0.12, cut: 3500, col: 0.6 }),
  "s.rockorgan": SF("Rock organ", "rock_organ", "pad", { a: 0.02, r: 0.3, col: 0.4 })
};
Object.assign(extra, SAMPLED);

// Sampled defaults per style, used when sampled instruments are on (P.samples). Electronic stays
// on its synthesizers; layers not listed keep the style's synth.
export const STYLE_SAMPLED = {
  ambient: { lead: "s.piano", harm: "s.vibes" },
  cinematic: { lead: "s.harp", harm: "s.strings", bass: "s.cello" },
  minimal: { lead: "s.vibes", harm: "s.marimba" },
  jazz: { lead: "s.jazzgtr", harm: "s.wurli", bass: "s.acbass" },
  electronic: {},
  epic: { lead: "s.horn", harm: "s.strings", bass: "s.contrabass", pad: "s.choir" },
  movie: { lead: "s.piano", harm: "s.strings", bass: "s.cello", pad: "s.synthstrings" },
  lofi: { lead: "s.cp80", harm: "s.wurli", bass: "s.fingerbass" },
  bossa: { lead: "s.flute", harm: "s.nylon", bass: "s.acbass", pad: "s.strings" },
  synthwave: {},
  classical: { lead: "s.piano", harm: "s.piano", bass: "s.cello", pad: "s.strings" },
  pop: { lead: "s.piano", harm: "s.cleangtr", bass: "s.fingerbass", pad: "s.synthstrings" },
  rock: { lead: "s.overdrive", harm: "s.distortion", bass: "s.pickbass", pad: "s.organ" },
  metal: { lead: "s.overdrive", harm: "s.distortion", bass: "s.pickbass", pad: "s.choir" },
  blues: { lead: "s.jazzgtr", harm: "s.piano", bass: "s.acbass", pad: "s.organ" },
  funk: { lead: "s.brass", harm: "s.mutedgtr", bass: "s.slapbass", pad: "s.organ" },
  lofinature: { lead: "s.piano", harm: "s.nylon", bass: "s.acbass", pad: "s.warmpad" },
  neoclassical: { lead: "s.piano", harm: "s.piano", bass: "s.cello", pad: "s.strings" },
  folk: { lead: "s.fiddle", harm: "s.acgtr", bass: "s.acbass", pad: "s.accordion" },
  meditation: { lead: "s.celesta", harm: "s.warmpad", pad: "s.warmpad" },
  postrock: { lead: "s.cleangtr", harm: "s.cleangtr", bass: "s.pickbass", pad: "s.strings" },
  chiptune: {},
  triphop: { lead: "s.mutedtpt", harm: "s.wurli", bass: "s.synthbass", pad: "s.strings" },
  reggae: { harm: "s.cleangtr", bass: "s.fingerbass", pad: "s.organ" },
  baroque: { lead: "s.violin", harm: "s.harpsichord", bass: "s.cello", pad: "s.strings" },
  eastasian: { lead: "s.shakuhachi", harm: "s.koto", bass: "s.contrabass", pad: "s.strings" },
  dnb: { pad: "s.synthstrings" },
  techno: {},
  acappella: { lead: "v.female", harm: "v.mixed", bass: "v.male", pad: "v.oohs" }
};
export const STORY_SAMPLED = { acappella: "v.female", lofinature: "s.flute", neoclassical: "s.cello", folk: "s.fiddle", meditation: "s.flute", postrock: "s.cleangtr", triphop: "s.mutedtpt", reggae: "s.trumpet", baroque: "s.violin", eastasian: "s.shakuhachi", pop: "s.flute", rock: "s.overdrive", metal: "s.overdrive", blues: "s.harmonica", funk: "s.tenorsax", ambient: "s.flute", cinematic: "s.violin", minimal: "s.vibes", jazz: "s.tenorsax", epic: "s.horn", movie: "s.violin", lofi: "s.flute", bossa: "s.flute", classical: "s.violin" };

// With the Story melody the line is long and tied, so a plucked default would cut it into
// separate attacks: each style uses a sustained lead instead, unless a preset is chosen.
export const STORY_LEAD = { acappella: "x.softlead", lofinature: "x.softlead", neoclassical: "x.warmlead", folk: "x.softlead", meditation: "x.softlead", postrock: "x.softlead", chiptune: "chiptune.lead", triphop: "x.softlead", reggae: "x.softlead", baroque: "x.softlead", eastasian: "x.softlead", dnb: "x.synthlead", techno: "x.synthlead", blues: "x.warmlead", funk: "x.synthlead", pop: "x.softlead", rock: "x.synthlead", metal: "x.synthlead", ambient: "x.softlead", cinematic: "x.softlead", minimal: "x.warmlead", jazz: "x.warmlead", electronic: "x.synthlead", epic: "epic.lead", movie: "x.softlead", lofi: "x.softlead", bossa: "x.softlead", synthwave: "synthwave.lead", classical: "x.softlead" };

// Adds catalog entries (sampled instruments listed at runtime by the UI, see samples.js) to
// the library without replacing curated presets.
export function addToLibrary(entries) { for (const [k, v] of Object.entries(entries)) if (!LIBRARY[k]) LIBRARY[k] = v; return LIBRARY; }
export const LIBRARY = (() => {
  const lib = {};
  for (const [sk, st] of Object.entries(STYLES)) for (const l of ["lead", "harm", "bass", "pad"]) lib[`${sk}.${l}`] = { ...st.inst[l] };
  return Object.assign(lib, extra);
})();

export const TYPE_NAME = { pluck: "Karplus-Strong pluck", fm: "2-operator FM", bass: "Sine and saw", pad: "Unison oscillators", wave: "Texture wavetable", sample: "Sampled instruments" };

// Editable parameters per instrument type: [key, label, min, max, step, scale, unit, dec].
export const PARAMS = {
  common: [["a", "Attack", 0.001, 2, 0.001, 1000, "ms", 0], ["r", "Release", 0.02, 4, 0.01, 1, "s", 2], ["cut", "Filter", 100, 16000, 10, 1, "Hz", 0], ["q", "Resonance", 0.3, 12, 0.1, 1, "", 1], ["col", "Colour", 0, 1, 0.01, 100, "%", 0]],
  pluck: [["d", "String decay (T60)", 0.1, 6, 0.05, 1, "s", 2]],
  fm: [["d", "Decay", 0.02, 4, 0.01, 1, "s", 2], ["s", "Sustain", 0, 1, 0.01, 100, "%", 0], ["ratio", "FM ratio", 0.5, 8, 0.5, 1, "", 1]],
  bass: [["d", "Decay", 0.02, 4, 0.01, 1, "s", 2], ["s", "Sustain", 0, 1, 0.01, 100, "%", 0]],
  pad: [["d", "Decay", 0.02, 4, 0.01, 1, "s", 2], ["s", "Sustain", 0, 1, 0.01, 100, "%", 0], ["det", "Detune", 0, 40, 1, 1, "cents", 0]],
  wave: [["d", "Decay", 0.02, 4, 0.01, 1, "s", 2], ["s", "Sustain", 0, 1, 0.01, 100, "%", 0]],
  sample: []
};

// The instruments in use: the style's, unless a layer has a preset and/or edits.
// choice: { [layer]: { preset: key | null, edits: { param: value } } }
// samples: use the style's sampled defaults (STYLE_SAMPLED) where it has them.
export function styleDefault(style, layer, melody = "classic", samples = false) {
  const sampled = samples ? STYLE_SAMPLED[style] || {} : {};
  if (melody !== "classic" && layer === "lead") return LIBRARY[(samples && STORY_SAMPLED[style]) || STORY_LEAD[style]];
  return sampled[layer] ? LIBRARY[sampled[layer]] : STYLES[style].inst[layer];
}
export function resolveInstruments(style, choice = {}, melody = "classic", samples = false) {
  const out = {};
  for (const l of ["lead", "harm", "bass", "pad"]) {
    const c = choice[l], base = c && c.preset && LIBRARY[c.preset] ? LIBRARY[c.preset] : styleDefault(style, l, melody, samples);
    out[l] = { ...base, ...(c && c.edits ? c.edits : {}) };
  }
  return out;
}
export { LAYERS };

/*
 * Texture wavetable. The profile is sampled along a line through the point, in the
 * dominant gradient direction of its area (across the edges, so stripes become a waveform), over a length of
 * 2r of the diagonal. The profile is made periodic by removing its linear trend, then its
 * spectrum (real FFT, 256 points) gives the first 64 harmonics for createPeriodicWave.
 */
export const WAVE_N = 256, WAVE_H = 64;
const fft = new FFT(WAVE_N);
export function textureWave(lum, x, y, r, ori) {
  const { w, h, data } = lum, diag = Math.hypot(w, h);
  let dom = 0; for (let k = 1; k < 4; k++) if (ori[k] > ori[dom]) dom = k;
  const ang = (dom * Math.PI) / 4; // along the dominant gradient direction, i.e. across the edges
  const len = 2 * r * diag, cx = x * w - 0.5, cy = y * h - 0.5, dx = Math.cos(ang), dy = Math.sin(ang);
  const sample = (px, py) => {
    px = Math.min(w - 1, Math.max(0, px)); py = Math.min(h - 1, Math.max(0, py));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = px - x0, fy = py - y0;
    return (data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx) * (1 - fy) + (data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx) * fy;
  };
  const prof = new Float64Array(WAVE_N);
  for (let i = 0; i < WAVE_N; i++) { const t = (i / WAVE_N - 0.5) * len; prof[i] = sample(cx + dx * t, cy + dy * t); }
  const a = prof[0], b = prof[WAVE_N - 1];
  let mean = 0;
  for (let i = 0; i < WAVE_N; i++) { prof[i] -= a + ((b - a) * i) / (WAVE_N - 1); mean += prof[i]; }
  mean /= WAVE_N;
  const input = new Array(WAVE_N), outC = fft.createComplexArray();
  for (let i = 0; i < WAVE_N; i++) input[i] = prof[i] - mean;
  fft.realTransform(outC, input);
  const real = new Float32Array(WAVE_H + 1), imag = new Float32Array(WAVE_H + 1);
  let energy = 0;
  for (let k = 1; k <= WAVE_H; k++) { real[k] = outC[2 * k]; imag[k] = outC[2 * k + 1]; energy += real[k] ** 2 + imag[k] ** 2; }
  // a flat area has no texture: fall back to a soft triangle-like spectrum
  if (energy < 1e-10) for (let k = 1; k <= WAVE_H; k += 2) imag[k] = 1 / (k * k);
  return { real, imag, angle: Math.round((ang * 180) / Math.PI) % 180 };
}

// Spectral tilt by the colour parameter: colour 1 keeps all harmonics, 0 keeps mostly the fundamental.
export function tiltWave(wave, col) {
  const p = 2 * (1 - col), real = new Float32Array(wave.real.length), imag = new Float32Array(wave.imag.length);
  for (let k = 1; k < real.length; k++) { const g = Math.pow(k, -p); real[k] = wave.real[k] * g; imag[k] = wave.imag[k] * g; }
  return { real, imag };
}
