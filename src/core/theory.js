// Music theory, styles, per-layer instruments, semantic category profiles.

export const NOTE_SH = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const NOTE_FL = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export let SPELL = NOTE_SH;
export const setSpelling = tonicPc => { SPELL = [1, 3, 5, 8, 10].includes(tonicPc) ? NOTE_FL : NOTE_SH; };
export const pcName = pc => SPELL[((pc % 12) + 12) % 12];
export const midiName = m => pcName(m) + (Math.floor(m / 12) - 1);

export const MODES = {
  phrygian: { iv: [0, 1, 3, 5, 7, 8, 10], b: 1, name: "Phrygian" },
  aeolian: { iv: [0, 2, 3, 5, 7, 8, 10], b: 2, name: "Aeolian (natural minor)" },
  dorian: { iv: [0, 2, 3, 5, 7, 9, 10], b: 3, name: "Dorian" },
  mixolydian: { iv: [0, 2, 4, 5, 7, 9, 10], b: 4, name: "Mixolydian" },
  ionian: { iv: [0, 2, 4, 5, 7, 9, 11], b: 5, name: "Ionian (major)" },
  lydian: { iv: [0, 2, 4, 6, 7, 9, 11], b: 6, name: "Lydian" }
};

/*
 * Base instruments. The image only modulates them (see timbre.js).
 * Parameter meaning per instrument type:
 *   pluck (Karplus-Strong): a = attack smoothing (s), d = T60, string decay time (s),
 *     r = release after the note ends (s), col = excitation brightness (0..1), cut/q = output filter.
 *   fm (2 operators):       a, d, s, r = ADSR; col = modulation index (0..1 → 0.3..4.3);
 *     ratio = modulator/carrier ratio; the index decays with time constant d.
 *   bass (sine + saw):      a, d, s, r = ADSR; col = amount of sawtooth over the sine.
 *   pad (unison):           a, d, s, r = ADSR; col = sawtooth vs. triangle; det = detune (cents).
 */
const I = (type, name, p) => ({ type, name, a: 0.01, d: 0.5, s: 0.7, r: 0.5, cut: 3000, q: 0.8, col: 0.4, ...p });

