// Raw: the notes read straight from the picture, with no harmony and no rules.
//
// The eye follows its path as in the other modes (the same places and times): while it rests on a
// place it circles slowly inside it (one turn every four beats, at 60% of its radius), then it
// moves in a straight line to the next one. At every step of its own grid each track reads one
// thing where the eye is and plays it:
//   height      the height of the eye: high in the picture, high notes
//   brightness  the brightness there (3 × 3 pixels)
//   colour      the hue of the region there, as a pitch class (red C, orange D, yellow E... a
//               twelfth of the colour circle each); its brightness sets the octave; grey is silent
//   saturation  how vivid the colour is
//   warmth      red against blue
//   edges       a short note (a drum hit on the rhythm track) each time the eye crosses an edge
//   texture     notes as dense as the region is busy (its entropy), their pitch from the brightness
// A value sets the pitch within the track's register; a new note starts when the pitch changes
// (or after the track's longest hold), so a steady area holds a note and a changing one moves.
// The loudness comes from the brightness (from the saturation for the brightness track). With
// the scale on, the pitches keep to the key and scale of the piece (the picture's, or the ones
// chosen in the Piece tab); off, every semitone can sound.
import { clamp, clampInt } from "./util.js";
import { LIBRARY } from "./instruments.js";

export const RAW_READS = { height: "Height", light: "Brightness", colour: "Colour", saturation: "Saturation", warmth: "Warmth", edges: "Edges", texture: "Texture" };
export const RAW_READ_DESC = {
  height: "high in the picture, high notes",
  light: "bright areas high, dark areas low",
  colour: "each colour its own note, grey is silent",
  saturation: "vivid colours high, muted ones low",
  warmth: "warm colours high, cool ones low",
  edges: "a short note each time the eye crosses an edge",
  texture: "more notes where the picture is busy"
};
// A raw piece has its own tracks (P.rawTracks): [{ id, read, preset }], preset "drums" for the
// style's drum kit (one at most, on the rhythm track). It starts with one: the height of the eye,
// on the style's melody instrument; Add track adds as many as you like.
export const DRUMS_KEY = "drums";
export const READ_ORDER = ["height", "colour", "light", "texture", "edges", "saturation", "warmth"];
// the colour of a raw track's lane (the role whose colour it takes)
export const READ_ROLE = { height: "counter", light: "sustain", colour: "ornament", saturation: "double", warmth: "drone", edges: "pulse", texture: "runs" };
// instruments a raw track can play: any but the texture wavetables (they need a place's wave)
export const rawPlayable = k => k === DRUMS_KEY || (!!LIBRARY[k] && LIBRARY[k].type !== "wave");
export function rawTrackList(P, defaultPreset) {
  const list = (Array.isArray(P && P.rawTracks) ? P.rawTracks : []).filter(t => t && t.id && RAW_READS[t.read] && rawPlayable(t.preset));
  let drums = false;
  const out = list.filter(t => (t.preset === DRUMS_KEY ? (drums ? false : (drums = true)) : true));
  return out.length ? out : [{ id: "r1", read: "height", preset: rawPlayable(defaultPreset) ? defaultPreset : "x.softlead" }];
}
export function nextTrackId(list) { const used = new Set(list.map(t => t.id)); let i = 1; while (used.has("r" + i)) i++; return "r" + i; }
// the register (MIDI), grid (beats) and longest hold (beats) of a track: low for a bass instrument,
// slow for a pad, quick for a plucked one
export function trackShape(preset) {
  const v = LIBRARY[preset] || {}, n = (v.name || "").toLowerCase();
  if (/bass|contrabass|cello|tuba|bassoon/.test(n) && !/clarinet/.test(n)) return [28, 52, 0.5, 4];
  if (v.type === "pad" || /pad|choir|strings|ensemble|organ|section|voices/.test(n)) return [43, 72, 1, 8];
  if (v.type === "pluck") return [50, 84, 0.25, 2];
  return [52, 84, 0.5, 4];
}

