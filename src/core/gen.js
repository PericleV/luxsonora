// How a song is made: Classic (each style always has the same tracks), By genre (the genre and
// the picture choose the tracks and their instruments) or Raw (the notes read straight from the
// picture, raw.js).
//
// By genre: every style has a pool of instruments for its five tracks and a band for the added
// ones (arrange.js STYLE_BAND), checked against what the genre usually plays (bossa nova: nylon
// guitar, flute, muted trumpet, sax; reggae: organ bubble, skank guitar, clavinet, horns; trip
// hop: Rhodes, strings, muted trumpet; synthwave: pads, arpeggios, a sax on top; post-rock:
// tremolo guitars, strings, glockenspiel; and so on). From the pool, the picture decides:
//  - an instrument's character is read from its own settings: how percussive it is (a plucked
//    sound or a fast attack), how bright (its filter) and how warm (its colour);
//  - the picture's: its detail (entropy and edges), its lightness and its warmth;
//  - a busy, sharp picture takes plucked and percussive sounds, a calm one sustained sounds, a
//    light one brighter, a warm one warmer. The style's own instrument gets a small head start.
// The added tracks (Medium: 2-3, Full: 4-6, on top of the five) are ranked the same way, with the
// role fitting the picture too (ostinato and runs for detail, held sections and drones for calm
// areas, ornaments for light) and the genre's order of roles as a tie-break. Candidates that fit
// almost equally well are told apart by the picture itself (a number drawn from its fingerprint
// for each instrument, up to 0.12), so pictures alike in their measures still get different
// bands. Everything comes from the picture, so the same picture gives the same tracks on every
// device.
import { clamp } from "./util.js";
import { LIBRARY, styleDefault } from "./instruments.js";
import { STYLE_BAND, STYLE_ROLES, ROLES, roleInstrument } from "./arrange.js";

export const GEN_MODES = { classic: "Classic", genre: "By genre", raw: "Raw" };
export const GEN_DESC = {
  classic: "The style always plays with the same tracks and instruments, and the picture shapes the music they play.",
  genre: "The genre and the picture choose the tracks and their instruments: a busy, sharp picture takes plucked and percussive sounds, a calm one held sounds, a light one brighter ones. Two pictures in the same style can sound like different bands.",
  raw: "No harmony and no rules: the notes are read straight from the picture along the eye's path. Each track reads one thing (the height, the brightness, the colour, the edges...). Choose the tempo, the scale and what each track reads."
};

