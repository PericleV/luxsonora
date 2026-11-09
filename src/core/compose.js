// Composition: melody, harmony, bass, rhythm and pad over a fixed duration with a final cadence.
import { clamp, clampInt, lerp } from "./util.js";
import { MODES, STYLES, RULES, degMidi, objectAt } from "./theory.js";
import { imageStats, pointTimbre, modulation, zoneFeatures, modulate, LAYER_DEPTH, ZERO_M, avgRegion } from "./timbre.js";
import { planTime } from "./duration.js";
import { surroundZone } from "./focus.js";
import { pathProfile, passage } from "./passages.js";
import { expertLayers, applyExpertChords, applyExpertNotes } from "./expert.js";
import { ruleOn, planModulation, applyPivots, transposeWindow, phraseCadences, contrastOf, leapRecovery, noParallels, melodyPeak, picardy } from "./rules.js";
import { dramaticArc, dynamics } from "./arc.js";
import { rhythmPart, areaDrive, DRUM_NAME } from "./rhythm.js";
import { pickKind, harmonyNotes, bassNotes } from "./patterns.js";
import { resolveInstruments, textureWave, LIBRARY } from "./instruments.js";
import { autoLayers, richnessOf, extraNotes, doubleNotes, cadenceExtra, roleInstrument, ROLES } from "./arrange.js";
import { hashBytes } from "./util.js";

export const SCORE_VERSION = 2;

// Splits a focus point's duration between the motif notes, on a sixteenth-note grid.
function gridSplit(dur, w) {
  const tot = w.reduce((a, b) => a + b, 0), n = w.length, b = [0];
  let cum = 0;
  for (let j = 0; j < n - 1; j++) { cum += w[j]; b.push(Math.round(((dur * cum) / tot) * 4) / 4); }
  b.push(dur);
  for (let j = 1; j < n; j++) b[j] = Math.max(b[j], b[j - 1] + 0.25);
  for (let j = n - 1; j >= 1; j--) b[j] = Math.min(b[j], b[j + 1] - 0.25);
  return b;
}

