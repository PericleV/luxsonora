// Composition rules: classical craft on top of the genre rules, each one can be turned off
// (Piece › Advanced › Composition rules). They read the image where they can:
//   modulate   the climax moves one step on the circle of fifths when its colour (or light) differs
//              from the image's, through a pivot chord, and comes home before the end
//   contrast   the contrast between two places sets how far the chord moves (similar places share
//              notes, contrasting ones jump further)
//   cadences   phrases of four bars end as question (a half cadence on V) and answer (on I)
//   picardy    a minor piece ends on a major chord when its last place is bright
//   leap       after a leap wider than a fourth the melody turns back by step
//   parallels  no parallel fifths or octaves between the melody and the bass
//   peak       the highest melody note falls on the climax
import { clamp } from "./util.js";
import { degMidi } from "./theory.js";

export const RULES_INFO = {
  modulate: { name: "Modulate at the climax", desc: "When the climax has another colour, the music moves one step on the circle of fifths there, and comes home before the end." },
  contrast: { name: "Contrast moves the chords", desc: "Similar places keep chords that share notes; a strong contrast in colour or light jumps to a more distant chord." },
  cadences: { name: "Question and answer", desc: "Every four bars a phrase ends: open on the dominant, then closed on the tonic." },
  picardy: { name: "A bright minor ending", desc: "A minor piece ends on a major chord when its last place is bright (the Picardy third)." },
  leap: { name: "Leaps turn back", desc: "After a leap wider than a fourth the melody turns back by step, so it stays singable." },
  parallels: { name: "No parallel fifths", desc: "The melody and the bass never move in parallel fifths or octaves." },
  peak: { name: "The peak at the climax", desc: "The highest note of the melody falls on the climax." }
};
export const defaultRules = () => Object.fromEntries(Object.keys(RULES_INFO).map(k => [k, true]));
export const ruleOn = (P, k) => !P.rules || P.rules[k] !== false;

const pc = m => ((m % 12) + 12) % 12;
const hasPerfectFifth = (deg, modeIv) => { const n = modeIv.length, r = modeIv[((deg % n) + n) % n], f = modeIv[(((deg + 4) % n) + n) % n] + (deg % n + 4 >= n ? 12 : 0); return pc(f - r) === 7; };

