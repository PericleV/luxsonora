// How a song is made: Composed (the genre's harmony, rules and band) or Raw (the notes read
// straight from the picture, raw.js). A composed piece plays the genre's usual band, or, with
// "The picture chooses the band" on (P.pictureBand), the band this picture calls for.
//
// The picture chooses the band: every style has a pool of instruments for its five tracks and a band for the added
// ones (arrange.js STYLE_BAND), checked against what the genre usually plays (bossa nova: nylon
// guitar, flute, muted trumpet, sax; reggae: organ bubble, skank guitar, clavinet, horns; trip
// hop: Rhodes, strings, muted trumpet; synthwave: pads, arpeggios, a sax on top; post-rock:
// tremolo guitars, strings, glockenspiel; and so on). From the pool, the picture decides:
//  - an instrument's character is read from its own settings: how percussive it is (a plucked
//    sound or a fast attack), how bright (its filter) and how warm (its colour);
//  - the picture's: its detail (entropy and edges), its lightness and its warmth;
//  - each instrument of the pool has a weight for how typical it is of the genre (rock is built
//    on guitars; a piano leads a rock song only now and then), and a choice is
//    0.6 · typical + 0.4 · how well it fits the picture: what the genre is built on comes first,
//    and among those the picture decides;
//  - a busy, sharp picture takes plucked and percussive sounds, a calm one sustained sounds, a
//    light one brighter, a warm one warmer.
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

export const GEN_MODES = { composed: "Composed", raw: "Raw" };
export const GEN_DESC = {
  composed: "The genre's harmony, rhythm and rules, with the picture shaping the melody, the chords and the sound.",
  raw: "No harmony and no rules: the notes are read straight from the picture along the eye's path. Each track reads one thing (the height, the brightness, the colour, the edges...). Choose the tempo, the scale and what each track reads."
};
export const BAND_DESC = {
  off: "The genre's usual band: the same tracks and instruments for every picture in this genre.",
  on: "The picture chooses among the instruments typical of the genre: a busy, sharp picture takes plucked and percussive sounds, a calm one held sounds, a light one brighter ones. A track the genre seldom has is left out (a jazz combo plays without a pad)."
};
// The mode of a project's settings, and whether the picture chooses the band; projects saved with
// the three modes of before ("classic", "genre", "raw") keep their meaning.
export const genOf = P => (P && P.gen === "raw" ? "raw" : "composed");
export const pictureBandOf = P => !!P && P.gen !== "raw" && (P.pictureBand === true || P.gen === "genre");