// lum: optional luminance image { w, h, data } for texture wavetables (defaults to the analysed image)
export function compose({ A, sal, points, cl, motifs, P, sem, cov = null, lum = null }) {
  const st = STYLES[P.style], g = A.global, ws = sem ? P.wSem : 0;
  // Advanced: composition can make the chords change faster or slower than the style's grid
  const R0 = RULES[P.style] || RULES.ambient, cr = P.chordRate ?? 1;
  const R = cr === 1 || !R0.unit ? R0 : { ...R0, unit: Math.max(1, Math.min(16, Math.round(R0.unit * cr))) };
  let val = 0.5 * g.brightness + 0.3 * g.warmth01 + 0.2 * g.sat;
  let energy = 0.6 * g.edgeN + 0.4 * g.entropy;
  if (sem && sem.valence != null) { val = lerp(val, clamp(sem.valence), 0.6 * ws); energy = lerp(energy, clamp(sem.energy), 0.6 * ws); }
  const allowed = [...st.modes].sort((a, b) => MODES[a].b - MODES[b].b);
  // key and scale: automatic from the image, or chosen by hand
  const scale = P.scale && P.scale !== "auto" ? P.scale : null;
  const autoMode = allowed[Math.round(clamp(val) * (allowed.length - 1))];
  const modeKey = scale ? (MODES[scale] ? scale : scale === "majpent" ? "ionian" : "aeolian") : autoMode, modeIv = MODES[modeKey].iv;
  const autoPc = g.hueStr > 0.06 ? ((Math.round(g.hue / 30) % 12) * 7) % 12 : (Math.round(g.brightness * 11) * 7) % 12;
  const pc = P.keyMode === "manual" ? ((P.keyPc % 12) + 12) % 12 : autoPc;
  const pcOff = pc > 5 ? pc - 12 : pc;
  const smooth = clamp(P.smooth ?? 0), range = P.range ?? 2, octave = P.octave ?? 0;
  const bpmStyle = lerp(st.tempo[0], st.tempo[1], clamp(energy)) * (1 + P.tempoAdj);
  // weight w (editable; defaults to the saliency at the point) sets the share of time
  const weightOf = f => (f.w ?? f.s);
  const plan = planTime(P.duration, bpmStyle, points.map(f => 1 + 3 * weightOf(f)), R.grid ?? 1);
  const bpm = plan.bpm, spb = 60 / bpm;
  const used = points.slice(0, plan.count);
  const major = modeIv[2] === 4;
  const pent = scale ? (scale === "majpent" || scale === "minpent") : st.pent;
  const melIv = pent ? (major ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10]) : !scale && st.melScale ? st.melScale : modeIv, n = melIv.length;
  const baseLead = 60 + pcOff + 12 * octave, stats = imageStats(A), maxE = stats.maxE;
  const inst = resolveInstruments(P.style, P.instruments, P.melody, P.samples === true);
  const texImg = lum || { w: A.W, h: A.H, data: A.L };
  const usesWave = ["lead", "harm", "bass", "pad"].some(l => inst[l].type === "wave");
  const makeWave = (x, y, r, ori) => { const wv = textureWave(texImg, x, y, r, ori); wv.key = hashBytes(new Uint8Array(wv.imag.buffer)) + hashBytes(new Uint8Array(wv.real.buffer)); return wv; };
  const withWave = (tim, wave) => { if (wave) for (const l of ["lead", "harm", "bass"]) if (tim[l].type === "wave") tim[l] = { ...tim[l], wave }; return tim; };
  const waves = [];
  const notes = [], out = [], visits = new Map();
  let t = 0, prevDeg = null, prevChord = null, lastLead = null, prevVel = null, prevTim = null, prevPan = 0, prevReg = null;
  // Smooth transitions (0 = off): limit of the melodic leap into a new point, maximum
  // velocity change, and the glide time of timbre and pan at the start of a point.
  const leapLimit = smooth > 0 ? Math.round(12 - 7 * smooth) : Infinity;
  const velStep = lerp(68, 12, smooth), glideSec = smooth * spb;
  const regLo = baseLead - 12, regHi = baseLead + 12 * range; // melody register used by the leap limit
  // dramatic arc over the segments (see arc.js); amount 0 gives every segment the same tension
  const arcAmount = clamp(P.arc ?? 0.7), arcOn = arcAmount > 0.25;
  const arc = dramaticArc(used.map((f, i) => {
    const t0 = plan.dur.slice(0, i).reduce((a, b) => a + b, 0);
    return { t0, t1: t0 + plan.dur[i], x: f.x, y: f.y, w: weightOf(f), revisit: f.revisitOf !== null && f.revisitOf !== undefined, mood: f.mood };
  }), plan.body, arcAmount);

  used.forEach((f, idx) => {
    // the area read by the point: its Gaussian footprint when available, else its region
    const r = f.zone || A.regions[f.region], ci = f.family ?? cl.assign[f.region], dur = plan.dur[idx];
    const target = Math.round((1 - f.y) * range * n) - Math.round(n * 0.2 * range);
    let deg, step = 0;
    if (prevDeg === null) deg = target;
    else {
      const pf = used[idx - 1], dx = f.x - pf.x, dy = f.y - pf.y, len = Math.hypot(dx, dy);
      const dir = Math.abs(dy) > 0.02 ? -Math.sign(dy) : dx >= 0 ? 1 : -1;
      step = dir * Math.max(1, Math.round(len * n * 1.4));
      deg = Math.round(lerp(prevDeg + step, target, P.fidelity));
    }
    deg = clampInt(deg, -n, range * n + 1);

    const v = (visits.get(ci) ?? -1) + 1; visits.set(ci, v);
    const mo = motifs[ci]; let iv = mo.iv.slice(), w = mo.w.slice(), variant = "original";
    if (v > 0) {
      const vv = (v - 1) % 3;
      if (vv === 0) variant = "repeated";
      else if (vv === 1) { variant = "inverted"; iv = iv.map(x => -x); }
      else { variant = "retrograde"; const rv = iv.slice().reverse(); iv = rv.map(x => x - rv[0]); w = w.slice().reverse(); }
    }
    const maxNotes = Math.max(1, Math.floor(dur / 0.25));
    if (iv.length > maxNotes) { iv = iv.slice(0, maxNotes); w = w.slice(0, maxNotes); }
    const obj = sem ? objectAt(sem, f.x, f.y) : null;
    const wave = usesWave ? makeWave(f.x, f.y, f.r ?? 0.07, r.ori) : null;
    if (wave) waves.push(wave);
    const tim = withWave(pointTimbre(r, inst, stats, obj, ws, P.timbre), wave);
    let vel = Math.round(52 + 68 * weightOf(f));
    if (prevVel !== null) vel = Math.round(prevVel + clamp(vel - prevVel, -velStep, velStep));
    // stereo from the horizontal position, kept within ±0.5 so the melody moves rather than jumps
    const pan = clamp((f.x - 0.5) * 0.9, -0.5, 0.5);
    // leap limit: move the motif by whole octaves of the scale toward the previous note,
    // but only inside the melody register, so repeated folding cannot drift off the range
    let leapShift = 0;
    if (lastLead !== null && isFinite(leapLimit) && ruleOn(P, "leapLimit")) {
      let m0 = degMidi(deg + iv[0], melIv, baseLead);
      for (let k = 0; k < 4 && Math.abs(m0 - lastLead) > leapLimit; k++) {
        const s1 = m0 > lastLead ? -n : n, m1 = degMidi(deg + s1 + iv[0], melIv, baseLead);
        if (Math.abs(m1 - lastLead) >= Math.abs(m0 - lastLead) || m1 < regLo || m1 > regHi) break;
        deg += s1; leapShift += s1; m0 = m1;
      }
    }
    // glide: notes that start a point move their filter and pan from the previous point's values
    const D = arc.tension[idx] ?? 0.6, section = arc.section[idx] ?? "development", dyn = dynamics(D);
    const glide = (layer, j) => (glideSec > 0 && prevTim && j === 0 ? { cut0: prevTim[layer].cut, q0: prevTim[layer].q, pan0: layer === "lead" ? prevPan : layer === "harm" ? prevPan * 0.4 : 0, sec: glideSec } : null);
    const bounds = gridSplit(dur, w), lead = [];
    iv.forEach((o, j) => {
      const m = degMidi(deg + o, melIv, baseLead), nd = bounds[j + 1] - bounds[j];
      notes.push({ layer: "lead", t: t + bounds[j], dur: nd * 0.92, midi: m, vel: clampInt(Math.round((j === 0 ? vel : vel * 0.85) * dyn), 1, 127), tim: tim.lead, pan, point: idx, glide: glide("lead", j) });
      lead.push(m);
    });
    lastLead = lead[lead.length - 1];

    // harmony
    const firstPc = (((lead[0] - baseLead) % 12) + 12) % 12, mdeg = modeIv.indexOf(firstPc);
    const cands = r.L > 0.5 ? R.cands[0] : R.cands[1];
    const tones = [0, 2, 4];
    if (st.ext >= 7 || r.entropy > 0.78) tones.push(6);
    if (st.ext >= 9 || r.entropy > 0.9) tones.push(8);
    const fits = cands.filter(rt => mdeg >= 0 && [0, 2, 4].includes((((mdeg - rt) % 7) + 7) % 7));
    let root;
    if (smooth > 0 && prevChord) {
      // minimal voice leading: among the candidates (those holding the melody note when
      // possible) take the chord sharing the most pitch classes with the previous one
      const prevPcs = new Set(prevChord.map(m => ((m % 12) + 12) % 12)), pool = fits.length ? fits : cands;
      const common = rt => tones.reduce((c, o) => c + (prevPcs.has(((degMidi(rt + o, modeIv, 0) % 12) + 12) % 12) ? 1 : 0), 0);
      // contrast rule: a place very unlike the previous one takes the candidate sharing the fewest
      // notes with the previous chord (a further move), a similar place the most (a smooth one)
      const far = ruleOn(P, "contrast") && prevReg && contrastOf(r, prevReg) > (P.contrastThr ?? 0.45);
      root = ruleOn(P, "voiceLeading") || far ? pool.reduce((best, rt) => (far ? common(rt) < common(best) : common(rt) > common(best)) ? rt : best, pool[0]) : pool[0];
    } else root = fits.length ? fits[0] : cands[ci % 3];
    prevReg = r;
    const center = prevChord ? prevChord.reduce((a, b) => a + b, 0) / prevChord.length : 60;
    let chord = tones.map(o => { let m = degMidi(root + o, modeIv, 48 + pcOff); while (m < center - 7) m += 12; while (m > center + 7) m -= 12; return m; });
    chord = [...new Set(chord)].sort((a, b) => a - b); prevChord = chord;
    let bm = degMidi(root, modeIv, 36 + pcOff); while (bm < 33) bm += 12; while (bm > 47) bm -= 12;

    const share = dur / plan.total;
    out.push({ ...f, idx, t0: t, t1: t + dur, dur, sec: dur * spb, share, weight: plan.weights[idx], deg, step, leapShift, cluster: ci, letter: mo.letter, visit: v, variant, root, chord, bass: bm, lead, tim, pan, obj, regionSal: sal.region[r.id ?? f.region], reg: r, vel, dyn, tension: D, section, tones, glides: { harm: glide("harm", 0), bass: glide("bass", 0) } });
    prevDeg = deg; prevVel = vel; prevTim = tim; prevPan = pan; t += dur;
  });

  // ---- the accompaniment lives on the style's harmonic grid (genre rules, theory.js RULES) ----
  // Chords change only on the grid (RULES.unit beats; slow styles halve it above tension 0.8),
  // each slot takes the chord of the focus point covering most of it, and equal neighbours merge.
  const pointAt = tt => out.find(F => tt >= F.t0 - 1e-9 && tt < F.t1 - 1e-9) || out[out.length - 1];
  const slots = [];
  for (let s0 = 0; out.length && s0 < plan.body - 1e-9;) {
    const unit = R.unit >= 8 && pointAt(s0 + 0.01).tension > 0.8 ? 4 : R.unit, s1 = Math.min(plan.body, s0 + unit);
    let best = null, bo = -1;
    for (const F of out) { const o = Math.min(F.t1, s1) - Math.max(F.t0, s0); if (o > bo + 1e-9) { bo = o; best = F; } }
    const last = slots[slots.length - 1];
    if (last && last.F === best && !R.loop) last.t1 = s1; else slots.push({ t0: s0, t1: s1, F: best });
    s0 = s1;
  }
  // composition rules on the chord grid: question-and-answer phrases, then the modulation's pivots
  if (ruleOn(P, "cadences") && !R.loop && (R.unit ?? 4) <= 4) phraseCadences(slots, modeIv, plan.body);
  const mod = ruleOn(P, "modulate") && arcOn && !R.quality ? planModulation(out, arc, g, slots, R) : null;
  if (mod) applyPivots(slots, mod, modeIv, melIv);
  // classical: the chord before the final cadence is the dominant, so the piece ends V-I
  if (R.cadentialV && ruleOn(P, "cadentialV") && slots.length > 1) { const S = slots[slots.length - 1]; S.F = { ...S.F, root: 4, tones: S.F.tones }; }
  // pop: the four-chord loop, one chord per bar, whatever the points (they still shape everything else)
  if (R.loop) { const seq = modeIv[2] === 3 ? R.loop.minor : R.loop.major; slots.forEach((S, k) => { S.F = { ...S.F, root: seq[k % seq.length] }; }); }
  // Expert rules: a chord asked for at some places wins over the style's choice (it is a degree of the key)
  if (P.expert && P.expert.length) applyExpertChords(P.expert, slots, out, spb);
  // voicing: each slot's chord moves to the octave closest to the previous chord's centre
  let vPrev = null;
  for (const S of slots) {
    const centre = vPrev ? vPrev.reduce((a, b) => a + b, 0) / vPrev.length : 60;
    S.root = S.F.root; S.tones = S.F.tones;
    // blues: every chord is a dominant seventh on its root (I7, IV7, V7), outside the mode on purpose
    const pitches = R.quality === "dom7" ? [0, 4, 7, 10].map(sm => degMidi(S.root, modeIv, 48 + pcOff) + sm) : S.tones.map(o => degMidi(S.root + o, modeIv, 48 + pcOff));
    S.chord = [...new Set(pitches.map(m0 => { let m = m0; while (m < centre - 7) m += 12; while (m > centre + 7) m -= 12; return m; }))].sort((a, b) => a - b);
    S.pcs = new Set(S.chord.map(m => ((m % 12) + 12) % 12));
    vPrev = S.chord;
  }
  prevChord = vPrev || prevChord;
  const slotAt = tt => slots.find(S => tt >= S.t0 - 1e-9 && tt < S.t1 - 1e-9) || slots[slots.length - 1];

  // melody on the grid: a note on a beat (or a long note) that is not in the slot's chord moves
  // to the nearest chord tone (within a minor third); so does an "avoid note", a non-chord note
  // a semitone from a chord tone held half a beat or more (it rubs against the chord), which may
  // instead become a tension (a scale tone a whole step from the chord, like a ninth or a sixth)
  const scalePcs = new Set(melIv.map(iv => (((iv + pcOff) % 12) + 12) % 12));
  const pcOf = m => ((m % 12) + 12) % 12;
  const rubs = (p, S) => S.pcs.has(pcOf(p + 1)) || S.pcs.has(pcOf(p - 1));
  // inside a modulation (once the notes are moved there) the melody's scale moves with the key
  let keyMoved = false;
  const shiftAt = tt => (keyMoved && mod && tt >= mod.t0 - 1e-9 && tt < mod.t1 - 1e-9 ? mod.shift : 0);
  const inScale = (m, tt) => scalePcs.has(pcOf(m - shiftAt(tt)));
  // a non-chord note that moves by step into a chord tone right after it is an appoggiatura or a
  // passing note: it resolves, so it stays
  const resolves = nn => {
    let nx = null;
    for (const m of notes) if (m.layer === "lead" && !m.dbl && m.t > nn.t + 1e-6 && (!nx || m.t < nx.t)) nx = m;
    if (!(nx && nx.t <= nn.t + nn.dur + 0.25 && Math.abs(nx.midi - nn.midi) <= 2 && slotAt(nx.t).pcs.has(pcOf(nx.midi)) && nn.dur <= 1 + 1e-9)) return false;
    // longer than half a beat, it must not sit a semitone from the chord's root (a minor ninth)
    const S = slotAt(nn.t), r = pcOf(modeIv[((S.root % modeIv.length) + modeIv.length) % modeIv.length] + pcOff), p = pcOf(nn.midi);
    return nn.dur <= 0.5 + 1e-9 || (pcOf(p - r) !== 1 && pcOf(r - p) !== 1);
  };
  const lastOfPassage = nn => { let last = nn; for (const m of notes) if (m.layer === "lead" && m.passage && nn.passage && m.passage.from === nn.passage.from && m.t > last.t) last = m; return last; };
  const snapLead = list => {
    if (!ruleOn(P, "chordTones")) return;
    for (const nn of list) {
      if (nn.layer !== "lead" || nn.point < 0 || nn.dbl || !slots.length) continue;
      const S = slotAt(nn.t), p = pcOf(nn.midi);
      if (S.pcs.has(p)) continue;
      const strong = Math.abs(nn.t - Math.round(nn.t)) < 1e-6 || nn.dur >= 0.9, avoid = nn.dur >= 0.5 - 1e-9 && rubs(p, S);
      if (!strong && !avoid) continue;
      if (!strong && resolves(nn)) continue;
      let to = null;
      for (const d of [-1, 1, -2, 2, -3, 3]) { const m = nn.midi + d; if (inScale(m, nn.t) && S.pcs.has(pcOf(m))) { to = m; break; } }
      // no chord tone in the scale nearby (a pentatonic tune over a chord with a note it lacks):
      // a note that rubs becomes a tension instead, even on the beat
      if (to === null && (!strong || avoid)) for (const d of [-1, 1, -2, 2]) { const m = nn.midi + d; if (inScale(m, nn.t) && !rubs(pcOf(m), S)) { to = m; break; } }
      if (to !== null) { nn.midi = to; nn.snapped = true; }
    }
  };
  snapLead(notes);
  // connections (passages.js): the path between two points becomes a passage into the next point
  const connect = P.connect ?? "off";
  if (connect !== "off") {
    for (let i = 0; i + 1 < out.length; i++) {
      const F = out[i], win = Math.min(connect === "rich" ? 2 : 1, F.dur - 0.5);
      if (win < 0.5) continue;
      const t1 = F.t1, t0 = t1 - win;
      const mine = notes.filter(nn => nn.layer === "lead" && nn.point === i), nxt = notes.filter(nn => nn.layer === "lead" && nn.point === i + 1);
      const before = mine.filter(nn => nn.t < t0 - 1e-9);
      if (!before.length || !nxt.length) continue;
      const L = before.reduce((a, b) => (b.t > a.t ? b : a)), N = nxt.reduce((a, b) => (b.t < a.t ? b : a));
      const prof = pathProfile(A, F, out[i + 1]);
      const ps = passage(L.midi, N.midi, t0, t1, prof, connect, P.style, scalePcs, tt => slotAt(tt).pcs);
      if (!ps.length) continue;
      // the passage replaces the end of the point: its later notes give way
      for (let k = notes.length - 1; k >= 0; k--) if (notes[k].layer === "lead" && notes[k].point === i && notes[k] !== L && notes[k].t >= ps[0].t - 1e-9) notes.splice(k, 1);
      L.dur = Math.max(0.2, (ps[0].t - L.t) * 0.97);
      const added = ps.map(x => ({ ...L, t: x.t, dur: x.dur, midi: x.midi, vel: Math.round(L.vel * (0.72 + 0.2 * x.f)), glide: null, passage: { from: i, to: i + 1, f: x.f }, ...(x.chromatic ? { chromatic: true } : {}) }));
      snapLead(added.slice(0, -1));
      notes.push(...added);
      F.passage = { notes: ps.length, crossings: prof.crossings.length, regions: prof.regions, len: prof.len, at: ps.map(x => x.f) };
    }
  } else if (R.pickups && ruleOn(P, "pickups") && smooth > 0) {
    // pickups: a passing note on the last eighth of a point leads into the next point's first note
    const scaleNear = (m, dir) => { let x = m + dir; while (!scalePcs.has(pcOf(x))) x += dir; return x; };
    for (let i = 0; i + 1 < out.length; i++) {
      const mine = notes.filter(nn => nn.layer === "lead" && nn.point === i), nxt = notes.filter(nn => nn.layer === "lead" && nn.point === i + 1);
      if (!mine.length || !nxt.length) continue;
      const L = mine.reduce((a, b) => (b.t > a.t ? b : a)), N = nxt.reduce((a, b) => (b.t < a.t ? b : a));
      if (L.dur < 0.9 || Math.abs(N.midi - L.midi) < 3) continue;
      const tp = out[i].t1 - 0.5; L.dur = Math.max(0.2, (tp - L.t) * 0.95);
      notes.push({ ...L, t: tp, dur: 0.45, midi: scaleNear(N.midi, N.midi > L.midi ? -1 : 1), vel: Math.round(L.vel * 0.8), glide: null, pickup: true });
    }
  }
  for (const F of out) F.lead = notes.filter(nn => nn.layer === "lead" && nn.point === F.idx).sort((a, b) => a.t - b.t).map(nn => nn.midi);

  // harmony and bass per slot: the articulation follows the style's list, the arc and the area
  let tonicBm = degMidi(0, modeIv, 36 + pcOff); while (tonicBm < 33) tonicBm += 12; while (tonicBm > 47) tonicBm -= 12;
  const bmOf = rt => { let m = degMidi(rt, modeIv, 36 + pcOff); while (m < 33) m += 12; while (m > 47) m -= 12; return m; };
  slots.forEach((S, k) => {
    const F = S.F, D = F.tension, sec = F.section, dyn = dynamics(D), ad = areaDrive(F), next = slots[k + 1];
    S.harmKind = pickKind(R.harm, D, ad.tex, sec, arcOn);
    let bKind = pickKind(R.bass, D, ad.tex, sec, arcOn);
    // the bass enters after the introduction (drone-based styles keep a pedal; epic keeps its pulse)
    if (arcOn && sec === "intro" && bKind !== "pedal" && P.style !== "epic") bKind = "rest";
    S.bassKind = bKind;
    const hn = harmonyNotes(S.harmKind, S.chord, S.t0, S.t1 - S.t0, D, ad, { vel: Math.round((40 + 30 * F.reg.entropy) * dyn), tim: F.tim.harm, pan: F.pan * 0.4, glide: F.glides.harm, rootPc: (((degMidi(S.root, modeIv, pcOff)) % 12) + 12) % 12 });
    const bn = bassNotes(bKind, S.root, modeIv, pcOff, bmOf(S.root), S.t0, S.t1 - S.t0, ad, { tim: F.tim.bass, glide: F.glides.bass }, { tonic: tonicBm, nextBm: next ? bmOf(next.root) : null, nextRoot: next ? next.root : null, approach: R.approach && ruleOn(P, "approach") });
    for (const nn of hn) notes.push({ ...nn, point: pointAt(nn.t).idx });
    for (const nn of bn) notes.push({ ...nn, point: pointAt(nn.t).idx, vel: clampInt(Math.round(nn.vel * dyn), 1, 127) });
  });
  for (const F of out) { const S = slotAt(F.t0); F.harmKind = S ? S.harmKind : "block"; F.bassKind = S ? S.bassKind : "hold"; }

  // rhythm: the style's kit in phrases, density and fills from the arc (rhythm.js)
  if (out.length) {
    const perc = rhythmPart(P.style, out, arc, plan.body, arcAmount, R, tonicBm < 38 ? tonicBm + 12 : tonicBm);
    notes.push(...perc);
    for (const F of out) {
      const mine = perc.filter(nn => nn.point === F.idx);
      F.hits = mine.length; F.drums = [...new Set(mine.map(nn => DRUM_NAME[nn.midi]))];
    }
  }
  const swK = P.swingAdj ?? 1;
  if (st.swing > 0 && swK > 0) for (const nn of notes) if ((nn.layer === "lead" || nn.layer === "perc") && Math.abs((nn.t % 1) - 0.5) < 1e-6) nn.t += Math.min(0.24, st.swing * 0.17 * swK);
  // sixteenth swing (lo-fi): the off sixteenths come late, behind the beat
  if (st.swing16 > 0 && swK > 0) for (const nn of notes) if ((nn.layer === "lead" || nn.layer === "perc") && Math.abs((nn.t % 0.5) - 0.25) < 1e-6) nn.t += Math.min(0.12, st.swing16 * 0.09 * swK);

  // ---- orchestration: extra layers (arrange.js); Small adds none ----
  const places = new Set(used.map(f => f.revisitOf ?? f.index)).size;
  // the orchestration's layers, and the instruments the Expert rules add (they play only at their places)
  const extra = [...(P.orch === "custom" ? (P.layers || []).filter(L => ROLES[L.role]) : autoLayers(P.style, P.orch || "small", richnessOf(A, places), P.samples === true)), ...expertLayers(P.expert).filter(L => ROLES[L.role])];
  for (const L of extra) {
    const base = (L.preset && LIBRARY[L.preset]) || LIBRARY[roleInstrument(P.style, L.role, P.samples === true)] || LIBRARY["x.softlead"];
    inst[L.id] = { ...base, ...(L.edits || {}) };
    for (const F of out) { F.timX = F.timX || {}; F.timX[L.id] = modulate(inst[L.id], F.tim.m, LAYER_DEPTH.harm, P.timbre); }
  }
  if (extra.length) {
    const xs = extraNotes({ layers: extra, A, sal, cov, points: out, slots, body: plan.body, baseLead, inst, modeIv, pcOff, style: P.style, buildUp: P.buildUp ?? 0.5, modePcs: new Set(modeIv.map(v => (((v + pcOff) % 12) + 12) % 12)), leadNotes: notes.filter(nn => nn.layer === "lead" && nn.point >= 0 && !nn.dbl) });
    for (const nn of xs) { const F = out[nn.point]; if (F && F.timX) nn.tim = F.timX[nn.layer]; notes.push(nn); }
  }

  // cadence: tonic chord on the last bar; every note dies out before T
  const tc = plan.body, cadBeats = plan.total - plan.body;
  const holdFor = tim => Math.max(1, cadBeats - (tim.r * 1.6) / spb);
  const homeWave = usesWave ? (waves[0] || makeWave(0.5, 0.5, 0.25, [1, 1, 1, 1])) : null;
  const cadTim = withWave({
    lead: modulate(inst.lead, ZERO_M, LAYER_DEPTH.lead, 0),
    harm: modulate(inst.harm, ZERO_M, LAYER_DEPTH.harm, 0),
    bass: modulate(inst.bass, ZERO_M, LAYER_DEPTH.bass, 0)
  }, homeWave);
  const cadTones = st.ext >= 7 ? [0, 2, 4, 6] : [0, 2, 4];
  const cCenter = prevChord ? prevChord.reduce((a, b) => a + b, 0) / prevChord.length : 60;
  const cadChord = [...new Set(cadTones.map(o => { let m = degMidi(o, modeIv, 48 + pcOff); while (m < cCenter - 7) m += 12; while (m > cCenter + 7) m -= 12; return m; }))].sort((a, b) => a - b);
  const leadDeg = prevDeg === null ? 0 : Math.round(prevDeg / n) * n;
  let cadLead = degMidi(leadDeg, melIv, baseLead);
  if (lastLead !== null) { while (cadLead - lastLead > 6) cadLead -= 12; while (lastLead - cadLead > 6) cadLead += 12; }
  let cadBass = degMidi(0, modeIv, 36 + pcOff); while (cadBass < 33) cadBass += 12; while (cadBass > 47) cadBass -= 12;
  notes.push({ layer: "lead", t: tc, dur: holdFor(cadTim.lead), midi: cadLead, vel: 76, tim: cadTim.lead, pan: 0, point: -2 });
  cadChord.forEach(m => notes.push({ layer: "harm", t: tc, dur: holdFor(cadTim.harm), midi: m, vel: 54, tim: cadTim.harm, pan: 0, point: -2 }));
  notes.push({ layer: "bass", t: tc, dur: holdFor(cadTim.bass), midi: cadBass, vel: 82, tim: cadTim.bass, pan: 0, point: -2 });
  notes.push(...cadenceExtra(extra, cadChord, baseLead, tc, holdFor, Object.fromEntries(extra.map(L => [L.id, modulate(inst[L.id], ZERO_M, LAYER_DEPTH.harm, 0)]))));

  // background pad: two-bar blocks in the body, then the tonic on the cadence
  // with focus point footprints the background is what was not looked at (1 − coverage);
  // otherwise it is the set of regions with low saliency
  let bgArea, bgZone;
  if (cov) { bgArea = cov.background; bgZone = cov.zone; }
  else { const bgList = A.regions.filter((r, i) => sal.region[i] < 0.35); bgArea = bgList.reduce((a, r) => a + r.area, 0); bgZone = avgRegion(bgList.length ? bgList : A.regions); }
  const padM = modulation(zoneFeatures(bgZone, maxE), stats, null, 0);
  let ptim = modulate(inst.pad, padM, LAYER_DEPTH.pad, P.timbre);
  // a wavetable pad reads a wide profile through the image centre, across the background's dominant orientation
  if (ptim.type === "wave") ptim = { ...ptim, wave: makeWave(0.5, 0.5, 0.3, bgZone.ori || [1, 1, 1, 1]) };
  // a style can keep the pad lower (rock and metal: a held pad under distorted guitars drones)
  const padK = R.padLevel ?? 1;
  const padVel = Math.round((30 + 50 * clamp(bgArea * 1.4)) * padK);
  if (cov && out.length) {
    // The pad follows the harmony: three voices move to the chord of each focus point by the
    // smallest total motion, and a voice whose note stays the same is held across the
    // boundary instead of restruck (its filter glides to the new timbre). Each new note takes
    // the timbre of the background around the current point (surroundZone).
    const triad = rt => (R.quality === "dom7" ? [0, 4, 7].map(sm => (((48 + pcOff + degMidi(rt, modeIv, 0) + sm) % 12) + 12) % 12) : [0, 2, 4].map(o => (((48 + pcOff + degMidi(rt + o, modeIv, 0)) % 12) + 12) % 12));
    const local = new Map(), voices = [null, null, null];
    const localPad = F => {
      const key = F.x.toFixed(5) + "," + F.y.toFixed(5) + "," + (F.r ?? 0);
      if (!local.has(key)) {
        const sz = surroundZone(A, cov, F.x, F.y, F.r ?? 0.07), m = modulation(zoneFeatures(sz.zone, maxE), stats, null, 0);
        let tim = modulate(inst.pad, m, LAYER_DEPTH.pad, P.timbre);
        if (tim.type === "wave") tim = { ...tim, wave: ptim.wave };
        local.set(key, { tim, m, vel: Math.round((30 + 50 * clamp(lerp(bgArea, sz.amount, 0.5) * 1.4)) * padK) });
      }
      return local.get(key);
    };
    const close = (v, end) => notes.push({ layer: "pad", t: v.t, dur: end - v.t, midi: v.midi, vel: v.vel, tim: v.tim, pan: 0, point: -1, seg: v.seg, sweep: v.sweep.length ? v.sweep : null });
    const moveTo = (pcs, t, lp, seg) => {
      const target = padVoicing(pcs, voices.every(Boolean) ? voices.map(v => v.midi) : null);
      target.forEach((m, k) => {
        const v = voices[k];
        if (v && v.midi === m) v.sweep.push({ at: t - v.t, cut: lp.tim.cut, q: lp.tim.q });
        else { if (v) close(v, t); voices[k] = { midi: m, t, tim: lp.tim, vel: lp.vel, seg, sweep: [] }; }
      });
    };
    for (const S of slots) {
      // the pad moves with the harmonic grid; tension opens its filter (up to +0.32 octave at
      // the climax) and sets its dynamics
      const F = S.F, lp0 = localPad(F), lp = { ...lp0, tim: { ...lp0.tim, cut: Math.min(16000, lp0.tim.cut * 2 ** (0.8 * (F.tension - 0.6))) }, vel: clampInt(Math.round(lp0.vel * dynamics(F.tension)), 1, 127) };
      moveTo(triad(S.root), S.t0, lp, F.idx);
    }
    for (const F of out) { const lp0 = localPad(F); F.padTim = { ...lp0.tim, cut: Math.min(16000, lp0.tim.cut * 2 ** (0.8 * (F.tension - 0.6))) }; F.padM = lp0.m; }
    moveTo(triad(0), tc, { tim: ptim, vel: padVel }, -2);
    for (const v of voices) close(v, tc + holdFor(v.tim));
  } else {
    // without coverage: tonic and fifth (plus the ninth on bright images) in two-bar blocks
    const padDegs = g.brightness > 0.5 ? [0, 4, 8] : [0, 4];
    for (let b = 0; b < plan.body - 1e-6; b += 8) {
      const dd = Math.min(8, plan.body - b);
      padDegs.forEach(o => notes.push({ layer: "pad", t: b, dur: dd, midi: degMidi(o, modeIv, 48 + pcOff), vel: padVel, tim: ptim, pan: 0, point: -1 }));
    }
    padDegs.forEach(o => notes.push({ layer: "pad", t: tc, dur: holdFor(ptim), midi: degMidi(o, modeIv, 48 + pcOff), vel: padVel, tim: ptim, pan: 0, point: -1 }));
  }

  // the modulation: everything under the climax moves into the new key
  if (mod) {
    transposeWindow(notes, slots, mod, scalePcs); keyMoved = true;
    const keyPc = (((pc + (mod.dir > 0 ? 7 : 5)) % 12) + 12) % 12;
    for (const F of out) if (F.t0 >= mod.t0 - 1e-9 && F.t0 < mod.t1 - 1e-9) F.modulation = { dir: mod.dir, keyPc };
    mod.keyPc = keyPc;
  }
  // melody rules: leaps turn back, no parallel fifths or octaves with the bass, the peak at the climax
  const ruleCtx = { slotAt, inScale, climax: arc.climax };
  if (ruleOn(P, "leap")) leapRecovery(notes, ruleCtx);
  if (ruleOn(P, "parallels")) noParallels(notes, ruleCtx);
  if (ruleOn(P, "peak") && arcOn && arc.climax >= 0) melodyPeak(notes, ruleCtx);
  // Picardy third: a minor piece whose last place is bright ends on the major tonic
  const lastF = out[out.length - 1], picardyOn = ruleOn(P, "picardy") && modeIv[2] === 3 && lastF && (lastF.reg.L ?? 0) > 0.55;
  if (picardyOn) { picardy(notes, pc, tc); for (let i = 0; i < cadChord.length; i++) if ((((cadChord[i] - pc) % 12) + 12) % 12 === 3) cadChord[i] += 1; }
  const extraIds = new Set(extra.map(L => L.id));
  applyContours({ notes, points: out, body: plan.body, smooth, extraIds });
  // ties and legato lengthen notes: a passing note held longer now may rub against the chord
  snapLead(notes.filter(nn => !(nn.passage && !nn.snapped && nn === lastOfPassage(nn))));
  if (ruleOn(P, "parallels")) noParallels(notes, ruleCtx);
  // a long melody note held into a chord it rubs against (a semitone from one of its tones) is
  // held until the change, then moves by step to the nearest tone of the new chord: a suspension
  // that resolves
  if (slots.length && ruleOn(P, "suspensions")) for (const nn of notes.filter(m => m.layer === "lead" && !m.dbl && m.dur > 0.5)) {
    for (const S of slots) {
      if (S.t0 <= nn.t + 1e-6 || S.t0 >= nn.t + nn.dur - 0.05) continue;
      const p = pcOf(nn.midi);
      // a note just before the change is an anticipation: it takes a tone of the coming chord
      if (S.t0 <= nn.t + 0.25) {
        if (!S.pcs.has(p) && rubs(p, S)) for (const d of [-1, 1, -2, 2]) if (S.pcs.has(pcOf(nn.midi + d)) && inScale(nn.midi + d, S.t0)) { nn.midi += d; break; }
        break;
      }
      if (S.pcs.has(p) || !rubs(p, S)) continue;
      // only a sliver held over: the note just ends at the change
      if (nn.t + nn.dur - S.t0 < 0.3) { nn.dur = S.t0 - nn.t; break; }
      let to = null;
      for (const d of [-1, 1, -2, 2]) if (S.pcs.has(pcOf(nn.midi + d)) && inScale(nn.midi + d, S.t0)) { to = nn.midi + d; break; }
      const rest = nn.t + nn.dur - S.t0;
      // another melody note starts right there: the held one just ends at the change
      if (to === null || notes.some(m => m.layer === "lead" && !m.dbl && m !== nn && m.t >= S.t0 - 1e-6 && m.t < S.t0 + 0.25)) { nn.dur = S.t0 - nn.t; break; }
      nn.dur = S.t0 - nn.t;
      notes.push({ ...nn, t: S.t0, dur: rest, midi: to, vel: Math.round(nn.vel * 0.85), glide: null, resolved: true });
      break;
    }
  }
  // stop-down (trailer device): everything stops for the half beat before the climax; notes
  // held across that gap are cut and the held ones come back on the climax
  if (R.stopDown && ruleOn(P, "stopDown") && arcOn && arc.climax > 0) {
    const tc0 = out[arc.climax].t0, w0 = tc0 - 0.5, keep = [];
    for (const nn of notes) {
      if (nn.t >= w0 - 1e-9 && nn.t < tc0 - 1e-9) continue;
      if (nn.t < w0 && nn.t + nn.dur > w0 + 1e-9) {
        const end = nn.t + nn.dur;
        keep.push({ ...nn, dur: w0 - nn.t, sweep: null });
        if (nn.layer !== "lead" && nn.layer !== "perc" && end > tc0 + 0.25) keep.push({ ...nn, t: tc0, dur: end - tc0, sweep: null, glide: null });
        continue;
      }
      keep.push(nn);
    }
    notes.length = 0; notes.push(...keep);
  }
  const score = { notes, points: out };
  doubleClimax(score);
  doubleNotes({ notes, points: out, extra, inst, body: plan.body, buildUp: P.buildUp ?? 0.5 });
  // Expert rules on the notes: silence, octave, dynamics, and the added instruments kept to their places
  if (P.expert && P.expert.length) applyExpertNotes(P.expert, notes, out, spb);
  if (ruleOn(P, "melodyTop")) keepMelodyOnTop(notes, extra);
  if (ruleOn(P, "restrikes")) trimRestrikes(notes, extra);
  if (ruleOn(P, "stale")) clipAtChanges(notes, slots, extra, plan.body);
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return {
    version: SCORE_VERSION, bpm, bpmStyle, bars: plan.bars, total: plan.total, body: plan.body, seconds: P.duration,
    requested: points.length, truncated: points.length - plan.count,
    pc, pcOff, modeKey, modeIv, melIv, major, val, energy, notes, points: out, stats, keyManual: P.keyMode === "manual", scaleManual: !!scale, pent, smooth,
    cadence: { t: tc, chord: cadChord, lead: cadLead, bass: cadBass },
    bgArea, ptim, padM, inst, style: P.style, motifCount: motifs.length, arc: { ...arc, amount: arcAmount },
    extra: extra.map(L => ({ id: L.id, role: L.role, preset: L.preset || null, name: inst[L.id].name, ...(L.only ? { only: true, rule: L.rule } : {}) })), expert: P.expert && P.expert.length ? P.expert : null, orch: P.orch === "custom" ? "custom" : (P.orch || "small"),
    slots: slots.map(S => ({ t0: S.t0, t1: S.t1, point: S.F.idx, root: S.root, chord: S.chord, harmKind: S.harmKind, bassKind: S.bassKind, shift: S.shift || 0, cadence: S.cadence || null, expert: S.expert || null })),
    modulation: mod ? { t0: mod.t0, t1: mod.t1, shift: mod.shift, dir: mod.dir, keyPc: mod.keyPc } : null, picardy: !!picardyOn, rules: P.rules || null, sidechain: ruleOn(P, "sidechain") ? R.sidechain || 0 : 0, buildUp: P.buildUp ?? 0.5
  };
}

