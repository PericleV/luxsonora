// Tuning of the sampled instruments that are out of tune, note by note.
//
// Each was measured in the app: a note rendered offline, its first five harmonics found by a fine
// Fourier transform (2-cent steps, ±70 cents round where each should be) and the median taken as
// how far the note is from where it should be, in cents (positive: sharp). The voices come from
// tape instruments (Mellotron and Chamberlin, one tape per key) and drift by up to ±70 cents from
// key to key; some General MIDI sounds are off by a zone of a few keys. Playing a note, the app
// detunes it by the opposite (smplr's detune), so it sounds in tune; a key between or beyond the
// measured ones takes the nearest one's value. The other instruments were within ±6 cents and are
// left alone.
const MEASURED = {
  // Mixed choir (v.mixed)
  "mellotron:8VOICE CHOIR": { 43: -30, 44: -30, 45: 12, 46: 4, 47: 16, 48: -22, 49: -22, 50: 10, 51: 10, 52: 0, 53: -10, 54: -10, 55: 26, 56: 26, 57: -2, 58: -2, 59: -12, 60: 8, 61: 8, 62: -24, 63: -24, 64: 12, 65: 10, 66: 10, 67: 10, 68: 10, 69: 10, 70: -16, 71: -16, 72: -16, 73: 21, 74: 30, 75: 30, 76: 30, 77: 30 },
  // Male voices (v.male)
  "mellotron:CHMB MALE VC": { 41: 18, 42: 28, 43: -2, 44: 4, 45: 14, 46: 46, 47: 12, 48: 46, 49: 48, 50: -20, 51: 52, 52: 48, 53: 38, 54: 14, 55: 30, 56: 32, 57: 10, 58: 10, 59: 66, 60: 70, 61: 42, 62: 48, 63: -38, 64: 0, 65: -54, 66: -54, 67: -52 },
  // Female voices (v.female)
  "mellotron:CHMB FEMALE": { 55: 38, 56: 22, 57: 38, 58: 38, 59: 24, 60: 36, 61: 36, 62: 36, 63: 38, 64: 38, 65: 38, 66: 38, 67: 26, 68: 26, 69: 26, 70: 26, 71: 26, 72: 26, 73: 24, 74: 24, 75: 40, 76: 40, 77: 40, 78: 10, 79: 10 },
  // Boys choir (v.boys)
  "mellotron:BOYS CHOIR": { 55: 16, 56: 8, 57: -40, 58: 4, 59: -68, 60: -16, 61: -44, 62: -56, 63: -50, 64: -68, 65: -48, 66: -38, 67: -38, 68: -38, 69: -38, 70: -38, 71: -38, 72: -38, 73: -38, 74: -38, 75: -38, 76: -38, 77: -38, 78: -38, 79: -38 },
  // Choir (s.choir)
  "sf:choir_aahs": { 43: 8, 44: 8, 45: 10, 46: 14, 47: -10, 48: -10, 49: -18, 50: -10, 51: -10, 52: 14, 53: 8, 54: -24, 55: -22, 56: -16, 57: -16, 58: -10, 59: -34, 60: -4, 61: -4, 62: 0, 63: 0, 64: 6, 65: -10, 66: -6, 67: -2, 68: -2, 69: -2, 70: 0, 71: 0, 72: 22, 73: 22, 74: -6, 75: -6, 76: -18, 77: -18, 78: 4, 79: -10 },
  // Electric bass (s.fingerbass)
  "sf:electric_bass_finger": { 28: -12, 29: 0, 30: 4, 31: 2, 32: 30, 33: -10, 34: -2, 35: 18, 36: 18, 37: 0, 38: -4, 39: -4, 40: 22, 41: 16, 42: 28, 43: -20, 44: -18, 45: -18, 46: -8, 47: -18, 48: 4, 49: 22, 50: 16, 51: 2, 52: 26, 53: 6, 54: 2, 55: 2, 56: 28, 57: 22, 58: 28, 59: 28, 60: 28 },
  // Synth bass (s.synthbass)
  "sf:synth_bass_1": { 28: -6, 36: -6, 37: -8, 60: -8 },
  // Nylon guitar (s.nylon)
  "sf:acoustic_guitar_nylon": { 40: 0, 41: 2, 42: 8, 43: 10, 44: 2, 45: 10, 46: 6, 47: 6, 48: 8, 49: 4, 50: 6, 51: 4, 52: 8, 53: 2, 54: 2, 55: 16, 56: 6, 57: 6, 58: 4, 59: 10, 60: 10, 61: 10, 62: 8, 63: 8, 64: 4, 65: 6, 66: 4, 67: 6, 68: 8, 69: 2, 70: 6, 84: 6 },
  // Picked bass (s.pickbass)
  "sf:electric_bass_pick": { 28: 12, 29: 12, 30: 10, 31: 12, 32: 10, 33: 10, 34: 12, 35: 12, 36: 12, 37: 8, 38: 8, 39: 8, 40: 20, 41: 20, 42: 20, 43: 16, 44: 16, 45: 16, 46: -4, 47: -4, 48: -4, 49: -4, 50: 8, 51: 8, 52: 8, 53: 8, 54: 14, 55: 14, 56: 14, 57: 8, 58: 8, 59: 8, 60: 6 },
  // Distortion guitar (s.distortion)
  "sf:distortion_guitar": { 40: 6, 41: 6, 42: 4, 43: 4, 44: 18, 45: 16, 46: 18, 47: 16, 48: 18, 49: 14, 50: 4, 51: 4, 52: 4, 53: 4, 54: 6, 55: 4, 56: 4, 57: 4, 58: 6, 59: 8, 60: 8, 61: 8, 62: 6, 63: 6, 64: 6, 65: 2, 66: 2, 67: 2, 68: 0, 79: 2 }
};
const keyOf = src => (src ? `${src.kind}:${src.instrument}` : "");
// the detune in cents that brings a sampled note in tune (0 for an instrument in tune)
export function tuneFix(src, note) {
  const t = MEASURED[keyOf(src)]; if (!t) return 0;
  let c = t[note];
  if (c === undefined) {
    // the nearest measured key (a sample zone covers several keys)
    let best = null; for (const k of Object.keys(t)) { const d = Math.abs(Number(k) - note); if (best === null || d < best[0]) best = [d, t[k]]; }
    c = best ? best[1] : 0;
  }
  return Math.abs(c) >= 4 ? -c : 0;
}
export const TUNED = Object.keys(MEASURED);
