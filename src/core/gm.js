// General MIDI programs in order (the soundfont names), and the program closest to an instrument,
// for the MIDI file (a DAW opens each track on a sound like the one heard in the app).
export const GM = "acoustic_grand_piano bright_acoustic_piano electric_grand_piano honkytonk_piano electric_piano_1 electric_piano_2 harpsichord clavinet celesta glockenspiel music_box vibraphone marimba xylophone tubular_bells dulcimer drawbar_organ percussive_organ rock_organ church_organ reed_organ accordion harmonica tango_accordion acoustic_guitar_nylon acoustic_guitar_steel electric_guitar_jazz electric_guitar_clean electric_guitar_muted overdriven_guitar distortion_guitar guitar_harmonics acoustic_bass electric_bass_finger electric_bass_pick fretless_bass slap_bass_1 slap_bass_2 synth_bass_1 synth_bass_2 violin viola cello contrabass tremolo_strings pizzicato_strings orchestral_harp timpani string_ensemble_1 string_ensemble_2 synth_strings_1 synth_strings_2 choir_aahs voice_oohs synth_choir orchestra_hit trumpet trombone tuba muted_trumpet french_horn brass_section synth_brass_1 synth_brass_2 soprano_sax alto_sax tenor_sax baritone_sax oboe english_horn bassoon clarinet piccolo flute recorder pan_flute blown_bottle shakuhachi whistle ocarina lead_1_square lead_2_sawtooth lead_3_calliope lead_4_chiff lead_5_charang lead_6_voice lead_7_fifths lead_8_bass__lead pad_1_new_age pad_2_warm pad_3_polysynth pad_4_choir pad_5_bowed pad_6_metallic pad_7_halo pad_8_sweep fx_1_rain fx_2_soundtrack fx_3_crystal fx_4_atmosphere fx_5_brightness fx_6_goblins fx_7_echoes fx_8_scifi sitar banjo shamisen koto kalimba bagpipe fiddle shanai tinkle_bell agogo steel_drums woodblock taiko_drum melodic_tom synth_drum reverse_cymbal guitar_fret_noise breath_noise seashore bird_tweet telephone_ring helicopter applause gunshot".split(" ");
// instrument name → program, first match wins
const BY_NAME = [
  [/wurli|electric piano|ep200|dusty|mellow keys|rhodes/, 4], [/cp80|electric grand/, 2], [/felt piano|piano/, 0], [/harpsichord/, 6], [/clavinet|clav\b/, 7],
  [/celesta/, 8], [/glock/, 9], [/music box/, 10], [/vibra/, 11], [/marimba/, 12], [/xylo/, 13], [/bell|chime/, 14],
  [/hammond|drawbar/, 16], [/rock organ/, 18], [/church/, 19], [/organ/, 16], [/accordion/, 21], [/harmonica/, 22],
  [/nylon/, 24], [/jazz guitar|blues guitar/, 26], [/clean electric|clean guitar/, 27], [/muted guitar|funk guitar/, 28], [/overdriv|lead guitar|rhythm guitar/, 29], [/distortion|heavy guitar/, 30], [/guitar|pluck/, 25],
  [/upright|acoustic bass/, 32], [/finger|electric bass|pop bass|warm bass/, 33], [/picked bass|heavy bass/, 34], [/slap/, 36], [/synth bass|octave bass|pulse bass|sub/, 38], [/bass/, 33],
  [/violin/, 40], [/viola/, 41], [/cello|celli/, 42], [/contrabass|low strings/, 43], [/tremolo/, 44], [/pizz/, 45], [/harp/, 46], [/timpani/, 47],
  [/string quartet|string ensemble|legato strings|soft strings|strings/, 48], [/synth strings/, 50], [/choir|voice/, 52],
  [/trumpet/, 56], [/trombone/, 57], [/tuba/, 58], [/horn section|horn/, 60], [/brass section|brass/, 61],
  [/soprano sax/, 64], [/alto sax/, 65], [/tenor sax|sax/, 66], [/oboe/, 68], [/bassoon/, 70], [/clarinet/, 71], [/piccolo/, 72], [/flute/, 73],
  [/saw lead|synth lead|pop lead|warm lead|soft lead/, 81], [/square/, 80], [/pad|wide|analog|tape/, 89], [/poly synth|stab|chord/, 90], [/fm bell|glass/, 98]
];
export function gmProgram(inst, fallback = 0) {
  if (inst && inst.src && inst.src.kind === "sf") { const i = GM.indexOf(inst.src.instrument); if (i >= 0) return i; }
  if (inst && inst.src && inst.src.kind === "piano") return 0;
  const n = ((inst && inst.name) || "").toLowerCase();
  if (n) for (const [re, p] of BY_NAME) if (re.test(n)) return p;
  return clampProgram(fallback);
}
const clampProgram = p => Math.max(0, Math.min(127, Math.round(p || 0)));