// ---- continuous regions (Smooth transitions, docs §7.7) ----
// Each focus point has its values (timbre per layer, pan, loudness) at its centre; between two
// points a note takes values blended by its time, so nothing jumps at a boundary. The blend
// zone around a boundary is s · (the shorter of the two points) wide, with a smoothstep:
// s = 0 gives the old steps, s = 1 crosses from centre to centre.
const smoothstep = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const TIM_LOG = ["a", "d", "r", "cut", "q"], TIM_LIN = ["s", "col"];
export function blendTim(A, B, u) {
  if (u <= 0 || A === B) return A;
  if (u >= 1) return B;
  const o = { ...(u < 0.5 ? A : B) };
  for (const k of TIM_LOG) if (A[k] > 0 && B[k] > 0) o[k] = A[k] * (B[k] / A[k]) ** u;
  for (const k of TIM_LIN) if (typeof A[k] === "number" && typeof B[k] === "number") o[k] = A[k] + (B[k] - A[k]) * u;
  return o;
}
// The two points a time falls between and the blend u from the first to the second.
export function regionAt(points, t, s) {
  let k = points.findIndex(F => t >= F.t0 - 1e-9 && t < F.t1 - 1e-9);
  if (k < 0) k = t < points[0].t0 ? 0 : points.length - 1;
  const F = points[k], c = (F.t0 + F.t1) / 2;
  if (t >= c && k + 1 < points.length) {
    const G = points[k + 1], h = (s * Math.min(F.dur, G.dur)) / 2;
    return { A: F, B: G, u: h > 0 ? smoothstep((t - (F.t1 - h)) / (2 * h)) : 0 };
  }
  if (t < c && k > 0) {
    const E = points[k - 1], h = (s * Math.min(E.dur, F.dur)) / 2;
    return { A: E, B: F, u: h > 0 ? smoothstep((t - (F.t0 - h)) / (2 * h)) : 1 };
  }
  return { A: F, B: F, u: 0 };
}
// Metric accent of the melody: the bar's downbeat, then the beats, then the rest.
export const accentAt = t => (Math.abs(t / 4 - Math.round(t / 4)) < 1e-6 ? 1 : Math.abs(t - Math.round(t)) < 1e-6 ? 0.92 : 0.82);