export const STYLES = {
  ambient: {
    name: "Ambient", modes: ["phrygian", "aeolian", "dorian", "mixolydian", "ionian", "lydian"], tempo: [56, 82], pent: false, ext: 7, swing: 0, perc: "soft", bass: "hold", reverb: 0.6,
    inst: {
      lead: I("pluck", "Soft pluck", { a: 0.012, d: 2.4, r: 0.7, cut: 2600, q: 0.9, col: 0.35 }),
      harm: I("fm", "FM bell", { a: 0.04, d: 1.6, s: 0.45, r: 1.6, cut: 5200, q: 0.7, col: 0.3, ratio: 2 }),
      bass: I("bass", "Round sub", { a: 0.02, d: 0.6, s: 0.85, r: 0.6, cut: 420, q: 0.9, col: 0.15 }),
      pad: I("pad", "Warm pad", { a: 1.4, d: 1.2, s: 0.85, r: 2.4, cut: 1300, q: 0.8, col: 0.35, det: 9 })
    },
    gm: { lead: 46, harm: 11, bass: 32, pad: 89 }
  },
  cinematic: {
    name: "Cinematic", modes: ["aeolian", "dorian", "ionian", "lydian"], tempo: [62, 96], pent: false, ext: 5, swing: 0, perc: "pulse", bass: "hold", reverb: 0.5,
    inst: {
      lead: I("pluck", "Harp", { a: 0.006, d: 3.2, r: 1.0, cut: 3800, q: 0.7, col: 0.5 }),
      harm: I("fm", "FM piano", { a: 0.01, d: 1.2, s: 0.35, r: 1.2, cut: 4200, q: 0.7, col: 0.35, ratio: 1 }),
      bass: I("bass", "Deep bass", { a: 0.03, d: 0.8, s: 0.9, r: 0.8, cut: 380, q: 0.8, col: 0.25 }),
      pad: I("pad", "Strings", { a: 0.9, d: 1.0, s: 0.9, r: 1.8, cut: 2200, q: 0.9, col: 0.7, det: 12 })
    },
    gm: { lead: 46, harm: 0, bass: 43, pad: 48 }
  },
  minimal: {
    name: "Minimal", modes: ["aeolian", "dorian", "mixolydian", "ionian"], tempo: [84, 118], pent: true, ext: 5, swing: 0, perc: "soft", bass: "pulse", reverb: 0.35,
    inst: {
      lead: I("pluck", "Short pluck", { a: 0.003, d: 0.9, r: 0.25, cut: 4200, q: 1.2, col: 0.55 }),
      harm: I("fm", "FM marimba", { a: 0.004, d: 0.5, s: 0.15, r: 0.4, cut: 6000, q: 0.7, col: 0.25, ratio: 4 }),
      bass: I("bass", "Pulse bass", { a: 0.006, d: 0.25, s: 0.6, r: 0.18, cut: 600, q: 1.4, col: 0.35 }),
      pad: I("pad", "Subtle pad", { a: 1.0, d: 1.0, s: 0.75, r: 1.6, cut: 1100, q: 0.8, col: 0.25, det: 6 })
    },
    gm: { lead: 46, harm: 12, bass: 33, pad: 89 }
  },
  jazz: {
    name: "Jazz", modes: ["dorian", "mixolydian", "ionian", "lydian"], tempo: [92, 138], pent: false, ext: 9, swing: 0.6, perc: "swing", bass: "walk", reverb: 0.3,
    inst: {
      lead: I("pluck", "Guitar", { a: 0.004, d: 1.6, r: 0.3, cut: 3000, q: 0.8, col: 0.4 }),
      harm: I("fm", "Electric piano", { a: 0.006, d: 1.0, s: 0.3, r: 0.6, cut: 3600, q: 0.7, col: 0.4, ratio: 1 }),
      bass: I("bass", "Upright bass", { a: 0.008, d: 0.35, s: 0.4, r: 0.15, cut: 700, q: 0.9, col: 0.1 }),
      pad: I("pad", "Soft organ", { a: 0.4, d: 0.8, s: 0.8, r: 0.9, cut: 1800, q: 0.7, col: 0.2, det: 4 })
    },
    gm: { lead: 26, harm: 4, bass: 32, pad: 16 }
  },
  electronic: {
    name: "Electronic", modes: ["phrygian", "aeolian", "dorian", "mixolydian"], tempo: [104, 126], pent: false, ext: 7, swing: 0, perc: "four", bass: "pulse", reverb: 0.3,
    inst: {
      lead: I("pluck", "Synth pluck", { a: 0.002, d: 0.8, r: 0.2, cut: 3200, q: 3.5, col: 0.8 }),
      harm: I("pad", "Saw chord stab", { a: 0.004, d: 0.35, s: 0.55, r: 0.16, cut: 2600, q: 1.4, col: 0.85, det: 14, lvl: 0.75 }),
      bass: I("bass", "Synth bass", { a: 0.004, d: 0.22, s: 0.7, r: 0.12, cut: 750, q: 3, col: 0.7 }),
      pad: I("pad", "Wide pad", { a: 0.6, d: 1.0, s: 0.8, r: 1.2, cut: 2400, q: 1.5, col: 0.85, det: 18 })
    },
    gm: { lead: 84, harm: 90, bass: 38, pad: 88 }
  },
  epic: {
    name: "Orchestral epic", modes: ["phrygian", "aeolian", "dorian"], tempo: [88, 128], pent: false, ext: 5, swing: 0, perc: "taiko", bass: "ostinato", reverb: 0.55,
    inst: {
      lead: I("pad", "Horn section", { a: 0.09, d: 0.8, s: 0.85, r: 0.5, cut: 1900, q: 0.9, col: 0.62, det: 6, lvl: 0.6, vib: 5 }),
      harm: I("pad", "String ostinato", { a: 0.01, d: 0.25, s: 0.55, r: 0.12, cut: 3200, q: 0.8, col: 0.7, det: 8, lvl: 0.8 }),
      bass: I("bass", "Low strings", { a: 0.02, d: 0.4, s: 0.8, r: 0.2, cut: 650, q: 0.8, col: 0.55 }),
      pad: I("pad", "Choir", { a: 0.8, d: 1.2, s: 0.9, r: 1.6, cut: 1500, q: 0.7, col: 0.15, det: 7 })
    },
    gm: { lead: 60, harm: 48, bass: 43, pad: 52 }
  },
  movie: {
    name: "Movie score", modes: ["aeolian", "dorian", "ionian", "lydian"], tempo: [60, 88], pent: false, ext: 7, swing: 0, perc: "score", bass: "pedal", reverb: 0.6,
    inst: {
      lead: I("fm", "Felt piano", { a: 0.004, d: 2.6, s: 0.15, r: 1.2, cut: 2600, q: 0.7, col: 0.12, ratio: 1 }),
      harm: I("pad", "Legato strings", { a: 0.45, d: 1.0, s: 0.9, r: 1.2, cut: 2300, q: 0.8, col: 0.6, det: 10, lvl: 0.75, vib: 4 }),
      bass: I("bass", "Celli and basses", { a: 0.12, d: 0.8, s: 0.9, r: 0.8, cut: 520, q: 0.8, col: 0.35 }),
      pad: I("pad", "Soft strings", { a: 1.2, d: 1.2, s: 0.9, r: 2.2, cut: 1600, q: 0.7, col: 0.45, det: 9 })
    },
    gm: { lead: 0, harm: 48, bass: 42, pad: 49 }
  },
  lofi: {
    name: "Lo-fi hip hop", modes: ["dorian", "aeolian", "mixolydian", "ionian"], tempo: [70, 90], pent: false, ext: 9, swing: 0.35, swing16: 0.55, perc: "boombap", bass: "hold", reverb: 0.35,
    inst: {
      lead: I("fm", "Mellow keys", { a: 0.006, d: 1.4, s: 0.25, r: 0.6, cut: 2200, q: 0.7, col: 0.18, ratio: 1 }),
      harm: I("fm", "Dusty electric piano", { a: 0.008, d: 1.6, s: 0.35, r: 0.8, cut: 1800, q: 0.7, col: 0.3, ratio: 1 }),
      bass: I("bass", "Warm bass", { a: 0.01, d: 0.6, s: 0.7, r: 0.25, cut: 480, q: 0.8, col: 0.15 }),
      pad: I("pad", "Tape pad", { a: 1.2, d: 1.0, s: 0.8, r: 2.0, cut: 1100, q: 0.7, col: 0.3, det: 14 })
    },
    gm: { lead: 4, harm: 4, bass: 33, pad: 89 }
  },
  bossa: {
    name: "Bossa nova", modes: ["dorian", "ionian", "lydian", "mixolydian"], tempo: [110, 140], pent: false, ext: 9, swing: 0, perc: "bossa", bass: "bossa", reverb: 0.3,
    inst: {
      lead: I("pluck", "Nylon melody", { a: 0.005, d: 1.8, r: 0.35, cut: 2800, q: 0.7, col: 0.3 }),
      harm: I("pluck", "Nylon comping", { a: 0.004, d: 1.2, r: 0.3, cut: 2600, q: 0.7, col: 0.35 }),
      bass: I("bass", "Upright bass", { a: 0.008, d: 0.4, s: 0.45, r: 0.15, cut: 700, q: 0.9, col: 0.1 }),
      pad: I("pad", "Soft strings", { a: 1.0, d: 1.0, s: 0.85, r: 1.6, cut: 1500, q: 0.7, col: 0.4, det: 8 })
    },
    gm: { lead: 24, harm: 24, bass: 32, pad: 49 }
  },
  synthwave: {
    name: "Synthwave", modes: ["aeolian", "dorian", "phrygian"], tempo: [84, 118], pent: false, ext: 5, swing: 0, perc: "gated", bass: "octave8", reverb: 0.45,
    inst: {
      lead: I("pad", "Saw lead", { a: 0.02, d: 0.5, s: 0.8, r: 0.4, cut: 3400, q: 1.6, col: 0.85, det: 10, vib: 8, lvl: 0.6 }),
      harm: I("pad", "Poly synth", { a: 0.05, d: 0.6, s: 0.7, r: 0.6, cut: 2400, q: 1.2, col: 0.7, det: 12, lvl: 0.7 }),
      bass: I("bass", "Octave bass", { a: 0.004, d: 0.2, s: 0.7, r: 0.1, cut: 900, q: 2.4, col: 0.8 }),
      pad: I("pad", "Analog pad", { a: 1.0, d: 1.0, s: 0.85, r: 1.8, cut: 1800, q: 1.1, col: 0.75, det: 16 })
    },
    gm: { lead: 81, harm: 90, bass: 38, pad: 89 }
  },
  classical: {
    name: "Classical", modes: ["ionian", "aeolian"], tempo: [66, 112], pent: false, ext: 5, swing: 0, perc: "none", bass: "hold", reverb: 0.5,
    inst: {
      lead: I("fm", "Piano (right hand)", { a: 0.004, d: 2.2, s: 0.15, r: 0.9, cut: 4200, q: 0.6, col: 0.15, ratio: 1 }),
      harm: I("fm", "Piano (left hand)", { a: 0.004, d: 1.8, s: 0.15, r: 0.8, cut: 3200, q: 0.6, col: 0.12, ratio: 1 }),
      bass: I("bass", "Cello", { a: 0.08, d: 0.8, s: 0.85, r: 0.6, cut: 1200, q: 0.8, col: 0.45 }),
      pad: I("pad", "String quartet", { a: 0.6, d: 1.0, s: 0.85, r: 1.2, cut: 2400, q: 0.8, col: 0.55, det: 6 })
    },
    gm: { lead: 0, harm: 0, bass: 42, pad: 48 }
  },
  pop: {
    name: "Pop", modes: ["ionian", "mixolydian", "aeolian", "dorian"], tempo: [96, 124], pent: false, ext: 5, swing: 0, perc: "pop", bass: "pick8", reverb: 0.35,
    inst: {
      lead: I("pad", "Pop lead", { a: 0.02, d: 0.5, s: 0.8, r: 0.35, cut: 3600, q: 1.1, col: 0.5, det: 6, vib: 6, lvl: 0.6 }),
      harm: I("fm", "Pop piano", { a: 0.004, d: 1.4, s: 0.2, r: 0.5, cut: 4200, q: 0.6, col: 0.2, ratio: 1 }),
      bass: I("bass", "Pop bass", { a: 0.005, d: 0.3, s: 0.6, r: 0.12, cut: 1100, q: 1.2, col: 0.5 }),
      pad: I("pad", "Synth strings", { a: 0.5, d: 1.0, s: 0.85, r: 1.4, cut: 2200, q: 0.8, col: 0.55, det: 12 })
    },
    gm: { lead: 80, harm: 0, bass: 33, pad: 50 }
  },
  rock: {
    name: "Rock", modes: ["mixolydian", "aeolian", "dorian", "ionian"], tempo: [100, 140], pent: false, ext: 5, swing: 0, perc: "rock", bass: "pick8", reverb: 0.3,
    inst: {
      lead: I("pad", "Lead guitar", { a: 0.01, d: 0.6, s: 0.85, r: 0.3, cut: 3000, q: 1.4, col: 0.9, det: 8, vib: 10, lvl: 0.55 }),
      harm: I("pad", "Rhythm guitar", { a: 0.006, d: 0.4, s: 0.8, r: 0.15, cut: 2600, q: 1.1, col: 0.95, det: 14, lvl: 0.7 }),
      bass: I("bass", "Picked bass", { a: 0.004, d: 0.25, s: 0.7, r: 0.1, cut: 1300, q: 1.4, col: 0.65 }),
      pad: I("pad", "Rock organ", { a: 0.05, d: 0.8, s: 0.85, r: 0.5, cut: 2200, q: 0.8, col: 0.4, det: 6 })
    },
    gm: { lead: 29, harm: 30, bass: 34, pad: 18 }
  },
  metal: {
    name: "Metal", modes: ["phrygian", "aeolian"], tempo: [120, 168], pent: false, ext: 5, swing: 0, perc: "metal", bass: "chug16", reverb: 0.28,
    inst: {
      lead: I("pad", "Lead guitar", { a: 0.01, d: 0.6, s: 0.85, r: 0.3, cut: 3200, q: 1.6, col: 0.95, det: 8, vib: 12, lvl: 0.55 }),
      harm: I("pad", "Heavy guitar", { a: 0.004, d: 0.3, s: 0.85, r: 0.08, cut: 2200, q: 1.3, col: 1, det: 16, lvl: 0.7 }),
      bass: I("bass", "Heavy bass", { a: 0.003, d: 0.2, s: 0.8, r: 0.08, cut: 1000, q: 1.6, col: 0.8 }),
      pad: I("pad", "Dark choir", { a: 0.8, d: 1.0, s: 0.85, r: 1.4, cut: 1600, q: 0.8, col: 0.3, det: 10 })
    },
    gm: { lead: 30, harm: 30, bass: 34, pad: 52 }
  },
  blues: {
    name: "Blues", modes: ["mixolydian"], tempo: [72, 104], pent: false, melScale: [0, 2, 3, 4, 7, 9, 10], ext: 7, swing: 0.95, perc: "shuffle", bass: "boogie", reverb: 0.35,
    inst: {
      lead: I("pluck", "Blues guitar", { a: 0.004, d: 1.6, r: 0.3, cut: 3000, q: 0.9, col: 0.5 }),
      harm: I("fm", "Blues piano", { a: 0.004, d: 1.3, s: 0.2, r: 0.5, cut: 3600, q: 0.6, col: 0.22, ratio: 1 }),
      bass: I("bass", "Upright bass", { a: 0.008, d: 0.4, s: 0.45, r: 0.15, cut: 700, q: 0.9, col: 0.1 }),
      pad: I("pad", "Hammond organ", { a: 0.03, d: 0.8, s: 0.85, r: 0.4, cut: 2400, q: 0.8, col: 0.3, det: 4 })
    },
    gm: { lead: 26, harm: 0, bass: 32, pad: 16 }
  },
  funk: {
    name: "Funk", modes: ["dorian", "mixolydian"], tempo: [92, 116], pent: false, ext: 9, swing: 0, swing16: 0.4, perc: "funk", bass: "funk16", reverb: 0.25,
    inst: {
      lead: I("pad", "Horn section", { a: 0.02, d: 0.5, s: 0.8, r: 0.2, cut: 3200, q: 1.2, col: 0.8, det: 6, lvl: 0.6 }),
      harm: I("pluck", "Funk guitar", { a: 0.003, d: 0.35, r: 0.06, cut: 3400, q: 0.9, col: 0.6 }),
      bass: I("bass", "Slap bass", { a: 0.003, d: 0.25, s: 0.5, r: 0.08, cut: 1600, q: 1.6, col: 0.55 }),
      pad: I("pad", "Organ", { a: 0.03, d: 0.8, s: 0.85, r: 0.3, cut: 2200, q: 0.8, col: 0.3, det: 4 })
    },
    gm: { lead: 61, harm: 28, bass: 36, pad: 16 }
  }
};

