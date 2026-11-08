// Rhythm: a drum kit and the groove conventions of each style, laid out in phrases.
//
// Genre rules first (see RULES in theory.js and docs §7.6): the groove is a bar pattern
// that stays the same for a whole phrase (2 or 4 bars), so it can lock in; it changes at
// phrase boundaries, with the section of the dramatic arc and with the tension of each bar.
// The image chooses the details: the area under the focus point at the start of a phrase
// sets the euclidean ornaments (number of onsets and rotation); the tension of each bar sets
// how many layers of the kit play. Area features are relative to the image (the timbre
// modulation vector m ∈ [−1, 1]^5, see timbre.js):
//   tex = mean of roughness (−legato) and entropy → ornament density
//   shp = edge sharpness                         → rim and click density
//   sat = saturation                             → open hi-hats in the drop
//   rotations from the dominant edge orientation and the horizontal position.
// Transitions: fills at phrase ends that lead into a new section, swells before section
// changes (riser, cymbal swell or timpani roll per style), a crash on the climax.
import { clamp, clampInt, lerp } from "./util.js";
import { dynamics } from "./arc.js";

// General MIDI percussion numbers used by the kits (channel 10).
export const DRUM = { kick: 36, rim: 37, snare: 38, clap: 39, ltom: 45, mtom: 48, htom: 50, chat: 42, phat: 44, ohat: 46, crash: 49, ride: 51, shaker: 70 };
export const DRUM_NAME = { 36: "Kick", 37: "Rim", 38: "Snare", 39: "Clap", 42: "Closed hi-hat", 44: "Pedal hi-hat", 45: "Low tom", 46: "Open hi-hat", 48: "Mid tom", 49: "Crash", 50: "High tom", 51: "Ride", 70: "Shaker" };

// Euclidean rhythm E(k, n) rotated by rot: k onsets spread as evenly as possible over n steps.
export function euclid(k, n = 16, rot = 0) {
  k = clampInt(k, 0, n);
  const out = new Array(n).fill(false);
  if (!k) return out;
  for (let i = 0; i < n; i++) out[(((i + rot) % n) + n) % n] = Math.floor((i * k) / n) !== Math.floor(((i - 1) * k) / n) || i === 0;
  return out;
}

const u = v => (clamp(v, -1, 1) + 1) / 2;
export function areaDrive(F) {
  const m = F.tim ? F.tim.m : { att: 0, leg: 0, bri: 0, res: 0, col: 0 }, ori = (F.reg && F.reg.ori) || [1, 0, 0, 0];
  let dom = 0; for (let k = 1; k < 4; k++) if (ori[k] > ori[dom]) dom = k;
  return { tex: (u(-m.leg) + u(m.bri)) / 2, shp: u(-m.att), sat: u(m.res), rot: dom * 3, rot2: Math.round((F.x ?? 0.5) * 7), acc: 0.9 + 0.2 * clamp(Math.sqrt((F.reg && F.reg.varL) || 0) * 3) };
}

/*
 * One bar for a style: a list per sixteenth step of [midi, velocity factor].
 * D: tension of the bar; a: area drive of the phrase; section: arc section of the bar.
 */