// Applies the continuous regions to the body notes of melody, harmony and bass (in place),
// and ties the melody across point boundaries (rests under half a beat are filled).
// score: { notes, points (t0, t1, dur, tim, pan, vel, dyn), body, smooth }.
export function applyContours(score) {
  const s = Math.min(1, Math.max(0, score.smooth ?? 0)), pts = score.points, body = score.body;
  if (s <= 0 || !pts.length) return score;
  for (const n of score.notes) {
    const isX = !!(score.extraIds && score.extraIds.has(n.layer));
    if (n.point < 0 || n.dbl || n.t >= body - 1e-9 || (!isX && n.layer !== "lead" && n.layer !== "harm" && n.layer !== "bass")) continue;
    const { A, B, u } = regionAt(pts, n.t, s);
    if (isX) { if (A.timX && B.timX) n.tim = blendTim(A.timX[n.layer], B.timX[n.layer], u); continue; }
    n.tim = blendTim(A.tim[n.layer], B.tim[n.layer], u);
    const pan = A.pan + (B.pan - A.pan) * u;
    n.pan = n.layer === "lead" ? pan : n.layer === "harm" ? pan * 0.4 : 0;
    n.glide = null;
    if (n.layer === "lead") {
      const base = (A.vel * (A.dyn ?? 1)) * (1 - u) + (B.vel * (B.dyn ?? 1)) * u;
      n.vel = Math.max(1, Math.min(127, Math.round(base * accentAt(n.t) * (n.pickup ? 0.88 : 1))));
    }
  }
  const lead = score.notes.filter(n => n.layer === "lead" && n.point >= 0 && !n.dbl && n.t < body - 1e-9).sort((a, b) => a.t - b.t);
  for (let i = 0; i + 1 < lead.length; i++) {
    const a = lead[i], b = lead[i + 1];
    if (a.point === b.point) continue;
    const gap = b.t - (a.t + a.dur);
    if (gap > 0 && gap < 0.5) a.dur = b.t - a.t;
  }
  return score;
}