// Where the eye is at beat t: { x, y, j } (j: the place it is at or leaving)
export function rawPath(points, total) {
  const P = points.map((F, j) => {
    const nx = points[j + 1], t1 = nx ? F.t1 : total;
    return { F, t0: F.t0, t1, mv: nx ? t1 - Math.min(1, 0.25 * (t1 - F.t0)) : t1, nx };
  });
  return t => {
    let j = 0; while (j < P.length - 1 && t >= P[j].t1) j++;
    const p = P[j]; if (!p) return { x: 0.5, y: 0.5, j: 0 };
    const F = p.F;
    if (t < p.mv || !p.nx) {
      const a = ((t - p.t0) / 4) * Math.PI * 2 + j * 1.7, rr = 0.6 * (F.r ?? 0.05);
      return { x: clamp(F.x + rr * Math.cos(a)), y: clamp(F.y + rr * Math.sin(a)), j };
    }
    const u = clamp((t - p.mv) / Math.max(1e-6, p.t1 - p.mv));
    return { x: F.x + (p.nx.x - F.x) * u, y: F.y + (p.nx.y - F.y) * u, j };
  };
}
// What the picture is at (x, y)
export function rawSample(A, x, y) {
  const W = A.W, H = A.H, px = clampInt(Math.round(x * W - 0.5), 0, W - 1), py = clampInt(Math.round(y * H - 0.5), 0, H - 1);
  let L = 0, e = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const i = yy * W + xx; L += A.L[i]; e = Math.max(e, A.mag ? A.mag[i] : 0); n++;
  }
  const reg = A.regions[A.labels[py * W + px]] || {};
  return { L: L / Math.max(1, n), edge: clamp(e / ((A.p95 || 1) * 1.5)), sat: clamp((reg.sat ?? 0) / 0.8), hue: reg.hue ?? 0, hueStr: reg.hueStr ?? 0, warm: clamp(0.5 + (reg.warmth ?? 0) * 1.5), ent: clamp(reg.entropy ?? 0), y };
}
// the nearest note of the scale (pcs: allowed pitch classes; null: every semitone)
export function snap(m, pcs, lo = 0, hi = 127) {
  m = Math.round(m);
  if (pcs) for (let d = 0; d <= 6; d++) { if (pcs.has((((m + d) % 12) + 12) % 12)) { m += d; break; } if (pcs.has((((m - d) % 12) + 12) % 12)) { m -= d; break; } }
  while (m < lo) m += 12; while (m > hi) m -= 12;
  return m;
}
const DRUMS = [36, 38, 42];

/*
 * The raw notes of a score (sc: a composed score, for its places, times, key, instruments and
 * timbres). tracks: [{ id, read }]. Returns the notes, in time order.
 */
export function rawNotes(sc, A, tracks, { scale = true } = {}) {
  const total = sc.total, pos = rawPath(sc.points, total);
  // the piece's scale (its melody's: a pentatonic when one is chosen)
  const pcs = scale ? new Set((sc.melIv || sc.modeIv).map(v => (((v + sc.pc) % 12) + 12) % 12)) : null;
  // the samples along the path, on the finest grid, shared by the tracks
  const G = 0.25, cache = new Map();
  const at = t => { const k = Math.round(t / G); let s = cache.get(k); if (!s) { const p = pos(k * G); s = { ...rawSample(A, p.x, p.y), x: p.x, j: p.j }; cache.set(k, s); } return s; };
  const notes = [];
  for (const { id, read, preset } of tracks) {
    const perc = id === "perc", [lo, hi, step0, hold] = perc ? [0, 0, 0.25, 0] : trackShape(preset), step = read === "edges" || read === "texture" ? 0.25 : step0;
    const timOf = () => (perc ? undefined : sc.inst[id]);
    const panOf = x => clamp((x - 0.5) * 1.2, -0.7, 0.7) * (id === "bass" || id === "pad" ? 0.3 : 1);
    const velOf = s => clampInt(Math.round(40 + 70 * (read === "light" ? 0.4 + 0.6 * s.sat : 0.6 * s.L + 0.4 * s.edge)), 1, 127);
    const pitchOf = (s, v) => {
      if (read === "colour") {
        if (s.sat < 0.12 || s.hueStr < 0.05) return null;
        const pc = Math.round(s.hue / 30) % 12, target = lo + s.L * (hi - lo);
        let best = null; for (let m = lo; m <= hi; m++) if (m % 12 === pc && (best === null || Math.abs(m - target) < Math.abs(best - target))) best = m;
        return best === null ? null : snap(best, pcs, lo, hi);
      }
      return snap(lo + clamp(v) * (hi - lo), pcs, lo, hi);
    };
    const value = s => (read === "height" ? 1 - s.y : read === "light" ? s.L : read === "saturation" ? s.sat : read === "warmth" ? s.warm : read === "texture" ? s.L : s.L);
    // each note keeps what the picture was under it (for its controllers and its track's effects)
    // and a key that names it while the piece stays the same (to delete it or change it)
    const push = (t, dur, midi, s) => notes.push({
      ...(perc ? { layer: "perc", t, dur: 0.05, midi, vel: velOf(s) } : { layer: id, t, dur, midi, vel: velOf(s), tim: timOf(s.j), pan: panOf(s.x) }),
      point: s.j, raw: read, rawKey: `${id}:${Math.round(t * 1000)}:${midi}`, pic: { L: s.L, edge: s.edge, sat: s.sat, ent: s.ent }
    });
    let cur = null, prevE = 0, phase = 0, prevLevel = -1;
    const close = t => { if (cur) { cur.dur = Math.max(0.1, t - cur.t); cur = null; } };
    for (let t = 0; t < total - 1e-9; t += step) {
      const s = at(t);
      if (read === "edges") {
        const e = s.edge, hit = e > 0.55 && prevE <= 0.55; prevE = e;
        if (hit) push(t, step * 2, perc ? DRUMS[s.y > 0.66 ? 0 : s.y > 0.33 ? 1 : 2] : snap(lo + (1 - s.y) * (hi - lo), pcs, lo, hi), s);
        continue;
      }
      if (read === "texture") {
        phase += 0.25 + 1.1 * s.ent;
        if (phase >= 1) { phase -= Math.floor(phase); push(t, step * 2, perc ? DRUMS[s.L < 0.33 ? 0 : s.L < 0.66 ? 1 : 2] : snap(lo + s.L * (hi - lo), pcs, lo, hi), s); }
        continue;
      }
      const v = value(s);
      if (perc) {
        // the rhythm track hits when the reading changes level (six levels): low a kick, then a
        // snare, high a hi-hat
        const level = Math.min(5, Math.floor(clamp(v) * 6));
        if (level !== prevLevel) push(t, 0.05, DRUMS[level < 2 ? 0 : level < 4 ? 1 : 2], s);
        prevLevel = level; continue;
      }
      const m = pitchOf(s, v);
      if (m === null) { close(t); continue; }
      if (!cur || cur.midi !== m || t - cur.t >= hold - 1e-9) {
        close(t);
        push(t, step, m, s); cur = notes[notes.length - 1];
      }
    }
    close(total);
  }
  return notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
}