// More instruments each style can use on its five tracks (the style's own comes first).
const CORE_POOL = {
  ambient: { lead: ["s.flute", "s.harp", "s.vibes", "s.celesta"], harm: ["s.harp", "s.vibes", "s.synthstrings"], pad: ["s.choir", "s.synthstrings", "s.warmpad"] },
  cinematic: { lead: ["s.horn", "s.cello", "s.violin", "s.piano"], harm: ["s.strings", "s.harp", "s.pizz"], bass: ["s.contrabass", "s.cello"], pad: ["s.choir", "s.strings"] },
  minimal: { lead: ["s.marimba", "s.vibes", "s.clarinet", "s.piano"], harm: ["s.marimba", "s.piano", "s.vibes"], pad: ["s.strings", "s.organ"] },
  jazz: { lead: ["s.tenorsax", "s.trumpet", "s.vibes", "s.piano", "s.jazzgtr"], harm: ["s.piano", "s.wurli", "s.jazzgtr", "s.organ"], pad: ["s.organ", "s.brass"] },
  epic: { lead: ["s.horn", "s.trumpet", "s.violin", "s.choir"], harm: ["s.strings", "s.brass", "s.tremolo"], bass: ["s.contrabass", "s.cello"], pad: ["s.choir", "s.strings"] },
  movie: { lead: ["s.piano", "s.flute", "s.oboe", "s.cello", "s.violin", "s.horn"], harm: ["s.strings", "s.harp", "s.piano"], bass: ["s.cello", "s.contrabass"], pad: ["s.synthstrings", "s.strings", "s.choir"] },
  lofi: { lead: ["s.cp80", "s.wurli", "s.piano", "s.jazzgtr", "s.tenorsax", "s.flute"], harm: ["s.wurli", "s.piano", "s.jazzgtr", "s.nylon"], bass: ["s.fingerbass", "s.acbass"], pad: ["s.warmpad", "s.organ"] },
  bossa: { lead: ["s.flute", "s.tenorsax", "s.mutedtpt", "s.piano", "s.nylon"], harm: ["s.nylon", "s.piano"], bass: ["s.acbass", "s.fingerbass"], pad: ["s.strings", "s.organ"] },
  synthwave: { lead: ["x.synthlead", "s.tenorsax"], pad: ["s.synthstrings", "x.wavepad"] },
  electronic: { lead: ["x.synthlead", "x.warmlead"], pad: ["x.wavepad", "s.synthstrings"] },
  techno: { lead: ["x.synthlead"], pad: ["x.wavepad"] },
  dnb: { lead: ["x.synthlead"], harm: ["s.piano", "s.wurli"], pad: ["s.strings", "s.synthstrings", "x.wavepad"] },
  classical: { lead: ["s.piano", "s.violin", "s.flute", "s.clarinet", "s.oboe", "s.cello"], harm: ["s.piano", "s.strings", "s.harp"], bass: ["s.cello", "s.contrabass"], pad: ["s.strings", "s.horn"] },
  pop: { lead: ["s.piano", "x.synthlead", "s.cleangtr", "s.flute"], harm: ["s.cleangtr", "s.piano", "s.acgtr", "s.mutedgtr"], bass: ["s.fingerbass", "s.synthbass"], pad: ["s.synthstrings", "s.strings", "s.warmpad"] },
  rock: { lead: ["s.overdrive", "s.distortion", "s.rockorgan", "s.piano"], harm: ["s.distortion", "s.overdrive", "s.cleangtr", "s.rockorgan"], bass: ["s.pickbass", "s.fingerbass"], pad: ["s.organ", "s.rockorgan", "s.strings"] },
  metal: { lead: ["s.overdrive", "s.distortion"], harm: ["s.distortion", "s.overdrive"], pad: ["s.choir", "s.strings", "s.organ"] },
  blues: { lead: ["s.jazzgtr", "s.harmonica", "s.overdrive", "s.tenorsax", "s.piano"], harm: ["s.piano", "s.organ", "s.jazzgtr"], bass: ["s.acbass", "s.fingerbass"], pad: ["s.organ"] },
  funk: { lead: ["s.brass", "s.tenorsax", "s.trumpet", "s.clav"], harm: ["s.mutedgtr", "s.clav", "s.wurli"], bass: ["s.slapbass", "s.fingerbass"], pad: ["s.organ", "s.brass"] },
  lofinature: { lead: ["s.piano", "s.flute", "s.nylon", "s.kalimba"], harm: ["s.nylon", "s.harp", "s.piano"], pad: ["s.warmpad", "s.strings"] },
  neoclassical: { lead: ["s.piano", "s.cello", "s.violin"], harm: ["s.piano", "s.strings", "s.harp"], bass: ["s.cello", "s.contrabass"], pad: ["s.strings", "s.choir"] },
  folk: { lead: ["s.fiddle", "s.banjo", "s.harmonica", "s.recorder", "s.flute", "s.acgtr"], harm: ["s.acgtr", "s.banjo", "s.accordion", "s.nylon"], bass: ["s.acbass", "s.contrabass"], pad: ["s.accordion", "s.strings"] },
  meditation: { lead: ["s.celesta", "s.panflute", "s.shakuhachi", "s.harp", "s.kalimba"], harm: ["s.warmpad", "s.harp"], pad: ["s.warmpad", "s.choir"] },
  postrock: { lead: ["s.cleangtr", "s.violin", "s.piano", "s.glock"], harm: ["s.cleangtr", "s.overdrive", "s.piano"], bass: ["s.pickbass", "s.fingerbass"], pad: ["s.strings", "s.organ"] },
  triphop: { lead: ["s.mutedtpt", "s.flute", "s.tenorsax", "s.wurli"], harm: ["s.wurli", "s.cp80", "s.piano"], bass: ["s.synthbass", "s.acbass"], pad: ["s.strings", "s.organ"] },
  reggae: { lead: ["s.organ", "s.trumpet", "s.tenorsax", "s.trombone", "s.piano"], harm: ["s.mutedgtr", "s.organ", "s.clav", "s.piano"], bass: ["s.fingerbass"], pad: ["s.organ"] },
  baroque: { lead: ["s.violin", "s.recorder", "s.oboe", "s.flute", "s.harpsichord", "s.trumpet"], harm: ["s.harpsichord", "s.organ", "s.strings"], bass: ["s.cello", "s.contrabass"], pad: ["s.strings", "s.organ"] },
  eastasian: { lead: ["s.shakuhachi", "s.koto", "s.panflute", "s.shamisen"], harm: ["s.koto", "s.shamisen", "s.harp"], pad: ["s.strings"] },
  chiptune: {}
};
// More players for the added tracks than the style's band lists (from the same research).
const BAND_MORE = {
  bossa: [["s.mutedtpt", "counter"], ["s.acbass", "pulse"]],
  reggae: [["s.clav", "ostinato"], ["s.piano", "runs"]],
  triphop: [["s.flute", "counter"], ["s.tenorsax", "counter"], ["s.organ", "drone"]],
  lofi: [["s.piano", "runs"], ["s.cp80", "runs"]],
  synthwave: [["s.tenorsax", "counter"]],
  postrock: [["s.violin", "counter"], ["s.organ", "drone"]],
  baroque: [["s.flute", "ornament"], ["s.trumpet", "double"]],
  eastasian: [["s.shamisen", "ostinato"]],
  dnb: [["s.piano", "runs"], ["s.strings", "sustain"]],
  folk: [["s.contrabass", "pulse"], ["s.nylon", "ostinato"]],
  jazz: [["s.wurli", "runs"]],
  funk: [["s.cp80", "runs"]]
};

