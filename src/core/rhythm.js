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
  } else if (style === "pop") {
    // pop: kick on 1 and 3 (and the "and" of 3 when driving), snare and clap on 2 and 4, eighth hats
    if (intro) { at([0], DRUM.kick, 0.8); at(EIGHTHS, DRUM.chat, 0.38); }
    else {
      at(D > 0.55 ? [0, 8, 10] : [0, 8], DRUM.kick, 0.92);
      at([4, 12], DRUM.snare, 0.85); if (D > 0.6) at([4, 12], DRUM.clap, 0.6);
      at(climax ? [...Array(16).keys()] : EIGHTHS, DRUM.chat, climax ? 0.4 : 0.5);
      if (D > 0.7 && a.sat > 0.35) at([14], DRUM.ohat, 0.45);
    }
  } else if (style === "rock") {
    // rock: kick on 1 and 3 with a push from the area, snare on 2 and 4, eighth hats (ride when
    // driving), a crash at the start of each phrase
    if (intro) { at(EIGHTHS, DRUM.chat, 0.42); at([0], DRUM.kick, 0.85); }
    else {
      const push = [[0, 8], [0, 6, 8], [0, 8, 10], [0, 7, 8]][a.rot % 4];
      at(push, DRUM.kick, 0.95); at([4, 12], DRUM.snare, 0.95);
      at(EIGHTHS, D > 0.75 || climax ? DRUM.ride : DRUM.chat, 0.55);
      if (b % 4 === 0 && D > 0.5) at([0], DRUM.crash, 0.8);
    }
  } else if (style === "metal") {
    // metal: driving eighth kicks, double bass sixteenths at the peak, snare on 2 and 4 (on 3,
    // half-time, in the resolution), crashes on the beats when tense
    if (intro) { at([0, 8], DRUM.kick, 0.9); at(EIGHTHS, DRUM.ride, 0.42); }
    else if (res) { at([0, 6, 10], DRUM.kick, 0.95); at([8], DRUM.snare, 1); at([0, 8], DRUM.crash, 0.7); }
    else {
      at(climax || D > 0.85 ? [...Array(16).keys()] : D > 0.55 ? EIGHTHS : [0, 6, 8, 14], DRUM.kick, climax || D > 0.85 ? 0.78 : 0.95);
      at([4, 12], DRUM.snare, 1);
      if (climax || D > 0.75) at([0, 4, 8, 12], DRUM.crash, 0.62); else at(EIGHTHS, DRUM.chat, 0.55);
    }
  } else if (style === "blues") {
    // shuffle: swung eighths on the ride (hats when calm), snare on 2 and 4, kick on 1 and 3
    at(EIGHTHS, D > 0.6 ? DRUM.ride : DRUM.chat, intro ? 0.38 : 0.5);
    if (!intro) { at([0, 8], DRUM.kick, 0.85); at([4, 12], DRUM.snare, 0.82); }
    if (D > 0.7 && !intro) at([14], DRUM.snare, 0.3);
  } else if (style === "funk") {
    // funk: syncopated kick from the area, a hard snare on 2 and 4 with ghost notes, sixteenth hats
    // accented on the eighths, an open hat on the "and" of 4
    if (!intro) {
      at([[0, 6, 10], [0, 3, 8, 10], [0, 7, 10, 13], [0, 3, 6, 11]][a.rot % 4], DRUM.kick, 0.95);
      at([4, 12], DRUM.snare, 1);
      put(E(lerp(2, 5, a.tex), a.rot2 + 1).map((on, q) => on && q !== 4 && q !== 12), DRUM.snare, 0.2);
    }
    for (let q = 0; q < 16; q++) bar[q].push([DRUM.chat, q % 2 ? 0.28 : 0.5]);
    if (D > 0.6 && !intro) at([14], DRUM.ohat, 0.5);
  } else if (style === "lofinature") {
    // almost nothing: a soft kick on 1, a rim on 3 when the music moves, a shaker when it's busier
    if (!intro && D > 0.35) { at([0], DRUM.kick, 0.55); at([8], DRUM.rim, 0.42); }
    if (D > 0.55) at(EIGHTHS, DRUM.shaker, 0.26);
  } else if (style === "folk") {
    // folk: a light kick on 1 and 3, a rim (or snare at the peak) on 2 and 4, shaker eighths
    if (!intro) { at([0, 8], DRUM.kick, 0.7); at([4, 12], climax ? DRUM.snare : DRUM.rim, climax ? 0.6 : 0.5); }
    if (D > 0.45) at(EIGHTHS, DRUM.shaker, 0.32);
  } else if (style === "postrock") {
    // post-rock: quiet ride when calm, floor-tom eighths as it builds, the full kit at the peak
    if (climax || D > 0.8) { at([0, 6, 8], DRUM.kick, 0.95); at([4, 12], DRUM.snare, 0.95); at(EIGHTHS, DRUM.ride, 0.55); if (b % 2 === 0) at([0], DRUM.crash, 0.8); }
    else if (D > 0.55 && !intro) { at(EIGHTHS, DRUM.ltom, 0.5); at([0, 8], DRUM.kick, 0.7); }
    else if (!intro) at([0, 4, 8, 12], DRUM.ride, 0.32);
  } else if (style === "chiptune") {
    // 8-bit: kick on 1 and 3, snare on 2 and 4, eighth hats (sixteenths at the peak)
    if (!intro) { at([0, 8], DRUM.kick, 0.9); at([4, 12], DRUM.snare, 0.85); }
    at(climax ? [...Array(16).keys()] : EIGHTHS, DRUM.chat, climax ? 0.36 : 0.44);
  } else if (style === "triphop") {
    // trip-hop: a slow heavy break, kick on 1 and the "and" of 2, snare on 3 (half time), swung hats
    if (!intro) { at([0, 6, 10], DRUM.kick, 0.92); at([8], DRUM.snare, 0.95); }
    at(EIGHTHS, DRUM.chat, intro ? 0.3 : 0.4);
    if (D > 0.7 && !intro) put(E(lerp(2, 4, a.tex), a.rot2 + 3), DRUM.rim, 0.3);
  } else if (style === "reggae") {
    // the one-drop: nothing on 1, kick and rim together on 3, swung hats; a snare roll into the peak
    if (!intro) { at([8], DRUM.kick, 0.95); at([8], DRUM.rim, 0.85); }
    at(EIGHTHS, DRUM.chat, intro ? 0.32 : 0.42);
    if (D > 0.7 && !intro) at([14], DRUM.ohat, 0.4);
  } else if (style === "eastasian") {
    // sparse: a woodblock (rim) on an euclidean figure, a taiko (low tom) on the downbeat when tense
    if (!intro) put(E(lerp(2, 4, a.tex), a.rot2), DRUM.rim, 0.36);
    if (D > 0.6 && !intro) at([0], DRUM.ltom, 0.7);
    if (climax) at([8], DRUM.ltom, 0.6);
  } else if (style === "dnb") {
    // drum and bass: the two-step, kick on 1 and the "and" of 3, snare on 2 and 4, sixteenth hats
    if (!intro) { at([0, 10], DRUM.kick, 0.95); at([4, 12], DRUM.snare, 0.95); put(E(lerp(1, 3, a.tex), a.rot2 + 5).map((on, q) => on && q !== 4 && q !== 12), DRUM.snare, 0.22); }
    for (let q = 0; q < 16; q++) if (!intro || q % 2 === 0) bar[q].push([DRUM.chat, q % 2 ? 0.26 : 0.46]);
  } else if (style === "techno") {
    // techno: four on the floor, an off-beat open hat, a rim or clap on 2 and 4, sixteenths at the peak
    if (!intro) at([0, 4, 8, 12], DRUM.kick, 0.96);
    at(OFF8, D > 0.5 ? DRUM.ohat : DRUM.chat, intro ? 0.38 : 0.5);
    if (!intro && D > 0.45) at([4, 12], D > 0.75 ? DRUM.clap : DRUM.rim, 0.6);
    if (D > 0.65 || climax) at(ODD16, DRUM.chat, 0.24);
  } else if (style === "classical" || style === "neoclassical" || style === "meditation" || style === "baroque" || style === "acappella") {
    // no drums: the instruments keep time
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
  acappella: null, lofinature: null, neoclassical: null, meditation: null, baroque: null, folk: [DRUM.rim, DRUM.rim, DRUM.kick, DRUM.kick], postrock: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom],
  chiptune: [DRUM.snare, DRUM.snare, DRUM.snare, DRUM.snare], triphop: [DRUM.snare, DRUM.kick, DRUM.snare, DRUM.rim], reggae: [DRUM.rim, DRUM.rim, DRUM.snare, DRUM.snare],
  eastasian: [DRUM.ltom, DRUM.ltom, DRUM.ltom, DRUM.ltom], dnb: [DRUM.snare, DRUM.snare, DRUM.snare, DRUM.snare], techno: [DRUM.clap, DRUM.clap, DRUM.clap, DRUM.clap],
  ambient: [DRUM.htom, DRUM.mtom, DRUM.mtom, DRUM.ltom], cinematic: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom],
  minimal: [DRUM.rim, DRUM.rim, DRUM.rim, DRUM.rim], jazz: [DRUM.snare, DRUM.snare, DRUM.snare, DRUM.snare],
  electronic: [DRUM.clap, DRUM.clap, DRUM.clap, DRUM.clap], epic: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom], movie: [DRUM.ltom, DRUM.ltom, DRUM.ltom, DRUM.ltom],
  lofi: [DRUM.snare, DRUM.kick, DRUM.snare, DRUM.snare], bossa: [DRUM.rim, DRUM.rim, DRUM.ltom, DRUM.ltom], synthwave: [DRUM.htom, DRUM.mtom, DRUM.ltom, DRUM.ltom], classical: null,
  pop: [DRUM.snare, DRUM.snare, DRUM.clap, DRUM.snare], blues: [DRUM.snare, DRUM.snare, DRUM.ltom, DRUM.ltom], funk: [DRUM.snare, DRUM.snare, DRUM.snare, DRUM.htom], rock: [DRUM.snare, DRUM.htom, DRUM.mtom, DRUM.ltom], metal: [DRUM.snare, DRUM.snare, DRUM.ltom, DRUM.ltom]
};
// styles without drums (the instruments keep time; no crash at the climax either)
const NO_DRUMS = new Set(["acappella", "neoclassical", "meditation", "baroque"]);
// styles whose climax is marked by the music, not by a crash cymbal
const NO_CRASH = new Set(["acappella", "ambient", "minimal", "classical", "lofinature", "eastasian", "folk", "movie", "neoclassical", "meditation", "baroque"]);
// Kit level per style (velocity scale), set from offline renders of the demos.
const LEVEL = { acappella: 80, lofinature: 84, neoclassical: 90, folk: 90, meditation: 80, postrock: 98, chiptune: 92, triphop: 100, reggae: 96, baroque: 90, eastasian: 92, dnb: 96, techno: 96, blues: 96, funk: 98, pop: 96, rock: 100, metal: 104, ambient: 96, cinematic: 92, minimal: 92, jazz: 104, electronic: 92, epic: 100, movie: 96, lofi: 92, bossa: 98, synthwave: 92, classical: 96 };

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
    if (b === climaxBar && !NO_CRASH.has(style)) push(b * 4, DRUM.crash, 96, { dur: 0.5 });
    // transition swells, ending where the next section begins
    if (arcOn && next && (sectionChange || intoClimax) && R.swell) {
      const end = (b + 1) * 4, len = R.swell === "riser" && intoClimax ? 4 : 2;
      if (R.swell === "timpani") {
        for (let k = 0; k < len * 8; k++) push(end - len + k / 8, DRUM.ltom, (30 + 70 * k / (len * 8)) * lv / 100, { roll: true, tune });
      } else notes.push({ layer: "perc", t: end - len, dur: len, midi: DRUM.crash, vel: intoClimax ? 92 : 70, point: at(end - len).idx, swell: R.swell });
    }
  }
  // accents the user put on points: a cymbal and a kick on the point's first beat (a low drum in classical)
  for (const F of segs) if (F.accent) { const soft = NO_CRASH.has(style); push(F.t0, soft ? DRUM.ltom : DRUM.crash, soft ? 80 : 100, { dur: 0.5, accent: true }); if (!soft) push(F.t0, DRUM.kick, 100, { accent: true }); }
  // cadence
  const cad = { acappella: [], lofinature: [[DRUM.kick, 50]], neoclassical: [], meditation: [], baroque: [], folk: [[DRUM.kick, 70]], postrock: [[DRUM.kick, 100], [DRUM.crash, 96]], chiptune: [[DRUM.kick, 90], [DRUM.crash, 70]], triphop: [[DRUM.kick, 96], [DRUM.crash, 60]], reggae: [[DRUM.kick, 90], [DRUM.rim, 80]], eastasian: [[DRUM.ltom, 90]], dnb: [[DRUM.kick, 100], [DRUM.crash, 80]], techno: [[DRUM.kick, 100], [DRUM.crash, 70]], ambient: [[DRUM.ltom, 60]], cinematic: [[DRUM.kick, 90], [DRUM.crash, 80]], minimal: [[DRUM.kick, 80]], jazz: [[DRUM.ride, 58], [DRUM.kick, 40]], electronic: [[DRUM.kick, 90], [DRUM.crash, 70]], epic: [[DRUM.kick, 110], [DRUM.ltom, 100], [DRUM.crash, 96]], movie: [[DRUM.ltom, 70]], lofi: [[DRUM.kick, 80]], bossa: [[DRUM.rim, 60], [DRUM.kick, 50]], synthwave: [[DRUM.kick, 92], [DRUM.crash, 76]], classical: [], pop: [[DRUM.kick, 90], [DRUM.crash, 76]], blues: [[DRUM.kick, 80], [DRUM.ride, 64]], funk: [[DRUM.kick, 92], [DRUM.snare, 84], [DRUM.crash, 70]], rock: [[DRUM.kick, 100], [DRUM.snare, 84], [DRUM.crash, 96]], metal: [[DRUM.kick, 110], [DRUM.ltom, 92], [DRUM.crash, 100]] }[style] || [];
  // The ending never hits harder than the music that led to it: each hit is at most a little
  // louder than the loudest hit of the last two bars, a crash closes only a loud ending, and when
  // the drums were silent there they stay silent (a lone drum on a soft last chord sounds like a gong).
  const tail = notes.filter(n => !n.swell && !n.roll && n.t >= body - 8 - 1e-9 && n.t < body - 1e-9);
  const ref = tail.reduce((m, n) => Math.max(m, n.vel), 0);
  for (const [midi, vel] of cad) {
    if (!tail.length) break;
    if (midi === DRUM.crash && ref < 84) continue;
    notes.push({ layer: "perc", t: body, dur: midi === DRUM.ride || midi === DRUM.crash ? 0.4 : 0.1, midi, vel: clampInt(Math.min(vel, ref + 6), 1, 127), point: -2 });
  }
  return notes;
}