/*
 * Genre rules (the frame each style keeps; see docs/documentation.md §9.2):
 *   grid:     rounding of focus point durations in beats (points start on beats, or every 2 beats)
 *   unit:     harmonic rhythm in beats (chords change on this grid, never in between)
 *   phrase:   bars per drum phrase (the groove is constant inside a phrase)
 *   harm:     harmony articulations, calm → busy (patterns.js)
 *   bass:     bass kinds, calm → busy
 *   cands:    chord candidates (scale degrees) for bright and dark areas
 *   sidechain: ducking of harmony, bass and pad on each kick (0 = none)
 *   pickups:  passing notes into the next focus point in the classic melody
 *   approach: bass approach note on the last beat of a chord
 *   swell:    transition sound before section changes: riser, cymbal or timpani roll
 *   stopDown: the music cuts out for half a beat before the climax (trailer device)
 *   cadentialV: the chord before the final cadence is the dominant (V-I, classical)
 */
export const RULES = {
  ambient: { grid: 1, unit: 8, phrase: 2, harm: ["block", "arp"], bass: ["pedal", "hold"], cands: [[0, 3, 4], [5, 1, 2]], sidechain: 0, pickups: true, approach: false, swell: "cymbal", stopDown: false },
  cinematic: { grid: 1, unit: 4, phrase: 2, harm: ["block", "broken", "arp"], bass: ["hold", "rootfifth"], cands: [[0, 3, 4], [5, 1, 2]], sidechain: 0, pickups: true, approach: true, swell: "cymbal", stopDown: false },
  minimal: { grid: 1, unit: 8, phrase: 4, harm: ["broken", "arp"], bass: ["pulse", "pulse"], cands: [[0, 3, 4], [5, 3, 1]], sidechain: 0, pickups: false, approach: false, swell: null, stopDown: false },
  jazz: { grid: 1, unit: 4, phrase: 2, harm: ["block", "comp"], bass: ["twofeel", "walk"], cands: [[0, 3, 4], [1, 5, 2]], sidechain: 0, pickups: true, approach: true, swell: null, stopDown: false },
  electronic: { grid: 2, unit: 4, phrase: 4, harm: ["block", "stab"], bass: ["hold", "offbeat"], cands: [[0, 5, 3], [5, 3, 6]], sidechain: 0.65, pickups: false, approach: false, swell: "riser", stopDown: false },
  epic: { grid: 2, unit: 4, phrase: 2, harm: ["block", "ostinato"], bass: ["hold", "ostinato"], cands: [[5, 2, 6], [0, 3, 5]], sidechain: 0, pickups: false, approach: false, swell: "timpani", stopDown: true },
  lofi: { grid: 1, unit: 4, phrase: 4, harm: ["block", "comp"], bass: ["hold", "rootfifth"], cands: [[1, 4, 0], [5, 3, 1]], sidechain: 0.25, pickups: true, approach: false, swell: null, stopDown: false },
  bossa: { grid: 1, unit: 4, phrase: 2, harm: ["block", "bossa"], bass: ["bossa", "bossa"], cands: [[0, 1, 4], [1, 4, 5]], sidechain: 0, pickups: true, approach: false, swell: null, stopDown: false },
  synthwave: { grid: 2, unit: 4, phrase: 4, harm: ["block", "arp"], bass: ["hold", "octave8"], cands: [[5, 2, 6], [0, 5, 3]], sidechain: 0.3, pickups: false, approach: false, swell: "riser", stopDown: false },
  classical: { grid: 1, unit: 4, phrase: 4, harm: ["block", "broken"], bass: ["hold", "rootfifth"], cands: [[0, 3, 4], [5, 1, 4]], sidechain: 0, pickups: true, approach: true, swell: null, stopDown: false, cadentialV: true },
  // pop: one chord per bar on the four-chord loop (I-V-vi-IV in major, i-VI-III-VII in minor)
  pop: { grid: 1, unit: 4, phrase: 4, harm: ["block", "pulse", "arp"], bass: ["hold", "pick8"], cands: [[0, 4, 5], [5, 3, 0]], loop: { major: [0, 4, 5, 3], minor: [0, 5, 2, 6] }, sidechain: 0.12, pickups: true, approach: false, swell: "riser", stopDown: false },
  // rock: power chords, held when calm and in eighths when driving; the bass in eighths
  rock: { grid: 1, unit: 4, phrase: 4, harm: ["power", "power8"], padLevel: 0.7, bass: ["pick8", "pick8"], cands: [[0, 3, 4], [5, 3, 4]], sidechain: 0, pickups: true, approach: false, swell: "cymbal", stopDown: false, drive: { harm: 0.45, lead: 0.3 } },
  // metal: palm-muted sixteenth riffs locked with the bass, a break before the climax
  metal: { grid: 1, unit: 4, phrase: 2, harm: ["powerhit", "power8", "chug16"], padLevel: 0.5, bass: ["pick8", "chug16"], cands: [[0, 5, 6], [0, 3, 5]], sidechain: 0, pickups: false, approach: false, swell: "cymbal", stopDown: true, drive: { harm: 0.6, lead: 0.4, bass: 0.15 } },
  // blues: the 12-bar form, every chord a dominant seventh (I7 IV7 V7), a boogie bass, shuffle
  blues: { grid: 1, unit: 4, phrase: 4, harm: ["block", "comp"], padLevel: 0.8, bass: ["boogie", "boogie"], cands: [[0, 3, 4], [0, 3, 4]], loop: { major: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], minor: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4] }, quality: "dom7", sidechain: 0, pickups: true, approach: false, swell: null, stopDown: false },
  // funk: a vamp on one or two chords, scratch guitar and syncopated bass in sixteenths
  funk: { grid: 1, unit: 4, phrase: 2, harm: ["comp", "funk16"], padLevel: 0.6, bass: ["funk16", "funk16"], cands: [[0, 3, 4], [0, 3, 6]], loop: { major: [0, 0, 3, 0], minor: [0, 0, 3, 3] }, sidechain: 0, pickups: false, approach: false, swell: null, stopDown: false },
  movie: { grid: 1, unit: 8, phrase: 2, harm: ["swell", "arp"], bass: ["pedal", "hold"], cands: [[0, 3, 4], [5, 3, 1]], sidechain: 0, pickups: true, approach: true, swell: "cymbal", stopDown: false }
};