// By genre, a track the genre does not usually have is left out: a jazz combo and bossa nova
// without a pad under them, baroque and neoclassical pieces without a drum kit.
export const GENRE_OMIT = { jazz: ["pad"], bossa: ["pad"], baroque: ["perc"], neoclassical: ["perc"] };

// The picture, on the scales the choice uses (0-1).
export function pictureOf(A) {
  const g = (A && A.global) || {};
  return { detail: clamp(0.5 * (g.entropy ?? 0.5) + 0.5 * (g.edgeN ?? 0.5)), light: clamp(g.brightness ?? 0.5), warm: clamp(g.warmth01 ?? 0.5) };
}
// An instrument's character, from its own settings.
export function characterOf(v) {
  if (!v) return { punch: 0.5, bright: 0.5, warm: 0.5 };
  const a = v.a ?? 0.02, punch = v.type === "pluck" || ((v.s ?? 0.5) < 0.35 && (v.d ?? 1) < 1.5) ? 0.9 : a < 0.02 ? 0.6 : a < 0.08 ? 0.4 : 0.15;
  const bright = clamp((Math.log2(Math.max(200, v.cut ?? 4000)) - Math.log2(1500)) / (Math.log2(12000) - Math.log2(1500)));
  return { punch, bright, warm: clamp(v.col ?? 0.5) };
}
export function instrumentFit(preset, pic) {
  const c = characterOf(LIBRARY[preset]);
  return 1 - (1.2 * Math.abs(c.punch - pic.detail) + 0.6 * Math.abs(c.bright - pic.light) + 0.5 * Math.abs(c.warm - pic.warm)) / 2.3;
}
// what each role reads best: [detail, light]
const ROLE_PIC = { ostinato: [0.75, 0.5], runs: [0.65, 0.6], sustain: [0.2, 0.5], drone: [0.15, 0.3], ornament: [0.5, 0.8], counter: [0.5, 0.5], double: [0.65, 0.5], pulse: [0.7, 0.4] };
export function roleFit(role, pic) {
  const [d, l] = ROLE_PIC[role] || [0.5, 0.5];
  return 1 - (1.2 * Math.abs(pic.detail - d) + 0.6 * Math.abs(pic.light - l)) / 1.8;
}
// a number in [0, 1) for a picture and a name: the same on every device
export function pictureDraw(A, name) {
  let h = 2166136261; const s = String((A && A.hash) ?? "") + "|" + name;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const JITTER = 0.12;
const usable = (k, samples) => !!LIBRARY[k] && (samples || !/^[sv]\./.test(k));
export const styleKey = (style, layer, melody = "classic", samples = true) => keyOf(style, layer, melody, samples);
const keyOf = (style, layer, melody, samples) => { const d = styleDefault(style, layer, melody, samples); return Object.keys(LIBRARY).find(k => LIBRARY[k] === d) || null; };

/*
 * The instruments of the five tracks for a picture: { lead, harm, bass, pad } (preset keys; a
 * track the pool has nothing more for keeps the style's own, null). With a story or improvised
 * melody the melody keeps its own instrument.
 */
export function genreCore(style, A, { samples = true, melody = "classic" } = {}) {
  const pic = pictureOf(A), pool = CORE_POOL[style] || {}, out = {}, taken = new Set();
  // one instrument per track: a track does not take the one an earlier track has
  for (const layer of ["lead", "harm", "bass", "pad"]) {
    const own = keyOf(style, layer, melody, samples);
    if (layer === "lead" && melody !== "classic") { out[layer] = null; if (own) taken.add(LIBRARY[own].name); continue; }
    const cands = [...new Set([own, ...(pool[layer] || [])])].filter(k => k && usable(k, samples) && !taken.has(LIBRARY[k].name));
    let best = null, bs = -Infinity;
    for (const k of cands) { const s = instrumentFit(k, pic) + (k === own ? 0.08 : 0) + JITTER * pictureDraw(A, layer + ":" + k); if (s > bs + 1e-9) { bs = s; best = k; } }
    if (!best) best = own;
    out[layer] = best === own ? null : best;
    if (best) taken.add(LIBRARY[best].name);
  }
  return out;
}

/*
 * The added tracks for a picture: the style's band (and the more players above) ranked by how
 * well the role and the instrument fit the picture, the genre's order of roles breaking ties;
 * an instrument already on a main track, the same instrument twice, or a third of one role is
 * passed over. Returns { pick: the first n as layers, rest: the others in order }.
 */
export function genreLayers(style, level, A, { samples = true, avoid = [], richness = 0.5 } = {}) {
  if (level !== "medium" && level !== "full") return { pick: [], rest: [] };
  const n = level === "medium" ? 2 + Math.round(clamp(richness)) : 4 + Math.round(2 * clamp(richness));
  const pic = pictureOf(A), order = STYLE_ROLES[style] || STYLE_ROLES.ambient;
  const band = [...(STYLE_BAND[style] || []), ...(BAND_MORE[style] || [])].filter(([k, r]) => ROLES[r] && usable(k, samples));
  // without sampled instruments, the style's synthesizer for each role
  const cands = band.length ? band : order.map(r => [roleInstrument(style, r, false), r]).filter(([k]) => LIBRARY[k]);
  const scored = cands.map(([k, r], i) => ({ k, r, i, s: roleFit(r, pic) + 0.6 * instrumentFit(k, pic) + 0.25 * (1 - Math.max(0, order.indexOf(r)) / order.length) + JITTER * pictureDraw(A, r + ":" + k) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  // avoid: the names of the instruments on the main tracks
  const seen = new Set(avoid), roles = {}, ranked = [];
  for (const x of scored) {
    const nm = LIBRARY[x.k].name;
    if (seen.has(nm) || (roles[x.r] || 0) >= 2) continue;
    seen.add(nm); roles[x.r] = (roles[x.r] || 0) + 1; ranked.push(x);
  }
  const lay = (x, j) => ({ id: "x" + (j + 1), role: x.r, preset: x.k });
  return { pick: ranked.slice(0, n).map(lay), rest: ranked.slice(n).map((x, j) => lay(x, n + j)) };
}
