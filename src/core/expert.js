// Expert rules: the user's own rules on the places the eye finds (Piece › Expert rules).
// A rule is "when <condition>, do <action>". The conditions pick focus points; the actions change
// the music there. User rules win over the style's rules, but stay in harmony: a chord is a degree
// of the key (so it is always in the scale, and the melody is fitted to it afterwards), an added
// instrument plays chord tones in its role's register, and a moved melody keeps its notes.
//   rule = { id, on, when: { type, point, section, colour, zone: {x0,y0,x1,y1}, from, to },
//            do: { type, preset, role, layer, degree, octave, db } }
import { clamp } from "./util.js";

export const CONDITIONS = { point: "At place", section: "In the part", colour: "Where the colour is", zone: "Inside a zone I draw", time: "Between seconds" };
export const ACTIONS = { play: "Add an instrument", mute: "Silence a track", chord: "Use the chord", octave: "Move the melody", dynamics: "Play louder or softer" };
export const SECTIONS = { intro: "Introduction", development: "Development", climax: "Climax", resolution: "Resolution" };
// colour families on the hue circle (degrees), plus light and dark
export const COLOURS = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", cyan: "Cyan", blue: "Blue", purple: "Purple", magenta: "Magenta", grey: "Grey (no colour)", bright: "Bright", dark: "Dark" };
const HUE_FROM = [["red", 345], ["orange", 15], ["yellow", 45], ["green", 70], ["cyan", 165], ["blue", 200], ["purple", 255], ["magenta", 290]];
export function colourOf(reg) {
  if (!reg || (reg.hueStr ?? 0) < 0.08) return "grey";
  const h = (((reg.hue ?? 0) % 360) + 360) % 360;
  if (h >= 345 || h < 15) return "red";
  let name = "orange";
  for (const [n, from] of HUE_FROM.slice(1)) if (h >= from) name = n;
  return name;
}
export const newRule = id => ({ id, on: true, when: { type: "section", section: "climax", point: 1, colour: "blue", zone: null, from: 0, to: 5 }, do: { type: "play", preset: "s.strings", role: "sustain", layer: "perc", degree: 4, octave: 1, db: 6 } });
const active = rules => (rules || []).filter(r => r && r.on !== false && r.when && r.do);

// Does focus point F (composed: x, y, t0, section, reg, idx) meet the condition? spb: seconds per beat.
export function pointMatches(w, F, spb) {
  if (!w || !F) return false;
  switch (w.type) {
    case "point": return F.idx === (w.point ?? 1) - 1;
    case "section": return F.section === w.section;
    case "colour": {
      const L = F.reg ? F.reg.L ?? 0.5 : 0.5;
      if (w.colour === "bright") return L > 0.62;
      if (w.colour === "dark") return L < 0.32;
      return colourOf(F.reg) === w.colour;
    }
    case "zone": { const z = w.zone; return !!z && F.x >= Math.min(z.x0, z.x1) && F.x <= Math.max(z.x0, z.x1) && F.y >= Math.min(z.y0, z.y1) && F.y <= Math.max(z.y0, z.y1); }
    case "time": { const s = F.t0 * spb, e = F.t1 * spb; return e > (w.from ?? 0) && s < (w.to ?? 0); }
    default: return false;
  }
}
// The stretches (in beats) where a rule applies: the matching places, or the seconds asked for.
export function ruleSpans(rule, points, spb) {
  const w = rule.when;
  if (w.type === "time") { const a = Math.max(0, (w.from ?? 0) / spb), b = Math.max(a, (w.to ?? 0) / spb); return b > a ? [[a, b]] : []; }
  const out = [];
  for (const F of points) if (pointMatches(w, F, spb)) { const last = out[out.length - 1]; if (last && Math.abs(last[1] - F.t0) < 1e-9) last[1] = F.t1; else out.push([F.t0, F.t1]); }
  return out;
}
const inSpans = (spans, t) => spans.some(([a, b]) => t >= a - 1e-9 && t < b - 1e-9);

// Extra layers asked for by "Add an instrument" rules; they play only where their rule applies.
export function expertLayers(rules) {
  return active(rules).filter(r => r.do.type === "play" && r.do.preset).map(r => ({ id: "e" + r.id, role: r.do.role || "counter", preset: r.do.preset, only: true, rule: r.id }));
}
// "Use the chord": the chord slots under the matching places take that degree of the key (a slot
// counts when at least half of it, or half of the place, lies inside).
export function applyExpertChords(rules, slots, points, spb) {
  for (const r of active(rules)) {
    if (r.do.type !== "chord") continue;
    const spans = ruleSpans(r, points, spb), deg = clamp(Math.round(r.do.degree ?? 0), 0, 6);
    for (const S of slots) {
      const hit = spans.some(([a, b]) => Math.min(S.t1, b) - Math.max(S.t0, a) >= 0.5 * Math.min(S.t1 - S.t0, b - a) - 1e-9);
      if (hit) { S.F = { ...S.F, root: deg }; S.expert = r.id; }
    }
  }
}
// Notes: silence a track, move the melody by octaves, louder or softer, and keep the added
// instruments to their places (an added instrument's layer is "e" + its rule's id).
// layers: only these layers (a melody rewritten by a neural model gets the rules again).
export function applyExpertNotes(rules, notes, points, spb, layers = null) {
  const R = active(rules), keep = new Array(notes.length).fill(true);
  for (const r of R) {
    const spans = ruleSpans(r, points, spb), d = r.do;
    notes.forEach((n, i) => {
      if (!keep[i] || (layers && !layers.has(n.layer))) return;
      if (d.type === "play") { if (n.layer === "e" + r.id && !inSpans(spans, n.t)) keep[i] = false; return; }
      if (!inSpans(spans, n.t)) return;
      if (d.type === "mute" && n.layer === d.layer) keep[i] = false;
      else if (d.type === "octave" && n.layer === "lead") { const m = n.midi + 12 * (d.octave || 0); if (m >= 36 && m <= 100) n.midi = m; }
      else if (d.type === "dynamics" && (!d.layer || d.layer === "all" || n.layer === d.layer)) n.vel = Math.max(1, Math.min(127, Math.round(n.vel * Math.pow(10, (d.db || 0) / 40))));
    });
  }
  for (let i = notes.length - 1; i >= 0; i--) if (!keep[i]) notes.splice(i, 1);
}
// One line per rule, for the list and the point's explanation.
export function describeRule(r, names = {}) {
  const w = r.when, d = r.do;
  const when = w.type === "point" ? `at place ${w.point}` : w.type === "section" ? `in the ${(SECTIONS[w.section] || w.section).toLowerCase()}` : w.type === "colour" ? `where it is ${(COLOURS[w.colour] || w.colour).toLowerCase()}` : w.type === "zone" ? "inside the zone" : `from ${w.from} s to ${w.to} s`;
  const what = d.type === "play" ? `add ${names.preset || d.preset}` : d.type === "mute" ? `silence the ${(names.layer || d.layer).toLowerCase()}` : d.type === "chord" ? `use chord ${names.degree || d.degree + 1}` : d.type === "octave" ? `move the melody ${d.octave > 0 ? "up" : "down"} ${Math.abs(d.octave)} octave${Math.abs(d.octave) === 1 ? "" : "s"}` : `play ${d.db > 0 ? "louder" : "softer"} by ${Math.abs(d.db)} dB`;
  return `${when.charAt(0).toUpperCase() + when.slice(1)}, ${what}`;
}
