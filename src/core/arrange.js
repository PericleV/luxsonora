// Orchestration: extra layers beyond melody, harmony, bass, pad and rhythm.
//
// Each extra layer has a role, and every role reads something of its own in the image, so each
// note still traces back to an area:
//   counter   a second gaze path through what the first one did not look at (1 − coverage)
//   ornament  small bright details (blobs and corners × brightness), each placed while the
//             gaze is nearest to it
//   ostinato  the texture of the current area, as a repeated figure on the chord
//   sustain   the large calm regions, as a held section chord that swells
//   double    the melody itself, an octave away, in the tense parts
//   drone     the background, as a tonic and fifth
//   pulse     the edges, as low pitched percussion (timpani, taiko) on a euclidean figure
// Arrangement rules keep it harmonious: every role has its own register, notes come from the
// sounding chord (or the melody), the more layers the less each one plays, and layers enter in
// turn as the dramatic arc rises (an orchestral crescendo) and thin out in the resolution.
// "Small" orchestration adds nothing: the piece is exactly the five-layer one.
import { clamp, clampInt, lerp } from "./util.js";
import { degMidi } from "./theory.js";
import { euclid, areaDrive } from "./rhythm.js";
import { gazePath } from "./focus.js";
import { detailsMap } from "./placement.js";
import { pathProfile, passage } from "./passages.js";

// gain: the layer's level in the mix, set from offline renders of the demos so that a counter-
// melody sits about 9 dB under the melody, the doubling 8 dB and the section 11 dB (RMS, Orchestral epic).
export const ROLES = {
  counter: { name: "Counter-melody", gain: 2.2, pan: -0.3, gm: 42, desc: "a second gaze path through what the first one missed" },
  ornament: { name: "Ornaments", gain: 1.0, pan: 0.35, gm: 9, desc: "small bright details, when the gaze is near them" },
  ostinato: { name: "Ostinato", gain: 0.6, pan: 0.2, gm: 45, desc: "the texture of the area, as a repeated figure" },
  sustain: { name: "Section", gain: 0.72, pan: 0, gm: 48, desc: "the large calm regions, as a held chord that swells" },
  double: { name: "Doubling", gain: 0.85, pan: -0.15, gm: 60, desc: "the melody an octave away, in the tense parts" },
  drone: { name: "Drone", gain: 0.45, pan: 0, gm: 89, desc: "the background, as tonic and fifth" },
  pulse: { name: "Pulse", gain: 0.5, pan: 0.1, gm: 47, desc: "the edges, as low pitched percussion" },
  runs: { name: "Runs", gain: 0.8, pan: 0.25, gm: 46, desc: "the path between points, as runs that link them" }
};
export const ROLE_COLOR = { counter: "#C77DDB", ornament: "#E6C84F", ostinato: "#5CC7D6", sustain: "#8FA5E8", double: "#F08A5D", drone: "#9AA8A0", pulse: "#D98A6C", runs: "#7FD18B" };