// Orchestration of the climax: the melody is doubled an octave above (below when it would
// pass MIDI 96) at 55% velocity. Applied after the story melody too (see story.js).
// The melody stays on top: a harmony note (or a held section chord) that would sound above the
// melody moves down an octave while it stays at or above MIDI 48 (lower it would get muddy).
export function keepMelodyOnTop(notes, extra = []) {
  const held = new Set(["harm", ...extra.filter(L => L.role === "sustain").map(L => L.id)]);
  const lead = notes.filter(n => n.layer === "lead" && !n.dbl), above = [];
  for (const n of notes) {
    if (!held.has(n.layer)) continue;
    let low = Infinity;
    for (const m of lead) if (m.t < n.t + n.dur - 0.05 && m.t + m.dur > n.t + 0.05 && m.midi < low) low = m.midi;
    if (low === Infinity) continue;
    while (n.midi > low - 1 && n.midi - 12 >= 48) n.midi -= 12;
    if (n.midi > low - 1) above.push([n, low]);
  }
  // a voice that still covers the melody is left out when its chord keeps others under the melody;
  // a voice moved onto another of its chord (an octave folded onto the root) is left out too
  const drop = new Set(), seen = new Map();
  for (const n of notes) {
    if (!held.has(n.layer)) continue;
    const k = n.layer + "|" + n.t.toFixed(6) + "|" + n.midi;
    if (seen.has(k)) drop.add(n); else seen.set(k, n);
  }
  for (const [n, low] of above) if (notes.some(m => m !== n && m.layer === n.layer && Math.abs(m.t - n.t) < 1e-6 && m.midi < low - 1 && !drop.has(m))) drop.add(n);
  for (let k = notes.length - 1; k >= 0; k--) if (drop.has(notes[k])) notes.splice(k, 1);
}
// A note that starts while the same pitch still sounds in its layer ends the earlier one there:
// two copies of one sampled note would phase and click. Single-line layers (the melody, the
// bass, counter-melody, runs, doubling, ostinato, pulse, ornaments) end the earlier note at any
// pitch, so a held note never rubs against the next one.
const MONO_ROLES = new Set(["counter", "runs", "double", "ostinato", "pulse", "ornament"]);
export function trimRestrikes(notes, extra = []) {
  const mono = new Set(["lead", "bass", ...extra.filter(L => MONO_ROLES.has(L.role)).map(L => L.id)]);
  const by = new Map();
  for (const n of notes) { if (n.layer === "perc" || n.dbl) continue; const k = mono.has(n.layer) ? n.layer : n.layer + "|" + n.midi; if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
  for (const list of by.values()) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i + 1 < list.length; i++) { const a = list[i], b = list[i + 1]; if (b.t > a.t + 1e-6 && b.t < a.t + a.dur - 1e-6) a.dur = Math.max(0.05, b.t - a.t - 0.02); }
  }
}

