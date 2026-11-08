// Accompaniment patterns: how the harmony and the bass play over each chord.
//
// Chords sit on the harmonic grid of the style (RULES.unit in theory.js), so these patterns
// are laid out per chord slot, not per focus point. The style lists the articulations it
// allows (calm → busy); the arc section and the tension, with the area's texture, choose one:
//   harmony: block (held chord), swell (held chord that grows, film strings), arp (arpeggio,
//            up or down from the dominant edge orientation), broken (Alberti), pulse
//            (euclidean chord hits), comp (jazz Charleston: beat 1 and the "and" of 2),
//            stab (house chord stabs on the off-beats), ostinato (string sixteenths on root,
//            fifth and octave, the epic engine).
//   bass:    hold, pedal (tonic under every chord), pulse, walk (with a chromatic approach to
//            the next root), twofeel / rootfifth (half notes), offbeat (house eighths on the
//            "and"), ostinato (eighths, octave on the beat), rest (silent in the introduction).
import { clamp, clampInt, lerp } from "./util.js";
import { degMidi } from "./theory.js";
import { euclid } from "./rhythm.js";

export const HARM_NAME = { bossa: "bossa nova comping (clave)", block: "held chord", swell: "swelling held chord", pulse: "pulsing chord", arp: "arpeggio", broken: "broken chord", comp: "comping (Charleston)", stab: "off-beat stabs", ostinato: "string ostinato" };
export const BASS_NAME = { bossa: "bossa bass: root, then the fifth", octave8: "octave eighths (80s)", hold: "held root", pedal: "pedal on the tonic", pulse: "repeated root", walk: "walking line", twofeel: "two-feel, root and fifth", rootfifth: "root and fifth", offbeat: "off-beat eighths", ostinato: "eighth-note ostinato", rest: "silent (enters after the introduction)" };

// Articulation from the style's list: calm in the introduction and resolution, busiest at the
// climax, otherwise by 0.6·tension + 0.4·texture (< 0.5 calm, < 0.68 middle, else busy).
export function pickKind(list, D, tex, section, arcOn) {
  const calm = list[0], busy = list[list.length - 1], mid = list.length > 2 ? list[1] : busy;
  if (arcOn && (section === "intro" || section === "resolution")) return calm;
  if (section === "climax") return busy;
  const s = 0.6 * D + 0.4 * tex;
  return s < 0.5 ? calm : s < 0.68 ? mid : busy;
}

// base: { vel, tim, pan, glide } shared by the notes; a: area drive. Returns harmony notes.
export function harmonyNotes(kind, chord, t0, dur, D, a, base) {
  const end = t0 + dur, out = [], sorted = [...chord].sort((x, y) => x - y);
  const mk = (t, d, midi, vel, first, extra) => out.push({ layer: "harm", t, dur: Math.max(0.1, Math.min(d, end - t)), midi, vel: clampInt(Math.round(vel), 1, 127), tim: base.tim, pan: base.pan, glide: first ? base.glide : null, ...extra });
  const grid = (fn) => { for (let j = Math.round(t0 * 4); j < Math.round(end * 4); j++) fn(j / 4, ((j % 16) + 16) % 16); };
  if (kind === "block") { chord.forEach(m => mk(t0, dur * 0.98, m, base.vel, true)); return out; }
  if (kind === "swell") { chord.forEach(m => mk(t0, dur, m, base.vel * 0.9, true, { swell: true })); return out; }
  if (kind === "pulse") {
    const hits = euclid(Math.round(lerp(3, 8, a.tex)), 16, a.rot), steps = [];
    grid((t, q) => { if (hits[q]) steps.push(t); });
    if (!steps.length || steps[0] > t0 + 1e-9) steps.unshift(t0);
    steps.forEach((t, k) => { const nx = steps[k + 1] ?? end; chord.forEach(m => mk(t, Math.min(1, nx - t) * 0.9, m, base.vel * (k ? 0.82 : 0.95), k === 0)); });
    return out;
  }
  if (kind === "bossa") {
    // guitar comping on the 3-2 bossa clave over two bars: beats 0, 1.5, 3 | 5, 6.5
    let k = 0;
    grid((t, q) => {
      const bar = Math.floor(t / 4 + 1e-9), pos = q + (bar % 2) * 16;
      if ([0, 6, 12, 20, 26].includes(pos)) { chord.forEach(m => mk(t, pos === 12 || pos === 26 ? 0.9 : 0.6, m, base.vel * (pos === 0 ? 0.88 : 0.76), k === 0)); k++; }
    });
    if (!k) chord.forEach(m => mk(t0, 0.6, m, base.vel * 0.85, true));
    return out;
  }
  if (kind === "comp") {
    // Charleston: beat 1 (short) and the "and" of 2 (longer); a third hit on the "and" of 4 when tense
    let k = 0;
    grid((t, q) => { if (q === 0 || q === 6 || (D > 0.7 && q === 14)) { chord.forEach(m => mk(t, q === 6 ? 1.2 : 0.45, m, base.vel * (q === 0 ? 0.85 : 0.78), k === 0)); k++; } });
    if (!k) chord.forEach(m => mk(t0, 0.45, m, base.vel * 0.85, true));
    return out;
  }
  if (kind === "stab") {
    // house stabs: short chords on the off-beat eighths (sidechained against the kick)
    let k = 0;
    grid((t, q) => { if (q % 4 === 2) { chord.forEach(m => mk(t, 0.32, m, base.vel * 0.9, k === 0)); k++; } });
    return out;
  }
  if (kind === "ostinato") {
    // sixteenths on root, fifth and octave of the chord, accent on each beat
    const root = sorted[0], fifth = sorted.find(m => ((m - root) % 12 + 12) % 12 === 7) ?? sorted[sorted.length - 1];
    const fig = [root, root + 12, fifth, root + 12];
    let k = 0;
    grid((t, q) => { mk(t, 0.22, fig[q % 4], base.vel * (q % 4 === 0 ? 0.95 : 0.7), k === 0); k++; });
    return out;
  }
  const rate = kind === "arp" && D > 0.78 ? 0.25 : 0.5;
  let seq;
  if (kind === "arp") { const up = [...sorted, sorted[0] + 12]; seq = a.rot / 3 >= 2 ? up.reverse() : up; }
  else seq = sorted.length >= 4 ? [sorted[0], sorted[3], sorted[1], sorted[2]] : [sorted[0], sorted[2], sorted[1], sorted[2]];
  for (let k = 0, t = t0; t < end - 1e-9; k++, t += rate) mk(t, rate * (kind === "arp" ? 1.8 : 1.4), seq[k % seq.length], base.vel * (k % seq.length === 0 ? 0.9 : 0.74), k === 0);
  return out;
}