// Where and which way to modulate: the climax's hue one or more steps from the image's on the
// colour wheel (which maps onto the circle of fifths) moves the key one step that way: up a fifth
// (the dominant) or down (the subdominant). Without colour, a brighter climax goes up, a darker
// one down. The window is the chord slots under the climax (at least two), with a slot before it
// for the pivot. Returns { i0, i1, t0, t1, dir, shift } or null.
export function planModulation(out, arc, g, slots, R) {
  if (!arc || arc.climax < 0 || slots.length < 4) return null;
  const F = out[arc.climax], r = F && F.reg; if (!r) return null;
  let dir = 0;
  if ((r.hueStr ?? 0) > 0.08 && (g.hueStr ?? 0) > 0.04) {
    const k0 = Math.round(g.hue / 30), k1 = Math.round(r.hue / 30), d = ((((k1 - k0) % 12) + 18) % 12) - 6;
    if (d !== 0) dir = Math.sign(d);
  } else if (Math.abs((r.L ?? 0.5) - g.brightness) > 0.15) dir = r.L > g.brightness ? 1 : -1;
  if (!dir) return null;
  const i0 = slots.findIndex(S => S.t1 > F.t0 + 1e-9);
  let i1 = slots.findIndex(S => S.t1 >= F.t1 - 1e-9);
  if (i0 < 1 || i1 < 0) return null;
  if (i1 === i0) i1 = i0 + 1;
  const last = R && R.cadentialV ? slots.length - 2 : slots.length - 1;
  if (i1 > last) return null;
  return { i0, i1, t0: slots[i0].t0, t1: slots[i1].t1, dir, shift: dir > 0 ? -5 : 5 };
}
// The pivots, set on the slots' roots (home key degrees) before the chords are voiced: into the new
// key through the chord both keys share (home V = new I going up, home I = new V going down), the
// new tonic first, and out through the new key's chord that is the home tonic.
// A pivot must also fit the melody's scale (a pentatonic tune cannot reach every chord tone), or
// the chord there stays as it was.
export function applyPivots(slots, mod, modeIv, melIv) {
  const set = (i, root) => { if (slots[i]) slots[i].F = { ...slots[i].F, root }; };
  const n = modeIv.length, mel = new Set((melIv || modeIv).map(pc));
  const fits = r => [0, 2, 4].every(k => mel.has(pc(modeIv[(r + k) % n])));
  const pre = mod.dir > 0 ? 4 : 0;
  if ((mod.dir < 0 || hasPerfectFifth(4, modeIv)) && fits(pre)) set(mod.i0 - 1, pre);
  set(mod.i0, 0);
  const out = mod.dir > 0 ? 3 : 4;
  if (mod.i1 > mod.i0 && fits(out)) set(mod.i1, out);
  for (let i = mod.i0; i <= mod.i1; i++) slots[i].shift = mod.shift;
}
// Moves the window into the new key. The melody stays where the image put it: only its notes
// outside the new scale move by a semitone (the raised fourth going up, the lowered seventh going
// down). The chords and the accompaniment move with the key; each accompaniment layer moves by a fourth or the fifth the other way (the same key), whichever joins its line
// to the notes around the window best and keeps it in range. Long notes crossing an edge (pads,
// drones, held bass) are split there; short ones belong to the side they start on and stop at the
// edge. Afterwards the short accompaniment notes next to an edge (approach notes that pointed at a
// note now moved, or moved away from it) take the nearest chord tone.
export function transposeWindow(notes, slots, mod, melScale) {
  const T0 = mod.t0, T1 = mod.t1, eps = 1e-6, alt = mod.shift - 12 * Math.sign(mod.shift);
  const pitched = n => n.layer !== "perc" && n.point !== -2 && Number.isFinite(n.midi);
  const inside = n => n.t >= T0 - eps && n.t < T1 - eps, long = n => n.layer === "pad" || n.dur >= 2;
  // the melody: into the new scale by the smallest step
  const inNew = m => melScale.has(pc(m - mod.shift)), steps = mod.dir > 0 ? [1, -1, 2, -2] : [-1, 1, -2, 2];
  for (const n of notes) if (pitched(n) && n.layer === "lead" && inside(n)) {
    n.keyShift = true;
    if (!inNew(n.midi)) for (const d of steps) if (inNew(n.midi + d)) { n.midi += d; break; }
  }
  const moving = n => pitched(n) && n.layer !== "lead";
  // the shift for each layer
  const shiftOf = new Map(), lo = { bass: 28 }, hi = { harm: 96 };
  for (const layer of new Set(notes.filter(moving).map(n => n.layer))) {
    const L = notes.filter(n => moving(n) && n.layer === layer && !n.dbl).sort((a, b) => a.t - b.t);
    const ins = L.filter(n => inside(n) || (long(n) && n.t < T1 - eps && n.t + n.dur > T0 + eps)); if (!ins.length) continue;
    const before = L.filter(n => n.t < T0 - eps && !ins.includes(n)).pop(), after = L.find(n => n.t >= T1 - eps);
    const cost = sh => {
      let c = 0;
      if (before) c += Math.abs(ins[0].midi + sh - before.midi);
      if (after) c += Math.abs(ins[ins.length - 1].midi + sh - after.midi);
      for (const n of ins) if (n.midi + sh < (lo[layer] ?? 24) || n.midi + sh > (hi[layer] ?? 100)) c += 50;
      return c;
    };
    shiftOf.set(layer, cost(alt) < cost(mod.shift) ? alt : mod.shift);
  }
  const add = [];
  for (const n of notes) {
    if (!moving(n)) continue;
    const sh = shiftOf.get(n.layer) ?? mod.shift, a = n.t, b = n.t + n.dur;
    if (b <= T0 + eps || a >= T1 - eps) continue;
    if (!long(n)) {
      if (a < T0 - eps) { n.dur = T0 - a; continue; }
      n.midi += sh; n.keyShift = true; if (b > T1 + eps) n.dur = T1 - a;
      continue;
    }
    const mid0 = Math.max(a, T0), mid1 = Math.min(b, T1), orig = n.midi;
    if (a < T0 - eps) { n.dur = T0 - a; add.push({ ...n, t: mid0, dur: mid1 - mid0, midi: orig + sh, glide: null, keyShift: true }); }
    else { n.t = mid0; n.dur = mid1 - mid0; n.midi += sh; n.keyShift = true; }
    if (b > T1 + eps) add.push({ ...n, t: T1, dur: b - T1, midi: orig, keyShift: false, glide: null });
  }
  notes.push(...add);
  // a pad voice that now ends where the same note starts again is held instead (a common tone)
  const pads = notes.filter(n => n.layer === "pad").sort((a, b) => a.t - b.t), gone = new Set();
  for (const a of pads) { if (gone.has(a)) continue; for (;;) { const b = pads.find(x => !gone.has(x) && x !== a && x.midi === a.midi && Math.abs(x.t - (a.t + a.dur)) < eps); if (!b) break; a.dur += b.dur; gone.add(b); } }
  for (let k = notes.length - 1; k >= 0; k--) if (gone.has(notes[k])) notes.splice(k, 1);
  for (let i = mod.i0; i <= mod.i1; i++) { const S = slots[i]; S.chord = S.chord.map(m => m + mod.shift); S.pcs = new Set(S.chord.map(pc)); }
  // approach notes at the edges
  const slotAt = t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1];
  for (const n of notes) {
    if (!moving(n) || n.layer === "pad" || n.dur > 1.01 || n.chromatic) continue;
    const nearEdge = [T0, T1].some(e => n.t >= e - 1.01 && n.t < e + 1.01);
    const S = slotAt(n.t); if (!nearEdge || S.pcs.has(pc(n.midi))) continue;
    for (const d of [-1, 1, -2, 2, -3, 3]) if (S.pcs.has(pc(n.midi + d))) { n.midi += d; break; }
  }
}

