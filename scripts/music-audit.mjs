// Music audit: composes many pieces (every style, several images and settings) and measures,
// note by note, what can sound wrong. Run: node scripts/music-audit.mjs [--examples]
//
//   clash      two notes a semitone apart (or a minor ninth) sounding together in different
//              layers, where at least one of them is not a tone of the chord at that moment
//   accNCT     an accompaniment note (harmony, bass, pad, extra layers) outside the chord on a
//              beat, held at least half a beat (chromatic approach notes excepted)
//   melNCT     a melody note outside the chord on a beat, or held a beat or more
//   unresolved a melody note outside the chord not followed by a step (≤ 2 semitones)
//   bassRoot   a bass note starting a chord that is neither its root nor its fifth
//   crossing   the melody below the top of the harmony or the bass above the melody
//   restrike   a note starting in a layer while the same pitch still sounds in that layer
//   leap       a melody leap over an octave
//   offgrid    a drum hit off the sixteenth grid
//   pileup     more than 14 pitched notes starting in one beat
//   range      a note outside MIDI 24-100
//   ending     the last chord is not the tonic, the melody's last note is not a tone of it, or a
//              note starts after the end
// Counts are per minute of music, so styles with different lengths compare.
import { synthImage } from "../test/helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { STYLES } from "../src/core/theory.js";

// --rules-off composes with every composition rule off (src/core/rules.js), to compare
const RULES_OFF = process.argv.includes("--rules-off") ? { modulate: false, contrast: false, cadences: false, picardy: false, leap: false, parallels: false, peak: false } : null;
const EXAMPLES = process.argv.includes("--examples") || !!(typeof process !== "undefined" && process.env.AUDIT_EXAMPLES);
const ONLY = (process.argv.find(a => a.startsWith("--style=")) || "").slice(8);
const IMAGES = [[200, 133, 1], [133, 200, 7], [200, 133, 3], [180, 180, 11], [240, 120, 5]].map(([w, h, s]) => ({ name: `img${s}`, img: synthImage(w, h, s) }));
const BASE = { count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7 };
const CONFIGS = [
  { duration: 30, orch: "small", connect: "off" },
  // two of the settings use the sampled band, as the app does by default (its roles and instruments differ)
  { duration: 30, orch: "full", connect: "light", samples: true, intro: "auto" },
  { duration: 60, orch: "medium", connect: "rich", samples: true },
  { duration: 30, orch: "full", connect: "rich", count: 14, smooth: 0.9 },
  { duration: 15, orch: "small", connect: "light", count: 4 }
];
const prepCache = new Map();
function prep(I) {
  if (!prepCache.has(I.name)) {
    const A = analyze(I.img), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
    prepCache.set(I.name, { A, CL, MOT, SAL: computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null) });
  }
  return prepCache.get(I.name);
}
function run(I, P) {
  const { A, CL, MOT, SAL } = prep(I);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}
const pc = m => ((m % 12) + 12) % 12;
const onBeat = t => Math.abs(t - Math.round(t)) < 1e-6;
const PITCHED_SKIP = new Set(["perc"]);

