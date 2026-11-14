// Labels on the places in the video: what the music does there.
//
// Notes: the notes the melody plays at the place, and under them its chord. While the eye is
// there they can follow the music: the label shows the last notes played, the newest on the
// right, and each new note slides in as it sounds (tickerAt).
// Timbre: how the place changes the sound against the rest of the picture (the two strongest
// changes, as the Focus point tab names them), and under them the measures behind them: the
// place's value and the picture's mean.
// My own: the user's own text for each point (an empty text shows no label).
// A label may have several lines: the first is the label, the others its details, drawn smaller.
import { midiName } from "../core/theory.js";
import { romanOf } from "../core/compose.js";
import { DIMS, DIM_SOURCE, DIM_KEY, MOD_WORDS } from "../core/timbre.js";

export const LABEL_MODES = { off: "Off", notes: "Notes", timbre: "Timbre", custom: "My own" };

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const MAX_NOTES = 8;

// The notes of a place: its melody as played (at most eight, then "…"), and its chord.
export function notesLabel(F, modeIv) {
  const ns = (F.lead || []).map(midiName);
  if (!ns.length) return "";
  const line = ns.length > MAX_NOTES ? ns.slice(0, MAX_NOTES).join(" ") + " …" : ns.join(" ");
  const chord = F.chord && F.chord.length ? `chord ${modeIv && F.root !== undefined ? romanOf(F.root, modeIv) + ": " : ""}${F.chord.map(m => midiName(m).replace(/-?\d+$/, "")).join(" ")}` : "";
  return chord ? line + "\n" + chord : line;
}

// The timbre of a place: its two strongest changes, and the measures behind them.
export function timbreLabel(F, stats) {
  const m = F.tim && F.tim.m; if (!m) return "";
  const top = DIMS.map(d => [d, m[d] || 0]).filter(([, v]) => Math.abs(v) >= 0.1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2);
  if (!top.length) return "Like the rest of the picture";
  const head = cap(top.map(([d, v]) => MOD_WORDS[d][v < 0 ? 0 : 1]).join(", "));
  const src = F.tim.src || {}, mu = (stats && stats.mu) || {};
  const f = x => (typeof x === "number" ? x.toFixed(2) : "?");
  return [head, ...top.map(([d]) => `${DIM_SOURCE[d]} ${f(src[DIM_KEY[d]])} · image mean ${f(mu[DIM_KEY[d]])}`)].join("\n");
}

// The melody's notes of each place, in seconds: [[{ s, name }]] by point index. Notes struck
// together (the doubling an octave above at the climax) count once, by the lowest.
export function placeNoteTimes(sc, spb) {
  const out = ((sc && sc.points) || []).map(() => []);
  for (const n of (sc && sc.notes) || []) if (n.layer === "lead" && !n.intro && n.point >= 0 && out[n.point]) out[n.point].push({ s: n.t * spb, midi: n.midi });
  return out.map(l => {
    l.sort((a, b) => a.s - b.s || a.midi - b.midi);
    const keep = [];
    for (const x of l) if (!keep.length || x.s - keep[keep.length - 1].s > 0.01) keep.push(x);
    return keep.map(x => ({ s: x.s, name: midiName(x.midi) }));
  });
}
export const TICKER_SLOTS = 6;
// What a following label shows at `sec`: the notes played so far (the last `slots`, plus the one
// sliding out once the row is full), newest last; before the first note, that note.
// u: how far the newest note has come in (0 to 1 over `slide` seconds); full: the row is full, so
// a new note pushes the others left.
export function tickerAt(list, sec, slots = TICKER_SLOTS, slide = 0.14) {
  if (!list || !list.length) return null;
  let k = 0; while (k < list.length && list[k].s <= sec + 1e-6) k++;
  const n = Math.min(slots, list.length);
  if (k === 0) return { names: [list[0].name], slots: n, u: 1, full: false };
  const full = k > slots, names = list.slice(Math.max(0, k - slots - (full ? 1 : 0)), k).map(x => x.name);
  return { names, slots: n, u: Math.min(1, Math.max(0, (sec - list[k - 1].s) / slide)), full };
}

// Every place's labels of each kind: { notes: [...], timbre: [...] }, by point index.
export function placeLabels(sc) {
  const pts = (sc && sc.points) || [];
  return { notes: pts.map(F => notesLabel(F, sc.modeIv)), timbre: pts.map(F => timbreLabel(F, sc.stats)) };
}

// The label shown for point i (0-based): the user's text by point number, or the place's notes or
// timbre; `detail: false` keeps only the first line. ("auto", the detected names of old
// projects, shows the notes.)
export function labelFor(mode, i, auto, custom, detail = true) {
  if (mode === "custom") return ((custom && custom[String(i + 1)]) || "").trim();
  if (mode === "auto") mode = "notes";
  const t = (auto && auto[mode] && auto[mode][i]) || "";
  return detail ? t : t.split("\n")[0];
}