// Phrases of four bars end as question and answer: the last bar of each phrase gets its own slot,
// on V (a half cadence; the subtonic VII when V has no perfect fifth) and on I in turn.
export function phraseCadences(slots, modeIv, body) {
  const question = hasPerfectFifth(4, modeIv) ? 4 : 6;
  for (let pe = 16, k = 1; pe < body - 4 + 1e-9; pe += 16, k++) {
    const i = slots.findIndex(S => S.t0 < pe - 1e-9 && S.t1 >= pe - 1e-9); if (i < 0) continue;
    const S = slots[i], pieces = [];
    if (S.t0 < pe - 4 - 1e-9) pieces.push({ ...S, t1: pe - 4 });
    pieces.push({ ...S, t0: pe - 4, t1: pe, F: { ...S.F, root: k % 2 ? question : 0 }, cadence: k % 2 ? "half" : "full" });
    if (S.t1 > pe + 1e-9) pieces.push({ ...S, t0: pe });
    slots.splice(i, 1, ...pieces);
  }
}

// The contrast between two places, 0-1, from their colour difference (CIE Lab).
export function contrastOf(a, b) {
  if (!a || !b || !a.lab || !b.lab) return 0;
  return clamp(Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]) / 50);
}

// ctx: { slotAt(t) → slot with pcs, inScale(midi, t), climax (point index) }
const leadLine = notes => notes.filter(n => n.layer === "lead" && !n.dbl && n.point >= 0).sort((a, b) => a.t - b.t);
const strongAt = n => Math.abs(n.t - Math.round(n.t)) < 1e-6 || n.dur >= 0.9;