// b: the bar's index (two-bar patterns such as the bossa clave alternate on it).
export function barPattern(style, D, a, section, b = 0) {
  const bar = Array.from({ length: 16 }, () => []);
  const at = (qs, midi, v) => qs.forEach(q => bar[q].push([midi, v]));
  const put = (steps, midi, v) => steps.forEach((on, q) => { if (on) bar[q].push([midi, v]); });
  const E = (k, rot) => euclid(Math.round(k), 16, rot);
  const intro = section === "intro", climax = section === "climax", res = section === "resolution";
  const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14], OFF8 = [2, 6, 10, 14], ODD16 = [1, 3, 5, 7, 9, 11, 13, 15];
  if (style === "electronic") {
    // house / techno: four on the floor, clap on 2 and 4, off-beat hats, 16th ghost hats in the drop
    if (!intro) at([0, 4, 8, 12], DRUM.kick, 0.95);
    if (!intro && D > 0.4 && !(res && D < 0.5)) at([4, 12], DRUM.clap, 0.78);
    at(OFF8, climax && a.sat > 0.35 ? DRUM.ohat : DRUM.chat, intro ? 0.42 : 0.62);
    if (D > 0.62 || climax) at(ODD16, DRUM.chat, 0.26);
    if (!intro && !res && a.tex > 0.55) put(E(3, a.rot2 + 1), DRUM.rim, 0.34);
  } else if (style === "ambient") {
    // no backbeat: a soft shaker texture, the occasional low tom on the downbeat
    if (D > 0.38) at(EIGHTHS, DRUM.shaker, 0.32);
    if (D > 0.55 && !intro) put(E(lerp(1, 3, a.shp), a.rot2 + 3), DRUM.rim, 0.36);
    if (D > 0.6 && !intro) at([0], DRUM.ltom, 0.62);
    if (D > 0.78) at([10], DRUM.ltom, 0.48);
  } else if (style === "cinematic") {
    const os = E(lerp(2, 6, D), a.rot);
    if (!intro) os.forEach((on, q) => { if (on) bar[q].push([q < 8 ? DRUM.ltom : DRUM.mtom, 0.72]); });
    if (D > 0.45 && !intro) at([0], DRUM.kick, 0.85);
    if (D > 0.72) at([8], DRUM.kick, 0.7);
    if (D > 0.62 && !intro && !res) at([12], DRUM.snare, 0.72);
    if (D > 0.35) put(E(lerp(3, 8, a.tex), a.rot2), DRUM.shaker, 0.3);
  } else if (style === "minimal") {
    // a steady pulse: eighth hats throughout, rim ornaments per phrase, kick on 1 and 3
    at(EIGHTHS, DRUM.chat, 0.5);
    if (!intro) put(E(lerp(2, 5, a.shp), a.rot2 + 2), DRUM.rim, 0.45);
    if (D > 0.5 && !intro) at([0, 8], DRUM.kick, 0.8);
    if (D > 0.7 && !res) at([12], DRUM.clap, 0.6);
  } else if (style === "jazz") {
    // ride "spang-a-lang", hi-hat on 2 and 4, comping ghost snares, feathered kick
    at([0, 4, 8, 12], DRUM.ride, 0.6);
    if (D > 0.35) at([6, 14], DRUM.ride, 0.45);
    at([4, 12], DRUM.phat, 0.42);
    if (!intro) put(E(lerp(1, 4, 0.5 * a.tex + 0.5 * D), a.rot + 1), DRUM.snare, 0.28);
    if (D > 0.4 && !intro) at([0, 8], DRUM.kick, 0.3);
  } else if (style === "epic") {
    // taiko ensemble: low drums on a euclidean figure, a boom on the downbeat, snare 16ths at the peak
    if (intro) at([0, 10], DRUM.ltom, 0.55);
    else {
      put(E(lerp(4, 7, D), a.rot), DRUM.ltom, 0.8);
      at([0], DRUM.kick, 1);
      if (D > 0.6) put(E(lerp(3, 6, a.tex), a.rot + 5), DRUM.mtom, 0.62);
      if (D > 0.72) at([4, 12], DRUM.snare, 0.7);
      if (climax) for (let q = 0; q < 16; q++) bar[q].push([DRUM.snare, q % 4 === 0 ? 0.55 : 0.3]);
    }
  } else if (style === "lofi") {
    // boom bap: kick on 1 and the "and" of 3, snare on 2 and 4, soft swung hats; ghost notes when tense
    if (!intro) { at([0, 10], DRUM.kick, 0.92); at([4, 12], DRUM.snare, 0.8); }
    at(EIGHTHS, DRUM.chat, intro ? 0.34 : 0.44);
    if (D > 0.6 && !intro) { at([7], DRUM.kick, 0.6); at([15], DRUM.snare, 0.22); }
    if (D > 0.72 && a.sat > 0.4) at([14], DRUM.ohat, 0.4);
  } else if (style === "bossa") {
    // bossa nova: cross-stick on the 3-2 clave (two bars), shaker eighths, soft kick 1, "and" of 2, 3, "and" of 4
    const clave = b % 2 === 0 ? [0, 6, 12] : [4, 10];
    at(clave, DRUM.rim, 0.62);
    at(EIGHTHS, DRUM.shaker, 0.34);
    if (!intro) at([0, 6, 8, 14], DRUM.kick, 0.5);
    if (D > 0.7) at([2, 10], DRUM.phat, 0.3);
  } else if (style === "synthwave") {
    // 80s: kick on 1 and 3 (four on the floor when driving), big snare on 2 and 4, eighth hats (sixteenths at the peak)
    if (!intro) { at(D > 0.7 ? [0, 4, 8, 12] : [0, 8], DRUM.kick, 0.92); at([4, 12], DRUM.snare, 0.95); }
    at(climax || D > 0.8 ? [...Array(16).keys()] : EIGHTHS, DRUM.chat, intro ? 0.34 : 0.42);
  } else if (style === "classical") {
    // no drums: the orchestra keeps time
  } else if (style === "movie") {
    // underscore: mostly silence; a heartbeat at mid tension, timpani at the peak
    if (D > 0.5 && !intro) at([0, 3], DRUM.kick, 0.45);
    if (D > 0.72) at([0], DRUM.ltom, 0.75);
    if (climax) at([8], DRUM.ltom, 0.6);
  }
  return bar;
}