// Roles in order of priority per style (the first ones are added first).
export const STYLE_ROLES = {
  ambient: ["ornament", "drone", "runs", "counter", "sustain", "ostinato", "double"],
  cinematic: ["sustain", "counter", "runs", "ostinato", "ornament", "double", "pulse"],
  minimal: ["ostinato", "counter", "runs", "ornament", "pulse", "sustain", "double"],
  jazz: ["counter", "sustain", "runs", "ornament", "double", "ostinato", "drone"],
  electronic: ["ostinato", "sustain", "runs", "ornament", "counter", "pulse", "double"],
  epic: ["sustain", "double", "runs", "pulse", "counter", "ornament", "ostinato"],
  movie: ["ornament", "counter", "runs", "sustain", "ostinato", "double", "drone"],
  lofi: ["counter", "ornament", "runs", "drone", "ostinato", "sustain", "double"],
  bossa: ["counter", "ornament", "runs", "sustain", "double", "ostinato", "pulse"],
  synthwave: ["ostinato", "sustain", "runs", "counter", "ornament", "double", "pulse"],
  classical: ["counter", "sustain", "runs", "ornament", "double", "drone", "pulse"]
};
// Instrument per style and role: sampled (when sampled instruments are on) and synthesized.
const SAMPLED = {
  ambient: { runs: "s.harp", counter: "s.flute", ornament: "s.glock", drone: "s.warmpad", sustain: "s.synthstrings", ostinato: "s.vibes", double: "s.flute", pulse: "s.timpani" },
  cinematic: { runs: "s.harp", counter: "s.cello", ornament: "s.celesta", sustain: "s.strings", ostinato: "s.pizz", double: "s.horn", pulse: "s.timpani", drone: "s.contrabass" },
  minimal: { runs: "s.marimba", ostinato: "s.marimba", counter: "s.clarinet", ornament: "s.glock", pulse: "s.marimba", sustain: "s.strings", double: "s.vibes", drone: "s.organ" },
  jazz: { runs: "s.vibes", counter: "s.tenorsax", sustain: "s.brass", ornament: "s.vibes", double: "s.trumpet", ostinato: "s.jazzgtr", drone: "s.organ", pulse: "s.vibes" },
  electronic: {},
  epic: { runs: "s.strings", sustain: "s.brass", double: "s.horn", pulse: "s.timpani", counter: "s.violin", ornament: "s.celesta", ostinato: "s.tremolo", drone: "s.contrabass" },
  movie: { runs: "s.harp", ornament: "s.celesta", counter: "s.cello", sustain: "s.strings", ostinato: "s.harp", double: "s.violin", drone: "s.contrabass", pulse: "s.timpani" },
  lofi: { runs: "s.vibes", counter: "s.tenorsax", ornament: "s.vibes", drone: "s.warmpad", ostinato: "s.nylon", sustain: "s.organ", double: "s.flute", pulse: "s.vibes" },
  bossa: { runs: "s.flute", counter: "s.tenorsax", ornament: "s.vibes", sustain: "s.strings", double: "s.flute", ostinato: "s.nylon", pulse: "s.marimba", drone: "s.contrabass" },
  synthwave: {},
  classical: { runs: "s.harp", counter: "s.violin", sustain: "s.strings", ornament: "s.flute", double: "s.oboe", drone: "s.contrabass", pulse: "s.timpani", ostinato: "s.pizz" }
};
// synthesizer styles take their own sounds for some roles
const STYLE_SYNTH = { electronic: { ostinato: "electronic.lead", sustain: "electronic.pad", pulse: "electronic.bass" }, synthwave: { ostinato: "synthwave.harm", sustain: "synthwave.pad", pulse: "synthwave.bass", counter: "x.synthlead" } };
const SYNTH = { runs: "x.glass", counter: "x.softlead", ornament: "x.glass", ostinato: "x.keys", sustain: "x.brass", double: "x.warmlead", drone: "x.sine", pulse: "x.keys" };
export const roleInstrument = (style, role, samples) => (samples && SAMPLED[style] && SAMPLED[style][role]) || (STYLE_SYNTH[style] && STYLE_SYNTH[style][role]) || SYNTH[role];

// Registers (MIDI) relative to the melody's base note, so the roles don't cover each other.
const REGISTER = { runs: [0, 19], counter: [-12, 2], ornament: [12, 26], ostinato: [-5, 10], sustain: [-5, 14], drone: [-24, -12], pulse: [-27, -14] };

export const ORCHESTRATION = { small: "Small", medium: "Medium", full: "Full", custom: "Custom" };

/*
 * The extra layers of an orchestration level, deterministic from the style and the image:
 * Medium adds 2-3, Full 4-6, more for richer images (entropy, edges, number of places).
 */
export function autoLayers(style, level, richness, samples) {
  if (level !== "medium" && level !== "full") return [];
  const n = level === "medium" ? 2 + Math.round(clamp(richness)) : 4 + Math.round(2 * clamp(richness));
  return (STYLE_ROLES[style] || STYLE_ROLES.ambient).slice(0, n).map((role, i) => ({ id: "x" + (i + 1), role, preset: roleInstrument(style, role, samples) }));
}
export const richnessOf = (A, places) => clamp(0.4 * A.global.entropy + 0.3 * A.global.edgeN + 0.3 * Math.min(1, places / 10));