// The instruments each style can use on its five tracks, with how typical each is of the genre
// (1: what the genre is built on; 0.3: heard in it now and then). The style's own instrument
// counts as 1 when it is not listed. Rock and metal are guitars first; a piano or an organ
// can lead a rock song only now and then, and never a metal one.
const CORE_POOL = {
  ambient: { lead: { "s.flute": 0.7, "s.harp": 0.7, "s.vibes": 0.6, "s.celesta": 0.6 }, harm: { "s.harp": 0.6, "s.vibes": 0.5, "s.synthstrings": 0.8 }, pad: { "s.choir": 0.7, "s.synthstrings": 0.8, "s.warmpad": 0.9 } },
  cinematic: { lead: { "s.horn": 0.9, "s.cello": 0.8, "s.violin": 0.8, "s.piano": 0.7 }, harm: { "s.strings": 1, "s.harp": 0.6, "s.pizz": 0.6 }, bass: { "s.contrabass": 0.9, "s.cello": 0.8 }, pad: { "s.choir": 0.8, "s.strings": 0.9 } },
  minimal: { lead: { "s.marimba": 0.9, "s.vibes": 0.8, "s.clarinet": 0.6, "s.piano": 0.9 }, harm: { "s.marimba": 0.8, "s.piano": 0.9, "s.vibes": 0.7 }, pad: { "s.strings": 0.7, "s.organ": 0.6 } },
  jazz: { lead: { "s.tenorsax": 1, "s.trumpet": 0.9, "s.vibes": 0.7, "s.piano": 0.9, "s.jazzgtr": 0.8 }, harm: { "s.piano": 1, "s.wurli": 0.7, "s.jazzgtr": 0.8, "s.organ": 0.6 }, pad: { "s.organ": 0.6, "s.brass": 0.5 } },
  epic: { lead: { "s.horn": 1, "s.trumpet": 0.8, "s.violin": 0.7, "s.choir": 0.7 }, harm: { "s.strings": 1, "s.brass": 0.9, "s.tremolo": 0.7 }, bass: { "s.contrabass": 0.9, "s.cello": 0.7 }, pad: { "s.choir": 1, "s.strings": 0.8 } },
  movie: { lead: { "s.piano": 0.9, "s.flute": 0.7, "s.oboe": 0.6, "s.cello": 0.7, "s.violin": 0.7, "s.horn": 0.7 }, harm: { "s.strings": 1, "s.harp": 0.7, "s.piano": 0.7 }, bass: { "s.cello": 0.9, "s.contrabass": 0.8 }, pad: { "s.synthstrings": 0.7, "s.strings": 0.9, "s.choir": 0.6 } },
  lofi: { lead: { "s.cp80": 0.9, "s.wurli": 0.9, "s.piano": 0.8, "s.jazzgtr": 0.7, "s.tenorsax": 0.6, "s.flute": 0.5 }, harm: { "s.wurli": 1, "s.piano": 0.8, "s.jazzgtr": 0.8, "s.nylon": 0.6 }, bass: { "s.fingerbass": 0.9, "s.acbass": 0.8 }, pad: { "s.warmpad": 0.7, "s.organ": 0.5 } },
  bossa: { lead: { "s.flute": 0.9, "s.tenorsax": 0.9, "s.mutedtpt": 0.7, "s.piano": 0.7, "s.nylon": 0.8 }, harm: { "s.nylon": 1, "s.piano": 0.7 }, bass: { "s.acbass": 1, "s.fingerbass": 0.6 }, pad: { "s.strings": 0.6, "s.organ": 0.4 } },
  synthwave: { lead: { "x.synthlead": 0.9, "s.tenorsax": 0.4 }, pad: { "s.synthstrings": 0.7, "x.wavepad": 0.7 } },
  electronic: { lead: { "x.synthlead": 0.8, "x.warmlead": 0.7 }, pad: { "x.wavepad": 0.8, "s.synthstrings": 0.6 } },
  techno: { lead: { "x.synthlead": 0.7 }, pad: { "x.wavepad": 0.7 } },
  dnb: { lead: { "x.synthlead": 0.8 }, harm: { "s.piano": 0.6, "s.wurli": 0.5 }, pad: { "s.strings": 0.6, "s.synthstrings": 0.7, "x.wavepad": 0.7 } },
  classical: { lead: { "s.piano": 1, "s.violin": 0.9, "s.flute": 0.7, "s.clarinet": 0.7, "s.oboe": 0.7, "s.cello": 0.8 }, harm: { "s.piano": 1, "s.strings": 0.9, "s.harp": 0.6 }, bass: { "s.cello": 1, "s.contrabass": 0.8 }, pad: { "s.strings": 1, "s.horn": 0.6 } },
  pop: { lead: { "s.piano": 0.8, "x.synthlead": 0.7, "s.cleangtr": 0.7, "s.flute": 0.4 }, harm: { "s.cleangtr": 0.9, "s.piano": 0.9, "s.acgtr": 0.8, "s.mutedgtr": 0.6 }, bass: { "s.fingerbass": 1, "s.synthbass": 0.7 }, pad: { "s.synthstrings": 0.8, "s.strings": 0.7, "s.warmpad": 0.6 } },
  rock: { lead: { "s.overdrive": 1, "s.distortion": 0.9, "s.cleangtr": 0.6, "s.rockorgan": 0.4, "s.piano": 0.3 }, harm: { "s.distortion": 1, "s.overdrive": 0.9, "s.cleangtr": 0.7, "s.rockorgan": 0.45 }, bass: { "s.pickbass": 1, "s.fingerbass": 0.8 }, pad: { "s.organ": 0.7, "s.rockorgan": 0.7, "s.strings": 0.35 } },
  metal: { lead: { "s.overdrive": 1, "s.distortion": 1 }, harm: { "s.distortion": 1, "s.overdrive": 0.9 }, bass: { "s.pickbass": 1, "s.fingerbass": 0.6 }, pad: { "s.choir": 0.8, "s.strings": 0.6, "s.organ": 0.5 } },
  blues: { lead: { "s.jazzgtr": 0.9, "s.harmonica": 0.9, "s.overdrive": 0.8, "s.tenorsax": 0.7, "s.piano": 0.7 }, harm: { "s.piano": 0.9, "s.organ": 0.8, "s.jazzgtr": 0.8 }, bass: { "s.acbass": 0.9, "s.fingerbass": 0.8 }, pad: { "s.organ": 0.8 } },
  funk: { lead: { "s.brass": 0.9, "s.tenorsax": 0.8, "s.trumpet": 0.8, "s.clav": 0.8 }, harm: { "s.mutedgtr": 1, "s.clav": 0.9, "s.wurli": 0.7 }, bass: { "s.slapbass": 1, "s.fingerbass": 0.8 }, pad: { "s.organ": 0.8, "s.brass": 0.6 } },
  lofinature: { lead: { "s.piano": 0.9, "s.flute": 0.7, "s.nylon": 0.8, "s.kalimba": 0.6 }, harm: { "s.nylon": 0.9, "s.harp": 0.6, "s.piano": 0.7 }, pad: { "s.warmpad": 0.8, "s.strings": 0.6 } },
  neoclassical: { lead: { "s.piano": 1, "s.cello": 0.8, "s.violin": 0.8 }, harm: { "s.piano": 1, "s.strings": 0.8, "s.harp": 0.5 }, bass: { "s.cello": 1, "s.contrabass": 0.7 }, pad: { "s.strings": 1, "s.choir": 0.5 } },
  folk: { lead: { "s.fiddle": 1, "s.banjo": 0.8, "s.harmonica": 0.7, "s.recorder": 0.5, "s.flute": 0.5, "s.acgtr": 0.8 }, harm: { "s.acgtr": 1, "s.banjo": 0.8, "s.accordion": 0.6, "s.nylon": 0.6 }, bass: { "s.acbass": 1, "s.contrabass": 0.8 }, pad: { "s.accordion": 0.8, "s.strings": 0.4 } },
  meditation: { lead: { "s.celesta": 0.7, "s.panflute": 0.8, "s.shakuhachi": 0.7, "s.harp": 0.7, "s.kalimba": 0.7 }, harm: { "s.warmpad": 0.8, "s.harp": 0.7 }, pad: { "s.warmpad": 0.9, "s.choir": 0.7 } },
  postrock: { lead: { "s.cleangtr": 1, "s.violin": 0.6, "s.piano": 0.6, "s.glock": 0.5 }, harm: { "s.cleangtr": 0.9, "s.overdrive": 0.8, "s.piano": 0.5 }, bass: { "s.pickbass": 0.9, "s.fingerbass": 0.8 }, pad: { "s.strings": 0.9, "s.organ": 0.5 } },
  triphop: { lead: { "s.mutedtpt": 0.8, "s.flute": 0.6, "s.tenorsax": 0.6, "s.wurli": 0.8 }, harm: { "s.wurli": 1, "s.cp80": 0.8, "s.piano": 0.6 }, bass: { "s.synthbass": 0.9, "s.acbass": 0.7 }, pad: { "s.strings": 0.9, "s.organ": 0.5 } },
  reggae: { lead: { "s.organ": 0.5, "s.trumpet": 0.8, "s.tenorsax": 0.8, "s.trombone": 0.6, "s.piano": 0.5 }, harm: { "s.mutedgtr": 1, "s.organ": 0.9, "s.clav": 0.7, "s.piano": 0.6 }, bass: { "s.fingerbass": 1 }, pad: { "s.organ": 0.8 } },
  baroque: { lead: { "s.violin": 1, "s.recorder": 0.8, "s.oboe": 0.8, "s.flute": 0.8, "s.harpsichord": 0.9, "s.trumpet": 0.6 }, harm: { "s.harpsichord": 1, "s.organ": 0.8, "s.strings": 0.7 }, bass: { "s.cello": 1, "s.contrabass": 0.7 }, pad: { "s.strings": 0.9, "s.organ": 0.7 } },
  eastasian: { lead: { "s.shakuhachi": 1, "s.koto": 0.9, "s.panflute": 0.6, "s.shamisen": 0.8 }, harm: { "s.koto": 1, "s.shamisen": 0.8, "s.harp": 0.4 }, pad: { "s.strings": 0.8 } },
  chiptune: {}
};
// How typical an added player is: by its place in the style's band (the first ones most), with
// the exceptions below (a piano or strings in a rock band, bells in metal, now and then only).
const BAND_TYP = {
  rock: { "s.piano": 0.35, "s.strings": 0.35, "s.rockorgan": 0.6 },
  metal: { "s.celesta": 0.2, "s.organ": 0.4, "s.strings": 0.5, "s.timpani": 0.5 },
  postrock: { "s.horn": 0.5, "s.timpani": 0.5 },
  pop: { "s.flute": 0.4, "s.glock": 0.5 },
  funk: { "s.organ": 0.6 },
  blues: { "s.trombone": 0.5, "s.trumpet": 0.6 }
};
// A choice ranks what is typical of the genre first; within that the picture decides.
const W_TYP = 0.6, W_FIT = 0.4;
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
  // one instrument per track: a track does not take the one an earlier track has, unless the style
  // itself plays it there (a classical piano plays both the melody and the accompaniment)
  for (const layer of ["lead", "harm", "bass", "pad"]) {
    const own = keyOf(style, layer, melody, samples), typ = { ...(own ? { [own]: 1 } : {}), ...(pool[layer] || {}) };
    if (layer === "lead" && melody !== "classic") { out[layer] = null; if (own) taken.add(LIBRARY[own].name); continue; }
    const cands = Object.keys(typ).filter(k => usable(k, samples) && (k === own || !taken.has(LIBRARY[k].name)));
    let best = null, bs = -Infinity;
    for (const k of cands) { const s = W_TYP * typ[k] + W_FIT * instrumentFit(k, pic) + JITTER * pictureDraw(A, layer + ":" + k); if (s > bs + 1e-9) { bs = s; best = k; } }
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
  const own = STYLE_BAND[style] || [], more = BAND_MORE[style] || [], over = BAND_TYP[style] || {};
  const band = [...own.map(([k, r], i) => [k, r, over[k] ?? 1 - 0.05 * i]), ...more.map(([k, r]) => [k, r, over[k] ?? 0.55])].filter(([k, r]) => ROLES[r] && usable(k, samples));
  // without sampled instruments, the style's synthesizer for each role
  const cands = band.length ? band : order.map(r => [roleInstrument(style, r, false), r, 1]).filter(([k]) => LIBRARY[k]);
  const scored = cands.map(([k, r, typ], i) => ({ k, r, i, s: W_TYP * typ + W_FIT * (0.6 * roleFit(r, pic) + 0.4 * instrumentFit(k, pic)) + 0.15 * (1 - Math.max(0, order.indexOf(r)) / order.length) + JITTER * pictureDraw(A, r + ":" + k) }))
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