// Semantic categories shift the modulation vector (in m units, see timbre.js).
export const CAT = {
  living: { label: "a warm voice", bias: { leg: 0.4, col: 0.3 } },
  natural: { label: "a soft sound", bias: { att: 0.4, leg: 0.5 } },
  artificial: { label: "a percussive sound", bias: { att: -0.6, bri: 0.3, leg: -0.3 } }
};

export function degMidi(deg, iv, base) {
  const n = iv.length, o = Math.floor(deg / n), k = ((deg % n) + n) % n;
  return base + 12 * o + iv[k];
}
export function objectAt(sem, x, y) {
  if (!sem || !sem.objects) return null;
  let best = null;
  for (const o of sem.objects) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h && (!best || (o.importance ?? 0) > (best.importance ?? 0))) best = o;
  return best;
}
export const LAYERS = ["lead", "harm", "bass", "pad", "perc"];
export const LAYER_NAME = { lead: "Melody", harm: "Harmony", bass: "Bass", pad: "Pad", perc: "Rhythm" };
// Drum kit of each style (see rhythm.js)
export const PERC_NAME = { ambient: "Shaker, rim and soft toms", cinematic: "Toms, snare and crash", minimal: "Hats, rims and kick", jazz: "Ride, brushes and kick", electronic: "Kick, clap and hats", epic: "Taiko, timpani and braams", movie: "Timpani and cymbal swells", lofi: "Boom-bap kit", bossa: "Rim, shaker and soft kick", synthwave: "Gated 80s kit", classical: "No drums", pop: "Kick, clap, snare and hats", rock: "Rock kit with crashes", metal: "Double bass drum, snare and cymbals", blues: "Shuffle on the ride", funk: "Tight kit with ghost notes" };