// An accompaniment note (the harmony or an extra layer, not the drone, which is a pedal) that
// would sound on into a chord it rubs against (a semitone from one of its tones) ends at the change.
// The same rules for a melody written after the composition (Story, Improvise): a note on a
// beat or a long one moves to a chord tone of the melody's scale; an "avoid note" held half a
// beat moves too, unless it resolves by step into a chord tone; a long note held into a chord it
// rubs against resolves by step at the change.
export function fitMelody(score) {
  const pc = m => ((m % 12) + 12) % 12;
  const slots = (score.slots || []).map(S => ({ ...S, pcs: new Set(S.chord.map(pc)) }));
  if (!slots.length) return;
  const scalePcs = new Set(score.melIv.map(iv => pc(iv + score.pcOff))), M = score.modulation;
  const slotAt = t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1];
  const inScale = (m, t) => scalePcs.has(pc(m - (M && t >= M.t0 - 1e-9 && t < M.t1 - 1e-9 ? M.shift : 0)));
  const rubs = (p, S) => S.pcs.has(pc(p + 1)) || S.pcs.has(pc(p - 1));
  const lead = score.notes.filter(n => n.layer === "lead" && !n.dbl && n.point >= 0).sort((a, b) => a.t - b.t);
  lead.forEach((nn, i) => {
    if (nn.t >= score.body - 1e-9) return;
    const S = slotAt(nn.t), p = pc(nn.midi);
    if (S.pcs.has(p)) return;
    const strong = Math.abs(nn.t - Math.round(nn.t)) < 1e-6 || nn.dur >= 0.9, avoid = nn.dur >= 0.5 - 1e-9 && rubs(p, S);
    if (!strong && !avoid) return;
    const nx = lead[i + 1];
    const r = pc(score.modeIv[((S.root % score.modeIv.length) + score.modeIv.length) % score.modeIv.length] + score.pcOff + (S.shift || 0));
    const rootRub = pc(p - r) === 1 || pc(r - p) === 1;
    if (!strong && nx && nx.t <= nn.t + nn.dur + 0.25 && Math.abs(nx.midi - nn.midi) <= 2 && slotAt(nx.t).pcs.has(pc(nx.midi)) && nn.dur <= 1 && (nn.dur <= 0.5 || !rootRub)) return;
    let to = null;
    for (const d of [-1, 1, -2, 2, -3, 3]) { const m = nn.midi + d; if (inScale(m, nn.t) && S.pcs.has(pc(m))) { to = m; break; } }
    if (to === null && (!strong || avoid)) for (const d of [-1, 1, -2, 2]) { const m = nn.midi + d; if (inScale(m, nn.t) && !rubs(pc(m), S)) { to = m; break; } }
    if (to !== null) { nn.midi = to; nn.snapped = true; }
  });
  for (const nn of lead) {
    if (nn.dur <= 0.5) continue;
    for (const S of slots) {
      if (S.t0 <= nn.t + 0.25 || S.t0 >= nn.t + nn.dur - 0.25) continue;
      const p = pc(nn.midi);
      if (S.pcs.has(p) || !rubs(p, S)) continue;
      let to = null;
      for (const d of [-1, 1, -2, 2]) if (S.pcs.has(pc(nn.midi + d)) && inScale(nn.midi + d, S.t0)) { to = nn.midi + d; break; }
      const rest = nn.t + nn.dur - S.t0;
      if (to === null || lead.some(m => m !== nn && m.t >= S.t0 - 1e-6 && m.t < S.t0 + 0.25)) { nn.dur = S.t0 - nn.t; break; }
      nn.dur = S.t0 - nn.t;
      score.notes.push({ ...nn, t: S.t0, dur: rest, midi: to, vel: Math.round(nn.vel * 0.85), glide: null, resolved: true });
      break;
    }
  }
}
// The melody rules for a melody written after the composition.
export function melodyRules(score) {
  const pc = m => ((m % 12) + 12) % 12, P = { rules: score.rules };
  const slots = (score.slots || []).map(S => ({ ...S, pcs: new Set(S.chord.map(pc)) })); if (!slots.length) return;
  const scalePcs = new Set(score.melIv.map(iv => pc(iv + score.pcOff))), M = score.modulation;
  const ctx = { slotAt: t => slots.find(S => t >= S.t0 - 1e-9 && t < S.t1 - 1e-9) || slots[slots.length - 1], inScale: (m, t) => scalePcs.has(pc(m - (M && t >= M.t0 - 1e-9 && t < M.t1 - 1e-9 ? M.shift : 0))), climax: score.arc ? score.arc.climax : -1 };
  if (ruleOn(P, "leap")) leapRecovery(score.notes, ctx);
  if (ruleOn(P, "parallels")) noParallels(score.notes, ctx);
  if (ruleOn(P, "peak") && ctx.climax >= 0 && score.arc && score.arc.amount > 0.25) melodyPeak(score.notes, ctx);
}
// Voices after any melody change: the melody on top, no restrikes, no notes held into a chord
// they rub against.
export function cleanVoices(score) {
  const pc = m => ((m % 12) + 12) % 12, P = { rules: score.rules };
  if (ruleOn(P, "melodyTop")) keepMelodyOnTop(score.notes, score.extra || []);
  if (ruleOn(P, "restrikes")) trimRestrikes(score.notes, score.extra || []);
  if (ruleOn(P, "stale")) clipAtChanges(score.notes, (score.slots || []).map(S => ({ ...S, pcs: new Set(S.chord.map(pc)) })), score.extra || [], score.body);
}