// Entry threshold of the k-th extra layer (0-based) out of n: they join one by one as the tension rises.
const entryOf = (k, n) => 0.42 + (0.38 * k) / Math.max(1, n);
const PCS = m => ((m % 12) + 12) % 12;
const nearestIn = (pcs, target, lo, hi) => {
  let best = null;
  for (let m = lo; m <= hi; m++) if (pcs.has(PCS(m)) && (best === null || Math.abs(m - target) < Math.abs(best - target))) best = m;
  return best;
};

/*
 * Notes of the extra layers. ctx: { layers, A, sal, cov, points (composed), slots, body, cadenceT,
 * modeIv, pcOff, baseLead, scalePcs, leadNotes, inst (per layer id), newId, spb }.
 * Returns notes (layer = the layer id, point = the focus point sounding at that time).
 */
export function extraNotes(ctx) {
  const { layers, A, sal, cov, points, slots, body, baseLead, inst, modeIv, pcOff } = ctx, n = layers.length, notes = [];
  if (!n || !points.length || !slots.length) return notes;
  const pointAt = t => points.find(F => t >= F.t0 - 1e-9 && t < F.t1 - 1e-9) || points[points.length - 1];
  const density = 1 / (1 + 0.22 * (n - 1));
  const leadAt = t => ctx.leadNotes.find(x => t >= x.t - 1e-9 && t < x.t + x.dur - 1e-9);
  const reg = (role) => [baseLead + REGISTER[role][0], baseLead + REGISTER[role][1]];
  layers.forEach((L, k) => {
    const role = L.role, R = ROLES[role], tim = inst[L.id], thr = entryOf(k, n), add = (t, dur, midi, vel, extra = {}) =>
      notes.push({ layer: L.id, t, dur: Math.max(0.1, dur), midi, vel: clampInt(Math.round(vel), 1, 127), tim, pan: R.pan, point: pointAt(t).idx, ...extra });
    // a layer plays a slot when its point's tension has reached its entry (drone and ornaments also stay in the resolution)
    const active = S => { const F = S.F; return F.tension >= thr - 1e-9 && !(F.section === "resolution" && role !== "drone" && role !== "ornament" && F.tension < thr + 0.1); };
    if (role === "counter") {
      // the second path: the attention map where the first path did not look
      const map2 = new Float32Array(sal.map.length);
      for (let i = 0; i < map2.length; i++) map2[i] = sal.map[i] * (1 - (cov ? cov.map[i] : 0));
      const m = Math.max(3, Math.min(12, slots.length));
      const path = gazePath(A, map2, { count: m, returns: 0, inhibition: 0.2, memory: 0, seed: 0, radius: 0.06 }, []).map(q => ({ ...q, id: undefined }));
      const [lo, hi] = reg("counter");
      let prev = null;
      slots.forEach((S, si) => {
        if (!active(S)) { prev = null; return; }
        const q = path[si % path.length], target = lo + (1 - q.y) * (hi - lo), step = S.F.tension > 0.78 ? 1 : 2;
        for (let t = S.t0; t < S.t1 - 1e-9; t += step) {
          const ln = leadAt(t);
          let m = nearestIn(S.pcs, prev === null ? target : lerp(prev, target, 0.35), lo, hi);
          if (m === null) continue;
          if (ln && PCS(ln.midi) === PCS(m)) m = nearestIn(new Set([...S.pcs].filter(p => p !== PCS(ln.midi))), m, lo, hi) ?? m;
          add(t, Math.min(step, S.t1 - t) * 0.98, m, 80 * density + 22, { src: { x: q.x, y: q.y } });
          prev = m;
        }
      });
    } else if (role === "ornament") {
      // bright small details: blobs and corners weighted by brightness, the strongest peaks
      const det = detailsMap(A), W = A.W, H = A.H, diag = Math.hypot(W, H), peaks = [];
      const score = new Float32Array(det.length); for (let i = 0; i < det.length; i++) score[i] = det[i] * (0.3 + 0.7 * A.L[i]);
      const want = Math.max(2, Math.round((body / 4) * 1.2 * density));
      const order = [...score.keys()].sort((a, b) => score[b] - score[a] || a - b);
      for (const i of order) {
        if (peaks.length >= want) break;
        const x = i % W, y = (i / W) | 0;
        if (peaks.every(p => Math.hypot(p.x - x, p.y - y) > 0.08 * diag)) peaks.push({ x, y, v: score[i] });
      }
      const [lo, hi] = reg("ornament"), used = new Map();
      for (const p of peaks) {
        // the point of the path nearest to the detail, and an off-beat inside it
        let F = points[0], bd = Infinity;
        for (const G of points) { const d = Math.hypot(G.x * W - p.x, G.y * H - p.y); if (d < bd) { bd = d; F = G; } }
        const c = used.get(F.idx) || 0; if (c >= 2) continue;
        const t = F.t0 + 0.5 + c; if (t >= F.t1 - 0.25) continue;
        const S = slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1];
        if (!active(S) && F.tension < thr) continue;
        const m = nearestIn(S.pcs, lo + (1 - p.y / H) * (hi - lo), lo, hi); if (m === null) continue;
        used.set(F.idx, c + 1);
        add(t, 0.75, m, 50 + 40 * clamp(p.v) * density, { src: { x: (p.x + 0.5) / W, y: (p.y + 0.5) / H } });
      }
    } else if (role === "ostinato") {
      const [lo, hi] = reg("ostinato");
      slots.forEach(S => {
        if (!active(S) || S.F.section === "intro") return;
        const sorted = [...S.chord].sort((a, b) => a - b), root = nearestIn(new Set([PCS(sorted[0])]), (lo + hi) / 2 - 4, lo, hi) ?? sorted[0];
        const fifth = nearestIn(new Set([PCS(sorted.find(x => PCS(x - sorted[0]) === 7) ?? sorted[sorted.length - 1])]), root + 7, root, root + 12) ?? root + 7;
        const fig = [root, fifth, root + 12, fifth], rate = S.F.tension > 0.8 && density > 0.6 ? 0.25 : 0.5;
        let j = 0;
        for (let t = S.t0; t < S.t1 - 1e-9; t += rate, j++) add(t, rate * 0.9, fig[j % 4], (j % 4 === 0 ? 70 : 54) * (0.6 + 0.4 * density));
      });
    } else if (role === "sustain") {
      const [lo, hi] = reg("sustain");
      let prev = null;
      slots.forEach(S => {
        if (!active(S)) { prev = null; return; }
        const voices = [...S.pcs].slice(0, 3).map((pc, i) => nearestIn(new Set([pc]), prev ? prev[i] ?? (lo + hi) / 2 : lo + 4 + 4 * i, lo, hi)).filter(x => x !== null);
        voices.forEach(m => add(S.t0, S.t1 - S.t0, m, 58 * (0.7 + 0.3 * density), { swell: true }));
        prev = voices;
      });
    } else if (role === "drone") {
      const [lo, hi] = reg("drone"), tonic = nearestIn(new Set([PCS(degMidi(0, modeIv, 60 + pcOff))]), lo + 4, lo, hi), fifth = tonic + 7;
      for (let b = 0; b < body - 1e-9; b += 8) {
        const S = slots.find(S => b >= S.t0 - 1e-9 && b < S.t1 - 1e-9) || slots[0];
        if (!active(S) && S.F.tension < thr - 0.1) continue;
        const d = Math.min(8, body - b);
        add(b, d, tonic, 44 * (0.7 + 0.3 * density)); add(b, d, fifth, 36 * (0.7 + 0.3 * density));
      }
    } else if (role === "runs") {
      // the path between consecutive points, as a run from one chord to the next (passages.js)
      const [lo, hi] = reg("runs"), slotAt = t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1];
      for (let i = 0; i + 1 < points.length; i++) {
        const F = points[i], G = points[i + 1], S = slotAt(F.t1 - 0.01), S2 = slotAt(G.t0 + 0.01);
        if (!active(S)) continue;
        const prof = pathProfile(A, F, G), win = Math.min(2, F.dur - 0.5);
        if (prof.len < 0.18 || win < 0.5) continue;
        const from = nearestIn(S.pcs, (lo + hi) / 2 - 2, lo, hi), to = nearestIn(S2.pcs, from + (G.y < F.y ? 5 : -5), lo, hi);
        if (from === null || to === null) continue;
        const ps = passage(from, to, F.t1 - win, F.t1, prof, density > 0.6 ? "rich" : "light", ctx.style, ctx.modePcs, t => slotAt(t).pcs);
        for (const x of ps) add(x.t, x.dur, x.midi, 52 + 30 * x.f, { passage: { from: i, to: i + 1, f: x.f }, ...(x.chromatic ? { chromatic: true } : {}) });
      }
    } else if (role === "pulse") {
      const [lo, hi] = reg("pulse");
      slots.forEach(S => {
        if (!active(S) || S.F.section === "intro") return;
        const a = areaDrive(S.F), hits = euclid(Math.round(lerp(2, 5, S.F.tension) * (0.6 + 0.4 * density)), 16, a.rot);
        const root = nearestIn(new Set([PCS([...S.chord].sort((x, y) => x - y)[0])]), (lo + hi) / 2, lo, hi);
        if (root === null) return;
        // the other hits take the chord tone nearest a fifth above (a diminished chord has no perfect fifth)
        const up = nearestIn(new Set([...S.pcs].filter(p => p !== PCS(root))), root + 7, root + 1, hi) ?? root;
        for (let j = Math.round(S.t0 * 4); j < Math.round(S.t1 * 4); j++) if (hits[((j % 16) + 16) % 16]) add(j / 4, 0.5, j % 16 === 0 ? root : up, j % 16 === 0 ? 92 : 70);
      });
    }
  });
  return notes;
}