// Fill over the last beat of a phrase, per style (electronic builds with a snare roll instead).
const FILL = {
  ambient: [DRUM.htom, DRUM.mtom, DRUM.mtom, DRUM.ltom], cinematic: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom],
  minimal: [DRUM.rim, DRUM.rim, DRUM.rim, DRUM.rim], jazz: [DRUM.snare, DRUM.snare, DRUM.snare, DRUM.snare],
  electronic: [DRUM.clap, DRUM.clap, DRUM.clap, DRUM.clap], epic: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom], movie: [DRUM.ltom, DRUM.ltom, DRUM.ltom, DRUM.ltom],
  lofi: [DRUM.snare, DRUM.kick, DRUM.snare, DRUM.snare], bossa: [DRUM.rim, DRUM.rim, DRUM.ltom, DRUM.ltom], synthwave: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom], classical: null
};
// Kit level per style (velocity scale), set from offline renders of the demos.
const LEVEL = { ambient: 96, cinematic: 92, minimal: 92, jazz: 104, electronic: 92, epic: 100, movie: 96, lofi: 92, bossa: 98, synthwave: 92, classical: 96 };

/*
 * segs: composed points (t0, t1, idx, x, tim, reg, tension, section); arc: { climax };
 * R: the style's rules (phrase length, swell); tune: MIDI pitch of timpani rolls (the tonic).
 * Returns perc notes for the body and cadence.
 */