/*
 * Your edits on a raw piece, and what each note plays with.
 *  - Deleted notes (P.rawCut: their keys) are left out.
 *  - Controllers: each note has three, from the picture under it (as the composed pieces take
 *    theirs from the places): expression (CC11) from its brightness and edges, vibrato (CC1) from
 *    how vivid the colour is, brightness (CC74) from how busy the texture is. P.rawCC holds the
 *    values you set by hand ({ key: { expr, mod, bright } }), which win. In the app the expression
 *    sets the track's level, the brightness its filter and the vibrato a synthesizer's vibrato; all
 *    three go into the MIDI file.
 *  - Each track's effects from the picture (sc.rawFx): reverb for calm, smooth areas, chorus for
 *    vivid colours, delay for bright, sparse lines.
 */
export const RAW_CC = { expr: "Expression (CC11)", mod: "Vibrato (CC1)", bright: "Brightness (CC74)" };
export const RAW_CC_DESC = { expr: "from the brightness and the edges under the note", mod: "from how vivid the colour is", bright: "from how busy the texture is" };
export function ccFromPicture(p = {}) {
  return { expr: clamp(0.55 + 0.35 * (p.L ?? 0.5) + 0.1 * (p.edge ?? 0)), mod: clamp(0.8 * (p.sat ?? 0.3)), bright: clamp(0.25 + 0.75 * (p.ent ?? 0.5)) };
}
export function applyRawEdits(sc, P = {}) {
  const cut = new Set(P.rawCut || []), own = P.rawCC || {}, spb = 60 / sc.bpm, before = sc.notes.length;
  sc.notes = sc.notes.filter(n => !cut.has(n.rawKey));
  sc.raw.cut = before - sc.notes.length;
  const cc = {};
  for (const n of sc.notes) {
    const o = own[n.rawKey] || null;
    n.cc = { ...ccFromPicture(n.pic), ...(o || {}) };
    if (o) n.ccOwn = true;
    if (n.layer === "perc" || !n.tim) continue;
    const tim = { ...n.tim, cut: Math.min(16000, (n.tim.cut || 6000) * 2 ** (2 * (n.cc.bright - 0.5))) };
    if (tim.type !== "sample" && n.cc.mod > 0.02 && n.dur * spb >= 0.4) tim.vib = (tim.vib || 0) + Math.round(16 * n.cc.mod);
    n.tim = tim;
    const c = cc[n.layer] || (cc[n.layer] = { expr: [], mod: [], bright: [] });
    c.expr.push([n.t, n.cc.expr]); c.mod.push([n.t, n.cc.mod]); c.bright.push([n.t, n.cc.bright]);
  }
  // one value per moment (the last note starting there)
  for (const c of Object.values(cc)) for (const k of ["expr", "mod", "bright"]) {
    const m = new Map(); for (const [t, v] of c[k]) m.set(Math.round(t * 1e4), [t, v]);
    c[k] = [...m.values()].sort((a, b) => a[0] - b[0]);
  }
  sc.cc = cc;
  // each track's effects, from what its notes saw
  const fx = {}, by = {};
  for (const n of sc.notes) if (n.layer !== "perc" && n.pic) (by[n.layer] || (by[n.layer] = [])).push(n);
  for (const [l, ns] of Object.entries(by)) {
    const m = k => ns.reduce((a, n) => a + (n.pic[k] ?? 0), 0) / ns.length, density = ns.length / Math.max(1, sc.total);
    fx[l] = { rev: clamp(0.2 + 0.9 * (1 - m("edge")) * (1 - 0.4 * m("ent"))), cho: clamp(0.75 * m("sat")), dly: clamp((0.05 + 0.4 * m("L")) * (1 - Math.min(1, density / 2))) };
  }
  sc.rawFx = fx;
  return sc;
}