// After a leap wider than a fourth (more than 5 semitones), the next note turns back by step.
export function leapRecovery(notes, ctx) {
  const L = leadLine(notes);
  for (let i = 0; i + 2 < L.length; i++) {
    const a = L[i], b = L[i + 1], c = L[i + 2], leap = b.midi - a.midi;
    if (Math.abs(leap) <= 5 || b.t - (a.t + a.dur) > 0.3 || c.t - (b.t + b.dur) > 0.3 || c.peak) continue;
    const mv = c.midi - b.midi;
    if (Math.sign(mv) === -Math.sign(leap) && Math.abs(mv) <= 4) continue;
    const S = ctx.slotAt(c.t), strong = strongAt(c), dir = -Math.sign(leap);
    for (const d of strong ? [1, 2, 3, 4] : [1, 2]) {
      const m = b.midi + dir * d;
      if (ctx.inScale(m, c.t) && (!strong || S.pcs.has(pc(m)))) { c.midi = m; c.recovered = true; break; }
    }
  }
}
// No parallel fifths or octaves between the melody and the bass: when both move the same way into
// the same perfect interval, the melody takes another chord tone nearby (contrary motion first).
export function noParallels(notes, ctx) {
  const bass = notes.filter(n => n.layer === "bass").sort((a, b) => a.t - b.t), L = notes.filter(n => n.layer === "lead" && !n.dbl).sort((a, b) => a.t - b.t);
  const leadAt = t => L.find(n => n.t <= t + 1e-6 && n.t + n.dur > t + 1e-6);
  let fixed = 0;
  for (let i = 0; i + 1 < bass.length; i++) {
    const b1 = bass[i], b2 = bass[i + 1];
    if (b2.midi === b1.midi) continue;
    const l1 = leadAt(b1.t), l2 = L.find(n => Math.abs(n.t - b2.t) < 1e-6);
    if (!l1 || !l2 || l2 === l1 || l2.midi === l1.midi || l2.peak) continue;
    const iv1 = pc(l1.midi - b1.midi), iv2 = pc(l2.midi - b2.midi);
    if (iv1 !== iv2 || (iv1 !== 7 && iv1 !== 0) || Math.sign(l2.midi - l1.midi) !== Math.sign(b2.midi - b1.midi)) continue;
    const S = ctx.slotAt(l2.t), contrary = -Math.sign(b2.midi - b1.midi);
    for (const d of [contrary, -contrary, 2 * contrary, -2 * contrary, 3 * contrary, -3 * contrary, 4 * contrary, -4 * contrary]) {
      const m = l2.midi + d, iv = pc(m - b2.midi);
      if (iv !== 7 && iv !== 0 && S.pcs.has(pc(m)) && ctx.inScale(m, l2.t)) { l2.midi = m; l2.unparallel = true; fixed++; break; }
    }
  }
  return fixed;
}
// The highest melody note falls on the climax: its top note rises to the chord tone just above the
// rest of the melody (at most a sixth higher than it was).
export function melodyPeak(notes, ctx) {
  const L = leadLine(notes), inC = L.filter(n => n.point === ctx.climax), outC = L.filter(n => n.point !== ctx.climax);
  if (!inC.length || !outC.length) return;
  const top = Math.max(...outC.map(n => n.midi)), p = inC.reduce((a, b) => (b.midi > a.midi ? b : a));
  if (p.midi > top) { p.peak = true; return; }
  // the notes on either side stay within a sixth of it, so the peak is reached, not jumped to
  const S = ctx.slotAt(p.t), k = L.indexOf(p), near = [L[k - 1], L[k + 1]].filter(Boolean);
  for (let m = top + 1; m <= top + 5; m++) if (S.pcs.has(pc(m)) && ctx.inScale(m, p.t)) { if (m - p.midi <= 9 && near.every(q => Math.abs(q.midi - m) <= 9)) { p.midi = m; p.peak = true; } return; }
}
// Picardy third: a minor piece with a bright last place ends on the major tonic chord.
export function picardy(notes, tonicPc, from) {
  const minor3 = pc(tonicPc + 3);
  for (const n of notes) if (n.layer !== "perc" && n.t >= from - 1e-6 && pc(n.midi) === minor3) { n.midi += 1; n.chromatic = true; n.picardy = true; }
}