export function auditScore(sc) {
  // the chord of each slot as pitch classes, and its root (a scale degree) as a pitch class
  const L7 = sc.modeIv.length;
  for (const S of sc.slots) { S.pcs = new Set(S.chord.map(pc)); S.rootPc = pc(sc.modeIv[((S.root % L7) + L7) % L7] + sc.pcOff + (S.shift || 0)); }
  // the key at a moment: a modulation moves it for a while
  const M = sc.modulation, shiftAt = t => (M && t >= M.t0 - 1e-9 && t < M.t1 - 1e-9 ? M.shift : 0);
  const spb = 60 / sc.bpm, minutes = (sc.total * spb) / 60;
  const tonic = sc.cadence && sc.cadence.chord ? new Set(sc.cadence.chord.map(pc)) : null;
  const chordAt = t => {
    if (t >= sc.body - 1e-9 && tonic) return { pcs: tonic, root: null };
    const S = sc.slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || sc.slots[sc.slots.length - 1];
    return S ? { pcs: S.pcs, rootPc: S.rootPc, S } : { pcs: new Set(), S: null };
  };
  const pitched = sc.notes.filter(n => !PITCHED_SKIP.has(n.layer) && Number.isFinite(n.midi));
  const ex = {}, cnt = {};
  const hit = (k, msg) => { cnt[k] = (cnt[k] || 0) + 1; if (EXAMPLES) (ex[k] = ex[k] || []).length < 4 && ex[k].push(msg); };
  const where = n => `${n.layer} t=${n.t.toFixed(2)} midi=${n.midi}`;
  // clashes: pairs from different layers, overlapping ≥ 1/8 beat, a semitone (or minor ninth) apart
  const byStart = [...pitched].sort((a, b) => a.t - b.t);
  for (let i = 0; i < byStart.length; i++) {
    const a = byStart[i];
    for (let j = i + 1; j < byStart.length && byStart[j].t < a.t + a.dur; j++) {
      const b = byStart[j]; if (a.layer === b.layer) continue;
      const ov = Math.min(a.t + a.dur, b.t + b.dur) - Math.max(a.t, b.t); if (ov < 0.125) continue;
      const iv = Math.abs(a.midi - b.midi); if (iv % 12 !== 1 && iv % 12 !== 11) continue;
      const ch = chordAt(Math.max(a.t, b.t)).pcs;
      if (ch.has(pc(a.midi)) && ch.has(pc(b.midi))) continue; // both chord tones: a coloured chord (maj7, add9), not a clash
      if (a.chromatic || b.chromatic) continue;
      // only an exposed non-chord note counts: on a beat (at least a sixteenth), or held half a beat
      const nct = ch.has(pc(a.midi)) ? b : a, t0 = Math.max(a.t, b.t);
      if (!((onBeat(t0) && ov >= 0.25) || ov >= 0.5 || (onBeat(nct.t) && nct.dur >= 0.5))) continue;
      // it resolves: the same layer moves by step into a chord tone right after (appoggiatura,
      // passing or approach note)
      const nx = pitched.filter(m => m.layer === nct.layer && !m.dbl && m.t > nct.t + 1e-6).sort((p, q) => p.t - q.t)[0];
      if (nx && nx.t <= nct.t + nct.dur + 0.25 && Math.abs(nx.midi - nct.midi) <= 2 && chordAt(nx.t).pcs.has(pc(nx.midi)) && nct.dur <= 1 + 1e-9) continue;
      hit("clash", `NCT ${where(nct)} dur=${nct.dur.toFixed(2)} vs ${where(nct === a ? b : a)} dur=${(nct === a ? b : a).dur.toFixed(2)} (${iv} st, ov ${ov.toFixed(2)}) chord ${[...ch]}`); cnt["clash_" + nct.layer.replace(/\d+$/, "")] = (cnt["clash_" + nct.layer.replace(/\d+$/, "")] || 0) + 1;
    }
  }
  // notes outside the harmony's scale (the melody's scale can differ: pentatonic, or a mode)
  // the mode, the melody's own scale (pentatonic, or the blues scale) and the sounding chord
  // (blues: dominant sevenths outside the mode on purpose) are all in the key
  const modePcs = new Set([...sc.modeIv, ...(sc.melIv || [])].map(v => pc(v + sc.pcOff)));
  for (const n of pitched) if (!n.chromatic && !modePcs.has(pc(n.midi - shiftAt(n.t))) && !chordAt(n.t).pcs.has(pc(n.midi))) hit("outOfMode", where(n));
  // parallel fifths or octaves between the melody and the bass
  { const B = pitched.filter(n => n.layer === "bass").sort((a, b) => a.t - b.t), Ld = pitched.filter(n => n.layer === "lead" && !n.dbl);
    for (let i = 0; i + 1 < B.length; i++) { const b1 = B[i], b2 = B[i + 1]; if (b1.midi === b2.midi) continue; const l1 = Ld.find(n => n.t <= b1.t + 1e-6 && n.t + n.dur > b1.t + 1e-6), l2 = Ld.find(n => Math.abs(n.t - b2.t) < 1e-6); if (!l1 || !l2 || l1 === l2 || l1.midi === l2.midi) continue; const i1 = pc(l1.midi - b1.midi), i2 = pc(l2.midi - b2.midi); if (i1 === i2 && (i1 === 7 || i1 === 0) && Math.sign(l2.midi - l1.midi) === Math.sign(b2.midi - b1.midi)) hit("parallel", `${where(l2)} over ${where(b2)}`); } }
  // stale: an accompaniment note still sounding a quarter beat after a chord change into a chord
  // it does not belong to
  for (const n of pitched) {
    if (n.layer === "lead" || n.chromatic) continue;
    for (const S of sc.slots) if (S.t0 > n.t + 1e-6 && S.t0 < n.t + n.dur - 0.25 && !S.pcs.has(pc(n.midi))) { hit("stale", `${where(n)} dur=${n.dur.toFixed(2)} into chord at ${S.t0} ${[...S.pcs]}`); break; }
    if (sc.body > n.t + 1e-6 && sc.body < n.t + n.dur - 0.25 && tonic && !tonic.has(pc(n.midi))) hit("stale", `${where(n)} into the cadence`);
  }
  // non-chord tones
  const lead = pitched.filter(n => n.layer === "lead" && !n.dbl).sort((a, b) => a.t - b.t);
  for (const n of pitched) {
    const ch = chordAt(n.t).pcs, out = !ch.has(pc(n.midi));
    if (!out) continue;
    // pedal points: the tonic (or its fifth) held in the bass or a drone is idiomatic
    const tonicPc = pc(sc.pc + shiftAt(n.t));
    if ((n.layer === "bass" || /^x/.test(n.layer)) && (pc(n.midi) === tonicPc || pc(n.midi) === pc(tonicPc + 7)) && n.dur >= 2) continue;
    // an approach note: the bass (or a run) moving by step into the next note within a beat
    const nxt = pitched.find(m => m.layer === n.layer && m.t > n.t + 1e-6 && m.t <= n.t + 1.01);
    if (n.layer !== "lead" && nxt && Math.abs(nxt.midi - n.midi) <= 2 && chordAt(nxt.t).pcs.has(pc(nxt.midi)) && n.dur <= 1.01) continue;
    if (n.layer === "lead") {
      if (n.dbl) continue;
      // counts when it rubs (a semitone from a chord tone), or is long and does not resolve by step
      const rubsCh = ch.has(pc(n.midi + 1)) || ch.has(pc(n.midi - 1));
      const nx = lead.find(m => m.t > n.t + 1e-6), res = nx && nx.t <= n.t + n.dur + 0.25 && Math.abs(nx.midi - n.midi) <= 2 && chordAt(nx.t).pcs.has(pc(nx.midi));
      if (((onBeat(n.t) && n.dur >= 0.25) || n.dur >= 1) && (rubsCh || !res)) hit("melNCT", where(n));
    } else if (!n.chromatic && onBeat(n.t) && n.dur >= 0.5 && n.layer !== "pad") hit("accNCT", where(n));
    else if (n.layer === "pad" && onBeat(n.t) && n.dur >= 0.5) hit("padNCT", where(n));
  }
  for (let i = 0; i + 1 < lead.length; i++) {
    const n = lead[i], nx = lead[i + 1];
    if (!chordAt(n.t).pcs.has(pc(n.midi)) && n.dur >= 0.5 && Math.abs(nx.midi - n.midi) > 2) hit("unresolved", `${where(n)} → ${nx.midi}`);
    if (Math.abs(nx.midi - n.midi) > 12 && nx.t - (n.t + n.dur) < 0.5) hit("leap", `${where(n)} → ${nx.midi}`);
  }
  // bass on chord changes
  for (const S of sc.slots) {
    const b = pitched.find(n => n.layer === "bass" && Math.abs(n.t - S.t0) < 1e-6);
    if (!b) continue;
    if (pc(b.midi) === pc(sc.pc) && (S.bassKind === "pedal" || b.dur >= 2)) continue;
    const root = S.rootPc, fifth = pc(root + 7);
    if (pc(b.midi) !== root && !(pc(b.midi) === fifth && S.pcs.has(fifth)) && !b.chromatic) hit("bassRoot", `${where(b)} root pc ${root}`);
  }
  // crossings, sampled every half beat
  for (let t = 0; t < sc.total; t += 0.5) {
    const at = l => pitched.filter(n => n.layer === l && n.t <= t + 1e-9 && n.t + n.dur > t + 1e-9).map(n => n.midi);
    const L = at("lead"), Hh = at("harm"), Bb = at("bass");
    if (L.length && Hh.length && Math.max(...L) < Math.max(...Hh) - 2) hit("crossing", `t=${t} melody ${Math.max(...L)} under harmony top ${Math.max(...Hh)}`);
    if (L.length && Bb.length && Math.max(...Bb) > Math.min(...L)) hit("crossing", `t=${t} bass ${Math.max(...Bb)} over melody ${Math.min(...L)}`);
  }
  // restrikes in a layer
  const byLayer = {};
  for (const n of pitched) (byLayer[n.layer] = byLayer[n.layer] || []).push(n);
  for (const ns of Object.values(byLayer)) {
    ns.sort((a, b) => a.t - b.t);
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length && ns[j].t < ns[i].t + ns[i].dur - 0.05; j++) if (ns[j].midi === ns[i].midi && ns[j].t > ns[i].t + 1e-6) { hit("restrike", `${where(ns[j])} over ${ns[i].t.toFixed(2)}`); break; }
  }
  // drums on the grid (no groove here)
  for (const n of sc.notes) if (n.layer === "perc" && !n.roll && !STYLES[sc.style].swing && !STYLES[sc.style].swing16 && Math.abs(n.t * 4 - Math.round(n.t * 4)) > 1e-6 && !sc.groove) hit("offgrid", `perc t=${n.t.toFixed(3)} ${n.midi}`);
  // pile-ups, range, ending
  for (let b = 0; b < sc.total; b++) { const k = pitched.filter(n => n.t >= b - 1e-9 && n.t < b + 1 - 1e-9).length; if (k > 14) hit("pileup", `beat ${b}: ${k} notes`); }
  for (const n of pitched) if (n.midi < 24 || n.midi > 100) hit("range", where(n));
  if (tonic && !new Set(sc.cadence.chord.map(pc)).has(pc(sc.pc))) hit("ending", "cadence chord lacks the tonic");
  for (const n of sc.notes) if (n.t > sc.total + 1e-6) hit("ending", `${where(n)} after the end`);
  if (tonic) for (const n of sc.notes) if (n.layer === "lead" && !n.dbl && n.point === -2 && !tonic.has(pc(n.midi))) hit("ending", `${where(n)} is not a tone of the final chord`);
  const per = {}; for (const k of Object.keys(cnt)) per[k] = cnt[k] / minutes;
  return { per, cnt, ex, minutes };
}