export function rhythmPart(style, segs, arc, body, amount, R, tune = 43) {
  const notes = [], arcOn = amount > 0.25, bars = Math.round(body / 4), phrase = R.phrase || 2;
  if (!segs.length) return notes;
  const at = t => segs.find(F => t >= F.t0 - 1e-9 && t < F.t1 - 1e-9) || segs[segs.length - 1];
  const barInfo = Array.from({ length: bars }, (_, b) => { const F = at(b * 4 + 2); return { F, D: F.tension ?? 0.6, section: F.section ?? "development" }; });
  const climaxBar = arc.climax >= 0 && arcOn ? Math.floor(segs[arc.climax].t0 / 4 + 1e-9) : -1;
  const lv = LEVEL[style] || 96;
  const push = (t, midi, vel, extra = {}) => notes.push({ layer: "perc", t, dur: 0.05, midi, vel: clampInt(Math.round(vel), 1, 127), point: at(t).idx, ...extra });
  for (let b = 0; b < bars; b++) {
    const { D, section } = barInfo[b], p0 = Math.floor(b / phrase) * phrase, a = areaDrive(at(p0 * 4 + 0.01)), dyn = dynamics(D);
    const lastOfPhrase = b % phrase === phrase - 1 || b === bars - 1, next = barInfo[b + 1];
    const sectionChange = next && next.section !== section;
    const intoClimax = b + 1 === climaxBar;
    const bar = barPattern(style, D, a, section, b);
    // electronic build: the bar before the drop becomes a snare roll (eighths, then sixteenths)
    const build = style === "electronic" && intoClimax;
    if (build) for (let q = 0; q < 16; q++) if (q < 8 ? q % 2 === 0 : true) push(b * 4 + q / 4, DRUM.snare, lv * (0.45 + 0.5 * q / 15) * dyn, { fill: true });
    const fill = arcOn && next && FILL[style] && lastOfPhrase && section !== "intro" && (sectionChange || intoClimax || (b + 1) % (phrase * 2) === 0);
    for (let q = 0; q < 16 && !build; q++) {
      const t = b * 4 + q / 4;
      if (fill && q >= 12) { push(t, FILL[style][q - 12], (62 + 12 * (q - 12)) * dyn * lv / 100, { fill: true }); continue; }
      const acc = q % 4 === 0 ? 1 : q % 2 === 0 ? 0.86 : 0.74;
      for (const [midi, v] of bar[q]) push(t, midi, lv * v * acc * a.acc * dyn);
    }
    if (b === climaxBar && style !== "ambient" && style !== "minimal") push(b * 4, DRUM.crash, 96, { dur: 0.5 });
    // transition swells, ending where the next section begins
    if (arcOn && next && (sectionChange || intoClimax) && R.swell) {
      const end = (b + 1) * 4, len = R.swell === "riser" && intoClimax ? 4 : 2;
      if (R.swell === "timpani") {
        for (let k = 0; k < len * 8; k++) push(end - len + k / 8, DRUM.ltom, (30 + 70 * k / (len * 8)) * lv / 100, { roll: true, tune });
      } else notes.push({ layer: "perc", t: end - len, dur: len, midi: DRUM.crash, vel: intoClimax ? 92 : 70, point: at(end - len).idx, swell: R.swell });
    }
  }
  // accents the user put on points: a cymbal and a kick on the point's first beat (a low drum in classical)
  for (const F of segs) if (F.accent) { push(F.t0, style === "classical" ? DRUM.ltom : DRUM.crash, 100, { dur: 0.5, accent: true }); if (style !== "classical") push(F.t0, DRUM.kick, 100, { accent: true }); }
  // cadence
  const cad = { ambient: [[DRUM.ltom, 60]], cinematic: [[DRUM.kick, 90], [DRUM.crash, 80]], minimal: [[DRUM.kick, 80]], jazz: [[DRUM.ride, 58], [DRUM.kick, 40]], electronic: [[DRUM.kick, 90], [DRUM.crash, 70]], epic: [[DRUM.kick, 110], [DRUM.ltom, 100], [DRUM.crash, 96]], movie: [[DRUM.ltom, 70]], lofi: [[DRUM.kick, 80]], bossa: [[DRUM.rim, 60], [DRUM.kick, 50]], synthwave: [[DRUM.kick, 92], [DRUM.crash, 76]], classical: [] }[style] || [];
  for (const [midi, vel] of cad) notes.push({ layer: "perc", t: body, dur: midi === DRUM.ride || midi === DRUM.crash ? 0.4 : 0.1, midi, vel, point: -2 });
  return notes;
}
