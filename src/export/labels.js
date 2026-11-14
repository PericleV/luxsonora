// Labels on the places in the video: what the music and the picture do there.
//
// Notes: the notes a chosen track plays at the place (the melody by default; notes struck
// together are one chord, named by its symbol), and under them the place's chord. While the eye
// is there they can follow the music: the label shows the last ones played, the newest on the
// right, and each new one slides in as it sounds (tickerAt).
// Timbre: the measures of the picture at the place that shape its sound, the ones ticked in the
// tab ("Edges 0.50"), with the picture's mean next to them if asked.
// My own: the user's own text for each point (an empty text shows no label).
// A label may have several lines.
import { midiName, pcName } from "../core/theory.js";
import { romanOf } from "../core/compose.js";
import { clamp } from "../core/util.js";

export const LABEL_MODES = { off: "Off", notes: "Notes", timbre: "Timbre", custom: "My own" };

const MAX_NOTES = 8;

/* ---- chords ---- */
// interval sets (from the root) and their symbols; the first that matches names the chord
const CHORDS = [
  [[0, 4, 7], ""], [[0, 3, 7], "m"], [[0, 3, 6], "dim"], [[0, 4, 8], "aug"], [[0, 2, 7], "sus2"], [[0, 5, 7], "sus4"],
  [[0, 4, 7, 10], "7"], [[0, 4, 7, 11], "maj7"], [[0, 3, 7, 10], "m7"], [[0, 3, 7, 11], "mMaj7"], [[0, 3, 6, 10], "m7b5"], [[0, 3, 6, 9], "dim7"],
  [[0, 4, 7, 9], "6"], [[0, 3, 7, 9], "m6"], [[0, 2, 4, 7], "add9"], [[0, 2, 3, 7], "madd9"], [[0, 5, 7, 10], "7sus4"],
  [[0, 2, 4, 7, 10], "9"], [[0, 2, 4, 7, 11], "maj9"], [[0, 2, 3, 7, 10], "m9"], [[0, 2, 4, 7, 9], "6/9"],
  [[0, 4, 10], "7"], [[0, 3, 10], "m7"], [[0, 4, 11], "maj7"], [[0, 7], "⁵"]
];
const KEY = a => a.join(",");
const CHORD_OF = new Map(CHORDS.map(([iv, s]) => [KEY(iv), s]));
// The symbol of a chord from its notes (MIDI): "Am7", "G9", "C/E" when the lowest note is not the
// root, a power chord as "G⁵" (not "G5", which reads as the note G in octave 5 next to the notes);
// null when it is no chord the table knows.
export function chordSymbol(midis) {
  if (!midis || !midis.length) return null;
  const pcs = [...new Set(midis.map(m => ((m % 12) + 12) % 12))], bass = ((Math.min(...midis) % 12) + 12) % 12;
  if (pcs.length < 2) return null;
  for (const root of [bass, ...pcs.filter(p => p !== bass)]) {
    const iv = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b), s = CHORD_OF.get(KEY(iv));
    if (s !== undefined) return pcName(root) + s + (root !== bass ? "/" + pcName(bass) : "");
  }
  return null;
}
// One event (notes struck together): a single note by its name ("E4"), octaves or a doubled note
// by the lowest, a chord by its symbol, else its notes.
export function eventName(midis) {
  const pcs = new Set(midis.map(m => ((m % 12) + 12) % 12));
  if (pcs.size === 1) return midiName(Math.min(...midis));
  return chordSymbol(midis) || [...midis].sort((a, b) => a - b).map(m => pcName(m)).join("·");
}