// ---- run
const KEYS = ["clash", "stale", "outOfMode", "parallel", "accNCT", "padNCT", "melNCT", "unresolved", "bassRoot", "crossing", "restrike", "leap", "offgrid", "pileup", "range", "ending"];
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const rows = [], worst = [];
  for (const style of Object.keys(STYLES)) {
    if (ONLY && style !== ONLY) continue;
    const tot = Object.fromEntries(KEYS.map(k => [k, 0])); let mins = 0;
    for (const I of IMAGES) for (const C of CONFIGS) {
      const P = { ...BASE, ...C, style, ...(RULES_OFF ? { rules: RULES_OFF } : {}) }, sc = run(I, P), r = auditScore(sc);
      mins += r.minutes; for (const k of KEYS) tot[k] += r.cnt[k] || 0;
      worst.push({ label: `${style} ${I.name} ${C.duration}s ${C.orch} ${C.connect}`, r });
    }
    rows.push([style, ...KEYS.map(k => (tot[k] / mins).toFixed(1))]);
  }
  const w = [12, ...KEYS.map(k => Math.max(6, k.length + 1))];
  console.log(["style", ...KEYS].map((s, i) => String(s).padEnd(w[i])).join(""));
  for (const r of rows) console.log(r.map((s, i) => String(s).padEnd(w[i])).join(""));
  console.log("(per minute of music, over", IMAGES.length * CONFIGS.length, "pieces per style)");
  if (EXAMPLES) for (const k of KEYS) {
    const top = worst.filter(x => x.r.ex[k]).sort((a, b) => (b.r.per[k] || 0) - (a.r.per[k] || 0)).slice(0, 2);
    if (!top.length) continue;
    console.log(`\n== ${k}`);
    for (const x of top) console.log(`  ${x.label}: ${x.r.cnt[k]}\n    ` + x.r.ex[k].join("\n    "));
  }
}