export function clipAtChanges(notes, slots, extra = [], body = Infinity) {
  if (!slots.length) return;
  const lines = new Set(extra.filter(L => ["runs", "counter", "ornament"].includes(L.role)).map(L => L.id));
  const pcx = m => ((m % 12) + 12) % 12;
  for (const n of notes) {
    if (!lines.has(n.layer) || n.chromatic || n.dur < 0.5 - 1e-9) continue;
    const S = slots.find(S => n.t >= S.t0 - 1e-9 && n.t < S.t1 - 1e-9); if (!S) continue;
    const p = pcx(n.midi);
    if (S.pcs.has(p) || !(S.pcs.has(pcx(p + 1)) || S.pcs.has(pcx(p - 1)))) continue;
    for (const d of [-1, 1, -2, 2]) if (S.pcs.has(pcx(n.midi + d))) { n.midi += d; break; }
  }
  const layers = new Set(["harm", ...extra.filter(L => L.role !== "drone").map(L => L.id)]);
  const pc = m => ((m % 12) + 12) % 12;
  for (const n of notes) {
    if (!layers.has(n.layer) || n.chromatic) continue;
    for (const S of slots) {
      if (S.t0 <= n.t + 0.05 || S.t0 >= n.t + n.dur - 0.1 || S.t0 >= body) continue;
      const p = pc(n.midi);
      if (!S.pcs.has(p) && (S.pcs.has(pc(p + 1)) || S.pcs.has(pc(p - 1)))) { n.dur = Math.max(0.1, S.t0 - n.t - 0.02); break; }
    }
  }
}