/* ---- notes ---- */
// The tracks a Notes label can follow (the drums have no notes)
export function noteTracks(sc, names = {}) {
  const ids = [...new Set(((sc && sc.notes) || []).map(n => n.layer))].filter(l => l !== "perc");
  const order = ["lead", "harm", "bass", "pad"];
  return ids.sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99)).map(l => [l, names[l] || l]);
}
// The events of a track at each place, in seconds: [[{ s, name }]] by point index. A note
// belongs to the place whose time it starts in; notes starting within 30 ms are one event.
export function placeEvents(sc, spb, track = "lead") {
  const pts = (sc && sc.points) || [], out = pts.map(() => []);
  const ns = ((sc && sc.notes) || []).filter(n => n.layer === track && !n.intro).sort((a, b) => a.t - b.t || a.midi - b.midi);
  let j = 0;
  for (const n of ns) {
    while (j < pts.length - 1 && n.t >= pts[j].t1 - 1e-6) j++;
    if (!pts[j] || n.t < pts[j].t0 - 1e-6 || n.t >= pts[j].t1 - 1e-6) continue;
    const list = out[j], s = n.t * spb, last = list[list.length - 1];
    if (last && s - last.s <= 0.03) last.midis.push(n.midi); else list.push({ s, midis: [n.midi] });
  }
  return out.map(l => l.map(e => ({ s: e.s, name: eventName(e.midis) })));
}
// The place's chord, under the notes: "chord vi · Am"
export function chordLine(F, modeIv) {
  if (!F.chord || !F.chord.length) return "";
  const sym = chordSymbol(F.chord) || F.chord.map(m => pcName(m)).join(" ");
  return `chord ${modeIv && F.root !== undefined ? romanOf(F.root, modeIv) + " · " : ""}${sym}`;
}
// The static label of a place: its first events (at most eight, then "…"), and its chord.
export function notesLabel(events, F, modeIv) {
  const ns = (events || []).map(e => e.name);
  if (!ns.length) return "";
  const line = ns.length > MAX_NOTES ? ns.slice(0, MAX_NOTES).join(" ") + " …" : ns.join(" ");
  const chord = chordLine(F, modeIv);
  return chord ? line + "\n" + chord : line;
}
export const TICKER_SLOTS = 6;
// What a following label shows at `sec`: the events played so far (the last `slots`, plus the one
// sliding out once the row is full), newest last; before the first, that one.
// u: how far the newest has come in (0 to 1 over `slide` seconds); full: the row is full, so a new
// one pushes the others left.
export function tickerAt(list, sec, slots = TICKER_SLOTS, slide = 0.14) {
  if (!list || !list.length) return null;
  let k = 0; while (k < list.length && list[k].s <= sec + 1e-6) k++;
  const n = Math.min(slots, list.length);
  if (k === 0) return { names: [list[0].name], slots: n, u: 1, full: false };
  const full = k > slots, names = list.slice(Math.max(0, k - slots - (full ? 1 : 0)), k).map(x => x.name);
  return { names, slots: n, u: Math.min(1, Math.max(0, (sec - list[k - 1].s) / slide)), full };
}

/* ---- the picture's measures ---- */
// What the analysis measured at a place (0-1), and the picture's mean where the app keeps one.
export const MEASURES = {
  edges: { name: "Edges", at: (F, st) => clamp(F.reg.edge / (st.maxE || 1)), mean: st => 1 - st.mu.smooth },
  sharpness: { name: "Edge sharpness", at: F => F.tim.src.sharp, mean: st => st.mu.sharp },
  smoothness: { name: "Smoothness", at: F => F.tim.src.smooth, mean: st => st.mu.smooth },
  entropy: { name: "Entropy", at: F => F.tim.src.ent, mean: st => st.mu.ent },
  saturation: { name: "Saturation", at: F => F.tim.src.sat, mean: st => st.mu.sat },
  warmth: { name: "Warmth", at: F => F.tim.src.warm, mean: st => st.mu.warm },
  brightness: { name: "Brightness", at: F => F.reg.L },
  saliency: { name: "Saliency", at: F => F.s }
};
export const DEFAULT_MEASURES = { edges: true, entropy: true, saturation: true };
// The measures of a place, one per line: "Edges 0.50", or "Edges 0.50 · mean 0.31".
export function measuresLabel(F, stats, which = DEFAULT_MEASURES, withMean = false) {
  const st = stats || { mu: {} }, f = x => (typeof x === "number" && isFinite(x) ? x.toFixed(2) : "?");
  return Object.entries(MEASURES).filter(([k]) => which && which[k]).map(([, M]) => {
    let v; try { v = M.at(F, st); } catch (e) { v = undefined; }
    let m; if (withMean && M.mean) try { m = M.mean(st); } catch (e) { m = undefined; }
    return `${M.name} ${f(v)}${withMean && M.mean ? ` · mean ${f(m)}` : ""}`;
  }).join("\n");
}

// The label shown for point i (0-based): the user's text by point number, or the place's notes or
// measures; `detail: false` keeps only the first line of the notes. ("auto", the detected names
// of old projects, shows the notes.)
export function labelFor(mode, i, auto, custom, detail = true) {
  if (mode === "custom") return ((custom && custom[String(i + 1)]) || "").trim();
  if (mode === "auto") mode = "notes";
  const t = (auto && auto[mode] && auto[mode][i]) || "";
  return detail || mode !== "notes" ? t : t.split("\n")[0];
}