/*
 * Bass notes over one chord slot. root: scale degree; bm: the root in MIDI 33-47;
 * tonic: the key's tonic in the same range (for the pedal); nextBm: the next chord's root
 * (for approach notes), or null.
 */
export function bassNotes(kind, root, modeIv, pcOff, bm, t0, dur, a, base, opts = {}) {
  const out = [], mk = (t, d, midi, vel, first, extra) => out.push({ layer: "bass", t, dur: d, midi, vel, tim: base.tim, pan: 0, glide: first ? base.glide : null, ...extra });
  const near = (deg, lo, hi) => { let m = degMidi(deg, modeIv, 36 + pcOff); while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
  const { tonic = bm, nextBm = null, nextRoot = null, approach = false } = opts;
  // approach note on the last beat: the scale step next to the next root, on the side we come
  // from (chromatic in the walk), so the bass leads into the new chord
  const appr = nextBm !== null && nextRoot !== null && nextBm !== bm && approach && dur >= 2;
  const body = appr ? dur - 1 : dur;
  const approachNote = () => { if (appr) mk(t0 + dur - 1, 0.9, near(nextRoot + (nextBm > bm ? -1 : 1), nextBm - 3, nextBm + 3), 72, false); };
  if (kind === "rest") return out;
  if (kind === "hold" || kind === "pedal") { mk(t0, body * 0.97, kind === "pedal" ? tonic : bm, 80, true); if (kind !== "pedal") approachNote(); return out; }
  if (kind === "pulse") {
    const sub = a.tex > 0.66 ? 0.5 : a.tex > 0.33 ? 1 : 2;
    for (let b = 0; b < dur - 1e-6; b += sub) mk(t0 + b, Math.min(sub, dur - b) * 0.8, bm, b === 0 ? 88 : 70, b === 0);
    return out;
  }
  if (kind === "offbeat") {
    for (let b = 0.5; b < dur - 1e-6; b += 1) mk(t0 + b, 0.4, bm, 86, b === 0.5);
    return out;
  }
  if (kind === "ostinato") {
    for (let b = 0, k = 0; b < dur - 1e-6; b += 0.5, k++) mk(t0 + b, 0.42, k % 4 === 2 && bm + 12 <= 59 ? bm + 12 : bm, k % 2 ? 70 : 90, k === 0);
    return out;
  }
  if (kind === "bossa") {
    // per bar: root on 1 (dotted quarter), fifth on the "and" of 2, fifth on 3 held
    const fifth = near(root + 4, bm - 5, bm + 7);
    for (let b = 0; b < dur - 1e-6; b += 4) {
      mk(t0 + b, Math.min(1.45, dur - b), bm, 84, b === 0);
      if (b + 1.5 < dur - 1e-6) mk(t0 + b + 1.5, 0.45, fifth, 70, false);
      if (b + 2 < dur - 1e-6) mk(t0 + b + 2, Math.min(1.9, dur - b - 2), fifth, 76, false);
    }
    return out;
  }
  if (kind === "octave8") {
    for (let b = 0, k = 0; b < dur - 1e-6; b += 0.5, k++) mk(t0 + b, 0.42, k % 2 && bm + 12 <= 59 ? bm + 12 : bm, k % 2 ? 72 : 88, k === 0);
    return out;
  }
  if (kind === "walk") {
    const walk = [0, 2, 4, 5], beats = Math.round(dur);
    for (let j = 0; j < beats; j++) {
      // jazz: a chromatic approach note, outside the scale on purpose (marked chromatic)
      if (appr && j === beats - 1) { const m = nextBm + (nextBm > bm ? -1 : 1); mk(t0 + j, 0.85, m, 74, false, { chromatic: true }); break; }
      mk(t0 + j, 0.85, near(root + walk[j % 4], bm - 2, bm + 10), j % 2 ? 68 : 82, j === 0);
    }
    return out;
  }
  // twofeel / rootfifth: half notes, root then fifth
  const fifth = near(root + 4, bm - 5, bm + 7);
  for (let b = 0, j = 0; b < body - 1e-6; b += 2, j++) mk(t0 + b, Math.min(2, body - b) * 0.9, j % 2 ? fifth : bm, j % 2 ? 72 : 84, j === 0);
  approachNote();
  return out;
}