export function doubleClimax(score) {
  const dbl = [];
  for (const nn of score.notes) {
    if (nn.layer !== "lead" || nn.point < 0 || nn.dbl) continue;
    const F = score.points[nn.point];
    if (!F || F.section !== "climax") continue;
    dbl.push({ ...nn, midi: nn.midi + 12 <= 96 ? nn.midi + 12 : nn.midi - 12, vel: Math.max(1, Math.round(nn.vel * 0.55)), glide: null, dbl: true });
  }
  score.notes.push(...dbl);
  return score;
}

// Pad voicing of a triad (three pitch classes). Without a previous voicing: close position
// from the root near G3. Otherwise each voice takes the nearest octave of one chord tone,
// choosing the assignment with the smallest total motion (ties: the first permutation),
// kept within MIDI 45-74.
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
export function padVoicing(pcs, prev) {
  const near = (pc, ref) => { let m = ref - ((((ref - pc) % 12) + 12) % 12); if (ref - m > 6) m += 12; return m; };
  const fit = m => (m < 45 ? m + 12 : m > 74 ? m - 12 : m);
  if (!prev) {
    const r = near(pcs[0], 55), t = r + ((((pcs[1] - r) % 12) + 12) % 12), f = t + ((((pcs[2] - t) % 12) + 12) % 12);
    return [r, t, f].map(fit);
  }
  let best = null, bc = Infinity;
  for (const p of PERMS) {
    const c = p.map((j, k) => fit(near(pcs[j], prev[k]))), cost = c.reduce((s, m, k) => s + Math.abs(m - prev[k]), 0);
    if (cost < bc) { bc = cost; best = c; }
  }
  return best;
}

export function romanOf(root, modeIv) {
  const R = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const iv = d => degMidi(d, modeIv, 0);
  const third = iv(root + 2) - iv(root), fifth = iv(root + 4) - iv(root);
  const s = R[root % 7];
  if (third === 4) return s;
  if (fifth === 6) return s.toLowerCase() + "°";
  return s.toLowerCase();
}