// Doubling: the melody an octave below (above if that leaves the register) in the slots where
// the doubling layer is active. Run after the melody is final (also after a neural melody).
export function doubleNotes(score) {
  const layers = score.extra || [], L = layers.find(x => x.role === "double"), notes = score.notes;
  for (let i = notes.length - 1; i >= 0; i--) if (L && notes[i].layer === L.id) notes.splice(i, 1);
  if (!L) return score;
  const k = layers.indexOf(L), thr = entryOf(k, layers.length);
  const lead = notes.filter(nn => nn.layer === "lead" && nn.point >= 0 && !nn.dbl && nn.t < score.body);
  for (const nn of lead) {
    const F = score.points[nn.point];
    if (!F || F.tension < thr) continue;
    const m = nn.midi - 12 >= 48 ? nn.midi - 12 : nn.midi + 12;
    notes.push({ layer: L.id, t: nn.t, dur: nn.dur, midi: m, vel: Math.max(1, Math.round(nn.vel * 0.7)), tim: (F.timX && F.timX[L.id]) || score.inst[L.id], pan: ROLES.double.pan, point: nn.point, ...(nn.chromatic ? { chromatic: true } : {}) });
  }
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return score;
}

// Cadence notes of the extra layers (the tonic chord, in each role's register).
export function cadenceExtra(layers, cadChord, baseLead, tc, holdFor, inst) {
  const out = [], pcs = new Set(cadChord.map(PCS));
  for (const L of layers) {
    const role = L.role, R = REGISTER[role]; if (!R || role === "pulse" || role === "ostinato") continue;
    const lo = baseLead + R[0], hi = baseLead + R[1], tim = inst[L.id];
    const ms = role === "sustain" ? [...pcs].slice(0, 3).map((pc, i) => nearestIn(new Set([pc]), lo + 4 + 4 * i, lo, hi)) : role === "drone" ? [nearestIn(new Set([PCS(cadChord[0])]), lo + 4, lo, hi)] : [nearestIn(pcs, (lo + hi) / 2, lo, hi)];
    for (const m of ms) if (m !== null) out.push({ layer: L.id, t: tc, dur: holdFor(tim), midi: m, vel: role === "ornament" ? 50 : 54, tim, pan: ROLES[role].pan, point: -2 });
  }
  return out;
}
